-- Закрытие чтения users: политика «Разрешить чтение пользователей» (using true) отдавала
-- всем, в том числе без входа, телефоны, почты, даты рождения, IP, токены Telegram и
-- отписки. Теперь строку видит: она сама (по auth_user_id или почте из токена),
-- администратор (is_admin()), менеджер/наблюдатель — по своей компании и их монтажникам
-- (как считает resolveAdminScope в app.js), монтажник — карточку своего менеджера (чат).
-- Функция security definer, чтобы читать users без рекурсии политики.
-- Уже выполнено в Supabase 08.10.2026.
-- Проверено: anon=0, админ=82, монтажник=1 (+менеджер), менеджеры — по своим компаниям.

create or replace function public.can_read_user(
  r_auth uuid, r_email text, r_work text, r_dist uuid, r_viewer uuid[]
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me record;
  scope uuid[];
  jemail text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if auth.uid() is null then return false; end if;
  if r_auth = auth.uid() then return true; end if;
  if jemail is not null and lower(coalesce(r_email, '')) = jemail then return true; end if;
  if public.is_admin() then return true; end if;

  select u.id, u.email, u.work_email, u.account_type, u.distributor_id, u.viewer_distributor_ids
    into me from public.users u where u.auth_user_id = auth.uid() limit 1;
  if not found then return false; end if;

  if me.account_type in ('manager', 'viewer') then
    select coalesce(array_agg(distinct s.id), '{}'::uuid[]) into scope from (
      select unnest(coalesce(me.viewer_distributor_ids, '{}'::uuid[])) as id where me.account_type = 'viewer'
      union
      select me.distributor_id where me.account_type = 'manager' and me.distributor_id is not null
      union
      select d.id from public.distributors d
       where nullif(lower(d.manager_email), '')  in (nullif(lower(me.email), ''), nullif(lower(me.work_email), ''))
          or nullif(lower(d.director_email), '') in (nullif(lower(me.email), ''), nullif(lower(me.work_email), ''))
    ) s where s.id is not null;
    if r_dist = any(scope) then return true; end if;
    if r_viewer && scope then return true; end if;
  end if;

  if me.distributor_id is not null and exists (
    select 1 from public.distributors d
     where d.id = me.distributor_id
       and ( nullif(lower(d.manager_email), '')  in (nullif(lower(r_email), ''), nullif(lower(r_work), ''))
          or nullif(lower(d.director_email), '') in (nullif(lower(r_email), ''), nullif(lower(r_work), '')) )
  ) then return true; end if;

  return false;
end;
$$;

drop policy if exists "Разрешить чтение пользователей" on public.users;
drop policy if exists users_select_scoped on public.users;
create policy users_select_scoped on public.users
  for select using (
    public.can_read_user(auth_user_id, email, work_email, distributor_id, viewer_distributor_ids)
  );
