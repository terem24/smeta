-- Выпуски ленты «Что нового» (heatcalc.ru/novosti/): план, черновики, утверждённые, опубликованные.
--
-- Видит и правит только админ (вкладка «Контент → Новости»). Публикует робот GitHub
-- (workflow weekly-digest.yml): через Edge Function news-queue забирает очередь, собирает
-- страницы и отмечает выпуск опубликованным. Функция ходит под service role,
-- RLS здесь только для админки.
--
-- Статусы: draft — черновик (не выйдет), approved — утверждён (выйдет в свой понедельник),
-- published — опубликован, rejected — отклонён (не выйдет и не считается в нумерации).
-- items — массив пунктов [{tag, h, t, b}]; recap — подборка на запас, не привязана к неделе.

create table if not exists public.news_issues (
    id           bigint generated always as identity primary key,
    issue_date   date not null unique,
    title        text not null default '',
    recap        boolean not null default false,
    items        jsonb not null default '[]'::jsonb,
    status       text not null default 'draft' check (status in ('draft', 'approved', 'published', 'rejected')),
    published_at date,
    push_status  text,                              -- null | дата отправки | skipped
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

alter table public.news_issues enable row level security;

drop policy if exists news_issues_admin_all on public.news_issues;
create policy news_issues_admin_all on public.news_issues
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

create or replace function public.news_issues_touch() returns trigger
language plpgsql set search_path = public as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists news_issues_touch on public.news_issues;
create trigger news_issues_touch before update on public.news_issues
    for each row execute function public.news_issues_touch();
