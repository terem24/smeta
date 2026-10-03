/**
 * Комнаты буквой Г, П и Т разных размеров — раскладка тёплого пола «с улиткой
 * по контуру» против «только прямоугольники». Аккуратные ортогональные
 * комнаты, как на настоящих планах, — корпус Galf для них не годится (там
 * зоны с растра рваные).
 *
 * Каждая комната стоит в доме из двух смежных комнат с коллектором в одной из
 * них (подводки идут и через соседнюю). Меряем:
 *   петель и метров трубы; непокрытый пол (дальше 0,25 м от трубы);
 *   разброс длин петель в комнате; пересечения петель между собой;
 *   наложения пучка подводок на чужие петли.
 *
 *   node bench/ufh_lshapes.js [--step 150] [--n 60] [--seed 7] [--verbose]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const STEP = +arg('--step', 150), N = +arg('--n', 60), SEED = +arg('--seed', 7), VERBOSE = process.argv.includes('--verbose');

const ctx = { console, Math, JSON, String, Number, Array, Object, parseInt, parseFloat, isNaN, isFinite, setTimeout, clearTimeout,
  Float64Array, Float32Array, Int32Array, Int16Array, Uint8Array, Uint16Array, Map, Set };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = { createElement: () => ({ getContext: () => null, style: {} }) };
vm.createContext(ctx);
for (const f of ['project_sheets.js', 'project_plans.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const PP = ctx.projectPlans;

let seed = SEED;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const between = (a, b) => a + (b - a) * rnd();
const q = v => Math.round(v * 10) / 10;
const PPM = 80;

/** Форма комнаты: список прямоугольников (м) */
function makeShape(kind) {
  const W = q(between(3.6, 7)), H = q(between(3.2, 6));
  const aw = q(between(1.3, Math.min(3, W - 1.2))), ah = q(between(1.3, Math.min(3, H - 1.2)));
  if (kind === 'L') return [[0, 0, W, ah], [0, ah, aw, H]];
  if (kind === 'U') return [[0, 0, W, ah], [0, ah, aw, H], [W - aw, ah, W, H]];
  return [[0, 0, W, ah], [(W - aw) / 2, ah, (W + aw) / 2, H]];          // T
}
const polyOf = rects => {
  // обход объединения прямоугольников: растр 5 см → контур
  const c = 0.05, X1 = Math.max(...rects.map(r => r[2])), Y1 = Math.max(...rects.map(r => r[3]));
  const Wc = Math.round(X1 / c), Hc = Math.round(Y1 / c), M = new Uint8Array(Wc * Hc);
  rects.forEach(r => { for (let y = Math.round(r[1] / c); y < Math.round(r[3] / c); y++) for (let x = Math.round(r[0] / c); x < Math.round(r[2] / c); x++) M[y * Wc + x] = 1; });
  // границы клеток → замкнутый контур по рёбрам (по часовой), вершины в клетках
  const edges = new Map();
  const add = (ax, ay, bx, by) => { const k = ax + ',' + ay; (edges.get(k) || edges.set(k, []).get(k)).push([bx, by]); };
  for (let y = 0; y < Hc; y++) for (let x = 0; x < Wc; x++) {
    if (!M[y * Wc + x]) continue;
    if (y === 0 || !M[(y - 1) * Wc + x]) add(x, y, x + 1, y);
    if (x === Wc - 1 || !M[y * Wc + x + 1]) add(x + 1, y, x + 1, y + 1);
    if (y === Hc - 1 || !M[(y + 1) * Wc + x]) add(x + 1, y + 1, x, y + 1);
    if (x === 0 || !M[y * Wc + x - 1]) add(x, y + 1, x, y);
  }
  const first = edges.keys().next().value.split(',').map(Number), pts = [first];
  let cur = first, guard = 0;
  while (guard++ < 100000) {
    const nx = edges.get(cur[0] + ',' + cur[1]);
    if (!nx || !nx.length) break;
    const nxt = nx.pop(); if (nxt[0] === first[0] && nxt[1] === first[1]) break;
    pts.push(nxt); cur = nxt;
  }
  // убрать вершины на прямых
  const out = [];
  pts.forEach((p, i) => {
    const a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length];
    if ((b[0] - p[0]) * (p[1] - a[1]) - (b[1] - p[1]) * (p[0] - a[0]) !== 0) out.push([p[0] * c, p[1] * c]);
  });
  return out;
};

const pip = (p, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > p[1]) !== (P[j][1] > p[1]) && p[0] < (P[j][0] - P[i][0]) * (p[1] - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
const crossSeg = (a, b) => {
  const [[x1, y1], [x2, y2]] = a, [[x3, y3], [x4, y4]] = b;
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (Math.abs(d) < 1e-9) {
    const hz = Math.abs(y2 - y1) < 1e-6 && Math.abs(y4 - y3) < 1e-6, vt = Math.abs(x2 - x1) < 1e-6 && Math.abs(x4 - x3) < 1e-6;
    const tol = STEP / 1000 * PPM / 3;
    if (hz && Math.abs(y1 - y3) < tol) return Math.min(Math.max(x1, x2), Math.max(x3, x4)) - Math.max(Math.min(x1, x2), Math.min(x3, x4)) > tol;
    if (vt && Math.abs(x1 - x3) < tol) return Math.min(Math.max(y1, y2), Math.max(y3, y4)) - Math.max(Math.min(y1, y2), Math.min(y3, y4)) > tol;
    return false;
  }
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d, u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
};

function measure(f) {
  const t0 = Date.now();
  const FL = PP.floorLoops(f, STEP, PP.loopLimit(STEP));
  if (VERBOSE) console.error('  floorLoops', Date.now() - t0, 'мс');
  const loops = [], res = { n: 0, m: 0, un: 0, area: 0, spread: [], loopX: 0, bandX: 0, poly: FL.polyUsed || 0, tried: FL.polyTried || 0, est: 0 };
  FL.forEach(Z => {
    const z = f.zones[Z.i], lp = (Z.loops || []).filter(l => l.sup);
    if (!lp.length) res.est++;
    lp.forEach(l => loops.push(l));
    const segs = []; lp.forEach(l => [l.sup, l.ret].forEach(P => { for (let i = 1; i < P.length; i++) segs.push([P[i - 1], P[i]]); }));
    const xs = z.pts.map(p => p[0]), ys = z.pts.map(p => p[1]), st = 0.05 * PPM;
    let cells = 0, un = 0;
    for (let y = Math.min(...ys) + st / 2; y < Math.max(...ys); y += st) for (let x = Math.min(...xs) + st / 2; x < Math.max(...xs); x += st) {
      if (!pip([x, y], z.pts)) continue;
      cells++;
      let d = Infinity; for (const s of segs) { const qd = segD([x, y], s[0], s[1]); if (qd < d) { d = qd; if (d < 0.25 * PPM) break; } }
      if (d >= 0.25 * PPM) un++;
    }
    res.area += cells * 0.0025; res.un += un * 0.0025;
    if (lp.length > 1) res.spread.push(Math.max(...lp.map(l => l.lenM)) / Math.min(...lp.map(l => l.lenM)));
    res.n += lp.length; res.m += lp.reduce((a, l) => a + l.lenM, 0);
  });
  const lines = loops.map(l => [l.sup, l.ret].flatMap(P => P.slice(1).map((p, i) => [P[i], p])));
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++)
    for (const a of lines[i]) for (const b of lines[j]) if (crossSeg(a, b)) res.loopX++;
  (FL.bundle || []).forEach(sg => {
    const hw = sg.n * 0.02 * PPM, bx = [Math.min(sg.a[0], sg.b[0]) - hw, Math.min(sg.a[1], sg.b[1]) - hw, Math.max(sg.a[0], sg.b[0]) + hw, Math.max(sg.a[1], sg.b[1]) + hw];
    lines.forEach((L, li) => { if (sg.own !== loops[li]) L.forEach(s => { if (Math.max(s[0][0], s[1][0]) > bx[0] && Math.min(s[0][0], s[1][0]) < bx[2] && Math.max(s[0][1], s[1][1]) > bx[1] && Math.min(s[0][1], s[1][1]) < bx[3]) res.bandX++; }); });
  });
  return res;
}

const cases = [];
for (let i = 0; i < N; i++) {
  const kind = ['L', 'L', 'L', 'U', 'T'][i % 5];
  const rects = makeShape(kind), P = polyOf(rects);
  const X1 = Math.max(...rects.map(r => r[2])), Y1 = Math.max(...rects.map(r => r[3]));
  // соседняя комната справа, коллектор в ней — подводки пройдут через стену
  const side = rnd() < 0.5;
  const neighbor = [X1 + 0.1, 0, X1 + 0.1 + between(2.6, 4), Math.max(2.8, between(2.8, Y1))];
  const nP = [[neighbor[0], neighbor[1]], [neighbor[2], neighbor[1]], [neighbor[2], neighbor[3]], [neighbor[0], neighbor[3]]];
  const collAt = side ? [neighbor[0] + 0.6, neighbor[3] - 0.6] : [neighbor[0] + 0.6, neighbor[1] + 0.6];
  const px = v => [v[0] * PPM + 40, v[1] * PPM + 40];
  cases.push({ id: kind + (i + 1), kind, area: rects.reduce((a, r) => a + (r[2] - r[0]) * (r[3] - r[1]), 0),
    floor: { pxPerM: PPM, w: 1000, h: 800, zones: [{ type: 'tp', name: kind + (i + 1), pts: P.map(px) }, { type: 'tp', name: 'Соседняя', pts: nP.map(px) }],
      coll: { x: px(collAt)[0], y: px(collAt)[1] } } });
}

const agg = { on: { n: 0, m: 0, un: 0, area: 0, loopX: 0, bandX: 0, spread: [], poly: 0, tried: 0, est: 0 }, off: { n: 0, m: 0, un: 0, area: 0, loopX: 0, bandX: 0, spread: [], poly: 0, tried: 0, est: 0 } };
const worse = [];
cases.forEach(c => {
  PP.setPoly(false); const a = measure(JSON.parse(JSON.stringify(c.floor)));
  PP.setPoly(true); const b = measure(JSON.parse(JSON.stringify(c.floor)));
  [['off', a], ['on', b]].forEach(([k, r]) => { const A = agg[k]; ['n', 'm', 'un', 'area', 'loopX', 'bandX', 'poly', 'tried', 'est'].forEach(f => A[f] += r[f]); A.spread.push(...r.spread); });
  const used = b.poly > 0;
  if (VERBOSE || b.loopX || b.bandX || (used && b.un / b.area > a.un / a.area + 0.02))
    console.log(`${c.id.padEnd(4)} ${c.area.toFixed(1).padStart(5)} м² контур ${b.poly}/${b.tried}  петель ${a.n}→${b.n}  труба ${a.m.toFixed(0)}→${b.m.toFixed(0)} м  ` +
      `непокрыто ${(a.un / a.area * 100).toFixed(1)}→${(b.un / b.area * 100).toFixed(1)} %  пересечений ${a.loopX}→${b.loopX}  наложений пучка ${a.bandX}→${b.bandX}`);
});
const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
console.log(`\nКомнат: ${cases.length} (Г, П, Т), шаг ${STEP} мм. Контур включился в ${agg.on.poly} зонах из ${agg.on.tried} пробованных.`);
for (const k of ['off', 'on']) {
  const A = agg[k];
  console.log(`${k === 'off' ? 'Только прямоугольники' : 'С улиткой по контуру  '}: петель ${A.n}, труба ${A.m.toFixed(0)} м, непокрыто ${(A.un / A.area * 100).toFixed(2)} %, ` +
    `разброс длин петель медиана ${med(A.spread).toFixed(2)} (больше 1,3: ${A.spread.filter(v => v > 1.3).length} из ${A.spread.length}), пересечений ${A.loopX}, наложений пучка ${A.bandX}, зон без петель ${A.est}`);
}
