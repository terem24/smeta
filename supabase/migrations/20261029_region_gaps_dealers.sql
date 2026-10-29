-- Регионы без дистрибьютора: список дистрибьюторов со страницы «Где купить» stout
-- и журнал обращений к ним.
--
-- ЗАЧЕМ. Монтажники регистрируются из регионов, где ни один дистрибьютор не подключён
-- к калькулятору. Админ видит такие «дыры» на вкладке «Регионы без дистрибьютора»,
-- берёт из этого списка подходящих дистрибьюторов и записывает, кому и когда написал.
--
-- КТО ПИШЕТ И ЧИТАЕТ. Только администратор (is_admin). Монтажники и гости таблиц не видят.
-- Выполнить вручную в Supabase SQL Editor.
--
-- Что смотреть:
--   select region_key, count(*) from public.region_outreach group by 1 order by 2 desc;

-- Дистрибьюторы из списка «Где купить». Это не подключённые пока компании: как только
-- компания заводится в «Дистрибьюторах» с тем же названием, вкладка помечает её как
-- подключённую и перестаёт предлагать.
create table if not exists public.stout_dealers (
    id           bigserial primary key,
    company_name text not null,
    regions      text[] not null default '{}',
    city         text,
    phone        text,
    email        text,
    site         text,
    created_at   timestamptz not null default now()
);

alter table public.stout_dealers enable row level security;

drop policy if exists stout_dealers_admin_all on public.stout_dealers;
create policy stout_dealers_admin_all on public.stout_dealers
    for all using (public.is_admin()) with check (public.is_admin());

-- Журнал обращений: какой регион, какая компания, каким способом и когда.
-- region_key — регион в приведённом виде (как его сравнивает калькулятор), чтобы
-- «Московская обл.» и «Московская область» попадали в одну строку.
create table if not exists public.region_outreach (
    id          bigserial primary key,
    region_key  text not null,
    region      text not null,
    dealer_id   bigint references public.stout_dealers(id) on delete set null,
    dealer_name text not null,
    channel     text not null check (channel in ('email', 'messenger', 'call', 'other')),
    created_by  text default (auth.jwt() ->> 'email'),
    created_at  timestamptz not null default now()
);

create index if not exists region_outreach_region_idx on public.region_outreach (region_key, created_at desc);

alter table public.region_outreach enable row level security;

drop policy if exists region_outreach_admin_all on public.region_outreach;
create policy region_outreach_admin_all on public.region_outreach
    for all using (public.is_admin()) with check (public.is_admin());
