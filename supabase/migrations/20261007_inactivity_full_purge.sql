-- Ночная чистка неактивных удаляла профиль, но не всегда учётку входа (auth.users).
--
-- Причина. process_inactive_accounts (20260922_inactivity_shorter_and_pro_pause.sql) удаляет
-- профиль и сметы, потом пытается удалить учётку входа, но делает это в блоке
-- «exception when others → notice»: любая ошибка глотается. Ошибка есть всегда, когда у человека
-- остались КП-ссылки: shared_invoices.user_id ссылается на auth.users(id) без ON DELETE, и
-- база не даёт удалить учётку. Профиль к этому моменту уже стёрт, учётка остаётся «хвостом»
-- (на 07.10.2026 так осталось 19 человек, пока их не удалили вручную).
--
-- Что меняется:
--   1) новая функция purge_user_everywhere стирает то, что не удаляется каскадом: КП-ссылки,
--      события журнала, диалоги помощника, проекты. Без неё учётка не удаляется;
--   2) ночная функция сначала зовёт её, потом удаляет учётку входа по идентификатору
--      (а не только по почте), и при ошибке пишет причину в журнал Postgres.
-- Ночной проход не меняется в остальном: пороги, письма, заморозка, предупреждения прежние.
--
-- Откат: вернуть прежний текст функции из 20260922_inactivity_shorter_and_pro_pause.sql
--   и при желании: drop function public.purge_user_everywhere(uuid, uuid, text);

create or replace function public.purge_user_everywhere(p_public_id uuid, p_auth_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    em text := lower(btrim(coalesce(p_email, '')));
begin
    -- События журнала по КП этого человека; номер КП должен быть только у его счетов
    delete from public.invoice_events ev
     where (
            ev.calc_id in (
                select s.object_info->>'sequence_id'
                  from public.shared_invoices s
                 where (s.user_id = p_auth_id or s.user_id = p_public_id)
                   and s.object_info->>'sequence_id' is not null
                   and not exists (
                        select 1 from public.shared_invoices s2
                         where s2.object_info->>'sequence_id' = s.object_info->>'sequence_id'
                           and not (s2.user_id = p_auth_id or s2.user_id = p_public_id)))
            or (em <> '' and lower(ev.user_email) = em)
            or ev.user_id in (coalesce(p_public_id::text, ''), coalesce(p_auth_id::text, ''))
           );

    delete from public.shared_invoices s where s.user_id = p_auth_id or s.user_id = p_public_id;

    delete from public.ai_fill_sessions a
     where (p_auth_id is not null and a.auth_user_id = p_auth_id)
        or (em <> '' and lower(a.user_email) = em);

    delete from public.projects p where em <> '' and lower(p.user_email) = em;
end;
$$;

revoke execute on function public.purge_user_everywhere(uuid, uuid, text) from public, anon, authenticated;

do $do$
declare
    d text;
begin
    d := pg_get_functiondef('public.process_inactive_accounts(boolean)'::regprocedure);

    -- переменная для идентификатора учётки входа
    d := replace(d, 'deleted  int := 0;', 'deleted  int := 0; v_auth uuid;');

    -- перед стиранием профиля: найти учётку входа и подчистить связанное
    d := replace(d,
        'delete from public.estimates where user_id = u.id;',
        'select us2.auth_user_id into v_auth from public.users us2 where us2.id = u.id; '
        || 'perform public.purge_user_everywhere(u.id, v_auth, u.email); '
        || 'delete from public.estimates where user_id = u.id;');

    -- удалять учётку входа по идентификатору, затем прежним способом по почте
    d := regexp_replace(d,
        'delete from auth\.users au',
        'delete from auth.users au2 where au2.id = v_auth; delete from auth.users au');

    -- причина отказа — в журнал, а не молча
    d := replace(d,
        'логин % в auth.users не удалён (нет прав)'', u.email;',
        'логин % в auth.users не удалён: %'', u.email, sqlerrm;');

    if d not like '%purge_user_everywhere%'
       or d not like '%v_auth uuid%'
       or d not like '%au2.id = v_auth%'
       or d not like '%не удалён: %' then
        raise exception 'process_inactive_accounts: подстановка не сработала';
    end if;
    execute d;
end
$do$;
