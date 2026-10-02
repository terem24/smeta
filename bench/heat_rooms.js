/**
 * Выгрузка помещений с теплопотерями проектировщика из корпуса рабочих проектов.
 *
 * Зачем. Экспликация рабочего проекта (ГОСТ 21.101) даёт название, площадь и
 * теплопотери каждой комнаты в ваттах — это расчёт проектировщика, с которым
 * можно сверить наш покомнатный расчёт (app.getRoomHeatLoss). Здесь — только
 * выгрузка в CSV, сверка — bench/heat_compare.js.
 *
 * Запуск (из корня worktree):
 *   node bench/heat_rooms.js "D:\galf_chat2\files" "D:\galf_chat2\galf_rooms.csv"
 *
 * Данные чужих проектов остаются на D:\, в репозиторий не попадают.
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
for (const f of ['recognize_geo.js', 'recognize_files.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8').replace(/^const (Recognize\w+) =/m, 'var $1 ='), ctx, { filename: f });
}
const F = ctx.RecognizeFiles;

const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.log('node bench/heat_rooms.js <папка с PDF> <выходной .csv>'); process.exit(0); }

const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';

(async () => {
    const rows = [];
    const seen = new Set();            // один и тот же проект бывает двумя файлами
    const files = fs.readdirSync(dir).filter(n => /\.pdf$/i.test(n));
    let projects = 0, dup = 0;
    for (let i = 0; i < files.length; i++) {
        let pdf;
        try { pdf = await pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(dir, files[i]))), verbosity: 0 }).promise; } catch (e) { continue; }
        let set = null;
        try { set = await F.projectSheets(pdf); } catch (e) { set = null; }
        if (!set || !set.gost) { pdf.destroy(); continue; }
        const got = [];
        for (const p of set.rooms) {
            let t = null;
            try { t = await F.pageExplication(await pdf.getPage(p.num)); } catch (e) { t = null; }
            if (!t || !t.rows.length) continue;
            const fl = F.sheetFloor(p.title);
            for (const r of t.rows) got.push({ sheet: p.num, floor: typeof fl === 'number' ? fl : '', num: r.num, name: r.name, area: r.area, heat: r.heat || '' });
        }
        pdf.destroy();
        if (!got.length) continue;
        // Подпись проекта: число комнат, сумма площадей и ватт — копии файла совпадают.
        const sig = got.length + '|' + Math.round(got.reduce((a, r) => a + (r.area || 0), 0) * 10) + '|' + got.reduce((a, r) => a + (+r.heat || 0), 0);
        if (seen.has(sig)) { dup++; continue; }
        seen.add(sig);
        projects++;
        got.forEach(r => rows.push([files[i], r.sheet, r.floor, r.num, r.name, r.area, r.heat]));
        if ((i + 1) % 25 === 0) process.stdout.write(`  ...${i + 1}/${files.length}\n`);
    }
    fs.writeFileSync(out, '﻿' + ['проект', 'лист', 'этаж', 'номер', 'помещение', 'площадь', 'теплопотери_Вт'].map(esc).join(';') + '\n' +
        rows.map(r => r.map(esc).join(';')).join('\n'), 'utf8');
    const withHeat = rows.filter(r => r[6]).length;
    console.log(`Проектов с экспликацией: ${projects} (копий пропущено ${dup}) | помещений ${rows.length} | с теплопотерями ${withHeat}`);
    console.log('Файл:', out);
})();
