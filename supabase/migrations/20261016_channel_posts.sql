-- Посты Telegram-канала @heatcalc_ru: план, черновики, утверждённые, опубликованные.
--
-- Видит и правит только админ (вкладка «Контент → Канал»). Публикует робот GitHub
-- (workflow channel-post.yml): через Edge Function channel-queue берёт утверждённые
-- посты, чей день настал, отправляет в канал и отмечает sent. Функция ходит под
-- service role, поэтому RLS здесь только для админки.
--
-- Статусы: draft — черновик (не уйдёт), approved — утверждён (уйдёт в свой день),
-- sent — опубликован, skip — отложен/отклонён.

create table if not exists public.channel_posts (
    id          bigint generated always as identity primary key,
    post_date   date not null,
    rubric      text not null default 'feature',
    title       text not null default '',
    body        text not null default '',          -- HTML Telegram: <b>, <i>, <a>
    image       text,                              -- путь в репозитории: channel/img/x.png
    button_text text,
    button_url  text,
    status      text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'skip')),
    sources     jsonb not null default '[]'::jsonb, -- откуда материал: [{title, url}]
    tg_message_id bigint,
    sent_at     timestamptz,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists channel_posts_date_idx on public.channel_posts (post_date);

alter table public.channel_posts enable row level security;

drop policy if exists channel_posts_admin_all on public.channel_posts;
create policy channel_posts_admin_all on public.channel_posts
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

create or replace function public.channel_posts_touch() returns trigger
language plpgsql set search_path = public as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists channel_posts_touch on public.channel_posts;
create trigger channel_posts_touch before update on public.channel_posts
    for each row execute function public.channel_posts_touch();
