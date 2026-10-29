-- Выключатель бонуса за обучение (Профи на 10 дней) — app_settings.subscription.tourBonus.enabled.
--
-- ЗАЧЕМ. Бонус из 20261029_tour_pro_trial.sql нужно уметь выключить из админки, не выкатывая
-- код. Флаг лежит в той же записи настроек, что тарифы и пробный период (ключ subscription),
-- и читается здесь. По умолчанию включён — как и раньше: если флага нет, бонус выдаётся.
--
-- ЧТО МЕНЯЕТСЯ. Только выдача: отметка «прошёл обучение» ставится всегда, а Профи — когда флаг
-- не выключен. Сама функция и её права остаются прежними.
--
-- Уже выполнено в Supabase 29.10.2026 (проект stout-calc).

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
    v_on    boolean;
begin
    v_user := public.grm_current_user_id();
    if v_user is null then
        return jsonb_build_object('pro_until', null);     -- гость: в users его нет
    end if;

    select * into v_row from public.users u where u.id = v_user for update;
    if not found or v_row.tour_done_at is not null then
        return jsonb_build_object('pro_until', null);     -- повторно не отмечаем и не выдаём
    end if;

    update public.users u
       set tour_done_at    = now(),
           tour_done_steps = greatest(0, least(coalesce(p_steps, 0), 100)),
           tour_done_plan  = left(p_plan, 40)
     where u.id = v_user;

    -- Выключатель: нет записи или флага — бонус включён
    select coalesce(s.value->'tourBonus'->>'enabled', 'true') <> 'false' into v_on
      from public.app_settings s
     where s.key = 'subscription';
    v_on := coalesce(v_on, true);

    if v_on
       and coalesce(v_row.account_type, 'free') in ('free', 'base')
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
revoke all on function public.mark_tour_done(int, text) from anon;
grant execute on function public.mark_tour_done(int, text) to authenticated;
