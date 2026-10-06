-- Регистрация по промокоду без кода из письма.
--
-- Когда у EmailJS кончается лимит (200 писем, цикл с 8-го), код подтверждения почты уйти не
-- может, и новый человек не может зарегистрироваться. Если он пришёл по промокоду магазина,
-- проверенному базой, код можно не слать: промокод и есть «пропуск», а адрес профиль попросит
-- сверить (метка email_unverified в метаданных учётки).
--
-- Режим в app_settings.mail_budget.promo_no_code:
--   'off'    — всегда слать код;
--   'auto'   — не слать, когда израсходовано 95 % лимита (по умолчанию);
--   'always' — не слать никогда при проверенном промокоде.
-- Кроме этого, сайт сам регистрирует без кода, если письмо не ушло (EmailJS отказал).
--
-- Выполнить в Supabase SQL Editor целиком.

create or replace function public.mail_code_skip_for_promo()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    cfg  jsonb;
    mode text;
    st   jsonb;
begin
    select value into cfg from public.app_settings where key = 'mail_budget';
    mode := coalesce(cfg->>'promo_no_code', 'auto');
    if mode = 'always' then return true; end if;
    if mode <> 'auto' then return false; end if;
    begin
        st := public.mail_budget_calc();
        return coalesce((st->>'pct')::numeric, 0) >= 95;
    exception when others then
        return false;
    end;
end;
$$;
grant execute on function public.mail_code_skip_for_promo() to anon, authenticated;

-- Админке нужен и сам режим: добавляем его в ответ состояния.
create or replace function public.mail_budget_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    cfg jsonb;
begin
    if not exists (select 1 from public.users u
                    where u.auth_user_id = auth.uid()
                      and u.account_type in ('admin', 'viewer')) then
        raise exception 'mail_budget_state: только для администратора';
    end if;
    select value into cfg from public.app_settings where key = 'mail_budget';
    return public.mail_budget_calc()
        || jsonb_build_object('promo_no_code', coalesce(cfg->>'promo_no_code', 'auto'));
end;
$$;
grant execute on function public.mail_budget_state() to authenticated;
