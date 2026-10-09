-- projects: раньше UPDATE разрешался любому вошедшему на любую строку (using true), а INSERT
-- (with check true) — с любой почтой автора. Теперь писать и обновлять можно только строки со
-- своей почтой автора (user_email = почта из токена, users.email или users.work_email) либо
-- администратору. Чтение у projects и так только у админа/наблюдателя.
-- Клиент (logProjectSheets в app.js) пишет upsert по calc_id с user_email своей учётки —
-- работает как раньше; при совпадении calc_id с чужим проектом запись молча не пройдёт.
-- Уже выполнено в Supabase 08.10.2026.

create or replace function public.is_my_email(e text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select nullif(lower(coalesce(e, '')), '') is not null and (
    lower(e) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or exists (
      select 1 from public.users u
       where u.auth_user_id = auth.uid()
         and lower(e) in (lower(coalesce(u.email, '')), lower(coalesce(u.work_email, '')))
    )
  );
$$;

drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;

create policy projects_insert_own on public.projects
  for insert to authenticated
  with check (public.is_admin() or user_email is null or public.is_my_email(user_email));

create policy projects_update_own on public.projects
  for update to authenticated
  using (public.is_admin() or public.is_my_email(user_email))
  with check (public.is_admin() or public.is_my_email(user_email));

-- Свои строки читать можно: без этого повторный выпуск (upsert по calc_id) у обычного
-- пользователя не мог обновить собственную запись — Postgres сверяет её с политикой чтения.
drop policy if exists projects_select_own on public.projects;
create policy projects_select_own on public.projects
  for select to authenticated
  using (public.is_my_email(user_email));
