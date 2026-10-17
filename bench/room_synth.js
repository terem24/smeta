/**
 * Синтетический план для стенда «Найти комнаты»: дом 12480×6600 мм из присланного скрина
 * (подписи 15,1 / 41 / 6,2 / 1,3 / 5,2 м²), нарисованный на canvas в самой странице.
 * Реальный скрин из Телеграма в репозиторий не кладём; здесь то, что ломало распознавание:
 *   — мебель и кухонные модули без подписи (замкнутые клетушки 2×1,5 м и 0,6×2,4 м);
 *   — подписи площадей, зачёркнутые линией;
 *   — масштаб, который до сверки с габаритом ошибочен на 9 %.
 * pageScript() возвращает код для страницы: drawSynth() → { canvas, labs, dims, ppm, expect }.
 */
module.exports.expect = [41, 15.1, 6.2, 5.2, 1.3];

module.exports.pageScript = function () {
  return `
function drawSynth() {
  var PPM = 120, c = document.createElement('canvas'); c.width = 1600; c.height = 880;
  var g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  var X0 = 40, Y0 = 40, W = Math.round(12.48 * PPM), H = Math.round(6.6 * PPM), T = Math.round(0.3 * PPM), t = Math.round(0.15 * PPM);
  g.fillStyle = '#222';
  // наружные стены
  g.fillRect(X0, Y0, W, T); g.fillRect(X0, Y0 + H - T, W, T); g.fillRect(X0, Y0, T, H); g.fillRect(X0 + W - T, Y0, T, H);
  var ix0 = X0 + T, iy0 = Y0 + T, iw = W - 2 * T, ih = H - 2 * T;
  var w1 = Math.round(6.83 * PPM), w2 = Math.round(2.52 * PPM);
  var xa = ix0 + w1, xb = xa + t + w2;                       // две сквозные перегородки
  var door = Math.round(0.9 * PPM);
  var wall = function (x, y, w, h) { g.fillRect(x, y, w, h); };
  // перегородка A с дверью, перегородка B с дверью
  wall(xa, iy0, t, Math.round(ih * 0.4)); wall(xa, iy0 + Math.round(ih * 0.4) + door, t, ih - Math.round(ih * 0.4) - door);
  wall(xb, iy0, t, Math.round(ih * 0.7)); wall(xb, iy0 + Math.round(ih * 0.7) + door, t, ih - Math.round(ih * 0.7) - door);
  // правый столбец режется на три: 6,2 / 5,2 / 1,3
  var cx = xb + t, cw = ix0 + iw - cx;
  var y1 = iy0 + Math.round(2.78 * PPM), y2 = y1 + t + Math.round(2.33 * PPM);
  wall(cx, y1, cw - door, t); wall(cx, y2, cw - door, t);
  // клетушки в большой комнате: кухонный модуль 0,6×2,4 с полным контуром и шкаф-«пенал» 2×1,5
  g.strokeStyle = '#222'; g.lineWidth = 6;
  g.strokeRect(ix0 + 30, iy0 + 30, Math.round(0.6 * PPM), Math.round(2.4 * PPM));
  g.strokeRect(ix0 + 200, iy0 + ih - Math.round(1.5 * PPM) - 30, Math.round(2.0 * PPM), Math.round(1.5 * PPM));
  // подписи площадей: цифры в 3-пиксельной линии, как на скрине (перечёркнуты)
  var labs = [];
  var put = function (txt, m2, x, y) {
    g.fillStyle = '#111'; g.font = '16px Arial'; g.fillText(txt, x - 24, y + 5);
    g.strokeStyle = '#111'; g.lineWidth = 1; g.beginPath(); g.moveTo(x - 30, y); g.lineTo(x + 30, y); g.stroke();
    labs.push({ m2: m2, x: x, y: y, scan: true });
  };
  put('41 м²', 41, ix0 + Math.round(w1 / 2) + 40, iy0 + Math.round(ih / 2));
  put('15,1 м²', 15.1, xa + t + Math.round(w2 / 2), iy0 + Math.round(ih / 2));
  put('6,2 м²', 6.2, cx + Math.round(cw / 2), iy0 + Math.round(1.39 * PPM));
  put('5,2 м²', 5.2, cx + Math.round(cw / 2), y1 + t + Math.round(1.16 * PPM));
  put('1,3 м²', 1.3, cx + Math.round(cw / 2), y2 + t + Math.round(0.29 * PPM));
  var dims = [{ mm: 12480, px: W, horiz: true }, { mm: 6600, px: H, horiz: false }];
  return { canvas: c, labs: labs, dims: dims, ppm: PPM };
}
`;
};
