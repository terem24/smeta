# -*- coding: utf-8 -*-
"""Добавление сезонных статей в расписание.

Обычные статьи расставлены по частотности запроса и идут ровным потоком три раза
в неделю. Сезонные живут иначе: у них есть день, раньше которого публиковать
бессмысленно, а позже — поздно. Индексация занимает недели, поэтому каждая
ставится за одну-две недели до своего пика.

Поле freq у них 0 — не потому, что спроса нет, а потому, что годовая частота
Вордстата для таких запросов ничего не говорит: весь спрос собран в две недели.
Проверять их надо по динамике, а не по среднему за год.

Скрипт идемпотентен: повторный запуск ничего не дублирует.
"""
import io
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEDULE = os.path.join(ROOT, 'content', 'schedule.json')
CLUSTER = 'Сезонные пики'

ITEMS = [
    ('2026-09-28', 'podgotovka-otopleniya-k-zime',
     'Подготовка отопления к зиме: что проверить перед сезоном',
     'подготовка отопления к зиме', 'чек-лист перед сезоном'),
    ('2026-11-03', 'kotel-ne-greet-v-moroz',
     'Котёл не справляется в мороз: что проверять',
     'котел не греет дом', 'расчётная пятидневка и три режима'),
    ('2026-12-18', 'dom-bez-otopleniya-zimoy',
     'Дом без присмотра зимой: как уехать и не разморозить',
     'как оставить дом на зиму', 'режим +5 и мощность резерва'),
    ('2026-12-26', 'tarify-na-otoplenie-s-1-yanvarya',
     'Тарифы на отопление с 1 января: как пересчитать расходы',
     'тарифы на газ и электричество', 'наши тарифные таблицы'),
    ('2027-01-12', 'otklyuchili-svet-zimoy',
     'Отключили свет зимой: сколько продержится дом',
     'отключили свет отопление не работает', 'расчёт остывания и автономии'),
    ('2027-04-06', 'konservatsiya-otopleniya-na-leto',
     'Консервация отопления на лето: что сделать в апреле',
     'консервация системы отопления', 'что проверяют перед простоем'),
    ('2027-04-27', 'zapusk-vodosnabzheniya-posle-zimy',
     'Запуск водоснабжения после зимы: порядок и опрессовка',
     'запуск воды на даче после зимы', 'давления по СП 73'),
    ('2027-06-15', 'povyshenie-tarifov-s-1-iyulya',
     'Повышение тарифов с 1 июля: что меняется в счетах за отопление',
     'повышение тарифов жкх', 'пересчёт стоимости сезона'),
]


def main():
    data = json.load(io.open(SCHEDULE, encoding='utf-8'))
    have = set(i['slug'] for i in data['items'])
    added = 0
    for date, slug, title, query, block in ITEMS:
        if slug in have:
            continue
        data['items'].append({
            'slug': slug, 'title': title, 'cluster': CLUSTER, 'cluster_key': 'season',
            'query': query, 'freq': 0, 'audience': 'owner', 'data_block': block,
            'status': 'planned', 'date': date, 'published_at': None, 'words': None,
        })
        added += 1
    data['items'].sort(key=lambda x: ((x['date'] or '9999'), x['slug']))
    io.open(SCHEDULE, 'w', encoding='utf-8').write(
        json.dumps(data, ensure_ascii=False, indent=1))
    print('добавлено: %d, всего в плане: %d' % (added, len(data['items'])))


if __name__ == '__main__':
    main()
