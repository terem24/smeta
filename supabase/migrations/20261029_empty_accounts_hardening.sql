-- Укрепление правила «без смет»:
--   * предохранитель: за ночь не больше max_delete (по умолчанию 10) удалений;
--   * письма правила не отключаются первыми при нехватке лимита почты (тип 'inactivity');
--   * архив смет и снимок человека при ЛЮБОМ удалении (админка, ночные проходы, каскад);
--   * журнал правила для админки, возврат смет из архива, заявка замороженного на доступ;
--   * предупреждение монтажнику перед автоотклонением его КП.

create or replace function public.empty_accounts_cfg()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    cfg jsonb;
    res jsonb := '{"enabled": false, "freeze_days": 30, "stale_days": 60, "delete_days": 30, "warn_days": 7, "max_delete": 10}'::jsonb;
begin
    select value into cfg from public.app_settings where key = 'empty_accounts';
    if cfg is not null then
        begin
            res := jsonb_build_object(
                'enabled',     coalesce((cfg->>'enabled')::boolean, false),
                'freeze_days', greatest(coalesce((cfg->>'freeze_days')::int, 30), 1),
                'stale_days',  greatest(coalesce((cfg->>'stale_days')::int, 60), 1),
                'delete_days', greatest(coalesce((cfg->>'delete_days')::int, 30), 1),
                'warn_days',   greatest(coalesce((cfg->>'warn_days')::int, 7), 1),
                'max_delete',  greatest(coalesce((cfg->>'max_delete')::int, 10), 1));
        exception when others then
            null;
        end;
    end if;
    return res;
end;
$$;
revoke all on function public.empty_accounts_cfg() from public, anon, authenticated;

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
    warn_days   int := (cfg->>'warn_days')::int;
    max_delete  int := (cfg->>'max_delete')::int;
    capped      int := 0;
    remind_days int := least(3, delete_days - 1);
    sender      uuid;
    u           record;
    nm          text;
    body        text;
    subj        text;
    del_date    text;
    frz_date    text;
    act         text;
    calcs       int;
    warned      int := 0;
    frozen      int := 0;
    frozen_stale int := 0;
    deleted     int := 0;
    reminded    int := 0;
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

    -- ── Удаление ─────────────────────────────────────────────────────────────
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
        -- Предохранитель: за ночь не больше max_delete удалений, остальные — на следующую.
        if deleted >= max_delete then
            capped := capped + 1;
            continue;
        end if;
        if not dry_run then
            select count(distinct ie.calc_id)::int into calcs
              from public.invoice_events ie
             where ie.calc_id is not null
               and (ie.user_id = u.id::text
                    or (ie.user_id is null and btrim(coalesce(u.email, '')) <> ''
                        and lower(btrim(ie.user_email)) = lower(btrim(u.email))));

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

    -- ── Напоминание за remind_days дней до удаления ──────────────────────────
    if remind_days >= 1 then
        for u in
            select us.id, us.email, us.username, us.first_name, us.phone, us.region, us.created_at,
                   us.account_type, us.last_visited, us.sess_visits, us.frozen_at,
                   (select count(*)::int from public.estimates e where e.user_id = us.id) as n_est,
                   (select l.reason from public.empty_accounts_log l
                     where l.user_id = us.id and l.action = 'frozen' order by l.at desc limit 1) as reason,
                   coalesce(nullif(btrim(concat_ws(' ', us.last_name, us.first_name, us.middle_name)), ''),
                            nullif(btrim(us.username), ''), us.email, 'Без имени') as full_name
              from public.users us
             where us.frozen_at is not null
               and us.frozen_at <= now() - make_interval(days => delete_days - remind_days)
               and us.frozen_at > now() - make_interval(days => delete_days)
               and us.account_type not in ('admin', 'viewer', 'manager', 'pro')
               and exists (select 1 from public.empty_accounts_log l where l.user_id = us.id and l.action = 'frozen')
               and not exists (select 1 from public.empty_accounts_log l where l.user_id = us.id and l.action = 'reminded')
               and not exists (select 1 from public.estimates e where e.user_id = us.id and e.status = 'completed')
        loop
            nm := coalesce(nullif(btrim(u.first_name), ''), nullif(btrim(u.username), ''), 'Коллега');
            del_date := public.ru_date(u.frozen_at + make_interval(days => delete_days));
            subj := 'Учётная запись HeatCalc.ru будет удалена ' || del_date;
            if u.n_est = 0 then
                body := format(
E'%s, здравствуйте!

Напоминаем: %s мы удалим вашу учётную запись на HeatCalc.ru — доступ к ней приостановлен, потому что в ней нет ни одной сохранённой сметы.

Если калькулятор вам нужен, напишите до этой даты на kovdor24@yandex.ru или в MAX: +7 982 610-95-48 — вернём доступ в тот же день.
Если не нужен — ничего делать не надо. Зарегистрироваться заново можно в любой момент.

Администрация HeatCalc.ru', nm, del_date);
            else
                body := format(
E'%s, здравствуйте!

Напоминаем: %s мы удалим вашу учётную запись на HeatCalc.ru — доступ к ней приостановлен, потому что давно нет новых расчётов. Ссылки на отправленные вами КП после этого перестанут открываться.

Чтобы сохранить аккаунт, напишите до этой даты на kovdor24@yandex.ru или в MAX: +7 982 610-95-48 — вернём доступ в тот же день, ничего заполнять заново не придётся.
Даже если аккаунт будет удалён, сами расчёты (%s) останутся в архиве, и мы сможем восстановить их по вашему запросу.

Администрация HeatCalc.ru', nm, del_date, u.n_est);
            end if;

            if not dry_run then
                insert into public.empty_accounts_log
                    (user_id, action, name, email, phone, region, created_at_user, reason, est_count,
                     last_visited, visits, account_type)
                values (u.id, 'reminded', u.full_name, u.email, u.phone, u.region, u.created_at, u.reason, u.n_est,
                        u.last_visited, u.sess_visits, u.account_type);
                if sender is not null then
                    insert into public.messages (sender_id, recipient_id, text, type)
                    values (sender, u.id, body, 'private');
                end if;
                if u.email is not null and btrim(u.email) <> '' then
                    perform public.inactivity_send_email(u.email, subj, body);
                end if;
            end if;
            reminded := reminded + 1;
        end loop;
    end if;

    -- ── Заморозка: порог пройден, предупреждение дано warn_days дней назад ───
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
         where ((s.n_est = 0 and s.created_at < now() - make_interval(days => freeze_days))
            or (s.n_est > 0 and s.account_type in ('base', 'free')
                and s.last_est < now() - make_interval(days => stale_days)))
           and exists (select 1 from public.empty_accounts_log l
                        where l.user_id = s.id and l.action = 'warned'
                          and l.at > coalesce(s.last_est, s.created_at)
                          and l.at <= now() - make_interval(days => warn_days))
    loop
        nm := coalesce(nullif(btrim(u.first_name), ''), nullif(btrim(u.username), ''), 'Коллега');
        del_date := public.ru_date(now() + make_interval(days => delete_days));
        subj := 'Доступ к HeatCalc.ru приостановлен';
        if u.n_est = 0 then
            body := format(
E'%s, здравствуйте!

Мы приостановили доступ к вашей учётной записи на HeatCalc.ru: вы зарегистрировались, но так и не сохранили ни одной сметы.

Чтобы вернуть доступ, напишите на kovdor24@yandex.ru или в MAX: +7 982 610-95-48 — вернём в тот же день.
Если калькулятор вам не нужен, ничего делать не надо: %s учётная запись будет удалена. Это ни на что не повлияет, зарегистрироваться заново можно в любой момент.

Администрация HeatCalc.ru',
                nm, del_date);
        else
            body := format(
E'%s, здравствуйте!

Мы приостановили доступ к вашей учётной записи на HeatCalc.ru: в ней давно нет новых расчётов. Сохранённые расчёты (%s) пока на месте.

Чтобы вернуть доступ, напишите на kovdor24@yandex.ru или в MAX: +7 982 610-95-48 — вернём в тот же день, ничего заполнять заново не придётся.
Если ответа не будет, %s учётная запись будет удалена, а ссылки на отправленные клиентам КП перестанут открываться. Сами расчёты сохранятся в архиве, и мы сможем восстановить их по вашему запросу. За 3 дня до удаления напомним ещё раз.

Администрация HeatCalc.ru',
                nm, u.n_est, del_date);
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
                perform public.inactivity_send_email(u.email, subj, body);
            end if;
        end if;
        frozen := frozen + 1;
        if u.n_est > 0 then frozen_stale := frozen_stale + 1; end if;
    end loop;

    -- ── Предупреждение: до порога осталось warn_days дней или он уже пройден ──
    for u in
        select * from (
            select us.id, us.email, us.username, us.first_name, us.phone, us.region, us.created_at, us.account_type,
                   us.last_visited, us.sess_visits,
                   (lower(coalesce(us.email, '')) ~ '@([a-z0-9-]+\.)*teremopt\.ru$'
                    or lower(coalesce(us.work_email, '')) ~ '@([a-z0-9-]+\.)*teremopt\.ru$'
                    or exists (select 1 from public.distributors d
                                where d.company_name ilike '%терем%'
                                  and btrim(coalesce(d.manager_email, '')) <> ''
                                  and lower(btrim(d.manager_email)) in (lower(btrim(coalesce(us.email, ''))),
                                                                       lower(btrim(coalesce(us.work_email, '')))))) as is_terem,
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
         where ((s.n_est = 0 and s.created_at < now() - make_interval(days => greatest(freeze_days - warn_days, 0)))
            or (s.n_est > 0 and s.account_type in ('base', 'free')
                and s.last_est < now() - make_interval(days => greatest(stale_days - warn_days, 0))))
           and not exists (select 1 from public.empty_accounts_log l
                            where l.user_id = s.id and l.action = 'warned'
                              and l.at > coalesce(s.last_est, s.created_at))
    loop
        nm := coalesce(nullif(btrim(u.first_name), ''), nullif(btrim(u.username), ''), 'Коллега');
        frz_date := public.ru_date(now() + make_interval(days => warn_days));
        subj := 'Скоро доступ к HeatCalc.ru будет приостановлен — как этого избежать';
        -- Сотрудникам ТЕРЕМ (почта teremopt.ru) тариф Профи не предлагаем никогда.
        if u.is_terem then
            act := E'Чтобы этого не случилось, достаточно рассчитать и сохранить смету — и ничего не изменится.';
        elsif u.n_est = 0 then
            act := E'Чтобы этого не случилось, достаточно любого из двух:
• рассчитать и сохранить хотя бы одну смету — и ничего не изменится;
• перейти на тариф Профи — учётные записи с действующим Профи не приостанавливаются.';
        else
            act := E'Чтобы этого не случилось, достаточно любого из двух:
• рассчитать и сохранить новую смету (или поправить существующую) — и ничего не изменится;
• перейти на тариф Профи — учётные записи с действующим Профи не приостанавливаются.';
        end if;
        if u.n_est = 0 then
            body := format(
E'%s, здравствуйте!

Вы зарегистрировались на HeatCalc.ru, но пока не сохранили ни одной сметы. Если до %s смета не появится, мы приостановим доступ к этой учётной записи.

%s

Если калькулятор вам не нужен, ничего делать не надо.

Администрация HeatCalc.ru', nm, frz_date, act);
        else
            body := format(
E'%s, здравствуйте!

В вашей учётной записи на HeatCalc.ru давно нет новых расчётов. Если до %s новой сметы не появится, мы приостановим доступ к ней. Сохранённые расчёты (%s) при этом не пропадут.

%s

Если калькулятор вам больше не нужен, ничего делать не надо.

Администрация HeatCalc.ru', nm, frz_date, u.n_est, act);
        end if;

        if not dry_run then
            insert into public.empty_accounts_log
                (user_id, action, name, email, phone, region, created_at_user, reason, est_count,
                 last_visited, visits, account_type)
            values (u.id, 'warned', u.full_name, u.email, u.phone, u.region, u.created_at,
                    case when u.n_est = 0 then 'no_estimates' else 'stale' end, u.n_est,
                    u.last_visited, u.sess_visits, u.account_type);
            if sender is not null then
                insert into public.messages (sender_id, recipient_id, text, type)
                values (sender, u.id, body, 'private');
            end if;
            if u.email is not null and btrim(u.email) <> '' then
                perform public.inactivity_send_email(u.email, subj, body);
            end if;
        end if;
        warned := warned + 1;
    end loop;

    return jsonb_build_object('enabled', on_flag, 'warned', warned, 'frozen', frozen, 'frozen_stale', frozen_stale,
                              'reminded', reminded, 'deleted', deleted, 'delete_capped', capped, 'kept_completed', kept_done,
                              'dry_run', dry_run);
end;
$$;
revoke all on function public.process_empty_accounts(boolean) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Письма правила: тип по теме. Раньше предупреждение и напоминание об удалении
--    попадали в 'other' (ступень 1, отключается уже при 50% лимита почты), теперь
--    это 'inactivity' (ступень 2, при 75%).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.mail_kind_of(subj text)
returns text
language sql
immutable
as $$
    select case
        when subj ilike 'Код подтверждения%'                      then 'code'
        when subj ilike '%Запрос счёта%'                          then 'invoice'
        when subj ilike '[Feedback%'                              then 'feedback'
        when subj ilike 'Вы давно не заходили%'
          or subj ilike 'Доступ к HeatCalc.ru приостановлен%'
          or subj ilike 'Скоро доступ к HeatCalc.ru%'
          or subj ilike 'Учётная запись HeatCalc.ru будет удалена%' then 'inactivity'
        when subj ilike 'Первая смета в HeatCalc%'
          or subj ilike 'Что не получилось в HeatCalc%'
          or subj ilike 'Давно не видели смет%'                   then 'nudge'
        when subj ilike 'Новое личное сообщение%'                 then 'message'
        when subj ilike 'Вопрос без ответа%'                      then 'stale'
        when subj ilike '%Тариф Профи%'                           then 'tariff'
        when subj ilike 'Статус КП%' or subj ilike '[Админ] Статус КП%' then 'status'
        else 'other'
    end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Архив смет при любом удалении учётки или сметы не владельцем.
--    Владелец стирает свою смету сам — не архивируем. Админ (кнопка «Удалить»),
--    ночные проходы (auth.uid() пуст) и каскад при удалении учётки — архивируем.
--    Правило «без смет» кладёт в архив само до удаления — тогда триггер пропускает.
--    Любая ошибка внутри проглатывается: архив не повод сорвать удаление.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.estimates_deleted add column if not exists restored_at timestamptz;
alter table public.estimates_deleted add column if not exists restored_to uuid;

create or replace function public.archive_deleted_estimate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    begin
        if exists (select 1 from public.estimates_deleted d where d.estimate_id = old.id) then
            return old;
        end if;
        if auth.uid() is not null
           and exists (select 1 from public.users us where us.id = old.user_id and us.auth_user_id = auth.uid()) then
            return old;
        end if;
        insert into public.estimates_deleted
            (estimate_id, user_id, user_name, status, status_before, project_name, total_sum,
             created_at_est, reason, row_data)
        select old.id, old.user_id,
               (select coalesce(nullif(btrim(concat_ws(' ', us.last_name, us.first_name, us.middle_name)), ''),
                                nullif(btrim(us.username), ''), us.email)
                  from public.users us where us.id = old.user_id),
               'deleted', old.status, old.project_name, old.total_sum, old.created_at,
               case when auth.uid() is null then 'system' else 'admin' end, to_jsonb(old);
    exception when others then
        raise notice 'archive_deleted_estimate: смета % не заархивирована', old.id;
    end;
    return old;
end;
$$;

drop trigger if exists estimates_archive_delete on public.estimates;
create trigger estimates_archive_delete
    before delete on public.estimates
    for each row execute function public.archive_deleted_estimate();

-- Снимок человека при любом удалении учётки (для воронки и статистики).
create or replace function public.log_user_deletion_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    n_est int;
    n_calc int;
begin
    begin
        if exists (select 1 from public.empty_accounts_log l
                    where l.user_id = old.id and l.action = 'deleted' and l.at > now() - interval '1 hour') then
            return old;
        end if;
        select (select count(*) from public.estimates e where e.user_id = old.id)
             + (select count(*) from public.estimates_deleted d where d.user_id = old.id and d.restored_at is null)
          into n_est;
        select count(distinct ie.calc_id) into n_calc
          from public.invoice_events ie
         where ie.calc_id is not null
           and (ie.user_id = old.id::text
                or (ie.user_id is null and btrim(coalesce(old.email, '')) <> ''
                    and lower(btrim(ie.user_email)) = lower(btrim(old.email))));
        insert into public.empty_accounts_log
            (user_id, action, name, email, phone, region, created_at_user, reason, est_count,
             calcs_started, last_visited, visits, account_type)
        values (old.id, 'deleted',
                coalesce(nullif(btrim(concat_ws(' ', old.last_name, old.first_name, old.middle_name)), ''),
                         nullif(btrim(old.username), ''), old.email, 'Без имени'),
                old.email, old.phone, old.region, old.created_at,
                case when old.frozen_at is not null then 'inactive'
                     when auth.uid() is null then 'system' else 'manual' end,
                n_est, coalesce(n_calc, 0), old.last_visited, old.sess_visits, old.account_type);
    exception when others then
        raise notice 'log_user_deletion_snapshot: снимок % не записан', old.id;
    end;
    return old;
end;
$$;

drop trigger if exists users_log_deletion_snapshot on public.users;
create trigger users_log_deletion_snapshot
    before delete on public.users
    for each row execute function public.log_user_deletion_snapshot();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Журнал правила для админки.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.empty_accounts_report(p_limit int default 300)
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
    select coalesce(jsonb_agg(r order by (r->>'at') desc), '[]'::jsonb) into res
      from (
        select jsonb_build_object(
                   'id', l.id, 'user_id', l.user_id, 'action', l.action, 'name', l.name,
                   'email', l.email, 'region', l.region, 'reason', l.reason,
                   'est_count', l.est_count, 'calcs_started', l.calcs_started,
                   'registered', l.created_at_user, 'at', l.at,
                   'archived', (select count(*) from public.estimates_deleted d where d.user_id = l.user_id and d.restored_at is null),
                   'alive', exists (select 1 from public.users us where us.id = l.user_id),
                   'frozen', exists (select 1 from public.users us where us.id = l.user_id and us.frozen_at is not null)) as r
          from public.empty_accounts_log l
         order by l.at desc
         limit greatest(1, least(coalesce(p_limit, 300), 1000))
      ) t;
    return res;
end;
$$;
grant execute on function public.empty_accounts_report(int) to authenticated;

-- Вернуть сметы удалённого человека на другую учётку (он заново зарегистрировался).
create or replace function public.restore_archived_estimates(p_old_user uuid, p_target_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    tgt uuid;
    r   record;
    ok  int := 0;
    bad int := 0;
begin
    if not public.is_admin() then
        raise exception 'Только для администратора';
    end if;
    select us.id into tgt from public.users us
     where lower(btrim(us.email)) = lower(btrim(p_target_email))
        or lower(btrim(coalesce(us.work_email, ''))) = lower(btrim(p_target_email))
     limit 1;
    if tgt is null then
        raise exception 'Учётная запись с почтой % не найдена: человек должен сначала зарегистрироваться', p_target_email;
    end if;
    for r in
        select d.id, d.row_data from public.estimates_deleted d
         where d.user_id = p_old_user and d.restored_at is null
         order by d.created_at_est nulls first, d.id
    loop
        begin
            insert into public.estimates
            select (jsonb_populate_record(null::public.estimates, r.row_data || jsonb_build_object('user_id', tgt))).*
            on conflict do nothing;
            update public.estimates_deleted set restored_at = now(), restored_to = tgt, status = 'restored' where id = r.id;
            ok := ok + 1;
        exception when others then
            bad := bad + 1;
        end;
    end loop;
    return jsonb_build_object('restored', ok, 'failed', bad, 'target', tgt);
end;
$$;
grant execute on function public.restore_archived_estimates(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Заявка замороженного на возврат доступа (из окна входа, до выхода из сессии).
--    Сообщение владельцу в кабинет + запись в журнал; не чаще раза в сутки.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.request_unfreeze()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    me     record;
    sender uuid;
    why    text;
begin
    select us.* into me from public.users us
     where us.auth_user_id = auth.uid() and us.frozen_at is not null limit 1;
    if not found then
        return jsonb_build_object('ok', false, 'reason', 'not_frozen');
    end if;
    if exists (select 1 from public.empty_accounts_log l
                where l.user_id = me.id and l.action = 'requested' and l.at > now() - interval '1 day') then
        return jsonb_build_object('ok', true, 'repeat', true);
    end if;
    select l.reason into why from public.empty_accounts_log l
     where l.user_id = me.id and l.action = 'frozen' order by l.at desc limit 1;
    select id into sender from public.users
     where lower(btrim(email)) = 'dima24ba@gmail.com' limit 1;
    if sender is null then
        select id into sender from public.users where account_type = 'admin' order by created_at limit 1;
    end if;
    insert into public.empty_accounts_log (user_id, action, name, email, phone, region, created_at_user, reason)
    values (me.id, 'requested',
            coalesce(nullif(btrim(concat_ws(' ', me.last_name, me.first_name, me.middle_name)), ''), me.username, me.email),
            me.email, me.phone, me.region, me.created_at, why);
    if sender is not null then
        insert into public.messages (sender_id, recipient_id, text, type)
        values (me.id, sender,
                format(E'Прошу вернуть доступ к аккаунту. Он приостановлен %s (%s). Заявка отправлена из окна входа; вернуть доступ можно кнопкой «Вернуть доступ» в карточке пользователя.',
                       to_char(me.frozen_at at time zone 'Europe/Moscow', 'DD.MM.YYYY'),
                       case why when 'no_estimates' then 'нет сохранённых смет'
                                when 'stale' then 'давно нет новых расчётов' else 'неактивность' end),
                'private');
    end if;
    return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.request_unfreeze() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Предупреждение перед автоотклонением КП: за 1–7 дней до закрытия монтажнику
--    (и менеджерам его филиала) уходит сообщение в кабинет. Почты нет — лимит EmailJS.
--    Срок берётся из тех же настроек, что у close_stale_kp_outcomes.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.send_kp_autoclose_warnings(dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    cfg     jsonb;
    c_on    boolean;
    v_auto  int;
    sender  uuid;
    o       record;
    u       record;
    it      jsonb;
    mgr_ids uuid[];
    mgr     uuid;
    comp    text;
    who     text;
    lines   text;
    body_i  text;
    body_m  text;
    n_inst  int := 0;
    n_mgr   int := 0;
    n_kps   int := 0;
begin
    select coalesce(s.value->'limit', '{}'::jsonb) into cfg from public.app_settings s where s.key = 'subscription';
    cfg := coalesce(cfg, '{}'::jsonb);
    c_on   := case when cfg->>'outcomeOn' in ('true', 'false') then (cfg->>'outcomeOn')::boolean else true end;
    v_auto := least(60, greatest(0, case when cfg->>'outcomeAutoMonths' ~ '^\d{1,2}$' then (cfg->>'outcomeAutoMonths')::int else 6 end));
    if not c_on or v_auto = 0 then
        return jsonb_build_object('installers', 0, 'kp', 0, 'dry_run', dry_run, 'off', true);
    end if;

    select id into sender from public.users where lower(btrim(email)) = 'kovdor24@yandex.ru' limit 1;
    if sender is null then
        select id into sender from public.users where account_type = 'admin' order by created_at limit 1;
    end if;
    if sender is null then
        return jsonb_build_object('installers', 0, 'managers', 0, 'dry_run', dry_run, 'error', 'no sender');
    end if;

    for o in
        with kp as (
            select s.calc_id,
                   max(s.created_at) as last_sent,
                   (array_agg(s.user_id order by s.created_at))[1] as owner_id,
                   (array_agg(s.project_name order by s.created_at desc) filter (where nullif(btrim(s.project_name), '') is not null))[1] as obj_name,
                   max((s.meta->>'kp_version')::int) filter (where s.meta->>'kp_version' ~ '^\d{1,6}$') as kp_version
              from public.invoice_events s
             where s.event in ('sent', 'printed')
             group by s.calc_id
        ),
        st as (
            select kp.*,
                   (select max(created_at) from public.invoice_events x where x.calc_id = kp.calc_id and x.event = 'extended') as last_ext
              from kp
             where not exists (select 1 from public.invoice_events x
                                where x.calc_id = kp.calc_id
                                  and x.event in ('won', 'invoice_requested', 'invoice_issued', 'paid'))
               and not exists (select 1 from public.invoice_events x
                                where x.calc_id = kp.calc_id and x.event = 'lost' and x.created_at >= kp.last_sent)
        ),
        due as (
            select st.*,
                   greatest(st.last_sent, coalesce(st.last_ext, st.last_sent)) as last_move,
                   greatest(st.last_sent, coalesce(st.last_ext, st.last_sent)) + make_interval(months => v_auto) as close_at
              from st
        )
        select d.owner_id,
               jsonb_agg(jsonb_build_object(
                   'calc_id', d.calc_id,
                   'obj', coalesce(d.obj_name, 'Без названия'),
                   'num', d.calc_id || coalesce('-' || d.kp_version::text, ''),
                   'close', to_char(d.close_at at time zone 'Europe/Moscow', 'DD.MM.YYYY'),
                   'for', to_char(d.last_move at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')) order by d.close_at) as items
          from due d
         where d.close_at > now() + interval '1 day'
           and d.close_at <= now() + interval '7 days'
           and d.owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           and not exists (select 1 from public.invoice_events x
                            where x.calc_id = d.calc_id and x.event = 'kp_autoclose_warning'
                              and x.meta->>'for' = to_char(d.last_move at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'))
         group by d.owner_id
    loop
        select * into u from public.users where id = o.owner_id::uuid;
        continue when not found;
        continue when coalesce((to_jsonb(u)->>'is_blocked')::boolean, false)
                   or nullif(to_jsonb(u)->>'frozen_at', '') is not null
                   or coalesce((to_jsonb(u)->>'is_test')::boolean, false)
                   or u.account_type in ('admin', 'viewer');

        select string_agg(format('• «%s», КП № %s — закроется %s', i->>'obj', i->>'num', i->>'close'), E'\n')
          into lines from jsonb_array_elements(o.items) i;

        body_i := format(
E'⏳ КП скоро закроются сами\n\nПо этим КП нет итога и движения, и в ближайшую неделю они станут «Отклонено (авто)»:\n%s\n\nОткройте калькулятор и отметьте итог (клиент согласился или отказался) либо продлите срок — тогда КП останется в работе.',
            lines);

        mgr_ids := '{}'; comp := null;
        if u.distributor_id is not null then
            select d.company_name into comp from public.distributors d where d.id = u.distributor_id;
            select coalesce(array_agg(distinct mu.id), '{}') into mgr_ids
              from public.distributors d
              join public.users mu
                on lower(btrim(mu.work_email)) in (lower(btrim(nullif(d.manager_email, ''))), lower(btrim(nullif(d.director_email, ''))))
                or lower(btrim(mu.email)) in (lower(btrim(nullif(d.manager_email, ''))), lower(btrim(nullif(d.director_email, ''))))
             where d.id = u.distributor_id and mu.id <> u.id
               and coalesce((to_jsonb(mu)->>'is_blocked')::boolean, false) = false;
        end if;
        who := coalesce(nullif(btrim(concat_ws(' ', u.last_name, u.first_name, u.middle_name)), ''),
                        nullif(btrim(u.username), ''), nullif(btrim(u.email), ''), 'Монтажник');
        body_m := format(
E'⏳ КП монтажника закроются сами\n\nМонтажник: %s, %s%s.\nЭти КП без итога и движения станут «Отклонено (авто)» в ближайшую неделю:\n%s\n\nПозвоните монтажнику или отметьте итог сами: кабинет → «Мои монтажники» → «КП без итога».',
            who, coalesce(nullif(btrim(u.phone), ''), 'телефон не указан'),
            coalesce(' (' || nullif(btrim(comp), '') || ')', ''), lines);

        if not dry_run then
            insert into public.messages (sender_id, recipient_id, text, type) values (sender, u.id, body_i, 'private');
            foreach mgr in array mgr_ids loop
                insert into public.messages (sender_id, recipient_id, text, type) values (sender, mgr, body_m, 'private');
            end loop;
            for it in select * from jsonb_array_elements(o.items) loop
                insert into public.invoice_events (calc_id, event, project_name, meta)
                values (it->>'calc_id', 'kp_autoclose_warning', it->>'obj',
                        jsonb_build_object('for', it->>'for', 'close', it->>'close',
                                           'comment', format('Автопредупреждение: КП закроется само %s', it->>'close')));
            end loop;
        end if;
        n_inst := n_inst + 1;
        n_kps  := n_kps + jsonb_array_length(o.items);
        n_mgr  := n_mgr + coalesce(array_length(mgr_ids, 1), 0);
    end loop;

    return jsonb_build_object('installers', n_inst, 'kp', n_kps, 'managers', n_mgr, 'dry_run', dry_run);
end;
$$;
revoke all on function public.send_kp_autoclose_warnings(boolean) from public, anon, authenticated;

do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        if exists (select 1 from cron.job where jobname = 'send_kp_autoclose_warnings') then
            perform cron.unschedule('send_kp_autoclose_warnings');
        end if;
        perform cron.schedule('send_kp_autoclose_warnings', '10 6 * * *',
                              'select public.send_kp_autoclose_warnings();');
    else
        raise notice 'pg_cron не установлен — расписание не создано.';
    end if;
end $$;

update public.app_settings
   set value = value || jsonb_build_object('max_delete', coalesce((value->>'max_delete')::int, 10))
 where key = 'empty_accounts';
