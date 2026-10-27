-- Письма-предупреждения сотрудникам ТЕРЕМ (почта teremopt.ru, основная или рабочая):
-- без предложения перейти на Профи. Остальное правило для них действует как для всех:
-- предупреждение, заморозка, удаление.

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
                    or lower(coalesce(us.work_email, '')) ~ '@([a-z0-9-]+\.)*teremopt\.ru$') as is_terem,
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
                              'reminded', reminded, 'deleted', deleted, 'kept_completed', kept_done,
                              'dry_run', dry_run);
end;
$$;
revoke all on function public.process_empty_accounts(boolean) from public, anon, authenticated;

