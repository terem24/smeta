// Отладка упрощения контура комнаты: node bench/room_poly_debug.js <папка корпуса> <id листа> <x> <y>
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'plan_editor.html'), 'utf8');
function grab(name) {
  const i = SRC.indexOf('\nfunction ' + name + '(');
  let j = SRC.indexOf('{', i), d = 0, k = j;
  for (; k < SRC.length; k++) { const c = SRC[k]; if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
  return SRC.slice(i, k + 1);
}
const [dir, id, X, Y] = process.argv.slice(2);
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8').replace(/^﻿/, '')).find(e => e.id === id);
const ctx = { GROW_ROOMS: true, Math, Uint8Array, Int16Array, Int32Array, Array, Number, console };
vm.createContext(ctx);
vm.runInContext(['openThin', 'chamferDist', 'cleanBar', 'growToWalls', 'labelRooms', 'traceLabel', 'dpSimp', 'simplifyZone', 'area', 'centroid', 'fitZonePts'].map(grab).join('\n'), ctx);
const rgb = fs.readFileSync(path.join(dir, id + '.rgb'));
const w0 = meta.w, h0 = meta.h, k = Math.min(1, 900 / w0), w = Math.round(w0 * k), h = Math.round(h0 * k);
const bar = new Uint8Array(w * h);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const x0 = Math.floor(x / k), x1 = Math.max(x0 + 1, Math.floor((x + 1) / k)), y0 = Math.floor(y / k), y1 = Math.max(y0 + 1, Math.floor((y + 1) / k));
  let r = 0, g = 0, b = 0, n = 0;
  for (let yy = y0; yy < y1 && yy < h0; yy++) for (let xx = x0; xx < x1 && xx < w0; xx++) { const p = 3 * (yy * w0 + xx); r += rgb[p]; g += rgb[p + 1]; b += rgb[p + 2]; n++; }
  r /= n; g /= n; b /= n;
  const lum = (r * 3 + g * 6 + b) / 10;
  bar[y * w + x] = ((lum < 165 && !(r > g + 28 && r > b + 28)) || (r > 140 && g > 120 && b < Math.min(r, g) - 70 && g > r * 0.62)) ? 1 : 0;
}
const m = { w, h, k, bar }, f = { pxPerM: meta.pxPerM };
ctx.getMask = () => m; ctx.F = () => f;
ctx.labelRooms();
const L = m.labels[Math.round(+Y * k) * w + Math.round(+X * k)];
const pts = ctx.traceLabel(m, L);
console.log('контур', pts.length, 'точек, площадь', ctx.area(pts).toFixed(2), JSON.stringify(pts));
[null, { maxCorners: 8, minSide: 0.5 }, { maxCorners: 10, minSide: 0.35 }, { maxCorners: 12, minSide: 0.25 }].forEach(o => {
  const S = ctx.simplifyZone(pts.map(q => q.slice()), meta.pxPerM, o);
  console.log(JSON.stringify(o), 'углов', S.length, 'площадь', ctx.area(S).toFixed(2), JSON.stringify(S));
});
