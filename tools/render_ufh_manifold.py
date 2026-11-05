# -*- coding: utf-8 -*-
"""
Кадр узла коллектора тёплого пола для сметы (раздел 4.1): STOUT SMS-0907 «полностью
укомплектован» на N выходов, евроконусы, трубы петель с защитными втулками, переходы на
транзитную трубу. Запуск из Blender:

    blender --background --python tools/render_ufh_manifold.py -- <папка> <N>

Общие детали, материалы, камера и линии — из blender_parts.py (тот же стиль,
масштаб и ракурс). Размеры — паспорт STOUT SMS (табл. 5.9): шаг выходов l = 50 мм, между
осями гребёнок H1 = 211 мм, воздухоотводчик H2 = 90 мм над осью, длина гребёнки
L1 = 50·(N−1) + 93 мм, кран с термометром L2 = 119 мм. Устройство — паспорт, п. 3.1 и фото
комплекта: снизу подающая гребёнка с расходомерами (красная метка), сверху обратная с
клапанами под сервопривод (белые колпачки, синяя метка), слева краны с американкой и
термометрами, справа концевые группы — воздухоотводчик и спускной кран, кронштейны.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blender_parts import *  # noqa: F401,F403 — общие детали, материалы, камера, проходы
from mathutils import Vector, Matrix
import bpy

_argv = sys.argv[sys.argv.index('--') + 1:]
OUT, N = _argv[0], int(_argv[1])
# вариант без перехода на транзит: у гребёнки с узлом подмеса его нет в смете (узел садится
# на гребёнку своими гайками) — третий аргумент «bare»
BARE = len(_argv) > 2 and _argv[2] == 'bare'
TAG = 'ufh_%d%s' % (N, '_bare' if BARE else '')

add_colors({
    'capwhite': (0.94, 0.94, 0.92),     # колпачок клапана обратки (фото паспорта, поз. 5)
    'meterred': (0.86, 0.10, 0.12),     # корпус расходомера (фото SSP-0001-000001)
    'glass': (0.92, 0.95, 0.97),
    'label_b': (0.14, 0.40, 0.85),
    'label_r': (0.88, 0.14, 0.14),
    'sleeve_r': (0.90, 0.20, 0.18),     # втулка защитная красная (подача)
    'sleeve_b': (0.16, 0.45, 0.90),     # втулка защитная синяя (обратка)
})

P = 0.050           # шаг выходов (паспорт, l)
ANCH = {}           # деталь -> точка мира, вокруг которой берётся её зона (вместо рамки)
RB = 0.017          # полувысота гребёнки: профиль SMS — квадрат ~34 мм со скруглёнными углами (разрезы паспорта, п. 3.1)
H1 = 0.211          # между осями гребёнок
YU = 0.035          # обратная гребёнка ближе к стене: её трубы идут вниз за подающей, расходомеры видны
ZF = -0.34          # уровень, до которого показаны трубы петель


def bar(name, z, y, x0, x1, label):
    """Гребёнка (паспорт, поз. 4 и 6; разрезы п. 3.1): профиль из нержавейки — квадрат со
    скруглёнными углами и круглым каналом внутри, на лицевой грани цветная наклейка со стрелкой
    (синяя — обратка, красная — подача) и надпись STOUT."""
    steel = metal('stainless_bar')
    sq = rounded([(-RB, -RB), (RB, -RB), (RB, RB), (-RB, RB)], 0.0075, seg=5)
    # локальные X -> мировая Y, Y -> Z, Z (длина) -> X
    m = Matrix.Translation(Vector(((x0 + x1) / 2, y, z))) @ Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    prism(name, sq, x1 - x0, steel, m, bevel=0.0012)
    box('наклейка', (0.024, 0.0010, 0.016), mat(label, rough=0.4), (x0 + 0.044, y - RB - 0.0002, z))
    box('стрелка', (0.006, 0.0012, 0.010), mat('white', rough=0.4), (x0 + 0.044, y - RB - 0.0006, z))
    try:
        cu = bpy.data.curves.new('STOUT', 'FONT')
        cu.body = 'STOUT'
        cu.size = 0.0095
        cu.extrude = 0.0003
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        ob = bpy.data.objects.new('надпись STOUT', cu)
        ob.data.materials.append(mat('black', rough=0.5))
        ob.matrix_world = Matrix.Translation(Vector((x1 - 0.052, y - RB - 0.0006, z))) @ Matrix.Rotation(math.pi / 2, 4, 'X')
        link(ob)
    except Exception:
        pass


def outlet_down(x, y, z, used):
    """Выход вниз: латунный ниппель под евроконус (паспорт, поз. 5), евроконус и труба петли.
    Труба обратки (верхняя гребёнка, ближе к стене) идёт вниз за подающей гребёнкой, ниже неё
    отводится вбок и встаёт парой рядом с трубой подачи; у пола обе поворачивают к зрителю в
    пластиковом фиксаторе 90° (раздел 4.1: «Фиксатор 90°»), над поворотом — защитная втулка
    своего цвета (красная — подача, синяя — обратка)."""
    part('mf')
    hexnut('ниппель выхода', 0.024, 0.006, M_BRASS(), (x, y, z - RB + 0.002), '-Z')
    lathe('резьба выхода', thread(0.0125, 0.008), M_BRASS(), (x, y, z - RB - 0.004), '-Z', segs=40)
    if not used:
        return
    ret = y > 0.01
    sfx = '%d%s' % (int(round(x / P)), 'u' if ret else 'd')
    part('ek:' + sfx)
    ln = ek_fit((x, y, z - RB - 0.012), '-Z')
    zt = z - RB - 0.012 - ln
    xx = x + (0.022 if ret else 0.0)
    pts = [(x, y, zt + 0.004)]
    if ret:
        # S-образный отвод вбок и к плоскости подающих труб ниже подающей гребёнки
        za, zb_ = -0.085, -0.150
        pts.append((x, y, za))
        for k in range(1, 13):
            t = k / 12
            c = (1 - math.cos(math.pi * t)) / 2
            pts.append((x + (xx - x) * c, y * (1 - c), za + (zb_ - za) * t))
    R_ = 0.036
    zc = ZF + R_
    pts.append((xx, 0.0, zc))
    arc = [(xx, -R_ + R_ * math.cos(t), zc - R_ * math.sin(t)) for t in [k * math.pi / 2 / 14 for k in range(1, 15)]]
    pts += arc
    pts.append((xx, -R_ - 0.085, ZF))
    # прямой вертикальный участок — отдельной деталью: по его рамке ставится точка выноски
    # (рамка всей трубы с отводом и поворотом указывала мимо трубы); остальное — та же труба
    # для подсветки («tubeb» красится в карте деталей как труба)
    nv = 2
    part('tube:' + sfx)
    tube('труба петли', pts[:nv], 0.008, M_PLAST('pex'))
    part('tubeb:' + sfx)
    tube('труба петли, отвод', pts[nv - 1:], 0.008, M_PLAST('pex'))
    part('fix:' + sfx)
    farc = [(xx, -R_ + R_ * math.cos(t), zc - R_ * math.sin(t)) for t in [k * math.pi / 2 / 14 for k in range(-2, 17)]]
    tube('фиксатор 90', farc, 0.0102, mat('black', rough=0.55))
    # точка выноски — середина дуги: рамка поворота велика, её углы пустые
    ANCH['fix:' + sfx] = (xx, -R_ + R_ * math.cos(math.pi / 4), zc - R_ * math.sin(math.pi / 4))
    for t in (0.0, math.pi / 2):
        lathe('обойма фиксатора', [(0.0108, 0), (0.0108, 0.006)], mat('black', rough=0.55),
              (xx, -R_ + R_ * math.cos(t), zc - R_ * math.sin(t) + (0.003 if t == 0 else 0)),
              'Z' if t == 0 else 'Y', segs=24)
    part('sleeve:' + sfx)
    col = 'sleeve_b' if ret else 'sleeve_r'
    lathe('втулка', [(0.0098, 0), (0.0108, 0.002), (0.0108, 0.058), (0.0098, 0.060)], mat(col, rough=0.45),
          (xx, 0.0, zc + 0.006), 'Z', segs=32)


def thermo_valve_cap(x, y, z):
    """Клапан под сервопривод на обратке (паспорт, поз. 10 и 8): латунная вставка с
    шестигранником и белый рифлёный колпачок ручной регулировки."""
    hexnut('вставка клапана', 0.024, 0.008, M_BRASS(), (x, y, z + RB - 0.002), 'Z')
    lathe('колпачок', [(0.0, 0), (0.0150, 0), (0.0155, 0.004), (0.0155, 0.018), (0.0140, 0.022), (0.0, 0.023)],
          mat('capwhite', rough=0.45), (x, y, z + RB + 0.006), 'Z', segs=48, knurl=0.0150, sharp=50)


def flow_meter(x, y, z):
    """Расходомер на подаче (паспорт, поз. 12; фото SSP-0001-000001): латунная вставка,
    красный рифлёный корпус настройки и прозрачная колба со шкалой, сверху красная пробка."""
    hexnut('вставка расходомера', 0.024, 0.006, M_BRASS(), (x, y, z + RB - 0.002), 'Z')
    lathe('корпус расходомера', [(0.0, 0), (0.0155, 0), (0.0160, 0.003), (0.0160, 0.016), (0.0110, 0.020), (0.0, 0.020)],
          mat('meterred', rough=0.35, coat=0.5), (x, y, z + RB + 0.004), 'Z', segs=40, knurl=0.0150, sharp=50)
    lathe('колба', [(0.0072, 0), (0.0072, 0.046), (0.0, 0.047)], mat('glass', rough=0.08, alpha=0.45),
          (x, y, z + RB + 0.024), 'Z', segs=32)
    lathe('поплавок', [(0.0, 0), (0.0040, 0), (0.0040, 0.008), (0.0, 0.008)], mat('meterred', rough=0.4),
          (x, y, z + RB + 0.040), 'Z', segs=16)
    lathe('пробка колбы', [(0.0, 0), (0.0080, 0), (0.0080, 0.006), (0.0, 0.007)], mat('meterred', rough=0.4),
          (x, y, z + RB + 0.070), 'Z', segs=24)


def valve_left(x0, y, z, col, key):
    """Слева на гребёнке (паспорт, поз. 1 и 2): термометр на тройнике лицом к зрителю, кран с
    американкой и бабочкой сверху; дальше — переход на транзитную трубу (раздел 4.1)."""
    part('mf')
    lathe('тройник термометра', [(0.0150, 0), (0.0165, 0.002), (0.0165, 0.026), (0.0150, 0.028)], M_NICKEL(),
          (x0, y, z), '-X', segs=48, sharp=40)
    lathe('стакан термометра', [(0.0090, 0), (0.0090, 0.010)], M_NICKEL(), (x0 - 0.014, y - 0.012, z), '-Y', segs=32)
    lathe('термометр', [(0.0, 0), (0.0200, 0), (0.0205, 0.002), (0.0205, 0.010), (0.0190, 0.012), (0.0, 0.012)],
          M_NICKEL(), (x0 - 0.014, y - 0.022, z), '-Y', segs=48)
    lathe('шкала', [(0.0, 0), (0.0175, 0), (0.0, 0.0006)], mat('white', rough=0.5), (x0 - 0.014, y - 0.0342, z), '-Y', segs=48)
    sector('шкала дуга', 0.0130, 0.0160, 0.0004, -40, 220, mat('black', rough=0.5), (x0 - 0.014, y - 0.0346, z), '-Y')
    x = x0 - 0.028
    hexnut('гайка американки', 0.040, 0.014, M_NICKEL(), (x, y, z), '-X')
    x -= 0.014
    lathe('корпус крана', [(0.0160, 0), (0.0182, 0.002), (0.0190, 0.008), (0.0190, 0.022), (0.0182, 0.028),
                           (0.0172, 0.030)], M_NICKEL(), (x, y, z), '-X', sharp=40)
    xc = x - 0.015
    x -= 0.030
    hexnut('кран ВР', 0.040, 0.016, M_NICKEL(), (x, y, z), '-X')
    x -= 0.016
    Rm = Matrix(((0, 0, -1, 0), (1, 0, 0, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
    T = Matrix.Translation(Vector((xc, y, z))) @ Rm
    pre = set(bpy.context.scene.objects)
    lathe('бобышка штока', [(0.0104, 0), (0.0104, 0.0040), (0.0098, 0.0045)], M_NICKEL(), (0, -0.0115, 0), '-Y')
    butterfly(0, 0, col)
    bpy.context.view_layer.update()
    for o in set(bpy.context.scene.objects) - pre:
        o.matrix_world = T @ o.matrix_world
    marks['mf_valve_%s' % key] = (xc, y, z + 0.03)
    # переход на транзитную трубу: латунный переходник и отрезок трубы влево
    if BARE:
        return x
    part('node:' + key)
    hexnut('переходник', 0.036, 0.012, M_BRASS(), (x, y, z), '-X')
    lathe('гильза перехода', [(0.0130, 0), (0.0130, 0.020), (0.0118, 0.022)], M_BRASS(), (x - 0.012, y, z), '-X')
    tube('транзит', [(x - 0.030, y, z), (x - 0.080, y, z)], 0.0125, M_PLAST('pex'))
    marks['node_%s' % key] = (x - 0.006, y, z + 0.02)
    return x - 0.080


def build():
    sc = reset()
    xs = [i * P for i in range(N)]
    x0, x1 = -0.0465, xs[-1] + 0.0465
    part('mf')
    bar('подающая гребёнка', 0.0, 0.0, x0, x1, 'label_r')
    bar('обратная гребёнка', H1, YU, x0, x1, 'label_b')
    for x in xs:
        part('mf')
        flow_meter(x, 0.0, 0.0)
        part('mf')
        thermo_valve_cap(x, YU, H1)
        outlet_down(x, 0.0, 0.0, True)
        outlet_down(x, YU, H1, True)
    part('mf')
    bracket(x0 + 0.016, RB, H1, YU)
    part('mf')
    bracket(x1 - 0.016, RB, H1, YU)
    valve_left(x0, 0.0, 0.0, 'flagred', 'sup')
    valve_left(x0, YU, H1, 'flagblue', 'ret')
    part('mf')
    end_group(x1, 0.0, 0.0, 'sup')
    part('mf')
    end_group(x1, YU, H1, 'ret')
    marks['mf'] = ((x0 + x1) / 2, YU, H1 + RB)
    marks['tube'] = (xs[0], YU, ZF + 0.12)
    marks['sleeve'] = (xs[0], 0.0, ZF + 0.07)
    return sc


def main():
    sc = build()
    cam = camera(sc)
    zones, pts, proj = frame_meta(sc, cam, ANCH)
    sc.render.film_transparent = True
    freestyle(sc, 'solid', LINE_COLOR, 1.8)
    render(sc, os.path.join(OUT, TAG + '_solid.png'))
    # карта деталей: плоские цвета по сноскам, без сглаживания и линий
    ID = {'mf': (1, 0, 0), 'ek': (0, 1, 0), 'tube': (0, 0, 1), 'sleeve': (1, 1, 0), 'node': (0, 1, 1), 'fix': (1, 0, 1), 'tubeb': (0, 0, 1)}
    id_pass(sc, list(coll('solid').objects), ID, os.path.join(OUT, TAG + '_id.png'))
    write_meta(sc, os.path.join(OUT, TAG + '.json'), zones, pts, proj)


main()
