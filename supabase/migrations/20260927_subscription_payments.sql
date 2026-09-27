-- Заявки на оплату подписки Профи и подтверждённые оплаты.
-- Строку заводит кнопка «Я оплатил» в окне оплаты (любой посетитель),
-- статус, сумму и срок ставит владелец во вкладке «Оплата подписки».
-- Цены, ссылки, акции и региональные цены лежат не здесь, а в
-- app_settings под ключом subscription (таблица и политика уже есть).
create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text,
  user_id uuid,
  plan text,                 -- month | year | ключ другого тарифа
  months integer,
  rub numeric,               -- сумма к оплате на момент заявки
  promo text,                -- название акции, если применилась
  region text,               -- регион пользователя на момент заявки
  status text not null default 'requested',   -- requested | paid | rejected
  paid_at timestamptz,
  paid_rub numeric,          -- сколько реально пришло
  pro_until timestamptz,     -- до какой даты продлён Профи
  note text,
  confirmed_by text,
  source text not null default 'site' -- site | manual (записано владельцем руками)
);
comment on table public.subscription_payments is 'Заявки «Я оплатил» и подтверждённые оплаты подписки Профи. Вкладка «Оплата подписки» в панели управления.';
create index if not exists subscription_payments_created_idx on public.subscription_payments (created_at desc);
create index if not exists subscription_payments_email_idx on public.subscription_payments (lower(email));

alter table public.subscription_payments enable row level security;

-- Заявку может оставить кто угодно, в том числе гость без входа: почту он вписывает сам.
-- Записать можно только «заявку с сайта» — статус и сумму оплаты гость не проставит.
drop policy if exists subscription_payments_insert_any on public.subscription_payments;
create policy subscription_payments_insert_any on public.subscription_payments
  for insert to anon, authenticated with check (status = 'requested' and source = 'site');

-- Смотреть, подтверждать и править — только администратор
drop policy if exists subscription_payments_admin_all on public.subscription_payments;
create policy subscription_payments_admin_all on public.subscription_payments
  for all to authenticated using (is_admin()) with check (is_admin());
