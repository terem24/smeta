-- Приглашения от менеджеров магазинов, часть 2 из 2: функции.
--
-- Две функции, обе security definer (работают от имени базы, а не вызывающего):
--
--   check_invite_code(code) — только посмотреть. Нужна ДО регистрации: у человека
--       ещё нет сессии, а таблицу компаний анониму читать нельзя. Отдаёт ровно то,
--       что можно показать на плашке «Вас пригласил магазин …»: название, имя
--       менеджера, месяцы Профи, занято мест и лимит. Ничего не меняет.
--
--   apply_invite_code(code) — привязать себя к компании по промокоду. Заменяет
--       прямой update таблицы users из приложения (applyPromoCode и
--       applyPromoFromRegistration в app.js). Проверка лимита и сама привязка
--       идут одной транзакцией с блокировкой строки компании: два монтажника,
--       нажавшие «Применить» в одну секунду, не проскочат вдвоём через последнее
--       свободное место. На клиенте такую проверку сделать нельзя.
--
-- Тариф выдаётся так же, как раньше делало приложение: pro_months > 0 даёт
-- account_type = 'pro' и demo_ends_at через N × 30 дней. Ноль — только привязка.
-- distributor_assigned_at ставит существующий триггер stamp_distributor_assigned_at.
--
-- КОГО НЕ СЧИТАЕМ ЗАНЯТЫМ МЕСТОМ. У менеджера магазина в той же карточке стоит тот
-- же distributor_id (для него это «моя компания»). Служебные роли — admin, viewer,
-- manager — в счётчик не входят, иначе менеджер занимал бы место сам у себя.
--
-- Ручная привязка администратором из панели остаётся прямым update и лимит не
-- проверяет — это осознанно: администратор может добавить сверх лимита.
--
-- Выполнить вручную в Supabase SQL Editor, весь файл целиком за один раз,
-- ПОСЛЕ части 1 (20260911_shop_invites_1_columns.sql).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Проверка кода без входа.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.check_invite_code(code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    d      public.distributors%rowtype;
    used   integer;
begin
    select * into d
      from public.distributors
     where promo_code = upper(btrim(coalesce(code, '')))
       and is_active = true
     limit 1;

    if not found then
        return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    if d.valid_until is not null and d.valid_until < now() then
        return jsonb_build_object('ok', false, 'reason', 'expired',
                                  'company_name', d.company_name);
    end if;

    select count(*) into used
      from public.users
     where distributor_id = d.id
       and coalesce(account_type, '') not in ('admin', 'viewer', 'manager');

    return jsonb_build_object(
        'ok',           used < coalesce(d.invite_limit, 5),
        'reason',       case when used < coalesce(d.invite_limit, 5) then null else 'limit' end,
        'company_name', d.company_name,
        'manager_name', d.manager_name,
        'pro_months',   coalesce(d.pro_months, 0),
        'used',         used,
        'limit',        coalesce(d.invite_limit, 5)
    );
end;
$$;

grant execute on function public.check_invite_code(text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Привязка себя по коду. Только для вошедших: кто «я» — берётся из сессии
--    (auth.uid()), а не из параметров, поэтому привязать чужую учётку нельзя.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.apply_invite_code(code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    d        public.distributors%rowtype;
    u        public.users%rowtype;
    used     integer;
    months   integer;
    pro_end  timestamptz;
begin
    if auth.uid() is null then
        return jsonb_build_object('ok', false, 'reason', 'no_session');
    end if;

    select * into u from public.users where auth_user_id = auth.uid() limit 1;
    if not found then
        return jsonb_build_object('ok', false, 'reason', 'no_user_row');
    end if;

    -- Строка компании блокируется до конца транзакции: параллельный вызов с тем
    -- же кодом дождётся и пересчитает занятые места уже с учётом этой привязки.
    select * into d
      from public.distributors
     where promo_code = upper(btrim(coalesce(code, '')))
       and is_active = true
     limit 1
       for update;

    if not found then
        return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    if d.valid_until is not null and d.valid_until < now() then
        return jsonb_build_object('ok', false, 'reason', 'expired',
                                  'company_name', d.company_name);
    end if;

    -- Уже привязан к этой же компании — ничего не меняем, но и не ругаемся.
    if u.distributor_id = d.id then
        return jsonb_build_object('ok', true, 'reason', 'already',
                                  'distributor', to_jsonb(d), 'pro_months', 0);
    end if;

    -- Привязан к другой — смена только через администратора (правило прежнее).
    if u.distributor_id is not null then
        return jsonb_build_object('ok', false, 'reason', 'other_distributor');
    end if;

    select count(*) into used
      from public.users
     where distributor_id = d.id
       and coalesce(account_type, '') not in ('admin', 'viewer', 'manager');

    if used >= coalesce(d.invite_limit, 5) then
        return jsonb_build_object('ok', false, 'reason', 'limit',
                                  'company_name', d.company_name,
                                  'manager_name', d.manager_name,
                                  'used', used, 'limit', coalesce(d.invite_limit, 5));
    end if;

    months := coalesce(d.pro_months, 0);
    if months > 0 then
        pro_end := now() + (months * 30) * interval '1 day';
        update public.users
           set distributor_id = d.id,
               account_type   = 'pro',
               demo_ends_at   = pro_end
         where id = u.id;
    else
        update public.users
           set distributor_id = d.id
         where id = u.id;
    end if;

    return jsonb_build_object(
        'ok',           true,
        'reason',       null,
        'distributor',  to_jsonb(d),
        'pro_months',   months,
        'demo_ends_at', pro_end,
        'used',         used + 1,
        'limit',        coalesce(d.invite_limit, 5)
    );
end;
$$;

revoke execute on function public.apply_invite_code(text) from public, anon;
grant  execute on function public.apply_invite_code(text) to authenticated;
