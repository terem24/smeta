-- Сколько сохранённых смет содержат каждую позицию «под заказ» из подбора по умолчанию.
-- Нужна вкладке админки «Замены позиций» → «Под заказ в подборе по умолчанию»:
-- по частоте и цене админ видит, с чего начинать. Только для админа; смет
-- посторонних пользователей функция не отдаёт (проверка is_admin()).
-- Считает по вхождению артикула в calc_data — точного учёта позиций в смете нет,
-- поэтому это «в скольких сметах встречается», а не «сколько штук».

create or replace function public.order_default_usage(p_ids text[])
returns table(item_id text, estimates integer)
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
           (select count(*)::int from public.estimates e
             where position(i.id in e.calc_data::text) > 0)
      from unnest(p_ids) as i(id);
end;
$function$;

revoke all on function public.order_default_usage(text[]) from public;
grant execute on function public.order_default_usage(text[]) to authenticated;
