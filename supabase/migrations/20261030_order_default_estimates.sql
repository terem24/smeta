-- Какие сохранённые сметы содержат каждую позицию «под заказ» из подбора по умолчанию,
-- и чьи они. Нужна вкладке админки «Замены позиций» → «Под заказ в подборе по умолчанию»:
-- админ видит не только число смет, но и названия смет и владельцев (логин, почта).
-- Только для админа (проверка is_admin()). Считает по вхождению артикула в calc_data,
-- как и order_default_usage.

create or replace function public.order_default_estimates(p_ids text[])
returns table(item_id text, estimate_id text, project_name text, created_at timestamptz,
              owner_id text, owner_username text, owner_email text)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select i.id::text,
           e.id::text,
           e.project_name::text,
           e.created_at,
           u.id::text,
           u.username::text,
           u.email::text
      from unnest(p_ids) as i(id)
      join public.estimates e on position(i.id in e.calc_data::text) > 0
      left join public.users u on u.id = e.user_id
     order by e.created_at desc;
end;
$function$;

revoke all on function public.order_default_estimates(text[]) from public;
grant execute on function public.order_default_estimates(text[]) to authenticated;
