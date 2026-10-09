-- Бюджет писем EmailJS: журнал, расход, прогноз, ступенчатое автоотключение.
--
-- Зачем. У аккаунта EmailJS 200 писем в месяц (цикл с 8-го числа), разбивки по типам писем
-- там нет, и лимит выедается незаметно. Здесь каждое письмо пишется в журнал, админка
-- показывает расход по типам и прогноз на цикл, а необязательные рассылки по ступеням
-- отключаются сами, когда нагрузка растёт (см. mail_budget_state).
--
-- Что включает. Настройки лежат в app_settings, ключ mail_budget (создаётся ниже):
--   limit        — лимит писем в цикле (200)
--   cycle_day    — день начала цикла (8)
--   mode         — 'auto' | 'manual'. В 'manual' автоотключения нет, работают только ручные отметки
--   tiers        — пороги ступеней, % нагрузки: t1 (напоминания новичкам, прочее) 80,
--                  t2 (неактивные, личные сообщения, вопросы без ответа, обратная связь) 90,
--                  t3 (статусы смет, тариф Профи) 95
--   overrides    — ручные отметки по типу письма: { "nudge": "off", "status": "on" }; главнее авто
--   adjust       — поправка к счётчику (письма, которые журнал не видит: Edge Function и т. п.);
--   adjust_cycle — дата начала цикла, для которого поправка записана; в следующем цикле она не действует
-- Коды регистрации и запросы счёта ('code', 'invoice') не отключаются никогда.
--
-- Нагрузка = max(доля израсходованного, прогноз на конец цикла). Прогноз считается со
-- 5-го дня цикла: раньше он слишком шумный (одна волна регистраций даёт «300 %»).
--
-- Выполнить в Supabase SQL Editor целиком.

create table if not exists public.mail_log (
    id         bigserial primary key,
    created_at timestamptz not null default now(),
    kind       text not null,
    template   text,
    subject    text,
    ok         boolean not null default true,   -- false = письмо отключено политикой или не ушло
    skipped    boolean not null default false,  -- true = не отправляли из-за выключателя
    source     text                             -- browser | db | edge
);
create index if not exists mail_log_created_idx on public.mail_log (created_at desc);
create index if not exists mail_log_kind_idx on public.mail_log (kind, created_at desc);
alter table public.mail_log enable row level security;   -- политик нет: читают и пишут только функции ниже

insert into public.app_settings (key, value)
values ('mail_budget', '{"limit": 200, "cycle_day": 8, "mode": "auto",
                          "tiers": {"t1": 80, "t2": 90, "t3": 95},
                          "overrides": {}, "adjust": 0}'::jsonb)
on conflict (key) do nothing;

-- Тип письма по теме. Один список на базу и браузер (в app.js зеркало — mailKindOf).
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
          or subj ilike 'Доступ к HeatCalc.ru приостановлен%'     then 'inactivity'
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

-- Ступень типа: 0 — защищён, 1..3 — отключается по порогу t1..t3.
create or replace function public.mail_tier_of(k text)
returns int
language sql
immutable
as $$
    select case k
        when 'code' then 0
        when 'invoice' then 0
        when 'nudge' then 1
        when 'other' then 1
        when 'inactivity' then 2
        when 'message' then 2
        when 'stale' then 2
        when 'feedback' then 2
        when 'status' then 3
        when 'tariff' then 3
        else 1
    end;
$$;

-- Начало текущего цикла EmailJS (UTC).
create or replace function public.mail_cycle_start(cycle_day int default 8)
returns timestamptz
language sql
stable
as $$
    select case
        when extract(day from (now() at time zone 'utc')) >= cycle_day
            then date_trunc('month', now() at time zone 'utc') + make_interval(days => cycle_day - 1)
        else date_trunc('month', now() at time zone 'utc') - interval '1 month' + make_interval(days => cycle_day - 1)
    end at time zone 'utc';
$$;

-- Расход, прогноз, состояние ступеней и типов. Читает админ (проверка внутри), а
-- mail_allowed ниже зовёт её без проверки роли — отсюда внутренняя версия.
create or replace function public.mail_budget_calc()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    cfg        jsonb;
    lim        int;
    cday       int;
    mode       text;
    t1 int; t2 int; t3 int;
    adj        int;
    ovr        jsonb;
    cstart     timestamptz;
    cend       timestamptz;
    cyc_days   numeric;
    elapsed    numeric;
    used_log   int;
    used       int;
    pct        numeric;
    forecast   numeric;
    fpct       numeric;
    load_pct   numeric;
    log_age    numeric;
    kinds      jsonb := '[]'::jsonb;
    k          record;
    tier       int;
    thr        int;
    auto_off   boolean;
    ov         text;
    eff_off    boolean;
    rate       numeric;
    est30      numeric;
    cnt30      int;
    cnt_cycle  int;
begin
    select value into cfg from public.app_settings where key = 'mail_budget';
    cfg := coalesce(cfg, '{}'::jsonb);
    lim  := greatest(coalesce((cfg->>'limit')::int, 200), 1);
    cday := least(greatest(coalesce((cfg->>'cycle_day')::int, 8), 1), 28);
    mode := case when cfg->>'mode' = 'manual' then 'manual' else 'auto' end;
    t1 := coalesce((cfg->'tiers'->>'t1')::int, 80);
    t2 := coalesce((cfg->'tiers'->>'t2')::int, 90);
    t3 := coalesce((cfg->'tiers'->>'t3')::int, 95);
    ovr := coalesce(cfg->'overrides', '{}'::jsonb);

    cstart := public.mail_cycle_start(cday);
    -- Поправка действует только в том цикле, для которого записана (adjust_cycle = дата начала цикла):
    -- с новым циклом счётчик сам начинается с нуля.
    adj := case when cfg->>'adjust_cycle' = (cstart at time zone 'utc')::date::text
                then coalesce((cfg->>'adjust')::int, 0) else 0 end;
    cend   := cstart + interval '1 month';
    cyc_days := greatest(extract(epoch from (cend - cstart)) / 86400.0, 1);
    elapsed  := greatest(extract(epoch from (now() - cstart)) / 86400.0, 0.5);

    select count(*) into used_log from public.mail_log
     where created_at >= cstart and not skipped;
    used := used_log + adj;
    pct := used * 100.0 / lim;

    -- Прогноз только со 5-го дня цикла.
    if elapsed >= 5 then
        forecast := used * cyc_days / elapsed;
    else
        forecast := used;
    end if;
    fpct := forecast * 100.0 / lim;
    load_pct := greatest(pct, fpct);

    select extract(epoch from (now() - min(created_at))) / 86400.0 into log_age from public.mail_log;
    log_age := coalesce(log_age, 0);

    for k in
        select unnest(array['code','invoice','status','tariff','message','stale','feedback','inactivity','nudge','other']) as kind
    loop
        tier := public.mail_tier_of(k.kind);
        thr := case tier when 1 then t1 when 2 then t2 when 3 then t3 else null end;
        auto_off := (mode = 'auto' and tier > 0 and load_pct >= thr);
        ov := ovr->>k.kind;
        -- Защищённые типы не отключаются даже ручной отметкой «выкл.»
        eff_off := case
            when tier = 0 then false
            when ov = 'off' then true
            when ov = 'on' then false
            else auto_off
        end;

        select count(*) filter (where not skipped) into cnt_cycle
          from public.mail_log where kind = k.kind and created_at >= cstart;
        select count(*) filter (where not skipped) into cnt30
          from public.mail_log where kind = k.kind and created_at >= now() - interval '30 days';

        -- Темп в сутки: по журналу, если он накопил хотя бы 3 дня; иначе оценка по таблицам
        -- истории (журнала писем раньше не было). Для остальных типов оценки нет.
        est30 := case k.kind
            when 'code' then (select count(*) from auth.users where created_at >= now() - interval '30 days')
            when 'inactivity' then (select count(*) from public.inactivity_notices where warned_at >= now() - interval '30 days')
                                  + (select count(*) from public.inactivity_notices where frozen_at >= now() - interval '30 days')
            when 'nudge' then (select count(*) from public.onboarding_nudges where sent_at >= now() - interval '30 days')
            else null end;
        if log_age >= 3 then
            rate := cnt30 / least(log_age, 30);
        elsif est30 is not null then
            rate := est30 / 30.0;
        else
            rate := null;
        end if;

        kinds := kinds || jsonb_build_object(
            'kind', k.kind,
            'tier', tier,
            'threshold', thr,
            'used', cnt_cycle,
            'rate_per_day', rate,
            'per_cycle', case when rate is null then null else round(rate * cyc_days) end,
            'override', ov,
            'auto_off', auto_off,
            'off', eff_off,
            'estimated', (log_age < 3 and est30 is not null)
        );
    end loop;

    return jsonb_build_object(
        'limit', lim,
        'used', used,
        'used_log', used_log,
        'adjust', adj,
        'pct', round(pct, 1),
        'forecast', round(forecast),
        'forecast_pct', round(fpct, 1),
        'load_pct', round(load_pct, 1),
        'cycle_start', cstart,
        'cycle_end', cend,
        'days_left', round(extract(epoch from (cend - now())) / 86400.0, 1),
        'elapsed_days', round(elapsed, 1),
        'mode', mode,
        'tiers', jsonb_build_object('t1', t1, 't2', t2, 't3', t3),
        'cycle_day', cday,
        'log_age_days', round(log_age, 1),
        'kinds', kinds
    );
end;
$$;
revoke all on function public.mail_budget_calc() from public, anon, authenticated;

-- Для админки: то же самое, но с проверкой роли.
create or replace function public.mail_budget_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not exists (select 1 from public.users u
                    where u.auth_user_id = auth.uid()
                      and u.account_type in ('admin', 'viewer')) then
        raise exception 'mail_budget_state: только для администратора';
    end if;
    return public.mail_budget_calc();
end;
$$;
grant execute on function public.mail_budget_state() to authenticated;

-- Можно ли сейчас слать письмо такого типа. Зовёт и браузер (перед необязательной
-- рассылкой), и функции базы. Ошибка расчёта = разрешаем: лучше лишнее письмо, чем
-- потерянный код регистрации.
create or replace function public.mail_allowed(k text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    st jsonb;
    e  jsonb;
begin
    if public.mail_tier_of(k) = 0 then return true; end if;
    begin
        st := public.mail_budget_calc();
        select x into e from jsonb_array_elements(st->'kinds') x where x->>'kind' = k limit 1;
        if e is null then return true; end if;
        return not coalesce((e->>'off')::boolean, false);
    exception when others then
        return true;
    end;
end;
$$;
grant execute on function public.mail_allowed(text) to anon, authenticated;

-- Запись в журнал. Открыта и анониму: код регистрации уходит до входа. Ограничитель от
-- накрутки: не больше 40 записей в минуту на всю базу; тип — только из списка.
create or replace function public.mail_log_add(k text, tpl text, subj text, was_ok boolean default true, was_skipped boolean default false, src text default 'browser')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if k is null or k not in ('code','invoice','status','tariff','message','stale','feedback','inactivity','nudge','other') then
        k := 'other';
    end if;
    if (select count(*) from public.mail_log where created_at > now() - interval '1 minute') >= 40 then
        return;
    end if;
    insert into public.mail_log (kind, template, subject, ok, skipped, source)
    values (k, left(tpl, 40), left(regexp_replace(coalesce(subj, ''), '[\r\n\t]+', ' ', 'g'), 120),
            was_ok, was_skipped, left(src, 10));
end;
$$;
grant execute on function public.mail_log_add(text, text, text, boolean, boolean, text) to anon, authenticated;

-- Последние письма для вкладки админки.
create or replace function public.mail_log_recent(n int default 100)
returns table (created_at timestamptz, kind text, template text, subject text, ok boolean, skipped boolean, source text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not exists (select 1 from public.users u
                    where u.auth_user_id = auth.uid()
                      and u.account_type in ('admin', 'viewer')) then
        raise exception 'mail_log_recent: только для администратора';
    end if;
    return query
        select l.created_at, l.kind, l.template, l.subject, l.ok, l.skipped, l.source
          from public.mail_log l order by l.created_at desc limit least(greatest(n, 1), 500);
end;
$$;
grant execute on function public.mail_log_recent(int) to authenticated;

-- Письма, которые уходят из базы (неактивные, напоминания новичкам): тип по теме,
-- проверка выключателя и запись в журнал. Тело отправки прежнее.
create or replace function public.inactivity_send_email(to_email text, subj text, body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    priv text;
    k    text := public.mail_kind_of(subj);
begin
    if to_email is null or btrim(to_email) = '' then return; end if;

    if not public.mail_allowed(k) then
        insert into public.mail_log (kind, template, subject, ok, skipped, source)
        values (k, 'template_ysuxfio', left(subj, 120), false, true, 'db');
        return;
    end if;

    if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;

    begin
        select decrypted_secret into priv
          from vault.decrypted_secrets where name = 'emailjs_private_key' limit 1;
    exception when others then
        priv := null;
    end;
    if priv is null or btrim(priv) = '' then
        raise notice 'inactivity_send_email: в Vault нет emailjs_private_key — письмо не отправлено';
        return;
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
end;
$$;

revoke all on function public.inactivity_send_email(text, text, text) from public, anon, authenticated;
