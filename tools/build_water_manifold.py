# -*- coding: utf-8 -*-
"""
Все кадры узла коллектора водоснабжения для сметы: img/manifold3d/*.jpg, карты деталей
*_id.png и индекс manifold3d_<тип>.json.

Тип коллектора — по артикулу в смете: st — STOUT SMB 6850 (головки сверху, отводы
вперёд), rm — ROMMER RMB-0004 (головки сверху, отводы вниз 90°). Линии ХВС и ГВС — с
компенсатором гидроудара в торце и с заглушкой (её ставят заменой в смете),
рециркуляция — только с заглушкой. Точек на линии 1…12. Каждый кадр рендерит
tools/render_water_manifold.py в Blender; здесь два прохода (детали и полупрозрачная
изоляция) сводятся в один, пустые поля обрезаются, зоны деталей пересчитываются под
обрезку. Карта деталей (третий проход, плоские цвета по сноскам) режется так же и
сжимается без сглаживания — по ней смета подсвечивает деталь её силуэтом.

    python tools/build_water_manifold.py st            # недостающие кадры типа
    python tools/build_water_manifold.py rm --force    # все кадры типа заново
    python tools/build_water_manifold.py st cw_5_hammer
    python tools/build_water_manifold.py bl --force --line=cw   (и hw, rc параллельно)
    python tools/build_water_manifold.py bl --merge
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
# Масштаб единый для всех кадров: столько пикселей на метр по оси коллектора (проекция X).
# Смета ставит коллекторы ХВС, ГВС и рециркуляции на одну картинку — размеры должны совпадать
PX_PER_M = 1500
TYPES = ('st', 'rm', 'bl')
# цвета карты деталей — как в проходе 3 render_water_manifold.py (чёрный — фон и прочее)
PALETTE = Image.new('P', (1, 1))
PALETTE.putpalette([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 255, 0, 255, 0, 255, 255,
                    255, 255, 255] + [0, 0, 0] * 248)

# ручка крана подводки — отдельный слой на вариант (бабочка/рычаг, красная/чёрная): смета
# кладёт поверх кадра тот, что соответствует артикулу крана
HANDLES = ('bf_r', 'bf_k', 'lv_r', 'lv_k')

FRAMES = [(line, n, end)
          for line, ends in (('cw', ('hammer', 'plug')), ('hw', ('hammer', 'plug')), ('rc', ('plug',)))
          for end in ends for n in range(1, 13)]


def tag(f):
    return '%s_%d_%s' % f


def build(typ, f, tmp):
    t = '%s_%s' % (typ, tag(f))
    subprocess.run([BLENDER, '--background', '--python', SCRIPT, '--', tmp, f[0], str(f[1]), f[2], typ],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    meta_path = os.path.join(tmp, t + '.json')
    if not os.path.isfile(meta_path):
        print('  нет кадра', t)
        return None
    with open(meta_path, encoding='utf-8') as fh:
        meta = json.load(fh)
    a = Image.open(os.path.join(tmp, t + '_solid.png')).convert('RGBA')
    b = Image.open(os.path.join(tmp, t + '_sheath.png')).convert('RGBA')
    im = Image.alpha_composite(a, b)
    W0, H0 = im.size
    hs = {k: Image.open(os.path.join(tmp, '%s_h_%s.png' % (t, k))).convert('RGBA') for k in HANDLES
          if os.path.isfile(os.path.join(tmp, '%s_h_%s.png' % (t, k)))}
    # у прозрачного кадра и слоя ручки вырез оставляет почти нулевую альфу — рамку берём по заметной
    def solid_box(h):
        return h.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    boxes = [solid_box(im)] + [solid_box(h) for h in hs.values()]
    boxes = [x for x in boxes if x]
    bb = (min(x[0] for x in boxes), min(x[1] for x in boxes), max(x[2] for x in boxes), max(x[3] for x in boxes))
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
    # карта деталей: те же обрезка и размер, без сглаживания, точной палитрой из восьми
    # цветов сносок — подбор палитры «по картинке» склеивал соседние цвета и терял детали
    idm = Image.open(os.path.join(tmp, t + '_id.png')).convert('RGB').crop(bb).resize(size, Image.NEAREST)
    idm.quantize(palette=PALETTE, dither=Image.Dither.NONE).save(os.path.join(OUT, t + '_id.png'), optimize=True)

    # слои ручек: та же обрезка и размер, затем по своей рамке; положение — в долях кадра
    hv = {}
    for k, h in hs.items():
        h = h.crop(bb).resize(size, Image.LANCZOS)
        h.putalpha(h.getchannel('A').point(lambda v: 0 if v <= 8 else v))
        hb = solid_box(h)
        if not hb:
            continue
        h.crop(hb).save(os.path.join(OUT, '%s_h_%s.png' % (t, k)), optimize=True)
        hv[k] = [round(hb[0] / size[0], 4), round(hb[1] / size[1], 4),
                 round((hb[2] - hb[0]) / size[0], 4), round((hb[3] - hb[1]) / size[1], 4)]

    def fx(x):
        return round((x * W0 - bb[0]) / cw, 4)

    def fy(y):
        return round((y * H0 - bb[1]) / ch, 4)

    return {'w': size[0], 'h': size[1],
            'zones': {k: [fx(z[0]), fy(z[1]), fx(z[2]), fy(z[3])] for k, z in meta['zones'].items()},
            'marks': {k: [fx(p[0]), fy(p[1])] for k, p in meta['marks'].items()}, 'hv': hv,
            # привязка: начало координат мира в пикселях кадра и пиксели на метр по осям X, Y, Z
            'o': [round((pj['o'][0] * W0 - bb[0]) * sc, 1), round((pj['o'][1] * H0 - bb[1]) * sc, 1)],
            'ax': {k: [round(pj[k][0] * W0 * sc, 2), round(pj[k][1] * H0 * sc, 2)] for k in ('x', 'y', 'z')}}


def main():
    os.makedirs(OUT, exist_ok=True)
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    typ = args.pop(0) if args and args[0] in TYPES else 'st'
    force = '--force' in sys.argv
    # --line cw|hw|rc — только одна линия, со своим индексом: так три процесса рендерят
    # тип параллельно, не перетирая общий индекс; --merge сводит их в manifold3d_<тип>.json
    line = next((a.split('=')[1] for a in sys.argv if a.startswith('--line=')), None)
    if '--merge' in sys.argv:
        index = {}
        for ln in ('cw', 'hw', 'rc'):
            part = os.path.join(OUT, 'manifold3d_%s_%s.json' % (typ, ln))
            if os.path.isfile(part):
                with open(part, encoding='utf-8') as fh:
                    index.update(json.load(fh))
                os.remove(part)
        with open(os.path.join(OUT, 'manifold3d_%s.json' % typ), 'w', encoding='utf-8') as fh:
            json.dump(index, fh, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
        print('кадров в индексе:', len(index))
        return
    idx_path = os.path.join(OUT, 'manifold3d_%s%s.json' % (typ, '_' + line if line else ''))
    index = {}
    if os.path.isfile(idx_path):
        with open(idx_path, encoding='utf-8') as fh:
            index = json.load(fh)
    todo = [f for f in FRAMES if (not args or tag(f) in args) and (not line or f[0] == line)
            and (force or args or tag(f) not in index or not os.path.isfile(os.path.join(OUT, '%s_%s.webp' % (typ, tag(f)))))]
    tmp = tempfile.mkdtemp(prefix='wm_%s_' % typ)
    for k, f in enumerate(todo, 1):
        print('[%d/%d] %s_%s' % (k, len(todo), typ, tag(f)), flush=True)
        r = build(typ, f, tmp)
        if r:
            index[tag(f)] = r
            # индекс пишем после каждого кадра: прерванный прогон продолжится с места
            with open(idx_path, 'w', encoding='utf-8') as fh:
                json.dump(index, fh, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    print('кадров в индексе:', len(index))


main()
