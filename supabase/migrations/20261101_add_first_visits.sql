-- Первый заход посетителя: откуда пришёл, на какую страницу, с какой меткой.
--
-- Зачем. Источник регистрации раньше жил только в localStorage того браузера, где
-- человек впервые открыл сайт, и записывался в users.utm_source, если вход случился
-- в течение 30 минут. Вход через Яндекс ID в другом окне или во встроенном браузере,
-- регистрация на следующий день — и источник терялся (в ноябре не знали источник у
-- 11 из 17 новых). Теперь первый заход пишется в базу сразу, по анонимному
-- идентификатору из браузера, а при регистрации привязывается к пользователю.
--
-- Анонимный идентификатор (случайный UUID) браузер хранит в localStorage; никаких
-- персональных данных в таблице нет: путь страницы без параметров, адрес сайта-
-- источника без пути и метки кампании.
--
-- Приложение работает и без этой таблицы: если функции ниже нет, вызов молча
-- не срабатывает, источник остаётся в users.utm_source, как раньше.
--
-- Выполнить вручную в Supabase SQL Editor, весь файл целиком за один раз.

create table if not exists public.first_visits (
    visitor_id text primary key check (char_length(visitor_id) between 8 and 64),
    created_at timestamptz not null default now(),
    landing text,
    referrer text,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    -- то же, что уходит в users.utm_source: «src: … | med: … | cmp: … | ref: … | lp: …»
    label text,
    user_id uuid references public.users(id) on delete set null,
    linked_at timestamptz
);

create index if not exists first_visits_user_idx on public.first_visits (user_id);
create index if not exists first_visits_created_idx on public.first_visits (created_at desc);

-- Прямой доступ закрыт всем, кроме админа (чтение для аналитики). Писать и
-- привязывать можно только через функции ниже: они режут длину полей и не дают
-- перезаписать чужую запись.
alter table public.first_visits enable row level security;

drop policy if exists first_visits_admin_read on public.first_visits;
create policy first_visits_admin_read on public.first_visits
    for select using (public.is_admin());

-- Запись первого захода. Повторный вызов с тем же идентификатором ничего не меняет:
-- первое касание не затираем.
create or replace function public.log_first_visit(
    p_visitor text,
    p_landing text,
    p_referrer text,
    p_source text,
    p_medium text,
    p_campaign text,
    p_label text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_visitor is null or char_length(p_visitor) not between 8 and 64 then
        return;
    end if;
    insert into public.first_visits (visitor_id, landing, referrer, utm_source, utm_medium, utm_campaign, label)
    values (
        p_visitor,
        left(p_landing, 120),
        left(p_referrer, 80),
        left(p_source, 60),
        left(p_medium, 60),
        left(p_campaign, 80),
        left(p_label, 300)
    )
    on conflict (visitor_id) do nothing;
end;
$$;

grant execute on function public.log_first_visit(text, text, text, text, text, text, text) to anon, authenticated;

-- Привязка первого захода к только что зарегистрированному пользователю.
-- Источник дописывается в users.utm_source, только если там пусто (или есть лишь
-- ответ из анкеты «ask: …»), и только для свежей регистрации: старого пользователя,
-- который зашёл с нового устройства, не переатрибутируем.
create or replace function public.attach_first_touch(p_visitor text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    u record;
    v record;
    cur text;
    parts text;
begin
    if auth.uid() is null or p_visitor is null then
        return null;
    end if;

    select id, utm_source, registered_at into u
    from public.users where auth_user_id = auth.uid() limit 1;
    if not found then
        return null;
    end if;
    if u.registered_at is null or u.registered_at < now() - interval '3 days' then
        return null;
    end if;

    select * into v from public.first_visits where visitor_id = p_visitor;
    if not found then
        return null;
    end if;
    -- чужой заход (уже привязан к другому) не берём
    if v.user_id is not null and v.user_id <> u.id then
        return null;
    end if;

    update public.first_visits
       set user_id = u.id, linked_at = coalesce(linked_at, now())
     where visitor_id = p_visitor and user_id is null;

    cur := coalesce(u.utm_source, '');
    parts := coalesce(v.label, '');
    -- в users.utm_source уже есть источник (не только «ask: …») — не трогаем
    if parts <> '' and (cur = '' or cur !~ '(src|med|cmp|ref|lp):') then
        update public.users
           set utm_source = trim(both ' |' from parts || case when cur <> '' then ' | ' || cur else '' end)
         where id = u.id;
        return parts;
    end if;
    return null;
end;
$$;

grant execute on function public.attach_first_touch(text) to authenticated;
