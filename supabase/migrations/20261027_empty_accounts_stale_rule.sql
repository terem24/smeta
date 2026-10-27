-- Правило «без смет» дополняется вторым: базовый тариф, смет не создавал давно.
--
-- Было: смет нет + заходил за последние N дней → не трогаем (skip_active). Теперь
-- заходы не защищают: нет смет — заморозка через freeze_days после регистрации.
--
-- Новое: у базового тарифа (base/free) смет несколько, но ни одной новой (создания или
-- правки) за stale_days дней — тоже заморозка, а дальше удаление. Профи, админов,
-- менеджеров, наблюдателей, заблокированных и тестовых не трогаем. Действующий Профи
-- и тот, у кого Профи закончился (account_type остался 'pro'), второму правилу не подлежат.
--
-- НАСТРОЙКИ app_settings.empty_accounts:
--   {"enabled": false, "freeze_days": 30, "stale_days": 60, "delete_days": 30}
--
-- ЧТО ПРОИСХОДИТ СО СМЕТАМИ ПРИ УДАЛЕНИИ: строки estimates удаляются целиком вместе с
-- учёткой (статуса «удалена» нет — записи просто исчезают), публичные ссылки на КП по
-- share_id перестают открываться. Исключение: у кого есть смета в статусе completed,
-- того не удаляем — он остаётся замороженным, решение за администратором. События
-- invoice_events остаются как были (без привязки по внешнему ключу).
--
-- Пробный запуск: select public.process_empty_accounts(true);

alter table public.empty_accounts_log add column if not exists reason text;      -- no_estimates | stale
alter table public.empty_accounts_log add column if not exists est_count int;

create or replace function public.empty_accounts_cfg()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    cfg jsonb;
    res jsonb := '{"enabled": false, "freeze_days": 30, "stale_days": 60, "delete_days": 30}'::jsonb;
begin
    select value into cfg from public.app_settings where key = 'empty_accounts';
    if cfg is not null then
        begin
            res := jsonb_build_object(
                'enabled',     coalesce((cfg->>'enabled')::boolean, false),
                'freeze_days', greatest(coalesce((cfg->>'freeze_days')::int, 30), 1),
                'stale_days',  greatest(coalesce((cfg->>'stale_days')::int, 60), 1),
                'delete_days', greatest(coalesce((cfg->>'delete_days')::int, 30), 1));
        exception when others then
            null;
        end;
    end if;
    return res;
end;
$$;
revoke all on function public.empty_accounts_cfg() from public, anon, authenticated;

create or replace function public.process_empty_accounts(dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    cfg         jsonb := public.empty_accounts_cfg();
    on_flag     boolean := (cfg->>'enabled')::boolean;
    freeze_days int := (cfg->>'freeze_days')::int;
    stale_days  int := (cfg->>'stale_days')::int;
    delete_days int := (cfg->>'delete_days')::int;
    sender      uuid;
    u           record;
    nm          text;
    body        text;
    frozen      int := 0;
    frozen_stale int := 0;
    deleted     int := 0;
    kept_done   int := 0;
begin
    if not on_flag and not dry_run then
        return jsonb_build_object('enabled', false);
    end if;

    select id into sender from public.users
     where lower(btrim(email)) = 'dima24ba@gmail.com' limit 1;
    if sender is null then
        select id into sender from public.users
         where account_type = 'admin' order by created_at limit 1;
    end if;

    -- ── Удаление: заморожен этим правилом, срок вышел ────────────────────────
    -- Смету со статусом completed не удаляем: такая учётка остаётся замороженной.
    for u in
        select us.id, us.email, us.username, us.phone, us.region, us.created_at,
               (select count(*)::int from public.estimates e where e.user_id = us.id) as n_est,
               (select l.reason from public.empty_accounts_log l
                 where l.user_id = us.id and l.action = 'frozen' order by l.at desc limit 1) as reason,
               coalesce(nullif(btrim(concat_ws(' ', us.last_name, us.first_name, us.middle_name)), ''),
                        nullif(btrim(us.username), ''), us.email, 'Без имени') as full_name
          from public.users us
         where us.frozen_at is not null
           and us.frozen_at < now() - make_interval(days => delete_days)
           and us.account_type not in ('admin', 'viewer', 'manager', 'pro')
           and exists (select 1 from public.empty_accounts_log l where l.user_id = us.id and l.action = 'frozen')
    loop
        if exists (select 1 from public.estimates e where e.user_id = u.id and e.status = 'completed') then
            kept_done := kept_done + 1;
            continue;
        end if;
        if not dry_run then
            insert into public.empty_accounts_log (user_id, action, name, email, phone, region, created_at_user, reason, est_count)
            values (u.id, 'deleted', u.full_name, u.email, u.phone, u.region, u.created_at, u.reason, u.n_est);

            update public.users set frozen_at = null where id = u.id;

            delete from public.estimates where user_id = u.id;
            delete from public.messages where sender_id = u.id or recipient_id = u.id;
            delete from public.manager_chat_messages
             where installer_user_id = u.id or manager_user_id = u.id or sender_user_id = u.id;
            delete from public.inactivity_notices where user_id = u.id;
            delete from public.users where id = u.id;

            begin
                delete from auth.users au
                 where lower(btrim(au.email)) = lower(btrim(coalesce(u.email, '')))
                   and btrim(coalesce(u.email, '')) <> '';
            exception when others then
                raise notice 'process_empty_accounts: логин % в auth.users не удалён (нет прав)', u.email;
            end;
        end if;
        deleted := deleted + 1;
    end loop;

    -- ── Заморозка ────────────────────────────────────────────────────────────
    --   no_estimates — смет нет, с регистрации прошло freeze_days (заходы не защищают);
    --   stale        — базовый тариф, смет несколько, последняя создана/правилась
    --                  больше stale_days дней назад.
    for u in
        select * from (
            select us.id, us.email, us.username, us.first_name, us.phone, us.region, us.created_at, us.account_type,
                   (select count(*)::int from public.estimates e where e.user_id = us.id) as n_est,
                   (select max(coalesce(e.updated_at, e.created_at)) from public.estimates e where e.user_id = us.id) as last_est,
                   coalesce(nullif(btrim(concat_ws(' ', us.last_name, us.first_name, us.middle_name)), ''),
                            nullif(btrim(us.username), ''), us.email, 'Без имени') as full_name
              from public.users us
             where us.frozen_at is null
               and us.account_type not in ('admin', 'viewer', 'manager')
               and not (us.account_type = 'pro'
                        and (us.pro_expires_at > now() or us.demo_ends_at is null or us.demo_ends_at > now()))
               and coalesce(us.is_blocked, false) = false
               and coalesce(us.is_test, false) = false
               and not exists (select 1 from public.empty_accounts_log l where l.user_id = us.id and l.action = 'frozen')
        ) s
         where (s.n_est = 0 and s.created_at < now() - make_interval(days => freeze_days))
            or (s.n_est > 0 and s.account_type in ('base', 'free')
                and s.last_est < now() - make_interval(days => stale_days))
    loop
        nm := coalesce(nullif(btrim(u.first_name), ''), nullif(btrim(u.username), ''), 'Коллега');
        if u.n_est = 0 then
            body := format(
E'%s, вы зарегистрировались на HeatCalc.ru, но за %s дней не сохранили ни одного расчёта — поэтому доступ к учётной записи приостановлен.

Если калькулятор вам нужен, напишите на kovdor24@yandex.ru или в MAX: +7 982 610-95-48 — включим в тот же день.

Если ответа не будет, через %s дней учётная запись будет удалена. Это ни на что не повлияет: зарегистрироваться заново можно в любой момент.

Администрация HeatCalc.ru',
                nm, freeze_days, delete_days);
        else
            body := format(
E'%s, в вашей учётной записи на HeatCalc.ru больше %s дней нет новых расчётов — поэтому доступ приостановлен.

Сохранённые расчёты (%s) пока никуда не делись. Чтобы вернуть доступ, напишите на kovdor24@yandex.ru или в MAX: +7 982 610-95-48 — включим в тот же день, ничего заполнять заново не придётся.

Если ответа не будет, через %s дней учётная запись и сохранённые в ней расчёты будут удалены, а ссылки на отправленные КП перестанут открываться.

Администрация HeatCalc.ru',
                nm, stale_days, u.n_est, delete_days);
        end if;

        if not dry_run then
            update public.users set frozen_at = now() where id = u.id;
            insert into public.empty_accounts_log (user_id, action, name, email, phone, region, created_at_user, reason, est_count)
            values (u.id, 'frozen', u.full_name, u.email, u.phone, u.region, u.created_at,
                    case when u.n_est = 0 then 'no_estimates' else 'stale' end, u.n_est);

            if sender is not null then
                insert into public.messages (sender_id, recipient_id, text, type)
                values (sender, u.id, body, 'private');
            end if;
            if u.email is not null and btrim(u.email) <> '' then
                perform public.inactivity_send_email(u.email, 'Доступ к HeatCalc.ru приостановлен', body);
            end if;
        end if;
        frozen := frozen + 1;
        if u.n_est > 0 then frozen_stale := frozen_stale + 1; end if;
    end loop;

    return jsonb_build_object('enabled', on_flag, 'frozen', frozen, 'frozen_stale', frozen_stale,
                              'deleted', deleted, 'kept_completed', kept_done, 'dry_run', dry_run);
end;
$$;
revoke all on function public.process_empty_accounts(boolean) from public, anon, authenticated;

update public.app_settings
   set value = (value - 'skip_active') || jsonb_build_object('stale_days', coalesce((value->>'stale_days')::int, 60))
 where key = 'empty_accounts';
