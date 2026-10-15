-- Отметка «прошёл обучение до конца» (tour.js) — зелёная галочка в админке.
--
-- ЗАЧЕМ. Режим обучения ведёт новичка по всему пути до сметы, но было не видно, кто его
-- дошёл до конца, а кто закрыл на втором шаге. Менеджер звонит всем подряд.
--
-- КТО ВИДИТ. Колонку читает панель управления (администратор, владелец, менеджер,
-- наблюдатель) — в интерфейсе самого пользователя отметки нет.
--
-- КТО ПИШЕТ. Только функция ниже и только про самого себя: user_id берётся из сессии
-- (grm_current_user_id), а не из параметров — чужую отметку поставить нельзя. Колонку
-- через таблицу не правим: политики users этого не разрешают, функция идёт мимо RLS.
--
-- Выполнить вручную в Supabase SQL Editor, весь файл целиком за один раз.
-- Без миграции калькулятор работает как раньше: запрос отметки ловит ошибку и молчит.

alter table public.users
    add column if not exists tour_done_at    timestamptz,
    add column if not exists tour_done_steps int,
    add column if not exists tour_done_plan  text;

comment on column public.users.tour_done_at    is 'Когда прошёл обучение до последнего шага (первый раз)';
comment on column public.users.tour_done_steps is 'Сколько шагов ему показали (зависит от тарифа и роли)';
comment on column public.users.tour_done_plan  is 'Тариф и роль на момент прохождения: "installer.pro"';

create or replace function public.mark_tour_done(p_steps int, p_plan text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid;
begin
    v_user := public.grm_current_user_id();
    if v_user is null then
        return;                                  -- гость: в users его нет
    end if;

    -- Первое прохождение не затираем: вторым кругом отметку не подделать и не сдвинуть
    update public.users u
       set tour_done_at    = now(),
           tour_done_steps = greatest(0, least(coalesce(p_steps, 0), 100)),
           tour_done_plan  = left(p_plan, 40)
     where u.id = v_user
       and u.tour_done_at is null;
end;
$$;

revoke all on function public.mark_tour_done(int, text) from public;
grant execute on function public.mark_tour_done(int, text) to authenticated;
