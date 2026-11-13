# -*- coding: utf-8 -*-
"""
Текстуры-наклейки для 3D-деталей (логотипы, панель котла): рисуются кодом по фото каталога, чтобы
надписи и кнопки читались вблизи (фото каталога 600x600 — для крупного плана мало).

    python tools/make_tex3d.py

Результат: tools/blender_assets/tex3d/*.png (подхватывает tools/export_parts_glb.py).
  * haier_panel.png — панель управления Haier NeoSlim (фото img/GE0Q6QE0CRU.jpg): чёрное стекло,
    семисегментное «42» с °C, ряд из трёх значков режимов, под ним «−», питание, «+», внизу слева
    белый скос с надписью «AC Platform», тёмные шевроны по бокам. Пропорции панели 193 x 154 мм.
  * haier_logo.png — надпись Haier тёмно-синим (66 x 22 мм над панелью).
  * stout_logo_dark.png — знак STOUT с надписью из img/stout_logo.png без слогана (как на бойлере).
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, 'blender_assets', 'tex3d')
os.makedirs(OUT, exist_ok=True)
FONTS = 'C:/Windows/Fonts/'


def font(name, size):
    for n in (name, 'arialbd.ttf', 'arial.ttf'):
        try:
            return ImageFont.truetype(FONTS + n, size)
        except Exception:
            pass
    return ImageFont.load_default()


# ── панель Haier ─────────────────────────────────────────────────────────
W, H = 1310, 1046                  # 193 x 154 мм, 6,8 пикс/мм; рисуем в 2x и сжимаем
S = 2
w, h = W * S, H * S
im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
r = int(0.035 * w)
d.rounded_rectangle((0, 0, w - 1, h - 1), r, fill=(9, 9, 11, 255))


def px(xf, yf):
    return int(xf * w), int(yf * h)


# блик стекла: светлая наклонная полоса слева сверху
glare = Image.new('RGBA', (w, h), (0, 0, 0, 0))
gd = ImageDraw.Draw(glare)
gd.polygon([px(0, 0), px(0.44, 0), px(0.20, 1.0), px(0, 1.0)], fill=(52, 52, 56, 255))
glare = glare.filter(ImageFilter.GaussianBlur(w // 80))
mask = Image.new('L', (w, h), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), r, fill=255)
base = Image.new('RGBA', (w, h), (0, 0, 0, 0))
base.paste(im, (0, 0))
base.alpha_composite(Image.composite(glare, Image.new('RGBA', (w, h), (0, 0, 0, 0)), mask))
im = base
d = ImageDraw.Draw(im)

# шевроны по бокам
for sx in (0.10, 0.90):
    k = 1 if sx < 0.5 else -1
    d.polygon([px(sx - k * 0.06, 0.26), px(sx + k * 0.06, 0.52), px(sx - k * 0.06, 0.78),
               px(sx - k * 0.02, 0.78), px(sx + k * 0.10, 0.52), px(sx - k * 0.02, 0.26)], fill=(22, 22, 25, 255))

# верхняя линия: сине-красная подсветка и надпись
d.line([px(0.15, 0.14), px(0.33, 0.14)], fill=(24, 90, 130, 255), width=int(0.004 * h))
d.line([px(0.67, 0.14), px(0.85, 0.14)], fill=(24, 90, 130, 255), width=int(0.004 * h))
f = font('arial.ttf', int(0.026 * h))
t = 'RESIDENTAL COMBUSTION'
tw = d.textlength(t, font=f)
d.text((w / 2 - tw / 2, 0.14 * h - 0.013 * h), t, font=f, fill=(150, 150, 155, 255))


def seg(x, y, sw, sh, th, digit, col):
    """Семисегментная цифра; (x, y) — левый верх, sw x sh — габарит, th — толщина."""
    S7 = {'0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg',
          '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g'}[digit]
    hh = sh / 2
    pos = {'a': (x + th, y, x + sw - th, y + th), 'g': (x + th, y + hh - th / 2, x + sw - th, y + hh + th / 2),
           'd': (x + th, y + sh - th, x + sw - th, y + sh),
           'f': (x, y + th, x + th, y + hh - th / 2), 'e': (x, y + hh + th / 2, x + th, y + sh - th),
           'b': (x + sw - th, y + th, x + sw, y + hh - th / 2), 'c': (x + sw - th, y + hh + th / 2, x + sw, y + sh - th)}
    for s_ in S7:
        d.rounded_rectangle(pos[s_], th * 0.4, fill=col)


col = (236, 238, 240, 255)
dw, dh, th = 0.092 * w, 0.215 * h, 0.017 * w
x0, y0 = 0.40 * w, 0.31 * h
seg(0.325 * w, y0 + dh / 2 - th / 2, 0.034 * w, th, th * 0.9, '-', col) if False else None
d.rounded_rectangle((0.318 * w, y0 + dh / 2 - th * 0.35, 0.346 * w, y0 + dh / 2 + th * 0.35), th * 0.3, fill=col)
seg(x0 - 0.02 * w, y0, dw, dh, th, '4', col)
seg(x0 + 0.095 * w, y0, dw, dh, th, '2', col)
d.text((0.640 * w, y0 - 0.005 * h), '°C', font=font('arial.ttf', int(0.058 * h)), fill=col)
d.ellipse((0.640 * w, y0 + 0.165 * h, 0.662 * w, y0 + 0.165 * h + 0.022 * w), outline=col, width=int(0.004 * w))
d.ellipse((0.300 * w, y0 + 0.175 * h, 0.328 * w, y0 + 0.175 * h + 0.028 * w), fill=(60, 60, 64, 255))

# ряд значков режимов и штрихи над ними
xs = (0.362, 0.50, 0.640)
for x in xs:
    d.line([px(x - 0.018, 0.575), px(x + 0.018, 0.575)], fill=(95, 95, 100, 255), width=int(0.004 * h))
ic = (225, 227, 230, 255)
cx, cy, a = xs[0] * w, 0.65 * h, 0.034 * w                    # значок 1: решётка (радиатор)
for i in range(3):
    for j in range(3):
        d.rectangle((cx - a + i * a * 0.72, cy - a + j * a * 0.72, cx - a + i * a * 0.72 + a * 0.5, cy - a + j * a * 0.72 + a * 0.5), fill=ic)
cx = xs[1] * w                                                  # значок 2: домик с огоньком
d.line([(cx - a, cy + a), (cx - a, cy - a * 0.1), (cx, cy - a), (cx + a, cy - a * 0.1), (cx + a, cy + a), (cx - a, cy + a)], fill=ic, width=int(0.007 * w), joint='curve')
d.ellipse((cx - a * 0.28, cy + a * 0.05, cx + a * 0.28, cy + a * 0.8), outline=ic, width=int(0.005 * w))
cx = xs[2] * w                                                  # значок 3: кран с водой
d.line([(cx - a, cy - a), (cx + a * 0.4, cy - a), (cx + a * 0.4, cy - a * 0.3), (cx - a, cy - a * 0.3), (cx - a, cy + a), (cx + a, cy + a)], fill=ic, width=int(0.007 * w), joint='curve')
d.line([(cx + a * 0.3, cy), (cx + a, cy + a * 0.4)], fill=ic, width=int(0.006 * w))

# нижний ряд: минус, питание, плюс
cy = 0.80 * h
tw_ = int(0.006 * w)
d.line([(xs[0] * w - a * 0.7, cy), (xs[0] * w + a * 0.7, cy)], fill=ic, width=tw_)
d.line([(xs[2] * w - a * 0.7, cy), (xs[2] * w + a * 0.7, cy)], fill=ic, width=tw_)
d.line([(xs[2] * w, cy - a * 0.7), (xs[2] * w, cy + a * 0.7)], fill=ic, width=tw_)
cx = xs[1] * w
d.arc((cx - a * 0.8, cy - a * 0.8, cx + a * 0.8, cy + a * 0.8), -55, 235, fill=ic, width=tw_)
d.line([(cx, cy - a * 1.0), (cx, cy - a * 0.1)], fill=ic, width=tw_)

# белый скос внизу слева с надписью
d.polygon([px(0, 0.855), px(0.18, 0.88), px(0.30, 0.935), px(0.34, 1.0), px(0, 1.0)], fill=(246, 246, 246, 255))
d.text((0.035 * w, 0.915 * h), 'AC Platform', font=font('arial.ttf', int(0.034 * h)), fill=(40, 40, 44, 255))
# контур скругления снова, чтобы белый скос не вылез за углы
final = Image.new('RGBA', (w, h), (0, 0, 0, 0))
final.paste(im, (0, 0), mask)
final.resize((W, H), Image.LANCZOS).save(os.path.join(OUT, 'haier_panel.png'))

# ── логотип Haier ────────────────────────────────────────────────────────
lw, lh = 990, 330
lg = Image.new('RGBA', (lw * 2, lh * 2), (0, 0, 0, 0))
ld = ImageDraw.Draw(lg)
lf = font('arialbd.ttf', int(lh * 2 * 0.98))
ld.text((0, -int(lh * 0.16)), 'Haier', font=lf, fill=(24, 44, 92, 255))
bb = lg.getbbox()
lg = lg.crop(bb)
lg.resize((lw, int(lw * lg.height / lg.width)), Image.LANCZOS).save(os.path.join(OUT, 'haier_logo.png'))

# ── логотип STOUT без слогана ────────────────────────────────────────────
src = Image.open(os.path.join(ROOT, 'img', 'stout_logo.png')).convert('RGBA')
px_ = src.load()
for y in range(int(src.height * 0.80), src.height):
    for x in range(int(src.width * 0.34), src.width):      # слоган «все складывается» справа от знака
        px_[x, y] = (0, 0, 0, 0)
src = src.crop(src.getbbox())
src.resize((1200, int(1200 * src.height / src.width)), Image.LANCZOS).save(os.path.join(OUT, 'stout_logo_dark.png'))
print('ok', os.listdir(OUT))

# ── циферблат термометра 0-120 °C (бойлер, шкала по паспорту SWH-2110) ───
import math
T = 800
dial = Image.new('RGBA', (T, T), (0, 0, 0, 0))
dd = ImageDraw.Draw(dial)
c = T / 2
dd.ellipse((0, 0, T - 1, T - 1), fill=(244, 244, 242, 255))
dd.ellipse((T * 0.03, T * 0.03, T * 0.97, T * 0.97), outline=(70, 70, 74, 255), width=4)
nf = font('arialbd.ttf', int(T * 0.085))
for i in range(0, 25):
    val = i * 5                                   # 0..120 через 5
    a = math.radians(225 - i * (270 / 24))        # от 225° (низ слева) по часовой на 270°
    big = (val % 20 == 0)
    r1, r2 = T * 0.44, T * (0.36 if big else 0.40)
    dd.line([(c + r1 * math.cos(a), c - r1 * math.sin(a)), (c + r2 * math.cos(a), c - r2 * math.sin(a))],
            fill=(30, 30, 34, 255), width=7 if big else 3)
    if big:
        t = str(val)
        rr = T * 0.27
        tw_ = dd.textlength(t, font=nf)
        dd.text((c + rr * math.cos(a) - tw_ / 2, c - rr * math.sin(a) - T * 0.045), t, font=nf, fill=(30, 30, 34, 255))
for val0, val1 in ((80, 120),):                   # красная зона после 80
    for i in range(val0 // 5, val1 // 5):
        a0 = math.radians(225 - i * (270 / 24))
        dd.arc((T * 0.455 - T * 0.0, T * 0.455 - T * 0.0, T * 0.545, T * 0.545), 0, 0, fill=(0, 0, 0, 0))
na = math.radians(225 - (60 / 5) * (270 / 24))    # стрелка на 60 °C
dd.line([(c - T * 0.08 * math.cos(na), c + T * 0.08 * math.sin(na)), (c + T * 0.38 * math.cos(na), c - T * 0.38 * math.sin(na))],
        fill=(200, 30, 28, 255), width=9)
dd.ellipse((c - T * 0.035, c - T * 0.035, c + T * 0.035, c + T * 0.035), fill=(40, 40, 44, 255))
dd.text((c - dd.textlength('°C', font=nf) / 2, c + T * 0.14), '°C', font=nf, fill=(30, 30, 34, 255))
dial.resize((400, 400), Image.LANCZOS).save(os.path.join(OUT, 'thermo_dial.png'))
