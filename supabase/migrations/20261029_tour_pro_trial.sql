-- Пробный Профи на 10 дней тем, кто прошёл обучение (tour.js → mark_tour_done).
--
-- ЗАЧЕМ. Обучение бросают, не доходя до пользы. Кто засчитал блок «Первый объект» (та же
-- отметка, что зелёная галочка в админке), получает Профи на 10 дней сразу, без кнопки.
--
-- КОМУ. Только первый раз (tour_done_at ещё пуст), только базовым и бесплатным аккаунтам,
-- у которых не было ни оплаты (pro_expires_at), ни пробного периода (demo_ends_at пуст).
-- Администраторы, менеджеры, наблюдатели и уже платные Профи не затрагиваются.
--
-- КАК. Выдаёт сама функция (security definer), от клиента это не зависит: прямой запрос из
-- браузера не может поставить account_type = 'pro' (триггер users_guard_privileged).
-- Функция возвращает { pro_until } — до какого срока выдан Профи, либо null, если не выдан.
--
-- Выполнить вручную в Supabase SQL Editor, весь файл целиком за один раз.
-- Без миграции старая функция не возвращает срока, и клиент просто не выдаёт Профи.

drop function if exists public.mark_tour_done(int, text);

create or replace function public.mark_tour_done(p_steps int, p_plan text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user  uuid;
    v_row   public.users%rowtype;
    v_until timestamptz := null;
begin
    v_user := public.grm_current_user_id();
    if v_user is null then
        return jsonb_build_object('pro_until', null);     -- гость: в users его нет
    end if;

    select * into v_row from public.users u where u.id = v_user for update;
    if not found or v_row.tour_done_at is not null then
        -- Вторым кругом отметку не ставим и Профи повторно не даём
        return jsonb_build_object('pro_until', null);
    end if;

    update public.users u
       set tour_done_at    = now(),
           tour_done_steps = greatest(0, least(coalesce(p_steps, 0), 100)),
           tour_done_plan  = left(p_plan, 40)
     where u.id = v_user;

    if coalesce(v_row.account_type, 'free') in ('free', 'base')
       and v_row.demo_ends_at is null
       and (v_row.pro_expires_at is null or v_row.pro_expires_at <= now()) then
        v_until := now() + interval '10 days';
        update public.users u
           set account_type = 'pro',
               demo_ends_at = v_until
         where u.id = v_user;
    end if;

    return jsonb_build_object('pro_until', v_until);
end;
$$;

revoke all on function public.mark_tour_done(int, text) from public;
grant execute on function public.mark_tour_done(int, text) to authenticated;
