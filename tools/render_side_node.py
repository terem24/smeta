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
import rad_bottom as rb

_argv = sys.argv[sys.argv.index('--') + 1:]
OUT, VAR = _argv[0], _argv[1]
_p = VAR.split('-')
# нижнее подключение: <семейство>-b<angled|straight>-<sht|rht>-<цвет прибора> — кадры в индексе узла
# радиатора (radnode): titan, quadro, round, rst1/rst2/rst3
BOTTOM = _p[1].startswith('b')
TAG = ('radnode_' if BOTTOM else 'side_') + VAR
FAMILY, NODE, STYLE, VCOL = _p[0], _p[1], _p[2], _p[3]
KITCOL = _p[4] if len(_p) > 4 else 'white'          # цвет набора (секционные) или цвет прибора (дизайнерские)
VERT = FAMILY in ('sebino', 'tonale', 'anteprima', 'oscar', 'quadro', 'round', 'rst1', 'rst2', 'rst3')
# ROMMER RST (паспорт: шаг секции T 41, трубки по колонкам, высоты 1500–2000; присоединение G 1/2" ВР) — на
# кадре 1750; глубина — по числу колонок (1: 41, 2: ~81, 3: ~121, оценка по рис. 1 паспорта)
ANGLED = NODE in ('angled', 'bangled')
import re as _re
_m = _re.match(r'^(titan|alpha|vega)(gr)?(350|200)?$', FAMILY)
SBASE, SHGT = (_m.group(1), _m.group(3) or '') if _m else ('', '')
HEAD = 'shtd' if STYLE == 'design' else ('rht' if STYLE == 'rht' else 'sht')
if BOTTOM:
    KITCOL = VCOL                                     # у нижнего варианта 4-е поле — цвет прибора

add_colors({'radwhite': (0.95, 0.95, 0.94), 'radgraphite': (0.29, 0.31, 0.33),
            'rgray': (0.36, 0.37, 0.38),      # «2676 серый» GLOBAL/STOUT — тёмно-серый муар
            'rnatural': (0.62, 0.63, 0.64),   # TUBE ROUND «натуральный» — сталь под лаком
            'rblack': (0.07, 0.07, 0.08)})

# Секционные (Space и аналоги): межосевое 500, 6 секций на кадре.
# Дизайнерские вертикальные (паспорт GLOBAL «дизайн-радиаторы», табл. «Размеры»; STOUT TUBE QV40/R40):
#   SEBINO 1800 — высота 1834, межосевое 1800, глубина 60, шаг секции 85 (4 секции — 340 мм);
#   TONALE / ANTEPRIMA 1800 — высота 1834, межосевое 1800, глубина 95, шаг 50;
#   OSCAR 1800 (STOUT, паспорта нет) — принято как SEBINO: шаг 80, глубина 70 (оценка по фото);
#   TUBE QUADRO QV40 1750 — квадратная труба 40x40, шаг 60, межосевое 1750, глубина 40;
#   TUBE ROUND R40 1-1750 — круглые трубки, шаг 50, межосевое 1750, однорядный, глубина 40.
VGEOM = {'sebino': (4, 0.085, 0.060, 1.834, 1.800), 'tonale': (6, 0.050, 0.095, 1.834, 1.800),
         'anteprima': (6, 0.050, 0.095, 1.834, 1.800), 'oscar': (4, 0.080, 0.070, 1.834, 1.800),
         'quadro': (4, 0.060, 0.080, 1.790, 1.750), 'round': (6, 0.050, 0.070, 1.790, 1.750),
         'rst1': (8, 0.041, 0.041, 1.750, 1.700), 'rst2': (8, 0.041, 0.081, 1.750, 1.700), 'rst3': (8, 0.041, 0.121, 1.750, 1.700)}
if VERT:
    NSEC, SW_, BD, HR, FA = VGEOM[FAMILY]
elif SBASE:
    # TITAN, ALPHA, VEGA — каталог STOUT «Отопительные приборы» (окт. 2025), таблицы «Размеры» с. 68, 76, 80:
    #   TITAN — секция 82, глубина 100, высота 570/420/270 при межосевом 500/350/200;
    #   ALPHA — секция 84, глубина 80, высота 572/422 при 500/350;
    #   VEGA  — секция 84, глубина 80, высота 576 при 500 (350/200 — с той же надставкой, оценка).
    _n, _sw, _bd, _dh = {'titan': (5, 0.082, 0.100, 0.070), 'alpha': (6, 0.084, 0.080, 0.072), 'vega': (6, 0.084, 0.080, 0.076)}[SBASE]
    _fa = {'350': 0.350, '200': 0.200}.get(SHGT, 0.500)
    NSEC, SW_, BD, HR, FA = _n, _sw, _bd, _fa + _dh, _fa
elif FAMILY in ('sect350', 'sect200'):
    # секционные высотой 350 и 200 (Space 350, TITAN 350/200, VEGA 350/200, ALPHA 350, алюминиевые 350):
    # межосевое 350/200, высота ~411/~261 (как у 500: +61 мм)
    _fa = 0.350 if FAMILY == 'sect350' else 0.200
    NSEC, SW_, BD, HR, FA = 6, 0.080, 0.090, _fa + 0.061, _fa
else:
    NSEC, SW_, BD, HR, FA = 6, 0.080, 0.090, 0.561, 0.500
ZB = 0.120
ZC0 = ZB + (HR - FA) / 2
ZC1 = ZC0 + FA
# у трубчатых QUADRO/ROUND коллектор сзади (каталог STOUT «Отопительные приборы», окт. 2025, с. 43, 47):
# ось коллектора и патрубков — y = 0, трубы впереди него; стена — за коллектором
YW = (0.020 if FAMILY in ('quadro', 'round') else BD / 2) + 0.035
RC = 0.019
LR = NSEC * SW_
ANCH = {}


def body_mat():
    if FAMILY == 'titangr':
        return mat('radgraphite', rough=0.45, coat=0.2)
    if VERT:
        return mat({'white': 'radwhite', 'black': 'rblack', 'gray': 'rgray', 'natural': 'rnatural'}.get(KITCOL, 'radwhite'),
                   rough=0.40 if KITCOL != 'natural' else 0.30, coat=0.3, metal=0.4 if KITCOL == 'natural' else 0.0)
    return mat('radgraphite' if FAMILY == 'sectgr' else 'radwhite', rough=0.45, coat=0.2)


def vsection(x0):
    """Вертикальная секция дизайнерского прибора — по каталогу STOUT «Отопительные приборы» (окт. 2025,
    крупные виды с. 13, 19, 25, 29, 43, 47):
      TONALE    — спереди узкая прямоугольная планка, за ней скруглённая колонна; сверху чёрная сетка-соты;
      ANTEPRIMA — вертикальная овальная труба (вытянута в глубину), сверху овальная сетка-соты;
      SEBINO    — плоская лицевая планка во всю ширину секции, сверху решётка с косыми прорезями;
      OSCAR     — плоская планка со скруглёнными вертикальными кромками, верх ступенькой (выемка);
      QUADRO    — квадратная труба 40x40 с плоской заглушкой сверху, коллектор сзади, между трубами зазор;
      ROUND     — круглая труба со скруглённым верхом, коллектор сзади;
      RST       — трубки по колонкам, коллекторы сверху и снизу (паспорт ROMMER).
    Коллекторы ведут патрубки G 1/2" (ось y = 0)."""
    m = body_mat()
    dark = mat('rblack' if KITCOL != 'black' else 'rgray', rough=0.6)
    xc = x0 + SW_ / 2
    zc = ZB + HR / 2
    zt = ZB + HR
    if FAMILY.startswith('rst'):
        cols = int(FAMILY[3])
        for c in range(cols):
            lathe('трубка RST', [(0.0125, 0), (0.0125, HR - 0.012), (0.0090, HR - 0.004), (0.0, HR)], m,
                  (xc, -BD / 2 + 0.0205 + c * 0.040, ZB), 'Z', segs=28)
        for zz in (ZC0, ZC1):
            box('коллектор RST', (SW_, BD, 0.050), m, (xc, 0.0, zz))
        return
    if FAMILY == 'quadro':
        yt = -0.040
        box('труба 40x40', (0.040, 0.040, HR - 0.004), m, (xc, yt, zc - 0.002))
        box('заглушка', (0.038, 0.038, 0.004), m, (xc, yt, zt - 0.002))
        for zz in (ZC0, ZC1):
            box('коллектор', (SW_, 0.034, 0.034), m, (xc, 0.0, zz))
            box('перемычка', (0.020, 0.014, 0.024), m, (xc, -0.022, zz))
        return
    if FAMILY == 'round':
        yt = -0.035
        lathe('труба', [(0.0150, 0), (0.0150, HR - 0.015), (0.0120, HR - 0.006), (0.0060, HR - 0.001), (0.0, HR)], m,
              (xc, yt, ZB), 'Z', segs=40, sharp=40)
        for zz in (ZC0, ZC1):
            lathe('коллектор', [(0.0150, 0), (0.0150, SW_)], m, (x0, 0.0, zz), 'X', segs=32)
            box('перемычка', (0.014, 0.020, 0.018), m, (xc, -0.018, zz))
        return
    for zz in (ZC0, ZC1):
        lathe('коллектор', [(0.017, 0), (0.017, SW_ - 0.002)], m, (x0 + 0.001, 0.0, zz), 'X', segs=32)
    if FAMILY == 'tonale':
        box('планка', (0.020, 0.024, HR), m, (xc, -BD / 2 + 0.012, zc))
        col = rounded([(-0.019, -0.030), (0.019, -0.030), (0.019, 0.030), (-0.019, 0.030)], 0.018, seg=6)
        prism('колонна', [(x + xc, y + BD / 2 - 0.034) for x, y in col], HR - 0.006, m, Matrix.Translation(Vector((0, 0, zc - 0.003))),
              bevel=0.002)
        box('соты', (SW_ - 0.006, BD - 0.030, 0.003), dark, (xc, 0.004, zt - 0.010))
        return
    if FAMILY == 'anteprima':
        ob = lathe('овальная труба', [(0.0205, 0), (0.0205, HR - 0.006), (0.0185, HR)], m, (xc, 0.0, ZB), 'Z', segs=48)
        ob.scale = (1.0, (BD / 2) / 0.0205, 1.0)
        ov = lathe('сетка', [(0.0175, 0), (0.0175, 0.002)], dark, (xc, 0.0, zt - 0.004), 'Z', segs=40)
        ov.scale = (1.0, (BD / 2 - 0.004) / 0.0175, 1.0)
        return
    # SEBINO и OSCAR: плоская лицевая планка и тело секции
    w = SW_ - 0.003
    if FAMILY == 'oscar':
        plan = rounded([(-w / 2, -BD / 2), (w / 2, -BD / 2), (w / 2, -BD / 2 + 0.014), (-w / 2, -BD / 2 + 0.014)], 0.006, seg=4)
        prism('лицевая планка', [(x + xc, y) for x, y in plan], HR, m, Matrix.Translation(Vector((0, 0, zc))), bevel=0.0015)
        box('тело', (0.026, BD - 0.016, HR - 0.040), m, (xc, 0.008, zc - 0.012))
        box('верх ступенькой', (w, BD - 0.040, 0.020), m, (xc, 0.016, zt - 0.040))
    else:
        box('лицевая планка', (w, 0.010, HR), m, (xc, -BD / 2 + 0.005, zc))
        box('тело', (0.024, BD - 0.012, HR - 0.006), m, (xc, 0.006, zc))
        box('решётка', (w, BD - 0.012, 0.003), mat('radwhite', rough=0.45), (xc, 0.006, zt - 0.002))
        for k in range(7):
            ob = box('прорезь', (0.004, BD - 0.022, 0.001), dark, (xc - w / 2 + 0.008 + k * (w - 0.016) / 6, 0.006, zt - 0.0002))
            ob.rotation_euler = (0, 0, math.radians(25))


def section(x0):
    if SBASE in ('alpha', 'vega'):
        return section_av(x0)
    return section_space(x0)


def section_av(x0):
    """Секция ALPHA / VEGA (каталог, крупные фото с. 77 и 81): лицевая панель плоская со скруглёнными
    углами, сверху и снизу — скруглённый «нос» на всю ширину секции, обнимающий коллектор спереди (у VEGA
    радиус больше и кромка отогнута волной), под носом — косые рёбра; между секциями — тёмный зазор."""
    m = body_mat()
    xc = x0 + SW_ / 2
    zt = ZB + HR
    vega = SBASE == 'vega'
    to_xz = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    to_yz = Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    w = SW_ - 0.008
    rn = 0.034 if vega else 0.028           # радиус носа
    hp = HR - 2 * rn - 0.070               # под носом — открытая зона косых рёбер (фото с. 77, 81)
    pan = rounded([(-w / 2, 0.0), (w / 2, 0.0), (w / 2, hp), (-w / 2, hp)], 0.010 if vega else 0.006, seg=5)
    prism('панель секции', pan, 0.004, m, Matrix.Translation(Vector((xc, -BD / 2 + 0.002, ZB + rn + 0.035))) @ to_xz,
          bevel=0.0018 if vega else 0.0010)
    box('тело секции', (0.030, BD - 0.020, FA - 0.02), m, (xc, 0.004, (ZC0 + ZC1) / 2))
    for dx in (-0.026, 0.026):
        box('ребро', (0.0025, BD - 0.012, FA - 0.06), m, (xc + dx, 0.006, (ZC0 + ZC1) / 2))
    for top in (True, False):
        zc = ZC1 if top else ZC0
        sz = 1 if top else -1
        # профиль носа в плоскости YZ: четверть-дуга от лица вверх (вниз) и полка назад к стене; толщина 3 мм
        cy, cz = -BD / 2 + rn, zc + sz * (0.0)
        outer = [(cy - rn * math.cos(t), cz + sz * rn * math.sin(t)) for t in [k * math.pi / 2 / 10 for k in range(11)]]
        outer = [(cy - rn, cz - sz * 0.010)] + outer + [(BD / 2 - 0.004, cz + sz * rn)]
        inner = [(BD / 2 - 0.004, cz + sz * (rn - 0.003))] + \
                [(cy - (rn - 0.003) * math.cos(t), cz + sz * (rn - 0.003) * math.sin(t)) for t in [k * math.pi / 2 / 10 for k in range(10, -1, -1)]] + \
                [(cy - rn + 0.003, cz - sz * 0.010)]
        prof = outer + inner
        if vega:            # отогнутая волной кромка носа к панели
            prof = [(cy - rn - 0.003, cz - sz * 0.016)] + prof + [(cy - rn - 0.000, cz - sz * 0.016)]
        if not top:
            prof = list(reversed(prof))
        prism('нос', prof, SW_ - 0.003, m, Matrix.Translation(Vector((xc, 0.0, 0.0))) @ to_yz, bevel=0.0006)
        for k in range(2):
            for sgx in (-1, 1):
                ob = box('ребро под носом', (0.030, 0.022, 0.0024), m, (xc + sgx * 0.019, -0.016, zc - sz * (0.030 + k * 0.018)))
                ob.rotation_euler = (math.radians(sz * 32), 0, 0)
    for zc in (ZC0, ZC1):
        lathe('коллектор', [(RC, 0), (RC, SW_ - 0.004)], m, (x0 + 0.002, 0.0, zc), 'X', segs=40)


def section_space(x0):
    """Секция Space (фото листовки STOUT, крупно): лицевая панель плоская со скруглениями сверху,
    сверху козырёк на всю ширину с загнутой передней кромкой, под ним 3 ряда изогнутых рёбер; сзади тело
    с рёбрами; коллекторы 1" сверху и снизу."""
    m = body_mat()
    xc = x0 + SW_ / 2
    zt = ZB + HR
    to_xz = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    if SBASE == 'titan':     # TITAN (каталог, фото с. 69): плоская панель почти во всю высоту, углы скруглены мягче
        hw = SW_ / 2 - 0.004
        pan = rounded([(-hw, 0.0), (hw, 0.0), (hw, HR - 0.070), (-hw, HR - 0.070)], 0.009, seg=5)
    else:
        pan = rounded([(-0.036, 0.0), (0.036, 0.0), (0.036, HR - 0.099), (-0.036, HR - 0.099)], 0.014, seg=5)
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
    hw = max(0.80, ZB + HR + 0.20)
    for name, size, loc in (('стена', (x1 - x0, 0.004, hw), ((x0 + x1) / 2, YW + 0.002, hw / 2 - 0.07)),
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
        (vsection if VERT else section)(-LR / 2 + k * SW_)
    marks['rad'] = (0.0, -BD / 2, ZB + HR * 0.55)
    if VERT:
        # дизайнерские: патрубки G 1/2" ВР; пробка и кран Маевского — в комплекте прибора, в цвет арматуры
        pc = 'white' if KITCOL == 'white' else ('black' if KITCOL == 'black' else 'chrome')
        part('rad')
        rs.kit_vent(-x_end + 0.002, ZC1, -sg, pc)
        rs.kit_plug(-x_end + 0.002, ZC0, -sg, pc)
        for o in list(coll('solid').objects):
            if o.get('part') == 'kit':
                o['part'] = 'rad'
        marks.pop('kit', None)          # пробка и кран Маевского — часть прибора, своей сноски нет
    else:
        # дальний торец: кран Маевского сверху, заглушка снизу (набор)
        rs.kit_vent(-x_end + 0.002, ZC1, -sg, KITCOL)
        rs.kit_plug(-x_end + 0.002, ZC0, -sg, KITCOL)
    # торец подключения: переходники набора 1" -> 1/2" (у дизайнерских — сразу в патрубок), клапаны
    for z, sup in ((ZC1, True), (ZC0, False)):
        xe = (x_end - sg * 0.002) if VERT else rs.kit_reducer(x_end - 0.002, z, sg, KITCOL)
        out, ax = rs.valve(xe, z, sg, sup, ANGLED, STYLE, VCOL, HEAD)
        p0 = rs.pipe_end(out, ax, STYLE, 's' if sup else 'r')
        rs.pipe_run(p0, sup, sg, ANGLED, YW, ZC0, ANCH)
    return sc


def build_bottom():
    """Нижнее подключение (узел SVH под правым торцом, как у Space): встроенный термоклапан в верхнем
    правом патрубке — термоголовка горизонтально; у дальнего торца кран Маевского сверху и заглушка снизу.
    TITAN — редукционные ниппели G 3/4" НР в приборе (как Space); трубчатые TUBE QUADRO/ROUND и RST — у
    прибора нижние патрубки G 1/2" ВР (паспорта), поэтому под узел — ниппель 1/2" x 3/4" (как у Ventil)."""
    sc = reset()
    sg = 1
    x_end = LR / 2
    room(x_end)
    part('rad')
    for k in range(NSEC):
        (vsection if VERT else section)(-LR / 2 + k * SW_)
    marks['rad'] = (0.0, -BD / 2, ZB + HR * 0.55)
    pc = 'black' if KITCOL == 'black' else ('chrome' if KITCOL in ('natural', 'gray') else 'white')
    rs.kit_vent(-x_end - 0.002, ZC1, -sg, pc)
    rs.kit_plug(-x_end - 0.002, ZC0, -sg, pc)
    rs.kit_plug(x_end + 0.002, ZC0, sg, pc)
    for o in list(coll('solid').objects):
        if o.get('part') == 'kit':
            o['part'] = 'rad'
    marks.pop('kit', None)
    lathe('вставка клапана', [(0.0120, 0), (0.0120, 0.010)], M_NICKEL(), (x_end + 0.002, 0, ZC1), 'X', segs=40)
    (rb.rht_head if HEAD == 'rht' else rb.sht_head)((x_end + 0.012, 0, ZC1), 'X')
    part('node')
    x_sup = x_end - 0.020
    x_ret = x_sup - 0.050
    if SBASE == 'titan':
        m = body_mat()
        box('прилив подключения', (0.084, 0.034, 0.016), m, ((x_sup + x_ret) / 2, 0.0, ZB + 0.004))
        zt = ZB - 0.002
        for x in (x_sup, x_ret):
            lathe('ниппель прибора', thread(0.0128, 0.012), M_NICKEL(), (x, 0, zt), '-Z', segs=40)
        zn = zt - 0.012
    else:
        zn = min(rb.nipple_sft0049(x, ZB) for x in (x_sup, x_ret))
    outs = rb.svh([x_sup, x_ret], zn, ANGLED)
    for (loc, ax), sup in zip(outs, (True, False)):
        if ANGLED:
            part('ek:' + ('s' if sup else 'r'))
            p0 = rb.ek(loc, ax)
            rb.wall_run(loc[0], p0, sup, YW, ANCH)
        else:
            rb.gtube_kit(loc[0], loc[2], sup, ANCH)
    if not ANGLED:
        rb.floor_bracket([x_sup, x_ret], ANCH)
    return sc


def main():
    sc = build_bottom() if BOTTOM else build()
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
