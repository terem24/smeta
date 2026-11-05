// Что даёт объединение бухт на типовых домах 150 м² — для подсказки «в среднем экономят» (poolAvgText в app.js).
// Запуск: node bench/pool_avg.js
const app = require('./env.js');
const V = [
  ['подробно, 2 этажа', { area: 150, floors: 2, detailedRooms: true }],
  ['подробно + ТП', { area: 150, floors: 2, detailedRooms: true, systems: ['rad','tp'], tp1: 60 }],
  ['подробно + ТП, 3 жильца, мп', { area: 150, floors: 2, detailedRooms: true, res: 3, systems: ['rad','tp'], tp1: 60, boilerPipeSystem: 'mp' }],
  ['2 этажа, коллекторы', { area: 150, floors: 2, systems: ['rad','tp'], tp1: 60, radScheme: 'collector' }],
  ['газ+эл, 2 этажа', { area: 150, floors: 2, fuels: ['gas','el'], detailedRooms: true }],
  ['радиаторы', { area: 150 }],
  ['радиаторы, 2 жильца', { area: 150, res: 2 }],
  ['радиаторы, 4 жильца', { area: 150, res: 4 }],
  ['радиаторы + тёплый пол 60', { area: 150, systems: ['rad', 'tp'], tp1: 60 }],
  ['радиаторы + тёплый пол 80', { area: 150, systems: ['rad', 'tp'], tp1: 80 }],
  ['тёплый пол 100', { area: 150, systems: ['tp'], tp1: 100 }],
  ['металлопластик', { area: 150, boilerPipeSystem: 'mp' }],
  ['мп + тёплый пол', { area: 150, systems: ['rad', 'tp'], tp1: 70, boilerPipeSystem: 'mp' }],
  ['рециркуляция', { area: 150, recirc: true }],
  ['рециркуляция + тёплый пол', { area: 150, recirc: true, systems: ['rad', 'tp'], tp1: 70 }],
];
const rows = [];
V.forEach(([t, o]) => {
  app.state.brandMode = 'stout';
  app.installerSettings = Object.assign(app.installerSettings || {}, { poolCoils: false });
  try { app.__setup(o); } catch (e) { console.log(t, 'ошибка', e.message); return; }
  const s = app._poolStats || {};
  rows.push({ t, m: s.metres || 0, rub: s.rub || 0, pct: s.pct || 0, unM: s.unM || 0 });
  console.log(t.padEnd(30), 'по разделам', Math.round(s.unM || 0), 'м; экономия', Math.round(s.metres || 0), 'м', s.pct, '%', s.rub, '₽');
});
const n = rows.length, nz = rows.filter(r => r.rub > 0).length;
const avg = k => Math.round(rows.reduce((a, r) => a + r[k], 0) / n);
console.log('\nвариантов', n, 'с экономией', nz, '| среднее: ', avg('m'), 'м,', (rows.reduce((a, r) => a + r.pct, 0) / n).toFixed(1), '%,', avg('rub'), '₽');
