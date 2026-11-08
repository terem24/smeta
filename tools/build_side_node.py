# -*- coding: utf-8 -*-
"""
Кадры подключения радиатора с БОКОВЫМ подключением для сметы: img/rad_side/side_<вариант>.webp, карты
деталей *_id.png и индекс side.json. Рендер — tools/render_side_node.py; вариант
<семейство>-<узел>-<арматура>-<цвет арматуры>-<цвет набора> (см. шапку render_side_node.py).

    python tools/build_side_node.py                 # недостающие кадры
    python tools/build_side_node.py --force         # все заново
    python tools/build_side_node.py sect-angled-std-x-white
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
OUT = os.path.join(HERE, 'img', 'rad_side')
BLENDER = os.environ.get('BLENDER') or r'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe'
SCRIPT = os.path.join(HERE, 'tools', 'render_side_node.py')
PX_PER_M = 2550
# радиатор Space 500 с нижним подключением: узел угловой (трубы из стены) или прямой (из пола),
# подключение справа (SRB-0320) или слева (SRB-0321, «_l»)
# секционные (белый набор): обычная арматура и STOUT Design всех цветов (выбор цвета арматуры в смете)
# секционные (белый набор): обычная арматура и STOUT Design всех цветов (выбор цвета арматуры в смете);
# дизайнерские и трубчатые — по цветам прибора, арматура STOUT Design в цвет (белый->белая, чёрный->чёрная,
# серый/натуральный->хром — так подбирает смета)
_AUTO = {'white': 'white', 'black': 'black', 'gray': 'chrome', 'natural': 'chrome'}
_COLS = {'oscar': ('white', 'black', 'gray'), 'sebino': ('white', 'black', 'gray'), 'tonale': ('white', 'black', 'gray'),
         'anteprima': ('white', 'black', 'gray'), 'quadro': ('white', 'black'), 'round': ('natural', 'black')}
VARIANTS = ['sect-%s-%s' % (k, st) for k in ('angled', 'straight')
            for st in ('std-x-white', 'design-chrome-white', 'design-white-white', 'design-black-white')] +     ['%s-%s-design-%s-%s' % (f, k, _AUTO[c], c) for f, cs in _COLS.items() for c in cs for k in ('angled', 'straight')] +     ['%s-%s-%s' % (f, k, st) for f in ('sect350', 'sect200') for k in ('angled', 'straight')
     for st in ('std-x-white', 'design-chrome-white', 'design-white-white', 'design-black-white')] +     ['%s-%s-%s' % (f, k, st) for f in ('titan', 'alpha', 'vega', 'titan350', 'alpha350', 'vega350', 'titan200', 'vega200')
     for k in ('angled', 'straight') for st in ('std-x-white', 'design-chrome-white', 'design-white-white', 'design-black-white')]
# TITAN, ALPHA, VEGA — свой вид секции (render_side_node.section_av / TITAN), каталог STOUT с. 66–81

# арматура STOUT Design на металлопластике — пресс-переходник вместо переходника с гильзой (смета, альбом STOUT)
VARIANTS += [v + '_mp' for v in list(VARIANTS) if '-design-' in v]
PALETTE = Image.new('P', (1, 1))
PALETTE.putpalette([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 255, 0, 255, 0, 255, 255,
                    255, 255, 255, 255, 128, 0] + [0, 0, 0] * 247)       # + оранжевый — монтажный набор


def build(v, tmp):
    # «…_mp» — арматура Design на металлопластике: пресс-переходник SFP-0001-001216 (rad_side.press_adapter)
    mp = v.endswith('_mp')
    vb = v[:-3] if mp else v
    t = 'side_' + vb
    env = dict(os.environ, HC_PX_PER_M=str(PX_PER_M))
    if mp:
        env['HC_PIPE'] = 'mp'
        for f in os.listdir(tmp):
            if f.startswith(t + '.') or f.startswith(t + '_'):
                os.remove(os.path.join(tmp, f))
    subprocess.run([BLENDER, '--background', '--python', SCRIPT, '--', tmp, vb],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
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
    im.save(os.path.join(OUT, 'side_' + v + '.webp'), quality=86, method=6)
    idm = Image.open(os.path.join(tmp, t + '_id.png')).convert('RGB').crop(bb).resize(size, Image.NEAREST)
    idm.quantize(palette=PALETTE, dither=Image.Dither.NONE).save(os.path.join(OUT, 'side_' + v + '_id.png'), optimize=True)

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
    idx_path = os.path.join(OUT, 'side.json')
    index = {}
    if os.path.isfile(idx_path):
        with open(idx_path, encoding='utf-8') as fh:
            index = json.load(fh)
    todo = [v for v in VARIANTS if (not args or v in args)
            and (force or args or v not in index or not os.path.isfile(os.path.join(OUT, 'side_%s.webp' % v)))]
    tmp = tempfile.mkdtemp(prefix='side_')
    for k, v in enumerate(todo, 1):
        print('[%d/%d] side_%s' % (k, len(todo), v), flush=True)
        r = build(v, tmp)
        if r:
            index[v] = r
            with open(idx_path, 'w', encoding='utf-8') as fh:
                json.dump(index, fh, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    print('кадров в индексе:', len(index))


main()
