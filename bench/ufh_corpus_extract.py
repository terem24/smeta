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

def label_blocks(page):
    """Подписи помещений на плане: строка «(1.1)» и следующие строки блока."""
    out = []
    d = page.get_text('dict')
    for b in d.get('blocks', []):
        lines = []
        for l in b.get('lines', []):
            t = ''.join(s['text'] for s in l.get('spans', [])).strip()
            if t: lines.append((t, l['bbox']))
        for k, (t, bb) in enumerate(lines):
            m = re.match(r'^\((\d+(?:\.\d+)?)\)$', t)
            if not m: continue
            rest = [x[0] for x in lines[k + 1:k + 4]]
            name = rest[0] if rest else ''
            area = None
            for r in rest:
                ma = re.search(r'([\d]+(?:[.,]\d+)?)\s*м', r)
                if ma and ('м2' in r.replace(' ', '') or 'м²' in r or r.strip().endswith('м')):
                    area = float(ma.group(1).replace(',', '.'))
            out.append({'no': m.group(1), 'name': name, 'area': area,
                        'x': (bb[0] + bb[2]) / 2 * ZOOM, 'y': bb[3] * ZOOM})
    return out

def explication(page):
    """Площади из таблицы экспликации: строка «1.1 | Гостиная | 17.55 м2 | …»."""
    words = page.get_text('words')
    rows = {}
    for w in words:
        key = round((w[1] + w[3]) / 2 / 2.5)
        rows.setdefault(key, []).append(w)
    res = {}
    for ws in rows.values():
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
        for lb in labs:
            if lb['area'] is None and lb['no'] in exp: lb['area'] = exp[lb['no']]
        L, steps = loops(page)
        coll = collector(page)
        pix = page.get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM), alpha=False)
        fid = 'p%03d' % len(meta)
        with open(os.path.join(out, fid + '.rgb'), 'wb') as fh: fh.write(pix.samples)
        meta.append({'id': fid, 'pdf': name, 'page': pno + 1, 'w': pix.width, 'h': pix.height,
                     'labels': labs, 'coll': coll, 'L': L, 'steps': steps})
        doc.close()
    io.open(os.path.join(out, 'meta.json'), 'w', encoding='utf-8').write(json.dumps(meta, ensure_ascii=False))
    ok = sum(1 for m in meta if m['labels'] and m['coll'] and m['L'])
    print('листов', len(meta), 'с подписями, коллектором и L', ok)

main()
