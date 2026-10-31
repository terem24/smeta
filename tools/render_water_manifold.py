# -*- coding: utf-8 -*-
"""
Кадр узла коллектора водоснабжения для сметы — в стиле листов «Обвязка коллекторов».

Состав кадра — ровно тот, что кладёт в смету раздел 5 (render, _addLineManifolds):
гребёнка собрана из блоков SMB 6850 на 4/3/2 выхода, на каждый выход евроконус и
труба в теплоизоляции, на торце компенсатор гидроудара с футоркой (или заглушка),
коллектор держат два хомута 1" на шпильках M8. У ХВС слева подводка из раздела 6.4:
удлинитель 30 мм, ниппель, сгон, кран шаровой, тройник на линии ввода.

Каждый объект помечен ключом детали (ob['part']): по ним считаются зоны кадра, на
которые смета вешает подсветку строк. Запуск — из tools/build_water_manifold.py:

    blender --background --python tools/render_water_manifold.py -- <dir> <line> <n> <end>
      line — cw | hw | rc     (ХВС, ГВС, рециркуляция)
      n    — точек на линии (1…12)
      end  — hammer | plug     (что стоит в торце)
      type — st | rm            (STOUT SMB 6850: головки сверху, отводы вперёд;
                                 ROMMER RMB-0004: головки сверху, отводы вниз 90°)
"""
import bpy
import bmesh
import json
import math
import os
import sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, LINE, N, END = argv[0], argv[1], int(argv[2]), argv[3]
TYPE = argv[4] if len(argv) > 4 else 'st'
TAG = '%s_%s_%d_%s' % (TYPE, LINE, N, END)

# цвета — как на экране (sRGB); Blender считает в линейном пространстве
C = {
    'nickel': (0.84, 0.85, 0.86),
    'brass': (0.98, 0.76, 0.26),
    'green': (0.16, 0.56, 0.27),
    'red': (0.85, 0.12, 0.15),
    'blue': (0.14, 0.22, 0.70),
    'white': (0.97, 0.97, 0.97),
    'black': (0.10, 0.10, 0.11),
    'rubber': (0.12, 0.12, 0.13),
    'capblack': (0.13, 0.13, 0.14),
    'pinkdisc': (0.93, 0.80, 0.80),
    'cw': (0.16, 0.56, 0.90),
    'hw': (0.98, 0.60, 0.06),
    'rc': (0.90, 0.36, 0.66),
    # изоляция 18/6 в смете синяя (ХВС) и красная (ГВС, рециркуляция), труба PEX-a серая
    'ins_cw': (0.18, 0.46, 0.90),
    'ins_hw': (0.88, 0.20, 0.20),
    'pex': (0.66, 0.68, 0.71),
}


def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


C = {k: tuple(_lin(x) for x in v) for k, v in C.items()}
KNOB = 'blue' if LINE == 'cw' else 'red'
INS = 'ins_cw' if LINE == 'cw' else 'ins_hw'

P = 0.050          # шаг выходов SMB 6850
RB = 0.0165        # радиус корпуса 1"
PART = ['']        # ключ детали для создаваемых объектов
marks = {}


def part(key):
    PART[0] = key


def split(n):
    """Блоки гребёнки, как в смете (_qSplit): 4-ки, остаток 3 или 2; 5 = 3 + 2."""
    q4, rem = n // 4, n % 4
    q3 = q2 = 0
    if rem == 3:
        q3 = 1
    elif rem == 2:
        q2 = 1
    elif rem == 1:
        if q4 > 0:
            q4 -= 1
            q3 = q2 = 1
        else:
            q2 = 1
    return [4] * q4 + [3] * q3 + [2] * q2


# ── сцена ────────────────────────────────────────────────────────────────

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    try:
        sc.eevee.taa_render_samples = 48
    except Exception:
        pass
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    # Мир: в кадре чисто белый фон, а в отражениях металла — градиент «светлый
    # верх / серый низ». Без него никель и латунь плоские.
    w = bpy.data.worlds.new('W')
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    lp = nt.nodes.new('ShaderNodeLightPath')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    mr = nt.nodes.new('ShaderNodeMapRange')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    mr.inputs['From Min'].default_value = -1
    mr.inputs['From Max'].default_value = 1
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    els = ramp.color_ramp.elements
    els[0].position = 0.30
    els[0].color = (0.30, 0.31, 0.33, 1)
    els[1].position = 0.62
    els[1].color = (1, 1, 1, 1)
    els.new(0.50).color = (0.62, 0.63, 0.66, 1)
    nt.links.new(lp.outputs['Is Camera Ray'], mix.inputs['Factor'])
    nt.links.new(ramp.outputs['Color'], mix.inputs[6])
    mix.inputs[7].default_value = (1, 1, 1, 1)
    nt.links.new(mix.outputs[2], bg.inputs['Color'])
    sc.world = w
    for name, energy, rot in (('key', 1.3, (math.radians(50), 0, math.radians(-35))),
                              ('rim', 0.5, (math.radians(-60), 0, math.radians(150)))):
        d = bpy.data.lights.new(name, 'SUN')
        d.energy = energy
        d.angle = math.radians(20)
        d.use_shadow = False
        ob = bpy.data.objects.new(name, d)
        ob.rotation_euler = rot
        sc.collection.objects.link(ob)
    return sc


MATS = {}


def mat(key, rough=0.4, metal=0.0, alpha=1.0, coat=0.0):
    k = (key, rough, metal, alpha, coat)
    if k in MATS:
        return MATS[k]
    m = bpy.data.materials.new('m_%s_%d' % (key, len(MATS)))
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = C[key] + (1,)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    try:
        b.inputs['Coat Weight'].default_value = coat
    except Exception:
        pass
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    MATS[k] = m
    return m


def M_NICKEL():
    return mat('nickel', rough=0.38, metal=0.42)


def M_BRASS():
    return mat('brass', rough=0.30, metal=0.45)


def M_PLAST(c):
    return mat(c, rough=0.30, coat=0.6)


COLL = {}


def coll(name):
    if name not in COLL:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
        COLL[name] = c
    return COLL[name]


def link(ob, group='solid'):
    coll(group).objects.link(ob)
    ob['part'] = PART[0]
    return ob


AXIS = {
    'Z': Matrix.Identity(4),
    '-Z': Matrix.Rotation(math.pi, 4, 'X'),
    'X': Matrix.Rotation(math.pi / 2, 4, 'Y'),
    '-X': Matrix.Rotation(-math.pi / 2, 4, 'Y'),
    '-Y': Matrix.Rotation(math.pi / 2, 4, 'X'),
    'Y': Matrix.Rotation(-math.pi / 2, 4, 'X'),
}


def lathe(name, prof, m, loc=(0, 0, 0), axis='Z', segs=48, sharp=35, group='solid', rot=0.0,
          knurl=None, caps=True):
    """Тело вращения по профилю [(r, h), ...] снизу вверх вдоль оси."""
    bm = bmesh.new()
    rings = []
    for r, h in prof:
        ring = []
        for i in range(segs):
            a = 2 * math.pi * i / segs + rot
            rr = r * (1.025 if knurl and r >= knurl and i % 2 else 1.0)
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), h)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if caps and prof[0][0] > 1e-6:
        bm.faces.new(list(reversed(rings[0])))
    if caps and prof[-1][0] > 1e-6:
        bm.faces.new(rings[-1])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(m)
    me.shade_smooth()
    try:
        me.set_sharp_from_angle(angle=math.radians(sharp))
    except Exception:
        pass
    ob = bpy.data.objects.new(name, me)
    ob.matrix_world = Matrix.Translation(Vector(loc)) @ AXIS[axis]
    return link(ob, group)


def sector(name, r_in, r_out, h, a0, a1, m, loc, axis, seg=24):
    """Сектор кольца толщиной h вдоль оси; углы в градусах в плоскости XY."""
    bm = bmesh.new()
    vs = []
    for k in range(seg + 1):
        a = math.radians(a0 + (a1 - a0) * k / seg)
        c, s_ = math.cos(a), math.sin(a)
        vs.append([bm.verts.new((r * c, r * s_, z)) for r, z in
                   ((r_in, 0), (r_out, 0), (r_out, h), (r_in, h))])
    for a, b in zip(vs, vs[1:]):
        for j in range(4):
            bm.faces.new((a[j], a[(j + 1) % 4], b[(j + 1) % 4], b[j]))
    bm.faces.new(list(reversed(vs[0])))
    bm.faces.new(vs[-1])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(m)
    me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    ob.matrix_world = Matrix.Translation(Vector(loc)) @ AXIS[axis]
    return link(ob)


def hexnut(name, af, h, m, loc, axis='Z', ch=0.12):
    """Шестигранник с фаской: профиль по описанной окружности, 6 граней."""
    R = af / 2 / math.cos(math.pi / 6)
    c = h * ch
    prof = [(R * 0.86, 0), (R, c), (R, h - c), (R * 0.86, h)]
    return lathe(name, prof, m, loc, axis, segs=6, sharp=20, rot=math.pi / 6)


def box(name, size, m, loc):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    ob.data.materials.append(m)
    bev = ob.modifiers.new('bev', 'BEVEL')
    bev.width = min(size) * 0.25
    bev.segments = 3
    for c in ob.users_collection:
        c.objects.unlink(ob)
    return link(ob)


def tube(name, pts, r, m, group='solid'):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (p[0], p[1], p[2], 1)
    cu.bevel_depth = r
    cu.bevel_resolution = 8
    cu.use_fill_caps = True
    ob = bpy.data.objects.new(name, cu)
    ob.data.materials.append(m)
    return link(ob, group)


def dot(loc, r=0.0011):
    """Тёмная метка-точка (смотровые отверстия, обжим), как на листах-образцах."""
    lathe('точка', [(0.0, 0), (r, 0), (r, 0.0008), (0.0, 0.0008)], mat('black', rough=0.6),
          loc, '-Y', segs=16)


# ── детали ───────────────────────────────────────────────────────────────

def block(j, bx0, bx1):
    """Блок гребёнки: трубка 1" с резьбовыми концами; на правом — шестигранник стыка."""
    part('mf:%d' % j)
    L = bx1 - bx0
    lathe('корпус', [(0.0, 0), (0.0150, 0), (0.0158, 0.002), (RB, 0.004),
                     (RB, L - 0.004), (0.0158, L - 0.002), (0.0150, L), (0.0, L)],
          M_NICKEL(), (bx0, 0, 0), 'X', segs=64)
    hexnut('шестигранник блока', 0.036, 0.010, M_NICKEL(), (bx1 - 0.010, 0, 0), 'X')


def outlet(i, x, used):
    """Вентиль выхода и, если выход занят, евроконус и труба — по типу коллектора.

    STOUT SMB 6850 (фото каталога): головка сверху — зелёный рифлёный колпак с розовым
    диском и цветной меткой, отвод 3/4" ЕК смотрит вперёд; труба уходит вперёд и вниз.
    ROMMER RMB-0004: головка сверху — чёрный рифлёный колпак с цветным верхом и белыми
    метками, отвод вниз под 90°.
    """
    part('mf:%d' % BLOCK_OF[i])
    lathe('шейка', [(0.0118, 0), (0.0118, 0.010), (0.0126, 0.011)], M_NICKEL(), (x, 0, RB - 0.003), 'Z')
    zc = RB + 0.008
    if TYPE == 'rm':
        lathe('колпак', [(0.0150, 0), (0.0188, 0.002), (0.0192, 0.004), (0.0192, 0.019),
                         (0.0184, 0.021), (0.0, 0.021)],
              M_PLAST('capblack'), (x, 0, zc), 'Z', sharp=50, segs=72, knurl=0.0190)
        lathe('верх', [(0.0, 0), (0.0172, 0), (0.0172, 0.0025), (0.0160, 0.0035), (0.0, 0.0035)],
              M_PLAST(KNOB), (x, 0, zc + 0.021), 'Z', sharp=50, segs=64)
        top = zc + 0.0245
    else:
        lathe('колпак', [(0.0150, 0), (0.0176, 0.002), (0.0182, 0.004), (0.0182, 0.017),
                         (0.0170, 0.020), (0.0, 0.020)],
              M_PLAST('green'), (x, 0, zc), 'Z', sharp=50, segs=72, knurl=0.0180)
        lathe('диск', [(0.0, 0), (0.0130, 0), (0.0130, 0.0016), (0.0, 0.0016)],
              M_PLAST('pinkdisc'), (x, 0, zc + 0.020), 'Z', segs=48)
        top = zc + 0.0216
    lathe('метка', [(0.0, 0), (0.0040, 0), (0.0040, 0.0012), (0.0, 0.0012)],
          M_PLAST('white' if TYPE == 'rm' else KNOB), (x, 0, top), 'Z', segs=32)
    lathe('штифт', [(0.0, 0), (0.0016, 0), (0.0016, 0.0020), (0.0, 0.0024)], M_NICKEL(),
          (x, 0, top + 0.0012), 'Z', segs=16)
    box('стрелка', (0.0030, 0.0110, 0.0012), M_PLAST('white'), (x, -0.0055, top + 0.0006))
    if TYPE == 'rm':
        for a0, a1 in ((200, 245), (295, 340)):
            sector('дуга', 0.0110, 0.0128, 0.0010, a0, a1, M_PLAST('white'), (x, 0, top), 'Z', seg=12)
    if i == 0:
        marks['mf'] = (x, 0, top)
    forward = TYPE != 'rm'
    if forward:
        # отвод вперёд: резьбовой штуцер 3/4" на зрителя
        lathe('штуцер', [(0.0122, 0), (0.0122, 0.003), (0.0116, 0.004), (0.0122, 0.005),
                         (0.0122, 0.008), (0.0116, 0.009), (0.0122, 0.010), (0.0122, 0.014)],
              M_NICKEL(), (x, -RB + 0.002, 0), '-Y')
    else:
        lathe('штуцер', [(0.0122, 0), (0.0122, 0.004), (0.0116, 0.005), (0.0122, 0.006),
                         (0.0122, 0.010), (0.0116, 0.011), (0.0122, 0.012), (0.0122, 0.016)],
              M_NICKEL(), (x, 0, -RB + 0.002), '-Z')
    if not used:
        return
    part('ek:%d' % i)
    if forward:
        y0 = -RB - 0.012
        hexnut('гайка ЕК', 0.032, 0.014, M_BRASS(), (x, y0, 0), '-Y')
        lathe('втулка ЕК', [(0.0122, 0), (0.0122, 0.008), (0.0111, 0.009), (0.0111, 0.011),
                            (0.0122, 0.012), (0.0122, 0.024), (0.0113, 0.026), (0.0104, 0.027)],
              M_BRASS(), (x, y0 - 0.014, 0), '-Y')
        dot((x, y0 - 0.0195, 0.0123), r=0.0011) if False else None
        y1 = y0 - 0.041
        R_ = 0.045
        pts = [(x, y1, 0), (x, y1 - 0.006, 0)]
        for k in range(1, 17):
            t = k / 16 * math.pi / 2
            pts.append((x, y1 - 0.006 - R_ * math.sin(t), -R_ + R_ * math.cos(t)))
        pts.append((x, y1 - 0.006 - R_, -0.30))
    else:
        z0 = -RB - 0.012
        hexnut('гайка ЕК', 0.032, 0.014, M_BRASS(), (x, 0, z0), '-Z')
        lathe('втулка ЕК', [(0.0122, 0), (0.0122, 0.008), (0.0111, 0.009), (0.0111, 0.011),
                            (0.0122, 0.012), (0.0122, 0.024), (0.0113, 0.026), (0.0104, 0.027)],
              M_BRASS(), (x, 0, z0 - 0.014), '-Z')
        dot((x, -0.0123, z0 - 0.0195))
        dot((x, -0.0123, z0 - 0.0315))
        pts = [(x, 0, z0 - 0.041), (x, 0, -0.30)]
    # труба 16 и теплоизоляция 18/6: изоляция полупрозрачная, сквозь неё видна серая труба
    part('tube:%d' % i)
    tube('труба16', pts, 0.008, M_PLAST('pex'))
    sp = [pts[0]] + pts[1:-1] + [(pts[-1][0], pts[-1][1], pts[-1][2] - 0.012)]
    tube('изоляция', sp, 0.0118, mat(INS, rough=0.35, alpha=0.62), group='sheath')


def clamp(k, xc):
    """Хомут одновинтовой 1" на корпусе и шпилька M8x100 к стене."""
    part('clamp:%d' % k)
    lathe('резинка', [(0.0, 0), (0.0200, 0), (0.0200, 0.010), (0.0, 0.010)], mat('rubber', rough=0.7),
          (xc - 0.005, 0, 0), 'X')
    lathe('лента', [(0.0, 0), (0.0222, 0), (0.0222, 0.006), (0.0, 0.006)], M_NICKEL(),
          (xc - 0.003, 0, 0), 'X')
    box('ушко хомута', (0.008, 0.012, 0.010), M_NICKEL(), (xc, 0.022, -0.004))
    hexnut('гайка M8', 0.013, 0.007, M_NICKEL(), (xc, 0.028, -0.004), 'Y')
    marks['clamp:%d' % k] = (xc, 0.004, 0.022)
    part('stud:%d' % k)
    tube('шпилька', [(xc, 0.030, -0.004), (xc, 0.115, -0.004)], 0.0036, M_NICKEL())
    lathe('дюбель', [(0.0, 0), (0.0055, 0), (0.0055, 0.03), (0.004, 0.034), (0.0, 0.034)],
          mat('white', rough=0.6), (xc, 0.090, -0.004), 'Y')
    marks['stud:%d' % k] = (xc, 0.075, -0.004)


def end_part_left(xe):
    """Торец слева: футорка и компенсатор (или заглушка) уходят влево от коллектора."""
    global AX_END
    AX_END = '-X'
    end_part(xe, -1)


AX_END = 'X'


def end_part(xe, sg=1):
    """Торец: футорка 3/4" x 1/2" и компенсатор гидроудара либо заглушка."""
    if END == 'hammer':
        part('fut')
        hexnut('футорка', 0.032, 0.010, M_BRASS(), (xe, 0, 0), AX_END)
        lathe('футорка резьба', [(0.0100, 0), (0.0100, 0.006)], M_BRASS(), (xe + sg * 0.010, 0, 0), AX_END)
        marks['fut'] = (xe + sg * 0.005, 0, 0.015)
        part('end')
        hexnut('компенсатор шестигр.', 0.024, 0.008, M_NICKEL(), (xe + sg * 0.016, 0, 0), AX_END)
        lathe('компенсатор', [(0.0110, 0), (0.0128, 0.002), (0.0128, 0.040), (0.0120, 0.044),
                              (0.0090, 0.047), (0.0, 0.048)], M_NICKEL(), (xe + sg * 0.024, 0, 0), AX_END, sharp=40)
        marks['end'] = (xe + sg * 0.050, 0, 0.012)
    else:
        part('end')
        hexnut('заглушка', 0.032, 0.012, M_NICKEL(), (xe, 0, 0), AX_END)
        lathe('заглушка торец', [(0.0150, 0), (0.0150, 0.003), (0.0120, 0.005), (0.0, 0.005)],
              M_NICKEL(), (xe + sg * 0.012, 0, 0), AX_END)
        marks['end'] = (xe + sg * 0.012, 0, 0.014)


def feed_side(xr):
    """Подводка с торца коллектора — как на листе «Узел обвязки коллектора водоснабжения»
    проектов-образцов: удлинитель 1" 30 мм, угловой сгон вниз, кран шаровой на вертикали,
    ниппель, подающая труба вниз и угольник у пола. У ХВС эти позиции — раздел 6.4 сметы,
    у ГВС и рециркуляции подача идёт не из раздела 5 и ключей деталей не получает."""
    keyed = LINE == 'cw'
    part('ext' if keyed else '')
    lathe('удлинитель', [(0.0170, 0), (0.0170, 0.022), (0.0185, 0.023), (0.0185, 0.030)],
          M_NICKEL(), (xr, 0, 0), 'X', segs=48)
    hexnut('удлинитель шестигр.', 0.036, 0.008, M_NICKEL(), (xr + 0.030, 0, 0), 'X')
    marks['ext'] = (xr + 0.015, 0, 0.018)
    x = xr + 0.038
    part('union' if keyed else '')
    lathe('сгон гайка', [(0.0190, 0), (0.0215, 0.002), (0.0215, 0.016), (0.0190, 0.018)],
          M_NICKEL(), (x, 0, 0), 'X', segs=40, sharp=40)
    R_ = 0.024
    knee = [(x + 0.016, 0, 0)]
    knee += [(x + 0.016 + R_ * math.sin(t), 0, -R_ + R_ * math.cos(t))
             for t in [k * math.pi / 2 / 14 for k in range(0, 15)]]
    xv = x + 0.016 + R_
    knee += [(xv, 0, -R_ - 0.010)]
    tube('сгон угловой', knee, 0.0180, M_NICKEL())
    marks['union'] = (xv, 0, -0.006)
    z = -R_ - 0.010
    part('ball' if keyed else '')
    hexnut('кран ВН', 0.034, 0.012, M_NICKEL(), (xv, 0, z), '-Z')
    lathe('корпус крана', [(0.0165, 0), (0.0188, 0.002), (0.0188, 0.034), (0.0170, 0.036)],
          M_NICKEL(), (xv, 0, z - 0.012), '-Z')
    hexnut('кран НР', 0.030, 0.010, M_NICKEL(), (xv, 0, z - 0.048), '-Z')
    zc = z - 0.030
    lathe('шток', [(0.0045, 0), (0.0045, 0.008)], M_NICKEL(), (xv, -0.018, zc), '-Y')
    lathe('ступица', [(0.0, 0), (0.0068, 0), (0.0068, 0.006), (0.0, 0.006)],
          mat('red', rough=0.4, coat=0.4), (xv, -0.026, zc), '-Y')
    for s_ in (-1, 1):
        box('крыло', (0.016, 0.005, 0.012), mat('red', rough=0.4, coat=0.4), (xv + s_ * 0.013, -0.029, zc))
    marks['ball'] = (xv + 0.010, -0.030, zc)
    z2 = z - 0.058
    part('nip' if keyed else '')
    hexnut('ниппель', 0.030, 0.010, M_NICKEL(), (xv, 0, z2), '-Z')
    lathe('ниппель резьба', [(0.0125, 0), (0.0125, 0.010)], M_NICKEL(), (xv, 0, z2 - 0.010), '-Z')
    marks['nip'] = (xv, 0, z2 - 0.005)
    part('')
    z3 = z2 - 0.020
    hexnut('пресс-фитинг', 0.030, 0.010, M_BRASS(), (xv, 0, z3), '-Z')
    lathe('гильза', [(0.0145, 0), (0.0145, 0.026), (0.0132, 0.030), (0.0118, 0.031)],
          M_BRASS(), (xv, 0, z3 - 0.010), '-Z')
    zb = -0.34
    R2 = 0.030
    pts = [(xv, 0, z3 - 0.040), (xv, 0, zb + R2)]
    pts += [(xv + R2 - R2 * math.cos(t), 0, zb + R2 - R2 * math.sin(t))
            for t in [k * math.pi / 2 / 12 for k in range(1, 13)]]
    pts += [(xv + R2 + 0.07, 0, zb)]
    tube('подающая труба', pts, 0.0125, M_PLAST(LINE))


BLOCK_OF = {}


def build():
    sc = reset()
    blocks = split(N)
    outs = sum(blocks)
    # Выходы и блоки по оси X: блок занимает свои выходы плюс по 25 мм на торцы
    xs = []
    bx = -0.025
    spans = []
    i = 0
    for j, b in enumerate(blocks):
        x0 = bx
        for k in range(b):
            xs.append(x0 + 0.025 + k * P)
            BLOCK_OF[i] = j
            i += 1
        bx = x0 + 0.025 + (b - 1) * P + 0.025 + 0.010
        spans.append((x0, bx))
    for j, (a, b) in enumerate(spans):
        block(j, a, b)
    for i in range(outs):
        outlet(i, xs[i], i < N)
    x_left, x_right = spans[0][0], spans[-1][1]
    # хомуты — у краёв гребёнки, между торцом и крайним выходом
    clamp(0, x_left + 0.006)
    clamp(1, x_right - 0.008)
    # торец с компенсатором (заглушкой) — слева, подводка — справа, как на листе проекта
    end_part_left(x_left)
    feed_side(x_right)
    return sc


# ── камера, линии, проходы ───────────────────────────────────────────────

def freestyle(sc, group, color, thick):
    sc.render.use_freestyle = True
    sc.render.line_thickness_mode = 'ABSOLUTE'
    sc.render.line_thickness = thick
    vl = sc.view_layers[0]
    vl.use_freestyle = True
    fs = vl.freestyle_settings
    fs.crease_angle = math.radians(58)
    while fs.linesets:
        fs.linesets.remove(fs.linesets[0])
    ls = fs.linesets.new('l_' + group)
    ls.select_by_collection = True
    ls.collection = coll(group)
    ls.select_silhouette = True
    ls.select_border = True
    ls.select_crease = True
    ls.linestyle.color = color
    ls.linestyle.thickness = 1.0


def mesh_points(ob, dg):
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    pts = [ev.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    return pts


def camera(sc):
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in sc.objects:
        if o.type in ('MESH', 'CURVE'):
            pts += mesh_points(o, dg)
    c = sum(pts, Vector()) / len(pts)
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cam = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    d = Vector((-0.46, -1.0, 0.40)).normalized()
    cam.location = c + d * 3
    cam.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    q = [inv @ p for p in pts]
    xs = [p.x for p in q]
    ys = [p.y for p in q]
    w = (max(xs) - min(xs)) * 1.06
    h = (max(ys) - min(ys)) * 1.06
    W = 1400
    sc.render.resolution_x = W
    sc.render.resolution_y = int(round(W * h / w))
    cam.location += cam.matrix_world.to_3x3() @ Vector(((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, 0))
    cd.ortho_scale = max(w, h)
    bpy.context.view_layer.update()
    return cam


def render(sc, path):
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    sc = build()
    cam = camera(sc)
    from bpy_extras.object_utils import world_to_camera_view

    # Зоны деталей: охват проекций вершин всех объектов детали, в долях кадра
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
    pts = {}
    for k, p in marks.items():
        v = world_to_camera_view(sc, cam, Vector(p))
        pts[k] = [round(v.x, 4), round(1 - v.y, 4)]

    line = (0.12, 0.13, 0.16)
    # проход 1: всё твёрдое, изоляция спрятана, линии по твёрдому
    for o in coll('sheath').objects:
        o.hide_render = True
    sc.render.film_transparent = False
    freestyle(sc, 'solid', line, 2.6)
    render(sc, os.path.join(OUT, TAG + '_solid.png'))
    # проход 2: только изоляция; твёрдое — вырез, чтобы чехол прятался за деталями,
    # а сам был полупрозрачным поверх трубы
    for o in coll('sheath').objects:
        o.hide_render = False
    for o in coll('solid').objects:
        o.is_holdout = True
    sc.render.film_transparent = True
    freestyle(sc, 'sheath', (0.35, 0.37, 0.42), 1.2)
    render(sc, os.path.join(OUT, TAG + '_sheath.png'))

    # проход 3: карта деталей — каждая сноска своим плоским цветом, без сглаживания и линий
    ID = {'mf': (1, 0, 0), 'ek': (0, 1, 0), 'tube': (0, 0, 1), 'clamp': (1, 1, 0), 'stud': (1, 1, 0),
          'end': (1, 0, 1), 'fut': (1, 0, 1), 'ext': (0, 1, 1), 'union': (0, 1, 1), 'ball': (0, 1, 1),
          'nip': (0, 1, 1)}
    em = {}
    for o in list(coll('solid').objects) + list(coll('sheath').objects):
        o.is_holdout = False
        o.hide_render = False
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
            for md in list(getattr(o, 'modifiers', [])):
                pass
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
                   'marks': pts}, f, ensure_ascii=False)


main()
