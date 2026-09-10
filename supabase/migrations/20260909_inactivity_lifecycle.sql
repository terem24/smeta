-- Что делать с учётками, в которые перестали заходить.
--
-- Раз в сутки база сама проходит по списку и делает три вещи:
--   30 дней молчания  → предупреждение (сообщение в кабинет, письмо, пуш на телефон);
--   45 дней молчания  → доступ приостановлен (заморозка): войти нельзя, данные целы;
--   45 дней заморозки → учётка и все её расчёты удаляются.
--
-- ПОЧЕМУ ЗАМОРОЗКА, А НЕ СРАЗУ УДАЛЕНИЕ. Между «человек забыл про сайт» и «человек
-- ушёл навсегда» разницы по логам не видно, а удаление необратимо: вместе с учёткой
-- пропадают сметы, по которым он работает с заказчиком. Заморозка даёт ещё полтора
-- месяца и понятный способ вернуться — написать администратору.
--
-- ПОЧЕМУ НЕ РАНЬШЕ ЧЕМ ЧЕРЕЗ 14 ДНЕЙ ПОСЛЕ ПРЕДУПРЕЖДЕНИЯ. В день включения правила
-- в базе уже лежат те, кто молчит два-три месяца. Без этой оговорки они были бы
-- заморожены в ту же ночь, не получив ни одного письма. Поэтому заморозка наступает
-- либо на 45-й день молчания, либо через две недели после предупреждения — смотря
-- что позже.
--
-- КОГО ПРАВИЛО НЕ КАСАЕТСЯ:
--   • администраторы, наблюдатели и менеджеры — служебные учётки, заходят редко,
--     а удаление ломает доступ к панели;
--   • те, кто оплачивал Профи (заполнен pro_expires_at) — человек заплатил деньги,
--     его данные не стираем, даже если он пропал.
--
-- Почему в базе, а не в приложении: правило должно работать само, а не тогда, когда
-- кто-то откроет админку. Тот же приём, что у автопоздравлений с днём рождения
-- (20260820_birthday_greetings.sql) — функция плюс расписание pg_cron.
--
-- Выполнить вручную в Supabase SQL Editor, весь файл целиком за один раз.
-- Сам по себе он ничего не удаляет: добавляет колонку, таблицу, функции и расписание.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Отметка о заморозке в самой учётке.
--
-- Отдельно от is_blocked намеренно: is_blocked ставит администратор руками и снимает
-- тоже руками. Смешай их — и «разблокировать» после автозаморозки сняло бы заодно
-- ручную блокировку нарушителя, а ночной проход мог бы заморозить того, кого только
-- что разблокировали.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.users add column if not exists frozen_at timestamptz;

comment on column public.users.frozen_at is
    'Доступ приостановлен из-за долгого отсутствия (см. process_inactive_accounts). '
    'Пусто — учётка обычная. Снимается кнопкой «Вернуть доступ» в админке.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Журнал: кого и когда предупреждали.
--
-- Одна строка на человека. warned_for хранит тот самый «последний вход», из-за
-- которого ушло предупреждение: человек зашёл, потом снова пропал на месяц — значение
-- изменилось, и предупреждение уйдёт заново. Без него письмо ушло бы один раз в жизни.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.inactivity_notices (
    user_id     uuid primary key references public.users(id) on delete cascade,
    stage       text        not null default 'warned',   -- warned | frozen
    warned_at   timestamptz,
    warned_for  timestamptz,
    frozen_at   timestamptz,
    updated_at  timestamptz not null default now()
);

-- Таблица служебная, наружу не отдаём: функции ниже — security definer и политики обходят.
alter table public.inactivity_notices enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Дата по-русски: «24 сентября 2026 года».
--
-- to_char зависит от локали сервера, а она здесь английская — писать монтажнику
-- «24 September» не годится.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.ru_date(d timestamptz)
returns text
language sql
immutable
as $$
    select extract(day from d)::int || ' ' ||
           (array['января','февраля','марта','апреля','мая','июня',
                  'июля','августа','сентября','октября','ноября','декабря']
            )[extract(month from d)::int] || ' ' ||
           extract(year from d)::int || ' года';
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Письмо и пуш.
--
-- Оба канала необязательные: если в базе нет pg_net (расширение для исходящих
-- запросов) или в Vault нет сервисного ключа, функция молча пропускает этот способ.
-- Сообщение в кабинете уходит всегда — оно пишется прямой вставкой в messages.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.inactivity_send_email(to_email text, subj text, body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if to_email is null or btrim(to_email) = '' then return; end if;
    -- pg_net не установлен — письма не отправляем, но и не падаем: остальные
    -- каналы и сама заморозка от почты не зависят.
    if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;

    -- Тело один в один как у приложения (см. emailjs.send в app.js): тот же прокси
    -- на Beget, тот же шаблон, тот же публичный ключ.
    perform net.http_post(
        url     := 'https://proxy.heatcalc.ru/emailjs_proxy.php',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body    := jsonb_build_object(
            'service_id',  'service_o11b4ej',
            'template_id', 'template_ysuxfio',
            'user_id',     '-m4N93pTqMlCfuBpT',
            'template_params', jsonb_build_object(
                'to_email',      btrim(to_email),
                'user_email',    btrim(to_email),
                'tariff_name',   'Системное уведомление',
                'email_subject', subj,
                'subject_text',  subj,
                'email_body',    body,
                'message_text',  body
            )
        )
    );
end;
$$;

create or replace function public.inactivity_send_push(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    svc text;
begin
    if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;

    -- Сервисный ключ лежит в Vault (Dashboard → Project Settings → Vault) под именем
    -- service_role_key. Нет секрета — нет пуша: в коде базы такому ключу не место,
    -- миграции читают все, кому открыт репозиторий.
    begin
        select decrypted_secret into svc
          from vault.decrypted_secrets where name = 'service_role_key' limit 1;
    exception when others then
        svc := null;
    end;
    if svc is null or btrim(svc) = '' then return; end if;

    -- Кому и что показать, функция send-push выясняет сама, перечитывая журнал из
    -- базы: наружу уходит только вид события и чья это строка.
    perform net.http_post(
        url     := 'https://ahanbwugsmcyvrwbmtlx.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || svc,
            'apikey', svc
        ),
        body    := jsonb_build_object('reason', 'inactivity', 'id', target::text)
    );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Сам ночной проход.
--
-- Возвращает, что сделал: {"warned": 3, "frozen": 1, "deleted": 0}.
-- С dry_run := true ничего не меняет — только считает, кого бы задело. С этого
-- и стоит начинать после установки.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.process_inactive_accounts(dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    -- Пороги. Меняются здесь, в одном месте; тексты писем считают даты от них сами.
    warn_days       constant int := 30;   -- когда предупредить
    freeze_days     constant int := 45;   -- когда приостановить доступ
    grace_days      constant int := 14;   -- сколько ждать после предупреждения
    delete_days     constant int := 45;   -- сколько ждать после заморозки

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
    -- Отправитель сообщений — владелец сайта, как у автопоздравлений.
    select id into sender from public.users
     where lower(btrim(email)) = 'dima24ba@gmail.com' limit 1;
    if sender is null then
        select id into sender from public.users
         where account_type = 'admin' order by created_at limit 1;
    end if;

    -- ── 5.1. Удаление: заморожен и за 45 дней так и не написал ──────────────
    --
    -- Идём от старшего этапа к младшему, чтобы человек за один проход не проскочил
    -- сразу два: сегодня заморозили — удалять будем не раньше чем через 45 дней.
    for u in
        select us.id, us.email, us.username, us.last_name, us.first_name
          from public.users us
         where us.frozen_at is not null
           and us.frozen_at < now() - make_interval(days => delete_days)
           and us.account_type not in ('admin', 'viewer', 'manager')
           and us.pro_expires_at is null
    loop
        if not dry_run then
            -- Тот же список таблиц, что чистит «Удалить учётку» в админке
            -- (deleteUserCompletely в app.js). Порядок важен: users последней.
            delete from public.estimates where user_id = u.id;
            delete from public.messages where sender_id = u.id or recipient_id = u.id;
            delete from public.manager_chat_messages
             where installer_user_id = u.id or manager_user_id = u.id or sender_user_id = u.id;
            delete from public.users where id = u.id;

            -- Логин в Supabase Auth живёт отдельной таблицей. Прав на неё у функции
            -- может не быть — тогда просто оставляем: без строки в public.users войти
            -- всё равно некуда, а падать из-за этого ночному проходу незачем.
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

    -- ── 5.2. Заморозка: 45 дней молчания и две недели после предупреждения ──
    for u in
        select us.id, us.email, us.username, us.first_name, us.middle_name,
               coalesce(us.last_visited, us.created_at) as last_seen
          from public.users us
          join public.inactivity_notices n on n.user_id = us.id
         where us.frozen_at is null
           and us.account_type not in ('admin', 'viewer', 'manager')
           and us.pro_expires_at is null
           and coalesce(us.last_visited, us.created_at) < now() - make_interval(days => freeze_days)
           and n.warned_at is not null
           and n.warned_at < now() - make_interval(days => grace_days)
           -- Предупреждение должно относиться к текущему молчанию. Без этой строки
           -- человек, который получил письмо год назад, заходил после него и снова
           -- пропал, был бы заморожен по тому старому письму, не получив нового.
           and n.warned_for = coalesce(us.last_visited, us.created_at)
    loop
        delete_on := now() + make_interval(days => delete_days);
        nm := coalesce(nullif(btrim(u.first_name), ''), nullif(btrim(u.username), ''), 'Коллега');
        body := format(
E'%s, доступ к вашей учётной записи на HeatCalc.ru приостановлен: в калькулятор не заходили больше %s дней.

Расчёты и сметы никуда не делись — они сохранены и ждут вас.

Чтобы вернуть доступ, просто ответьте на это письмо или напишите на dima24ba@gmail.com. Включим в тот же день, ничего заполнять заново не придётся.

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

    -- ── 5.3. Предупреждение: 30 дней молчания ──────────────────────────────
    for u in
        select us.id, us.email, us.username, us.first_name, us.middle_name,
               coalesce(us.last_visited, us.created_at) as last_seen
          from public.users us
          left join public.inactivity_notices n on n.user_id = us.id
         where us.frozen_at is null
           and us.account_type not in ('admin', 'viewer', 'manager')
           and us.pro_expires_at is null
           and coalesce(us.last_visited, us.created_at) < now() - make_interval(days => warn_days)
           -- Ещё не предупреждали, либо предупреждали за прошлый период молчания:
           -- человек заходил после того письма и снова пропал.
           and (n.warned_for is null or n.warned_for <> coalesce(us.last_visited, us.created_at))
    loop
        -- Дата заморозки: 45-й день молчания, но не раньше чем через две недели.
        freeze_on := greatest(u.last_seen + make_interval(days => freeze_days),
                              now() + make_interval(days => grace_days));
        delete_on := freeze_on + make_interval(days => delete_days);
        nm := coalesce(nullif(btrim(u.first_name), ''), nullif(btrim(u.username), ''), 'Коллега');
        body := format(
E'%s, вы больше месяца не заходили в калькулятор HeatCalc.ru.

Если так и не зайдёте, %s мы приостановим доступ к вашей учётной записи, а %s удалим её вместе со всеми сохранёнными расчётами и сметами.

Чтобы этого не случилось, достаточно открыть heatcalc.ru и зайти в свой аккаунт — отсчёт начнётся заново, никаких действий больше не нужно.

Если аккаунт вам больше не нужен, просто не обращайте внимания на это письмо.

Администрация HeatCalc.ru',
            nm, public.ru_date(freeze_on), public.ru_date(delete_on));

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

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Вернуть доступ. Зовётся кнопкой в админке (app.unfreezeUser).
--
-- Кроме снятия отметки сдвигает «последний вход» на сегодня: иначе ночной проход
-- увидел бы прежнюю дату и заморозил человека той же ночью.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.unfreeze_user(target uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    ok boolean := false;
begin
    -- Звать может только администратор: сверяемся с почтой из сессии, а не с тем,
    -- что прислал браузер.
    if not exists (
        select 1 from public.users me
         where me.auth_user_id = auth.uid()
           and (me.account_type = 'admin'
                or lower(btrim(me.email)) in ('dima24ba@gmail.com', 'kovdorekb@gmail.com', 'kovdor24@yandex.ru'))
    ) then
        raise exception 'Вернуть доступ может только администратор';
    end if;

    update public.users
       set frozen_at = null, last_visited = now()
     where id = target and frozen_at is not null;
    ok := found;

    delete from public.inactivity_notices where user_id = target;
    return ok;
end;
$$;

revoke all on function public.process_inactive_accounts(boolean) from public, anon, authenticated;
revoke all on function public.inactivity_send_email(text, text, text) from public, anon, authenticated;
revoke all on function public.inactivity_send_push(uuid) from public, anon, authenticated;
grant execute on function public.unfreeze_user(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Расписание: каждую ночь в 03:30 UTC (06:30 по Москве).
--
-- Раньше поздравлений с днём рождения (06:00 UTC) — чтобы человек, которого сегодня
-- заморозили, не получил в то же утро «с днём рождения!» в мёртвую учётку.
-- ─────────────────────────────────────────────────────────────────────────
do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        if exists (select 1 from cron.job where jobname = 'process_inactive_accounts') then
            perform cron.unschedule('process_inactive_accounts');
        end if;
        perform cron.schedule('process_inactive_accounts', '30 3 * * *',
                              'select public.process_inactive_accounts();');
    else
        raise notice 'pg_cron не установлен — расписание не создано. Включите расширение в Dashboard → Database → Extensions и повторите этот блок.';
    end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Проверки (выполнять отдельно, по желанию).
--
-- Кого правило заденет, ничего не меняя:
--   select public.process_inactive_accounts(true);
--
-- Поимённо, кто сколько молчит:
--   select last_name, first_name, email, frozen_at,
--          (current_date - coalesce(last_visited, created_at)::date) as дней_молчит
--     from public.users
--    where account_type not in ('admin','viewer','manager') and pro_expires_at is null
--    order by 5 desc;
--
-- Запустить проход прямо сейчас:
--   select public.process_inactive_accounts();
--
-- Вернуть человеку доступ руками (то же делает кнопка в админке):
--   select public.unfreeze_user('<id учётки>');
--
-- Выключить правило совсем:
--   select cron.unschedule('process_inactive_accounts');
-- ─────────────────────────────────────────────────────────────────────────
