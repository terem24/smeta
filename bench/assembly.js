/**
 * Стенд «сходится ли котельная по концам» — см. шапку assembly_check.js.
 *
 * Запуск (из корня репозитория):
 *   node bench/assembly.js            типовые объекты, итог по каждому
 *   node bench/assembly.js detail     плюс разбор: кто дал каждый конец
 *   node bench/assembly.js ports      как разобрано название каждой позиции
 */
const app = require('./env.js');
const ac = require('../assembly_check.js');

const mode = process.argv[2] || '';

// Объекты подобраны так, чтобы прошли разные ветки обвязки: без гидрострелки
// и с ней, 22 и 28 трубы, оба бренда, три системы обвязки.
const OBJECTS = [
    { title: '120 м², радиаторы', o: { area: 120, res: 3 } },
    { title: '200 м², радиаторы + тёплый пол', o: { area: 200, systems: ['rad', 'tp'], tp1: 80 } },
    { title: '300 м², радиаторы + тёплый пол', o: { area: 300, res: 6, systems: ['rad', 'tp'], tp1: 80 } },
    { title: '200 м², ROMMER', o: { area: 200, systems: ['rad', 'tp'], tp1: 80, brandMode: 'rommer' } },
    { title: '200 м², металлопластик', o: { area: 200, systems: ['rad', 'tp'], tp1: 80, boilerPipeSystem: 'mp' } },
    { title: '200 м², полипропилен', o: { area: 200, systems: ['rad', 'tp'], tp1: 80, boilerPipeSystem: 'ppr' } },
    { title: '150 м², рециркуляция ГВС', o: { area: 150, recirc: true } },
    { title: '150 м², газ + резервный электрокотёл', o: { area: 150, fuels: ['gas', 'el'] } },
    { title: '300 м², металлопластик', o: { area: 300, res: 6, systems: ['rad', 'tp'], tp1: 80, boilerPipeSystem: 'mp' } },
    { title: '150 м², рециркуляция ГВС, ROMMER', o: { area: 150, recirc: true, brandMode: 'rommer' } },
    // Электрокотёл с буферной ёмкостью STT (подробный режим, «день-ночь»). С коллектором ёмкость стоит вместо
    // гидрострелки: коллектор обычный SDG-0016, стыковка должна сходиться полностью. Без коллектора (малый дом)
    // остаются «ВР без пары» электро-объектов без газа — они есть и без ёмкости, ёмкость их не добавляет.
    { title: '200 м², электрокотёл + буфер вместо гидрострелки', o: { area: 200, res: 3, fuels: ['el'], detailedRooms: true, bufferTank: true, elTariffMode: 'day_night', elPowerLimitOff: true, systems: ['rad', 'tp'], tp1: 80 } },
    { title: '300 м², электрокотёл + буфер, PPR', o: { area: 300, res: 6, fuels: ['el'], detailedRooms: true, bufferTank: true, elTariffMode: 'day_night', elPowerLimitOff: true, systems: ['rad', 'tp'], tp1: 80, boilerPipeSystem: 'ppr' } },
    { title: '120 м², электрокотёл + буфер без коллектора', o: { area: 120, res: 3, fuels: ['el'], detailedRooms: true, bufferTank: true, elTariffMode: 'day_night', elPowerLimitOff: true } }
];

const KIND = ac.KIND_RU;

OBJECTS.forEach(({ title, o }) => {
    app.state.brandMode = 'stout';
    app.__setup(o);
    const r = ac.check(app.currentEquipmentList);
    console.log('\n=== ' + title + ' ===');
    if (mode === 'chains') {
        const ch = require('../assembly_chains.js').run(app.currentEquipmentList, ac);
        ch.chains.forEach(c => {
            console.log('  ' + (c.ok ? '✓' : '✗') + ' ' + c.name + (c.ok ? '' : '\n      ' + c.problem));
            if (!c.ok || process.argv[3] === 'links') console.log('      ' + c.links.join('  →  '));
        });
        if (ch.dangling.length) console.log('  висят без пары: ' + ch.dangling.join('; '));
        ch.notDescribed.forEach(t => console.log('  · не описано: ' + t));
        if (ch.unclaimed.length) console.log('  вне цепочек: ' + ch.unclaimed.map(u => u.n + '×' + ' ' + u.name).join('; '));
        return;
    }
    if (mode === 'ports') {
        app.currentEquipmentList.filter(it => /^[12]\./.test(String(it.sectionTitle || ''))).forEach(it => {
            const p = ac.portsOf(it);
            console.log('  ' + String(it.q).padStart(3) + ' × ' + it.name + '  →  ' +
                (p ? p.ports.map(x => (x.pipe ? 'труба ' + x.size : (x.qty > 1 ? x.qty + '×' : '') + KIND[x.kind] + ' ' + x.size) + (x.ext ? ' (наружу)' : '')).join(', ') + (p.from === 'passport' ? '  [паспорт]' : '') : '??'));
        });
        return;
    }
    if (!r.problems.length) console.log('  резьба сходится');
    r.problems.forEach(p => {
        console.log('  ✗ ' + p.text);
        if (mode === 'detail' && r.balance[p.size]) r.balance[p.size].who.forEach(w =>
            console.log('      ' + String(w.n).padStart(2) + ' ' + KIND[w.kind].padEnd(15) + w.name));
    });
    if (r.slots.length) console.log('  не проверяется: ' + r.slots.join('; '));
    if (r.unknown.length) console.log('  нет данных о концах (' + r.unknown.length + '): ' +
        r.unknown.map(it => it.name).join('; '));
    if (r.ext.length) console.log('  уходит из котельной: ' +
        r.ext.map(e => e.n + '× ' + KIND[e.p.kind] + ' ' + e.p.size + '" (' + (e.p.role || e.it.name) + ')').join('; '));
});
