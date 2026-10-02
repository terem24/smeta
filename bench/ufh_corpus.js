/**
 * Раскладка тёплого пола на настоящих домах корпуса Galf — против проектировщика.
 *
 * Данные готовит bench/ufh_corpus_extract.py: картинка листа «План напольного
 * отопления» (сырые RGB), подписи помещений «(1.1) … 18 м²», точка коллектора
 * (конец выноски), длины петель проектировщика «L= …».
 *
 * Здесь:
 *   1) стены — тёмные ненасыщенные пиксели, двойные линии перегородок
 *      сплавляются раздутием; трубы петель цветные и в стены не попадают;
 *   2) комнаты — та же карта, что у распознавания проекта (RecognizeGeo:
 *      проёмы закрываются по уровням, заливка от подписей);
 *   3) масштаб — 1:100 листа А3 (так выпущен весь корпус); площади подписей
 *      только для проверки карты; комнаты с тёплым полом — где на картинке
 *      красные трубы;
 *   4) комната → прямоугольный контур по сетке 0,1 м → наша раскладка
 *      (projectPlans.floorLoops);
 *   5) сверка: длина трубы и число петель против проектировщика, пересечения
 *      петель между собой и наложения пучка подводок на петли, незаложенные зоны.
 *
 * Запуск (из корня worktree):
 *   node bench/ufh_corpus.js <папка вывода extract> [--svg <папка>] [--only p012]
 *   UNDERLAY=1 — на листе подложкой картинка проекта (<id>.png рядом с листом)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const dir = process.argv[2];
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const svgDir = arg('--svg'), only = arg('--only');
if (!dir) { console.log('node bench/ufh_corpus.js <папка extract> [--svg <папка>] [--only pNNN]'); process.exit(0); }

const ctx = { console, Math, JSON, String, Number, Array, Object, parseInt, parseFloat, isNaN, isFinite, setTimeout, clearTimeout,
  Float64Array, Float32Array, Int32Array, Int16Array, Uint8Array, Uint16Array, Map, Set };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = { createElement: () => ({ getContext: () => null, style: {} }) };
vm.createContext(ctx);
for (const f of ['project_sheets.js', 'project_plans.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const PP = ctx.projectPlans;
const Geo = require(path.join(root, 'recognize_geo.js'));

const ZOOM = 1.5;                                   // как в ufh_corpus_extract.py
const MM_PX = 25.4 / 72 / ZOOM * 100;               // мм натуры на пиксель при 1:100

// ── картинка → маска стен ─────────────────────────────────────────────────
function wallMask(rgb, W, H) {
  const N = W * H, raw = new Uint8Array(N), red = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = rgb[3 * i], g = rgb[3 * i + 1], b = rgb[3 * i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx < 120 && mx - mn < 35) raw[i] = 1;                    // чёрное и тёмно-серое
    if (r > 120 && r - g > 45 && r - b > 45) red[i] = 1;          // подача петель
  }
  const step = (a, op) => {
    const b = new Uint8Array(N);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      b[i] = op ? (a[i] | a[i - 1] | a[i + 1] | a[i - W] | a[i + W]) : (a[i] & a[i - 1] & a[i + 1] & a[i - W] & a[i + W]);
    }
    return b;
  };
  const rep = (a, op, r) => { for (let s = 0; s < r; s++) a = step(a, op); return a; };
  // закрытие на 3 px сплавляет пары линий, открытие на 1 px снимает текст и размерные линии
  const closed = rep(rep(raw, 1, 3), 0, 3);
  const wall = rep(rep(closed, 0, 1), 1, 1);
  return { wall, red };
}

// ── область карты → прямоугольный контур по сетке g пикселей ───────────────
function regionPoly(reg, W, H, id, g) {
  const GW = Math.ceil(W / g), GH = Math.ceil(H / g);
  const cnt = new Uint16Array(GW * GH);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (reg[y * W + x] === id) cnt[((y / g) | 0) * GW + ((x / g) | 0)]++;
  const half = g * g / 2;
  let inC = new Uint8Array(GW * GH);
  for (let i = 0; i < GW * GH; i++) if (cnt[i] > half) inC[i] = 1;
  // самая большая связная часть
  const seen = new Uint8Array(GW * GH), q = new Int32Array(GW * GH);
  let best = null;
  for (let i = 0; i < GW * GH; i++) {
    if (!inC[i] || seen[i]) continue;
    let qh = 0, qt = 0; q[qt++] = i; seen[i] = 1;
    const cells = [];
    while (qh < qt) {
      const k = q[qh++]; cells.push(k);
      const kx = k % GW;
      for (const j of [kx > 0 ? k - 1 : -1, kx < GW - 1 ? k + 1 : -1, k - GW, k + GW])
        if (j >= 0 && j < GW * GH && inC[j] && !seen[j]) { seen[j] = 1; q[qt++] = j; }
    }
    if (!best || cells.length > best.length) best = cells;
  }
  if (!best || best.length < 30) return null;
  // Как упрощает обвод редактор (simplifyZone): комната почти прямоугольная —
  // берём прямоугольник габарита. Монтажник обводит именно так.
  let bx0 = GW, by0 = GH, bx1 = -1, by1 = -1;
  best.forEach(k => { const cx = k % GW, cy = (k / GW) | 0; bx0 = Math.min(bx0, cx); by0 = Math.min(by0, cy); bx1 = Math.max(bx1, cx); by1 = Math.max(by1, cy); });
  if (best.length >= 0.8 * (bx1 - bx0 + 1) * (by1 - by0 + 1))
    return [[bx0 * g, by0 * g], [(bx1 + 1) * g, by0 * g], [(bx1 + 1) * g, (by1 + 1) * g], [bx0 * g, (by1 + 1) * g]];
  inC = new Uint8Array(GW * GH);
  best.forEach(k => { inC[k] = 1; });
  const at = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH && inC[y * GW + x] === 1;
  let start = -1;
  for (let i = 0; i < GW * GH; i++) if (inC[i]) { start = i; break; }
  const sx = start % GW, sy = (start / GW) | 0;
  // обход по рёбрам клеток, область справа по ходу: 0 →, 1 ↓, 2 ←, 3 ↑
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const side = (x, y, d) => d === 0 ? [at(x, y - 1), at(x, y)] : d === 1 ? [at(x, y), at(x - 1, y)]
    : d === 2 ? [at(x - 1, y), at(x - 1, y - 1)] : [at(x - 1, y - 1), at(x, y - 1)];
  let x = sx, y = sy, dir = 0;
  const pts = [[x, y]];
  for (let guard = 0; guard < 8 * GW * GH; guard++) {
    let moved = false;
    for (const turn of [1, 0, 3, 2]) {
      const d = (dir + turn) & 3, s = side(x, y, d);
      if (s[1] && !s[0]) { dir = d; x += DX[d]; y += DY[d]; moved = true; break; }
    }
    if (!moved) break;
    pts.push([x, y]);
    if (x === sx && y === sy) break;
  }
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[(i - 1 + pts.length - 1) % (pts.length - 1)], b = pts[i], c = pts[i + 1];
    if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) continue;
    out.push([b[0] * g, b[1] * g]);
  }
  return out.length >= 4 ? out : null;
}

// ── проверки рисунка (те же, что в bench/ufh_sheet.js) ─────────────────────
const segsOf = r => r.slice(1).map((p, i) => [r[i], p]);
function crossCount(FL, pxPerM) {
  const loopsAll = [];
  FL.forEach(z => z.loops.forEach(l => { if (l.sup) loopsAll.push(l); }));
  const lines = loopsAll.map(l => segsOf(l.sup).concat(segsOf(l.ret)));
  const cross = (a, b) => {
    const [[x1, y1], [x2, y2]] = a, [[x3, y3], [x4, y4]] = b;
    const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
    if (Math.abs(d) < 1e-9) return false;
    const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d, u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
    return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
  };
  let loopX = 0, bandX = 0;
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++)
    for (const a of lines[i]) for (const b of lines[j]) if (cross(a, b)) loopX++;
  (FL.bundle || []).forEach(sg => {
    const hw = sg.n * 0.02 * pxPerM;
    const bx = [Math.min(sg.a[0], sg.b[0]) - hw, Math.min(sg.a[1], sg.b[1]) - hw, Math.max(sg.a[0], sg.b[0]) + hw, Math.max(sg.a[1], sg.b[1]) + hw];
    lines.forEach((L, li) => {
      if (sg.own === loopsAll[li]) return;
      L.forEach(([[x1, y1], [x2, y2]]) => {
        if (Math.max(x1, x2) > bx[0] && Math.min(x1, x2) < bx[2] && Math.max(y1, y2) > bx[1] && Math.min(y1, y2) < bx[3]) {
          bandX++;
          if (process.env.WHERE) console.log('  наложение: пучок', sg.n, 'труб', sg.a.map(Math.round), '→', sg.b.map(Math.round),
            sg.own ? '(ввод петли)' : '', '| петля, отрезок', [x1, y1].map(Math.round), '→', [x2, y2].map(Math.round));
        }
      });
    });
  });
  return { loopX, bandX, loops: loopsAll.length };
}

// ── прогон ─────────────────────────────────────────────────────────────────
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
const res = [];
for (const m of meta) {
  if (only && m.id !== only) continue;
  const row = { id: m.id, pdf: m.pdf, page: m.page, designN: m.L.length, designM: Math.round(m.L.reduce((a, b) => a + b, 0)) };
  res.push(row);
  const labs = (m.labels || []).filter(l => l.x > 0);
  if (!labs.length) { row.fail = 'нет подписей помещений'; continue; }
  if (!m.coll) { row.fail = 'коллектор не найден'; continue; }
  if (!m.L.length) { row.fail = 'нет длин петель'; continue; }
  const rgb = fs.readFileSync(path.join(dir, m.id + '.rgb'));
  const W = m.w, H = m.h;
  const { wall, red } = wallMask(rgb, W, H);
  // Карту строит RecognizeGeo по многоугольникам стен — подаём ей готовую маску
  // вместо заливки; масштаб подбирается так, чтобы пиксель был MM_PX натуры.
  Geo.fillEvenOdd = (dst) => { for (let i = 0; i < dst.length; i++) dst[i] = wall[i]; };
  const k = Geo.PX_PER_PT, scale = MM_PX / (25.4 / 72 / k);
  const seeds = labs.map(l => ({ name: l.no, x: l.x / W * 100, y: (l.y + 8) / H * 100 }));
  let map;
  try { map = Geo.buildFromPolys([[]], W / k, H / k, seeds, scale); } catch (e) { row.fail = 'карта: ' + e.message; continue; }
  if (!map) { row.fail = 'карта не построилась'; continue; }
  // Масштаб листа: корпус выпущен не только в 1:100 (544R — около 1:75), поэтому
  // берём его по подписанным площадям: медиана «площадь на карте / по подписи».
  const ks = [];
  labs.forEach((l, i) => { if (l.area > 1 && map.areas[i] > 0.5) ks.push(map.areas[i] / l.area); });
  ks.sort((a, b) => a - b);
  const kA = ks.length >= 2 ? ks[ks.length >> 1] : 1;
  row.scale = Math.round(100 / Math.sqrt(kA));
  const pxPerM = 1000 / (MM_PX / Math.sqrt(kA));
  // комнаты с тёплым полом: красные трубы внутри
  const cntR = new Float64Array(labs.length), cntA = new Float64Array(labs.length);
  for (let i = 0; i < W * H; i++) { const r = map.reg[i]; if (r >= 0) { cntA[r]++; if (red[i]) cntR[r]++; } }
  const zones = [];
  const g = Math.max(2, Math.round(0.25 * pxPerM));           // сетка контура 0,25 м — как рука в редакторе
  const polyA = P => { let s = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) s += (P[j][0] + P[i][0]) * (P[j][1] - P[i][1]); return Math.abs(s / 2); };
  let labA = 0, labZ = 0, badRooms = 0, noArea = 0;
  labs.forEach((l, i) => {
    if (!cntA[i] || cntR[i] / cntA[i] < 0.004) return;
    const pts = regionPoly(map.reg, W, H, i, g);
    if (!pts) return;
    zones.push({ type: 'tp', name: l.no + (l.name ? ' ' + l.name : ''), pts });
    const a = polyA(pts) / pxPerM / pxPerM;
    if (l.area > 0) { labA += l.area; labZ += a; if (Math.abs(a / l.area - 1) > 0.25) badRooms++; }
    else noArea++;
  });
  // Карта годится для сверки, если каждая комната с тёплым полом совпала с
  // подписанной площадью в пределах 25 %: иначе комната «растеклась» через
  // незакрытый проём, и разница в трубе — от карты, а не от раскладки.
  // и масштаб подогнан хотя бы по трём подписанным площадям
  row.goodMap = badRooms === 0 && noArea <= 1 && ks.length >= 3 && labA > 0;
  // площадь зон против подписанной — по комнатам, где подпись площади есть
  row.zoneA = Math.round(zones.reduce((a, z) => a + polyA(z.pts), 0) / pxPerM / pxPerM * 10) / 10;
  row.areaK = labA > 0 ? Math.round(labZ / labA * 100) / 100 : null;
  row.rooms = labs.length; row.tpRooms = zones.length;
  if (!zones.length) { row.fail = 'комнат с тёплым полом не нашлось'; continue; }
  const step = m.steps.length ? +Object.entries(m.steps.reduce((a, s) => (a[s] = (a[s] || 0) + 1, a), {})).sort((a, b) => b[1] - a[1])[0][0] : 150;
  row.step = step;
  const f = { pxPerM, w: W, h: H, zones, coll: { x: m.coll.x, y: m.coll.y } };
  const T = Date.now();
  let FL;
  try { FL = PP.floorLoops(f, step, PP.loopLimit(step)); } catch (e) { row.fail = 'раскладка: ' + e.message; continue; }
  row.ms = Date.now() - T;
  let ourM = 0, ourN = 0, est = 0, leadM = 0;
  const lenP = P => P.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - P[i][0], p[1] - P[i][1]), 0);
  let manM = 0;
  FL.forEach(Z => { if (Z.est) est++; Z.loops.forEach(l => {
    ourM += l.m; ourN++;
    if (l.lead && l.lead.length > 1) {
      leadM += 2 * lenP(l.lead) / pxPerM;
      const a = l.lead[0], b = l.lead[l.lead.length - 1];
      manM += 2 * (Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1])) / pxPerM;   // прямой путь по осям
    }
  }); });
  row.ourN = ourN; row.ourM = Math.round(ourM); row.est = est; row.leadM = Math.round(leadM);
  // этаж из комнат обычного размера: карта стенда не слила полдома в одну «комнату»
  row.realRooms = FL.every(Z => Z.area <= 60);
  row.overLim = 0; row.overLimRoom = 0;
  FL.forEach(Z => Z.loops.forEach(l => {
    if (!l.sup || l.lenM <= PP.loopLimit(step) + 0.5) return;
    row.overLim++;
    if (Z.area <= 60) row.overLimRoom++;          // комната обычного размера, а не растёкшаяся карта
  }));
  row.snake = 0; row.spiral = 0;
  FL.forEach(Z => Z.loops.forEach(l => { if (l.kind) row[l.kind]++; }));
  row.detour = manM > 0 ? Math.round(leadM / manM * 100) / 100 : null;
  row.ratio = Math.round(ourM / Math.max(1, row.designM) * 100) / 100;
  Object.assign(row, crossCount(FL, pxPerM));
  if (svgDir) {
    fs.mkdirSync(svgDir, { recursive: true });
    const img = process.env.UNDERLAY ? m.id + '.png'
      : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
    const sh = PP.sheets({ floors: [Object.assign({ img }, f)] }, { only: ['tp'], stepMm: step, code: m.pdf.slice(0, 30), rooms: [] });
    if (sh[0]) fs.writeFileSync(path.join(svgDir, m.id + '.svg'), sh[0].svg);
  }
}

// ── сводка ─────────────────────────────────────────────────────────────────
const done = res.filter(r => !r.fail);
const ok = done.filter(r => r.goodMap);
const q = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * p))] : NaN; };
console.log(`Листов: ${res.length}, разложено: ${done.length}, из них с хорошей картой помещений (для сверки длин): ${ok.length}`);
if (done.length) {
  console.log(`Рисунок по ВСЕМ разложенным: чисто ${done.filter(r => !r.loopX && !r.bandX).length} из ${done.length}; ` +
    `с пересечениями петель ${done.filter(r => r.loopX).length}, с наложением пучка ${done.filter(r => r.bandX).length}, ` +
    `с незаложенными зонами ${done.filter(r => r.est).length}`);
  const real = done.filter(r => r.realRooms);
  console.log(`Этажи из комнат обычного размера (все до 60 м²): ${real.length}; чисто ${real.filter(r => !r.loopX && !r.bandX && !r.est).length}; ` +
    `с наложением пучка ${real.filter(r => r.bandX).length}, с незаложенными зонами ${real.filter(r => r.est).length}, ` +
    `петель ${real.reduce((a, r) => a + r.ourN, 0)}, комнат ${real.reduce((a, r) => a + r.tpRooms, 0)}`);
  console.log(`Петли длиннее предела: ${done.reduce((a, r) => a + r.overLim, 0)} на ${done.filter(r => r.overLim).length} этажах ` +
    `(в комнатах до 60 м²: ${done.reduce((a, r) => a + r.overLimRoom, 0)} на ${done.filter(r => r.overLimRoom).length}); ` +
    `улиток ${done.reduce((a, r) => a + r.spiral, 0)}, змеек ${done.reduce((a, r) => a + r.snake, 0)}; ` +
    `время раскладки: медиана ${q(done.map(r => r.ms), 0.5)} мс, макс ${Math.max(...done.map(r => r.ms))} мс`);
}
const fails = {};
res.filter(r => r.fail).forEach(r => { fails[r.fail] = (fails[r.fail] || 0) + 1; });
Object.entries(fails).forEach(([k, v]) => console.log(`  не разобрано — ${k}: ${v}`));
if (ok.length) {
  const ratio = ok.map(r => r.ratio);
  console.log(`Труба наша / проектировщика: медиана ${q(ratio, 0.5)}, 25–75 % ${q(ratio, 0.25)}–${q(ratio, 0.75)}`);
  console.log(`Петель: наших ${ok.reduce((a, r) => a + r.ourN, 0)}, у проектировщиков ${ok.reduce((a, r) => a + r.designN, 0)}`);
  console.log(`Площадь наших зон / подписанной (по тем же комнатам): медиана ${q(ok.filter(r => r.areaK).map(r => r.areaK), 0.5)}`);
  console.log(`Труба на м² зоны: наша медиана ${q(ok.map(r => Math.round((r.ourM - r.leadM) / r.zoneA * 10) / 10), 0.5)} без подводок; подводки — ${q(ok.map(r => Math.round(r.leadM / r.ourM * 100)), 0.5)} % трубы`);
  console.log(`Подводки длиннее прямого пути по осям: медиана в ${q(ok.filter(r => r.detour).map(r => r.detour), 0.5)} раза`);
  console.log(`Чисто (0 пересечений и 0 наложений пучка): ${ok.filter(r => !r.loopX && !r.bandX).length} из ${ok.length}`);
  console.log(`С пересечениями петель: ${ok.filter(r => r.loopX).length}, с наложением пучка: ${ok.filter(r => r.bandX).length}, с незаложенными зонами: ${ok.filter(r => r.est).length}`);
  console.log(`Время раскладки: медиана ${q(ok.map(r => r.ms), 0.5)} мс, макс ${Math.max(...ok.map(r => r.ms))} мс`);
}
fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(res, null, 1));
console.log('Подробно:', path.join(dir, 'result.json'));
