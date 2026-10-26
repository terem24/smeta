-- Журнал шагов регистрации и входа: где люди уходят из окна входа.
--
-- ЗАЧЕМ. Аккаунт создаётся только после правильного кода из письма, поэтому всё, что
-- было до него (почта, промокод, письмо, код), в users и auth.users не попадает. Этот
-- журнал пишет шаги до создания аккаунта, привязывая их к анонимному id сеанса.
--
-- КТО ПИШЕТ. Только функция log_reg_event (гость и вошедший). Прямой записи в таблицу нет.
-- ЧИТАЕТ. Только администратор (is_admin). Почту в журнале не храним: только домен почты.
--
-- Что смотреть:
--   select step, count(distinct session_id) from public.reg_events group by 1 order by 2 desc;

create table if not exists public.reg_events (
    id         bigserial primary key,
    session_id text not null,
    mode       text not null check (mode in ('login', 'register')),
    step       text not null,
    detail     text,
    created_at timestamptz not null default now()
);

create index if not exists reg_events_step_idx on public.reg_events (step, created_at desc);
create index if not exists reg_events_session_idx on public.reg_events (session_id);

alter table public.reg_events enable row level security;

drop policy if exists reg_events_admin_read on public.reg_events;
create policy reg_events_admin_read on public.reg_events
    for select using (public.is_admin());

create or replace function public.log_reg_event(p_session text, p_mode text, p_step text, p_detail text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_session is null or length(p_session) not between 8 and 64 then
        return;
    end if;
    if p_mode not in ('login', 'register') then
        return;
    end if;
    if p_step not in (
        'form_open', 'email_entered', 'email_taken', 'blocked', 'promo_refused',
        'code_sent', 'code_send_failed', 'code_wrong', 'code_ok',
        'account_created', 'signup_error',
        'login_sent', 'login_ok', 'login_error'
    ) then
        return;
    end if;
    insert into public.reg_events (session_id, mode, step, detail)
    values (p_session, p_mode, p_step, left(p_detail, 120));
end;
$$;

revoke all on function public.log_reg_event(text, text, text, text) from public;
grant execute on function public.log_reg_event(text, text, text, text) to anon, authenticated;
