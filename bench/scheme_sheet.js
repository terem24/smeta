/**
 * Стенд листа схемы узла (app.wmSheet): коллекторы водоснабжения и тёплого пола.
 *
 * Лист собирается в браузере из кадров Blender (img/manifold3d, img/manifold_ufh) и подписей со
 * сносками. Глазами по одному листу не увидеть, что на 12 выходах ROMMER сноска перечеркнула
 * соседнюю или подпись вылезла за край, — стенд перебирает все кадры индексов и проверяет:
 *
 *   1. скос сноски — строго 45° (полка горизонтальна, скос |dx| = |dy|);
 *   2. линии сносок не пересекаются (между собой, в обеих колонках);
 *   3. текст подписи в пределах листа (по ширине — оценка кеглем, как считает wmSheet);
 *   4. подписи одной колонки не налезают друг на друга;
 *   5. точка сноски лежит на своей детали (в зоне детали из индекса кадра);
 *   6. ничего лишнего и ничего забытого: каждая деталь кадра подписана, у каждой подписи есть
 *      деталь на кадре;
 *   7. подписи находят строки сметы: на типовых объектах (render) каждая деталь кадра
 *      находит свою позицию в разделе сметы — по тем же правилам, что подсветка (WM_PARTS,
 *      WM_SUB, UFH_LAB_RE).
 *
 * Запуск из корня репозитория:
 *   node bench/scheme_sheet.js          — все проверки, итог; exit 1 при провале
 *   node bench/scheme_sheet.js -v       — каждый лист отдельной строкой
 *   node bench/scheme_sheet.js --svg=папка   — сохранить листы svg для просмотра
 *
 * Стенд меряет геометрию разметки, а не картинку: силуэт детали по карте (_id.png) здесь не
 * читается, точка проверяется по рамке детали.
 */
const fs = require('fs');
const path = require('path');
const app = require('./env.js');

const VERB = process.argv.includes('-v');
const SVG_DIR = (process.argv.find(a => a.startsWith('--svg=')) || '').slice(6);
if (SVG_DIR) fs.mkdirSync(SVG_DIR, { recursive: true });
let bad = 0, sheets = 0;
const fails = {};
const fail = (sheet, what) => { bad++; (fails[what] = fails[what] || []).push(sheet); if (VERB) console.log('  ✗ ' + sheet + ': ' + what); };

const rd = f => JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
// индексы новых узлов (коллектор радиаторов, подключение радиатора) — пока кадров нет, их листы пропускаются
const rdOpt = f => fs.existsSync(path.join(__dirname, '..', f)) ? rd(f) : null;
const IDX = { rad: rdOpt('img/manifold_rad/rad.json'), radnode: rdOpt('img/rad_node/radnode.json'), panel: rdOpt('img/rad_panel/panel.json'), side: rdOpt('img/rad_side/side.json'), conv: rdOpt('img/rad_conv/conv.json'), wo: rdOpt('img/water_outlet/wo.json'), sw: rdOpt('img/sewer_node/sw.json'), st: rd('img/manifold3d/manifold3d_st.json'), rm: rd('img/manifold3d/manifold3d_rm.json'),
    bl: rd('img/manifold3d/manifold3d_bl.json'), ufh: rd('img/manifold_ufh/ufh.json') };

// ── разбор листа ─────────────────────────────────────────────────────────
const num = s => parseFloat(s);
function parseSheet(svg) {
    const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
    const W = num(vb[1]), H = num(vb[2]);
    const hh = num(/<g transform="translate\(0 ([\d.]+)\)">/.exec(svg)[1]);
    const labs = [];
    const re = /<g class="wm-lab[^"]*" data-wm="([^"]+)">([\s\S]*?)<\/g>/g;
    let m;
    while ((m = re.exec(svg))) {
        const body = m[2];
        const pl = [...body.matchAll(/<polyline points="([-\d.e]+),([-\d.e]+) ([-\d.e]+),([-\d.e]+)"/g)].map(q => q.slice(1, 5).map(num));
        const texts = [...body.matchAll(/<text x="([-\d.e]+)" y="([-\d.e]+)" font-size="([\d.e]+)"[^>]*>([^<]*)<\/text>/g)]
            .map(q => ({ x: num(q[1]), y: num(q[2]), fs: num(q[3]), s: q[4].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&quot;/g, '"') }));
        const hit = /<rect class="wm-hit"[^>]* x="([-\d.e]+)" y="([-\d.e]+)" width="([-\d.e]+)" height="([-\d.e]+)"/.exec(body);
        const dot = /<circle cx="([-\d.e]+)" cy="([-\d.e]+)"/.exec(body);
        labs.push({ pk: m[1], shelf: pl[0], slope: pl[1], texts, hit: hit && hit.slice(1, 5).map(num), dot: dot && [num(dot[1]), num(dot[2])] });
    }
    return { W, H, hh, labs };
}
const cross = (p, q) => {
    const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const A = [p[0], p[1]], B = [p[2], p[3]], C = [q[0], q[1]], D = [q[2], q[3]];
    const d1 = d(C, D, A), d2 = d(C, D, B), d3 = d(A, B, C), d4 = d(A, B, D);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};

// Проверки 1–6 по готовому листу; o — то, из чего его собрали (items, кадры)
function checkSheet(name, svg, o, ox, oy) {
    sheets++;
    const S = parseSheet(svg);
    const n0 = bad;
    S.labs.forEach(L => {
        const [x0, y0, x1, y1] = L.slope;
        const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), len = Math.hypot(dx, dy);
        if (len > 1 && Math.abs(dx - dy) > Math.max(1.5, len * 0.02)) fail(name, `скос не 45° (${L.pk}: ${Math.round(Math.atan2(dy, dx) * 180 / Math.PI)}°)`);
        if (Math.abs(L.shelf[1] - L.shelf[3]) > 0.01) fail(name, `полка не горизонтальна (${L.pk})`);
        L.texts.forEach(t => {
            const w = t.s.length * t.fs * 0.56;
            if (t.x < 0 || t.x + w > S.W + 0.5) fail(name, `текст за краем листа (${L.pk}: «${t.s}»)`);
            if (t.y + S.hh < t.fs * 0.8 || t.y + S.hh > S.H + 0.5) fail(name, `текст за краем по высоте (${L.pk})`);
        });
        // точка на детали: в рамке хоть одной зоны подписи (в пикселях листа, запас 2 px)
        const it = o.items.find(i => i.pk === L.pk);
        if (it && L.dot) {
            const on = it.zs.some(({ z }) => L.dot[0] >= ox + z[0] * o.iw - 2 && L.dot[0] <= ox + z[2] * o.iw + 2 &&
                L.dot[1] >= oy + z[1] * o.ih - 2 && L.dot[1] <= oy + z[3] * o.ih + 2);
            if (!on) fail(name, `точка сноски мимо детали (${L.pk})`);
        }
    });
    for (let i = 0; i < S.labs.length; i++) for (let j = i + 1; j < S.labs.length; j++) {
        const a = S.labs[i], b = S.labs[j];
        if ([a.shelf, a.slope].some(p => [b.shelf, b.slope].some(q => cross(p, q)))) fail(name, `сноски пересекаются (${a.pk} × ${b.pk})`);
        // подписи одной колонки налезают
        if (a.hit && b.hit && Math.abs(a.hit[0] - b.hit[0]) < 1 &&
            a.hit[1] < b.hit[1] + b.hit[3] - 1 && b.hit[1] < a.hit[1] + a.hit[3] - 1) fail(name, `подписи налезают (${a.pk} / ${b.pk})`);
    }
    if (S.labs.length !== o.items.length) fail(name, `подписей на листе ${S.labs.length}, а деталей с подписью ${o.items.length}`);
    if (VERB && bad === n0) console.log('  ✓ ' + name);
    if (SVG_DIR) fs.writeFileSync(path.join(SVG_DIR, name.replace(/[^\w.-]+/g, '_') + '.svg'),
        svg.replace(/^[\s\S]*?(<svg)/, '$1').replace(/<\/svg>[\s\S]*$/, '</svg>').replace(/data-href=/g, 'href=')
            .replace(/href="img\//g, 'href="' + path.join(__dirname, '..', 'img').replace(/\\/g, '/') + '/'));
}

// Отступы картинки на листе — как в wmSheet (ox = ширина колонки подписей, oy — по высоте):
// их нет в разметке, восстанавливаем по кадру <image> с наименьшими x и y
function origin(svg, frames) {
    const ims = [...svg.matchAll(/<image class="wm-photo"[^>]* x="([-\d.e]+)" y="([-\d.e]+)"/g)].map(q => [num(q[1]), num(q[2])]);
    const k = frames.reduce((b, f, i) => (f.x + f.y < frames[b].x + frames[b].y ? i : b), 0);
    return [ims[k][0] - frames[k].x, ims[k][1] - frames[k].y];
}

// ── 1–6: все кадры индексов ──────────────────────────────────────────────
const SHORT = { cw: 'ХВС', hw: 'ГВС', rc: 'Рециркуляция' };
const TEXT = {
    mount: ['Крепление', 'хомут 1" + шпилька M8'], ek: ['Евроконус', '16x2.2'],
    tube: ['Отводы к потребителям', '16x2.2 в изоляции'], feed: ['Подводка от узла ввода', 'кран, сгон, ниппель'],
    end_hammer: ['Компенсатор гидроудара', '1/2" на футорке 3/4" x 1/2"'], end_plug: ['Заглушка коллектора', '3/4" НР']
};
function waterSheet(typ, set) {
    const frames = [];
    for (const [line, n, end, at] of set) {
        const fr = IDX[typ][`${line}_${n}_${end}`];
        if (!fr) return null;
        frames.push({ id: line + '@' + at, line, at, typ, L: { end }, big: n, n, fr, end, path: `img/manifold3d/${typ}_${line}_${n}_${end}` });
    }
    const places = frames.map(f => f.at).filter((a, i, arr) => arr.indexOf(a) === i);
    const { iw, ih } = app.wmPlaceFrames(frames, places, app.WM_STEP);
    const spec = frames.map(f => f.id + ':' + f.end).join(',');
    const zonesOf = app.wmZonesOf(frames, iw, ih, (z, f) => app.wmPartKey(z, f.end));
    const keys = frames.map(f => 'mf:' + f.id).concat(['mount', 'ek', 'tube', 'feed', 'end_hammer', 'end_plug']);
    const items = keys.map(key => {
        const lns = app.wmLabLines(key, spec);
        const zs = [].concat(...(app.WM_LABS[key.split(':')[0]] || []).map(pk => (zonesOf[pk] || []).filter(q => lns.indexOf(q.line) >= 0)));
        if (!zs.length) return null;
        const f = frames.find(x => 'mf:' + x.id === key);
        const lines = f ? [`${SHORT[f.line]} — ${f.big} выходов (4 + 4 + 4)`, 'коллектор 1" x 3/4" ЕК'] : TEXT[key];
        return { pk: key, rows: [], miss: [], ok: true, off: false, lines, tail: '', zs, mx: zs.reduce((s, q) => s + (q.z[0] + q.z[2]) / 2, 0) / zs.length };
    }).filter(Boolean);
    // 6: деталь кадра без подписи
    const labelled = new Set([].concat(...items.map(it => it.zs.map(q => q.pk + '|' + q.line))));
    const orphan = [].concat(...Object.keys(zonesOf).map(pk => zonesOf[pk].filter(q => !labelled.has(pk + '|' + q.line)).map(q => pk)));
    const o = { kind: 'water', frames, items, iw, ih, spec, hk: 'bf_r', title: 'Коллекторы', subtitle: 'Водоснабжение',
        places: places.map(at => ({ name: 'Котельная', rows: frames.filter(f => f.at === at).map(f => `${SHORT[f.line]} — ${f.big} выходов`) })) };
    return { o, orphan: orphan.filter((p, i, a) => a.indexOf(p) === i) };
}
function ufhSheet(list) {
    const frames = list.map((k, i) => ({ id: 'm' + i, at: i, m: { loops: parseInt(k), lbl: (i + 1) + ' этаж' }, fr: IDX.ufh[k], path: 'img/manifold_ufh/ufh_' + k }));
    if (frames.some(f => !f.fr)) return null;
    const { iw, ih } = app.wmPlaceFrames(frames, frames.map(f => f.at), [0, 0, 0]);
    const spec = frames.map(f => f.id).join(',');
    const zonesOf = app.wmZonesOf(frames, iw, ih, z => String(z).split(':')[0]);
    frames.forEach(f => (zonesOf.mf || []).forEach(q => { if (q.line === f.id) (zonesOf['mf:' + f.id] = zonesOf['mf:' + f.id] || []).push(q); }));
    const T = { ek: ['Евроконус', '16x2.0'], tube: ['Петли тёплого пола', '16x2.0 (500 м)'], sleeve: ['Защитные втулки', 'красная — подача, синяя — обратка'],
        fix: ['Фиксатор 90°', 'поворот петли в пол'], node: ['Переход на транзит', 'к кранам коллектора'] };
    const keys = frames.map(f => 'mf:' + f.id).concat(Object.keys(T));
    const items = keys.map(key => {
        const zs = (zonesOf[key] || []).map(q => ({ ...q, pk: key === 'tube' ? 'tube' : q.pk }));
        if (!zs.length) return null;
        const f = frames.find(x => 'mf:' + x.id === key);
        const lines = f ? [`Коллектор ТП — ${f.m.loops} выходов (${f.m.lbl})`, 'расходомеры, краны, воздухоотводчики'] : T[key];
        return { pk: key, rows: [], miss: [], ok: true, off: false, lines, tail: '', zs, mx: zs.reduce((s, q) => s + (q.z[0] + q.z[2]) / 2, 0) / zs.length };
    }).filter(Boolean);
    const known = new Set(['mf', 'tubeb'].concat(Object.keys(T)));
    const orphan = Object.keys(zonesOf).filter(pk => !known.has(pk) && pk.indexOf('mf:') !== 0);
    const o = { kind: 'ufh', frames, items, iw, ih, spec, hk: null, title: 'Коллекторы', subtitle: 'Тёплый пол',
        places: frames.map(f => ({ name: f.m.lbl, rows: [`Коллектор — ${f.m.loops} выходов`, 'STOUT SMS-0907, полностью укомплектован'] })) };
    return { o, orphan };
}
// Листы на гребёнках из двух коллекторов (тёплый пол — ufhSheet; радиаторы — то же устройство)
function radSheet(list) {
    if (!IDX.rad) return undefined;
    const frames = list.map((k, i) => ({ id: 'm' + i, at: i, loops: parseInt(k), fr: IDX.rad[k], path: 'img/manifold_rad/rad_' + k }));
    if (frames.some(f => !f.fr)) return null;
    const { iw, ih } = app.wmPlaceFrames(frames, frames.map(f => f.at), [0, 0, 0]);
    const zonesOf = app.wmZonesOf(frames, iw, ih, z => String(z).split(':')[0]);
    frames.forEach(f => (zonesOf.mf || []).forEach(q => { if (q.line === f.id) (zonesOf['mf:' + f.id] = zonesOf['mf:' + f.id] || []).push(q); }));
    const T = { ek: ['Евроконус', '16x2.2'], tube: ['Лучи к радиаторам', '16x2.2 в теплоизоляции'], node: ['Подвод к коллектору', 'ниппель, угольник, переходник'] };
    const items = frames.map(f => 'mf:' + f.id).concat(Object.keys(T)).map(key => {
        const zs = zonesOf[key] || [];
        if (!zs.length) return null;
        const f = frames.find(x => 'mf:' + x.id === key);
        const lines = f ? [`Коллектор радиаторов — ${f.loops} выходов (№ ${f.at + 1})`, 'балансировочные и термоклапаны, краны'] : T[key];
        return { pk: key, rows: [], miss: [], ok: true, off: false, lines, tail: '', zs, mx: zs.reduce((a, q) => a + (q.z[0] + q.z[2]) / 2, 0) / zs.length };
    }).filter(Boolean);
    const orphan = Object.keys(zonesOf).filter(pk => !/^mf/.test(pk) && !T[pk]);
    return { o: { kind: 'rad', frames, items, iw, ih, spec: frames.map(f => f.id).join(','), hk: null, title: 'Коллекторы', subtitle: 'Радиаторы',
        places: frames.map(f => ({ name: 'Коллектор № ' + (f.at + 1), rows: ['Коллектор — ' + f.loops + ' выходов', 'STOUT SMS-0912, в сборе'] })) }, orphan };
}
function radNodeSheet(v) {
    if (!IDX.radnode) return undefined;
    const fr = IDX.radnode[v];
    if (!fr) return null;
    const frames = [{ id: 'r0', at: 0, fr, path: 'img/rad_node/radnode_' + v }];
    const { iw, ih } = app.wmPlaceFrames(frames, [0], [0, 0, 0]);
    const zonesOf = app.wmZonesOf(frames, iw, ih, z => { const k = String(z).split(':')[0]; return { rad: 'mf', sleeve: 'fix' }[k] || k; });
    (zonesOf.mf || []).forEach(q => (zonesOf['mf:r0'] = zonesOf['mf:r0'] || []).push(q));
    const T = { 'mf:r0': ['Радиатор STOUT Space 500', 'нижнее подключение справа'], head: ['Термостатическая головка', 'на встроенный клапан, M30x1,5'],
        node: ['Узел нижнего подключения', 'угловой, трубы из стены'], ek: ['Евроконус', '16x2.2'], tube: ['Подводка к радиатору', 'подача и обратка'],
        fix: ['Выход трубы из стены', 'фиксатор 90°, защитные втулки'], bracket: ['Кронштейны', 'настенные, регулируемые'] };
    const items = Object.keys(T).map(key => {
        const zs = zonesOf[key] || [];
        if (!zs.length) return null;
        return { pk: key, rows: [], miss: [], ok: true, off: false, lines: T[key], tail: '', zs, mx: zs.reduce((a, q) => a + (q.z[0] + q.z[2]) / 2, 0) / zs.length };
    }).filter(Boolean);
    const orphan = Object.keys(zonesOf).filter(pk => pk !== 'mf' && !T[pk]);
    return { o: { kind: 'radnode', frames, items, iw, ih, spec: 'r0', hk: null, title: 'Подключение радиатора', subtitle: 'Обвязка прибора',
        places: [{ name: 'Нижнее подключение', rows: ['Узел SVH', 'термоголовка SHT-0001'] }] }, orphan };
}
function panelSheet(v) {
    if (!IDX.panel) return undefined;
    const fr = IDX.panel[v];
    if (!fr) return null;
    const frames = [{ id: 'p0', at: 0, fr, path: 'img/rad_panel/panel_' + v }];
    const { iw, ih } = app.wmPlaceFrames(frames, [0], [0, 0, 0]);
    const zonesOf = app.wmZonesOf(frames, iw, ih, z => { const k = String(z).split(':')[0]; return { rad: 'mf', sleeve: 'fix' }[k] || k; });
    (zonesOf.mf || []).forEach(q => (zonesOf['mf:p0'] = zonesOf['mf:p0'] || []).push(q));
    const T = { 'mf:p0': ['Радиатор стальной панельный', 'тип 21, боковое подключение'], head: ['Термостатическая головка', 'на термоклапан, M30x1,5'],
        node: ['Клапан термостатический', 'угловой под евроконус, подача'], lock: ['Клапан запорно-балансировочный', 'угловой под евроконус, обратка'],
        ek: ['Евроконус', '16x2.2'], tube: ['Подводка к радиатору', 'подача и обратка'], fix: ['Выход трубы из стены', 'фиксатор 90°, защитные втулки'] };
    const items = Object.keys(T).map(key => {
        const zs = zonesOf[key] || [];
        if (!zs.length) return null;
        return { pk: key, rows: [], miss: [], ok: true, off: false, lines: T[key], tail: '', zs, mx: zs.reduce((a, q) => a + (q.z[0] + q.z[2]) / 2, 0) / zs.length };
    }).filter(Boolean);
    const orphan = Object.keys(zonesOf).filter(pk => pk !== 'mf' && !T[pk]);
    return { o: { kind: 'panel', frames, items, iw, ih, spec: 'p0', hk: null, title: 'Подключение радиатора', subtitle: 'Обвязка прибора',
        places: [{ name: 'Стальной панельный, тип 21', rows: ['Боковое одностороннее подключение', 'Клапаны угловые под евроконус'] }] }, orphan };
}
function sideSheet(v) {
    if (!IDX.side) return undefined;
    const fr = IDX.side[v];
    if (!fr) return null;
    const frames = [{ id: 's0', at: 0, fr, path: 'img/rad_side/side_' + v }];
    const { iw, ih } = app.wmPlaceFrames(frames, [0], [0, 0, 0]);
    const zonesOf = app.wmZonesOf(frames, iw, ih, z => { const k = String(z).split(':')[0]; return { rad: 'mf', sleeve: 'fix' }[k] || k; });
    (zonesOf.mf || []).forEach(q => (zonesOf['mf:s0'] = zonesOf['mf:s0'] || []).push(q));
    const T = { 'mf:s0': ['Радиатор TONALE', 'белый, боковое подключение'], head: ['Термоголовка STOUT Design', 'белая, SHTD-0002'],
        node: ['Клапан термостатический', 'угловой, STOUT Design белые, подача'], lock: ['Клапан запорно-балансировочный', 'угловой, обратка'],
        ek: ['Переходник 16 x НР 1/2"', 'с монтажной гильзой'], tube: ['Подводка к радиатору', 'подача и обратка'],
        fix: ['Выход трубы из стены', 'фиксатор 90°, защитные втулки'], kit: ['Монтажный набор', 'переходники 1" x 1/2", заглушка, кран Маевского'] };
    const items = Object.keys(T).map(key => {
        const zs = zonesOf[key] || [];
        if (!zs.length) return null;
        return { pk: key, rows: [], miss: [], ok: true, off: false, lines: T[key], tail: '', zs, mx: zs.reduce((a, q) => a + (q.z[0] + q.z[2]) / 2, 0) / zs.length };
    }).filter(Boolean);
    const orphan = Object.keys(zonesOf).filter(pk => pk !== 'mf' && !T[pk]);
    return { o: { kind: 'side', frames, items, iw, ih, spec: 's0', hk: null, title: 'Подключение радиатора', subtitle: 'Обвязка прибора',
        places: [{ name: 'Боковое подключение', rows: ['Арматура STOUT Design, белые', 'Пробка и кран Маевского — в комплекте'] }] }, orphan };
}
function convSheet(v) {
    if (!IDX.conv) return undefined;
    const fr = IDX.conv[v];
    if (!fr) return null;
    const frames = [{ id: 'c0', at: 0, fr, path: 'img/rad_conv/conv_' + v }];
    const { iw, ih } = app.wmPlaceFrames(frames, [0], [0, 0, 0]);
    const zonesOf = app.wmZonesOf(frames, iw, ih, z => { const k = String(z).split(':')[0]; return { conv: 'mf', fit: 'ek' }[k] || k; });
    (zonesOf.mf || []).forEach(q => (zonesOf['mf:c0'] = zonesOf['mf:c0'] || []).push(q));
    const T = { 'mf:c0': ['Конвектор внутрипольный SCQ', 'с вентилятором'], head: ['Сервопривод', 'на термостатический клапан'],
        node: ['Клапан термостатический', 'осевой 1/2", подача'], lock: ['Клапан запорно-балансировочный', 'угловой 1/2", обратка'],
        ek: ['Переходник 16 x НР 1/2"', 'с монтажной гильзой'], tube: ['Подводка к конвектору', 'в стяжке, подача и обратка'] };
    const items = Object.keys(T).map(key => {
        const zs = zonesOf[key] || [];
        if (!zs.length) return null;
        return { pk: key, rows: [], miss: [], ok: true, off: false, lines: T[key], tail: '', zs, mx: zs.reduce((a, q) => a + (q.z[0] + q.z[2]) / 2, 0) / zs.length };
    }).filter(Boolean);
    const orphan = Object.keys(zonesOf).filter(pk => pk !== 'mf' && !T[pk]);
    return { o: { kind: 'conv', frames, items, iw, ih, spec: 'c0', hk: null, title: 'Подключение конвектора', subtitle: 'Обвязка прибора',
        places: [{ name: 'Внутрипольный SCQ, с вентилятором', rows: ['Подключение справа, трубы в стяжке', 'Клапаны осевой и угловой 1/2"'] }] }, orphan };
}
function woSheet(v) {
    if (!IDX.wo) return undefined;
    const fr = IDX.wo[v];
    if (!fr) return null;
    const frames = [{ id: 'w0', at: 0, fr, path: 'img/water_outlet/wo_' + v }];
    const { iw, ih } = app.wmPlaceFrames(frames, [0], [0, 0, 0]);
    const zonesOf = app.wmZonesOf(frames, iw, ih, z => String(z).split(':')[0]);
    (zonesOf.mf || []).forEach(q => (zonesOf['mf:w0'] = zonesOf['mf:w0'] || []).push(q));
    const T = { 'mf:w0': ['Монтажная планка двойная', '150 мм — смеситель'], node: ['Водорозетка 16 x Rp 1/2"', 'тупиковая, на планке'],
        ek: ['Гильза монтажная 16', 'на штуцере водорозетки'], tube: ['Труба PEX-a 16x2.2', 'в теплоизоляции: синяя ХВС, красная ГВС'],
        fix: ['Фиксатор поворота 90°', 'выход трубы из пола'], head: ['Пробка с наружной резьбой', 'на время опрессовки'] };
    const items = Object.keys(T).map(key => {
        const zs = zonesOf[key] || [];
        if (!zs.length) return null;
        return { pk: key, rows: [], miss: [], ok: true, off: false, lines: T[key], tail: '', zs, mx: zs.reduce((a, q) => a + (q.z[0] + q.z[2]) / 2, 0) / zs.length };
    }).filter(Boolean);
    const orphan = Object.keys(zonesOf).filter(pk => pk !== 'mf' && !T[pk]);
    return { o: { kind: 'wo', frames, items, iw, ih, spec: 'w0', hk: null, title: 'Точки подключения', subtitle: 'Сантехника',
        places: [{ name: 'Монтажная планка двойная 150 мм', rows: ['Две водорозетки — ХВС и ГВС', 'Пробки — до установки прибора'] }] }, orphan };
}
function swSheet(list) {
    if (!IDX.sw) return undefined;
    if (list.some(k => !IDX.sw[k])) return null;
    const frames = list.map((k, i) => ({ id: 'k' + i, at: i, fr: IDX.sw[k], k, path: 'img/sewer_node/sw_' + k }));
    const { iw, ih } = app.wmPlaceFrames(frames, frames.map(f => f.at), [0, 0, 0]);
    const zonesOf = app.wmZonesOf(frames, iw, ih, (z, f) => { const k = String(z).split(':')[0]; return k === 'mf' ? 'mf:' + f.id : k; });
    const T = { mf: ['Инсталляция', 'выпуск D110 под заглушкой'], tube: ['Труба канализационная', 'бесшумная D110 и D58'],
        ek: ['Отводы', '110x87°, 58x45°, 58x87°, 110x45° на выпуск'], node: ['Тройник 110x58 87°', 'ветка прибора в лежак'],
        head: ['Заглушки D110 и D58', 'до установки приборов'], lock: ['Ревизия с крышкой D110', 'на лежаке'],
        fix: ['Хомуты на шпильках M8', '4" для D110, 2" для D58'], kit: ['Муфта двухраструбная D110', 'стык лежака'] };
    const items = Object.keys(zonesOf).map(key => {
        const t = T[key.split(':')[0]];
        if (!t) return null;
        const zs = zonesOf[key];
        return { pk: key, rows: [], miss: [], ok: true, off: false, lines: t, tail: '', zs, mx: zs.reduce((a, q) => a + (q.z[0] + q.z[2]) / 2, 0) / zs.length };
    }).filter(Boolean);
    const orphan = Object.keys(zonesOf).filter(pk => !T[pk.split(':')[0]]);
    return { o: { kind: 'sw', frames, items, iw, ih, spec: frames.map(f => f.id).join(','), hk: null, title: 'Канализация', subtitle: 'Санузел',
        places: frames.map(f => ({ name: f.k, rows: ['Бесшумная D110'] })) }, orphan };
}
function run(name, r) {
    if (r === undefined) return;                 // кадров этого узла ещё нет — лист не проверяем
    if (!r) { fail(name, 'нет кадра в индексе'); return; }
    r.orphan.forEach(p => fail(name, `деталь кадра без подписи (${p})`));
    const svg = app.wmSheet(r.o);
    const [ox, oy] = origin(svg, r.o.frames);
    checkSheet(name, svg, r.o, ox, oy);
}

console.log('Листы по всем кадрам индексов');
for (const typ of ['st', 'rm', 'bl']) {
    for (let n = 1; n <= 12; n++) {
        // одна линия; три линии в одном месте; ХВС и ГВС в двух местах (квартира со стояком кухни)
        run(`${typ} cw ${n}`, waterSheet(typ, [['cw', n, 'hammer', 0]]));
        run(`${typ} rc ${n} заглушка`, waterSheet(typ, [['rc', n, 'plug', 0]]));
        run(`${typ} cw+hw+rc ${n}`, waterSheet(typ, [['cw', n, 'hammer', 0], ['hw', Math.max(1, n - 2), 'hammer', 0], ['rc', Math.max(1, n - 4), 'plug', 0]]));
        run(`${typ} 2 места ${n}`, waterSheet(typ, [['cw', n, 'plug', 0], ['hw', n, 'plug', 0], ['cw', 2, 'hammer', 1], ['hw', 2, 'hammer', 1]]));
    }
}
for (let n = 2; n <= 13; n++) {
    run(`ТП ${n}`, ufhSheet([String(n)]));
    run(`ТП ${n} без перехода`, ufhSheet([n + '_bare']));
    run(`ТП ${n} + ${Math.max(2, 15 - n)}`, ufhSheet([String(n), String(Math.max(2, 15 - n))]));
}

for (let n = 2; n <= 13; n++) {
    run(`радиаторы ${n}`, radSheet([String(n)]));
    run(`радиаторы ${n} без подвода`, radSheet([n + '_bare']));
    run(`радиаторы ${n} + ${Math.max(2, 15 - n)}`, radSheet([String(n), String(Math.max(2, 15 - n))]));
}
Object.keys(IDX.radnode || {}).forEach(v => run('подключение ' + v, radNodeSheet(v)));
Object.keys(IDX.side || {}).forEach(v => run('боковое ' + v, sideSheet(v)));
Object.keys(IDX.panel || {}).forEach(v => run('панельный ' + v, panelSheet(v)));
Object.keys(IDX.conv || {}).forEach(v => run('конвектор ' + v, convSheet(v)));
Object.keys(IDX.wo || {}).forEach(v => run('водорозетки ' + v, woSheet(v)));
if (IDX.sw) {
    ['main', 'toilet', 'basin', 'shower', 'wash'].forEach(k => run('канализация ' + k, swSheet([k])));
    run('канализация санузел целиком', swSheet(['main', 'toilet', 'basin', 'shower', 'wash']));
}

// ── 7: подписи находят строки сметы ──────────────────────────────────────
console.log('Подписи и строки сметы на типовых объектах');
const zone = (name, fx) => ({ id: name, name, dist: 8, fixtures: Object.assign({ toilet: 0, basin: 0, shower: 0, bath: 0, wash: 0, dish: 0, bidet: 0 }, fx) });
const Z3 = [zone('С/у1', { toilet: 1, basin: 2, bath: 1, wash: 1 }), zone('С/у2', { toilet: 1, basin: 1, shower: 1 }), zone('Кухня', { dish: 1, basin: 1 })];
// комната с окном в пол — под ним конвектор (подробный расчёт)
const CONV_ROOMS = () => [{ id: 11, name: 'Гостиная', area: 30, floor: 1, sys: ['rad'], windows: [{ id: 12, width: 3, isPan: true }] },
    { id: 21, name: 'Спальня', area: 16, floor: 1, sys: ['rad'], windows: [{ id: 22, width: 1.5, isPan: false }] }];
const OBJ = {
    'STOUT, ХВС+ГВС+рециркуляция, узел ввода, ТП 2 этажа': { area: 180, floors: 2, systems: ['rad', 'tp'], tp1: 40, tp2: 30, water: true, recirc: true, waterInput: true, waterZones: Z3 },
    'ROMMER, без узла ввода, ТП 1 этаж': { area: 140, floors: 1, systems: ['rad', 'tp'], tp1: 60, water: true, brandMode: 'rommer', waterZones: Z3.slice(0, 2) },
    'Только ХВС+ГВС, 1 санузел': { area: 100, floors: 1, systems: ['rad'], water: true, waterInput: true, waterZones: [zone('С/у', { toilet: 1, basin: 1, shower: 1 })] },
    'ТП, узел подмеса на гребёнке': { area: 160, floors: 2, systems: ['rad', 'tp'], tp1: 8, tp2: 30, ufhMixType: 'std' },
    'Радиаторы Space на коллекторе, 120 м²': { area: 120, floors: 1, systems: ['rad'] },
    'Радиаторы Space, узел прямой (из пола)': { area: 120, floors: 1, systems: ['rad'], connectionType: 'straight' },
    'Секционные боковые (Space Россия), угловые': { area: 120, floors: 1, systems: ['rad'], radType: 'space_ru', connectionType: 'angled' },
    'OSCAR чёрный, Design чёрная': { area: 120, floors: 1, systems: ['rad'], radType: 'oscar_1800_black_s', connectionType: 'angled' },
    'TUBE ROUND натуральный, прямые': { area: 120, floors: 1, systems: ['rad'], radType: 'tube_round_1800_natural_s', connectionType: 'straight' },
    'TITAN графит, нижнее, угловой': { area: 120, floors: 1, systems: ['rad'], radType: 'titan_graphite', connectionType: 'angled' },
    'TUBE QUADRO чёрный, нижнее, прямой': { area: 120, floors: 1, systems: ['rad'], radType: 'tube_quadro_1800_black_b', connectionType: 'straight' },
    'ROMMER RST 2, нижнее, угловой': { area: 120, floors: 1, systems: ['rad'], radType: 'rommer_rst_2_1750', connectionType: 'angled' },
    'Ventil (ROMMER), узел угловой': { area: 200, floors: 2, systems: ['rad'], brandMode: 'rommer', connectionType: 'angled' },
    'Ventil (ROMMER), узел прямой': { area: 200, floors: 2, systems: ['rad'], brandMode: 'rommer', connectionType: 'straight' },
    'Стальные панельные, клапаны угловые (из стены)': { area: 120, floors: 1, systems: ['rad'], radType: 'steel', connectionType: 'angled' },
    'Стальные панельные, клапаны прямые (из пола)': { area: 120, floors: 1, systems: ['rad'], radType: 'steel', connectionType: 'straight' },
    'Канализация: санузел и кухня': { area: 120, floors: 1, systems: ['rad'], water: true, sewer: true, waterZones: Z3 },
    'Конвектор SCN, клапаны прямые': { area: 120, floors: 1, systems: ['rad'], detailedRooms: true, rooms: CONV_ROOMS(), convectorType: 'scn', convConnectionType: 'straight' },
    'Конвектор SCQ, клапаны осевой и угловой': { area: 120, floors: 1, systems: ['rad'], detailedRooms: true, rooms: CONV_ROOMS(), convectorType: 'scq', convConnectionType: 'angled' }
};
const nm = it => String(it.name || '').split('\n')[0].trim();
for (const [title, patch] of Object.entries(OBJ)) {
    app.__setup(patch);
    app.render(true);
    const eq = app.currentEquipmentList || [];
    const secOf = it => String(it.sectionTitle || it.group || '');
    const miss = [];
    // водоснабжение: детали кадров по линиям — как wmRows (раздел, подраздел линии, узел ввода)
    const L = app._wmLines || {};
    ['cw', 'hw', 'rc'].filter(k => L[k] && L[k].pts.length).forEach(line => {
        const fr = IDX.st[`${line}_${Math.min(12, L[line].pts[0])}_${L[line].end}`];
        if (!fr) { miss.push(`${line}: нет кадра`); return; }
        const pks = Object.keys(fr.zones).map(z => app.wmPartKey(z, L[line].end)).filter((p, i, a) => a.indexOf(p) === i);
        pks.forEach(pk => {
            const def = app.WM_PARTS[pk];
            if (!def) { miss.push(`${line}: деталь «${pk}» без описания в WM_PARTS`); return; }
            if (def.node && !app.state.waterInput) return;      // раздел 6 выключен — подпись так и пишет
            const secRe = def.node ? /Узел ввода|^6\./ : /водоснабжени|ГВС|Рециркул|^5\./i;
            const all = eq.filter(it => secRe.test(secOf(it)) && def.re.test(nm(it)));
            if (!all.length) miss.push(`${SHORT[line]}: ${def.t}`);
        });
    });
    // тёплый пол: каждая подпись листа — по UFH_LAB_RE в разделе 4, коллектор — по этажу
    // _ufhMans живёт от прошлого расчёта, если раздела 4 в смете нет — смотрим только при ТП
    // лист ТП есть только у STOUT SMS-0907 (renderUfhManifoldSheet): с ROMMER — прежний лист, подписей нет
    const mans = (app.state.systems || []).indexOf('tp') >= 0 &&
        (app._ufhMans || []).every(m => { const it = eq.find(x => x.originalId === m.oid && /^4\./.test(x.group || ''));
            return !it || /^SMS-0907/i.test(String(it.displaySku || it.id)); }) ? app._ufhMans || [] : [];
    if (mans.length) {
        const sec4 = eq.filter(it => /тёплый пол|теплый пол|^4\./i.test(secOf(it)));
        mans.forEach(m => { if (!sec4.some(it => /^Коллектор ТП/i.test(nm(it)) && nm(it).indexOf('(' + m.lbl + ')') >= 0)) miss.push(`ТП: коллектор (${m.lbl})`); });
        const bare = !sec4.some(it => app.UFH_LAB_RE.node.test(nm(it)));
        Object.keys(app.UFH_LAB_RE).forEach(pk => {
            if (pk === 'node' && bare) return;                // кадр «_bare» — перехода на нём нет
            if (pk === 'tube') return;                         // труба — по ключу строки, ниже
            if (!sec4.some(it => app.UFH_LAB_RE[pk].test(nm(it)) && !/^Коллектор/i.test(nm(it)))) miss.push(`ТП: ${pk}`);
        });
        if (!eq.some(it => /_ufh(#\d+)?$|^ufh_transit/.test(String(it.originalId || it.id || '')) || (/тёплый пол|теплый пол|^4\./i.test(secOf(it)) && /труба/i.test(nm(it)))))
            miss.push('ТП: труба петель');
    }
    // коллектор радиаторов SMS-0912: подписи листа — RAD_LAB_RE в разделе 3, подвод — строки «…_rad_node»
    const sec3 = eq.filter(it => /^3\./.test(secOf(it)));
    if (sec3.some(it => /^SMS-0912/i.test(String(it.originalId || '')) && /^SMS-0912/i.test(String(it.displaySku || it.id)))) {
        Object.keys(app.RAD_LAB_RE).forEach(pk => { if (!sec3.some(it => app.RAD_LAB_RE[pk].test(nm(it)))) miss.push('коллектор радиаторов: ' + pk); });
        if (!sec3.some(it => /^Коллектор радиаторный/i.test(nm(it)))) miss.push('коллектор радиаторов: сам коллектор');
    }
    // нижнее подключение (Space, Ventil) с узлом SVH-0002/0004 — подписи RADNODE_LAB_RE; у прямого
    // узла фитинг, трубка и скоба набора (RADNODE_LAB_RE_STRAIGHT); кронштейны — только у Space
    const svh = sec3.find(it => /^SVH-000[24]/i.test(String(it.displaySku || it.id)));
    const hasSpace = sec3.some(it => /^SRB-032[01]/i.test(String(it.displaySku || it.id)));
    const hasVentil = sec3.some(it => /^RRS-2020/i.test(String(it.displaySku || it.id)));
    const hasOther = sec3.some(it => app.bottomFamily(String(it.displaySku || it.id)));
    const hasTitan = sec3.some(it => /^SRB-3320/i.test(String(it.displaySku || it.id)));
    if (svh && (hasSpace || hasVentil || hasOther)) {
        const straight = /^SVH-0002/i.test(String(svh.displaySku || svh.id));
        Object.keys(app.RADNODE_LAB_RE).forEach(pk => {
            if (pk === 'bracket' && !hasSpace && !hasTitan) return;
            const re = (straight && app.RADNODE_LAB_RE_STRAIGHT[pk]) || app.RADNODE_LAB_RE[pk];
            if (!sec3.some(it => re.test(nm(it)))) miss.push('подключение радиатора: ' + pk);
        });
    }
    // подключение стального панельного (боковое) — клапаны под евроконус и подписи PANEL_LAB_RE
    if (sec3.some(it => /^RRS-2010/i.test(String(it.displaySku || it.id)))) {
        if (!sec3.some(it => /^SVT-000[12]-100015/i.test(String(it.displaySku || it.id)))) miss.push('панельный: термоклапан не под евроконус');
        Object.keys(app.PANEL_LAB_RE).forEach(pk => { if (!sec3.some(it => app.PANEL_LAB_RE[pk].test(nm(it)))) miss.push('панельный: ' + pk); });
    }
    // боковое подключение (секционные, дизайнерские, трубчатые) — подписи SIDE_LAB_RE; набор — если есть строка
    const sideRad = sec3.find(it => app.sideFamily(String(it.displaySku || it.id)));
    if (sideRad && sec3.some(it => /^SVTD?-000[12]/i.test(String(it.displaySku || it.id)))) {
        Object.keys(app.SIDE_LAB_RE).forEach(pk => {
            if (pk === 'kit' && !app.sideFamily(String(sideRad.displaySku || sideRad.id)).sect) return;
            if (!sec3.some(it => app.SIDE_LAB_RE[pk].test(nm(it)))) miss.push('боковое подключение: ' + pk);
        });
    }
    // конвекторы — подписи CONV_LAB_RE в разделе «3.2. Обвязка конвекторов» (сервопривод — только у SCQ)
    const conv = sec3.find(it => /^SC[NQ]-/i.test(String(it.displaySku || it.id)));
    if (conv) {
        const c32 = sec3.filter(it => /Обвязка конвектор/i.test(String(it.group || '')));
        Object.keys(app.CONV_LAB_RE).forEach(pk => {
            if (pk === 'head' && !/^SCQ/i.test(String(conv.displaySku || conv.id))) return;
            const pool = pk === 'tube' ? sec3 : c32;
            if (!pool.some(it => app.CONV_LAB_RE[pk].test(nm(it)))) miss.push('конвектор: ' + pk);
        });
    }
    // канализация — подписи SW_LAB_RE в разделе 8 (инсталляция — при унитазе, ревизия и муфта — общие)
    const sec8 = eq.filter(it => /^8\./.test(String(it.group || '')));
    if (sec8.some(it => /^Труба канализационная/i.test(nm(it)))) {
        Object.keys(app.SW_LAB_RE).forEach(pk => {
            if (pk === 'mf' && !(app.state.waterZones || []).some(z => (z.fixtures || {}).toilet > 0)) return;
            if (!sec8.some(it => app.SW_LAB_RE[pk].test(nm(it)))) miss.push('канализация: ' + pk);
        });
    }
    // водорозетки — подписи WO_LAB_RE и планки в разделе 5
    const sec5 = eq.filter(it => /^5\./.test(String(it.group || '')));
    if (sec5.some(it => /^SFA-0032/i.test(String(it.displaySku || it.id)))) {
        Object.keys(app.WO_LAB_RE).forEach(pk => { if (!sec5.some(it => app.WO_LAB_RE[pk].test(nm(it)))) miss.push('водорозетки: ' + pk); });
        if (!sec5.some(it => app.WO_PLATES[String(it.displaySku || it.id)])) miss.push('водорозетки: монтажная планка');
    }
    if (miss.length) miss.forEach(m => fail(title, 'нет строки сметы: ' + m));
    else console.log('  ✓ ' + title);
}

console.log(`\nЛистов: ${sheets}. ` + (bad ? `Провалов: ${bad}` : 'Всё сходится.'));
Object.keys(fails).forEach(w => console.log(`  ${w} — ${fails[w].length}: ${fails[w].slice(0, 4).join('; ')}${fails[w].length > 4 ? '…' : ''}`));
process.exit(bad ? 1 : 0);
