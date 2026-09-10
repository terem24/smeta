-- Разовая уборка: убрать монтажные работы из сохранённых смет продавцов.
--
-- Продавец монтаж не делает. Печать, ссылка клиенту и счёт работы у него уже
-- прятали, а сохранение в облако — нет: queueCloudSave отдавала сумму работ
-- без оглядки на сферу деятельности. В базе накопились сметы, где works_sum
-- есть, хотя в смете этих работ не существует.
--
-- Код поправлен в app.js (queueCloudSave гасит works_sum у продавца), этот
-- файл разбирает то, что уже сохранено.
--
-- Кого НЕ трогаем: у кого в анкете отмечены обе сферы — и продавец, и
-- монтажник. Монтаж такие люди делают, работы у них законные.
--
-- Запускать в SQL Editor консоли Supabase. Повторный запуск безопасен:
-- условие works_sum > 0 второй раз ничего не найдёт.

-- 1. Сначала посмотреть, что попадёт под правку (ожидается 13 строк).
select e.id,
       u.username,
       e.project_name,
       e.eq_sum,
       e.works_sum,
       e.total_sum
  from estimates e
  join users u on u.id = e.user_id
 where u.activity_types @> array['Продавец']::text[]
   and not (u.activity_types @> array['Монтажник']::text[])
   and coalesce(e.works_sum, 0) > 0
 order by u.username;

-- 2. Сама правка. Итог пересобирается из оборудования, иначе в смете
--    останется сумма, которая ни из чего не складывается.
update estimates e
   set works_sum = 0,
       total_sum = coalesce(e.eq_sum, 0)
  from users u
 where u.id = e.user_id
   and u.activity_types @> array['Продавец']::text[]
   and not (u.activity_types @> array['Монтажник']::text[])
   and coalesce(e.works_sum, 0) > 0;

-- 3. Проверка: должно вернуть 0.
select count(*)
  from estimates e
  join users u on u.id = e.user_id
 where u.activity_types @> array['Продавец']::text[]
   and not (u.activity_types @> array['Монтажник']::text[])
   and coalesce(e.works_sum, 0) > 0;
