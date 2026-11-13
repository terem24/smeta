/**
 * Стенд ядра дома (house_core.js): ручные случаи с проверкой чисел и, если дан файл корпуса Galf, сверка самой
 * формулы Q = A·(tв − tн)/R·n с расчётами проектировщиков построчно.
 *
 *   node bench/house_core.js [D:\galf_chat2\galf_heatcalc.json]
 *
 * Код выхода 0 — все ручные случаи сошлись. Сверка с Galf только печатает расхождения (там округления проектировщика).
 */
const fs = require('fs');
const path = require('path');
const HC = require(path.join(__dirname, '..', 'house_core.js'));

let fail = 0;
const eq = (what, got, want, tol) => {
    const ok = Math.abs(got - want) <= (tol === undefined ? 1e-6 : tol);
    if (!ok) fail++;
    console.log((ok ? 'ok   ' : 'FAIL ') + what + ': ' + (Math.round(got * 1000) / 1000) + (ok ? '' : ' (ждали ' + want + ')'));
};

// 1. Одна комната 5 x 4, стена R 3.0, окно 1.5x1.5, h 2.7, Тн -25, Тв 20, первый и последний этаж
{
    const m = HC.create({ Tn: -25, settings: { R_wallDefault: 3.0, wallThick: 0 } });
    const f = HC.addFloor(m, { level: 0 });
    const P = [[0, 0], [5, 0], [5, 4], [0, 4]];
    const w = P.map((p, i) => HC.addWall(m, { floor: f.id, a: p, b: P[(i + 1) % 4] }));
    HC.addOpening(m, { wall: w[0].id, offset: 1, width: 1.5, height: 1.5 });
    const rooms = HC.detectRooms(m, f.id);
    eq('одна комната: найдено помещений', rooms.length, 1);
    eq('одна комната: площадь', rooms[0].area, 20);
    eq('одна комната: периметр', rooms[0].perimeter, 18);
    const L = HC.heatLoss(m).rooms[0];
    const dT = 45, h = 2.7;
    const part = n => L.parts.filter(p => p.what.indexOf(n) === 0).reduce((s, p) => s + p.Q, 0);
    // стены: периметр 18 · 2.7 = 48.6 м² минус окно 2.25; ориентация: южная (низ плана, нормаль -Y) 1.0, остальные 1.10 или 1.05
    const k = { S: 1.0, E: 1.10, N: 1.10, W: 1.05 };
    const wallsQ = (5 * h - 2.25) * dT / 3.0 * k.S + (4 * h) * dT / 3.0 * k.E + (5 * h) * dT / 3.0 * k.N + (4 * h) * dT / 3.0 * k.W;
    eq('одна комната: стены', part('стена'), wallsQ, 1e-6);
    eq('одна комната: окно', part('окно'), 2.25 * dT / 0.51 * k.S, 1e-6);
    // пол: периметр 18 · 2 = 36 + 4 угла · 4 = 52 > 20 → вся площадь в зоне I
    eq('одна комната: пол, зона I', part('пол, зона 1'), 20 * dT / (2.1 + 2.8), 1e-6);
    eq('одна комната: кровля', part('кровля'), 20 * dT / 3.95, 1e-6);
    eq('одна комната: вентиляция', part('вентиляция'), 20 * h * 0.35 * 0.34 * dT, 1e-6);
}

// 2. Т-примыкания: пример дома 10 x 8 делится на три комнаты, площади складываются в 80
{
    const m = HC.sampleHouse();
    const rooms = HC.detectRooms(m, m.floors[0].id);
    eq('пример: помещений', rooms.length, 3);
    eq('пример: сумма площадей по осям', rooms.reduce((s, r) => s + r.areaGross, 0), 80, 1e-6);
    const areas = rooms.map(r => Math.round(r.areaGross)).sort((a, b) => a - b);
    eq('пример: меньшая комната 4x4', areas[0], 16);
    const L = HC.heatLoss(m);
    const inner = L.rooms.reduce((n, r) => n + r.parts.filter(p => /внутренняя/.test(p.what)).length, 0);
    console.log('     внутренних стен в расчёте (со стороны тёплой комнаты): ' + inner);
    // симметрия: санузел (25 °C) теряет в соседние комнаты, они (20 °C) ему — нет
    const bath = L.rooms.find(r => r.name === 'Санузел');
    eq('пример: санузел отдаёт в соседей', bath.parts.filter(p => /внутренняя/.test(p.what)).length > 0 ? 1 : 0, 1);
    const bedroom = L.rooms.find(r => r.name === 'Спальня');
    eq('пример: спальня не греет санузел', bedroom.parts.filter(p => /к «Санузел»/.test(p.what)).length, 0);
    console.log('     итого по примеру: ' + Math.round(L.total) + ' Вт, ' + Math.round(L.total / 80) + ' Вт/м²');
    L.rooms.forEach(r => console.log('     ' + r.name + ': ' + r.area.toFixed(1) + ' м², ' + Math.round(r.Q) + ' Вт'));
}

// 2б. Чистая площадь: комната 5 x 4 по осям при стенах 0,2 м — (5 − 0,2)(4 − 0,2) = 18,24
{
    const m = HC.create({ Tn: -25, settings: { wallThick: 0.2 } });
    const f = HC.addFloor(m, { level: 0 });
    const P = [[0, 0], [5, 0], [5, 4], [0, 4]];
    P.forEach((p, i) => HC.addWall(m, { floor: f.id, a: p, b: P[(i + 1) % 4] }));
    const r = HC.detectRooms(m, f.id)[0];
    eq('чистая площадь комнаты 5x4 при стенах 0,2 м', r.area, 18.24, 1e-9);
    eq('площадь по осям', r.areaGross, 20, 1e-9);
}

// 3. Импорт контуров комнат: общие стены склеиваются, Т-примыкание режет стену, шум в 5 см снимается привязкой
{
    const m = HC.create({ Tn: -25 });
    const f = HC.addFloor(m, { level: 0 });
    const polys = [
        { name: 'Гостиная', pts: [[0, 0], [6, 0.03], [6.04, 4], [0, 4.02]] },
        { name: 'Спальня', pts: [[6.02, 0.0], [10, 0], [10.03, 4], [6, 4]] },
        { name: 'Кухня', pts: [[0, -4], [10, -4.02], [10, 0], [0, -0.02]], tv: 22 }
    ];
    const r = HC.fromPolygons(m, f.id, polys, {});
    eq('импорт: найдено комнат', r.rooms, 3);
    eq('импорт: стен без дублей (гостиная 4, спальня 3 новых, кухня 3 новых)', r.walls, 10);
    const rooms = HC.detectRooms(m, f.id);
    eq('импорт: сумма площадей по осям', Math.round(rooms.reduce((s, x) => s + x.areaGross, 0)), 80);
    const names = rooms.map(x => x.name).sort().join(',');
    console.log('     имена комнат из контуров: ' + names + (names === 'Гостиная,Кухня,Спальня' ? '' : '  <-- не те'));
    if (names !== 'Гостиная,Кухня,Спальня') fail++;
    const n = HC.addOpeningsAt(m, f.id, [{ x: 3, y: 4.0, w: 1.5, kind: 'window' }, { x: 8, y: 0, w: 0.9, kind: 'door' }, { x: 50, y: 50, w: 1, kind: 'window' }]);
    eq('импорт: проёмов поставлено (третий слишком далеко)', n, 2);
}

// 3б. Импорт «как на плане»: контуры по внутренним граням стен 0,2 м, между комнатами зазор 0,2 м
{
    const sh = (x0, y0, x1, y1, d) => [[x0 + d, y0 + d], [x1 - d, y0 + d], [x1 - d, y1 - d], [x0 + d, y1 - d]];
    const m = HC.create({ Tn: -25 });
    const f = HC.addFloor(m, { level: 0 });
    const polys = [
        { name: 'Гостиная', pts: sh(0, 0, 6, 8, 0.1) },
        { name: 'Спальня', pts: sh(6, 0, 10, 4, 0.1) },
        { name: 'Санузел', pts: sh(6, 4, 10, 8, 0.1) }
    ];
    const gap = HC.estimateGap(polys);
    eq('зазор между комнатами определён по рёбрам, м', gap, 0.2, 0.011);
    const r = HC.fromPolygons(m, f.id, polys, { gap: 'auto', ext: { layers: null, thick: 0.2 }, int: { layers: null, thick: 0.2 } });
    eq('как на плане: комнат', r.rooms, 3);
    eq('как на плане: стен без дублей (общая стена x=6 режется на 2 куска, y=4 — один)', r.walls, 10);
    const rooms = HC.detectRooms(m, f.id);
    const inn = rooms.filter(x => x.edges.some(e => e.neighbor)).length;
    eq('как на плане: комнат с общими стенами', inn, 3);
    eq('как на плане: сумма площадей по осям', Math.round(rooms.reduce((s2, x) => s2 + x.areaGross, 0) * 10) / 10, 80, 0.2);
    eq('как на плане: чистая площадь после импорта = площадь исходных контуров (5,8x7,8 + 2 x 3,8x3,8)', Math.round(rooms.reduce((s2, x) => s2 + x.area, 0) * 100) / 100, 74.12, 0.05);
    const bad = rooms.filter(x => x.edges.length && x.edges.every(e => !e.neighbor)).length;
    eq('как на плане: комнат, у которых все стены наружные (должно быть 0)', bad, 0);
}

// 3в. Комнаты из зон: зоны перекрываются и неровные — комнат ровно столько же, сколько зон, площади = площадям зон
{
    const m = HC.create({ Tn: -25 });
    const f = HC.addFloor(m, { level: 0 });
    const zones = [
        { name: 'А', pts: [[0, 0], [6, 0], [6, 4], [0, 4]] },
        { name: 'Б', pts: [[5.5, 0], [10, 0], [10, 4], [5.5, 4]] },              // перекрывает А на полметра
        { name: 'В', pts: [[0, 4.1], [4, 4.1], [4, 7], [2, 8], [0, 8]] },          // неровная, зазор 0,1 м
        { name: 'Г', pts: [[4.2, 4.1], [10, 4.1], [10, 8], [4.2, 8]] },
        { name: 'Д', pts: [[11, 0], [12, 0], [12, 1], [11, 1]] }                  // отдельная кладовка, не касается остальных
    ];
    const polyArea = P => Math.abs(P.reduce((a2, p, i) => { const q = P[(i + 1) % P.length]; return a2 + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
    const want = zones.reduce((t, z) => t + polyArea(z.pts), 0);
    const r = HC.fromPolygons(m, f.id, zones, {});
    const rooms = HC.detectRooms(m, f.id);
    eq('из зон: комнат столько же, сколько зон', rooms.length, 5);
    eq('из зон: чистая площадь комнат = площади зон', Math.round(rooms.reduce((t, x) => t + x.area, 0) * 100) / 100, Math.round(want * 100) / 100, 0.1);     // выпрямление чуть двигает косую зону
    const L = HC.heatLoss(m);
    eq('из зон: расчёт дошёл до каждой комнаты', L.rooms.length, 5);
    eq('из зон: потери положительные у всех', L.rooms.every(x => x.Q > 0) ? 1 : 0, 1);
    eq('из зон: отдельная кладовка — все стены наружные', rooms.find(x => x.name === 'Д').edges.every(e => !e.neighbor) ? 1 : 0, 1);
    eq('из зон: после правки стен комнаты ищутся по стенам', HC.hasFixed(m) ? 1 : 0, 1);
    HC.dropFixed(m);
    eq('после dropFixed признак снят', HC.hasFixed(m) ? 1 : 0, 0);
}

// 3г. Чистка зон: легенда и штамп листа (далеко от здания) отбрасываются, ступеньки выпрямляются
{
    const m = HC.create({ Tn: -25 });
    const f = HC.addFloor(m, { level: 0 });
    const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    // комната 6 x 4 со «ступенькой» в 6 см по краю и слегка кривым ребром
    const rough = [[0, 0], [3, 0.03], [6, 0], [6.06, 0.02], [6.04, 4], [3, 4.03], [0, 3.97], [0.05, 2]];
    const zones = [
        { name: 'Дом 1', pts: rough },
        { name: 'Дом 2', pts: rect(6.2, 0, 10, 4) },
        { name: 'Легенда', pts: rect(30, 0, 33, 2) },          // коробки таблицы вдали от плана
        { name: 'Легенда 2', pts: rect(33, 0, 36, 2) },
        { name: 'Штамп', pts: rect(0, 40, 8, 42) }
    ];
    const r = HC.fromPolygons(m, f.id, zones, {});
    eq('чистка: отброшено зон вне здания (легенда x2 и штамп)', r.dropped.length, 3);
    eq('чистка: осталось комнат', r.rooms, 2);
    const q = HC.orthoPoly(rough, 8, 0.25);
    const rectLike = q.every((p, i) => { const n = q[(i + 1) % q.length]; return Math.abs(p[0] - n[0]) < 1e-9 || Math.abs(p[1] - n[1]) < 1e-9; });
    eq('чистка: ступеньки сведены в прямоугольник (все рёбра осевые)', rectLike ? 1 : 0, 1);
    eq('чистка: вершин после выпрямления', q.length, 4);
    const ar = Math.abs(q.reduce((a2, p, i) => { const n = q[(i + 1) % q.length]; return a2 + p[0] * n[1] - n[0] * p[1]; }, 0) / 2);
    eq('чистка: площадь после выпрямления ~ 6 x 4', ar, 24, 0.5);
    const keepAll = HC.create({ Tn: -25 }); const f2 = HC.addFloor(keepAll, { level: 0 });
    const r2 = HC.fromPolygons(keepAll, f2.id, zones, { clean: false });
    eq('чистка выключена: все пять зон остаются комнатами', r2.rooms, 5);
}

// 3д. Окна по оценке: жилая комната без окон получает остекление ~1/8 площади, санузел — нет, комната с окнами не трогается
{
    const m = HC.create({ Tn: -25 });
    const f = HC.addFloor(m, { level: 0 });
    const r = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    HC.fromPolygons(m, f.id, [
        { name: 'Гостиная', pts: r(0, 0, 6, 4) },
        { name: 'С/у', pts: r(6.2, 0, 8.2, 2) },
        { name: 'Спальня', pts: r(0, 4.2, 4, 8) }
    ], { gap: 'auto' });
    const rooms0 = HC.detectRooms(m, f.id);
    const spal = rooms0.find(x => x.name === 'Спальня');
    HC.addOpeningsAt(m, f.id, [{ x: 2, y: 8.1, w: 1.5, kind: 'window' }, { x: 3.4, y: 8.1, w: 1.5, kind: 'window' }]);   // у спальни уже 2 окна: хватает
    const est = HC.estimateWindows(m, f.id);
    const rooms = HC.detectRooms(m, f.id);
    const winArea = rn => { const rm = rooms.find(x => x.name === rn); return rm.edges.reduce((s2, e) => s2 + HC.openingsOn(m, e.piece).filter(o => o.kind === 'window').reduce((t, o) => t + o.width * o.height, 0), 0); };
    const g = rooms.find(x => x.name === 'Гостиная');
    eq('окна по оценке: гостиная получила остекление ≈ 1/8 площади', Math.round(winArea('Гостиная') / g.area * 100) / 100, 0.125, 0.06);
    eq('окна по оценке: санузел окон не получил', winArea('С/у'), 0, 1e-9);
    eq('окна по оценке: тронута одна комната — гостиная (спальня и санузел не тронуты)', est.rooms, 1);
    eq('окна по оценке: помечены как оценка', m.openings.filter(o => o.est).length > 0 ? 1 : 0, 1);
}

// 4. Сверка формулы с Galf
const gf = process.argv[2];
if (gf && fs.existsSync(gf)) {
    const data = JSON.parse(fs.readFileSync(gf, 'utf8'));
    let n = 0, sumErr = 0, maxErr = 0, over = 0, theirs = 0, ours = 0;
    data.forEach(p => p.rooms.forEach(r => r.rows.forEach(x => {
        if (!(x.area > 0 && x.R > 0 && x.q > 0 && Number.isFinite(x.tv) && Number.isFinite(x.tn))) return;
        const q = x.area * (x.tv - x.tn) / x.R * (x.n || 1) * (x.count || 1);
        const e = Math.abs(q - x.q) / x.q;
        n++; sumErr += e; maxErr = Math.max(maxErr, e); if (e > 0.1) over++;
        theirs += x.q; ours += q;
    })));
    console.log('Galf: строк ' + n + ', средняя ошибка формулы ' + (sumErr / n * 100).toFixed(1) + ' %, максимум ' + (maxErr * 100).toFixed(0) +
        ' %, строк с ошибкой больше 10 %: ' + over + ', сумма проектировщика ' + Math.round(theirs) + ' Вт, по нашей формуле ' + Math.round(ours) + ' Вт');
}

console.log(fail ? '\nНе сошлось: ' + fail : '\nВсе ручные случаи сошлись');
process.exit(fail ? 1 : 0);
