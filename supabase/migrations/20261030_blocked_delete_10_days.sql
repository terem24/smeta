-- Заблокированных удаляем через 10 дней молчания, а не через порог заморозки (25 дней).
-- Меняет одно условие в process_inactive_accounts (блок 5.0 из 20261030_blocked_accounts_cleanup.sql):
-- freeze_days -> константа blocked_days = 10. Заменой в тексте действующей функции, чтобы не
-- копировать её целиком и не разойтись с версией в базе.
do $$
declare
    d text := pg_get_functiondef('public.process_inactive_accounts(boolean)'::regprocedure);
    d2 text;
begin
    d2 := replace(d,
        E'               < now() - make_interval(days => freeze_days)',
        E'               < now() - make_interval(days => 10)');
    if d2 = d then
        raise exception 'process_inactive_accounts: условие блока 5.0 не найдено, ничего не изменено';
    end if;
    execute d2;
end $$;
