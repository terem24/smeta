/**
 * Сквозная проверка «PDF рабочего проекта → спецификация → подбор» на коде сайта:
 * RecognizeFiles.projectSheets (set.spec) → RecognizeMatch.specItem → matchSpec.
 *
 * Запуск (из корня worktree):
 *   node bench/spec_pdf.js "D:\galf_chat2\files" 544R --index "D:\galf_tools\price_index_live.json"
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const flag = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const [dir, needle] = argv;
const INDEX = flag('--index') || path.join(ROOT, 'price_index.json');

const pdfjsLib = require(path.join(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.js'));
const ctx = { console, globalThis: null, setTimeout, clearTimeout, window: { pdfjsLib },
    RecognizeUI: { plural: (n, a) => a }, RecognizePlan: { PDF_CELL: '', PDF_TIP: '' } };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'recognize_files.js'), 'utf8')
    .replace(/^const (Recognize\w+) =/m, 'var $1 ='), ctx, { filename: 'recognize_files.js' });
const F = ctx.RecognizeFiles;

const sb = { console, document: { createElement: () => ({ style: {} }) }, window: {},
    navigator: { userAgent: 'node' }, localStorage: { getItem: () => null, setItem: () => {} }, module: undefined };
sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'catalog.js'), 'utf8') + '\n;\n' +
    fs.readFileSync(path.join(ROOT, 'recognize_match.js'), 'utf8') + '\n;\nglobalThis.__RM = RecognizeMatch;\n', sb);
const RM = sb.__RM;
RM.setPriceIndex(JSON.parse(fs.readFileSync(INDEX, 'utf8')).items);

(async () => {
    const name = fs.readdirSync(dir).find(n => n.includes(needle) && /\.pdf$/i.test(n));
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(dir, name))), verbosity: 0 }).promise;
    const set = await F.projectSheets(pdf);
    console.log('ФАЙЛ:', name, '| ГОСТ:', !!(set && set.gost), '| строк спецификации:', set ? set.spec.length : 0);
    if (!set || !set.spec.length) return;
    const t = { код: 0, аналог: 0, нет: 0 };
    for (const row of set.spec) {
        const rec = RM.specItem(row);
        const r = RM.matchSpec(rec, null);
        const kind = r.m ? (r.m.byArticle ? 'код' : 'аналог') : 'нет';
        t[kind]++;
        console.log(`  ${kind.padEnd(6)} | ${String(rec.qty).padStart(6)} ${rec.unit.padEnd(5)} | ${rec.raw.slice(0, 55).padEnd(55)} | ` +
            `${String((row.codes || [])[0] || '—').padEnd(16)} → ${r.m ? (r.m.item.id + ' ' + String(r.m.item.name).slice(0, 40)) : r.why}`);
    }
    console.log('\nИтог:', JSON.stringify(t), '| разделы:', [...new Set(set.spec.map(r => r.section))].slice(0, 8).join(' / '));
})();
