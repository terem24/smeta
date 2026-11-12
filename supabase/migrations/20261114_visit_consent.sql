-- Согласие на куки в цифрах.
--
-- Яндекс Метрика запускается только после нажатия «Принять» в плашке куки, а наш
-- учёт визитов от согласия не зависит. Чтобы разница между ними была числом, а не
-- догадкой, каждый визит помечается ответом посетителя: accepted, declined, либо
-- пусто (плашку не трогал или ещё не успел ответить).
--
-- Без этой миграции всё работает как раньше: вызов visit_consent молча не
-- срабатывает, в админке просто нет карточки про согласие.
-- Выполнить вручную в Supabase SQL Editor, весь файл целиком за один раз.

alter table public.visits add column if not exists consent text;

create or replace function public.visit_consent(p_id bigint, p_visitor text, p_value text)
returns void
language sql
security definer
set search_path = public
as $$
    update public.visits
       set consent = p_value
     where id = p_id and visitor_id = p_visitor
       and p_value in ('accepted', 'declined')
       and created_at > now() - interval '12 hours';
$$;

grant execute on function public.visit_consent(bigint, text, text) to anon, authenticated;
