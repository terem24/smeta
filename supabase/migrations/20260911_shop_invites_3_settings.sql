-- Приглашения от менеджеров магазинов, часть 3: настройки сайта в базе.
--
-- Рубильник «регистрация только по промокоду» переезжает из кода (константа
-- INVITE_ONLY_REGISTRATION в app.js) в таблицу: включать и выключать его должен
-- администратор из панели, без выкладки новой версии. Таблица общая, на будущее
-- в неё лягут и другие переключатели сайта.
--
-- Читать может кто угодно, в том числе без входа: режим регистрации нужен
-- форме регистрации ещё до появления сессии. Писать — только администратор:
-- та же проверка public.is_admin(), что стоит на удалении пользователей и
-- сообщений (20260714_add_role_based_rls_support.sql).
--
-- Значение — jsonb, чтобы одной таблицей обходиться и для флагов, и для чисел,
-- и для текстов. Режим регистрации: {"mode": "open"} или {"mode": "invite"}.
-- По умолчанию open — регистрация свободная, как была.
--
-- Выполнить вручную в Supabase SQL Editor, весь файл целиком за один раз.

create table if not exists public.app_settings (
    key         text primary key,
    value       jsonb not null default '{}'::jsonb,
    updated_at  timestamptz not null default now(),
    updated_by  text
);

comment on table public.app_settings is
    'Переключатели сайта, которые администратор меняет из панели. '
    'registration: {"mode": "open" | "invite"} — свободная регистрация или только по промокоду.';

alter table public.app_settings enable row level security;

drop policy if exists app_settings_read_all on public.app_settings;
create policy app_settings_read_all on public.app_settings
    for select using (true);

drop policy if exists app_settings_admin_write on public.app_settings;
create policy app_settings_admin_write on public.app_settings
    for all using (public.is_admin()) with check (public.is_admin());

insert into public.app_settings (key, value)
values ('registration', '{"mode": "open"}'::jsonb)
on conflict (key) do nothing;
