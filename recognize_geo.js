/**
 * Карта помещений листа проекта — без модели.
 *
 * Зачем. На «Хвойной 3» почти все ошибки распознавания были одного рода:
 * модель по картинке решала, в какой комнате стоит окно, прибор или зона
 * тёплого пола, — и путала соседние комнаты (коридор без окон, три окна в
 * кабинете, лишнее окно в санузле). При этом в PDF всё нужное уже лежит
 * точно: стены — залитые многоугольники одного цвета («Существующие и
 * новые стены»), подписи комнат, марки приборов, подписи S= и концы
 * выносок окон — текст и линии с координатами. Остаётся геометрия: какая
 * комната содержит точку.
 *
 * Как. Стены растрируются в маску. Дверные проёмы закрываются «раздутием»
 * стен на полпроёма, и заливка от подписи каждой комнаты не перетекает в
 * соседнюю. Потом комнаты дорастают обратно в полосу у стен — до ниш,
 * проёмов и окон, где и стоят приборы и концы выносок. Снаружи дома —
 * отдельная заливка от краёв листа по сильно раздутым стенам (окна и
 * витражи закрыты), в неё комнаты не растут.
 *
 * Листы одного проекта нарисованы в одном масштабе и положении, поэтому
 * карта, построенная по листу помещений, годится для листов отопления,
 * сантехники и обмерного плана.
 *
 * Всё в процентах листа (x — от левого края, y — от верхнего), как у
 * RecognizeFiles.pageLabels / pageWords.
 */

const RecognizeGeo = {

    PX_PER_PT: 2.5,        // 1:100 → ≈14 мм натуры на пиксель
    // Полуширины закрываемых проёмов по проходам, мм: 1,2 м закрывает
    // проёмы до 2,4 м (гардеробная без двери), 0,35 м — обычную дверь 0,7 м.
    LEVELS_MM: [1200, 900, 650, 450, 300],
    SHELL_MM: 4000,        // снаружи: окна и витражи до 4 м закрыты
    GROW_MM: 700,          // насколько комнаты дорастают в полосу у стен

    ops() {
        const lib = (typeof window !== 'undefined' && window.pdfjsLib) || globalThis.pdfjsLib;
        return lib && lib.OPS;
    },

    /**
     * Линии и заливки листа из списка операций pdf.js: с учётом save/restore,
     * transform и вложенных объектов (Form XObject). Координаты — в
     * процентах листа. segs — отрезки (для выносок), fills — залитые
     * контуры с цветом.
     */
    async pagePaths(page) {
        const OPS = this.ops();
        if (!OPS) return null;
        if (page._geoPaths) return page._geoPaths;
        const list = await page.getOperatorList();
        const vp = page.getViewport({ scale: 1 });
        const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
            m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
        const ap = (m, x, y) => {
            const ux = m[0] * x + m[2] * y + m[4], uy = m[1] * x + m[3] * y + m[5];
            const [vx, vy] = vp.convertToViewportPoint(ux, uy);
            return [vx / vp.width * 100, vy / vp.height * 100];
        };
        const hex = a => {
            if (typeof a[0] === 'string') return a[0].toLowerCase();
            const h = v => Math.max(0, Math.min(255, Math.round(+v || 0))).toString(16).padStart(2, '0');
            return '#' + h(a[0]) + h(a[1]) + h(a[2]);
        };
        const FILL = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke,
            OPS.closeFillStroke, OPS.closeEOFillStroke].filter(v => v !== undefined));
        let ctm = [1, 0, 0, 1, 0, 0], fillColor = '#000000';
        const stack = [], segs = [], fills = [];
        let pending = null;          // контуры последнего constructPath
        for (let i = 0; i < list.fnArray.length; i++) {
            const fn = list.fnArray[i], a = list.argsArray[i];
            if (fn === OPS.save) stack.push([ctm, fillColor]);
            else if (fn === OPS.restore) { const s = stack.pop(); if (s) [ctm, fillColor] = s; }
            else if (fn === OPS.transform) ctm = mul(ctm, a);
            else if (fn === OPS.paintFormXObjectBegin) {
                stack.push([ctm, fillColor]);
                if (Array.isArray(a[0]) && a[0].length === 6) ctm = mul(ctm, a[0]);
            } else if (fn === OPS.paintFormXObjectEnd) { const s = stack.pop(); if (s) [ctm, fillColor] = s; }
            else if (fn === OPS.setFillRGBColor) fillColor = hex(a);
            else if (fn === OPS.setFillGray) fillColor = hex([a[0] * 255, a[0] * 255, a[0] * 255]);
            else if (fn === OPS.constructPath) {
                const ops = a[0], co = a[1];
                let k = 0, cur = null, start = null;
                const polys = [];
                let poly = null;
                const push = (p, q) => { if (p && q && (p[0] !== q[0] || p[1] !== q[1])) segs.push([p, q]); };
                for (const op of ops) {
                    if (op === OPS.moveTo) {
                        cur = ap(ctm, co[k], co[k + 1]); start = cur; k += 2;
                        poly = [cur]; polys.push(poly);
                    } else if (op === OPS.lineTo) {
                        const p = ap(ctm, co[k], co[k + 1]); push(cur, p); cur = p; k += 2;
                        if (poly) poly.push(p);
                    } else if (op === OPS.curveTo) {
                        const p = ap(ctm, co[k + 4], co[k + 5]); push(cur, p); cur = p; k += 6;
                        if (poly) poly.push(p);
                    } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
                        const p = ap(ctm, co[k + 2], co[k + 3]); push(cur, p); cur = p; k += 4;
                        if (poly) poly.push(p);
                    } else if (op === OPS.rectangle) {
                        const [x, y, w, h] = [co[k], co[k + 1], co[k + 2], co[k + 3]]; k += 4;
                        const p = [ap(ctm, x, y), ap(ctm, x + w, y), ap(ctm, x + w, y + h), ap(ctm, x, y + h)];
                        push(p[0], p[1]); push(p[1], p[2]); push(p[2], p[3]); push(p[3], p[0]);
                        cur = start = p[0];
                        polys.push(p); poly = null;
                    } else if (op === OPS.closePath) { push(cur, start); cur = start; }
                }
                pending = polys;
            } else if (FILL.has(fn)) {
                if (pending && pending.length) fills.push({ color: fillColor, polys: pending });
                pending = null;
            } else if (fn === OPS.endPath || fn === OPS.stroke || fn === OPS.closeStroke) pending = null;
        }
        page._geoPaths = { segs, fills, aspect: vp.width / vp.height, wPt: vp.width, hPt: vp.height };
        return page._geoPaths;
    },

    polyArea(p) {
        let s = 0;
        for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
        return Math.abs(s / 2);
    },

    /**
     * Цвет стен: серая заливка, которой на листе больше всего по площади.
     * Штриховки и мебель бывают серыми тоже, но их площадь на плане в разы
     * меньше, чем у стен. null — стен заливкой нет (скан, другой чертёж).
     */
    wallColor(fills) {
        const area = new Map();
        for (const f of fills) {
            const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(f.color);
            if (!m) continue;
            const [r, g, b] = [m[1], m[2], m[3]].map(h => parseInt(h, 16));
            const lum = (r + g + b) / 3;
            if (Math.abs(r - g) > 12 || Math.abs(g - b) > 12 || lum < 30 || lum > 170) continue;
            const s = f.polys.reduce((a, p) => a + this.polyArea(p), 0);
            area.set(f.color, (area.get(f.color) || 0) + s);
        }
        let best = null;
        for (const [c, s] of area) if (!best || s > best.s) best = { c, s };
        // Стены дома занимают хотя бы 0,3 % листа (в %² — 30 из 10 000).
        return best && best.s > 30 ? best.c : null;
    },

    /** Масштаб листа из текста штампа: «1:100», «М 1:50». По умолчанию 1:100. */
    scaleOf(text) {
        const m = String(text || '').match(/1\s*:\s*(\d{2,3})\b/);
        const s = m ? +m[1] : 100;
        return s >= 20 && s <= 200 ? s : 100;
    },

    /**
     * Карта листа: { w, h, reg (Int16Array: -1 ничья, -2 снаружи, -3 стена,
     * иначе номер подписи), names, mmPx }. seeds — [{ name, x, y }] в
     * процентах. null — стен на листе не нашлось.
     */
    async build(page, seeds, sheetText) {
        const walls = await this.wallsOf(page, sheetText);
        return walls ? this.buildFromWalls(walls, seeds) : null;
    },

    /**
     * Стены листа — то, что нужно для карты, без остального чертежа:
     * { polys, wPt, hPt, scale }. Хранится в наборе листов проекта, пока
     * помещения не прочитаны (карта строится по их подписям).
     */
    async wallsOf(page, sheetText) {
        const paths = await this.pagePaths(page);
        if (!paths) return null;
        const color = this.wallColor(paths.fills);
        if (!color) return null;
        const polys = paths.fills.filter(f => f.color === color).map(f => f.polys);
        delete page._geoPaths;          // лист большой — список операций не держим
        return { polys, wPt: paths.wPt, hPt: paths.hPt, scale: this.scaleOf(sheetText) };
    },

    buildFromWalls(walls, seeds) {
        if (!walls || !seeds.length) return null;
        return this.buildFromPolys(walls.polys, walls.wPt, walls.hPt, seeds, walls.scale);
    },

    /**
     * Ширина проёма в стене у точки (конец выноски окна), метры. Идём от
     * точки вдоль стены в обе стороны до откосов; стена — то направление,
     * где откосы нашлись с обеих сторон ближе (поперёк — комната или улица).
     */
    gapWidth(map, xPct, yPct) {
        if (!map || !map.wall) return null;
        const { w, h, wall, mmPx } = map;
        const cx = Math.round(xPct / 100 * w), cy = Math.round(yPct / 100 * h);
        const maxPx = 4500 / mmPx;
        const run = (dx, dy) => {
            for (let s = 1; s < maxPx; s++) {
                const x = cx + dx * s, y = cy + dy * s;
                if (x < 0 || y < 0 || x >= w || y >= h) return null;
                if (wall[y * w + x]) return s;
            }
            return null;
        };
        const opts = [];
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
            const a = run(dx, dy), b = run(-dx, -dy);
            if (a && b) opts.push(a + b - 1);
        }
        if (!opts.length) return null;
        // lenK — поправка масштаба по экспликации (RecognizeProject.geoMap).
        const m = Math.min(...opts) * mmPx * (map.lenK || 1) / 1000;
        return m >= 0.4 && m <= 4.5 ? Math.round(m * 100) / 100 : null;
    },

    buildFromPolys(polyGroups, wPt, hPt, seeds, scale) {
        const k = this.PX_PER_PT;
        const w = Math.round(wPt * k), h = Math.round(hPt * k);
        const mmPx = 25.4 / 72 / k * scale;
        const wall = new Uint8Array(w * h);
        for (const group of polyGroups) this.fillEvenOdd(wall, w, h, group.map(p => p.map(([x, y]) => [x / 100 * w, y / 100 * h])));

        const dist = this.distance(wall, w, h);           // до стены, в пикселях
        const rShell = this.SHELL_MM / 2 / mmPx;
        const N = w * h;
        const reg = new Int16Array(N).fill(-1);
        for (let i = 0; i < N; i++) if (wall[i]) reg[i] = -3;
        // Рамка в пиксель — занята: соседи i±1, i±w всегда внутри массива.
        for (let x = 0; x < w; x++) { reg[x] = -3; reg[(h - 1) * w + x] = -3; }
        for (let y = 0; y < h; y++) { reg[y * w] = -3; reg[y * w + w - 1] = -3; }

        const q = new Int32Array(N);
        let qh = 0, qt = 0;
        const D4 = [1, -1, w, -w];

        // Улица. Ядро — всё, что дальше SHELL/2 от стен и связано с краем
        // листа: окна и витражи уже SHELL закрыты. Улица — ядро и полоса
        // шириной SHELL/2 вокруг него (морфологическое «закрытие»): полоса
        // доходит до наружных стен, но в комнату через окно почти не
        // заходит. Без этого полоса вокруг дома через входную дверь
        // доставалась прихожей вместе со всеми окнами.
        {
            const core = new Uint8Array(N);
            const ok = i => !core[i] && reg[i] === -1 && dist[i] > rShell;
            for (let x = 1; x < w - 1; x++) for (const y of [1, h - 2]) { const i = y * w + x; if (ok(i)) { core[i] = 1; q[qt++] = i; } }
            for (let y = 1; y < h - 1; y++) for (const x of [1, w - 2]) { const i = y * w + x; if (ok(i)) { core[i] = 1; q[qt++] = i; } }
            while (qh < qt) {
                const i = q[qh++];
                for (let t = 0; t < 4; t++) { const j = i + D4[t]; if (ok(j)) { core[j] = 1; q[qt++] = j; } }
            }
            const dOut = this.distance(core, w, h);
            for (let i = 0; i < N; i++) if (reg[i] === -1 && dOut[i] <= rShell) reg[i] = -2;
        }

        // Комнаты — в несколько проходов, от широких проёмов к узким. На
        // уровне R стены «раздуты» на R: проёмы уже 2R закрыты. Кусок
        // свободного места с одной ещё не размещённой подписью — её комната.
        // С двумя и больше (гардеробная, открытая в спальню проёмом в 2 м) —
        // не трогаем до более узкого уровня: там они разделятся по проёму,
        // а не посередине между подписями. Узкая комната (кладовая 1,2 м)
        // на широком уровне «пропадает» и находится на узком. После
        // размещения на каждом уровне комнаты заполняют всё, что у них
        // освободилось (ниши, углы), — раньше, чем сосед дотянется через
        // открывшуюся на следующем уровне дверь.
        const names = seeds.map(s => s.name);
        const seedPx = seeds.map(s => {
            const x = Math.round(s.x / 100 * w), y = Math.round(s.y / 100 * h);
            return x >= 0 && y >= 0 && x < w && y < h ? y * w + x : -1;
        });
        const placed = new Array(seeds.length).fill(false);
        const comp = new Int32Array(N);
        let compId = 0;
        const levels = this.LEVELS_MM.map(mm => mm / mmPx);
        for (let li = 0; li < levels.length; li++) {
            const R = levels[li], last = li === levels.length - 1;
            const free = i => reg[i] === -1 && dist[i] > R;
            // Подпись у самой стены — сдвинуть в ближайшее свободное.
            const at = seedPx.map((p, n) => {
                if (placed[n] || p < 0) return -1;
                if (free(p)) return p;
                return this.nearest(reg, dist, w, h, p % w, (p / w) | 0, R, (last ? 1500 : 300) / mmPx);
            });
            const base = compId + 1;
            const bySeed = new Map();
            for (let n = 0; n < at.length; n++) {
                const p = at[n];
                if (p < 0) continue;
                if (comp[p] < base) {
                    const id = ++compId;
                    comp[p] = id;
                    qh = qt = 0; q[qt++] = p;
                    while (qh < qt) {
                        const i = q[qh++];
                        for (let t = 0; t < 4; t++) { const j = i + D4[t]; if (comp[j] < base && free(j)) { comp[j] = id; q[qt++] = j; } }
                    }
                }
                if (!bySeed.has(comp[p])) bySeed.set(comp[p], []);
                bySeed.get(comp[p]).push(n);
            }
            const hold = new Set();
            qh = qt = 0;
            for (const [id, list] of bySeed) {
                if (list.length > 1 && !last) { hold.add(id); continue; }
                // Одна подпись — компонента её. На последнем уровне подписей
                // несколько — делим по расстоянию от них (ниже, общей волной).
                for (const n of list) { if (reg[at[n]] === -1) { reg[at[n]] = n; q[qt++] = at[n]; } placed[n] = true; }
            }
            // Волна от всех размещённых: заполняет освободившееся на этом
            // уровне, кроме кусков, где ждут разделения две подписи.
            for (let i = 0; i < N; i++) if (reg[i] >= 0) q[qt++] = i;
            while (qh < qt) {
                const i = q[qh++];
                for (let t = 0; t < 4; t++) {
                    const j = i + D4[t];
                    if (!free(j) || (comp[j] >= base && hold.has(comp[j]))) continue;
                    reg[j] = reg[i]; q[qt++] = j;
                }
            }
        }

        // Дорастить в полосу у стен: ниши, проёмы, окна — не дальше
        // последнего уровня и GROW_MM.
        const depth = new Uint16Array(N);
        qh = qt = 0;
        for (let i = 0; i < N; i++) if (reg[i] >= 0) q[qt++] = i;
        const maxD = ((this.LEVELS_MM[this.LEVELS_MM.length - 1] + this.GROW_MM) / mmPx) | 0;
        while (qh < qt) {
            const i = q[qh++];
            if (depth[i] >= maxD) continue;
            for (let t = 0; t < 4; t++) {
                const j = i + D4[t];
                if (reg[j] !== -1) continue;
                reg[j] = reg[i]; depth[j] = depth[i] + 1; q[qt++] = j;
            }
        }
        // Площадь каждой комнаты — для самопроверки карты (сверка с экспликацией).
        const cnt = new Float64Array(names.length);
        for (let i = 0; i < N; i++) if (reg[i] >= 0) cnt[reg[i]]++;
        const areas = Array.from(cnt, c => Math.round(c * mmPx * mmPx / 1e4) / 100);
        // Касается ли комната «улицы» — число наружных стен считать по ней.
        return { w, h, reg, wall, names, mmPx, areas };
    },

    /**
     * Наружные стены комнаты n: с каких сторон (север/юг/запад/восток листа)
     * за стеной — улица. От каждой точки комнаты у стены идём наружу сквозь
     * стену (и проём окна) не дальше WALL_MM; дошли до улицы — эта сторона
     * наружная в этой точке. Сторона считается, если так набирается не
     * меньше метра стены: угол соседней комнаты или торец перегородки —
     * не наружная стена. Возвращает { sides, count, lengthM }.
     */
    WALL_MM: 900,
    outerSides(map, n) {
        if (!map) return null;
        const { w, h, reg, mmPx } = map;
        const N = w * h, maxS = Math.ceil(this.WALL_MM / mmPx);
        const dirs = [['N', -w], ['S', w], ['W', -1], ['E', 1]];
        const hit = { N: 0, S: 0, W: 0, E: 0 };
        for (let i = w; i < N - w; i++) {
            if (reg[i] !== n) continue;
            for (const [k, d] of dirs) {
                if (reg[i + d] !== -3) continue;       // не у стены с этой стороны
                let j = i + d;
                for (let s = 1; s <= maxS; s++, j += d) {
                    if (j < 0 || j >= N) break;
                    const v = reg[j];
                    if (v === -2) { hit[k]++; break; }
                    if (v >= 0 && v !== n) break;       // за стеной соседняя комната
                    if (v === n && s > 1) break;        // вернулись в свою
                }
            }
        }
        const minPx = 1000 / mmPx;
        const sides = Object.keys(hit).filter(k => hit[k] >= minPx);
        return { sides, count: sides.length, lengthM: Math.round(sides.reduce((a, k) => a + hit[k], 0) * mmPx / 100) / 10 };
    },

    /** Ближайший к точке пиксель, свободный от раздутых стен. */
    nearest(reg, dist, w, h, fx, fy, rDoor, maxPx) {
        const cx = Math.round(fx), cy = Math.round(fy);
        const ok = (x, y) => x >= 0 && y >= 0 && x < w && y < h && reg[y * w + x] === -1 && dist[y * w + x] > rDoor;
        if (ok(cx, cy)) return cy * w + cx;
        for (let r = 1; r < maxPx; r++) {
            for (let d = -r; d <= r; d++) {
                for (const [x, y] of [[cx + d, cy - r], [cx + d, cy + r], [cx - r, cy + d], [cx + r, cy + d]]) {
                    if (ok(x, y)) return y * w + x;
                }
            }
        }
        return -1;
    },

    /**
     * Комната точки: номер подписи или -1. Точка на стене или в проёме —
     * ближайшая комната в пределах maxMm (конец выноски окна лежит на самом
     * окне, в толще наружной стены).
     */
    roomAt(map, xPct, yPct, maxMm) {
        if (!map) return -1;
        const { w, h, reg } = map;
        const cx = Math.round(xPct / 100 * w), cy = Math.round(yPct / 100 * h);
        const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h) ? reg[y * w + x] : -9;
        if (at(cx, cy) >= 0) return at(cx, cy);
        const maxPx = (maxMm || 800) / map.mmPx;
        for (let r = 1; r < maxPx; r++) {
            const seen = new Map();
            for (let d = -r; d <= r; d++) {
                for (const [x, y] of [[cx + d, cy - r], [cx + d, cy + r], [cx - r, cy + d], [cx + r, cy + d]]) {
                    const v = at(x, y);
                    if (v >= 0) seen.set(v, (seen.get(v) || 0) + 1);
                }
            }
            if (seen.size) return [...seen].sort((a, b) => b[1] - a[1])[0][0];
        }
        return -1;
    },

    /** Заливка многоугольников по правилу чёт-нечет (с дырками) — в маску. */
    fillEvenOdd(mask, w, h, polys) {
        const edges = [];
        for (const p of polys) {
            for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
                const [x0, y0] = p[j], [x1, y1] = p[i];
                if (y0 === y1) continue;
                edges.push(y0 < y1 ? [x0, y0, x1, y1] : [x1, y1, x0, y0]);
            }
        }
        if (!edges.length) return;
        const ymin = Math.max(0, Math.floor(Math.min(...edges.map(e => e[1])))),
            ymax = Math.min(h - 1, Math.ceil(Math.max(...edges.map(e => e[3]))));
        const xs = [];
        for (let y = ymin; y <= ymax; y++) {
            const sy = y + 0.5;
            xs.length = 0;
            for (const [x0, y0, x1, y1] of edges) {
                if (sy < y0 || sy >= y1) continue;
                xs.push(x0 + (sy - y0) / (y1 - y0) * (x1 - x0));
            }
            xs.sort((a, b) => a - b);
            for (let i = 0; i + 1 < xs.length; i += 2) {
                const a = Math.max(0, Math.round(xs[i])), b = Math.min(w - 1, Math.round(xs[i + 1]) - 1);
                for (let x = a; x <= b; x++) mask[y * w + x] = 1;
            }
        }
    },

    /**
     * Расстояние до ближайшей стены, в пикселях: фаска 3-4 (ход по прямой
     * стоит 3, по диагонали 4), два прохода по растру. Целые числа и без
     * Math.min — на листе в 6 млн пикселей это доли секунды.
     */
    distance(wall, w, h) {
        const N = w * h, INF = 1 << 29;
        const d = new Int32Array(N);
        for (let i = 0; i < N; i++) d[i] = wall[i] ? 0 : INF;
        for (let y = 0; y < h; y++) {
            const row = y * w;
            for (let x = 0; x < w; x++) {
                const i = row + x;
                let v = d[i];
                if (v === 0) continue;
                let c;
                if (x > 0 && (c = d[i - 1] + 3) < v) v = c;
                if (y > 0) {
                    if ((c = d[i - w] + 3) < v) v = c;
                    if (x > 0 && (c = d[i - w - 1] + 4) < v) v = c;
                    if (x < w - 1 && (c = d[i - w + 1] + 4) < v) v = c;
                }
                d[i] = v;
            }
        }
        for (let y = h - 1; y >= 0; y--) {
            const row = y * w;
            for (let x = w - 1; x >= 0; x--) {
                const i = row + x;
                let v = d[i];
                if (v === 0) continue;
                let c;
                if (x < w - 1 && (c = d[i + 1] + 3) < v) v = c;
                if (y < h - 1) {
                    if ((c = d[i + w] + 3) < v) v = c;
                    if (x < w - 1 && (c = d[i + w + 1] + 4) < v) v = c;
                    if (x > 0 && (c = d[i + w - 1] + 4) < v) v = c;
                }
                d[i] = v;
            }
        }
        const out = new Float32Array(N);
        for (let i = 0; i < N; i++) out[i] = d[i] / 3;
        return out;
    },
};

if (typeof window !== 'undefined') window.RecognizeGeo = RecognizeGeo;
if (typeof module !== 'undefined') module.exports = RecognizeGeo;
