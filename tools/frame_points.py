# -*- coding: utf-8 -*-
"""
Точки сносок на самой детали. Лист сметы (app.wmSheet) раньше брал точки выноски по рамке детали
(доли её прямоугольника): у детали, лежащей на кадре наискось (конвектор, длинные трубы, радиатор в ракурсе),
угол рамки — пустое место, и сноска указывала в воздух. Здесь по карте деталей (*_id.png) для каждой зоны
индекса подбираются точки, где пиксель карты — цвета этой детали: сетка тех же долей, что у листа, каждая
точка притягивается к ближайшему пикселю детали. Пишется в зону индекса как "pts" — лист берёт их вместо
рамки.

    python tools/frame_points.py img/rad_conv/conv.json img/rad_side/side.json ...
"""
import json
import os
import sys

import numpy as np
from PIL import Image

# цвет карты деталей по ключу детали — общий для render_* кадров приборов, водорозеток и канализации
COL = {'rad': (255, 0, 0), 'conv': (255, 0, 0), 'mf': (255, 0, 0),
       'ek': (0, 255, 0), 'fit': (0, 255, 0),
       'tube': (0, 0, 255),
       'lock': (255, 255, 0), 'bracket': (255, 255, 0), 'mount': (255, 255, 0),
       'node': (0, 255, 255),
       'fix': (255, 0, 255), 'sleeve': (255, 0, 255),
       'head': (255, 255, 255),
       'kit': (255, 128, 0), 'feed': (0, 255, 255), 'end': (255, 0, 255)}
FX = (0.25, 0.5, 0.75)
FY = {'tube': (0.4, 0.62, 0.8), 'rad': (0.15, 0.5, 0.85), 'conv': (0.15, 0.5, 0.85), 'mf': (0.15, 0.5, 0.85)}


def points(idm, z, col, search):
    """Точки зоны z (доли кадра) на пикселях цвета col: сетка долей, каждая — к ближайшему пикселю детали
    внутри рамки (с запасом search px). Пустой список — детали на карте не видно."""
    H, W = idm.shape[:2]
    x0, y0 = max(0, int(z[0] * W) - search), max(0, int(z[1] * H) - search)
    x1, y1 = min(W, int(z[2] * W) + search + 1), min(H, int(z[3] * H) + search + 1)
    sub = idm[y0:y1, x0:x1]
    m = np.all(sub == np.array(col, dtype=np.uint8), axis=2)
    ys, xs = np.nonzero(m)
    if not len(xs):
        return []
    # без самой кромки детали: точка сноски — внутри силуэта (пиксель, у которого соседи той же детали)
    inner = m.copy()
    inner[1:, :] &= m[:-1, :]
    inner[:-1, :] &= m[1:, :]
    inner[:, 1:] &= m[:, :-1]
    inner[:, :-1] &= m[:, 1:]
    iy, ix = np.nonzero(inner)
    if len(ix):
        xs, ys = ix, iy
    return xs, ys, x0, y0


def zone_pts(idm, k, z):
    base = k.split(':')[0]
    col = COL.get(base)
    if not col:
        return None
    H, W = idm.shape[:2]
    small = (z[2] - z[0]) * W < 12 and (z[3] - z[1]) * H < 12          # якорь (точка), а не рамка
    r = points(idm, z, col, 60 if small else 2)
    if not r and small:
        r = points(idm, z, col, 250)          # якорь лёг на соседнюю деталь — ближайший видимый участок
    if not r:
        return []
    xs, ys, x0, y0 = r
    xs = xs + x0
    ys = ys + y0
    out = []
    grid = [((z[0] + z[2]) / 2, (z[1] + z[3]) / 2)] if small else \
        [(z[0] + (z[2] - z[0]) * fx, z[1] + (z[3] - z[1]) * fy) for fx in FX for fy in FY.get(base, (0.5,))]
    for gx, gy in grid:
        d = (xs - gx * W) ** 2 + (ys - gy * H) ** 2
        i = int(np.argmin(d))
        p = [round(float(xs[i]) / W, 4), round(float(ys[i]) / H, 4)]
        if p not in out:
            out.append(p)
    return out


def main():
    for idx in sys.argv[1:]:
        d = os.path.dirname(idx)
        pref = {'conv.json': 'conv_', 'side.json': 'side_', 'radnode.json': 'radnode_', 'panel.json': 'panel_',
                'wo.json': 'wo_', 'sw.json': 'sw_', 'boiler.json': 'boiler_'}[os.path.basename(idx)]
        with open(idx, encoding='utf-8') as fh:
            index = json.load(fh)
        empty = []
        for key, fr in index.items():
            p = os.path.join(d, pref + key + '_id.png')
            if not os.path.isfile(p):
                continue
            idm = np.array(Image.open(p).convert('RGB'))
            pts = {}
            for k, z in fr['zones'].items():
                r = zone_pts(idm, k, z)
                if r is None:
                    continue
                if not r:
                    empty.append(key + ':' + k)
                pts[k] = r
            fr['pts'] = pts
        with open(idx, 'w', encoding='utf-8') as fh:
            json.dump(index, fh, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
        print(idx, 'кадров', len(index), 'деталей без пикселей на карте:', len(empty), empty[:6])


if __name__ == '__main__':
    main()
