-- Журнал напоминаний: «column q.deleted_at does not exist».
--
-- В inactivity_report() две части union all, у первой столбцы без имён (coalesce, case, null::...),
-- а подзапрос q получает имена по первой части — поэтому order by q.deleted_at падал.
-- Лечение: явный список имён столбцов у подзапроса. Остальное — как в 20261006 (+ единственный админ
-- по почте kovdor24@yandex.ru, 20261008).

drop function if exists public.inactivity_report();

create function public.inactivity_report()
returns table (
    user_id        uuid,
    name           text,
    email          text,
    phone          text,
    region         text,
    city           text,
    stage          text,          -- warned | frozen | deleted
    warned_at      timestamptz,
    frozen_at      timestamptz,
    last_visited   timestamptz,
    returned_at    timestamptz,
    estimates      int,
    deleted_id     uuid,
    deleted_at     timestamptz,
    reg_allowed_at timestamptz,
    reg_until      timestamptz,   -- до какого числа закрыта регистрация (только у удалённых)
    kind           text           -- inactive | manual
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if not exists (
        select 1 from public.users me
         where me.auth_user_id = auth.uid()
           and (me.account_type in ('admin', 'viewer')
                or lower(btrim(me.email)) in ('kovdor24@yandex.ru'))
    ) then
        raise exception 'Отчёт доступен только администратору';
    end if;

    return query
    select * from (
    select u.id,
           coalesce(nullif(btrim(concat_ws(' ', u.last_name, u.first_name, u.middle_name)), ''),
                    nullif(btrim(u.username), ''), u.email, 'Без имени')::text,
           u.email, u.phone, u.region, u.city,
           (case when u.frozen_at is not null then 'frozen' else 'warned' end)::text,
           n.warned_at, u.frozen_at, u.last_visited,
           case when u.last_visited > n.warned_at then u.last_visited end,
           (select count(*)::int from public.estimates e where e.user_id = u.id),
           null::uuid, null::timestamptz, null::timestamptz, null::timestamptz, null::text
      from public.inactivity_notices n
      join public.users u on u.id = n.user_id

    union all

    select d.user_id, d.name, d.email, d.phone, d.region, d.city,
           'deleted'::text, d.warned_at, d.frozen_at, d.last_visited,
           null::timestamptz, d.estimates,
           d.id, d.deleted_at, d.reg_allowed_at,
           d.deleted_at + make_interval(days => d.block_days), d.kind
      from public.inactivity_deleted d
    ) q (c_user_id, c_name, c_email, c_phone, c_region, c_city, c_stage, c_warned_at, c_frozen_at,
         c_last_visited, c_returned_at, c_estimates, c_deleted_id, c_deleted_at, c_reg_allowed_at,
         c_reg_until, c_kind)
    order by coalesce(q.c_deleted_at, q.c_warned_at) desc nulls last;
end;
$$;

grant execute on function public.inactivity_report() to authenticated;
