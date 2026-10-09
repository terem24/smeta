/**
 * Стенд автоматики MyHeat (тариф «Профи»): что попадает в раздел 2.9 на типовых котельных.
 *
 * Те же объекты считаются с автоматикой STOUT, ZONT и MyHeat; для каждого — состав
 * раздела 2.9 и сумма. Это числа, а не вид: стенд ловит падение расчёта, неверный
 * подбор прибора и блоков и «потерянные» позиции (выход без реле, датчик без шины).
 *
 * Запуск из корня репозитория:
 *   node bench/myheat.js            сводка по объектам
 *   node bench/myheat.js detail     плюс все строки раздела 2.9 у MyHeat
 */
const app = require('./env.js');
const detail = process.argv[2] === 'detail';

const PRO = { accountType: 'pro', tgUser: { id: 1, account_type: 'pro' }, boilerAuto: true };
const OBJECTS = [
    { title: '120 м², радиаторы (без смесителей)', o: { area: 120, res: 3 } },
    { title: '150 м², рециркуляция ГВС', o: { area: 150, recirc: true } },
    { title: '200 м², радиаторы + тёплый пол', o: { area: 200, systems: ['rad', 'tp'], tp1: 80 } },
    { title: '300 м², радиаторы + тёплый пол', o: { area: 300, res: 6, systems: ['rad', 'tp'], tp1: 80 } },
    { title: '200 м², подробный: протечка, воздух, давление', o: { area: 200, systems: ['rad', 'tp'], tp1: 80, detailedRooms: true, leakProtect: true, airControl: true, airDeviceType: 'thermostat', airLink: 'radio', heatingFeed: true } },
    { title: '150 м², газ + резервный электрокотёл', o: { area: 150, fuels: ['gas', 'el'] } },
    { title: '200 м², снеготаяние', o: { area: 200, systems: ['rad', 'tp'], tp1: 80, snowMelt: true } }
];
const BRANDS = [['stout', 'STOUT'], ['zont', 'ZONT'], ['myheat', 'MyHeat']];
const fmt = v => Math.round(v).toLocaleString('ru-RU');
let bad = 0;

OBJECTS.forEach(({ title, o }) => {
    console.log('\n=== ' + title + ' ===');
    BRANDS.forEach(([b, name]) => {
        try {
            app.__setup(Object.assign({}, PRO, { boilerAutoBrand: b }, o));
            const rows = app.currentEquipmentList.filter(it => /^2\.9\./.test(String(it.group || it.sectionTitle || '')));
            const sum = rows.reduce((a, it) => a + (it.price || 0) * (it.q || 0), 0);
            const cfg = app.thermaticConfig;
            const ctrl = rows[0];
            let line = '  ' + name.padEnd(8) + ' ' + String(rows.length).padStart(2) + ' поз., ' + fmt(sum).padStart(8) + ' ₽  ' + (ctrl ? ctrl.name : '— раздела 2.9 нет');
            if (b === 'myheat' && cfg && cfg.mh) {
                const f = cfg.mh;
                line += '  [' + f.model.short + (f.modules.length ? ' + ' + f.modules.map(x => x.qty + '×' + x.id).join(' + ') : '') +
                    '; выходов ' + f.outputsNeed + '/' + f.outputsMax + (f.ok ? '' : '; НЕ ХВАТАЕТ: ' + f.fail) + ']';
                if (!f.ok) bad++;
                (cfg.warnings || []).forEach(w => { line += '\n      ⚠ ' + w.slice(0, 160); });
            }
            console.log(line);
            if (detail && b === 'myheat') rows.forEach(it => console.log('        ' + String(it.q).padStart(3) + ' × ' + it.name + '  (' + fmt(it.price) + ' ₽)  ' + (it.group || '')));
        } catch (e) {
            bad++;
            console.log('  ' + name + ' — ПАДЕНИЕ: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
        }
    });
});
console.log(bad ? '\nРасхождений: ' + bad : '\nВсё сошлось.');
process.exit(bad ? 1 : 0);
