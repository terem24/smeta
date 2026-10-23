/**
 * Аудит пар STOUT ↔ ROMMER: какие строки сметы STOUT не имеют пары (.rommer / ANALOG_MAP / .alts),
 * а в каталоге ROMMER-двойник по названию есть. Запуск: node bench/pair_audit.js
 */
const app = require('./env.js');
const fs = require('fs');
const catalog = app.__catalog;
const _src = fs.readFileSync(__dirname + '/../app.js', 'utf8');
const _a = _src.indexOf('const ANALOG_MAP = ') + 19;
const ANALOG_MAP = new Function('return ' + _src.slice(_a, _src.indexOf('};', _a) + 1))();
const O = [
    { area: 120, res: 3 }, { area: 200, systems: ['rad', 'tp'], tp1: 80 },
    { area: 150, recirc: true }, { area: 120, res: 3, fuels: ['el'], systems: ['rad', 'tp'], tp1: 80 },
    { area: 200, systems: ['rad', 'tp'], tp1: 80, boilerPipeSystem: 'mp' }
];
const miss = {};
O.forEach(o => {
    app.state.brandMode = 'stout';
    app.__setup(o);
    (app.currentSpec || []).forEach(i => {
        const id = i.originalId || i.id;
        if (!/^S[A-Z]{2}-/.test(String(i.id))) return;
        if (i.rommer || (i.alts && i.alts.length) || ANALOG_MAP[i.id]) return;
        miss[i.id] = i.name;
    });
});
const all = [];
for (const k in catalog) (Array.isArray(catalog[k]) ? catalog[k] : []).forEach(x => x && x.id && all.push(x));
const rom = all.filter(x => /^R[A-Z]{2}-/.test(x.id));
Object.keys(miss).forEach(id => {
    const tail = id.slice(4);
    const cand = rom.filter(r => r.id.slice(4) === tail).map(r => r.id + ' ' + r.name);
    console.log(id + ' | ' + miss[id] + (cand.length ? '  → ' + [...new Set(cand)].join(' ; ') : ''));
});
console.log('без пары: ' + Object.keys(miss).length);
