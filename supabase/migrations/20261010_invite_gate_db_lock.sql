-- Замок закрытой регистрации на стороне базы.
-- Окно «Нужен промокод магазина» закрывает калькулятор только в браузере: учётку Яндекс ID /
-- Google база создаёт и без промокода, а окно можно убрать через консоль. Поэтому, пока
-- регистрация «по приглашению», вошедший без дистрибьютора не может создавать сметы,
-- ссылки клиенту и проекты. Ограничение только добавляется (RESTRICTIVE) и существующие
-- политики не меняет. Гостей без входа (ссылки на смету) оно не касается.
create or replace function public.invite_gate_blocks_me()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select auth.uid() is not null
    and coalesce((select value->>'mode' from public.app_settings where key = 'registration'), 'open') = 'invite'
    and exists (
      select 1 from public.users u
      where u.auth_user_id = auth.uid()
        and u.registered_at is not null
        and u.distributor_id is null
        and u.account_type in ('free', 'base')
    );
$$;

revoke all on function public.invite_gate_blocks_me() from public, anon;
grant execute on function public.invite_gate_blocks_me() to authenticated;

drop policy if exists invite_gate_estimates on public.estimates;
create policy invite_gate_estimates on public.estimates
  as restrictive for insert to authenticated
  with check (not public.invite_gate_blocks_me());

drop policy if exists invite_gate_shared_invoices on public.shared_invoices;
create policy invite_gate_shared_invoices on public.shared_invoices
  as restrictive for insert to authenticated
  with check (not public.invite_gate_blocks_me());

drop policy if exists invite_gate_projects on public.projects;
create policy invite_gate_projects on public.projects
  as restrictive for insert to authenticated
  with check (not public.invite_gate_blocks_me());
