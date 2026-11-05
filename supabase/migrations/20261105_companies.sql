-- Компании: явное объединение филиалов (карточек дистрибьюторов) под одной компанией.
--
-- До этого компанию в разделе «Филиалы» угадывали по названию карточки (всё, что до
-- «ОП», «филиал», «отделение»…). «КИТ-Сервис (Сергей)» и «КИТ-Сервис (Евгений)» такого
-- слова не содержат, поэтому оставались двумя компаниями, и общей статистики у них не было.
--
-- Теперь у карточки есть необязательное поле company_id. Если оно задано, карточка
-- входит в эту компанию, а название не разбирается. Если пусто — работает прежняя
-- группировка по названию, поэтому ничего не ломается и старые карточки трогать не надо.
--
-- Общий наблюдатель: отдельной колонки не нужно. Наблюдателю по-прежнему назначаются
-- филиалы (users.viewer_distributor_ids), а в карточке пользователя галочка «вся компания»
-- отмечает их все разом; новый филиал, добавленный в компанию, подхватывается
-- автоматически (это делает админка при переносе филиала).
--
-- Выполнить вручную в Supabase SQL Editor. Повторный запуск безопасен.

create table if not exists public.companies (
    id         uuid primary key default gen_random_uuid(),
    name       text not null,
    created_at timestamptz not null default now()
);

-- Название компании уникально без учёта регистра и пробелов по краям
create unique index if not exists companies_name_lower_uq
    on public.companies (lower(btrim(name)));

alter table public.companies enable row level security;

-- Читать список компаний может любой вошедший (нужен подписям и фильтрам),
-- менять — только администратор.
drop policy if exists companies_read on public.companies;
create policy companies_read on public.companies
    for select to authenticated using (true);

drop policy if exists companies_admin_write on public.companies;
create policy companies_admin_write on public.companies
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

alter table public.distributors
    add column if not exists company_id uuid references public.companies(id) on delete set null;

create index if not exists distributors_company_id_idx
    on public.distributors (company_id);
