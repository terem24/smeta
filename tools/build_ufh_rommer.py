# -*- coding: utf-8 -*-
"""
Кадры узла коллектора тёплого пола ROMMER RMS-1210: img/manifold_ufh/ufhr_<N>.webp, карты деталей, индекс ufhr.json.
То же, что tools/build_ufh_manifold.py, но рендер — tools/render_ufh_rommer.py. Общий сборщик не меняется: здесь его
исходник берётся и правится на лету.

    python tools/build_ufh_rommer.py            # недостающие кадры
    python tools/build_ufh_rommer.py 4          # только N = 4 (+ вариант «_bare»)
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, 'build_ufh_manifold.py'), encoding='utf-8').read()
for old, new in (("KIND = 'rad' if RAD else 'ufh'", "KIND = 'ufhr'"),
                 ("'render_ufh_manifold.py'", "'render_ufh_rommer.py'")):
    if old not in src:
        raise SystemExit('build_ufh_rommer: в build_ufh_manifold.py не найдено «%s»' % old)
    src = src.replace(old, new)
exec(compile(src, os.path.join(HERE, 'build_ufh_manifold.py'), 'exec'), globals())
