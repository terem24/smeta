-- Закрытие утечки переписки: раньше политика чтения messages пропускала любые
-- строки с recipient_id IS NULL (ответы монтажников администрации) — их видел
-- кто угодно, даже без входа. Теперь читает только администратор, получатель,
-- отправитель, а также автор исходного письма (наблюдатель видит ответы на своё).
-- Уже выполнено в Supabase 08.10.2026.

create or replace function public.is_reply_to_my_message(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select pid is not null and exists (
    select 1 from public.messages p
    where p.id = pid
      and p.sender_id = (select u.id from public.users u where u.auth_user_id = auth.uid())
  );
$$;

drop policy if exists "Allow select for recipient, sender, or broadcast" on public.messages;
drop policy if exists messages_select_own_or_admin on public.messages;
create policy messages_select_own_or_admin on public.messages
  for select using (
    public.is_admin()
    or recipient_id = (select u.id from public.users u where u.auth_user_id = auth.uid())
    or sender_id    = (select u.id from public.users u where u.auth_user_id = auth.uid())
    or public.is_reply_to_my_message(parent_id)
  );
