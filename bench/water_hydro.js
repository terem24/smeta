/**
 * Стенд проверки гидравлики водоснабжения — см. шапку water_hydro.js.
 *
 * Запуск (из корня репозитория):
 *   node bench/water_hydro.js            типовые объекты: по каждому — путь воды и вердикты, затем проверки
 *   node bench/water_hydro.js sweep      сетка объектов (глубина × трасса × санузлы × этажи × труба × автоматика)
 *   node bench/water_hydro.js json       то же по типовым объектам в JSON (для сравнения до/после правки)
 *
 * Стенд меряет ЧИСЛА, а не вёрстку. Что он проверяет:
 *   1. физику модуля: трение по ручному расчёту, Kv, интерполяцию кривой насоса;
 *   2. согласие с подбором насоса в смете: потери в трубе скважины — те же, что у app.wellLineLoss;
 *   3. баланс напора: напор насоса минус сумма ступеней = напор у прибора, ни метра не теряется и не берётся из воздуха;
 *   4. монотонность: больше расход — меньше напор у прибора; длиннее линия — меньше напор;
 *   5. что проверка ничего не меняет: состояние и смета до и после вызова одинаковы;
 *   6. что подбор насоса в смете не оставляет прибор без давления (отчёт по сетке — «расхождения подбора»).
 */
const app = require('./env.js');
const wh = app.__ctx.waterHydro;
if (!wh) throw new Error('water_hydro.js не загрузился в песочницу');

const mode = process.argv[2] || '';
let bad = 0;
const fail = (msg) => { bad++; console.log('  ✗ ' + msg); };
const f1 = v => (v == null ? '—' : v.toFixed(1));
const f2 = v => (v == null ? '—' : v.toFixed(2));
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

const Z = (name, dist, f) => ({
    id: name, name, dist,
    fixtures: Object.assign({ toilet: 0, basin: 0, bath: 0, shower: 0, wash: 0, dish: 0, bidet: 0 }, f)
});
// Типовой набор: кухня + N санузлов (как в быстром режиме дома)
const house = (baths, d1 = 6) => {
    const z = [Z('Кухня', d1, { basin: 1, dish: 1 })];
    for (let i = 0; i < baths; i++) z.push(i === 0
        ? Z('Санузел 1', d1, { toilet: 1, basin: 1, bath: 1, wash: 1 })
        : Z('Санузел ' + (i + 1), 8 + (i - 1) * 2, { toilet: 1, basin: 1, shower: 1 }));
    return z;
};
const base = { area: 200, fuels: ['gas'], systems: ['rad'], water: true, well: true, detailedRooms: true, waterInput: true };

const OBJECTS = [
    { title: 'Дом 200 м², скважина 30 м, трасса 15 м, 2 санузла', o: { ...base, wellDepth: 30, wellDist: 15, waterZones: house(2) } },
    { title: 'Глубокая скважина 90 м, трасса 40 м, 3 санузла, SIRIO', o: { ...base, wellDepth: 90, wellDist: 40, waterZones: house(3) } },
    { title: 'Та же, автоматика по протоку (BRIO), без редуктора', o: { ...base, wellDepth: 90, wellDist: 40, waterZones: house(3), wellAutoType: 'base' } },
    { title: 'Та же, по протоку, редуктор в узле', o: { ...base, wellDepth: 90, wellDist: 40, waterZones: house(3), wellAutoType: 'base', waterReducer: true } },
    { title: '2 этажа, 4 санузла, трасса 100 м', o: { ...base, floors: 2, wellDepth: 50, wellDist: 100, waterZones: house(4) } },
    { title: 'Металлопластик 16×2,0, 2 этажа, 5 санузлов, трасса 60 м', o: { ...base, floors: 2, waterPipeMaterial: 'metal_plastic', wellDepth: 60, wellDist: 60, waterZones: house(5) } },
    { title: 'Длинные линии 25 м до санузла', o: { ...base, wellDepth: 40, wellDist: 20, waterZones: [Z('Кухня', 25, { basin: 1, dish: 1 }), Z('Санузел 1', 25, { toilet: 1, basin: 1, shower: 1, wash: 1 })] } },
    { title: 'Без узла ввода (вода сразу на коллектор)', o: { ...base, waterInput: false, wellDepth: 30, wellDist: 15, waterZones: house(2) } },
    { title: 'Колба тонкой очистки Big Blue в узле, по протоку, редуктор', o: { ...base, wellDepth: 60, wellDist: 30, waterZones: house(3), wellAutoType: 'base', waterReducer: true, bigBlueFilter: true, waterFilterLevel: 'basic' } },
    { title: 'Городская вода 3 бар, дом, 2 санузла', o: { ...base, well: false, mainsBar: 3, waterZones: house(2) } },
    { title: 'Городская вода 1,2 бар, 3 санузла (слабая сеть)', o: { ...base, well: false, mainsBar: 1.2, waterZones: house(3) } },
    { title: 'Городская вода 6,5 бар без редуктора', o: { ...base, well: false, mainsBar: 6.5, waterZones: house(2) } },
    { title: 'Городская вода 6,5 бар с редуктором', o: { ...base, well: false, mainsBar: 6.5, waterReducer: true, waterZones: house(2) } },
    { title: 'Городская вода, сеть не задана (проверки нет)', o: { ...base, well: false, mainsBar: 0, waterZones: house(2) } },
    { title: '2 этажа: санузел 1 на первом, санузел 2 наверху', o: { ...base, floors: 2, well: false, mainsBar: 1.6, waterZones: (() => { const z = house(2); z[1].level = 1; z[2].level = 2; return z; })() } },
    { title: 'Насос заменён вручную на самый слабый 2-44 при глубине 60 м', o: { ...base, wellDepth: 60, wellDist: 30, waterZones: house(2), swaps: { well_pump_auto: 'RPW-0012-350215' } } }
];

const jsonOut = [];
const stagesText = (r) => r.scenarios.design.trunk.stages;

function run(title, o) {
    app.state.brandMode = 'stout';
    app.__setup(o);
    const r = app.waterHydroCheck();
    return { title, o, r };
}

function checks(title, o, r) {
    if (!r) { if (o.well === false && !(o.mainsBar > 0)) return; fail(title + ': проверка не вернула результат'); return; }
    const d = r.scenarios.design;
    // 3. баланс напора по общей части
    const st = d.trunk.stages;
    const sumLoss = st.slice(1).reduce((a, s) => a + s.dH, 0);
    if (!near(st[0].H - sumLoss, d.trunk.Hcoll, 1e-9)) fail(title + ': баланс общей части не сходится: ' + f2(st[0].H - sumLoss) + ' ≠ ' + f2(d.trunk.Hcoll));
    r.fixtures.forEach(f => {
        const s = f.parts.reduce((a, p) => a + p.dH, 0);
        if (!near(d.trunk.Hcoll - s, f.have, 1e-9)) fail(title + ': баланс линии «' + f.zone + ' / ' + f.title + '» не сходится');
        if (f.k != null && f.have / f.need !== f.k) fail(title + ': k у «' + f.title + '» не равен have/need');
        const want = wh.verdictOf(f.need, f.have, r.reserve);
        if (want !== f.verdict) fail(title + ': вердикт «' + f.title + '» не по запасу');
    });
    // 4. пик не лучше расчёта
    if (r.scenarios.peak) {
        const idx = {}; d.rows.forEach(x => { idx[x.zone + '|' + x.type + '|' + x.line] = x; });
        r.scenarios.peak.rows.forEach(x => {
            const a = idx[x.zone + '|' + x.type + '|' + x.line];
            if (a && x.have > a.have + 1e-9) fail(title + ': на пике напор у «' + x.title + '» выше, чем на расчётном расходе');
        });
    }
}

// ---------------------------------------------------------------------------
// 1–2. Физика модуля
// ---------------------------------------------------------------------------
console.log('=== Физика модуля ===');
{
    // Ручной расчёт: 32×3 (d=26 мм), 100 м, 2 м³/ч. v=1,047 м/с, Re=20 944, λ=0,3164/Re^0,25=0,0263, hf=5,65 м
    const p = wh.pipeLoss(2, 0.026, 100, 1.3e-6);
    if (!near(p.hf, 5.65, 0.02)) fail('трение 32×3, 100 м, 2 м³/ч: ' + f2(p.hf) + ' м, ручной расчёт 5,65 м');
    if (!near(p.v, 1.047, 0.01)) fail('скорость 32×3 при 2 м³/ч: ' + f2(p.v) + ', ручной расчёт 1,047');
    if (!near(wh.kvLoss(4, 4), 10, 1e-9)) fail('Kv: при Q = Kv потеря должна быть 10 м');
    if (wh.kvLoss(0, 4) !== 0) fail('Kv: нулевой расход — нулевая потеря');
    // Кривая насоса: узлы точные, середина линейна, правее последней точки — 0
    const cv = [[0, 100], [2, 80], [4, 40]];
    if (wh.headAt(cv, 0) !== 100 || wh.headAt(cv, 2) !== 80 || wh.headAt(cv, 3) !== 60 || wh.headAt(cv, 4.5) !== 0)
        fail('интерполяция кривой насоса неверна');
    // Согласие с подбором насоса в смете: тот же Блазиус (Re < 1e5) — расхождение до 1 %
    [[1.5, 30, 15], [2.4, 60, 40], [3.7, 90, 115]].forEach(([q, depth, dist]) => {
        const a = app.wellLineLoss(q, depth, dist);
        const b = wh.pipeLoss(q, a.dIn, a.len, 1.3e-6);
        if (!near(a.hf, b.hf, 0.01)) fail('wellLineLoss(' + q + ', ' + depth + ', ' + dist + ') = ' + f2(a.hf) + ' м, модуль даёт ' + f2(b.hf) + ' м');
    });
    // Ламинарный режим: Re < 2300 — λ = 64/Re
    const lam = wh.pipeLoss(0.02, 0.0116, 10, 1.3e-6);
    if (!(lam.Re < 2300 && near(lam.lam, 64 / lam.Re, 1e-9))) fail('ламинарный режим считается не по 64/Re');
    // Размеры узла: Kv растёт как сечение, расширение/сужение между узлом и коллектором — по ручному расчёту
    if (!near(wh.kvAt(5, 0.025), 7.8125, 1e-9)) fail('kvAt: счётчик 1" должен иметь Kv 7,81, а не ' + wh.kvAt(5, 0.025));
    if (!near(wh.kvAt(5, 0.02), 5, 1e-9)) fail('kvAt: 3/4" — это базовый Kv');
    // 3/4" → 1" при 2 м³/ч: β = 0,64, k = (1−β)² = 0,1296, v = 1,768 м/с, потеря 0,0206 м
    if (!near(wh.stepLoss(2, 0.02, 0.025), 0.0206, 0.02)) fail('расширение 3/4" → 1": ' + wh.stepLoss(2, 0.02, 0.025).toFixed(4) + ' м, ручной расчёт 0,0206');
    // сужение — вдвое мягче по коэффициенту: 0,5·(1−β) = 0,18 на скорости в малом сечении
    if (!near(wh.stepLoss(2, 0.025, 0.02), 0.18 * Math.pow(1.768, 2) / 19.62, 0.02)) fail('сужение 1" → 3/4" посчитано неверно');
    if (wh.stepLoss(2, 0.02, 0.02) !== 0) fail('одинаковые сечения — потери нет');
    // Разбор размера по названию позиции
    [['Кран шаровой ВН-НР 3/4"', 0.02], ['Фильтр 1 1/4"', 0.032], ['Кран 1/2"', 0.015], ['Счётчик воды ВСКМ-15, 110 мм', 0.015], ['Узел DN25', 0.025], ['Труба 16x2.0', null]]
        .forEach(([n, want]) => { if (app.inchBore(n) !== want) fail('inchBore("' + n + '") = ' + app.inchBore(n) + ', ждали ' + want); });
    console.log('  трение, Kv, кривая насоса, размеры узла, согласие с wellLineLoss — проверено');
}

// ---------------------------------------------------------------------------
// Вероятностный расход (peakFlow)
// ---------------------------------------------------------------------------
console.log('\n=== Вероятностный расход ===');
{
    const hot0 = {};
    // 1. Один прибор: расчётный расход — его полный расход (занят с вероятностью p < 1 − conf?) — проверяем границы
    const one = wh.peakFlow({ shower: 1 }, 3, { shower: 1 });
    if (!(one.design > 0 && one.design <= wh.FIXTURES.shower.q + 1e-9)) fail('один душ: расчётный расход ' + one.design + ' вне (0; q]');
    // 2. Не больше суммы всех приборов, не меньше расхода самого большого прибора, когда он вообще бывает занят
    const c = { toilet: 3, basin: 4, shower: 2, bath: 1, wash: 1, dish: 1 };
    const sum = wh.peakFlow(c, 4, {}).sum;
    // 3. Монотонность по жильцам и вероятностей: больше людей — не меньше расход
    let prev = 0;
    [1, 2, 3, 4, 6, 8, 10].forEach(n => {
        const r = wh.peakFlow(c, n, {});
        if (r.design > sum + 1e-9) fail('расчётный расход ' + r.design + ' больше суммы приборов ' + sum);
        if (r.design + 1e-9 < prev) fail('жильцов ' + n + ': расчётный расход упал (' + r.design.toFixed(2) + ' < ' + prev.toFixed(2) + ')');
        prev = r.design;
    });
    // 4. Больше приборов — не меньше расход
    const more = wh.peakFlow({ ...c, shower: 4, basin: 6 }, 4, {});
    if (more.design + 1e-9 < wh.peakFlow(c, 4, {}).design) fail('приборов стало больше, а расход меньше');
    // 5. Монте-Карло: распределение суммарного расхода против прямой симуляции (сид фиксирован)
    let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const counts = { toilet: 2, basin: 3, shower: 2, wash: 1 }, N = 4;
    const r = wh.peakFlow(counts, N, hot0);
    const prof = wh.PEAK.profiles[r.peakId];
    const items = [];
    Object.keys(counts).forEach(t => { const pr = prof[t]; const p = Math.min(wh.PEAK.pCap, (((pr.r || 0) * N + (pr.h || 0)) / 3600) / counts[t]); for (let i = 0; i < counts[t]; i++) items.push([wh.FIXTURES[t].q, p]); });
    const draws = []; for (let i = 0; i < 400000; i++) { let q = 0; for (const [w, p] of items) if (rnd() < p) q += w; draws.push(q); }
    draws.sort((a, b) => a - b);
    const mc = draws[Math.floor(draws.length * wh.PEAK.conf)];
    if (Math.abs(mc - r.design) > 0.06) fail('квантиль по свёртке ' + r.design.toFixed(2) + ' м³/ч, по Монте-Карло ' + mc.toFixed(2));
    else console.log('  свёртка против Монте-Карло: ' + r.design.toFixed(2) + ' и ' + mc.toFixed(2) + ' м³/ч (квантиль ' + wh.PEAK.conf + ')');
    // 6. Пик: вечером с ванной и стиркой не меньше утреннего без них — оба считаются, берётся больший
    const sc = wh.peakFlow({ toilet: 1, basin: 2, bath: 1, wash: 1, dish: 1 }, 4, {});
    if (sc.design !== Math.max.apply(null, sc.scenarios.map(x => x.Q))) fail('расчётный расход — не больший из двух пиков');
    // 7. Таблица для отчёта: расход по числу жильцов и санузлов
    console.log('  расчётный расход, м³/ч (сумма приборов → вероятностный):');
    [[1, 1], [2, 2], [3, 3], [5, 4]].forEach(([baths, N]) => {
        const f = { toilet: baths, basin: baths + 1, shower: Math.max(0, baths - 1), bath: 1, wash: 1, dish: 1 };
        const q = wh.peakFlow(f, N, {});
        console.log('    санузлов ' + baths + ', жильцов ' + N + ': ' + f2(q.sum) + ' → ' + f2(q.design) + ' (' + q.scenarios.map(x => x.title.split(' ')[0].toLowerCase() + ' ' + f2(x.Q)).join(', ') + ')');
    });
}

// ---------------------------------------------------------------------------
// Типовые объекты
// ---------------------------------------------------------------------------
OBJECTS.forEach(({ title, o }) => {
    const { r } = run(title, o);
    checks(title, o, r);
    jsonOut.push({ title, verdict: r && r.verdict, pump: r && r.pump.name, worst: r && r.worst && { zone: r.worst.zone, title: r.worst.title, have: r.worst.have, need: r.worst.need },
        static: r && r.static.bar, flags: r && r.flags.map(f => f.id) });
    if (mode === 'json') return;
    console.log('\n=== ' + title + ' ===');
    if (!r) { console.log('  (нет данных: скважина / давление в сети или санузлы не заданы)'); return; }
    console.log('  вердикт: ' + r.verdict + '   насос: ' + r.pump.name + ' — ' + f1(r.pump.head) + ' м на ' + f2(r.pump.Q) + ' м³/ч (при нуле ' + f1(r.pump.headMax) + ')');
    stagesText(r).forEach(s => console.log('    ' + s.title.padEnd(62) + ' −' + f2(s.dH).padStart(6) + '  → ' + f1(s.H).padStart(6) + ' м' + (s.v != null ? '   ' + f2(s.v) + ' м/с' : '')));
    const w = r.worst;
    if (w) console.log('  худший прибор: ' + w.zone + ' / ' + w.title + ' (' + (w.line === 'hot' ? 'ГВС' : 'ХВС') + '): ' + f1(w.have) + ' м при минимуме ' + f1(w.need) + ' м → ' + w.verdict);
    console.log('  при закрытых кранах: ' + f1(r.static.bar) + ' бар (' + r.static.verdict + (r.static.capped ? ', держит ' + r.static.capNote : '') + ')');
    r.flags.forEach(fl => console.log('  ! ' + fl.text));
    (r.advice || []).forEach(a => console.log('  → ' + a.text));
});

// ---------------------------------------------------------------------------
// 4–5. Монотонность и «ничего не меняет»
// ---------------------------------------------------------------------------
console.log('\n=== Монотонность и неизменность сметы ===');
{
    const o = { ...base, wellDepth: 60, wellDist: 30, waterZones: house(3) };
    run('mono', o);
    const data = app.buildWaterHydroData();
    // Автоматика по протоку: у автоматики по давлению напор на вводе обрезан уставкой, и длина трассы его не меняет
    data.control = 'flow';
    const ev = (patch) => wh.evaluate(Object.assign(JSON.parse(JSON.stringify(data)), patch), { noAdvice: true });
    const lowest = (r) => Math.min(...r.fixtures.map(f => f.have));
    const a = lowest(ev({}));
    // Длиннее трасса — меньше напор
    if (!(lowest(ev({ dist: 100 })) < a)) fail('длиннее трасса, а напор у приборов не упал');
    // Глубже — меньше напор
    if (!(lowest(ev({ depth: 120 })) < a)) fail('глубже установка, а напор у приборов не упал');
    // Тоньше труба линии — меньше напор
    const thin = JSON.parse(JSON.stringify(data)); thin.branch.dIn = 0.0096;
    if (!(lowest(wh.evaluate(thin, { noAdvice: true })) <= a)) fail('тоньше линия, а напор у приборов вырос');
    // Больший расход — меньше напор насоса
    const q1 = ev({ flows: { design: 1.5, peak: 1.5 } }), q2 = ev({ flows: { design: 3.0, peak: 3.0 } });
    if (!(q2.scenarios.design.trunk.Hcoll < q1.scenarios.design.trunk.Hcoll)) fail('расход вырос, а напор на коллекторе не упал');
    console.log('  длина, глубина, диаметр линии, расход — напор падает монотонно');

    // Проверка ничего не меняет: состояние и смета до и после
    const snap = () => JSON.stringify({ s: app.state, b: (app.currentEquipmentList || []).map(i => [i.id, i.q, i.price]) });
    const before = snap();
    app.waterHydroCheck(); app.waterHydroCheck();
    if (snap() !== before) fail('waterHydroCheck изменил состояние или смету');
    else console.log('  состояние и смета до/после проверки совпадают');
    // Карточка строится и не падает
    try { const h = app.waterHydroHtml(app.waterHydroCheck(), false); if (!/Проверка водоснабжения/.test(h)) fail('карточка пустая'); else console.log('  карточка строится (' + h.length + ' симв.)'); }
    catch (e) { fail('waterHydroHtml упал: ' + e.message); }
}

// ---------------------------------------------------------------------------
// Расход подбора насоса: авто (по потребителям) и вручную (только «По комнатам»)
// ---------------------------------------------------------------------------
console.log('\n=== Расход подбора: авто / вручную ===');
{
    app.syncUI = () => {}; app.saveState = () => {};
    const o = { ...base, wellDepth: 60, wellDist: 30, waterZones: house(2) };
    run('flow-auto', o);
    const auto = app._wellSel;
    if (auto.q !== app.waterPumpFlowAuto()) fail('авто: расход подбора ' + auto.q + ' ≠ waterPumpFlowAuto ' + app.waterPumpFlowAuto());
    if (app.waterFlowManual() !== 0) fail('авто: waterFlowManual должен быть 0');
    // Вручную в «По комнатам»: расход ровно как задан, нижняя граница не действует
    [0.5, 1.0, 3.5, 5].forEach(v => {
        run('flow-man', { ...o, waterFlowManualOn: true, waterFlowManual: v });
        if (app._wellSel.q !== v) fail('вручную ' + v + ': расход подбора ' + app._wellSel.q);
        const r = app.waterHydroCheck();
        if (r.pump.Q !== v) fail('вручную ' + v + ': проверка считает на ' + r.pump.Q);
        if (r.data.flowManual !== v) fail('вручную ' + v + ': flowManual в данных ' + r.data.flowManual);
        if (r.scenarios.design.trunk.Hcoll == null) fail('вручную ' + v + ': нет напора на коллекторе');
    });
    // Границы диапазона: 0,5…10
    run('flow-clamp-hi', { ...o, waterFlowManualOn: true, waterFlowManual: 99 });
    if (app._wellSel.q !== 5) fail('99 м³/ч должно обрезаться до 5, а стало ' + app._wellSel.q);
    run('flow-clamp-lo', { ...o, waterFlowManualOn: true, waterFlowManual: 0.1 });
    if (app._wellSel.q !== 0.5) fail('0,1 м³/ч должно подниматься до 0,5, а стало ' + app._wellSel.q);
    // Быстрый расчёт: ручное значение игнорируется
    run('flow-quick', { ...o, detailedRooms: false, waterFlowManualOn: true, waterFlowManual: 7 });
    if (app.waterFlowManual() !== 0) fail('быстрый расчёт: ручной расход должен игнорироваться');
    // Больше расход — не слабее насос (при той же глубине): подбор не должен убывать
    let prevHead = 0, prevPrice = 0, ok = true;
    [1, 2, 3, 4, 5].forEach(v => {
        run('flow-mono', { ...o, waterFlowManualOn: true, waterFlowManual: v });
        const pr = app._wellSel.pump.price || 0;
        if (v > 1 && pr < prevPrice - 1) ok = false;
        prevPrice = pr;
    });
    if (!ok) fail('рост ручного расхода уронил цену подобранного насоса');
    // Ручной расход меньше авто: в карточке есть предупреждение
    run('flow-warn', { ...o, waterFlowManualOn: true, waterFlowManual: 0.5 });
    const html = app.waterHydroHtml(app.waterHydroCheck(), false);
    if (!/задан вручную/.test(html)) fail('в карточке нет пометки «задан вручную»');
    if (!/меньше расчётного/.test(html)) fail('ручной расход меньше расчётного, а предупреждения нет');
    // горячая линия не больше общего расхода
    const dd = app.buildWaterHydroData();
    if (dd.flows.hot > dd.flows.design + 1e-9) fail('горячий расход ' + dd.flows.hot + ' больше общего ' + dd.flows.design);
    console.log('  авто ' + f2(auto.q) + ' м³/ч; вручную 0,5…5 — расход подбора и проверки совпадает с заданным; границы и быстрый расчёт — верно');
}

// ---------------------------------------------------------------------------
// Размеры узла ввода и коллекторов — по позициям сметы
// ---------------------------------------------------------------------------
console.log('\n=== Размеры узла по позициям сметы ===');
{
    run('sizes', { ...base, wellDepth: 60, wellDist: 30, waterZones: house(3) });
    const real = app.waterNodeSizes();
    // Как собрана смета сейчас: узел 3/4", коллекторы с входом 1" (water_manifolds_stout, inSize 1)
    if (real.dIn !== 0.02) fail('узел в смете 3/4", а проверка видит ' + real.dIn);
    if (real.collector.cold !== 0.025) fail('вход коллектора в смете 1", а проверка видит ' + real.collector.cold);
    console.log('  из сметы: узел ' + real.dIn * 1000 + ' мм, коллектор ' + real.collector.cold * 1000 + ' мм');
    // Подмена списка позиций: кран 1", счётчик ВСКМ-15, коллектор ГВС 3/4"
    const keep = app.currentEquipmentList;
    app.currentEquipmentList = [
        { sectionTitle: '6. Узел ввода ХВС', name: 'Кран шаровой ВН-НР 1"' },
        { sectionTitle: '6. Узел ввода ХВС', name: 'Счётчик воды ВСКМ-15, 110 мм' },
        { sectionTitle: '5.2. Внутреннее ГВС', group: '5.2. Внутреннее ГВС', id: 'SMB-6851-343402_water', name: 'Коллектор 3/4"х3/4"х2 вых.' }
    ];
    const fake = app.waterNodeSizes();
    app.currentEquipmentList = keep;
    if (fake.dIn !== 0.025) fail('кран 1" — а узел ' + fake.dIn);
    if (fake.sizes.meter !== 0.015) fail('ВСКМ-15 — а счётчик ' + fake.sizes.meter);
    if (fake.sizes.mesh !== 0.025) fail('фильтр без размера должен брать диаметр узла, а взял ' + fake.sizes.mesh);
    if (fake.collector.hot !== 0.02) fail('коллектор ГВС 3/4" — а вход ' + fake.collector.hot);
    if (fake.collector.cold !== 0.02) fail('холодного коллектора в списке нет — берём как ГВС, а взял ' + fake.collector.cold);
    console.log('  подмена: кран 1", ВСКМ-15, коллектор ГВС 3/4" — размеры прочитаны верно');
    // Узкий счётчик теряет больше широкого — на тех же расходах
    const data = app.buildWaterHydroData();
    const ev = (sz) => { const d = JSON.parse(JSON.stringify(data)); d.node.sizes = Object.assign({}, d.node.sizes, sz); return wh.evaluate(d, { noAdvice: true }); };
    const lo = (r) => r.scenarios.design.trunk.Hcoll;
    if (!(lo(ev({ meter: 0.015 })) < lo(ev({ meter: 0.02 })) && lo(ev({ meter: 0.02 })) < lo(ev({ meter: 0.025 })))) fail('счётчик уже — напор на коллекторе должен быть ниже');
    else console.log('  счётчик 1/2" → 3/4" → 1": напор на коллекторе ' + f1(lo(ev({ meter: 0.015 }))) + ' → ' + f1(lo(ev({ meter: 0.02 }))) + ' → ' + f1(lo(ev({ meter: 0.025 }))) + ' м');
}

// ---------------------------------------------------------------------------
// Кнопки «исправить»: совет применён — вердикт стал лучше и смета пересчиталась
// ---------------------------------------------------------------------------
console.log('\n=== Кнопки «исправить» ===');
{
    // syncUI пишет в профиль страницы, а в песочнице DOM-заглушка: нужен только пересчёт сметы
    app.syncUI = () => {}; app.saveState = () => {};
    // Слабый насос при глубине 60 м: совет «поставить насос» должен вылечить
    run('fix-pump', { ...base, wellDepth: 60, wellDist: 30, waterZones: house(2), swaps: { well_pump_auto: 'RPW-0012-350215' } });
    let r = app.waterHydroCheck();
    const act = (r.advice || []).flatMap(a => a.actions || []).find(a => a.fix === 'pump');
    if (!act) fail('для слабого насоса нет кнопки «поставить насос»');
    else {
        app.waterHydroFix(act.fix, act.arg);
        const r2 = app.waterHydroCheck();
        if (r2.verdict !== 'ok') fail('после замены насоса вердикт «' + r2.verdict + '», а не ok');
        else console.log('  замена насоса: ' + r.verdict + ' → ' + r2.verdict + ' (' + r2.pump.name.replace('Насос скважинный ', '') + ')');
    }
    // Давление при закрытых кранах: «автоматика SIRIO» и «редуктор» обе снимают красное
    ['auto', 'reducer'].forEach(kind => {
        run('fix-' + kind, { ...base, wellDepth: 90, wellDist: 40, waterZones: house(3), wellAutoType: 'base' });
        const a = app.waterHydroCheck();
        const btn = (a.advice || []).flatMap(x => x.actions || []).find(x => x.fix === kind);
        if (!btn) { fail('нет кнопки «' + kind + '» при давлении ' + a.static.bar.toFixed(1) + ' бар'); return; }
        app.waterHydroFix(btn.fix, btn.arg);
        const b = app.waterHydroCheck();
        if (b.static.verdict === 'fail') fail('после «' + kind + '» давление при закрытых кранах всё ещё выше 6 бар');
        else console.log('  ' + kind + ': ' + a.static.bar.toFixed(1) + ' → ' + b.static.bar.toFixed(1) + ' бар');
    });
}

// ---------------------------------------------------------------------------
// 6. Сетка: подбор насоса в смете против проверки
// ---------------------------------------------------------------------------
if (mode === 'sweep') {
    console.log('\n=== Сетка объектов ===');
    const depths = [10, 60, 100, 150], dists = [0, 100], bathsL = [1, 3, 5], floorsL = [1, 2], lineL = [6, 25];
    const mats = ['pex', 'metal_plastic'], autos = ['sirio', 'base'];
    const tot = { n: 0, ok: 0, tight: 0, fail: 0, nullRes: 0, byFix: 0, byStatic: 0, byPump: 0 };
    // Расхождения разбираем по тому, что сказала смета сама: если напора насосу не хватает по её
    // собственному расчёту (красная плашка раздела 7), проверка лишь подтверждает; настоящая находка —
    // когда смета молчит, а у прибора давления нет.
    const cls = { warned: [], silentFail: [], silentTight: [] };
    const cmp = { n: 0, changed: 0, dPrice: 0, up: 0, down: 0, qNew: 0, qOld: 0 };
    const t0 = Date.now();
    depths.forEach(depth => dists.forEach(dist => bathsL.forEach(baths => floorsL.forEach(floors => lineL.forEach(line => mats.forEach(mat => autos.forEach(auto => {
        const o = { ...base, floors, wellDepth: depth, wellDist: dist, waterPipeMaterial: mat, wellAutoType: auto, waterZones: house(baths, line) };
        const title = `глубина ${depth}, трасса ${dist}, санузлов ${baths}, линия ${line} м, этажей ${floors}, ${mat}, ${auto}`;
        let r, sel;
        try { app.state.brandMode = 'stout'; app.__setup(o); r = app.waterHydroCheck(); sel = app._wellSel; }
        catch (e) { fail(title + ': упало — ' + e.message); return; }
        tot.n++;
        if (!r) { tot.nullRes++; fail(title + ': нет результата'); return; }
        checks(title, o, r);
        // Тот же объект по прежнему способу (сумма со сглаживанием): как меняется насос и цена
        {
            const newPump = sel.pump, newQ = sel.q;
            app.state.waterFlowMethod = 'sum'; app.render();
            const oldSel = app._wellSel;
            cmp.n++;
            if (oldSel.pump.id !== newPump.id) { cmp.changed++; cmp.dPrice += (newPump.price || 0) - (oldSel.pump.price || 0); if (newPump.price > oldSel.pump.price) cmp.up++; if (newPump.price < oldSel.pump.price) cmp.down++; }
            cmp.qNew += newQ; cmp.qOld += oldSel.q;
            app.state.waterFlowMethod = 'prob'; app.render();
        }
        tot[r.verdict === 'unknown' ? 'ok' : r.verdict]++;
        if (r.counts.fail) tot.byFix++;
        if (r.static.verdict === 'fail') tot.byStatic++;
        if (r.pump.outOfRange) tot.byPump++;
        // Смета предупреждает о давлении при закрытых кранах (редуктор) — проверка обязана быть не мягче
        const flowCtl = !['sirio', 'top', 'relay_krs5', 'epc12auto', 'epc2'].includes(auto);
        const h0 = sel.pump.curve[0][1];
        if (flowCtl && !o.waterReducer && (h0 - depth - sel.floorsH) / 10 > 6 && r.static.verdict === 'ok') fail(title + ': смета требует редуктор (' + ((h0 - depth - sel.floorsH) / 10).toFixed(1) + ' бар), а проверка считает давление нормальным');
        const appWarns = wh.headAt(sel.pump.curve, sel.q) < sel.h || sel.q > sel.pump.q_max;
        const entry = { title, pump: r.pump.name, worst: r.worst, flags: r.flags.filter(f => f.level !== 'info').map(f => f.id).join(','), need: sel.h, head: wh.headAt(sel.pump.curve, sel.q) };
        const bad1 = r.counts.fail > 0 || r.pump.outOfRange;
        const bad2 = !bad1 && (r.counts.tight > 0);
        if (appWarns && (bad1 || bad2)) cls.warned.push(entry);
        else if (bad1) cls.silentFail.push(entry);
        else if (bad2) cls.silentTight.push(entry);
    })))))));
    console.log('  объектов: ' + tot.n + ' за ' + ((Date.now() - t0) / 1000).toFixed(1) + ' с;  ок ' + tot.ok + ', впритык ' + tot.tight + ', не хватает ' + tot.fail);
    console.log('  из красных: приборы без давления ' + tot.byFix + ', давление при закрытых кранах вне нормы (выше 6 бар или воды нет) ' + tot.byStatic + ', расход выше предела насоса ' + tot.byPump + ' (категории пересекаются)');
    console.log('  проверка красная/жёлтая, смета тоже предупреждает (напора насосу не хватает): ' + cls.warned.length);
    console.log('  проверка КРАСНАЯ, а смета молчит: ' + cls.silentFail.length);
    console.log('  проверка жёлтая («впритык» у прибора), смета молчит: ' + cls.silentTight.length);
    const show = (list, n) => list.slice(0, n).forEach(m => console.log('    · ' + m.title + ' → ' + m.pump.replace('Насос скважинный ', '') + '; ' + (m.worst ? m.worst.zone + '/' + m.worst.title + ' ' + (m.worst.line === 'hot' ? 'ГВС' : 'ХВС') + ' ' + f1(m.worst.have) + '/' + f1(m.worst.need) + ' м (' + m.worst.verdict + ')' : '') + (m.flags ? ' [' + m.flags + ']' : '')));
    console.log('  вероятностный расход против суммы со сглаживанием: средний расчётный расход ' + f2(cmp.qNew / cmp.n) + ' против ' + f2(cmp.qOld / cmp.n) + ' м³/ч; насос другой в ' + cmp.changed + ' из ' + cmp.n + ' (дешевле ' + cmp.down + ', дороже ' + cmp.up + '), суммарно ' + Math.round(cmp.dPrice).toLocaleString('ru-RU') + ' ₽');
    if (cls.silentFail.length) { console.log('  — красные при молчании сметы:'); show(cls.silentFail, 30); }
    if (cls.silentTight.length) { console.log('  — жёлтые при молчании сметы:'); show(cls.silentTight, 15); }
}

if (mode === 'json') console.log(JSON.stringify(jsonOut, null, 1));
console.log('\n' + (bad ? '✗ проверок не прошло: ' + bad : '✓ все проверки прошли'));
process.exit(bad ? 1 : 0);
