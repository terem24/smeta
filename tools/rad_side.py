# -*- coding: utf-8 -*-
"""
Арматура бокового подключения радиатора — общая для всех приборов с боковым подключением
(секционные, панельные Compact, дизайнерские, трубчатые). Ось X — вдоль прибора, Z — вверх, пол z = 0,
стена — y = yw, зритель со стороны −Y. Состав — как кладёт смета (раздел 3.1):

  обычная арматура:  клапан термостатический SVT-0001/0002-100015 и запорно-балансировочный
                     SVL-1196/1166 (под евроконус, никель, белые колпачки), термоголовка SHT-0001,
                     евроконус 16 на каждый клапан;
  дизайнерская:      STOUT Design SVTD/SVLD в цвет (хром/белый/чёрный; паспорт SVTD/SVLD: со стороны
                     трубы ВР 1/2", к прибору — штуцер НР 1/2" с PTFE), термоголовка SHTD-0002 в цвет,
                     вместо евроконуса — переходник 16 x НР 1/2" с монтажной гильзой (решение
                     владельца 07.11.2026);
  монтажный набор:   (секционные) переходники 1" -> 1/2" в цвет набора (SKU-0211 белый RAL 9016,
                     SKU-0221 графит, SKU-0231 чёрный 9011), заглушка 1", воздухоотводчик;
  трубы:             угловые клапаны — в стену, поворот вниз в штробе на фиксаторе 90° (5D), подача
                     обходит обратку S-отводом; прямые — наружу и вниз в пол, поворот в стяжку на
                     фиксаторе; защитные втулки на выходе трубы.
Части (part) для карты деталей: node — термоклапан, lock — запорный, head — головка, ek — евроконус или
переходник, tube — труба, fix/sleeve — выход трубы, kit — монтажный набор.
"""
import math

from blender_parts import *  # noqa: F401,F403
from mathutils import Vector, Matrix

add_colors({
    'headwhite': (0.96, 0.96, 0.95),
    'markred': (0.86, 0.14, 0.14),
    'markblue': (0.18, 0.45, 0.88),
    'scaleink': (0.25, 0.26, 0.28),
    'sleeve_r': (0.90, 0.20, 0.18),
    'sleeve_b': (0.16, 0.45, 0.90),
    'ins_sup': (0.93, 0.27, 0.22),
    'ins_ret': (0.13, 0.56, 0.95),
    'ral9016': (0.95, 0.95, 0.94),
    'ral9005': (0.08, 0.08, 0.09),
    'ral7024': (0.29, 0.31, 0.33),
    'ral9011': (0.10, 0.10, 0.11),
    'ptfe': (0.88, 0.45, 0.40),
})

DIRS = {'X': Vector((1, 0, 0)), '-X': Vector((-1, 0, 0)), 'Y': Vector((0, 1, 0)), '-Y': Vector((0, -1, 0)),
        'Z': Vector((0, 0, 1)), '-Z': Vector((0, 0, -1))}


def finish(color):
    """Покрытие дизайнерской арматуры и монтажного набора: chrome | white | black | graphite."""
    if color == 'chrome':
        return M_CHROME()
    return mat({'white': 'ral9016', 'black': 'ral9005', 'graphite': 'ral7024'}.get(color, 'ral9016'), rough=0.38, coat=0.4)


def sht_head(c, ax):
    """STOUT SHT-0001-003015 (паспорт: D 52, H 90, гайка SW 33 с накаткой; фото: шкала, 20 рёбер, метки)."""
    ni = M_NICKEL()
    d = DIRS[ax]
    c = Vector(c)
    part('head')
    lathe('гайка головки', [(0.0165, 0), (0.0170, 0.001), (0.0170, 0.013), (0.0160, 0.014)], ni, tuple(c), ax, segs=48, knurl=0.0168)
    c1 = c + d * 0.014
    lathe('термоголовка', [(0.0200, 0), (0.0260, 0.006), (0.0260, 0.030), (0.0245, 0.032), (0.0240, 0.036),
                           (0.0235, 0.058), (0.0205, 0.068), (0.0160, 0.074), (0.0, 0.076)], mat('headwhite', rough=0.40, coat=0.3),
          tuple(c1), ax, segs=80, sharp=40, ribs=(20, 0.09, 0.033, 0.072))
    _scale(c1, d, 0.0262, 0.020)
    side = Vector((0, -1, 0)) if abs(d.y) < 0.5 else Vector((0, 0, 1))
    up = d.cross(side).normalized()
    for dk, col in ((0.008, 'markred'), (-0.008, 'markblue')):
        p = c1 + d * 0.042 + side * 0.0240 + up * dk
        box('метка', _sz(d, 0.004, 0.008), mat(col, rough=0.4), tuple(p))
    marks['head'] = tuple(c1 + d * 0.050 + side * 0.026)


def shtd_head(c, ax, color):
    """STOUT Design SHTD-0002-003015 (фото): гайка M30x1,5, корпус в цвет — цилиндр, к торцу слегка
    сужается, на колпаке узкие продольные прорези, у основания шкала 1–5 с указателем."""
    d = DIRS[ax]
    c = Vector(c)
    part('head')
    m = finish(color)
    lathe('гайка головки', [(0.0160, 0), (0.0165, 0.001), (0.0165, 0.012), (0.0155, 0.013)], m, tuple(c), ax, segs=48, knurl=0.0163)
    c1 = c + d * 0.013
    lathe('термоголовка SHTD', [(0.0215, 0), (0.0225, 0.004), (0.0225, 0.024), (0.0220, 0.028), (0.0210, 0.064),
                                (0.0195, 0.072), (0.0150, 0.076), (0.0, 0.077)], m, tuple(c1), ax, segs=80, sharp=40,
          ribs=(10, 0.05, 0.034, 0.066))
    ink = mat('ral9016' if color == 'black' else 'scaleink', rough=0.5)
    _scale(c1, d, 0.0227, 0.014, ink)
    marks['head'] = tuple(c1 + d * 0.050 + Vector((0, -1, 0)) * 0.022)


def _sz(d, a, b):
    if abs(d.z) > 0.5:
        return (b * 0.5, 0.0012, a * 2)
    if abs(d.y) > 0.5:
        return (b * 0.5, a * 2, 0.0012)
    return (a * 2, 0.0012, b * 0.5)


def _scale(c1, d, r, at, ink=None):
    """Риски шкалы на кольце головки — со стороны зрителя (или сверху у головки, смотрящей на зрителя)."""
    ink = ink or mat('scaleink', rough=0.5)
    side = Vector((0, -1, 0)) if abs(d.y) < 0.5 else Vector((0, 0, 1))
    up = d.cross(side).normalized()
    for k in range(-3, 4):
        a = math.radians(k * 16)
        p = c1 + d * (at if k % 2 else at + 0.0015) + (side * math.cos(a) + up * math.sin(a)) * r
        ln = 0.004 if k % 2 else 0.007
        size = (0.0012, 0.0008, ln) if abs(d.z) > 0.5 else ((0.0012, ln, 0.0008) if abs(d.y) > 0.5 else (ln, 0.0008, 0.0012))
        box('риска', size, ink, tuple(p))


def _union_tail(x, z, sg, m, design):
    """Хвостовик клапана в патрубок (у дизайнерских — латунь с красным PTFE) и накидная гайка."""
    ax = 'X' if sg > 0 else '-X'
    if design:
        lathe('хвостовик PTFE', [(0.0105, 0), (0.0105, 0.004)], mat('ptfe', rough=0.6), (x - sg * 0.002, 0, z), ax, segs=32)
    hexnut('накидная гайка', 0.030, 0.012, m, (x + sg * 0.003, 0, z), ax, ch=0.14)
    return x + sg * 0.015


def valve(x_end, z, sg, thermo, angled, style='std', color='chrome', head='sht'):
    """Клапан на торце прибора (патрубок НР/ВР 1/2" — хвостовик клапана вкручен в патрубок или
    переходник набора). Угловой — выход к стене (+Y), шток к зрителю (−Y), головка горизонтально;
    прямой — выход наружу по оси прибора, шток вверх. Возвращает (точку выхода, ось выхода)."""
    design = style == 'design'
    m = finish(color) if design else M_NICKEL()
    part('node' if thermo else 'lock')
    xb = _union_tail(x_end, z, sg, m, design)
    axs = 'X' if sg > 0 else '-X'
    if angled:
        L = 0.054 if thermo else 0.050
        xv = x_end + sg * (L - 0.012)
        if design:
            box('корпус', (abs(xv - xb) + 0.024, 0.026, 0.026), m, ((xb + xv) / 2 + sg * 0.006, 0, z))
        else:
            lathe('корпус к оси', [(0.0100, 0), (0.0100, abs(xv - xb))], m, (xb, 0, z), axs, segs=40)
            lathe('корпус', [(0.0, -0.016), (0.0115, -0.016), (0.0122, -0.012), (0.0122, 0.012), (0.0115, 0.016), (0.0, 0.016)],
                  m, (xv, 0, z), 'Y', segs=40)
        out_c, out_ax = (xv, 0.013, z), 'Y'
        stem_ax, stem_c = '-Y', Vector((xv, -0.013 if design else -0.016, z))
    else:
        L = 0.054 if thermo else 0.067
        xe = x_end + sg * L
        xv = (xb + xe) / 2
        if design:
            box('корпус', (abs(xe - xb) - 0.008, 0.026, 0.026), m, ((xb + xe) / 2 - sg * 0.004, 0, z))
        else:
            lathe('корпус', [(0.0100, 0), (0.0112, 0.004), (0.0112, abs(xe - xb) - 0.004), (0.0100, abs(xe - xb))],
                  m, (xb, 0, z), axs, segs=40)
            lathe('прилив штока', [(0.0110, 0), (0.0110, 0.012)], m, (xv, 0, z), 'Z', segs=40)
        out_c, out_ax = (xe - sg * (0.008 if design else 0.0), 0, z), axs
        stem_ax, stem_c = 'Z', Vector((xv, 0, z + (0.013 if design else 0.012)))
    d = DIRS[stem_ax]
    if design:
        # выход ВР 1/2" — шестигранник в цвет
        hexnut('выход ВР 1/2', 0.026, 0.010, m, out_c, out_ax)
        out = Vector(out_c) + DIRS[out_ax] * 0.010
    else:
        lathe('выход 3/4" ЕК', [(0.0115, 0), (0.0115, 0.003)] + thread(0.0128, 0.010, start=0.003), m, out_c, out_ax, segs=40)
        out = Vector(out_c) + DIRS[out_ax] * 0.013
    if thermo:
        lathe('резьба M30x1,5', [(0.0150, 0), (0.0150, 0.008)], m, tuple(stem_c), stem_ax, segs=40)
        (shtd_head(tuple(stem_c + d * 0.008), stem_ax, color) if head == 'shtd' else sht_head(tuple(stem_c + d * 0.008), stem_ax))
        part('node')
    else:
        if design:
            # колпачок запорного Design — цилиндр в цвет (фото SVLD)
            lathe('колпачок', [(0.0, 0), (0.0130, 0), (0.0135, 0.003), (0.0135, 0.024), (0.0125, 0.027), (0.0, 0.028)], m,
                  tuple(stem_c), stem_ax, segs=48, sharp=40)
        else:
            lathe('шток', [(0.0090, 0), (0.0090, 0.006)], m, tuple(stem_c), stem_ax, segs=32)
            hexnut('колпачок', 0.025, 0.012, mat('headwhite', rough=0.45, coat=0.2), tuple(stem_c + d * 0.006), stem_ax, ch=0.18)
    marks['node' if thermo else 'lock'] = (xv, -0.014, z + 0.010)
    return tuple(out), out_ax


def pipe_end(loc, ax, style, key):
    """Присоединение трубы 16 к выходу клапана: евроконус (обычная арматура) или переходник 16 x НР 1/2"
    с монтажной гильзой (STOUT Design: у клапана ВР 1/2"). Возвращает начало трубы."""
    part('ek:' + key)
    d = DIRS[ax]
    p = Vector(loc)
    if style == 'design':
        br = M_BRASS()
        hexnut('переходник шестигранник', 0.024, 0.006, br, tuple(p), ax)
        p = p + d * 0.006
        lathe('штуцер', [(0.0075, 0), (0.0090, 0.004), (0.0075, 0.010), (0.0090, 0.014), (0.0075, 0.020)], br, tuple(p), ax, segs=32)
        lathe('гильза', [(0.0115, 0), (0.0115, 0.020), (0.0105, 0.022)], br, tuple(p + d * 0.001), ax, segs=40)
        return tuple(p + d * 0.022)
    if ax == 'Y':
        T = Matrix.Translation(p) @ Matrix.Rotation(math.pi / 2, 4, 'X')
    elif ax in ('X', '-X'):
        T = Matrix.Translation(p) @ Matrix.Rotation(-(1 if ax == 'X' else -1) * math.pi / 2, 4, 'Y')
    else:
        T = Matrix.Translation(p)
    transformed(T, ek_fit, (0, 0, 0), '-Z')
    return tuple(p + d * 0.0218)


def pipe_run(p0, sup, sg, angled, yw, z_bot, anch):
    """Труба 16 от евроконуса (переходника): угловой — в стену, поворот вниз в штробе на фиксаторе
    (5D), подача обходит обратку S-отводом; прямой — наружу, вниз к полу, поворот в стяжку на фиксаторе."""
    key = 's' if sup else 'r'
    pm = M_PLAST('ins_sup' if sup else 'ins_ret') if illus() else M_PLAST('pex')
    R = 0.078
    x, y0, z0 = p0
    if angled:
        yc = yw - 0.004
        pts = [(x, y0 - 0.004, z0), (x, yc, z0)]
        arc = [(x, yc + R * math.sin(t), z0 - R + R * math.cos(t)) for t in [k * math.pi / 2 / 14 for k in range(1, 15)]]
        tail = [(x, yc + R, -0.06)]
        if sup:
            zs, dx, h = z_bot + 0.100, sg * 0.045, 0.160
            tail = [(x + dx * (1 - math.cos(math.pi * k / 12)) / 2, yc + R, zs - h * k / 12) for k in range(13)] + [(x + dx, yc + R, -0.06)]
        part('tube:' + key)
        tube('труба 16', pts + arc + tail, 0.008, pm)
        part('fix:' + key)
        pipe_fixator90((x, yc, z0 - R), (0, 0, 1), (0, 1, 0), R)
        anch['fix:' + key] = (x, yc + R * math.sin(math.pi / 4), z0 - R + R * math.cos(math.pi / 4))
        part('sleeve:' + key)
        lathe('втулка', [(0.0098, 0), (0.0108, 0.002), (0.0108, 0.058), (0.0098, 0.060)],
              mat('sleeve_r' if sup else 'sleeve_b', rough=0.45), (x, yw - 0.030, z0), 'Y', segs=32)
        return
    xd = x + sg * (0.020 + (0.060 if sup else 0.0))
    pts = [(x - sg * 0.004, 0, z0), (xd, 0, z0)]
    arc1 = [(xd + sg * R * math.sin(t), 0, z0 - R + R * math.cos(t)) for t in [k * math.pi / 2 / 12 for k in range(1, 13)]]
    xv = xd + sg * R
    zc = -0.020 - R
    arc2 = [(xv, -R + R * math.cos(t), (zc + R) - R * math.sin(t)) for t in [k * math.pi / 2 / 14 for k in range(1, 15)]]
    part('tube:' + key)
    tube('труба 16', pts + arc1 + [(xv, 0, zc + R)] + arc2 + [(xv, -R - 0.06, zc)], 0.008, pm)
    part('fix:' + key)
    pipe_fixator90((xv, -R, zc + R), (0, 1, 0), (0, 0, -1), R)
    anch['fix:' + key] = (xv, -R + R * math.cos(math.pi / 4), zc + R - R * math.sin(math.pi / 4))
    part('sleeve:' + key)
    lathe('втулка', [(0.0098, 0), (0.0108, 0.002), (0.0108, 0.058), (0.0098, 0.060)],
          mat('sleeve_r' if sup else 'sleeve_b', rough=0.45), (xv, 0, -0.030), 'Z', segs=32)


def kit_reducer(x, z, sg, color):
    """Переходник 1" -> 1/2" из монтажного набора (фото SKU-0211: круглый, в цвет, с выступами под
    ключ по окружности) — вкручен в коллектор секции; возвращает торец (под хвостовик клапана)."""
    part('kit')
    m = finish(color)
    ax = 'X' if sg > 0 else '-X'
    lathe('переходник набора', [(0.0175, 0), (0.0185, 0.002), (0.0185, 0.010), (0.0130, 0.012), (0.0110, 0.012)], m,
          (x, 0, z), ax, segs=48, ribs=(8, 0.05, 0.002, 0.010))
    marks['kit'] = (x + sg * 0.006, -0.018, z + 0.010)
    return x + sg * 0.012


def kit_plug(x, z, sg, color):
    """Заглушка 1" из набора (фото: круглая, в цвет, с выступами по краю)."""
    part('kit')
    m = finish(color)
    ax = 'X' if sg > 0 else '-X'
    lathe('заглушка набора', [(0.0175, 0), (0.0185, 0.002), (0.0185, 0.010), (0.0140, 0.012), (0.0, 0.013)], m,
          (x, 0, z), ax, segs=48, ribs=(8, 0.05, 0.002, 0.010))


def kit_vent(x, z, sg, color):
    """Переходник 1" -> 1/2" с ручным воздухоотводчиком (кран Маевского) из набора."""
    xe = kit_reducer(x, z, sg, color)
    ax = 'X' if sg > 0 else '-X'
    lathe('кран Маевского', [(0.0070, 0), (0.0070, 0.010), (0.0050, 0.012), (0.0050, 0.016), (0.0, 0.017)], M_NICKEL(),
          (xe, 0, z), ax, segs=24)
    lathe('носик', [(0.0018, 0), (0.0018, 0.007)], M_NICKEL(), (xe + sg * 0.006, 0, z), '-Z', segs=12)
