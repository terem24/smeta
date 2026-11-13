# -*- coding: utf-8 -*-
"""
Выгрузка узлов из сборщиков соседней сессии (tools/render_*_node.py, коллекторы, канализация,
водорозетки) в GLB целиком, одним файлом на узел — для 3D-режима «Дом 3D».

    blender --background --python tools/export_nodes_glb.py -- <папка вывода>

Файлы сборщиков не правим: читаем исходник, отрезаем хвостовой вызов main() (он рисует кадр) и
вызываем build(), как делает сам кадр. Берётся только группа solid (детали), стена-подложка
(sheath) в модель не идёт. Результат: <папка>/<ключ>.glb и nodes.json (габариты в мм).
Узел, у которого сборщик упал, пропускается с сообщением, остальные выгружаются.
"""
import json
import os
import sys
import traceback

TOOLS = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[sys.argv.index('--') + 1]
os.makedirs(OUT, exist_ok=True)
HEAD = sys.argv[:sys.argv.index('--') + 1]

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

index = {}


def node(fname, args, key, label):
    sys.argv = HEAD + [OUT] + args
    path = os.path.join(TOOLS, fname)
    src = open(path, encoding='utf-8').read().rstrip()
    assert src.endswith('main()'), fname + ': хвост main() не найден'
    g = {'__file__': path, '__name__': 'node_export'}
    try:
        exec(compile(src[:-len('main()')], path, 'exec'), g)
        g['build']()
        objs = list(g['coll']('solid').objects)
        if not objs:
            raise RuntimeError('пустой solid')
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, key + '.glb'), use_selection=True,
                                  export_format='GLB', export_apply=True)
        pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
        lo = [min(p[i] for p in pts) for i in range(3)]
        hi = [max(p[i] for p in pts) for i in range(3)]
        index[key] = {'label': label, 'source': fname, 'args': args, 'objects': len(objs),
                      'size_mm': [round((hi[i] - lo[i]) * 1000, 1) for i in range(3)]}
        print('ok', key, index[key]['size_mm'])
    except Exception:
        print('FAIL', key)
        traceback.print_exc(limit=3)


# коллекторы тёплого пола и радиаторов (STOUT SMS)
for n in (4, 8):
    node('render_ufh_manifold.py', [str(n)], 'ufh_manifold_%d' % n, 'Коллектор тёплого пола STOUT SMS на %d выходов в сборе' % n)
node('render_ufh_manifold.py', ['4', 'rad'], 'rad_manifold_4', 'Коллектор радиаторов на 4 выхода')
# коллектор водоснабжения: линия, точек, торец, тип
for typ, nm in (('st', 'STOUT SMB 6850'), ('rm', 'ROMMER RMB-0004'), ('bl', 'шаровые краны')):
    node('render_water_manifold.py', ['cw', '4', 'hammer', typ], 'water_manifold_cw4_' + typ, 'Коллектор водоснабжения ХВС на 4 точки, %s' % nm)
node('render_water_manifold.py', ['hw', '4', 'plug', 'st'], 'water_manifold_hw4_st', 'Коллектор водоснабжения ГВС на 4 точки, заглушка')
# радиаторы и узлы подключения
for v in ('space_angled', 'space_straight'):
    node('render_rad_node.py', [v], 'rad_node_' + v, 'Секционный радиатор STOUT Space, узел %s' % v)
for v in ('panel21_angled', 'panel21_straight', 'panel22_angled', 'panel11_straight'):
    node('render_panel_node.py', [v], 'panel_node_' + v, 'Панельный радиатор, узел %s' % v)
for v in ('scn-straight', 'scn-angled', 'scq-straight', 'scq-angled'):
    node('render_conv_node.py', [v], 'conv_node_' + v.replace('-', '_'), 'Внутрипольный конвектор, узел %s' % v)
for v in ('sect-angled-std-x-white', 'sect-straight-std-x-white'):
    node('render_side_node.py', [v], 'side_node_' + v.replace('-', '_'), 'Секционный радиатор, боковое подключение %s' % v)
# водоснабжение и канализация
for v in ('double150', 'double100', 'single'):
    node('render_water_outlet.py', [v], 'water_outlet_' + v, 'Водорозетка на монтажной планке, вариант %s' % v)
for v in ('toilet', 'basin', 'shower', 'wash', 'main'):
    node('render_sewer_node.py', [v], 'sewer_' + v, 'Канализация санузла: %s' % v)

with open(os.path.join(OUT, 'nodes.json'), 'w', encoding='utf-8') as f:
    json.dump(index, f, ensure_ascii=False, indent=1)
print('nodes.json', len(index))
