-- Проверка, есть ли аккаунт с таким email (для окна «Восстановление пароля»).
-- Возвращает только true/false, саму строку пользователя не отдаёт.
create or replace function public.auth_email_exists(p_email text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (select 1 from auth.users where lower(email) = lower(trim(p_email)));
$$;

revoke all on function public.auth_email_exists(text) from public;
grant execute on function public.auth_email_exists(text) to anon, authenticated;
