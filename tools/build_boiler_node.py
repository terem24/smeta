# -*- coding: utf-8 -*-
"""
Кадры листа котельной, узел «Котёл с обвязкой» (разделы 2.1/2.2 сметы): img/boiler_node/boiler_<вариант>.webp
(прозрачный фон), карты деталей *_id.png и индекс boiler.json. Рендер — tools/render_boiler_node.py в Blender;
здесь проходы сводятся, поля обрезаются, кадр приводится к единому масштабу, зоны и привязка пересчитываются.

    python tools/build_boiler_node.py                 # недостающие кадры
    python tools/build_boiler_node.py --force         # все заново
    python tools/build_boiler_node.py status          # только этот
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
OUT = os.path.join(HERE, 'img', 'boiler_node')
BLENDER = os.environ.get('BLENDER') or r'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe'
SCRIPT = os.path.join(HERE, 'tools', 'render_boiler_node.py')
PX_PER_M = 1200     # котёл с обвязкой ~0,9 x 1,4 м: кадр ~1100 x 1700 px
# haier1 — газовый Haier NeoSlim 1.x Ti (газ по умолчанию); status — электрический STOUT STATUS (электро по умолчанию)
VARIANTS = ['haier1', 'haier2', 'status', 'status27']   # haier2 — двухконтурный NeoSlim 2.x; status27 — STATUS 21–27 кВт (рис. 3 паспорта)
VARIANTS += [v + '_n' for v in list(VARIANTS) if v.startswith('status')]   # без бойлера: без трёхходового клапана
# газ + резервный электрокотёл (каскад без гидрострелки): обратный клапан SVC-0011 с ниппелем на подаче — «…_c»
VARIANTS += [v + '_c' for v in list(VARIANTS) if v != 'haier2']
VARIANTS += [v + '_rm' for v in list(VARIANTS)]      # смета ROMMER: краны RBV-0004 с красной бабочкой
PALETTE = Image.new('P', (1, 1))
PALETTE.putpalette([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 255, 0, 255, 0, 255, 255,
                    255, 255, 255, 255, 128, 0] + [0, 0, 0] * 247)


def build(v, tmp):
    t = 'boiler_' + v
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
    # --index=<файл> — свой индекс для параллельного запуска (потом слить в boiler.json), иначе boiler.json
    idx_name = next((a_[8:] for a_ in sys.argv if a_.startswith('--index=')), 'boiler.json')
    idx_path = os.path.join(OUT, idx_name)
    index = {}
    if os.path.isfile(idx_path):
        with open(idx_path, encoding='utf-8') as fh:
            index = json.load(fh)
    todo = [v for v in VARIANTS if (not args or v in args)
            and (force or args or v not in index or not os.path.isfile(os.path.join(OUT, 'boiler_%s.webp' % v)))]
    tmp = tempfile.mkdtemp(prefix='boiler_')
    for k, v in enumerate(todo, 1):
        print('[%d/%d] %s' % (k, len(todo), v), flush=True)
        r = build(v, tmp)
        if r:
            index[v] = r
            with open(idx_path, 'w', encoding='utf-8') as fh:
                json.dump(index, fh, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    print('кадров в индексе:', len(index))


main()
