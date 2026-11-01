-- Подтверждение оплаты Профи кнопками в Telegram.
--
-- ЗАЧЕМ. Заявка «Я оплатил» приходит владельцу в бот монтажников с кнопками «✅ Оплачено»
-- и «✗ Отклонить» (функция pay-notify). Нажатие ловит tg-webhook и зовёт pay_confirm_tg —
-- те же правила, что у кнопок во вкладке «Оплата подписки» (subscription.js: confirmPaid,
-- rejectRequest):
--   • оплачено, тариф со сроком (месяц, год) — Профи продлевается на months месяцев от
--     прежнего срока (если заявка включала 24 часа — от срока до них), пишутся
--     demo_ends_at и pro_expires_at, тип учётки — pro (админу/менеджеру/наблюдателю не трогаем);
--   • оплачено, «Один расчёт» (у тарифа days > 0) — кредит в pro_objects;
--   • отклонено — 24 часа по заявке снимаются (прежний срок, если ещё идёт, иначе сейчас).
-- Человеку в «Сообщения» уходит строка об итоге — от имени администратора.
--
-- Вызывает только сервер (service_role): у браузера права нет.

alter table public.subscription_payments
    add column if not exists tg_notified_at timestamptz;   -- когда заявка ушла владельцу в бот с кнопками

create or replace function public.pay_confirm_tg(p_id uuid, p_ok boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    r public.subscription_payments%rowtype;
    u public.users%rowtype;
    v_admin uuid;
    v_days integer;
    v_base timestamptz;
    v_until timestamptz;
    v_end timestamptz;
    v_months integer;
    v_text text;
begin
    select * into r from public.subscription_payments where id = p_id for update;
    if not found then return jsonb_build_object('ok', false, 'reason', 'notfound'); end if;
    if r.status <> 'requested' then return jsonb_build_object('ok', false, 'reason', 'done', 'status', r.status); end if;

    select * into u from public.users
     where (r.user_id is not null and id = r.user_id)
        or (r.user_id is null and r.email is not null and lower(email) = lower(r.email))
     limit 1;
    select id into v_admin from public.users where lower(email) = 'kovdor24@yandex.ru' limit 1;

    if p_ok then
        if u.id is null then return jsonb_build_object('ok', false, 'reason', 'nouser'); end if;
        select nullif(value #>> array['plans', coalesce(r.plan, ''), 'days'], '')::numeric::integer
          into v_days from public.app_settings where key = 'subscription';
        if coalesce(v_days, 0) > 0 then
            insert into public.pro_objects (user_id, payment_id, granted_by) values (u.id, r.id, 'telegram');
            v_text := 'Оплата подтверждена ✅ Профи для одного объекта начислен: откройте смету и нажмите «Открыть Профи для этого объекта» в окне тарифа.';
        else
            v_months := greatest(1, coalesce(r.months, 1));
            v_base := case when r.grace_until is not null then r.grace_prev_ends else u.demo_ends_at end;
            if v_base is null or v_base < now() or v_base > '2090-01-01'::timestamptz then v_base := now(); end if;
            v_until := v_base + make_interval(months => v_months);
            update public.users
               set demo_ends_at = v_until, pro_expires_at = v_until,
                   account_type = case when account_type in ('admin', 'viewer', 'manager') then account_type else 'pro' end
             where id = u.id;
            v_text := 'Оплата подтверждена ✅ Профи продлён до ' || to_char(v_until at time zone 'Europe/Moscow', 'DD.MM.YYYY') || '. Спасибо!';
        end if;
        update public.subscription_payments
           set status = 'paid', paid_at = now(), paid_rub = coalesce(r.rub, paid_rub), months = coalesce(v_months, r.months),
               pro_until = v_until, confirmed_by = 'telegram', user_id = coalesce(r.user_id, u.id)
         where id = r.id;
    else
        if u.id is not null and r.grace_until is not null and r.grace_until > now() then
            v_end := case when r.grace_prev_ends is not null and r.grace_prev_ends > now() then r.grace_prev_ends else now() end;
            update public.users set demo_ends_at = v_end where id = u.id;
        end if;
        update public.subscription_payments set status = 'rejected', confirmed_by = 'telegram' where id = r.id;
        v_text := 'Мы не нашли вашу оплату Профи. Если вы уже перевели деньги — ответьте на это сообщение или напишите на kovdor24@yandex.ru, разберёмся в тот же день.';
    end if;

    if u.id is not null and v_admin is not null then
        insert into public.messages (sender_id, recipient_id, text, type) values (v_admin, u.id, v_text, 'private');
    end if;

    return jsonb_build_object('ok', true, 'paid', p_ok, 'until', v_until, 'object', coalesce(v_days, 0) > 0,
        'who', coalesce(nullif(trim(concat_ws(' ', u.last_name, u.first_name)), ''), u.email, r.email));
end $$;

revoke all on function public.pay_confirm_tg(uuid, boolean) from public, anon, authenticated;
grant execute on function public.pay_confirm_tg(uuid, boolean) to service_role;
