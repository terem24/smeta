# -*- coding: utf-8 -*-
"""
Чистка кадров схем от заливки стены и пола. Проход sheath (стена и пол полупрозрачные, alpha 0.18) кладёт
на прозрачный фон светлую заливку (альфа ~84, где плоскости перекрываются, ~128): на листе сметы кадр
выглядит вставленной серой картинкой. Здесь заливка снимается — остаются линии стены/пола (Freestyle, серые)
и сами детали; под полом детали остаются приглушёнными (заливка лежит на непрозрачных пикселях детали).

    from frame_clean import clean          # в сборщиках: im = clean(im) перед сохранением .webp
    python tools/frame_clean.py img/rad_side img/rad_node ...   # дочистить готовые кадры
"""
import os
import sys

import numpy as np
from PIL import Image


def clean(im):
    """Светлые полупрозрачные пиксели (заливка плоскостей) — в полную прозрачность."""
    a = np.array(im.convert('RGBA'))
    rgb, al = a[..., :3].astype(int), a[..., 3]
    fill = (al < 200) & (rgb.min(axis=2) >= 200)
    a[fill, 3] = 0
    return Image.fromarray(a, 'RGBA')


def _one(p):
    try:
        return _one_(p)
    except Exception:
        return 0          # кадр ещё пишется сборщиком — пропустить


def _one_(p):
    im = Image.open(p)
    im.load()
    out = clean(im)
    if np.array_equal(np.array(im.convert('RGBA')), np.array(out)):
        return 0
    tmp = p + '.tmp.webp'
    out.save(tmp, quality=86, method=4)
    os.replace(tmp, p)
    return 1


def main():
    from multiprocessing import Pool
    files = [os.path.join(d, f) for d in sys.argv[1:] for f in sorted(os.listdir(d)) if f.endswith('.webp') and not f.endswith('.tmp.webp')]
    with Pool() as pool:
        n = sum(pool.map(_one, files, chunksize=4))
    print('очищено кадров:', n, 'из', len(files))


if __name__ == '__main__':
    main()
