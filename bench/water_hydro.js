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
    if (!r) { fail(title + ': проверка не вернула результат'); return; }
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
    console.log('  трение, Kv, кривая насоса, согласие с wellLineLoss — проверено');
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
    if (!r) { console.log('  (нет данных: скважина или санузлы не заданы)'); return; }
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
    if (cls.silentFail.length) { console.log('  — красные при молчании сметы:'); show(cls.silentFail, 30); }
    if (cls.silentTight.length) { console.log('  — жёлтые при молчании сметы:'); show(cls.silentTight, 15); }
}

if (mode === 'json') console.log(JSON.stringify(jsonOut, null, 1));
console.log('\n' + (bad ? '✗ проверок не прошло: ' + bad : '✓ все проверки прошли'));
process.exit(bad ? 1 : 0);
