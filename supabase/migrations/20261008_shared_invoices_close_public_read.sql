-- shared_invoices: закрытие открытого чтения и анонимного UPDATE.
-- Раньше «Allow public read access» (using true) отдавал все 99 смет любому, даже без входа,
-- а «anon can update shared_invoices status» (using true) позволял переписать любую смету.
-- Теперь:
--  · страница клиента (invoice.html) читает КП по номеру ссылки через get_shared_invoice(uuid)
--    (security definer; id — случайный uuid, как «ссылка с секретом»), статус пишет через
--    set_shared_invoice_status — оба уже в базе;
--  · напрямую таблицу читает владелец (user_id = auth.uid()), администратор и менеджер/
--    наблюдатель по монтажникам своей компании (как в users_select_scoped);
--  · анонимная вставка (offline-запасной путь клиента) оставлена — отдельная задача.
--
-- ВЫПОЛНЯТЬ ТОЛЬКО ПОСЛЕ публикации invoice.html с вызовом get_shared_invoice, иначе
-- уже открытые у клиентов страницы со старым прямым select перестанут грузить смету.

create or replace function public.can_read_invoice_owner(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select uid is not null and exists (
    select 1 from public.users u
     where u.auth_user_id = uid
       and public.can_read_user(u.auth_user_id, u.email, u.work_email, u.distributor_id, u.viewer_distributor_ids)
  );
$$;

drop policy if exists "Allow public read access" on public.shared_invoices;
drop policy if exists "anon can update shared_invoices status" on public.shared_invoices;
drop policy if exists shared_invoices_select_scoped on public.shared_invoices;

create policy shared_invoices_select_scoped on public.shared_invoices
  for select to authenticated
  using (public.is_admin() or user_id = auth.uid() or public.can_read_invoice_owner(user_id));
