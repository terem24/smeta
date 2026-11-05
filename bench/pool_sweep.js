// Перебор параметров дома: где объединение бухт даёт экономию. node bench/pool_sweep.js [площадь]
const app = require('./env.js');
const log = console.log; console.log = () => {};
const areaArg = +process.argv[2] || 0;
const areas = areaArg ? [areaArg] : [100, 150, 200, 300];
const out = [];
const grid = {
  floors: [1, 2],
  systems: [['rad'], ['rad', 'tp'], ['tp']],
  water: [true],
  waterPipeMaterial: ['pex', 'metal_plastic', 'pert'],
  pipeType: ['insulated', 'insulated_mp'],
  boilerPipeSystem: ['ss304', 'mp'],
  recirc: [false, true],
  zones: [1, 2, 3]
};
const keys = Object.keys(grid);
const keepZones = null;
let n = 0;
const rec = (i, o) => {
  if (i === keys.length) { run(o); return; }
  grid[keys[i]].forEach(v => rec(i + 1, Object.assign({}, o, { [keys[i]]: v })));
};
function run(o) {
  areas.forEach(area => {
    const s = Object.assign({ area, tp1: Math.round(area * 0.4), hotWater: true }, o);
    if (!s.systems.includes('tp')) s.tp1 = 0;
    const d = area < 120 ? 6 : 10;
    s.waterZones = [{ id: 1, name: 'Кухня', kind: 'kitchen', dist: d, fixtures: { toilet: 0, basin: 1, bath: 0, shower: 0, wash: 0, dish: 1 } }];
    for (let z = 0; z < s.zones; z++) s.waterZones.push({ id: 10 + z, name: 'Санузел ' + (z + 1), kind: 'wc', dist: d + 4 * z, fixtures: z ? { toilet: 1, basin: 1, bath: 0, shower: 0, wash: 0, dish: 0 } : { toilet: 1, basin: 1, bath: 0, shower: 1, wash: 0, dish: 0 } });
    delete s.zones;
    app.installerSettings = Object.assign(app.installerSettings || {}, { poolCoils: false });
    try { app.state.brandMode = 'stout'; app.__setup(s); } catch (e) { return; }
    const st = app._poolStats || {};
    n++;
    out.push({ s, unM: st.unM || 0, m: st.metres || 0, rub: st.rub || 0, pct: st.pct || 0, unRub: st.unRub || 0 });
  });
}
rec(0, {});
const by = a => out.filter(r => r.s.area === a);
areas.forEach(a => {
  const r = by(a), sv = r.filter(x => x.rub > 0);
  const avg = k => r.length ? Math.round(r.reduce((t, x) => t + x[k], 0) / r.length) : 0;
  log(`\n=== ${a} м²: вариантов ${r.length}, с экономией ${sv.length} (${Math.round(sv.length / (r.length || 1) * 100)} %). Среднее по всем: ${avg('m')} м, ${avg('rub')} ₽`);
  if (sv.length) {
    const sa = k => Math.round(sv.reduce((t, x) => t + x[k], 0) / sv.length);
    const mx = sv.reduce((b, x) => x.rub > b.rub ? x : b, sv[0]);
    log(`    среди тех, где есть: в среднем ${sa('m')} м, ${sa('rub')} ₽, ${(sv.reduce((t, x) => t + x.pct, 0) / sv.length).toFixed(1)} %; максимум ${mx.rub} ₽ (${mx.m} м, ${mx.pct} %) ${JSON.stringify(mx.s)}`);
  }
});
// что чаще всего даёт экономию
keys.filter(k => k !== 'zones').forEach(k => {
  const vals = {};
  out.filter(r => !areaArg || r.s.area === areaArg).forEach(r => { const v = JSON.stringify(r.s[k]); (vals[v] = vals[v] || []).push(r); });
  log(k.padEnd(20), Object.keys(vals).map(v => `${v}: ${Math.round(vals[v].filter(r => r.rub > 0).length / vals[v].length * 100)}% / ср. ${Math.round(vals[v].reduce((t, r) => t + r.rub, 0) / vals[v].length)} ₽`).join(' | '));
});
