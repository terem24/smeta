# -*- coding: utf-8 -*-
"""
Кадры узла коллектора тёплого пола для сметы: img/manifold_ufh/ufh_<N>.webp (прозрачный
фон), карты деталей ufh_<N>_id.png и индекс ufh.json. N — выходов на гребёнке, 2…13 (как у
STOUT SMS-0907). Каждый кадр рендерит tools/render_ufh_manifold.py в Blender; здесь пустые
поля обрезаются и кадр приводится к единому масштабу (PX_PER_M — тот же, что у узла
водоснабжения), зоны деталей и привязка к миру пересчитываются под обрезку.

    python tools/build_ufh_manifold.py            # недостающие кадры
    python tools/build_ufh_manifold.py --force    # все заново
    python tools/build_ufh_manifold.py 4 7        # только эти
"""
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'img', 'manifold_ufh')
BLENDER = r'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe'
SCRIPT = os.path.join(HERE, 'tools', 'render_ufh_manifold.py')
PX_PER_M = 1500
NS = range(2, 14)
PALETTE = Image.new('P', (1, 1))
PALETTE.putpalette([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 255, 0, 255, 0, 255, 255,
                    255, 255, 255] + [0, 0, 0] * 248)


def build(n, tmp, bare=False):
    t = 'ufh_%d%s' % (n, '_bare' if bare else '')
    subprocess.run([BLENDER, '--background', '--python', SCRIPT, '--', tmp, str(n)] + (['bare'] if bare else []),
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    meta_path = os.path.join(tmp, t + '.json')
    if not os.path.isfile(meta_path):
        print('  нет кадра', t)
        return None
    with open(meta_path, encoding='utf-8') as fh:
        meta = json.load(fh)
    im = Image.open(os.path.join(tmp, t + '_solid.png')).convert('RGBA')
    W0, H0 = im.size
    bb = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    pad = 14
    bb = (max(0, bb[0] - pad), max(0, bb[1] - pad), min(W0, bb[2] + pad), min(H0, bb[3] + pad))
    im = im.crop(bb)
    cw, ch = im.size
    pj = meta['proj']
    sc = PX_PER_M / ((pj['x'][0] * W0) ** 2 + (pj['x'][1] * H0) ** 2) ** 0.5
    size = (int(round(cw * sc)), int(round(ch * sc)))
    im = im.resize(size, Image.LANCZOS)
    im.putalpha(im.getchannel('A').point(lambda v: 0 if v <= 8 else v))
    im.save(os.path.join(OUT, t + '.webp'), quality=86, method=6)
    idm = Image.open(os.path.join(tmp, t + '_id.png')).convert('RGB').crop(bb).resize(size, Image.NEAREST)
    idm.quantize(palette=PALETTE, dither=Image.Dither.NONE).save(os.path.join(OUT, t + '_id.png'), optimize=True)

    def fx(x):
        return round((x * W0 - bb[0]) / cw, 4)

    def fy(y):
        return round((y * H0 - bb[1]) / ch, 4)

    return {'w': size[0], 'h': size[1],
            'zones': {k: [fx(z[0]), fy(z[1]), fx(z[2]), fy(z[3])] for k, z in meta['zones'].items()},
            'marks': {k: [fx(p[0]), fy(p[1])] for k, p in meta['marks'].items()},
            'o': [round((pj['o'][0] * W0 - bb[0]) * sc, 1), round((pj['o'][1] * H0 - bb[1]) * sc, 1)],
            'ax': {k: [round(pj[k][0] * W0 * sc, 2), round(pj[k][1] * H0 * sc, 2)] for k in ('x', 'y', 'z')}}


def main():
    os.makedirs(OUT, exist_ok=True)
    args = [int(a) for a in sys.argv[1:] if not a.startswith('--')]
    force = '--force' in sys.argv
    idx_path = os.path.join(OUT, 'ufh.json')
    index = {}
    if os.path.isfile(idx_path):
        with open(idx_path, encoding='utf-8') as fh:
            index = json.load(fh)
    # каждый размер — в двух видах: с переходом на транзит и без него («_bare»)
    key = lambda n, b: str(n) + ('_bare' if b else '')
    todo = [(n, b) for n in NS for b in (False, True) if (not args or n in args)
            and (force or args or key(n, b) not in index
                 or not os.path.isfile(os.path.join(OUT, 'ufh_%s.webp' % key(n, b))))]
    tmp = tempfile.mkdtemp(prefix='ufh_')
    for k, (n, b) in enumerate(todo, 1):
        print('[%d/%d] ufh_%s' % (k, len(todo), key(n, b)), flush=True)
        r = build(n, tmp, b)
        if r:
            index[key(n, b)] = r
            with open(idx_path, 'w', encoding='utf-8') as fh:
                json.dump(index, fh, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    print('кадров в индексе:', len(index))


main()
