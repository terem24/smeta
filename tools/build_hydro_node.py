# -*- coding: utf-8 -*-
"""
Кадры листа котельной, узел «Гидравлика» (раздел 2.4 сметы): img/hydro_node/hydro_<вариант>.webp
(прозрачный фон), карты деталей *_id.png и индекс hydro.json. Рендер — tools/render_hydro_node.py в Blender;
здесь проходы сводятся, поля обрезаются, кадр приводится к единому масштабу, зоны и привязка пересчитываются.

    python tools/build_hydro_node.py                 # недостающие кадры
    python tools/build_hydro_node.py --force         # все заново
    python tools/build_hydro_node.py 2_ds            # только этот
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
OUT = os.path.join(HERE, 'img', 'hydro_node')
BLENDER = os.environ.get('BLENDER') or r'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe'
SCRIPT = os.path.join(HERE, 'tools', 'render_hydro_node.py')
PX_PER_M = 1200     # как у котла: листы котельной в одном масштабе
# «<пар коллектора>_<группы слева направо>»: d — SDG-0001 прямая, s — SDG-0003 под сервопривод, m — SDG-0002
# с четырёхходовым термостатическим клапаном; групп не больше пар, порядок d → s → m (так их ставит смета)
VARIANTS = ['2_d', '2_s', '2_m', '2_dd', '2_ds', '2_dm', '2_ss', '2_sm', '2_mm',
            '3_ddd', '3_dds', '3_ddm', '3_dss', '3_dsm', '3_dmm', '3_sss', '3_smm', '3_mmm']
VARIANTS += [v + '_v' for v in list(VARIANTS)]      # воздухоотводчик и на обратке (по умолчанию в смете)
# насосы, кроме SPC-0011 (фото каталога): только наборы групп, которые реально кладёт смета
_PSET = ['2_d', '2_s', '2_m', '2_dd', '2_ds', '2_dm', '3_ddd', '3_dds', '3_ddm', '3_dmm']
VARIANTS += [g + v + '_p' + f for f in ('10', 'mini', 'minipro', 'profi', 'evo') for g in _PSET for v in ('', '_v')]
# ROMMER «…_r»: коллектор RDG-0017 со стрелкой RDG-0015, группы RDG-1001/1003/1002; насос в смете ROMMER — RCP-0004 PROFI
# (все наборы групп), частотный EVO — наборы, которые реально кладёт смета
_BASE = ['2_d', '2_s', '2_m', '2_dd', '2_ds', '2_dm', '2_ss', '2_sm', '2_mm',
         '3_ddd', '3_dds', '3_ddm', '3_dss', '3_dsm', '3_dmm', '3_sss', '3_smm', '3_mmm']
VARIANTS += [g + v + '_r_pprofi' for g in _BASE for v in ('', '_v')]
VARIANTS += [g + v + '_r_pevo' for g in _PSET for v in ('', '_v')]
# STOUT «…_s»: обычный коллектор SDG-0016 (2-4 пары) с отдельной стрелкой SDG-0015-004001; группы d → s → m, насос SPC-0011,
# воздухоотводчик на обратке (по умолчанию в смете). До 3 групп на 2-3 парах, до 2 на 4 парах
def _combos(n):
    out = ['']
    for _ in range(n):
        out = sorted(set(o + c for o in out for c in 'dsm' if not o or 'dsm'.index(c) >= 'dsm'.index(o[-1])))
    return out


for _np, _mx in ((2, 2), (3, 3), (4, 2)):
    for _n in range(1, _mx + 1):
        VARIANTS += ['%d_%s_v_s' % (_np, g) for g in _combos(_n)]
PALETTE = Image.new('P', (1, 1))
PALETTE.putpalette([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 255, 0, 255, 0, 255, 255,
                    255, 255, 255, 255, 128, 0, 128, 0, 255, 0, 128, 255, 128, 255, 0] + [0, 0, 0] * 244)   # + sep, cap (ROMMER), th (термометр)


def build(v, tmp):
    t = 'hydro_' + v
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
    # --index=<файл> — свой индекс для параллельного запуска (потом слить в hydro.json), иначе hydro.json
    idx_name = next((a_[8:] for a_ in sys.argv if a_.startswith('--index=')), 'hydro.json')
    idx_path = os.path.join(OUT, idx_name)
    index = {}
    if os.path.isfile(idx_path):
        with open(idx_path, encoding='utf-8') as fh:
            index = json.load(fh)
    todo = [v for v in VARIANTS if (not args or v in args)
            and (force or args or v not in index or not os.path.isfile(os.path.join(OUT, 'hydro_%s.webp' % v)))]
    tmp = tempfile.mkdtemp(prefix='hydro_')
    for k, v in enumerate(todo, 1):
        print('[%d/%d] %s' % (k, len(todo), v), flush=True)
        r = build(v, tmp)
        if r:
            index[v] = r
            with open(idx_path, 'w', encoding='utf-8') as fh:
                json.dump(index, fh, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    print('кадров в индексе:', len(index))


main()
