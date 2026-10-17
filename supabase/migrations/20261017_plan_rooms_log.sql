-- Журнал правок монтажника на шаге «Комнаты» редактора плана (plan_editor.html).
--
-- Одна строка на выход из шага: что «Найти комнаты» нашла сама, что осталось после правок,
-- откуда взят масштаб, сколько подписей площадей прочитано. Без персональных данных:
-- ни пользователя, ни адреса, ни самого плана — только числа и площади комнат.
-- Нужен, чтобы раз в неделю искать повторяющиеся ошибки распознавания и превращать их в правила.
--
-- Писать может любой (редактор открыт и без входа): через функцию с проверкой размера,
-- таблица напрямую закрыта. Читает только админ.

create table if not exists public.plan_rooms_log (
    id             bigint generated always as identity primary key,
    created_at     timestamptz not null default now(),
    auto_n         int,                -- комнат нашли сами
    auto_m2        numeric,            -- их сумма, м²
    auto_areas     jsonb,              -- площади по убыванию (до 40)
    final_n        int,                -- комнат осталось после правок
    final_m2       numeric,
    final_areas    jsonb,
    kept_n         int,                -- осталось как нашли (тот же центр, площадь ±10 %)
    removed_n      int,                -- удалено или перерисовано
    added_n        int,                -- добавлено или перерисовано
    scale_src      text,               -- dims | doors | areas | printed | frame | manual
    ppm            numeric,
    labels_read    int,                -- подписей площадей прочитано
    labels_scan    boolean,            -- читала модель (скан/фото), а не текстовый слой PDF
    contours_big   int,                -- контуров крупнее 4 м²
    skipped        int,                -- пропущено «клетушек» без подписи
    reread_before  int,                -- подписей до второго прохода (null — прохода не было)
    reread_after   int,
    frame          text,               -- сверка с габаритом: ok | fixed | mismatch | none
    sum_warn       boolean,            -- сумма комнат превысила внутреннюю площадь габарита
    inner_m2       numeric,
    ver            int
);

create index if not exists plan_rooms_log_created_idx on public.plan_rooms_log (created_at desc);

alter table public.plan_rooms_log enable row level security;

drop policy if exists plan_rooms_log_admin_read on public.plan_rooms_log;
create policy plan_rooms_log_admin_read on public.plan_rooms_log
    for select to authenticated
    using (public.is_admin());

create or replace function public.plan_rooms_log_add(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p is null or jsonb_typeof(p) <> 'object' or length(p::text) > 6000 then
        return;
    end if;
    insert into public.plan_rooms_log (
        auto_n, auto_m2, auto_areas, final_n, final_m2, final_areas,
        kept_n, removed_n, added_n, scale_src, ppm, labels_read, labels_scan,
        contours_big, skipped, reread_before, reread_after, frame, sum_warn, inner_m2, ver
    ) values (
        (p->>'auto_n')::int, (p->>'auto_m2')::numeric,
        case when jsonb_typeof(p->'auto_areas') = 'array' then p->'auto_areas' end,
        (p->>'final_n')::int, (p->>'final_m2')::numeric,
        case when jsonb_typeof(p->'final_areas') = 'array' then p->'final_areas' end,
        (p->>'kept_n')::int, (p->>'removed_n')::int, (p->>'added_n')::int,
        left(p->>'scale_src', 16), (p->>'ppm')::numeric, (p->>'labels_read')::int, (p->>'labels_scan')::boolean,
        (p->>'contours_big')::int, (p->>'skipped')::int, (p->>'reread_before')::int, (p->>'reread_after')::int,
        left(p->>'frame', 12), (p->>'sum_warn')::boolean, (p->>'inner_m2')::numeric, (p->>'ver')::int
    );
exception when others then
    return;     -- журнал не должен ронять редактор
end;
$$;

revoke all on function public.plan_rooms_log_add(jsonb) from public;
grant execute on function public.plan_rooms_log_add(jsonb) to anon, authenticated;
