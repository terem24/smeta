-- Удаление анкет без следа заменяется архивом и статистикой.
--
-- 1) estimates_deleted — сметы удалённого человека не исчезают: каждая уходит сюда со
--    статусом 'deleted' (status_before — прежний), причиной, датой и полной копией строки
--    в row_data (jsonb). Публичная ссылка на КП при этом не работает (в estimates строки
--    нет), но сама смета цела и восстановима: insert into estimates
--    select * from jsonb_populate_record(null::public.estimates, row_data).
-- 2) empty_accounts_log хранит снимок человека на момент удаления: когда зарегистрировался,
--    сколько расчётов начал, сколько смет сохранил, сколько заходил, какой тариф.
-- 3) registration_funnel() — воронка по месяцам регистрации (для админки): сколько
--    зарегистрировалось, не считали вовсе / считали, но не сохранили / сохранили смету,
--    сколько сейчас заморожено и сколько удалено. Живые и удалённые считаются вместе,
--    поэтому после чисток цифры за сезон не проваливаются.
--
-- Охват: архив и снимок пишет ночной проход process_empty_accounts. Ручное удаление
-- кнопкой «Удалить» и проход неактивных по-прежнему стирают сметы физически.

create table if not exists public.estimates_deleted (
    id              bigserial primary key,
    estimate_id     uuid,
    user_id         uuid,
    user_name       text,
    status          text not null default 'deleted',
    status_before   text,
    project_name    text,
    total_sum       numeric,
    created_at_est  timestamptz,
    reason          text,
    deleted_at      timestamptz not null default now(),
    row_data        jsonb not null
);
create index if not exists estimates_deleted_user_idx on public.estimates_deleted (user_id);
alter table public.estimates_deleted enable row level security;

alter table public.empty_accounts_log add column if not exists calcs_started int;
alter table public.empty_accounts_log add column if not exists last_visited timestamptz;
alter table public.empty_accounts_log add column if not exists visits int;
alter table public.empty_accounts_log add column if not exists account_type text;

create or replace function public.process_empty_accounts(dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    cfg         jsonb := public.empty_accounts_cfg();
    on_flag     boolean := (cfg->>'enabled')::boolean;
    freeze_days int := (cfg->>'freeze_days')::int;
    stale_days  int := (cfg->>'stale_days')::int;
    delete_days int := (cfg->>'delete_days')::int;
    sender      uuid;
    u           record;
    nm          text;
    body        text;
    calcs       int;
    frozen      int := 0;
    frozen_stale int := 0;
    deleted     int := 0;
    kept_done   int := 0;
begin
    if not on_flag and not dry_run then
        return jsonb_build_object('enabled', false);
    end if;

    select id into sender from public.users
     where lower(btrim(email)) = 'dima24ba@gmail.com' limit 1;
    if sender is null then
        select id into sender from public.users
         where account_type = 'admin' order by created_at limit 1;
    end if;

    -- ── Удаление: заморожен этим правилом, срок вышел ────────────────────────
    -- Смету со статусом completed не удаляем: такая учётка остаётся замороженной.
    for u in
        select us.id, us.email, us.username, us.phone, us.region, us.created_at,
               us.last_visited, us.account_type, us.sess_visits,
               (select count(*)::int from public.estimates e where e.user_id = us.id) as n_est,
               (select l.reason from public.empty_accounts_log l
                 where l.user_id = us.id and l.action = 'frozen' order by l.at desc limit 1) as reason,
               coalesce(nullif(btrim(concat_ws(' ', us.last_name, us.first_name, us.middle_name)), ''),
                        nullif(btrim(us.username), ''), us.email, 'Без имени') as full_name
          from public.users us
         where us.frozen_at is not null
           and us.frozen_at < now() - make_interval(days => delete_days)
           and us.account_type not in ('admin', 'viewer', 'manager', 'pro')
           and exists (select 1 from public.empty_accounts_log l where l.user_id = us.id and l.action = 'frozen')
    loop
        if exists (select 1 from public.estimates e where e.user_id = u.id and e.status = 'completed') then
            kept_done := kept_done + 1;
            continue;
        end if;
        if not dry_run then
            select count(distinct ie.calc_id)::int into calcs
              from public.invoice_events ie
             where ie.calc_id is not null
               and (ie.user_id = u.id::text
                    or (ie.user_id is null and btrim(coalesce(u.email, '')) <> ''
                        and lower(btrim(ie.user_email)) = lower(btrim(u.email))));

            -- Сметы не стираем, а переводим в «удалена» и кладём в архив.
            insert into public.estimates_deleted
                (estimate_id, user_id, user_name, status, status_before, project_name, total_sum,
                 created_at_est, reason, row_data)
            select e.id, e.user_id, u.full_name, 'deleted', e.status, e.project_name, e.total_sum,
                   e.created_at, u.reason, to_jsonb(e)
              from public.estimates e where e.user_id = u.id;

            insert into public.empty_accounts_log
                (user_id, action, name, email, phone, region, created_at_user, reason, est_count,
                 calcs_started, last_visited, visits, account_type)
            values (u.id, 'deleted', u.full_name, u.email, u.phone, u.region, u.created_at, u.reason, u.n_est,
                    coalesce(calcs, 0), u.last_visited, u.sess_visits, u.account_type);

            update public.users set frozen_at = null where id = u.id;

            delete from public.estimates where user_id = u.id;
            delete from public.messages where sender_id = u.id or recipient_id = u.id;
            delete from public.manager_chat_messages
             where installer_user_id = u.id or manager_user_id = u.id or sender_user_id = u.id;
            delete from public.inactivity_notices where user_id = u.id;
            delete from public.users where id = u.id;

            begin
                delete from auth.users au
                 where lower(btrim(au.email)) = lower(btrim(coalesce(u.email, '')))
                   and btrim(coalesce(u.email, '')) <> '';
            exception when others then
                raise notice 'process_empty_accounts: логин % в auth.users не удалён (нет прав)', u.email;
            end;
        end if;
        deleted := deleted + 1;
    end loop;

    -- ── Заморозка ────────────────────────────────────────────────────────────
    for u in
        select * from (
            select us.id, us.email, us.username, us.first_name, us.phone, us.region, us.created_at, us.account_type,
                   us.last_visited, us.sess_visits,
                   (select count(*)::int from public.estimates e where e.user_id = us.id) as n_est,
                   (select max(coalesce(e.updated_at, e.created_at)) from public.estimates e where e.user_id = us.id) as last_est,
                   coalesce(nullif(btrim(concat_ws(' ', us.last_name, us.first_name, us.middle_name)), ''),
                            nullif(btrim(us.username), ''), us.email, 'Без имени') as full_name
              from public.users us
             where us.frozen_at is null
               and us.account_type not in ('admin', 'viewer', 'manager')
               and not (us.account_type = 'pro'
                        and (us.pro_expires_at > now() or us.demo_ends_at is null or us.demo_ends_at > now()))
               and coalesce(us.is_blocked, false) = false
               and coalesce(us.is_test, false) = false
               and not exists (select 1 from public.empty_accounts_log l where l.user_id = us.id and l.action = 'frozen')
        ) s
         where (s.n_est = 0 and s.created_at < now() - make_interval(days => freeze_days))
            or (s.n_est > 0 and s.account_type in ('base', 'free')
                and s.last_est < now() - make_interval(days => stale_days))
    loop
        nm := coalesce(nullif(btrim(u.first_name), ''), nullif(btrim(u.username), ''), 'Коллега');
        if u.n_est = 0 then
            body := format(
E'%s, вы зарегистрировались на HeatCalc.ru, но за %s дней не сохранили ни одного расчёта — поэтому доступ к учётной записи приостановлен.

Если калькулятор вам нужен, напишите на kovdor24@yandex.ru или в MAX: +7 982 610-95-48 — включим в тот же день.

Если ответа не будет, через %s дней учётная запись будет удалена. Это ни на что не повлияет: зарегистрироваться заново можно в любой момент.

Администрация HeatCalc.ru',
                nm, freeze_days, delete_days);
        else
            body := format(
E'%s, в вашей учётной записи на HeatCalc.ru больше %s дней нет новых расчётов — поэтому доступ приостановлен.

Сохранённые расчёты (%s) пока никуда не делись. Чтобы вернуть доступ, напишите на kovdor24@yandex.ru или в MAX: +7 982 610-95-48 — включим в тот же день, ничего заполнять заново не придётся.

Если ответа не будет, через %s дней учётная запись будет удалена, а ссылки на отправленные КП перестанут открываться. Сами расчёты останутся в архиве — их можно восстановить по запросу.

Администрация HeatCalc.ru',
                nm, stale_days, u.n_est, delete_days);
        end if;

        if not dry_run then
            update public.users set frozen_at = now() where id = u.id;
            insert into public.empty_accounts_log
                (user_id, action, name, email, phone, region, created_at_user, reason, est_count,
                 last_visited, visits, account_type)
            values (u.id, 'frozen', u.full_name, u.email, u.phone, u.region, u.created_at,
                    case when u.n_est = 0 then 'no_estimates' else 'stale' end, u.n_est,
                    u.last_visited, u.sess_visits, u.account_type);

            if sender is not null then
                insert into public.messages (sender_id, recipient_id, text, type)
                values (sender, u.id, body, 'private');
            end if;
            if u.email is not null and btrim(u.email) <> '' then
                perform public.inactivity_send_email(u.email, 'Доступ к HeatCalc.ru приостановлен', body);
            end if;
        end if;
        frozen := frozen + 1;
        if u.n_est > 0 then frozen_stale := frozen_stale + 1; end if;
    end loop;

    return jsonb_build_object('enabled', on_flag, 'frozen', frozen, 'frozen_stale', frozen_stale,
                              'deleted', deleted, 'kept_completed', kept_done, 'dry_run', dry_run);
end;
$$;
revoke all on function public.process_empty_accounts(boolean) from public, anon, authenticated;

-- Воронка по месяцам регистрации: живые учётки + снимки удалённых правилом.
-- none — ни расчёта, ни сметы; calc_only — расчёты начинал, не сохранил; saved — есть смета.
create or replace function public.registration_funnel()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    res jsonb;
begin
    if not public.is_admin() then
        raise exception 'Только для администратора';
    end if;

    with live as (
        select date_trunc('month', us.created_at) as m,
               (select count(*) from public.estimates e where e.user_id = us.id) as n_est,
               exists (select 1 from public.invoice_events ie
                        where ie.calc_id is not null
                          and (ie.user_id = us.id::text
                               or (ie.user_id is null and btrim(coalesce(us.email, '')) <> ''
                                   and lower(btrim(ie.user_email)) = lower(btrim(us.email))))) as calc,
               (us.frozen_at is not null) as is_frozen,
               false as is_deleted
          from public.users us
         where us.account_type not in ('admin', 'viewer', 'manager')
           and coalesce(us.is_test, false) = false
    ), gone as (
        select date_trunc('month', l.created_at_user) as m,
               coalesce(l.est_count, 0) as n_est,
               coalesce(l.calcs_started, 0) > 0 as calc,
               false as is_frozen,
               true as is_deleted
          from public.empty_accounts_log l
         where l.action = 'deleted' and l.created_at_user is not null
    ), allp as (
        select * from live union all select * from gone
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'month',      to_char(m, 'YYYY-MM'),
               'registered', total,
               'none',       none_n,
               'calc_only',  calc_n,
               'saved',      saved_n,
               'frozen',     frozen_n,
               'deleted',    deleted_n) order by m desc), '[]'::jsonb)
      into res
      from (
        select m,
               count(*) as total,
               count(*) filter (where n_est = 0 and not calc) as none_n,
               count(*) filter (where n_est = 0 and calc) as calc_n,
               count(*) filter (where n_est > 0) as saved_n,
               count(*) filter (where is_frozen) as frozen_n,
               count(*) filter (where is_deleted) as deleted_n
          from allp
         group by m
      ) t;
    return res;
end;
$$;
grant execute on function public.registration_funnel() to authenticated;
