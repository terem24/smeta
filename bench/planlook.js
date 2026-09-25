/**
 * Стенд догадки «план этажа или смета» (RecognizeUI.planScore).
 *
 * Зачем. Снимок плана без догадки читается двумя запросами к модели: первым —
 * по правилам сметы, и только услышав в ответ «это план», вторым — по правилам
 * плана. Догадка смотрит на картинку арифметикой и экономит первый запрос.
 * Цена ошибки несимметрична: не узнать план — потерять один запрос (как было
 * раньше), а принять смету за план — потратить лишний и показать человеку
 * невнятное «помещений не нашлось». Поэтому пороги подбираются так, чтобы
 * догадка скорее промолчала, и стенд следит именно за этим.
 *
 * Запуск:
 *   node bench/planlook.js                  — рисованные листы, ожидания зашиты
 *   node bench/planlook.js <папка>          — настоящие листы: подпапки
 *                                             plan/ и estimate/ задают ответ
 *
 * Настоящие картинки (jpg, png) переводит в серый Pillow — он уже стоит вместе
 * с остальными питоновскими скриптами проекта. Нет Pillow — стенд скажет об
 * этом и отработает на рисованных.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

// ── Объект распознавания без браузера ───────────────────────────────────────
// Берём из recognize.js только сам объект: ниже он вешается на window и
// подписывается на DOMContentLoaded, а здесь ни того, ни другого нет.
function loadUI() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'recognize.js'), 'utf8');
    const cut = src.indexOf('window.RecognizeUI = RecognizeUI;');
    if (cut < 0) throw new Error('не нашёлся конец объекта RecognizeUI в recognize.js');
    const ctx = { console };
    vm.createContext(ctx);
    vm.runInContext(src.slice(0, cut) + '\nthis.UI = RecognizeUI;', ctx);
    return ctx.UI;
}

// ── Рисованные листы ────────────────────────────────────────────────────────
// Каждый — массив яркостей 0..255, как его отдаёт grayOf после уменьшения.
function sheet(w, h) {
    const g = new Uint8Array(w * h).fill(250);
    return {
        w, h, g,
        dot(x, y) { if (x >= 0 && y >= 0 && x < w && y < h) g[y * w + x] = 20; },
        line(x1, y1, x2, y2, th) {
            const t = th || 1;
            const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
            for (let i = 0; i <= n; i++) {
                const x = Math.round(x1 + (x2 - x1) * i / n), y = Math.round(y1 + (y2 - y1) * i / n);
                for (let a = 0; a < t; a++) for (let b = 0; b < t; b++) this.dot(x + a, y + b);
            }
        },
        rect(x1, y1, x2, y2, th) {
            this.line(x1, y1, x2, y1, th); this.line(x2, y1, x2, y2, th);
            this.line(x2, y2, x1, y2, th); this.line(x1, y2, x1, y1, th);
        },
        // Строка текста: череда коротких штрихов — букв
        text(x, y, len, step) {
            for (let i = 0; i < len; i += (step || 3)) {
                this.line(x + i, y, x + i, y + 4, 1);
                if (i % 9 === 0) this.line(x + i, y + 4, x + i + 1, y + 4, 1);
            }
        },
    };
}

function drawPlan() {
    const s = sheet(400, 300);
    s.rect(30, 30, 370, 250, 3);                 // наружные стены
    s.line(170, 30, 170, 250, 3);                // перегородка
    s.line(170, 140, 370, 140, 3);
    s.line(30, 190, 170, 190, 3);
    s.line(250, 140, 250, 250, 3);
    s.line(30, 22, 370, 22, 1);                  // размерная цепочка
    s.line(22, 30, 22, 250, 1);
    s.text(60, 90, 60);                          // «Кухня 14,2 м²»
    s.text(200, 70, 70);
    s.text(200, 180, 50);
    s.text(60, 215, 55);
    return s;
}

function drawPrintedEstimate() {
    const s = sheet(400, 560);
    s.rect(20, 20, 380, 540, 1);                 // рамка таблицы
    [70, 130, 300].forEach(x => s.line(x, 20, x, 540, 1));   // колонки
    for (let y = 40; y < 540; y += 18) {         // строки со словами
        s.line(20, y, 380, y, 1);
        s.text(26, y + 5, 36); s.text(76, y + 5, 48); s.text(136, y + 5, 150); s.text(306, y + 5, 60);
    }
    return s;
}

function drawHandEstimate() {
    const s = sheet(400, 560);
    for (let y = 40; y < 540; y += 22) s.text(30, y, 300 + (y % 7) * 10, 4);
    return s;
}

function drawInvoiceWithLogo() {
    const s = sheet(400, 560);
    s.rect(24, 60, 376, 120, 2);                 // шапка счёта
    s.text(34, 30, 140); s.text(34, 44, 200);
    s.rect(24, 150, 376, 520, 1);
    [80, 240, 310].forEach(x => s.line(x, 150, x, 520, 1));
    for (let y = 170; y < 520; y += 20) {
        s.line(24, y, 376, y, 1);
        s.text(30, y + 6, 44); s.text(86, y + 6, 145); s.text(246, y + 6, 58); s.text(316, y + 6, 54);
    }
    return s;
}

function drawPhoto() {
    const s = sheet(400, 300);
    for (let i = 0; i < s.g.length; i++) s.g[i] = 60 + ((i * 2654435761) % 120);
    return s;
}

function drawBlank() {
    return sheet(400, 300);
}

/**
 * Лист, снятый на телефон: тень поперёк страницы, зерно матрицы и лёгкий
 * смаз. Проверяем на нём главное — смета и в таком виде не должна сойти за
 * план. Про сам план спрос мягче: не узнали — потеряли один запрос, не более.
 */
function photoize(s) {
    const { w, h, g } = s;
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            // Смаз 3×3 — объектив телефона с рук
            let sum = 0, n = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = x + dx, yy = y + dy;
                    if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
                    sum += g[yy * w + xx]; n++;
                }
            }
            let v = sum / n;
            v *= 0.62 + 0.38 * (1 - x / w);          // тень от руки с одного края
            v += ((i * 2654435761) % 31) - 15;       // зерно
            out[i] = Math.max(0, Math.min(255, v | 0));
        }
    }
    return { w, h, g: out };
}

// Счёт на четыре позиции: строк мало, рамка есть, внутри ячеек пусто — то
// есть внешне ближе всего к плану. Самый опасный лист для догадки.
function drawShortInvoice() {
    const s = sheet(400, 560);
    s.rect(24, 40, 376, 200, 1);
    [80, 240, 310].forEach(x => s.line(x, 40, x, 200, 1));
    for (let y = 70; y < 200; y += 32) {
        s.line(24, y, 376, y, 1);
        s.text(30, y + 10, 44); s.text(86, y + 10, 140); s.text(246, y + 10, 56); s.text(316, y + 10, 52);
    }
    s.text(30, 220, 150); s.text(30, 240, 90);
    return s;
}

const DRAWN = [
    { name: 'план этажа', want: true, make: drawPlan },
    { name: 'смета таблицей', want: false, make: drawPrintedEstimate },
    { name: 'смета от руки', want: false, make: drawHandEstimate },
    { name: 'счёт поставщика', want: false, make: drawInvoiceWithLogo },
    { name: 'фотография', want: false, make: drawPhoto },
    { name: 'пустой лист', want: false, make: drawBlank },
    { name: 'счёт на 4 позиции', want: false, make: drawShortInvoice },
    { name: 'план на телефон', want: true, soft: true, make: () => photoize(drawPlan()) },
    { name: 'счёт 4 на телефон', want: false, make: () => photoize(drawShortInvoice()) },
    { name: 'смета на телефон', want: false, make: () => photoize(drawPrintedEstimate()) },
    { name: 'от руки на телефон', want: false, make: () => photoize(drawHandEstimate()) },
    { name: 'счёт на телефон', want: false, make: () => photoize(drawInvoiceWithLogo()) },
];

// ── Настоящие листы ─────────────────────────────────────────────────────────
const PY = 'import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert("L");' +
    'im.thumbnail((480,480));sys.stdout.buffer.write(b"P5\\n%d %d\\n255\\n"%im.size);' +
    'sys.stdout.buffer.write(im.tobytes())';

function grayOfFile(file) {
    const out = execFileSync('python', ['-c', PY, file], { maxBuffer: 1 << 26 });
    // PGM: P5, размеры, 255, дальше байты яркости
    let p = 0, head = [];
    while (head.length < 4) {
        const nl = out.indexOf(0x0a, p);
        String(out.slice(p, nl)).trim().split(/\s+/).forEach(v => head.push(v));
        p = nl + 1;
    }
    const w = +head[1], h = +head[2];
    return { g: new Uint8Array(out.slice(p, p + w * h)), w, h };
}

function realSheets(dir) {
    const out = [];
    for (const [sub, want] of [['plan', true], ['estimate', false]]) {
        const d = path.join(dir, sub);
        if (!fs.existsSync(d)) continue;
        for (const f of fs.readdirSync(d)) {
            if (!/\.(jpe?g|png|webp|bmp|tiff?)$/i.test(f)) continue;
            out.push({ name: `${sub}/${f}`, want, file: path.join(d, f) });
        }
    }
    return out;
}

// ── Прогон ──────────────────────────────────────────────────────────────────
function pct(v) { return (v * 100).toFixed(1) + '%'; }

function main() {
    const UI = loadUI();
    const dir = process.argv[2];
    const cases = dir ? realSheets(dir) : DRAWN;
    if (dir && !cases.length) {
        console.log(`В ${dir} нет подпапок plan/ и estimate/ с картинками.`);
        process.exit(2);
    }

    let bad = 0, saved = 0, wasted = 0;
    for (const c of cases) {
        let px;
        try {
            px = c.file ? grayOfFile(c.file) : (m => ({ g: m.g, w: m.w, h: m.h }))(c.make());
        } catch (e) {
            console.log(`  ?  ${c.name}: снимок не прочитан (${String(e.message).split('\n')[0]})`);
            bad++; continue;
        }
        const r = UI.planScore(px);
        const ok = r.plan === c.want;
        // soft — лист, который узнать желательно, но не обязательно: промах
        // здесь стоит одного запроса, а не неверного разбора
        if (!ok && !c.soft) bad++;
        if (ok && c.want) saved++;            // запрос сэкономлен
        if (!ok && !c.want) wasted++;         // смету примем за план — лишний запрос
        const w = r.why || {};
        const num = (v) => (v === undefined ? '—' : (v < 1 && v > 0 ? pct(v) : v));
        console.log(`  ${ok ? 'ok' : (c.soft ? ' ~' : 'НЕТ')} ${c.name.padEnd(22)} план=${String(r.plan).padEnd(5)} ` +
            `ждали=${String(c.want).padEnd(5)} чернил=${num(w.inkFrac)} линий=${num(w.hLong)}/${num(w.vLong)} ` +
            `строк=${num(w.bands)} пусто=${num(w.emptyFrac)} перегородок=${num(w.partial)}`);
    }

    console.log(`\nЛистов ${cases.length}, расхождений ${bad}` +
        ` · планов узнано сразу: ${saved} (столько запросов сбережено)` +
        ` · смет принято за план: ${wasted}`);
    process.exit(bad ? 1 : 0);
}

main();
