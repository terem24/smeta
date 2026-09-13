-- Замены снятых позиций каталога: очередь «снято → чем заменить».
--
-- Как это работает целиком:
--   1. AutoPrice.py (парсер цен, 10-го и 20-го числа) у позиций, которые на
--      teremonline «Под заказ», читает вкладку «Похожие». Подходящего преемника
--      отправляет сюда функцией catalog_successor_propose — строка в статусе new.
--   2. Админ открывает раздел админки «Замены позиций», при необходимости правит
--      название для калькулятора и нажимает «Подтвердить» (approved) или
--      «Отклонить» (rejected).
--   3. AutoSuccessors.py (workflow apply-successors.yml, раз в сутки) забирает
--      подтверждённые строки функцией catalog_successors_approved и переписывает
--      позицию в catalog.js: артикул, название, цену, наличие. Внутренний id
--      позиции не меняется — по нему её ищут код подбора, старые сметы и ссылки.
--
-- Почему парсер пишет через функцию, а не прямо в таблицу. В GitHub Actions у
-- скриптов только публичный ключ (anon), как у AutoCompanyInfo.py. Открыть anon
-- вставку в таблицу — значит дать любому засыпать очередь чем угодно. Функция
-- принимает только то, что умеет парсер: артикулы по шаблону, ссылки только на
-- teremonline, цены в разумных пределах, не больше 300 необработанных строк.
-- Решение (approved/rejected) через неё не поменять: это право админа.
--
-- Отклонённая пара остаётся в таблице, и парсер её больше не поднимает: функция
-- при повторной находке только отмечает seen_at.
--
-- Выполнить вручную в Supabase SQL Editor, весь файл целиком, за один раз.

create table if not exists public.catalog_successors (
    id              bigserial primary key,
    old_article     text not null,
    new_article     text not null,
    catalog_name    text,            -- название позиции в каталоге сейчас
    new_name        text,            -- название преемника на сайте
    apply_name      text,            -- какое название поставить в калькуляторе (выбирает админ)
    brand           text,
    old_site_price  numeric,         -- цена старой позиции на сайте, как на карточке
    new_site_price  numeric,         -- цена преемника на сайте, как на карточке
    catalog_price   numeric,         -- цена старой позиции в каталоге
    new_price       numeric,         -- цена преемника в единицах каталога
    old_url         text,
    new_url         text,
    status          text not null default 'new'
                    check (status in ('new', 'approved', 'rejected')),
    found_at        timestamptz not null default now(),
    seen_at         timestamptz not null default now(),
    decided_at      timestamptz,
    decided_by      text,
    unique (old_article, new_article)
);

create index if not exists catalog_successors_status_idx on public.catalog_successors (status);

alter table public.catalog_successors enable row level security;

-- Читает и решает только админ (is_admin: владелец и account_type = 'admin').
drop policy if exists catalog_successors_admin_read on public.catalog_successors;
create policy catalog_successors_admin_read on public.catalog_successors
    for select using (public.is_admin());

drop policy if exists catalog_successors_admin_update on public.catalog_successors;
create policy catalog_successors_admin_update on public.catalog_successors
    for update using (public.is_admin()) with check (public.is_admin());

grant select, update on public.catalog_successors to authenticated;
revoke insert, delete on public.catalog_successors from anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- Парсер: предложить пару. Возвращает, что стало со строкой:
--   'added' — новая строка; 'seen' — пара уже есть, отмечена находка;
--   'skipped' — очередь переполнена или данные не прошли проверку.
create or replace function public.catalog_successor_propose(p jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_old    text := btrim(coalesce(p->>'old_article', ''));
    v_new    text := btrim(coalesce(p->>'new_article', ''));
    v_status text;
    v_price  numeric;
begin
    -- Артикулы: буквы, цифры и разделители, как у кодов на сайте и в каталоге.
    if v_old !~ '^[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9 ._/-]{0,63}$'
       or v_new !~ '^[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9 ._/-]{0,63}$'
       or upper(v_old) = upper(v_new) then
        return 'skipped';
    end if;

    -- Ссылки — только на карточки teremonline.
    if coalesce(p->>'old_url', '') !~ '^(/product/|https://(www\.)?teremonline\.ru/product/)[^"<>\s]{1,300}$'
       or coalesce(p->>'new_url', '') !~ '^(/product/|https://(www\.)?teremonline\.ru/product/)[^"<>\s]{1,300}$' then
        return 'skipped';
    end if;

    begin
        v_price := (p->>'new_price')::numeric;
    exception when others then
        return 'skipped';
    end;
    if v_price is null or v_price <= 0 or v_price > 10000000 then
        return 'skipped';
    end if;

    select status into v_status from public.catalog_successors
     where old_article = v_old and new_article = v_new;

    if found then
        -- Цены и названия освежаем только у нерешённой пары: у решённой админ
        -- уже видел конкретные цифры, подменять их под ним нельзя.
        update public.catalog_successors
           set seen_at = now(),
               new_name       = case when status = 'new' then left(p->>'new_name', 300) else new_name end,
               catalog_name   = case when status = 'new' then left(p->>'catalog_name', 300) else catalog_name end,
               old_site_price = case when status = 'new' then nullif(p->>'old_site_price', '')::numeric else old_site_price end,
               new_site_price = case when status = 'new' then nullif(p->>'new_site_price', '')::numeric else new_site_price end,
               catalog_price  = case when status = 'new' then nullif(p->>'catalog_price', '')::numeric else catalog_price end,
               new_price      = case when status = 'new' then v_price else new_price end
         where old_article = v_old and new_article = v_new;
        return 'seen';
    end if;

    if (select count(*) from public.catalog_successors where status = 'new') >= 300 then
        return 'skipped';
    end if;

    insert into public.catalog_successors
        (old_article, new_article, catalog_name, new_name, brand,
         old_site_price, new_site_price, catalog_price, new_price, old_url, new_url)
    values
        (v_old, v_new, left(p->>'catalog_name', 300), left(p->>'new_name', 300), left(p->>'brand', 60),
         nullif(p->>'old_site_price', '')::numeric, nullif(p->>'new_site_price', '')::numeric,
         nullif(p->>'catalog_price', '')::numeric, v_price,
         left(p->>'old_url', 400), left(p->>'new_url', 400));
    return 'added';
exception when others then
    return 'skipped';
end;
$$;

revoke all on function public.catalog_successor_propose(jsonb) from public;
grant execute on function public.catalog_successor_propose(jsonb) to anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- Ежедневный перенос в каталог: подтверждённые пары. Секретов тут нет — это
-- артикулы, название и цена, которые после переноса и так лежат в catalog.js.
create or replace function public.catalog_successors_approved()
returns table (old_article text, new_article text, apply_name text, new_price numeric)
language sql
security definer
set search_path = public
as $$
    select s.old_article, s.new_article, s.apply_name, s.new_price
      from public.catalog_successors s
     where s.status = 'approved'
     order by s.decided_at nulls last, s.id;
$$;

revoke all on function public.catalog_successors_approved() from public;
grant execute on function public.catalog_successors_approved() to anon, authenticated;
