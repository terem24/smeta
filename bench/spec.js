/**
 * Замер: спецификация рабочего проекта → позиции прайса ТЕРЕМ по артикулу.
 *
 * Зачем. Распознавание рабочего проекта берёт из него помещения и приборы, а смету
 * собирает нашим подбором. В проекте же есть спецификация: «3 Кран шаровой … DN25
 * R854X025 Giacomini шт. 2». Прежде чем строить «смету по спецификации», меряем:
 * сколько строк читается и какая доля артикулов есть в прайсе.
 *
 * Две цифры по каждому артикулу:
 *  - «нынешний подбор» — правило matchByArticle (recognize_match.js): код ≥ 8 знаков,
 *    буквы и не меньше двух цифр, точное совпадение или префикс (хвост фасовки);
 *  - «колонка артикула» — тот же код, но взятый прямо из колонки таблицы, без
 *    ограничения на вид: так ловятся «1070529» Uponor и «VTi.961.I».
 *
 * Запуск (из корня worktree):
 *   node bench/spec.js "D:\galf_chat2\files"            — весь корпус
 *   node bench/spec.js "D:\galf_chat2\files" --one 544R — один файл, строки на экран
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
vm.runInContext(fs.readFileSync(path.join(root, 'recognize_files.js'), 'utf8')
    .replace(/^const (Recognize\w+) =/m, 'var $1 ='), ctx, { filename: 'recognize_files.js' });
const F = ctx.RecognizeFiles;

// ---------------------------------------------------------------- прайс
// Прайс: свежий индекс с сервера (--price путь), иначе копия из репозитория — она бывает
// старее: в копии от 9.09 нет Energoflex SUPRS-400, добавленного сборщиком 22.09.
const priceArg = process.argv.indexOf('--price') > 0 ? process.argv[process.argv.indexOf('--price') + 1] : null;
const price = JSON.parse(fs.readFileSync(priceArg || path.join(root, 'price_index.json'), 'utf8'));
console.log('Прайс:', price.version, 'собран', price.built, '| позиций', price.items.length);
const norm = s => String(s || '').replace(/[\s.\-\/]/g, '').toUpperCase();
const byArt = new Map();
for (const it of price.items) {
    const k = norm(it.a);
    if (k.length >= 4 && !byArt.has(k)) byArt.set(k, it);
}
const keys = [...byArt.keys()];

/** Правило нынешнего подбора: длинный смешанный код. */
const ruleOk = k => k.length >= 8 && /[A-ZА-Я]/.test(k) && (k.match(/\d/g) || []).length >= 2;

function lookup(raw) {
    const k = norm(raw);
    if (k.length < 4) return null;
    if (byArt.has(k)) return { how: 'точно', it: byArt.get(k) };
    // Хвост фасовки/цвета: код в проекте короче кода в прайсе.
    if (k.length >= 6) {
        let best = null;
        for (const kk of keys) {
            if (kk.length > k.length && kk.startsWith(k) && (!best || Number(byArt.get(kk).p) < Number(best.p))) best = byArt.get(kk);
        }
        if (best) return { how: 'префикс', it: best };
    }
    return null;
}

// ---------------------------------------------------------------- разбор строк
// Шапка таблицы со столбцом артикула.
const HEAD_RE = /наименован/i;
const HEAD_ART_RE = /(артикул|код\b|код\s+(продукции|изделия)|обозначение)/i;
const UNIT_RE = /^(шт\.?|м\.?|п\.?\s?м\.?|пог\.?\s?м\.?|компл\.?|к-т|кг|л|м2|м²|упак\.?|бухта|рулон|пара|ед\.?)$/i;
const NUM_RE = /^\d+([.,]\d+)?$/;

/**
 * Строка таблицы справа налево: … артикул производитель ед. кол-во [примечание].
 * Производитель — 1–3 слова без цифр; артикул — слово с цифрами сразу перед ним.
 */
function parseRow(line) {
    const m = line.match(/^(\d{1,3})\s+(.+)$/);
    if (!m) return null;
    const t = m[2].split(/\s+/);
    // кол-во и ед.: ищем последнюю пару «ед. число» (примечание после неё отбрасываем)
    let u = -1;
    for (let i = t.length - 2; i >= 1; i--) {
        if (UNIT_RE.test(t[i]) && NUM_RE.test(t[i + 1])) { u = i; break; }
    }
    if (u < 2) return null;
    const qty = parseFloat(t[u + 1].replace(',', '.'));
    const unit = t[u].replace(/\.$/, '');
    let j = u - 1;
    const mf = [];
    while (j >= 1 && mf.length < 3 && !/\d/.test(t[j]) && /^[A-ZА-ЯЁa-z]/.test(t[j]) && !/^[а-яё]/.test(t[j])) {
        mf.unshift(t[j]);
        j--;
    }
    // Производитель обычно с заглавной/латиницей; «шаровой», «наружной» и пр. сюда не попадают.
    // Артикул — слово с цифрами. Чисто цифровой («1070529» Uponor, «09404105» Termoclip)
    // берём от пяти цифр: размеры и количества такими не бывают.
    const isArt = w => /\d/.test(w) && /^[A-Za-zА-Яа-я0-9][A-Za-zА-Яа-я0-9.\-\/]{3,}$/.test(w) &&
        (!/^\d+([.,]\d+)?(мм|м)?$/.test(w) || /^\d{5,}$/.test(w));
    let art = null, alts = [];
    if (j >= 1 && isArt(t[j])) {
        art = t[j];
        // STOUT пишут код через пробелы: «SMB 6851 013402» = SMB-6851-013402.
        // Склейки из двух и трёх последних слов — кандидаты, выберет прайс.
        for (let w = 2; w <= 3 && j - w + 1 >= 1; w++) {
            const seg = t.slice(j - w + 1, j + 1);
            if (seg.every(x => /^[A-Za-z0-9.\-]+$/.test(x))) alts.push({ code: seg.join(' '), take: w });
        }
        j--;
    }
    const name = t.slice(0, j + 1).join(' ');
    if (!/[а-яё]{3}/i.test(name)) return null;
    return { pos: m[1], name, art, alts, maker: mf.join(' ') || null, unit, qty };
}

async function specRows(pdf) {
    const rows = [];
    let tables = 0;
    for (let p = 1; p <= pdf.numPages; p++) {
        let lines;
        try { lines = await F.pageLines(await pdf.getPage(p)); } catch (e) { continue; }
        for (let h = 0; h < lines.length; h++) {
            if (!HEAD_RE.test(lines[h]) || !HEAD_ART_RE.test(lines[h])) continue;
            tables++;
            for (let i = h + 1; i < lines.length; i++) {
                if (HEAD_RE.test(lines[i]) && HEAD_ART_RE.test(lines[i])) break;
                const r = parseRow(lines[i]);
                if (r) rows.push(Object.assign(r, { page: p }));
            }
        }
    }
    return { rows, tables };
}

// ---------------------------------------------------------------- запуск
const open = file => pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;

(async () => {
    const dir = process.argv[2];
    const one = process.argv.indexOf('--one') > 0 ? process.argv[process.argv.indexOf('--one') + 1] : null;
    const files = fs.readdirSync(dir).filter(n => /\.pdf$/i.test(n) && (!one || n.includes(one)));
    const all = [];
    let projects = 0, withSpec = 0, withArt = 0;
    for (let i = 0; i < files.length; i++) {
        let pdf;
        try { pdf = await open(path.join(dir, files[i])); } catch (e) { continue; }
        let set = null;
        try { set = await F.projectSheets(pdf); } catch (e) { set = null; }
        if (!set || !set.gost) continue;
        projects++;
        const { rows } = await specRows(pdf);
        if (rows.length) withSpec++;
        if (rows.some(r => r.art)) withArt++;
        for (const r of rows) {
            let hit = r.art ? lookup(r.art) : null;
            // Код через пробелы: пробуем склейки, и если прайс узнал — это и есть артикул.
            if (!hit && r.alts) {
                for (const a of r.alts) {
                    const h = lookup(a.code);
                    if (h) {
                        hit = h;
                        r.art = a.code;
                        r.name = r.name.split(' ').slice(0, Math.max(1, r.name.split(' ').length - (a.take - 1))).join(' ');
                        break;
                    }
                }
            }
            all.push(Object.assign(r, { file: files[i], rule: r.art ? ruleOk(norm(r.art)) : false,
                hit: hit ? hit.how : '', pa: hit ? hit.it.a : '', pn: hit ? hit.it.n : '', pp: hit ? hit.it.p : '' }));
        }
        if (one) {
            rows.forEach(r => console.log(`  ${r.pos.padStart(3)} | ${r.name.slice(0, 60).padEnd(60)} | ${String(r.art || '—').padEnd(16)} | ${String(r.maker || '—').padEnd(14)} | ${r.unit} ${r.qty} | ${r.hit ? r.hit + ': ' + r.pa : 'нет'}`));
        }
        if ((i + 1) % 25 === 0) process.stdout.write(`  ...${i + 1}/${files.length}\n`);
    }

    const withA = all.filter(r => r.art);
    const found = withA.filter(r => r.hit);
    const foundRule = withA.filter(r => r.hit && r.rule);
    const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '—';
    console.log('');
    console.log('Рабочих проектов:', projects, '| со спецификацией:', withSpec, '| с колонкой артикула:', withArt);
    console.log('Строк спецификации прочитано:', all.length, '| из них с артикулом:', withA.length);
    console.log('Артикул найден в прайсе ТЕРЕМ:', found.length, '(' + pct(found.length, withA.length) + ')',
        '| из них точно:', found.filter(r => r.hit === 'точно').length, '| по префиксу:', found.filter(r => r.hit === 'префикс').length);
    console.log('Нашёл бы нынешний подбор (правило ≥8 знаков, буквы+цифры):', foundRule.length, '(' + pct(foundRule.length, withA.length) + ')');

    // По производителям
    const mk = new Map();
    for (const r of withA) {
        const k = (r.maker || '—').toLowerCase();
        const o = mk.get(k) || { n: 0, f: 0 };
        o.n++;
        if (r.hit) o.f++;
        mk.set(k, o);
    }
    console.log('');
    console.log('По производителям (строк с артикулом / найдено в прайсе):');
    [...mk].sort((a, b) => b[1].n - a[1].n).slice(0, 30).forEach(([k, o]) =>
        console.log(`  ${k.slice(0, 24).padEnd(24)} ${String(o.n).padStart(5)}  ${String(o.f).padStart(5)}  ${pct(o.f, o.n).padStart(4)}`));

    const out = path.join(path.dirname(dir), one ? 'galf_spec_one.csv' : 'galf_spec_rows.csv');
    const esc = v => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
    const head = ['файл', 'лист', 'поз', 'наименование', 'артикул', 'производитель', 'ед', 'кол', 'правило подбора', 'найдено', 'артикул прайса', 'название прайса', 'цена'];
    fs.writeFileSync(out, '\ufeff' + head.map(esc).join(';') + '\n' + all.map(r =>
        [r.file, r.page, r.pos, r.name, r.art, r.maker, r.unit, r.qty, r.rule ? 'да' : 'нет', r.hit, r.pa, r.pn, r.pp].map(esc).join(';')).join('\n'), 'utf8');
    console.log('');
    console.log('Все строки:', out);
})();
