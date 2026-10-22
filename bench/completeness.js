/**
 * Стенд «не потерялся ли в смете обязательный узел» — см. шапку completeness_check.js.
 *
 * Запуск (из корня репозитория):
 *   node bench/completeness.js          типовые объекты, находки по каждому
 *   node bench/completeness.js rules    какие правила действовали на каждом объекте
 *   node bench/completeness.js ci       код выхода 1 на находку, которой нет в bench/completeness_known.txt
 *
 * Объекты подобраны так, чтобы сработали все условия правил: газ и электро, с бойлером и без, тёплый пол,
 * рециркуляция, оба бренда, три системы обвязки.
 */
const app = require('./env.js');
const cc = require('../completeness_check.js');
const fs = require('fs');
const path = require('path');

const mode = process.argv[2] || '';

const OBJECTS = [
    { title: 'газ 120 м², радиаторы', o: { area: 120, res: 3 } },
    { title: 'газ 200 м², радиаторы + тёплый пол', o: { area: 200, systems: ['rad', 'tp'], tp1: 80 } },
    { title: 'газ 300 м², радиаторы + тёплый пол', o: { area: 300, res: 6, systems: ['rad', 'tp'], tp1: 80 } },
    { title: 'газ 200 м², ROMMER', o: { area: 200, systems: ['rad', 'tp'], tp1: 80, brandMode: 'rommer' } },
    { title: 'газ 200 м², металлопластик', o: { area: 200, systems: ['rad', 'tp'], tp1: 80, boilerPipeSystem: 'mp' } },
    { title: 'газ 200 м², полипропилен', o: { area: 200, systems: ['rad', 'tp'], tp1: 80, boilerPipeSystem: 'ppr' } },
    { title: 'газ 150 м², рециркуляция ГВС', o: { area: 150, recirc: true } },
    { title: 'газ 150 м², без бойлера', o: { area: 150, hotWater: false } },
    { title: 'газ 150 м² + резервный электрокотёл', o: { area: 150, fuels: ['gas', 'el'] } },
    { title: 'электро 120 м², с бойлером', o: { area: 120, res: 3, fuels: ['el'] } },
    { title: 'электро 200 м², тёплый пол', o: { area: 200, res: 3, fuels: ['el'], systems: ['rad', 'tp'], tp1: 80 } },
    { title: 'электро 300 м², тёплый пол', o: { area: 300, res: 6, fuels: ['el'], systems: ['rad', 'tp'], tp1: 80 } },
    { title: 'электро 320 м², радиаторы', o: { area: 320, res: 6, fuels: ['el'] } },
    { title: 'электро 120 м², буфер', o: { area: 120, res: 3, fuels: ['el'], detailedRooms: true, bufferTank: true, elTariffMode: 'day_night', elPowerLimitOff: true } }
];

/** Котлы объекта: по топливу из состояния; у электрокотла берём название из раздела 1 (нужно правилу про STATUS). */
function boilersOf(items) {
    const st = app.state;
    const el = items.find(it => /^1\./.test(String(it.sectionTitle || '')) && /электрич/i.test(it.name));
    return (st.fuels || []).map(f => f === 'gas' ? { type: 'gas', name: 'газовый' } : { type: 'el', name: el ? el.name : '' });
}

const known = (() => {
    try {
        return fs.readFileSync(path.join(__dirname, 'completeness_known.txt'), 'utf8')
            .split(String.fromCharCode(10)).map(x => x.trim()).filter(x => x && x[0] !== '#');
    } catch (e) { return []; }
})();

const found = [];
OBJECTS.forEach(({ title, o }) => {
    app.state.brandMode = o.brandMode || 'stout';
    app.__setup(o);
    const items = app.currentEquipmentList;
    const ctx = {
        items, state: app.state, boilers: boilersOf(items),
        dhwTank: !!app.dhwTankOn(),
        ufh: (app.state.systems || []).indexOf('tp') >= 0,
        recirc: !!app.state.recirc
    };
    const r = cc.check(ctx);
    console.log('\n=== ' + title + ' ===');
    if (!r.findings.length) console.log('  комплектно');
    r.findings.forEach(f => {
        console.log('  ✗ ' + f.title + ': ' + f.missing.join('; '));
        found.push(title + ' :: ' + f.rule);
    });
    if (mode === 'rules') console.log('  действовали: ' + r.applied.join(', '));
});

if (mode === 'ci') {
    const fresh = found.filter(k => known.indexOf(k) < 0);
    const fixed = known.filter(k => found.indexOf(k) < 0);
    console.log('\n[ci] находок: ' + found.length + ', из них новых: ' + fresh.length);
    fixed.forEach(k => console.log('[ci] уже не срабатывает, убери из completeness_known.txt: ' + k));
    fresh.forEach(k => console.log('[ci] НОВАЯ находка: ' + k));
    process.exitCode = fresh.length ? 1 : 0;
}
