/**
 * Повтор разбора: ответ модели из bench/replay/*.json → startReview → проверка.
 *
 * Файл случая: { name, items: [...ответ модели...], docTotals, expect: { "<docNo>": "артикул" | null },
 * system: "pex" }. Ответ настоящей модели снимается на сайте в консоли:
 *   RecognizeUI.dumpReplay('имя')   — вернёт json и положит его в буфер обмена.
 * Дальше его кладут сюда и проставляют expect у строк, где верный артикул ясен.
 * Так проверяется ровно то, что видит монтажник: тип, код и производитель так,
 * как их заполнила модель, а не как их подаёт стенд подбора.
 *
 * Запуск: node bench/replay.js            (exit 1, если что-то не сошлось)
 */
const fs = require('fs'), path = require('path');
const { load } = require('./ui_env.js');

const dir = path.join(__dirname, 'replay');
let bad = 0, total = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const { U, out } = load({ keep: ['renderCompare', 'renderReview'] });
    U.saveDraft = () => {};
    U._fileKind = 'pdf';
    U.startReview({ items: c.items, docTotals: c.docTotals, sectionTotals: c.sectionTotals });
    console.log(`\n${c.name}${c.synthetic ? '  (синтетический ответ модели — замените снятым с сайта)' : ''}`);
    const order = U._rows.map((r) => r.docNo).join(',');
    if (c.order && order !== c.order) { bad++; console.log(`FAIL порядок строк: ${order} (ждали ${c.order})`); }
    total++;
    if (c.system) {
        const got = U._sysChosen || (U._sys && U._sys.main);
        total++; if (got !== c.system) { bad++; console.log(`FAIL система: ${got} (ждали ${c.system})`); }
    }
    for (const r of U._rows) {
        const want = c.expect ? c.expect[r.docNo] : undefined;
        if (want === undefined) continue;
        const got = r._m && r._m.item ? String(r._m.item.article || r._m.item.id) : null;
        total++;
        const ok = got === want;
        if (!ok) bad++;
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(r.docNo).padStart(3)} ${String(r.raw).slice(0, 50).padEnd(50)} → ${got || '—'}${ok ? '' : `  (ждали ${want})`}`);
    }
    for (const no of (c.sumBad || [])) {
        total++; const r = U._rows.find((x) => x.docNo === String(no));
        if (!r || !r._sumBad) { bad++; console.log(`FAIL строка ${no}: расхождение цены × количества с суммой не замечено`); }
    }
    if (c.totalKind) {
        const t = U.totalCheck();
        total++; if (!t || t.kind !== c.totalKind) { bad++; console.log(`FAIL сверка суммы: ${t ? t.kind : 'нет'} (ждали ${c.totalKind})`); }
    }
    // Экраны не должны падать: сравнение цен и таблица проверки рисуются целиком.
    for (const [name, fn, needle] of [['сравнение цен', () => U.renderCompare(), 'Итого по документу'], ['таблица проверки', () => U.renderReview(), 'rec-table']]) {
        total++;
        try { out.html = ''; fn(); if (!out.html.includes(needle)) throw new Error('в выводе нет «' + needle + '»'); }
        catch (e) { bad++; console.log(`FAIL экран «${name}»: ${e.message}`); }
    }
    if (c.maxPpr != null) {
        const ppr = U._rows.filter((r) => r._m && r._m.item && /PP-?R|полипроп/i.test(r._m.item.name)).length;
        total++; if (ppr > c.maxPpr) { bad++; console.log(`FAIL полипропиленовых позиций: ${ppr} (допустимо ${c.maxPpr})`); }
    }
}
console.log(`\n${total - bad} из ${total}`);
process.exit(bad ? 1 : 0);
