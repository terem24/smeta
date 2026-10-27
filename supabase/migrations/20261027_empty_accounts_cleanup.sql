-- Анкеты без единой сохранённой сметы: заморозка и удаление по срокам из админки.
--
-- Люди регистрируются, ничего не сохраняют и пропадают — таких в списке много.
-- Раз в сутки (03:40 UTC, после прохода неактивных) база делает с ними два шага:
--   1) через freeze_days после регистрации замораживает доступ (frozen_at) и пишет письмо;
--   2) через delete_days после заморозки удаляет учётку.
--
-- НАСТРОЙКИ в app_settings, ключ empty_accounts:
--   {"enabled": false, "freeze_days": 30, "delete_days": 30, "skip_active": true}
--   enabled     — главный выключатель. По умолчанию ВЫКЛЮЧЕНО: включает администратор
--                 на вкладке «Напоминания»;
--   freeze_days — через сколько дней после регистрации замораживать;
--   delete_days — через сколько дней после заморозки удалять;
--   skip_active — не трогать тех, кто заходил за последние freeze_days дней
--                 (считает, но не сохраняет — такой человек не пропал).
--
-- Кого не трогаем: администраторов, наблюдателей, менеджеров, действующий Профи,
-- заблокированных вручную, тестовые учётки, всех, у кого есть хоть одна смета.
-- Дают один шанс: если администратор вернул доступ («Вернуть доступ»), второй раз
-- этого человека правило не замораживает.
--
-- Удалённые этим правилом НЕ попадают в запрет повторной регистрации: перед удалением
-- снимаем frozen_at, и триггер log_inactive_deletion (он пишет «год запрета» только
-- замороженным) их пропускает. Человек, не сохранивший ни одной сметы, может
-- зарегистрироваться заново сразу. Журнал действий — таблица empty_accounts_log.
--
-- Пробный запуск, ничего не меняет:  select public.process_empty_accounts(true);
-- Выполнить в Supabase SQL Editor целиком.

create table if not exists public.empty_accounts_log (
    id        bigserial primary key,
    user_id   uuid not null,
    action    text not null,            -- frozen | deleted
    name      text,
    email     text,
    phone     text,
    region    text,
    created_at_user timestamptz,
    at        timestamptz not null default now()
);
create index if not exists empty_accounts_log_user_idx on public.empty_accounts_log (user_id, action);
alter table public.empty_accounts_log enable row level security;

insert into public.app_settings (key, value)
values ('empty_accounts', '{"enabled": false, "freeze_days": 30, "delete_days": 30, "skip_active": true}'::jsonb)
on conflict (key) do nothing;

-- Кого правило касается сейчас (общая часть пробы, заморозки и предпросмотра в админке).
create or replace function public.empty_accounts_cfg()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    cfg jsonb;
    res jsonb := '{"enabled": false, "freeze_days": 30, "delete_days": 30, "skip_active": true}'::jsonb;
begin
    select value into cfg from public.app_settings where key = 'empty_accounts';
    if cfg is not null then
        begin
            res := jsonb_build_object(
                'enabled',     coalesce((cfg->>'enabled')::boolean, false),
                'freeze_days', greatest(coalesce((cfg->>'freeze_days')::int, 30), 1),
                'delete_days', greatest(coalesce((cfg->>'delete_days')::int, 30), 1),
                'skip_active', coalesce((cfg->>'skip_active')::boolean, true));
        exception when others then
            null;   -- мусор в настройке: остаются значения по умолчанию, правило выключено
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
    delete_days int := (cfg->>'delete_days')::int;
    skip_active boolean := (cfg->>'skip_active')::boolean;
    sender      uuid;
    u           record;
    nm          text;
    body        text;
    frozen      int := 0;
    deleted     int := 0;
begin
    -- Выключено — ничего не делаем. Пробный запуск выключателя не спрашивает.
    if not on_flag and not dry_run then
        return jsonb_build_object('enabled', false);
    end if;

    select id into sender from public.users
     where lower(btrim(email)) = 'dima24ba@gmail.com' limit 1;
    if sender is null then
        select id into sender from public.users
         where account_type = 'admin' order by created_at limit 1;
    end if;

    -- ── Удаление: заморожен этим правилом, срок вышел, смет по-прежнему нет ───
    for u in
        select us.id, us.email, us.username, us.phone, us.region, us.created_at,
               coalesce(nullif(btrim(concat_ws(' ', us.last_name, us.first_name, us.middle_name)), ''),
                        nullif(btrim(us.username), ''), us.email, 'Без имени') as full_name
          from public.users us
         where us.frozen_at is not null
           and us.frozen_at < now() - make_interval(days => delete_days)
           and us.account_type not in ('admin', 'viewer', 'manager', 'pro')
           and exists (select 1 from public.empty_accounts_log l where l.user_id = us.id and l.action = 'frozen')
           and not exists (select 1 from public.estimates e where e.user_id = us.id)
    loop
        if not dry_run then
            insert into public.empty_accounts_log (user_id, action, name, email, phone, region, created_at_user)
            values (u.id, 'deleted', u.full_name, u.email, u.phone, u.region, u.created_at);

            -- Без frozen_at триггер log_inactive_deletion не заведёт запрет регистрации на год.
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

    -- ── Заморозка: смет нет, зарегистрирован давно ───────────────────────────
    for u in
        select us.id, us.email, us.username, us.first_name, us.phone, us.region, us.created_at,
               coalesce(nullif(btrim(concat_ws(' ', us.last_name, us.first_name, us.middle_name)), ''),
                        nullif(btrim(us.username), ''), us.email, 'Без имени') as full_name
          from public.users us
         where us.frozen_at is null
           and us.created_at < now() - make_interval(days => freeze_days)
           and us.account_type not in ('admin', 'viewer', 'manager')
           -- Действующий Профи (пробный, по промокоду или оплаченный) не трогаем.
           and not (us.account_type = 'pro'
                    and (us.pro_expires_at > now() or us.demo_ends_at is null or us.demo_ends_at > now()))
           and coalesce(us.is_blocked, false) = false
           and coalesce(us.is_test, false) = false
           and (not skip_active
                or coalesce(us.last_visited, us.created_at) < now() - make_interval(days => freeze_days))
           and not exists (select 1 from public.estimates e where e.user_id = us.id)
           -- Один шанс: уже замораживали, администратор вернул доступ — больше не трогаем.
           and not exists (select 1 from public.empty_accounts_log l where l.user_id = us.id and l.action = 'frozen')
    loop
        nm := coalesce(nullif(btrim(u.first_name), ''), nullif(btrim(u.username), ''), 'Коллега');
        body := format(
E'%s, вы зарегистрировались на HeatCalc.ru, но за %s дней не сохранили ни одного расчёта — поэтому доступ к учётной записи приостановлен.

Если калькулятор вам нужен, напишите на kovdor24@yandex.ru или в MAX: +7 982 610-95-48 — включим в тот же день.

Если ответа не будет, через %s дней учётная запись будет удалена. Это ни на что не повлияет: зарегистрироваться заново можно в любой момент.

Администрация HeatCalc.ru',
            nm, freeze_days, delete_days);

        if not dry_run then
            update public.users set frozen_at = now() where id = u.id;
            insert into public.empty_accounts_log (user_id, action, name, email, phone, region, created_at_user)
            values (u.id, 'frozen', u.full_name, u.email, u.phone, u.region, u.created_at);

            if sender is not null then
                insert into public.messages (sender_id, recipient_id, text, type)
                values (sender, u.id, body, 'private');
            end if;
            if u.email is not null and btrim(u.email) <> '' then
                perform public.inactivity_send_email(u.email, 'Доступ к HeatCalc.ru приостановлен', body);
            end if;
        end if;
        frozen := frozen + 1;
    end loop;

    return jsonb_build_object('enabled', on_flag, 'frozen', frozen, 'deleted', deleted, 'dry_run', dry_run);
end;
$$;
revoke all on function public.process_empty_accounts(boolean) from public, anon, authenticated;

-- Сколько анкет подпадёт под правило прямо сейчас — для кнопки в админке. Ничего не меняет.
create or replace function public.empty_accounts_preview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception 'Только для администратора';
    end if;
    return public.process_empty_accounts(true);
end;
$$;
grant execute on function public.empty_accounts_preview() to authenticated;

do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        if exists (select 1 from cron.job where jobname = 'process_empty_accounts') then
            perform cron.unschedule('process_empty_accounts');
        end if;
        perform cron.schedule('process_empty_accounts', '40 3 * * *',
                              'select public.process_empty_accounts();');
    else
        raise notice 'pg_cron не установлен — расписание не создано.';
    end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Проход неактивных (из 20261002_inactivity_days_setting.sql) без изменений, кроме
-- одного условия в удалении: замороженных правилом «без смет» он не удаляет — у них
-- свой срок, и удалять их «за неактивность» значило бы закрыть им регистрацию на год.
-- ─────────────────────────────────────────────────────────────────────────
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

            perform public.inactivity_send_email(u.email, 'Вы давно не заходили в HeatCalc.ru', body);
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

-- Проверка без изменений:  select public.process_inactive_accounts(true);
