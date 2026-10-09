-- Цифр в ФИО не бывает: «190 Андрей» (ник из Яндекс ID с номером машины) попал в базу
-- мимо формы кабинета. Клиент теперь выбрасывает такие слова сам (app.stripDigitWords),
-- а база страхует: цифры в фамилии, имени или отчестве заменяются на пусто — вход и
-- регистрация не ломаются, анкету просто попросят заполнить заново.
-- Что уже лежит в базе, чистится отдельно (запрос ниже закомментирован: прогнать руками).

create or replace function public.users_strip_name_digits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.last_name   ~ '[0-9]' then new.last_name   := nullif(btrim(regexp_replace(new.last_name,   '\S*[0-9]\S*', '', 'g')), ''); end if;
    if new.first_name  ~ '[0-9]' then new.first_name  := nullif(btrim(regexp_replace(new.first_name,  '\S*[0-9]\S*', '', 'g')), ''); end if;
    if new.middle_name ~ '[0-9]' then new.middle_name := nullif(btrim(regexp_replace(new.middle_name, '\S*[0-9]\S*', '', 'g')), ''); end if;
    if new.username    ~ '[0-9]' and new.username !~ '@' then
        new.username := coalesce(nullif(btrim(regexp_replace(new.username, '\S*[0-9]\S*', '', 'g')), ''), new.username);
    end if;
    return new;
end;
$$;

drop trigger if exists users_strip_name_digits on public.users;
create trigger users_strip_name_digits
    before insert or update of last_name, first_name, middle_name, username on public.users
    for each row execute function public.users_strip_name_digits();

-- Разовая чистка существующих строк:
-- update public.users set last_name = last_name where last_name ~ '[0-9]' or first_name ~ '[0-9]' or middle_name ~ '[0-9]';
