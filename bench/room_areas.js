/**
 * Точность площадей комнат, найденных на растре плана (редактор plan_editor.html).
 *
 * Берёт корпус Galf (папка bench/ufh_corpus.js: meta.json + pNNN.rgb), для
 * каждой подписи комнаты на листе («Кухня 19.57 м²», координаты из текста
 * PDF) находит комнату, которую редактор выделил бы под этой точкой, и
 * сравнивает её площадь с напечатанной.
 *
 *   node bench/room_areas.js <папка корпуса> [--mode raw|clean|both] [--only p012] [--verbose]
 *
 * Функции поиска комнат берутся из plan_editor.html как есть (labelRooms,
 * openThin, chamferDist, traceLabel) — правка в редакторе сразу видна здесь.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = process.argv[2];
if (!dir) { console.error('нужна папка корпуса'); process.exit(1); }
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MODE = arg('--mode', 'both'), ONLY = arg('--only', null), VERBOSE = process.argv.includes('--verbose');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'plan_editor.html'), 'utf8');

/** Текст функции верхнего уровня по имени (до закрывающей скобки) */
function grab(name) {
  const i = SRC.indexOf('\nfunction ' + name + '(');
  if (i < 0) throw new Error('нет функции ' + name);
  let j = SRC.indexOf('{', i), depth = 0, k = j;
  for (; k < SRC.length; k++) {
    const c = SRC[k];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) break; }
  }
  return SRC.slice(i, k + 1);
}
const ctx = { GROW_ROOMS: true, Math, Uint8Array, Int16Array, Int32Array, Array, Number, console, window: {} };
vm.createContext(ctx);
vm.runInContext(['openThin', 'chamferDist', 'cleanBar', 'growToWalls', 'labelRooms', 'traceLabel', 'dpSimp', 'simplifyZone', 'area', 'centroid', 'fitZonePts'].map(grab).join('\n'), ctx);
if (process.argv.includes('--nogrow')) ctx.growToWalls = function () {};
let CUR = null;
ctx.getMask = () => CUR.m;
ctx.F = () => CUR.f;

/** Маска стен — как getMask редактора: уменьшение до 900 px по ширине, тёмное — стена */
function buildMask(rgb, w0, h0) {
  const k = Math.min(1, 900 / w0), w = Math.round(w0 * k), h = Math.round(h0 * k);
  const bar = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor(x / k), x1 = Math.max(x0 + 1, Math.floor((x + 1) / k));
    const y0 = Math.floor(y / k), y1 = Math.max(y0 + 1, Math.floor((y + 1) / k));
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = y0; yy < y1 && yy < h0; yy++) for (let xx = x0; xx < x1 && xx < w0; xx++) {
      const p = 3 * (yy * w0 + xx); r += rgb[p]; g += rgb[p + 1]; b += rgb[p + 2]; n++;
    }
    r /= n; g /= n; b /= n;
    const lum = (r * 3 + g * 6 + b) / 10;
    const dark = lum < 165 && !(r > g + 28 && r > b + 28);
    const ochre = r > 140 && g > 120 && b < Math.min(r, g) - 70 && g > r * 0.62;
    bar[y * w + x] = (dark || ochre) ? 1 : 0;
  }
  return { w, h, k, bar };
}

const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8').replace(/^﻿/, ''));
const modes = MODE === 'both' ? ['raw', 'clean'] : [MODE];
const rows = [];
for (const e of meta) {
  if (ONLY && e.id !== ONLY) continue;
  const labs = (e.labels || []).filter(l => l.area > 1 && l.x > 0);
  if (labs.length < 2 || !e.pxPerM) continue;
  const rgbFile = path.join(dir, e.id + '.rgb');
  if (!fs.existsSync(rgbFile)) continue;
  const rgb = fs.readFileSync(rgbFile);
  const m0 = buildMask(rgb, e.w, e.h);
  for (const mode of modes) {
    const f = { pxPerM: e.pxPerM };
    if (mode === 'clean') f.roomMask = 'clean';
    const m = { w: m0.w, h: m0.h, k: m0.k, bar: m0.bar };   // метки кладутся в m — копия на режим
    CUR = { m, f };
    const t0 = Date.now();
    ctx.labelRooms();
    const ms = Date.now() - t0;
    const ppm = e.pxPerM * m.k;
    if (process.argv.includes('--dump') && ONLY) {
      // картинка для глаза: стена — чёрное, области — по цвету, подписи — красные точки
      const out = Buffer.alloc(m.w * m.h * 3, 255);
      for (let i = 0; i < m.w * m.h; i++) {
        const L = m.labels[i];
        if (m.bar[i]) { out[3 * i] = out[3 * i + 1] = out[3 * i + 2] = 20; continue; }
        if (!L) { out[3 * i] = out[3 * i + 1] = out[3 * i + 2] = 235; continue; }
        const h = (L * 97) % 360, c = 0.45, X = c * (1 - Math.abs((h / 60) % 2 - 1));
        const [r, g, b] = h < 60 ? [c, X, 0] : h < 120 ? [X, c, 0] : h < 180 ? [0, c, X] : h < 240 ? [0, X, c] : h < 300 ? [X, 0, c] : [c, 0, X];
        out[3 * i] = 190 + r * 120; out[3 * i + 1] = 190 + g * 120; out[3 * i + 2] = 190 + b * 120;
      }
      labs.forEach(l => { const sx = Math.round(l.x * m.k), sy = Math.round(l.y * m.k);
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const x = sx + dx, y = sy + dy; if (x >= 0 && y >= 0 && x < m.w && y < m.h) { const i = y * m.w + x; out[3 * i] = 230; out[3 * i + 1] = 0; out[3 * i + 2] = 0; } } });
      fs.writeFileSync(process.argv[process.argv.indexOf('--dump') + 1] + '_' + mode + '.ppm', Buffer.concat([Buffer.from(['P6', m.w + ' ' + m.h, '255', ''].join(String.fromCharCode(10))), out]));
    }
    const perRegion = {};
    const rowsHere = [];
    labs.forEach(l => {
      const sx = Math.round(l.x * m.k), sy = Math.round(l.y * m.k);
      // подпись может лечь на линию — ищем ближайшую клетку с меткой
      let L = 0, bd = 1e9;
      for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
        const x = sx + dx, y = sy + dy;
        if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
        const v = m.labels[y * m.w + x];
        if (v && dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; L = v; }
      }
      let got = L && !m.labEdge[L] ? m.labCnt[L] / (ppm * ppm) : 0;
      if (got < 1.5 || got > 130) got = 0;            // такую область enumerateRooms не берёт
      let polyA = 0, simpA = 0, fitA = 0;
      if (got && L) {
        // что получит монтажник на экране: контур по меткам, затем упрощение до 4–6 углов
        const shoe = P => { let a = 0; for (let i = 0; i < P.length; i++) { const u = P[i], v = P[(i + 1) % P.length]; a += u[0] * v[1] - v[0] * u[1]; } return Math.abs(a) / 2 / (e.pxPerM * e.pxPerM); };
        const pts = ctx.traceLabel(m, L);
        if (pts) { polyA = shoe(pts); simpA = shoe(ctx.fitZonePts(pts.map(q => q.slice()), e.pxPerM) || pts); fitA = shoe(ctx.fitZonePts(pts.map(q => q.slice()), e.pxPerM, l.area) || pts); }
      }
      if (got) perRegion[L] = (perRegion[L] || 0) + 1;
      rowsHere.push({ id: e.id, mode, name: l.name, printed: l.area, got, polyA, simpA, fitA, L, ratio: got ? got / l.area : 0, ms });
    });
    rowsHere.forEach(r => { r.alone = r.got > 0 && perRegion[r.L] === 1; rows.push(r); });
  }
}

const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
for (const mode of modes) {
  const R = rows.filter(r => r.mode === mode);
  const found = R.filter(r => r.got > 0), rat = found.map(r => r.ratio);
  const err = found.map(r => Math.abs(r.ratio - 1));
  console.log(`\n[${mode}] подписей ${R.length}, комната найдена ${found.length}`);
  console.log(`  найденная / напечатанная: медиана ${med(rat).toFixed(3)}, 25–75 % ${q(rat, .25).toFixed(2)}–${q(rat, .75).toFixed(2)}`);
  console.log(`  ошибка до 5 %: ${err.filter(v => v <= .05).length}, до 10 %: ${err.filter(v => v <= .10).length}, до 20 %: ${err.filter(v => v <= .20).length}, больше 20 %: ${err.filter(v => v > .20).length}`);
  console.log(`  меньше напечатанной на 10 %+: ${rat.filter(v => v < .9).length}, больше на 10 %+: ${rat.filter(v => v > 1.1).length}`);
  const al = R.filter(r => r.alone), ra = al.map(r => r.ratio), ea = ra.map(v => Math.abs(v - 1));
  console.log(`  ТОЛЬКО комнаты, выделенные отдельно (одна подпись на область): ${al.length}`);
  console.log(`    найденная / напечатанная: медиана ${med(ra).toFixed(3)}, 25–75 % ${q(ra, .25).toFixed(2)}–${q(ra, .75).toFixed(2)}; ошибка до 5 %: ${ea.filter(v => v <= .05).length}, до 10 %: ${ea.filter(v => v <= .10).length}, до 20 %: ${ea.filter(v => v <= .20).length}, больше: ${ea.filter(v => v > .20).length}`);
  const ms = R.map(r => r.ms);
  console.log(`  время поиска комнат на лист: медиана ${med(ms)} мс`);
  if (VERBOSE) R.forEach(r => console.log(`    ${r.id} ${String(r.name).padEnd(18)} напечатано ${r.printed}  найдено ${r.got.toFixed(1)}  контур ${r.polyA.toFixed(1)}  упрощённый ${r.simpA.toFixed(1)}  с подгонкой ${r.fitA.toFixed(1)}  ${r.ratio.toFixed(2)}${r.alone ? '' : '  (область общая/нет)'}`));
}
