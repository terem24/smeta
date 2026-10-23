-- Итог КП: напоминание на 30-й день читает настройки админа.
--
-- До этого срок (30 дней), число продлений (2) и круг получателей были зашиты в
-- send_kp_outcome_reminders (20261022_kp_outcome.sql). Теперь функция берёт их там же,
-- откуда окно в калькуляторе (kp_outcome.js): app_settings.subscription → limit
-- («Оплата подписки» → «Лимит КП» → «Итог КП»):
--   outcomeOn        — общий выключатель; выключено — сообщений нет;
--   outcomeAudBase / outcomeAudPro / outcomeAudMgr — кому: монтажники без Профи,
--                      на Профи, менеджеры;
--   outcomeDays      — срок по умолчанию, дней (30);
--   outcomeDaysMin / outcomeDaysMax — границы личного срока монтажника (14 / 60);
--   outcomeExt       — сколько раз можно продлить (2).
-- Личный срок монтажника — users.installer_settings.kpOutcomeDays («Настройки → КП и
-- счета»), приводится к границам админа. Тарифы определяются как в калькуляторе:
-- менеджер — account_type = 'manager'; Профи — 'pro' с неистёкшим demo_ends_at;
-- остальные — Базовый.
--
-- Правила срока и клампы те же, что в KpOutcome (kp_outcome.js, Subscription.limitSettings
-- в subscription.js) — менять вместе. Ключ повторного напоминания — дата срока, так что
-- смена срока даёт новую дату и, значит, новое напоминание по КП, по которым срок
-- сдвинулся.
--
-- Выполнить в Supabase SQL Editor целиком. Ничего не удаляет.

create or replace function public.send_kp_outcome_reminders(dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    start_at     constant timestamptz := '2026-10-23 00:00:00+03';  -- KpOutcome.START
    -- Пропущенный день планировщика подбираем, но не старше недели
    catchup_days constant int := 7;
    admin_emails constant text[] := array['kovdor24@yandex.ru'];

    cfg     jsonb;
    c_on    boolean;
    a_base  boolean;
    a_pro   boolean;
    a_mgr   boolean;
    v_min   int;
    v_max   int;
    v_def   int;
    v_ext   int;

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
    -- ── Настройки админа ───────────────────────────────────────────────
    select coalesce(s.value->'limit', '{}'::jsonb) into cfg
      from public.app_settings s where s.key = 'subscription';
    cfg := coalesce(cfg, '{}'::jsonb);

    c_on   := case when cfg->>'outcomeOn'      in ('true', 'false') then (cfg->>'outcomeOn')::boolean      else true end;
    a_base := case when cfg->>'outcomeAudBase' in ('true', 'false') then (cfg->>'outcomeAudBase')::boolean else true end;
    a_pro  := case when cfg->>'outcomeAudPro'  in ('true', 'false') then (cfg->>'outcomeAudPro')::boolean  else true end;
    a_mgr  := case when cfg->>'outcomeAudMgr'  in ('true', 'false') then (cfg->>'outcomeAudMgr')::boolean  else true end;
    v_min  := least(90,  greatest(7, case when cfg->>'outcomeDaysMin' ~ '^\d{1,3}$' then (cfg->>'outcomeDaysMin')::int else 14 end));
    v_max  := least(180, greatest(v_min, case when cfg->>'outcomeDaysMax' ~ '^\d{1,3}$' then (cfg->>'outcomeDaysMax')::int else 60 end));
    v_def  := least(v_max, greatest(v_min, case when cfg->>'outcomeDays' ~ '^\d{1,3}$' then (cfg->>'outcomeDays')::int else 30 end));
    v_ext  := least(5, greatest(0, case when cfg->>'outcomeExt' ~ '^\d{1,2}$' then (cfg->>'outcomeExt')::int else 2 end));

    if not c_on then
        return jsonb_build_object('installers', 0, 'kp', 0, 'managers', 0, 'dry_run', dry_run, 'off', true);
    end if;

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
        own as (
            -- Хозяин КП: тариф и личный срок. user_id в журнале — текст, сравниваем как текст
            select st.*, uu.account_type, uu.demo_ends_at,
                   case when uu.installer_settings->>'kpOutcomeDays' ~ '^\d{1,3}$'
                        then least(v_max, greatest(v_min, (uu.installer_settings->>'kpOutcomeDays')::int))
                        else v_def end as days
              from st
              join public.users uu on uu.id::text = st.owner_id
        ),
        due as (
            select own.*,
                   greatest(own.last_sent, coalesce(own.last_ext, own.last_sent), start_at - make_interval(days => own.days))
                       + make_interval(days => own.days) as due_at
              from own
        ),
        pending as (
            select d.*, to_char(d.due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as due_key
              from due d
             where d.due_at <= now()
               and d.due_at > now() - make_interval(days => catchup_days)
               -- кому включено: менеджер / Профи (с неистёкшим сроком) / остальные
               and case
                       when d.account_type = 'manager' then a_mgr
                       when d.account_type = 'pro' and (d.demo_ends_at is null or d.demo_ends_at > now()) then a_pro
                       else a_base
                   end
        )
        select p.owner_id,
               max(p.days) as days,
               jsonb_agg(jsonb_build_object(
                   'calc_id', p.calc_id,
                   'obj', coalesce(p.obj_name, 'Без названия'),
                   'num', p.calc_id || coalesce('-' || p.kp_version::text, ''),
                   'sent', to_char(p.last_sent at time zone 'Europe/Moscow', 'DD.MM.YYYY'),
                   'left', greatest(0, v_ext - p.n_ext),
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
E'🏁 Чем закончились КП?\n\nПрошло больше %s дней, а итог не отмечен:\n%s\n\nОткройте калькулятор и отметьте по каждому: клиент согласился, отказался или ещё думает%s. Если отказ — выберите причину: по ним мы дорабатываем калькулятор.',
            o.days, lines,
            case when v_ext > 0 then format(' (срок можно продлить на %s дней, не больше %s раз)', o.days, v_ext) else '' end);

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
            coalesce(' (' || nullif(btrim(comp), '') || ')', ''), o.days, lines);

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

-- ─────────────────────────────────────────────────────────────────────────
-- Проверки (по желанию, отдельно):
--   select public.send_kp_outcome_reminders(true);   -- сколько ушло бы сегодня
-- ─────────────────────────────────────────────────────────────────────────
