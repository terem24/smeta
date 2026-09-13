-- Сколько времени человек проводит в калькуляторе и чем там занимается.
--
-- ЗАЧЕМ. В админке видно, сколько у монтажника смет, и когда он заходил последний раз.
-- Не видно главного: человек заходит каждый день и ничего не считает — он смотрит цены,
-- он застрял на первом экране или он просто держит вкладку открытой? Без этого любое
-- действие (письмо, звонок менеджера, подсказка в интерфейсе) бьёт наугад.
--
-- ЧТО СЧИТАЕМ. Визит — непрерывный кусок работы с разрывом меньше 30 минут. Время внутри
-- визита — только активное: вкладка на переднем плане и за последнюю минуту была мышь,
-- клавиатура или прокрутка. Открытая на весь день фоновая вкладка даёт ноль, а не восемь
-- часов, иначе цифра бессмысленна. Номер визита выдаёт браузер и хранит в localStorage,
-- общем для всех вкладок, — три открытых вкладки это один визит, а не три.
--
-- ПОЧЕМУ ИТОГИ ЛЕЖАТ В users, А НЕ СЧИТАЮТСЯ ЗАПРОСОМ. Список пользователей в админке и
-- так тянет строки из users; четыре лишние колонки не стоят ничего. Считать же сумму по
-- журналу визитов пришлось бы отдельным запросом на каждое открытие вкладки, а лимит
-- egress Supabase на бесплатном плане — 5 ГБ в месяц, мы в него уже упирались
-- (см. историю с опросом уведомлений). Журнал визитов читается только когда открыли
-- карточку конкретного человека.
--
-- Выполнить вручную в Supabase SQL Editor, весь файл целиком за один раз.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Итоги по человеку — прямо в учётке
--
-- sess_screens — не «сколько раз кликнул», а «в скольких визитах открывал». Счётчик
-- кликов накручивается сам собой (человек десять раз дёрнул ползунок площади), а число
-- визитов с экраном — честная величина: заходил за прайсом в 12 визитах из 14.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.users
    add column if not exists sess_visits   int   not null default 0,
    add column if not exists sess_sec      int   not null default 0,
    add column if not exists sess_days     int   not null default 0,
    add column if not exists sess_last_day date,
    add column if not exists sess_screens  jsonb not null default '{}'::jsonb;

comment on column public.users.sess_visits  is 'Всего визитов (разрыв 30 минут = новый визит)';
comment on column public.users.sess_sec     is 'Всего активных секунд на сайте';
comment on column public.users.sess_days    is 'В скольких разных днях заходил';
comment on column public.users.sess_last_day is 'Последний день с визитом — чтобы не считать день дважды';
comment on column public.users.sess_screens is 'Экран → в скольких визитах открывал: {"params":12,"lk:objects":3}';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Журнал визитов
--
-- Первичный ключ — номер визита, который выдал браузер. Поэтому повторная отправка того
-- же визита (а она обязательна: длинный визит досылается каждые несколько минут, иначе
-- закрытое по-живому окно унесло бы всё время с собой) не плодит строки.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.user_sessions (
    id         uuid primary key,
    user_id    uuid        not null references public.users(id) on delete cascade,
    started_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    active_sec int         not null default 0,
    screens    jsonb       not null default '{}'::jsonb,
    device     text
);

create index if not exists user_sessions_user_idx    on public.user_sessions (user_id, started_at desc);
create index if not exists user_sessions_started_idx on public.user_sessions (started_at desc);

alter table public.user_sessions enable row level security;

-- Читает администратор (карточка человека в панели) и сам человек — свои визиты.
-- Писать через таблицу нельзя вообще: только функцией ниже, иначе любой с anon-ключом
-- дорисовал бы себе часы активности.
drop policy if exists user_sessions_read on public.user_sessions;
create policy user_sessions_read on public.user_sessions
    for select using (
        public.is_admin()
        or user_id = public.grm_current_user_id()
    );

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Сложение счётчиков в jsonb
--
-- Нужно в одном месте — свести старые итоги по экранам с новыми. Значения не-числа и
-- заведомый мусор отбрасываем: карта экранов приходит из браузера, доверять ей нельзя.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.jsonb_add_counts(a jsonb, b jsonb)
returns jsonb
language sql
immutable
as $$
    select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
      from (
            select k, sum(n) as n
              from (
                    select key as k, value::bigint as n
                      from jsonb_each_text(coalesce(a, '{}'::jsonb))
                     where value ~ '^[0-9]{1,9}$'
                    union all
                    select key as k, value::bigint as n
                      from jsonb_each_text(coalesce(b, '{}'::jsonb))
                     where value ~ '^[0-9]{1,9}$'
                   ) parts
             group by k
           ) sums;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Браузер отчитывается о визите
--
-- Чей это визит, решает не браузер, а сервер: user_id берётся из текущей сессии
-- (grm_current_user_id), в параметрах его нет. Поэтому подменить чужой визит нельзя.
--
-- security definer нужен, чтобы функция писала в users и user_sessions мимо RLS —
-- прав на прямую запись туда у пользователя нет и не будет.
--
-- active_sec не перезаписываем, а берём максимум: у визита, открытого в двух вкладках,
-- досылки могут прийти вразнобой, и меньшее число не должно откатывать большее.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.record_visit(
    p_visit   uuid,
    p_sec     int,
    p_screens jsonb default '{}'::jsonb,
    p_device  text  default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user        uuid;
    v_prev_sec    int;
    v_prev_screens jsonb;
    v_is_new      boolean := false;
    v_new_day     boolean := false;
    v_delta       jsonb;
begin
    v_user := public.grm_current_user_id();
    if v_user is null then
        return;                                  -- гость: в users его нет, считать некому
    end if;

    -- Сутки активности в одном визите невозможны — всё, что больше, это сбой часов
    -- или попытка накрутки.
    p_sec := greatest(0, least(coalesce(p_sec, 0), 86400));
    if p_screens is null or jsonb_typeof(p_screens) <> 'object' then
        p_screens := '{}'::jsonb;
    end if;

    select active_sec, screens
      into v_prev_sec, v_prev_screens
      from public.user_sessions
     where id = p_visit and user_id = v_user;

    if not found then
        insert into public.user_sessions (id, user_id, active_sec, screens, device)
             values (p_visit, v_user, p_sec, p_screens, left(p_device, 120))
        on conflict (id) do nothing;

        if not found then
            -- Строка с таким номером уже есть, но принадлежит другому человеку.
            -- Столкновение uuid практически невозможно, но молча портить чужие
            -- итоги нельзя — просто выходим.
            return;
        end if;

        v_prev_sec     := 0;
        v_prev_screens := '{}'::jsonb;
        v_is_new       := true;
    else
        update public.user_sessions
           set active_sec = greatest(active_sec, p_sec),
               screens    = p_screens,
               updated_at = now()
         where id = p_visit;
    end if;

    -- В итоги человека идёт только прирост: визит досылается много раз, и каждая
    -- досылка не должна прибавлять всё время заново.
    select coalesce(jsonb_object_agg(k, 1), '{}'::jsonb)
      into v_delta
      from jsonb_object_keys(p_screens) as k
     where not (v_prev_screens ? k);

    select (u.sess_last_day is distinct from current_date)
      into v_new_day
      from public.users u
     where u.id = v_user;

    update public.users u
       set sess_sec      = u.sess_sec + greatest(p_sec - v_prev_sec, 0),
           sess_visits   = u.sess_visits + case when v_is_new then 1 else 0 end,
           sess_days     = u.sess_days   + case when v_is_new and v_new_day then 1 else 0 end,
           sess_last_day = current_date,
           sess_screens  = public.jsonb_add_counts(u.sess_screens, coalesce(v_delta, '{}'::jsonb))
     where u.id = v_user;
end;
$$;

revoke all on function public.record_visit(uuid, int, jsonb, text) from public;
grant execute on function public.record_visit(uuid, int, jsonb, text) to authenticated;
