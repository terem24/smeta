/**
 * Спецификация проекта: чем закрываются контроллеры и датчики чужих марок.
 *
 * Идёт через matchSpec — тот же путь, что и на сайте при загрузке спецификации:
 * код из колонки → подбор по названию → аналог с защитами. Правило подбора для
 * Профи (CLAUDE.md, п. 8): аналог допустим, если он равноценен; чего в ассортименте
 * нет — не подменять молча, а писать «нет полного соответствия».
 *
 * Запуск из корня: node bench/zont_spec.js [--all]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const ALL = process.argv.includes('--all');

const src = fs.readFileSync(path.join(ROOT, 'catalog.js'), 'utf8') + '\n;\n' +
    fs.readFileSync(path.join(ROOT, 'recognize_match.js'), 'utf8') + '\n;\nglobalThis.__RM = RecognizeMatch;\n';
const sb = { console, document: { createElement: () => ({ style: {} }) }, window: {}, navigator: { userAgent: 'node' },
    localStorage: { getItem: () => null, setItem: () => {} }, module: undefined };
sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(src, sb, { filename: 'bench-zont-spec.js' });
const RM = sb.__RM;
RM.setPriceIndex(JSON.parse(fs.readFileSync(path.join(ROOT, 'price_index.json'), 'utf8')).items);

// name, art, maker — как строка таблицы спецификации; ok — допустимые артикулы; none — подбора быть не должно
const ROWS = [
    // свои и ZONT — по коду из колонки и по названию
    { name: 'Автоматический регулятор отопления Climatic.V2', art: 'ML00007105', maker: 'ZONT', ok: ['ML00007105'] },
    { name: 'Контроллер отопления SMART 2.0', art: '', maker: 'ZONT', ok: ['ML00004479'] },
    { name: 'Блок расширения ZE-44', art: '', maker: 'ZONT', ok: ['ML00005696'] },
    { name: 'Датчик давления MLD-10.01', art: '', maker: 'ZONT', ok: ['ML00005517'] },
    { name: 'Радиомодуль МЛ-590', art: '', maker: 'ZONT', ok: ['ML00004741'] },
    // чужие погодозависимые контроллеры — аналог по функции
    { name: 'Контроллер погодозависимый для смесительных контуров ECL Comfort 310', art: '087H3040', maker: 'Danfoss', ok: ['ML00007105', 'SMH-3001-104212'] },
    { name: 'Регулятор температуры отопления погодозависимый CRC120', art: '', maker: 'ESBE', ok: ['EWT100', 'ML00007105', 'SMH-3001-104212'] },
    { name: 'Контроллер погодозависимый RVS43', art: '', maker: 'Siemens', ok: ['ML00007105', 'SMH-3001-104212'] },
    { name: 'Контроллер отопления погодозависимый смесительный', art: '', maker: 'Seltron', ok: ['ML00007105', 'SMH-3001-104212'] },
    // GSM / Wi-Fi управление котлом
    // без названия модели подбирать ZONT вслепую нельзя — «нет полного соответствия» честнее
    { name: 'Wi-Fi термостат для управления котлом', art: '', maker: 'Zont', none: ['ML00004479', 'ML00007105', 'ML00005886'] },
    // не наш диапазон — подбор не должен ставить автоматику ZONT
    { name: 'Термостат комнатный механический', art: '', maker: 'Danfoss', none: ['ML00004479', 'ML00007105', 'ML00005886'] },
    { name: 'Привод клапана смесительного 230 В', art: '', maker: 'Danfoss', none: ['ML00007105', 'ML00004479'] },
    { name: 'Блок питания 24 В 1 А', art: '', maker: 'Meanwell', none: ['ML13968'] },
];

let bad = 0;
ROWS.forEach((r) => {
    const rec = RM.specItem({ name: r.name, art: r.art, maker: r.maker, unit: 'шт', qty: 1, pos: '1' });
    const res = RM.matchSpec(rec, null);
    const id = res.m && res.m.item ? String(res.m.item.id) : '';
    const name = res.m && res.m.item ? String(res.m.item.name || '').slice(0, 56) : '';
    const ok = r.ok ? r.ok.includes(id) : !(r.none || []).includes(id);
    if (!ok) bad++;
    if (!ok || ALL) {
        console.log((ok ? 'OK  ' : 'МИМО') + ' | ' + (r.maker ? r.maker + ' ' : '') + r.name);
        console.log('       → ' + (id || '—') + (name ? ' «' + name + '»' : '') + (res.m && res.m.substituted ? ' · ' + res.m.substituted : '') + (res.why ? ' · ' + res.why : ''));
    }
});
console.log('\nВсего ' + ROWS.length + ', верно ' + (ROWS.length - bad) + ', мимо ' + bad);
process.exitCode = bad ? 1 : 0;
