# -*- coding: utf-8 -*-
"""
Кадр узла подключения стального панельного радиатора для сметы (раздел 3.1, боковое
подключение): ROMMER Compact (Лемакс) тип 11/21/22/33, высота 500, и его обвязка — то, что кладёт
смета на прибор: термостатический клапан под евроконус SVT-0002-100015 (угловой) или
SVT-0001-100015 (прямой) на подаче сверху, запорно-балансировочный SVL-1166-000015 (угловой) или
SVL-1196-000015 (прямой) на обратке снизу с той же стороны, термоголовка SHT-0001-003015,
евроконусы 16x2.2, фиксаторы 90° SFA-0029, защитные втулки.

    blender --background --python tools/render_panel_node.py -- <папка> <вариант>
      вариант — panel21_angled | panel21_straight | panel11_… | panel22_… | panel33_…

Источники:
  * радиатор — паспорт ROMMER (Лемакс), «Монтажные размеры»: глубина D 68 (тип 21), 102 (22),
    157 (33); от стены до фасада A 97/132/186, то есть зазор ~30 мм; для типа 11 D в таблице 65 —
    расходится с A 77 и фото, взята глубина 47 (A − 30). Патрубки G1/2" ВР (4 боковых), межосевое
    J 449 при высоте 500, ось патрубков — на середине глубины (F = A − D/2). В комплекте
    кронштейны, заглушка и воздухоотводчик (схема монтажа: воздухоотводчик сверху, заглушка снизу
    на дальнем торце). Фасад — фото каталога RRS-2020: рамка по краю, вертикальные рифы ~33 мм со
    скруглёнными концами; сверху решётка, по торцам декоративные боковины.
  * клапаны — паспорт STOUT SVT ред. 4 и SVR/SVRS/SVL ред. 4, табл. «Номенклатура и габаритные
    размеры»: SVT -100015 — L 54, ось — верх H 45 (прямой) / H1 39 (угловой), колпачок D 35,
    хвостовик l 13,2, гайка SW 30, со стороны трубы G 3/4" НР (евроконус); SVL-1196 — L 67,
    H 27, D 25; SVL-1166 — L 50, H 45, l 23, D 25. Фото: никель, белый колпачок.
  * схема: подача — сверху через термоклапан, обратка — снизу через запорный, одна сторона
    (паспорт ROMMER, «двухтрубная система»). Угловые клапаны — трубы из стены (головка
    горизонтально, к комнате), прямые — из пола (головка вертикально).
Радиатор на кадре — длиной 600 мм (длина прибора на схеме условная, подпись берёт её из сметы).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blender_parts import *  # noqa: F401,F403
from mathutils import Vector, Matrix
import bpy
import rad_bottom as rb

_argv = sys.argv[sys.argv.index('--') + 1:]
OUT, VAR = _argv[0], _argv[1]
# panelNN_… — Compact, боковое подключение (кадры img/rad_panel/panel_*);
# ventilNN_… — Ventil, нижнее подключение через узел SVH (кадры в индексе узла радиатора radnode)
VENTIL = VAR.startswith('ventil')
TAG = ('radnode_' + VAR) if VENTIL else ('panel_' + VAR.replace('panel', ''))
ANGLED = '_angled' in VAR
TYPE = VAR[6:8] if VENTIL else VAR[5:7]           # 11 | 21 | 22 | 33

add_colors({
    'radwhite': (0.95, 0.95, 0.94),    # RAL 9016
    'headwhite': (0.96, 0.96, 0.95),
    'markred': (0.86, 0.14, 0.14),
    'markblue': (0.18, 0.45, 0.88),
    'scaleink': (0.25, 0.26, 0.28),
    'slot': (0.30, 0.31, 0.33),
    'sleeve_r': (0.90, 0.20, 0.18),
    'sleeve_b': (0.16, 0.45, 0.90),
    'ins_sup': (0.93, 0.27, 0.22),
    'ins_ret': (0.13, 0.56, 0.95),
})

DEPTH = {'11': 0.047, '21': 0.068, '22': 0.102, '33': 0.157}[TYPE]
PANELS = {'11': 1, '21': 2, '22': 2, '33': 3}[TYPE]
LR = 0.600            # длина на кадре
HR = 0.500            # высота
J = 0.449             # межосевое боковых патрубков
ZB = 0.120            # низ над полом
YF = -DEPTH / 2       # фасад
YW = DEPTH / 2 + 0.030   # стена (паспорт: A − D ≈ 30 мм)
Z_TOP = ZB + (HR + J) / 2
Z_BOT = ZB + (HR - J) / 2
ANCH = {}


def radiator():
    """Корпус: панели (фасад рифлёный по фото, остальные гладкие), сверху решётка с прорезями,
    по торцам боковины; между панелями — тёмная глубина (оребрение видно сквозь решётку)."""
    m = mat('radwhite', rough=0.45, coat=0.2)
    dark = mat('slot', rough=0.7)
    x0, x1 = -LR / 2, LR / 2
    zc = ZB + HR / 2
    # панели: фасад и тыльные, толщина ~11 мм (сварная панель с каналами)
    ys = [YF + 0.0055 + k * (DEPTH - 0.011) / max(1, PANELS - 1) for k in range(PANELS)] if PANELS > 1 else [YF + 0.0055]
    for y in ys:
        box('панель', (LR - 0.004, 0.011, HR - 0.004), m, (0, y, zc))
    if PANELS == 1:            # тип 11: оребрение сзади, за ним стена
        box('оребрение', (LR - 0.020, DEPTH - 0.014, HR - 0.040), dark, (0, YF + 0.011 + (DEPTH - 0.014) / 2, zc))
    else:
        box('оребрение', (LR - 0.020, DEPTH - 0.024, HR - 0.040), dark, (0, 0.0, zc))
    # фасад: рамка по краю и вертикальные рифы ~33 мм со скруглёнными концами (фото RRS-2020)
    to_xz = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    n = int((LR - 0.060) / 0.033)
    xs0 = -(n - 1) * 0.033 / 2
    for k in range(n):
        rib = rounded([(-0.0075, 0.0), (0.0075, 0.0), (0.0075, HR - 0.130), (-0.0075, HR - 0.130)], 0.0070, seg=4)
        prism('риф', rib, 0.0022, m, Matrix.Translation(Vector((xs0 + k * 0.033, YF - 0.0010, ZB + 0.060))) @ to_xz,
              bevel=0.0009)
    # решётка сверху: пластина с поперечными прорезями (тёмные полосы)
    box('решётка', (LR - 0.010, DEPTH - 0.004, 0.003), m, (0, 0.0, ZB + HR + 0.0015))
    ns = int((LR - 0.060) / 0.012)
    for k in range(ns):
        box('прорезь', (0.0045, DEPTH - 0.020, 0.0008), dark, (-(ns - 1) * 0.006 + k * 0.012, 0.0, ZB + HR + 0.0031))
    # боковины по торцам
    for sx in (-1, 1):
        box('боковина', (0.003, DEPTH + 0.002, HR - 0.002), m, (sx * (LR / 2 + 0.0015), 0.0, zc))


def port_end(x, z, sg):
    """Торец патрубка G1/2" ВР в окне боковины — латунное кольцо."""
    lathe('патрубок', [(0.0110, 0), (0.0110, 0.003)], M_NICKEL(), (x, 0, z), 'X' if sg > 0 else '-X', segs=32)


def plug(x, z, sg):
    """Заглушка 1/2" из монтажного комплекта (белая, шестигранник)."""
    m = mat('radwhite', rough=0.45, coat=0.2)
    ax = 'X' if sg > 0 else '-X'
    hexnut('заглушка', 0.022, 0.006, m, (x, 0, z), ax)
    lathe('заглушка торец', [(0.009, 0), (0.009, 0.002), (0.0, 0.0025)], m, (x + sg * 0.006, 0, z), ax, segs=24)


def air_vent(x, z, sg):
    """Воздухоотводчик ручной 1/2" из монтажного комплекта: белая пробка-шестигранник и винт."""
    plug(x, z, sg)
    lathe('винт воздухоотводчика', [(0.0035, 0), (0.0035, 0.006), (0.0, 0.0065)], M_NICKEL(),
          (x + sg * 0.0085, 0, z + 0.002), 'X' if sg > 0 else '-X', segs=16)


def thermo_head(c, ax):
    """Термоголовка SHT-0001-003015 (паспорт: D 52, H 90, гайка SW 33 с накаткой, M30x1,5; фото:
    кольцо шкалы, ребристый колпак, красная и синяя метки) — на клапане по оси ax от точки c."""
    ni = M_NICKEL()
    part('head')
    d = {'Z': Vector((0, 0, 1)), '-Y': Vector((0, -1, 0))}[ax]
    c = Vector(c)
    lathe('гайка термоголовки', [(0.0165, 0), (0.0170, 0.001), (0.0170, 0.013), (0.0160, 0.014)], ni, c, ax,
          segs=48, knurl=0.0168)
    c1 = c + d * 0.014
    w = mat('headwhite', rough=0.40, coat=0.3)
    lathe('термоголовка', [(0.0200, 0), (0.0260, 0.006), (0.0260, 0.030), (0.0245, 0.032), (0.0240, 0.036),
                           (0.0235, 0.058), (0.0205, 0.068), (0.0160, 0.074), (0.0, 0.076)], w, c1, ax,
          segs=80, sharp=40, ribs=(20, 0.09, 0.033, 0.072))
    # метки и риски — на стороне к зрителю (у вертикальной головки — фасадом, у горизонтальной — сверху)
    side = Vector((0, -1, 0)) if ax == 'Z' else Vector((0, 0, 1))
    across = d.cross(side).normalized()
    dark = mat('scaleink', rough=0.5)
    for k in range(-3, 4):
        a = math.radians(k * 16)
        p = c1 + d * (0.020 if k % 2 else 0.0215) + (side * math.cos(a) + across * math.sin(a)) * 0.0262
        size = (0.0012, 0.0008, 0.004 if k % 2 else 0.007) if ax == 'Z' else (0.0012, 0.004 if k % 2 else 0.007, 0.0008)
        box('риска шкалы', size, dark, tuple(p))
    for dk, col in ((0.008, 'markred'), (-0.008, 'markblue')):
        p = c1 + d * 0.042 + side * 0.0240 + across * dk
        size = (0.004, 0.0016, 0.008) if ax == 'Z' else (0.004, 0.008, 0.0016)
        box('метка', size, mat(col, rough=0.4), tuple(p))
    marks['head'] = tuple(c1 + d * 0.050 + side * 0.026)


def union_tail(x, z, sg):
    """Хвостовик с накидной гайкой SW 30 (паспорт: l 13,2; фото — гайка заметно шире корпуса) — вкручен в патрубок радиатора; гайка
    у торца радиатора. Возвращает X начала корпуса клапана."""
    ni = M_NICKEL()
    ax = 'X' if sg > 0 else '-X'
    hexnut('накидная гайка', 0.030, 0.012, ni, (x + sg * 0.003, 0, z), ax, ch=0.14)
    lathe('хвостовик', [(0.0118, 0), (0.0118, 0.006)], ni, (x + sg * 0.015, 0, z), ax, segs=32)
    return x + sg * 0.021


def euro_thread(c, ax):
    """Выход под евроконус G 3/4" НР (фото: голая резьба) по оси ax."""
    lathe('выход 3/4" ЕК', [(0.0115, 0), (0.0115, 0.003)] + thread(0.0128, 0.010, start=0.003), M_NICKEL(), c, ax, segs=40)
    d = {'X': (1, 0, 0), '-X': (-1, 0, 0), 'Y': (0, 1, 0), '-Z': (0, 0, -1)}[ax]
    return tuple(Vector(c) + Vector(d) * 0.013)


def valve(x_end, z, sg, thermo):
    """Клапан на торце радиатора: хвостовик с гайкой, корпус; у углового — выход к стене (+Y),
    шток к зрителю (−Y); у прямого — выход по оси прибора наружу, шток вверх. Термоклапан —
    белый колпачок снят, стоит термоголовка; запорный — белый шестигранный колпачок D 25."""
    ni = M_NICKEL()
    part('node' if thermo else 'lock')
    xb = union_tail(x_end, z, sg)
    if ANGLED:
        L = 0.054 if thermo else 0.050
        xv = x_end + sg * (L - 0.012)                      # ось корпуса (L — от торца до оси выхода)
        lathe('корпус к оси', [(0.0100, 0), (0.0100, abs(xv - xb))], ni, (xb, 0, z), 'X' if sg > 0 else '-X', segs=40)
        lathe('корпус', [(0.0, -0.016), (0.0115, -0.016), (0.0122, -0.012), (0.0122, 0.012), (0.0115, 0.016),
                         (0.0, 0.016)], ni, (xv, 0, z), 'Y', segs=40)
        out = euro_thread((xv, 0.016, z), 'Y')
        stem_ax, stem_c = '-Y', (xv, -0.016, z)
    else:
        L = 0.054 if thermo else 0.067
        xv = xb + sg * (L - 0.021) * 0.5
        xe = x_end + sg * L
        lathe('корпус', [(0.0100, 0), (0.0112, 0.004), (0.0112, abs(xe - xb) - 0.004), (0.0100, abs(xe - xb))],
              ni, (xb, 0, z), 'X' if sg > 0 else '-X', segs=40)
        lathe('прилив штока', [(0.0110, 0), (0.0110, 0.012)], ni, (xv, 0, z), 'Z', segs=40)
        out = euro_thread((xe, 0, z), 'X' if sg > 0 else '-X')
        stem_ax, stem_c = 'Z', (xv, 0, z + 0.012)
    d = {'Z': Vector((0, 0, 1)), '-Y': Vector((0, -1, 0))}[stem_ax]
    if thermo:
        lathe('резьба M30x1,5', [(0.0150, 0), (0.0150, 0.008)], ni, stem_c, stem_ax, segs=40)
        thermo_head(tuple(Vector(stem_c) + d * 0.008), stem_ax)
        part('node')
    else:
        # шток с белым шестигранным колпачком D 25 (фото SVL)
        lathe('шток', [(0.0090, 0), (0.0090, 0.006)], ni, stem_c, stem_ax, segs=32)
        cap = mat('headwhite', rough=0.45, coat=0.2)
        hexnut('колпачок', 0.025, 0.012, cap, tuple(Vector(stem_c) + d * 0.006), stem_ax, ch=0.18)
    marks['node' if thermo else 'lock'] = (xv, -0.012, z + 0.010)
    return out


def ek(loc, axis):
    """Евроконус 16x2.2 (фото SFC-0020-001622) на выход клапана."""
    if axis == 'Y':
        T = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(math.pi / 2, 4, 'X')   # -Z -> +Y
        transformed(T, ek_fit, (0, 0, 0), '-Z')
        return (loc[0], loc[1] + 0.0218, loc[2])
    sgx = 1 if axis == 'X' else -1
    T = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(-sgx * math.pi / 2, 4, 'Y')   # -Z -> ±X
    transformed(T, ek_fit, (0, 0, 0), '-Z')
    return (loc[0] + sgx * 0.0218, loc[1], loc[2])


def pipe_run(p0, sup, sg):
    """Труба 16x2.2 от евроконуса. Угловой клапан: в стену, поворот вниз в штробе на фиксаторе
    (радиус 78 мм — 5D, паспорт SFA-0029), втулка на выходе из стены. Прямой: наружу по оси прибора,
    свободный поворот вниз (5D), вниз к полу и поворот в стяжку на фиксаторе, втулка на выходе из пола."""
    key = 's' if sup else 'r'
    col = 'ins_sup' if sup else 'ins_ret'
    R = 0.078
    pm = M_PLAST(col) if illus() else M_PLAST('pex')
    x, y0, z0 = p0
    if ANGLED:
        yc = YW - 0.004
        pts = [(x, y0 - 0.004, z0), (x, yc, z0)]
        arc = [(x, yc + R * math.sin(t), z0 - R + R * math.cos(t)) for t in [k * math.pi / 2 / 14 for k in range(1, 15)]]
        tail = [(x, yc + R, -0.06)]
        if sup:
            # подача спускается в штробе мимо клапана обратки: та же вертикаль занята, поэтому выше
            # нижнего клапана — S-отвод наружу на 45 мм на высоте 160 мм (радиус ~115 мм, больше 5D) до
            # того, как обратка уходит в стену вниз; дальше вниз параллельно ей
            zs, dx, h = Z_BOT + 0.100, sg * 0.045, 0.160
            s_bend = [(x + dx * (1 - math.cos(math.pi * k / 12)) / 2, yc + R, zs - h * k / 12) for k in range(13)]
            tail = s_bend + [(x + dx, yc + R, -0.06)]
        part('tube:' + key)
        tube('труба 16', pts + arc + tail, 0.008, pm)
        part('fix:' + key)
        pipe_fixator90((x, yc, z0 - R), (0, 0, 1), (0, 1, 0), R)
        ANCH['fix:' + key] = (x, yc + R * math.sin(math.pi / 4), z0 - R + R * math.cos(math.pi / 4))
        part('sleeve:' + key)
        lathe('втулка', [(0.0098, 0), (0.0108, 0.002), (0.0108, 0.058), (0.0098, 0.060)],
              mat('sleeve_r' if sup else 'sleeve_b', rough=0.45), (x, YW - 0.030, z0), 'Y', segs=32)
        return
    # прямой: подача сверху уходит дальше от прибора, чем обратка, чтобы трубы не пересекались
    xd = x + sg * (0.020 + (0.060 if sup else 0.0))
    pts = [(x - sg * 0.004, 0, z0), (xd, 0, z0)]
    arc1 = [(xd + sg * R * math.sin(t), 0, z0 - R + R * math.cos(t)) for t in [k * math.pi / 2 / 12 for k in range(1, 13)]]
    xv = xd + sg * R
    zc = 0.0 - 0.020 - R                 # поворот в стяжке
    pts2 = [(xv, 0, zc + R)]
    arc2 = [(xv, -R + R * math.cos(t), (zc + R) - R * math.sin(t)) for t in [k * math.pi / 2 / 14 for k in range(1, 15)]]
    part('tube:' + key)
    tube('труба 16', pts + arc1 + pts2 + arc2 + [(xv, -R - 0.06, zc)], 0.008, pm)
    part('fix:' + key)
    pipe_fixator90((xv, -R, zc + R), (0, 1, 0), (0, 0, -1), R)
    ANCH['fix:' + key] = (xv, -R + R * math.cos(math.pi / 4), zc + R - R * math.sin(math.pi / 4))
    part('sleeve:' + key)
    lathe('втулка', [(0.0098, 0), (0.0108, 0.002), (0.0108, 0.058), (0.0098, 0.060)],
          mat('sleeve_r' if sup else 'sleeve_b', rough=0.45), (xv, 0, -0.030), 'Z', segs=32)


def room():
    part('')
    g = mat('radwhite', rough=0.6, alpha=0.18)
    x0, x1 = -LR / 2 - 0.26, LR / 2 + 0.10
    for name, size, loc in (('стена', (x1 - x0, 0.004, 0.80), ((x0 + x1) / 2, YW + 0.002, 0.33)),
                            ('пол', (x1 - x0, 0.40, 0.004), ((x0 + x1) / 2, YW - 0.20, -0.002))):
        ob = box(name, size, g, loc)
        ob.modifiers.clear()
        for c in list(ob.users_collection):
            c.objects.unlink(ob)
        coll('sheath').objects.link(ob)


def build_ventil():
    """Ventil (паспорт ROMMER/Лемакс: 4 боковых и 2 нижних патрубка G 1/2" ВР; нижние — межосевое
    50 мм, ось крайнего в 32 мм от торца бокового патрубка; в верхний боковой со стороны подключения
    встроена вентильная вставка RTI под термоголовку): подключение справа снизу. Смета: ниппели
    SFT-0049 (1/2" НР x 3/4" НР) в нижние патрубки, узел SVH-0004 (угловой: евроконусы, трубы в стену,
    фиксаторы 90°, втулки) или SVH-0002 (прямой: фитинги 15x3/4", трубки Г-образные 16/500, скоба),
    термоголовка RHT-0001 (ROMMER). Кронштейны, заглушки и воздухоотводчик — в комплекте радиатора."""
    sc = reset()
    room()
    x_end = LR / 2 + 0.003
    part('rad')
    radiator()
    port_end(-x_end, Z_TOP, -1)
    air_vent(-x_end, Z_TOP, -1)
    plug(-x_end, Z_BOT, -1)
    plug(x_end, Z_BOT, 1)
    marks['rad'] = (0.0, YF, ZB + HR * 0.55)
    # вентильная вставка в верхнем правом патрубке и термоголовка горизонтально
    lathe('вставка RTI', [(0.0120, 0), (0.0120, 0.010)], M_NICKEL(), (x_end, 0, Z_TOP), 'X', segs=40)
    # головка — как в смете: ROMMER RHT-0001 (режим ROMMER) или STOUT SHT-0001 (вариант «_sht»)
    (rb.sht_head if VAR.endswith('_sht') else rb.rht_head)((x_end + 0.010, 0, Z_TOP), 'X')
    part('node')
    x_sup = LR / 2 - 0.032 + 0.003
    x_ret = x_sup - 0.050
    zt = ZB
    zn = min(rb.nipple_sft0049(x, zt) for x in (x_sup, x_ret))
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


def build():
    if VENTIL:
        return build_ventil()
    sc = reset()
    room()
    # подключение слева: камера смотрит слева-спереди, у правого торца клапаны и выход трубы в стену
    # закрыл бы сам радиатор (боковое подключение допустимо с любой стороны)
    sg = -1
    x_end = sg * (LR / 2 + 0.003)
    part('rad')
    radiator()
    for z in (Z_TOP, Z_BOT):
        port_end(x_end, z, sg)
    # дальний торец: воздухоотводчик сверху, заглушка снизу (монтажный комплект)
    air_vent(-x_end, Z_TOP, -sg)   # дальний торец
    plug(-x_end, Z_BOT, -sg)
    marks['rad'] = (0.0, YF, ZB + HR * 0.55)
    for z, sup in ((Z_TOP, True), (Z_BOT, False)):
        out = valve(x_end, z, sg, sup)
        part('ek:' + ('s' if sup else 'r'))
        p0 = ek(out, 'Y' if ANGLED else 'X')
        pipe_run(p0, sup, sg)
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
    # карта деталей: радиатор R, евроконус G, труба B, запорный клапан Y, термоклапан C,
    # фиксатор и втулка M (выход трубы), термоголовка W
    ID = {'rad': (1, 0, 0), 'ek': (0, 1, 0), 'tube': (0, 0, 1), 'lock': (1, 1, 0), 'node': (0, 1, 1), 'bracket': (1, 1, 0),
          'fix': (1, 0, 1), 'sleeve': (1, 0, 1), 'head': (1, 1, 1)}
    id_pass(sc, list(coll('solid').objects), ID, os.path.join(OUT, TAG + '_id.png'))
    write_meta(sc, os.path.join(OUT, TAG + '.json'), zones, pts, proj)


main()
