-- Итог КП: автоотклонение «без ответа слишком долго».
--
-- КП, которое ушло клиенту, но итога по нему нет и никакого движения (новой отправки,
-- продления) уже 12 месяцев, само становится «Отклонено»: в журнал invoice_events
-- пишется событие lost с reason = 'timeout' и auto = true. После этого КП лежит в
-- колонке «Итог» планировщика, в «Моих объектах» его статус «Отказ: Нет ответа 12 мес.
-- (авто)», в виджете «Итоги» на дашборде оно «Отклонено (авто)».
--
-- Срок — настройка админа («Оплата подписки» → «Лимит КП» → «Итог КП» → «Автоотклонение
-- без ответа, месяцев»): app_settings.subscription.limit.outcomeAutoMonths, по умолчанию
-- 12, 0 — не отклонять. Общий выключатель окна (outcomeOn) выключен — тоже не отклоняем.
--
-- Правило то же, что в KpOutcome.build (kp_outcome.js): считаем от последней отправки
-- или последнего продления. Если после автоотклонения КП отправят клиенту снова,
-- оно снова «в работе» — новое событие отправки позже события lost.
--
-- Запускается раз в сутки в 06:25 UTC (09:25 МСК), после напоминаний (06:20).
-- Выполнить в Supabase SQL Editor целиком. Ничего не удаляет.

create or replace function public.close_stale_kp_outcomes(dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    cfg    jsonb;
    c_on   boolean;
    v_auto int;
    r      record;
    n      int := 0;
begin
    select coalesce(s.value->'limit', '{}'::jsonb) into cfg
      from public.app_settings s where s.key = 'subscription';
    cfg := coalesce(cfg, '{}'::jsonb);
    c_on   := case when cfg->>'outcomeOn' in ('true', 'false') then (cfg->>'outcomeOn')::boolean else true end;
    v_auto := least(60, greatest(0, case when cfg->>'outcomeAutoMonths' ~ '^\d{1,2}$' then (cfg->>'outcomeAutoMonths')::int else 12 end));
    if not c_on or v_auto = 0 then
        return jsonb_build_object('closed', 0, 'dry_run', dry_run, 'off', true);
    end if;

    for r in
        with kp as (
            select s.calc_id,
                   max(s.created_at) as last_sent,
                   (array_agg(s.project_name order by s.created_at desc) filter (where nullif(btrim(s.project_name), '') is not null))[1] as obj
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
        )
        select st.calc_id, st.obj, greatest(st.last_sent, coalesce(st.last_ext, st.last_sent)) as base
          from st
         where greatest(st.last_sent, coalesce(st.last_ext, st.last_sent)) + make_interval(months => v_auto) <= now()
    loop
        if not dry_run then
            insert into public.invoice_events (calc_id, event, project_name, meta)
            values (r.calc_id, 'lost', r.obj,
                    jsonb_build_object(
                        'reason', 'timeout',
                        'auto', true,
                        'by_staff', true,
                        'label', format('Нет ответа %s мес. (авто)', v_auto),
                        'comment', format('Автоматически: итога не было %s мес. с %s', v_auto, to_char(r.base at time zone 'Europe/Moscow', 'DD.MM.YYYY'))));
        end if;
        n := n + 1;
    end loop;

    return jsonb_build_object('closed', n, 'dry_run', dry_run, 'months', v_auto);
end;
$$;

revoke all on function public.close_stale_kp_outcomes(boolean) from public, anon, authenticated;

do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        if exists (select 1 from cron.job where jobname = 'close_stale_kp_outcomes') then
            perform cron.unschedule('close_stale_kp_outcomes');
        end if;
        perform cron.schedule('close_stale_kp_outcomes', '25 6 * * *',
                              'select public.close_stale_kp_outcomes();');
    else
        raise notice 'pg_cron не установлен — расписание не создано.';
    end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Проверки (по желанию, отдельно):
--   select public.close_stale_kp_outcomes(true);   -- сколько КП закрылось бы сегодня
--   select calc_id, meta->>'label', created_at from invoice_events
--    where event = 'lost' and meta->>'auto' = 'true' order by created_at desc limit 20;
-- ─────────────────────────────────────────────────────────────────────────
