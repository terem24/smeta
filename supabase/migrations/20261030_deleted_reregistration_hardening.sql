-- Повторная регистрация удалённого: закрытие обходов.
--
-- Было: запрет шёл по inactivity_deleted (почта точно, телефон — последние 10 цифр), но
--   * телефон при регистрации пуст (его вводят в анкете позже), а при сохранении анкеты
--     проверки не было: новая почта + тот же телефон проходили;
--   * почта сверялась точно: name+1@gmail.com и name.@gmail.com обходили запрет;
--   * ручное удаление блокировало всего на 30 дней;
--   * сам логин в auth.users создавался (и письмо подтверждения уходило), запрет срабатывал
--     только при создании профиля в public.users.
-- Стало:
--   1. norm_email: gmail без точек и «+метки», у остальных без «+метки»; reg_block_info
--      сравнивает по ней.
--   2. Смена телефона/почты в профиле: если значение совпало с удалённым — учётка получает
--      is_blocked (дальше работает users_block_sync: бан во входе и выход), а не ошибку.
--   3. Создание логина в auth.users с почтой удалённого — отказ (signup_blocked_deleted).
--   4. Ручное удаление блокирует регистрацию бессрочно (3650 дней); снять можно кнопкой
--      «Разрешить регистрацию» на вкладке «Неактивные» (reg_allowed_at).
--
-- Выполнить в Supabase SQL Editor целиком.

-- ── 1. Нормализация почты ──
create or replace function public.norm_email(e text)
returns text
language sql
immutable
as $$
    select case
        when btrim(coalesce(e, '')) = '' or position('@' in e) = 0 then lower(btrim(coalesce(e, '')))
        when split_part(lower(btrim(e)), '@', 2) in ('gmail.com', 'googlemail.com')
            then replace(split_part(split_part(lower(btrim(e)), '@', 1), '+', 1), '.', '') || '@gmail.com'
        else split_part(split_part(lower(btrim(e)), '@', 1), '+', 1) || '@' || split_part(lower(btrim(e)), '@', 2)
    end;
$$;

create or replace function public.reg_block_info(p_email text, p_phone text default null)
returns table(till timestamptz, kind text)
language sql
stable
security definer
set search_path = public
as $$
    select d.deleted_at + make_interval(days => d.block_days), d.kind
      from public.inactivity_deleted d
     where d.reg_allowed_at is null
       and d.deleted_at + make_interval(days => d.block_days) > now()
       and lower(btrim(coalesce(d.email, ''))) not like '%@teremopt.ru'
       and lower(btrim(coalesce(p_email, ''))) not like '%@teremopt.ru'
       and (
            (nullif(btrim(p_email), '') is not null
             and public.norm_email(d.email) = public.norm_email(p_email))
         or (length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 10
             and right(regexp_replace(coalesce(d.phone, ''), '\D', '', 'g'), 10)
               = right(regexp_replace(p_phone, '\D', '', 'g'), 10))
       )
     order by 1 desc
     limit 1;
$$;

-- ── 4. Срок блокировки при ручном удалении ──
update public.inactivity_deleted set block_days = 3650 where kind = 'manual' and block_days < 3650;

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
               v_kind, case when v_kind = 'manual' then 3650 else 365 end;
    exception when others then
        raise notice 'log_inactive_deletion: след об учётке % не записан', old.id;
    end;
    return old;
end;
$$;

-- ── 2. Смена телефона/почты в профиле ──
create or replace function public.users_block_reregistration_upd()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    b record;
begin
    if coalesce(NEW.is_blocked, false) then return NEW; end if;
    -- администратор правит чужую учётку — не блокируем
    if auth.uid() is not null and public.is_admin() and NEW.auth_user_id is distinct from auth.uid() then
        return NEW;
    end if;
    if (NEW.phone is distinct from OLD.phone and btrim(coalesce(NEW.phone, '')) <> '')
       or (NEW.email is distinct from OLD.email and btrim(coalesce(NEW.email, '')) <> '') then
        select * into b from public.reg_block_info(NEW.email, NEW.phone);
        if b.till is not null then
            NEW.is_blocked := true;
        end if;
    end if;
    return NEW;
end;
$$;
revoke all on function public.users_block_reregistration_upd() from public, anon, authenticated;

-- имя с «zz»: срабатывает после users_guard_privileged, который запрещает клиенту менять is_blocked
drop trigger if exists users_zz_block_reregistration_upd on public.users;
create trigger users_zz_block_reregistration_upd
    before update of phone, email on public.users
    for each row
    execute function public.users_block_reregistration_upd();

-- ── 3. Логин в auth.users ──
create or replace function public.auth_signup_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    cfg jsonb;
    per_hour int := 30;
    per_day  int := 150;
    dom text;
    n_hour int;
    n_day int;
    blk timestamptz;
begin
    begin
        select value into cfg from public.app_settings where key = 'signup_limits';
        if cfg is not null then
            per_hour := greatest(coalesce((cfg->>'per_hour')::int, per_hour), 1);
            per_day  := greatest(coalesce((cfg->>'per_day')::int, per_day), 1);
        end if;
    exception when others then
        null;
    end;

    dom := lower(split_part(coalesce(new.email, ''), '@', 2));
    if dom ~ '(^|\.)(oastify\.com|burpcollaborator\.net|interact\.sh|oast\.(pro|live|site|online|fun|me))$' then
        raise exception 'signup_blocked_domain' using errcode = 'P0001';
    end if;

    -- удалённый администратором или за неактивность: новый логин не создаём
    begin
        select till into blk from public.reg_block_info(new.email, null) limit 1;
    exception when others then
        blk := null;
    end;
    if blk is not null then
        raise exception 'signup_blocked_deleted' using errcode = 'P0001';
    end if;

    select count(*) filter (where created_at > now() - interval '1 hour'),
           count(*) filter (where created_at > now() - interval '1 day')
      into n_hour, n_day
      from auth.users;

    if n_hour >= per_hour or n_day >= per_day then
        raise exception 'signup_rate_limited' using errcode = 'P0001';
    end if;

    return new;
end;
$$;
