# -*- coding: utf-8 -*-
"""
Кадр точки подключения сантехники для сметы (раздел «5. Внутреннее водоснабжение»): водорозетки на
монтажной планке и подводка от коллектора — то, что кладёт смета на точку:
  * водорозетка 16 x Rp 1/2" тупиковая (угольник настенный удлинённый) SFA-0032-001612;
  * монтажная планка двойная 150 мм SAC-0022-600150 (смеситель умывальника, ванны, душа), двойная 100 мм
    SAC-0022-600100 или одинарная SAC-0022-600001 (унитаз, инсталляция — только ХВС);
  * гильза монтажная 16 SFA-0020-000016 на штуцере, труба PEX-a 16x2.2 в теплоизоляции (синяя — ХВС,
    красная — ГВС), фиксатор поворота 90° SFA-0031-000016 на выходе трубы из пола в штробу;
  * пробки с наружной резьбой SFA-0035-100012 / -200012 (синяя / красная) — в водорозетках до установки
    приборов (опрессовка).

    blender --background --python tools/render_water_outlet.py -- <папка> <вариант>
      вариант — double150 | double100 | single

Источники:
  * водорозетка — паспорт STOUT SFA ред. 6 (23.04.2026), п. 10 «Угольник переходной настенный с внутренней
    резьбой, удлинённый»: L 40 (штуцер), D 13,45, d 10, H 55,5 (от стены до торца гнезда), Rp 1/2";
    ушко с двумя отверстиями под винты (шаг 45 — как у SFA-0009 той же серии).
  * планка — оцинкованная перфорированная полоса с отбортовкой (фото каталога STOUT SAC), межосевое
    водорозеток — 150 или 100 мм по артикулу; одинарная — короткая полоса под одну водорозетку.
  * фиксатор SFA-0031 — пластиковый (чёрный) жёлоб поворота 90° для труб 14–18 мм, радиус ~5D.
Высота точки на кадре условная (400 мм над полом); высота по прибору — в проекте.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blender_parts import *  # noqa: F401,F403
from mathutils import Vector, Matrix
import bpy

_argv = sys.argv[sys.argv.index('--') + 1:]
OUT, VAR = _argv[0], _argv[1]
TAG = 'wo_' + VAR
DOUBLE = VAR.startswith('double')
STEP = 0.150 if VAR == 'double150' else 0.100

add_colors({
    'ins_sup': (0.93, 0.27, 0.22),
    'ins_ret': (0.13, 0.56, 0.95),
    'plugred': (0.90, 0.20, 0.18),
    'plugblue': (0.16, 0.45, 0.90),
    'fixblack': (0.16, 0.17, 0.18),
    'wallg': (0.92, 0.92, 0.91),
})

ZO = 0.400                 # ось водорозеток над полом (на кадре условно)
YW = 0.0                   # лицо стены; комната — −Y
YP = YW - 0.004            # лицо планки
ANCH = {}


def plate():
    """Монтажная планка: оцинкованная полоса 25 мм с отбортовкой и рядом отверстий."""
    part('mf')
    z = metal('zinc_bracket')
    L = (STEP + 0.080) if DOUBLE else 0.060
    box('планка', (L, 0.002, 0.025), z, (0, YW - 0.001, ZO))
    for sz in (-1, 1):
        box('отбортовка', (L, 0.006, 0.0015), z, (0, YW - 0.003, ZO + sz * 0.0125))
    dark = mat('fixblack', rough=0.6)
    n = int(L / 0.012)
    for k in range(n):
        x = -L / 2 + 0.006 + k * (L - 0.012) / max(1, n - 1)
        if DOUBLE and any(abs(x - sx * STEP / 2) < 0.030 for sx in (-1, 1)):
            continue
        if not DOUBLE and abs(x) < 0.030:
            continue
        lathe('отверстие', [(0.0022, 0), (0.0022, 0.0005)], dark, (x, YW - 0.0021, ZO), '-Y', segs=12)
    marks['mf'] = (-L / 2 + 0.010, YW - 0.002, ZO + 0.006)


def outlet(x, hot, key):
    """Водорозетка SFA-0032: ушко на планке (2 винта), корпус с гнездом Rp 1/2" к комнате (H 55,5 от
    стены), штуцер 16 вниз (L 40) с гильзой; в гнезде — пробка под опрессовку. Возвращает низ штуцера."""
    br = M_BRASS()
    part('node')
    # ушко: пластина с двумя отверстиями, шаг 45
    ear = rounded([(-0.0315, -0.009), (0.0315, -0.009), (0.0315, 0.009), (-0.0315, 0.009)], 0.009, seg=6)
    to_xz = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    prism('ушко', [(px + x, pz) for px, pz in ear], 0.003, br, Matrix.Translation(Vector((0, YP - 0.0015, ZO))) @ to_xz, bevel=0.0006)
    for sx in (-1, 1):
        lathe('винт', [(0.0040, 0), (0.0040, 0.0015), (0.0, 0.0022)], metal('zinc'), (x + sx * 0.0225, YP - 0.003, ZO), '-Y', segs=16)
    # корпус: от ушка к комнате, гнездо Rp 1/2" (наружный Ø ~26), вылет 55,5 от стены
    lathe('корпус', [(0.0115, 0), (0.0120, 0.006), (0.0120, 0.040), (0.0130, 0.042), (0.0130, 0.0515), (0.0120, 0.0525)],
          br, (x, YW - 0.003, ZO), '-Y', segs=6 if False else 40)
    hexnut('шестигранник гнезда', 0.027, 0.012, br, (x, YW - 0.0405, ZO), '-Y', ch=0.10)
    # штуцер вниз: L 40 от оси, Ø 13,45 с ёлочкой, на нём гильза
    yc = YW - 0.015
    lathe('прилив штуцера', [(0.0100, 0), (0.0100, 0.012)], br, (x, yc, ZO), '-Z', segs=32)
    lathe('штуцер', [(0.0067, 0), (0.0080, 0.004), (0.0067, 0.010), (0.0080, 0.014), (0.0067, 0.020)], br, (x, yc, ZO - 0.012), '-Z', segs=32)
    part('ek:' + key)
    lathe('гильза', [(0.0105, 0), (0.0115, 0.002), (0.0115, 0.020), (0.0105, 0.022)], br, (x, yc, ZO - 0.018), '-Z', segs=40)
    marks['node'] = (x + 0.012, YW - 0.030, ZO + 0.012)
    marks.setdefault('ek', (x + 0.011, yc - 0.008, ZO - 0.028))
    # пробка под опрессовку: пластик, шестигранник с рёбрами и резьбой 1/2"
    part('head:' + key)
    pm = mat('plugred' if hot else 'plugblue', rough=0.45, coat=0.2)
    c = (x, YW - 0.0555, ZO)
    hexnut('пробка', 0.024, 0.008, pm, c, '-Y', ch=0.18)
    lathe('пробка торец', [(0.0090, 0), (0.0090, 0.003), (0.0, 0.0035)], pm, (x, YW - 0.0635, ZO), '-Y', segs=24)
    marks.setdefault('head', (x, YW - 0.066, ZO + 0.006))
    return Vector((x, yc, ZO - 0.040))


def pipe(p, hot, key):
    """Труба 16 в теплоизоляции: вниз по штробе, поворот в стяжку на фиксаторе SFA-0031 (R 5D) к комнате."""
    R = 0.080
    zc = -0.030                       # ось трубы в стяжке
    part('tube:' + key)
    pm = M_PLAST('ins_sup' if hot else 'ins_ret') if illus() else M_PLAST('pex')
    arc = [(p.x, p.y - R + R * math.cos(t), zc + R - R * math.sin(t)) for t in [k * math.pi / 2 / 14 for k in range(15)]]
    # изоляция 18/6 — на прямых участках; в повороте труба голая и лежит в жёлобе фиксатора
    tube('изоляция 18/6', [(p.x, p.y, p.z + 0.002), (p.x, p.y, zc + R + 0.006)], 0.014, pm)
    tube('труба PEX 16', [(p.x, p.y, zc + R + 0.012)] + arc + [(p.x, p.y - R - 0.012, zc)], 0.008, M_PLAST('pex'))
    tube('изоляция 18/6', [(p.x, p.y - R - 0.006, zc), (p.x, p.y - R - 0.22, zc)], 0.014, pm)
    part('fix:' + key)
    ob = pipe_fixator90((p.x, p.y - R, zc + R), (0, 1, 0), (0, 0, -1), R)
    ob.data.materials.clear()
    ob.data.materials.append(mat('fixblack', rough=0.55))
    ANCH['fix:' + key] = (p.x, p.y - R + R * math.cos(math.pi / 4), zc + R - R * math.sin(math.pi / 4))
    ANCH['tube:' + key] = (p.x, p.y, ZO * 0.45)


def room():
    part('')
    g = mat('wallg', rough=0.6, alpha=0.18)
    x0, x1 = -0.30, 0.30
    for name, size, loc in (('стена', (x1 - x0, 0.004, 0.80), (0.0, YW + 0.002, 0.36)),
                            ('пол', (x1 - x0, 0.45, 0.004), (0.0, YW - 0.225, -0.002))):
        ob = box(name, size, g, loc)
        ob.modifiers.clear()
        for c in list(ob.users_collection):
            c.objects.unlink(ob)
        coll('sheath').objects.link(ob)


def build():
    sc = reset()
    room()
    plate()
    pts = [(-STEP / 2, True), (STEP / 2, False)] if DOUBLE else [(0.0, False)]
    for x, hot in pts:
        key = 'h' if hot else 'c'
        p = outlet(x, hot, key)
        pipe(p, hot, key)
    return sc


def main():
    sc = build()
    cam = camera(sc, objects=list(coll('solid').objects))
    zones, pts, proj = frame_meta(sc, cam, ANCH)
    sheath = list(coll('sheath').objects)
    for o in sheath:
        o.hide_render = True
    sc.render.film_transparent = True
    freestyle(sc, 'solid', LINE_COLOR, 1.8)
    render(sc, os.path.join(OUT, TAG + '_solid.png'))
    for o in sheath:
        o.hide_render = False
    for o in coll('solid').objects:
        o.is_holdout = True
    freestyle(sc, 'sheath', (0.62, 0.64, 0.68), 1.0)
    eng = sc.render.engine
    set_engine(sc, 'eevee')
    render(sc, os.path.join(OUT, TAG + '_sheath.png'))
    sc.render.engine = eng
    for o in sheath:
        o.hide_render = True
    # карта деталей: планка R, гильза G, труба B, водорозетка C, фиксатор M, пробка W
    ID = {'mf': (1, 0, 0), 'ek': (0, 1, 0), 'tube': (0, 0, 1), 'node': (0, 1, 1), 'fix': (1, 0, 1), 'head': (1, 1, 1)}
    id_pass(sc, list(coll('solid').objects), ID, os.path.join(OUT, TAG + '_id.png'))
    write_meta(sc, os.path.join(OUT, TAG + '.json'), zones, pts, proj)


main()
