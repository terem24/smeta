/**
 * Раскладка тёплого пола по комнатам — насколько петли доходят до стен и
 * насколько ровные петли внутри комнаты. Мерка к замечанию владельца
 * (03.10.2026): «в помещениях пол до стен много не доходит, в нестандартных
 * формах пропускает», «Гостиная 1/2 — 21,8 м, 2/2 — 56,3 м».
 *
 * Вход — этаж из редактора планов (JSON: pxPerM, zones, coll, rads); без
 * аргумента — синтетика 544R из bench/ufh_sheet.js.
 *
 * По каждой зоне тёплого пола:
 *   непокрыто — доля площади зоны дальше REACH_M от ближайшей трубы петли
 *               (у стены труба в 100 мм от неё, полшага — ещё 75 мм: всё,
 *               что дальше 0,25 м, тёплым полом уже не прогревается);
 *   разброс  — самая длинная петля комнаты к самой короткой (с подводками
 *               и без них): проектировщики делают петли комнаты равными.
 *
 * Запуск: node bench/ufh_room.js [этаж.json ...] [--step 150] [--svg out.svg]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const STEP = +(arg('--step') || 150), svgOut = arg('--svg');
const files = process.argv.slice(2).filter((a, i, A) => !a.startsWith('--') && !(i > 0 && A[i - 1].startsWith('--')));
const REACH_M = 0.25;

const ctx = { console, Math, JSON, String, Number, Array, Object, parseInt, parseFloat, isNaN, isFinite, setTimeout, clearTimeout,
  Float64Array, Float32Array, Int32Array, Int16Array, Uint8Array, Uint16Array, Map, Set };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = { createElement: () => ({ getContext: () => null, style: {} }) };
vm.createContext(ctx);
for (const f of ['project_sheets.js', 'project_plans.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const PP = ctx.projectPlans;

function synth() {
  const ROOMS = [
    ['Гостиная', 0, 0, 4.2, 4.5], ['Кухня', 4.2, 0, 8.4, 4.5],
    ['Лестница', 0, 4.5, 3.0, 6.7], ['Холл', 3.0, 4.5, 4.2, 6.7], ['Прихожая', 6.2, 4.5, 8.4, 6.7],
    ['Спальня', 0, 6.7, 4.2, 10.6], ['Душевая, С/у', 4.2, 6.7, 6.2, 10.6],
  ];
  const PPM = 50, pts = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(p => [p[0] * PPM + PPM, p[1] * PPM + PPM]);
  return { name: '544R (синтетика)', pxPerM: PPM, w: 10.4 * PPM, h: 12.6 * PPM,
    zones: ROOMS.map(([name, ...r]) => ({ type: 'tp', name, pts: pts(...r) })), coll: { x: 9.3 * PPM, y: 8.3 * PPM } };
}

const pip = (p, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > p[1]) !== (P[j][1] > p[1]) && p[0] < (P[j][0] - P[i][0]) * (p[1] - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };

function measure(f) {
  const ppm = f.pxPerM, FL = PP.floorLoops(f, STEP, PP.loopLimit(STEP)), rows = [];
  const colds = (f.zones || []).filter(z => z.type === 'cold');
  let aAll = 0, unAll = 0, mAll = 0, nAll = 0;
  FL.forEach(Z => {
    const z = f.zones[Z.i], lp = (Z.loops || []).filter(l => l.sup);
    const segs = [];
    lp.forEach(l => [l.sup, l.ret].forEach(P => { for (let i = 1; i < P.length; i++) segs.push([P[i - 1], P[i]]); }));
    // сетка 5 см по зоне
    const xs = z.pts.map(p => p[0]), ys = z.pts.map(p => p[1]), st = 0.05 * ppm;
    let cells = 0, un = 0;
    for (let y = Math.min(...ys) + st / 2; y < Math.max(...ys); y += st)
      for (let x = Math.min(...xs) + st / 2; x < Math.max(...xs); x += st) {
        const p = [x, y];
        if (!pip(p, z.pts) || colds.some(c => pip(p, c.pts))) continue;
        cells++;
        let d = Infinity;
        for (const s of segs) { const q = segD(p, s[0], s[1]); if (q < d) { d = q; if (d < REACH_M * ppm) break; } }
        if (d >= REACH_M * ppm) un++;
      }
    const a = cells * 0.05 * 0.05;
    const L = lp.map(l => l.lenM), LM = lp.map(l => l.loopM);
    rows.push({ name: z.name, area: a, un: cells ? un / cells : 0, n: lp.length,
      L: L.map(v => Math.round(v * 10) / 10), spread: L.length > 1 ? Math.max(...L) / Math.min(...L) : 1,
      spreadLoop: LM.length > 1 ? Math.max(...LM) / Math.min(...LM) : 1 });
    aAll += a; unAll += a * (cells ? un / cells : 0); mAll += L.reduce((s, v) => s + v, 0); nAll += lp.length;
  });
  return { rows, un: aAll ? unAll / aAll : 0, m: mAll, n: nAll };
}

const floors = files.length ? files.map(fn => Object.assign({ name: path.basename(fn) }, JSON.parse(fs.readFileSync(fn, 'utf8')))) : [synth()];
floors.forEach(f => {
  const t = Date.now(), r = measure(f);
  console.log(`\n${f.name}: шаг ${STEP} мм, петель ${r.n}, труба ${Math.round(r.m)} м, непокрыто ${(r.un * 100).toFixed(1)} % (${Date.now() - t} мс)`);
  r.rows.forEach(x => console.log(`  ${x.name.padEnd(16)} ${x.area.toFixed(1).padStart(5)} м²  непокрыто ${(x.un * 100).toFixed(0).padStart(3)} %  ` +
    `петли ${x.L.join(' / ')} м  разброс ${x.spread.toFixed(2)} (без подводок ${x.spreadLoop.toFixed(2)})`));
  if (svgOut) {
    const v = PP.ufhView(Object.assign({}, f, { img: null }), STEP, [], { rads: true });
    if (v && v.svg) fs.writeFileSync(svgOut, '<?xml version="1.0" encoding="utf-8"?>' + v.svg);
  }
});
