-- Закрытие самоповышения: политика users_self_update не ограничивала колонки, и любой
-- вошедший мог выполнить update users set account_type='admin' (is_admin() верит этому
-- полю), а политика INSERT (with check true) позволяла создать строку сразу админской.
-- Триггер ниже запрещает прямым запросам из браузера (роли authenticated/anon) менять
-- привилегированные поля. Не трогает: администратора (is_admin()), RPC-функции базы
-- (apply_invite_code и др. — они идут под ролью-владельцем), service_role.
-- Разрешено клиенту: понизить тариф до базового, один раз начать пробный период
-- (demo_ends_at пуст → срок до 60 дней), привязаться к магазину первый раз при
-- свободной регистрации. Уже выполнено в Supabase 08.10.2026.
-- Триггер намеренно НЕ security definer — иначе current_user всегда был бы владельцем.

create or replace function public.users_guard_privileged()
returns trigger
language plpgsql
as $$
declare
  reg_mode text;
begin
  if current_user not in ('authenticated', 'anon') then return NEW; end if;
  if public.is_admin() then return NEW; end if;

  if TG_OP = 'INSERT' then
    if coalesce(NEW.account_type, 'free') not in ('free', 'base')
       or NEW.pro_expires_at is not null
       or NEW.demo_ends_at is not null
       or coalesce(NEW.is_blocked, false)
       or NEW.frozen_at is not null
       or coalesce(array_length(NEW.viewer_distributor_ids, 1), 0) > 0
       or coalesce(NEW.xp_points_total, 0) <> 0
       or coalesce(NEW.xp_points_current_month, 0) <> 0 then
      raise exception 'Недостаточно прав для создания учётной записи с такими полями' using errcode = '42501';
    end if;
    return NEW;
  end if;

  if NEW.account_type is distinct from OLD.account_type then
    if NEW.account_type in ('free', 'base') then
      null;
    elsif NEW.account_type = 'pro'
          and coalesce(OLD.account_type, 'free') in ('free', 'base')
          and OLD.demo_ends_at is null
          and NEW.demo_ends_at is not null
          and NEW.demo_ends_at <= now() + interval '60 days' then
      null;
    else
      raise exception 'Менять тариф или роль может только администратор' using errcode = '42501';
    end if;
  end if;

  if NEW.demo_ends_at is distinct from OLD.demo_ends_at then
    if not (OLD.demo_ends_at is null and NEW.demo_ends_at is not null
            and NEW.demo_ends_at <= now() + interval '60 days') then
      raise exception 'Менять срок пробного периода может только администратор' using errcode = '42501';
    end if;
  end if;

  if NEW.pro_expires_at is distinct from OLD.pro_expires_at
     or NEW.is_blocked is distinct from OLD.is_blocked
     or NEW.frozen_at is distinct from OLD.frozen_at
     or NEW.price_source is distinct from OLD.price_source
     or NEW.viewer_distributor_ids is distinct from OLD.viewer_distributor_ids
     or NEW.xp_points_total is distinct from OLD.xp_points_total
     or NEW.xp_points_current_month is distinct from OLD.xp_points_current_month
     or NEW.registered_at is distinct from OLD.registered_at then
    raise exception 'Это поле может менять только администратор' using errcode = '42501';
  end if;

  if NEW.auth_user_id is distinct from OLD.auth_user_id
     and OLD.auth_user_id is not null
     and NEW.auth_user_id is distinct from auth.uid() then
    raise exception 'Нельзя привязать учётную запись к чужому входу' using errcode = '42501';
  end if;

  if NEW.distributor_id is distinct from OLD.distributor_id then
    select value ->> 'mode' into reg_mode from public.app_settings where key = 'registration';
    if not (OLD.distributor_id is null and NEW.distributor_id is not null and coalesce(reg_mode, 'open') <> 'invite') then
      raise exception 'Привязка к магазину — по промокоду или через администратора' using errcode = '42501';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists users_guard_privileged on public.users;
create trigger users_guard_privileged
  before insert or update on public.users
  for each row execute function public.users_guard_privileged();
