-- Напоминание «КП отправлено, счёт не выставлен»: номер КП с версией.
--
-- Сайт с 22.09.2026 пишет версию КП в meta событий отправки (sent / printed,
-- meta.kp_version). В тексте напоминания монтажнику и менеджеру вместо
-- «расчёт № 452712» теперь «КП № 452712-3» — та же форма номера, что в смете,
-- у клиента, в договоре и в пушах. Версии нет (отправка до 22.09) — просто номер.
--
-- Функция большая, и её уже правила миграция 20260922_users_work_email.sql
-- (поиск менеджера по рабочей почте). Поэтому, как и там, меняем точечно строки
-- в её тексте, а не переписываем целиком. Повторный запуск ничего не ломает:
-- уже заменённые места пропускаются.

do $$
declare
    src  text;
    pairs text[][] := array[
        -- 1. Версия из события отправки
        array['ev.calc_id, ev.created_at as sent_at, ev.event, ev.project_name, ev.user_email',
              'ev.calc_id, ev.created_at as sent_at, ev.event, ev.project_name, ev.user_email, ev.meta->>''kp_version'' as kp_version'],
        -- 2. И дальше в выборку цикла
        array['select p.calc_id, p.sent_at, p.event, p.user_email,',
              'select p.calc_id, p.sent_at, p.event, p.user_email, p.kp_version,'],
        -- 3. Номер с версией в обоих текстах (монтажнику и менеджеру)
        array['obj, r.calc_id, coalesce('', '' || sum_txt, ''''),',
              'obj, r.calc_id || coalesce(''-'' || nullif(btrim(r.kp_version), ''''), ''''), coalesce('', '' || sum_txt, ''''),'],
        -- 4. Подпись номера
        array['(расчёт № %s%s)', '(КП № %s%s)']
    ];
    i int;
begin
    select pg_get_functiondef('public.send_kp_invoice_reminders(boolean)'::regprocedure) into src;
    for i in 1 .. array_length(pairs, 1) loop
        if position(pairs[i][2] in src) > 0 then
            continue;   -- уже заменено прошлым запуском
        end if;
        if position(pairs[i][1] in src) = 0 then
            raise exception 'send_kp_invoice_reminders: не найдена строка для замены № %: %', i, pairs[i][1];
        end if;
        src := replace(src, pairs[i][1], pairs[i][2]);
    end loop;
    execute src;
end $$;

-- Проверка без отправки (ничего не пишет):
-- select public.send_kp_invoice_reminders(true);
