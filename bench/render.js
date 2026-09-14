/**
 * Стенд сметы по типовым объектам: считает render() на наборе объектов и печатает
 * теплопотери, число строк и суммы оборудования и работ. С --save пишет полный
 * состав в файл, с --compare сравнивает с сохранённым прогоном построчно.
 *
 * Зачем. После пачки правок в render() синтаксическая проверка не ловит того, что
 * падает только при расчёте конкретного объекта (переменная не в той области,
 * ветка квартиры, тройниковая схема), и не показывает, какие позиции и суммы
 * сдвинулись. Здесь это видно до публикации: до правок — --save, после — --compare.
 *
 * Запуск из корня репозитория:
 *   node bench/render.js                     — прогон, ошибки и итоги по объектам
 *   node bench/render.js --save before.json  — сохранить состав смет
 *   node bench/render.js --compare before.json — что изменилось по каждому объекту
 *
 * Первый прогон с этим набором — 14.09.2026, перед выкладкой правок аудита
 * (18 объектов, ошибок нет).
 */
const fs = require('fs');
const app = require('./env.js');

const DEF = JSON.parse(JSON.stringify(app.state));
const zone = (name, fx, dist) => ({ id: name, name, dist: dist || 8,
    fixtures: Object.assign({ toilet: 0, basin: 0, shower: 0, bath: 0, wash: 0, dish: 0, bidet: 0 }, fx) });

// __gen — сгенерировать помещения для подробного режима, как это делает переключатель.
const SCEN = {
    'Q1 газ+бойлер, радиаторы, 150 м², 1 эт.': { area: 150, floors: 1, res: 4, win: 10, fuels: ['gas'], systems: ['rad'], hotWater: true },
    'Q2 газ, 150 м², 2 эт., рад+ТП 40, вода, скважина, канализация': { area: 150, floors: 2, res: 4, win: 12, fuels: ['gas'], systems: ['rad', 'tp'], tp1: 40, hotWater: true, water: true, well: true, wellDepth: 50, wellDist: 30, waterInput: true,
        waterZones: [zone('Санузел 1', { toilet: 1, basin: 1, bath: 1, wash: 1 }), zone('Санузел 2', { toilet: 1, basin: 1, shower: 1 }), zone('Кухня', { dish: 1, basin: 1 })] },
    'Q3 электро, 120 м², юг': { area: 120, floors: 1, res: 3, win: 8, fuels: ['el'], systems: ['rad'], region: 78 },
    'Q4 только ТП, 100 м², газ': { area: 100, floors: 1, res: 3, win: 8, fuels: ['gas'], systems: ['tp'], tp1: 90 },
    'Q5 газ, 350 м², каскад, без бойлера': { area: 350, floors: 2, res: 6, win: 20, fuels: ['gas'], systems: ['rad'], hotWater: false, region: 130 },
    'Q6 тройниковая, 55/45, 130 м²': { area: 130, floors: 1, res: 4, win: 9, fuels: ['gas'], systems: ['rad'], radConnectionScheme: 'tee', radRegime: 'r5545' },
    'Q7 снеготаяние 30 м², 200 м²': { area: 200, floors: 2, res: 4, win: 14, fuels: ['gas'], systems: ['rad'], hotWater: true, snowMelt: true, snowZones: [{ id: 1, name: 'Проезд', area: 30, kind: 'drive', step: 200, dist: 10 }] },
    'D1 подробный, 140 м², рад+ТП': { area: 140, floors: 1, res: 4, win: 10, fuels: ['gas'], systems: ['rad', 'tp'], tp1: 40, hotWater: true, detailedRooms: true, __gen: true },
    'D2 подробный, 200 м², 2 эт., электро, 70/55': { area: 200, floors: 2, res: 5, win: 14, fuels: ['el'], systems: ['rad'], detailedRooms: true, radRegime: 'r7055', __gen: true },
    'X1 электро + бойлер, 90 м²': { area: 90, floors: 1, res: 3, win: 7, fuels: ['el'], systems: ['rad'], hotWater: true },
    'X2 скважина 100 м, BRIO': { area: 150, floors: 2, res: 4, win: 12, fuels: ['gas'], systems: ['rad'], water: true, well: true, wellDepth: 100, wellDist: 40, wellAutoType: 'brio', waterZones: [zone('С/у', { toilet: 1, basin: 1, shower: 1 })] },
    'X3 ТП одна петля 8 м², узел std, 2 эт.': { area: 160, floors: 2, res: 4, win: 12, fuels: ['gas'], systems: ['rad', 'tp'], tp1: 8, tp2: 30, ufhMixType: 'std' },
    'X4 ROMMER, канализация Comfort, рециркуляция': { area: 180, floors: 2, res: 5, win: 12, fuels: ['gas'], systems: ['rad'], brandMode: 'rommer', sewerType: 'comfort', hotWater: true, water: true, recirc: true,
        waterZones: [zone('С/у1', { toilet: 1, basin: 2, bath: 1 }), zone('С/у2', { toilet: 1, basin: 1, shower: 1 })] },
    'X6 подробный, тройник, 55/45, 2 эт.': { area: 180, floors: 2, res: 4, win: 12, fuels: ['gas'], systems: ['rad'], detailedRooms: true, radConnectionScheme: 'tee', radRegime: 'r5545', __gen: true },
    'X7 газ, раздел котла выключен (котёл заказчика)': { area: 120, floors: 1, res: 3, win: 8, fuels: ['gas'], systems: ['rad'], disabledSections: ['1. Котёл + водонагреватель'] },
    'R1 распознанная смета без объекта': { area: 0, groupItems: true, userAddedEq: [
        { id: 'rec_1', name: 'Кран шаровой 1/2', price: 500, q: 3, recognized: true, section: '9. Дополнительные материалы', sectionAuto: '5. Внутреннее водоснабжение', article: 'SVB-1007-200020' },
        { id: 'rec_2', name: 'Радиатор', price: 9000, q: 2, recognized: true, section: '9. Дополнительные материалы', sectionAuto: '3. Приборы отопления' }] }
};

const out = {};
let errors = 0;
for (const [name, patch] of Object.entries(SCEN)) {
    const r = { name };
    try {
        app.state = Object.assign(JSON.parse(JSON.stringify(DEF)), JSON.parse(JSON.stringify(patch)),
            { tgUser: { id: 1, account_type: 'pro' }, accountType: 'pro' });
        if (patch.__gen) app.generateRoomsForDetailedCalculation();
        app.autoCalcZones();
        app.render(true);
        r.heat = app.getHouseHeatLoss();
        r.eqSum = Math.round(app.lastEqSum); r.worksSum = Math.round(app.lastWorksSum);
        r.eq = (app.currentEquipmentList || []).map(i => [i.displaySku || i.id, i.name, i.q, i.price]);
        r.works = (app.currentWorksList || []).map(w => [w.name, w.q, w.price]);
    } catch (e) {
        errors++;
        r.error = String(e && e.stack || e).split('\n').slice(0, 4).join(' | ');
    }
    out[name] = r;
}

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
for (const r of Object.values(out)) {
    console.log(r.error ? `ОШИБКА ${r.name} → ${r.error}`
        : `ok  ${r.name}: теплопотери ${r.heat} кВт, оборудование ${r.eq.length} строк ${r.eqSum.toLocaleString('ru-RU')} ₽, работы ${r.works.length} строк ${r.worksSum.toLocaleString('ru-RU')} ₽`);
}
if (arg('--save')) fs.writeFileSync(arg('--save'), JSON.stringify(out, null, 1));
if (arg('--compare')) {
    const old = JSON.parse(fs.readFileSync(arg('--compare'), 'utf8'));
    for (const [k, b] of Object.entries(out)) {
        const a = old[k];
        if (!a || a.error || b.error) continue;
        const j = x => x.join(' | ');
        const ea = a.eq.map(j), eb = b.eq.map(j), wa = a.works.map(j), wb = b.works.map(j);
        const lines = [
            ...ea.filter(x => !eb.includes(x)).map(x => '  − ' + x), ...eb.filter(x => !ea.includes(x)).map(x => '  + ' + x),
            ...wa.filter(x => !wb.includes(x)).map(x => '  работа − ' + x), ...wb.filter(x => !wa.includes(x)).map(x => '  работа + ' + x)
        ];
        if (!lines.length && a.heat === b.heat) continue;
        console.log(`\n=== ${k}: теплопотери ${a.heat} → ${b.heat}, оборудование ${a.eqSum} → ${b.eqSum} ₽, работы ${a.worksSum} → ${b.worksSum} ₽`);
        lines.forEach(l => console.log(l));
    }
}
process.exitCode = errors ? 1 : 0;
