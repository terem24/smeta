# -*- coding: utf-8 -*-
"""
Текстуры для листа «Гидравлика» (tools/render_hydro_node.py), STOUT:
  * tools/tex/stout_label.png — белая наклейка со знаком и надписью STOUT (как на кожухах коллектора SDG-0016 и
    стрелки SDG-0015 на фото каталога: белый прямоугольник со скруглёнными углами, синий знак и слово STOUT, без слогана);
  * tools/tex/thermo_dial.png — циферблат термометра Dn63 (фото SIM-1001-635015): круг, деления 0…120 °C на 270°,
    цифры 0, 20 … 120, «°C», знак STOUT внизу, чёрная стрелка с красным хвостом.

    python tools/make_hydro_labels.py
"""
import math
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, 'tex')
logo = Image.open(os.path.join(ROOT, 'img', 'stout_logo.png')).convert('RGBA')
_cut = Image.new('L', logo.size, 255)                              # без слогана «все складывается»
ImageDraw.Draw(_cut).rectangle((int(logo.width * 0.36), int(logo.height * 0.76), logo.width, logo.height), fill=0)
logo.putalpha(Image.composite(logo.getchannel('A'), Image.new('L', logo.size, 0), _cut))
logo = logo.crop(logo.getchannel('A').getbbox())
FONT = r'C:\Windows\Fonts\arialbd.ttf'

# наклейка: 2,4 : 1
W, H = 960, 400
lab = Image.new('RGB', (W, H), (246, 246, 246))
d = ImageDraw.Draw(lab)
d.rounded_rectangle((6, 6, W - 7, H - 7), 40, outline=(205, 205, 205), width=4, fill=(248, 248, 248))
k = (H * 0.60) / logo.height
lg = logo.resize((int(logo.width * k), int(logo.height * k)), Image.LANCZOS)
rgb = Image.new('RGB', lg.size, (248, 248, 248))
rgb.paste(lg, mask=lg.getchannel('A'))
lab.paste(rgb, ((W - lg.width) // 2, (H - lg.height) // 2))
lab.save(os.path.join(OUT, 'stout_label.png'))

# циферблат: 1024 x 1024, центр (512, 512), шкала радиусом ~440
S = 1024
c = S // 2
im = Image.new('RGB', (S, S), (250, 250, 248))
d = ImageDraw.Draw(im)
f_big = ImageFont.truetype(FONT, 66)
f_c = ImageFont.truetype(FONT, 56)
for t in range(0, 121, 2):
    a = math.radians(225 - 270 * t / 120)                # 0 — внизу слева, 120 — внизу справа, по часовой
    big = t % 20 == 0
    mid = t % 10 == 0
    r0, r1 = (372 if big else 400 if mid else 412), 440
    d.line((c + r0 * math.cos(a), c - r0 * math.sin(a), c + r1 * math.cos(a), c - r1 * math.sin(a)), fill=(20, 20, 24),
           width=11 if big else 5 if mid else 3)
for t in range(0, 121, 20):
    a = math.radians(225 - 270 * t / 120)
    r = 312
    s = str(t)
    w, h = d.textbbox((0, 0), s, font=f_big)[2:]
    d.text((c + r * math.cos(a) - w / 2, c - r * math.sin(a) - h / 2 - 8), s, font=f_big, fill=(20, 20, 24))
w, h = d.textbbox((0, 0), '°C', font=f_c)[2:]
d.text((c - w / 2, c - 190 - h / 2), '°C', font=f_c, fill=(20, 20, 24))
k = 250 / logo.width
lg2 = logo.resize((int(logo.width * k), int(logo.height * k)), Image.LANCZOS)
im.paste(Image.new('RGB', lg2.size, (30, 60, 110)), (c - lg2.width // 2, c + 230), lg2.getchannel('A'))
# стрелка на 45 °C: чёрная, хвост красный
a = math.radians(225 - 270 * 45 / 120)
ux, uy = math.cos(a), -math.sin(a)
nx, ny = -uy, ux
tip, tail = 400, 90
d.polygon([(c + ux * tip, c + uy * tip), (c + nx * 14, c + ny * 14), (c - nx * 14, c - ny * 14)], fill=(15, 15, 18))
d.polygon([(c - ux * tail, c - uy * tail), (c + nx * 14, c + ny * 14), (c - nx * 14, c - ny * 14)], fill=(190, 30, 25))
d.ellipse((c - 30, c - 30, c + 30, c + 30), fill=(35, 35, 38))
d.ellipse((c - 14, c - 14, c + 14, c + 14), fill=(150, 150, 155))
im.save(os.path.join(OUT, 'thermo_dial.png'))
print('ok')
