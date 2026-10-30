-- Заблокированных удаляем через 10 дней с момента блокировки (а не с последнего входа).
--
-- users.blocked_at ставится при любом переходе is_blocked false -> true (кнопка в админке,
-- совпадение телефона с удалённым) и сбрасывается при разблокировке. Уже заблокированным
-- на момент миграции дата неизвестна, ставим now(): их 10 дней идут отсюда.
-- Блок 5.0 process_inactive_accounts теперь смотрит на blocked_at; меняется заменой
-- условия в тексте действующей функции.

alter table public.users add column if not exists blocked_at timestamptz;

update public.users set blocked_at = now() where is_blocked and blocked_at is null;

create or replace function public.users_stamp_blocked_at()
returns trigger
language plpgsql
as $$
begin
    if coalesce(NEW.is_blocked, false) then
        if not coalesce(OLD.is_blocked, false) or NEW.blocked_at is null then
            NEW.blocked_at := now();
        else
            NEW.blocked_at := OLD.blocked_at;
        end if;
    else
        NEW.blocked_at := null;
    end if;
    return NEW;
end;
$$;

-- «zzz»: после users_zz_block_reregistration_upd, который сам может поставить is_blocked
drop trigger if exists users_zzz_stamp_blocked_at on public.users;
create trigger users_zzz_stamp_blocked_at
    before update on public.users
    for each row
    when (OLD.is_blocked is distinct from NEW.is_blocked or NEW.blocked_at is distinct from OLD.blocked_at)
    execute function public.users_stamp_blocked_at();

do $$
declare
    d text := pg_get_functiondef('public.process_inactive_accounts(boolean)'::regprocedure);
    d2 text;
begin
    d2 := replace(d,
        E'           and greatest(coalesce(us.last_visited, us.created_at),\n                        case when us.demo_ends_at <= now() then us.demo_ends_at end)\n               < now() - make_interval(days => 10)',
        E'           and coalesce(us.blocked_at, now()) < now() - make_interval(days => 10)');
    if d2 = d then
        raise exception 'process_inactive_accounts: условие блока 5.0 не найдено, ничего не изменено';
    end if;
    execute d2;
end $$;
