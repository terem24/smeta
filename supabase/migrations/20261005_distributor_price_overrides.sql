-- Правки прайса дистрибьютора: «не применять» и «своя цена» по артикулу.
--
-- Зачем. Прайс дистрибьютора лежит файлом dist_prices.js и целиком пересобирается из
-- выгрузок. Спорные позиции (другая единица измерения, ошибка каталога, цена в разы
-- выше или ниже) раньше исключались прямо в скрипте сборки — менять их мог только
-- разработчик и только выкладкой новой версии. Теперь админ правит их в админке
-- («Каталог → Прайс дистрибьютора»), а калькулятор накладывает правки поверх прайса.
--
-- Два действия над артикулом:
--   skip  — «не применять»: монтажнику остаётся цена Терем-онлайн из каталога;
--   price — «своя цена»: берётся цена, указанная здесь, вместо цены из прайса.
-- Нет строки — действует цена из прайса, как раньше.
--
-- Кто что может (проверка внутри функций, прямой записи в таблицы нет):
--   владелец и администратор — правят любой прайс;
--   наблюдатель — правит прайсы своих компаний (users.viewer_distributor_ids);
--   менеджер дистрибьютора — только смотрит правки и журнал своей компании.
--
-- Каждая правка пишется в журнал: кто, когда, что было и что стало.
--
-- Выполнить вручную в Supabase SQL Editor, весь файл целиком, за один раз.

create table if not exists public.distributor_price_overrides (
    price_list_key text        not null,         -- ключ из dist_prices.js, например 'kit-service'
    article        text        not null,         -- артикул, как id позиции каталога
    action         text        not null check (action in ('skip', 'price')),
    price          numeric,                      -- только для action = 'price'
    note           text,                         -- почему так
    updated_by     text,
    updated_at     timestamptz not null default now(),
    primary key (price_list_key, article),
    check ((action = 'price' and price is not null and price > 0) or (action = 'skip'))
);

create table if not exists public.distributor_price_override_log (
    id             bigserial primary key,
    price_list_key text        not null,
    article        text        not null,
    before_action  text,                          -- null = правки не было (цена из прайса)
    before_price   numeric,
    after_action   text,                          -- null = правку сняли
    after_price    numeric,
    note           text,
    changed_by     text,
    changed_at     timestamptz not null default now()
);

create index if not exists dpo_log_key_idx on public.distributor_price_override_log (price_list_key, changed_at desc);

alter table public.distributor_price_overrides   enable row level security;
alter table public.distributor_price_override_log enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- Кто может править / смотреть прайс с ключом p_key
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.dist_price_can_edit(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.is_admin()
        or exists (
            select 1
              from public.users u
              join public.distributors d on d.price_list_key = p_key
             where u.auth_user_id = auth.uid()
               and u.account_type = 'viewer'
               and d.id = any(coalesce(u.viewer_distributor_ids, '{}'))
        );
$$;

create or replace function public.dist_price_can_view(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.dist_price_can_edit(p_key)
        or exists (
            select 1
              from public.users u
              join public.distributors d on d.price_list_key = p_key
             where u.auth_user_id = auth.uid()
               and u.account_type = 'manager'
               and (
                    u.distributor_id = d.id
                 or (coalesce(btrim(d.manager_email), '')  <> '' and lower(btrim(d.manager_email))  = lower(btrim(coalesce(u.email, ''))))
                 or (coalesce(btrim(d.director_email), '') <> '' and lower(btrim(d.director_email)) = lower(btrim(coalesce(u.email, ''))))
               )
        );
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Чтение. Правки читают и монтажники дистрибьютора — иначе калькулятор не смог бы
-- их наложить. Там только артикул, действие и цена; те же цены и так лежат в
-- dist_prices.js, который отдаётся браузеру. Заметку и автора монтажникам не отдаём:
-- читать таблицу напрямую они не могут, только через функцию ниже.
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists dpo_view on public.distributor_price_overrides;
create policy dpo_view on public.distributor_price_overrides
    for select using (public.dist_price_can_view(price_list_key));

create or replace function public.dist_price_overrides_public(p_key text)
returns table (article text, action text, price numeric)
language sql
stable
security definer
set search_path = public
as $$
    select o.article, o.action, o.price
      from public.distributor_price_overrides o
     where o.price_list_key = p_key;
$$;

revoke all on function public.dist_price_overrides_public(text) from public;
grant execute on function public.dist_price_overrides_public(text) to anon, authenticated;

drop policy if exists dpo_log_view on public.distributor_price_override_log;
create policy dpo_log_view on public.distributor_price_override_log
    for select using (public.dist_price_can_view(price_list_key));

grant select on public.distributor_price_overrides, public.distributor_price_override_log to authenticated;
revoke insert, update, delete on public.distributor_price_overrides, public.distributor_price_override_log from anon, authenticated;
revoke select on public.distributor_price_overrides, public.distributor_price_override_log from anon;

-- ─────────────────────────────────────────────────────────────────────────
-- Запись: поставить правку. p_action = 'skip' | 'price'.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.dist_price_override_set(
    p_key     text,
    p_article text,
    p_action  text,
    p_price   numeric default null,
    p_note    text    default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_art  text := btrim(coalesce(p_article, ''));
    v_old  public.distributor_price_overrides%rowtype;
    v_who  text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
    if not public.dist_price_can_edit(p_key) then
        raise exception 'Нет права менять этот прайс-лист';
    end if;
    if v_art !~ '^[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9 ._/-]{0,63}$' then
        raise exception 'Некорректный артикул';
    end if;
    if p_action not in ('skip', 'price') then
        raise exception 'Неизвестное действие';
    end if;
    if p_action = 'price' and (p_price is null or p_price <= 0 or p_price > 10000000) then
        raise exception 'Цена должна быть больше нуля';
    end if;
    -- Ключ прайса должен быть привязан хоть к одному дистрибьютору: мусорные ключи не плодим
    if not exists (select 1 from public.distributors d where d.price_list_key = p_key) then
        raise exception 'Прайс-лист не привязан ни к одному дистрибьютору';
    end if;

    select * into v_old from public.distributor_price_overrides
     where price_list_key = p_key and article = v_art;

    insert into public.distributor_price_overrides (price_list_key, article, action, price, note, updated_by, updated_at)
    values (p_key, v_art, p_action, case when p_action = 'price' then round(p_price) else null end,
            left(nullif(btrim(coalesce(p_note, '')), ''), 300), v_who, now())
    on conflict (price_list_key, article) do update
       set action = excluded.action, price = excluded.price, note = excluded.note,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at;

    insert into public.distributor_price_override_log
        (price_list_key, article, before_action, before_price, after_action, after_price, note, changed_by)
    values (p_key, v_art, v_old.action, v_old.price, p_action,
            case when p_action = 'price' then round(p_price) else null end,
            left(nullif(btrim(coalesce(p_note, '')), ''), 300), v_who);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Запись: снять правку (вернуть цену из прайса).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.dist_price_override_clear(
    p_key     text,
    p_article text,
    p_note    text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_art text := btrim(coalesce(p_article, ''));
    v_old public.distributor_price_overrides%rowtype;
    v_who text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
    if not public.dist_price_can_edit(p_key) then
        raise exception 'Нет права менять этот прайс-лист';
    end if;
    select * into v_old from public.distributor_price_overrides
     where price_list_key = p_key and article = v_art;
    if not found then
        return;
    end if;
    delete from public.distributor_price_overrides where price_list_key = p_key and article = v_art;
    insert into public.distributor_price_override_log
        (price_list_key, article, before_action, before_price, after_action, after_price, note, changed_by)
    values (p_key, v_art, v_old.action, v_old.price, null, null,
            left(nullif(btrim(coalesce(p_note, '')), ''), 300), v_who);
end;
$$;

revoke all on function public.dist_price_override_set(text, text, text, numeric, text) from public;
revoke all on function public.dist_price_override_clear(text, text, text) from public;
grant execute on function public.dist_price_override_set(text, text, text, numeric, text) to authenticated;
grant execute on function public.dist_price_override_clear(text, text, text) to authenticated;
revoke all on function public.dist_price_can_edit(text) from public;
revoke all on function public.dist_price_can_view(text) from public;
grant execute on function public.dist_price_can_edit(text) to authenticated;
grant execute on function public.dist_price_can_view(text) to authenticated;
