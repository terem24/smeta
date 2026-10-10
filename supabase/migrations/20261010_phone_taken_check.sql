-- Проверка «этот телефон уже в другой учётной записи» при сохранении анкеты.
-- Политика users_select_scoped не даёт монтажнику читать чужие строки, поэтому
-- отвечает функция: только маскированная почта, без остальных данных.
create or replace function public.phone_taken_by_other(p_phone text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select case
           when position('@' in u.email) > 3
             then left(u.email, 2) || '***' || substr(u.email, position('@' in u.email))
           else u.email
         end
  from public.users u
  where u.phone = p_phone
    and u.auth_user_id is distinct from auth.uid()
    and coalesce(u.is_test, false) = false
  limit 1;
$$;

revoke all on function public.phone_taken_by_other(text) from public, anon;
grant execute on function public.phone_taken_by_other(text) to authenticated;
