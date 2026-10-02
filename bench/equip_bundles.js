/**
 * Комплекты оборудования: что проектировщики кладут вместе — и чего из этого нет в
 * нашей автоматической смете.
 *
 * По спецификациям рабочих проектов корпуса Galf (galf_spec_rows.csv, bench/spec.js)
 * для каждого проекта отмечаем, какие ВИДЫ оборудования в нём есть (котёл, бойлер,
 * бак, насосная группа, фильтр, автоматика…), потом считаем: как часто вид встречается,
 * и что чаще всего идёт вместе с котлом, бойлером, коллектором тёплого пола и радиаторами.
 * Те же виды отмечаем в наших типовых сметах (bench/render.js-набор) — разница и есть
 * «пропущенное» либо «лишнее» у нас.
 *
 * Запуск (из корня worktree):
 *   node bench/equip_bundles.js "D:\galf_chat2\galf_spec_rows.csv"
 *   node bench/equip_bundles.js "D:\galf_chat2\galf_spec_rows.csv" --list фильтр   — какие строки попали в вид
 */
const fs = require('fs');

const [csv] = process.argv.slice(2);
if (!csv) { console.log('node bench/equip_bundles.js <galf_spec_rows.csv> [--list <слово>]'); process.exit(0); }
const LIST = process.argv.includes('--list') ? process.argv[process.argv.indexOf('--list') + 1] : null;

const lc = s => String(s || '').toLowerCase().replace(/ё/g, 'е');
// Виды оборудования; строка может попасть в несколько видов (бак — и бак, и вид по назначению).
const KINDS = [
    ['котёл', n => /(^|[^а-я])котел(?!ьн)/.test(n) && !/расширит|бак|подключ|обвязк|комплект\s+подключ|нагреват/.test(n)],
    ['бойлер косвенного нагрева', n => /бойлер|водонагревател/.test(n)],
    ['расширительный бак отопления', n => /(расширительн\S*\s+бак|бак\s+расширит|мембранн\S*\s+бак)/.test(n) && !/гвс|водоснаб|питьев|airfix|для\s+воды/.test(n)],
    ['бак для воды / ГВС', n => /(расширительн\S*\s+бак|бак\s+расширит|мембранн\S*\s+бак|гидроаккумулятор)/.test(n) && /гвс|водоснаб|питьев|airfix|для\s+воды|гидроаккумулятор/.test(n)],
    ['насосная группа / узел подмеса', n => /насосн\S*\s+групп|групп\S*\s+насосн|узел\s+подмеса|насосн\S*\s+модул|узел\s+обвязк\S*\s+коллектор/.test(n)],
    ['циркуляционный насос', n => /циркуляционн\S*\s+насос|насос\s+циркуляц|насос\s+с\s+мокрым/.test(n)],
    ['гидрострелка', n => /гидрострел|гидравлическ\S*\s+разделител/.test(n)],
    ['коллектор', n => /коллектор/.test(n) && !/шкаф/.test(n)],
    ['коллекторный шкаф', n => /шкаф/.test(n)],
    ['сервопривод / термоэлектрика', n => /сервопривод|термоэлектрическ|привод\s+термо|электротермическ/.test(n)],
    ['терморегулятор / термостат', n => /терморегулятор|термостат\S*\s+(комнат|програм|wi|wifi)|комнатн\S*\s+термостат|термоголов|термостатическ\S*\s+(голов|элемент)/.test(n)],
    ['смесительный клапан', n => /смесительн\S*\s+клапан|трехходов|трехходов/.test(n)],
    ['магнитный фильтр / шламоотделитель', n => /шламоотдел|магнитн\S*\s+фильтр|фильтр\S*\s+магнит/.test(n)],
    ['сетчатый фильтр', n => /фильтр/.test(n) && /сетчат|универсал|косой|муфтов/.test(n)],
    ['фильтр воды (колба, картридж)', n => /колб|big\s*blue|картридж|магистральн\S*\s+фильтр|фильтр\S*\s+для\s+воды/.test(n)],
    ['водоподготовка (умягчение)', n => /умягчител|обезжелез|водоподготов|ионообмен|реагент/.test(n)],
    ['редуктор давления', n => /редуктор\S*\s+давлен|редукционн/.test(n)],
    ['предохранительный клапан', n => /предохранительн/.test(n)],
    ['воздухоотводчик / сепаратор', n => /воздухоотводч|сепаратор\s+воздух|воздухоотделит/.test(n)],
    ['автоматика (контроллер, погодозависимая)', n => /погодозависим|контроллер|zont|ectocontrol|термостат\S*\s+(?:wi|wifi)|умный/.test(n)],
    ['теплоноситель (антифриз)', n => /теплоноситель|антифриз|гликол|незамерзающ(?!ий\s+кран)/.test(n) && !/кран/.test(n)],
    ['манометр / термометр', n => /манометр|термометр|термоманометр/.test(n)],
    ['водосчётчик', n => /счетчик|водосчет/.test(n)],
    ['рециркуляция ГВС', n => /рециркуляц/.test(n)],
    ['полотенцесушитель', n => /полотенцесуш/.test(n)],
    ['радиатор / конвектор', n => /радиатор|конвектор/.test(n) && !/узел|подключ|кран|клапан|вентиль/.test(n)],
    ['группа безопасности котла', n => /групп\S*\s+безопасн/.test(n)],
    ['обратный клапан', n => /обратн\S*\s+клапан/.test(n)],
    ['автоподпитка', n => /подпиточн|автомат\S*\s+подпитк|клапан\s+подпитк/.test(n)],
    ['дренаж / слив котла', n => /дренаж|слив/.test(n) && /котел|бойлер/.test(n)],
];

function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
        else if (c === '"') q = true; else if (c === ';') { row.push(cell); cell = ''; }
        else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const head = rows.shift().map(h => h.replace(/^\ufeff/, ''));
    return rows.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const rows = parseCsv(fs.readFileSync(csv, 'utf8'));
const byProject = new Map();
for (const r of rows) { if (!byProject.has(r['файл'])) byProject.set(r['файл'], []); byProject.get(r['файл']).push(r); }
const seen = new Set(), projects = [];
for (const [f, rs] of byProject) {
    const sig = rs.length + '|' + Math.round(rs.reduce((a, r) => a + (parseFloat(String(r['кол']).replace(',', '.')) || 0), 0));
    if (seen.has(sig)) continue; seen.add(sig);
    // Проект без единой «капитальной» строки (котёл, коллектор, радиатор) — это не сводная спецификация, а узел или
    // план; такие строки не говорят об отсутствии вида, пропускаем проекты скуднее 25 позиций.
    if (rs.length < 25) continue;
    const kinds = new Set();
    for (const r of rs) { const n = lc(r['наименование']); for (const [k, f] of KINDS) if (f(n)) kinds.add(k); }
    projects.push({ f, kinds, n: rs.length });
}

if (LIST) {
    const cnt = new Map();
    for (const r of rows) { const n = lc(r['наименование']); for (const [k, f] of KINDS) if (lc(k).includes(lc(LIST)) && f(n)) { const key = `[${k}] ` + r['наименование'].slice(0, 70); cnt.set(key, (cnt.get(key) || 0) + 1); } }
    [...cnt].sort((a, b) => b[1] - a[1]).slice(0, 35).forEach(([k, n]) => console.log(String(n).padStart(4), k));
    process.exit(0);
}

const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
const N = projects.length;
console.log(`Проектов со сводной спецификацией (≥ 25 позиций, без копий): ${N}`);
const freq = KINDS.map(([k]) => [k, projects.filter(p => p.kinds.has(k)).length]);
console.log('\nКАК ЧАСТО ВИД ЕСТЬ В ПРОЕКТЕ:');
freq.sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(pct(n, N)).padStart(3)} %  ${k}`));

// Что идёт вместе: для опорных видов — доля проектов с каждым другим видом.
const ANCHORS = ['котёл', 'бойлер косвенного нагрева', 'коллектор', 'радиатор / конвектор'];
for (const a of ANCHORS) {
    const sub = projects.filter(p => p.kinds.has(a));
    if (sub.length < 8) continue;
    console.log(`\nВМЕСТЕ С «${a}» (проектов ${sub.length}): что есть в ≥ 60 % таких проектов`);
    KINDS.map(([k]) => [k, sub.filter(p => p.kinds.has(k)).length]).filter(([k, n]) => k !== a && pct(n, sub.length) >= 60)
        .sort((x, y) => y[1] - x[1]).forEach(([k, n]) => console.log(`  ${String(pct(n, sub.length)).padStart(3)} %  ${k}`));
}

// Наши типовые сметы: какие виды есть.
if (process.argv.includes('--ours')) {
    process.chdir(require('path').join(__dirname, '..'));
    const app = require('./env.js');
    const DEF = JSON.parse(JSON.stringify(app.state));
    const zone = (name, fx) => ({ id: name, name, dist: 8, fixtures: Object.assign({ toilet: 0, basin: 0, shower: 0, bath: 0, wash: 0, dish: 0, bidet: 0 }, fx) });
    const SCEN = {
        'газ+бойлер, радиаторы+ТП, вода, 150 м²': { area: 150, floors: 2, res: 4, win: 12, fuels: ['gas'], systems: ['rad', 'tp'], tp1: 40, hotWater: true, water: true, waterInput: true,
            waterZones: [zone('С/у 1', { toilet: 1, basin: 1, bath: 1, wash: 1 }), zone('С/у 2', { toilet: 1, basin: 1, shower: 1 }), zone('Кухня', { dish: 1, basin: 1 })] },
        'электро, радиаторы, 120 м²': { area: 120, floors: 1, res: 3, win: 8, fuels: ['el'], systems: ['rad'] },
        'газ, только ТП, 100 м²': { area: 100, floors: 1, res: 3, win: 8, fuels: ['gas'], systems: ['tp'], tp1: 90 },
    };
    const present = {};
    for (const [name, patch] of Object.entries(SCEN)) {
        app.state = Object.assign(JSON.parse(JSON.stringify(DEF)), JSON.parse(JSON.stringify(patch)), { tgUser: { id: 1, account_type: 'pro' }, accountType: 'pro' });
        app.autoCalcZones(); app.render(true);
        const ks = new Set();
        for (const i of (app.currentEquipmentList || [])) { const n = lc(i.name); for (const [k, f] of KINDS) if (f(n)) ks.add(k); }
        present[name] = ks;
    }
    console.log('\nНАШИ ТИПОВЫЕ СМЕТЫ — какие виды есть (✓) и что у проектировщиков встречается чаще 60 %, а у нас нет (✗):');
    console.log('вид'.padEnd(44) + 'проекты'.padStart(8) + '   ' + Object.keys(present).map((_, i) => `№${i + 1}`).join('  '));
    Object.keys(present).forEach((n, i) => console.log(`  №${i + 1} = ${n}`));
    for (const [k, n] of freq) {
        if (pct(n, N) < 20) continue;
        console.log(`${k.padEnd(44)}${(pct(n, N) + ' %').padStart(8)}   ` + Object.values(present).map(ks => ks.has(k) ? ' ✓ ' : (pct(n, N) >= 60 ? ' ✗ ' : ' · ')).join('  '));
    }
}
