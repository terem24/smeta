/**
 * Нормы расходников в НАШИХ сметах — для сверки с проектами (bench/spec_norms.js).
 * Считает типовые объекты, раскладывает оборудование по системам (раздел сметы) и
 * категориям (bench/norm_cats.js) и печатает расходники на 1 м трубы.
 *
 * Запуск (из корня worktree):
 *   node bench/norm_ours.js
 *   node bench/norm_ours.js --list вода     — какие позиции попали в систему «вода…»
 */
const app = require('./env.js');
const { systemOf, CATS, catOf, metersOf } = require('./norm_cats.js');

const DEF = JSON.parse(JSON.stringify(app.state));
const zone = (name, fx, dist) => ({ id: name, name, dist: dist || 8,
    fixtures: Object.assign({ toilet: 0, basin: 0, shower: 0, bath: 0, wash: 0, dish: 0, bidet: 0 }, fx) });
// Набор: полный дом с водой и канализацией, радиаторный, тёплый пол, подробный; ничего, чего нет в стенде render.js.
const SCEN = {
    'полный дом 150 м² (радиаторы+ТП+вода+канализация)': { area: 150, floors: 2, res: 4, win: 12, fuels: ['gas'], systems: ['rad', 'tp'], tp1: 40, hotWater: true, water: true, well: true, wellDepth: 50, wellDist: 30, waterInput: true,
        waterZones: [zone('Санузел 1', { toilet: 1, basin: 1, bath: 1, wash: 1 }), zone('Санузел 2', { toilet: 1, basin: 1, shower: 1 }), zone('Кухня', { dish: 1, basin: 1 })] },
    'радиаторы 150 м² одноэтажный': { area: 150, floors: 1, res: 4, win: 10, fuels: ['gas'], systems: ['rad'], hotWater: true },
    'ТП 100 м²': { area: 100, floors: 1, res: 3, win: 8, fuels: ['gas'], systems: ['tp'], tp1: 90 },
    'ROMMER 180 м², вода, канализация': { area: 180, floors: 2, res: 5, win: 12, fuels: ['gas'], systems: ['rad'], brandMode: 'rommer', sewerType: 'comfort', hotWater: true, water: true, recirc: true,
        waterZones: [zone('С/у1', { toilet: 1, basin: 2, bath: 1 }), zone('С/у2', { toilet: 1, basin: 1, shower: 1 })] },
    'подробный 140 м², радиаторы+ТП': { area: 140, floors: 1, res: 4, win: 10, fuels: ['gas'], systems: ['rad', 'tp'], tp1: 40, hotWater: true, detailedRooms: true, __gen: true },
};
const LIST = process.argv.includes('--list') ? process.argv[process.argv.indexOf('--list') + 1] : null;
const f2 = v => (Math.round(v * 100) / 100).toFixed(2);
const all = {};
for (const [name, patch] of Object.entries(SCEN)) {
    app.state = Object.assign(JSON.parse(JSON.stringify(DEF)), JSON.parse(JSON.stringify(patch)), { tgUser: { id: 1, account_type: 'pro' }, accountType: 'pro' });
    if (patch.__gen) app.generateRoomsForDetailedCalculation();
    app.autoCalcZones();
    app.render(true);
    const bySys = {};
    for (const i of (app.currentEquipmentList || [])) {
        const sys = systemOf(i.sectionTitle); if (!sys) continue;
        const cat = catOf({ name: i.name }); if (!cat) continue;
        if (LIST && sys.includes(LIST)) console.log(`  [${sys}/${cat}] ${i.q} × ${String(i.name).slice(0, 80)}`);
        const o = (bySys[sys] = bySys[sys] || {});
        o[cat] = (o[cat] || 0) + ((cat === 'труба' || cat === 'изоляция, м') ? metersOf(i.name, i.q, i.desc, i.unit) : i.q);
    }
    all[name] = bySys;
}
for (const [name, bySys] of Object.entries(all)) {
    console.log(`\n### ${name}`);
    for (const [sys, o] of Object.entries(bySys)) {
        const pipe = o['труба'] || 0;
        if (pipe < 20) continue;
        console.log(`  ${sys.padEnd(14)} труба ${String(Math.round(pipe)).padStart(4)} м | ` + CATS.slice(1).map(([c]) => (o[c] ? `${c.split(',')[0]} ${f2(o[c] / pipe)}` : null)).filter(Boolean).join(' | '));
    }
}
