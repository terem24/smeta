-- Итог КП: «чем закончилось?» (сайт — kp_outcome.js).
--
-- Сайт пишет в invoice_events три новых события:
--   won      — клиент согласился (meta.where: terem / other_seller / self);
--   lost     — отказ (meta.reason — причина из списка, meta.comment);
--   extended — «ещё думает», срок ответа +30 дней (не больше двух раз).
-- Таблица та же, колонки те же — схему менять не нужно.
--
-- Эта миграция делает две вещи на стороне базы.
--
-- 1. Раз в сутки — напоминание на 30-й день. Срок ответа КП: последняя
--    отправка клиенту (sent / printed) или последнее продление + 30 дней, но не
--    раньше 23.10.2026 (день запуска: иначе всем разом пришли бы письма по КП
--    полугодовой давности). Срок вышел, итога нет — монтажнику сообщение в
--    кабинет, менеджеру его дистрибьютора — такое же с ФИО и телефоном.
--    Одно напоминание на один срок: продлил — следующее придёт по новому сроку.
--    Окно в самом калькуляторе показывается при входе и без этого сообщения;
--    сообщение нужно тем, кто калькулятор не открывает.
--    Правило срока то же, что KpOutcome.build в kp_outcome.js — менять вместе.
--
-- 2. Напоминание «КП без счёта» на 10-й день (send_kp_invoice_reminders) больше
--    не уходит по КП, у которого отмечен итог (won / lost).
--
-- Выполнить в Supabase SQL Editor целиком. Ничего не удаляет.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Напоминание на 30-й день
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.send_kp_outcome_reminders(dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    term_days    constant int := 30;       -- KpOutcome.DAYS
    max_ext      constant int := 2;        -- KpOutcome.MAX_EXT
    start_at     constant timestamptz := '2026-10-23 00:00:00+03';  -- KpOutcome.START
    -- Пропущенный день планировщика подбираем, но не старше недели
    catchup_days constant int := 7;
    admin_emails constant text[] := array['kovdor24@yandex.ru'];

    sender  uuid;
    o       record;
    it      jsonb;
    u       record;
    mgr_ids uuid[];
    mgr     uuid;
    comp    text;
    who     text;
    lines   text;
    n_kp    int;
    body_i  text;
    body_m  text;
    n_inst  int := 0;
    n_mgr   int := 0;
    n_kps   int := 0;
begin
    select id into sender from public.users where lower(btrim(email)) = 'kovdor24@yandex.ru' limit 1;
    if sender is null then
        select id into sender from public.users where account_type = 'admin' order by created_at limit 1;
    end if;
    if sender is null then
        return jsonb_build_object('installers', 0, 'managers', 0, 'dry_run', dry_run, 'error', 'no sender');
    end if;

    -- Одно сообщение на монтажника: у кого вышел срок сразу у нескольких КП (в день
    -- запуска — у всех старых), получает их списком, а не пачкой сообщений
    for o in
        with sends as (
            select calc_id, created_at, user_id, project_name, meta
              from public.invoice_events
             where event in ('sent', 'printed')
               and created_at > now() - interval '400 days'
        ),
        kp as (
            select s.calc_id,
                   max(s.created_at) as last_sent,
                   (array_agg(s.user_id order by s.created_at))[1] as owner_id,
                   (array_agg(s.project_name order by s.created_at desc) filter (where nullif(btrim(s.project_name), '') is not null))[1] as obj_name,
                   max((s.meta->>'kp_version')::int) filter (where s.meta->>'kp_version' ~ '^\d{1,6}$') as kp_version
              from sends s
             group by s.calc_id
        ),
        st as (
            select kp.*,
                   (select max(created_at) from public.invoice_events x where x.calc_id = kp.calc_id and x.event = 'extended') as last_ext,
                   (select count(*) from public.invoice_events x where x.calc_id = kp.calc_id and x.event = 'extended')::int as n_ext
              from kp
             where not exists (select 1 from public.invoice_events x
                                where x.calc_id = kp.calc_id
                                  and x.event in ('won', 'invoice_requested', 'invoice_issued', 'paid'))
               and not exists (select 1 from public.invoice_events x
                                where x.calc_id = kp.calc_id and x.event = 'lost' and x.created_at >= kp.last_sent)
        ),
        due as (
            select st.*,
                   greatest(st.last_sent, coalesce(st.last_ext, st.last_sent), start_at - make_interval(days => term_days))
                       + make_interval(days => term_days) as due_at
              from st
        ),
        pending as (
            select d.*, to_char(d.due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as due_key
              from due d
             where d.due_at <= now()
               and d.due_at > now() - make_interval(days => catchup_days)
               and d.owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        )
        select p.owner_id,
               jsonb_agg(jsonb_build_object(
                   'calc_id', p.calc_id,
                   'obj', coalesce(p.obj_name, 'Без названия'),
                   'num', p.calc_id || coalesce('-' || p.kp_version::text, ''),
                   'sent', to_char(p.last_sent at time zone 'Europe/Moscow', 'DD.MM.YYYY'),
                   'left', greatest(0, max_ext - p.n_ext),
                   'ext', p.n_ext,
                   'due', p.due_key) order by p.due_at) as items
          from pending p
         where not exists (select 1 from public.invoice_events x
                            where x.calc_id = p.calc_id and x.event = 'kp_outcome_reminder'
                              and x.meta->>'due' = p.due_key)
         group by p.owner_id
    loop
        select * into u from public.users where id = o.owner_id::uuid;
        continue when not found;
        continue when coalesce((to_jsonb(u)->>'is_blocked')::boolean, false)
                   or nullif(to_jsonb(u)->>'frozen_at', '') is not null
                   or coalesce((to_jsonb(u)->>'is_test')::boolean, false)
                   or u.account_type in ('admin', 'viewer')
                   or lower(btrim(coalesce(u.email, ''))) = any(admin_emails);

        n_kp := jsonb_array_length(o.items);
        select string_agg(format('• «%s», КП № %s, отправлено %s%s', i->>'obj', i->>'num', i->>'sent',
                                 case when (i->>'left')::int > 0 then '' else ' (продления закончились)' end), E'\n')
          into lines
          from jsonb_array_elements(o.items) i;

        body_i := format(
E'🏁 Чем закончились КП?\n\nПрошло больше %s дней, а итог не отмечен:\n%s\n\nОткройте калькулятор и отметьте по каждому: клиент согласился, отказался или ещё думает (срок можно продлить на %s дней, не больше %s раз). Если отказ — выберите причину: по ним мы дорабатываем калькулятор.',
            term_days, lines, term_days, max_ext);

        mgr_ids := '{}'; comp := null;
        if u.distributor_id is not null then
            select d.company_name into comp from public.distributors d where d.id = u.distributor_id;
            select coalesce(array_agg(distinct mu.id), '{}') into mgr_ids
              from public.distributors d
              join public.users mu
                on lower(btrim(mu.work_email)) in (lower(btrim(nullif(d.manager_email, ''))), lower(btrim(nullif(d.director_email, ''))))
                or lower(btrim(mu.email)) in (lower(btrim(nullif(d.manager_email, ''))), lower(btrim(nullif(d.director_email, ''))))
             where d.id = u.distributor_id
               and mu.id <> u.id
               and coalesce((to_jsonb(mu)->>'is_blocked')::boolean, false) = false;
        end if;

        who := coalesce(nullif(btrim(concat_ws(' ', u.last_name, u.first_name, u.middle_name)), ''),
                        nullif(btrim(u.username), ''), nullif(btrim(u.email), ''), 'Монтажник');
        body_m := format(
E'🏁 КП без итога\n\nМонтажник: %s, %s%s.\nКП ушли клиентам больше %s дней назад, итог не отмечен:\n%s\n\nПозвоните монтажнику — или отметьте итог сами, если знаете: кабинет → «Мои монтажники» → «КП без итога».',
            who, coalesce(nullif(btrim(u.phone), ''), 'телефон не указан'),
            coalesce(' (' || nullif(btrim(comp), '') || ')', ''), term_days, lines);

        if not dry_run then
            insert into public.messages (sender_id, recipient_id, text, type)
            values (sender, u.id, body_i, 'private');
            foreach mgr in array mgr_ids loop
                insert into public.messages (sender_id, recipient_id, text, type)
                values (sender, mgr, body_m, 'private');
            end loop;
            -- Отметка в истории каждого КП: по ней второй раз за тот же срок не пишем.
            -- В канбане это техническое событие (ADMIN_KANBAN_TECH_EVENTS в app.js).
            for it in select * from jsonb_array_elements(o.items) loop
                insert into public.invoice_events (calc_id, event, project_name, meta)
                values (it->>'calc_id', 'kp_outcome_reminder', it->>'obj',
                        jsonb_build_object(
                            'due', it->>'due',
                            'ext', (it->>'ext')::int,
                            'managers', coalesce(array_length(mgr_ids, 1), 0),
                            'comment', format('Автонапоминание: КП отправлено %s, итог не отмечен', it->>'sent')));
            end loop;
        end if;

        n_inst := n_inst + 1;
        n_kps  := n_kps + n_kp;
        n_mgr  := n_mgr + coalesce(array_length(mgr_ids, 1), 0);
    end loop;

    return jsonb_build_object('installers', n_inst, 'kp', n_kps, 'managers', n_mgr, 'dry_run', dry_run);
end;
$$;

revoke all on function public.send_kp_outcome_reminders(boolean) from public, anon, authenticated;

-- Ежедневно в 06:20 UTC (09:20 по Москве) — сразу после напоминания о счёте
do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        if exists (select 1 from cron.job where jobname = 'send_kp_outcome_reminders') then
            perform cron.unschedule('send_kp_outcome_reminders');
        end if;
        perform cron.schedule('send_kp_outcome_reminders', '20 6 * * *',
                              'select public.send_kp_outcome_reminders();');
    else
        raise notice 'pg_cron не установлен — расписание не создано.';
    end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Напоминание «КП без счёта» не шлём, если итог уже отмечен
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
    src  text;
    a    text := '''rejected'', ''needs_revision'', ''invoice_reminder_declined'']';
    b    text := '''rejected'', ''needs_revision'', ''invoice_reminder_declined'', ''won'', ''lost'']';
begin
    select pg_get_functiondef('public.send_kp_invoice_reminders(boolean)'::regprocedure) into src;
    if position(b in src) > 0 then
        return;   -- уже заменено прошлым запуском
    end if;
    if position(a in src) = 0 then
        raise exception 'send_kp_invoice_reminders: не найден список stop_events';
    end if;
    execute replace(src, a, b);
end;
$$;

revoke all on function public.send_kp_invoice_reminders(boolean) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Проверки (по желанию, отдельно):
--   select public.send_kp_outcome_reminders(true);   -- сколько ушло бы сегодня
--   select calc_id, meta, created_at from invoice_events where event = 'kp_outcome_reminder' order by created_at desc limit 20;
--   select event, meta->>'reason' as reason, count(*) from invoice_events where event in ('won','lost') group by 1, 2 order by 3 desc;
-- ─────────────────────────────────────────────────────────────────────────
