-- Заблокированные: без писем, удаляются сами.
--
-- Раньше «давно не заходил» (process_inactive_accounts) слал заблокированным предупреждение
-- «вы не заходили», хотя зайти они не могли, потом замораживал и удалял. Теперь:
--   * предупреждения и заморозка заблокированных пропускаются, писем нет;
--   * заблокированный, молчавший дольше порога заморозки (freeze, по умолчанию 25 дней),
--     удаляется ночным заданием сразу, вместе со сметами, перепиской и логином;
--   * админов, наблюдателей, менеджеров и действующий Профи (pro) задание не трогает, как и раньше;
--   * удаление заблокированного пишется как ручное (kind 'manual', запрет регистрации бессрочно).
-- «Без смет» (process_empty_accounts) заблокированных по-прежнему не трогает.

create or replace function public.log_inactive_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_kind text;
begin
    if coalesce(old.is_blocked, false) then
        v_kind := 'manual';
    elsif old.frozen_at is not null then
        v_kind := 'inactive';
    elsif auth.uid() is not null and public.is_admin()
          and old.auth_user_id is distinct from auth.uid() then
        v_kind := 'manual';
    else
        return old;
    end if;

    begin
        insert into public.inactivity_deleted
            (user_id, name, email, phone, region, city, warned_at, frozen_at, last_visited, estimates, kind, block_days)
        select old.id,
               coalesce(nullif(btrim(concat_ws(' ', old.last_name, old.first_name, old.middle_name)), ''),
                        nullif(btrim(old.username), ''), old.email, 'Без имени'),
               old.email, old.phone, old.region, old.city,
               (select n.warned_at from public.inactivity_notices n where n.user_id = old.id),
               old.frozen_at, old.last_visited,
               (select count(*)::int from public.estimates e where e.user_id = old.id),
               v_kind, case when v_kind = 'manual' then 3650 else 365 end;
    exception when others then
        raise notice 'log_inactive_deletion: след об учётке % не записан', old.id;
    end;
    return old;
end;
$$;

create or replace function public.process_inactive_accounts(dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    warn_days       int := 20;
    freeze_days     int := 25;
    delete_days     int := 10;
    grace_days      constant int := 5;
    cfg             jsonb;

    sender   uuid;
    u        record;
    nm       text;
    msg_id   uuid;
    freeze_on  timestamptz;
    delete_on  timestamptz;
    body     text;
    warned   int := 0;
    frozen   int := 0;
    deleted  int := 0;
    sent     boolean;
begin
    select value into cfg from public.app_settings where key = 'inactivity_days';
    if cfg is not null then
        begin
            warn_days   := coalesce((cfg->>'warn')::int,   warn_days);
            freeze_days := coalesce((cfg->>'freeze')::int, freeze_days);
            delete_days := coalesce((cfg->>'delete')::int, delete_days);
        exception when others then
            raise notice 'process_inactive_accounts: inactivity_days нельзя прочитать, взяты 20/25/10';
            warn_days := 20; freeze_days := 25; delete_days := 10;
        end;
    end if;
    warn_days   := greatest(warn_days, 1);
    freeze_days := greatest(freeze_days, warn_days);
    delete_days := greatest(delete_days, 1);

    select id into sender from public.users
     where lower(btrim(email)) = 'dima24ba@gmail.com' limit 1;
    if sender is null then
        select id into sender from public.users
         where account_type = 'admin' order by created_at limit 1;
    end if;

    -- ── 5.0. Заблокированные: без писем, молчат дольше порога заморозки — удаляем ──
    for u in
        select us.id, us.auth_user_id, us.email
          from public.users us
         where coalesce(us.is_blocked, false)
           and greatest(coalesce(us.last_visited, us.created_at),
                        case when us.demo_ends_at <= now() then us.demo_ends_at end)
               < now() - make_interval(days => freeze_days)
           and us.account_type not in ('admin', 'viewer', 'manager', 'pro')
    loop
        if not dry_run then
            delete from public.estimates where user_id = u.id;
            delete from public.messages where sender_id = u.id or recipient_id = u.id;
            delete from public.manager_chat_messages
             where installer_user_id = u.id or manager_user_id = u.id or sender_user_id = u.id;
            perform public.purge_user_everywhere(u.id, u.auth_user_id, u.email);
            delete from public.users where id = u.id;

            begin
                if u.auth_user_id is not null then
                    delete from auth.users where id = u.auth_user_id;
                end if;
            exception when others then
                raise notice 'process_inactive_accounts: логин заблокированного % не удалён', u.email;
            end;
        end if;
        deleted := deleted + 1;
    end loop;

    -- ── 5.1. Удаление: заморожен и за delete_days так и не написал ──
    for u in
        select us.id, us.email, us.username, us.last_name, us.first_name
          from public.users us
         where us.frozen_at is not null
           and us.frozen_at < now() - make_interval(days => delete_days)
           and us.account_type not in ('admin', 'viewer', 'manager', 'pro')
           and not exists (select 1 from public.empty_accounts_log l where l.user_id = us.id and l.action = 'frozen')
    loop
        if not dry_run then
            delete from public.estimates where user_id = u.id;
            delete from public.messages where sender_id = u.id or recipient_id = u.id;
            delete from public.manager_chat_messages
             where installer_user_id = u.id or manager_user_id = u.id or sender_user_id = u.id;
            delete from public.users where id = u.id;

            begin
                delete from auth.users au
                 where lower(btrim(au.email)) = lower(btrim(coalesce(u.email, '')))
                   and btrim(coalesce(u.email, '')) <> '';
            exception when others then
                raise notice 'process_inactive_accounts: логин % в auth.users не удалён (нет прав)', u.email;
            end;
        end if;
        deleted := deleted + 1;
    end loop;

    -- ── 5.2. Заморозка ──
    for u in
        select * from (
            select us.id, us.email, us.username, us.first_name, us.middle_name,
                   greatest(coalesce(us.last_visited, us.created_at),
                            case when us.demo_ends_at <= now() then us.demo_ends_at end) as last_seen,
                   n.warned_at, n.warned_for
              from public.users us
              join public.inactivity_notices n on n.user_id = us.id
             where us.frozen_at is null
               and n.mail_sent is true
               and us.account_type not in ('admin', 'viewer', 'manager', 'pro')
               and coalesce(us.is_blocked, false) = false
        ) s
         where s.last_seen < now() - make_interval(days => freeze_days)
           and s.warned_at is not null
           and s.warned_at < now() - make_interval(days => grace_days)
           and s.warned_for = s.last_seen
    loop
        delete_on := now() + make_interval(days => delete_days);
        nm := coalesce(nullif(btrim(u.first_name), ''), nullif(btrim(u.username), ''), 'Коллега');
        body := format(
E'%s, доступ к вашей учётной записи на HeatCalc.ru приостановлен: в калькулятор не заходили больше %s дней.\n\nРасчёты и сметы никуда не делись — они сохранены и ждут вас.\n\nЧтобы вернуть доступ, напишите на kovdor24@yandex.ru или в MAX: +7 982 610-95-48. Включим в тот же день, ничего заполнять заново не придётся.\n\nЕсли до %s мы не получим ответа, учётная запись будет удалена вместе со всеми сохранёнными расчётами.\n\nАдминистрация HeatCalc.ru',
            nm, freeze_days, public.ru_date(delete_on));

        if not dry_run then
            update public.users set frozen_at = now() where id = u.id;
            update public.inactivity_notices
               set stage = 'frozen', frozen_at = now(), updated_at = now()
             where user_id = u.id;

            if sender is not null then
                insert into public.messages (sender_id, recipient_id, text, type)
                values (sender, u.id, body, 'private');
            end if;
            perform public.inactivity_send_email(u.email, 'Доступ к HeatCalc.ru приостановлен', body);
            perform public.inactivity_send_push(u.id);
        end if;
        frozen := frozen + 1;
    end loop;

    -- ── 5.3. Предупреждение ──
    for u in
        select * from (
            select us.id, us.email, us.username, us.first_name, us.middle_name,
                   greatest(coalesce(us.last_visited, us.created_at),
                            case when us.demo_ends_at <= now() then us.demo_ends_at end) as last_seen,
                   n.warned_for
              from public.users us
              left join public.inactivity_notices n on n.user_id = us.id
             where us.frozen_at is null
               and us.account_type not in ('admin', 'viewer', 'manager', 'pro')
               and coalesce(us.is_blocked, false) = false
        ) s
         where s.last_seen < now() - make_interval(days => warn_days)
           and (s.warned_for is null or s.warned_for <> s.last_seen)
    loop
        if not public.mail_allowed('inactivity') then continue; end if;
        freeze_on := greatest(u.last_seen + make_interval(days => freeze_days),
                              now() + make_interval(days => grace_days));
        delete_on := freeze_on + make_interval(days => delete_days);
        nm := coalesce(nullif(btrim(u.first_name), ''), nullif(btrim(u.username), ''), 'Коллега');
        body := format(
E'%s, вы уже %s дней не заходили в калькулятор HeatCalc.ru.\n\nЕсли так и не зайдёте, %s мы приостановим доступ к вашей учётной записи, а %s удалим её вместе со всеми сохранёнными расчётами и сметами.\n\nЧтобы этого не случилось, достаточно открыть heatcalc.ru и зайти в свой аккаунт — отсчёт начнётся заново, никаких действий больше не нужно.\n\nЕсли аккаунт вам больше не нужен, просто не обращайте внимания на это письмо.\n\nАдминистрация HeatCalc.ru',
            nm, warn_days, public.ru_date(freeze_on), public.ru_date(delete_on));

        if not dry_run then
            if sender is not null then
                insert into public.messages (sender_id, recipient_id, text, type)
                values (sender, u.id, body, 'private')
                returning id into msg_id;
            end if;

            insert into public.inactivity_notices (user_id, stage, warned_at, warned_for, updated_at)
            values (u.id, 'warned', now(), u.last_seen, now())
            on conflict (user_id) do update
                set stage = 'warned', warned_at = now(),
                    warned_for = excluded.warned_for, updated_at = now();

            sent := public.inactivity_send_email(u.email, 'Вы давно не заходили в HeatCalc.ru', body);
            update public.inactivity_notices set mail_sent = sent where user_id = u.id;
            perform public.inactivity_send_push(u.id);
        end if;
        warned := warned + 1;
    end loop;

    if dry_run then
        raise notice 'process_inactive_accounts (пробный запуск, ничего не менялось): предупреждено %, заморожено %, удалено %',
            warned, frozen, deleted;
    else
        raise notice 'process_inactive_accounts: предупреждено %, заморожено %, удалено %',
            warned, frozen, deleted;
    end if;

    return jsonb_build_object('warned', warned, 'frozen', frozen, 'deleted', deleted, 'dry_run', dry_run);
end;
$function$;
