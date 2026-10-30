-- Блокировка пользователя на стороне сервера.
--
-- Раньше is_blocked проверял только браузер (handleAuthSession): у кого вкладка уже открыта
-- или кто ходит в API напрямую своим токеном, тот продолжал работать. Теперь три слоя:
--   1. Бан во входе Supabase: при is_blocked = true учётке в auth.users ставится banned_until,
--      все её сессии удаляются. Обновить токен и войти заново нельзя ни по паролю, ни через Google.
--   2. Запрет в базе: пока действует уже выданный токен (до часа), политики RESTRICTIVE
--      закрывают заблокированному любые запросы к таблицам (кроме чтения своей строки users —
--      по ней сайт узнаёт о блокировке и показывает окно).
--   3. Сайт сам опрашивает is_blocked (app.js, enforceBlocked) и выкидывает человека сразу.
-- Разблокировка (is_blocked = false) снимает бан. Данные и сметы не трогаются.
-- Функции базы с security definer (RPC) политиками не закрываются — это отдельный список.
--
-- Выполнить в Supabase SQL Editor целиком.

-- ── 1. Бан во входе ──
create or replace function public.users_block_sync()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
    if NEW.auth_user_id is null then return NEW; end if;
    if coalesce(NEW.is_blocked, false) then
        update auth.users set banned_until = now() + interval '100 years' where id = NEW.auth_user_id;
        delete from auth.sessions where user_id = NEW.auth_user_id;
    else
        update auth.users set banned_until = null where id = NEW.auth_user_id and banned_until is not null;
    end if;
    return NEW;
end;
$$;
revoke all on function public.users_block_sync() from public, anon, authenticated;

drop trigger if exists users_block_sync on public.users;
create trigger users_block_sync
    after update of is_blocked on public.users
    for each row
    when (OLD.is_blocked is distinct from NEW.is_blocked)
    execute function public.users_block_sync();

-- Уже заблокированные до этой миграции
update auth.users a set banned_until = now() + interval '100 years'
  from public.users u
 where u.auth_user_id = a.id and coalesce(u.is_blocked, false);
delete from auth.sessions s
 using public.users u
 where u.auth_user_id = s.user_id and coalesce(u.is_blocked, false);

-- ── 2. Запрет в базе на время жизни выданного токена ──
create or replace function public.is_blocked_me()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (select 1 from public.users where auth_user_id = auth.uid() and is_blocked);
$$;
revoke all on function public.is_blocked_me() from public, anon;
grant execute on function public.is_blocked_me() to authenticated;

do $$
declare t record;
begin
    for t in
        select c.relname
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
    loop
        execute format('drop policy if exists block_deny on public.%I', t.relname);
        if t.relname = 'users' then
            -- читать свою строку можно: по ней сайт показывает окно «заблокирован»
            execute 'drop policy if exists block_deny_ins on public.users';
            execute 'drop policy if exists block_deny_upd on public.users';
            execute 'drop policy if exists block_deny_del on public.users';
            execute 'create policy block_deny_ins on public.users as restrictive for insert to authenticated with check ((select not public.is_blocked_me()))';
            execute 'create policy block_deny_upd on public.users as restrictive for update to authenticated using ((select not public.is_blocked_me()))';
            execute 'create policy block_deny_del on public.users as restrictive for delete to authenticated using ((select not public.is_blocked_me()))';
        else
            execute format(
                'create policy block_deny on public.%I as restrictive for all to authenticated using ((select not public.is_blocked_me())) with check ((select not public.is_blocked_me()))',
                t.relname);
        end if;
    end loop;
end $$;
