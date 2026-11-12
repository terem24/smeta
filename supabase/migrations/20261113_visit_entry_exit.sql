-- Страницы входа и выхода, переход «статья -> калькулятор».
--
-- exit_page — последняя страница визита, calc — открывал ли посетитель калькулятор
-- в этом визите. Так видно, какие статьи приводят людей в калькулятор, а какие
-- просто читают и уходят. До выкладки статьи не учитывались, и все визиты были
-- визитами калькулятора: у них calc проставляется задним числом.
--
-- Без этой миграции всё работает как раньше, в админке просто нет этих колонок.
-- Выполнить вручную в Supabase SQL Editor, весь файл целиком за один раз.

alter table public.visits add column if not exists exit_page text;
alter table public.visits add column if not exists calc boolean not null default false;

update public.visits set calc = true
 where created_at < now() - interval '1 day' or landing in ('/', '/index.html');

-- Новая версия visit_hit с путём страницы и отметкой калькулятора. Старую убираем:
-- две функции с одним именем и необязательными параметрами конфликтуют.
drop function if exists public.visit_hit(bigint, text);

create or replace function public.visit_hit(p_id bigint, p_visitor text, p_path text default null, p_calc boolean default false)
returns void
language sql
security definer
set search_path = public
as $$
    update public.visits
       set pages = least(pages + 1, 200),
           exit_page = coalesce(left(p_path, 120), exit_page),
           calc = calc or coalesce(p_calc, false)
     where id = p_id and visitor_id = p_visitor
       and created_at > now() - interval '12 hours';
$$;

grant execute on function public.visit_hit(bigint, text, text, boolean) to anon, authenticated;

-- Отметка без прибавления страницы: для первой страницы нового визита
create or replace function public.visit_mark(p_id bigint, p_visitor text, p_path text, p_calc boolean)
returns void
language sql
security definer
set search_path = public
as $$
    update public.visits
       set exit_page = left(p_path, 120),
           calc = calc or coalesce(p_calc, false)
     where id = p_id and visitor_id = p_visitor
       and created_at > now() - interval '12 hours';
$$;

grant execute on function public.visit_mark(bigint, text, text, boolean) to anon, authenticated;
