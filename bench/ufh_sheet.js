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

// Пересечения автоматических подводок между собой (по осям пар): на листе их
// быть не должно — пучок от гребёнки разводится без перехлёстов.
const routes = [], owner = [];
PP.floorLoops(floor, STEP, PP.loopLimit(STEP)).forEach(z => z.loops.forEach(l => { if (Array.isArray(l.autoLead)) { routes.push(l.autoLead); owner.push(z.i); } }));
// и сколько метров трассы идёт поверх чужих тёплых полов (транзит)
const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
let transitM = 0;
routes.forEach((r, k) => r.slice(1).forEach((b, i) => {
    const a = r[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / 5));
    for (let j = 0; j < n; j++) {
        const t = (j + 0.5) / n, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        if (floor.zones.some((z, zi) => zi !== owner[k] && inPoly(p, z.pts))) transitM += L / n / PPM;
    }
}));
const segs = r => r.slice(1).map((p, i) => [r[i], p]);
const cross = (a, b) => {
    const [[x1, y1], [x2, y2]] = a, [[x3, y3], [x4, y4]] = b;
    const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
    if (Math.abs(d) < 1e-9) return false;
    const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d, u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
    return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
};
let nx = 0;
for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++)
    for (const a of segs(routes[i])) for (const b of segs(routes[j])) if (cross(a, b)) nx++;
console.log(`Подводок: ${routes.length}, пересечений между ними: ${nx}, по чужим тёплым полам: ${Math.round(transitM)} м трассы`);

const sh = PP.sheets(plans, { only: ['tp'], stepMm: STEP, code: 'СТЕНД', rooms: [] });
fs.writeFileSync(out, sh[0] ? sh[0].svg : '<svg/>', 'utf8');
console.log('Лист:', out);
