-- Таймер счёта: клиент просит обновить просроченный счёт.
--
-- Что появилось. У ссылки клиенту теперь есть срок действия (object_info.valid_days,
-- sent_at, valid_until — их пишет калькулятор при создании и переотправке ссылки).
-- Когда срок вышел, а клиент ни согласовал, ни отклонил, страница invoice.html
-- прячет цены и оставляет одну кнопку — «Обновить счёт». Нажатие пишет статус
-- refresh_requested, и монтажник получает уведомление.
--
-- Страница открывается без входа (роль anon), статус она пишет только через
-- set_shared_invoice_status из 20260816_shared_invoice_status_rpc.sql. Там белый
-- список статусов, и нового в нём нет — функция ответила бы «Недопустимый статус».
-- Поэтому пересоздаём её с тем же именем и сигнатурой: добавляем refresh_requested
-- и вместе с ним две служебные отметки для статистики —
--   refresh_requested_at — когда просили последний раз,
--   refresh_count        — сколько раз просили по этой ссылке.
-- Обе остаются в строке и после того, как монтажник переотправит счёт (калькулятор
-- их не затирает), чтобы дашборд мог посчитать, как таймер повлиял на ответы.
--
-- Выполнить вручную в Supabase SQL Editor (весь файл целиком, за один раз).

create or replace function public.set_shared_invoice_status(
    p_id uuid,
    p_status text,
    p_comment text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_patch   jsonb;
    v_coltype text;
    v_updated int;
    v_now     text;
begin
    -- Белый список: снаружи приходит только то, что умеют кнопки на странице сметы.
    if p_status not in ('sent', 'confirmed', 'needs_revision', 'invoice_requested', 'refresh_requested') then
        raise exception 'Недопустимый статус сметы: %', p_status;
    end if;

    v_now := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

    v_patch := jsonb_build_object(
        'status', p_status,
        'status_updated_at', v_now
    );

    -- Комментарий не передали (согласование, запрос счёта) — прежний не затираем.
    if p_comment is not null then
        v_patch := v_patch || jsonb_build_object('client_comment', left(p_comment, 5000));
    end if;

    select format_type(a.atttypid, a.atttypmod)
      into v_coltype
      from pg_attribute a
     where a.attrelid = 'public.shared_invoices'::regclass
       and a.attname = 'object_info';

    if p_status = 'refresh_requested' then
        -- Просьба обновить счёт: помимо статуса ведём отметку времени и счётчик.
        -- Счётчик читаем из самой строки, а не из запроса — страница его не знает.
        execute format(
            'update public.shared_invoices
                set object_info = ((coalesce(object_info::jsonb, ''{}''::jsonb) || $1
                    || jsonb_build_object(
                        ''refresh_requested_at'', $3::text,
                        ''refresh_count'', coalesce((object_info::jsonb->>''refresh_count'')::int, 0) + 1
                    ))::text)::%s
              where id = $2',
            v_coltype
        ) using v_patch, p_id, v_now;
    else
        execute format(
            'update public.shared_invoices
                set object_info = ((coalesce(object_info::jsonb, ''{}''::jsonb) || $1)::text)::%s
              where id = $2',
            v_coltype
        ) using v_patch, p_id;
    end if;

    get diagnostics v_updated = row_count;

    -- false = строки с таким id нет. Страница в этом случае создаст её сама
    -- обычным insert'ом: данные сметы у неё в руках, а вставка анониму разрешена.
    return v_updated > 0;
end;
$$;

revoke all on function public.set_shared_invoice_status(uuid, text, text) from public;
grant execute on function public.set_shared_invoice_status(uuid, text, text) to anon, authenticated;
