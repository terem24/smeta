-- invoice_events: журнал событий по сметам. Защиты на уровне строк у таблицы нет
-- (rls_disabled_in_public), а права по умолчанию позволяли анонимному ключу из
-- публичного app.js удалить, изменить и даже очистить (TRUNCATE) всю таблицу.
--
-- Быстрая мера: отзываем только то, чем код не пользуется.
--   anon:          DELETE, UPDATE, TRUNCATE, TRIGGER, REFERENCES — оставляем SELECT и INSERT
--                  (клиентская страница invoice.html вставляет событие и просит вернуть id).
--   authenticated: TRUNCATE, TRIGGER, REFERENCES — оставляем SELECT, INSERT, UPDATE, DELETE
--                  (монтажник стирает свою историю, админка чистит сирот).
-- Чтение остаётся открытым: полноценная защита таблицы требует правок клиента
-- и политик на восемь видов пользователей, делается отдельной задачей.
--
-- Откат:
--   grant delete, update, truncate, trigger, references on public.invoice_events to anon;
--   grant truncate, trigger, references on public.invoice_events to authenticated;

revoke delete, update, truncate, trigger, references on public.invoice_events from anon;
revoke truncate, trigger, references on public.invoice_events from authenticated;
