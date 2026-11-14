# -*- coding: utf-8 -*-
"""
Кадр «Котельная в сборе» — как «3D вид котельной» в проектах Galf: все узлы на своих местах в одной сцене и
соединены трубами, а не отдельными кадрами с обрезанными трубами.

    blender --background --python tools/render_room.py -- <папка> <вариант>
      вариант (пробный): haier1_2_ds_v_b200 — котёл Haier NeoSlim 1.24 Ti с обвязкой (render_boiler_node),
      коллектор SDG-0018 с группами d, s (render_hydro_node), бойлер OptiBase 200 л, бак ГВС 24 л, узел входа ХВС,
      термосмеситель (render_dhw_node).

Расстановка (по 3D-листам котельных Galf, 200 проектов, «3D вид котельной»): бойлер на полу слева, патрубками к
котлу; бак ГВС на стене над бойлером; котёл на стене справа от бойлера; коллектор с группами справа от котла, трубы
котла заходят в коллектор снизу; узел входа ХВС на стене между бойлером и котлом; термосмеситель над бойлером на
выходе ГВС. Змеевик бойлера — от котла (у Haier свой трёхходовой клапан: подача на бойлер I, обратка змеевика — в
общую обратку котла через тройник), как в руководстве Haier и в проектах Galf с одноконтурным котлом.

Узлы строятся своими построителями (те же детали, что на листах узлов), их трубы-обрезки укорачиваются до коротких
выходов, а между выходами этот файл прокладывает трубу 22 с поворотами по осям и тройником, где линии сходятся.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import blender_parts as bp
from blender_parts import *  # noqa: F401,F403
from mathutils import Vector, Matrix
import bpy

_argv = sys.argv[sys.argv.index('--') + 1:]
OUT, VAR = _argv[0], _argv[1]
TAG = 'room_' + VAR

STUB = 0.05            # длина выхода трубы, оставляемого у узла


def load(script, var):
    """Исполняет построитель узла как модуль (без main()) с вариантом var; возвращает его пространство имён."""
    path = os.path.join(HERE, script)
    src = open(path, encoding='utf-8').read()
    src = src.rsplit('\nmain()', 1)[0]
    old = sys.argv
    sys.argv = ['blender', '--', OUT, var]
    ns = {'__file__': path, '__name__': 'room_' + script}
    try:
        exec(compile(src, path, 'exec'), ns)
    finally:
        sys.argv = old
    return ns


def place(fn, M, ns=None):
    """Вызывает построитель fn и переносит всё, что он создал (и его метки, и выходы труб), матрицей M."""
    before = set(bpy.data.objects)
    mk0 = dict(bp.marks)
    stubs = []
    if ns is not None:
        orig = ns['pipe']

        def pipe(pts, *a, **k):
            pts = [Vector(p) for p in pts]
            # короткие внутренние трубки (между фитингами узла) — целиком, длинные обрезки — выходом STUB
            L = sum((pts[i + 1] - pts[i]).length for i in range(len(pts) - 1))
            if L > 0.12:
                # выход — прямой отрезок STUB по направлению первого заметного участка (дуги построителя не берём:
                # дальше трассу ведёт сборка, без лишних поворотов)
                i = 0
                while i < len(pts) - 2 and (pts[i + 1] - pts[i]).length < 0.006:
                    i += 1
                d = (pts[i + 1] - pts[i]).normalized()
                out = [pts[0], pts[0] + d * STUB]
                stubs.append((out[-1].copy(), d, pts, True))
                pts = out
            elif len(pts) >= 2:
                stubs.append((pts[-1].copy(), (pts[-1] - pts[-2]).normalized(), pts, False))
            return orig(pts, *a, **k)
        ns['pipe'] = pipe
        if 'bend' in ns:
            # колена построителя ГВС — прямым выходом по первому направлению (дальше трассу ведёт сборка)
            ns['bend'] = lambda p, d1, d2, L1, L2, R=0.040: [p, p + ns['AXV'][d1] * max(L1, STUB)]
    fn()
    if ns is not None:
        ns['pipe'] = orig
    # матрицы мира свежих объектов (масштаб box()) — только после пересчёта сцены, иначе куб детали теряет размер
    bpy.context.view_layer.update()
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        if o.name.startswith('стена') or o.type == 'CAMERA':
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        if o.parent is None:
            o.matrix_world = M @ o.matrix_world
    R3 = M.to_3x3()
    out_marks = {}
    for k, v in bp.marks.items():
        if k not in mk0 or mk0[k] != v:
            out_marks[k] = M @ Vector(v)
    bp.marks.clear()
    bp.marks.update(mk0)
    return [(M @ p, (R3 @ d).normalized(), [M @ q for q in full], cut) for p, d, full, cut in stubs], out_marks


def run(p, *pts):
    """Труба 22 по ломаной (повороты — уголки 90°, как пресс-фитинги RSS-1003)."""
    part('tube')
    pts = [Vector(p)] + [Vector(q) for q in pts]
    # убрать нулевые отрезки
    clean = [pts[0]]
    for q in pts[1:]:
        if (q - clean[-1]).length > 1e-4:
            clean.append(q)
    tube('труба 22', [tuple(q) for q in clean], 0.011, M_SATIN())
    st = M_SATIN()
    for i in range(1, len(clean) - 1):
        lathe('уголок 22', [(0.0, 0), (0.0150, 0), (0.0150, 0.001), (0.0, 0.001)], st, tuple(clean[i]), 'Z', segs=24)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0150, location=tuple(clean[i]), segments=24, ring_count=12)
        s = bpy.context.active_object
        s.data.materials.append(st)
        for cl in list(s.users_collection):
            cl.objects.unlink(s)
        coll('solid').objects.link(s)
        s['part'] = 'tube'
    for q in (clean[0], clean[-1]):
        lathe('пресс-кольцо', [(0.0158, -0.010), (0.0158, 0.010)], mat('redring', rough=0.4), tuple(q), 'Z', segs=24) if False else None


def tee_at(p):
    part('tube')
    st = M_SATIN()
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0175, location=tuple(p), segments=24, ring_count=12)
    s = bpy.context.active_object
    s.data.materials.append(st)
    for cl in list(s.users_collection):
        cl.objects.unlink(s)
    coll('solid').objects.link(s)
    s['part'] = 'tube'


def T(x, y, z):
    return Matrix.Translation(Vector((x, y, z)))


def build():
    sc = reset()
    part('')
    add_colors({'redring': (0.85, 0.15, 0.13), 'roomwall': (0.93, 0.93, 0.92), 'roomfloor': (0.80, 0.78, 0.74)})
    # помещение: стена и пол (как на листах Galf — серые плоскости)
    wall = box('стена комнаты', (3.2, 0.02, 2.4), mat('roomwall', rough=0.9), (0.25, 0.010, 1.20))
    floor = box('пол комнаты', (3.2, 1.2, 0.02), mat('roomfloor', rough=0.9), (0.25, -0.60, -0.010))
    for o in (wall, floor):
        o.modifiers.clear()
        for cl in list(o.users_collection):
            cl.objects.unlink(o)
        coll('sheath').objects.link(o)

    # ── котёл с обвязкой: низ котла на 1,5 м (листы «Вид котельной спереди» Galf: 1500–1556) ───────────
    KX, KZ = 0.25, 1.50
    nb = load('render_boiler_node.py', 'haier1')
    nb['reset'] = lambda: bpy.context.scene
    nb['gas_line'] = lambda *a, **k: None                       # газ — по проекту газоснабжения, на схеме не нужен
    _stab = nb['stab250']
    # стабилизатор — на стене слева от котла, на высоте его середины (на полочке), а не на полу под котлом
    nb['stab250'] = lambda x, z, y=None: _stab(-0.17, 0.30)
    kst, kmk = place(nb['build'], T(KX, 0, KZ), nb)
    kst = [s for s in kst if s[3]]                               # только выходы (внутренние трубки узла — нет)
    kst.sort(key=lambda s: s[0].x)
    k_sup, k_dhw, k_ret = kst[0], kst[1], kst[-1]                # подача A, на бойлер I, обратка G (выход фильтра вбок)
    YK = k_sup[0].y                                              # плоскость труб котла

    # ── гидравлика: коллектор на уровне низа котла, группы вверх рядом с котлом ─────────────────────────
    HX, HZ = 1.07, 1.58
    nh = load('render_hydro_node.py', '2_ds_v')
    nh['reset'] = lambda: bpy.context.scene
    _, hmk = place(nh['build'], T(HX, 0, HZ))
    B = 0.200
    YA = nh['YA']
    zport = HZ + nh['ZC'] - nh['CH'] / 2 - 0.022 - 0.0485          # низ муфт 1 1/2" x 1" к котлу
    c_sup = Vector((HX - B / 2, YA, zport))                        # подача — левый нижний (паспорт SDG, п. 5)
    c_ret = Vector((HX + B / 2, YA, zport))

    # ── бойлер на полу слева, патрубками к котлу (поворот 180° вокруг своей оси) ──────────────────────────
    BX = -0.66
    nd = load('render_dhw_node.py', 'b200')
    nd['reset'] = lambda: bpy.context.scene
    R = nd['OPTI'][200]['D'] / 2
    yc = nd['YW'] - 0.050 - R
    Mb = T(BX, yc, 0) @ Matrix.Rotation(math.pi, 4, 'Z') @ T(0, -yc, 0)
    bst, bmk = place(nd['build'], Mb, nd)
    hot = [s for s in bst if s[1].z > 0.5][0]
    side = sorted([s for s in bst if s[1].z <= 0.5], key=lambda s: -s[0].z)
    b_cin, b_cout, b_cold = side[0], side[1], side[-1]

    # ── узел входа ХВС на стене справа от бойлера ─────────────────────────────────────────────────────────
    GX, GZ = 0.02, 0.12
    ng = load('render_dhw_node.py', 'g')
    ng['reset'] = lambda: bpy.context.scene
    gst, gmk = place(ng['build'], T(GX, 0, GZ), ng)
    g_top = [s for s in gst if s[1].z > 0.5][0]
    g_br = sorted([s for s in gst if s[1].z <= 0.5], key=lambda s: s[0].z)   # ниже — бак, выше — подмес
    g_tank, g_mix = g_br[0], g_br[-1]

    # ── бак ГВС на стене над бойлером, на высоте котла ────────────────────────────────────────────────────
    TX = BX
    nt = load('render_dhw_node.py', 't24')
    nt['reset'] = lambda: bpy.context.scene
    tst, tmk = place(nt['build'], T(TX, 0, 1.56), nt)
    t_out = tst[0]

    # ── термосмеситель над бойлером: горячий вход прямо над выходом ГВС бойлера ───────────────────────────
    nm = load('render_dhw_node.py', 'mix')
    nm['reset'] = lambda: bpy.context.scene
    _, mmk0 = None, None
    MZ = 1.40
    probe = nm['mixer']
    # смещение по x: конец горячего входа ровно над патрубком ГВС бойлера (одна вертикаль и один поворот)
    mst0, _ = place(lambda: None, T(0, 0, 0))
    MX = hot[0].x + 0.205
    mst, mmk = place(nm['build'], T(MX, 0, MZ), nm)
    m_hot = min(mst, key=lambda s: s[0].x)
    m_cold = max(mst, key=lambda s: s[0].x)

    # ── трассы трубы 22: по осям, у каждой не больше двух поворотов в плоскости стены ─────────────────────
    # подача A: вниз под котёл, вперёд в плоскость коллектора, вправо и вверх в левый нижний патрубок
    p = k_sup[0]
    zs = p.z
    run(p, (p.x, YA, zs), (c_sup.x, YA, zs), c_sup)
    # обратка: выход фильтра вбок — прямо вправо (фильтр сам даёт поворот), у коллектора вперёд и вверх в патрубок
    p = k_ret[0]
    run(p, (c_ret.x, p.y, p.z), (c_ret.x, YA, p.z), c_ret)
    # подача на бойлер I: вниз до уровня 1,0 м, влево до бойлера, вперёд к оси бойлера и вниз в верхний патрубок змеевика
    p, q = k_dhw[0], b_cin[0]
    zc1 = 1.02
    run(p, (p.x, p.y, zc1), (q.x, p.y, zc1), (q.x, q.y, zc1), q)
    # обратка змеевика: вверх до 0,94, к котлу и вверх тройником в обратку (между фильтром и коллектором)
    q = b_cout[0]
    xt = (k_ret[0].x + c_sup.x) / 2 - 0.06
    zc2 = 0.94
    run(q, (q.x + 0.05, q.y, q.z), (q.x + 0.05, q.y, zc2), (q.x + 0.05, YK, zc2), (xt, YK, zc2), (xt, YK, k_ret[0].z))
    tee_at(Vector((xt, YK, k_ret[0].z)))
    # ХВС: верх узла входа -> нижний патрубок бойлера (влево и вниз)
    p, q = g_top[0], b_cold[0]
    zh = p.z + 0.05
    run(p, (p.x, p.y, zh), (q.x + 0.05, p.y, zh), (q.x + 0.05, q.y, zh), (q.x + 0.05, q.y, q.z), q)
    # бак ГВС: опуск прямо вниз за бойлером до 1,32 м, вправо за узел входа и вниз к отводу бака
    p, q = t_out[0], g_tank[0]
    xd = GX + 0.11
    zb = 1.33
    run(p, (p.x, p.y, zb), (xd, p.y, zb), (xd, q.y - 0.03, zb), (xd, q.y - 0.03, q.z), (q.x, q.y - 0.03, q.z), q)
    # ГВС: верх бойлера прямо вверх в горячий вход термосмесителя
    p, q = hot[0], m_hot[0]
    run(p, (p.x, p.y, q.z), (q.x, q.y, q.z) if abs(p.y - q.y) < 1e-3 else (p.x, q.y, q.z), q)
    # подмес: отвод тройника подмеса — вперёд, вверх до термосмесителя и влево в холодный вход
    p, q = g_mix[0], m_cold[0]
    run(p, (p.x, p.y - 0.03, p.z), (p.x, p.y - 0.03, q.z), (q.x, p.y - 0.03, q.z), (q.x, q.y, q.z), q)
    return sc


def main():
    sc = build()
    cam = camera(sc, objects=list(coll('solid').objects) + list(coll('sheath').objects))
    sc.render.film_transparent = False
    freestyle(sc, 'solid', LINE_COLOR, 1.6)
    render(sc, os.path.join(OUT, TAG + '_solid.png'))


main()
