-- Глубина просмотра: сколько страниц открыл посетитель за визит.
--
-- Сайт — это не один экран: калькулятор плюс около 280 статей, страниц городов и
-- новостей. Метрика считает глубину сама, но только для согласившихся на куки;
-- здесь то же самое считается для всех. Каждая загрузка страницы внутри визита
-- вызывает visit_hit и прибавляет единицу.
--
-- Без этой миграции всё работает как раньше: вызов visit_hit молча не срабатывает,
-- в админке просто не будет глубины.
--
-- Выполнить вручную в Supabase SQL Editor, весь файл целиком за один раз.

alter table public.visits add column if not exists pages int not null default 1;

-- Ещё одна страница в текущем визите. Чужой визит (другой visitor_id) не меняется;
-- не больше 200 страниц на визит и только в течение 12 часов после начала.
create or replace function public.visit_hit(p_id bigint, p_visitor text)
returns void
language sql
security definer
set search_path = public
as $$
    update public.visits
       set pages = least(pages + 1, 200)
     where id = p_id and visitor_id = p_visitor
       and created_at > now() - interval '12 hours';
$$;

grant execute on function public.visit_hit(bigint, text) to anon, authenticated;
