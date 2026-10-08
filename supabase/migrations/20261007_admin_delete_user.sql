-- Ручное удаление пользователя из админки теперь стирает и учётку входа.
--
-- Было: кнопка «Удалить» (app.deleteUserCompletely) из браузера удаляла строки в нескольких
-- таблицах и профиль, а учётку входа (auth.users) оставляла: для её удаления нужен служебный
-- ключ, которого у страницы нет. Так остались «хвосты» у 14 из 19 человек, удалённых 06.10.2026.
--
-- Стало: одна серверная функция admin_delete_user_completely(p_user_id), которую зовёт кнопка.
-- Она работает от имени владельца базы, но сама проверяет, кто её вызвал:
--   * вызвать может только администратор (is_admin());
--   * администраторов, наблюдателей и менеджеров удаляет только владелец (три адреса из is_admin());
--   * себя удалить нельзя, защищённые адреса владельца удалить нельзя.
-- Что стирает: сметы, сообщения, чаты с менеджером, КП-ссылки, события журнала, диалоги помощника,
-- проекты (purge_user_everywhere), профиль и учётку входа.
-- В журнал «удалённых» запись по-прежнему делает триггер log_inactive_deletion: он видит
-- администратора в сессии и помечает удаление как 'manual' (запрет повторной регистрации 30 дней).
--
-- Откат: drop function public.admin_delete_user_completely(uuid);
--   и вернуть прежний deleteUserCompletely в app.js.

create or replace function public.admin_delete_user_completely(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    owners constant text[] := array['kovdorekb@gmail.com', 'kovdor24@yandex.ru', 'dima24ba@gmail.com'];
    caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
    u record;
    n int;
begin
    if auth.uid() is null or not public.is_admin() then
        return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;

    select id, auth_user_id, email, account_type into u from public.users where id = p_user_id;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;

    if u.auth_user_id is not null and u.auth_user_id = auth.uid() then
        return jsonb_build_object('ok', false, 'error', 'self');
    end if;
    if lower(coalesce(u.email, '')) = any(owners) then
        return jsonb_build_object('ok', false, 'error', 'protected');
    end if;
    if u.account_type in ('admin', 'viewer', 'manager') and not (caller_email = any(owners)) then
        return jsonb_build_object('ok', false, 'error', 'owner_only');
    end if;

    delete from public.estimates where user_id = u.id;
    delete from public.messages where sender_id = u.id or recipient_id = u.id;
    delete from public.manager_chat_messages
     where installer_user_id = u.id or manager_user_id = u.id or sender_user_id = u.id;

    perform public.purge_user_everywhere(u.id, u.auth_user_id, u.email);

    delete from public.users where id = u.id;
    get diagnostics n = row_count;
    if n = 0 then
        return jsonb_build_object('ok', false, 'error', 'not_deleted');
    end if;

    if u.auth_user_id is not null then
        begin
            delete from auth.users where id = u.auth_user_id;
        exception when others then
            return jsonb_build_object('ok', true, 'auth_deleted', false, 'warning', sqlerrm);
        end;
    end if;

    return jsonb_build_object('ok', true, 'auth_deleted', u.auth_user_id is not null);
end;
$$;

revoke execute on function public.admin_delete_user_completely(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_user_completely(uuid) to authenticated;
