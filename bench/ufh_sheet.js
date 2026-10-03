/**
 * Лист «Тёплый пол N этажа» без браузера: projectPlans.sheets на плане этажа,
 * собранном из прямоугольников комнат (в метрах). Пишет SVG листа и список петель —
 * чтобы сравнивать раскладку с проектными листами корпуса Galf глазами и числом.
 *
 * По умолчанию — первый этаж проекта 2024-544R (комнаты и коллектор сняты с листа
 * О-«Этаж 01. План напольного отопления»): у проектировщика там 10 петель и 552 м
 * трубы вместе с подводками. Подводки монтажник здесь не рисовал — их строит
 * автоматика (пучок от коллектора); стенд считает их пересечения между собой
 * (должно быть 0) и метры трассы поверх чужих тёплых полов.
 *
 * Запуск (из корня worktree):
 *   node bench/ufh_sheet.js <выход.svg>
 *   node bench/ufh_sheet.js <выход.svg> --step 100
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const out = process.argv[2] || path.join(root, 'ufh_sheet.svg');
const STEP = +(process.argv.includes('--step') ? process.argv[process.argv.indexOf('--step') + 1] : 150);

const ctx = { console, Math, JSON, String, Number, Array, Object, parseInt, parseFloat, isNaN, isFinite, setTimeout, clearTimeout };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = { createElement: () => ({ getContext: () => null, style: {} }) };
vm.createContext(ctx);
for (const f of ['project_sheets.js', 'project_plans.js'])
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const PP = ctx.projectPlans;

// Этаж 1 проекта 2024-544R: сетка осей 2200/2000/2000/2200 по X, 4500/2200/3900 по Y.
const ROOMS = [
    ['Гостиная', 0, 0, 4.2, 4.5], ['Кухня', 4.2, 0, 8.4, 4.5],
    ['Лестница', 0, 4.5, 3.0, 6.7], ['Холл', 3.0, 4.5, 4.2, 6.7], ['Прихожая', 6.2, 4.5, 8.4, 6.7],
    ['Спальня', 0, 6.7, 4.2, 10.6], ['Душевая, С/у', 4.2, 6.7, 6.2, 10.6],
];
const PPM = 50;                                  // пикселей подложки на метр
const pts = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(p => [p[0] * PPM + PPM, p[1] * PPM + PPM]);
const floor = {
    img: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
    pxPerM: PPM, w: 10.4 * PPM, h: 12.6 * PPM,
    zones: ROOMS.map(([name, ...r]) => ({ type: 'tp', name, pts: pts(...r) })),
    coll: { x: 8.3 * PPM + PPM, y: 7.3 * PPM + PPM },
};
const plans = { floors: [floor] };

const loops = PP.loopRows(floor, STEP, []);
console.log(`Шаг ${STEP} мм, предел петли ${PP.loopLimit(STEP)} м, петель ${loops.length}:`);
loops.forEach(r => console.log(`  ${String(r.no).padStart(2)}  ${r.name.padEnd(18)} ${PP.num1(r.area).padStart(5)} м²  ${String(r.m).padStart(4)} м`));
console.log('Всего трубы:', Math.round(loops.reduce((a, r) => a + r.m, 0)), 'м');

// Проверка рисунка — как читает лист монтажник:
//  • трубы разных петель не пересекаются и не ложатся одна на другую;
//  • пучок подводок (полоса шириной по числу труб) не ложится на петли;
//  • вид укладки по участкам: улитка / змейка.
const FL = PP.floorLoops(floor, STEP, PP.loopLimit(STEP));
const loopsAll = [];
FL.forEach(z => z.loops.forEach(l => { if (l.sup) loopsAll.push(l); }));
const segsOf = r => r.slice(1).map((p, i) => [r[i], p]);
const cross = (a, b) => {
    const [[x1, y1], [x2, y2]] = a, [[x3, y3], [x4, y4]] = b;
    const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
    if (Math.abs(d) < 1e-9) {                     // параллельные: наложение ближе трети шага
        const hz = Math.abs(y2 - y1) < 1e-6 && Math.abs(y4 - y3) < 1e-6, vt = Math.abs(x2 - x1) < 1e-6 && Math.abs(x4 - x3) < 1e-6;
        const tol = STEP / 1000 * PPM / 3;
        if (hz && Math.abs(y1 - y3) < tol) return Math.min(Math.max(x1, x2), Math.max(x3, x4)) - Math.max(Math.min(x1, x2), Math.min(x3, x4)) > tol;
        if (vt && Math.abs(x1 - x3) < tol) return Math.min(Math.max(y1, y2), Math.max(y3, y4)) - Math.max(Math.min(y1, y2), Math.min(y3, y4)) > tol;
        return false;
    }
    const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d, u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
    return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
};
let loopX = 0;
const lines = loopsAll.map(l => segsOf(l.sup).concat(segsOf(l.ret)));
for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++)
    for (const a of lines[i]) for (const b of lines[j]) if (cross(a, b)) loopX++;
// пучок — прямоугольник вокруг оси шириной по числу труб
let bandX = 0;
const segHitsBox = (s, bx) => {
    const [[x1, y1], [x2, y2]] = s;
    return Math.max(x1, x2) > bx[0] && Math.min(x1, x2) < bx[2] && Math.max(y1, y2) > bx[1] && Math.min(y1, y2) < bx[3];
};
(FL.bundle || []).forEach(sg => {
    const hw = sg.n * 0.02 * PPM;                 // полоса как на листе
    const bx = [Math.min(sg.a[0], sg.b[0]) - hw, Math.min(sg.a[1], sg.b[1]) - hw, Math.max(sg.a[0], sg.b[0]) + hw, Math.max(sg.a[1], sg.b[1]) + hw];
    // ввод петли в саму себя — не наложение, так её и подключают
    lines.forEach((L, li) => { if (sg.own !== loopsAll[li]) L.forEach(s => { if (segHitsBox(s, bx)) bandX++; }); });
});
// Пучок в середине комнаты: метры оси пучка дальше MID_M от стен своей зоны.
// Проектировщики ведут подводки вдоль стен и по коридорам — середина комнаты
// остаётся петлям.
const MID_M = 0.4;
const pip = (x, y, P) => { let c = false; for (let a = 0, b = P.length - 1; a < P.length; b = a++) if ((P[a][1] > y) !== (P[b][1] > y) && x < (P[b][0] - P[a][0]) * (y - P[a][1]) / (P[b][1] - P[a][1]) + P[a][0]) c = !c; return c; };
const segD = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; const t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L)) : 0; return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy); };
const wallDist = (x, y) => { for (const z of floor.zones) if (pip(x, y, z.pts)) { let d = Infinity; for (let a = 0, b = z.pts.length - 1; a < z.pts.length; b = a++) d = Math.min(d, segD(x, y, z.pts[b], z.pts[a])); return d / PPM; } return 0; };
let bundleM = 0, midM = 0;
(FL.bundle || []).forEach(sg => {
    const L = Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]) / PPM, n = Math.max(1, Math.ceil(L / 0.02));
    for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, d = wallDist(sg.a[0] + (sg.b[0] - sg.a[0]) * t, sg.a[1] + (sg.b[1] - sg.a[1]) * t);
        bundleM += L / n; if (d > MID_M) midM += L / n;
    }
});
console.log(`Пучок: ${bundleM.toFixed(1)} м по оси, из них в середине комнат (дальше ${MID_M} м от стен) ${midM.toFixed(1)} м`);
const kinds = loopsAll.reduce((a, l) => (a[l.kind] = (a[l.kind] || 0) + 1, a), {});
console.log(`Пересечений петель между собой: ${loopX}; пучок на петлях: ${bandX}; укладка: ` +
    Object.keys(kinds).map(k => (k === 'spiral' ? 'улитка ' : 'змейка ') + kinds[k]).join(', '));
const sh = PP.sheets(plans, { only: ['tp'], stepMm: STEP, code: 'СТЕНД', rooms: [] });
fs.writeFileSync(out, sh[0] ? sh[0].svg : '<svg/>', 'utf8');
console.log('Лист:', out);
