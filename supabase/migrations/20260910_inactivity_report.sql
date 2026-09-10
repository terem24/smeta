-- Отчёт по напоминаниям неактивным: кому ушло, кто вернулся, кто нет.
--
-- Дополняет 20260909_inactivity_lifecycle.sql. Ту миграцию уже выполнили, поэтому
-- здесь ничего из неё не переписывается: след об удалённых снимает триггер, а не
-- изменённая process_inactive_accounts — так не нужно вклеивать заново полторы
-- сотни строк работающего кода ради одной вставки.
--
-- Выполнить вручную в Supabase SQL Editor, весь файл целиком за один раз.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Кого правило довело до удаления.
--
-- Журнал inactivity_notices удаляется вместе с учёткой (on delete cascade), и без
-- этой таблицы удалённые исчезали бы из отчёта совсем: «предупредили десятерых,
-- вернулось трое», а куда делись остальные — не видно.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.inactivity_deleted (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid,                    -- без ссылки: строки в users уже нет
    name         text,
    email        text,
    phone        text,
    region       text,
    city         text,
    warned_at    timestamptz,
    frozen_at    timestamptz,
    last_visited timestamptz,
    estimates    int,
    deleted_at   timestamptz not null default now()
);

alter table public.inactivity_deleted enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Триггер: перед удалением замороженной учётки сохраняем о ней память.
--
-- Срабатывает и на ручное удаление из админки — если человек был заморожен,
-- это тот же самый исход, и в отчёте он должен остаться.
--
-- Любая ошибка внутри проглатывается: журнал не повод сорвать удаление.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.log_inactive_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if old.frozen_at is not null then
        begin
            insert into public.inactivity_deleted
                (user_id, name, email, phone, region, city, warned_at, frozen_at, last_visited, estimates)
            select old.id,
                   coalesce(nullif(btrim(concat_ws(' ', old.last_name, old.first_name, old.middle_name)), ''),
                            nullif(btrim(old.username), ''), old.email, 'Без имени'),
                   old.email, old.phone, old.region, old.city,
                   (select n.warned_at from public.inactivity_notices n where n.user_id = old.id),
                   old.frozen_at, old.last_visited,
                   (select count(*)::int from public.estimates e where e.user_id = old.id);
        exception when others then
            raise notice 'log_inactive_deletion: след об учётке % не записан', old.id;
        end;
    end if;
    return old;
end;
$$;

drop trigger if exists users_log_inactive_delete on public.users;
create trigger users_log_inactive_delete
    before delete on public.users
    for each row execute function public.log_inactive_deletion();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Сам отчёт.
--
-- Одной таблицей: и те, кому напоминание ушло только что, и замороженные, и уже
-- удалённые. Столбец returned_at заполнен, если человек заходил ПОСЛЕ письма, —
-- это и есть ответ на вопрос «вернулся или проигнорировал».
--
-- Таблицы под RLS без политик, читать их напрямую браузер не может: отчёт отдаёт
-- эта функция, и только администратору или наблюдателю.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.inactivity_report()
returns table (
    user_id      uuid,
    name         text,
    email        text,
    phone        text,
    region       text,
    city         text,
    stage        text,          -- warned | frozen | deleted
    warned_at    timestamptz,
    frozen_at    timestamptz,
    last_visited timestamptz,
    returned_at  timestamptz,
    estimates    int
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if not exists (
        select 1 from public.users me
         where me.auth_user_id = auth.uid()
           and (me.account_type in ('admin', 'viewer')
                or lower(btrim(me.email)) in ('dima24ba@gmail.com', 'kovdorekb@gmail.com', 'kovdor24@yandex.ru'))
    ) then
        raise exception 'Отчёт доступен только администратору';
    end if;

    return query
    select u.id,
           coalesce(nullif(btrim(concat_ws(' ', u.last_name, u.first_name, u.middle_name)), ''),
                    nullif(btrim(u.username), ''), u.email, 'Без имени')::text,
           u.email, u.phone, u.region, u.city,
           (case when u.frozen_at is not null then 'frozen' else 'warned' end)::text,
           n.warned_at, u.frozen_at, u.last_visited,
           -- Зашёл после письма — значит напоминание сработало
           case when u.last_visited > n.warned_at then u.last_visited end,
           (select count(*)::int from public.estimates e where e.user_id = u.id)
      from public.inactivity_notices n
      join public.users u on u.id = n.user_id

    union all

    select d.user_id, d.name, d.email, d.phone, d.region, d.city,
           'deleted'::text, d.warned_at, d.frozen_at, d.last_visited,
           null::timestamptz, d.estimates
      from public.inactivity_deleted d

    order by 8 desc nulls last;
end;
$$;

revoke all on function public.log_inactive_deletion() from public, anon, authenticated;
grant execute on function public.inactivity_report() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Проверки (выполнять отдельно, по желанию).
--
-- Весь отчёт как его видит админка:
--   select * from public.inactivity_report();
--
-- Сколько вернулось после напоминания:
--   select count(*) filter (where returned_at is not null) as вернулись,
--          count(*) filter (where returned_at is null and stage = 'warned') as молчат,
--          count(*) filter (where stage = 'frozen') as заморожены,
--          count(*) filter (where stage = 'deleted') as удалены
--     from public.inactivity_report();
-- ─────────────────────────────────────────────────────────────────────────
