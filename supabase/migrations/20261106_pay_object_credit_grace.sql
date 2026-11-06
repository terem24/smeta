-- «Я оплатил» по тарифу «Один расчёт» → сразу кредит на объект, а не Профи на 24 часа.
--
-- ЗАЧЕМ. Раньше любая заявка «Я оплатил» включала Профи на весь аккаунт на 24 часа
-- (pay_request_grace, 20261105). Для «Одного расчёта» это работало плохо:
--   • сразу после оплаты срабатывали напоминания «Профи истекает менее чем через 24 часа»
--     и «Последний день пробного Профи» — человек только что заплатил, а его пугают;
--   • после подтверждения кредит в pro_objects появлялся, а 24 часа на аккаунте продолжали
--     тикать и заканчивались теми же напоминаниями.
-- Теперь по «Одному расчёту» заявка сразу кладёт кредит в pro_objects (granted_by = 'grace',
-- payment_id = заявка). Человек открывает Профи для своей сметы на полное окно правок
-- (30 дней по настройке тарифа), срок аккаунта (demo_ends_at) не трогается вовсе.
--   • Подтвердили оплату — кредит остаётся (второй не начисляется), granted_by меняется на
--     того, кто подтвердил.
--   • Отклонили — неиспользованный кредит удаляется, уже открытая смета закрывается
--     (expires_at = now()).
-- Защита от злоупотреблений та же: одна неподтверждённая заявка с авансом на 60 дней.
-- Тарифы со сроком (месяц, год) работают как раньше — 24 часа Профи.

alter table public.subscription_payments
    add column if not exists grace_object boolean not null default false;  -- по заявке выдан кредит «Один расчёт» авансом

create or replace function public.pay_request_grace(
    p_email text, p_plan text, p_months integer, p_rub numeric, p_promo text, p_region text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    u public.users%rowtype;
    v_until timestamptz := now() + interval '24 hours';
    v_recent integer;
    v_grant boolean;
    v_object boolean;
    v_days integer;
    v_id uuid;
begin
    if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
    select * into u from public.users where auth_user_id = auth.uid() limit 1;
    if not found then return jsonb_build_object('ok', false, 'reason', 'nouser'); end if;

    select nullif(value #>> array['plans', coalesce(left(p_plan, 24), ''), 'days'], '')::numeric::integer
      into v_days from public.app_settings where key = 'subscription';
    v_object := coalesce(v_days, 0) > 0;

    select count(*) into v_recent from public.subscription_payments
     where user_id = u.id and (grace_until is not null or grace_object) and status <> 'paid'
       and created_at > now() - interval '60 days';

    v_grant := v_recent = 0
        and not coalesce(u.is_blocked, false) and u.frozen_at is null
        -- Для срочного тарифа 24 часа не нужны тому, у кого Профи и так дольше суток;
        -- кредит на объект выдаём всегда — он не зависит от срока аккаунта
        and (v_object or u.demo_ends_at is null or u.demo_ends_at < v_until);

    insert into public.subscription_payments
        (email, user_id, plan, months, rub, promo, region, status, source, grace_until, grace_prev_ends, grace_object)
    values
        (lower(nullif(trim(p_email), '')), u.id, left(p_plan, 24), p_months, p_rub, left(p_promo, 120),
         coalesce(nullif(left(p_region, 120), ''), u.region), 'requested', 'site',
         case when v_grant and not v_object then v_until end,
         case when v_grant and not v_object then u.demo_ends_at end,
         v_grant and v_object)
    returning id into v_id;

    if v_grant and v_object then
        insert into public.pro_objects (user_id, payment_id, granted_by) values (u.id, v_id, 'grace');
    elsif v_grant then
        update public.users
           set demo_ends_at = v_until,
               account_type = case when account_type in ('admin', 'viewer', 'manager') then account_type else 'pro' end
         where id = u.id;
    end if;

    return jsonb_build_object(
        'ok', true, 'id', v_id, 'granted', v_grant, 'object', v_object,
        'until', case when v_grant and not v_object then v_until end,
        'reason', case when v_grant then null
                       when v_recent > 0 then 'recent'
                       when u.demo_ends_at >= v_until then 'active'
                       else 'blocked' end);
end $$;

revoke all on function public.pay_request_grace(text, text, integer, numeric, text, text) from public, anon;
grant execute on function public.pay_request_grace(text, text, integer, numeric, text, text) to authenticated;


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
            -- Кредит выдан авансом при заявке — второй не начисляем
            if exists (select 1 from public.pro_objects where payment_id = r.id) then
                update public.pro_objects set granted_by = 'telegram' where payment_id = r.id;
            else
                insert into public.pro_objects (user_id, payment_id, granted_by) values (u.id, r.id, 'telegram');
            end if;
            -- Старые заявки (до этой миграции) включали 24 часа Профи на аккаунт — снимаем их,
            -- чтобы не тикали напоминания «Профи заканчивается»: у человека теперь кредит на объект
            if r.grace_until is not null and r.grace_until > now() then
                v_end := case when r.grace_prev_ends is not null and r.grace_prev_ends > now() then r.grace_prev_ends else now() end;
                update public.users set demo_ends_at = v_end where id = u.id;
            end if;
            v_text := 'Оплата подтверждена ✅ Профи для одного объекта ваш. Если ещё не открыли — откройте смету и нажмите «Открыть Профи для этого объекта» в окне тарифа.';
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
        -- Кредит «Один расчёт», выданный авансом: свободный — удалить, потраченный — закрыть
        delete from public.pro_objects where payment_id = r.id and calc_id is null;
        update public.pro_objects set expires_at = now() where payment_id = r.id and calc_id is not null and expires_at > now();
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
