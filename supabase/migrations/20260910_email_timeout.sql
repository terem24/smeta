-- Письма: таймаут 5 секунд оказался мал.
--
-- Первая же настоящая рассылка (10 писем разом, 10.09.2026) дала пять отказов
-- «Timeout of 5000 ms reached. Total time: 5000 ms (DNS time: 5000 ms)» — все пять
-- секунд ушли на определение адреса сервера, до самого запроса дело не дошло.
-- Пять писем при этом не отправились вовсе.
--
-- Почему так: pg_net шлёт всё пачкой после коммита, разрешение имени на десяти
-- одновременных запросах упирается в свои же пределы, а 5000 мс — значение по
-- умолчанию, и на холодном кэше DNS его не хватает.
--
-- Правка одна: даём запросу 20 секунд. Прокси на Beget всё равно оборвёт свой
-- поход в EmailJS через 15 (CURLOPT_TIMEOUT в emailjs_proxy.php), так что более
-- долгого ожидания здесь взяться неоткуда.
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
        ),
        -- 20 секунд вместо пяти: на пачке писем всё время съедал DNS
        timeout_milliseconds := 20000
    );
end;
$$;

revoke all on function public.inactivity_send_email(text, text, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Дослать письма после неудачной рассылки.
--
-- Отправляем по одному, с секундной паузой: pg_sleep между строками разводит
-- запросы по времени, и они больше не толкаются на разрешении имени.
--
-- Кому именно не дошло, по журналу ответов не видно — там нет адресата. Поэтому
-- шлём всем десятерым; те, кто письмо уже получил, получат такое же второе. Это
-- лучше, чем оставить пятерых без предупреждения о том, что учётку удалят.
--
-- ВЫПОЛНЯТЬ ОТДЕЛЬНО:
--
--   select public.inactivity_send_email(
--              u.email,
--              'Вы давно не заходили в HeatCalc.ru',
--              m.text),
--          pg_sleep(1)
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
-- Проверка через минуту — ждём десять двухсоток и ни одного таймаута:
--   select status_code, error_msg, count(*) from net._http_response
--    where created > now() - interval '5 minutes'
--    group by status_code, error_msg;
-- ─────────────────────────────────────────────────────────────────────────
