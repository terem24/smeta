/**
 * Стенд отбора листов рабочего проекта (ОВ / ТМ / СО по ГОСТ 21.101).
 *
 * Зачем. RecognizeFiles.projectSheets писался на дизайн-проекте, где название
 * листа стоит первой строкой штампа. На 243 рабочих проектах из чата
 * проектировщиков он опознал комплект листов ровно у одного: там основная
 * надпись по ГОСТ 21.101, и название листа лежит в ней иначе.
 *
 * Запуск (из корня worktree):
 *   node bench/mep.js "D:\galf_chat2\files"            — счёт по всей папке
 *   node bench/mep.js "D:\galf_chat2\files" --dump 544 — текст листов одного
 *                                                        файла (по кусочку имени)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const pdfjsLib = require(path.join(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.js'));

const ctx = {
    console, globalThis: null, setTimeout, clearTimeout,
    window: { pdfjsLib },
    RecognizeUI: { plural: (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; } },
    RecognizePlan: { PDF_CELL: '', PDF_TIP: '' },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['recognize_geo.js', 'recognize_files.js', 'recognize_plan.js', 'recognize_project.js']) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    vm.runInContext(fs.readFileSync(p, 'utf8').replace(/^const (Recognize\w+) =/m, 'var $1 ='), ctx, { filename: f });
}
const F = ctx.RecognizeFiles;
const P = ctx.RecognizeProject;
const PL = ctx.RecognizePlan;

/** Вся цепочка без модели: листы -> экспликация -> помещения расчёта. */
async function chain(dir, needle) {
    const name = fs.readdirSync(dir).find(n => n.includes(needle) && /\.pdf$/i.test(n));
    if (!name) { console.log('нет файла с', needle); return; }
    const pdf = await open(path.join(dir, name));
    const set = await F.projectSheets(pdf);
    if (!set) { console.log(name + ': НЕ КОМПЛЕКТ'); return; }
    set.roomTables = [];
    for (const p of set.rooms) set.roomTables.push(await F.pageExplication(await pdf.getPage(p.num)));
    const plans = P.plansFromPdf(set);
    console.log('ФАЙЛ:', name, '| ГОСТ-проект:', !!set.gost, '| листов помещений:', set.rooms.length);
    if (!plans) { console.log('помещения без модели НЕ собрались — лист пойдёт модели'); return; }
    plans.forEach((sh, i) => {
        if (!sh) { console.log('лист ' + i + ': модели'); return; }
        const n = PL.normalizeSheet(sh, i, name, plans.length, null);
        console.log(`лист ${i} «${n.sheet.label}» этаж ${n.sheet.floorRaw}` +
            (n.sheet.floorGuessed ? ' (угадан)' : '') + `, итог ${n.sheet.totalArea} м²`);
        n.rows.forEach(r => console.log(`   ${r.num} ${r.name} — ${r.area} м²` +
            (r.heatPdf ? `, проект: ${r.heatPdf} Вт` : '') + (r._sel ? '' : '  [не в расчёт]')));
    });
}


const open = file => pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;

async function dump(dir, needle, pages) {
    const name = fs.readdirSync(dir).find(n => n.includes(needle) && /\.pdf$/i.test(n));
    if (!name) { console.log('нет файла с', needle); return; }
    console.log('ФАЙЛ:', name);
    const pdf = await open(path.join(dir, name));
    console.log('листов:', pdf.numPages);
    for (let i = 1; i <= Math.min(pages, pdf.numPages); i++) {
        const lines = await F.pageLines(await pdf.getPage(i));
        console.log(`=== лист ${i} (${lines.length} строк) ===`);
        const show = lines.length <= 16 ? lines.map((s, j) => [j, s])
            : [...lines.slice(0, 4).map((s, j) => [j, s]), [null, '...'],
               ...lines.slice(-10).map((s, j) => [lines.length - 10 + j, s])];
        show.forEach(([j, s]) => console.log('  ' + (j === null ? '' : j + ': ') + s));
    }
}

/**
 * Почему файл не опознался. Главный подозреваемый — битая кодировка шрифтов:
 * у части проектов pdf.js вместо «Заказчик» отдаёт «4>47G<>», текстового слоя
 * фактически нет, и правилами такой лист не прочитать ничем.
 */
async function why(dir, needle) {
    const names = fs.readdirSync(dir).filter(n => n.includes(needle) && /\.pdf$/i.test(n));
    for (const name of names) {
        const pdf = await open(path.join(dir, name));
        const all = [];
        for (let p = 1; p <= Math.min(pdf.numPages, 40); p++) {
            try { all.push(...await F.pageLines(await pdf.getPage(p))); } catch (e) { /* пусто */ }
        }
        const text = all.join('\n');
        const cyr = (text.match(/[А-Яа-яЁё]/g) || []).length;
        const lat = (text.match(/[A-Za-z]/g) || []).length;
        const titled = [];
        for (let p = 1; p <= pdf.numPages; p++) {
            const lines = await F.pageLines(await pdf.getPage(p));
            const t = F.sheetTitle(lines);
            if (t) titled.push(t);
        }
        const set = await F.projectSheets(pdf);
        console.log(`${name}: листов ${pdf.numPages}, с названием ${titled.length}, ` +
            `кириллицы ${cyr}, латиницы ${lat}, комплект: ${set ? 'да' : 'НЕТ'}`);
        if (!set) console.log('   названия: ' + titled.slice(0, 6).join(' | ').slice(0, 300));
    }
}

/** Все строки одного листа — целиком. */
async function linesOf(dir, needle, pageNum) {
    const name = fs.readdirSync(dir).find(n => n.includes(needle) && /\.pdf$/i.test(n));
    const pdf = await open(path.join(dir, name));
    const lines = await F.pageLines(await pdf.getPage(pageNum));
    lines.forEach((s, i) => console.log('  ' + i + ': ' + s));
}

/** Куски текста вокруг заголовка «Экспликация» — с координатами, как их видит pdf.js. */
async function items(dir, needle, pageNum) {
    const name = fs.readdirSync(dir).find(n => n.includes(needle) && /\.pdf$/i.test(n));
    const pdf = await open(path.join(dir, name));
    const page = await pdf.getPage(pageNum);
    const c = await page.getTextContent();
    const vp = page.getViewport({ scale: 1 });
    const all = c.items.map(t => {
        const [x, y] = vp.convertToViewportPoint(t.transform[4], t.transform[5]);
        return { s: String(t.str || '').replace(/\s+/g, ' ').trim(),
            x: Math.round(x / vp.width * 1000) / 10, y: Math.round(y / vp.height * 1000) / 10 };
    }).filter(i => i.s);
    const head = all.find(i => /кспликаци/i.test(i.s)) || all.find(i => /аименовани/i.test(i.s));
    if (!head) { console.log('нет заголовка «Экспликация» на листе', pageNum); return; }
    console.log(`заголовок: «${head.s}» x=${head.x} y=${head.y}`);
    all.filter(i => i.y >= head.y - 0.5 && i.y < head.y + 14)
        .sort((a, b) => (a.y - b.y) || (a.x - b.x))
        .forEach(i => console.log(`   x=${i.x}\ty=${i.y}\t${i.s}`));
}

/** Экспликация помещений с листов проекта — то, что читается без модели. */
async function expl(dir, needle) {
    const name = fs.readdirSync(dir).find(n => n.includes(needle) && /\.pdf$/i.test(n));
    if (!name) { console.log('нет файла с', needle); return; }
    const pdf = await open(path.join(dir, name));
    const set = await F.projectSheets(pdf);
    if (!set) { console.log(name + ': НЕ КОМПЛЕКТ'); return; }
    console.log('ФАЙЛ:', name);
    for (const p of set.rooms) {
        const t = await F.pageExplication(await pdf.getPage(p.num));
        console.log(`лист ${p.num} «${p.title}» expl=${p.expl}: ` + (t ? `${t.rows.length} помещений, итог ${t.total}` : 'НЕ ПРОЧИТАНА'));
        if (t) t.rows.forEach(r => console.log(`   ${r.num} ${r.name} — ${r.area}` + (r.heat ? ` м², ${r.heat} Вт` : ' м²')));
    }
}

/** Разбор одного файла: что увидел projectSheets. */
async function one(dir, needle) {
    const name = fs.readdirSync(dir).find(n => n.includes(needle) && /\.pdf$/i.test(n));
    if (!name) { console.log('нет файла с', needle); return; }
    const pdf = await open(path.join(dir, name));
    const set = await F.projectSheets(pdf);
    console.log('ФАЙЛ:', name, '| листов:', pdf.numPages);
    if (!set) { console.log('НЕ КОМПЛЕКТ'); return; }
    console.log('адрес:', set.address);
    console.log('визуализаций:', set.visual, '| примечаний:', (set.notes || []).length);
    console.log('нужные листы:');
    set.found.forEach(p => console.log('  ' + p.num + ' [' + p.kind + '] ' + p.title));
    console.log('листы помещений:', set.rooms.map(p => p.num + ' «' + p.title + '»').join(', '));
}

async function run(dir) {
    const files = fs.readdirSync(dir).filter(n => /\.pdf$/i.test(n)).map(n => path.join(dir, n));
    let sets = 0, projects = 0, none = 0;
    let explAny = 0, explAll = 0, roomsTotal = 0, heatRooms = 0;
    const kinds = {};
    const miss = [];
    for (let i = 0; i < files.length; i++) {
        const f = files[i];
        let pdf;
        try { pdf = await open(f); } catch (e) { continue; }
        const lines1 = await F.pageLines(await pdf.getPage(1));
        const all = [];
        for (let p = 1; p <= Math.min(pdf.numPages, 60); p++) {
            try { all.push(...await F.pageLines(await pdf.getPage(p))); } catch (e) { /* пусто */ }
        }
        // Проект это или книга — по основной надписи, как в galf_cards.js.
        const stamps = (all.join('\n').match(/(Кол\.?\s?уч|Изм\.|N\s?докум|Подп\.\s?и\s?дата|Инв\.\s?N|Взам\.\s?инв)/gi) || []).length;
        if (stamps < 3) continue;
        projects++;
        let set = null;
        try { set = await F.projectSheets(pdf); } catch (e) { set = null; }
        if (set) {
            sets++;
            for (const p of set.found) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
            // Экспликация помещений: сколько проектов отдают комнаты без модели.
            let read = 0, rooms = 0, heat = 0;
            for (const p of set.rooms) {
                const t = await F.pageExplication(await pdf.getPage(p.num));
                if (!t) continue;
                read++;
                rooms += t.rows.length;
                heat += t.rows.filter(r => r.heat).length;
            }
            if (read) {
                explAny++;
                if (read === set.rooms.length) explAll++;
                roomsTotal += rooms;
                heatRooms += heat;
            }
        } else {
            none++;
            if (miss.length < 10) miss.push(path.basename(f) + '  (листов ' + pdf.numPages + ')');
        }
        if ((i + 1) % 25 === 0) process.stdout.write(`  ...${i + 1}/${files.length}\n`);
    }
    console.log('');
    console.log('Проектов (по штампу):', projects);
    console.log('Опознано комплектов листов:', sets, '—', Math.round(100 * sets / (projects || 1)) + '%');
    console.log('Не опознано:', none);
    console.log('Разделы в опознанных:', JSON.stringify(kinds));
    console.log('Экспликация прочитана хотя бы на одном листе:', explAny,
        '| на всех листах помещений:', explAll);
    console.log('Помещений прочитано:', roomsTotal, '| из них с теплопотерями:', heatRooms);
    if (miss.length) {
        console.log('');
        console.log('Примеры неопознанных:');
        miss.forEach(s => console.log('  ' + s));
    }
}

(async () => {
    const dir = process.argv[2];
    if (!dir) { console.log('укажите папку с PDF'); return; }
    const d = process.argv.indexOf('--dump');
    const o = process.argv.indexOf('--one');
    const y = process.argv.indexOf('--why');
    if (y > 0) { await why(dir, process.argv[y + 1]); return; }
    const ch = process.argv.indexOf('--chain');
    if (ch > 0) { await chain(dir, process.argv[ch + 1]); return; }
    const ln = process.argv.indexOf('--lines');
    if (ln > 0) { await linesOf(dir, process.argv[ln + 1], +process.argv[ln + 2]); return; }
    const it = process.argv.indexOf('--items');
    if (it > 0) { await items(dir, process.argv[it + 1], +process.argv[it + 2]); return; }
    const e = process.argv.indexOf('--expl');
    if (e > 0) { await expl(dir, process.argv[e + 1]); return; }
    if (d > 0) await dump(dir, process.argv[d + 1], +(process.argv[d + 2] || 3));
    else if (o > 0) await one(dir, process.argv[o + 1]);
    else await run(dir);
})();
