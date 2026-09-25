/**
 * Стенд распознавания комплекта листов проекта — без модели и без браузера.
 *
 * Зачем. Правка распознавания проекта проверялась прогоном на сайте: 15
 * запросов к модели, три минуты и сверка глазами по двенадцати комнатам. Так
 * не видно, что правка, починившая окна кабинета, увела радиатор из спальни, —
 * и суточный лимит модели кончается раньше, чем проверка.
 *
 * Что меряет. Всё, что распознавание берёт из PDF без модели (RecognizeGeo и
 * RecognizeFiles): отбор листов, стены, места подписей комнат, окна по концам
 * выносок, зоны тёплого пола по подписям S=, приборы по маркам РД, сантехнику
 * по маркам спецификации. Помещения берутся из эталона — как будто модель
 * прочитала экспликацию верно (это она и так делает без ошибок). Итог — по
 * каждой комнате «совпало / не совпало» и общий счёт.
 *
 * Запуск (из корня репозитория):
 *   cd bench && npm i --no-save pdfjs-dist@3.11.174 && cd ..
 *   node bench/project.js bench/projects/hvoynaya3.json
 *
 * Эталон — bench/projects/<имя>.json, в .gitignore: это проекты заказчиков, а
 * репозиторий открытый. Формат — см. вывод `node bench/project.js --help`.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HELP = `node bench/project.js <эталон.json> [--pdf <путь к PDF>]

Эталон:
{
  "pdf": "C:/Users/.../Downloads/Хвойная 3 проект.pdf",
  "rooms": [
    { "name": "Коридор", "area": 17.53, "windows": 2, "floorWin": 2,
      "ufh": 14.08, "heaters": 0, "fix": {} },
    { "name": "Гардеробная", "area": 10.57, "windows": 0, "ufh": true },
    { "name": "Мастер-санузел", "area": 10.89, "windows": 2, "floorWin": 0, "ufh": 4.22,
      "fix": { "toilet": 1, "toiletHot": 1, "basin": 1, "bath": 1, "shower": 1 } }
  ]
}
ufh: число — площадь зоны с подписью S=; true — зона без подписи (площадь по
остатку спецификации); 0 или нет поля — тёплого пола нет. Поле, которого в
эталоне нет, не сравнивается.`;

const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) { console.log(HELP); process.exit(0); }
const etalonPath = args[0];
const et = JSON.parse(fs.readFileSync(etalonPath, 'utf8'));
const pdfPath = args.includes('--pdf') ? args[args.indexOf('--pdf') + 1] : et.pdf;

let pdfjsLib;
try { pdfjsLib = require(path.join(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.js')); } catch (e) {
    console.error('Нет pdf.js: cd bench && npm i --no-save pdfjs-dist@3.11.174');
    process.exit(1);
}

// Модули сайта — как в браузере, с заглушками того, что им нужно от страницы.
const root = path.join(__dirname, '..');
const ctx = {
    console, globalThis: null, setTimeout, clearTimeout,
    window: { pdfjsLib },
    RecognizeUI: { plural: (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; } },
    RecognizePlan: { PDF_CELL: '', PDF_TIP: '' },
};
ctx.globalThis = ctx;
ctx.window.pdfjsLib = pdfjsLib;
vm.createContext(ctx);
for (const f of ['recognize_geo.js', 'recognize_files.js', 'recognize_project.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8').replace(/^const (Recognize\w+) =/m, 'var $1 =');
    vm.runInContext(src, ctx, { filename: f });
}
const { RecognizeGeo: G, RecognizeFiles: F, RecognizeProject: P } = ctx;
G.ops = () => pdfjsLib.OPS;

const fmt = n => (Math.round(n * 100) / 100).toLocaleString('ru-RU');
const FIX = ['toilet', 'toiletHot', 'basin', 'bath', 'shower', 'bidet'];

(async () => {
    const t0 = Date.now();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), verbosity: 0 }).promise;
    const set = await F.projectSheets(pdf);
    if (!set) { console.log('Не комплект листов проекта.'); return; }
    console.log(`Листов ${pdf.numPages}; помещения — ${set.rooms.map(p => p.num + ' «' + p.title + '»').join(', ')}`);

    // То, что fromProjectSet готовит без картинок.
    set.roomWords = []; set.roomWalls = []; set.roomTables = [];
    for (const p of set.rooms) {
        const page = await pdf.getPage(p.num);
        set.roomWords.push(await F.pageWords(page));
        set.roomTables.push(p.expl ? await F.pageExplication(page) : null);
        set.roomWalls.push(await G.wallsOf(page, p.text));
    }
    const cand = set.pages.find(p => p.kind === 'plan' && /h\s*окна\s*=/i.test(p.text || ''));
    set.winSheet = cand ? { num: cand.num, title: cand.title, labels: await F.pageWindowLabels(await pdf.getPage(cand.num)) } : null;
    const eng = [];
    for (const kind of ['heat', 'water']) {
        const p = set.found.find(x => x.kind === kind && !set.rooms.some(r => r.num === x.num));
        if (!p) continue;
        const page = await pdf.getPage(p.num);
        eng.push({ kind, num: p.num, title: p.title, text: p.text, roomSheet: 0,
            labels: kind === 'heat' ? await F.pageLabels(page) : [],
            fixtures: kind === 'water' ? await F.pageFixtures(page) : null });
    }
    set.eng = eng;

    // Помещения — из экспликации PDF, как на сайте (fitExplication), будто
    // модель не прочитала ни одного. Таблицы нет — из эталона.
    let rows;
    const res0 = { rows: [], sheets: [{}] };
    P.fitExplication(res0, set);
    if (res0.rows.length) {
        rows = res0.rows;
        console.log(`Экспликация: ${rows.length} помещений, итог ${fmt(set.roomTables[0].total)} м²`);
    } else {
        console.log('Экспликация не разобрана — помещения из эталона');
        rows = et.rooms.map((r, i) => ({ name: r.name, area: r.area, windows: null, panoramic: 0, _sheet: 0, num: String(i + 1) }));
    }
    const etOf = r => et.rooms.find(e => e.name === r.name);
    et.rooms.filter(e => !rows.some(r => r.name === e.name)).forEach(e => console.log(`  ✗ нет помещения «${e.name}»`));
    const map = P.geoMap(rows, set, 0);
    if (!map) { console.log('Карта помещений не построилась: стен заливкой нет или подписей комнат меньше двух.'); return; }
    const noSeed = rows.filter(r => !map.rows.includes(r)).map(r => r.name);
    console.log(`Карта: ${map.w}×${map.h}, подписей комнат найдено ${map.rows.length} из ${rows.length}` +
        (noSeed.length ? ` (нет: ${noSeed.join(', ')})` : ''));

    // Окна — как readWindows, но без модели: что карта не нашла, то не найдено.
    if (set.winSheet) {
        const origAsk = ctx.RecognizeUI.askModel;
        ctx.RecognizeUI.askModel = async () => { throw new Error('модель на стенде не вызывается'); };
        ctx.RecognizeUI.cleanError = m => m;
        const res = await P.readWindows(rows, set, null);
        ctx.RecognizeUI.askModel = origAsk;
        res.summary.forEach(s => console.log('  ' + s));
        res.warnings.forEach(s => console.log('  ! ' + s));
    }
    rows.forEach(r => { r.eng = r.eng || {}; });
    for (const sh of eng) {
        const scope = rows;
        if (sh.kind === 'heat') {
            P.takeHeat({ rooms: [], ufhTotal: et.ufhTotal || null }, rows, sh, scope);
            // Зоны без подписи модель отмечает сама; на стенде — из эталона.
            rows.forEach(r => { const e = etOf(r); if (e && e.ufh === true) { r.eng.ufh = true; r.eng.ufhArea = null; r.eng.ufhAreaSrc = 'spec'; } });
            const g = P.geoHeat(sh, scope, map);
            (g ? g.summary : ['по чертежу не разложено']).forEach(s => console.log(`  Лист ${sh.num}: ${s}`));
            (g ? g.warnings : []).forEach(s => console.log('  ! ' + s));
        } else {
            P.takeWater({ rooms: [] }, rows, sh, scope);
            const g = P.geoWater(sh, scope, map);
            (g ? g.summary : ['по чертежу не разложено (нет спецификации с марками)']).forEach(s => console.log(`  Лист ${sh.num}: ${s}`));
            (g ? g.warnings : []).forEach(s => console.log('  ! ' + s));
        }
    }

    // Сверка с эталоном.
    let ok = 0, all = 0;
    const bad = [];
    const check = (room, field, want, got) => {
        all++;
        const same = typeof want === 'number' && typeof got === 'number' ? Math.abs(want - got) < 0.015 : want === got;
        if (same) ok++; else bad.push(`${room}: ${field} — эталон ${want}, стенд ${got}`);
    };
    rows.forEach(r => {
        const e = etOf(r), g = r.eng || {};
        if (!e) { bad.push(`${r.name}: лишнее помещение`); all++; return; }
        if ('area' in e) check(r.name, 'площадь', e.area, r.area);
        if ('windows' in e) check(r.name, 'окон', e.windows, r.windows === null ? '—' : r.windows);
        if ('floorWin' in e) check(r.name, 'окон в пол', e.floorWin, r.panoramic || 0);
        if ('ufh' in e) {
            if (e.ufh === true) check(r.name, 'тёплый пол', 'зона без подписи', g.ufh ? 'зона без подписи' : 'нет');
            else check(r.name, 'тёплый пол, м²', e.ufh || 0, g.ufh ? (g.ufhArea || 0) : 0);
        }
        if ('heaters' in e) check(r.name, 'приборов', e.heaters, g.heaters || 0);
        if ('fix' in e) FIX.forEach(k => check(r.name, k, (e.fix || {})[k] || 0, (g.fix || {})[k] || 0));
    });
    console.log(`\nСовпало ${ok} из ${all} (${Math.round(ok / all * 100)} %), ${fmt((Date.now() - t0) / 1000)} с`);
    bad.forEach(b => console.log('  ✗ ' + b));
})().catch(e => { console.error(e); process.exit(1); });
