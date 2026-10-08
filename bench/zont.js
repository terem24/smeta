/**
 * Стенд подбора автоматики ZONT при распознавании сметы или спецификации.
 *
 * Строки — так, как их пишут в проектах и счетах поставщиков: с артикулом ТЕРЕМ
 * (ML0000…), с названием модели без артикула, со старой моделью (H1000+ PRO без V2,
 * Climatic 1.3), с чужим словом вместо нашего («блок расширения» / «блок
 * управления»). Каждая идёт через ТОТ ЖЕ конвейер, что и на сайте (matchItem), и
 * сверяется с ожидаемым артикулом: что подбор находит сам, что — аналогом, что не
 * находит вовсе.
 *
 * Запуск из корня репозитория:
 *   node bench/zont.js              таблица результатов, код возврата 1 при расхождениях
 *   node bench/zont.js --all        показать и совпавшие строки
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SHOW_ALL = process.argv.includes('--all');

function loadMatcher() {
    const src = fs.readFileSync(path.join(ROOT, 'catalog.js'), 'utf8') + '\n;\n' +
        fs.readFileSync(path.join(ROOT, 'recognize_match.js'), 'utf8') + '\n;\nglobalThis.__RM = RecognizeMatch;\n';
    const sb = {
        console, document: { createElement: () => ({ style: {} }) }, window: {},
        navigator: { userAgent: 'node' }, localStorage: { getItem: () => null, setItem: () => {} }, module: undefined
    };
    sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(src, sb, { filename: 'bench-zont.js' });
    return sb.__RM;
}

const RM = loadMatcher();
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'price_index.json'), 'utf8'));
RM.setPriceIndex(idx.items);

// expect: артикул(ы) каталога, которые считаем верным ответом; null — подбор обязан не угадывать
const CASES = [
    // --- по артикулу ТЕРЕМ ---
    { raw: 'ML00007105 Автоматический регулятор ZONT Climatic.V2', expect: 'ML00007105' },
    { raw: 'ML00004479 Отопительный ZONT SMART 2.0 GSM/Wi-Fi контроллер для газовых и электрических котлов', expect: 'ML00004479' },
    { raw: 'Адаптер цифровых шин универсальный (DIN) ZONT ML00005505', expect: 'ML00005505' },
    { raw: 'ML00000291 Реле промежуточное ZONT 12V DC', expect: 'ML00000291' },
    { raw: 'ML00006584 Универсальный контроллер ZONT H1000+ PRO.V2', expect: 'ML00006584' },
    { raw: 'ML00006086 Универсальный контроллер ZONT H2000+ PRO.V2', expect: 'ML00006086' },
    { raw: 'ML00007752 Универсальный контроллер ZONT H700+ PRO.V2', expect: 'ML00007752' },
    { raw: 'ML00007756 Универсальный контроллер ZONT H1500+ PRO.V2', expect: 'ML00007756' },
    { raw: 'ML00005703 Блок расширения ZE-22', expect: 'ML00005703' },
    { raw: 'ML00005696 Блок расширения ZE-44 для ZONT H2000+ PRO', expect: 'ML00005696' },
    { raw: 'ML00007406 Блок расширения ZONT EX-108 для Climatic V2', expect: 'ML00007406' },
    { raw: 'ML00004766 Блок расширения ZONT EX-77', expect: 'ML00004766' },
    { raw: 'ML00004741 Радиомодуль ZONT МЛ-590', expect: 'ML00004741' },
    // --- по названию, без артикула ---
    { raw: 'Регулятор отопления ZONT Climatic.V2', expect: 'ML00007105' },
    { raw: 'Погодозависимый автоматический регулятор ZONT Climatic V2', expect: 'ML00007105' },
    { raw: 'Контроллер ZONT SMART 2.0', expect: 'ML00004479' },
    { raw: 'Отопительный GSM/Wi-Fi контроллер ZONT SMART 2.0', expect: 'ML00004479' },
    { raw: 'Универсальный контроллер ZONT H1000+ PRO.V2', expect: 'ML00006584' },
    { raw: 'Контроллер ZONT H2000+ PRO V2', expect: 'ML00006086' },
    { raw: 'Блок расширения ZONT EX-77 для Climatic', expect: 'ML00004766' },
    { raw: 'Блок расширения EX-108', expect: 'ML00007406' },
    { raw: 'Адаптер цифровой шины универсальный ZONT', expect: ['ML00005505', 'ML00005842'] },
    { raw: 'Плата цифровых шин ZONT Climatic', expect: 'ML00005842' },
    { raw: 'Реле промежуточное на DIN-рейку 12V DC ZONT', expect: 'ML00000291' },
    { raw: 'Радиомодуль ZONT МЛ-590 (868 МГц)', expect: 'ML00004741' },
    // --- прежние модели и замены ---
    { raw: 'Контроллер ZONT H1000+ PRO', expect: 'ML00006584', note: 'без V2: актуальная замена' },
    { raw: 'Контроллер ZONT H2000+ PRO', expect: 'ML00006086', note: 'без V2: актуальная замена' },
    { raw: 'Контроллер ZONT H700+ PRO', expect: 'ML00005557', note: 'прежняя версия есть в прайсе — берём её' },
    { raw: 'Контроллер ZONT H1500+ PRO', expect: 'ML00005968', note: 'прежняя версия есть в прайсе — берём её' },
    { raw: 'Отопительный контроллер ZONT H-1V.02', expect: 'ML00005454' },
    { raw: 'Термостат ZONT SMART NEW', expect: 'ML00005886' },
    { raw: 'Погодозависимый регулятор ZONT Climatic 1.3', expect: 'ML00004486' },
    { raw: 'Погодозависимый регулятор ZONT Climatic 1.1', expect: 'ML00004511' },
    { raw: 'Блок управления смесительными контурами', expect: 'SMH-3001-104212', note: 'прямая замена по таблице' },
    // --- чужое с похожими словами: ZONT быть не должно ---
    { raw: 'Термостат MY HEAT SMART 2', expect: null, expectNot: ['ML00004479', 'ML00005886'] },
    { raw: 'Зонт вентиляционный 110', expect: null, expectNot: ['ML00007105'] },
    { raw: 'Обезжириватель резьбы 650 мл', expect: null, expectNot: ['ML00004741', 'ML00007555'] },
    // --- без марки ZONT, но по коду модели ---
    { raw: 'Блок расширения EX-77 для Climatic', expect: 'ML00004766' },
    { raw: 'Радиомодуль МЛ-590', expect: 'ML00004741' },
    { raw: 'Датчик давления MLD-10.01 нерж. сталь', expect: 'ML00005517' },
    // --- датчики и аксессуары автоматики ---
    { raw: 'Термодатчик ZONT DS18B20 в гильзу', expect: 'ML00003614' },
    { raw: 'Датчик температуры ZONT NTC', expect: 'ML00004775' },
    { raw: 'Датчик давления ZONT MLD-10.01', expect: 'ML00005517' }
];

const keys = (e) => (Array.isArray(e) ? e : [e]);

let bad = 0;
const rows = [];
CASES.forEach((c) => {
    let res = null, err = '';
    try { res = RM.matchItem({ raw: c.raw, type: '', d: null, dims: null, thread: null, threadType: null }, null); }
    catch (e) { err = e.message; }
    const id = res && res.item ? (res.item.id || res.item.article || res.item.code || '') : '';
    const name = res && res.item ? (res.item.name || res.item.n || '') : '';
    const score = res && typeof res.score === 'number' ? res.score.toFixed(2) : '-';
    const ok = !err && (c.expect === null ? !(c.expectNot || []).includes(String(id)) : keys(c.expect).includes(String(id)));
    if (!ok) bad++;
    rows.push({ ok, raw: c.raw, expect: c.expect === null ? 'не ' + (c.expectNot || []).join('|') : keys(c.expect).join('|'), id, name, score, note: c.note || '', err });
});

rows.forEach((r) => {
    if (r.ok && !SHOW_ALL) return;
    console.log((r.ok ? 'OK  ' : 'МИМО') + ' | ' + r.raw);
    if (!r.ok) console.log('       ждали ' + r.expect + (r.note ? ' (' + r.note + ')' : '') + ', получили ' + (r.id || '—') + (r.name ? ' «' + String(r.name).slice(0, 60) + '»' : '') + ' балл ' + r.score + (r.err ? ' ошибка: ' + r.err : ''));
});
console.log('\nВсего ' + CASES.length + ', совпало ' + (CASES.length - bad) + ', мимо ' + bad);
process.exitCode = bad ? 1 : 0;
