# -*- coding: utf-8 -*-
"""
Выгрузка деталей котельной из процедурной библиотеки Blender в GLB для 3D-режима (вкладка «Дом 3D»).

    python tools/make_tex3d.py      (один раз: текстуры логотипов и панели, tools/blender_assets/ в git не идёт)
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
# наклейки и подмена логотипов (tools/parts3d_decals.py); текстуры — tools/make_tex3d.py и make_tex3d_logos.py
_g['TEX'] = os.path.join(TOOLS, 'blender_assets', 'tex3d')
_dp = os.path.join(TOOLS, 'parts3d_decals.py')
_DEC = compile(open(_dp, encoding='utf-8').read(), _dp, 'exec')
exec(_DEC, _g)

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

_g['add_colors']({'ringblue': (0.12, 0.30, 0.75)})


def _blue_rings():
    """В кадрах узлов у переходников красное кольцо (ROMMER RSS); в смете STOUT SSS-2021/2022, на их фото кольцо синее."""
    for _o in _g['coll']('solid').objects:
        if _o.name.startswith('кольцо пресс') and _o.data.materials:
            _o.data.materials[0] = _g['mat']('ringblue', rough=0.35)


# Кран шаровой SVB-0004 3/4" ВР/НР: вход ВР (c), выход НР (возвращённая точка)
reset(); e = _g['ball_valve'](C0)
export('ball_valve_svb0004', 'Кран шаровой SVB-0004 3/4" ВР/НР',
       [port('in', C0, (0, 0, 1), 'F', '3/4"', 'паспорт SVB-0004: l 13 ВР'),
        port('out', e, D['-Z'], 'M', '3/4"', 'паспорт SVB-0004: l1 13 НР')])

# Американка SFT-0041 3/4" ВР/НР
reset(); e = _g['union'](C0)
export('union_sft0041', 'Американка SFT-0041 3/4" ВР/НР',
       [port('in', C0, (0, 0, 1), 'F', '3/4"', 'карточка SFT-0041'),
        port('out', e, D['-Z'], 'M', '3/4"', 'карточка SFT-0041')])

# Переходники нерж. 22x3/4": RSS-1021 (ВПр-НР), RSS-1022 (ВПр-ВР)
reset(); e = _g['adapter'](C0, False)
_blue_rings()
export('adapter_rss1021', 'Переходник RSS-1021 22x3/4" НР (пресс-НР)',
       [port('in', C0, (0, 0, 1), 'M', '3/4"', 'RSS-1021'), port('out', e, D['-Z'], 'P', '22', 'RSS-1021')])
reset(); e = _g['adapter'](C0, True)
_blue_rings()
export('adapter_rss1022', 'Переходник RSS-1022 22x3/4" ВР (пресс-ВР)',
       [port('in', C0, (0, 0, 1), 'F', '3/4"', 'RSS-1022'), port('out', e, D['-Z'], 'P', '22', 'RSS-1022')])

# Сепаратор и магнитный фильтр: проточная часть по оси; концы, пока без паспортных резьб -> U
reset(); e = _g['separator'](C0, side=-1)
SRC_S = 'RFW-0070 ВР/ВР: гнёзда с внутренней резьбой сверху и снизу (docstring сборщика render_boiler_node.py, паспорт ROMMER разд. 4)'
export('separator_rfw0070', 'Сепаратор воздуха RFW-0070 3/4"',
       [port('in', C0, (0, 0, 1), 'F', '3/4"', SRC_S), port('out', e, D['-Z'], 'F', '3/4"', SRC_S)])
reset(); _fp, _fax = _g['mag_filter'](C0, side=1)
_AX = {'-Z': (0, 0, -1), 'Z': (0, 0, 1), 'X': (1, 0, 0), '-X': (-1, 0, 0)}
SRC_F = 'RFW-0080: накидная гайка C на НР крана (ВР), вход A — наружная резьба под переходник ВПр-ВР (docstring сборщика render_boiler_node.py)'
export('filter_rfw0080', 'Фильтр магнитный RFW-0080 3/4"',
       [port('in', C0, (0, 0, 1), 'F', '3/4"', SRC_F), port('out', _fp, _AX[_fax], 'M', '3/4"', SRC_F)])

# Стабилизатор напряжения ST 250
reset(); _g['stabilizer'](x=0.0, z=0.0)
print('логотипы стабилизатора:', _g['replace_logos']())
export('stabilizer_st250', 'Стабилизатор ST 250', [])

# Бойлер OptiBase и насосная группа: сборщики лежат в tools/parts3d_boiler_pump.py
_g['port'] = port
_g['TEX'] = os.path.join(TOOLS, 'blender_assets', 'tex3d')
_bp = os.path.join(TOOLS, 'parts3d_boiler_pump.py')
exec(compile(open(_bp, encoding='utf-8').read(), _bp, 'exec'), _g)

# Котёл Haier NeoSlim Ti: корпус, патрубки снизу, дымоход; панель и логотип — наклейки по фото каталога
# (панель 193 x 154 мм, дисплей 42 °C, значки и кнопки; Haier над ней), старые прямоугольники панели убираем
reset(); _g['boiler'](); _g['chimney']()
for _ob in list(bpy.data.objects):
    if _ob.name.startswith(('панель индикации', 'экран', 'значок', 'логотип', 'линия', 'цифры', 'кнопка')):
        bpy.data.objects.remove(_ob, do_unlink=True)
_W, _H, _D, _YW = _g['W'], _g['H'], _g['D'], _g['YW']
_g['decal']('панель управления Haier', 'haier_panel.png', 0.198, 0.157, (_W / 2, _YW - _D - 0.0008, 0.031 + 0.0785), rough=0.12, coat=0.8)
_g['decal']('логотип Haier', 'haier_logo.png', 0.069, 0.069 * 0.30, (_W / 2, _YW - _D - 0.0006, _H - 0.069))
XP, YP = _g['XP'], _g['YP']
bp = [port(k, Vector((x, YP, 0)), D['-Z'], 'M', '3/4"' if k != 'D' else '1/2"', 'руководство Haier стр. 28-29')
      for k, x in XP.items()]
export('boiler_haier_neoslim', 'Котёл Haier NeoSlim 1.18/1.24 Ti', bp)

# Обвязка: пресс-фитинги 22, труба, расширительный бак (tools/parts3d_piping.py)
_pp = os.path.join(TOOLS, 'parts3d_piping.py')
exec(compile(open(_pp, encoding='utf-8').read(), _pp, 'exec'), _g)
for _fn, _key, _label in (('elbow90', 'fit22_elbow90', 'Угольник 90° ВПр-ВПр 22 SSS-2003-000022 (пресс, нерж.)'),
                          ('elbow45', 'fit22_elbow45', 'Угольник 45° ВПр-НПр 22 SSS-2004-000022 (пресс, нерж.)'),
                          ('tee22', 'fit22_tee', 'Тройник равнопроходной ВПр 22 SSS-2013-000022 (пресс, нерж.)'),
                          ('pipe22', 'pipe22_250', 'Труба нерж. 22x1,2, отрезок 250 мм (SSS-2001-000022)'),
                          ('expansion_tank_18', 'exp_tank_sth0004_18', 'Расширительный бак STOUT STH-0004-000018, 18 л')):
    reset(); _pl = _g[_fn](); export(_key, _label, _pl)

_SRC = 'паспорт SWH-2110 рис. 3-5, высота от пола считана с чертежа (±20 мм)'
# (высота патрубка от пола, м) по чертежам; 300 л — рис. 3, 400/500 л — рис. 4-5
for lit, D_, H_, hot, pz in (
        (300, 0.590, 1.690, '1"', {'cold': 0.195, 'coil_out': 0.315, 'recirc': 0.430, 'coil_in': 0.895}),
        (500, 0.735, 1.655, '1"', {'cold': 0.130, 'coil_out': 0.380, 'recirc': 0.630, 'coil_in': 0.730})):
    reset()
    ports_ = {k: (z, '1"', _SRC) for k, z in pz.items()}
    pl = _g['swh_boiler'](D_, H_, ports_, hot)
    export('boiler_swh2110_%d' % lit, 'Бойлер STOUT OptiBase SWH-2110-%06d, %d л' % (lit, lit), pl)

# Гидравлика котельной: коллектор SDG-0018 и насосные группы SDG-0001/0003 — сборщики соседней сессии
# (tools/render_hydro_node.py), те же, что рисуют кадры узлов. Читаем исходник, не правим.
_hp = os.path.join(TOOLS, 'render_hydro_node.py')
_hs = open(_hp, encoding='utf-8').read().rstrip()
assert _hs.endswith('main()'), 'render_hydro_node.py изменился: хвост main() не найден'
sys.argv = sys.argv[:sys.argv.index('--') + 1] + [OUT, '2_dsm']   # <пар>_<группы>: сборщик читает именно так
_h = {'__file__': _hp, '__name__': 'hydro_export'}
exec(compile(_hs[:-len('main()')], _hp, 'exec'), _h)
_h['TEX'] = _g['TEX']
exec(_DEC, _h)
YA = _h['YA']


SRC_G = 'паспорт SDG-0001/0002 ред. 3, табл. 4.2: низ G1 1/2" НР, шаг F 125; верхние узлы ASKON МУ-25М — отдельной позицией, портов сверху нет'
for kind, key, label in (('d', 'pump_group_sdg0001_direct', 'Насосная группа STOUT SDG-0001-002501 DN25 (прямая)'),
                         ('s', 'pump_group_sdg0003_servo', 'Насосная группа STOUT SDG-0003-002501 DN25 (под сервопривод)'),
                         ('m', 'pump_group_sdg0002_25', 'Насосная группа STOUT SDG-0002-002501 DN25 (4-ходовой клапан)')):
    reset(); _h['part']('')
    _h['group'](0.0, 0.0, kind)      # кожух без передней крышки, как в сборщике: таблички нет
    dx = 0.0625
    gp = [port('bottom_left', Vector((-dx, YA, 0.0)), (0, 0, -1), 'M', '1 1/2"', SRC_G),
          port('bottom_right', Vector((dx, YA, 0.0)), (0, 0, -1), 'M', '1 1/2"', SRC_G)]
    export(key, label, gp)

reset(); _h['part']('')
_xs, _zt = _h['collector'](2)
print('логотипы коллектора:', _h['replace_logos']())
SRC_C = 'паспорт SDG ред. 30.03.2023, табл. 4.3.6: верх накидные гайки G1 1/2" к группам, низ G1 1/2" НР к котлу'
cp = [port('top_%d' % i, Vector((x, YA, _zt)), (0, 0, 1), 'F', '1 1/2"', SRC_C) for i, x in enumerate(_xs)]
cp += [port('boiler_%s' % n, Vector((sx * 0.100, YA, -0.075 - 0.022 - 0.0485)), (0, 0, -1), 'F', '1"', SRC_C + '; на патрубках муфты SFT-0005 ВР 1 1/2" x ВР 1"')
       for n, sx in (('supply', -1), ('return', 1))]
export('hydro_collector_sdg0018_2', 'Коллектор-гидрострелка STOUT SDG-0018-004002 (2 пары выходов)', cp)

with open(os.path.join(OUT, 'parts.json'), 'w', encoding='utf-8') as f:
    json.dump(index, f, ensure_ascii=False, indent=1)
print('parts.json', len(index))
