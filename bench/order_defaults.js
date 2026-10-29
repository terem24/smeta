/**
 * Позиции «под заказ», которые подбор ставит в смету по умолчанию.
 *
 * Зачем. Позиция с availability «on_order» (или «в наличии», но с ценой старше
 * 31 дня — калькулятор такие тоже считает «под заказ») не должна быть
 * выбором по умолчанию: монтажник получает смету, которую нельзя собрать.
 * Часть позиций подбор берёт жёстко, по артикулу (`F('SVB-0009-000020')`,
 * `byId(/^SVB-…/)`), и в каталоге это не видно. Стенд собирает такие ссылки
 * из исходников и сверяет с каталогом.
 *
 * Запуск (из корня): node bench/order_defaults.js [--json]
 * С --json пишет order_defaults.json — его читает вкладка админки
 * «Замены позиций», раздел «Под заказ в подборе по умолчанию».
 * Каждый день перегоняет workflow apply-successors.yml. Поле built — дата,
 * когда список последний раз менялся; если список не изменился, файл не трогаем.
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const app = require('./env.js');

const SRC = ['app.js', 'assembly_chains.js', 'recognize_match.js', 'recognize_plan.js'];
const ID = /['"`\/^]([A-Z]{2,4}-\d{4}-\d{5,7}|R[A-Z]{2}-\d{4}-\d{5,7})(?=[_'"`\$)\/]|\b)/g;
const refs = {};
SRC.forEach(f => {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) return;
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        let m; ID.lastIndex = 0;
        while ((m = ID.exec(line))) (refs[m[1]] = refs[m[1]] || []).push(f + ':' + (i + 1));
    });
});

const now = Date.now(), DAY = 86400000;
const out = [];
Object.keys(refs).forEach(id => {
    const it = app.findCatalogItemById(id);
    if (!it) return;
    let av = it.availability, stale = false;
    if (av === 'in_stock' && it.price_date) {
        const d = new Date(it.price_date);
        if (!isNaN(d) && (now - d) / DAY > 31) { av = 'on_order'; stale = true; }
    }
    if (av !== 'on_order') return;
    out.push({ id, name: it.name, price: it.price, brand: it.brand || '', price_date: it.price_date || '', stale, where: refs[id].slice(0, 4) });
});
out.sort((a, b) => a.id.localeCompare(b.id));
console.log('Под заказ в жёстких ссылках подбора: ' + out.length);
out.forEach(o => console.log(`${o.id}  ${o.price} ₽  ${o.name}\n    ${o.where.join(', ')}`));
if (process.argv.includes('--json')) {
    const file = path.join(root, 'order_defaults.json');
    let built = new Date().toISOString().slice(0, 10), same = false;
    try {
        const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
        same = JSON.stringify(prev.items) === JSON.stringify(out);
        if (same) built = prev.built;
    } catch (e) { /* файла ещё нет */ }
    if (same) {
        console.log('order_defaults.json: список без изменений, файл не трогаем');
    } else {
        fs.writeFileSync(file, JSON.stringify({ built, items: out }, null, 1));
        console.log('→ order_defaults.json (список изменился)');
    }
}
