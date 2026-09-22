-- Удалённые за неактивность не могут зарегистрироваться заново год — пока
-- администратор не разрешит раньше.
--
-- Список удалённых уже ведёт триггер users_log_inactive_delete в таблице
-- inactivity_deleted (20260910_inactivity_report.sql): имя, почта, телефон, регион,
-- даты письма, заморозки и удаления. Здесь к нему добавляется отметка «регистрацию
-- разрешили» и сам запрет.
--
-- Запрет стоит на вставке в public.users, а не на форме регистрации: учётка
-- появляется в users при первом входе любым способом — почта, Google, Telegram, — и
-- только это место закрывает все три. Форма регистрации дополнительно спрашивает
-- reg_block_until заранее, чтобы человек не ждал письма с кодом зря.
--
-- Узнаём человека по почте или по телефону (последние 10 цифр): новая почта с тем
-- же телефоном — тот же монтажник.

alter table public.inactivity_deleted add column if not exists reg_allowed_at timestamptz;
alter table public.inactivity_deleted add column if not exists reg_allowed_by uuid;

comment on column public.inactivity_deleted.reg_allowed_at is
    'Администратор разрешил зарегистрироваться заново, не дожидаясь года. Пусто — запрет действует.';

-- ─────────────────────────────────────────────────────────────────────────
-- 1. До какого числа закрыта регистрация. null — не закрыта.
--
-- Отдаёт только дату, без имени и причины: функцию может позвать кто угодно с
-- формы регистрации.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.reg_block_until(p_email text, p_phone text default null)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
    select max(d.deleted_at) + interval '1 year'
      from public.inactivity_deleted d
     where d.reg_allowed_at is null
       and d.deleted_at > now() - interval '1 year'
       and (
            (nullif(btrim(p_email), '') is not null
             and lower(btrim(d.email)) = lower(btrim(p_email)))
         or (length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 10
             and right(regexp_replace(coalesce(d.phone, ''), '\D', '', 'g'), 10)
               = right(regexp_replace(p_phone, '\D', '', 'g'), 10))
       );
$$;

grant execute on function public.reg_block_until(text, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Сам запрет: новая строка в users с почтой или телефоном удалённого.
--
-- Текст ошибки начинается с REG_BLOCKED_INACTIVE — по нему приложение узнаёт этот
-- случай и показывает человеку понятное сообщение вместо технической ошибки.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.users_block_deleted_reregistration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    till timestamptz;
begin
    -- Приложение при каждом входе делает upsert по auth_user_id, а BEFORE INSERT
    -- срабатывает и тогда, когда строка уже есть и вставка превратится в обновление.
    -- Существующих не трогаем — запрет только на новую учётку.
    if new.auth_user_id is not null
       and exists (select 1 from public.users x where x.auth_user_id = new.auth_user_id) then
        return new;
    end if;

    till := public.reg_block_until(new.email, new.phone);
    if till is not null then
        raise exception 'REG_BLOCKED_INACTIVE %', to_char(till, 'DD.MM.YYYY')
            using hint = 'Учётка удалена за неактивность; регистрация закрыта на год, если администратор не разрешит раньше.';
    end if;
    return new;
end;
$$;

drop trigger if exists users_block_deleted_reregistration on public.users;
create trigger users_block_deleted_reregistration
    before insert on public.users
    for each row execute function public.users_block_deleted_reregistration();

revoke all on function public.users_block_deleted_reregistration() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Разрешить зарегистрироваться заново. Кнопка на вкладке «Напоминания».
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.allow_deleted_reregistration(record_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    me_id uuid;
begin
    select me.id into me_id from public.users me
     where me.auth_user_id = auth.uid()
       and (me.account_type = 'admin'
            or lower(btrim(me.email)) in ('dima24ba@gmail.com', 'kovdorekb@gmail.com', 'kovdor24@yandex.ru'))
     limit 1;
    if me_id is null then
        raise exception 'Разрешить регистрацию может только администратор';
    end if;

    update public.inactivity_deleted
       set reg_allowed_at = now(), reg_allowed_by = me_id
     where id = record_id and reg_allowed_at is null;
    return found;
end;
$$;

grant execute on function public.allow_deleted_reregistration(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Отчёт: для удалённых добавлены номер записи и отметка о разрешении.
-- Тип результата меняется, поэтому функцию пересоздаём.
-- ─────────────────────────────────────────────────────────────────────────
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
    deleted_id     uuid,          -- строка inactivity_deleted (только у удалённых)
    deleted_at     timestamptz,
    reg_allowed_at timestamptz
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
    select u.id,
           coalesce(nullif(btrim(concat_ws(' ', u.last_name, u.first_name, u.middle_name)), ''),
                    nullif(btrim(u.username), ''), u.email, 'Без имени')::text,
           u.email, u.phone, u.region, u.city,
           (case when u.frozen_at is not null then 'frozen' else 'warned' end)::text,
           n.warned_at, u.frozen_at, u.last_visited,
           case when u.last_visited > n.warned_at then u.last_visited end,
           (select count(*)::int from public.estimates e where e.user_id = u.id),
           null::uuid, null::timestamptz, null::timestamptz
      from public.inactivity_notices n
      join public.users u on u.id = n.user_id

    union all

    select d.user_id, d.name, d.email, d.phone, d.region, d.city,
           'deleted'::text, d.warned_at, d.frozen_at, d.last_visited,
           null::timestamptz, d.estimates,
           d.id, d.deleted_at, d.reg_allowed_at
      from public.inactivity_deleted d

    order by 8 desc nulls last;
end;
$$;

grant execute on function public.inactivity_report() to authenticated;

-- Проверка: select public.reg_block_until('кто-то@mail.ru', null);
