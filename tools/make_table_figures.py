# -*- coding: utf-8 -*-
"""Графики из таблиц статей: числа берутся из самой таблицы, а не переписываются руками.

Запуск из корня репозитория:  python -X utf8 tools/make_table_figures.py

Для каждой записи CONFIG: статья, номер блока-таблицы в content/articles/<slug>.json, какие колонки
взять, подписи. Скрипт рисует столбцовую диаграмму (стиль и цвета те же, что у графиков кластера
«Нейросети и расчёты», tools/make_ai_figures.py), кладёт SVG в content/figures/ и вставляет блок
figure сразу после таблицы. Повторный запуск ничего не дублирует.

Какие таблицы НЕ превращаются в график: текстовые («что вписать в договор», «схема — где
применима»). График из текста — декорация, а не данные.

После запуска пересобрать статьи:
  python -X utf8 tools/build_article.py <slug>              (в очереди)
  python -X utf8 tools/build_article.py <slug> --publish    (уже вышла)
"""
import io, json, math, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_ai_figures as F

ROOT = F.ROOT
NBSP = ' '


def num(s):
    """Первое число в ячейке: «67 500 ₽» → 67500, «0,15» → 0.15, «1–2» → 1, «127 %» → 127."""
    s = re.sub(r'<[^>]+>', '', str(s)).replace(' ', ' ').replace(' ', ' ')
    m = re.search(r'\d[\d ]*(?:,\d+)?', s)
    if not m:
        return None
    return float(m.group(0).replace(' ', '').replace(',', '.'))


def short(s, n=16):
    s = re.sub(r'<[^>]+>', '', str(s)).replace(' ', ' ').strip()
    if ', ' in s and len(s) > n:
        s = s.split(', ')[0]
    return s


def ru(v):
    dec = 0 if abs(v - round(v)) < 1e-9 else 1 if abs(v * 10 - round(v * 10)) < 1e-9 else 2
    s = ('%.*f' % (dec, v)).replace('.', ',')
    if v >= 10000 and dec == 0:
        s = '{:,}'.format(int(round(v))).replace(',', NBSP)
    return s


def nice_max(v):
    e = 10 ** math.floor(math.log10(v))
    for m in (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10):
        if m * e >= v:
            return m * e
    return 10 * e


def nice_step(vmax):
    raw = vmax / 5.0
    e = 10 ** math.floor(math.log10(raw))
    for m in (1, 2, 2.5, 5, 10):
        if m * e >= raw:
            return m * e
    return 10 * e


def wrap(label, width):
    words = str(label).replace(' ', ' ').split(' ')
    lines, cur = [], ''
    for w in words:
        if len(cur) + len(w) + 1 > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + ' ' + w).strip()
    lines.append(cur)
    return lines[:3]


def chart(rows, series, unit, legend=None, label_w=17):
    """rows: [(подпись, [значения по сериям], [подписи у столбцов])]; series: [(цвет, прозрачность)]."""
    W, X0, X1 = 480, 150, 408
    vmax = nice_max(max(max(v for v in r[1] if v is not None) for r in rows))
    step = nice_step(vmax)
    scale = (X1 - X0) / vmax
    ns = len(series)
    bh = 16 if ns == 1 else 15
    gap_in = 3
    top = 30 if legend else 14
    y = top
    body = ''
    layout = []
    for r in rows:
        lines = wrap(r[0], label_w)
        h = max(ns * (bh + gap_in) + 14, len(lines) * 15 + 12)
        layout.append((y, h, lines))
        y += h
    y1 = y - 4
    v = 0.0
    while v <= vmax + 1e-9:
        x = X0 + v * scale
        body += ('<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" style="stroke:%s;stroke-opacity:.22;stroke-width:1"/>'
                 % (x, top - 6, x, y1, F.MUT))
        body += F.t(x, y1 + 20, ru(v), 12, F.MUT, 'middle')
        v += step
    for (y0, h, lines), r in zip(layout, rows):
        cy = y0 + (h - ns * (bh + gap_in)) / 2.0
        mid = y0 + h / 2.0
        for j, ln in enumerate(lines):
            body += F.t(X0 - 10, mid + 4 + (j - (len(lines) - 1) / 2.0) * 15, ln, 13, F.TXT, 'end')
        for k, (val, lab) in enumerate(zip(r[1], r[2])):
            if val is None:
                continue
            col, op = series[k]
            by = cy + k * (bh + gap_in)
            body += F.rbar(X0, by, val * scale, bh, col, op)
            body += F.t(X0 + val * scale + 7, by + bh - 3, lab, 13, F.TXT, 'start', 600)
    H = y1 + 44
    body += F.t((X0 + X1) / 2, H - 6, unit, 12, F.MUT, 'middle')
    if legend:
        lx = X0
        for (col, op), name in zip(series, legend):
            body += '<rect x="%d" y="8" width="12" height="12" rx="3" style="fill:%s;fill-opacity:%.2f"/>' % (lx, col, op)
            body += F.t(lx + 18, 19, name, 12, F.TXT, 'start')
            lx += 24 + 7 * len(name)
    return body, W, H


BLUE, GRAY = F.BLUE, F.MUT
OPS = [(BLUE, 0.95), (GRAY, 0.8), (BLUE, 0.4)]
OPS_ORDERED = [(BLUE, 0.95), (BLUE, 0.6), (BLUE, 0.3)]

CONFIG = [
    dict(slug='montazh-teplogo-pola-spb', table=11, name='shag', label=0, vals=[3], label_prefix='Шаг ', unit='теплосъём, Вт/м²',
         alt='Теплосъём водяного тёплого пола по шагу укладки: 90 Вт/м² при шаге 100 мм, 70 при 150, 50 при 200',
         caption='Чем реже шаг укладки, тем меньше теплосъём: 90 Вт/м² при 100 мм, 50 при 200 мм.'),
    dict(slug='montazh-teplogo-pola-spb', table=7, name='smeta', label=0, vals=[2], skip='итого', unit='сумма, ₽',
         alt='Из чего складывается стоимость монтажа тёплого пола на 90 м² в Санкт-Петербурге по статьям сметы',
         caption='Стоимость монтажа тёплого пола на 90 м² по статьям, ₽.'),
    dict(slug='podgotovka-otopleniya-k-zime', table=4, name='raboty', label=0, vals=[2], unit='цена работы, ₽',
         alt='Расценки на работы по подготовке отопления к зиме в Санкт-Петербурге', caption='Расценки на работы, ₽.'),
    dict(slug='kollektor-teplogo-pola', table=4, name='truba', label=0, vals=[1], label_prefix='Шаг ', unit='труба на 1 м² пола, м',
         alt='Расход трубы тёплого пола на 1 м² по шагу укладки: 11,0 м при шаге 100 мм, 7,3 при 150, 5,5 при 200',
         caption='Расход трубы на 1 м² пола по шагу укладки, м.'),
    dict(slug='elektrokotel-dlya-doma', table=5, name='tok', label=0, vals=[1, 2], unit='ток, А', legend=['220 В', '380 В'],
         alt='Ток электрокотла по мощности: при 220 В от 27 А (6 кВт) до 109 А (24 кВт), при 380 В от 9 до 36 А',
         caption='Ток электрокотла по мощности: при 220 В он втрое больше, чем при 380 В.'),
    dict(slug='elektrokotel-dlya-doma', table=10, name='sezon', label=0, vals=[2], unit='стоимость сезона, ₽',
         alt='Стоимость отопительного сезона (24 400 кВт·ч) по источнику тепла: газовый котёл 26 500 ₽, электрокотёл по городскому тарифу 192 000 ₽',
         caption='Стоимость отопительного сезона 24 400 кВт·ч по источнику тепла, ₽.'),
    dict(slug='bimetall-ili-alyuminiy', table=9, name='rubl-vatt', label=0, vals=[4], unit='₽ за ватт теплоотдачи',
         alt='Цена ватта теплоотдачи радиаторов: алюминий STOUT 8,3 ₽, биметалл TITAN 14,5 ₽', caption='Стоимость ватта теплоотдачи, ₽.'),
    dict(slug='bimetall-ili-alyuminiy', table=5, name='grafik', label=0, vals=[3], label_prefix='График ', unit='теплоотдача, % от номинала при ΔT 50',
         alt='Теплоотдача радиатора в процентах от номинала при разных графиках системы: 127 % при 90/70, 27 % при 45/35',
         caption='Теплоотдача радиатора при разных графиках системы, % от номинала при ΔT 50 К.'),
    dict(slug='polipropilen-dlya-otopleniya', table=3, name='udlinenie', label=0, vals=[2],
         unit='удлинение 10 м трубы при нагреве на 60 °C, мм',
         alt='Удлинение 10 м трубы при нагреве на 60 °C: PP-R без армирования 90 мм, с алюминием 18 мм, медь 10 мм, PE-Xa 120 мм',
         caption='Тепловое удлинение 10 м трубы при нагреве на 60 °C, мм.'),
    dict(slug='vodosnabzhenie-chastnogo-doma', table=5, name='raboty', label=0, vals=[2], strip_paren=True, unit='цена работы, ₽',
         alt='Расценки на монтаж водоснабжения частного дома по видам работ', caption='Расценки на монтаж водоснабжения, ₽.'),
    dict(slug='nacenka-montazhnika', table=3, name='marzha', label=0, vals=[1], unit='маржа, % от выручки',
         alt='Связь наценки и маржи: наценка 10 % даёт маржу 9,1 %, наценка 43 % даёт 30 %',
         caption='Наценка и маржа — разные числа: наценка 43 % даёт маржу 30 %.', label_prefix='Наценка '),
    dict(slug='boyler-kosvennogo-nagreva', table=4, name='moshchnost', label=1, vals=[2], unit='мощность на прогрев за час, кВт',
         alt='Мощность на прогрев бака косвенного нагрева за час: от 5,8 кВт для 100 литров до 29,1 кВт для 500 литров',
         caption='Мощность, нужная на прогрев бака за час, по его объёму, кВт.', boiler=True),
    dict(slug='podbor-tsirkulyatsionnogo-nasosa', table=5, name='rashod', label=0, vals=[1, 4], unit='расход, м³/ч',
         legend=['перепад 20 К', 'перепад 5 К'],
         alt='Расход теплоносителя по мощности при перепаде температур 20 К и 5 К: при малом перепаде расход в четыре раза больше',
         caption='Расход теплоносителя при перепаде 20 К и 5 К: чем меньше перепад, тем больше воды надо прокачать.'),
    dict(slug='diametr-trub-otopleniya', table=12, name='moshchnost', label=0, vals=[1, 2, 3], label_prefix='Труба ', unit='мощность ветки, кВт',
         legend=['80/60', '75/65', '40/35'], ordered=True,
         alt='Мощность, которую держит труба PEX по диаметру при графиках 80/60, 75/65 и 40/35',
         caption='Мощность ветки по диаметру трубы и графику системы, кВт: чем меньше перепад, тем меньше мощности держит труба.'),
]


def clean(s):
    return re.sub(r'<[^>]+>', '', str(s)).replace(' ', ' ').strip()


def build(cfg, blk):
    rows = []
    for r in blk['rows']:
        if cfg.get('skip') and cfg['skip'] in clean(r[cfg['label']]).lower():
            continue
        vs = [num(r[c]) for c in cfg['vals']]
        if any(v is None for v in vs):
            continue
        lab = clean(r[cfg['label']])
        if cfg.get('strip_paren'):
            lab = re.sub(r'\s*\(.*$', '', lab)
        if cfg.get('label_prefix'):
            lab = cfg['label_prefix'] + lab
        if cfg.get('boiler'):
            lab = '%s (%s)' % (clean(r[1]), clean(r[0]))
        rows.append((lab, vs, [short(r[c]) for c in cfg['vals']]))
    ns = len(cfg['vals'])
    series = (OPS_ORDERED if cfg.get('ordered') else OPS)[:ns]
    body, W, H = chart(rows, series, cfg['unit'], cfg.get('legend'))
    return F.svg_wrap(W, H, body, cfg['alt'])


def main():
    by = {}
    for c in CONFIG:
        by.setdefault(c['slug'], []).append(c)
    for slug, cfgs in by.items():
        path = os.path.join(ROOT, 'content', 'articles', slug + '.json')
        art = json.load(io.open(path, encoding='utf-8'))
        blocks = art['blocks']
        orig = [b for b in blocks if b.get('type') != 'figure']      # номера таблиц — по тексту без графиков
        for c in cfgs:
            tbl = orig[c['table']]
            assert tbl['type'] == 'table', (slug, c['table'], tbl['type'])
            src = 'content/figures/%s-%s.svg' % (slug, c['name'])
            io.open(os.path.join(ROOT, src), 'w', encoding='utf-8').write(build(c, tbl))
            if not any(b.get('type') == 'figure' and b.get('src') == src for b in blocks):
                pos = next(i for i, b in enumerate(blocks) if b is tbl)
                blocks.insert(pos + 1, {'type': 'figure', 'src': src, 'alt': c['alt'], 'caption': c['caption']})
        io.open(path, 'w', encoding='utf-8').write(json.dumps(art, ensure_ascii=False, indent=1))
        print(slug, len(cfgs))


if __name__ == '__main__':
    main()
