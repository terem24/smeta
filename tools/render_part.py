# -*- coding: utf-8 -*-
"""
Одна деталь крупно — для сверки с фото каталога (лист «фото | рендер», tools/part_sheet.py).

    blender --background --python tools/render_part.py -- <папка> <деталь> [ширина]

Деталь строится той же функцией модуля blender_parts.py, что и в кадрах схем, в том же
ракурсе и с теми же материалами; вид и движок — переменные HC_LOOK / HC_ENGINE (см. модуль).
Выход: <папка>/<деталь>.png на прозрачном фоне. Список деталей — PARTS ниже и в part_sheet.py.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blender_parts import *  # noqa: F401,F403
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, NAME = argv[0], argv[1]
WIDTH = int(argv[2]) if len(argv) > 2 else 900


def p_valve(col='flagred', handle='bf'):
    """Кран шаровой с американкой и бабочкой (STOUT SVB-1007)."""
    xc, x = union_ball_valve(0.0)
    T = Matrix.Translation(Vector((xc, 0, 0))) @ VALVE_TOP
    valve_boss(T)
    transformed(T, butterfly if handle == 'bf' else lever_handle, 0, 0, col)


def p_endgroup():
    """Концевая группа коллектора ТП (STOUT SMS-1000-010001): воздухоотводчик и слив."""
    end_group(0.0, 0.0, 0.0, 'sup')


def p_ek():
    """Евроконус 16 (STOUT SFC-0020-001620)."""
    ek_fit((0, 0, 0), '-Y')


def p_hammer():
    """Компенсатор гидроудара (STOUT SVS-1014-000015)."""
    water_hammer(0.0, 1, 'X')


def p_plug():
    """Заглушка 3/4" НР (STOUT SFT-0024-000034)."""
    plug34(0.0, 1, 'X')


def p_clamp():
    """Хомут 1" на шпильке M8 с дюбелем (STOUT SAC-0020-300001)."""
    lathe('труба 1"', [(0.0165, 0), (0.0165, 0.06)], M_NICKEL(), (-0.03, 0, 0), 'X', segs=48)
    clamp(0, 0.0)


def p_ext():
    """Удлинитель хромированный 30 мм (STOUT SFT-0002-003430)."""
    lathe('удлинитель', [(0.0175, 0), (0.0182, 0.0015), (0.0182, 0.0285), (0.0175, 0.030)],
          M_CHROME(), (0, 0, 0), 'X', segs=56)


def p_nipple():
    """Ниппель НР-НР (STOUT SFT-0004-003434)."""
    lathe('ниппель резьба 1', thread(0.0128, 0.006), M_NICKEL(), (0, 0, 0), 'X', segs=40)
    hexnut('ниппель', 0.030, 0.010, M_NICKEL(), (0.006, 0, 0), 'X')
    lathe('ниппель резьба 2', thread(0.0128, 0.006), M_NICKEL(), (0.016, 0, 0), 'X', segs=40)


PARTS = {'valve': p_valve, 'endgroup': p_endgroup, 'ek': p_ek, 'hammer': p_hammer, 'plug': p_plug,
         'clamp': p_clamp, 'ext': p_ext, 'nipple': p_nipple}


def main():
    sc = reset()
    part('x')
    PARTS[NAME]()
    camera(sc, width=WIDTH)
    sc.render.film_transparent = True
    freestyle(sc, 'solid', LINE_COLOR, 1.4)
    render(sc, os.path.join(OUT, NAME + '.png'))


main()
