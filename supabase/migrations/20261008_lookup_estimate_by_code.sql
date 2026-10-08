-- Поиск КП по номеру («Загрузить по коду») — только после входа и с учётом роли.
-- Раньше смету по номеру отдавала любому, даже без входа (таблица estimates была открыта на чтение),
-- а КП с версией («665761-1») не находилось вовсе — искали точное совпадение share_id.
--
-- lookup_estimate_by_code(p_code) возвращает jsonb:
--   {status:'auth'}                      — нет входа
--   {status:'notfound'}                  — такого номера нет
--   {status:'foreign'}                   — смета чужая, а роль не даёт её открывать (монтажник, продавец
--                                          и т. д.): сама смета НЕ отдаётся, даже имя автора
--   {status:'ok', id, calc_data, user_id, username, mine}
--                                        — владелец, администратор, менеджер или наблюдатель
-- Версия КП в номере («665761-2») отбрасывается: у сметы один share_id, версии лежат внутри calc_data.
--
-- Важно: если выполнена функция load_estimate_by_code из 20261008_estimates_close_public_access.sql
-- (она отдаёт смету и анониму), её нужно убрать после публикации app.js с этим вызовом:
--   revoke execute on function public.load_estimate_by_code(text) from anon, authenticated;

create or replace function public.lookup_estimate_by_code(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  raw text := btrim(coalesce(p_code, ''));
  code text;
  me record;
  est record;
  privileged boolean := false;
  mine boolean := false;
begin
  if auth.uid() is null then
    return jsonb_build_object('status', 'auth');
  end if;

  -- «665761-1» → «665761»; коды вида HC-… не трогаем
  if raw ~ '^\d{6}\s*[-–—/]\s*\d{1,3}$' then
    code := substring(raw from '^\d{6}');
  else
    code := raw;
  end if;
  if code = '' then
    return jsonb_build_object('status', 'notfound');
  end if;

  select u.id, u.account_type into me
    from public.users u where u.auth_user_id = auth.uid() limit 1;

  select e.id, e.calc_data, e.user_id, u.username into est
    from public.estimates e
    left join public.users u on u.id = e.user_id
   where e.share_id = code
   order by e.created_at asc
   limit 1;

  if not found then
    return jsonb_build_object('status', 'notfound');
  end if;

  mine := me.id is not null and est.user_id = me.id;
  privileged := public.is_admin() or coalesce(me.account_type, '') in ('manager', 'viewer');

  if not (mine or privileged) then
    return jsonb_build_object('status', 'foreign');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'id', est.id,
    'calc_data', est.calc_data,
    'user_id', est.user_id,
    'username', est.username,
    'mine', mine
  );
end;
$$;

revoke all on function public.lookup_estimate_by_code(text) from public;
revoke all on function public.lookup_estimate_by_code(text) from anon;
grant execute on function public.lookup_estimate_by_code(text) to authenticated;
