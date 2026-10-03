/**
 * Улитка по контуру на синтетических формах: прямоугольник, Г, П, Т — без
 * браузера. Пишет SVG с трубами подачи (красная) и обратки (синяя) и
 * проверяет, что трубы не сближаются меньше 0,7 шага.
 *
 *   node bench/contour_spiral.js [выход.svg] [--step 150]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(root, 'contour_spiral.svg');
const STEP = +(process.argv.includes('--step') ? process.argv[process.argv.indexOf('--step') + 1] : 150);

const ctx = { console, Math, JSON, String, Number, Array, Object, parseInt, parseFloat, isNaN, isFinite, setTimeout, clearTimeout,
  Float64Array, Float32Array, Int32Array, Int16Array, Uint8Array, Uint16Array, Map, Set };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = { createElement: () => ({ getContext: () => null, style: {} }) };
vm.createContext(ctx);
for (const f of ['project_sheets.js', 'project_plans.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const PP = ctx.projectPlans;

const PPM = 100, s = STEP / 1000 * PPM, r = s / 3;
// формы в метрах: список прямоугольников [x0,y0,x1,y1], объединение
const SHAPES = {
  'прямоугольник 4×3': [[0, 0, 4, 3]],
  'Г 5×4, выступ 2×2': [[0, 0, 5, 2], [0, 2, 2, 4]],
  'Г 4×4 толстая': [[0, 0, 4, 2.4], [0, 2.4, 2.2, 4]],
  'П 5×3': [[0, 0, 5, 1.2], [0, 1.2, 1.4, 3], [3.6, 1.2, 5, 3]],
  'Т 5×3': [[0, 0, 5, 1.4], [1.8, 1.4, 3.2, 3]],
  'узкая 4×0.5': [[0, 0, 4, 0.5]],
  'Г с узким плечом': [[0, 0, 4, 2.4], [0, 2.4, 0.8, 4]],
};

function inside(rects, x, y) { return rects.some(q => x >= q[0] && x <= q[2] && y >= q[1] && y <= q[3]); }
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function segSegDist(a, b, c, d) {
  const cr = (p, q, u, v) => { const o = (q[0] - p[0]) * (v[1] - u[1]) - (q[1] - p[1]) * (v[0] - u[0]); return o; };
  // пересечение
  const d1 = cr(a, b, a, c), d2 = cr(a, b, a, d), d3 = cr(c, d, c, a), d4 = cr(c, d, c, b);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(segDist(a, c, d), segDist(b, c, d), segDist(c, a, b), segDist(d, a, b));
}
/** Наименьшее расстояние между несмежными звеньями одной ломаной */
function minGap(P, skip) {
  let m = Infinity;
  for (let i = 0; i + 1 < P.length; i++) for (let j = i + skip; j + 1 < P.length; j++)
    m = Math.min(m, segSegDist(P[i], P[i + 1], P[j], P[j + 1]));
  return m;
}

let svg = '', yOff = 0, bad = 0;
for (const [name, rects] of Object.entries(SHAPES)) {
  const pad = 0.6 * PPM, X1 = Math.max(...rects.map(q => q[2])) * PPM, Y1 = Math.max(...rects.map(q => q[3])) * PPM;
  const W = Math.ceil(X1 / r) + 4, H = Math.ceil(Y1 / r) + 4, org = [-2 * r, -2 * r];
  const M = new Uint8Array(W * H);
  // стена: труба в 100 мм, значит маска начинается в (0,1 − s/2) от стены, не меньше 0
  const clear = Math.max(0, 0.1 * PPM - s / 2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const px = org[0] + (x + 0.5) * r, py = org[1] + (y + 0.5) * r;
    if (!inside(rects.map(q => [q[0] * PPM, q[1] * PPM, q[2] * PPM, q[3] * PPM]), px, py)) continue;
    // расстояние до границы формы
    // отступ от стены квадратом (по Чебышёву): углы остаются прямыми и у выпуклых, и у внутренних углов
    let ok = true;
    const hh = clear + r / 2;
    for (const dd of [[hh, 0], [-hh, 0], [0, hh], [0, -hh], [hh, hh], [hh, -hh], [-hh, hh], [-hh, -hh]])
      if (!inside(rects.map(q => [q[0] * PPM, q[1] * PPM, q[2] * PPM, q[3] * PPM]), px + dd[0], py + dd[1])) ok = false;
    if (ok) M[y * W + x] = 1;
  }
  const t = Date.now();
  const G = PP.contourGuide(M, W, H, r, org, s, [0, 0]);
  const ms = Date.now() - t;
  if (!G) { console.log(name.padEnd(22), 'нет улитки'); svg += `<text x="10" y="${yOff + 20}" font-size="12">${name}: нет улитки</text>`; yOff += 40; continue; }
  const sup = PP.offsetOrtho(G.guide, s / 2), ret = PP.offsetOrtho(G.guide, -s / 2);
  const pipe = sup.concat(ret.slice().reverse());      // одна труба: подача, разворот, обратка
  const gap = minGap(pipe, 3), lenM = pipe.reduce((a, p, i) => i ? a + Math.hypot(p[0] - pipe[i - 1][0], p[1] - pipe[i - 1][1]) : 0, 0) / PPM;
  const area = rects.reduce((a, q) => a + (q[2] - q[0]) * (q[3] - q[1]), 0);
  const okGap = gap >= 0.7 * s;
  if (!okGap) bad++;
  console.log(name.padEnd(22), `колец ${G.rings}, труба ${lenM.toFixed(1)} м на ${area.toFixed(1)} м² (${(area / (lenM * STEP / 1000) * 100).toFixed(0)} % заполнения), ` +
    `наименьший зазор ${(gap / PPM * 1000).toFixed(0)} мм ${okGap ? 'ок' : 'МАЛО'}, ${ms} мс`);
  const path1 = a => a.map((p, i) => (i ? 'L' : 'M') + (p[0] + 40).toFixed(1) + ',' + (p[1] + 40 + yOff).toFixed(1)).join('');
  svg += `<g><text x="10" y="${yOff + 16}" font-size="12">${name}</text>` +
    rects.map(q => `<rect x="${q[0] * PPM + 40}" y="${q[1] * PPM + 40 + yOff}" width="${(q[2] - q[0]) * PPM}" height="${(q[3] - q[1]) * PPM}" fill="#fff4e8" stroke="#f80"/>`).join('') +
    `<path d="${path1(sup)}" stroke="#d33" fill="none" stroke-width="2"/><path d="${path1(ret)}" stroke="#36c" fill="none" stroke-width="2"/>` +
    `<circle cx="${G.guide[0][0] + 40}" cy="${G.guide[0][1] + 40 + yOff}" r="4" fill="#0a0"/></g>`;
  yOff += Y1 + 80;
}
fs.writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" width="620" height="${yOff + 20}" style="background:#fff">${svg}</svg>`);
console.log('SVG:', out, bad ? `— зазоров меньше нормы: ${bad}` : '— все зазоры в норме');
