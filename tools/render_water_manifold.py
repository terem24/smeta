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
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blender_parts import *  # noqa: F401,F403 — общие детали, материалы, камера, проходы
from mathutils import Vector, Matrix
import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, LINE, N, END = argv[0], argv[1], int(argv[2]), argv[3]
TYPE = argv[4] if len(argv) > 4 else 'st'
TAG = '%s_%s_%d_%s' % (TYPE, LINE, N, END)

KNOB = 'blue' if LINE == 'cw' else 'red'
INS = 'ins_cw' if LINE == 'cw' else 'ins_hw'

P = 0.037 if TYPE == 'bl' else 0.050   # шаг выходов: SMB 62xx — 37 мм по паспорту, SMB 6850 — 50
RB = 0.0165        # радиус корпуса 1"


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
        # компенсатор гидроудара SVS-1014-000015 — деталь модуля
        part('end')
        x0 = water_hammer(xe + sg * 0.010, sg, AX_END)
        marks['end'] = (x0 + sg * 0.024, 0, 0.024)
    else:
        part('end')
        plug34(xe, sg, AX_END)
        marks['end'] = (xe + sg * 0.012, 0, 0.014)


def feed_side(xr):
    """Подводка с торца коллектора — строго по разделу 6.4 сметы, по резьбам: удлинитель
    ВН/ВР 30 мм (НР в коллектор) -> сгон прямой ВР-НР (хвостовик НР в удлинитель) -> кран
    шаровой ВН-НР (американка НР в корпус сгона) -> ниппель НР -> пресс-фитинг и короткий
    отрезок подающей трубы по оси (подвод сбоку). Тройник 6.4 стоит в узле ввода (отвод на коллектор), здесь его нет. Всё по
    оси коллектора, ручка крана сверху — как на фото каталога. У ГВС и рециркуляции подача не из
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
    # кран шаровой с американкой (фото SVB-1007 / RBV-0005) — деталь модуля; ручка сверху:
    # крылья бабочки в плоскости трубы и штока, к камере лицом
    part('ball' if keyed else '')
    xc, x = union_ball_valve(x)
    T = Matrix.Translation(Vector((xc, 0, 0))) @ VALVE_TOP
    valve_boss(T)
    marks['ball'] = (xc, -0.012, 0.012)
    # ручка — отдельным слоем на каждый вариант: тип и цвет берёт смета по артикулу крана
    for key, fn, col in HANDLES:
        for o in transformed(T, fn, 0, 0, col):
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
    # подающая труба: пресс-фитинг с ВР на ниппеле и короткий условный отрезок трубы по оси
    # магистрали — подвод сбоку, сама магистраль на схеме не рисуется
    part('')
    hexnut('пресс-фитинг', 0.030, 0.010, M_BRASS(), (x, 0, 0), 'X')
    lathe('гильза', [(0.0145, 0), (0.0145, 0.026), (0.0132, 0.030), (0.0118, 0.031)],
          M_BRASS(), (x + 0.010, 0, 0), 'X')
    x += 0.041
    tube('подающая труба', [(x - 0.004, 0, 0), (x + 0.070, 0, 0)], 0.0125, M_PLAST(LINE))


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


# ── камера, линии, проходы — в blender_parts.py

def main():
    sc = build()
    cam = camera(sc)
    from bpy_extras.object_utils import world_to_camera_view
    zones, pts, proj = frame_meta(sc, cam)
    dg = bpy.context.evaluated_depsgraph_get()

    line = LINE_COLOR
    hcols = [coll('h_' + k) for k, _, _ in HANDLES]
    for c in hcols:
        for o in c.objects:
            o.hide_render = True
    # проход 1: всё твёрдое, изоляция спрятана, линии по твёрдому. Фон прозрачный (белый —
    # только в отражениях): смета ставит коллекторы линий друг перед другом
    for o in coll('sheath').objects:
        o.hide_render = True
    sc.render.film_transparent = True
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
    # ручка — малая часть кадра: рендерится только рамка вокруг неё (кадр того же размера,
    # вне рамки прозрачно), иначе четыре полных прохода на кадр
    sc.render.use_crop_to_border = False
    for (k, _, _), c in zip(HANDLES, hcols):
        vs = [world_to_camera_view(sc, cam, p) for o in c.objects for p in mesh_points(o, dg)]
        pad = 0.02
        sc.render.border_min_x = max(0.0, min(v.x for v in vs) - pad)
        sc.render.border_max_x = min(1.0, max(v.x for v in vs) + pad)
        sc.render.border_min_y = max(0.0, min(v.y for v in vs) - pad)
        sc.render.border_max_y = min(1.0, max(v.y for v in vs) + pad)
        sc.render.use_border = True
        for o in c.objects:
            o.hide_render = False
        freestyle(sc, 'h_' + k, line, 1.8)
        render(sc, os.path.join(OUT, TAG + '_h_' + k + '.png'))
        for o in c.objects:
            o.hide_render = True
    sc.render.use_border = False

    # проход 3: карта деталей — каждая сноска своим плоским цветом, без сглаживания и линий
    ID = {'mf': (1, 0, 0), 'ek': (0, 1, 0), 'tube': (0, 0, 1), 'clamp': (1, 1, 0), 'stud': (1, 1, 0),
          'end': (1, 0, 1), 'fut': (1, 0, 1), 'ext': (0, 1, 1), 'union': (0, 1, 1), 'ball': (0, 1, 1),
          'nip': (0, 1, 1), 'tee': (0, 1, 1)}
    id_pass(sc, list(coll('solid').objects) + list(coll('sheath').objects), ID, os.path.join(OUT, TAG + '_id.png'))
    write_meta(sc, os.path.join(OUT, TAG + '.json'), zones, pts, proj)


main()
