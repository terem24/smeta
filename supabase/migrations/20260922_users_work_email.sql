-- Рабочая почта пользователя.
--
-- Менеджера вписывают в карточку дистрибьютора рабочим адресом (…@teremopt.ru),
-- а входит он нередко личной почтой или через Яндекс ID. Тогда ни одна сверка
-- «почта в карточке = почта учётки» его не узнаёт: нет своих монтажников, чата,
-- напоминаний и журнала. Владелец вписывает рабочий адрес в карточку пользователя
-- в админке, и дальше сверка идёт по обеим почтам.

alter table public.users add column if not exists work_email text;

-- ── Журнал действий команды: кто может писать и кто видит ──────────────────
create or replace function public.team_activity_visible(p_dist uuid, p_actor uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
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
                           and lower(btrim(d.director_email)) in (
                                lower(btrim(coalesce(u.email, ''))),
                                lower(btrim(coalesce(u.work_email, '')))))))
               )
        );
$function$;

create or replace function public.log_team_activity(p_action text, p_distributor uuid default null::uuid, p_target_user uuid default null::uuid, p_target text default null::text, p_meta jsonb default null::jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
                   and exists (
                        select 1 from unnest(array[lower(btrim(coalesce(u.email, ''))),
                                                   lower(btrim(coalesce(u.work_email, '')))]) m(v)
                         where m.v <> ''
                           and m.v in (lower(btrim(coalesce(d.manager_email, ''))),
                                       lower(btrim(coalesce(d.director_email, '')))))))
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
$function$;

-- ── Поздравления и напоминания по КП: менеджер находится и по рабочей почте ──
-- Функции большие, поэтому меняем в них одну строку, а не переписываем целиком.
do $$
declare
    src text;
    old_s text;
    new_s text;
begin
    old_s := 'on lower(btrim(mu.email)) = lower(btrim(coalesce(nullif(d.manager_email, ''''), d.director_email)))';
    new_s := 'on lower(btrim(coalesce(nullif(d.manager_email, ''''), d.director_email))) in (lower(btrim(mu.email)), lower(btrim(mu.work_email)))';
    select pg_get_functiondef('public.send_birthday_greetings()'::regprocedure) into src;
    if position(old_s in src) > 0 then
        execute replace(src, old_s, new_s);
    elsif position(new_s in src) = 0 then
        raise exception 'send_birthday_greetings: не найдена строка поиска менеджера';
    end if;

    old_s := 'on lower(btrim(mu.email)) in (';
    new_s := 'on lower(btrim(mu.work_email)) in (lower(btrim(nullif(d.manager_email, ''''))), lower(btrim(nullif(d.director_email, ''''))))'
          || ' or lower(btrim(mu.email)) in (';
    select pg_get_functiondef('public.send_kp_invoice_reminders(boolean)'::regprocedure) into src;
    if position(new_s in src) = 0 then
        if position(old_s in src) = 0 then
            raise exception 'send_kp_invoice_reminders: не найдена строка поиска менеджера';
        end if;
        execute replace(src, old_s, new_s);
    end if;
end $$;
