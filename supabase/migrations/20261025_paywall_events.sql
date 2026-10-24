-- Журнал пути к оплате: увидел закрытое → открыл окно тарифа → открыл оплату.
--
-- ЗАЧЕМ. «Готовность платить» знает регистрацию, сметы, КП и «Я оплатил», но не знает, видят ли
-- люди предложение Профи и доходят ли до окна оплаты. По этому журналу видно, на каком шаге
-- и из какого места (src) они отваливаются.
--
-- КТО ПИШЕТ. Только функция ниже и только про самого себя (user_id из сессии). Гости не пишутся.
-- Читает администратор (политика ниже): вкладка «Готовность платить» → «Путь к окну оплаты».
--
-- Выполнить вручную в Supabase SQL Editor, весь файл целиком. Без миграции сайт работает как
-- раньше: запись тихо падает, вкладка пишет, что журнала нет.
--
-- Что смотреть:
--   select kind, src, count(*), count(distinct user_id) from public.paywall_events group by 1,2 order by 3 desc;

create table if not exists public.paywall_events (
    id         bigserial primary key,
    user_id    uuid not null,
    kind       text not null check (kind in ('seen', 'tariff_open', 'pay_open')),
    src        text,
    plan       text,
    created_at timestamptz not null default now()
);

create index if not exists paywall_events_kind_idx on public.paywall_events (kind, created_at desc);

alter table public.paywall_events enable row level security;

drop policy if exists paywall_events_admin_read on public.paywall_events;
create policy paywall_events_admin_read on public.paywall_events
    for select using (public.is_admin());

create or replace function public.log_paywall_event(p_kind text, p_src text default null, p_plan text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid;
begin
    v_user := public.grm_current_user_id();
    if v_user is null or p_kind not in ('seen', 'tariff_open', 'pay_open') then
        return;
    end if;
    insert into public.paywall_events (user_id, kind, src, plan)
    values (v_user, p_kind, left(p_src, 120), left(p_plan, 40));
end;
$$;

revoke all on function public.log_paywall_event(text, text, text) from public;
grant execute on function public.log_paywall_event(text, text, text) to authenticated;
revoke execute on function public.log_paywall_event(text, text, text) from anon;
