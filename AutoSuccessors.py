"""Перенос подтверждённых замен снятых позиций в catalog.js.

Цепочка целиком описана в supabase/migrations/20260913_catalog_successors.sql:
парсер цен находит на teremonline преемника снятой позиции, админ подтверждает
пару в разделе «Замены позиций», а этот скрипт раз в сутки переписывает позицию
каталога (workflow apply-successors.yml).

Что меняется в позиции:
  article      — новый артикул. Его показывают смета, счёт и ссылка клиенту
                 (displaySku берёт article раньше id), по нему же следующий
                 прогон парсера обновляет цену;
  name         — название, выбранное админом (пусто — старое не трогаем);
  price        — цена преемника в единицах каталога;
  availability — 'in_stock': парсер предлагает только преемника в наличии;
  price_date   — сегодня, иначе правило 31 дня сразу покажет «Под заказ».

Что НЕ меняется — id. На конкретные id позиций опирается код подбора в app.js
(сотни мест), по id позицию находят сохранённые сметы и старые ссылки клиентам,
по id ищется фото img/<id>.jpg. Смени id — позиция молча пропадёт из смет.

Повторный запуск ничего не портит: позиция, у которой article уже равен новому
артикулу, пропускается. Поэтому цену, которую потом обновит парсер, скрипт
обратно не перепишет.
"""
import datetime
import json
import re
import sys

import AutoPrice as ap

SUPABASE_APPROVED_PATH = "/rest/v1/rpc/catalog_successors_approved"


def js_literal(value):
    """Строка JS в двойных кавычках, как пишет каталог."""
    return json.dumps(value, ensure_ascii=False)


def plan_object_edits(item, content, row, today):
    """Точечные правки одной позиции -> [(abs_start, abs_end, text)] или None,
    если позиция уже переведена."""
    start = item['start_idx']
    obj_text = item['obj_text']
    own = ap._own_text(obj_text)
    new_article = row['new_article']

    art = ap.js_string_field(own, 'article')
    id_field = ap.js_string_field(own, 'id')
    current = art[0] if art else (id_field[0] if id_field else None)
    if current == new_article:
        return None

    edits = []
    appended = []   # поля, которых у объекта нет — дописываются одной вставкой

    # Артикул: заменить, а если поля нет — поставить сразу после id, чтобы в
    # файле код стоял рядом с кодом.
    if art:
        edits.append((start + art[1], start + art[2], js_literal(new_article)))
    elif id_field:
        edits.append((start + id_field[2], start + id_field[2], ', article: ' + js_literal(new_article)))
    else:
        appended.append('article: ' + js_literal(new_article))

    name = (row.get('apply_name') or '').strip()
    if name:
        nm = ap.js_string_field(own, 'name')
        if nm:
            if nm[0] != name:
                edits.append((start + nm[1], start + nm[2], js_literal(name)))
        else:
            appended.append('name: ' + js_literal(name))

    try:
        price = float(row.get('new_price') or 0)
    except (TypeError, ValueError):
        price = 0
    if price > 0:
        m = item['match']
        text = str(int(round(price))) if abs(price - round(price)) < 1e-9 else ('%g' % price)
        edits.append((m.start(2), m.end(2), text))

    for field, value in (('availability', 'in_stock'), ('price_date', today)):
        f = ap.js_string_field(own, field)
        if f:
            if f[0] != value:
                edits.append((start + f[1], start + f[2], js_literal(value)))
        else:
            appended.append(field + ': ' + js_literal(value))

    if appended:
        # Одной вставкой перед закрывающей скобкой самого объекта. Если последним
        # символом стоит запятая, вторая не нужна.
        last_brace = obj_text.rfind('}')
        idx = last_brace - 1
        while idx >= 0 and obj_text[idx].isspace():
            idx -= 1
        lead = '' if obj_text[idx] in ',{' else ', '
        edits.append((start + idx + 1, start + idx + 1, lead + ', '.join(appended)))
    return edits


def main():
    print("--- ПЕРЕНОС ПОДТВЕРЖДЁННЫХ ЗАМЕН В КАТАЛОГ ---")
    try:
        rows = ap.supabase_rpc(SUPABASE_APPROVED_PATH, {}) or []
    except Exception as e:
        # Нет функции (миграция не выполнена) или нет связи — каталог не трогаем.
        print(f"Не удалось получить подтверждённые замены: {e}")
        return 1
    print(f"Подтверждённых пар в базе: {len(rows)}")
    if not rows:
        return 0

    with open(ap.FULL_PATH, 'r', encoding='utf-8') as f:
        content = f.read()
    items = ap.collect_catalog_items(content)
    today = datetime.datetime.now().strftime('%Y-%m-%d')

    # Карта замен «код -> подтверждённая строка». Строки приходят в порядке
    # решения, поэтому при двух решениях по одному коду побеждает позднее: админ
    # передумал — действует последнее слово, а не то, что раньше в списке.
    successor_of = {}
    for row in rows:
        old, new = row.get('old_article') or '', row.get('new_article') or ''
        if old and new and old != new:
            successor_of[old] = row

    def final_row(code):
        """Последнее звено цепочки: подтвердили «А -> Б», а через месяц Б тоже
        сняли и подтвердили «Б -> В». Позиция должна стать В, а не прыгать
        каждый день между Б и В. Защита от петли — множество пройденных кодов."""
        row, seen = None, set()
        while code in successor_of and code not in seen:
            seen.add(code)
            row = successor_of[code]
            code = row['new_article']
        return row

    all_edits = []
    changed = 0
    report = {}
    matched_codes = set()
    for it in items:
        own = ap._own_text(it['obj_text'])
        id_f = ap.js_string_field(own, 'id')
        art_f = ap.js_string_field(own, 'article')
        # Сначала по id: это исходный код позиции, и решение «передумал» по нему
        # должно перебивать то, что уже записано в article. Потом по article —
        # у чужих брендов код отдельный (ASKON-MU-25M и «МУ-25М»), а у уже
        # переведённой позиции article — это вход в следующее звено цепочки.
        row = None
        for code in (id_f[0] if id_f else None, art_f[0] if art_f else None):
            if code and code in successor_of:
                matched_codes.add(code)
                row = final_row(code)
                break
        if not row:
            continue
        edits = plan_object_edits(it, content, row, today)
        if edits is None:
            continue
        all_edits.extend(edits)
        changed += 1
        key = f"{id_f[0] if id_f else '?'} -> {row['new_article']}"
        report[key] = report.get(key, 0) + 1

    for key, n in sorted(report.items()):
        print(f"  {key}: переписано позиций {n}")
    for code, row in successor_of.items():
        if code not in matched_codes and not any(r['new_article'] == code for r in successor_of.values()):
            print(f"  {code} -> {row['new_article']}: позиции нет в каталоге, пропуск")

    if not all_edits:
        print("Всё подтверждённое уже в каталоге.")
        return 0

    for s, e, val in sorted(all_edits, key=lambda x: x[0], reverse=True):
        content = content[:s] + val + content[e:]
    with open(ap.FULL_PATH, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"Готово: переписано позиций {changed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
