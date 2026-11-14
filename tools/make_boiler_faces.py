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
