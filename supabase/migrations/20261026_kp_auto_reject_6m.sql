-- Итог КП: автоотклонение «без ответа» — 6 месяцев вместо 12 (решение владельца 26.10.2026).
--
-- Меняет только значение по умолчанию внутри close_stale_kp_outcomes: если в
-- app_settings.subscription.limit.outcomeAutoMonths срок не задан, берётся 6.
-- Заданное в админке («Оплата подписки» → «Лимит КП» → «Итог КП») по-прежнему главнее.
-- В браузере тот же срок: LIMIT_DEFAULTS в subscription.js и FALLBACK в kp_outcome.js.
--
-- Выполнить в Supabase SQL Editor целиком. Ничего не удаляет и не отклоняет сразу:
-- закрытие — ежедневная задача в 09:25 МСК. Перед ней посмотреть, что закроется:
--   select public.close_stale_kp_outcomes(true);

do $$
declare
    src text;
begin
    select pg_get_functiondef('public.close_stale_kp_outcomes(boolean)'::regprocedure) into src;
    if position('then (cfg->>''outcomeAutoMonths'')::int else 12 end' in src) = 0 then
        raise exception 'close_stale_kp_outcomes: не найдено значение по умолчанию 12';
    end if;
    src := replace(src, 'then (cfg->>''outcomeAutoMonths'')::int else 12 end', 'then (cfg->>''outcomeAutoMonths'')::int else 6 end');
    execute src;
end;
$$;

revoke all on function public.close_stale_kp_outcomes(boolean) from public, anon, authenticated;
