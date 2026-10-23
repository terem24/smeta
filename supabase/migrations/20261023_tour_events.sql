-- Журнал «где бросают обучение» (tour.js): шаг, на котором нажали «Пропустить шаг» или закрыли крестиком.
--
-- ЗАЧЕМ. mark_tour_done говорит, кто дошёл до конца, но не говорит, где остальные
-- отваливаются. По этому журналу видно шаги, которые надо переписать.
--
-- КТО ПИШЕТ. Только функция ниже и только про самого себя (user_id из сессии). Таблица
-- закрыта RLS без политик: читать её можно из SQL Editor и из панели управления.
--
-- Выполнить вручную в Supabase SQL Editor, весь файл целиком. Без миграции обучение
-- работает как раньше: запрос тихо падает.
--
-- Что смотреть:
--   select block, step, kind, count(*) from public.tour_events group by 1,2,3 order by 4 desc;

create table if not exists public.tour_events (
    id         bigserial primary key,
    user_id    uuid not null,
    kind       text not null check (kind in ('skip', 'close')),
    block      text,
    step       text,
    plan       text,
    created_at timestamptz not null default now()
);

alter table public.tour_events enable row level security;

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
    if v_user is null or p_kind not in ('skip', 'close') then
        return;
    end if;
    insert into public.tour_events (user_id, kind, block, step, plan)
    values (v_user, p_kind, left(p_block, 40), left(p_step, 40), left(p_plan, 40));
end;
$$;

revoke all on function public.log_tour_event(text, text, text, text) from public;
grant execute on function public.log_tour_event(text, text, text, text) to authenticated;
