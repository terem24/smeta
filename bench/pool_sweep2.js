// Где объединение бухт даёт экономию: радиаторы и тёплый пол в одной трубе. node bench/pool_sweep2.js
const app = require('./env.js');
const log = console.log; console.log = () => {};
const rows = [];
[100, 120, 150, 180, 200, 250, 300].forEach(area => {
  [1, 2].forEach(floors => {
    [0.25, 0.4, 0.6, 0.8].forEach(k => {
      ['insulated', 'insulated_mp', 'split_mp'].forEach(pipeType => {
        ['pex', 'pert', 'metal_plastic'].forEach(ufh => {
          const o = { area, floors, systems: ['rad', 'tp'], tp1: Math.round(area * k), pipeType, ufhPipeMaterial: ufh, hotWater: true, res: 4, boilerPipeSystem: 'ss304' };
          app.installerSettings = Object.assign(app.installerSettings || {}, { poolCoils: false });
          try { app.__setup(o); } catch (e) { return; }
          const st = app._poolStats || {};
          rows.push({ o, unM: st.unM || 0, m: st.metres || 0, rub: st.rub || 0, pct: st.pct || 0 });
        });
      });
    });
  });
});
const sv = rows.filter(r => r.rub > 0);
log('вариантов', rows.length, 'с экономией', sv.length);
const by = (f) => { const g = {}; rows.forEach(r => { const k = f(r); (g[k] = g[k] || []).push(r); }); Object.keys(g).forEach(k => { const a = g[k], s = a.filter(r => r.rub > 0); log(String(k).padEnd(34), 'доля с экономией', Math.round(s.length / a.length * 100) + '%', '| ср. по всем', Math.round(a.reduce((t, r) => t + r.rub, 0) / a.length), '₽', '| ср. где есть', s.length ? Math.round(s.reduce((t, r) => t + r.rub, 0) / s.length) : 0, '₽'); }); };
log('\nпо площади'); by(r => r.o.area);
log('\nрадиаторы × тёплый пол'); by(r => r.o.pipeType + ' + ТП ' + r.o.ufhPipeMaterial);
log('\nплощадь тёплого пола / площадь'); by(r => Math.round(r.o.tp1 / r.o.area * 100) + '%');
const mx = sv.sort((a, b) => b.rub - a.rub).slice(0, 5);
log('\nтоп:'); mx.forEach(r => log(r.rub, '₽', r.m, 'м', r.pct + '%', JSON.stringify(r.o)));
const a150 = rows.filter(r => r.o.area === 150);
log('\n150 м²: вариантов', a150.length, ' с экономией', a150.filter(r => r.rub > 0).length, ' ср.по всем', Math.round(a150.reduce((t, r) => t + r.rub, 0) / a150.length), '₽,', (a150.reduce((t, r) => t + r.pct, 0) / a150.length).toFixed(1), '%');
