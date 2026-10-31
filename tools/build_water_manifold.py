# -*- coding: utf-8 -*-
"""
Все кадры узла коллектора водоснабжения для сметы: img/manifold3d/*.jpg и manifold3d.json.

Линии ХВС и ГВС — с компенсатором гидроудара в торце и с заглушкой (её ставят заменой
в смете), рециркуляция — только с заглушкой. Точек на линии 1…12. Каждый кадр рендерит
tools/render_water_manifold.py в Blender; здесь два прохода (детали и полупрозрачная
изоляция) сводятся в один, пустые поля обрезаются, зоны деталей пересчитываются под
обрезку.

    python tools/build_water_manifold.py            # недостающие кадры
    python tools/build_water_manifold.py --force    # все заново
    python tools/build_water_manifold.py cw_5_hammer
"""
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageChops

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'img', 'manifold3d')
BLENDER = r'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe'
SCRIPT = os.path.join(HERE, 'tools', 'render_water_manifold.py')
WIDTH = 1100

FRAMES = [(line, n, end)
          for line, ends in (('cw', ('hammer', 'plug')), ('hw', ('hammer', 'plug')), ('rc', ('plug',)))
          for end in ends for n in range(1, 13)]


def tag(f):
    return '%s_%d_%s' % f


def build(f, tmp):
    t = tag(f)
    subprocess.run([BLENDER, '--background', '--python', SCRIPT, '--', tmp, f[0], str(f[1]), f[2]],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    meta_path = os.path.join(tmp, t + '.json')
    if not os.path.isfile(meta_path):
        print('  нет кадра', t)
        return None
    with open(meta_path, encoding='utf-8') as fh:
        meta = json.load(fh)
    a = Image.open(os.path.join(tmp, t + '_solid.png')).convert('RGBA')
    b = Image.open(os.path.join(tmp, t + '_sheath.png')).convert('RGBA')
    im = Image.alpha_composite(a, b).convert('RGB')
    W0, H0 = im.size
    bb = ImageChops.difference(im, Image.new('RGB', im.size, 'white')).getbbox()
    pad = 14
    bb = (max(0, bb[0] - pad), max(0, bb[1] - pad), min(W0, bb[2] + pad), min(H0, bb[3] + pad))
    im = im.crop(bb)
    cw, ch = im.size
    sc = WIDTH / cw
    im = im.resize((WIDTH, int(round(ch * sc))), Image.LANCZOS)
    im.save(os.path.join(OUT, t + '.jpg'), quality=84, optimize=True, progressive=True)

    def fx(x):
        return round((x * W0 - bb[0]) / cw, 4)

    def fy(y):
        return round((y * H0 - bb[1]) / ch, 4)

    return {'w': im.size[0], 'h': im.size[1],
            'zones': {k: [fx(z[0]), fy(z[1]), fx(z[2]), fy(z[3])] for k, z in meta['zones'].items()},
            'marks': {k: [fx(p[0]), fy(p[1])] for k, p in meta['marks'].items()}}


def main():
    os.makedirs(OUT, exist_ok=True)
    idx_path = os.path.join(OUT, 'manifold3d.json')
    index = {}
    if os.path.isfile(idx_path):
        with open(idx_path, encoding='utf-8') as fh:
            index = json.load(fh)
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    force = '--force' in sys.argv
    todo = [f for f in FRAMES if (not args or tag(f) in args)
            and (force or args or tag(f) not in index or not os.path.isfile(os.path.join(OUT, tag(f) + '.jpg')))]
    tmp = tempfile.mkdtemp(prefix='wm_')
    for k, f in enumerate(todo, 1):
        print('[%d/%d] %s' % (k, len(todo), tag(f)), flush=True)
        r = build(f, tmp)
        if r:
            index[tag(f)] = r
            # индекс пишем после каждого кадра: прерванный прогон продолжится с места
            with open(idx_path, 'w', encoding='utf-8') as fh:
                json.dump(index, fh, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    print('кадров в индексе:', len(index))


main()
