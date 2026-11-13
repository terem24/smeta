# -*- coding: utf-8 -*-
"""
Отбор 3D-моделей для сайта: models/parts3d и models/nodes3d (локальные, в .gitignore) -> models3d/ (идёт в git и на сайт).

    python tools/publish_models3d.py [--node-limit-kb 300]

Что выкладываем:
  * models3d/parts/ — все детали котельной (GLB и parts.json): около 4,5 МБ, нужны вкладке «Дом 3D» для сборки из сметы;
  * models3d/nodes/ — только лёгкие узлы (до --node-limit-kb, по умолчанию 300 КБ: водорозетки и канализация) и nodes.json
    с теми же ключами. Тяжёлые узлы (коллекторы, радиаторные и конвекторные узлы, 1-3 МБ каждый, всего около 30 МБ)
    остаются локальными: файл в git навсегда, а в списке вкладки они просто не появятся.
Папка models/ в .gitignore остаётся как есть (там FBX и 99 МБ исходников), выкладка идёт отдельной папкой.
Запускать после tools/export_parts_glb.py и tools/export_nodes_glb.py; результат коммитить вместе с кодом.
"""
import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIMIT = 300
if '--node-limit-kb' in sys.argv:
    LIMIT = int(sys.argv[sys.argv.index('--node-limit-kb') + 1])

SRC_P = os.path.join(ROOT, 'models', 'parts3d')
SRC_N = os.path.join(ROOT, 'models', 'nodes3d')
DST_P = os.path.join(ROOT, 'models3d', 'parts')
DST_N = os.path.join(ROOT, 'models3d', 'nodes')

for d in (DST_P, DST_N):
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)

total = 0
for f in sorted(os.listdir(SRC_P)):
    if f.endswith('.glb') or f == 'parts.json':
        shutil.copy2(os.path.join(SRC_P, f), os.path.join(DST_P, f))
        total += os.path.getsize(os.path.join(DST_P, f))
print('детали: %d файлов, %.1f МБ' % (len(os.listdir(DST_P)), total / 1e6))

meta = json.load(open(os.path.join(SRC_N, 'nodes.json'), encoding='utf-8'))
keep = {}
tn = 0
for k, v in meta.items():
    p = os.path.join(SRC_N, k + '.glb')
    if os.path.exists(p) and os.path.getsize(p) <= LIMIT * 1024:
        shutil.copy2(p, os.path.join(DST_N, k + '.glb'))
        keep[k] = v
        tn += os.path.getsize(p)
with open(os.path.join(DST_N, 'nodes.json'), 'w', encoding='utf-8') as f:
    json.dump(keep, f, ensure_ascii=False, indent=1)
print('узлы: %d из %d (до %d КБ), %.1f МБ; остались локальными: %s' % (
    len(keep), len(meta), LIMIT, tn / 1e6, ', '.join(sorted(set(meta) - set(keep))) or '—'))
