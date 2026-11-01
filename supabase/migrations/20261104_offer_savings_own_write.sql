-- offer_savings: калькулятор сам пишет экономию «Бюджетнее» по своей строке.
--
-- ЗАЧЕМ. Раньше строки появлялись, только когда администратор открывал предложение
-- в «Готовности к оплате» (pay_readiness.js), поэтому таблица стояла пустой. Теперь
-- после сохранения сметы app.cheaperSavingForOffer считает экономию и показывает её
-- человеку без Профи, а заодно пишет её сюда — админ видит цифру сразу.
--
-- Все строки по-прежнему видит только администратор; пользователь может прочитать,
-- вставить и обновить только свою строку (user_id = его запись в users).

drop policy if exists offer_savings_own_insert on public.offer_savings;
create policy offer_savings_own_insert on public.offer_savings
    for insert to authenticated
    with check (user_id in (select u.id from public.users u where u.auth_user_id = auth.uid()));

drop policy if exists offer_savings_own_update on public.offer_savings;
create policy offer_savings_own_update on public.offer_savings
    for update to authenticated
    using (user_id in (select u.id from public.users u where u.auth_user_id = auth.uid()))
    with check (user_id in (select u.id from public.users u where u.auth_user_id = auth.uid()));

-- INSERT ... ON CONFLICT DO UPDATE (upsert) проверяет существующую строку и по
-- политике SELECT, поэтому свою строку человек видеть должен. Чужие — нет.
drop policy if exists offer_savings_own_select on public.offer_savings;
create policy offer_savings_own_select on public.offer_savings
    for select to authenticated
    using (user_id in (select u.id from public.users u where u.auth_user_id = auth.uid()));
