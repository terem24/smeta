# -*- coding: utf-8 -*-
"""
Кадр узла коллектора тёплого пола для сметы (раздел 4.1): STOUT SMS-0907 «полностью
укомплектован» на N выходов, евроконусы, трубы петель с защитными втулками, переходы на
транзитную трубу. Запуск из Blender:

    blender --background --python tools/render_ufh_manifold.py -- <папка> <N>

Общие детали, материалы, камера и линии — из render_water_manifold.py (тот же стиль,
масштаб и ракурс). Размеры — паспорт STOUT SMS (табл. 5.9): шаг выходов l = 50 мм, между
осями гребёнок H1 = 211 мм, воздухоотводчик H2 = 90 мм над осью, длина гребёнки
L1 = 50·(N−1) + 93 мм, кран с термометром L2 = 119 мм. Устройство — паспорт, п. 3.1 и фото
комплекта: снизу подающая гребёнка с расходомерами (красная метка), сверху обратная с
клапанами под сервопривод (белые колпачки, синяя метка), слева краны с американкой и
термометрами, справа концевые группы — воздухоотводчик и спускной кран, кронштейны.
"""
import io
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_src = io.open(os.path.join(HERE, 'render_water_manifold.py'), encoding='utf-8').read()
# argv водоснабжения: <папка> <линия> <N> <торец> <тип> — линию и торец подставляем свои
_argv = sys.argv[sys.argv.index('--') + 1:]
sys.argv = sys.argv[:sys.argv.index('--') + 1] + [_argv[0], 'hw', _argv[1], 'ufh', 'st']
exec(_src[:_src.index('# ── детали')] +
     _src[_src.index('# ── камера, линии, проходы'):_src.index('def main():')], globals())
# вариант без перехода на транзит: у гребёнки с узлом подмеса его нет в смете (узел садится
# на гребёнку своими гайками) — третий аргумент «bare»
BARE = len(_argv) > 2 and _argv[2] == 'bare'
TAG = 'ufh_%d%s' % (N, '_bare' if BARE else '')

C.update({k: tuple(_lin(x) for x in v) for k, v in {
    'capwhite': (0.94, 0.94, 0.92),     # колпачок клапана обратки (фото паспорта, поз. 5)
    'meterred': (0.86, 0.10, 0.12),     # корпус расходомера (фото SSP-0001-000001)
    'glass': (0.92, 0.95, 0.97),
    'ni_silver': (0.78, 0.79, 0.80),   # никель концевой группы (фото SMS-1000-010001)
    'label_b': (0.14, 0.40, 0.85),
    'label_r': (0.88, 0.14, 0.14),
    'sleeve_r': (0.90, 0.20, 0.18),     # втулка защитная красная (подача)
    'sleeve_b': (0.16, 0.45, 0.90),     # втулка защитная синяя (обратка)
}.items()})

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
    steel = mat('chrome', rough=0.24, metal=0.70)
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


def end_group(x1, y, z, key):
    """Концевая группа (фото STOUT SMS-1000-010001 и ROMMER RMS-1001, паспорт SMS, поз. 7, 9,
    13; высота над осью ~90 мм — H2): в торец гребёнки — штуцер 1" с чёрным уплотнительным
    кольцом и шестигранником, тело-тройник; вверх — автоматический воздухоотводчик (шейка,
    гладкий стакан ~33 мм, крышка ~43 мм с рифлёным пояском и куполом, чёрный колпачок
    клапана); вниз — спускной штуцер с резьбой; к зрителю — белая ручка сливного крана."""
    part('mf')
    # никель концевой группы — холодный серебристый с бликами (фото SMS-1000), не тёплый никель кранов
    NI = mat('ni_silver', rough=0.20, metal=0.90)
    lathe('кольцо уплотнительное', [(0.0150, 0), (0.0168, 0.0006), (0.0168, 0.0026), (0.0150, 0.0032)],
          mat('rubber', rough=0.7), (x1, y, z), 'X', segs=48)
    hexnut('шестигранник штуцера', 0.036, 0.009, NI, (x1 + 0.0032, y, z), 'X', ch=0.15)
    x = x1 + 0.0122
    lathe('шейка тройника', [(0.0110, 0), (0.0110, 0.010)], NI, (x, y, z), 'X', segs=40)
    xe = x + 0.010 + 0.010
    lathe('тело тройника', [(0.0, 0), (0.0110, 0), (0.0115, 0.002), (0.0115, 0.040), (0.0110, 0.042), (0.0, 0.042)],
          NI, (xe, y, z - 0.027), 'Z', segs=40, sharp=40)
    # воздухоотводчик
    av = NI
    lathe('шейка воздухоотводчика', [(0.0085, 0), (0.0085, 0.006)], av, (xe, y, z + 0.015), 'Z', segs=32)
    lathe('стакан воздухоотводчика', [(0.0150, 0), (0.0165, 0.0015), (0.0165, 0.028), (0.0170, 0.029)], av,
          (xe, y, z + 0.021), 'Z', segs=56, sharp=40)
    lathe('крышка воздухоотводчика', [(0.0170, 0), (0.0212, 0.0015), (0.0215, 0.003), (0.0215, 0.011), (0.0200, 0.012)],
          av, (xe, y, z + 0.050), 'Z', segs=64, knurl=0.0212, sharp=40)
    lathe('купол крышки', [(0.0200, 0), (0.0185, 0.004), (0.0140, 0.007), (0.0060, 0.0085), (0.0, 0.0088)], av,
          (xe, y, z + 0.062), 'Z', segs=48)
    lathe('колпачок клапана', [(0.0, 0), (0.0042, 0), (0.0044, 0.002), (0.0044, 0.012), (0.0030, 0.0145), (0.0, 0.015)],
          mat('black', rough=0.5), (xe, y, z + 0.0705), 'Z', segs=24, knurl=0.0043, sharp=50)
    # спускной штуцер вниз и ручка сливного крана к зрителю
    hexnut('шестигранник спуска', 0.022, 0.006, NI, (xe, y, z - 0.027), '-Z')
    lathe('резьба спуска', thread(0.0105, 0.010), NI, (xe, y, z - 0.033), '-Z', segs=40)
    lathe('ручка сливного крана', [(0.0, 0), (0.0100, 0), (0.0106, 0.002), (0.0106, 0.012), (0.0095, 0.0145),
                                   (0.0, 0.0150)], mat('capwhite', rough=0.45), (xe, y - 0.0105, z - 0.010), '-Y',
          segs=8, rot=math.pi / 8, sharp=30)
    marks['mf_end_%s' % key] = (xe, y, z + 0.07)


def bracket(xb):
    """Кронштейн (паспорт, поз. 3; фото комплекта): оцинкованная штампованная полоса за
    гребёнками — сверху ушко с отверстием под дюбель, по длине прорези, между гребёнками изгиб:
    обратная гребёнка ближе к стене, подающая на выносе. На каждой гребёнке — хомут по профилю."""
    part('mf')
    zinc = mat('zinc', rough=0.34, metal=0.60)
    dark = mat('black', rough=0.6)
    W_, T_ = 0.026, 0.0022
    yu = YU + RB + 0.003 + T_ / 2          # полоса за обратной гребёнкой
    yl = RB + 0.003 + T_ / 2               # и за подающей
    zj = 0.050                             # высота изгиба
    zt, zb = H1 + 0.060, -0.032
    box('полоса верх', (W_, T_, zt - zj), zinc, (xb, yu, (zt + zj) / 2))
    box('изгиб', (W_, yu - yl + T_, T_), zinc, (xb, (yu + yl) / 2, zj))
    box('полоса низ', (W_, T_, zj - zb), zinc, (xb, yl, (zj + zb) / 2))
    # ушко с отверстием под шуруп и прорези по длине
    lathe('ушко', [(0.0, 0), (W_ / 2, 0), (W_ / 2, T_), (0.0, T_)], zinc, (xb, yu + T_ / 2, zt), '-Y', segs=32)
    lathe('отверстие', [(0.0, 0), (0.0042, 0), (0.0042, 0.0004), (0.0, 0.0004)], dark, (xb, yu - T_ / 2 - 0.0001, zt), '-Y', segs=20)
    for zc_ in (H1 * 0.55, H1 * 0.30):
        box('прорезь', (0.0060, 0.0004, 0.022), dark, (xb, yu - T_ / 2 - 0.0002, zc_))
    # штамповка: ряд круглых отверстий по полосе (как на листах проекта и фото комплекта)
    zz = zj + 0.022
    while zz < zt - 0.030:
        if abs(zz - H1) > 0.030 and all(abs(zz - q) > 0.018 for q in (H1 * 0.55, H1 * 0.30)):
            lathe('отверстие полосы', [(0.0, 0), (0.0030, 0), (0.0030, 0.0004), (0.0, 0.0004)], dark,
                  (xb, yu - T_ / 2 - 0.0001, zz), '-Y', segs=16)
        zz += 0.024
    for zz in (zj - 0.020, zb + 0.012):
        lathe('отверстие полосы', [(0.0, 0), (0.0030, 0), (0.0030, 0.0004), (0.0, 0.0004)], dark,
              (xb, yl - T_ / 2 - 0.0001, zz), '-Y', segs=16)
    # хомуты по профилю гребёнки
    for z, y in ((0.0, 0.0), (H1, YU)):
        sq = rounded([(-RB - 0.0022, -RB - 0.0022), (RB + 0.0022, -RB - 0.0022), (RB + 0.0022, RB + 0.0022),
                      (-RB - 0.0022, RB + 0.0022)], 0.0085, seg=5)
        m = Matrix.Translation(Vector((xb, y, z))) @ Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
        prism('хомут гребёнки', sq, 0.016, zinc, m, bevel=0.0006)
        lathe('винт хомута', [(0.0, 0), (0.0032, 0), (0.0032, 0.0015), (0.0, 0.0022)], zinc, (xb, y, z + RB + 0.0022), 'Z', segs=20)
        hexnut('гайка хомута', 0.0065, 0.0028, zinc, (xb, y, z - RB - 0.0022), '-Z')


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
    bracket(x0 + 0.016)
    bracket(x1 - 0.016)
    valve_left(x0, 0.0, 0.0, 'flagred', 'sup')
    valve_left(x0, YU, H1, 'flagblue', 'ret')
    end_group(x1, 0.0, 0.0, 'sup')
    end_group(x1, YU, H1, 'ret')
    marks['mf'] = ((x0 + x1) / 2, YU, H1 + RB)
    marks['tube'] = (xs[0], YU, ZF + 0.12)
    marks['sleeve'] = (xs[0], 0.0, ZF + 0.07)
    return sc


def main():
    sc = build()
    cam = camera(sc)
    from bpy_extras.object_utils import world_to_camera_view
    dg = bpy.context.evaluated_depsgraph_get()
    zones = {}
    for o in sc.objects:
        k = o.get('part', '') if o.type in ('MESH', 'CURVE') else ''
        if not k or o.hide_render:
            continue
        for p in mesh_points(o, dg):
            v = world_to_camera_view(sc, cam, p)
            x, y = v.x, 1 - v.y
            z = zones.setdefault(k, [x, y, x, y])
            z[0], z[1], z[2], z[3] = min(z[0], x), min(z[1], y), max(z[2], x), max(z[3], y)
    for k, p in ANCH.items():
        v = world_to_camera_view(sc, cam, Vector(p))
        zones[k] = [v.x - 0.002, 1 - v.y - 0.002, v.x + 0.002, 1 - v.y + 0.002]
    pts = {}
    for k, p in marks.items():
        v = world_to_camera_view(sc, cam, Vector(p))
        pts[k] = [round(v.x, 4), round(1 - v.y, 4)]

    def pr(p):
        v = world_to_camera_view(sc, cam, Vector(p))
        return [v.x, 1 - v.y]
    o0 = pr((0, 0, 0))
    proj = {'o': [round(c, 6) for c in o0]}
    for k, p in (('x', (1, 0, 0)), ('y', (0, 1, 0)), ('z', (0, 0, 1))):
        q = pr(p)
        proj[k] = [round(q[0] - o0[0], 6), round(q[1] - o0[1], 6)]

    line = (0.28, 0.30, 0.34)
    sc.render.film_transparent = True
    freestyle(sc, 'solid', line, 1.8)
    render(sc, os.path.join(OUT, TAG + '_solid.png'))

    # карта деталей: плоские цвета по сноскам, без сглаживания и линий
    ID = {'mf': (1, 0, 0), 'ek': (0, 1, 0), 'tube': (0, 0, 1), 'sleeve': (1, 1, 0), 'node': (0, 1, 1), 'fix': (1, 0, 1), 'tubeb': (0, 0, 1)}
    em = {}
    for o in list(coll('solid').objects):
        k = o.get('part', '').split(':')[0]
        c = ID.get(k, (0, 0, 0))
        if c not in em:
            m = bpy.data.materials.new('id_%d%d%d' % c)
            m.use_nodes = True
            nt = m.node_tree
            for n in list(nt.nodes):
                if n.type != 'OUTPUT_MATERIAL':
                    nt.nodes.remove(n)
            e = nt.nodes.new('ShaderNodeEmission')
            e.inputs['Color'].default_value = c + (1,)
            nt.links.new(e.outputs[0], nt.nodes['Material Output'].inputs[0])
            em[c] = m
        if o.type in ('MESH', 'CURVE'):
            o.data.materials.clear()
            o.data.materials.append(em[c])
    sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0, 0, 0, 1)
    for n in list(sc.world.node_tree.links):
        sc.world.node_tree.links.remove(n)
    sc.world.node_tree.links.new(sc.world.node_tree.nodes['Background'].outputs[0],
                                 sc.world.node_tree.nodes['World Output'].inputs[0])
    for ob in sc.objects:
        if ob.type == 'LIGHT':
            ob.hide_render = True
    sc.render.use_freestyle = False
    sc.render.film_transparent = False
    sc.render.filter_size = 0.0
    try:
        sc.eevee.taa_render_samples = 1
    except Exception:
        pass
    render(sc, os.path.join(OUT, TAG + '_id.png'))
    with open(os.path.join(OUT, TAG + '.json'), 'w', encoding='utf-8') as f:
        json.dump({'w': sc.render.resolution_x, 'h': sc.render.resolution_y,
                   'zones': {k: [round(v, 4) for v in z] for k, z in zones.items()},
                   'marks': pts, 'proj': proj}, f, ensure_ascii=False)


main()
