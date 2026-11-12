# -*- coding: utf-8 -*-
"""
Общая библиотека деталей для кадров схем узлов сметы (Blender, запуск headless).

Здесь всё, что не зависит от конкретного узла: сцена и окружение, материалы, примитивы
(тела вращения, плоские детали, шестигранники, резьба, трубы), типовые детали (евроконус,
кран с американкой, бабочка и рычаг, хомут на шпильке, кронштейн, концевая группа),
камера, линии Freestyle, проходы рендера и метаданные кадра (зоны деталей, точки сносок,
привязка к миру). Скрипты узлов подключают модуль так:

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from blender_parts import *

Вид материалов — переменная окружения HC_LOOK (или set_look()):
    illus  — по умолчанию: светлая чистая иллюстрация, как листы-образцы владельца («Обвязка
             коллекторов», «Узел ХВС»): металл почти белый с мягкой светотенью, латунь жёлтая,
             пластики сочные, ровный свет без отражений студии, тонкий контур. Решение
             владельца 05.11.2026 — фотореализм с зеркальным металлом отвергнут;
    pbr    — фотореализм: студийная HDRI в отражениях, металлы физические (metallic = 1),
             цвет и блеск сняты с фото каталога (таблица LIB, поле src). Не использовать для
             смет — оставлен для сверки формы с фото;
    legacy — прежний вид (градиентный мир, «полуметалл»), кадр в кадр как до выноса
             деталей в модуль. Нужен для сверки и как откат.
Движок — HC_ENGINE: cycles (по умолчанию) или eevee; HC_SAMPLES — число проходов Cycles (128).

HDRI в git не лежит (тяжёлая): tools/blender_assets/ в .gitignore. Нет файла — модуль
скачивает его сам (HDRI_URL, Poly Haven, CC0), без сети — падает обратно на прежний
градиентный мир и пишет об этом в консоль.
"""
import bpy
import bmesh
import math
import os
import urllib.request
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.environ.get('HC_ASSETS') or os.path.join(HERE, 'blender_assets')
# Студийная HDRI: Poly Haven «Studio Small 09», CC0 (https://polyhaven.com/a/studio_small_09).
# Мягкие софтбоксы сверху и сбоку, тёмный пол — металл на ней читается как на фото каталога
# (светлая грань, тёмная полоса снизу, блик по кромке).
HDRI_NAME = 'studio_small_09_2k.hdr'
HDRI_URL = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/studio_small_09_2k.hdr'
HDRI_STRENGTH = 1.25
HDRI_ROT = math.radians(30)      # поворот окружения вокруг Z: главный софтбокс слева сверху

LOOK = [os.environ.get('HC_LOOK', 'illus')]
# Движок по умолчанию — Cycles (решение владельца 05.11.2026: качество важнее скорости).
# HC_ENGINE=eevee — быстрый черновик
ENGINE = [os.environ.get('HC_ENGINE', 'cycles')]


def set_look(look=None, engine=None):
    if look:
        LOOK[0] = look
    if engine:
        ENGINE[0] = engine


def legacy():
    return LOOK[0] == 'legacy'


def illus():
    return LOOK[0] == 'illus'


# ── цвета ────────────────────────────────────────────────────────────────
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
    'ni_silver': (0.78, 0.79, 0.80),   # никель концевой группы (фото SMS-1000-010001)
    'capwhite': (0.94, 0.94, 0.92),
}


def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def add_colors(d):
    """Добавить цвета (sRGB 0…1) в общую таблицу C — в линейном виде."""
    C.update({k: tuple(_lin(x) for x in v) for k, v in d.items()})


_raw = dict(C)
C.clear()
add_colors(_raw)

# ── библиотека металлов ──────────────────────────────────────────────────
# Для каждого металла два набора: legacy — прежний (ключ цвета C, шероховатость, металличность),
# pbr — физический металл: base — цвет отражения (sRGB, светлая сторона детали на фото каталога,
# 75–92-й процентиль яркости металла без фона — tools/photo_probe.py), rough — по размаху
# «тень → свет» на том же фото (зеркальные детали дают широкий размах и резкий блик, сатин —
# узкий). aniso — шлифовка вдоль оси (сатин компенсатора).
# illus — цвет детали в иллюстрации (sRGB): светлый, как на листах-образцах; оттенок — с фото
# (тёплый никель кранов чуть желтее холодного концевой группы, хром — голубоватый)
ILLUS = {
    'nickel_warm': (0.84, 0.82, 0.78), 'nickel_cold': (0.83, 0.83, 0.82), 'chrome': (0.86, 0.88, 0.90),
    'steel_lever': (0.76, 0.77, 0.79), 'stainless_bar': (0.84, 0.85, 0.86), 'satin': (0.78, 0.78, 0.80),
    'brass': (0.93, 0.68, 0.22), 'zinc': (0.78, 0.79, 0.81), 'zinc_bracket': (0.80, 0.81, 0.83),
}

LIB = {
    'nickel_warm': dict(legacy=('nickel', 0.28, 0.55), base=(0.89, 0.84, 0.80), rough=0.30,
                        src='SVB-1007-000020: свет 228,213,203; SFT-0004-003434: 207,200,188 — тёплый никель кранов и фитингов'),
    'nickel_cold': dict(legacy=('ni_silver', 0.20, 0.90), base=(0.86, 0.85, 0.81), rough=0.25,
                        src='SMS-1000-010001: свет 219,216,207 — концевая группа, никель холоднее кранов, блик резче'),
    'chrome': dict(legacy=('chrome', 0.08, 0.85), base=(0.85, 0.87, 0.86), rough=0.08,
                   src='SFT-0002-003430: свет 216,221,218, блик голубоватый — зеркальный хром удлинителя'),
    'steel_lever': dict(legacy=('chrome', 0.30, 0.60), base=(0.80, 0.81, 0.82), rough=0.34,
                        src='SVB-0001/0003: оцинкованная полоса рычага, полуматовая'),
    'stainless_bar': dict(legacy=('chrome', 0.24, 0.70), base=(0.82, 0.83, 0.84), rough=0.30,
                          src='SMS-0907: профиль гребёнки из нержавейки, шлифованный'),
    'satin': dict(legacy=('satin', 0.55, 0.35), base=(0.74, 0.73, 0.75), rough=0.45, aniso=0.5,
                  src='SVS-1014-000015: тень 152, свет 188 — узкий размах, матовый сатин компенсатора'),
    'brass': dict(legacy=('brass', 0.30, 0.50), base=(0.77, 0.62, 0.39), rough=0.32,
                  src='SFT-0024-000034: свет 196,157,100, блик 245,208,143 — латунь заглушки и штуцеров'),
    'zinc': dict(legacy=('zinc', 0.38, 0.55), base=(0.70, 0.71, 0.72), rough=0.40,
                 src='SAC-0020-300001: свет 166 нейтральный — оцинковка хомута и шпильки'),
    'zinc_bracket': dict(legacy=('zinc', 0.34, 0.60), base=(0.72, 0.73, 0.74), rough=0.38,
                         src='SMS-0907 кронштейн: оцинковка, штамповка'),
}

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


def metal(name):
    """Металл из библиотеки LIB — в текущем виде (legacy или pbr)."""
    d = LIB[name]
    if illus():
        # «полуметалл» без зеркала: в нём отражается только мягкий градиент мира (светлый
        # верх, серый низ) — широкий светлый отблеск и тень, как на листах-образцах
        sh = 0.70 if name == 'chrome' else 0.62
        k = ('illus', name)
        if k in MATS:
            return MATS[k]
        m = bpy.data.materials.new('il_' + name)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = tuple(_lin(x) for x in ILLUS[name]) + (1,)
        b.inputs['Metallic'].default_value = 0.45
        b.inputs['Roughness'].default_value = 1.0 - sh
        try:
            b.inputs['Specular IOR Level'].default_value = 0.35
        except Exception:
            pass
        MATS[k] = m
        return m
    if legacy():
        key, rough, mt = d['legacy']
        return mat(key, rough=rough, metal=mt)
    k = ('lib', name)
    if k in MATS:
        return MATS[k]
    m = bpy.data.materials.new('lib_' + name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = tuple(_lin(x) for x in d['base']) + (1,)
    b.inputs['Metallic'].default_value = 1.0
    b.inputs['Roughness'].default_value = d['rough']
    if d.get('aniso'):
        try:
            b.inputs['Anisotropic'].default_value = d['aniso']
        except Exception:
            pass
    MATS[k] = m
    return m


def M_NICKEL():
    return metal('nickel_warm')


def M_CHROME():
    return metal('chrome')


def M_SATIN():
    return metal('satin')


def M_BRASS():
    return metal('brass')


def M_PLAST(c):
    # пластик: в pbr чуть матовее и с тонким лаком — глянцевый колпак на фото даёт мягкий блик
    if legacy():
        return mat(c, rough=0.30, coat=0.6)
    return mat(c, rough=0.45, coat=0.15) if illus() else mat(c, rough=0.34, coat=0.35)


# ── сцена ────────────────────────────────────────────────────────────────

def hdri_path():
    """Путь к HDRI; нет файла — скачать (Poly Haven, CC0). Нет сети — None."""
    p = os.path.join(ASSETS, HDRI_NAME)
    if os.path.isfile(p):
        return p
    try:
        os.makedirs(ASSETS, exist_ok=True)
        print('blender_parts: скачиваю HDRI', HDRI_URL)
        req = urllib.request.Request(HDRI_URL, headers={'User-Agent': 'heatcalc-render'})
        with urllib.request.urlopen(req, timeout=60) as r, open(p + '.part', 'wb') as f:
            f.write(r.read())
        os.replace(p + '.part', p)
        return p
    except Exception as e:
        print('blender_parts: HDRI недоступна (%s) — прежний градиентный мир' % e)
        return None


def _gradient_world(nt, bg, mix):
    """Прежний мир: в отражениях металла градиент «светлый верх / серый низ»."""
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    mr = nt.nodes.new('ShaderNodeMapRange')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
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
    nt.links.new(ramp.outputs['Color'], mix.inputs[6])


def set_engine(sc, name):
    """Движок сцены: cycles (адаптивная выборка, шумодав) или eevee."""
    if name == 'cycles':
        sc.render.engine = 'CYCLES'
        sc.cycles.samples = int(os.environ.get('HC_SAMPLES', '128'))
        sc.cycles.use_adaptive_sampling = True
        sc.cycles.adaptive_threshold = 0.02
        sc.cycles.use_denoising = True
        try:
            sc.cycles.device = 'CPU'
        except Exception:
            pass
    else:
        sc.render.engine = 'BLENDER_EEVEE'
        try:
            sc.eevee.taa_render_samples = 48 if legacy() else 64
        except Exception:
            pass


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    COLL.clear()
    sc = bpy.context.scene
    set_engine(sc, 'cycles' if (ENGINE[0] == 'cycles' and not legacy()) else 'eevee')
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    # Мир: в кадре чисто белый фон (камера видит белое), а в отражениях металла — окружение:
    # HDRI студии или прежний градиент. Без него никель и латунь плоские.
    w = bpy.data.worlds.new('W')
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    lp = nt.nodes.new('ShaderNodeLightPath')
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    hp = None if (legacy() or illus()) else hdri_path()
    if illus():
        # иллюстрация: мягкий рассеянный свет со всех сторон — светлый верх, чуть серее низ;
        # даёт объём и затенение в стыках без бликов и отражений
        tc = nt.nodes.new('ShaderNodeTexCoord')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        mr = nt.nodes.new('ShaderNodeMapRange')
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        nt.links.new(tc.outputs['Generated'], sep.inputs[0])
        nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
        mr.inputs['From Min'].default_value = -1
        mr.inputs['From Max'].default_value = 1
        nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
        els = ramp.color_ramp.elements
        els[0].position = 0.35
        els[0].color = (0.36, 0.37, 0.39, 1)
        els[1].position = 0.65
        els[1].color = (1, 1, 1, 1)
        nt.links.new(ramp.outputs['Color'], mix.inputs[6])
        bg.inputs['Strength'].default_value = 0.8
    elif hp:
        env = nt.nodes.new('ShaderNodeTexEnvironment')
        env.image = bpy.data.images.load(hp, check_existing=True)
        tc = nt.nodes.new('ShaderNodeTexCoord')
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Rotation'].default_value = (0, 0, HDRI_ROT)
        nt.links.new(tc.outputs['Generated'], mp.inputs['Vector'])
        nt.links.new(mp.outputs['Vector'], env.inputs['Vector'])
        nt.links.new(env.outputs['Color'], mix.inputs[6])
        bg.inputs['Strength'].default_value = HDRI_STRENGTH
    else:
        _gradient_world(nt, bg, mix)
    nt.links.new(lp.outputs['Is Camera Ray'], mix.inputs['Factor'])
    mix.inputs[7].default_value = (1, 1, 1, 1)
    nt.links.new(mix.outputs[2], bg.inputs['Color'])
    sc.world = w
    # Солнца: в legacy — основной свет; при HDRI свет даёт окружение, солнца слабее —
    # только рисуют форму (светлая грань слева сверху, как на фото каталога)
    k = 1.0 if (legacy() or not hp) else 0.6
    if illus():
        k = 1.0
    for name, energy, rot in (('key', 1.3, (math.radians(50), 0, math.radians(-35))),
                              ('rim', 0.5, (math.radians(-60), 0, math.radians(150)))):
        d = bpy.data.lights.new(name, 'SUN')
        d.energy = energy * k
        d.angle = math.radians(40 if illus() else 20)
        d.use_shadow = False
        ob = bpy.data.objects.new(name, d)
        ob.rotation_euler = rot
        sc.collection.objects.link(ob)
    return sc


# ── объекты и примитивы ──────────────────────────────────────────────────

PART = ['']        # ключ детали для создаваемых объектов
marks = {}         # точки сносок: ключ -> точка мира
COLL = {}


def part(key):
    PART[0] = key


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
          knurl=None, caps=True, ribs=None):
    """Тело вращения по профилю [(r, h), ...] снизу вверх вдоль оси. ribs = (n, глубина, h0, h1) —
    n продольных рёбер на участке h0..h1 (пазы глубиной в долях радиуса; segs кратно 4n)."""
    bm = bmesh.new()
    rings = []
    for r, h in prof:
        ring = []
        for i in range(segs):
            a = 2 * math.pi * i / segs + rot
            rr = r * (1.025 if knurl and r >= knurl and i % 2 else 1.0)
            if ribs and ribs[2] <= h <= ribs[3] and (i % (segs // ribs[0])) >= segs // ribs[0] // 2:
                rr = r * (1 - ribs[1])
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


def thread(r, length, pitch=0.0016, depth=0.0006, start=0.0):
    """Профиль резьбы-накатки: витки — чередующиеся радиусы, как блестит резьба на фото."""
    out, h = [], 0.0
    while h < length - 1e-6:
        out += [(r, start + h), (r - depth, start + min(length, h + pitch / 2))]
        h += pitch
    out.append((r, start + length))
    return out


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
    """Труба по ломаной pts радиусом r (кривая с фаской, торцы закрыты)."""
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


def transformed(T, fn, *a, **kw):
    """Построить деталь fn(*a) в своей позе и перенести всё созданное матрицей T.
    Возвращает множество новых объектов."""
    pre = set(bpy.context.scene.objects)
    fn(*a, **kw)
    bpy.context.view_layer.update()
    new = set(bpy.context.scene.objects) - pre
    for o in new:
        o.matrix_world = T @ o.matrix_world
    return new


# ── типовые детали ───────────────────────────────────────────────────────

# Ручки крана (локально: u — вдоль трубы, d — от оси крана по штоку). Размеры — паспорт
# STOUT SVB-0007/1007 для 3/4": размах бабочки L2 = 64 мм, верх ручки H2 = 45,7 мм от оси;
# форма — фото каталога SVB-0002/0007/1007, RBV-0005 с нескольких ракурсов.
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
    steel = metal('steel_lever')
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


def ek_fit(loc, axis):
    """Евроконус 16 (фото SFC-0020-001620/001622): никелированная накидная гайка 3/4" —
    шестигранник под ключ ~29 мм с сильно скруглёнными гранями и фасками, из неё выходит
    латунный штуцер с буртом под трубу. Возвращает длину узла по оси.
    HC_PIPE=stable (стабильная труба 16,2x2,6 — евроконуса под неё нет): переходник аксиальный с накидной
    гайкой SFA-0034-001634 (паспорт SFA ред. 6, п. 18: L 38,3) и монтажная гильза SFA-0020-000016."""
    dirv = {'-Y': Vector((0, -1, 0)), '-Z': Vector((0, 0, -1))}[axis]
    if os.environ.get('HC_PIPE') == 'stable':
        br = M_BRASS()
        hexnut('гайка 3/4" переходника', 0.030, 0.012, br, tuple(Vector(loc)), axis, ch=0.14)
        v = Vector(loc) + dirv * 0.012
        lathe('корпус переходника', [(0.0090, 0), (0.0090, 0.004)], br, tuple(v), axis, segs=32)
        lathe('штуцер аксиальный', [(0.0075, 0), (0.0090, 0.004), (0.0075, 0.010), (0.0090, 0.014), (0.0075, 0.020)],
              br, tuple(v + dirv * 0.004), axis, segs=32)
        lathe('гильза', [(0.0115, 0), (0.0115, 0.020), (0.0105, 0.022)], br, tuple(v + dirv * 0.005), axis, segs=40)
        return 0.0218
    R_ = 0.029 / math.sqrt(3)
    hexa = [(R_ * math.cos(math.pi / 6 + k * math.pi / 3), R_ * math.sin(math.pi / 6 + k * math.pi / 3))
            for k in range(6)]
    prism('гайка ЕК', rounded(hexa, 0.0032, seg=4), 0.0160, M_NICKEL(),
          Matrix.Translation(Vector(loc) + dirv * 0.0080) @ AXIS[axis], bevel=0.0012)
    v = Vector(loc) + dirv * 0.0160
    lathe('штуцер ЕК', [(0.0108, 0), (0.0108, 0.0012), (0.0100, 0.0016), (0.0100, 0.0040), (0.0090, 0.0048),
                        (0.0086, 0.0058)], M_BRASS(), tuple(v), axis, segs=40)
    return 0.0218


def union_ball_valve(x):
    """Кран шаровой с американкой по оси X от x (фото SVB-1007 / RBV-0005): ниппель
    американки НР (виден край), накидная гайка, корпус с поясками, шестигранник ВР.
    Возвращает (центр корпуса по X, конец крана по X). Ручку ставит valve_top()."""
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
    return xc, x


# Поза ручки крана на трубе по X: детали ручки строятся в своей позе (труба по Z, шток к -Y)
# и переносятся — труба по X, шток вверх; крылья бабочки в плоскости трубы и штока
VALVE_TOP = Matrix(((0, 0, 1, 0), (-1, 0, 0, 0), (0, -1, 0, 0), (0, 0, 0, 1)))


def valve_boss(T):
    """Бобышка штока крана в позе T (ручка ставится поверх неё)."""
    return transformed(T, lathe, 'бобышка штока', [(0.0104, 0), (0.0104, 0.0040), (0.0098, 0.0045)],
                       M_NICKEL(), (0, -0.0115, 0), '-Y')


def water_hammer(x0, sg=1, axis='X'):
    """Компенсатор гидроудара SVS-1014-000015 по оси X от x0 (sg — в какую сторону):
    габариты — паспорт (табл. 3: H 90, D 52, l 13, SW 30, SW1 47), доли по высоте — замер
    силуэта фото каталога (масштаб по резьбе 1/2"): крышка ~48 мм (на чертеже паспорта короче,
    фото точнее), шестигранник SW1 ~18 мм со скруглённым низом ~7 мм, короткий шестигранник
    SW 30 ~4 мм, резьба 13 мм почти вся в футорке. Покрытие матовое (фото каталога), не
    зеркальный хром. Возвращает X начала крышки."""
    sat = M_SATIN()
    lathe('компенсатор резьба', thread(0.0104, 0.003), sat, (x0, 0, 0), axis, segs=40)
    x0 += sg * 0.003
    hexnut('компенсатор SW30', 0.030, 0.0040, sat, (x0, 0, 0), axis, ch=0.0)
    x0 += sg * 0.0040
    lathe('компенсатор низ', [(0.0150, 0), (0.0205, 0.0010), (0.0240, 0.0030), (0.0258, 0.0055),
                              (0.0262, 0.0062), (0.0250, 0.0066), (0.0262, 0.0070)], sat, (x0, 0, 0), axis, segs=64, sharp=40)
    x0 += sg * 0.0070
    hexnut('компенсатор SW47', 0.047, 0.018, sat, (x0, 0, 0), axis, ch=0.08)
    x0 += sg * 0.018
    lathe('компенсатор крышка', [(0.0243, 0), (0.0243, 0.0020), (0.0240, 0.0430), (0.0228, 0.0465),
                                 (0.0200, 0.0478), (0.0, 0.0480)], sat, (x0, 0, 0), axis, segs=64, sharp=40)
    return x0


def plug34(xe, sg=1, axis='X'):
    """Заглушка 3/4" НР (фото SFT-0024-000034): латунный шестигранник, резьба в торце."""
    hexnut('заглушка', 0.032, 0.012, M_BRASS(), (xe, 0, 0), axis)
    lathe('заглушка торец', [(0.0150, 0), (0.0150, 0.002), (0.0130, 0.003), (0.0, 0.003)],
          M_BRASS(), (xe + sg * 0.012, 0, 0), axis)


def pipe_fixator90(C, u, v, R, r=0.0086, name='фиксатор 90', t0=-0.10, t1=math.pi / 2 + 0.10):
    """Фиксатор поворота трубы 90° STOUT SFA-0029 (металл, оцинкованный; паспорт SFA-0029/0036,
    табл. 4: для трубы 16 — L 112, H 80, h 16,5, R 70 мм; радиус изгиба 5D): гнутая
    оцинкованная пластина-жёлоб по ВНУТРЕННЕЙ стороне поворота — труба лежит в желобе и огибает
    его. Поворот задаётся центром C, единичными векторами u (от центра к началу дуги) и v (к
    концу дуги), радиусом R по оси трубы; r — радиус желоба (труба 16 + зазор). Жёлоб —
    полуцилиндр, обращённый к центру поворота, толщина пластины 0,8 мм (модификатор)."""
    C, u, v = Vector(C), Vector(u), Vector(v)
    b = u.cross(v).normalized()
    bm = bmesh.new()
    rows = []
    nt, nf = 24, 12
    for i in range(nt + 1):
        t = t0 + (t1 - t0) * i / nt
        n = u * math.cos(t) + v * math.sin(t)          # от центра поворота наружу
        c = C + n * R
        # профиль: полка — жёлоб (полуокружность к центру поворота) — полка; полки по 4 мм
        prof = [(0.0, -(r + 0.004))] + [(math.cos(-math.pi / 2 + math.pi * j / nf) * r,
                                          math.sin(-math.pi / 2 + math.pi * j / nf) * r) for j in range(nf + 1)] + [(0.0, r + 0.004)]
        rows.append([bm.verts.new(c - n * q + b * w) for q, w in prof])
    for a_, b_ in zip(rows, rows[1:]):
        for j in range(len(a_) - 1):
            bm.faces.new((a_[j], a_[j + 1], b_[j + 1], b_[j]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(metal('zinc'))
    me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    sol = ob.modifiers.new('sol', 'SOLIDIFY')
    sol.thickness = 0.0008
    return link(ob)


def clamp(k, xc):
    """Хомут одновинтовой 1" с гайкой M8 (фото SAC-0020-300001): стальная оцинкованная лента
    ~20 мм на чёрной резиновой вставке (резина выступает по краям), сверху стяжка — два ушка
    и винт с гайкой, сзади к стене приварная гайка M8. Шпилька M8x100 (фото SAC-0020-400100):
    резьба M8 от гайки к стене, у стены шурупная часть в сером дюбеле. Ось трубы — X."""
    part('clamp:%d' % k)
    zinc = metal('zinc')
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


def end_group(x1, y, z, key):
    """Концевая группа коллектора ТП (фото STOUT SMS-1000-010001 и ROMMER RMS-1001, паспорт
    SMS, поз. 7, 9, 13; высота над осью ~90 мм — H2): в торец гребёнки — штуцер 1" с чёрным
    уплотнительным кольцом и шестигранником, тело-тройник; вверх — автоматический
    воздухоотводчик (шейка, гладкий стакан ~33 мм, крышка ~43 мм с рифлёным пояском и куполом,
    чёрный колпачок клапана); вниз — спускной штуцер с резьбой; к зрителю — белая ручка
    сливного крана. Ось гребёнки — X, группа справа от x1."""
    # никель концевой группы — холодный серебристый с бликами (фото SMS-1000), не тёплый никель кранов
    NI = metal('nickel_cold')
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


def bracket(xb, rb, h1, yu):
    """Кронштейн коллектора ТП (паспорт SMS, поз. 3; фото комплекта): оцинкованная
    штампованная полоса за гребёнками — сверху ушко с отверстием под дюбель, по длине прорези,
    между гребёнками изгиб: обратная гребёнка (ось на высоте h1, отнесена к стене на yu) ближе
    к стене, подающая на выносе. На каждой гребёнке (полувысота профиля rb) — хомут по профилю."""
    zinc = metal('zinc_bracket')
    dark = mat('black', rough=0.6)
    W_, T_ = 0.026, 0.0022
    yu_ = yu + rb + 0.003 + T_ / 2         # полоса за обратной гребёнкой
    yl = rb + 0.003 + T_ / 2               # и за подающей
    zj = 0.050                             # высота изгиба
    zt, zb = h1 + 0.060, -0.032
    box('полоса верх', (W_, T_, zt - zj), zinc, (xb, yu_, (zt + zj) / 2))
    box('изгиб', (W_, yu_ - yl + T_, T_), zinc, (xb, (yu_ + yl) / 2, zj))
    box('полоса низ', (W_, T_, zj - zb), zinc, (xb, yl, (zj + zb) / 2))
    # ушко с отверстием под шуруп и прорези по длине
    lathe('ушко', [(0.0, 0), (W_ / 2, 0), (W_ / 2, T_), (0.0, T_)], zinc, (xb, yu_ + T_ / 2, zt), '-Y', segs=32)
    lathe('отверстие', [(0.0, 0), (0.0042, 0), (0.0042, 0.0004), (0.0, 0.0004)], dark, (xb, yu_ - T_ / 2 - 0.0001, zt), '-Y', segs=20)
    for zc_ in (h1 * 0.55, h1 * 0.30):
        box('прорезь', (0.0060, 0.0004, 0.022), dark, (xb, yu_ - T_ / 2 - 0.0002, zc_))
    # штамповка: ряд круглых отверстий по полосе (как на листах проекта и фото комплекта)
    zz = zj + 0.022
    while zz < zt - 0.030:
        if abs(zz - h1) > 0.030 and all(abs(zz - q) > 0.018 for q in (h1 * 0.55, h1 * 0.30)):
            lathe('отверстие полосы', [(0.0, 0), (0.0030, 0), (0.0030, 0.0004), (0.0, 0.0004)], dark,
                  (xb, yu_ - T_ / 2 - 0.0001, zz), '-Y', segs=16)
        zz += 0.024
    for zz in (zj - 0.020, zb + 0.012):
        lathe('отверстие полосы', [(0.0, 0), (0.0030, 0), (0.0030, 0.0004), (0.0, 0.0004)], dark,
              (xb, yl - T_ / 2 - 0.0001, zz), '-Y', segs=16)
    # хомуты по профилю гребёнки
    for z, y in ((0.0, 0.0), (h1, yu)):
        sq = rounded([(-rb - 0.0022, -rb - 0.0022), (rb + 0.0022, -rb - 0.0022), (rb + 0.0022, rb + 0.0022),
                      (-rb - 0.0022, rb + 0.0022)], 0.0085, seg=5)
        m = Matrix.Translation(Vector((xb, y, z))) @ Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
        prism('хомут гребёнки', sq, 0.016, zinc, m, bevel=0.0006)
        lathe('винт хомута', [(0.0, 0), (0.0032, 0), (0.0032, 0.0015), (0.0, 0.0022)], zinc, (xb, y, z + rb + 0.0022), 'Z', segs=20)
        hexnut('гайка хомута', 0.0065, 0.0028, zinc, (xb, y, z - rb - 0.0022), '-Z')


# ── камера, линии, проходы ───────────────────────────────────────────────

LINE_COLOR = (0.28, 0.30, 0.34)
VIEW_DIR = (-0.46, -1.0, 0.40)     # ракурс всех кадров схем — один на все узлы


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


# Запас разрешения рендера над масштабом кадра сметы: сборщик потом уменьшает кадр до
# PX_PER_M (LANCZOS) — так кромки и линии чётче, чем у кадра «пиксель в пиксель»
OVERSAMPLE = 1.3


def camera(sc, width=None, objects=None, ppm=None):
    """Ортокамера по ракурсу VIEW_DIR, кадр по охвату объектов (по умолчанию — всех).
    Ширина кадра: width пикселей, либо по масштабу — ppm пикселей на метр плоскости камеры
    (по умолчанию HC_PX_PER_M × OVERSAMPLE: сборщик кадров передаёт свой PX_PER_M), иначе
    1400 px — прежнее поведение."""
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in (objects if objects is not None else sc.objects):
        if o.type in ('MESH', 'CURVE'):
            pts += mesh_points(o, dg)
    c = sum(pts, Vector()) / len(pts)
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cam = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    d = Vector(VIEW_DIR).normalized()
    cam.location = c + d * 3
    cam.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    q = [inv @ p for p in pts]
    xs = [p.x for p in q]
    ys = [p.y for p in q]
    w = (max(xs) - min(xs)) * 1.06
    h = (max(ys) - min(ys)) * 1.06
    if not width and not ppm and os.environ.get('HC_PX_PER_M'):
        ppm = float(os.environ['HC_PX_PER_M']) * OVERSAMPLE
    W = width or (int(round(w * ppm)) if ppm else 1400)
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


def frame_meta(sc, cam, anchors=None):
    """Метаданные кадра в долях кадра: зоны деталей (охват проекций вершин объектов детали;
    anchors — деталь -> точка мира, вокруг которой зона берётся вместо охвата), точки сносок
    (marks) и привязка к миру: начало координат и проекции единичных осей X, Y, Z. Камера
    ортогональная и одна на все кадры — по привязке смета ставит кадры в одном масштабе."""
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
    for k, p in (anchors or {}).items():
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
    return zones, pts, proj


def write_meta(sc, path, zones, pts, proj):
    import json
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({'w': sc.render.resolution_x, 'h': sc.render.resolution_y,
                   'zones': {k: [round(v, 4) for v in z] for k, z in zones.items()},
                   'marks': pts, 'proj': proj}, f, ensure_ascii=False)


def id_pass(sc, objects, ID, path):
    """Карта деталей: каждая сноска своим плоским цветом (ID: ключ детали -> RGB), без
    сглаживания, линий и света; фон чёрный."""
    em = {}
    for o in objects:
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
    wn = sc.world.node_tree
    wn.nodes['Background'].inputs['Color'].default_value = (0, 0, 0, 1)
    for n in list(wn.links):
        wn.links.remove(n)
    wn.links.new(wn.nodes['Background'].outputs[0], wn.nodes['World Output'].inputs[0])
    for ob in sc.objects:
        if ob.type == 'LIGHT':
            ob.hide_render = True
    sc.render.use_freestyle = False
    sc.render.film_transparent = False
    sc.render.filter_size = 0.0
    if sc.render.engine == 'CYCLES':
        sc.cycles.samples = 1
        sc.cycles.use_denoising = False
    else:
        try:
            sc.eevee.taa_render_samples = 1
        except Exception:
            pass
    render(sc, path)
