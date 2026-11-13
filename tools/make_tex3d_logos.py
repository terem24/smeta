# -*- coding: utf-8 -*-
"""
Вторая часть текстур для 3D (после tools/make_tex3d.py): логотипы для тёмных поверхностей, табличка насосной
группы и плашка ROMMER.

    python tools/make_tex3d.py && python tools/make_tex3d_logos.py

  * stout_logo_white.png — знак и надпись STOUT белым (на чёрном ЕРР-кожухе коллектора);
  * stout_plaque.png — белая скруглённая табличка с синим знаком STOUT (лицо насосной группы, фото SDG-0002);
  * rommer_logo.png — красная плашка ROMMER из img/rommer_logo.jpg.
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, 'blender_assets', 'tex3d')

logo = Image.open(os.path.join(OUT, 'stout_logo_dark.png')).convert('RGBA')
a = logo.getchannel('A')
Image.merge('RGBA', (Image.new('L', logo.size, 245), Image.new('L', logo.size, 245), Image.new('L', logo.size, 247), a)).save(
    os.path.join(OUT, 'stout_logo_white.png'))

PW, PH = 1200, 420
pl = Image.new('RGBA', (PW, PH), (0, 0, 0, 0))
ImageDraw.Draw(pl).rounded_rectangle((0, 0, PW - 1, PH - 1), 70, fill=(246, 246, 246, 255))
k = (PH * 0.62) / logo.height
lg = logo.resize((int(logo.width * k), int(logo.height * k)), Image.LANCZOS)
pl.alpha_composite(lg, ((PW - lg.width) // 2, (PH - lg.height) // 2))
pl.save(os.path.join(OUT, 'stout_plaque.png'))

Image.open(os.path.join(ROOT, 'img', 'rommer_logo.jpg')).convert('RGBA').save(os.path.join(OUT, 'rommer_logo.png'))
print('ok', sorted(os.listdir(OUT)))
