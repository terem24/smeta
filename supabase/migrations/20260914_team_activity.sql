-- Журнал действий сотрудников дистрибьютора: менеджеров, руководителей, администрации.
--
-- ЗАЧЕМ. Руководитель компании с несколькими филиалами хочет видеть не только сметы
-- монтажников (они уже есть в invoice_events), но и работу самих менеджеров: сколько
-- раз менеджер разослал ссылку-приглашение, сколько статусов счетов поменял, сколько
-- написал монтажникам. До сих пор кнопки «Поделиться», «Ссылка», «QR» и «Печать» не
-- оставляли следа нигде — посчитать разосланные ссылки было не из чего.
--
-- ЧТО ПИШЕТСЯ (поле action):
--   invite_share   — «Поделиться» (системное меню телефона или текст в буфер)
--   invite_link    — «Ссылка» (скопирована ссылка-приглашение)
--   invite_qr      — QR-код показан на экране
--   invite_print   — лист А5 отправлен на печать
--   status_change  — менеджер/руководитель сменил статус счёта в планировщике
--   message        — сотрудник написал монтажнику из панели
--
-- ПОЧЕМУ ЗАПИСЬ ТОЛЬКО ФУНКЦИЕЙ. Кто действовал, решает сервер по сессии, а не браузер:
-- иначе любой с публичным ключом дописал бы менеджеру сотню «разосланных ссылок».
-- Прямой insert в таблицу закрыт.
--
-- ПОЧЕМУ ЧТЕНИЕ ЗАКРЫТО ПО ФИЛИАЛАМ. Филиалы одной компании не должны видеть работу друг
-- друга. В отличие от старых таблиц (users, estimates — открыты на чтение, см. заметку о
-- доступе), эта таблица новая, и её можно сразу закрыть как надо:
--   • администрация сайта видит всё;
--   • наблюдатель — филиалы из своего списка (users.viewer_distributor_ids);
--   • менеджер — свой филиал (users.distributor_id);
--   • директор — филиалы, где его почта стоит в карточке в поле «Email директора»;
--   • любой — свои собственные записи.
--
-- Выполнить вручную в Supabase SQL Editor, весь файл целиком за один раз.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Таблица
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.team_activity (
    id             bigint generated always as identity primary key,
    created_at     timestamptz not null default now(),
    actor_id       uuid references public.users(id) on delete set null,
    actor_email    text,
    actor_name     text,
    actor_role     text,
    distributor_id uuid,
    action         text not null,
    target_user_id uuid,
    target         text,
    meta           jsonb
);

create index if not exists team_activity_dist_idx  on public.team_activity (distributor_id, created_at desc);
create index if not exists team_activity_actor_idx on public.team_activity (actor_id, created_at desc);

alter table public.team_activity enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Кто видит записи филиала
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.team_activity_visible(p_dist uuid, p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.is_admin()
        or exists (
            select 1
              from public.users u
             where u.auth_user_id = auth.uid()
               and (
                    u.id = p_actor
                 or (p_dist is not null and u.account_type = 'viewer'
                     and p_dist = any(coalesce(u.viewer_distributor_ids, '{}')))
                 or (p_dist is not null and u.account_type = 'manager'
                     and u.distributor_id = p_dist)
                 or (p_dist is not null and exists (
                        select 1 from public.distributors d
                         where d.id = p_dist
                           and coalesce(btrim(d.director_email), '') <> ''
                           and lower(btrim(d.director_email)) = lower(btrim(coalesce(u.email, '')))))
               )
        );
$$;

drop policy if exists team_activity_read on public.team_activity;
create policy team_activity_read on public.team_activity
    for select using (public.team_activity_visible(distributor_id, actor_id));

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Запись действия
--
-- Филиал можно не передавать: для сообщения и смены статуса он берётся из карточки
-- монтажника (p_target_user). Писать разрешено только тем, у кого есть к чему:
-- служебным ролям и тем, чья почта стоит менеджером/директором в карточке филиала
-- (менеджер без роли раздаёт приглашения из кабинета).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.log_team_activity(
    p_action      text,
    p_distributor uuid  default null,
    p_target_user uuid  default null,
    p_target      text  default null,
    p_meta        jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    u      public.users%rowtype;
    v_dist uuid;
    v_name text;
begin
    if p_action not in ('invite_share', 'invite_link', 'invite_qr', 'invite_print', 'status_change', 'message') then
        return;
    end if;

    select * into u from public.users where auth_user_id = auth.uid() limit 1;
    if not found then
        return;                                   -- гость: писать некому
    end if;

    v_dist := p_distributor;
    if v_dist is null and p_target_user is not null then
        select distributor_id into v_dist from public.users where id = p_target_user;
    end if;

    if not (
        public.is_admin()
        or coalesce(u.account_type, '') in ('admin', 'viewer', 'manager')
        or (v_dist is not null and exists (
                select 1 from public.distributors d
                 where d.id = v_dist
                   and lower(btrim(coalesce(u.email, ''))) in (
                        lower(btrim(coalesce(d.manager_email, ''))),
                        lower(btrim(coalesce(d.director_email, ''))))))
    ) then
        return;
    end if;

    -- meta приходит из браузера: не больше пары килобайт, иначе журнал превратится в свалку
    if p_meta is not null and (jsonb_typeof(p_meta) <> 'object' or length(p_meta::text) > 2000) then
        p_meta := null;
    end if;

    v_name := nullif(btrim(concat_ws(' ', u.last_name, u.first_name)), '');

    insert into public.team_activity
        (actor_id, actor_email, actor_name, actor_role, distributor_id, action, target_user_id, target, meta)
    values
        (u.id, u.email, coalesce(v_name, u.username, u.email), u.account_type,
         v_dist, p_action, p_target_user, left(p_target, 200), p_meta);
end;
$$;

revoke all on function public.log_team_activity(text, uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.log_team_activity(text, uuid, uuid, text, jsonb) to authenticated;
