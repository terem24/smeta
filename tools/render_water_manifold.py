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
      type — st | rm | bl       (STOUT SMB 6850: головки сверху, отводы вперёд;
                                 ROMMER RMB-0004: головки сверху, отводы вниз 90°;
                                 шаровые краны — STOUT SMB 6200/6201, ROMMER RMB-0007/0008:
                                 на каждом отводе спереди кран с флажком, отвод вперёд)
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
    # металлы — пипеткой по фото каталога (середина светлой стороны), у каждой детали свой:
    # никель кранов и фитингов тёплый (SVB-1007, SFT-0004: ~182,176,170), хром удлинителя
    # холодный и зеркальный (SFT-0002: ~195,198,193), компенсатор — матовый серый сатин
    # (SVS-1014: ~171,171,173)
    'nickel': (0.84, 0.81, 0.77),
    'chrome': (0.90, 0.92, 0.92),
    'satin': (0.64, 0.64, 0.66),
    'brass': (0.80, 0.63, 0.32),   # латунь заглушки и пресс-фитинга (SFT-0024: ~174,144,85)
    'green': (0.16, 0.56, 0.27),
    'red': (0.85, 0.12, 0.15),
    'blue': (0.14, 0.22, 0.70),
    'white': (0.97, 0.97, 0.97),
    'black': (0.10, 0.10, 0.11),
    'rubber': (0.12, 0.12, 0.13),
    'capblack': (0.13, 0.13, 0.14),
    'flagblue': (0.22, 0.55, 0.92),
    'flagred': (0.90, 0.16, 0.16),
    'pinkdisc': (0.93, 0.80, 0.80),
    'cw': (0.16, 0.56, 0.90),
    'hw': (0.98, 0.60, 0.06),
    'rc': (0.90, 0.36, 0.66),
    # изоляция 18/6 в смете синяя (ХВС) и красная (ГВС, рециркуляция), труба PEX-a серая
    'ins_cw': (0.13, 0.56, 0.95),
    'ins_hw': (0.93, 0.27, 0.22),
    'pex': (0.66, 0.68, 0.71),
    'zinc': (0.72, 0.74, 0.76),    # оцинковка хомута и шпильки (фото SAC-0020-300001)
    'dowel': (0.68, 0.70, 0.72),   # серый нейлоновый дюбель (фото SAC-0020-400100)
}


def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


C = {k: tuple(_lin(x) for x in v) for k, v in C.items()}
KNOB = 'blue' if LINE == 'cw' else 'red'
INS = 'ins_cw' if LINE == 'cw' else 'ins_hw'

P = 0.037 if TYPE == 'bl' else 0.050   # шаг выходов: SMB 62xx — 37 мм по паспорту, SMB 6850 — 50
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
    els[0].color = (0.66, 0.67, 0.70, 1)
    els[1].position = 0.62
    els[1].color = (1, 1, 1, 1)
    els.new(0.50).color = (0.80, 0.81, 0.83, 1)
    els.new(0.44).color = (0.30, 0.31, 0.33, 1)
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
    return mat('nickel', rough=0.28, metal=0.55)


def M_CHROME():
    return mat('chrome', rough=0.08, metal=0.85)


def M_SATIN():
    return mat('satin', rough=0.55, metal=0.35)


def M_BRASS():
    return mat('brass', rough=0.30, metal=0.50)


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


def prism(name, pts, h, m, mtx, bevel=0.0008):
    """Плоская деталь по контуру [(u, v), ...] в плоскости XY, толщиной h вдоль Z, со
    скруглёнными кромками; mtx — куда её поставить (поворот и перенос)."""
    bm = bmesh.new()
    bot = [bm.verts.new((u, v, -h / 2)) for u, v in pts]
    top = [bm.verts.new((u, v, h / 2)) for u, v in pts]
    bm.faces.new(list(reversed(bot)))
    bm.faces.new(top)
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    ob.matrix_world = mtx
    if bevel:
        bv = ob.modifiers.new('bev', 'BEVEL')
        bv.width = bevel
        bv.segments = 3
        bv.limit_method = 'ANGLE'
    return link(ob)


def rounded(pts, r, seg=4):
    """Контур со скруглёнными углами: каждый угол заменяется дугой радиуса r."""
    out = []
    n = len(pts)
    for i in range(n):
        p0, p1, p2 = Vector(pts[i - 1] + (0,)), Vector(pts[i] + (0,)), Vector(pts[(i + 1) % n] + (0,))
        a, b = (p0 - p1).normalized(), (p2 - p1).normalized()
        rr = min(r, (p0 - p1).length / 2.2, (p2 - p1).length / 2.2)
        s_, e_ = p1 + a * rr, p1 + b * rr
        for k in range(seg + 1):
            t = k / seg
            q = (1 - t) ** 2 * s_ + 2 * (1 - t) * t * p1 + t ** 2 * e_
            out.append((q.x, q.y))
    return out


# Ручки крана подводки (локально: u — вдоль трубы, d — от оси крана по штоку). Размеры —
# паспорт STOUT SVB-0007/1007 для 3/4": размах бабочки L2 = 64 мм, верх ручки H2 = 45,7 мм от
# оси; форма — фото каталога SVB-0002/0007/1007, RBV-0005 с нескольких ракурсов.
def _uv_frame(xv, zc, thick_axis='X'):
    """Матрица: локальные X -> вдоль трубы (Z), Y -> по штоку (-Y), Z -> поперёк (X)."""
    return Matrix.Translation(Vector((xv, 0, zc))) @ \
        Matrix(((0, 0, 1, 0), (0, -1, 0, 0), (1, 0, 0, 0), (0, 0, 0, 1)))


def butterfly(xv, zc, col):
    """Бабочка: литая ступица-воротник на штоке и два крыла — плоские пластины ~4 мм в плоскости
    трубы и штока (на всех фото крыло видно лицом сбоку и ребром сверху). Крыло почти
    прямоугольное, слегка расходится наружу, верхние углы скруглены, низ крыла выше
    накидной гайки. Между крыльями на воротнике гайка штока с латунной вставкой."""
    m = mat(col, rough=0.32, coat=0.6)
    lathe('воротник бабочки', [(0.0104, 0), (0.0122, 0.0015), (0.0122, 0.0118), (0.0110, 0.0135), (0.0, 0.0135)],
          m, (xv, -0.0155, zc), '-Y', segs=40, sharp=40)
    wing = [(0.0078, 0.0200), (0.0318, 0.0236), (0.0304, 0.0457), (0.0112, 0.0457), (0.0090, 0.0290)]
    for sg in (1, -1):
        pts = wing if sg > 0 else [(-u, d) for u, d in reversed(wing)]
        prism('крыло бабочки', rounded(pts, 0.0034, seg=4), 0.0040, m, _uv_frame(xv, zc), bevel=0.0009)
    hexnut('гайка бабочки', 0.0110, 0.0045, M_NICKEL(), (xv, -0.0290, zc), '-Y')
    lathe('вставка гайки', [(0.0, 0), (0.0030, 0), (0.0030, 0.0010), (0.0, 0.0012)], M_BRASS(),
          (xv, -0.0335, zc), '-Y', segs=20)


def _band(path, t):
    """Контур полосы толщиной t вдоль ломаной path [(u, d), ...]."""
    left, right = [], []
    for i, (u, d) in enumerate(path):
        a = Vector(path[max(i - 1, 0)]) if i else Vector(path[0])
        b = Vector(path[min(i + 1, len(path) - 1)])
        tg = (b - a).normalized()
        n = Vector((-tg.y, tg.x)) * (t / 2)
        left.append((u + n.x, d + n.y))
        right.append((u - n.x, d - n.y))
    return left + list(reversed(right))


def lever_handle(xv, zc, col):
    """Рычаг (фото SVB-0001/0003, RBV-0001): стальная оцинкованная полоса ~12 x 2 мм от гайки
    штока поднимается под ~45° и идёт вдоль трубы, на дальней части — пластиковый чехол цвета
    ручки со скруглённым концом; у штока — гайка и упор. Рычаг вдоль трубы вниз (кран открыт)."""
    steel = mat('chrome', rough=0.30, metal=0.60)
    m = mat(col, rough=0.32, coat=0.6)
    path = [(0.0070, 0.0175), (-0.0060, 0.0175), (-0.0200, 0.0330), (-0.1080, 0.0370)]
    prism('рычаг', _band(path, 0.0022), 0.0120, steel, _uv_frame(xv, zc), bevel=0.0004)
    sleeve = [(-0.0480, 0.0352), (-0.1110, 0.0380)]
    prism('чехол рычага', rounded(_band(sleeve, 0.0050), 0.0018, seg=3), 0.0150, m, _uv_frame(xv, zc), bevel=0.0010)
    hexnut('гайка рычага', 0.0100, 0.0045, steel, (xv, -0.0186, zc), '-Y')


def lever(x, y, z, col):
    """Флажок шарового крана коллектора (SMB 6200/6201, RMB-0008): круглая ступица с винтом
    на штоке и плоская лопатка вбок, сужается к концу, лицом к зрителю."""
    m = mat(col, rough=0.35, coat=0.5)
    lathe('ступица флажка', [(0.0, 0), (0.0068, 0), (0.0072, 0.002), (0.0072, 0.0085), (0.0060, 0.0100),
                             (0.0, 0.0100)], m, (x, y, z), 'Z', segs=32, sharp=40)
    lathe('винт флажка', [(0.0, 0), (0.0020, 0), (0.0020, 0.0012), (0.0, 0.0014)], M_NICKEL(),
          (x, y, z + 0.0100), 'Z', segs=16)
    # лопатка: локальная X → мировая −X (влево), Y → вверх, Z (толщина) → к зрителю
    mtx = Matrix.Translation(Vector((x, y - 0.0005, z + 0.0050))) @ \
        Matrix(((-1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    blade = rounded([(0.0040, -0.0050), (0.0215, -0.0035), (0.0240, 0.0005), (0.0225, 0.0050),
                     (0.0040, 0.0055)], 0.0018)
    prism('лопатка флажка', blade, 0.0050, m, mtx)


def thread(r, length, pitch=0.0016, depth=0.0006, start=0.0):
    """Профиль резьбы-накатки: витки — чередующиеся радиусы, как блестит резьба на фото."""
    out, h = [], 0.0
    while h < length - 1e-6:
        out += [(r, start + h), (r - depth, start + min(length, h + pitch / 2))]
        h += pitch
    out.append((r, start + length))
    return out


def ek_fit(loc, axis):
    """Евроконус 16 (фото SFC-0020-001620/001622): никелированная накидная гайка 3/4" —
    шестигранник под ключ ~29 мм с сильно скруглёнными гранями и фасками, из неё выходит
    латунный штуцер с буртом под трубу. Возвращает длину узла по оси."""
    dirv = {'-Y': Vector((0, -1, 0)), '-Z': Vector((0, 0, -1))}[axis]
    R_ = 0.029 / math.sqrt(3)
    hexa = [(R_ * math.cos(math.pi / 6 + k * math.pi / 3), R_ * math.sin(math.pi / 6 + k * math.pi / 3))
            for k in range(6)]
    prism('гайка ЕК', rounded(hexa, 0.0032, seg=4), 0.0160, M_NICKEL(),
          Matrix.Translation(Vector(loc) + dirv * 0.0080) @ AXIS[axis], bevel=0.0012)
    v = Vector(loc) + dirv * 0.0160
    lathe('штуцер ЕК', [(0.0108, 0), (0.0108, 0.0012), (0.0100, 0.0016), (0.0100, 0.0040), (0.0090, 0.0048),
                        (0.0086, 0.0058)], M_BRASS(), tuple(v), axis, segs=40)
    return 0.0218


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

    STOUT SMB 6850 (фото каталога): зелёный рифлёный колпак с розовым диском и цветной
    меткой, отвод 3/4" ЕК под прямым углом к нему. Коллектор так и ставят — повёрнутым
    вокруг оси отводами вниз: головки смотрят на зрителя, трубы идут прямо вниз без изгиба.
    ROMMER RMB-0004: головка сверху — чёрный рифлёный колпак с цветным верхом и белыми
    метками, отвод вниз под 90°.
    """
    part('mf:%d' % BLOCK_OF[i])
    if TYPE == 'bl':
        ball_outlet(i, x, used)
        return
    before = set(bpy.context.scene.objects)
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
        # диск по паспорту SMB 6849(50): в цвет линии, белые дуги «+/−» и белая стрелка
        lathe('диск', [(0.0, 0), (0.0140, 0), (0.0140, 0.0016), (0.0, 0.0016)],
              M_PLAST(KNOB), (x, 0, zc + 0.020), 'Z', segs=48)
        top = zc + 0.0216
    lathe('метка', [(0.0, 0), (0.0040, 0), (0.0040, 0.0012), (0.0, 0.0012)],
          M_PLAST('white'), (x, 0, top), 'Z', segs=32)
    lathe('штифт', [(0.0, 0), (0.0016, 0), (0.0016, 0.0020), (0.0, 0.0024)], M_NICKEL(),
          (x, 0, top + 0.0012), 'Z', segs=16)
    box('стрелка', (0.0030, 0.0110, 0.0012), M_PLAST('white'), (x, -0.0055, top + 0.0006))
    if True:
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
        turn_down(before, i) if forward else None
        return
    part('ek:%d' % i)
    if forward:
        y0 = -RB - 0.012
        ln = ek_fit((x, y0, 0), '-Y')
        turn_down(before, i)
        # после поворота конец евроконуса (x, y1, 0) оказывается внизу — (x, 0, y1)
        y1 = y0 - ln
        pts = [(x, 0, y1), (x, 0, -0.30)]
    else:
        z0 = -RB - 0.012
        ln = ek_fit((x, 0, z0), '-Z')
        pts = [(x, 0, z0 - ln), (x, 0, -0.30)]
    # труба 16 и теплоизоляция 18/6: изоляция полупрозрачная, сквозь неё видна серая труба
    part('tube:%d' % i)
    tube('труба16', pts, 0.008, M_PLAST('pex'))
    sp = [pts[0]] + pts[1:-1] + [(pts[-1][0], pts[-1][1], pts[-1][2] - 0.012)]
    tube('изоляция', sp, 0.0118, mat(INS, rough=0.30, alpha=0.90), group='sheath')


def turn_down(before, i):
    """Повернуть вокруг оси коллектора на 90° всё, что построено для отвода после before:
    головка уходит со верха на зрителя, отвод — вниз."""
    rot = Matrix.Rotation(math.pi / 2, 4, 'X')
    # масштаб у box() задан полем scale — без пересчёта matrix_world его ещё не содержит
    bpy.context.view_layer.update()
    for o in set(bpy.context.scene.objects) - before:
        o.matrix_world = rot @ o.matrix_world
    if i == 0 and 'mf' in marks:
        marks['mf'] = tuple(rot @ Vector(marks['mf']))


def ball_outlet(i, x, used):
    """Отвод коллектора с шаровым краном — по паспорту STOUT SMB 62xx (чертёж п. 4.2 и
    фото): на отводе у самого корпуса круглая бобышка крана, шток перпендикулярен и корпусу,
    и отводу; ручка — тонкая плоская планка ~7×20 мм от ступицы с винтом вбок, вдоль корпуса,
    с коротким загибом на конце; дальше шестигранник и резьба 1/2". Строится отводом вперёд
    и поворачивается вокруг оси коллектора отводом вниз: шток и ручка смотрят на зрителя."""
    before = set(bpy.context.scene.objects)
    yv = -RB - 0.004
    # отвод от корпуса и бобышка крана со штоком вверх (после поворота — на зрителя)
    lathe('отвод крана', [(0.0098, 0), (0.0098, 0.0270)], M_NICKEL(), (x, -RB + 0.003, 0), '-Y', segs=40)
    lathe('корпус крана', [(0.0, 0), (0.0100, 0), (0.0112, 0.004), (0.0112, 0.016), (0.0100, 0.020),
                           (0.0, 0.020)], M_NICKEL(), (x, yv, -0.010), 'Z', segs=48, sharp=40)
    lathe('бобышка штока', [(0.0065, 0), (0.0065, 0.004), (0.0058, 0.005)], M_NICKEL(), (x, yv, 0.010), 'Z', segs=32)
    hexnut('шестигранник отвода', 0.022, 0.006, M_NICKEL(), (x, yv - 0.012, 0), '-Y')
    # ручка: ступица с винтом и тонкая планка вдоль корпуса (+X), загиб на конце
    fm = mat('flagblue' if LINE == 'cw' else 'flagred', rough=0.35, coat=0.5)
    lathe('ступица ручки', [(0.0, 0), (0.0058, 0), (0.0058, 0.0042), (0.0050, 0.0050), (0.0, 0.0050)],
          fm, (x, yv, 0.0150), 'Z', segs=32, sharp=40)
    bar = rounded([(-0.0040, -0.0048), (0.0205, -0.0048), (0.0205, 0.0048), (-0.0040, 0.0048)], 0.0018)
    prism('ручка', bar, 0.0026, fm, Matrix.Translation(Vector((x, yv, 0.0172))), bevel=0.0006)
    box('загиб ручки', (0.0026, 0.0096, 0.0060), fm, (x + 0.0192, yv, 0.0142))
    lathe('винт ручки', [(0.0, 0), (0.0020, 0), (0.0020, 0.0012), (0.0, 0.0014)], M_NICKEL(),
          (x, yv, 0.0200), 'Z', segs=16)
    ym = yv
    # латунная резьба 1/2" отвода
    yt = -RB - 0.024
    lathe('резьба отвода', [(0.0104, 0), (0.0104, 0.003), (0.0098, 0.004), (0.0104, 0.005),
                            (0.0104, 0.008), (0.0098, 0.009), (0.0104, 0.010), (0.0104, 0.013),
                            (0.0092, 0.014)], M_BRASS(), (x, yt, 0), '-Y')
    yt = yt - 0.002
    if i == 0:
        marks['mf'] = (x + 0.012, yv, 0.019)
    if not used:
        turn_down(before, i)
        return
    part('ek:%d' % i)
    y0 = yt - 0.010
    ln = ek_fit((x, y0, 0), '-Y')
    turn_down(before, i)
    y1 = y0 - ln
    pts = [(x, 0, y1), (x, 0, -0.30)]
    part('tube:%d' % i)
    tube('труба16', pts, 0.008, M_PLAST('pex'))
    sp = [pts[0]] + pts[1:-1] + [(pts[-1][0], pts[-1][1], pts[-1][2] - 0.012)]
    tube('изоляция', sp, 0.0118, mat(INS, rough=0.30, alpha=0.90), group='sheath')


def clamp(k, xc):
    """Хомут одновинтовой 1" с гайкой M8 (фото SAC-0020-300001): стальная оцинкованная лента
    ~20 мм на чёрной резиновой вставке (резина выступает по краям), сверху стяжка — два ушка
    и винт с гайкой, сзади к стене приварная гайка M8. Шпилька M8x100 (фото SAC-0020-400100):
    резьба M8 от гайки к стене, у стены шурупная часть в сером дюбеле."""
    part('clamp:%d' % k)
    zinc = mat('zinc', rough=0.38, metal=0.55)
    # резина толстая (~4 мм) и шире ленты — на фото чёрный обод виден с обеих сторон
    lathe('резинка', [(0.0168, 0), (0.0204, 0), (0.0208, 0.002), (0.0208, 0.020), (0.0204, 0.022),
                      (0.0168, 0.022)], mat('rubber', rough=0.7), (xc - 0.011, 0, 0), 'X', segs=56)
    lathe('лента', [(0.0207, 0), (0.0220, 0), (0.0220, 0.014), (0.0207, 0.014)], zinc,
          (xc - 0.007, 0, 0), 'X', segs=56, sharp=60)
    # стяжка сверху: два радиальных ушка, винт поперёк них
    for dx in (-0.0040, 0.0040):
        box('ушко хомута', (0.0016, 0.016, 0.012), zinc, (xc + dx, 0, 0.0262))
    lathe('винт стяжки', [(0.0, 0), (0.0022, 0), (0.0022, 0.016), (0.0, 0.016)], zinc,
          (xc - 0.008, 0, 0.0270), 'X', segs=16)
    lathe('головка винта', [(0.0, 0), (0.0038, 0), (0.0040, 0.0010), (0.0040, 0.0022), (0.0, 0.0030)], zinc,
          (xc + 0.0048, 0, 0.0270), 'X', segs=24)
    hexnut('гайка стяжки', 0.007, 0.003, zinc, (xc - 0.0048, 0, 0.0270), '-X')
    # к стене: площадка и приварная гайка M8
    box('площадка гайки', (0.014, 0.003, 0.014), zinc, (xc, 0.0222, 0))
    hexnut('гайка M8', 0.013, 0.0065, zinc, (xc, 0.0235, 0), 'Y')
    marks['clamp:%d' % k] = (xc, 0.004, 0.022)
    part('stud:%d' % k)
    lathe('шпилька', thread(0.0040, 0.044, pitch=0.00125, depth=0.0005), zinc, (xc, 0.030, 0), 'Y', segs=24)
    lathe('шуруп', [(0.0030, 0), (0.0030, 0.008)], zinc, (xc, 0.074, 0), 'Y', segs=16)
    lathe('дюбель', [(0.0, 0), (0.0040, 0), (0.0055, 0.004), (0.0055, 0.030), (0.0045, 0.034), (0.0, 0.034)],
          mat('dowel', rough=0.6), (xc, 0.080, 0), 'Y', segs=24)
    marks['stud:%d' % k] = (xc, 0.060, 0)


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
        # футорка 3/4" x 1/2" (фото SFT-0029-003412): никелированный шестигранник, резьба
        # уходит в торец коллектора и не видна
        hexnut('футорка', 0.032, 0.010, M_NICKEL(), (xe, 0, 0), AX_END)
        marks['fut'] = (xe + sg * 0.005, 0, 0.015)
        # компенсатор гидроудара SVS-1014-000015: габариты — паспорт (табл. 3: H 90, D 52, l 13,
        # SW 30, SW1 47), доли по высоте — замер силуэта фото каталога (масштаб по резьбе 1/2"):
        # крышка ~48 мм (на чертеже паспорта короче, фото точнее), шестигранник SW1 ~18 мм со
        # скруглённым низом ~7 мм, короткий шестигранник SW 30 ~4 мм, резьба 13 мм почти вся
        # в футорке. Покрытие матовое (фото каталога), не зеркальный хром
        part('end')
        sat = M_SATIN()
        x0 = xe + sg * 0.010
        lathe('компенсатор резьба', thread(0.0104, 0.003), sat, (x0, 0, 0), AX_END, segs=40)
        x0 += sg * 0.003
        hexnut('компенсатор SW30', 0.030, 0.0040, sat, (x0, 0, 0), AX_END, ch=0.0)
        x0 += sg * 0.0040
        lathe('компенсатор низ', [(0.0150, 0), (0.0205, 0.0010), (0.0240, 0.0030), (0.0258, 0.0055),
                                  (0.0262, 0.0062), (0.0250, 0.0066), (0.0262, 0.0070)], sat, (x0, 0, 0), AX_END, segs=64, sharp=40)
        x0 += sg * 0.0070
        hexnut('компенсатор SW47', 0.047, 0.018, sat, (x0, 0, 0), AX_END, ch=0.08)
        x0 += sg * 0.018
        lathe('компенсатор крышка', [(0.0243, 0), (0.0243, 0.0020), (0.0240, 0.0430), (0.0228, 0.0465),
                                     (0.0200, 0.0478), (0.0, 0.0480)], sat, (x0, 0, 0), AX_END, segs=64, sharp=40)
        marks['end'] = (x0 + sg * 0.024, 0, 0.024)
    else:
        part('end')
        # заглушка 3/4" НР (фото SFT-0024-000034): латунный шестигранник, резьба в торце
        hexnut('заглушка', 0.032, 0.012, M_BRASS(), (xe, 0, 0), AX_END)
        lathe('заглушка торец', [(0.0150, 0), (0.0150, 0.002), (0.0130, 0.003), (0.0, 0.003)],
              M_BRASS(), (xe + sg * 0.012, 0, 0), AX_END)
        marks['end'] = (xe + sg * 0.012, 0, 0.014)


def feed_side(xr):
    """Подводка с торца коллектора — строго по разделу 6.4 сметы, по резьбам: удлинитель
    ВН/ВР 30 мм (НР в коллектор) -> сгон прямой ВР-НР (хвостовик НР в удлинитель) -> кран
    шаровой ВН-НР (американка НР в корпус сгона) -> ниппель НР -> тройник ВР. В отвод тройника
    снизу приходит подающая труба, другой конец тройника — дальше по линии. Всё по оси
    коллектора, ручка крана сверху — как на фото каталога. У ГВС и рециркуляции подача не из
    раздела 6.4, ключей деталей не получает."""
    keyed = LINE == 'cw'
    part('ext' if keyed else '')
    # удлинитель (фото SFT-0002-003430): гладкий хромированный цилиндр, наружная резьба
    chrome = M_CHROME()
    lathe('удлинитель', [(0.0175, 0), (0.0182, 0.0015), (0.0182, 0.0285), (0.0175, 0.030)],
          chrome, (xr, 0, 0), 'X', segs=56)
    marks['ext'] = (xr + 0.015, 0, 0.018)
    x = xr + 0.030
    # сгон прямой SFT-0045 (фото): гладкий хвостовик НР с резьбой у торца, шестигранная
    # накидная гайка с пояском, шестигранный корпус ВР
    part('union' if keyed else '')
    lathe('сгон хвостовик', [(0.0128, 0), (0.0128, 0.006), (0.0124, 0.007), (0.0124, 0.012)], M_NICKEL(),
          (x, 0, 0), 'X', segs=48)
    x += 0.012
    hexnut('сгон гайка', 0.040, 0.017, M_NICKEL(), (x, 0, 0), 'X', ch=0.14)
    x += 0.017
    lathe('сгон поясок', [(0.0172, 0), (0.0172, 0.003)], M_NICKEL(), (x, 0, 0), 'X', segs=48)
    x += 0.003
    hexnut('сгон корпус', 0.036, 0.016, M_NICKEL(), (x, 0, 0), 'X', ch=0.12)
    marks['union'] = (x - 0.004, 0, 0.022)
    x += 0.016
    # кран шаровой с американкой (фото SVB-1007 / RBV-0005): ниппель американки НР (виден
    # край), накидная гайка, корпус с поясками, шестигранник ВР
    part('ball' if keyed else '')
    lathe('ниппель американки', [(0.0160, 0), (0.0140, 0.002)] + thread(0.0136, 0.004, start=0.002),
          M_NICKEL(), (x + 0.006, 0, 0), '-X', segs=48)
    hexnut('гайка американки', 0.040, 0.014, M_NICKEL(), (x + 0.006, 0, 0), 'X')
    x += 0.020
    lathe('корпус крана', [(0.0160, 0), (0.0182, 0.002), (0.0190, 0.008), (0.0190, 0.022), (0.0182, 0.028),
                           (0.0172, 0.030)], M_NICKEL(), (x, 0, 0), 'X', sharp=40)
    xc = x + 0.015
    x += 0.030
    hexnut('кран ВР', 0.034, 0.014, M_NICKEL(), (x, 0, 0), 'X')
    x += 0.014
    # ручка сверху: детали строятся в своей позе (труба по Z, шток к -Y) и переносятся —
    # труба по X, шток вверх; крылья бабочки в плоскости трубы и штока, к камере лицом
    Rm = Matrix(((0, 0, 1, 0), (-1, 0, 0, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
    T = Matrix.Translation(Vector((xc, 0, 0))) @ Rm

    def turned(fn, *a):
        pre = set(bpy.context.scene.objects)
        fn(*a)
        bpy.context.view_layer.update()
        new = set(bpy.context.scene.objects) - pre
        for o in new:
            o.matrix_world = T @ o.matrix_world
        return new
    turned(lathe, 'бобышка штока', [(0.0104, 0), (0.0104, 0.0040), (0.0098, 0.0045)], M_NICKEL(),
           (0, -0.0115, 0), '-Y')
    marks['ball'] = (xc, -0.012, 0.012)
    # ручка — отдельным слоем на каждый вариант: тип и цвет берёт смета по артикулу крана
    for key, fn, col in HANDLES:
        for o in turned(fn, 0, 0, col):
            for c in list(o.users_collection):
                c.objects.unlink(o)
            coll('h_' + key).objects.link(o)
            o['part'] = ''
    # ниппель (фото SFT-0004-003434): шестигранник посередине, резьба с двух сторон
    part('nip' if keyed else '')
    lathe('ниппель резьба 1', thread(0.0128, 0.006), M_NICKEL(), (x, 0, 0), 'X', segs=40)
    hexnut('ниппель', 0.030, 0.010, M_NICKEL(), (x + 0.006, 0, 0), 'X')
    lathe('ниппель резьба 2', thread(0.0128, 0.006), M_NICKEL(), (x + 0.016, 0, 0), 'X', segs=40)
    marks['nip'] = (x + 0.011, 0, 0.016)
    x += 0.022
    # тройник ВР (фото SFT-0020-000034): гладкое литое тело, на концах утолщённые буртики
    part('tee' if keyed else '')
    L, RB_, RT = 0.054, 0.0152, 0.0176
    lathe('тройник', [(RT, 0), (RT, 0.007), (RB_, 0.009), (RB_, L - 0.009), (RT, L - 0.007), (RT, L)],
          M_NICKEL(), (x, 0, 0), 'X', segs=56, sharp=40)
    xt = x + L / 2
    lathe('тройник отвод', [(RB_, 0), (RB_, 0.018), (RT, 0.020), (RT, 0.028)], M_NICKEL(),
          (xt, 0, -0.010), '-Z', segs=56, sharp=40)
    marks['tee'] = (xt, -0.010, 0.014)
    part('')
    # дальше по линии: пресс-фитинг с НР и труба вправо
    hexnut('пресс-фитинг', 0.030, 0.010, M_BRASS(), (x + L, 0, 0), 'X')
    lathe('гильза', [(0.0145, 0), (0.0145, 0.026), (0.0132, 0.030), (0.0118, 0.031)],
          M_BRASS(), (x + L + 0.010, 0, 0), 'X')
    tube('труба дальше', [(x + L + 0.040, 0, 0), (x + L + 0.090, 0, 0)], 0.0125, M_PLAST(LINE))
    # подача снизу в отвод тройника: пресс-фитинг с НР, труба вниз и угольник у пола
    z3 = -0.038
    hexnut('пресс-фитинг', 0.030, 0.010, M_BRASS(), (xt, 0, z3), '-Z')
    lathe('гильза', [(0.0145, 0), (0.0145, 0.026), (0.0132, 0.030), (0.0118, 0.031)],
          M_BRASS(), (xt, 0, z3 - 0.010), '-Z')
    zb = -0.34
    R2 = 0.030
    pts = [(xt, 0, z3 - 0.040), (xt, 0, zb + R2)]
    pts += [(xt + R2 - R2 * math.cos(t), 0, zb + R2 - R2 * math.sin(t))
            for t in [k * math.pi / 2 / 12 for k in range(1, 13)]]
    pts += [(xt + R2 + 0.07, 0, zb)]
    tube('подающая труба', pts, 0.0125, M_PLAST(LINE))


# варианты ручки крана подводки: бабочка/рычаг, красная/чёрная (STOUT SVB-1xxx и ROMMER —
# красные, STOUT SVB-0xxx — чёрные; паспорт SVB: «SVB-1007 — ручка красного цвета»)
HANDLES = [('bf_r', butterfly, 'flagred'), ('bf_k', butterfly, 'black'),
           ('lv_r', lever_handle, 'flagred'), ('lv_k', lever_handle, 'black')]

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

    line = (0.28, 0.30, 0.34)
    hcols = [coll('h_' + k) for k, _, _ in HANDLES]
    for c in hcols:
        for o in c.objects:
            o.hide_render = True
    # проход 1: всё твёрдое, изоляция спрятана, линии по твёрдому
    for o in coll('sheath').objects:
        o.hide_render = True
    sc.render.film_transparent = False
    freestyle(sc, 'solid', line, 1.8)
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
    # проходы ручек: по слою на вариант, всё остальное — вырез (ручку закрывают детали перед ней)
    for o in coll('sheath').objects:
        o.is_holdout = True
    for (k, _, _), c in zip(HANDLES, hcols):
        for o in c.objects:
            o.hide_render = False
        freestyle(sc, 'h_' + k, line, 1.8)
        render(sc, os.path.join(OUT, TAG + '_h_' + k + '.png'))
        for o in c.objects:
            o.hide_render = True

    # проход 3: карта деталей — каждая сноска своим плоским цветом, без сглаживания и линий
    ID = {'mf': (1, 0, 0), 'ek': (0, 1, 0), 'tube': (0, 0, 1), 'clamp': (1, 1, 0), 'stud': (1, 1, 0),
          'end': (1, 0, 1), 'fut': (1, 0, 1), 'ext': (0, 1, 1), 'union': (0, 1, 1), 'ball': (0, 1, 1),
          'nip': (0, 1, 1), 'tee': (0, 1, 1)}
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
