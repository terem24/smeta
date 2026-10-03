# Лист «План напольного отопления» корпуса Galf → данные для стенда раскладки.
#
# Листы корпуса — растр (Revit выгружает план картинкой), текст — векторный.
# Для каждого проекта: картинка листа (сырые RGB) + подписи помещений «(1.1) /
# Гостиная / 1733 Вт / 18 м²» с координатами, точка коллектора (конец выноски
# от подписи «Коллектор ТП…»), длины и шаги петель проектировщика («Контур N /
# Шаг 150 мм / L= 74.6 м»). Обработка картинки — в bench/ufh_corpus.js.
#
# Запуск: python bench/ufh_corpus_extract.py <ufh_list.tsv> <папка PDF> <папка вывода> [предел]
import fitz, io, os, re, sys, json

ZOOM = 1.5          # 108 точек на дюйм: стена 200 мм при 1:100 ≈ 8 px

def all_lines(page):
    out = []
    for b in page.get_text('dict').get('blocks', []):
        for l in b.get('lines', []):
            t = ''.join(s['text'] for s in l.get('spans', [])).strip()
            if t: out.append((t, l['bbox']))
    return out

AREA_RE = re.compile(r'^(\d+(?:[.,]\d+)?)\s*м\s*[2²]?$')

def label_blocks(page):
    """Подписи помещений на плане: строка «(1.1)», под ней — имя, ватты, площадь.
    В листах корпуса это отдельные блоки текста, поэтому строки подписи
    собираются по положению: левый край тот же (±4 pt), ниже номера до 25 pt."""
    lines = all_lines(page)
    out = []
    for t, bb in lines:
        m = re.match(r'^\((\d+(?:\.\d+)?)\)$', t)
        if not m: continue
        below = [(t2, b2) for t2, b2 in lines
                 if abs(b2[0] - bb[0]) < 4 and bb[3] - 1 < b2[1] < bb[3] + 25]
        below.sort(key=lambda x: x[1][1])
        name, area = '', None
        for t2, _ in below[:4]:
            ma = AREA_RE.match(t2.replace(' ', ''))
            if ma: area = float(ma.group(1).replace(',', '.')); continue
            if not name and not re.search(r'\d', t2): name = t2
        out.append({'no': m.group(1), 'name': name, 'area': area,
                    'x': (bb[0] + bb[2]) / 2 * ZOOM, 'y': bb[3] * ZOOM})
    return out

def explication(page):
    """Площади из таблицы экспликации: строка «1.1 | Гостиная | 17.55 м2 | …».
    Строки — слова с близким центром по высоте (допуск 2,5 pt)."""
    words = sorted(page.get_text('words'), key=lambda w: (w[1] + w[3]) / 2)
    rows, cur, cy = [], [], None
    for w in words:
        c = (w[1] + w[3]) / 2
        if cy is not None and abs(c - cy) > 2.5:
            rows.append(cur); cur = []
        cur.append(w); cy = c if not cur[:-1] else cy
    if cur: rows.append(cur)
    res = {}
    for ws in rows:
        ws.sort(key=lambda w: w[0])
        txt = ' '.join(w[4] for w in ws)
        m = re.match(r'^(\d+\.\d+)\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*м', txt)
        if m: res[m.group(1)] = float(m.group(3).replace(',', '.'))
    return res

def collector(page):
    """Точка коллектора: дальний конец выноски от подписи «Коллектор …»."""
    hits = [s for s in page.search_for('Коллектор')]
    if not hits: return None
    segs = []
    for dr in page.get_drawings():
        for it in dr['items']:
            if it[0] == 'l': segs.append((it[1], it[2]))
    best = None
    for r in hits:
        # выноска начинается у подписи: ищем отрезок с концом у края подписи
        for a, b in segs:
            for p, q in ((a, b), (b, a)):
                if r.x0 - 6 <= p.x <= r.x1 + 6 and r.y0 - 6 <= p.y <= r.y1 + 6:
                    L = abs(q.x - p.x) + abs(q.y - p.y)
                    if L > 15 and (best is None or L > best[0]):
                        # цепочка: продолжаем от q, пока есть отрезок с концом в q
                        cur, seen = q, 0
                        for _ in range(6):
                            nxt = None
                            for c, e in segs:
                                for u, v in ((c, e), (e, c)):
                                    if abs(u.x - cur.x) < 0.6 and abs(u.y - cur.y) < 0.6 and (abs(v.x - cur.x) + abs(v.y - cur.y)) > 2 \
                                            and not (r.x0 - 6 <= v.x <= r.x1 + 6 and r.y0 - 6 <= v.y <= r.y1 + 6):
                                        nxt = v
                            if not nxt or (abs(nxt.x - p.x) + abs(nxt.y - p.y)) <= (abs(cur.x - p.x) + abs(cur.y - p.y)): break
                            cur = nxt
                        best = (L, cur)
    if not best: return None
    return {'x': best[1].x * ZOOM, 'y': best[1].y * ZOOM}

def dim_scale(page):
    """Масштаб по размерным цепочкам осей: «2200 2000 2000 2200» в один ряд.
    Центр подписи размера стоит посередине своего отрезка, поэтому положение
    подписи линейно по середине отрезка в мм: x = a + b·mid. b — pt на мм натуры.
    Берём ряды из 3+ чисел с малым разбросом подгонки; ответ — медиана по рядам."""
    nums = []
    for w in page.get_text('words'):
        t = w[4]
        if re.fullmatch(r'\d{3,5}', t) and 300 <= int(t) <= 30000 and (w[2] - w[0]) > (w[3] - w[1]):
            nums.append(((w[0] + w[2]) / 2, (w[1] + w[3]) / 2, int(t)))
    nums.sort(key=lambda n: n[1])
    rows, cur = [], []
    for n in nums:
        if cur and abs(n[1] - cur[-1][1]) > 1.5:
            rows.append(cur); cur = []
        cur.append(n)
    if cur: rows.append(cur)
    bs = []
    for r in rows:
        r.sort(key=lambda n: n[0])
        if len(r) < 3: continue
        mids, acc = [], 0
        for n in r: mids.append(acc + n[2] / 2); acc += n[2]
        xs = [n[0] for n in r]
        mm = sum(mids) / len(mids); mx = sum(xs) / len(xs)
        sxx = sum((m - mm) ** 2 for m in mids)
        if sxx <= 0: continue
        b = sum((m - mm) * (x - mx) for m, x in zip(mids, xs)) / sxx
        if b <= 0: continue
        res = max(abs(mx + b * (m - mm) - x) for m, x in zip(mids, xs))
        if res < 0.03 * (xs[-1] - xs[0]) + 1: bs.append(b)
    if not bs: return None
    bs.sort()
    return bs[len(bs) // 2]

def loops(page):
    t = page.get_text()
    L = [float(x.replace(',', '.')) for x in re.findall(r'L\s*=\s*(\d+(?:[.,]\d+)?)\s*м', t)]
    steps = [int(x) for x in re.findall(r'Шаг\s*(\d{2,3})\s*мм', t)]
    return L, steps

def main():
    lst, src, out = sys.argv[1], sys.argv[2], sys.argv[3]
    lim = int(sys.argv[4]) if len(sys.argv) > 4 else 10**6
    os.makedirs(out, exist_ok=True)
    rows = [l.rstrip('\n').split('\t') for l in io.open(lst, encoding='utf-8')]
    meta = []
    for r in rows[:lim]:
        name, pno = r[0], int(r[1])
        try:
            doc = fitz.open(os.path.join(src, name)); page = doc[pno]
        except Exception as e:
            continue
        labs = label_blocks(page)
        exp = explication(page)
        for lb in labs:          # в экспликации площадь точная, в подписи на плане — округлённая
            if lb['no'] in exp: lb['area'] = exp[lb['no']]
        L, steps = loops(page)
        coll = collector(page)
        pix = page.get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM), alpha=False)
        fid = 'p%03d' % len(meta)
        with open(os.path.join(out, fid + '.rgb'), 'wb') as fh: fh.write(pix.samples)
        b = dim_scale(page)                      # pt листа на мм натуры
        meta.append({'id': fid, 'pdf': name, 'page': pno + 1, 'w': pix.width, 'h': pix.height,
                     'labels': labs, 'coll': coll, 'L': L, 'steps': steps,
                     'pxPerM': b * 1000 * ZOOM if b else None})
        doc.close()
    io.open(os.path.join(out, 'meta.json'), 'w', encoding='utf-8').write(json.dumps(meta, ensure_ascii=False))
    ok = sum(1 for m in meta if m['labels'] and m['coll'] and m['L'])
    print('листов', len(meta), 'с подписями, коллектором и L', ok)

main()
