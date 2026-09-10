/**
 * Стенд котельной: во что превращается объект после правки подбора обвязки.
 *
 * Зачем. Диаметр обвязки, фитинги, изоляция и хомуты завязаны друг на друга:
 * поменял ряд типоразмеров — поехали резьбы переходников; поменял правило
 * каскада — поехал тройник врезки. Разглядеть это в смете нельзя, тем более
 * что одинаковые артикулы из разных узлов СКЛЕИВАЮТСЯ в одну строку и
 * показываются под первой попавшейся группой. Здесь всё сведено в числа.
 *
 * Запуск (из корня репозитория):
 *   node bench/boiler.js            всё сразу
 *   node bench/boiler.js sizes      ряды типоразмеров и подбор по скорости
 *   node bench/boiler.js bill       состав и суммы по реальным объектам
 *   node bench/boiler.js systems    цена четырёх систем обвязки
 *   node bench/boiler.js pumps      напор встроенных насосов котлов
 *
 * Сравнить две версии кода: снять «до» из git и прогнать оба дерева —
 *   git show <ревизия>:app.js > /tmp/before/app.js   (туда же catalog.js)
 * Каталог обязан быть ОДИН И ТОТ ЖЕ: парсер цен переписывает его каждый день,
 * и на разных каталогах сравниваются не правки, а прайсы.
 */
const app = require('./env.js');

const MAX_AREA = app.MAX_AREA || 360;

// Объекты в границах продукта. Регион 100 — расчётные −25 °C, 130 — −35 °C.
const OBJECTS = [
    { area: 60, res: 2 }, { area: 100, res: 3 }, { area: 150, res: 4 },
    { area: 200, res: 5 }, { area: 250, res: 6 }, { area: 300, res: 6 },
    { area: MAX_AREA, res: 7 }
];

const pad = (v, n) => String(v).padStart(n);
const padR = (v, n) => String(v).padEnd(n);

function sizes() {
    console.log('\n=== РЯДЫ ТИПОРАЗМЕРОВ: наружный (внутренний), мм ===');
    const line = (sys, title) =>
        '  ' + padR(title, 22) + app.boilerPipeRange(sys).map(r => r.size + ' (' + r.inner + ')').join('   ');
    console.log(line('ss304', 'Нержавейка 304/316L'));
    console.log(line('mp', 'Металлопластик'));
    console.log(line('stable', 'Стабильная PE-Xa'));
    console.log(line('ppr', 'ППР Pro Aqua'));
    app.state.pprSystemBrand = 'wavin'; app._boilerRangeCache = null;
    console.log(line('ppr', 'ППР Wavin'));
    app.state.pprSystemBrand = 'proaqua'; app._boilerRangeCache = null;

    [20, 10].forEach(dt => {
        console.log('\n=== ПОДБОР ПО СКОРОСТИ, Δt = ' + dt + ' °C (предел ' + app.BOILER_V_MAX + ' м/с) ===');
        console.log('   кВт | нержавейка    | металлопластик | стабильная    | ППР Pro Aqua');
        [10, 15, 20, 25, 30, 35, 40, 50, 60, 80].forEach(kw => {
            const f = (s) => {
                const r = app.boilerPickSize(s, kw, dt);
                return (r.capped ? '!' : ' ') + pad(r.size, 3) + ' v=' + r.v.toFixed(2);
            };
            console.log('  ' + pad(kw, 4) + ' |' + padR(f('ss304'), 15) + '|' + padR(f('mp'), 16) +
                '|' + padR(f('stable'), 15) + '|' + f('ppr'));
        });
    });
    console.log('\n  «!» — ряд системы закончился, скорость выше предела');
}

function bill() {
    console.log('\n=== ОБЪЕКТЫ В ГРАНИЦАХ ПРОДУКТА (до ' + MAX_AREA + ' м²) ===');
    console.log('   м²  регион | теплопотери | котлов | труба        | раздел 2');
    OBJECTS.forEach(o => [100, 130].forEach(region => {
        app.__setup({ area: o.area, res: o.res, region: region });
        const list = app.currentEquipmentList || [];
        const pipes = [...new Set(list
            .filter(x => /^RSS-1001-/.test(String(x.originalId || '')))
            .map(x => (String(x.name).match(/(\d{2})х/) || [])[1])
            .filter(Boolean))].sort((a, b) => a - b).join(', ');
        const boilers = list
            .filter(x => /Дымоход коаксиальный/.test(String(x.name || '')))
            .reduce((a, x) => a + (x.q || 1), 0) || 1;
        console.log('  ' + pad(o.area, 4) + '  ' + pad(region === 130 ? '-35' : '-25', 6) +
            ' | ' + pad((Math.round(app.getHouseHeatLoss() * 10) / 10) + ' кВт', 10) +
            '  |  ' + pad(boilers, 2) + '    | ' + padR(pipes, 12) + ' | ' + pad(app.__sum('2.'), 8));
    }));
}

function systems() {
    console.log('\n=== ЦЕНА РАЗДЕЛА 2 В КАЖДОЙ СИСТЕМЕ ОБВЯЗКИ (объект 200 м²) ===');
    app.__setup({ area: 200, res: 5 });
    const t = app.boilerSystemTotals();
    const cur = t[app.boilerPipeSystem()] || 0;
    Object.entries(t).forEach(([k, v]) => {
        const d = v - cur;
        console.log('  ' + padR(k, 8) + pad(v, 8) + ' Р   ' +
            (d === 0 ? '(текущая)' : (d > 0 ? '+' : '') + d + ' Р'));
    });
}

function pumps() {
    console.log('\n=== НАПОР ВСТРОЕННЫХ НАСОСОВ, м вод. ст. ===');
    console.log('  ' + padR('насос', 20) + padR('тип', 10) + [0.5, 1.0, 1.5, 2.0, 2.5].map(q => pad(q, 6)).join(''));
    app.BOILER_PUMPS.forEach(p => {
        console.log('  ' + padR(p.id, 20) + padR(p.kind, 10) +
            [0.5, 1.0, 1.5, 2.0, 2.5].map(q => pad((app.boilerPumpHead(p, q) || 0).toFixed(2), 6)).join(''));
    });
    console.log('\n  «unknown» — в паспорте не сказано, вычтено ли сопротивление котла.');
    console.log('  Проверка привязки к котлам каталога:');
    const c = app.__catalog;
    [].concat(c.boilers_gas || [], (c.boilers_status || []).slice(0, 1), (c.boilers_polis || []).slice(0, 1),
        (c.boilers_baxi || []).filter(b => /ECO Nova 24|Duo-tec E 1\.28|Duo-tec E 24/.test(b.name)).slice(0, 3))
        .forEach(b => {
            const p = app.boilerPumpOf(b);
            console.log('    ' + padR(String(b.name || '').slice(0, 40), 42) + '-> ' +
                (p ? p.id : (b.noPump ? 'насоса нет (ГБМ)' : 'кривой нет')));
        });
}

const what = (process.argv[2] || 'all').toLowerCase();
const parts = { sizes, bill, systems, pumps };
if (parts[what]) parts[what]();
else if (what === 'all') Object.values(parts).forEach(f => f());
else {
    console.log('Неизвестный раздел: ' + what);
    console.log('Доступны: ' + Object.keys(parts).join(', ') + ' — или без аргумента, тогда всё сразу.');
    process.exit(1);
}
