-- estimates: закрытие открытого чтения и вставки.
-- Раньше «Разрешить чтение смет» (using true) отдавал все сметы (с calc_data — составы, цены,
-- адреса, заказчики) любому, даже без входа, а «Разрешить сохранение новых смет»
-- (with check true) позволял записать смету от имени любого user_id.
-- Важно: estimates.user_id — это users.id, а не auth-id, поэтому прежняя «своя» политика
-- (auth.uid() = user_id) не срабатывала никогда, всё делал открытый true.
-- Теперь читает владелец, администратор и менеджер/наблюдатель по монтажникам своей компании;
-- вставлять — только свои (user_id = my_users_id()) или админ.
-- «Загрузить расчёт по коду» (loadFromCode) идёт через load_estimate_by_code(text).
-- Выполнять ПОСЛЕ публикации app.js с вызовом load_estimate_by_code.

create or replace function public.my_users_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id from public.users u where u.auth_user_id = auth.uid() limit 1;
$$;

create or replace function public.can_read_estimate_owner(owner_users_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select owner_users_id is not null and (
    owner_users_id = public.my_users_id()
    or exists (
      select 1 from public.users u
       where u.id = owner_users_id and public.can_read_invoice_owner(u.auth_user_id)
    )
  );
$$;

create or replace function public.load_estimate_by_code(p_code text)
returns table(id uuid, calc_data jsonb, user_id uuid, username text)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.calc_data, e.user_id, u.username
    from public.estimates e
    left join public.users u on u.id = e.user_id
   where e.share_id = p_code
   order by e.created_at asc
   limit 1;
$$;
revoke all on function public.load_estimate_by_code(text) from public;
grant execute on function public.load_estimate_by_code(text) to anon, authenticated;

drop policy if exists "Разрешить чтение смет" on public.estimates;
drop policy if exists "Users can view their own estimates" on public.estimates;
drop policy if exists "Admins can view all estimates" on public.estimates;
drop policy if exists estimates_select_scoped on public.estimates;
create policy estimates_select_scoped on public.estimates
  for select
  using (public.is_admin() or public.can_read_estimate_owner(user_id));

drop policy if exists "Разрешить сохранение новых смет" on public.estimates;
drop policy if exists estimates_insert_own on public.estimates;
create policy estimates_insert_own on public.estimates
  for insert to authenticated
  with check (public.is_admin() or user_id = public.my_users_id());
