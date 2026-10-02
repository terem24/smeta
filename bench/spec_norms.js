/**
 * Нормы расходников по реальным проектам: сколько хомутов, изоляции, фитингов,
 * ленты и крепежа проектировщики кладут на метр трубы — из спецификаций рабочих
 * проектов корпуса Galf, ПО СИСТЕМАМ (водоснабжение, радиаторы, тёплый пол,
 * канализация, котельная). По смете целиком считать нельзя: у тёплого пола
 * сотни метров трубы без единого фитинга, у котельной десятки фитингов на
 * десяток метров, и отношение «в целом» показывает лишь долю этих систем.
 *
 * Строки — боевой RecognizeFiles.projectSheets(...).spec (с названием раздела).
 * Читаются только таблицы с колонкой артикула — других спецификаций код не берёт.
 * Одна и та же строка на нескольких листах (3D-вид повторяет таблицу плана) —
 * считается один раз. Копии одного файла — один проект.
 *
 * Запуск (из корня worktree):
 *   node bench/spec_norms.js "D:\galf_chat2\files" "D:\galf_chat2\galf_norms.json"
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

const { SYSTEMS, systemOf, CATS, catOf } = require('./norm_cats.js');
const lc = s => String(s || '').toLowerCase().replace(/ё/g, 'е');
// Труба и изоляция в спецификации считаются метрами; строка в штуках («Евроконус для трубы», «трубка в штангах») — не метры.
const MET = r => /^м$|пог/.test(lc(r.unit));
const catRow = r => { const c = catOf(r); return ((c === 'труба' || c === 'изоляция, м') && !MET(r)) ? null : c; };

const [dir, out] = process.argv.slice(2);
if (!dir) { console.log('node bench/spec_norms.js <папка с PDF> [<выход .json>]'); process.exit(0); }

(async () => {
    const files = fs.readdirSync(dir).filter(n => /\.pdf$/i.test(n));
    const seen = new Set();
    const projects = [];
    for (let i = 0; i < files.length; i++) {
        let pdf;
        try { pdf = await pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(dir, files[i]))), verbosity: 0 }).promise; } catch (e) { continue; }
        let set = null;
        try { set = await F.projectSheets(pdf); } catch (e) { set = null; }
        pdf.destroy();
        if (!set || !set.gost || !(set.spec || []).length) continue;
        const sig = set.spec.length + '|' + Math.round(set.spec.reduce((a, r) => a + (+r.qty || 0), 0));
        if (seen.has(sig)) continue;
        seen.add(sig);
        // Одна строка на нескольких листах — одна.
        const uniq = new Map();
        for (const r of set.spec) {
            const k = [r.section, r.name, r.art, r.qty, r.unit].join('|');
            if (!uniq.has(k)) uniq.set(k, r);
        }
        const bySys = {};
        for (const r of uniq.values()) {
            const sys = systemOf(r.section);
            if (!sys) continue;
            const cat = catRow(r);
            if (!cat) continue;
            const o = (bySys[sys] = bySys[sys] || {});
            o[cat] = (o[cat] || 0) + (+r.qty || 0);
        }
        projects.push({ file: files[i], rows: uniq.size, bySys });
        if ((i + 1) % 25 === 0) process.stdout.write(`  ...${i + 1}/${files.length}\n`);
    }
    if (out) fs.writeFileSync(out, JSON.stringify(projects), 'utf8');

    const q = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * p))] : NaN; };
    const f2 = v => Number.isFinite(v) ? (Math.round(v * 100) / 100).toFixed(2) : '—';
    console.log(`\nПроектов со спецификацией по артикулам (без копий): ${projects.length}`);
    for (const [sys] of SYSTEMS) {
        const list = projects.filter(p => p.bySys[sys] && (p.bySys[sys]['труба'] || 0) >= 20);
        if (!list.length) continue;
        console.log(`\n=== ${sys}: проектов с трубой ≥ 20 м в разделе — ${list.length}; труба, м (медиана ${Math.round(q(list.map(p => p.bySys[sys]['труба']), 0.5))})`);
        console.log('категория               у скольких проектов есть   на 1 м трубы: медиана   25–75 %');
        for (const [cat] of CATS) {
            if (cat === 'труба') continue;
            const v = list.map(p => (p.bySys[sys][cat] || 0) / p.bySys[sys]['труба']);
            const has = v.filter(x => x > 0);
            if (!has.length) continue;
            console.log(`${cat.padEnd(22)} ${String(has.length).padStart(5)} (${String(Math.round(100 * has.length / list.length)).padStart(3)} %)               ${f2(q(has, 0.5)).padStart(6)}            ${f2(q(has, 0.25))}–${f2(q(has, 0.75))}`);
        }
    }
})();
