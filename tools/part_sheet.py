# -*- coding: utf-8 -*-
"""
Лист сверки детали: «фото каталога | рендер крупно» — по одной строке на деталь, в столбцах
варианты рендера (вид и движок). Перед массовым рендером каждую деталь сверять так (правило
владельца: деталь — по фото каталога и паспорту, цвет и блеск — с фото).

    python tools/part_sheet.py                         # все детали, столбец illus (вид смет)
    python tools/part_sheet.py valve endgroup          # только эти
    python tools/part_sheet.py valve --cols=legacy,eevee,cycles
    python tools/part_sheet.py --out=scratch/sheet.png --samples=64

Столбцы: legacy — прежний вид (EEVEE), eevee / cycles — новый вид (HDRI, металлы по фото)
на своём движке. Рендер детали — tools/render_part.py в Blender; фото — img/<артикул>.jpg.
Выход по умолчанию — tools/blender_assets/sheets/part_sheet.png (в git не входит).
"""
import os
import subprocess
import sys
import tempfile
import time

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLENDER = os.environ.get('BLENDER') or r'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe'
SCRIPT = os.path.join(ROOT, 'tools', 'render_part.py')

# деталь -> (подпись, фото каталога). Фото — те, с которых сняты цвет и форма
PARTS = {
    'valve': ('Кран шаровой с американкой, бабочка — STOUT SVB-1007', ['SVB-1007-000020', 'SVB-1007-200020']),
    'endgroup': ('Концевая группа коллектора ТП — STOUT SMS-1000', ['SMS-1000-010001']),
    'ek': ('Евроконус 16 — STOUT SFC-0020-001620', ['SFC-0020-001620']),
    'hammer': ('Компенсатор гидроудара — STOUT SVS-1014', ['SVS-1014-000015']),
    'plug': ('Заглушка 3/4" НР — STOUT SFT-0024', ['SFT-0024-000034']),
    'clamp': ('Хомут 1" на шпильке M8 — STOUT SAC-0020', ['SAC-0020-300001']),
    'ext': ('Удлинитель 30 мм, хром — STOUT SFT-0002', ['SFT-0002-003430']),
    'nipple': ('Ниппель НР-НР — STOUT SFT-0004', ['SFT-0004-003434']),
}
COLS = {'illus': ('иллюстрация (Cycles)', 'illus', 'cycles'), 'illus_eevee': ('иллюстрация (EEVEE)', 'illus', 'eevee'),
        'legacy': ('прежний вид', 'legacy', 'eevee'), 'eevee': ('EEVEE + HDRI', 'pbr', 'eevee'),
        'cycles': ('Cycles + HDRI', 'pbr', 'cycles')}
CELL = 420


def font(sz):
    for f in (r'C:\Windows\Fonts\bahnschrift.ttf', r'C:\Windows\Fonts\arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if os.path.isfile(f):
            return ImageFont.truetype(f, sz)
    return ImageFont.load_default()


def fit(im, box):
    k = min(box / im.width, box / im.height)
    im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS)
    cell = Image.new('RGB', (box, box), 'white')
    if im.mode == 'RGBA':
        cell.paste(im, ((box - im.width) // 2, (box - im.height) // 2), im)
    else:
        cell.paste(im, ((box - im.width) // 2, (box - im.height) // 2))
    return cell


def trim(im):
    """Обрезать пустые поля: у рендера — прозрачные, у фото каталога — белые."""
    if im.mode == 'RGBA':
        bb = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    else:
        bb = im.convert('L').point(lambda v: 255 if v < 238 else 0).getbbox()
    return im.crop(bb) if bb else im


def render_part(name, col, tmp, samples):
    _, look, engine = COLS[col]
    d = os.path.join(tmp, col)
    os.makedirs(d, exist_ok=True)
    env = dict(os.environ, HC_LOOK=look, HC_ENGINE=engine, HC_SAMPLES=str(samples))
    t = time.time()
    subprocess.run([BLENDER, '--background', '--python', SCRIPT, '--', d, name, '1000'], env=env,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    p = os.path.join(d, name + '.png')
    return (Image.open(p).convert('RGBA') if os.path.isfile(p) else None), time.time() - t


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opt = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
    names = args or list(PARTS)
    cols = opt.get('cols', 'illus').split(',')
    out = opt.get('out') or os.path.join(ROOT, 'tools', 'blender_assets', 'sheets', 'part_sheet.png')
    samples = int(opt.get('samples', '128'))
    tmp = tempfile.mkdtemp(prefix='part_sheet_')
    head, cap = 64, 46
    W = CELL * (1 + len(cols)) + 20
    H = head + len(names) * (CELL + cap) + 10
    sheet = Image.new('RGB', (W, H), 'white')
    dr = ImageDraw.Draw(sheet)
    f1, f2 = font(26), font(20)
    for k, t in enumerate(['фото каталога'] + [COLS[c][0] for c in cols]):
        dr.text((10 + k * CELL + 10, 18), t, fill=(60, 60, 60), font=f1)
    times = {}
    for i, n in enumerate(names):
        title, photos = PARTS[n]
        y = head + i * (CELL + cap)
        dr.text((20, y + 8), title, fill=(20, 20, 20), font=f2)
        y += cap
        ph = next((os.path.join(ROOT, 'img', p + '.jpg') for p in photos
                   if os.path.isfile(os.path.join(ROOT, 'img', p + '.jpg'))), None)
        if ph:
            sheet.paste(fit(trim(Image.open(ph).convert('RGB')), CELL - 10), (10, y))
        for k, c in enumerate(cols):
            im, dt = render_part(n, c, tmp, samples)
            times.setdefault(c, []).append(dt)
            print('%s / %s: %.0f с' % (n, c, dt), flush=True)
            if im:
                sheet.paste(fit(trim(im), CELL - 10), (10 + (k + 1) * CELL, y))
            else:
                dr.text((10 + (k + 1) * CELL + 20, y + CELL // 2), 'рендер не вышел', fill=(200, 0, 0), font=f2)
        dr.line((10, y + CELL - 2, W - 10, y + CELL - 2), fill=(225, 225, 225))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    sheet.save(out)
    print('лист:', out)
    for c, ts in times.items():
        print('  %s: в среднем %.0f с на деталь' % (c, sum(ts) / len(ts)))


main()
