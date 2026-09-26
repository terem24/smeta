/**
 * Таблица цен для страницы заказчика /dom/: «Эконом / Оптимум / Комфорт» вилкой.
 *
 * Зачем. Страница заказчика лёгкая и app.js не грузит, а цифры на ней обязаны
 * сходиться со сметой, которую монтажник откроет по заявке. Поэтому цены не
 * придумываются формулой «₽ за м²», а считаются настоящим render() по сетке
 * типовых домов — здесь, заранее. Страница берёт ближайшую точку сетки.
 *
 * Вилка «от–до» — это то, чего заказчик на этом шаге не знает: сколько окон и
 * комнат и насколько утеплены стены. Утепление на смету почти не влияет (котёл и
 * так из нижнего ряда), а окна и комнаты — сильно: это число радиаторов, выходов
 * коллектора и метров трубы. Нижняя граница — компактный дом (окно на 15 м²,
 * газобетон 400 + минвата 100), верхняя — дом с большим остеклением (окно на
 * 9 м², комнатой больше, газобетон 300 без утепления).
 * Регион — Санкт-Петербург: с него стартуем.
 *
 * Запуск из корня репозитория (раз в месяц, после обновления цен):
 *   node bench/dom_prices.js            — пишет dom/prices.json
 *   node bench/dom_prices.js --probe    — один дом, проверка скорости и состава
 */
const fs = require('fs');
const path = require('path');
const app = require('./env.js');

const DEF = JSON.parse(JSON.stringify(app.state));
const SPB = { name: 'Санкт-Петербург', temp: -24 };   // как в CITIES_DB (catalog.js), сам массив в песочнице не виден

// Комплектации — утверждены 26.09.2026. Что спросили в мастере (газ/электро,
// радиаторы/тёплый пол, горячая вода) задаёт «что»; комплектация — «какого класса».
const PACKS = {
    econom: (q) => ({
        brandMode: 'rommer',
        // горячая вода двухконтурным котлом, без бойлера (для газа)
        hotWater: q.fuel === 'el' ? q.hw : false,
        fuels: [q.fuel],
        boilerAuto: false, ufhAuto: false,
        boilerScheme: 'direct',
        boilerPipeSystem: 'ppr',
        pipeType: 'split',
        radType: 'steel',
        tp1: q.tp ? q.tpFloor : 0
    }),
    optimum: (q) => ({
        brandMode: 'stout',
        hotWater: q.hw,
        fuels: [q.fuel],
        boilerAuto: true, boilerAutoLevel: 'auto', autoOn: true, ufhAuto: false,
        boilerScheme: 'hydro',
        boilerPipeSystem: 'ss304',
        pipeType: 'insulated',
        radType: 'space',
        tp1: q.tp ? q.tpFloor : 0
    }),
    comfort: (q) => ({
        brandMode: 'stout',
        hotWater: q.hw,
        // резервный электрокотёл к газовому — на дежурные +5 °C
        fuels: q.fuel === 'gas' ? ['gas', 'el'] : ['el'],
        boilerAuto: true, boilerAutoLevel: 'full', autoOn: true,
        ufhAuto: true, zoneAuto: Object.assign({}, DEF.zoneAuto || {}, { radMode: 'heads', link: 'wired', sys: 'auto' }),
        boilerScheme: 'hydro',
        boilerPipeSystem: 'ss316',
        pipeType: 'insulated',
        radType: 'space',
        // тёплый пол по всему первому этажу — всегда
        tp1: q.tpFloor,
        systems: q.rad ? ['rad', 'tp'] : ['tp']
    })
};

const AREAS = [60, 80, 100, 120, 150, 180, 210, 250, 300, 360];
const HOUSES = {
    lo: { winPer: 15, resAdd: 0, walls: [{ matId: 'gas_d500', thick: 400 }, { matId: 'minwool', thick: 100 }] },
    mid: { winPer: 12, resAdd: 0, walls: [{ matId: 'gas_d500', thick: 400 }, { matId: 'minwool', thick: 50 }] },
    hi: { winPer: 9, resAdd: 1, walls: [{ matId: 'gas_d500', thick: 300 }] }
};

function calc(q, pack, h) {
    const floorArea = q.area / q.floors;
    q.tpFloor = Math.round(floorArea * 0.7);   // жилая часть первого этажа без лестницы, котельной, шкафов
    const sys = [];
    if (q.rad) sys.push('rad');
    if (q.tp) sys.push('tp');
    const patch = Object.assign({
        objectType: 'house', area: q.area, floors: q.floors,
        res: Math.max(2, Math.min(7, Math.round(q.area / 40) + h.resAdd)),
        win: Math.max(4, Math.round(q.area / h.winPer)),
        systems: sys, wallLayersEnabled: true, showWallLayersPanel: true, wallLayers: h.walls,
        selectedCity: SPB, region: Math.round(((20 - SPB.temp) / 45) * 100),
        detailedRooms: true, boilerSeriesManual: false
    }, PACKS[pack](q));
    app.state = Object.assign(JSON.parse(JSON.stringify(DEF)), JSON.parse(JSON.stringify(patch)),
        { tgUser: { id: 1, account_type: 'pro' }, accountType: 'pro' });
    app.generateRoomsForDetailedCalculation();
    app.autoCalcZones();
    app.render(true);
    return {
        eq: Math.round(app.lastEqSum), works: Math.round(app.lastWorksSum),
        kw: app.getHouseHeatLoss(),
        list: (app.currentEquipmentList || []).map(i => [i.displaySku || i.id, i.name, i.q, i.price])
    };
}

const k1000 = (x) => Math.round(x / 1000) * 1000;

if (process.argv.includes('--probe')) {
    const q = { area: 150, floors: 2, fuel: 'gas', rad: true, tp: true, hw: true };
    for (const pack of Object.keys(PACKS)) {
        const t = Date.now();
        const r = calc(Object.assign({}, q), pack, HOUSES.mid);
        console.log(`\n=== ${pack}: ${r.kw} кВт, оборудование ${r.eq.toLocaleString('ru-RU')} ₽, монтаж ${r.works.toLocaleString('ru-RU')} ₽, ${Date.now() - t} мс`);
        r.list.forEach(l => console.log('   ' + l.join(' | ')));
    }
    process.exit(0);
}

// Ключ: площадь|этажи|топливо|системы|вода. Значение: по комплектациям
// [оборудование от, до, монтаж от, до] в рублях, округлено до тысячи.
const out = { city: SPB.name, built: new Date().toISOString().slice(0, 10), areas: AREAS, prices: {} };
let errors = 0, n = 0;
const t0 = Date.now();
for (const area of AREAS)
    for (const floors of [1, 2])
        for (const fuel of ['gas', 'el'])
            for (const sys of ['rad', 'tp', 'rad+tp'])
                for (const hw of [true, false]) {
                    const q = { area, floors, fuel, rad: sys !== 'tp', tp: sys !== 'rad', hw };
                    const key = [area, floors, fuel, sys, hw ? 1 : 0].join('|');
                    const row = {};
                    for (const pack of Object.keys(PACKS)) {
                        try {
                            const lo = calc(Object.assign({}, q), pack, HOUSES.lo);
                            const hi = calc(Object.assign({}, q), pack, HOUSES.hi);
                            row[pack] = [k1000(Math.min(lo.eq, hi.eq)), k1000(Math.max(lo.eq, hi.eq)),
                                k1000(Math.min(lo.works, hi.works)), k1000(Math.max(lo.works, hi.works))];
                        } catch (e) {
                            errors++;
                            console.log(`ОШИБКА ${key} ${pack}: ${String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')}`);
                        }
                    }
                    out.prices[key] = row;
                    n++;
                }
const dir = path.join(__dirname, '..', 'dom');
if (!fs.existsSync(dir)) fs.mkdirSync(dir);
fs.writeFileSync(path.join(dir, 'prices.json'), JSON.stringify(out));
console.log(`Готово: ${n} домов, ошибок ${errors}, ${Math.round((Date.now() - t0) / 1000)} с → dom/prices.json`);
process.exitCode = errors ? 1 : 0;
