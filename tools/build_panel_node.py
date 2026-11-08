# -*- coding: utf-8 -*-
"""
Кадры узла подключения стального панельного радиатора (боковое подключение) для сметы:
img/rad_panel/panel_<тип>_<узел>.webp (прозрачный фон, стена и пол полупрозрачные), карты деталей
*_id.png и индекс panel.json. Рендер — tools/render_panel_node.py в Blender; здесь проходы сводятся, пустые поля обрезаются, кадр
приводится к единому масштабу (PX_PER_M — как у коллекторов), зоны и привязка пересчитываются.

    python tools/build_panel_node.py                 # недостающие кадры
    python tools/build_panel_node.py --force         # все заново
    python tools/build_panel_node.py panel21_angled  # только этот
"""
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from frame_clean import clean  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'img', 'rad_panel')
BLENDER = os.environ.get('BLENDER') or r'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe'
SCRIPT = os.path.join(HERE, 'tools', 'render_panel_node.py')
PX_PER_M = 2550
# ROMMER Compact тип 11/21/22/33, высота 500: клапаны угловые (трубы из стены) или прямые (из пола)
VARIANTS = ['panel%s_%s%s' % (t, k, h) for t in ('21', '22', '11', '33') for k in ('angled', 'straight') for h in ('', '_rht')]
PALETTE = Image.new('P', (1, 1))
PALETTE.putpalette([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 255, 0, 255, 0, 255, 255,
                    255, 255, 255] + [0, 0, 0] * 248)


def build(v, tmp):
    t = 'panel_' + v.replace('panel', '')
    subprocess.run([BLENDER, '--background', '--python', SCRIPT, '--', tmp, v],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                   env=dict(os.environ, HC_PX_PER_M=str(PX_PER_M)))
    meta_path = os.path.join(tmp, t + '.json')
    if not os.path.isfile(meta_path):
        print('  нет кадра', t)
        return None
    with open(meta_path, encoding='utf-8') as fh:
        meta = json.load(fh)
    im = Image.open(os.path.join(tmp, t + '_solid.png')).convert('RGBA')
    sh = os.path.join(tmp, t + '_sheath.png')
    if os.path.isfile(sh):
        im = Image.alpha_composite(im, Image.open(sh).convert('RGBA'))
    im = clean(im)                     # без заливки стены и пола — на листе без серого фона (frame_clean.py)
    W0, H0 = im.size
    bb = im.getchannel('A').point(lambda x: 255 if x > 8 else 0).getbbox()
    pad = 14
    bb = (max(0, bb[0] - pad), max(0, bb[1] - pad), min(W0, bb[2] + pad), min(H0, bb[3] + pad))
    im = im.crop(bb)
    cw, ch = im.size
    pj = meta['proj']
    sc = PX_PER_M / ((pj['x'][0] * W0) ** 2 + (pj['x'][1] * H0) ** 2) ** 0.5
    size = (int(round(cw * sc)), int(round(ch * sc)))
    im = im.resize(size, Image.LANCZOS)
    im.putalpha(im.getchannel('A').point(lambda x: 0 if x <= 8 else x))
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
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    force = '--force' in sys.argv
    idx_path = os.path.join(OUT, 'panel.json')
    index = {}
    if os.path.isfile(idx_path):
        with open(idx_path, encoding='utf-8') as fh:
            index = json.load(fh)
    todo = [v for v in VARIANTS if (not args or v in args)
            and (force or args or v.replace('panel', '') not in index or not os.path.isfile(os.path.join(OUT, 'panel_%s.webp' % v.replace('panel', ''))))]
    tmp = tempfile.mkdtemp(prefix='panel_')
    for k, v in enumerate(todo, 1):
        print('[%d/%d] %s' % (k, len(todo), v), flush=True)
        r = build(v, tmp)
        if r:
            index[v.replace('panel', '')] = r
            with open(idx_path, 'w', encoding='utf-8') as fh:
                json.dump(index, fh, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    print('кадров в индексе:', len(index))


main()
