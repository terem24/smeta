-- Лента заявок на монтаж для мастеров на тарифе Профи.
--
-- Откуда заявки. Форма на /dom/ и на странице монтажа пишет заявку в журнал на Beget
-- (lead.php) и шлёт владельцу в Телеграм. Владелец во вкладке «Заявки» нажимает
-- «Предложить Профи-мастерам» — заявка попадает сюда. Автоматически ничего не уходит:
-- владелец сам отсекает тестовые и мусорные заявки, а мастер платит не за мусор.
--
-- Как устроено, чтобы не нарушить согласие заказчика (soglasie-zayavka.html, п. 5:
-- данные получает ОДИН мастер, который берёт заявку в работу).
--   lead_board    — витрина: место (без улицы и дома), площадь, виды работ. Её видит
--                   любой вошедший, контактов здесь нет.
--   lead_contacts — имя, телефон, комментарий, ссылка на расчёт. Напрямую не читается
--                   никем, кроме администратора. Мастер получает контакты только
--                   ответом функции lead_take, и только если заявка ещё свободна:
--                   «взять» — одной транзакцией, второй мастер получит отказ.
--
-- Кто может брать (lead_access): монтажник (сфера «Монтажник») в Санкт-Петербурге
-- или Ленинградской области на ПЛАТНОМ Профи — pro_expires_at проставлен (оплата) или
-- есть привязка к магазину (distributor_id). Чистый пробный период не даёт брать:
-- иначе заявки раздавались бы тем, кто не платит и не вернётся. Администратор может
-- всегда (для проверки). Не больше 3 заявок за сутки на одного мастера.
--
-- Отметки мастера («связался», «договор», «смонтировано», «отказ») пишутся в
-- существующую lead_assignments — владелец видит их во вкладке «Заявки» как раньше.
--
-- Выполнить в Supabase SQL Editor целиком (повторный запуск безопасен).

create table if not exists public.lead_board (
  lead_id      text primary key,                 -- id заявки из журнала Beget
  published_at timestamptz not null default now(),
  place        text not null,                    -- населённый пункт, без улицы и дома
  area         integer,
  works        text[] not null default '{}',     -- heating | ufh | boiler | water | sewer | other
  status       text not null default 'open',     -- open | taken | closed
  taken_by     uuid references public.users(id) on delete set null,
  taken_at     timestamptz
);

create table if not exists public.lead_contacts (
  lead_id   text primary key references public.lead_board(lead_id) on delete cascade,
  name      text not null,
  phone     text not null,
  when_call text,
  comment   text,
  calc      text                                  -- ответы заказчика для ссылки ?opros=
);

alter table public.lead_board    enable row level security;
alter table public.lead_contacts enable row level security;

drop policy if exists lead_board_read on public.lead_board;
create policy lead_board_read on public.lead_board
  for select to authenticated using (true);

drop policy if exists lead_board_admin on public.lead_board;
create policy lead_board_admin on public.lead_board
  for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists lead_contacts_admin on public.lead_contacts;
create policy lead_contacts_admin on public.lead_contacts
  for all to authenticated using (is_admin()) with check (is_admin());

-- Кто я и могу ли брать заявки. Ответ: {can, reason, user_id, name}
-- reason: ok | admin | no_user | blocked | not_installer | region | not_pro | trial
create or replace function public.lead_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  u record;
  nm text;
begin
  select * into u from public.users where auth_user_id = auth.uid() limit 1;
  if not found then
    return jsonb_build_object('can', false, 'reason', 'no_user');
  end if;
  nm := coalesce(nullif(trim(coalesce(u.last_name, '') || ' ' || coalesce(u.first_name, '')), ''), u.username, 'мастер');
  if public.is_admin() then
    return jsonb_build_object('can', true, 'reason', 'admin', 'user_id', u.id, 'name', nm);
  end if;
  if coalesce(u.is_blocked, false) or u.frozen_at is not null then
    return jsonb_build_object('can', false, 'reason', 'blocked');
  end if;
  if not ('Монтажник' = any(coalesce(u.activity_types, '{}'))) then
    return jsonb_build_object('can', false, 'reason', 'not_installer');
  end if;
  if coalesce(u.region, '') not in ('Санкт-Петербург', 'Ленинградская область') then
    return jsonb_build_object('can', false, 'reason', 'region');
  end if;
  if u.account_type <> 'pro' or (u.demo_ends_at is not null and u.demo_ends_at <= now()) then
    return jsonb_build_object('can', false, 'reason', 'not_pro');
  end if;
  if u.pro_expires_at is null and u.distributor_id is null then
    return jsonb_build_object('can', false, 'reason', 'trial');
  end if;
  return jsonb_build_object('can', true, 'reason', 'ok', 'user_id', u.id, 'name', nm);
end;
$$;

-- Взять заявку. Успех: {ok:true, name, phone, when_call, comment, calc}.
-- Отказ: {ok:false, reason: not_allowed | gone | limit}
create or replace function public.lead_take(p_lead text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  acc jsonb := public.lead_access();
  me uuid;
  nm text;
  n int;
  b record;
  c record;
begin
  if not coalesce((acc ->> 'can')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed', 'why', acc ->> 'reason');
  end if;
  me := (acc ->> 'user_id')::uuid;
  nm := acc ->> 'name';

  select count(*) into n from public.lead_board
   where taken_by = me and taken_at > now() - interval '24 hours';
  if n >= 3 and (acc ->> 'reason') <> 'admin' then
    return jsonb_build_object('ok', false, 'reason', 'limit');
  end if;

  update public.lead_board
     set status = 'taken', taken_by = me, taken_at = now()
   where lead_id = p_lead and status = 'open'
   returning * into b;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;

  insert into public.lead_assignments (lead_id, installer_id, installer_name, status, updated_at)
  values (p_lead, me, nm, 'sent', now())
  on conflict (lead_id) do update
    set installer_id = excluded.installer_id, installer_name = excluded.installer_name,
        status = 'sent', updated_at = now();

  select * into c from public.lead_contacts where lead_id = p_lead;
  return jsonb_build_object('ok', true, 'name', c.name, 'phone', c.phone,
                            'when_call', c.when_call, 'comment', c.comment, 'calc', c.calc);
end;
$$;

-- Мои взятые заявки с контактами. Читается по факту взятия, а не по тарифу сегодня:
-- кончился Профи — взятая заявка у мастера остаётся.
create or replace function public.lead_mine()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'lead_id', b.lead_id, 'taken_at', b.taken_at, 'place', b.place, 'area', b.area, 'works', b.works,
           'name', c.name, 'phone', c.phone, 'when_call', c.when_call, 'comment', c.comment, 'calc', c.calc,
           'mark', coalesce(a.status, 'sent'))
         order by b.taken_at desc), '[]'::jsonb)
  from public.lead_board b
  join public.lead_contacts c on c.lead_id = b.lead_id
  left join public.lead_assignments a on a.lead_id = b.lead_id
  where b.taken_by = (select id from public.users where auth_user_id = auth.uid() limit 1);
$$;

-- Отметка мастера по своей заявке: contacted | contract | done | rejected
create or replace function public.lead_mark(p_lead text, p_status text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid;
begin
  if p_status not in ('contacted', 'contract', 'done', 'rejected') then
    return false;
  end if;
  select id into me from public.users where auth_user_id = auth.uid() limit 1;
  if me is null or not exists (select 1 from public.lead_board where lead_id = p_lead and taken_by = me) then
    return false;
  end if;
  update public.lead_assignments set status = p_status, updated_at = now() where lead_id = p_lead;
  return true;
end;
$$;

revoke all on function public.lead_access() from public;
revoke all on function public.lead_take(text) from public;
revoke all on function public.lead_mine() from public;
revoke all on function public.lead_mark(text, text) from public;
grant execute on function public.lead_access() to authenticated;
grant execute on function public.lead_take(text) to authenticated;
grant execute on function public.lead_mine() to authenticated;
grant execute on function public.lead_mark(text, text) to authenticated;
