-- Сфера деятельности (users.activity_types) меняется не чаще раза в 7 дней.
-- Клиентская проверка в анкете обходится через консоль, поэтому правило держит база.
-- Что делает триггер:
--   * при любой смене activity_types пишет users.activity_changed_at = now();
--   * если у строки уже была сфера и она менялась меньше 7 дней назад, а менять пытается
--     сам владелец строки (auth.uid() = auth_user_id), смена отклоняется.
-- Админка и служебные записи (auth.uid() не владелец) не ограничиваются.

alter table public.users add column if not exists activity_changed_at timestamptz;

create or replace function public.users_activity_lock()
returns trigger
language plpgsql
as $$
begin
    if new.activity_types is distinct from old.activity_types then
        if auth.uid() is not null
           and auth.uid() = old.auth_user_id
           and cardinality(coalesce(old.activity_types, '{}'::text[])) > 0
           and old.activity_changed_at is not null
           and old.activity_changed_at > now() - interval '7 days' then
            raise exception 'activity_locked' using errcode = 'P0001';
        end if;
        new.activity_changed_at := now();
    end if;
    return new;
end;
$$;

drop trigger if exists users_activity_lock on public.users;
create trigger users_activity_lock
    before update of activity_types on public.users
    for each row execute function public.users_activity_lock();
