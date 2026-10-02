-- Письма тем, кто заходит, но не считает.
--
-- Раз в сутки база проходит по живым учёткам и пишет трём группам:
--   day3  — зарегистрировался 3+ дня назад, смет нет (и не прошло 14 дней):
--           «Первая смета за пару минут»;
--   day14 — смет нет, зарегистрирован 14+ дней назад, заходил за последние 14 дней:
--           «Что не получилось?»;
--   day45 — смета была, последняя 45+ дней назад, но заходил за последние 14 дней:
--           «Давно не видели смет от вас».
-- Каждый шаг уходит человеку один раз (day45 — заново, если он успел сделать новую
-- смету и снова замолчал). Не чаще одного письма в 7 дней на человека. Тексты
-- утверждены владельцем 02.10.2026. Канал: сообщение в кабинет + письмо; пуша нет —
-- в Vault нет ключа service_role_key, а событию нужна выкладка Edge Function.
--
-- Кого не трогаем: администраторов, наблюдателей, менеджеров, действующий тариф
-- Профи, замороженных. С «Напоминаниями неактивным» не пересекается: те касаются
-- молчащих 20+ дней, здесь — заходивших за последние 14.
--
-- НАСТРОЙКИ в app_settings, ключ onboarding_nudges:
--   {"enabled": false, "day3": 3, "day14": 14, "day45": 45}
-- По умолчанию рассылка ВЫКЛЮЧЕНА. Включает администратор переключателем на вкладке
-- «Напоминания». Перед включением: select public.process_onboarding_nudges(true);
-- — пробный прогон, ничего не отправляет и не пишет, возвращает список адресатов.
--
-- Выполнить в Supabase SQL Editor целиком.

create table if not exists public.onboarding_nudges (
    user_id  uuid not null references public.users(id) on delete cascade,
    step     text not null,                 -- day3 | day14 | day45
    sent_at  timestamptz not null default now(),
    for_at   timestamptz,                   -- для day45: дата последней сметы, из-за которой ушло письмо
    primary key (user_id, step)
);
alter table public.onboarding_nudges enable row level security;

insert into public.app_settings (key, value)
values ('onboarding_nudges', '{"enabled": false, "day3": 3, "day14": 14, "day45": 45}'::jsonb)
on conflict (key) do nothing;

create or replace function public.process_onboarding_nudges(dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    d3 int := 3;
    d14 int := 14;
    d45 int := 45;
    cfg jsonb;
    on_flag boolean := false;
    sender uuid;
    u record;
    nm text;
    subj text;
    body text;
    n3 int := 0;
    n14 int := 0;
    n45 int := 0;
    would jsonb := '[]'::jsonb;
begin
    select value into cfg from public.app_settings where key = 'onboarding_nudges';
    if cfg is not null then
        begin
            on_flag := coalesce((cfg->>'enabled')::boolean, false);
            d3  := greatest(coalesce((cfg->>'day3')::int, d3), 1);
            d14 := greatest(coalesce((cfg->>'day14')::int, d14), d3 + 1);
            d45 := greatest(coalesce((cfg->>'day45')::int, d45), 1);
        exception when others then
            on_flag := false;
        end;
    end if;

    -- Выключено — ничего не делаем. Пробный прогон выключателя не спрашивает.
    if not on_flag and not dry_run then
        return jsonb_build_object('enabled', false);
    end if;

    select id into sender from public.users
     where lower(btrim(email)) = 'dima24ba@gmail.com' limit 1;
    if sender is null then
        select id into sender from public.users
         where account_type = 'admin' order by created_at limit 1;
    end if;

    for u in
        select * from (
            select b.*,
                   case
                     when b.est_total = 0 and b.created_at <= now() - make_interval(days => d3)
                          and b.created_at > now() - make_interval(days => d14)
                          then 'day3'
                     when b.est_total = 0 and b.created_at <= now() - make_interval(days => d14)
                          and b.last_visited > now() - interval '14 days'
                          then 'day14'
                     when b.est_total > 0 and b.est_last <= now() - make_interval(days => d45)
                          and b.last_visited > now() - interval '14 days'
                          then 'day45'
                   end as step
              from (
                select us.id, us.email, us.username, us.first_name, us.created_at, us.last_visited,
                       (select count(*) from public.estimates e where e.user_id = us.id) as est_total,
                       (select max(e.created_at) from public.estimates e where e.user_id = us.id) as est_last
                  from public.users us
                 where us.frozen_at is null
                   and us.account_type not in ('admin', 'viewer', 'manager', 'pro')
                   and us.email is not null and btrim(us.email) <> ''
              ) b
        ) s
         where s.step is not null
           -- Этот шаг этому человеку уже уходил (day45 — по той же последней смете).
           and not exists (
                select 1 from public.onboarding_nudges n
                 where n.user_id = s.id and n.step = s.step
                   and (s.step <> 'day45' or n.for_at is not distinct from s.est_last))
           -- Не чаще одного письма в неделю.
           and not exists (
                select 1 from public.onboarding_nudges n
                 where n.user_id = s.id and n.sent_at > now() - interval '7 days')
    loop
        nm := coalesce(nullif(btrim(u.first_name), ''), nullif(btrim(u.username), ''), 'Коллега');

        if u.step = 'day3' then
            subj := 'Первая смета в HeatCalc.ru — за пару минут';
            body := format(
E'%s, вы зарегистрировались в калькуляторе HeatCalc.ru, но пока не сохранили ни одной сметы.

Самый короткий путь: откройте heatcalc.ru, укажите город, площадь дома и тип котла — калькулятор сам соберёт оборудование и работы. Сметой можно сразу поделиться с заказчиком ссылкой или выгрузить в PDF.

Если что-то непонятно, просто ответьте на это письмо — подскажем.

Администрация HeatCalc.ru', nm);
            n3 := n3 + 1;
        elsif u.step = 'day14' then
            subj := 'Что не получилось в HeatCalc.ru?';
            body := format(
E'%s, вы заходили в калькулятор, но смету так и не сохранили. Нам важно понять почему.

Может, не хватило какой-то позиции в каталоге, непонятен какой-то шаг или сайт не подошёл под вашу задачу. Напишите одной строкой, что мешает, на kovdor24@yandex.ru или в MAX: +7 982 610-95-48. Ответим в тот же день и, если нужно, поправим калькулятор.

Администрация HeatCalc.ru', nm);
            n14 := n14 + 1;
        else
            subj := 'Давно не видели смет от вас';
            body := format(
E'%s, вы считали у нас раньше, а последние полтора месяца новых смет нет, хотя на сайт вы заходите.

Расскажите, чего не хватает: оборудования, нужного расчёта, удобства? Ответьте на это письмо, напишите на kovdor24@yandex.ru или в MAX: +7 982 610-95-48. Мы читаем каждое сообщение и часто доделываем то, о чём просят монтажники.

Администрация HeatCalc.ru', nm);
            n45 := n45 + 1;
        end if;

        if dry_run then
            would := would || jsonb_build_object('step', u.step, 'name', nm, 'email', u.email,
                                                  'registered', u.created_at::date, 'last_visit', u.last_visited::date);
        else
            insert into public.onboarding_nudges (user_id, step, sent_at, for_at)
            values (u.id, u.step, now(), case when u.step = 'day45' then u.est_last end)
            on conflict (user_id, step) do update
                set sent_at = now(), for_at = excluded.for_at;

            if sender is not null then
                insert into public.messages (sender_id, recipient_id, text, type)
                values (sender, u.id, body, 'private');
            end if;
            perform public.inactivity_send_email(u.email, subj, body);
        end if;
    end loop;

    return jsonb_build_object('enabled', on_flag, 'dry_run', dry_run,
                              'day3', n3, 'day14', n14, 'day45', n45, 'recipients', would);
end;
$$;

revoke all on function public.process_onboarding_nudges(boolean) from public, anon, authenticated;

-- Расписание: каждый день в 07:00 UTC (10:00 по Москве). При выключенном флаге
-- функция ничего не делает.
do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        if exists (select 1 from cron.job where jobname = 'process_onboarding_nudges') then
            perform cron.unschedule('process_onboarding_nudges');
        end if;
        perform cron.schedule('process_onboarding_nudges', '0 7 * * *',
                              'select public.process_onboarding_nudges();');
    else
        raise notice 'pg_cron не установлен — расписание не создано.';
    end if;
end $$;

-- Пробный прогон:  select public.process_onboarding_nudges(true);
-- Отключить расписание совсем:  select cron.unschedule('process_onboarding_nudges');
