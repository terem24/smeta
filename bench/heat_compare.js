/**
 * Сверка теплопотерь: расчёт проектировщика (листы «Расчет теплопотерь» корпуса
 * Galf) против допущений нашего getRoomHeatLoss — на ОДНОЙ и той же геометрии.
 *
 * Берём у проектировщика площади конструкций, Тв и Тн каждой комнаты и считаем,
 * что дал бы наш расчёт с нашими R по умолчанию: стена 1,8, окно 0,51, кровля
 * 3,95, пол — зоны по грунту, вентиляция n = 0,35. Так видно, какое допущение
 * тянет итог, а не только «общий процент». Наши R и порядок формул — из
 * bench/env.js (значения, которые отдаёт getRoomHeatLoss при пустых настройках).
 *
 * Запуск (из корня worktree):
 *   node bench/heat_compare.js "D:\galf_chat2\galf_heatcalc.json"
 */
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) { console.log('node bench/heat_compare.js <galf_heatcalc.json>'); process.exit(0); }
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

// Наши допущения по умолчанию — снимаются со стенда, а не копируются руками.
process.chdir(path.join(__dirname, '..'));
let OURS = { R_wall: 1.8, R_glz: 0.51, R_roof: 3.95, R_floorConstr: 2.8, R_door: 0.7, n_vent: 0.35, H: 2.7 };
try {
    const app = require('./env.js');
    const L = app.getRoomHeatLoss({ id: 1, name: 'Гостиная', area: 20, floor: 1, windows: [{ width: 1.5 }] });
    OURS = { R_wall: L.R_wall, R_glz: L.R_glz, R_roof: L.R_roof, R_floorConstr: L.R_floorConstr, R_door: L.R_door || 0.7, n_vent: L.n_vent, H: app.state.h1 || 2.7 };
} catch (e) { console.warn('env.js не поднялся, беру значения по умолчанию:', e.message); }
const R_ZONES = [2.1, 4.3, 8.6, 14.2];

const kindOf = s => {
    s = String(s).toLowerCase();
    if (/окн|остекл|витраж|светопроз/.test(s)) return 'окно';
    if (/двер|ворота/.test(s)) return 'дверь';
    if (/стен/.test(s)) return 'стена';
    if (/кровл|потолок|перекрыт|чердак|покрыт/.test(s)) return 'кровля';
    if (/пол/.test(s)) return 'пол';
    return 'иное';
};
const median = a => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
const q = (a, p) => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * p))] : NaN; };
const f1 = v => Number.isFinite(v) ? (Math.round(v * 10) / 10).toString() : '—';
const f2 = v => Number.isFinite(v) ? (Math.round(v * 100) / 100).toFixed(2) : '—';

// Копии одного проекта в корпусе (файл дважды) считаем один раз.
const seen = new Set();
const projects = [];
for (const p of data) {
    const rooms = p.rooms.filter(r => r.rows.length);
    if (!rooms.length) continue;
    const sig = rooms.length + '|' + rooms.reduce((a, r) => a + r.rows.reduce((b, x) => b + x.q, 0), 0);
    if (seen.has(sig)) continue;
    seen.add(sig);
    projects.push({ file: p.file, rooms });
}

const comp = {};       // составляющая → { n, A, theirs, ours, R: [] }
const add = (k, A, theirs, ours, R) => {
    const c = comp[k] || (comp[k] = { n: 0, A: 0, theirs: 0, ours: 0, R: [] });
    c.n++; c.A += A; c.theirs += theirs; c.ours += ours; if (R) c.R.push(R);
};
const perProject = [];
const tvAll = [], tnAll = [], nAll = [];

for (const pr of projects) {
    let T = 0, T0 = 0, Oenv = 0, Ovent = 0;
    const tn = [];
    for (const rm of pr.rooms) {
        const rows = rm.rows;
        const tv = rows[0].tv, tnr = rows[0].tn, dT = tv - tnr;
        tvAll.push(tv); tn.push(tnr); tnAll.push(tnr);
        rows.forEach(r => nAll.push(r.n));
        const by = {};
        rows.forEach(r => { const k = kindOf(r.kind); by[k] = (by[k] || 0) + r.area; });
        const outerA = (by['стена'] || 0) + (by['окно'] || 0) + (by['дверь'] || 0);
        const outerPerim = outerA / OURS.H;
        let ours = 0;
        for (const r of rows) {
            const k = kindOf(r.kind), d = r.tv - r.tn;
            const theirsQ = r.q, theirs0 = r.area * d / r.R;       // без коэффициента n
            T += theirsQ; T0 += theirs0;
            let o = 0;
            if (k === 'окно') o = r.area * d / OURS.R_glz;
            else if (k === 'стена') o = r.area * d / OURS.R_wall;
            else if (k === 'дверь') o = r.area * d / OURS.R_door;
            else if (k === 'кровля') o = r.area * d / OURS.R_roof;
            else if (k === 'пол') {
                // Зоны по грунту, как в getRoomHeatLoss: полосы 2 м по наружному периметру комнаты.
                let rest = r.area, z = [0, 0, 0, 0];
                if (outerPerim > 0.1) { for (let i = 0; i < 3 && rest > 0.01; i++) { const a = Math.min(rest, outerPerim * 2); z[i] = a; rest -= a; } z[3] = rest > 0.01 ? rest : 0; }
                else z[2] = r.area;
                o = z.reduce((s, a, i) => s + (a > 0 ? a * d / (R_ZONES[i] + OURS.R_floorConstr) : 0), 0);
            }
            if (k !== 'иное') add(k, r.area, theirs0, o, r.R);
            ours += o;
        }
        Oenv += ours;
        // Вентиляция по нашей формуле: объём комнаты по площади пола (или кровли, если пола нет).
        const A = by['пол'] || by['кровля'] || 0;
        const vent = dT > 0 ? A * OURS.H * OURS.n_vent * 0.34 * dT : 0;
        Ovent += vent;
    }
    const O = Oenv + Ovent;
    perProject.push({ file: pr.file, rooms: pr.rooms.length, tn: median(tn), T, T0, Oenv, Ovent, O,
        ratio: O / T, ratioEnv: Oenv / T0, ratioSame: (T0 + Ovent) / T, A: pr.rooms.reduce((a, r) => a + Math.max(...['пол', 'кровля'].map(k => r.rows.filter(x => kindOf(x.kind) === k).reduce((s, x) => s + x.area, 0))), 0) });
}

console.log(`Проектов с листом расчёта: ${projects.length} | комнат ${projects.reduce((a, p) => a + p.rooms.length, 0)}`);
console.log(`Наши допущения (стенд): R стены ${OURS.R_wall}, окна ${OURS.R_glz}, кровли ${OURS.R_roof}, пола ${OURS.R_floorConstr} + зона грунта, n вент. ${OURS.n_vent}, h ${OURS.H} м`);
console.log(`Проектировщик: Тв медиана ${f1(median(tvAll))} °C, Тн медиана ${f1(median(tnAll.length ? tnAll : []))}, коэффициент n: ${[...new Set(nAll)].sort().join(', ')}`);

console.log('\nСОСТАВЛЯЮЩИЕ (одна геометрия, ΔT проектировщика; «их» — без коэффициента n):');
console.log('составляющая  строк   Σ площади   R проектировщика (медиана; 25–75 %)   наш R   их Вт     наши Вт   наши/их');
for (const k of ['стена', 'окно', 'дверь', 'кровля', 'пол']) {
    const c = comp[k]; if (!c) continue;
    const ourR = { 'стена': OURS.R_wall, 'окно': OURS.R_glz, 'дверь': OURS.R_door, 'кровля': OURS.R_roof, 'пол': OURS.R_floorConstr + ' + грунт' }[k];
    console.log(`${k.padEnd(12)} ${String(c.n).padStart(5)} ${f1(c.A).padStart(11)}   ${f2(median(c.R))} (${f2(q(c.R, 0.25))}–${f2(q(c.R, 0.75))})`.padEnd(66) +
        ` ${String(ourR).padStart(10)} ${String(Math.round(c.theirs)).padStart(9)} ${String(Math.round(c.ours)).padStart(9)}   ${f2(c.ours / c.theirs)}`);
}
const sum = k => perProject.reduce((a, p) => a + p[k], 0);
console.log(`\nИТОГО по проектам: проектировщик ${Math.round(sum('T'))} Вт (без коэффициента n ${Math.round(sum('T0'))}), ` +
    `наш расчёт ограждения ${Math.round(sum('Oenv'))} + вентиляция ${Math.round(sum('Ovent'))} = ${Math.round(sum('O'))} Вт`);
const rO = perProject.map(p => p.ratio), rE = perProject.map(p => p.ratioEnv);
console.log(`наш полный / их полный по проектам: медиана ${f2(median(rO))}, 25–75 %: ${f2(q(rO, 0.25))}–${f2(q(rO, 0.75))}, мин ${f2(Math.min(...rO))}, макс ${f2(Math.max(...rO))}`);
const rS = perProject.map(p => p.ratioSame);
console.log(`НАША ФОРМУЛА ПРИ ИХ R (ограждения по их R + наша вентиляция n=0,35, без их n) / их полный: медиана ${f2(median(rS))}, 25–75 %: ${f2(q(rS, 0.25))}–${f2(q(rS, 0.75))}, мин ${f2(Math.min(...rS))}, макс ${f2(Math.max(...rS))}`);
console.log(`наши ограждения / их без n: медиана ${f2(median(rE))}, 25–75 %: ${f2(q(rE, 0.25))}–${f2(q(rE, 0.75))}`);
const wm2 = perProject.filter(p => p.A > 30).map(p => p.T / p.A);
console.log(`\nУДЕЛЬНЫЕ ПОТЕРИ дома, Вт на м² площади пола: проектировщик — медиана ${f1(median(wm2))}, 25–75 %: ${f1(q(wm2, 0.25))}–${f1(q(wm2, 0.75))}; наш быстрый расчёт (37 Вт/м³ × h 2,7 м, регион «Центр») — ${f1(37 * 2.7)}`);
console.log('\nПО ПРОЕКТАМ (Тн, комнат, их Вт, наши Вт, наши/их):');
perProject.sort((a, b) => a.ratio - b.ratio).forEach(p =>
    console.log(`  ${p.file.slice(0, 40).padEnd(40)} Тн ${String(p.tn).padStart(4)}  ${String(p.rooms).padStart(3)}  ${String(Math.round(p.T)).padStart(6)}  ${String(Math.round(p.O)).padStart(6)}  ${f2(p.ratio)}`));
