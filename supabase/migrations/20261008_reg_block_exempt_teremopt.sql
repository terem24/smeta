-- Сотрудников ТЕРЕМ (@teremopt.ru) блок повторной регистрации не касается:
-- ни 365 дней после удаления за неактивность, ни 30 дней после ручного удаления.
-- Блок считает одна функция reg_block_info: её читают и триггер на users, и форма
-- регистрации (reg_block_until), поэтому правится она одна.
create or replace function public.reg_block_info(p_email text, p_phone text default null)
returns table(till timestamptz, kind text)
language sql
stable
security definer
set search_path to 'public'
as $function$
    select d.deleted_at + make_interval(days => d.block_days), d.kind
      from public.inactivity_deleted d
     where d.reg_allowed_at is null
       and d.deleted_at + make_interval(days => d.block_days) > now()
       and lower(btrim(coalesce(d.email, ''))) not like '%@teremopt.ru'
       and lower(btrim(coalesce(p_email, ''))) not like '%@teremopt.ru'
       and (
            (nullif(btrim(p_email), '') is not null
             and lower(btrim(d.email)) = lower(btrim(p_email)))
         or (length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 10
             and right(regexp_replace(coalesce(d.phone, ''), '\D', '', 'g'), 10)
               = right(regexp_replace(p_phone, '\D', '', 'g'), 10))
       )
     order by 1 desc
     limit 1;
$function$;
