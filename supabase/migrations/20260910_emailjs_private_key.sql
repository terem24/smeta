-- Письма из базы: закрытый ключ EmailJS.
--
-- Первая попытка разослать напоминания уткнулась в отказ почтовой службы:
--   403 «API access in strict mode, but no Private Key was provided».
-- Из браузера письмо уходит по открытому ключу (его проверяют по адресу сайта),
-- а запрос с сервера EmailJS принимает только с закрытым — в строгом режиме,
-- который у нас включён.
--
-- Ключ в тексте миграции не хранится: миграции лежат в репозитории, а этим ключом
-- можно рассылать письма от имени сайта и выжечь месячный лимит. Берём его из
-- Vault (Dashboard → Project Settings → Vault) под именем emailjs_private_key.
-- Нет секрета — писем нет, но ночной проход всё равно отработает: сообщения в
-- кабинете и заморозка от почты не зависят.
--
-- Выполнить вручную в Supabase SQL Editor, весь файл целиком за один раз.

create or replace function public.inactivity_send_email(to_email text, subj text, body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    priv text;
begin
    if to_email is null or btrim(to_email) = '' then return; end if;
    if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;

    -- Закрытый ключ EmailJS. Vault может быть недоступен или пуст — тогда молча
    -- выходим: почта необязательный канал, ронять из-за неё проход незачем.
    begin
        select decrypted_secret into priv
          from vault.decrypted_secrets where name = 'emailjs_private_key' limit 1;
    exception when others then
        priv := null;
    end;
    if priv is null or btrim(priv) = '' then
        raise notice 'inactivity_send_email: в Vault нет emailjs_private_key — письмо не отправлено';
        return;
    end if;

    -- Тело как у приложения (см. emailjs.send в app.js), плюс accessToken —
    -- то самое, чего не хватало строгому режиму.
    perform net.http_post(
        url     := 'https://proxy.heatcalc.ru/emailjs_proxy.php',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body    := jsonb_build_object(
            'service_id',  'service_o11b4ej',
            'template_id', 'template_ysuxfio',
            'user_id',     '-m4N93pTqMlCfuBpT',
            'accessToken', btrim(priv),
            'template_params', jsonb_build_object(
                'to_email',      btrim(to_email),
                'user_email',    btrim(to_email),
                'tariff_name',   'Системное уведомление',
                'email_subject', subj,
                'subject_text',  subj,
                'email_body',    body,
                'message_text',  body
            )
        )
    );
end;
$$;

revoke all on function public.inactivity_send_email(text, text, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Дослать письма тем, кому напоминание уже ушло сообщением в кабинет.
--
-- Ночной проход 10.09.2026 отработал, когда база ещё не умела ходить наружу
-- (pg_net включили позже), — сообщения в кабинете люди получили, а письма нет.
-- Повторный запуск process_inactive_accounts их не догонит: журнал уже помечен,
-- и второй раз этих людей функция не тронет.
--
-- Текст берём из самого сообщения, которое им написали, — так письмо совпадёт
-- с тем, что человек увидит в кабинете, слово в слово.
--
-- ВЫПОЛНЯТЬ ОТДЕЛЬНО, ПОСЛЕ ПРОВЕРКИ, что тестовое письмо дошло:
--
--   select public.inactivity_send_email(
--              u.email,
--              'Вы давно не заходили в HeatCalc.ru',
--              m.text)
--     from public.inactivity_notices n
--     join public.users u on u.id = n.user_id
--     join lateral (
--              select msg.text from public.messages msg
--               where msg.recipient_id = u.id
--               order by msg.created_at desc limit 1
--          ) m on true
--    where n.warned_at > now() - interval '2 days'
--      and coalesce(btrim(u.email), '') <> '';
--
-- Сколько писем ушло и что ответила служба:
--   select status_code, content, created from net._http_response
--    order by created desc limit 20;
-- ─────────────────────────────────────────────────────────────────────────
