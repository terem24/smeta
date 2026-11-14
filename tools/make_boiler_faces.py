# -*- coding: utf-8 -*-
"""
Текстуры фасадов котлов по фото каталога (img/<артикул>.jpg) → tools/tex/<имя>_front.png.
  * Haier NeoSlim (GE0Q6QE0CRU): фото строго спереди — вырезается корпус без дымохода и ножки, пропорции 400 x 725.
  * STOUT STATUS (SEB-3101): фото под углом — передняя грань (правая на фото, на ней логотип и контроллер)
    выпрямляется перспективным преобразованием в прямоугольник 426 x 741.
Запуск: python tools/make_boiler_faces.py
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(os.path.dirname(HERE), 'img')
TEX = os.path.join(HERE, 'tex')
os.makedirs(TEX, exist_ok=True)

# Haier: корпус x 169–433, y 66–538 (измерено по маске фото 600 x 600), 264 x 472 = 0,559 = 400 / 725
a = Image.open(os.path.join(IMG, 'GE0Q6QE0CRU.jpg')).convert('RGB').crop((169, 66, 433, 538))
a.resize((528, 944), Image.LANCZOS).save(os.path.join(TEX, 'GE0Q6QE0CRU_front.png'))

# STATUS: передняя грань на фото 600 x 600 — верх-лево (264, 4), верх-право (470, 36), низ-право (470, 549), низ-лево (264, 585)
b = Image.open(os.path.join(IMG, 'SEB-3101-000012.jpg')).convert('RGB')
W, H = 640, 1113                                   # 426 / 741 = 0,575
quad = (264, 4, 264, 585, 470, 549, 470, 36)       # порядок PIL: верх-лево, низ-лево, низ-право, верх-право
b.transform((W, H), Image.QUAD, quad, Image.BICUBIC).save(os.path.join(TEX, 'SEB-3101_front.png'))
# Стабилизатор ST 600 (SST-0001-000600): фото строго спереди, корпус x 172–452, y 100–470 (280 x 370 = 0,757 = 130 / 170)
c = Image.open(os.path.join(IMG, 'SST-0001-000600.jpg')).convert('RGB').crop((172, 100, 452, 470))
c.resize((560, 740), Image.LANCZOS).save(os.path.join(TEX, 'SST-0001-000600_front.png'))
# POLIS (SEB-5101): фото под углом, передняя грань слева — верх-лево (177, 45), низ-лево (177, 515), низ-право (357, 570), верх-право (357, 88)
# на фото 600 x 600; грань 247 x 750 мм -> 380 x 1154
d = Image.open(os.path.join(IMG, 'SEB-5101-000012.jpg')).convert('RGB')
t = d.transform((380, 1154), Image.QUAD, (177, 45, 177, 515, 357, 570, 357, 88), Image.BICUBIC)
# панель управления (ручка, три клавиши, манометр) на фото снята под углом и при выпрямлении плывёт — рисуется деталями,
# а здесь закрашивается полосой чистого фасада выше неё (оттенок фасада меняется только по горизонтали)
t.paste(t.crop((0, 700, 380, 880)), (0, 920))
t.save(os.path.join(TEX, 'SEB-5101_front.png'))
print('ok')


# ───────── POLIS: панель управления рисуется заново (фото снято под углом, ручка и манометр на нём объёмные) ─────────
# Раскладка — по фото каталога SEB-5101 и рис. 1/10 паспорта: плита 143 x 94 мм, слева ручка термостата Ø40 с белым
# маркером над ней, три клавиши 1-2-3 (над ними «СЕТЬ» и «АВАРИЯ» с лампами), справа манометр Ø38 с цветными зонами.
from PIL import ImageDraw, ImageFont
import math as _m


def _font(px, bold=False):
    for f in ('arialbd.ttf' if bold else 'arial.ttf', 'DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf'):
        try:
            return ImageFont.truetype(f, px)
        except OSError:
            pass
    return ImageFont.load_default()


def polis_panel():
    """Плита 157 x 74 мм по фронтальному чертежу паспорта (рис. 10, вид спереди): слева ручка термостата, над ней
    указатель, три клавиши L1-L3 (над первой и третьей — кольцевые лампы «СЕТЬ» и «АВАРИЯ»), справа манометр."""
    k = 8                                               # пикселей на мм
    W, H = 157 * k, 74 * k
    S = 2                                               # сглаживание
    im = Image.new('RGB', (W * S, H * S), (238, 236, 234))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, W * S - 1, H * S - 1), radius=9 * k * S, fill=(16, 16, 18))
    d.rounded_rectangle((1.6 * k * S, 1.6 * k * S, W * S - 1.6 * k * S, H * S - 1.6 * k * S), radius=7.5 * k * S, outline=(34, 34, 38), width=2 * S)
    P = lambda x, y: (x * k * S, y * k * S)
    white, grey = (226, 226, 224), (150, 150, 152)
    # указатель над ручкой (на чертеже — контурный треугольник, чуть правее оси ручки)
    d.polygon([P(26.6, 19.5), P(24.2, 13.5), P(29.0, 13.5)], outline=white, width=2 * S)
    # кольцевые лампы и подписи над клавишами
    for x in (64, 95.6):
        d.ellipse((P(x - 3.4, 12.8 - 3.4), P(x + 3.4, 12.8 + 3.4)), outline=(110, 110, 116), width=2 * S, fill=(26, 26, 30))
    f = _font(int(2.9 * k * S), True)
    for txt, x in (('СЕТЬ', 64), ('АВАРИЯ', 95.6)):
        w = d.textlength(txt, font=f)
        d.text((x * k * S - w / 2, 21 * k * S), txt, font=f, fill=grey)
    # обозначения фаз под клавишами
    f2 = _font(int(3.4 * k * S), True)
    for n, x in zip(('L1', 'L2', 'L3'), (61.4, 79.3, 98.2)):
        w = d.textlength(n, font=f2)
        d.text((x * k * S - w / 2, 59 * k * S), n, font=f2, fill=grey)
    im.resize((W, H), Image.LANCZOS).save(os.path.join(TEX, 'SEB-5101_panel.png'))


def polis_knob():
    """Лицо ручки термостата: белый диск, крупные риски по дуге 270°, указатель-метка (на малом диске цифры не читаются)."""
    N, S = 512, 2
    im = Image.new('RGB', (N * S, N * S), (232, 232, 230))
    d = ImageDraw.Draw(im)
    c = N * S / 2
    for i in range(0, 31):
        a = _m.radians(-135 + 9 * i)
        big = i % 5 == 0
        r0, r1 = (0.55 if big else 0.70) * c, 0.90 * c
        d.line([(c + r0 * _m.sin(a), c - r0 * _m.cos(a)), (c + r1 * _m.sin(a), c - r1 * _m.cos(a))], fill=(55, 55, 60), width=(20 if big else 10) * S)
    d.line([(c, c), (c, c - 0.42 * c)], fill=(55, 55, 60), width=22 * S)
    d.ellipse((c - 0.10 * c, c - 0.10 * c, c + 0.10 * c, c + 0.10 * c), fill=(120, 120, 124))
    im.resize((N, N), Image.LANCZOS).save(os.path.join(TEX, 'SEB-5101_knob.png'))


def polis_gauge():
    """Лицо манометра: белый диск, дуга зон (жёлтая, зелёная, красная), риски, чёрная стрелка, надпись bar."""
    N, S = 512, 2
    im = Image.new('RGB', (N * S, N * S), (240, 240, 238))
    d = ImageDraw.Draw(im)
    c = N * S / 2
    for a0, a1, col in ((-135, -70, (232, 196, 40)), (-70, 20, (60, 160, 70)), (20, 135, (200, 40, 36))):
        d.arc((c - 0.80 * c, c - 0.80 * c, c + 0.80 * c, c + 0.80 * c), a0 - 90, a1 - 90, fill=col, width=int(0.14 * c))
    for i in range(0, 28):
        a = _m.radians(-135 + 10 * i)
        r0, r1 = (0.58 if i % 3 == 0 else 0.64) * c, 0.68 * c
        d.line([(c + r0 * _m.sin(a), c - r0 * _m.cos(a)), (c + r1 * _m.sin(a), c - r1 * _m.cos(a))], fill=(60, 60, 64), width=4 * S)
    f = _font(int(0.14 * N * S), True)
    w = d.textlength('bar', font=f)
    d.text((c - w / 2, c + 0.30 * c), 'bar', font=f, fill=(60, 60, 64))
    a = _m.radians(-20)
    d.line([(c - 0.12 * c * _m.sin(a), c + 0.12 * c * _m.cos(a)), (c + 0.62 * c * _m.sin(a), c - 0.62 * c * _m.cos(a))], fill=(15, 15, 18), width=9 * S)
    d.ellipse((c - 0.09 * c, c - 0.09 * c, c + 0.09 * c, c + 0.09 * c), fill=(15, 15, 18))
    im.resize((N, N), Image.LANCZOS).save(os.path.join(TEX, 'SEB-5101_gauge.png'))


polis_panel()
polis_knob()
polis_gauge()
