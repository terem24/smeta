-- География визитов: город, регион и страна по IP.
--
-- Сам IP в базу не пишется. Браузер один раз в сутки спрашивает геосервис (ipapi.co,
-- запасной ipinfo.io — те же, что при входе), получает примерные координаты и
-- сопоставляет их с ближайшим городом справочника cities_geo.js — так город и регион
-- приходят по-русски. Координаты округляются до 0,1° (около 10 км): для карты этого
-- хватает, а точный адрес по ним не восстановить.
--
-- Выполнить в Supabase SQL Editor целиком, после 20261102_add_visits.sql.

alter table public.visits add column if not exists city text;
alter table public.visits add column if not exists region text;
alter table public.visits add column if not exists country text;
alter table public.visits add column if not exists lat numeric(4, 1);
alter table public.visits add column if not exists lon numeric(4, 1);

alter table public.first_visits add column if not exists city text;
alter table public.first_visits add column if not exists region text;
alter table public.first_visits add column if not exists country text;
alter table public.first_visits add column if not exists lat numeric(4, 1);
alter table public.first_visits add column if not exists lon numeric(4, 1);

-- Геоданные дописываются к уже начатому визиту (геосервис отвечает не сразу) и к
-- первому заходу, если там их ещё нет. Чужой визит и старый визит не трогаются.
create or replace function public.set_visit_geo(
    p_id bigint,
    p_visitor text,
    p_city text,
    p_region text,
    p_country text,
    p_lat numeric,
    p_lon numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_lat numeric := case when p_lat between -90 and 90 then round(p_lat, 1) end;
    v_lon numeric := case when p_lon between -180 and 180 then round(p_lon, 1) end;
begin
    if p_visitor is null then
        return;
    end if;
    update public.visits
       set city = left(p_city, 60), region = left(p_region, 80), country = left(p_country, 60), lat = v_lat, lon = v_lon
     where id = p_id and visitor_id = p_visitor and city is null
       and created_at > now() - interval '12 hours';
    update public.first_visits
       set city = left(p_city, 60), region = left(p_region, 80), country = left(p_country, 60), lat = v_lat, lon = v_lon
     where visitor_id = p_visitor and city is null;
end;
$$;

grant execute on function public.set_visit_geo(bigint, text, text, text, text, numeric, numeric) to anon, authenticated;
