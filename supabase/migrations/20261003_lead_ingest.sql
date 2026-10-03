-- Автоматический приём заявок в ленту мастеров (продолжение 20261003_lead_board.sql).
--
-- Было: владелец во вкладке «Заявки» нажимал «Предложить Профи-мастерам» у каждой заявки.
-- Стало: lead.php на Beget сам отправляет принятую заявку сюда, в функцию lead_ingest.
--
-- Почему безопасно. Функцию может вызвать кто угодно с публичным ключом сайта, поэтому
-- первым аргументом идёт секрет: он лежит в таблице lead_secrets (политик нет — читать
-- её может только сама функция) и в файле lead_ingest_secret.php на Beget. Без секрета
-- функция отвечает «forbidden» и ничего не пишет. Секрет в репозиторий НЕ кладётся:
-- репозиторий открытый. Его задаёт владелец отдельным запросом (см. ниже).
--
-- Выключатель: app_settings, ключ lead_board, поле auto. Нет настройки или auto = true —
-- заявки идут в ленту сами; auto = false — функция ничего не публикует (журнал на Beget
-- и Телеграм работают как раньше, вручную предложить заявку можно во вкладке «Заявки»).
--
-- Задать секрет (выполнить один раз, подставив свою длинную случайную строку):
--   insert into public.lead_secrets (k, v) values ('ingest', '<секрет>')
--   on conflict (k) do update set v = excluded.v;

create table if not exists public.lead_secrets (
  k text primary key,
  v text not null
);
alter table public.lead_secrets enable row level security;   -- политик нет: читает только lead_ingest

create or replace function public.lead_ingest(p_secret text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  good boolean;
  cfg jsonb;
  lid text := left(coalesce(p ->> 'lead_id', ''), 40);
  pl text := left(trim(coalesce(p ->> 'place', '')), 80);
  nm text := left(trim(coalesce(p ->> 'name', '')), 80);
  ph text := left(trim(coalesce(p ->> 'phone', '')), 40);
  ar int;
  wk text[];
begin
  select (v = p_secret) into good from public.lead_secrets where k = 'ingest';
  if not coalesce(good, false) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select value into cfg from public.app_settings where key = 'lead_board';
  if coalesce((cfg ->> 'auto')::boolean, true) = false then
    return jsonb_build_object('ok', true, 'skipped', 'off');
  end if;

  if lid = '' or pl = '' or nm = '' or ph = '' then
    return jsonb_build_object('ok', false, 'reason', 'fields');
  end if;

  begin ar := nullif(p ->> 'area', '')::int; exception when others then ar := null; end;
  select coalesce(array_agg(left(x, 60)), '{}') into wk
    from jsonb_array_elements_text(case when jsonb_typeof(p -> 'works') = 'array' then p -> 'works' else '[]'::jsonb end) x;

  insert into public.lead_board (lead_id, place, area, works, status)
  values (lid, pl, ar, wk, 'open')
  on conflict (lead_id) do nothing;

  insert into public.lead_contacts (lead_id, name, phone, when_call, comment, calc)
  values (lid, nm, ph, left(nullif(p ->> 'when_call', ''), 80), left(nullif(p ->> 'comment', ''), 1000), left(nullif(p ->> 'calc', ''), 2000))
  on conflict (lead_id) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.lead_ingest(text, jsonb) from public;
grant execute on function public.lead_ingest(text, jsonb) to anon, authenticated;
