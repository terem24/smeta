-- «Один расчёт»: оплата (900 ₽) даёт кредит на одну смету, а не срок Профи.
-- Строка без calc_id — неиспользованный кредит. Человек тратит его кнопкой «Открыть Профи для
-- этого объекта»: функция unlock_pro_object привязывает кредит к calc_id сметы, фиксирует
-- отпечаток объекта (sig: площадь, город, этажность) и ставит окно правок (по умолчанию 30 дней,
-- настраивается полем «Дней на правки» у тарифа в «Оплата подписки»).
-- Клиент сверяет текущую смету с sig: площадь ±30 %, тот же город, этажность ±1, иначе Профи
-- в этой смете закрывается («это другой объект»). Сверка идёт в браузере (app.objectMatchesSig).
-- Кредиты начисляет владелец при подтверждении оплаты (политика admin_all); клиент их только
-- читает и тратит через функцию, напрямую писать в таблицу не может.
-- Уже выполнено в Supabase 23.10.2026 (проект stout-calc); revoke от anon выполнен отдельной строкой ниже.
create table if not exists public.pro_objects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  granted_at timestamptz not null default now(),
  granted_by text,
  payment_id uuid,                 -- заявка в subscription_payments, по которой начислен кредит
  calc_id text,                    -- смета, для которой потрачен кредит; null — кредит свободен
  unlocked_at timestamptz,
  expires_at timestamptz,          -- конец окна правок
  sig jsonb,                       -- { area, city, floors } на момент открытия
  note text
);
comment on table public.pro_objects is 'Кредиты «Один расчёт» и сметы, для которых они потрачены (Профи на один объект).';
create index if not exists pro_objects_user_idx on public.pro_objects (user_id);
create index if not exists pro_objects_calc_idx on public.pro_objects (user_id, calc_id);

alter table public.pro_objects enable row level security;

-- Человек видит только свои строки
drop policy if exists pro_objects_select_own on public.pro_objects;
create policy pro_objects_select_own on public.pro_objects
  for select to authenticated
  using (user_id in (select id from public.users where auth_user_id = auth.uid()));

-- Начислять, править и удалять — только администратор
drop policy if exists pro_objects_admin_all on public.pro_objects;
create policy pro_objects_admin_all on public.pro_objects
  for all to authenticated using (is_admin()) with check (is_admin());

-- Потратить кредит на смету. Возвращает конец окна правок.
-- Если для этой сметы окно ещё идёт, кредит не тратится повторно.
create or replace function public.unlock_pro_object(p_calc_id text, p_sig jsonb default null)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  exp timestamptz;
  cid uuid;
  win integer;
begin
  select id into uid from public.users where auth_user_id = auth.uid();
  if uid is null then
    raise exception 'Войдите в аккаунт' using errcode = '42501';
  end if;
  if coalesce(trim(p_calc_id), '') = '' then
    raise exception 'Сначала сохраните смету' using errcode = '22023';
  end if;
  if coalesce((p_sig ->> 'area')::numeric, 0) <= 0 then
    raise exception 'Укажите площадь дома: по ней фиксируется объект' using errcode = '22023';
  end if;

  select max(expires_at) into exp
    from public.pro_objects
   where user_id = uid and calc_id = p_calc_id and expires_at > now();
  if exp is not null then return exp; end if;

  select id into cid
    from public.pro_objects
   where user_id = uid and calc_id is null
   order by granted_at
   limit 1
   for update skip locked;
  if cid is null then
    raise exception 'Нет оплаченных расчётов' using errcode = 'P0001';
  end if;

  -- Окно правок — из включённого тарифа «Один расчёт»: любой тариф с days > 0 в настройках
  select min((p.value ->> 'days')::integer) into win
    from public.app_settings s, jsonb_each(s.value -> 'plans') p
   where s.key = 'subscription'
     and coalesce((p.value ->> 'enabled')::boolean, true)
     and coalesce((p.value ->> 'days')::integer, 0) > 0;
  win := greatest(1, least(coalesce(win, 30), 366));

  update public.pro_objects
     set calc_id = p_calc_id, unlocked_at = now(), expires_at = now() + make_interval(days => win), sig = p_sig
   where id = cid
   returning expires_at into exp;
  return exp;
end;
$$;

revoke all on function public.unlock_pro_object(text, jsonb) from public;
revoke execute on function public.unlock_pro_object(text, jsonb) from anon;
grant execute on function public.unlock_pro_object(text, jsonb) to authenticated;
