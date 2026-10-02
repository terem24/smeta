-- Неактивные учётки: сроки (20 / 25 / 10 дней) меняются из админки.
--
-- Раньше пороги были константами внутри process_inactive_accounts. Теперь функция
-- читает их из app_settings, ключ inactivity_days: {"warn": 20, "freeze": 25, "delete": 10}.
--   warn   — через сколько дней молчания уходит письмо;
--   freeze — на какой день молчания доступ приостанавливается (не раньше warn);
--   delete — через сколько дней заморозки учётка удаляется.
-- Нет записи или в ней мусор — работают прежние 20 / 25 / 10. Писать в app_settings
-- может только администратор (политика app_settings_admin_write из
-- 20260911_shop_invites_3_settings.sql), так что отдельной функции не нужно.
-- В письме о заморозке контакты теперь kovdor24@yandex.ru и MAX +7 982 610-95-48.
--
-- Выполнить в Supabase SQL Editor целиком. Меняет только функцию ночного прохода.

insert into public.app_settings (key, value)
values ('inactivity_days', '{"warn": 20, "freeze": 25, "delete": 10}'::jsonb)
on conflict (key) do nothing;

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
