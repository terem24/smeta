/**
 * Печатная спецификация Galf Design (проект 2026-545, раздел «Водоснабжение»).
 *
 * Эталон проставлен человеком для строк, где верный артикул однозначен. Стенд
 * гонит их тем же путём, что сайт для файла с колонкой «Код»: код → аналог через
 * защиты (RecognizeMatch.matchSpec). Нужен, чтобы правка подбора не вернула
 * старые промахи: незамерзающий кран → шаровой, хомут → труба, коллектор с
 * регулирующими клапанами → с запорными.
 *
 * Запуск (из корня репозитория): node bench/spec_galf.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'catalog.js'), 'utf8') + '\n;\n' +
    fs.readFileSync(path.join(ROOT, 'equivalents.js'), 'utf8') + '\n;\n' +
    fs.readFileSync(path.join(ROOT, 'recognize_match.js'), 'utf8') + '\n;\nglobalThis.__RM = RecognizeMatch;\n';
const sb = { console, document: { createElement: () => ({ style: {} }) }, window: {},
    navigator: { userAgent: 'node' }, localStorage: { getItem: () => null, setItem: () => {} }, module: undefined };
sb.globalThis = sb; vm.createContext(sb); vm.runInContext(src, sb);
const RM = sb.__RM;
RM.setPriceIndex(JSON.parse(fs.readFileSync(path.join(ROOT, 'price_index.json'), 'utf8')).items);

// [название, код из колонки, производитель, ожидаемый артикул или null — «верного нет, пустая строка лучше»]
const ROWS = [
    ['Кран незамерзающий водоразборный с антисифоном 400 мм, 1/2" HP (выход 3/4" HP), ROMMER RVFF-0001-1', '520400', 'ROMMER', 'RVFF-0001-1520400'],
    ['Балансировочный клапан MVT-R LF, Ду 20 ВР, Kvs 2,86, Ридан', '003Z4082RLF', 'Ридан', 'RVL-0001-100020'],
    ['Хомут трубный быстрого монтажа 1" (32-35 мм)', 'TR32-35FGRS51', null, 'SAC-0020-200001'],
    ['Узел нижнего подключения для двухтрубной системы 1/2" НР х 3/4" НР, угловой, Giacomini', 'R388X012', 'Giacomini', 'SVH-0004-000020'],
    ['Шаровой кран латунный полнопр. 3/4" ВН-НР, ручка-бабочка, со сгоном, Giacomini', 'R859X325', 'Giacomini', 'SVB-0004-200020'],
    ['Коллектор с регулирующими клапанами 1"x2x3/4" ЕК, Elsen', 'EMW02.02T', 'Elsen', 'RMB-0004-013402'],
    ['Коллектор с регулирующими клапанами 1"x3x3/4" ЕК, Elsen', 'EMW02.03T', 'Elsen', 'RMB-0004-013403'],
    ['Коллектор с регулирующими клапанами 1"x4x3/4" ЕК, Elsen', 'EMW02.04T', 'Elsen', 'RMB-0004-013404'],
    ['Удлинитель хромированный 1" ВН/НР 30мм, MVI', 'BF.671.06-L30', 'MVI', 'SFT-0002-000130'],
    ['Евроконус для сшитого полиэтилена 3/4"-16 * 2,2, Elsen', 'EFB03.1622EK', 'Elsen', 'SFC-0020-001622'],
    ['Угольник настенный с креплением 16 x 1/2", Elsen', 'EFA25.16-12WB', 'Elsen', 'SFA-0009-001612'],
    ['Угольник-переходник ВН 16 x 1/2", Elsen', 'EFA25.16-12BB', 'Elsen', 'SFP-0010-001216'],
    ['Гильза монтажная DN16, Elsen', 'EFA16P', 'Elsen', 'SFA-0020-000016'],
];

let ok = 0;
for (const [name, code, maker, want] of ROWS) {
    const rec = RM.specItem({ name, art: code, codes: [code], maker, qty: 1, unit: 'шт' });
    // Колонка «Код» с переноса строки: часть кода в названии, хвост в колонке.
    const part = name.match(/[A-Z]{2,}[A-Z0-9.]*-\d{2,}[A-Z0-9.]*-\d+(?![\dA-Z])/);
    if (part && /^\d+$/.test(code)) rec._spec.codes.unshift(part[0] + code);
    const r = RM.matchSpec(rec, null);
    const got = r.m && r.m.item ? (r.m.item.id) : null;
    const good = got === want;
    if (good) ok++;
    console.log((good ? 'ok  ' : 'FAIL') + ' ' + name.slice(0, 52).padEnd(52) + ' → ' + (got || '—') + (good ? '' : '  (ждали ' + want + ')'));
}
// У коллектора должны быть варианты обоих брендов, а не по одному.
const crec = RM.specItem({ name: ROWS[6][0], art: ROWS[6][1], codes: [ROWS[6][1]], maker: 'Elsen', qty: 1 });
const cur = RM.matchSpec(crec, null).m.item;
const vr = RM.variantsOf(crec, cur, null, 3716, 4);
const varOk = vr.stout.length >= 2 && vr.rommer.length >= 2;
console.log((varOk ? 'ok  ' : 'FAIL') + ` варианты коллектора: STOUT ${vr.stout.length}, ROMMER ${vr.rommer.length}`);
if (varOk) ok++;

console.log(`\n${ok} из ${ROWS.length + 1}`);
process.exit(ok === ROWS.length + 1 ? 0 : 1);
