-- Экономия «Бюджетнее» по последней смете каждого пользователя — для текста предложения «Профи».
--
-- ЗАЧЕМ. Предложение в «Сообщения» говорит клиенту, насколько его смета могла бы стоить дешевле
-- с тарифом «Профи». Цифру считает bench/cheaper_offer.js (тем же движком, что программа) и
-- пишет сюда. Публичный сайт эти данные не видит: читать может только администратор.
--
-- ЧТО ХРАНИТСЯ. По одной строке на пользователя: сумма его последней сметы в STOUT, сумма в режиме
-- «Бюджетнее», экономия в рублях и процентах, и когда посчитано. Поля с персональными данными нет.
--
-- Выполнить в Supabase SQL Editor целиком (или apply_migration).

create table if not exists public.offer_savings (
    user_id      uuid primary key references public.users(id) on delete cascade,
    estimate_id  uuid references public.estimates(id) on delete set null,
    base_sum     numeric not null,
    cheap_sum    numeric not null,
    save_rub     numeric not null,
    save_pct     numeric not null,
    computed_at  timestamptz not null default now()
);

comment on table public.offer_savings is 'Экономия «Бюджетнее» по последней смете пользователя (для предложения Профи). Читает только администратор.';

alter table public.offer_savings enable row level security;

drop policy if exists offer_savings_admin_select on public.offer_savings;
create policy offer_savings_admin_select on public.offer_savings
    for select to authenticated
    using (public.is_admin());

drop policy if exists offer_savings_admin_write on public.offer_savings;
create policy offer_savings_admin_write on public.offer_savings
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());
