-- Журнал загрузок прайса дистрибьютора из админки.
--
-- Сам прайс лежит на Beget (dist_price_save.php → dist_prices_data/<ключ>.json), а не
-- в базе: его качает каждый монтажник, и на бесплатном Supabase это съело бы лимит
-- исходящего трафика. Здесь — только одна короткая строка за загрузку: кто, когда,
-- на какую дату прайс и сколько позиций добавилось, поменялось и пропало.
--
-- Строку пишет сам dist_price_save.php под токеном загрузившего: функция
-- dist_price_upload_log проверяет то же право, что и правки (dist_price_can_edit),
-- и берёт автора из токена, а не из параметров.
-- Читают журнал те, кто видит правки этого прайса (dist_price_can_view): владелец,
-- администратор, наблюдатель и менеджер своей компании.
--
-- Нужна миграция 20261005_distributor_price_overrides.sql (функции can_edit/can_view).
-- Выполнить вручную в Supabase SQL Editor, весь файл целиком, за один раз.

create table if not exists public.distributor_price_uploads (
    id             bigserial primary key,
    price_list_key text        not null,
    price_date     date        not null,          -- дата прайса из файла
    items_count    integer     not null,          -- позиций в прайсе после загрузки
    added          integer     not null default 0,
    changed        integer     not null default 0,
    removed        integer     not null default 0,
    files          integer     not null default 1, -- сколько Excel-файлов загружено за раз
    mode           text        not null default 'merge' check (mode in ('merge', 'replace')),
    uploaded_by    text,
    uploaded_at    timestamptz not null default now()
);

create index if not exists dpu_key_idx on public.distributor_price_uploads (price_list_key, uploaded_at desc);

alter table public.distributor_price_uploads enable row level security;

drop policy if exists dpu_view on public.distributor_price_uploads;
create policy dpu_view on public.distributor_price_uploads
    for select using (public.dist_price_can_view(price_list_key));

grant select on public.distributor_price_uploads to authenticated;
revoke insert, update, delete on public.distributor_price_uploads from anon, authenticated;
revoke select on public.distributor_price_uploads from anon;

create or replace function public.dist_price_upload_log(
    p_key        text,
    p_price_date date,
    p_items      integer,
    p_added      integer default 0,
    p_changed    integer default 0,
    p_removed    integer default 0,
    p_files      integer default 1,
    p_mode       text    default 'merge'
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.dist_price_can_edit(p_key) then
        raise exception 'Нет права менять этот прайс-лист';
    end if;
    insert into public.distributor_price_uploads
        (price_list_key, price_date, items_count, added, changed, removed, files, mode, uploaded_by)
    values
        (p_key, p_price_date, greatest(p_items, 0), greatest(p_added, 0), greatest(p_changed, 0),
         greatest(p_removed, 0), greatest(p_files, 1),
         case when p_mode = 'replace' then 'replace' else 'merge' end,
         lower(coalesce(auth.jwt() ->> 'email', '')));
end;
$$;

revoke all on function public.dist_price_upload_log(text, date, integer, integer, integer, integer, integer, text) from public;
grant execute on function public.dist_price_upload_log(text, date, integer, integer, integer, integer, integer, text) to authenticated;
