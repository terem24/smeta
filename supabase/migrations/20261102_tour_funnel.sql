-- Воронка обучения: журнал tour_events пишет не только «пропустил» и «закрыл», но и
-- «начал блок» (start), «дошёл до шага» (step) и «закончил блок» (done).
--
-- ЗАЧЕМ. По skip/close видно, где бросают, но не видно, сколько людей вообще начинало и
-- какая доля дошла до каждого шага. Теперь видно: начали → дошли до шага N → закончили,
-- и сколько секунд в среднем люди проводят на шаге (по разнице времени между событиями step).
--
-- КТО ЧИТАЕТ. Таблица по-прежнему закрыта RLS без политик. Отчёт отдаёт функция tour_funnel —
-- только администратору (is_admin()), её показывает вкладка «Тарифы → Пробный период».
--
-- Выполнено в Supabase 02.11.2026 (проект stout-calc).

alter table public.tour_events drop constraint if exists tour_events_kind_check;
alter table public.tour_events add constraint tour_events_kind_check
    check (kind in ('skip', 'close', 'start', 'step', 'done'));

create index if not exists tour_events_created_idx on public.tour_events (created_at);

create or replace function public.log_tour_event(p_kind text, p_block text default null, p_step text default null, p_plan text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid;
begin
    v_user := public.grm_current_user_id();
    if v_user is null or p_kind not in ('skip', 'close', 'start', 'step', 'done') then
        return;
    end if;
    -- Один и тот же шаг, открытый повторно за минуту (перезагрузка, «Назад»), не пишем
    if p_kind in ('step', 'start') and exists (
        select 1 from public.tour_events e
         where e.user_id = v_user and e.kind = p_kind
           and e.block is not distinct from left(p_block, 40)
           and e.step is not distinct from left(p_step, 40)
           and e.created_at > now() - interval '1 minute') then
        return;
    end if;
    insert into public.tour_events (user_id, kind, block, step, plan)
    values (v_user, p_kind, left(p_block, 40), left(p_step, 40), left(p_plan, 40));
end;
$$;

revoke all on function public.log_tour_event(text, text, text, text) from public;
revoke execute on function public.log_tour_event(text, text, text, text) from anon;
grant execute on function public.log_tour_event(text, text, text, text) to authenticated;

-- Отчёт за последние p_days дней: по каждому блоку и шагу — сколько человек начали блок,
-- дошли до шага, пропустили его, закрыли обучение на нём, закончили блок, и медиана секунд
-- на шаге (до следующего события того же человека, не дольше 15 минут).
create or replace function public.tour_funnel(p_days int default 30)
returns table (block text, step text, reached bigint, skipped bigint, closed bigint, median_sec int)
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception 'Только для администратора' using errcode = '42501';
    end if;
    return query
    with ev as (
        select e.user_id, e.kind, e.block, e.step, e.created_at,
               lead(e.created_at) over (partition by e.user_id order by e.created_at, e.id) as next_at
          from public.tour_events e
         where e.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
    )
    select ev.block,
           coalesce(case when ev.kind = 'start' then '·start' when ev.kind = 'done' then '·done' else ev.step end, '') as step,
           count(distinct ev.user_id) filter (where ev.kind in ('step', 'start', 'done')) as reached,
           count(distinct ev.user_id) filter (where ev.kind = 'skip') as skipped,
           count(distinct ev.user_id) filter (where ev.kind = 'close') as closed,
           (percentile_cont(0.5) within group (order by extract(epoch from (ev.next_at - ev.created_at)))
               filter (where ev.kind = 'step' and ev.next_at is not null and ev.next_at - ev.created_at < interval '15 minutes'))::int as median_sec
      from ev
     group by 1, 2;
end;
$$;

revoke all on function public.tour_funnel(int) from public;
revoke execute on function public.tour_funnel(int) from anon;
grant execute on function public.tour_funnel(int) to authenticated;
