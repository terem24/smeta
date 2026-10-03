# -*- coding: utf-8 -*-
"""Добавление в расписание статей про деловую часть работы монтажника.

Основной план (seo_plan.py) собран по частотности запросов, и в нём 40 статей для
монтажников — все технические: схемы, гидравлика, обвязка. Про деньги и бумаги
(договор, акты, КП, наценка, оплата) для монтажника не было ничего, а это то, на
чём они теряют больше всего: не вписанная в договор оговорка стоит дороже ошибки
в диаметре трубы. Заказчику те же темы закрывает кластер money (audience owner),
здесь — взгляд подрядчика.

Статьи идут по средам, пятницам и понедельникам — в дни, свободные от основного
потока (вторник, четверг, суббота), так что общий ритм не сдвигается. Призыв в
мастер /dom/ в них не нужен: читатель — подрядчик, а не хозяин дома
(cluster_key biz в NO_DOM_CLUSTERS сборщика).

Скрипт идемпотентен: повторный запуск ничего не дублирует.
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEDULE = os.path.join(ROOT, 'content', 'schedule.json')
CLUSTER = 'Бизнес монтажника'

ITEMS = [
    ('2026-10-07', 'dogovor-podryada-zashchita-montazhnika',
     'Договор подряда на монтаж: что вписать, чтобы защитить себя',
     'договор подряда на монтаж отопления', 'шаблон договора из сметы'),
    ('2026-10-09', 'akt-skrytyh-rabot-otopleniya',
     'Акт скрытых работ на отопление и тёплый пол: как составить',
     'акт скрытых работ отопление', 'акты из сметы'),
    ('2026-10-12', 'kp-na-montazh-otopleniya',
     'Коммерческое предложение на монтаж отопления: из чего собрать',
     'коммерческое предложение на монтаж отопления', 'КП ссылкой и версии'),
    ('2026-10-14', 'nacenka-montazhnika',
     'Наценка монтажника: сколько закладывать на оборудование и работы',
     'наценка на оборудование монтаж', 'вкладка «Деньги»'),
    ('2026-10-16', 'avans-i-oplata-po-etapam',
     'Аванс и оплата по этапам: как не работать в долг',
     'аванс по договору подряда монтаж', 'этапы оплаты из сметы'),
    ('2026-10-19', 'dopolnitelnye-raboty-po-hodu-montazha',
     'Дополнительные работы по ходу монтажа: как оформить и получить деньги',
     'дополнительные работы договор подряда', 'порядок допсоглашения'),
    ('2026-10-21', 'zakazchik-ne-podpisyvaet-akt',
     'Заказчик не подписывает акт: что делать подрядчику',
     'заказчик не подписывает акт выполненных работ', 'акт сдачи-приёмки из сметы'),
    ('2026-10-23', 'samozanyatyy-ili-ip-montazhnik',
     'Самозанятый или ИП: как монтажнику продавать оборудование и работы',
     'самозанятый монтажник оборудование', 'раздельные позиции оборудования и работ'),
]


def main():
    data = json.load(io.open(SCHEDULE, encoding='utf-8'))
    have = set(i['slug'] for i in data['items'])
    added = 0
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import biz_weekly
    for date, slug, title, query, block in ITEMS + biz_weekly.items():
        if slug in have:
            continue
        data['items'].append({
            'slug': slug, 'title': title, 'cluster': CLUSTER, 'cluster_key': 'biz',
            'query': query, 'freq': 0, 'audience': 'pro', 'data_block': block,
            'status': 'queued', 'date': date, 'published_at': None, 'words': None,
        })
        added += 1
    data['items'].sort(key=lambda x: ((x['date'] or '9999'), x['slug']))
    io.open(SCHEDULE, 'w', encoding='utf-8').write(
        json.dumps(data, ensure_ascii=False, indent=1))
    print('добавлено: %d, всего в плане: %d' % (added, len(data['items'])))


if __name__ == '__main__':
    main()
