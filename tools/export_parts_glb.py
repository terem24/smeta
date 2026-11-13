# -*- coding: utf-8 -*-
"""
Выгрузка деталей котельной из процедурной библиотеки Blender в GLB для 3D-режима (вкладка «Дом 3D»).

    blender --background --python tools/export_parts_glb.py -- <папка вывода>

Источник геометрии — тот же код, что рисует кадры узлов (tools/blender_parts.py и сборщики деталей
в tools/render_boiler_node.py): деталь собирается один раз, а не дублируется вторым чертежом. Файлы
сборщиков не правим — читаем их исходник и берём функции деталей (хвостовой вызов main() отрезаем).

На выходе <папка>/<ключ>.glb и parts.json: габариты в мм и порты (точка и ось присоединения).
Начало координат у детали — в точке входа c = (0, 0, 0); оси как в кадрах узлов (Z вверх, Blender),
экспортёр glTF переводит их в Y вверх. Порты помечены src: по какой строке паспорта/кода взяты.
Неизвестные — не выдумываем: type 'U'.
"""
import json
import math
import os
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[sys.argv.index('--') + 1]
os.makedirs(OUT, exist_ok=True)

# Сборщик котла читает argv как <папка> <вариант>; подставляем, чтобы его верхний код отработал.
sys.argv = sys.argv[:sys.argv.index('--') + 1] + [OUT, 'parts']
_path = os.path.join(TOOLS, 'render_boiler_node.py')
_src = open(_path, encoding='utf-8').read().rstrip()
assert _src.endswith('main()'), 'render_boiler_node.py изменился: хвост main() не найден'
_g = {'__file__': _path, '__name__': 'parts_export'}
exec(compile(_src[:-len('main()')], _path, 'exec'), _g)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

reset, coll = _g['reset'], _g['coll']
index = {}


def vec(v):
    return [round(float(x) * 1000, 2) for x in v]


def export(key, label, ports, solid=('solid',)):
    """Сохранить всё, что сейчас лежит в сцене в группе solid."""
    objs = [o for g in solid for o in coll(g).objects]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    path = os.path.join(OUT, key + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_apply=True)
    xs = [(o.matrix_world @ Vector(c)) for o in objs for c in o.bound_box]
    lo = [min(p[i] for p in xs) for i in range(3)]
    hi = [max(p[i] for p in xs) for i in range(3)]
    index[key] = {'label': label, 'size_mm': vec([hi[i] - lo[i] for i in range(3)]),
                  'min_mm': vec(lo), 'max_mm': vec(hi), 'ports': ports}
    print('ok', key, index[key]['size_mm'])


def port(name, pos, axis, kind, size, src):
    """kind: M — наружная резьба, F — внутренняя/накидная гайка, P — под пресс, U — не знаем."""
    return {'name': name, 'pos_mm': vec(pos), 'axis': axis, 'type': kind, 'size': size, 'src': src}


C0 = Vector((0, 0, 0))
D = {'-Z': (0, 0, -1)}

# Кран шаровой SVB-0004 3/4" ВР/НР: вход ВР (c), выход НР (возвращённая точка)
reset(); e = _g['ball_valve'](C0)
export('ball_valve_svb0004', 'Кран шаровой SVB-0004 3/4" ВР/НР',
       [port('in', C0, D['-Z'], 'F', '3/4"', 'паспорт SVB-0004: l 13 ВР'),
        port('out', e, D['-Z'], 'M', '3/4"', 'паспорт SVB-0004: l1 13 НР')])

# Американка SFT-0041 3/4" ВР/НР
reset(); e = _g['union'](C0)
export('union_sft0041', 'Американка SFT-0041 3/4" ВР/НР',
       [port('in', C0, D['-Z'], 'F', '3/4"', 'карточка SFT-0041'),
        port('out', e, D['-Z'], 'M', '3/4"', 'карточка SFT-0041')])

# Переходники нерж. 22x3/4": RSS-1021 (ВПр-НР), RSS-1022 (ВПр-ВР)
reset(); e = _g['adapter'](C0, False)
export('adapter_rss1021', 'Переходник RSS-1021 22x3/4" НР (пресс-НР)',
       [port('in', C0, D['-Z'], 'M', '3/4"', 'RSS-1021'), port('out', e, D['-Z'], 'P', '22', 'RSS-1021')])
reset(); e = _g['adapter'](C0, True)
export('adapter_rss1022', 'Переходник RSS-1022 22x3/4" ВР (пресс-ВР)',
       [port('in', C0, D['-Z'], 'F', '3/4"', 'RSS-1022'), port('out', e, D['-Z'], 'P', '22', 'RSS-1022')])

# Сепаратор и магнитный фильтр: проточная часть по оси; концы, пока без паспортных резьб -> U
reset(); e = _g['separator'](C0, side=-1)
export('separator_rfw0070', 'Сепаратор воздуха RFW-0070 3/4"',
       [port('in', C0, D['-Z'], 'U', '3/4"', 'гнёзда ВР по коду сборщика (проверить)'),
        port('out', e, D['-Z'], 'U', '3/4"', 'гнёзда ВР по коду сборщика (проверить)')])
reset(); r = _g['mag_filter'](C0, side=1)
export('filter_rfw0080', 'Фильтр магнитный RFW-0080 3/4"',
       [port('in', C0, D['-Z'], 'U', '3/4"', 'по коду сборщика (проверить)')])

# Котёл Haier NeoSlim Ti: корпус, патрубки снизу, дымоход
reset(); _g['boiler'](); _g['chimney']()
XP, YP = _g['XP'], _g['YP']
bp = [port(k, Vector((x, YP, 0)), D['-Z'], 'M', '3/4"' if k != 'D' else '1/2"', 'руководство Haier стр. 28-29')
      for k, x in XP.items()]
export('boiler_haier_neoslim', 'Котёл Haier NeoSlim 1.18/1.24 Ti', bp)

# Стабилизатор напряжения ST 250
reset(); _g['stabilizer'](x=0.0, z=0.0)
export('stabilizer_st250', 'Стабилизатор ST 250', [])

# Бойлер OptiBase и насосная группа: сборщики лежат в tools/parts3d_boiler_pump.py
_g['port'] = port
_bp = os.path.join(TOOLS, 'parts3d_boiler_pump.py')
exec(compile(open(_bp, encoding='utf-8').read(), _bp, 'exec'), _g)
_SRC = 'паспорт SWH-2110 рис. 3-5, высота от пола считана с чертежа (±20 мм)'
# (высота патрубка от пола, м) по чертежам; 300 л — рис. 3, 400/500 л — рис. 4-5
for lit, D_, H_, hot, pz in (
        (300, 0.590, 1.690, '1"', {'cold': 0.195, 'coil_out': 0.315, 'recirc': 0.430, 'coil_in': 0.895}),
        (500, 0.735, 1.655, '1"', {'cold': 0.130, 'coil_out': 0.380, 'recirc': 0.630, 'coil_in': 0.730})):
    reset()
    ports_ = {k: (z, '1"', _SRC) for k, z in pz.items()}
    pl = _g['swh_boiler'](D_, H_, ports_, hot)
    export('boiler_swh2110_%d' % lit, 'Бойлер STOUT OptiBase SWH-2110-%06d, %d л' % (lit, lit), pl)

reset(); pl = _g['pump_group_mix25']()
export('pump_group_sdg0002_25', 'Насосная группа STOUT SDG-0002-002501 DN25 (смес.)', pl)

# Гидравлика котельной: коллектор SDG-0018 и насосные группы SDG-0001/0003 — сборщики соседней сессии
# (tools/render_hydro_node.py), те же, что рисуют кадры узлов. Читаем исходник, не правим.
_hp = os.path.join(TOOLS, 'render_hydro_node.py')
_hs = open(_hp, encoding='utf-8').read().rstrip()
assert _hs.endswith('main()'), 'render_hydro_node.py изменился: хвост main() не найден'
sys.argv = sys.argv[:sys.argv.index('--') + 1] + [OUT, 'ds']
_h = {'__file__': _hp, '__name__': 'hydro_export'}
exec(compile(_hs[:-len('main()')], _hp, 'exec'), _h)
YA = _h['YA']
SRC_G = 'паспорт SDG-0001 ред. 3, табл. 4.2: низ G1 1/2" НР, верх Rp 1" ВР, шаг F 125'
for kind, key, label in (('d', 'pump_group_sdg0001_direct', 'Насосная группа STOUT SDG-0001-002501 DN25 (прямая)'),
                         ('s', 'pump_group_sdg0003_servo', 'Насосная группа STOUT SDG-0003-002501 DN25 (под сервопривод)')):
    reset(); _h['part']('')
    _h['group'](0.0, 0.0, kind)
    dx = 0.0625
    gp = [port('bottom_left', Vector((-dx, YA, 0.0)), (0, 0, -1), 'M', '1 1/2"', SRC_G),
          port('bottom_right', Vector((dx, YA, 0.0)), (0, 0, -1), 'M', '1 1/2"', SRC_G),
          port('top_left', Vector((-dx, YA, 0.338)), (0, 0, 1), 'F', '1"', SRC_G),
          port('top_right', Vector((dx, YA, 0.338)), (0, 0, 1), 'F', '1"', SRC_G)]
    export(key, label, gp)
reset(); _h['part']('')
_xs, _zt = _h['collector'](2)
SRC_C = 'паспорт SDG ред. 30.03.2023, табл. 4.3.6: верх накидные гайки G1 1/2" к группам, низ G1 1/2" НР к котлу'
cp = [port('top_%d' % i, Vector((x, YA, _zt)), (0, 0, 1), 'F', '1 1/2"', SRC_C) for i, x in enumerate(_xs)]
cp += [port('boiler_%s' % n, Vector((sx * 0.100, YA, -0.075 - 0.040)), (0, 0, -1), 'M', '1 1/2"', SRC_C)
       for n, sx in (('supply', -1), ('return', 1))]
export('hydro_collector_sdg0018_2', 'Коллектор-гидрострелка STOUT SDG-0018-004002 (2 пары выходов)', cp)

with open(os.path.join(OUT, 'parts.json'), 'w', encoding='utf-8') as f:
    json.dump(index, f, ensure_ascii=False, indent=1)
print('parts.json', len(index))
