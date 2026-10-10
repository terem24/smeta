-- Единственный админ по почте: kovdor24@yandex.ru.
--
-- 08.10.2026 решено оставить одну админскую учётку. Раньше админом признавали три адреса
-- (kovdorekb@gmail.com, kovdor24@yandex.ru, dima24ba@gmail.com), они вшиты в тела функций и в
-- правила доступа. Адреса kovdorekb и dima24ba освобождать нельзя, пока они значатся админами:
-- регистрация не требует подтверждения почты, и любой, кто зарегистрируется на освободившийся
-- адрес, получит админские права. Поэтому сначала убираем эти два адреса отовсюду, и только
-- потом можно удалять их учётки (сейчас они очищены и заблокированы до 2999 года).
--
-- Правка делается подстановкой в текущие определения функций и правил (pg_get_functiondef и
-- pg_policies), а не переписыванием их вручную. Если адрес после подстановки остался, миграция
-- падает целиком. Затронуто 9 функций (is_admin, admin_delete_user_completely, unfreeze_user,
-- allow_deleted_reregistration, inactivity_report, process_inactive_accounts,
-- process_onboarding_nudges, send_birthday_greetings, send_kp_invoice_reminders) и 6 правил
-- (distributors, estimates, manager_chat_messages, message_receipts ×2, messages).
-- Отправитель системных сообщений (поиск «владельца» по почте) теперь тоже kovdor24.
--
-- Откат: вернуть три адреса в списки (определения в предыдущих миграциях).

do $do$
declare
    r record;
    d text;
    q text;
    w text;
    n_fn int := 0;
    n_pol int := 0;
begin
    for r in
        select p.oid, p.proname
          from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and pg_get_functiondef(p.oid) ~ '''(dima24ba|kovdorekb)@gmail\.com'''
    loop
        d := pg_get_functiondef(r.oid);
        d := regexp_replace(d, '''kovdorekb@gmail\.com''(::text)?\s*,\s*', '', 'g');
        d := regexp_replace(d, '\s*,\s*''dima24ba@gmail\.com''(::text)?', '', 'g');
        d := regexp_replace(d, '''(dima24ba|kovdorekb)@gmail\.com''', '''kovdor24@yandex.ru''', 'g');
        if d ~ '''(dima24ba|kovdorekb)@gmail\.com''' then
            raise exception 'функция %: адрес остался', r.proname;
        end if;
        execute d;
        n_fn := n_fn + 1;
    end loop;

    for r in
        select schemaname, tablename, policyname, qual, with_check
          from pg_policies
         where schemaname = 'public'
           and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ '(dima24ba|kovdorekb)@gmail\.com'
    loop
        q := r.qual;
        w := r.with_check;
        if q is not null then
            q := regexp_replace(q, '''kovdorekb@gmail\.com''(::text)?\s*,\s*', '', 'g');
            q := regexp_replace(q, '\s*,\s*''dima24ba@gmail\.com''(::text)?', '', 'g');
            q := regexp_replace(q, '''(dima24ba|kovdorekb)@gmail\.com''', '''kovdor24@yandex.ru''', 'g');
        end if;
        if w is not null then
            w := regexp_replace(w, '''kovdorekb@gmail\.com''(::text)?\s*,\s*', '', 'g');
            w := regexp_replace(w, '\s*,\s*''dima24ba@gmail\.com''(::text)?', '', 'g');
            w := regexp_replace(w, '''(dima24ba|kovdorekb)@gmail\.com''', '''kovdor24@yandex.ru''', 'g');
        end if;
        if coalesce(q, '') || coalesce(w, '') ~ '(dima24ba|kovdorekb)@gmail\.com' then
            raise exception 'правило %.%: адрес остался', r.tablename, r.policyname;
        end if;
        execute format('alter policy %I on %I.%I %s %s', r.policyname, r.schemaname, r.tablename,
                       case when q is not null then 'using (' || q || ')' else '' end,
                       case when w is not null then 'with check (' || w || ')' else '' end);
        n_pol := n_pol + 1;
    end loop;

    raise notice 'исправлено функций %, правил %', n_fn, n_pol;
end
$do$;
