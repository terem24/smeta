/**
 * Листы «Расчет теплопотерь» рабочих проектов: построчно конструкции каждой
 * комнаты — площадь, Тв, Тн, R, коэффициент n, потери в ваттах. Это единственное
 * место корпуса, где видно, ПО ЧЕМУ проектировщик получил свои ватты, — и можно
 * сверить с нашими допущениями (R окна, стены, пола, ΔT, добавки).
 *
 * Запуск (из корня worktree):
 *   node bench/heat_calc_sheets.js "D:\galf_chat2\files" "D:\galf_chat2\galf_heatcalc.json"
 *   node bench/heat_calc_sheets.js "D:\galf_chat2\files" --one 2020-105     — разбор одного файла
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const pdfjsLib = require(path.join(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.js'));
const ctx = {
    console, globalThis: null, setTimeout, clearTimeout, window: { pdfjsLib },
    RecognizeUI: { plural: (n, a) => a }, RecognizePlan: { PDF_CELL: '', PDF_TIP: '' },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'recognize_files.js'), 'utf8').replace(/^const (Recognize\w+) =/m, 'var $1 ='), ctx);
const F = ctx.RecognizeFiles;

const num = s => parseFloat(String(s).replace(',', '.').replace(/\s/g, ''));

/**
 * Строки листа → [{ floor, room, rows: [{ kind, count, area, tv, tn, R, n, q }], total }].
 * Длинный результат переносится: «… х 1,3 1» / «08 Вт» — склеиваем без пробела, пока
 * строка не кончится на «Вт».
 */
function parseSheet(lines, floorHint) {
    // 1. Склейка переносов.
    const merged = [];
    for (let i = 0; i < lines.length; i++) {
        let s = lines[i];
        if (/\d\s*°C\s+-?\d+\s*°C/.test(s) && !/Вт\s*$/.test(s)) {
            while (i + 1 < lines.length && !/Вт\s*$/.test(s) && merged.length < 10000) { s += lines[++i]; if (i - 0 > lines.length) break; if (/Вт\s*$/.test(lines[i])) break; }
        }
        merged.push(s);
    }
    const rooms = [];
    let floor = floorHint, cur = null;
    const ROW = /^(\d+(?:[.,]\d+)?)\s+(.+?)\s+(\d+)\s+([\d.,]+)\s*м\s?²\s+(-?\d+(?:[.,]\d+)?)\s*°C\s+(-?\d+(?:[.,]\d+)?)\s*°C\s+([\d.,]+)\s*\(\s*м\s?²[^)]*\)\s*\/\s*Вт\s+([\d.,]+)\s+.*?(\d+)\s*Вт\s*$/;
    for (const s of merged) {
        let m;
        if ((m = s.match(/^(\d+)\s*этаж\s+(\d+)\s*Вт$/i))) { floor = +m[1]; continue; }       // итог этажа
        if ((m = s.match(/^(\d+)\s*этаж$/i))) { floor = +m[1]; continue; }
        if ((m = s.match(/^(цоколь|мансард|подвал)[а-я]*$/i))) { floor = m[1]; continue; }
        if ((m = s.match(this_ROW_TOTAL))) {
            if (cur && cur.id === m[1]) { cur.total = +m[2]; }
            continue;
        }
        if (/^\d+(?:[.,]\d+)?$/.test(s)) { cur = { id: s, floor, rows: [], total: null }; rooms.push(cur); continue; }
        if ((m = s.match(ROW))) {
            if (!cur || cur.id !== m[1]) { cur = { id: m[1], floor, rows: [], total: null }; rooms.push(cur); }
            if (!cur.floorSet && /^\d+[.,]\d+$/.test(m[1])) { cur.floor = +m[1].split(/[.,]/)[0]; cur.floorSet = true; }
            cur.rows.push({ kind: m[2].trim(), count: +m[3], area: num(m[4]), tv: num(m[5]), tn: num(m[6]), R: num(m[7]), n: num(m[8]), q: +m[9] });
        }
    }
    return rooms;
}
const this_ROW_TOTAL = /^(\d+(?:[.,]\d+)?)\s+(\d+)\s*Вт$/;

async function sheetsOf(pdf) {
    const out = [];
    for (let p = 1; p <= pdf.numPages; p++) {
        let lines;
        try { lines = await F.pageLines(await pdf.getPage(p)); } catch (e) { continue; }
        // Заголовок листа — «Расчет теплопотерь …» в первых строках (или в штампе последним).
        const head = lines.slice(0, 14).concat(lines.slice(-6)).find(s => /^расч[её]т\s+теплопотер/i.test(s));
        if (!head) continue;
        if (!lines.some(s => /Конструкция\s+К-во|^#\s*Конструкция/i.test(s))) continue;
        out.push({ page: p, title: head, lines });
    }
    return out;
}

(async () => {
    const [dir, outOrFlag, needle] = process.argv.slice(2);
    const one = outOrFlag === '--one';
    const files = fs.readdirSync(dir).filter(n => /\.pdf$/i.test(n) && (!one || n.includes(needle)));
    const res = [];
    for (let i = 0; i < files.length; i++) {
        let pdf;
        try { pdf = await pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(dir, files[i]))), verbosity: 0 }).promise; } catch (e) { continue; }
        const sheets = await sheetsOf(pdf);
        pdf.destroy();
        if (!sheets.length) continue;
        const rooms = [];
        for (const sh of sheets) {
            const fl = /(\d+)\s*этаж/i.exec(sh.title);
            rooms.push(...parseSheet(sh.lines, fl ? +fl[1] : null));
        }
        const rows = rooms.reduce((a, r) => a + r.rows.length, 0);
        const sumRows = rooms.reduce((a, r) => a + r.rows.reduce((b, x) => b + x.q, 0), 0);
        const sumTot = rooms.reduce((a, r) => a + (r.total || 0), 0);
        res.push({ file: files[i], pages: sheets.map(s => s.page), rooms });
        console.log(`${files[i].slice(0, 44).padEnd(44)} листов ${sheets.length}, комнат ${rooms.length}, строк ${rows}, Σстрок ${sumRows} Вт, Σкомнат ${sumTot} Вт` +
            (sumTot && Math.abs(sumRows - sumTot) > sumTot * 0.03 ? '  ← РАСХОЖДЕНИЕ' : ''));
        if (one) rooms.slice(0, 8).forEach(r => console.log(`   комната ${r.id} (этаж ${r.floor}) итого ${r.total}: ` + r.rows.map(x => `${x.kind} ${x.area}м² R${x.R} →${x.q}`).join(' | ')));
    }
    if (!one && outOrFlag) {
        fs.writeFileSync(outOrFlag, JSON.stringify(res), 'utf8');
        console.log('Проектов с листом расчёта:', res.length, '| файл:', outOrFlag);
    }
})();
