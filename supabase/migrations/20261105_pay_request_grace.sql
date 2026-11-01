-- «Я оплатил» → Профи сразу на 24 часа, пока владелец проверяет поступление.
--
-- ЗАЧЕМ. Раньше после оплаты человек ждал ручной проверки и в это время передумывал
-- или пугался, что деньги ушли в никуда. Теперь кнопка «Я оплатил» (app.js,
-- notifyPayment) зовёт pay_request_grace: заявка пишется в subscription_payments, как
-- и раньше, и Профи включается на 24 часа. Владелец подтверждает оплату во вкладке
-- «Оплата подписки» — Профи продлевается на оплаченный срок от прежнего (grace_prev_ends),
-- без лишних суток; отклоняет — 24 часа снимаются.
--
-- ЗАЩИТА ОТ ЗЛОУПОТРЕБЛЕНИЙ. Только вошедший пользователь. Не чаще одного раза за 60 дней,
-- пока прошлая такая заявка не подтверждена оплатой (requested/rejected — второй раз не
-- дадим, заявка всё равно запишется). Заблокированному и приостановленному — нет. Тому,
-- у кого Профи и так действует дольше суток, срок не трогаем.
--
-- users_guard_privileged пропускает изменение: функция security definer, current_user —
-- владелец функции, а не authenticated.

alter table public.subscription_payments
    add column if not exists grace_until timestamptz,      -- до когда включён Профи по этой заявке
    add column if not exists grace_prev_ends timestamptz;  -- demo_ends_at до включения (база для продления)

create or replace function public.pay_request_grace(
    p_email text, p_plan text, p_months integer, p_rub numeric, p_promo text, p_region text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    u public.users%rowtype;
    v_until timestamptz := now() + interval '24 hours';
    v_recent integer;
    v_grant boolean;
    v_id uuid;
begin
    if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
    select * into u from public.users where auth_user_id = auth.uid() limit 1;
    if not found then return jsonb_build_object('ok', false, 'reason', 'nouser'); end if;

    select count(*) into v_recent from public.subscription_payments
     where user_id = u.id and grace_until is not null and status <> 'paid'
       and created_at > now() - interval '60 days';

    v_grant := v_recent = 0
        and not coalesce(u.is_blocked, false) and u.frozen_at is null
        and (u.demo_ends_at is null or u.demo_ends_at < v_until);

    insert into public.subscription_payments
        (email, user_id, plan, months, rub, promo, region, status, source, grace_until, grace_prev_ends)
    values
        (lower(nullif(trim(p_email), '')), u.id, left(p_plan, 24), p_months, p_rub, left(p_promo, 120),
         coalesce(nullif(left(p_region, 120), ''), u.region), 'requested', 'site',
         case when v_grant then v_until end, case when v_grant then u.demo_ends_at end)
    returning id into v_id;

    if v_grant then
        update public.users
           set demo_ends_at = v_until,
               account_type = case when account_type in ('admin', 'viewer', 'manager') then account_type else 'pro' end
         where id = u.id;
    end if;

    return jsonb_build_object(
        'ok', true, 'id', v_id, 'granted', v_grant,
        'until', case when v_grant then v_until end,
        'reason', case when v_grant then null
                       when v_recent > 0 then 'recent'
                       when u.demo_ends_at >= v_until then 'active'
                       else 'blocked' end);
end $$;

revoke all on function public.pay_request_grace(text, text, integer, numeric, text, text) from public, anon;
grant execute on function public.pay_request_grace(text, text, integer, numeric, text, text) to authenticated;
