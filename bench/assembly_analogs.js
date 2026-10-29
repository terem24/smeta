/**
 * Стенд стыковки для электрокотлов других марок (catalog.boilers_el_analogs) в сравнении со STOUT.
 *
 * Запуск (из корня репозитория):
 *   node bench/assembly_analogs.js            итог по каждому сценарию
 *   node bench/assembly_analogs.js detail     плюс кто дал каждый конец в непарных размерах
 *
 * Сценарии: каждый аналог на каждой мощности, с бойлером и без, STATUS-класс — только электро, POLIS-класс — вместе
 * с газовым котлом (так он ставится). Эталон — STOUT STATUS / POLIS на тех же объектах. Критерий: аналог не должен
 * давать расхождений по резьбе сверх тех, что даёт эталон на том же объекте, и подбор не должен терять котёл.
 */
const app = require('./env.js');
const ac = require('../assembly_check.js');
const mode = process.argv[2] || '';
const KIND = ac.KIND_RU;
const cat = app.__catalog;

// аналоги видны только на тарифе Профи; стенд работает «как Профи»
app.canUseBrand = () => true;

function setup(o) { app.state.brandMode = 'stout'; app.__setup(o); return app.currentEquipmentList; }
function summary(L) {
    const r = ac.check(L);
    return { r, problems: r.problems.map(p => p.text), sizes: r.problems.map(p => p.size).sort().join(',') };
}
const boilerOf = L => L.find(x => app.isElBoilerId(x.originalId || x.id));

let bad = 0, total = 0;
const rows = [];
function scenario(title, o, baseline, expectFallback) {
    const L = setup(o);
    const b = boilerOf(L);
    const s = summary(L);
    total++;
    const isAnalog = b && cat.boilers_el_analogs.some(x => x.id === (b.originalId || b.id));
    // аналог без проверенного клапана ГВС при бойлере в подбор не идёт: уход на STOUT здесь правильный
    const keptBrand = !o.elBoilerBrand || expectFallback || isAnalog;
    // хуже эталона: проблемы в размерах, которых у эталона нет, или их больше (лучше эталона — нормально)
    const baseSizes = baseline ? baseline.r.problems.map(p => p.size) : [];
    const worse = baseline && (s.problems.length > baseline.problems.length || s.r.problems.some(p => !baseSizes.includes(p.size)));
    const ok = keptBrand && !worse;
    if (!ok) bad++;
    rows.push({ title, ok, keptBrand, s, b });
    console.log((ok ? '  ✓ ' : '  ✗ ') + title + ' — ' + (b ? b.name : 'котла нет') +
        (s.problems.length ? '  [стык: ' + s.problems.length + ' расхожд., размеры ' + s.sizes + ']' : '  [резьба сходится]') +
        (keptBrand ? '' : '  !!! подбор ушёл на другой котёл'));
    if (mode === 'detail' && s.problems.length) {
        s.r.problems.forEach(p => {
            console.log('        ' + p.text);
            if (s.r.balance[p.size]) s.r.balance[p.size].who.forEach(w => console.log('           ' + String(w.n).padStart(2) + ' ' + KIND[w.kind].padEnd(14) + w.name));
        });
    }
    return s;
}

const POWER_AREA = { 3: 60, 4: 60, 4.5: 60, 5: 60, 6: 70, 7: 80, 7.5: 80, 9: 100, 12: 130, 14: 150, 15: 160, 18: 190, 21: 220, 24: 250, 28: 290 };
const status = cat.boilers_el_analogs.filter(x => x.tier === 'status');
const polis = cat.boilers_el_analogs.filter(x => x.tier === 'polis');

console.log('=== STATUS-класс: электро, без бойлера и с бойлером ===');
const baseStatus = {};
[false, true].forEach(hw => {
    const base = { area: 150, res: 3, fuels: ['el'], hotWater: hw };
    baseStatus[hw] = scenario('STOUT STATUS, бойлер ' + (hw ? 'есть' : 'нет'), { ...base });
    status.forEach(a => {
        // мощность подбираем руками, как в окне замены: тот же типоразмер
        scenario(a.brand + ' ' + a.name.replace('Котёл электрический ', '') + ', бойлер ' + (hw ? 'есть' : 'нет'),
            { ...base, elBoilerBrand: a.brand, elBoilerLine: a.series, boilerSeries: 'status', boilerSeriesManual: true, elBoilerPower: a.power }, baseStatus[hw],
            hw && !a.dhwKit && !a.noPump);
    });
});

console.log('\n=== POLIS-класс: газ + электро-резерв ===');
const basePolis = scenario('STOUT POLIS', { area: 150, res: 3, fuels: ['gas', 'el'], boilerSeries: 'polis', boilerSeriesManual: true, elBoilerPower: 6 });
polis.forEach(a => {
    scenario(a.brand + ' ' + a.name.replace('Котёл электрический ', ''),
        { area: 150, res: 3, fuels: ['gas', 'el'], elBoilerBrand: a.brand, elBoilerLine: a.series, boilerSeries: 'polis', boilerSeriesManual: true, elBoilerPower: a.power }, basePolis);
});

console.log('\nИТОГ: сценариев ' + total + ', хуже эталона или потеряли котёл: ' + bad);
process.exit(bad ? 1 : 0);
