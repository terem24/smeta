# -*- coding: utf-8 -*-
"""
Кадры листа «Бойлер ГВС» (раздел 2.3 сметы и его трубы из 2.5). Раскладка — как в проектах котельных
(«Для примера/2025-210-МЕР.СО.pdf», листы ТМ-09…ТМ-15: «Обвязка бойлера косвенного нагрева», «Обвязка
расширительных баков», «Обвязка контура ХВС бойлера», «Обвязка контура ГВС»): каждый узел — своим кадром,
между узлами труба 22 (обрезана на кадре).

    blender --background --python tools/render_dhw_node.py -- <папка> <вариант>
      b200   — бойлер OptiBase 200 л: змеевик (американка 1", кран 1" ВР/ВР, переходник 22x1 НР, труба), вход ХВС
               (муфта ВР 1" x НР 3/4", американка 3/4", переходник ВР 3/4", труба), выход ГВС (американка 3/4",
               переходник ВР 3/4", труба);
      g / g_n — узел входа ХВС В1 на стене (снизу вверх по потоку): кран 3/4" НР/НР, [тройник подмеса, ниппель],
               обратный клапан, ниппель, тройник бака, ниппель, крестовина (предохранительный клапан 6 бар на
               ниппеле 3/4"x1/2", дренажный кран), переходник НР 3/4" и труба к бойлеру; g_n — без термосмесителя;
      t24 / t18 / t12 — бак ГВС на L-кронштейне ASKON-83115, узел SVS-0008, переходник НР 3/4", труба вниз;
      mix    — термостатический клапан SVM-0125: горячий вход — кран ВР/накидная (SVB-0009) и переходник НР
               3/4"; холодный — кран НР/накидная (SVB-1009), обратный клапан, переходник НР 3/4"; выход вниз —
               кран SVB-1009 в разводку.
Источники: бойлер — паспорт SWH-2110 (stout_4bce0e01b963), рис. 2: D 590, H 1250, патрубки от низа 195 (ХВС),
315 (змеевик, выход), 495 (рециркуляция), 670 (змеевик, вход), ГВС G3/4" НР сверху; фото: белый кожух, чёрная
крышка, логотип. Бак STW-0015 — паспорт (stout_4a872c5cdd94): вертикальный, патрубок снизу по оси G3/4"; размеры в
паспорте не даны — по аналогии с STH-0006-000024 того же объёма (stout.ru: 335 x 360), 18 и 12 л — по объёму;
фото: белый, шов посередине, наклейка. Термосмеситель SVM-0125-186520 — паспорт (stout_a344695f707b): G3/4" НР,
L 59, H 90, D 40, входы по бокам, выход снизу; фото: латунь, чёрная ручка со шкалой. Обратный клапан SVC-0012 —
фото: латунь, шестигранники по концам. Предохранительный клапан RVS-0003 — фото: латунь, синий колпак, вход 1/2"
ВР снизу, сброс 3/4" ВР вбок. Кран SVB-0006 (НР/НР), SVB-0009 (ВР/накидная), SVB-1009 (НР/накидная) — фото,
чёрная бабочка. Узел SVS-0008 — фото: никель, чёрный рычаг. Кронштейн ASKON-83115 — фото: красный L-профиль.
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
TAG = 'dhw_' + VAR

add_colors({
    'bwhite': (0.95, 0.95, 0.95),
    'bblack': (0.07, 0.07, 0.08),
    'logo': (0.20, 0.22, 0.26),
    'redbr': (0.80, 0.12, 0.10),
    'capblue': (0.12, 0.30, 0.78),
    'dial': (0.95, 0.95, 0.93),
    'black': (0.10, 0.10, 0.11),
    'redring': (0.85, 0.15, 0.13),
    'label': (0.80, 0.86, 0.92),
})

YW = 0.0
AXV = {'X': Vector((1, 0, 0)), '-X': Vector((-1, 0, 0)), 'Y': Vector((0, 1, 0)), '-Y': Vector((0, -1, 0)),
       'Z': Vector((0, 0, 1)), '-Z': Vector((0, 0, -1))}
ANCH = {}


def V(c):
    return Vector(c)


def into(p, ax, L=0.012):
    """Начало резьбы, вкрученной в гнездо с концом p по направлению ax: на L назад, внутрь гнезда."""
    return p - AXV[ax] * L


def frame_of(ax, stem):
    """Матрица детали «вдоль трубы X, шток −Y»: локальный X -> ax, локальный −Y -> stem."""
    x = AXV[ax]
    sv = AXV[stem]
    y = -sv
    z = x.cross(y)
    return Matrix(((x.x, y.x, z.x, 0), (x.y, y.y, z.y, 0), (x.z, y.z, z.z, 0), (0, 0, 0, 1)))


# ── детали, вдоль оси ax от точки c; возвращают конец ─────────────────────────
def thr(r, L, m, c, ax, name='резьба НР'):
    lathe(name, thread(r, L), m, tuple(c), ax, segs=40)
    return c + AXV[ax] * L


def hx(af, h, m, c, ax, name='шестигранник'):
    hexnut(name, af, h, m, tuple(c), ax)
    return c + AXV[ax] * h


def nipple(c, ax, r2=0.0128):
    ni = M_NICKEL()
    c = thr(0.0128, 0.012, ni, c, ax)
    c = hx(0.032 if r2 > 0.011 else 0.030, 0.008, ni, c, ax, 'ниппель')
    return thr(r2, 0.012 if r2 > 0.011 else 0.010, ni, c, ax)


def body(r, L, m, c, ax, name='корпус'):
    lathe(name, [(r * 0.86, 0), (r, 0.003), (r, L - 0.003), (r * 0.86, L)], m, tuple(c), ax, segs=48)
    return c + AXV[ax] * L


def tee(c, ax, bax, cross_bax=None):
    """Тройник (крестовина) 3/4" ВР, никель: проход L 52, отвод 26 от оси. Возвращает (конец прохода, конец отвода[, второго])."""
    ni = M_NICKEL()
    d = AXV[ax]
    lathe('тройник проход', [(0.0175, 0), (0.0175, 0.009), (0.0158, 0.011), (0.0158, 0.041), (0.0175, 0.043), (0.0175, 0.052)],
          ni, tuple(c), ax, segs=48)
    m = c + d * 0.026
    outs = []
    for b in [bax] + ([cross_bax] if cross_bax else []):
        lathe('тройник отвод', [(0.0158, 0.0100), (0.0158, 0.017), (0.0175, 0.019), (0.0175, 0.026)], ni, tuple(m), b, segs=48)
        outs.append(m + AXV[b] * 0.026)
    return [c + d * 0.052] + outs


def check(c, ax):
    """Обратный клапан 3/4" ВР/ВР (SVC-0012, фото): латунь, шестигранники по концам, цилиндр, стрелка."""
    br = M_BRASS()
    c = hx(0.034, 0.013, br, c, ax, 'клапан ВР')
    lathe('клапан корпус', [(0.0185, 0), (0.0208, 0.002), (0.0208, 0.037), (0.0185, 0.039)], br, tuple(c), ax, segs=48)
    c = c + AXV[ax] * 0.039
    return hx(0.034, 0.013, br, c, ax, 'клапан ВР')


def ballvalve(c, ax, ends=('M', 'M'), stem='Z', col='black', big=False):
    """Кран шаровой 3/4" (1" при big) с бабочкой: концы M — НР, F — ВР (шестигранник), N — накидная гайка."""
    ni = M_NICKEL()
    br = M_BRASS()
    k = 1.25 if big else 1.0
    d = AXV[ax]

    def end(c, kind, out):
        if kind == 'M':
            return thr(0.0128 * k, 0.013, br, c, ax)
        if kind == 'F':
            return hx(0.031 * k, 0.015, ni, c, ax, 'кран ВР')
        return hx(0.036 * k, 0.014, ni, c, ax, 'накидная гайка')
    c = end(c, ends[0], False)
    lathe('корпус крана', [(0.0150 * k, 0), (0.0200 * k, 0.004), (0.0228 * k, 0.012), (0.0228 * k, 0.026), (0.0200 * k, 0.034),
                           (0.0150 * k, 0.038)], ni, tuple(c), ax, segs=48, sharp=40)
    cc = c + d * 0.019
    T = Matrix.Translation(cc) @ frame_of(ax, stem)
    transformed(T, lathe, 'бобышка штока', [(0.0110, 0), (0.0110, 0.0060), (0.0100, 0.0070)], ni, (0, -0.0150 * k, 0), '-Y')
    transformed(T, butterfly, 0, 0, col)
    c = c + d * 0.038
    return end(c, ends[1], True)


def union34(c, ax, big=False):
    """Американка ВР/НР (SFT-0041): шестигранник ВР, накидная гайка, НР."""
    ni = M_NICKEL()
    k = 1.25 if big else 1.0
    c = hx(0.032 * k, 0.015, ni, c, ax, 'американка ВР')
    c = hx(0.041 * k, 0.017, ni, c, ax, 'американка гайка')
    return thr(0.0128 * k, 0.012, ni, c, ax)


def adapter(c, ax, fem):
    """Переходник ВПр-НР / ВПр-ВР 22x3/4" (фото RSS-1021/1022: хром, раструб с красным кольцом)."""
    st = M_SATIN()
    if fem:
        c = hx(0.032, 0.017, st, c, ax, 'переходник ВР')
    else:
        c = thr(0.0128, 0.012, st, c, ax)
        c = hx(0.027, 0.008, st, c, ax, 'переходник шестигранник')
    lathe('раструб', [(0.0125, 0), (0.0150, 0.004), (0.0150, 0.020), (0.0158, 0.022), (0.0158, 0.028), (0.0125, 0.030)],
          st, tuple(c), ax, segs=48)
    lathe('кольцо пресс', [(0.0160, 0), (0.0160, 0.006)], mat('redring', rough=0.4), tuple(c + AXV[ax] * 0.022), ax, segs=48)
    return c + AXV[ax] * 0.028


def pipe(pts, cut=True):
    part('tube')
    tube('труба 22', [tuple(p) for p in pts], 0.011, M_SATIN())


def bend(p, d1, d2, L1, L2, R=0.040):
    """Труба от p: L1 по d1, дуга R, L2 по d2. Точки ломаной."""
    a, b = AXV[d1], AXV[d2]
    q = p + a * L1
    pts = [p, q]
    for k in range(1, 11):
        t = k * math.pi / 2 / 10
        pts.append(q + a * (R * math.sin(t)) + b * (R - R * math.cos(t)))
    pts.append(pts[-1] + b * L2)
    return pts


# ── кадры ─────────────────────────────────────────────────────────────────────
def boiler200():
    """OptiBase 200: патрубки на −X (к зрителю), стена за бойлером (+Y)."""
    R, H, foot = 0.295, 1.250, 0.040
    yc = YW - 0.050 - R
    part('mf')
    white = mat('bwhite', rough=0.45, coat=0.3)
    blk = mat('bblack', rough=0.55)
    lathe('кожух', [(0.001, foot), (R * 0.90, foot), (R, foot + 0.035), (R, H - 0.040)], white, (0, yc, 0), 'Z', segs=96)
    lathe('крышка', [(R * 1.001, H - 0.040), (R * 1.001, H - 0.014), (R * 0.97, H - 0.004), (R * 0.80, H), (0.001, H + 0.004)],
          blk, (0, yc, 0), 'Z', segs=96)
    for k in range(3):
        a = math.radians(90 + 120 * k)
        lathe('ножка', [(0.026, 0), (0.026, foot)], blk, (0.72 * R * math.cos(a), yc + 0.72 * R * math.sin(a), 0), 'Z', segs=24)
    box('логотип', (0.060, 0.0012, 0.014), mat('logo', rough=0.5), (-0.10, yc - R * 0.98, H - 0.10))
    marks['mf'] = (-0.12, yc - R * 0.96, H * 0.6)
    ni = M_NICKEL()
    z0 = foot
    ports = {'cold': z0 + 0.195, 'cout': z0 + 0.315, 'rec': z0 + 0.495, 'cin': z0 + 0.670}
    for k, z in ports.items():
        lathe('патрубок ' + k, [(0.0180, 0), (0.0180, 0.008)] + thread(0.0166, 0.024, start=0.008), ni, (-R + 0.004, yc, z), '-X', segs=40)
    hexnut('заглушка анода', 0.050, 0.012, blk, (0.12, yc, H), 'Z')
    # змеевик: американка 1", кран 1" ВР/ВР, переходник 22x1 НР, труба вверх (к котлу)
    for k, xl in (('cin', 0.040), ('cout', 0.090)):
        p = V((-R - 0.028, yc, ports[k]))
        part('feed')
        p = union34(p, '-X', big=True)
        part('ek')
        p = ballvalve(p - V((0.013 * 1.25 - 0.004, 0, 0)), '-X', ends=('F', 'F'), stem='Z', big=True)
        part('tube')
        p = adapter(p - V((0.012, 0, 0)), '-X', fem=False)
        pipe(bend(p, '-X', 'Z', xl, 1.30 - ports[k]))
    # вход ХВС: муфта ВР 1" x НР 3/4", американка 3/4", переходник ВР 3/4", труба к узлу В1 (вниз)
    p = V((-R - 0.028, yc, ports['cold']))
    part('feed')
    br = M_BRASS()
    lathe('муфта 1x3/4', [(0.0225, 0), (0.0225, 0.024), (0.0180, 0.028)], br, tuple(p + V((0.010, 0, 0))), '-X', segs=48)
    p = thr(0.0128, 0.012, br, p - V((0.018, 0, 0)), '-X')
    p = union34(p - V((0.010, 0, 0)), '-X')
    part('tube')
    p = adapter(p - V((0.012, 0, 0)), '-X', fem=True)
    pipe(bend(p, '-X', '-Z', 0.150, ports['cold'] - 0.080))
    ANCH['tube:a'] = tuple(p + V((-0.100, 0, 0)))
    # выход ГВС сверху: американка 3/4", переходник ВР, труба вверх (к термосмесителю)
    p = V((-0.12, yc, H + 0.004))
    lathe('патрубок ГВС', [(0.0150, 0), (0.0150, 0.008)] + thread(0.0128, 0.016, start=0.008), ni, tuple(p), 'Z', segs=40)
    part('feed')
    p = union34(p + V((0, 0, 0.012)), 'Z')
    part('tube')
    p = adapter(p - V((0, 0, 0.012)), 'Z', fem=True)
    pipe([p, p + V((0, 0, 0.18))])
    marks['feed'] = (-R - 0.060, yc - 0.030, ports['cold'])
    marks['ek'] = (-R - 0.110, yc - 0.035, ports['cin'] + 0.010)
    marks['tube'] = (-R - 0.240, yc, ports['cold'] - 0.200)


def group(mix=True):
    """Узел входа ХВС В1 на стене, поток снизу вверх. Отводы тройников — к зрителю (−Y), крестовина — вбок."""
    y = YW - 0.070
    p = V((0.0, y, 0.0))
    part('ek')
    p = ballvalve(p, 'Z', ends=('M', 'M'), stem='-Y')
    marks['ek'] = (0.0, y - 0.050, 0.035)
    part('feed')
    if mix:
        p, b = tee(p - V((0, 0, 0.012)), 'Z', '-Y')
        part('tube')
        q = adapter(into(b, '-Y'), '-Y', fem=False)
        pipe(bend(q, '-Y', 'X', 0.040, 0.10))
        part('feed')
        p = nipple(p - V((0, 0, 0.012)), 'Z')
    part('mount')
    p = check(p - V((0, 0, 0.012)), 'Z')
    marks['mount'] = (0.0, y - 0.022, p.z - 0.032)
    part('feed')
    p = nipple(p - V((0, 0, 0.012)), 'Z')
    p, b = tee(p - V((0, 0, 0.012)), 'Z', '-Y')
    part('tube')
    q = adapter(into(b, '-Y'), '-Y', fem=False)
    pipe(bend(q, '-Y', '-X', 0.030, 0.10))
    ANCH['tube:a'] = tuple(q + V((-0.06, -0.070, 0)))
    part('feed')
    p = nipple(p - V((0, 0, 0.012)), 'Z')
    p, bs, bd = tee(p - V((0, 0, 0.012)), 'Z', '-X', 'X')
    marks['feed'] = (0.0, y - 0.020, p.z - 0.026)
    # предохранительный клапан 6 бар на ниппеле 3/4" x 1/2" (вход ВР 1/2" — вбок), сброс 3/4" вниз
    q = nipple(into(bs, '-X'), '-X', r2=0.0104)
    part('end')
    br = M_BRASS()
    q2 = hx(0.026, 0.012, br, into(q, '-X', 0.010), '-X', 'клапан вход')
    lathe('клапан корпус', [(0.0, 0), (0.017, 0), (0.017, 0.030), (0.0, 0.030)], br, tuple(q2), '-X', segs=40)
    cc = q2 + V((-0.015, 0, 0))
    lathe('сброс 3/4', [(0.0175, 0), (0.0175, 0.026)], br, tuple(cc), '-Z', segs=40)
    lathe('колпак', [(0.0, 0), (0.019, 0), (0.019, 0.026), (0.016, 0.034), (0.0, 0.036)], mat('capblue', rough=0.4),
          tuple(cc + V((0, 0, 0.012))), 'Z', segs=40, knurl=0.0188)
    marks['end'] = tuple(cc + V((0, -0.020, 0.030)))
    # дренажный кран на второй отвод крестовины
    part('ek')
    ballvalve(into(bd, 'X'), 'X', ends=('M', 'M'), stem='-Y')
    part('tube')
    p = adapter(p - V((0, 0, 0.012)), 'Z', fem=False)
    pipe([p, p + V((0, 0, 0.16))])


def tank(vol, stout_mount=False):
    """Бак ГВС на стене: висит патрубком вниз на узле SVS-0008, кронштейн ASKON-83115 держит узел."""
    D, H = {24: (0.360, 0.335), 18: (0.320, 0.315), 12: (0.280, 0.290)}[vol]
    R = D / 2
    yc = YW - 0.060 - R
    part('mf')
    w = mat('bwhite', rough=0.45, coat=0.3)
    z0 = 0.120
    prof = [(0.012, 0), (0.030, 0.002), (R * 0.55, 0.020), (R * 0.85, 0.050), (R, 0.095), (R, H - 0.095), (R * 0.85, H - 0.050),
            (R * 0.55, H - 0.020), (0.020, H - 0.002), (0.0, H)]
    lathe('бак', prof, w, (0, yc, z0), 'Z', segs=96, sharp=25)
    lathe('шов', [(R * 1.004, H / 2 - 0.004), (R * 1.004, H / 2 + 0.004)], mat('dial', rough=0.6), (0, yc, z0), 'Z', segs=96)
    box('наклейка', (0.090, 0.001, 0.050), mat('label', rough=0.5), (0, yc - R - 0.0005, z0 + H * 0.62))
    lathe('ниппель воздуха', [(0.0, 0), (0.010, 0), (0.010, 0.014), (0.0, 0.016)], mat('bblack', rough=0.5), (0, yc, z0 + H), 'Z', segs=24)
    marks['mf'] = (-R * 0.5, yc - R * 0.86, z0 + H * 0.6)
    ni = M_NICKEL()
    lathe('патрубок бака', [(0.022, 0), (0.022, 0.006)] + thread(0.0128, 0.014, start=0.006), ni, (0, yc, z0 + 0.002), '-Z', segs=40)
    # узел SVS-0008: ВР на патрубок бака, кран с рычагом, накидная гайка вниз
    part('kit')
    p = V((0, yc, z0 - 0.012))
    p = hx(0.031, 0.014, ni, p, '-Z', 'узел ВР')
    lathe('узел корпус', [(0.016, 0), (0.019, 0.004), (0.019, 0.030), (0.016, 0.034)], ni, tuple(p), '-Z', segs=40)
    box('рычаг', (0.010, 0.050, 0.006), mat('bblack', rough=0.4), tuple(p + V((0, -0.035, -0.017))))
    p = p + V((0, 0, -0.034))
    p = hx(0.034, 0.014, ni, p, '-Z', 'узел накидная')
    marks['kit'] = tuple(p + V((0, -0.030, 0.030)))
    part('head')
    if stout_mount:
        # STOUT SAC-0030-000825 (фото): оцинкованная пластина с ложементом на стене и стальной хомут вокруг бака
        g = mat('dial', rough=0.35, metal=0.8)
        box('пластина крепления', (0.150, 0.004, 0.110), g, (0, YW - 0.002, z0 + H / 2))
        box('ложемент', (0.080, abs(yc + R - YW) + 0.004, 0.090), g, (0, (YW + yc + R) / 2 - 0.004, z0 + H / 2))
        lathe('хомут', [(R + 0.002, H / 2 - 0.007), (R + 0.002, H / 2 + 0.007)], g, (0, yc, z0), 'Z', segs=96)
        hexnut('замок хомута', 0.014, 0.012, g, (R + 0.004, yc, z0 + H / 2), 'X')
        marks['head'] = (-R * 0.7, yc - R * 0.72, z0 + H / 2)
    else:
        # кронштейн ASKON-83115 L: полка на стене, плечо к узлу
        r = mat('redbr', rough=0.45, metal=0.3)
        box('кронштейн стена', (0.040, 0.004, 0.120), r, (0, YW - 0.002, z0 - 0.030))
        box('кронштейн плечо', (0.030, abs(yc - YW), 0.004), r, (0, (yc + YW) / 2, z0 - 0.004))
        marks['head'] = (0.0, YW - 0.040, z0 - 0.004)
    part('tube')
    p = adapter(p + V((0, 0, 0.012)), '-Z', fem=False)
    pipe([p, p + V((0, 0, -0.16))])
    ANCH['tube:a'] = tuple(p + V((0, 0, -0.08)))


def mixer():
    """Термостатический клапан SVM-0125: входы по бокам (горячий −X, холодный +X), выход вниз, ручка вверх."""
    y = YW - 0.070
    c = V((0, y, 0.0))
    br = M_BRASS()
    part('mf')
    lathe('корпус клапана', [(0.0, 0), (0.020, 0), (0.022, 0.006), (0.022, 0.040), (0.018, 0.046), (0.0, 0.046)], br, tuple(c - V((0, 0, 0.026))), 'Z', segs=48)
    for sx in (-1, 1):
        lathe('боковой', [(0.0170, 0), (0.0170, 0.012)] + thread(0.0128, 0.012, start=0.012), br, tuple(c + V((sx * 0.0055, 0, 0))), 'X' if sx > 0 else '-X', segs=40)
    lathe('нижний', [(0.0170, 0), (0.0170, 0.020)] + thread(0.0128, 0.012, start=0.020), br, tuple(c - V((0, 0, 0.024))), '-Z', segs=40)
    lathe('ручка', [(0.0, 0), (0.020, 0), (0.020, 0.030), (0.016, 0.036), (0.0, 0.037)], mat('black', rough=0.45),
          tuple(c + V((0, 0, 0.020))), 'Z', segs=48, ribs=(12, 0.06, 0.004, 0.028))
    box('шкала', (0.016, 0.001, 0.008), mat('dial', rough=0.4), tuple(c + V((0, -0.0205, 0.034))))
    marks['mf'] = tuple(c + V((0, -0.022, 0.040)))
    # горячий вход (−X): кран ВР/накидная гайка, переходник НР 3/4", труба от бойлера
    part('ek')
    p = ballvalve(c + V((-0.0295, 0, 0)), '-X', ends=('N', 'F'), stem='Z')
    marks['ek'] = tuple(c + V((-0.050, -0.030, 0.030)))
    part('tube')
    p = adapter(into(p, '-X'), '-X', fem=False)
    pipe([p, p + V((-0.14, 0, 0))])
    # холодный вход (+X): кран НР/накидная гайка, обратный клапан, переходник НР 3/4", труба от тройника подмеса
    part('ek')
    p = ballvalve(c + V((0.0295, 0, 0)), 'X', ends=('N', 'M'), stem='Z')
    part('mount')
    p = check(p - V((0.012, 0, 0)), 'X')
    marks['mount'] = tuple(p + V((-0.030, -0.022, 0)))
    part('tube')
    p = adapter(p - V((0.012, 0, 0)), 'X', fem=False)
    pipe([p, p + V((0.14, 0, 0))])
    ANCH['tube:a'] = tuple(p + V((0.07, 0, 0)))
    # выход вниз: кран НР/накидная гайка в разводку ГВС
    part('ek')
    p = ballvalve(c + V((0, 0, -0.056)), '-Z', ends=('N', 'M'), stem='-Y')


def build():
    sc = reset()
    part('')
    g = mat('bwhite', rough=0.6, alpha=0.18)
    ob = box('стена', (1.6, 0.004, 1.8), g, (-0.2, YW + 0.002, 0.6))
    ob.modifiers.clear()
    for cl in list(ob.users_collection):
        cl.objects.unlink(ob)
    coll('sheath').objects.link(ob)
    if VAR == 'b200':
        boiler200()
    elif VAR in ('g', 'g_n'):
        group(mix=(VAR == 'g'))
    elif VAR.startswith('t'):
        tank(int(VAR[1:3]), VAR.endswith('_s'))
    elif VAR == 'mix':
        mixer()
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
    ID = {'mf': (1, 0, 0), 'ek': (0, 1, 0), 'tube': (0, 0, 1), 'mount': (1, 1, 0), 'feed': (0, 1, 1),
          'end': (1, 0, 1), 'head': (1, 1, 1), 'kit': (1, 0.5, 0)}
    id_pass(sc, list(coll('solid').objects), ID, os.path.join(OUT, TAG + '_id.png'))
    write_meta(sc, os.path.join(OUT, TAG + '.json'), zones, pts, proj)


main()
