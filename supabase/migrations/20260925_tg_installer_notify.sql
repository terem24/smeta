-- Личные Telegram-уведомления монтажнику (КП, опросник, чат). tg_chat_id/tg_username
-- пишет только tg-webhook сервисным ключом — клиент их не трогает. tg_connect_token —
-- одноразовый код на подключение (10 минут), генерирует клиент при нажатии «Подключить»,
-- отдельно от users.id: тот же id уже публичный в ссылке на опросник (oprosnik.html?m=),
-- и его нельзя использовать как секрет для привязки бота.
alter table public.users add column if not exists tg_chat_id bigint;
alter table public.users add column if not exists tg_username text;
alter table public.users add column if not exists tg_connect_token text;
alter table public.users add column if not exists tg_connect_token_at timestamptz;
