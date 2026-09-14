-- Напоминание «КП ушло клиенту, а счёт так и не выставлен».
--
-- Раз в сутки база сама проходит по сметам, которые монтажник отправил клиенту —
-- ссылкой (событие sent) или файлом: печать, PDF, Excel (событие printed) — и если
-- с последней отправки прошло N дней, а счёт по смете не запрошен и не выставлен,
-- отправляет:
--   1) монтажнику — личное сообщение в кабинет и пуш на телефон;
--   2) менеджеру дистрибьютора, за которым закреплён монтажник (и директору, если
--      у компании заполнен только он), — такое же сообщение с ФИО и телефоном
--      монтажника, суммой и объектом;
--   3) в историю сметы (invoice_events) — отметку kp_reminder_sent, её видно
--      в карточке канбана «Статусы смет».
--
-- N — настройка монтажника: личный кабинет → «Реквизиты компании» → «Напомнить
-- выставить счёт через, дней» (users.installer_settings.kpReminderDays).
-- Не задано — 10 дней, 0 — напоминаний нет.
--
-- Одно напоминание на одну отправку. Отправил КП заново (новая ссылка, новый файл) —
-- отсчёт начинается с новой даты. Напоминание не уходит, если после отправки:
-- запрошен или выставлен счёт, оплачено, клиент отклонил смету или попросил
-- доработку, монтажник отказался от счёта в прежнем напоминании.
--
-- Почему в базе, а не в приложении: напоминание должно прийти и тогда, когда
-- калькулятор никто не открывал. Тот же приём, что у автопоздравлений
-- (20260820_birthday_greetings.sql) и неактивных учёток (20260909_inactivity_lifecycle.sql).
--
-- Выполнить вручную в Supabase SQL Editor, весь файл целиком за один раз.
-- Ничего не удаляет и не переписывает, только добавляет.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Журнал: по какой отправке уже напомнили.
--
-- Ключ (calc_id, sent_for): sent_for — время той самой отправки КП. Вторая
-- отправка той же сметы даёт новое время и, значит, своё напоминание.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.kp_invoice_reminders (
    id           uuid primary key default gen_random_uuid(),
    calc_id      text        not null,
    sent_for     timestamptz not null,
    installer_id uuid references public.users(id) on delete cascade,
    manager_ids  uuid[]      not null default '{}',
    days         int         not null,
    created_at   timestamptz not null default now(),
    unique (calc_id, sent_for)
);

-- Таблица служебная, наружу не отдаём: функции ниже — security definer.
alter table public.kp_invoice_reminders enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Пуш на телефон.
--
-- Текст и адресатов Edge Function send-push берёт из журнала сама (ветка
-- kp_reminder), наружу уходит только id строки и кому: монтажнику или менеджеру.
-- Нет pg_net или сервисного ключа в Vault — пуш молча пропускается, сообщение
-- в кабинете уходит всё равно.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.kp_reminder_send_push(rid uuid, target text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    svc text;
begin
    if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
    begin
        select decrypted_secret into svc
          from vault.decrypted_secrets where name = 'service_role_key' limit 1;
    exception when others then
        svc := null;
    end;
    if svc is null or btrim(svc) = '' then return; end if;

    perform net.http_post(
        url     := 'https://ahanbwugsmcyvrwbmtlx.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || svc,
            'apikey', svc
        ),
        body    := jsonb_build_object('reason', 'kp_reminder', 'id', rid::text, 'to', target)
    );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Сам проход.
--
-- Возвращает {"installers": 3, "managers": 2, "dry_run": false}.
-- С dry_run := true ничего не отправляет — только считает.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.send_kp_invoice_reminders(dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    default_days constant int := 10;  -- то же число, что KP_REMINDER_DAYS_DEFAULT в app.js
    max_days     constant int := 90;
    -- Насколько запоздавшую отправку ещё подбираем. Нужен на случай, если планировщик
    -- пропустил день, и в день включения: без него разом ушли бы напоминания
    -- по всем КП за последние месяцы, давно закрытым по телефону.
    catchup_days constant int := 7;
    stop_events  constant text[] := array['invoice_requested', 'invoice_issued', 'paid',
                                          'rejected', 'needs_revision', 'invoice_reminder_declined'];
    admin_emails constant text[] := array['dima24ba@gmail.com', 'kovdorekb@gmail.com', 'kovdor24@yandex.ru'];

    sender   uuid;
    r        record;
    u        record;
    inst     uuid;
    n_days     int;
    v        text;
    obj      text;
    how      text;
    daysw    text;
    sum_txt  text;
    who      text;
    comp     text;
    mgr_ids  uuid[];
    mgr      uuid;
    rid      uuid;
    body_i   text;
    body_m   text;
    n_inst   int := 0;
    n_mgr    int := 0;
begin
    -- Отправитель — владелец сайта, как у автопоздравлений.
    select id into sender from public.users
     where lower(btrim(email)) = 'dima24ba@gmail.com' limit 1;
    if sender is null then
        select id into sender from public.users
         where account_type = 'admin' order by created_at limit 1;
    end if;
    if sender is null then
        raise notice 'send_kp_invoice_reminders: не найден отправитель — напоминания не отправлены';
        return jsonb_build_object('installers', 0, 'managers', 0, 'dry_run', dry_run);
    end if;

    for r in
        with last_send as (
            -- Последняя отправка каждой сметы за окно, в которое может попасть напоминание
            select distinct on (ev.calc_id)
                   ev.calc_id, ev.created_at as sent_at, ev.event, ev.project_name, ev.user_email
              from public.invoice_events ev
             where ev.event in ('sent', 'printed')
               and ev.created_at > now() - make_interval(days => max_days + catchup_days)
             order by ev.calc_id, ev.created_at desc
        ),
        pending as (
            select ls.*
              from last_send ls
             where ls.sent_at <= now() - interval '1 day'
               and not exists (select 1 from public.invoice_events s
                                where s.calc_id = ls.calc_id
                                  and s.created_at > ls.sent_at
                                  and s.event = any(stop_events))
               and not exists (select 1 from public.kp_invoice_reminders k
                                where k.calc_id = ls.calc_id and k.sent_for = ls.sent_at)
        ),
        est as (
            -- Сохранённая смета по номеру расчёта. Двойники в базе бывают — берём свежую.
            select distinct on (e.calc_data->>'calc_id')
                   e.calc_data->>'calc_id' as calc_id, e.user_id, e.project_name, e.total_sum::text as total_sum
              from public.estimates e
             where e.calc_data->>'calc_id' in (select calc_id from pending)
             order by e.calc_data->>'calc_id', e.created_at desc
        )
        select p.calc_id, p.sent_at, p.event, p.user_email,
               coalesce(nullif(btrim(est.project_name), ''), nullif(btrim(p.project_name), '')) as obj_name,
               est.user_id as est_user, est.total_sum
          from pending p
          left join est on est.calc_id = p.calc_id
         order by p.sent_at
    loop
        -- ── Чья смета ──────────────────────────────────────────────────────
        -- Сохранённая смета знает хозяина точно. КП можно распечатать и не сохранив
        -- расчёт — тогда хозяин только в почте из события отправки.
        inst := r.est_user;
        if inst is null and nullif(btrim(r.user_email), '') is not null then
            select id into inst from public.users
             where lower(btrim(email)) = lower(btrim(r.user_email)) limit 1;
        end if;
        continue when inst is null;

        select * into u from public.users where id = inst;
        continue when not found;
        -- Заблокированным, замороженным и служебным учёткам не пишем. frozen_at читаем
        -- через jsonb: колонка появляется миграцией неактивных учёток, и без неё
        -- прямое обращение уронило бы весь проход.
        continue when coalesce((to_jsonb(u)->>'is_blocked')::boolean, false)
                   or nullif(to_jsonb(u)->>'frozen_at', '') is not null
                   or u.account_type in ('admin', 'viewer')
                   or lower(btrim(coalesce(u.email, ''))) = any(admin_emails);

        -- ── Через сколько дней ─────────────────────────────────────────────
        n_days := default_days;
        v := btrim(coalesce(u.installer_settings->>'kpReminderDays', ''));
        if v ~ '^\d{1,4}$' then n_days := least(v::int, max_days); end if;
        continue when n_days <= 0;
        continue when r.sent_at > now() - make_interval(days => n_days)
                   or r.sent_at <= now() - make_interval(days => n_days + catchup_days);

        -- ── Текст ─────────────────────────────────────────────────────────
        obj := coalesce(r.obj_name, 'Без названия');
        how := case when r.event = 'sent' then 'ссылкой' else 'файлом' end;
        daysw := case
            when n_days % 10 = 1 and n_days % 100 <> 11 then 'день'
            when n_days % 10 between 2 and 4 and n_days % 100 not between 12 and 14 then 'дня'
            else 'дней' end;
        sum_txt := null;
        if r.total_sum ~ '^\d+(\.\d+)?$' and r.total_sum::numeric > 0 then
            sum_txt := replace(to_char(round(r.total_sum::numeric), 'FM999,999,999,999'), ',', ' ') || ' ₽';
        end if;

        body_i := format(
E'📄 Напоминание: выставить счёт

КП по объекту «%s» (расчёт № %s%s) ушло клиенту %s %s — прошло %s %s, а счёт по нему так и не запрошен.

Позвоните клиенту и узнайте решение. Если смету нужно поправить — отправьте новую версию, отсчёт начнётся заново. Когда клиент согласует смету по ссылке, в разделе «Мои объекты» появится кнопка «📄 Получить счёт».

Срок напоминания меняется в личном кабинете → «Реквизиты компании». Поставьте 0 — напоминаний не будет.',
            obj, r.calc_id, coalesce(', ' || sum_txt, ''),
            to_char(r.sent_at at time zone 'Europe/Moscow', 'DD.MM.YYYY'), how,
            n_days, daysw);

        -- ── Менеджер дистрибьютора ─────────────────────────────────────────
        -- Та же выборка, что у запроса счёта в send-push: менеджер и директор, адрес
        -- без учёта регистра.
        mgr_ids := '{}'; comp := null;
        if u.distributor_id is not null then
            select d.company_name into comp from public.distributors d where d.id = u.distributor_id;
            select coalesce(array_agg(distinct mu.id), '{}') into mgr_ids
              from public.distributors d
              join public.users mu
                on lower(btrim(mu.email)) in (lower(btrim(nullif(d.manager_email, ''))),
                                              lower(btrim(nullif(d.director_email, ''))))
             where d.id = u.distributor_id
               and mu.id <> u.id
               and coalesce((to_jsonb(mu)->>'is_blocked')::boolean, false) = false;
        end if;

        who := coalesce(nullif(btrim(concat_ws(' ', u.last_name, u.first_name, u.middle_name)), ''),
                        nullif(btrim(u.username), ''), nullif(btrim(u.email), ''), 'Монтажник');
        body_m := format(
E'📄 Счёт по КП не выставлен

Монтажник: %s, %s.
КП по объекту «%s» (расчёт № %s%s) ушло клиенту %s %s — прошло %s %s, счёт не запрошен.

Монтажник закреплён за вами%s. Хороший повод позвонить и узнать, как идёт сделка.',
            who, coalesce(nullif(btrim(u.phone), ''), 'телефон не указан'),
            obj, r.calc_id, coalesce(', ' || sum_txt, ''),
            to_char(r.sent_at at time zone 'Europe/Moscow', 'DD.MM.YYYY'), how,
            n_days, daysw,
            coalesce(' (' || nullif(btrim(comp), '') || ')', ''));

        if not dry_run then
            insert into public.kp_invoice_reminders (calc_id, sent_for, installer_id, manager_ids, days)
            values (r.calc_id, r.sent_at, u.id, mgr_ids, n_days)
            on conflict (calc_id, sent_for) do nothing
            returning id into rid;
            -- Параллельный запуск уже напомнил по этой отправке
            continue when rid is null;

            insert into public.messages (sender_id, recipient_id, text, type)
            values (sender, u.id, body_i, 'private');
            perform public.kp_reminder_send_push(rid, 'installer');

            foreach mgr in array mgr_ids loop
                insert into public.messages (sender_id, recipient_id, text, type)
                values (sender, mgr, body_m, 'private');
            end loop;
            if array_length(mgr_ids, 1) > 0 then
                perform public.kp_reminder_send_push(rid, 'manager');
            end if;

            -- Отметка в истории сметы. В канбане это техническое событие: карточку
            -- из колонки не двигает (ADMIN_KANBAN_TECH_EVENTS в app.js).
            insert into public.invoice_events (calc_id, event, project_name, meta)
            values (r.calc_id, 'kp_reminder_sent', obj,
                    jsonb_build_object(
                        'comment', format('Автонапоминание: КП отправлено %s дн. назад, счёт не запрошен', n_days),
                        'days', n_days,
                        'sent_at', r.sent_at,
                        'managers', coalesce(array_length(mgr_ids, 1), 0)));
        end if;

        n_inst := n_inst + 1;
        n_mgr  := n_mgr + coalesce(array_length(mgr_ids, 1), 0);
    end loop;

    raise notice 'send_kp_invoice_reminders%: монтажникам %, менеджерам %',
        case when dry_run then ' (пробный запуск, ничего не отправлено)' else '' end, n_inst, n_mgr;
    return jsonb_build_object('installers', n_inst, 'managers', n_mgr, 'dry_run', dry_run);
end;
$$;

revoke all on function public.send_kp_invoice_reminders(boolean) from public, anon, authenticated;
revoke all on function public.kp_reminder_send_push(uuid, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Расписание: ежедневно в 06:15 UTC (09:15 по Москве) — в рабочее время,
-- чтобы менеджер мог сразу позвонить.
-- ─────────────────────────────────────────────────────────────────────────
do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        if exists (select 1 from cron.job where jobname = 'send_kp_invoice_reminders') then
            perform cron.unschedule('send_kp_invoice_reminders');
        end if;
        perform cron.schedule('send_kp_invoice_reminders', '15 6 * * *',
                              'select public.send_kp_invoice_reminders();');
    else
        raise notice 'pg_cron не установлен — расписание не создано. Включите расширение в Dashboard → Database → Extensions и повторите этот блок.';
    end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Проверки (выполнять отдельно, по желанию).
--
-- Сколько напоминаний ушло бы сегодня, ничего не отправляя:
--   select public.send_kp_invoice_reminders(true);
--
-- Отправить прямо сейчас:
--   select public.send_kp_invoice_reminders();
--
-- Что уже отправлено:
--   select * from public.kp_invoice_reminders order by created_at desc limit 20;
--
-- Выключить напоминания совсем:
--   select cron.unschedule('send_kp_invoice_reminders');
-- ─────────────────────────────────────────────────────────────────────────
