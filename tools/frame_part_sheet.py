# -*- coding: utf-8 -*-
"""
Лист сверки по готовому кадру: для каждой детали кадра — «фото каталога | та же деталь,
вырезанная из кадра крупно» (по зоне детали из индекса). Сверяется ровно то, что увидит смета,
а не отдельный рендер детали (tools/part_sheet.py).

    python tools/frame_part_sheet.py img/manifold_rad/rad.json 5            # кадр rad_5
    python tools/frame_part_sheet.py img/rad_node/radnode.json space_angled
    python tools/frame_part_sheet.py img/manifold_ufh/ufh.json 4 --out=scratch/ufh4.png

Какие фото ставить к деталям — таблица PHOTOS (префикс зоны -> артикулы img/<артикул>.jpg)
по виду узла (по имени индекса). Выход по умолчанию — tools/blender_assets/sheets/<кадр>_parts.png.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PHOTOS = {
    'rad': {'mf': ('Коллектор SMS-0912 (подача — балансировочные клапаны, обратка — термоклапаны)', ['SMS-0912-000005', 'SSP-0001-000005']),
            'ek': ('Евроконус 16x2.2', ['SFC-0020-001622']),
            'tube': ('Труба 16x2.2 в теплоизоляции', []),
            'node': ('Подвод: ниппель 1" x 3/4", угольник 3/4" ВР, переходник', ['SFT-0004-000134', 'SFT-0014-000034', 'SFA-0001-002034'])},
    'ufh': {'mf': ('Коллектор SMS-0907', ['SMS-0907-000005', 'SSP-0001-000001']),
            'ek': ('Евроконус 16x2.0', ['SFC-0020-001620']),
            'fix': ('Фиксатор 90° SFA-0029', ['SFA-0029-000016']),
            'sleeve': ('Защитная втулка', ['SFA-0035-200016']),
            'node': ('Переход на транзит', [])},
    'water': {'mf': ('Коллектор STOUT SMB 6850 / ROMMER RMB-0004 / с кранами SMB 6200', ['SMB-6850-011202', 'RMB-0004-013402', 'SMB-6200-011202']),
              'ek': ('Евроконус 16x2.0', ['SFC-0020-001620']),
              'clamp': ('Хомут 1"', ['SAC-0020-300001']),
              'stud': ('Шпилька M8x100 с дюбелем', ['SAC-0020-400100']),
              'end': ('Компенсатор гидроудара / заглушка', ['SVS-1014-000015', 'SFT-0026-000001']),
              'fut': ('Футорка 3/4" x 1/2"', ['SFT-0029-003412']),
              'ext': ('Удлинитель 30 мм', ['SFT-0002-003430']),
              'nip': ('Ниппель', ['SFT-0004-003434']),
              'union': ('Сгон прямой', ['SFT-0045-000034']),
              'ball': ('Кран шаровой с американкой', ['SVB-1007-000020'])},
    'panel': {'rad': ('Радиатор ROMMER Compact (стальной панельный)', ['RRS-2020-115080']),
              'head': ('Термоголовка SHT-0001-003015', ['SHT-0001-003015']),
              'node': ('Клапан термостатический под евроконус', ['SVT-0001-100015', 'SVT-0002-100015']),
              'lock': ('Клапан запорно-балансировочный под евроконус', ['SVL-1196-000015', 'SVL-1166-000015']),
              'ek': ('Евроконус 16x2.2', ['SFC-0020-001622']),
              'fix': ('Фиксатор 90° SFA-0029', ['SFA-0029-000016']),
              'sleeve': ('Защитные втулки', ['SFA-0035-200016', 'SFA-0035-100016'])},
    'radnode': {'rad': ('Радиатор STOUT Space 500, нижнее подключение', ['SRB-0320-050011']),
                'head': ('Термоголовка SHT-0001-003015', ['SHT-0001-003015']),
                'node': ('Узел нижнего подключения SVH', ['SVH-0004-000020', 'SVH-0002-000020']),
                'ek': ('Евроконус 16x2.2', ['SFC-0020-001622']),
                'fix': ('Фиксатор 90° SFA-0029', ['SFA-0029-000016']),
                'sleeve': ('Защитные втулки', ['SFA-0035-200016', 'SFA-0035-100016']),
                'bracket': ('Кронштейны SKU-0320-000080', ['SKU-0320-000080'])},
}
CELL = 360


def font(sz):
    for f in (r'C:\Windows\Fonts\bahnschrift.ttf', r'C:\Windows\Fonts\arial.ttf'):
        if os.path.isfile(f):
            return ImageFont.truetype(f, sz)
    return ImageFont.load_default()


def fit(im, w, h):
    k = min(w / im.width, h / im.height)
    im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS)
    cell = Image.new('RGB', (w, h), 'white')
    if im.mode == 'RGBA':
        cell.paste(im, ((w - im.width) // 2, (h - im.height) // 2), im)
    else:
        cell.paste(im, ((w - im.width) // 2, (h - im.height) // 2))
    return cell


def trim_white(im):
    bb = im.convert('L').point(lambda v: 255 if v < 238 else 0).getbbox()
    return im.crop(bb) if bb else im


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opt = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
    idx_path, key = args[0], args[1]
    kind = os.path.splitext(os.path.basename(idx_path))[0]
    with open(os.path.join(ROOT, idx_path), encoding='utf-8') as fh:
        fr = json.load(fh)[key]
    prefix = {'rad': 'rad_', 'ufh': 'ufh_', 'radnode': 'radnode_', 'panel': 'panel_'}.get(kind, '')
    if kind.startswith('manifold3d_'):               # водоснабжение: кадры <тип>_<ключ>
        prefix, kind = kind[-2:] + '_', 'water'
    frame = Image.open(os.path.join(ROOT, os.path.dirname(idx_path), prefix + key + '.webp')).convert('RGBA')
    W, H = frame.size
    groups = {}
    for z, q in fr['zones'].items():
        groups.setdefault(z.split(':')[0], []).append(q)
    table = PHOTOS.get(kind, {})
    rows = [g for g in table if g in groups] + [g for g in groups if g not in table]
    sheet = Image.new('RGB', (CELL * 3 + 40, len(rows) * (CELL + 50) + 20), 'white')
    dr = ImageDraw.Draw(sheet)
    f2 = font(20)
    y = 10
    for g in rows:
        title, skus = table.get(g, (g, []))
        dr.text((14, y), title, fill=(20, 20, 20), font=f2)
        y += 34
        x0 = min(q[0] for q in groups[g]); y0 = min(q[1] for q in groups[g])
        x1 = max(q[2] for q in groups[g]); y1 = max(q[3] for q in groups[g])
        pad = 0.02
        box = (max(0, int((x0 - pad) * W)), max(0, int((y0 - pad) * H)), min(W, int((x1 + pad) * W)), min(H, int((y1 + pad) * H)))
        crop = frame.crop(box)
        bg = Image.new('RGBA', crop.size, 'white')
        bg.alpha_composite(crop)
        sheet.paste(fit(bg.convert('RGB'), CELL * 2 - 20, CELL), (CELL + 30, y))
        ph = [os.path.join(ROOT, 'img', s + '.jpg') for s in skus if os.path.isfile(os.path.join(ROOT, 'img', s + '.jpg'))]
        for k, p in enumerate(ph[:2]):
            hh = CELL // max(1, min(2, len(ph)))
            sheet.paste(fit(trim_white(Image.open(p).convert('RGB')), CELL, hh), (10, y + k * hh))
        if not ph:
            dr.text((30, y + CELL // 2), 'фото нет', fill=(180, 0, 0), font=f2)
        y += CELL + 16
    out = opt.get('out') or os.path.join(ROOT, 'tools', 'blender_assets', 'sheets', '%s_%s_parts.png' % (kind, key))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    sheet.save(out)
    print('лист:', out)


main()
