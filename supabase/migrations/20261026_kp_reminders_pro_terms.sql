-- Итог КП: напоминания считают срок так же, как окно в браузере (kp_outcome.js).
--
-- Раньше send_kp_outcome_reminders считала срок как «последняя отправка или продление + срок
-- ответа монтажника». Теперь продление несёт свою длину (invoice_events.meta.days: у Профи 45
-- дней, у остальных срок ответа), и срок = max(отправка + срок, продление + длина продления).
-- Иначе у Профи с продлением на 45 дней напоминание пришло бы на 15 дней раньше срока.
-- Для Профи (account_type 'pro' с неистёкшим сроком) и менеджеров в тексте и в счётчике
-- «продлений осталось» берутся их числа: app_settings.subscription.limit.outcomeProExt
-- (по умолчанию 4) и outcomeProExtDays (по умолчанию 45).
--
-- Меняет только тело функции (через pg_get_functiondef), расписание не трогает.
-- Проверка после: select public.send_kp_outcome_reminders(true);

do $$
declare
    src text;
    n   int;
begin
    select pg_get_functiondef('public.send_kp_outcome_reminders(boolean)'::regprocedure) into src;

    -- функция уже переписана: второй раз не применяем
    if position('ext_days_last' in src) > 0 then
        raise notice 'send_kp_outcome_reminders: уже обновлена';
        return;
    end if;

    -- объявления и настройки Профи
    n := position(E'    v_ext   int;\n' in src);
    if n = 0 then raise exception 'не найдено объявление v_ext'; end if;
    src := replace(src, E'    v_ext   int;\n', E'    v_ext   int;\n    v_pext  int;\n    v_pextd int;\n');

    n := position(E'    if not c_on then\n' in src);
    if n = 0 then raise exception 'не найдено условие c_on'; end if;
    src := replace(src, E'    if not c_on then\n',
        E'    v_pext  := least(10,  greatest(0, case when cfg->>''outcomeProExt'' ~ ''^\\d{1,2}$'' then (cfg->>''outcomeProExt'')::int else 4 end));\n'
        || E'    v_pextd := least(180, greatest(7, case when cfg->>''outcomeProExtDays'' ~ ''^\\d{1,3}$'' then (cfg->>''outcomeProExtDays'')::int else 45 end));\n\n'
        || E'    if not c_on then\n');

    -- длина последнего продления
    n := position('x.event = ''extended'')::int as n_ext' in src);
    if n = 0 then raise exception 'не найден n_ext'; end if;
    src := replace(src, 'x.event = ''extended'')::int as n_ext',
        'x.event = ''extended'')::int as n_ext,' || E'\n'
        || '                   (select case when x.meta->>''days'' ~ ''^\d{1,3}$'' then (x.meta->>''days'')::int end'
        || ' from public.invoice_events x where x.calc_id = kp.calc_id and x.event = ''extended'' order by x.created_at desc limit 1) as ext_days_last');

    -- тариф хозяина
    n := position('select st.*, uu.account_type, uu.demo_ends_at,' in src);
    if n = 0 then raise exception 'не найден own'; end if;
    src := replace(src, 'select st.*, uu.account_type, uu.demo_ends_at,',
        'select st.*, uu.account_type, uu.demo_ends_at,' || E'\n'
        || '                   (uu.account_type = ''manager'' or (uu.account_type = ''pro'' and (uu.demo_ends_at is null or uu.demo_ends_at > now()))) as is_pro,');

    -- срок: max(отправка + срок, продление + длина продления)
    n := position('greatest(own.last_sent, coalesce(own.last_ext, own.last_sent), start_at - make_interval(days => own.days))' in src);
    if n = 0 then raise exception 'не найдена формула срока'; end if;
    src := replace(src, 'greatest(own.last_sent, coalesce(own.last_ext, own.last_sent), start_at - make_interval(days => own.days))',
        'greatest(greatest(own.last_sent, start_at - make_interval(days => own.days)) + make_interval(days => own.days),'
        || ' own.last_ext + make_interval(days => coalesce(own.ext_days_last, own.days)))');
    n := position(E'\n                       + make_interval(days => own.days) as due_at' in src);
    if n = 0 then raise exception 'не найден хвост формулы срока'; end if;
    src := replace(src, E'\n                       + make_interval(days => own.days) as due_at', ' as due_at');

    -- сколько продлений осталось и что написать в сообщении
    n := position('''left'', greatest(0, v_ext - p.n_ext),' in src);
    if n = 0 then raise exception 'не найден left'; end if;
    src := replace(src, '''left'', greatest(0, v_ext - p.n_ext),', '''left'', greatest(0, case when p.is_pro then v_pext else v_ext end - p.n_ext),');
    n := position('max(p.days) as days,' in src);
    if n = 0 then raise exception 'не найден max days'; end if;
    src := replace(src, 'max(p.days) as days,', 'max(p.days) as days,' || E'\n               bool_or(p.is_pro) as is_pro,');
    n := position('o.days, v_ext) else' in src);
    if n = 0 then raise exception 'не найден текст продления'; end if;
    src := replace(src, 'o.days, v_ext) else', 'case when o.is_pro then v_pextd else o.days end, case when o.is_pro then v_pext else v_ext end) else');

    execute src;
end;
$$;

revoke all on function public.send_kp_outcome_reminders(boolean) from public, anon, authenticated;
