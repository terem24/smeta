-- Заморозка только после предупреждения, которое дошло по почте.
--
-- До этого письмо могло не уйти (лимит EmailJS, выключатель ступени в «Деньги → Почта»),
-- а заморозка всё равно шла по журналу предупреждений. Теперь:
--   * предупреждение пишется, только если тип письма сейчас разрешён (mail_allowed);
--     иначе человека пропускаем, и ночью проверим снова;
--   * inactivity_send_email возвращает true, если письмо отправлено (запрос в почтовый шлюз),
--     и этот факт пишется в mail_sent журнала / inactivity_notices;
--   * заморозка идёт только по предупреждению с mail_sent = true.
-- Старые предупреждения (mail_sent = null) в заморозку не попадают: человек остаётся активным,
-- пока не вернётся или не будет предупреждён заново.
--
-- Выполнить в Supabase SQL Editor целиком.

alter table public.inactivity_notices add column if not exists mail_sent boolean;
alter table public.empty_accounts_log add column if not exists mail_sent boolean;

drop function if exists public.inactivity_send_email(text, text, text);
create function public.inactivity_send_email(to_email text, subj text, body text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    priv text;
    k    text := public.mail_kind_of(subj);
begin
    if to_email is null or btrim(to_email) = '' then return false; end if;

    if not public.mail_allowed(k) then
        insert into public.mail_log (kind, template, subject, ok, skipped, source)
        values (k, 'template_ysuxfio', left(subj, 120), false, true, 'db');
        return false;
    end if;

    if not exists (select 1 from pg_extension where extname = 'pg_net') then return false; end if;

    begin
        select decrypted_secret into priv
          from vault.decrypted_secrets where name = 'emailjs_private_key' limit 1;
    exception when others then
        priv := null;
    end;
    if priv is null or btrim(priv) = '' then
        raise notice 'inactivity_send_email: в Vault нет emailjs_private_key — письмо не отправлено';
        return false;
    end if;

    perform net.http_post(
        url     := 'https://proxy.heatcalc.ru/emailjs_proxy.php',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body    := jsonb_build_object(
            'service_id',  'service_o11b4ej',
            'template_id', 'template_ysuxfio',
            'user_id',     '-m4N93pTqMlCfuBpT',
            'accessToken', btrim(priv),
            'template_params', jsonb_build_object(
                'to_email',      btrim(to_email),
                'user_email',    btrim(to_email),
                'tariff_name',   'Системное уведомление',
                'email_subject', subj,
                'subject_text',  subj,
                'email_body',    body,
                'message_text',  body
            )
        ),
        timeout_milliseconds := 20000
    );

    insert into public.mail_log (kind, template, subject, ok, skipped, source)
    values (k, 'template_ysuxfio', left(subj, 120), true, false, 'db');
    return true;
end;
$$;
revoke all on function public.inactivity_send_email(text, text, text) from public, anon, authenticated;

-- ── Неактивные учётки (process_inactive_accounts) ──
create or replace function public.process_inactive_accounts(dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    -- Пороги лежат в app_settings (ключ inactivity_days), меняются в админке,
    -- на вкладке «Напоминания». Если записи нет или в ней мусор — берём 20 / 25 / 10.
    warn_days       int := 20;   -- когда предупредить
    freeze_days     int := 25;   -- когда приостановить доступ
    delete_days     int := 10;   -- сколько ждать после заморозки
    grace_days      constant int := 5;    -- сколько ждать после предупреждения
    cfg             jsonb;

    sender   uuid;
    u        record;
    nm       text;
    msg_id   uuid;
    freeze_on  timestamptz;
    delete_on  timestamptz;
    body     text;
    warned   int := 0;
    frozen   int := 0;
    deleted  int := 0;
    sent     boolean;
begin
    select value into cfg from public.app_settings where key = 'inactivity_days';
    if cfg is not null then
        begin
            warn_days   := coalesce((cfg->>'warn')::int,   warn_days);
            freeze_days := coalesce((cfg->>'freeze')::int, freeze_days);
            delete_days := coalesce((cfg->>'delete')::int, delete_days);
        exception when others then
            raise notice 'process_inactive_accounts: inactivity_days нельзя прочитать, взяты 20/25/10';
            warn_days := 20; freeze_days := 25; delete_days := 10;
        end;
    end if;
    -- Защита от нелепых значений: заморозка не раньше предупреждения, всё не меньше 1.
    warn_days   := greatest(warn_days, 1);
    freeze_days := greatest(freeze_days, warn_days);
    delete_days := greatest(delete_days, 1);

    -- Отправитель сообщений — владелец сайта, как у автопоздравлений.
    select id into sender from public.users
     where lower(btrim(email)) = 'dima24ba@gmail.com' limit 1;
    if sender is null then
        select id into sender from public.users
         where account_type = 'admin' order by created_at limit 1;
    end if;

    -- ── 5.1. Удаление: заморожен и за 10 дней так и не написал ──────────────
    --
    -- Идём от старшего этапа к младшему, чтобы человек за один проход не проскочил
    -- сразу два: сегодня заморозили — удалять будем не раньше чем через 10 дней.
    for u in
        select us.id, us.email, us.username, us.last_name, us.first_name
          from public.users us
         where us.frozen_at is not null
           and us.frozen_at < now() - make_interval(days => delete_days)
           and us.account_type not in ('admin', 'viewer', 'manager', 'pro')
           and not exists (select 1 from public.empty_accounts_log l where l.user_id = us.id and l.action = 'frozen')
    loop
        if not dry_run then
            -- Тот же список таблиц, что чистит «Удалить учётку» в админке
            -- (deleteUserCompletely в app.js). Порядок важен: users последней.
            delete from public.estimates where user_id = u.id;
            delete from public.messages where sender_id = u.id or recipient_id = u.id;
            delete from public.manager_chat_messages
             where installer_user_id = u.id or manager_user_id = u.id or sender_user_id = u.id;
            delete from public.users where id = u.id;

            begin
                delete from auth.users au
                 where lower(btrim(au.email)) = lower(btrim(coalesce(u.email, '')))
                   and btrim(coalesce(u.email, '')) <> '';
            exception when others then
                raise notice 'process_inactive_accounts: логин % в auth.users не удалён (нет прав)', u.email;
            end;
        end if;
        deleted := deleted + 1;
    end loop;

    -- ── 5.2. Заморозка: 25 дней молчания и 5 дней после предупреждения ──────
    for u in
        select * from (
            select us.id, us.email, us.username, us.first_name, us.middle_name,
                   -- Начало отсчёта: последний вход, но не раньше окончания Профи.
                   greatest(coalesce(us.last_visited, us.created_at),
                            case when us.demo_ends_at <= now() then us.demo_ends_at end) as last_seen,
                   n.warned_at, n.warned_for
              from public.users us
              join public.inactivity_notices n on n.user_id = us.id
             where us.frozen_at is null
               -- Замораживаем только после предупреждения, которое дошло по почте.
               and n.mail_sent is true
               -- Действующий Профи — счётчик стоит.
               and us.account_type not in ('admin', 'viewer', 'manager', 'pro')
        ) s
         where s.last_seen < now() - make_interval(days => freeze_days)
           and s.warned_at is not null
           and s.warned_at < now() - make_interval(days => grace_days)
           -- Предупреждение должно относиться к текущему молчанию.
           and s.warned_for = s.last_seen
    loop
        delete_on := now() + make_interval(days => delete_days);
        nm := coalesce(nullif(btrim(u.first_name), ''), nullif(btrim(u.username), ''), 'Коллега');
        body := format(
E'%s, доступ к вашей учётной записи на HeatCalc.ru приостановлен: в калькулятор не заходили больше %s дней.

Расчёты и сметы никуда не делись — они сохранены и ждут вас.

Чтобы вернуть доступ, напишите на kovdor24@yandex.ru или в MAX: +7 982 610-95-48. Включим в тот же день, ничего заполнять заново не придётся.

Если до %s мы не получим ответа, учётная запись будет удалена вместе со всеми сохранёнными расчётами.

Администрация HeatCalc.ru',
            nm, freeze_days, public.ru_date(delete_on));

        if not dry_run then
            update public.users set frozen_at = now() where id = u.id;
            update public.inactivity_notices
               set stage = 'frozen', frozen_at = now(), updated_at = now()
             where user_id = u.id;

            if sender is not null then
                insert into public.messages (sender_id, recipient_id, text, type)
                values (sender, u.id, body, 'private');
            end if;
            perform public.inactivity_send_email(u.email, 'Доступ к HeatCalc.ru приостановлен', body);
            perform public.inactivity_send_push(u.id);
        end if;
        frozen := frozen + 1;
    end loop;

    -- ── 5.3. Предупреждение: 20 дней молчания ──────────────────────────────
    for u in
        select * from (
            select us.id, us.email, us.username, us.first_name, us.middle_name,
                   greatest(coalesce(us.last_visited, us.created_at),
                            case when us.demo_ends_at <= now() then us.demo_ends_at end) as last_seen,
                   n.warned_for
              from public.users us
              left join public.inactivity_notices n on n.user_id = us.id
             where us.frozen_at is null
               and us.account_type not in ('admin', 'viewer', 'manager', 'pro')
        ) s
         where s.last_seen < now() - make_interval(days => warn_days)
           -- Ещё не предупреждали, либо предупреждали за прошлый период молчания.
           and (s.warned_for is null or s.warned_for <> s.last_seen)
    loop
        if not public.mail_allowed('inactivity') then continue; end if;
        -- Дата заморозки: 25-й день молчания, но не раньше чем через 5 дней после
        -- письма — те, кто уже молчит дольше, получают свои 5 дней на ответ.
        freeze_on := greatest(u.last_seen + make_interval(days => freeze_days),
                              now() + make_interval(days => grace_days));
        delete_on := freeze_on + make_interval(days => delete_days);
        nm := coalesce(nullif(btrim(u.first_name), ''), nullif(btrim(u.username), ''), 'Коллега');
        body := format(
E'%s, вы уже %s дней не заходили в калькулятор HeatCalc.ru.

Если так и не зайдёте, %s мы приостановим доступ к вашей учётной записи, а %s удалим её вместе со всеми сохранёнными расчётами и сметами.

Чтобы этого не случилось, достаточно открыть heatcalc.ru и зайти в свой аккаунт — отсчёт начнётся заново, никаких действий больше не нужно.

Если аккаунт вам больше не нужен, просто не обращайте внимания на это письмо.

Администрация HeatCalc.ru',
            nm, warn_days, public.ru_date(freeze_on), public.ru_date(delete_on));

        if not dry_run then
            if sender is not null then
                insert into public.messages (sender_id, recipient_id, text, type)
                values (sender, u.id, body, 'private')
                returning id into msg_id;
            end if;

            insert into public.inactivity_notices (user_id, stage, warned_at, warned_for, updated_at)
            values (u.id, 'warned', now(), u.last_seen, now())
            on conflict (user_id) do update
                set stage = 'warned', warned_at = now(),
                    warned_for = excluded.warned_for, updated_at = now();

            sent := public.inactivity_send_email(u.email, 'Вы давно не заходили в HeatCalc.ru', body);
            update public.inactivity_notices set mail_sent = sent where user_id = u.id;
            perform public.inactivity_send_push(u.id);
        end if;
        warned := warned + 1;
    end loop;

    if dry_run then
        raise notice 'process_inactive_accounts (пробный запуск, ничего не менялось): предупреждено %, заморожено %, удалено %',
            warned, frozen, deleted;
    else
        raise notice 'process_inactive_accounts: предупреждено %, заморожено %, удалено %',
            warned, frozen, deleted;
    end if;

    return jsonb_build_object('warned', warned, 'frozen', frozen, 'deleted', deleted, 'dry_run', dry_run);
end;
$$;

revoke all on function public.process_inactive_accounts(boolean) from public, anon, authenticated;

-- ── Анкеты без смет (process_empty_accounts) ──
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
    sent        boolean;
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
            if not public.mail_allowed(public.mail_kind_of(subj)) then continue; end if;
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
                          and l.at <= now() - make_interval(days => warn_days)
                          and l.mail_sent is true)
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
        if not public.mail_allowed(public.mail_kind_of(subj)) then continue; end if;
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
            -- Сначала письмо: в журнал пишем, дошло ли оно. Без доставленного предупреждения не замораживаем.
            sent := case when u.email is not null and btrim(u.email) <> ''
                         then public.inactivity_send_email(u.email, subj, body) else false end;
            insert into public.empty_accounts_log
                (user_id, action, name, email, phone, region, created_at_user, reason, est_count,
                 last_visited, visits, account_type, mail_sent)
            values (u.id, 'warned', u.full_name, u.email, u.phone, u.region, u.created_at,
                    case when u.n_est = 0 then 'no_estimates' else 'stale' end, u.n_est,
                    u.last_visited, u.sess_visits, u.account_type, sent);
            if sender is not null then
                insert into public.messages (sender_id, recipient_id, text, type)
                values (sender, u.id, body, 'private');
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
