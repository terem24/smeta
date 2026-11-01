-- Карта кликов: где щёлкают посетители калькулятора.
--
-- Что пишется про щелчок: экран (режим калькулятора или открытое окно), путь к элементу
-- в разметке (селектор, без текста), точка щелчка внутри элемента (доли 0..1) и на
-- странице, размер окна и тип устройства. Текст элементов, введённые значения, имена —
-- нет. Признаки «мёртвый» (щёлкнули по тому, что не нажимается) и «яростный» (три и
-- больше щелчков подряд в одно место) считает браузер.
--
-- Нагрузка: браузер копит щелчки и шлёт пачкой (до 60 за раз) при сворачивании
-- вкладки или раз в минуту — 1–2 запроса на визит. Строки старше 90 дней удаляются
-- сами при записи (изредка, чтобы не нагружать каждую вставку).
--
-- Выполнить в Supabase SQL Editor целиком, после 20261102_add_visits.sql.

create table if not exists public.clicks (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    visitor_id text not null check (char_length(visitor_id) between 8 and 64),
    visit_id bigint,
    screen text not null,
    device text,
    vw smallint,
    vh smallint,
    sel text,
    tag text,
    rx real,
    ry real,
    px real,
    py integer,
    dead boolean not null default false,
    rage boolean not null default false
);

create index if not exists clicks_created_idx on public.clicks (created_at desc);
create index if not exists clicks_screen_idx on public.clicks (screen, created_at desc);

alter table public.clicks enable row level security;

drop policy if exists clicks_admin_read on public.clicks;
create policy clicks_admin_read on public.clicks
    for select using (public.is_admin());

create or replace function public.log_clicks(
    p_visitor text,
    p_visit bigint,
    p_device text,
    p_vw int,
    p_vh int,
    p_items jsonb
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
    n int;
begin
    if p_visitor is null or char_length(p_visitor) not between 8 and 64
       or p_items is null or jsonb_typeof(p_items) <> 'array' then
        return 0;
    end if;

    insert into public.clicks (visitor_id, visit_id, screen, device, vw, vh, sel, tag, rx, ry, px, py, dead, rage, created_at)
    select p_visitor, p_visit, left(coalesce(x->>'s', '?'), 60), left(p_device, 20),
           least(greatest(coalesce(p_vw, 0), 0), 10000), least(greatest(coalesce(p_vh, 0), 0), 10000),
           left(x->>'e', 240), left(x->>'t', 20),
           least(greatest((x->>'rx')::real, 0), 1), least(greatest((x->>'ry')::real, 0), 1),
           least(greatest((x->>'px')::real, 0), 100), least(greatest((x->>'py')::int, 0), 100000),
           coalesce((x->>'d')::boolean, false), coalesce((x->>'r')::boolean, false),
           -- время щелчка из браузера, но не из будущего и не старше суток
           least(now(), greatest(now() - interval '1 day', coalesce(to_timestamp((x->>'at')::double precision / 1000), now())))
      from jsonb_array_elements(p_items) with ordinality as e(x, i)
     where i <= 60 and jsonb_typeof(x) = 'object';
    get diagnostics n = row_count;

    if random() < 0.02 then
        delete from public.clicks where created_at < now() - interval '90 days';
    end if;
    return n;
end;
$$;

grant execute on function public.log_clicks(text, bigint, text, int, int, jsonb) to anon, authenticated;
