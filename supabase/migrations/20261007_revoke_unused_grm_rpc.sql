-- Геймификация убрана из калькулятора 06.10.2026 (gamification.js и страница /rating/
-- удалены), её функции вызывать больше некому. Отзываем право вызывать их через
-- публичный интерфейс у анонимного ключа и у вошедших. Сами функции и данные остаются.
--
-- Отзывать надо и у public: по умолчанию функции доступны всем через эту роль, и
-- отзыв только у anon и authenticated ничего не меняет (первая попытка 07.10.2026
-- именно так и прошла вхолостую).
--
-- Не трогаем grm_current_user_id(): она стоит в правиле доступа user_sessions_read
-- (журнал визитов для админки), без права на вызов чтение этой таблицы сломается.
--
-- Триггерные функции (grm_on_reaction_*, grm_sync_estimate_status, tariff_log_change)
-- тоже отзываем: право на выполнение проверяется при создании триггера, а не при каждом
-- срабатывании, поэтому триггеры продолжают работать.
--
-- Откат: grant execute on function public.<имя>(<аргументы>) to public, anon, authenticated;

revoke execute on function public.grm_leaderboard(text, integer) from public, anon, authenticated;
revoke execute on function public.grm_prize_content(text) from public, anon, authenticated;
revoke execute on function public.grm_prize_feedback(text) from public, anon, authenticated;
revoke execute on function public.grm_prize_invoices(text) from public, anon, authenticated;
revoke execute on function public.grm_track_action(text, text) from public, anon, authenticated;
revoke execute on function public.grm_unlock_achievement(text) from public, anon, authenticated;
revoke execute on function public.grm_on_reaction_delete() from public, anon, authenticated;
revoke execute on function public.grm_on_reaction_insert() from public, anon, authenticated;
revoke execute on function public.grm_sync_estimate_status() from public, anon, authenticated;
revoke execute on function public.tariff_log_change() from public, anon, authenticated;
