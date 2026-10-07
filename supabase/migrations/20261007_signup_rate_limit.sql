-- Лимит регистраций на уровне базы.
--
-- Почему здесь, а не на странице. Код из письма при регистрации придумывается и проверяется
-- в самом браузере (app.createAccountFromPending), а учётка создаётся прямым вызовом
-- auth.signUp с публичным ключом, который виден в коде. Любой может позвать этот метод
-- мимо формы, поэтому ограничение на странице никого не остановит. В базе остановит.
--
-- Что делает триггер на auth.users (срабатывает при любом способе входа: почта, Яндекс, Telegram):
--   1) отклоняет адреса на доменах сканеров безопасности (oastify.com, interact.sh и подобные):
--      19.09.2026 в базе нашлась учётка bee@….oastify.com, регистрацию проверяли на уязвимости;
--   2) отклоняет новую учётку, если за последний час их создано не меньше per_hour (по умолчанию 30),
--      а за сутки не меньше per_day (150). Обычный день: 1–3 регистрации, пики 14.09 (21, обучение
--      сотрудников) и 25.09 (9), в них лимит не упирается.
-- Пороги меняются без правки кода: app_settings, ключ 'signup_limits', значение
--   {"per_hour": 30, "per_day": 150}
-- Отказ приходит клиенту как «Database error saving new user» (так Supabase показывает любую
-- ошибку триггера); настоящая причина signup_rate_limited / signup_blocked_domain видна в
-- журнале Postgres.
--
-- Лимит общий, а не по IP: у триггера нет адреса клиента. Лимит по IP и по почте — в панели
-- Supabase (Authentication → Rate Limits), там же нужно ограничить число писем в час.
--
-- Откат:
--   drop trigger if exists trg_auth_signup_guard on auth.users;
--   drop function if exists public.auth_signup_guard();

create or replace function public.auth_signup_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    cfg jsonb;
    per_hour int := 30;
    per_day  int := 150;
    dom text;
    n_hour int;
    n_day int;
begin
    begin
        select value into cfg from public.app_settings where key = 'signup_limits';
        if cfg is not null then
            per_hour := greatest(coalesce((cfg->>'per_hour')::int, per_hour), 1);
            per_day  := greatest(coalesce((cfg->>'per_day')::int, per_day), 1);
        end if;
    exception when others then
        null;
    end;

    dom := lower(split_part(coalesce(new.email, ''), '@', 2));
    if dom ~ '(^|\.)(oastify\.com|burpcollaborator\.net|interact\.sh|oast\.(pro|live|site|online|fun|me))$' then
        raise exception 'signup_blocked_domain' using errcode = 'P0001';
    end if;

    select count(*) filter (where created_at > now() - interval '1 hour'),
           count(*) filter (where created_at > now() - interval '1 day')
      into n_hour, n_day
      from auth.users;

    if n_hour >= per_hour or n_day >= per_day then
        raise exception 'signup_rate_limited' using errcode = 'P0001';
    end if;

    return new;
end;
$$;

revoke execute on function public.auth_signup_guard() from public, anon, authenticated;

drop trigger if exists trg_auth_signup_guard on auth.users;
create trigger trg_auth_signup_guard
    before insert on auth.users
    for each row execute function public.auth_signup_guard();
