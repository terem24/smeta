-- Защита имени в анкете, журнал его правок и запрет повторной регистрации после удаления.
--
-- 1. name_looks_like_company(text) — «ООО Монтаж», «Сантехинжиниринг»: название компании
--    вместо ФИО. Правило то же, что app.looksLikeCompany в app.js — менять вместе.
-- 2. Триггер на users: при новой учётке такое имя молча обнуляется (анкету попросят
--    заполнить в кабинете), при правке — отказ NAME_COMPANY. Администратору можно всё.
--    Меняют только реально изменившееся ФИО: старые учётки с таким именем вход не ломают.
-- 3. user_name_history — кто, когда и на что менял ФИО. Читает администратор через
--    user_name_history_for(user_id).
-- 4. Удалённого администратором (не за неактивность) не регистрируем заново 30 дней;
--    удалённого за неактивность — по-прежнему год. Список — та же inactivity_deleted,
--    «Разрешить регистрацию» работает для обоих.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Название компании вместо ФИО
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.name_looks_like_company(p_name text)
returns boolean
language sql
immutable
as $$
    select
        lower(replace(coalesce(p_name, ''), 'ё', 'е')) ~
            '(^|[^а-я])(ооо|оао|зао|пао|ип|тоо|ао|чп|нко)([^а-я]|$)'
     or lower(replace(coalesce(p_name, ''), 'ё', 'е')) ~
            '(^|[^а-я])(монтаж(?![а-я])|монтажн|сантех|инжинир|строи|групп[аы]?(?![а-я])|компани|сервис|трейд|холдинг|студи[яий]|мастерск|бригад|отоплен|теплотех|теплоснаб|водоснаб|энерго|ремонт|логистик|технолог|проектн|проектс)';
$$;

grant execute on function public.name_looks_like_company(text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Журнал правок ФИО
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.user_name_history (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null,              -- без внешнего ключа: след остаётся и после удаления учётки
    email      text,
    old_name   text,
    new_name   text,
    changed_by uuid,                       -- auth.uid() того, кто менял
    by_admin   boolean not null default false,
    changed_at timestamptz not null default now()
);
create index if not exists user_name_history_user_idx on public.user_name_history (user_id, changed_at desc);
alter table public.user_name_history enable row level security;   -- без политик: только через функции

-- Защита: ФИО-«компания» не проходит
create or replace function public.users_guard_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    old_n text;
    new_n text;
begin
    new_n := nullif(btrim(concat_ws(' ', new.last_name, new.first_name, new.middle_name)), '');
    if tg_op = 'INSERT' then
        if public.name_looks_like_company(new_n) then
            new.last_name := null; new.first_name := null; new.middle_name := null;
        end if;
        return new;
    end if;

    old_n := nullif(btrim(concat_ws(' ', old.last_name, old.first_name, old.middle_name)), '');
    if old_n is not distinct from new_n then
        return new;
    end if;
    if public.name_looks_like_company(new_n) and not public.is_admin() then
        raise exception 'NAME_COMPANY'
            using hint = 'В анкете нужны ваши фамилия, имя и отчество, а не название компании.';
    end if;
    return new;
end;
$$;

drop trigger if exists users_guard_name on public.users;
create trigger users_guard_name
    before insert or update of last_name, first_name, middle_name on public.users
    for each row execute function public.users_guard_name();

-- Журнал: после записи, когда ФИО точно изменилось
create or replace function public.users_log_name_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    old_n text;
    new_n text;
begin
    new_n := nullif(btrim(concat_ws(' ', new.last_name, new.first_name, new.middle_name)), '');
    if tg_op = 'UPDATE' then
        old_n := nullif(btrim(concat_ws(' ', old.last_name, old.first_name, old.middle_name)), '');
    end if;
    if old_n is not distinct from new_n then
        return new;
    end if;
    begin
        insert into public.user_name_history (user_id, email, old_name, new_name, changed_by, by_admin)
        values (new.id, new.email, old_n, new_n, auth.uid(),
                coalesce(auth.uid() is distinct from new.auth_user_id and public.is_admin(), false));
    exception when others then
        raise notice 'users_log_name_change: запись не сделана';   -- журнал не повод срывать сохранение
    end;
    return new;
end;
$$;

drop trigger if exists users_log_name_change on public.users;
create trigger users_log_name_change
    after insert or update of last_name, first_name, middle_name on public.users
    for each row execute function public.users_log_name_change();

revoke all on function public.users_guard_name() from public, anon, authenticated;
revoke all on function public.users_log_name_change() from public, anon, authenticated;

create or replace function public.user_name_history_for(p_user uuid)
returns table (changed_at timestamptz, old_name text, new_name text, by_admin boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
    if not (public.is_admin() or exists (
        select 1 from public.users me
         where me.auth_user_id = auth.uid() and me.account_type in ('admin', 'viewer'))) then
        raise exception 'История доступна только администратору';
    end if;
    return query
    select h.changed_at, h.old_name, h.new_name, h.by_admin
      from public.user_name_history h
     where h.user_id = p_user
     order by h.changed_at desc
     limit 50;
end;
$$;

grant execute on function public.user_name_history_for(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Запрет повторной регистрации: 30 дней после удаления администратором
-- ─────────────────────────────────────────────────────────────────────────
alter table public.inactivity_deleted add column if not exists kind text not null default 'inactive';
alter table public.inactivity_deleted add column if not exists block_days int not null default 365;

comment on column public.inactivity_deleted.kind is
    'inactive — удалён за неактивность (запрет год); manual — удалён администратором (запрет 30 дней).';

-- Удаление: замороженный — как раньше (за неактивность), остальные — только если удаляет администратор.
-- Служебные подчистки (пустой дубль при переходе на Яндекс ID и т. п.) идут не от админа и не считаются.
create or replace function public.log_inactive_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_kind text;
begin
    if old.frozen_at is not null then
        v_kind := 'inactive';
    elsif auth.uid() is not null and public.is_admin()
          and old.auth_user_id is distinct from auth.uid() then
        v_kind := 'manual';
    else
        return old;
    end if;

    begin
        insert into public.inactivity_deleted
            (user_id, name, email, phone, region, city, warned_at, frozen_at, last_visited, estimates, kind, block_days)
        select old.id,
               coalesce(nullif(btrim(concat_ws(' ', old.last_name, old.first_name, old.middle_name)), ''),
                        nullif(btrim(old.username), ''), old.email, 'Без имени'),
               old.email, old.phone, old.region, old.city,
               (select n.warned_at from public.inactivity_notices n where n.user_id = old.id),
               old.frozen_at, old.last_visited,
               (select count(*)::int from public.estimates e where e.user_id = old.id),
               v_kind, case when v_kind = 'manual' then 30 else 365 end;
    exception when others then
        raise notice 'log_inactive_deletion: след об учётке % не записан', old.id;
    end;
    return old;
end;
$$;

-- До какого числа закрыта регистрация и по какой причине
create or replace function public.reg_block_info(p_email text, p_phone text default null)
returns table (till timestamptz, kind text)
language sql
stable
security definer
set search_path = public
as $$
    select d.deleted_at + make_interval(days => d.block_days), d.kind
      from public.inactivity_deleted d
     where d.reg_allowed_at is null
       and d.deleted_at + make_interval(days => d.block_days) > now()
       and (
            (nullif(btrim(p_email), '') is not null
             and lower(btrim(d.email)) = lower(btrim(p_email)))
         or (length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 10
             and right(regexp_replace(coalesce(d.phone, ''), '\D', '', 'g'), 10)
               = right(regexp_replace(p_phone, '\D', '', 'g'), 10))
       )
     order by 1 desc
     limit 1;
$$;

grant execute on function public.reg_block_info(text, text) to anon, authenticated;

create or replace function public.reg_block_until(p_email text, p_phone text default null)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
    select till from public.reg_block_info(p_email, p_phone);
$$;

create or replace function public.users_block_deleted_reregistration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    b record;
begin
    if new.auth_user_id is not null
       and exists (select 1 from public.users x where x.auth_user_id = new.auth_user_id) then
        return new;
    end if;

    select * into b from public.reg_block_info(new.email, new.phone);
    if b.till is not null then
        raise exception '% %',
            case when b.kind = 'manual' then 'REG_BLOCKED_DELETED' else 'REG_BLOCKED_INACTIVE' end,
            to_char(b.till, 'DD.MM.YYYY')
            using hint = 'Учётка удалена; повторная регистрация закрыта, пока не истёк срок или администратор не разрешит.';
    end if;
    return new;
end;
$$;

-- Отчёт: добавлены срок запрета и причина удаления
drop function if exists public.inactivity_report();

create function public.inactivity_report()
returns table (
    user_id        uuid,
    name           text,
    email          text,
    phone          text,
    region         text,
    city           text,
    stage          text,          -- warned | frozen | deleted
    warned_at      timestamptz,
    frozen_at      timestamptz,
    last_visited   timestamptz,
    returned_at    timestamptz,
    estimates      int,
    deleted_id     uuid,
    deleted_at     timestamptz,
    reg_allowed_at timestamptz,
    reg_until      timestamptz,   -- до какого числа закрыта регистрация (только у удалённых)
    kind           text           -- inactive | manual
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if not exists (
        select 1 from public.users me
         where me.auth_user_id = auth.uid()
           and (me.account_type in ('admin', 'viewer')
                or lower(btrim(me.email)) in ('dima24ba@gmail.com', 'kovdorekb@gmail.com', 'kovdor24@yandex.ru'))
    ) then
        raise exception 'Отчёт доступен только администратору';
    end if;

    return query
    select * from (
    select u.id,
           coalesce(nullif(btrim(concat_ws(' ', u.last_name, u.first_name, u.middle_name)), ''),
                    nullif(btrim(u.username), ''), u.email, 'Без имени')::text,
           u.email, u.phone, u.region, u.city,
           (case when u.frozen_at is not null then 'frozen' else 'warned' end)::text,
           n.warned_at, u.frozen_at, u.last_visited,
           case when u.last_visited > n.warned_at then u.last_visited end,
           (select count(*)::int from public.estimates e where e.user_id = u.id),
           null::uuid, null::timestamptz, null::timestamptz, null::timestamptz, null::text
      from public.inactivity_notices n
      join public.users u on u.id = n.user_id

    union all

    select d.user_id, d.name, d.email, d.phone, d.region, d.city,
           'deleted'::text, d.warned_at, d.frozen_at, d.last_visited,
           null::timestamptz, d.estimates,
           d.id, d.deleted_at, d.reg_allowed_at,
           d.deleted_at + make_interval(days => d.block_days), d.kind
      from public.inactivity_deleted d
    ) q
    order by coalesce(q.deleted_at, q.warned_at) desc nulls last;
end;
$$;

grant execute on function public.inactivity_report() to authenticated;
