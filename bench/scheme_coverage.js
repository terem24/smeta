/**
 * Стенд покрытия схем узлов: где в смете позиция/раздел есть, а лист схемы не строится.
 *
 * Листы узлов (котёл 2.1/2.2, бойлер 2.3, гидравлика 2.4, радиаторы и приборы 3.x, тёплый пол 4.x,
 * вода 5, канализация 8) собираются из кадров Blender только по узкому набору артикулов. Остальное
 * молча падает на пусто либо на прежний лист проекта-образца. Стенд перебирает конфигурации сметы
 * (бренд, топливо, котёл, площадь, этажи, приборы, ТП, ГВС, замены, тип трубы, коллектора, гидравлики)
 * и для каждой позиции раздела со схемой смотрит: построил ли лист свой кадр.
 *
 * Запуск из корня репозитория:
 *   node bench/scheme_coverage.js                 — таблица пробелов в консоль
 *   node bench/scheme_coverage.js --md=файл.md    — ещё и отчёт в markdown
 *   node bench/scheme_coverage.js -v              — каждая конфигурация отдельной строкой
 * Код возврата всегда 0: это отчёт, а не проверка. Blender и сеть не нужны, логика сметы не меняется
 * (индексы кадров читаются с диска, wmPreviewOn включается подменой в песочнице).
 *
 * Котлы PLUS (SEB-2201) сняты с производства и не подбираются — в отчёте помечены «исключено».
 */
const fs = require('fs');
const path = require('path');
const app = require('./env.js');

const VERB = process.argv.includes('-v');
const MD = (process.argv.find(a => a.startsWith('--md=')) || '').slice(5);
const rootDir = path.join(__dirname, '..');
const rdOpt = f => { try { return JSON.parse(fs.readFileSync(path.join(rootDir, f), 'utf8')); } catch (e) { return {}; } };

// индексы кадров — с диска, как их отдал бы fetch
app._blIdx = rdOpt('img/boiler_node/boiler.json');
app._nodeIdx = { hydro: rdOpt('img/hydro_node/hydro.json'), dhw: rdOpt('img/dhw_node/dhw.json') };
app._radIdx = rdOpt('img/manifold_rad/rad.json');
app._ufhIdx = rdOpt('img/manifold_ufh/ufh.json');
app._rnIdx = rdOpt('img/rad_node/radnode.json');
app._pnIdx = rdOpt('img/rad_panel/panel.json');
app._sdIdx = rdOpt('img/rad_side/side.json');
app._cvIdx = rdOpt('img/rad_conv/conv.json');
app._woIdx = rdOpt('img/water_outlet/wo.json');
app._swIdx = rdOpt('img/sewer_node/sw.json');
app._wmIdx = { st: rdOpt('img/manifold3d/manifold3d_st.json'), rm: rdOpt('img/manifold3d/manifold3d_rm.json'), bl: rdOpt('img/manifold3d/manifold3d_bl.json') };
app.wmPreviewOn = () => true;
// строки таблицы на странице-заглушке не нужны: подписи ищут их в DOM, которого здесь нет
app.__doc.querySelectorAll = () => [];
// render() внутри индексов зовёт fetch — после подмены индексов он не нужен, но на всякий случай глушим
app.render = (function (orig) { return function () { return orig.apply(this, arguments); }; })(app.render);

const cat = app.__catalog;
const sku = it => String(it.displaySku || it.id || '');
const grp = it => String(it.group || it.sectionTitle || '');
const built = html => typeof html === 'string' && html.indexOf('wm-lab') >= 0;
const asHtml = r => (r && typeof r === 'object') ? (r.html || '') : (r || '');

// семейство артикула: SEB-3101, GE0Q6, SDG-0018 ... без мощности/длины
function fam(s) {
    s = String(s || '');
    let m = /^([A-Z]{2,4}-\d{4})/.exec(s);
    if (m) return m[1];
    m = /^(GE0Q6)/.exec(s);
    if (m) return m[1];
    m = /^([A-Za-z]+\d?[A-Za-z]*)/.exec(s);
    return m ? m[1] : s.slice(0, 8);
}
const EXCLUDED = /^SEB-2201/i;   // котлы PLUS сняты с производства

// ── накопитель пробелов ───────────────────────────────────────────────────
const G = {};          // ключ слот|семейство -> { slot, family, brand: Set, cfgs: Set, covered, total, reasons: {}, ex: [] }
let cfgCount = 0;
function note(cfgId, slot, family, ok, reason, brand, name) {
    const k = slot + '|' + family;
    const g = G[k] || (G[k] = { slot, family, name: name || '', brands: new Set(), total: new Set(), gap: new Set(), reasons: {}, ex: [] });
    g.total.add(cfgId); g.brands.add(brand);
    if (!ok) {
        g.gap.add(cfgId);
        g.reasons[reason] = (g.reasons[reason] || 0) + 1;
        if (g.ex.length < 3 && g.ex.indexOf(cfgId) < 0) g.ex.push(cfgId);
    }
}

// ── причины отказа (повторяют условия renderXxx, без правок app.js) ───────
function hydroWhy(eq) {
    const e = eq.filter(it => /^2\.4/.test(grp(it)));
    const col = e.find(it => /^(SDG-0018|RDG-0017)-00400[23]$/i.test(sku(it)));
    if (!col) {
        const c2 = e.find(it => /^(SDG|RDG)-00(16|17|18)/i.test(sku(it)));
        return c2 ? 'коллектор ' + fam(sku(c2)) + ' (не SDG-0018/RDG-0017 на 2-3 контура)' : 'нет коллектора SDG-0018/RDG-0017 (самосборная/другая гидравлика)';
    }
    const rm = /^RDG/i.test(sku(col));
    const isGr = it => /^(RDG-10\d\d|SDG-000[1-7])-/i.test(sku(it));
    const GR = rm ? /^(RDG-1001|RDG-1003|RDG-1002)-002501$/i : /^(SDG-0001|SDG-0003|SDG-0002)-002501$/i;
    const bad = e.find(it => isGr(it) && !GR.test(sku(it)));
    if (bad) return 'группа ' + sku(bad) + ' без кадра (левая/DN20/DN32/чужой бренд)';
    if (rm && !e.some(it => /^RDG-0015-004003$/i.test(sku(it)))) return 'ROMMER без стрелки RDG-0015-004003';
    const n = e.filter(it => GR.test(sku(it))).reduce((s, it) => s + (it.q || it.qty || 1), 0);
    const np = /3$/.test(sku(col)) ? 3 : 2;
    if (!n) return 'нет групп DN25 с правым насосом';
    if (n > np) return 'групп больше, чем пар на коллекторе';
    const pump = e.find(it => /^(SPC|RCP)-/i.test(sku(it)));
    if (pump) {
        const P = ['SPC-0011-2560180', 'SPC-0010-2560180', 'SPC-0002-2560180', 'SPC-0003-2560180', 'RCP-0004-2560180', 'RCP-0030-2560180'];
        if (P.indexOf(sku(pump).toUpperCase()) < 0) return 'насос ' + sku(pump) + ' без кадра';
    }
    return 'нет кадра в индексе (комбинация групп/воздухоотводчика/насоса)';
}
function dhwWhy(eq) {
    const g23 = eq.filter(it => /^2\.3/.test(grp(it)));
    const boiler = eq.find(it => /^(SWH-2110|RWH-2110|SWH-3110)-000(100|150|190|200|300|500)$/i.test(sku(it)));
    if (!boiler) {
        const b = g23.find(it => /водонагрев|бойлер/i.test(String(it.name || '')));
        return 'бойлер ' + (b ? sku(b) : '?') + ' не из SWH-2110/RWH-2110/SWH-3110 (100-500 л)';
    }
    if (!g23.find(it => /^STW-0015-0000(24|18|12)$/i.test(sku(it)))) return 'нет бака ГВС STW-0015 (24/18/12 л)';
    if (!app._dhwPipe || !app._dhwPipe.cold) return 'нет труб узла (_dhwPipe)';
    return 'нет кадра в индексе dhw.json (серия/объём/крепление/смеситель)';
}

// ── сам перебор ───────────────────────────────────────────────────────────
function evalCfg(cfgId, patch) {
    cfgCount++;
    try { app.__setup(patch); } catch (e) { console.log('  ошибка __setup ' + cfgId + ': ' + e.message); return; }
    const eq = app.currentEquipmentList || [];
    const brand = (app.state.brandMode || 'stout');
    const safe = (fn) => { try { return fn(); } catch (e) { return '#ERR ' + e.message; } };

    // 2.1/2.2 котёл
    const boilers = eq.filter(it => /^(Котел|Котёл|Электрокот|Газовый кот)/i.test(String(it.name || '')) && !/^(Датчик|Стабилизатор)/i.test(String(it.name || '')));
    if (boilers.length) {
        const bsh = safe(() => asHtml(app.renderBoilerNodeScheme()));
        const idx = app._blIdx;
        boilers.forEach(it => {
            const s = sku(it);
            const f = fam(s);
            if (EXCLUDED.test(s)) { note(cfgId, '2.1/2.2 котёл', f + ' (PLUS, исключено)', true, '', brand, it.name); return; }
            const k = app.boilerFrameKey(it);
            let ok = !!k && !!idx[k] && built(bsh), why = '';
            if (!ok) why = !k ? 'нет вида кадра для котла (' + (/^GE0Q6/i.test(s) ? 'Haier: не одно/двухконтурный по названию' : 'чужая модель') + ')' : (!idx[k] ? 'нет кадра ' + k : 'лист не построен');
            note(cfgId, '2.1/2.2 котёл', f + (/^GE0Q6/i.test(s) ? (/двухконтур/i.test(it.name) ? ' двухконтурный' : ' одноконтурный') : ''), ok, why, brand, it.name);
        });
    }
    // 2.3 бойлер ГВС
    const g23 = eq.filter(it => /^2\.3/.test(grp(it)));
    const wh = eq.find(it => /^(SWH|RWH|SWB|RWB)-\d{4}/i.test(sku(it)));
    if (wh) {
        const html = safe(() => asHtml(app.renderDhwNodeScheme()));
        const ok = built(html);
        note(cfgId, '2.3 бойлер ГВС', fam(sku(wh)), ok, ok ? '' : dhwWhy(eq), brand, wh.name);
    }
    // 2.4 гидравлика
    const g24 = eq.filter(it => /^2\.4/.test(grp(it)));
    if (g24.length) {
        const html = safe(() => asHtml(app.renderHydroNodeScheme()));
        const ok = built(html);
        const col = g24.find(it => /^(SDG|RDG)-00(16|17|18)/i.test(sku(it)));
        const selfAsm = !col && g24.some(it => /Самосбор|GIDRUSS|Gidruss/i.test(grp(it) + ' ' + String(it.name || '')));
        const f = col ? fam(sku(col)) : (selfAsm ? 'самосборная группа/GIDRUSS' : fam(sku(g24[0])));
        note(cfgId, '2.4 гидравлика', f + (/_/.test(String(app.state.hydroType)) ? '' : ' (' + (app.state.hydroType || 'combo') + ')'), ok, ok ? '' : hydroWhy(eq), brand);
        // насосные группы по отдельности — для таблицы по артикулам
        g24.filter(it => /^(RDG-10\d\d|SDG-000[1-7])-/i.test(sku(it))).forEach(it =>
            note(cfgId, '2.4 группа', sku(it).replace(/-\d{6}$/, '-…') + ' ' + sku(it).slice(-6), ok && /-002501$/.test(sku(it)), ok ? 'группа вне набора кадров' : hydroWhy(eq), brand, it.name));
        g24.filter(it => /^(SPC|RCP)-/i.test(sku(it))).forEach(it => {
            const P = ['SPC-0011-2560180', 'SPC-0010-2560180', 'SPC-0002-2560180', 'SPC-0003-2560180', 'RCP-0004-2560180', 'RCP-0030-2560180'];
            note(cfgId, '2.4 насос', sku(it), P.indexOf(sku(it).toUpperCase()) >= 0 && ok, 'насос без кадра', brand, it.name);
        });
    }
    // 3.x приборы и узлы
    const sec3 = eq.filter(it => /^3\./.test(grp(it)));
    if (sec3.length) {
        const sheets = { node: safe(() => app.renderRadNodeSheet()), panel: safe(() => app.renderPanelNodeSheet()), side: safe(() => app.renderSideNodeSheet()), conv: safe(() => app.renderConvNodeSheet()) };
        const ok_ = k => !!sheets[k] && typeof sheets[k] === 'object';
        const rads = sec3.filter(it => !/^(SV|SF|SM|SK|SA|SP|SH|SH)/i.test(sku(it)) || /^(SRB|SRA|SC[NQ])/i.test(sku(it)));
        sec3.forEach(it => {
            const s = sku(it);
            if (/^SC[NQ]-/i.test(s)) note(cfgId, '3.x конвектор', fam(s), ok_('conv'), 'нет кадра (тип клапана/металлопластик/модель)', brand, it.name);
            else if (/^RRS-2010/i.test(s)) note(cfgId, '3.x радиатор стальной панельный', fam(s), ok_('panel'), 'нет кадра (клапаны под евроконус/исполнение/головка)', brand, it.name);
            else if (/^(SRB-032[01]|RRS-2020)/i.test(s) || app.bottomFamily(s)) {
                // нижнее подключение: нужен ровно один узел SVH, кадр space/ventil/…
                const svh = sec3.filter(x => /^SVH-000[24]/i.test(sku(x))).length;
                note(cfgId, '3.x радиатор нижнее подключение', fam(s), ok_('node'), svh !== 1 ? 'в смете ' + svh + ' узлов SVH (нужен 1)' : 'нет кадра (тип/«башмак»/стабильная труба/сторона)', brand, it.name);
            } else if (app.sideFamily(s)) note(cfgId, '3.x радиатор боковое подключение', fam(s), ok_('side'), 'нет кадра (семейство/арматура/цвет)', brand, it.name);
            else if (/^(Радиатор|Конвектор)/i.test(String(it.name || '')))
                note(cfgId, '3.x радиатор без узла схемы', fam(s), false, 'у семейства нет листа узла подключения', brand, it.name);
        });
        // коллекторы радиаторов
        const rmRows = (app.currentEquipmentList || []).filter(it => /^SMS-0912/i.test(String(it.originalId || '')));
        if (rmRows.length) {
            const fresh = safe(() => app.renderRadManifoldSheet());
            rmRows.forEach(it => note(cfgId, '3.x коллектор радиаторов', fam(sku(it)), !!fresh && typeof fresh === 'object', 'коллектор вне SMS-0912 или нет кадра', brand, it.name));
        }
        sec3.filter(it => /^Коллектор/i.test(String(it.name || '')) && !/^SMS-0912/i.test(String(it.originalId || ''))).forEach(it =>
            note(cfgId, '3.x коллектор радиаторов', fam(sku(it)), false, 'нет листа (только SMS-0912)', brand, it.name));
    }
    // 4.x тёплый пол
    const mans = (app._ufhMans || []);
    if ((app.state.systems || []).indexOf('tp') >= 0 && mans.length) {
        const fresh = safe(() => app.renderUfhManifoldSheet());
        mans.forEach(m => {
            const shown = eq.find(it => it.originalId === m.oid && /^4\./.test(grp(it)));
            const s = shown ? sku(shown) : String(m.id);
            note(cfgId, '4.x коллектор ТП', fam(s), !!fresh && typeof fresh === 'object', /^SMS-0907/i.test(s) ? 'нет кадра (число выходов вне 2-13)' : 'лист ТП есть только у STOUT SMS-0907', brand, shown && shown.name);
        });
    }
    if (eq.some(it => /^4\.4/.test(grp(it)))) note(cfgId, '4.4 снеготаяние', 'снеготаяние', false, 'нет листа узла', brand);
    // 5 вода
    const g5 = eq.filter(it => /^5\./.test(grp(it)));
    const lines = safe(() => app.wmLinesNow());
    if (Array.isArray(lines) && lines.length) {
        const html = safe(() => asHtml(app.renderWaterScheme()));
        const typ = safe(() => app.wmType(lines[0]));
        note(cfgId, '5 коллекторы воды', 'коллектор воды ' + typ, built(html), 'нет кадра (число выходов/торец)', brand);
    }
    if (g5.some(it => /^SFA-0032/i.test(sku(it)))) {
        const html = safe(() => asHtml(app.renderWaterOutletScheme()));
        note(cfgId, '5 водорозетки', 'SFA-0032', built(html), 'нет планки вне double150/double100/single или кадра', brand);
    }
    // 8 канализация
    if (eq.some(it => /^8\./.test(grp(it)) && /^Труба канализационная/i.test(String(it.name || '')))) {
        const html = safe(() => asHtml(app.renderSewerNodeScheme()));
        note(cfgId, '8 канализация', 'узлы санузла', built(html), 'нет кадра прибора', brand);
    }
    if (VERB) console.log('  ' + cfgId);
}

// ── сетка конфигураций ────────────────────────────────────────────────────
const zone = (name, fx) => ({ id: name, name, dist: 8, fixtures: Object.assign({ toilet: 0, basin: 0, shower: 0, bath: 0, wash: 0, dish: 0, bidet: 0 }, fx) });
const Z3 = [zone('С/у1', { toilet: 1, basin: 2, bath: 1, wash: 1 }), zone('С/у2', { toilet: 1, basin: 1, shower: 1 }), zone('Кухня', { dish: 1, basin: 1 })];
const CONV_ROOMS = () => [{ id: 11, name: 'Гостиная', area: 30, floor: 1, sys: ['rad'], windows: [{ id: 12, width: 3, isPan: true }] },
    { id: 21, name: 'Спальня', area: 16, floor: 1, sys: ['rad'], windows: [{ id: 22, width: 1.5, isPan: false }] }];

const BRANDS = ['stout', 'rommer'];
const FUELS = [['gas'], ['el'], ['gas', 'el']];
const AREAS = [100, 250, 400];
const FLOORS = [1];
const SYS = [{ systems: ['rad'] }, { systems: ['rad', 'tp'], tp1: 60, tp2: 30 }];
const HW = [true, false];
const RADS = [
    { radType: 'space', connectionType: 'angled' }, { radType: 'space', connectionType: 'straight' },
    { radType: 'steel', connectionType: 'angled' }, { radType: 'steel', connectionType: 'straight' },
    { radType: 'space_ru', connectionType: 'angled' }, { radType: 'titan', connectionType: 'angled' },
    { radType: 'aluminum', connectionType: 'angled' }, { radType: 'rommer_rst_2_1750', connectionType: 'angled' },
    { radType: 'oscar_1800_black_s', connectionType: 'angled' }, { radType: 'tube_quadro_1800_black_b', connectionType: 'straight' }
];
const PIPES = ['insulated', 'split_mp', 'stable_16'];
const MANIF = ['standard', 'chrome'];
const HYDRO = ['combo', 'modular'];
const SERIES = ['status', 'polis'];

let seq = 0;
const base = o => Object.assign({ floors: 1, hotWater: true, water: false }, o);
const configs = [];
// 1) котельная: бренд × топливо × серия × площадь × этажи × ГВС × гидравлика × (ТП)
for (const b of BRANDS) for (const f of FUELS) for (const a of AREAS) for (const fl of FLOORS) for (const sy of SYS) for (const hw of HW) for (const h of HYDRO) {
    if (fl === 2 && a < 150) continue;
    for (const se of (f.indexOf('el') >= 0 ? SERIES : ['status']))
        configs.push([`котельная ${b} ${f.join('+')} ${se} ${a}м2 ${fl}эт ${sy.systems.join('+')} ГВС=${hw} ${h}`,
            base(Object.assign({ brandMode: b, fuels: f, boilerSeries: se, area: a, floors: fl, hotWater: hw, hydroType: h }, sy))]);
}
// 2) радиаторы: бренд × прибор × труба × коллектор
for (const b of BRANDS) for (const r of RADS) for (const p of PIPES) for (const m of (r.radType === 'space' ? MANIF : ['standard']))
    configs.push([`радиаторы ${b} ${r.radType} ${r.connectionType} ${p} коллектор ${m}`, base(Object.assign({ brandMode: b, area: 140, systems: ['rad'], pipeType: p, radManifoldType: m }, r))]);
// 3) конвекторы, подробные помещения
for (const b of BRANDS) for (const t of ['scn', 'scq']) for (const c of ['angled', 'straight']) for (const p of ['insulated', 'split_mp'])
    configs.push([`конвекторы ${b} ${t} ${c} ${p}`, base({ brandMode: b, area: 120, systems: ['rad'], detailedRooms: true, rooms: CONV_ROOMS(), convectorType: t, convConnectionType: c, pipeType: p })]);
// 4) вода и канализация
for (const b of BRANDS) for (const zs of [Z3, Z3.slice(0, 1)]) for (const rc of [false, true]) for (const wi of [true])
    configs.push([`вода ${b} зон=${zs.length} рециркуляция=${rc} ввод=${wi}`, base({ brandMode: b, area: 160, floors: 2, systems: ['rad'], water: true, sewer: true, recirc: rc, waterInput: wi, waterZones: zs })]);
// 5) бойлеры: тип × бренд
for (const b of BRANDS) for (const bt of ['optibase', 'standard', 'stainless']) for (const ar of [120, 400])
    configs.push([`бойлер ${b} ${bt} ${ar}м2`, base({ brandMode: b, fuels: ['gas'], area: ar, boilerType: bt, hotWater: true })]);
// 6) снеготаяние
configs.push(['снеготаяние', base({ area: 200, systems: ['rad'], snowMelt: true, snowArea: 20 })]);

// 7) замены state.swaps: у каждого базового объекта заменяем котёл, бойлер, насос, гидравлику, радиатор на соседей по категории
const SWAP_CATS = ['boilers_gas', 'boilers_status', 'boilers_polis', 'boilers_plus', 'boilers_baxi', 'boilers_vaillant', 'boilers_navien', 'tanks_optibase', 'tanks_standard', 'tanks_stainless', 'pumps_dn25', 'rommer_pumps', 'hydro_dn25', 'collectors_dn25', 'rads', 'manifolds_rad', 'convectors_scq', 'convectors_scn'];
const SWAP_BASES = [
    ['газ+бойлер+ТП', base({ area: 200, systems: ['rad', 'tp'], tp1: 80, fuels: ['gas'], hotWater: true })],
    ['электро+бойлер', base({ area: 150, systems: ['rad'], fuels: ['el'], hotWater: true })],
    ['ROMMER газ+ТП', base({ area: 200, systems: ['rad', 'tp'], tp1: 80, fuels: ['gas'], hotWater: true, brandMode: 'rommer' })],
    ['ROMMER электро', base({ area: 150, systems: ['rad'], fuels: ['el'], hotWater: true, brandMode: 'rommer' })]
];
const swapJobs = [];
for (const [nm, patch] of SWAP_BASES) {
    app.__setup(patch); app.render(true);
    for (const it of (app.currentEquipmentList || [])) {
        const oid = it.originalId || it.id;
        for (const ck of SWAP_CATS) {
            const arr = cat[ck]; if (!Array.isArray(arr)) continue;
            const ix = arr.findIndex(x => x.id === oid);
            if (ix < 0) continue;
            arr.filter((x, i) => i !== ix).slice(0, 2).forEach(alt => swapJobs.push([`замена ${nm}: ${oid} -> ${alt.id}`, Object.assign({}, patch, { swaps: { [oid]: alt.id } })]));
        }
    }
}
swapJobs.slice(0, 90).forEach(j => configs.push(j));

const t0 = Date.now();
const seen = new Set();
configs.forEach(([id, patch]) => { if (seen.has(id)) return; seen.add(id); evalCfg(id, patch); });

// ── отчёт ─────────────────────────────────────────────────────────────────
const rows = Object.values(G).map(g => ({ slot: g.slot, family: g.family, name: g.name, brands: [...g.brands].join('/'), total: g.total.size, gap: g.gap.size,
    reasons: g.reasons, ex: g.ex }));
const gaps = rows.filter(r => r.gap > 0 && !/исключено/.test(r.family)).sort((a, b) => b.gap - a.gap);
const ok = rows.filter(r => r.gap === 0 && !/исключено/.test(r.family)).sort((a, b) => a.slot.localeCompare(b.slot));
const excl = rows.filter(r => /исключено/.test(r.family));
const topReason = r => Object.entries(r.reasons).sort((a, b) => b[1] - a[1])[0] || ['', 0];
const lines = [];
lines.push('# Покрытие схем узлов кадрами (стенд bench/scheme_coverage.js)', '',
    `Конфигураций сметы: ${cfgCount}. Время: ${Math.round((Date.now() - t0) / 1000)} с. Индексы кадров — с диска, ветка main.`,
    'Строка = семейство позиций в разделе со схемой. «Затронуто» — сколько конфигураций, где позиция есть, а кадра для неё нет (из скольких, где она вообще есть).', '',
    '## Пробелы (нет кадра), по частоте', '', '| Раздел | Семейство (артикул) | Бренд | Затронуто | Главная причина | Пример |', '|---|---|---|---|---|---|');
gaps.forEach(r => lines.push(`| ${r.slot} | ${r.family}${r.name ? ' — ' + String(r.name).slice(0, 40) : ''} | ${r.brands} | ${r.gap} из ${r.total} | ${topReason(r)[0]} | ${r.ex[0] || ''} |`));
lines.push('', '## Есть кадр во всех конфигурациях', '', '| Раздел | Семейство | Бренд | Конфигураций |', '|---|---|---|---|');
ok.forEach(r => lines.push(`| ${r.slot} | ${r.family} | ${r.brands} | ${r.total} |`));
lines.push('', '## Исключено', '', ...excl.map(r => `- ${r.slot}: ${r.family} (в ${r.total} конфигурациях) — снято с производства, не подбирается`));
const out = lines.join('\n') + '\n';
if (MD) { fs.writeFileSync(MD, out); console.log('Отчёт: ' + MD); }
console.log(`Конфигураций: ${cfgCount}. Семейств с пробелом: ${gaps.length}, без пробела: ${ok.length}.`);
gaps.slice(0, 15).forEach(r => console.log(`  ${String(r.gap).padStart(4)}/${String(r.total).padEnd(4)} ${r.slot} | ${r.family} | ${topReason(r)[0]}`));
process.exit(0);
