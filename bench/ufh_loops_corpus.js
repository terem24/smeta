/**
 * Петли тёплого пола в рабочих проектах корпуса Galf: длина петли по шагу укладки,
 * сколько петель на лист этажа и сколько петель приходится на помещение — против
 * нашего предела длины (app.ufhLoopMax) и нашей разбивки.
 *
 * Подписи «Контур N / Шаг 150 мм / L= 74.6 м» читает боевой RecognizeFiles.pageLabels
 * (loopLabels), поэтому стенд меряет ровно то, что видит распознавание.
 *
 * Запуск (из корня worktree):
 *   node bench/ufh_loops_corpus.js "D:\galf_chat2\files"
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const pdfjsLib = require(path.join(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.js'));
const ctx = { console, globalThis: null, setTimeout, clearTimeout, window: { pdfjsLib },
    RecognizeUI: { plural: (n, a) => a }, RecognizePlan: { PDF_CELL: '', PDF_TIP: '' } };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'recognize_files.js'), 'utf8').replace(/^const (Recognize\w+) =/m, 'var $1 ='), ctx);
const F = ctx.RecognizeFiles;

const dir = process.argv[2];
if (!dir) { console.log('node bench/ufh_loops_corpus.js <папка с PDF>'); process.exit(0); }

const q = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * p))] : NaN; };

(async () => {
    const byStep = new Map(), perSheet = [];
    const seen = new Set();
    let projects = 0;
    for (const name of fs.readdirSync(dir).filter(n => /\.pdf$/i.test(n))) {
        let pdf;
        try { pdf = await pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(dir, name))), verbosity: 0 }).promise; } catch (e) { continue; }
        const loops = new Map();          // номер петли → {len, step}: на плане и 3D-виде одна и та же петля
        let sheets = 0;
        for (let p = 1; p <= Math.min(pdf.numPages, 120); p++) {
            let ls;
            try { ls = (await F.pageLabels(await pdf.getPage(p))).filter(l => l.loop); } catch (e) { continue; }
            if (ls.length < 2) continue;
            sheets++;
            const fresh = ls.filter(l => !loops.has(String(l.loop)));
            if (fresh.length) perSheet.push(fresh.length);
            ls.forEach(l => loops.set(String(l.loop), { len: l.len, step: l.step }));
        }
        pdf.destroy();
        if (!loops.size) continue;
        const sig = loops.size + '|' + [...loops.values()].reduce((a, l) => a + l.len, 0).toFixed(1);
        if (seen.has(sig)) continue;
        seen.add(sig);
        projects++;
        for (const l of loops.values()) { if (!byStep.has(l.step)) byStep.set(l.step, []); byStep.get(l.step).push(l.len); }
    }
    console.log(`Проектов с петлями (без копий): ${projects}`);
    console.log('\nДлина петли по шагу укладки, м:');
    console.log('шаг   петель   медиана   90 %   95 %   макс   доля > 80 м   > 90 м   > 100 м');
    for (const [st, a] of [...byStep].sort((x, y) => x[0] - y[0])) {
        if (a.length < 10) continue;
        const gt = v => Math.round(100 * a.filter(x => x > v).length / a.length);
        console.log(`${String(st).padStart(3)}  ${String(a.length).padStart(7)}   ${String(q(a, 0.5)).padStart(6)}  ${String(q(a, 0.9)).padStart(5)}  ${String(q(a, 0.95)).padStart(5)}  ${String(Math.max(...a)).padStart(5)}   ${String(gt(80)).padStart(6)} %  ${String(gt(90)).padStart(5)} %  ${String(gt(100)).padStart(5)} %`);
    }
    console.log(`\nПетель на лист этажа: медиана ${q(perSheet, 0.5)}, 90 % ${q(perSheet, 0.9)}, макс ${Math.max(...perSheet)}`);

    // Наш предел — из самого калькулятора.
    try {
        process.chdir(root);
        const app = require('./env.js');
        console.log('\nНаш предел длины петли (app.ufhLoopMax):', [100, 150, 200].map(s => `шаг ${s} → ${app.ufhLoopMax(s)} м`).join(', '));
    } catch (e) { console.log('env.js не поднялся:', e.message); }
})();
