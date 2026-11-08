# -*- coding: utf-8 -*-
"""
Кадры канализации санузла для сметы (раздел «8. Канализация») — по прибору, как смета кладёт позиции
(app.js, блок «Канализация»: трубы и фитинги по потребителям):
  * toilet — инсталляция (комплект из 8.1), отвод 110x87° SKB-0012-011087 в лежак, заглушка D110
    SKB-0005-000110 на выпуске инсталляции до установки унитаза;
  * basin  — раковина / биде: тройник 110x58 87° SKB-0016-115887 в лежаке, труба D58, 2 отвода 45°
    SKB-0010-005845 (уход в штробу), отвод 87° SKB-0012-005887 к выпуску в стене, заглушка D58;
  * shower — душ / ванна: тройник 110x58, труба D58 в полу, 2 отвода 45°, отвод 87° вверх к трапу/сифону,
    заглушка D58 на уровне пола;
  * wash   — стиральная / посудомоечная машина: тройник 110x58, труба D58 вверх, отвод 45° к комнате,
    заглушка D58;
  * main   — лежак D110 (трубы SKB-0002), ревизия с крышкой SKB-0014-000110, муфта двухраструбная
    SKB-0006-000110, 2 отвода 45° SKB-0010-011045 — выпуск вниз под перекрытие/фундамент, хомуты
    4" SAC-0020-010004 на шпильках M8 SAC-0020-400100.

    blender --background --python tools/render_sewer_node.py -- <папка> <вариант>

Источники: состав — app.js (блок раздела 8); размеры труб — бесшумная канализация STOUT SKB (наружный
диаметр 110 и 58 мм, раструб с уплотнительным кольцом), белая. Уклон лежака на кадре не показан (по
СП 30.13330 — 0,02 для D110 и 0,03 для D50; на кадре трубы горизонтальны условно), длины условные.
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
TAG = 'sw_' + VAR

add_colors({
    'sewwhite': (0.93, 0.93, 0.92),
    'sewgray': (0.74, 0.75, 0.77),
    'instframe': (0.36, 0.38, 0.41),
    'cistern': (0.95, 0.95, 0.94),
    'plugblk': (0.85, 0.86, 0.87),
})

YC = -0.090                # ось лежака (у стены; комната — −Y)
ZC = -0.120                # ось лежака под чистым полом
R110, R58 = 0.055, 0.029
ANCH = {}


def M_PIPE():
    return mat('sewwhite', rough=0.40, coat=0.25)


def V(*a):
    return Vector(a)


def pipe(name, a, b, r, sock=True):
    """Прямая труба от a к b; раструб у начала a (наружу на 8 % диаметра, длина 1,1 радиуса)."""
    part('tube')
    a, b = Vector(a), Vector(b)
    tube(name, [tuple(a), tuple(b)], r, M_PIPE())
    if sock:
        d = (b - a).normalized()
        tube('раструб', [tuple(a), tuple(a + d * r * 1.2)], r * 1.10, M_PIPE())


def bend(c, u, v, R, r, deg=87, key='ek'):
    """Отвод: дуга радиусом R вокруг центра c от направления u к v (угол deg), с раструбом на входе."""
    part(key)
    c, u, v = Vector(c), Vector(u).normalized(), Vector(v).normalized()
    a = math.radians(deg)
    n = 12
    pts = [tuple(c + (u * math.cos(a * k / n) + v * math.sin(a * k / n)) * R) for k in range(n + 1)]
    tube('отвод', pts, r * 1.02, M_PIPE())
    p0 = Vector(pts[0])
    t0 = (Vector(pts[1]) - p0).normalized()
    tube('раструб отвода', [tuple(p0 - t0 * r * 0.2), tuple(p0 + t0 * r * 1.1)], r * 1.12, M_PIPE())
    return Vector(pts[-1]), (Vector(pts[-1]) - Vector(pts[-2])).normalized()


def bend2(p, din, toward, R, r, deg=87, key='ek'):
    """Отвод от торца p, вход по направлению din, поворот в сторону toward на угол deg (радиус R по оси)."""
    p, din, toward = Vector(p), Vector(din).normalized(), Vector(toward)
    n = (toward - din * toward.dot(din)).normalized()      # к центру поворота
    c = p + n * R
    return bend(c, -n, din, R, r, deg, key)


def plug(c, d, r, key='head'):
    """Заглушка в раструбе: круглая крышка с язычком, светло-серая."""
    part(key)
    d = Vector(d).normalized()
    ob = lathe('заглушка', [(r * 1.14, 0), (r * 1.14, r * 0.25), (r * 0.9, r * 0.32), (0.0, r * 0.34)], mat('plugblk', rough=0.5), (0, 0, 0), 'Z', segs=48)
    ob.matrix_world = Matrix.Translation(Vector(c)) @ Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4()
    marks.setdefault(key, tuple(Vector(c) + d * r * 0.3 + V(0, 0, r * 0.6)))


def tee58(x, branch):
    """Тройник 110x58 87° на лежаке: корпус D110 с раструбом, отвод D58 в сторону branch. Возвращает
    торец отвода (раструб D58) и направление."""
    part('node')
    tube('тройник', [(x - 0.11, YC, ZC), (x + 0.07, YC, ZC)], R110 * 1.04, M_PIPE())
    tube('раструб тройника', [(x - 0.11, YC, ZC), (x - 0.04, YC, ZC)], R110 * 1.12, M_PIPE())
    d = Vector(branch).normalized()
    p0 = V(x, YC, ZC)
    tube('отвод тройника', [tuple(p0), tuple(p0 + d * (R110 + 0.045))], R58 * 1.04, M_PIPE())
    pe = p0 + d * (R110 + 0.045)
    tube('раструб 58', [tuple(pe - d * 0.035), tuple(pe)], R58 * 1.14, M_PIPE())
    marks['node'] = (x - 0.05, YC - R110 * 0.8, ZC + R110 * 0.6)
    return pe, d


def collector(x0, x1):
    pipe('лежак D110', (x0, YC, ZC), (x1, YC, ZC), R110, sock=False)
    ANCH['tube'] = ((x0 + x1) / 2, YC - R110, ZC)


def clamp(c, r, axis, key='fix'):
    """Хомут с резиновым вкладышем на шпильке M8 — к стене (+Y) или к полу (−Z)."""
    part(key)
    zn = metal('zinc')
    lathe('хомут', [(r + 0.006, 0), (r + 0.006, 0.020)], zn, tuple(Vector(c) - V(*{'X': (0.010, 0, 0), 'Z': (0, 0, 0.010)}[axis])), axis, segs=40, caps=False)
    lathe('вкладыш', [(r + 0.003, 0), (r + 0.003, 0.018)], mat('instframe', rough=0.7),
          tuple(Vector(c) - V(*{'X': (0.009, 0, 0), 'Z': (0, 0, 0.009)}[axis])), axis, segs=40, caps=False)
    c = Vector(c)
    if axis == 'X':        # горизонтальная труба — шпилька вниз в перекрытие
        tube('шпилька M8', [tuple(c - V(0, 0, r + 0.006)), tuple(c - V(0, 0, r + 0.090))], 0.004, zn)
    else:                  # вертикальная — шпилька к стене
        tube('шпилька M8', [tuple(c + V(0, r + 0.006, 0)), tuple(c + V(0, -c.y + 0.010, 0))], 0.004, zn)
    marks.setdefault(key, tuple(c + V(0, -r - 0.006, 0.010)))


def installation(x):
    """Инсталляция (комплект NOVAFLOW из сметы): стальная рама на стене, бачок, шпильки под чашу, выпуск
    D110 к комнате на высоте ~230 мм; внутри рамы — колено выпуска вниз к лежаку."""
    part('mf')
    fr = mat('instframe', rough=0.5)
    W, H = 0.50, 1.12
    for sx in (-1, 1):
        box('стойка рамы', (0.040, 0.050, H), fr, (x + sx * (W / 2 - 0.020), -0.030, H / 2))
    for z in (0.08, 0.40, H - 0.03):
        box('перекладина', (W, 0.040, 0.030), fr, (x, -0.030, z))
    box('бачок', (0.36, 0.090, 0.42), mat('cistern', rough=0.45), (x, -0.050, 0.78))
    for sx in (-1, 1):
        tube('шпилька чаши', [(x + sx * 0.090, -0.06, 0.40), (x + sx * 0.090, -0.17, 0.40)], 0.006, metal('zinc'))
    marks['mf'] = (x + 0.18, -0.10, 0.80)
    # выпуск инсталляции: горизонтальный патрубок к комнате и колено вниз
    zo = 0.230
    tube('выпуск инсталляции', [(x, -0.03, zo), (x, -0.20, zo)], R110 * 1.02, M_PIPE())
    tube('колено инсталляции', [(x, -0.03, zo), (x, -0.03, zo - 0.03)] +
         [(x, -0.03 - 0.06 * (1 - math.cos(t)), zo - 0.03 - 0.06 * math.sin(t)) for t in [k * math.pi / 2 / 8 for k in range(1, 9)]] +
         [(x, YC, ZC + 0.10)], R110 * 1.02, M_PIPE())
    plug(V(x, -0.20, zo), (0, -1, 0), R110)
    return V(x, YC, ZC + 0.10)


def room(x0, x1, h=0.80):
    part('')
    g = mat('sewwhite', rough=0.6, alpha=0.18)
    for name, size, loc in (('стена', (x1 - x0, 0.004, h), ((x0 + x1) / 2, 0.002, h / 2 - 0.05)),
                            ('пол', (x1 - x0, 0.45, 0.004), ((x0 + x1) / 2, -0.225, -0.002))):
        ob = box(name, size, g, loc)
        ob.modifiers.clear()
        for c in list(ob.users_collection):
            c.objects.unlink(ob)
        coll('sheath').objects.link(ob)


def build():
    sc = reset()
    if VAR == 'toilet':
        room(-0.40, 0.40, 1.25)
        top = installation(-0.10)
        # отвод 87° из вертикали в лежак (+X)
        e, d = bend2(top, (0, 0, -1), (1, 0, 0), 0.10, R110)
        collector(e.x, 0.36)
        marks['ek'] = (-0.03, YC - R110, ZC + 0.02)
    elif VAR == 'basin':
        room(-0.35, 0.35, 0.80)
        collector(-0.30, 0.30)
        pe, d = tee58(0.0, (0, 0, 1))
        # вверх, уход к стене двумя отводами 45°, вверх по штробе, отвод 87° к выпуску в стене (к комнате)
        p = pe + V(0, 0, 0.03)
        pipe('труба D58', pe, p, R58)
        e1, d1 = bend2(p, (0, 0, 1), (0, 1, 0), 0.06, R58, deg=45)
        p = e1 + d1 * 0.03
        pipe('труба D58', e1, p, R58)
        e2, d2 = bend2(p, d1, (0, 0, 1), 0.06, R58, deg=45)
        zt = 0.45
        p = V(e2.x, e2.y, zt - 0.06)
        pipe('труба D58', e2, p, R58)
        clamp(V(e2.x, e2.y, 0.22), R58, 'Z')
        e3, d3 = bend2(p, (0, 0, 1), (0, -1, 0), 0.06, R58)
        plug(e3, (0, -1, 0), R58)
        marks['ek'] = (e1.x + 0.03, e1.y - 0.02, e1.z)
    elif VAR == 'shower':
        room(-0.35, 0.35, 0.40)
        collector(-0.30, 0.30)
        pe, d = tee58(0.0, (0, -1, 0))
        # в полу к трапу: смещение двумя отводами 45°, отвод 87° вверх, заглушка на уровне пола
        p = pe + V(0, -0.08, 0)
        pipe('труба D58', pe, p, R58)
        e1, d1 = bend2(p, (0, -1, 0), (1, 0, 0), 0.08, R58, deg=45)
        p = e1 + d1 * 0.10
        pipe('труба D58', e1, p, R58)
        e2, d2 = bend2(p, d1, (0, -1, 0), 0.08, R58, deg=45)
        p = e2 + d2 * 0.08
        pipe('труба D58', e2, p, R58)
        e3, d3 = bend2(p, (0, -1, 0), (0, 0, 1), 0.07, R58)
        pipe('труба D58', e3, V(e3.x, e3.y, -0.012), R58)
        plug(V(e3.x, e3.y, -0.012), (0, 0, 1), R58)
        marks['ek'] = (e1.x + 0.02, e1.y, e1.z + 0.03)
    elif VAR == 'wash':
        room(-0.35, 0.35, 0.70)
        collector(-0.30, 0.30)
        pe, d = tee58(0.0, (0, 0, 1))
        zt = 0.42
        p = V(pe.x, pe.y, zt)
        pipe('труба D58', pe, p, R58)
        clamp(V(pe.x, pe.y, 0.20), R58, 'Z')
        e1, d1 = bend2(p, (0, 0, 1), (0, -1, 0), 0.06, R58, deg=45)
        plug(e1, d1, R58)
        marks['ek'] = (e1.x + 0.03, e1.y, e1.z - 0.03)
    else:   # main — лежак: ревизия, муфта, выпуск двумя отводами 45°, хомуты на шпильках
        room(-0.55, 0.65, 0.40)
        collector(-0.50, -0.12)
        part('lock')
        tube('ревизия', [(-0.12, YC, ZC), (0.08, YC, ZC)], R110 * 1.06, M_PIPE())
        lathe('люк ревизии', [(0.045, 0), (0.045, 0.012), (0.035, 0.016), (0.0, 0.017)], mat('plugblk', rough=0.5),
              (-0.02, YC - R110 * 1.02, ZC), '-Y', segs=40)
        marks['lock'] = (-0.02, YC - R110 - 0.01, ZC + 0.02)
        part('kit')
        tube('муфта', [(0.08, YC, ZC), (0.20, YC, ZC)], R110 * 1.12, M_PIPE())
        marks['kit'] = (0.14, YC - R110, ZC + 0.03)
        pipe('лежак D110', (0.20, YC, ZC), (0.36, YC, ZC), R110, sock=False)
        e1, d1 = bend2(V(0.36, YC, ZC), (1, 0, 0), (0, 0, -1), 0.12, R110, deg=45)
        p = e1 + d1 * 0.08
        pipe('труба D110', e1, p, R110)
        e2, d2 = bend2(p, d1, (0, 0, -1), 0.12, R110, deg=45)
        pipe('выпуск D110', e2, e2 + d2 * 0.12, R110)
        marks['ek'] = (e1.x, YC - R110, e1.z)
        for x in (-0.40, 0.28):
            clamp(V(x, YC, ZC), R110, 'X')
        ANCH['tube'] = (-0.32, YC - R110, ZC)
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
    # карта деталей: инсталляция R, отводы G, трубы B, ревизия Y, тройник C, хомуты M, заглушки W,
    # муфта — оранжевый
    ID = {'mf': (1, 0, 0), 'ek': (0, 1, 0), 'tube': (0, 0, 1), 'lock': (1, 1, 0), 'node': (0, 1, 1), 'fix': (1, 0, 1),
          'head': (1, 1, 1), 'kit': (1, 0.216, 0)}
    id_pass(sc, list(coll('solid').objects), ID, os.path.join(OUT, TAG + '_id.png'))
    write_meta(sc, os.path.join(OUT, TAG + '.json'), zones, pts, proj)


main()
