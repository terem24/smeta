-- Визиты: своя замена основных отчётов Яндекс Метрики, которая не зависит от неё.
--
-- first_visits (миграция 20261101) хранит только первый заход браузера. Для отчётов
-- «как в Метрике» этого мало: нужны визиты (сессии), вернувшиеся посетители, время на
-- сайте, отказы, устройства. Поэтому каждый визит — отдельная строка в visits:
--   * визит начинается при открытии калькулятора в новой вкладке/сеансе браузера;
--   * длительность дописывается, когда вкладку сворачивают или закрывают (end_visit);
--   * отказ — визит короче 15 секунд (считается в админке, не здесь).
-- Персональных данных нет: анонимный UUID браузера, путь страницы, сайт-источник без
-- пути, метки кампании, тип устройства, ОС и браузер (по строке User-Agent, без версий).
--
-- Приложение работает и без этой миграции: при ошибке вызова log_visit оно пишет
-- только первый заход, как раньше.
--
-- Выполнить вручную в Supabase SQL Editor, весь файл целиком за один раз.

-- Устройство первого захода — в first_visits, чтобы отчёт по новым посетителям
-- не искал его по визитам
alter table public.first_visits add column if not exists device text;
alter table public.first_visits add column if not exists os text;
alter table public.first_visits add column if not exists browser text;

create table if not exists public.visits (
    id bigint generated always as identity primary key,
    visitor_id text not null check (char_length(visitor_id) between 8 and 64),
    created_at timestamptz not null default now(),
    -- последний сигнал от вкладки и сколько секунд она была на экране
    ended_at timestamptz,
    seconds int not null default 0,
    is_new boolean not null default false,
    landing text,
    referrer text,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    device text,
    os text,
    browser text
);

create index if not exists visits_created_idx on public.visits (created_at desc);
create index if not exists visits_visitor_idx on public.visits (visitor_id);

alter table public.visits enable row level security;

drop policy if exists visits_admin_read on public.visits;
create policy visits_admin_read on public.visits
    for select using (public.is_admin());

-- Начало визита. Возвращает id визита: им браузер потом дописывает длительность.
-- Первый визит браузера заодно создаёт строку first_visits (первое касание не
-- затирается: on conflict do nothing).
create or replace function public.log_visit(
    p_visitor text,
    p_landing text,
    p_referrer text,
    p_source text,
    p_medium text,
    p_campaign text,
    p_label text,
    p_device text,
    p_os text,
    p_browser text
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_new boolean;
    v_id bigint;
begin
    if p_visitor is null or char_length(p_visitor) not between 8 and 64 then
        return null;
    end if;

    insert into public.first_visits (visitor_id, landing, referrer, utm_source, utm_medium, utm_campaign, label, device, os, browser)
    values (p_visitor, left(p_landing, 120), left(p_referrer, 80), left(p_source, 60), left(p_medium, 60),
            left(p_campaign, 80), left(p_label, 300), left(p_device, 20), left(p_os, 30), left(p_browser, 30))
    on conflict (visitor_id) do nothing;
    v_new := found;

    -- строка first_visits могла появиться раньше старой версией приложения — без устройства
    if not v_new then
        update public.first_visits
           set device = coalesce(device, left(p_device, 20)),
               os = coalesce(os, left(p_os, 30)),
               browser = coalesce(browser, left(p_browser, 30))
         where visitor_id = p_visitor and device is null;
    end if;

    insert into public.visits (visitor_id, is_new, landing, referrer, utm_source, utm_medium, utm_campaign, device, os, browser)
    values (p_visitor, v_new, left(p_landing, 120), left(p_referrer, 80), left(p_source, 60), left(p_medium, 60),
            left(p_campaign, 80), left(p_device, 20), left(p_os, 30), left(p_browser, 30))
    returning id into v_id;
    return v_id;
end;
$$;

grant execute on function public.log_visit(text, text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- Длительность визита: сколько секунд вкладка была на экране. Вызывается при каждом
-- сворачивании и закрытии; значение только растёт и не больше 6 часов. Чужой визит
-- (другой visitor_id) не меняется.
create or replace function public.end_visit(p_id bigint, p_visitor text, p_seconds int)
returns void
language sql
security definer
set search_path = public
as $$
    update public.visits
       set seconds = greatest(seconds, least(coalesce(p_seconds, 0), 21600)),
           ended_at = now()
     where id = p_id and visitor_id = p_visitor
       and created_at > now() - interval '12 hours';
$$;

grant execute on function public.end_visit(bigint, text, int) to anon, authenticated;

-- attach_first_touch без входа не нужен: по умолчанию функции доступны всем (PUBLIC)
revoke execute on function public.attach_first_touch(text) from public, anon;
grant execute on function public.attach_first_touch(text) to authenticated;
