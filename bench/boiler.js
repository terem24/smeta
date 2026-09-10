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
 *   node bench/boiler.js swap       таблица замены: открывается ли выбор системы
 *
 * Сравнить две версии кода: снять «до» из git и прогнать оба дерева —
 *   git show <ревизия>:app.js > /tmp/before/app.js   (туда же catalog.js)
 * Каталог обязан быть ОДИН И ТОТ ЖЕ: парсер цен переписывает его каждый день,
 * и на разных каталогах сравниваются не правки, а прайсы.
 *
 * Чего стенд НЕ видит: альтернативы Pro Aqua привязываются к позициям Wavin в
 * app.init() (linkPprAlts), а init() здесь не поднимается — он падает на DOM.
 * Поэтому в ППР сюда всегда попадают артикулы Wavin, независимо от
 * pprSystemBrand. На подбор диаметра это не влияет: boilerPipeRange берёт
 * размеры по бренду сам. А вот цены раздела 2 в ППР — всегда Wavin.
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
    const cur = (t[app.boilerPipeSystem()] || {}).total || 0;
    console.log('  система   труба+фитинги   весь раздел 2   разница');
    Object.entries(t).forEach(([k, v]) => {
        const d = v.total - cur;
        console.log('  ' + padR(k, 10) + pad(v.pipe, 8) + ' Р' + pad(v.total, 14) + ' Р   ' +
            (d === 0 ? '(текущая)' : (d > 0 ? '+' : '') + d + ' Р'));
    });
    console.log('\n  Оборудование (котёл, бойлер, насосы, гидрострелка) во всех системах');
    console.log('  одно и то же — в разнице оно сокращается, в итоге раздела топит её.');
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

/**
 * Таблица замены: каждая ли строка обвязки открывает ВЫБОР СИСТЕМЫ.
 *
 * Класс ошибки, повторившийся трижды. Строка обвязки опознаётся по артикулу, и
 * стоит признаку разойтись с соседней веткой модалки — строка проваливается в
 * чужой список: то в брендовый переключатель «Pro Aqua / Wavin», то вовсе никуда.
 * На экране это выглядит как «замена не работает», и глазами по одной смете не
 * ловится: ломается ровно один артикул из дюжины.
 *
 * Проверяем не признак, а РЕЗУЛЬТАТ — что именно модалка положила на страницу.
 */
function swap() {
    console.log('\n=== ТАБЛИЦА ЗАМЕНЫ: строки раздела 2, открывающие выбор системы ===');

    // Что считать «строкой обвязки» — определяем НЕЗАВИСИМО от кода приложения:
    // по принадлежности артикула каталожным массивам системы. Повторить здесь
    // app.isBoilerPipeRow значило бы проверять признак сам собой.
    const ids = (names) => {
        const out = {};
        names.forEach(n => (app.__catalog[n] || []).forEach(x => {
            if (x && x.id) out[x.id] = 1;
            (x && x.alts || []).forEach(a => { if (a && a.id) out[a.id] = 1; });
            // Номенклатура ROMMER лежит полем .rommer внутри позиции STOUT.
            if (x && x.rommer && x.rommer.id) out[x.rommer.id] = 1;
        }));
        return out;
    };
    const FAM = {
        ss304: ids(Object.keys(app.__catalog).filter(k => k.indexOf('ss_') === 0)),
        ss316: ids(Object.keys(app.__catalog).filter(k => k.indexOf('ss_') === 0)),
        ppr: ids(Object.keys(app.__catalog).filter(k => k.indexOf('ppr_') === 0)),
        mp: ids(['water_fittings_press_mp', 'metal_plastic_pipes']),
        stable: ids(['axial_fittings_pex', 'stable_pipes']),
        stable_r: ids(['axial_fittings_pex', 'stable_pipes'])
    };

    ['ss304', 'ss316', 'ppr', 'mp', 'stable', 'stable_r'].forEach(sys => {
        ['proaqua', 'wavin'].forEach(brand => {
            if (sys !== 'ppr' && brand === 'wavin') return;   // бренд ППР на другие не влияет
            app.state.pprSystemBrand = brand;
            app._boilerRangeCache = null;
            app.__setup({ area: 200, res: 5, region: 100, boilerPipeSystem: sys });
            const body = app.__doc.getElementById('swap_modal_body');
            let ok = 0;
            const bad = [];
            (app.currentEquipmentList || [])
                .filter(x => String(x.group || '').indexOf('2.') === 0)
                .forEach(x => {
                    const id = String(x.originalId || x.id);
                    // Синтетические id трубы (boiler_pipe_*) в каталоге не лежат —
                    // добавляем их к семейству по приставке.
                    const own = FAM[sys][id] || id.indexOf('boiler_pipe_') === 0;
                    if (!own) return;
                    body.innerHTML = '';
                    app._lastSwapLookupId = null;
                    let html = '';
                    try { app.openSwapModal(id); html = String(body.innerHTML || ''); } catch (e) { html = ''; }
                    if (/Нержавеющая сталь AISI 304/.test(html)) ok++;
                    else bad.push(id);
                });
            console.log('  ' + padR(sys + (sys === 'ppr' ? ' / ' + brand : ''), 18) +
                'своих строк: ' + pad(ok + bad.length, 2) + ', открывают выбор: ' + pad(ok, 2) +
                (bad.length ? ('   ОШИБКА, выбор не открывается: ' + bad.join(', ')) : ''));
        });
    });
    app.state.pprSystemBrand = 'proaqua';
    console.log('\n  «Своих строк» — позиции раздела 2, чьи артикулы лежат в каталожных');
    console.log('  массивах этой системы. Каждая обязана открывать выбор из шести систем.');
}

const what = (process.argv[2] || 'all').toLowerCase();
const parts = { sizes, bill, systems, pumps, swap };
if (parts[what]) parts[what]();
else if (what === 'all') Object.values(parts).forEach(f => f());
else {
    console.log('Неизвестный раздел: ' + what);
    console.log('Доступны: ' + Object.keys(parts).join(', ') + ' — или без аргумента, тогда всё сразу.');
    process.exit(1);
}
