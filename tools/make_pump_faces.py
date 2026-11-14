# -*- coding: utf-8 -*-
"""
Текстуры лицевой стороны мотора насосов для схем (tools/render_hydro_node.py) из фото каталога img/<артикул>.jpg:
торец, снятый под углом (эллипс на фото), разворачивается в круг 512 x 512; белый фон фото, попавший к краю торца,
заменяется цветом самого торца (медиана кольца у края без белого). Результат — tools/tex/<артикул>_face.png.

    python tools/make_pump_faces.py
"""
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# артикул: (cx, cy, rx, ry) эллипса торца на фото 600 x 600 (замер по сетке 50 px)
FACES = {'SPC-0011-2560180': (288, 342, 112, 112), 'SPC-0010-2560180': (190, 348, 95, 15, 5, 145),   # косая: (cx, cy, ux, uy, vx, vy) — оси торца на фото, надписи встают горизонтально
         'SPC-0002-2560180': (165, 395, 100, 160), 'SPC-0003-2560180': (155, 383, 100, 162),
         'RCP-0004-2560180': (300, 365, 150, 150)}
N = 512
# снятые под углом — к краю торца попадает белый фон; у фронтальных (SPC-0011, RCP-0004) белые у края — надписи
OBLIQUE = {'SPC-0010-2560180', 'SPC-0002-2560180', 'SPC-0003-2560180'}


def main():
    os.makedirs(os.path.join(HERE, 'tools', 'tex'), exist_ok=True)
    for sku, fc in FACES.items():
        cx, cy = fc[0], fc[1]
        ax = fc[2:] if len(fc) == 6 else (fc[2], 0, 0, fc[3])      # (ux, uy, vx, vy)
        src = np.asarray(Image.open(os.path.join(HERE, 'img', sku + '.jpg')).convert('RGB')).astype(np.float32)
        H, W = src.shape[:2]
        yy, xx = np.mgrid[0:N, 0:N]
        u = (xx + 0.5) / N * 2 - 1
        v = (yy + 0.5) / N * 2 - 1
        sx = np.clip(cx + u * ax[0] + v * ax[2], 0, W - 1).astype(int)
        sy = np.clip(cy + u * ax[1] + v * ax[3], 0, H - 1).astype(int)
        out = src[sy, sx]
        r = np.sqrt(u * u + v * v)
        white = (out.min(axis=2) > 185) & (out.max(axis=2) - out.min(axis=2) < 30)
        ring = (r > 0.80) & (r < 0.97) & ~white
        face = np.median(out[ring], axis=0) if ring.any() else np.array([20, 20, 22], np.float32)
        if sku in OBLIQUE:
            out[white & (r > 0.6)] = face      # фон у края — цветом торца (надписи в середине не трогаем)
        out[r > 1.0] = face
        Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(os.path.join(HERE, 'tools', 'tex', sku + '_face.png'))
        print(sku, 'торец', face.astype(int))


if __name__ == '__main__':
    main()
