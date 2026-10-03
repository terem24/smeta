"""
PDF плана -> папка для bench/room_areas.js: pNNN.rgb + meta.json.

Рисует страницу так же, как редактор (renderPdfPage): масштаб min(4, 1600 / длинная сторона).
Подписи площадей («19,16 м²») берёт из текстового слоя вместе с координатами.
Масштаб (px/м) считает по размерным числам, как scaleFromDims редактора.

    python bench/pdf_to_case.py "план.pdf" <папка вывода>
"""
import json
import os
import re
import sys

import fitz  # PyMuPDF

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
doc = fitz.open(src)
meta = []
for pno in range(len(doc)):
    page = doc[pno]
    r = page.rect
    k = min(4, 1600 / max(r.width, r.height))
    pix = page.get_pixmap(matrix=fitz.Matrix(k, k), alpha=False)
    pid = 'p%03d' % pno
    with open(os.path.join(out, pid + '.rgb'), 'wb') as f:
        f.write(pix.samples)
    words = page.get_text('words')
    labels = []
    for w in words:
        m = re.match(r'^(\d{1,3}[.,]\d{1,2})$', w[4])
        if not m:
            continue
        # дальше на той же строке должно стоять «м²»
        tail = [v for v in words if abs(v[3] - w[3]) < 3 and 0 <= v[0] - w[2] < 8 and v[4].startswith('м')]
        if not tail:
            continue
        labels.append({'name': 'комн.', 'area': float(m.group(1).replace(',', '.')),
                       'x': (w[0] + w[2]) / 2 * k, 'y': (w[1] + w[3]) / 2 * k})
    # масштаб по цепочкам размеров: расстояние между подписями соседних участков = (v1+v2)/2 мм
    toks = []
    for w in words:
        v = re.sub(r'\s', '', w[4])
        if re.match(r'^\d{3,5}$', v) and 200 <= int(v) <= 20000:
            toks.append((int(v), (w[0] + w[2]) / 2 * k, (w[1] + w[3]) / 2 * k))
    ks = []
    for sk, ak in ((2, 1), (1, 2)):
        lst = sorted(toks, key=lambda t: t[sk])
        grp = []
        def flush():
            global grp
            if len(grp) >= 2:
                g = sorted(grp, key=lambda t: t[ak])
                for i in range(1, len(g)):
                    d = g[i][ak] - g[i - 1][ak]
                    mm = (g[i][0] + g[i - 1][0]) / 2
                    if d > 2 and mm > 0 and 0.004 < d / mm < 1.5:
                        ks.append(d / mm)
            grp = []
        for t in lst:
            if grp and abs(t[sk] - grp[-1][sk]) > 6:
                flush()
            grp.append(t)
        flush()
    ks.sort()
    ppm = 0
    if len(ks) >= 3:
        med = ks[len(ks) // 2]
        good = [v for v in ks if abs(v - med) / med < 0.12]
        ppm = sum(good) / len(good) * 1000 if len(good) >= 3 else 0
    meta.append({'id': pid, 'pdf': os.path.basename(src), 'page': pno + 1, 'w': pix.width, 'h': pix.height,
                 'pxPerM': ppm, 'labels': labels})
    print(pid, pix.width, pix.height, 'подписей', len(labels), 'px/м по размерам', round(ppm, 1))
with open(os.path.join(out, 'meta.json'), 'w', encoding='utf-8') as f:
    json.dump(meta, f, ensure_ascii=False)
