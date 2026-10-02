/**
 * Стенд ядра «смета по спецификации»: RecognizeMatch.specItem + matchSpec на строках,
 * которые bench/spec.js вынул из корпуса (galf_spec_rows.csv).
 *
 * Считает: сколько строк закрыл код из колонки артикула, сколько — аналог (всегда
 * «проверьте»), сколько аналогов отклонено защитой и почему. Печатает ту же
 * беспристрастную выборку, что bench/spec_analog.js (каждая 160-я строка из
 * ненайденных по артикулу), — по ней сравнивается с ручной разметкой.
 *
 * Запуск (из корня worktree):
 *   node bench/spec_engine.js "D:\galf_chat2\galf_spec_rows.csv" --index "D:\galf_tools\price_index_live.json"
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const flag = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const CSV = argv[0];
const INDEX = flag('--index') || path.join(ROOT, 'price_index.json');

function loadMatcher() {
    const src = fs.readFileSync(path.join(ROOT, 'catalog.js'), 'utf8') + '\n;\n' +
        fs.readFileSync(path.join(ROOT, 'recognize_match.js'), 'utf8') + '\n;\nglobalThis.__RM = RecognizeMatch;\n';
    const sb = { console, document: { createElement: () => ({ style: {} }) }, window: {},
        navigator: { userAgent: 'node' }, localStorage: { getItem: () => null, setItem: () => {} }, module: undefined };
    sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(src, sb, { filename: 'bench-bundle.js' });
    return sb.__RM;
}

function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) {
            if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
        } else if (c === '"') q = true;
        else if (c === ';') { row.push(cell); cell = ''; }
        else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
        else if (c !== '\r') cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const head = rows.shift().map(h => h.replace(/^\ufeff/, ''));
    return rows.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const RM = loadMatcher();
const idx = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
RM.setPriceIndex(idx.items);
console.log('Прайс:', idx.version, 'собран', idx.built, '| позиций', idx.items.length);

const all = parseCsv(fs.readFileSync(CSV, 'utf8')).filter(r => r['артикул']);
const cache = new Map();
const res = all.map(r => {
    const key = r['наименование'] + '|' + r['артикул'] + '|' + r['производитель'];
    if (!cache.has(key)) {
        const rec = RM.specItem({ name: r['наименование'], art: r['артикул'], maker: r['производитель'],
            unit: r['ед'], qty: parseFloat(r['кол']) || 0, pos: r['поз'] });
        cache.set(key, RM.matchSpec(rec, null));
    }
    return { r, x: cache.get(key) };
});

const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '—';
const byCode = res.filter(o => o.x.m && o.x.m.byArticle);
const analog = res.filter(o => o.x.m && o.x.m.analog);
const rejected = res.filter(o => !o.x.m && /отклонён/.test(o.x.why || ''));
const none = res.filter(o => !o.x.m && !/отклонён/.test(o.x.why || ''));
console.log('\nСтрок спецификации с артикулом:', all.length);
console.log(`  по коду из колонки артикула  ${String(byCode.length).padStart(6)}  ${pct(byCode.length, all.length)}`);
console.log(`  аналог (жёлтый, «проверьте») ${String(analog.length).padStart(6)}  ${pct(analog.length, all.length)}`);
console.log(`  аналог отклонён защитой      ${String(rejected.length).padStart(6)}  ${pct(rejected.length, all.length)}`);
console.log(`  аналога нет                  ${String(none.length).padStart(6)}  ${pct(none.length, all.length)}`);

const why = new Map();
for (const o of rejected) {
    const k = String(o.x.why).replace(/^аналог отклонён:\s*/, '').replace(/\d+([.,]\d+)?/g, 'N').replace(/(в проекте|подобран) [а-яё ]+/g, '$1 …');
    why.set(k, (why.get(k) || 0) + 1);
}
console.log('\nПочему отклонены (по виду причины):');
[...why].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, n]) => console.log(`  ${String(n).padStart(5)}  ${k}`));

// Та же выборка, что в spec_analog.js: ненайденные bench/spec.js, каждая 160-я.
// Найденное вторым поиском — «по признакам»: отдельный счёт и выборка для глаз
// (каждая N-я из таких строк, чтобы видеть разнообразие).
const feat = res.filter(o => o.x.m && o.x.m.byFeatures);
console.log(`\nИз аналогов найдено вторым поиском (по признакам): ${feat.length} (${pct(feat.length, all.length)} всех строк)`);
if (argv.includes('--features')) {
    const uniq = [], seen = new Set();
    for (const o of feat) if (!seen.has(o.r['наименование'])) { seen.add(o.r['наименование']); uniq.push(o); }
    const step = Math.max(1, Math.floor(uniq.length / 40));
    uniq.filter((_, i) => i % step === 0).slice(0, 40).forEach(o => console.log(
        `  ${String(o.r['производитель'] || '—').slice(0, 12).padEnd(12)} | ${o.r['наименование'].slice(0, 64).padEnd(64)} → ${o.x.m.item.id} ${String(o.x.m.item.name).slice(0, 48)}`));
}

// --why <regex>: какие строки отклонены по такой причине (по одной на уникальное название).
const WHY = flag('--why');
if (WHY) {
    const rx = new RegExp(WHY, 'i'), seen = new Set();
    console.log(`\nОтклонены по причине «${WHY}»:`);
    for (const o of res) {
        if (o.x.m || !rx.test(o.x.why || '') || seen.has(o.r['наименование'])) continue;
        seen.add(o.r['наименование']);
        if (seen.size > 30) break;
        console.log(`  ${String(o.r['производитель'] || '—').slice(0, 12).padEnd(12)} | ${o.r['наименование'].slice(0, 80)}`);
    }
}

// --grep <regex>: что получили строки с таким названием (по одной на уникальное).
const GREP = flag('--grep');
if (GREP) {
    const rx = new RegExp(GREP, 'i'), seen = new Set();
    console.log(`\nСтроки «${GREP}»:`);
    for (const o of res) {
        if (!rx.test(o.r['наименование']) || seen.has(o.r['наименование'])) continue;
        seen.add(o.r['наименование']);
        const m = o.x.m;
        console.log(`  ${m ? (m.byArticle ? 'КОД ' : 'АНЛГ') : 'НЕТ '} | ${o.r['наименование'].slice(0, 70).padEnd(70)} → ` +
            (m ? `${m.item.id} ${String(m.item.name).slice(0, 40)}` : String(o.x.why).slice(0, 60)));
    }
}

// --offset N даёт ДРУГУЮ выборку того же шага: защиты настраивались на выборке 0,
// и честная проверка — на строках, которых при настройке не видели.
const OFFSET = +(flag('--offset') || 0);
const miss = res.filter(o => !o.r['найдено']);
console.log(`\nВЫБОРКА (каждая 160-я со сдвигом ${OFFSET} из ненайденных по артикулу bench/spec.js):`);
miss.forEach((o, i) => {
    if (i % 160 !== OFFSET) return;
    const m = o.x.m;
    const tag = m ? (m.byArticle ? 'КОД ' : 'АНЛГ') : 'НЕТ ';
    const what = m ? `${String(m.item.id).padEnd(18)} ${String(m.item.name).slice(0, 52)}` : String(o.x.why).slice(0, 75);
    console.log(`  ${tag} | ${String(o.r['производитель'] || '—').slice(0, 14).padEnd(14)} | ${o.r['наименование'].slice(0, 62).padEnd(62)} → ${what}`);
});
