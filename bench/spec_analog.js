/**
 * Второй замер шага 3: чем закрываются строки спецификации, которых нет в прайсе.
 *
 * Первый замер (bench/spec.js) показал: STOUT по артикулу находится на 98 %, а
 * Valtec, Giacomini, Flamco, Uponor, ZOTA и др. в прайсе ТЕРЕМ отсутствуют вовсе.
 * Их можно закрыть только аналогом. Здесь эти строки идут через ТОТ ЖЕ конвейер
 * подбора, что и на сайте (RecognizeMatch.matchItem — загрузка как в bench/run.js).
 *
 * На сайте тип, диаметр, размеры и резьбу строки вынимает модель. У спецификации
 * есть только текст, поэтому два прогона — вилка:
 *   «текст»   — только raw;
 *   «правила» — raw + поля, вынутые из текста регулярками (как сделал бы разбор).
 * Балл делим, как экран распознавания: ≥ 0,9 зелёный, ≥ 0,7 жёлтый, ниже — слабый.
 *
 * Запуск (из корня worktree):
 *   node bench/spec_analog.js "D:\galf_chat2\galf_spec_rows.csv" --index "D:\galf_tools\price_index_live.json"
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

// ------------------------------------------------------------- CSV
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

// ------------------------------------------------------------- поля из текста
const TYPES = [
    [/кран[а-я]*\s+шаров|шаров[а-я]*\s+кран/i, s => /американк/i.test(s) ? 'кран_американка' : 'кран_шаровой'],
    [/американк|разъ[её]мн[а-я]* соединени/i, () => 'американка'],
    [/ниппел/i, () => 'ниппель'],
    [/футорк/i, () => 'футорка'],
    [/тройник/i, s => /пресс/i.test(s) ? 'тройник_пресс' : 'тройник'],
    [/угол|угольник|отвод/i, s => /пресс/i.test(s) ? 'угол_пресс' : 'прочее'],
    [/муфт/i, s => /пресс/i.test(s) ? 'пресс_муфта' : 'прочее'],
    [/переход|переходник/i, () => 'переход'],
    [/фильтр/i, () => 'фильтр'],
    [/хомут/i, () => 'хомут'],
    [/насос/i, () => 'насос'],
    [/радиатор/i, () => 'радиатор'],
    [/теплоизол|изоляц/i, () => 'изоляция'],
    [/труба/i, s => /металлопласт|металлополим|pe-?x|сшит/i.test(s) ? 'труба_pex' : /полипроп|ppr/i.test(s) ? 'труба_ppr' : 'прочее'],
];
function fields(raw) {
    const s = raw.replace(/[’‘´]/g, "'");
    const type = (TYPES.find(([rx]) => rx.test(s)) || [null, () => 'прочее'])[1](s);
    let d = null, dims = null, thread = null, threadType = null, angle = null;
    const dn = s.match(/\bDN\s?(\d{2,3})\b/i) || s.match(/[ØД]\s?=?\s?(\d{2,3})\b/);
    if (dn) d = +dn[1];
    const tri = s.match(/\b(\d{2,3})\s*[хx×]\s*(\d{2,3})\s*[хx×]\s*(\d{2,3})\b/);
    if (tri) dims = [+tri[1], +tri[2], +tri[3]];
    const pipe = s.match(/\b(\d{2})\s*[хx×]\s*\d[.,]\d\b/);          // «22х1,2», «16х2.0» — наружный диаметр
    if (!d && pipe) d = +pipe[1];
    if (!d) { const mm = s.match(/\b(\d{2})\s*мм\b/); if (mm) d = +mm[1]; }
    const th = s.match(/(\d\s\d\/\d|\d\/\d|\b[12]\b)\s*(?:"|''|дюйм)/);
    if (th) thread = th[1].replace(/\s+/g, ' ');
    // \b в JS вокруг кириллицы не работает — границу слова задаём явно.
    const w = x => new RegExp('(^|[^а-яё])' + x + '([^а-яё]|$)', 'i');
    if (/вр\s*[-–\/]?\s*нр/i.test(s) || w('вн').test(s) || /внутренн[а-я]*\s*\/\s*наружн/i.test(s)) threadType = 'ВН';
    else if (/вр\s*[-–\/]?\s*вр/i.test(s) || w('вв').test(s)) threadType = 'ВВ';
    else if (w('вр').test(s) || /внутренн[а-я]* резьб/i.test(s)) threadType = 'ВР';
    else if (w('нр').test(s) || /наружн[а-я]* резьб/i.test(s)) threadType = 'НР';
    if (/\b90\s*°|90\s*град/i.test(s)) angle = 90; else if (/\b45\s*°|45\s*град/i.test(s)) angle = 45;
    return { type, d, dims, thread, threadType, angle };
}
/**
 * Система трубопровода — подсказка подбору. Из спецификации её видно не только по
 * словам, но и по артикулу и марке: VTi у Valtec — нержавейка, VTm — металлопластик,
 * Uponor/KAN-therm/TECE — металлопластик под пресс. Без подсказки пресс-тройник
 * Uponor 25 уезжал в полипропилен.
 */
function sysOf(raw, art, maker) {
    const a = String(art || ''), m = String(maker || '').toLowerCase();
    if (/^VTi/i.test(a)) return 'ss';
    if (/^VTm/i.test(a)) return 'mp';
    if (/uponor|kan-?therm|tece/.test(m) && /пресс|труб|фитинг|тройник|угол|муфт/i.test(raw)) return 'mp';
    if (/нерж/i.test(raw)) return 'ss';
    if (/металлопласт|металлополим/i.test(raw)) return 'mp';
    if (/полипроп|\bppr\b/i.test(raw)) return 'ppr';
    if (/pe-?x|сшит/i.test(raw)) return 'pex';
    return null;
}

// ------------------------------------------------------------- прогон
const RM = loadMatcher();
const idx = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
RM.setPriceIndex(idx.items);
console.log('Прайс:', idx.version, 'собран', idx.built, '| позиций', idx.items.length);

const all = parseCsv(fs.readFileSync(CSV, 'utf8'));
const miss = all.filter(r => r['артикул'] && !r['найдено']);
console.log('Строк с артикулом:', all.filter(r => r['артикул']).length, '| не найдено по артикулу:', miss.length);

const bin = sc => sc >= 0.9 ? 'зелёный' : sc >= 0.7 ? 'жёлтый' : sc > 0 ? 'слабый' : 'нет';
const tally = mode => ({ mode, зелёный: 0, жёлтый: 0, слабый: 0, нет: 0, ошибка: 0 });
const T = { текст: tally('текст'), правила: tally('правила') };
const byMaker = new Map();
const sample = [];
const cache = new Map();
for (const r of miss) {
    const raw = r['наименование'];
    // Кэш по названию + подсказке системы: одно название у разных марок может значить разное.
    const key = raw + '|' + sysOf(raw, r['артикул'], r['производитель']);
    let res = cache.get(key);
    if (!res) {
        res = {};
        for (const mode of ['текст', 'правила']) {
            const rec = mode === 'текст' ? { raw, type: '', d: null, dims: null, thread: null, threadType: null }
                : Object.assign({ raw }, fields(raw));
            try {
                const m = RM.matchItem(rec, sysOf(raw, r['артикул'], r['производитель']));
                res[mode] = m ? { sc: m.score || 0, id: m.item.id, name: m.item.name, sub: m.substituted || '' } : null;
            } catch (e) { res[mode] = { err: e.message }; }
        }
        cache.set(key, res);
    }
    for (const mode of ['текст', 'правила']) {
        const x = res[mode];
        if (x && x.err) T[mode].ошибка++;
        else T[mode][bin(x ? x.sc : 0)]++;
    }
    const mk = (r['производитель'] || '—').toLowerCase();
    const o = byMaker.get(mk) || { n: 0, g: 0, y: 0 };
    o.n++;
    const b = bin(res['правила'] && res['правила'].sc ? res['правила'].sc : 0);
    if (b === 'зелёный') o.g++; else if (b === 'жёлтый') o.y++;
    byMaker.set(mk, o);
    // Выборка для глаз — каждая 160-я строка из ВСЕХ ненайденных, каким бы ни был
    // результат: так видно и точность аналогов, и долю строк, оставшихся без них.
    if (miss.indexOf(r) % 160 === 0) sample.push({ raw, mk, x: res['правила'] || { sc: 0, id: '—', name: 'нет аналога' } });
}

const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '—';
console.log('\nСтрок без артикула в прайсе:', miss.length, '| уникальных названий:', cache.size);
for (const t of Object.values(T)) {
    console.log(`  ${t.mode.padEnd(8)} зелёный ${pct(t.зелёный, miss.length).padStart(4)}  жёлтый ${pct(t.жёлтый, miss.length).padStart(4)}` +
        `  слабый ${pct(t.слабый, miss.length).padStart(4)}  нет ${pct(t.нет, miss.length).padStart(4)}` + (t.ошибка ? `  ошибок ${t.ошибка}` : ''));
}
console.log('\nПо производителям (режим «правила»): строк | зелёный | жёлтый');
[...byMaker].sort((a, b) => b[1].n - a[1].n).slice(0, 18).forEach(([k, o]) =>
    console.log(`  ${k.slice(0, 22).padEnd(22)} ${String(o.n).padStart(5)}  ${pct(o.g, o.n).padStart(4)}  ${pct(o.y, o.n).padStart(4)}`));

// Выборка для глаз: каждая 10-я строка из «зелёных и жёлтых», чтобы видеть разнообразие
const out = path.join(path.dirname(CSV), 'galf_spec_analog_sample.txt');
const lines = sample.slice(0, 41).map(s =>
    `${s.x.sc.toFixed(2)} | ${s.mk.padEnd(16)} | ${s.raw.slice(0, 70).padEnd(70)} → ${String(s.x.id).padEnd(18)} ${String(s.x.name).slice(0, 60)}`);
fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log('\nВыборка для ручной проверки (40 строк):', out);
