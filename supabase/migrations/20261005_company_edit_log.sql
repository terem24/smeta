-- Журнал смены реквизитов и логотипа.
--
-- Кто и когда менял реквизиты, видно в панели («Тарифы» → «Кто менял реквизиты»).
-- Три вида записей в той же team_activity:
--   company_edit      — человек сам поменял свои реквизиты или логотип в кабинете;
--   dist_brand        — администратор поменял реквизиты дистрибьютора (для всей компании);
--   dist_brand_delete — администратор удалил реквизиты дистрибьютора.
-- Свои правки может записать любой вошедший (раньше журнал вели только менеджеры
-- и руководители), записи про дистрибьютора — только администратор.
-- Читают, как и раньше, по team_activity_visible: администратор видит всё,
-- человек — свои записи.

create or replace function public.log_team_activity(p_action text, p_distributor uuid default null::uuid, p_target_user uuid default null::uuid, p_target text default null::text, p_meta jsonb default null::jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    u      public.users%rowtype;
    v_dist uuid;
    v_name text;
begin
    if p_action not in ('invite_share', 'invite_link', 'invite_qr', 'invite_print', 'status_change', 'message',
                        'company_edit', 'dist_brand', 'dist_brand_delete') then
        return;
    end if;

    select * into u from public.users where auth_user_id = auth.uid() limit 1;
    if not found then
        return;                                   -- гость: писать некому
    end if;

    v_dist := p_distributor;
    if v_dist is null and p_target_user is not null then
        select distributor_id into v_dist from public.users where id = p_target_user;
    end if;

    if p_action = 'company_edit' then
        -- своя правка: пишет любой вошедший, филиал — свой
        p_target_user := null;
        if v_dist is null then v_dist := u.distributor_id; end if;
    elsif p_action in ('dist_brand', 'dist_brand_delete') then
        if not public.is_admin() then
            return;
        end if;
    elsif not (
        public.is_admin()
        or coalesce(u.account_type, '') in ('admin', 'viewer', 'manager')
        or (v_dist is not null and exists (
                select 1 from public.distributors d
                 where d.id = v_dist
                   and exists (
                        select 1 from unnest(array[lower(btrim(coalesce(u.email, ''))),
                                                   lower(btrim(coalesce(u.work_email, '')))]) m(v)
                         where m.v <> ''
                           and m.v in (lower(btrim(coalesce(d.manager_email, ''))),
                                       lower(btrim(coalesce(d.director_email, '')))))))
    ) then
        return;
    end if;

    -- meta приходит из браузера: не больше пары килобайт, иначе журнал превратится в свалку
    if p_meta is not null and (jsonb_typeof(p_meta) <> 'object' or length(p_meta::text) > 2000) then
        p_meta := null;
    end if;

    v_name := nullif(btrim(concat_ws(' ', u.last_name, u.first_name)), '');

    insert into public.team_activity
        (actor_id, actor_email, actor_name, actor_role, distributor_id, action, target_user_id, target, meta)
    values
        (u.id, u.email, coalesce(v_name, u.username, u.email), u.account_type,
         v_dist, p_action, p_target_user, left(p_target, 200), p_meta);
end;
$function$;
