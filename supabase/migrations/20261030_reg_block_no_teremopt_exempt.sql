-- Исключение для @teremopt.ru (20261008_reg_block_exempt_teremopt.sql) убрано:
-- сотрудники блокируются при повторной регистрации так же, как остальные.
-- Снять запрет с конкретного человека — кнопка «Разрешить регистрацию» на вкладке «Неактивные».
create or replace function public.reg_block_info(p_email text, p_phone text default null)
returns table(till timestamptz, kind text)
language sql
stable
security definer
set search_path = public
as $$
    select d.deleted_at + make_interval(days => d.block_days), d.kind
      from public.inactivity_deleted d
     where d.reg_allowed_at is null
       and d.deleted_at + make_interval(days => d.block_days) > now()
       and (
            (nullif(btrim(p_email), '') is not null
             and public.norm_email(d.email) = public.norm_email(p_email))
         or (length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 10
             and right(regexp_replace(coalesce(d.phone, ''), '\D', '', 'g'), 10)
               = right(regexp_replace(p_phone, '\D', '', 'g'), 10))
       )
     order by 1 desc
     limit 1;
$$;
