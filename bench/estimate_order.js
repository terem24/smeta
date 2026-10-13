/**
 * Итоговая смета после переноса: порядок строк — как в документе.
 *
 * Смета сортировала распознанное по сумме строки, и позиция из начала счёта
 * (незамерзающий кран) оказывалась четырнадцатой. Здесь распознанные строки
 * переносятся в настоящую смету (app.applyRecognized + render), и порядок
 * currentEquipmentList сверяется с порядком документа.
 *
 * Запуск: node bench/estimate_order.js
 */
const fs = require('fs'), path = require('path');
const { load } = require('./ui_env.js');
const c = JSON.parse(fs.readFileSync(path.join(__dirname, 'replay', 'galf_2026-545.json'), 'utf8'));

const { U } = load();
U._fileKind = 'pdf';
U.startReview({ items: c.items });
const rows = JSON.parse(JSON.stringify(U._rows));

const log = console.log; console.log = () => {};          // env.js шумит про init
const app = require('./env.js');
console.log = log;
app.applyRecognized(rows, 'new', { docPrices: true });
app.render(true);

const got = (app.currentEquipmentList || []).map((i) => i.name);
const want = rows.map((r) => r._m && r._m.item ? r._m.item.name : (r.raw || ''));
let bad = 0;
if (got.length !== want.length) { bad++; console.log(`FAIL строк в смете ${got.length}, в документе ${want.length}`); }
for (let i = 0; i < Math.min(got.length, want.length); i++) {
    if (got[i] !== want[i]) { bad++; console.log(`FAIL место ${i + 1}: в смете «${got[i]}», по документу «${want[i]}»`); break; }
}
console.log(bad ? 'порядок сметы нарушен' : `порядок сметы совпадает с документом (${got.length} строк)`);
process.exit(bad ? 1 : 0);
