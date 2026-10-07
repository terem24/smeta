-- Согласие на информационные рассылки и отписка (закон о рекламе, 38-ФЗ, ст. 18).
--
-- Информационными считаем письма и сообщения, без которых аккаунтом можно пользоваться:
--   * напоминания новичкам process_onboarding_nudges («Первая смета…», «Что не получилось…»,
--     «Давно не видели смет…»);
--   * поздравления с днём рождения send_birthday_greetings (пользователю и менеджеру
--     дистрибьютора: у менеджера уходят имя, возраст, город и телефон монтажника).
-- Служебные письма согласия не требуют и не меняются: код подтверждения, статусы смет и
-- счетов, сообщения менеджера, предупреждения о приостановке доступа, напоминания по КП.
--
-- mail_consent: null — человек не отвечал (рассылку не шлём), true — согласен, false — отказался.
-- Согласие ставится галочкой при регистрации и переключателем в кабинете, отказ — там же
-- или по ссылке из письма (страница unsubscribe.html → mail_unsubscribe).
--
-- Функции рассылок правятся подстановкой в их текущий код прямо в базе, чтобы не переписывать
-- длинные тексты поздравлений и писем вручную; если подстановка не сработала — миграция падает.
--
-- Откат:
--   alter table public.users drop column mail_consent, drop column mail_consent_at, drop column mail_unsub_token;
--   и вернуть прежние версии функций process_onboarding_nudges и send_birthday_greetings
--   из 20261002_onboarding_nudges.sql / 20260820_birthday_greetings.sql.

alter table public.users
    add column if not exists mail_consent boolean,
    add column if not exists mail_consent_at timestamptz,
    add column if not exists mail_unsub_token uuid not null default gen_random_uuid();

create unique index if not exists users_mail_unsub_token_key on public.users (mail_unsub_token);

comment on column public.users.mail_consent is
    'Согласие на информационные письма и поздравления: null — не отвечал, true — согласен, false — отказался.';
comment on column public.users.mail_unsub_token is
    'Секрет для ссылки «отписаться» в письмах; даёт только право отозвать согласие.';

-- Отписка по ссылке из письма: без входа, по секретному токену.
create or replace function public.mail_unsubscribe(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    n int;
begin
    if p_token is null then return false; end if;
    update public.users
       set mail_consent = false, mail_consent_at = now()
     where mail_unsub_token = p_token;
    get diagnostics n = row_count;
    return n > 0;
end;
$$;

-- Согласие или отказ из кабинета и при первой авторизации после регистрации.
create or replace function public.set_my_mail_consent(p_value boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    n int;
begin
    if auth.uid() is null or p_value is null then return false; end if;
    update public.users
       set mail_consent = p_value, mail_consent_at = now()
     where auth_user_id = auth.uid();
    get diagnostics n = row_count;
    return n > 0;
end;
$$;

create or replace function public.get_my_mail_consent()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object('consent', u.mail_consent, 'at', u.mail_consent_at)
      from public.users u
     where u.auth_user_id = auth.uid()
     limit 1;
$$;

revoke execute on function public.mail_unsubscribe(uuid) from public, anon, authenticated;
grant execute on function public.mail_unsubscribe(uuid) to anon, authenticated;
revoke execute on function public.set_my_mail_consent(boolean) from public, anon, authenticated;
grant execute on function public.set_my_mail_consent(boolean) to authenticated;
revoke execute on function public.get_my_mail_consent() from public, anon, authenticated;
grant execute on function public.get_my_mail_consent() to authenticated;

-- Напоминания новичкам: только согласившимся, со строкой об отписке в конце.
do $do$
declare
    d text;
begin
    d := pg_get_functiondef('public.process_onboarding_nudges(boolean)'::regprocedure);

    d := replace(d,
        $q$us.id, us.email, us.username, us.first_name, us.created_at, us.last_visited,$q$,
        $q$us.id, us.email, us.username, us.first_name, us.created_at, us.last_visited, us.mail_unsub_token,$q$);
    d := replace(d,
        $q$and lower(btrim(us.email)) not like '%@teremopt.ru'$q$,
        $q$and lower(btrim(us.email)) not like '%@teremopt.ru'
                   and coalesce(us.mail_consent, false)$q$);
    d := replace(d,
        $q$        if dry_run then
            would := would$q$,
        $q$        body := body || E'\n\n—\nЭто информационное письмо. Если оно вам не нужно, отпишитесь: https://heatcalc.ru/unsubscribe.html?t=' || u.mail_unsub_token::text;

        if dry_run then
            would := would$q$);

    if d not like '%coalesce(us.mail_consent, false)%'
       or d not like '%us.mail_unsub_token%'
       or d not like '%unsubscribe.html%' then
        raise exception 'process_onboarding_nudges: подстановка не сработала';
    end if;
    execute d;
end
$do$;

-- Поздравления: только согласившимся (и им, и менеджеру о них).
do $do$
declare
    d text;
begin
    d := pg_get_functiondef('public.send_birthday_greetings()'::regprocedure);

    d := replace(d,
        $q$where us.birth_date is not null$q$,
        $q$where us.birth_date is not null
           and coalesce(us.mail_consent, false)$q$);

    if d not like '%coalesce(us.mail_consent, false)%' then
        raise exception 'send_birthday_greetings: подстановка не сработала';
    end if;
    execute d;
end
$do$;
