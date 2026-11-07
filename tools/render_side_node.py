# -*- coding: utf-8 -*-
"""
Кадр подключения радиатора с БОКОВЫМ подключением (секционные, дизайнерские, трубчатые) — прибор и
его обвязка в том виде и цвете, как в смете (арматура — модуль rad_side.py).

    blender --background --python tools/render_side_node.py -- <папка> <вариант>
      вариант — <семейство>-<узел>-<арматура>-<цвет>[-<цвет набора>]
        семейство: sect (секционный Space/Россия и аналоги, белый) | sectgr (секционный графит)
        узел:      angled (клапаны угловые, трубы из стены) | straight (прямые, трубы из пола)
        арматура:  std (SVT/SVL под евроконус, SHT-0001) | design (STOUT Design в цвет, SHTD-0002)
        цвет:      цвет дизайнерской арматуры: chrome | white | black (для std не важен — «x»)
        набор:     цвет монтажного набора (секционные): white | graphite | black

Секционный прибор: секция по фото Space (листовка STOUT) — плоская лицевая панель со скруглениями,
сверху козырёк и изогнутые рёбра; коллекторы 1" с переходниками набора. Межосевое 500, 6 секций на
кадре (число секций каждого прибора — в смете). Подключение — на левом торце (камера слева-спереди):
сверху термоклапан с головкой, снизу запорный клапан; на дальнем торце — кран Маевского сверху и
заглушка снизу (монтажный набор).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blender_parts import *  # noqa: F401,F403
from mathutils import Vector, Matrix
import bpy
import rad_side as rs

_argv = sys.argv[sys.argv.index('--') + 1:]
OUT, VAR = _argv[0], _argv[1]
TAG = 'side_' + VAR
_p = VAR.split('-')
FAMILY, NODE, STYLE, VCOL = _p[0], _p[1], _p[2], _p[3]
KITCOL = _p[4] if len(_p) > 4 else 'white'
ANGLED = NODE == 'angled'
HEAD = 'shtd' if STYLE == 'design' else 'sht'

add_colors({'radwhite': (0.95, 0.95, 0.94), 'radgraphite': (0.29, 0.31, 0.33)})

NSEC = 6
SW_ = 0.080
HR = 0.561
FA = 0.500
BD = 0.090
ZB = 0.120
ZC0 = ZB + (HR - FA) / 2
ZC1 = ZC0 + FA
YW = BD / 2 + 0.035
RC = 0.019
LR = NSEC * SW_
ANCH = {}


def body_mat():
    return mat('radgraphite' if FAMILY == 'sectgr' else 'radwhite', rough=0.45, coat=0.2)


def section(x0):
    """Секция Space (фото листовки STOUT, крупно): лицевая панель плоская со скруглениями сверху,
    сверху козырёк на всю ширину с загнутой передней кромкой, под ним 3 ряда изогнутых рёбер; сзади тело
    с рёбрами; коллекторы 1" сверху и снизу."""
    m = body_mat()
    xc = x0 + SW_ / 2
    zt = ZB + HR
    to_xz = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    pan = rounded([(-0.036, 0.0), (0.036, 0.0), (0.036, 0.462), (-0.036, 0.462)], 0.014, seg=5)
    prism('панель секции', pan, 0.005, m, Matrix.Translation(Vector((xc, -BD / 2 + 0.0025, ZB + 0.020))) @ to_xz, bevel=0.0012)
    box('тело секции', (0.030, BD - 0.020, FA - 0.02), m, (xc, 0.004, (ZC0 + ZC1) / 2))
    for dx in (-0.024, 0.024):
        box('ребро', (0.0025, BD - 0.012, FA - 0.06), m, (xc + dx, 0.006, (ZC0 + ZC1) / 2))
    box('стенка', (0.004, BD - 0.010, 0.070), m, (xc, 0.0, zt - 0.040))
    for k in range(3):
        for sgx in (-1, 1):
            ob = box('ребро верх', (0.030, 0.024, 0.0024), m, (xc + sgx * 0.018, -0.022, zt - 0.068 + k * 0.020))
            ob.rotation_euler = (math.radians(32), 0, 0)
    hood = [(-BD / 2 - 0.002, -0.020), (-BD / 2 - 0.004, -0.008), (-BD / 2 + 0.004, 0.0), (BD / 2 - 0.006, 0.0),
            (BD / 2 - 0.002, -0.006), (BD / 2 - 0.004, -0.009), (BD / 2 - 0.008, -0.004), (-BD / 2 + 0.006, -0.004),
            (-BD / 2 + 0.000, -0.009), (-BD / 2 + 0.001, -0.020)]
    to_yz = Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    prism('козырёк', hood, SW_ - 0.003, m, Matrix.Translation(Vector((xc, 0.0, zt))) @ to_yz, bevel=0.0008)
    for zc in (ZC0, ZC1):
        lathe('коллектор', [(RC, 0), (RC, SW_ - 0.004)], m, (x0 + 0.002, 0.0, zc), 'X', segs=40)


def room(x_conn):
    part('')
    g = mat('radwhite', rough=0.6, alpha=0.18)
    x0, x1 = -LR / 2 - 0.30, LR / 2 + 0.10
    for name, size, loc in (('стена', (x1 - x0, 0.004, 0.80), ((x0 + x1) / 2, YW + 0.002, 0.33)),
                            ('пол', (x1 - x0, 0.40, 0.004), ((x0 + x1) / 2, YW - 0.20, -0.002))):
        ob = box(name, size, g, loc)
        ob.modifiers.clear()
        for c in list(ob.users_collection):
            c.objects.unlink(ob)
        coll('sheath').objects.link(ob)


def build():
    sc = reset()
    sg = -1                                   # подключение на левом торце (к камере)
    x_end = sg * LR / 2
    room(x_end)
    part('rad')
    for k in range(NSEC):
        section(-LR / 2 + k * SW_)
    marks['rad'] = (0.0, -BD / 2, ZB + HR * 0.55)
    # дальний торец: кран Маевского сверху, заглушка снизу (набор)
    rs.kit_vent(-x_end + 0.002, ZC1, -sg, KITCOL)
    rs.kit_plug(-x_end + 0.002, ZC0, -sg, KITCOL)
    # торец подключения: переходники набора 1" -> 1/2", клапаны
    for z, sup in ((ZC1, True), (ZC0, False)):
        xe = rs.kit_reducer(x_end - 0.002, z, sg, KITCOL)
        out, ax = rs.valve(xe, z, sg, sup, ANGLED, STYLE, VCOL, HEAD)
        p0 = rs.pipe_end(out, ax, STYLE, 's' if sup else 'r')
        rs.pipe_run(p0, sup, sg, ANGLED, YW, ZC0, ANCH)
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
    # карта деталей: прибор R, евроконус/переходник G, труба B, запорный Y, термоклапан C, выход трубы M,
    # головка W, монтажный набор — оранжевый (третий уровень канала, см. WM_GCOL в app.js)
    ID = {'rad': (1, 0, 0), 'ek': (0, 1, 0), 'tube': (0, 0, 1), 'lock': (1, 1, 0), 'node': (0, 1, 1),
          'fix': (1, 0, 1), 'sleeve': (1, 0, 1), 'head': (1, 1, 1), 'kit': (1, 0.216, 0)}   # 0,216 линейный = 128 в sRGB
    id_pass(sc, list(coll('solid').objects), ID, os.path.join(OUT, TAG + '_id.png'))
    write_meta(sc, os.path.join(OUT, TAG + '.json'), zones, pts, proj)


main()
