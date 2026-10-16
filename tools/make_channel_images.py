# -*- coding: utf-8 -*-
"""Инфографика для постов канала: channel/img/*.png (1280x720).

Запускается вручную, когда нужно перерисовать: python tools/make_channel_images.py
Шрифты — Segoe UI из Windows; готовые PNG лежат в репозитории, Action их не рисует.
Числа на картинках те же, что в текстах постов (content/channel_queue.json).
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'channel', 'img')
W, H = 1280, 720
BG, CARD = (15, 32, 56), (27, 52, 88)
ORANGE, BLUE, WHITE, GREY = (255, 122, 47), (42, 168, 224), (255, 255, 255), (160, 180, 205)
FONTS = 'C:/Windows/Fonts/'


def font(size, bold=False):
    return ImageFont.truetype(FONTS + ('segoeuib.ttf' if bold else 'segoeui.ttf'), size)


def canvas(title):
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 14, H], fill=ORANGE)
    d.text((70, 52), title, font=font(54, True), fill=WHITE)
    d.text((70, H - 68), 'heatcalc.ru', font=font(30, True), fill=BLUE)
    d.text((W - 70, H - 68), 'HeatCalc — для монтажников', font=font(26), fill=GREY, anchor='ra')
    return im, d


def box(d, xy, text, fill, size=40, color=WHITE):
    d.rounded_rectangle(xy, radius=22, fill=fill)
    cx, cy = (xy[0] + xy[2]) / 2, (xy[1] + xy[3]) / 2
    d.text((cx, cy), text, font=font(size, True), fill=color, anchor='mm')


def nr_vr():
    im, d = canvas('НР ↔ ВР: стык — это пара')
    rows = [('Кран ВР/ВР', 'на другом конце — переход на НР'),
            ('Кран ВР/НР', 'на другом конце — переход на ВР')]
    y = 190
    for left, right in rows:
        box(d, (70, y, 430, y + 120), left, ORANGE)
        d.text((470, y + 60), '→', font=font(70, True), fill=WHITE, anchor='mm')
        box(d, (520, y, 1210, y + 120), right, BLUE, 38)
        y += 160
    box(d, (70, y + 10, 1210, y + 130), 'Размер берём по крану, а не по диаметру трубы', CARD, 38)
    return im


def watts():
    im, d = canvas('Сколько Вт на 1 м² пола')
    data = [('«1 кВт на 10 м²»', 100, ORANGE), ('Проекты, медиана', 67, BLUE)]
    x0, scale, y = 70, 7.4, 200
    for name, val, col in data:
        d.text((x0, y), name, font=font(36), fill=WHITE)
        d.rounded_rectangle((x0, y + 56, x0 + val * scale, y + 156), radius=18, fill=col)
        d.text((x0 + val * scale + 24, y + 106), '%d Вт/м²' % val, font=font(48, True), fill=WHITE, anchor='lm')
        y += 220
    d.text((70, H - 130), 'Расчёты проектировщиков по 102 частным домам', font=font(28), fill=GREY)
    return im


def ufh():
    im, d = canvas('Утеплитель под тёплый пол: R, м²·°C/Вт')
    rows = [('Над отапливаемым', 0.75, '0,75', ORANGE, 0), ('По грунту / над неотапливаемым', 1.25, '1,25', ORANGE, 0),
            ('Над улицей', 1.25, '1,25 – 2,00', BLUE, 0.75)]
    x0, scale, y = 70, 380, 160
    for name, val, label, col, extra in rows:
        d.text((x0, y), name, font=font(34), fill=WHITE)
        d.rounded_rectangle((x0, y + 52, x0 + val * scale, y + 130), radius=16, fill=col)
        if extra:
            d.rounded_rectangle((x0 + val * scale + 6, y + 52, x0 + (val + extra) * scale, y + 130), radius=16,
                                fill=(25, 110, 150))
        d.text((x0 + (val + extra) * scale + 24, y + 91), label, font=font(42, True), fill=WHITE, anchor='lm')
        y += 140
    d.text((70, H - 118), 'ГОСТ Р 70834-2023, п. 9.1.5, табл. 2', font=font(28), fill=GREY)
    return im


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, fn in (('nr_vr', nr_vr), ('watts', watts), ('ufh', ufh)):
        fn().save(os.path.join(OUT, name + '.png'), optimize=True)
        print('ok', name)
