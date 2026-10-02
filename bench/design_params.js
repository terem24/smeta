/**
 * Что проектировщики пишут в листах рабочего проекта: температурный график
 * радиаторов и тёплого пола, высота потолков, внутренние температуры, давление
 * в системе. Из этого — значения по умолчанию калькулятора, подкреплённые
 * практикой, а не догадкой.
 *
 * Считаем ПРОЕКТЫ, а не вхождения: график 70/55 на десяти листах одного дома —
 * один голос. Копии одного файла (одинаковая подпись листов) пропускаются.
 *
 * Запуск (из корня worktree):
 *   node bench/design_params.js "D:\galf_chat2\files" "D:\galf_chat2\galf_params.json"
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

const [dir, out] = process.argv.slice(2);
if (!dir) { console.log('node bench/design_params.js <папка с PDF> [<выход .json>]'); process.exit(0); }

const num = s => parseFloat(String(s).replace(',', '.'));
// Каждое правило: имя, регулярка по тексту всего проекта (строки склеены пробелом), группы → значение.
const RULES = [
    // «Температурный график 70/50», «Параметры теплоносителя 75/65 °C», «режим работы системы 80/60»
    { key: 'график радиаторов', rx: /(?:температурн\S*\s+график\S*|параметр\S*\s+теплоноситель\S*|режим\S*\s+работ\S*\s+систем\S*|температур\S*\s+теплоноситель\S*|теплоноситель\S*\s+-?\s*вод\S*)[^.\d]{0,60}?(\d{2,3})\s*[\/-]\s*(\d{2,3})\s*(?:°|˚|ºС|С|C)/gi, fmt: m => `${m[1]}/${m[2]}`, ok: m => +m[1] > +m[2] && +m[1] <= 95 && +m[2] >= 30 },
    // Тёплый пол: «40/30», «45/35», «35/28» рядом со словами про пол
    { key: 'график тёплого пола', rx: /(?:т[её]пл\S*\s+пол\S*|напольн\S*\s+отоплен\S*)[^.\d]{0,80}?(\d{2})\s*[\/-]\s*(\d{2})\s*(?:°|˚|ºС|С|C)/gi, fmt: m => `${m[1]}/${m[2]}`, ok: m => +m[1] > +m[2] && +m[1] <= 55 },
    // Высота потолков: «высота потолков 2,7 м», «h=3,0 м»
    { key: 'высота потолков, м', rx: /высот\S*\s+(?:потолк\S*|помещени\S*|этаж\S*)[^.\d]{0,30}?([2-4][.,]\d{1,2})\s*м/gi, fmt: m => num(m[1]).toFixed(1), ok: m => num(m[1]) >= 2.4 && num(m[1]) <= 4.5 },
    // Давление в системе: «рабочее давление 2 бар», «давление в системе отопления 1,5 бар»
    { key: 'давление в системе, бар', rx: /(?:рабочее\s+давление|давление\s+в\s+систем\S*)[^.\d]{0,50}?(\d[.,]?\d?)\s*бар/gi, fmt: m => num(m[1]).toFixed(1), ok: m => num(m[1]) >= 0.5 && num(m[1]) <= 6 },
    // Шаг укладки: «шаг 150 мм»
    { key: 'шаг укладки тёплого пола, мм', rx: /шаг\S*\s+укладк\S*[^.\d]{0,40}?(\d{2,3})\s*мм/gi, fmt: m => m[1], ok: m => +m[1] >= 50 && +m[1] <= 300 },
    // Запас мощности котла: «запас мощности 15 %»
    { key: 'запас мощности котла, %', rx: /запас\S*\s+(?:по\s+)?мощност\S*[^.\d]{0,30}?(\d{1,2})\s*%/gi, fmt: m => m[1], ok: m => +m[1] >= 3 && +m[1] <= 50 },
    // Кратность воздухообмена: «воздухообмен 0,35», «кратность 0.5 1/ч»
    { key: 'кратность воздухообмена, 1/ч', rx: /(?:кратност\S*(?:\s+воздухообмен\S*)?|воздухообмен\S*)[^.\d]{0,30}?(\d[.,]\d{1,2})\s*(?:1\s*\/\s*ч|ч-1|в\s+час|крат)/gi, fmt: m => num(m[1]).toFixed(2), ok: m => num(m[1]) >= 0.2 && num(m[1]) <= 3 },
];

(async () => {
    const files = fs.readdirSync(dir).filter(n => /\.pdf$/i.test(n));
    const seen = new Set();
    const res = RULES.map(r => ({ key: r.key, byProject: [] }));
    let projects = 0;
    for (let i = 0; i < files.length; i++) {
        let pdf;
        try { pdf = await pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(dir, files[i]))), verbosity: 0 }).promise; } catch (e) { continue; }
        let set = null;
        try { set = await F.projectSheets(pdf); } catch (e) { set = null; }
        if (!set || !set.gost) { pdf.destroy(); continue; }
        // Весь текст проекта (без тяжёлых листов — спецификаций и экспликаций пока не режем: нужны только ключевые фразы).
        const parts = [];
        for (let p = 1; p <= Math.min(pdf.numPages, 80); p++) {
            try { parts.push((await F.pageLines(await pdf.getPage(p))).join(' ')); } catch (e) { /* пусто */ }
        }
        pdf.destroy();
        const text = parts.join('\n').replace(/\s+/g, ' ');
        const sig = pdf.numPages + '|' + text.length;
        if (seen.has(sig)) continue;
        seen.add(sig);
        projects++;
        RULES.forEach((rule, k) => {
            const vals = new Map();
            for (const m of text.matchAll(rule.rx)) if (rule.ok(m)) { const v = rule.fmt(m); vals.set(v, (vals.get(v) || 0) + 1); }
            if (vals.size) res[k].byProject.push({ file: files[i], values: [...vals] });
        });
        if ((i + 1) % 25 === 0) process.stdout.write(`  ...${i + 1}/${files.length}\n`);
    }
    console.log(`\nПроектов (комплектов по ГОСТ, без копий): ${projects}`);
    for (const r of res) {
        // Голос проекта — самое частое значение в нём (график называют на каждом листе).
        const win = new Map();
        r.byProject.forEach(p => { const best = p.values.sort((a, b) => b[1] - a[1])[0][0]; win.set(best, (win.get(best) || 0) + 1); });
        const tot = r.byProject.length;
        console.log(`\n${r.key} — указано в ${tot} проектах (${Math.round(100 * tot / projects)} %):`);
        [...win].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([v, n]) => console.log(`  ${String(v).padEnd(10)} ${String(n).padStart(4)}  ${Math.round(100 * n / tot)} %`));
    }
    if (out) fs.writeFileSync(out, JSON.stringify(res), 'utf8');
})();
