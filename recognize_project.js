/**
 * Комплект листов проекта: листы инженерных систем.
 *
 * Дизайн-проект или рабочий проект приходит одним PDF на десятки листов
 * (RecognizeFiles.projectSheets разбирает его по названиям в штампах).
 * Помещения читаются с плана по правилам RecognizePlan, а здесь — то, что
 * на плане помещений не нарисовано:
 *   - лист отопления: где тёплый пол, какие приборы у окон, полотенцесушители;
 *   - лист сантехники: какие приборы в каком помещении.
 *
 * Каждый лист — один запрос: картинка, текст листа (подписи площадей,
 * спецификации — они в PDF набраны, и читать их с картинки незачем) и
 * список уже прочитанных помещений, к которым модель привязывает найденное.
 * Результат ложится в строки экрана проверки (row.eng) и при переносе в
 * расчёт — в системы комнат, окна-конвекторы, «Водоснабжение» по санузлам
 * и полотенцесушители (RecognizePlan.toCalcRoom / apply).
 */

const RecognizeProject = {

    FIX_KEYS: ['toilet', 'toiletHot', 'basin', 'bath', 'shower', 'drain', 'bidet', 'wash', 'dish'],
    FIX_NAMES: {
        toilet: 'унитаз', toiletHot: 'из них унитаз-биде (ГВС)', basin: 'раковина', bath: 'ванна', shower: 'душ',
        drain: 'трап', bidet: 'биде', wash: 'стиральная машина', dish: 'посудомоечная машина',
    },
    // Приборы с горячей водой — по ним включается бойлер.
    HOT_KEYS: ['toiletHot', 'basin', 'bath', 'shower', 'bidet'],
    HEATER_NAMES: {
        floor_convector: 'конвектор в полу',
        wall_convector: 'настенный конвектор',
        radiator: 'радиатор',
    },

    num(v) {
        if (v === null || v === undefined || v === '') return null;
        const n = parseFloat(String(v).replace(',', '.').replace(/[^\d.\-]/g, ''));
        return isNaN(n) ? null : n;
    },

    cnt(v) {
        const n = this.num(v);
        return n > 0 ? Math.min(20, Math.round(n)) : 0;
    },

    fmt(n) {
        return (Math.round(n * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
    },

    /**
     * Прочитать листы инженерных систем и разложить по помещениям.
     * rows — строки RecognizePlan (мутируются: row.eng), project — набор из
     * RecognizeFiles.fromProjectSet. Возвращает { summary, warnings }.
     * Упавший лист не отменяет помещения: они уже прочитаны.
     */
    async read(rows, project, onStatus) {
        const ui = RecognizeUI;
        const summary = [], warnings = [];
        let modelOff = false;       // лимит кончился — дальше только по чертежу
        const posHint = 'Координаты подписей помещений взяты с листа планировки того же этажа: листы нарисованы в одном масштабе ' +
            'и положении, x — % ширины слева, y — % высоты сверху. Помещение, в котором стоит прибор или зона, — то, ' +
            'в чьих границах на этом листе оказывается её точка; ориентируйся по стенам на картинке и по этим координатам.\n\n';

        for (const sh of (project && project.eng) || []) {
            const what = this.SHEET_WHAT[sh.kind] || 'инженерных систем';

            // Помещения этого листа. Лист системы сведён с листом помещений
            // своего этажа (RecognizeFiles.pairRoomSheet) — тогда только его
            // комнаты: список второго этажа на плане первого сбивал бы модель.
            // Не сведён — весь дом, как прежде, и без мест подписей.
            const scope = this.sheetScope(rows, sh);
            const words = sh.roomSheet !== null && sh.roomSheet !== undefined && project.roomWords
                ? project.roomWords[sh.roomSheet] : null;
            const pos = this.roomPositions(scope.map(n => rows[n]), words);
            const list = scope.map((n, k) => {
                const r = rows[n];
                return `${n + 1}. ${r.name}${r.area > 0 ? `, ${this.fmt(r.area)} м²` : ''}` +
                    `${r.floor === 2 ? ', 2-й этаж' : ''}` +
                    (pos[k] ? `, подпись на плане (${pos[k].x}%, ${pos[k].y}%)` : '');
            }).join('\n');
            const scopeRows = scope.map(n => rows[n]);

            // Тип вентиляции часто назван в тексте листа прямо — тогда модель
            // не нужна, и запрос из лимита не тратится.
            if (sh.kind === 'vent') {
                const byText = this.ventFromText(sh.text);
                if (byText) {
                    const res = this.takeVent(byText, sh);
                    summary.push(res.summary);
                    warnings.push(...res.warnings);
                    continue;
                }
            }

            if (onStatus) onStatus(`Читаю лист ${sh.num} — ${what}…`);

            // Марки приборов набраны в PDF — их число известно точно. Говорим
            // его модели прямо: по картинке она на «Хвойной 3» насчитала шесть
            // приборов при пяти марках и поставила лишний в кабинет.
            const marks = sh.kind === 'heat' ? this.heaterMarks(sh.text) : [];
            const marksHint = marks.length
                ? `На листе ровно ${marks.length} ${RecognizeUI.plural(marks.length, 'прибор', 'прибора', 'приборов')} отопления: ` +
                  `${marks.join(', ')}. Найди на картинке, где стоит каждая марка, и отнеси её к помещению; ` +
                  `сумма heaters по всем помещениям должна быть ровно ${marks.length}, в heaterMarks перечисли марки помещения.\n\n`
                : '';
            // Точное положение марок и подписей зон — из PDF, а не с картинки.
            const labels = (sh.labels || []);
            const zoneSum = labels.filter(l => !l.mark)
                .reduce((a, l) => a + (this.num(String(l.s).replace(/^S=/i, '').replace(/м.*$/i, '')) || 0), 0);
            const zonesHint = zoneSum > 0
                ? `Подписи зон тёплого пола «S=…» на листе дают в сумме ${this.fmt(zoneSum)} м². Если в спецификации тёплого пола ` +
                  'больше — на листе есть заштрихованные зоны без подписи: найди их (часто это гардеробные, кладовые, ниши) ' +
                  'и отнеси к помещениям с ufh=true, ufhArea=null и ufhApprox — своей оценкой площади по размерам на чертеже.\n\n'
                : '';
            const labelsHint = labels.length
                ? 'Положение надписей на листе (x — % ширины слева, y — % высоты сверху; взято из PDF точно): ' +
                  labels.map(l => `${l.s} (${l.x}%, ${l.y}%)`).join('; ') +
                  '. Марка прибора стоит у окна своего помещения — обычно ближе всего к подписи площади зоны тёплого пола ' +
                  'этого же помещения; помещение каждой марки определяй по этим координатам, а не по картинке.\n\n'
                : '';
            // Раскладка по карте помещений модели не требует: если модель не
            // ответила (лимит, сбой), зоны, приборы и сантехника по маркам всё
            // равно встанут по комнатам. На «Хвойной 3» 26.09 часовой лимит
            // оборвал лист сантехники — и вместе с моделью пропала и точная
            // раскладка по чертежу, которой модель не нужна.
            const map = sh.kind === 'vent' ? null : this.geoMap(rows, project, sh.roomSheet);
            const canGeo = !!map && (sh.kind === 'heat' ? (sh.labels || []).length > 0 : !!(sh.fixtures && sh.fixtures.marks && sh.fixtures.marks.length));
            let parsed = null, fail = null;
            if (!modelOff) {
                try {
                    const data = await ui.askModel([
                        { text: `Лист ${sh.num} «${sh.title}» — ${this.SHEET_TOPIC[sh.kind] || ''}. ` +
                            `Задача: ${sh.kind}.\n\nПомещения, уже прочитанные с плана:\n${list}\n\n` +
                            (sh.kind !== 'vent' && pos.some(Boolean) ? posHint : '') + marksHint + labelsHint + zonesHint +
                            (sh.text ? `Текст листа (набран в PDF, ему можно верить больше, чем картинке):\n${sh.text}\n\n` : '') +
                            'Верни только JSON.' },
                        { inline_data: { mime_type: 'image/jpeg', data: sh.img } },
                    ], PROJECT_ENG_PROMPT);
                    const cand = data?.candidates?.[0];
                    const text = cand?.content?.parts?.[0]?.text;
                    if (!text) throw new Error('пустой ответ');
                    parsed = ui.parseModelJson(text, cand.finishReason);
                } catch (e) {
                    fail = e;
                    if (e.quota) { modelOff = true; if (!warnings.includes(e.message)) warnings.push(e.message); }
                    else warnings.push(`лист ${sh.num} (${what}) не прочитан по картинке: ${ui.cleanError(e.message).split('\n')[0]}`);
                }
            }
            if (!parsed && !canGeo) continue;
            // Без модели — пустой ответ: остаётся только то, что взято из чертежа.
            if (!parsed) parsed = sh.kind === 'heat' ? { rooms: [], ufhTotal: this.ufhTotalOf(sh.text), towelRails: this.towelsOf(sh.text) } : { rooms: [] };
            if (sh.kind === 'heat' && !(this.num(parsed.ufhTotal) > 0)) parsed.ufhTotal = this.ufhTotalOf(sh.text);
            const res = sh.kind === 'heat' ? this.takeHeat(parsed, rows, sh, scopeRows)
                : sh.kind === 'vent' ? this.takeVent(parsed, sh)
                : this.takeWater(parsed, rows, sh, scopeRows);
            // Поверх модели — раскладка по карте помещений, где она есть.
            const geo = !canGeo ? null : sh.kind === 'heat' ? this.geoHeat(sh, scopeRows, map) : this.geoWater(sh, scopeRows, map);
            if (geo && geo.summary.length) {
                res.summary = res.summary.replace(/\.$/, '') + `; по чертежу: ${geo.summary.join(', ')}.`;
                // Предупреждения модели о числе марок и приборов после
                // раскладки по чертежу уже не про то.
                if (sh.kind === 'heat') res.warnings = res.warnings.filter(w => !/марок приборов на листе/.test(w));
            }
            if (fail && geo && geo.summary.length) res.summary = `Лист ${sh.num} «${sh.title}»: по чертежу — ${geo.summary.join(', ')} (картинка листа не прочитана).`;
            summary.push(res.summary);
            warnings.push(...res.warnings, ...(geo ? geo.warnings : []));
        }
        return { summary, warnings };
    },

    /**
     * Номера строк (индексы в rows), к которым относится лист системы. Лист
     * сведён с листом помещений k — строки, прочитанные с него (row._sheet —
     * номер снимка, а снимки идут в порядке set.rooms). Не сведён или с того
     * листа строк нет (дочитанный руками этаж) — весь дом.
     */
    sheetScope(rows, sh) {
        const all = rows.map((r, n) => n);
        if (sh.kind === 'vent' || sh.roomSheet === null || sh.roomSheet === undefined) return all;
        const own = all.filter(n => rows[n]._sheet === sh.roomSheet);
        return own.length ? own : all;
    },

    /**
     * Место подписи каждой комнаты на листе помещений: [{x, y} | null] по
     * строкам. Та же надпись есть и в таблице экспликации — там названия
     * стоят столбиком (три и больше с одним x), такие отбрасываем. Две
     * комнаты с одним названием («Санузел» и «Санузел») — место не указываем:
     * какая из подписей чья, по тексту не понять.
     */
    roomPositions(rows, words) {
        if (!Array.isArray(words) || !words.length) return rows.map(() => null);
        const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
        const names = new Set(rows.map(r => norm(r.name)));
        const cand = words.filter(w => names.has(norm(w.s)));
        const column = w => cand.filter(o => Math.abs(o.x - w.x) < 0.5).length >= 3;
        const onPlan = cand.filter(w => !column(w));
        const dup = {};
        rows.forEach(r => { const k = norm(r.name); dup[k] = (dup[k] || 0) + 1; });
        // Середина надписи точнее её левого края: длинное «Кухня-гостиная»
        // начинается у самой стены.
        const at = w => ({ x: w.cx !== undefined ? w.cx : w.x, y: w.cy !== undefined ? w.cy : w.y });
        const out = rows.map(r => {
            const k = norm(r.name);
            if (dup[k] > 1) return null;
            const hits = onPlan.filter(w => norm(w.s) === k);
            return hits.length === 1 ? at(hits[0]) : null;
        });
        // Название на плане не подписано (или подписано иначе) — ищем по
        // площади «3,02 м²» под номером комнаты. В экспликации площади без
        // «м²», их regex не берёт.
        rows.forEach((r, i) => {
            if (out[i] || !(r.area > 0)) return;
            const a = (Math.round(r.area * 100) / 100).toFixed(2);
            const re = new RegExp('^' + a.replace('.', '[.,]') + '\\s*м');
            const hits = words.filter(w => re.test(w.s));
            if (hits.length === 1 && !rows.some((o, j) => j !== i && o.area > 0 && Math.abs(o.area - r.area) < 0.005)) out[i] = at(hits[0]);
        });
        return out;
    },

    // ------------------------------------------------------------------
    // Карта помещений (RecognizeGeo)
    //
    // Где стоит окно, прибор или зона тёплого пола — вопрос геометрии, а не
    // зрения: стены листа помещений лежат в PDF заливкой, подписи комнат,
    // марки и концы выносок — текстом и линиями с координатами. Модель по
    // картинке путала соседние комнаты (коридор без окон, три окна в
    // кабинете, раковина «лишняя»). Всё, что карта разложила, ставится
    // поверх ответа модели и помечается r.eng.src[поле] = 'pdf' — на экране
    // проверки такие ячейки зелёные, их можно не перепроверять.
    // ------------------------------------------------------------------

    _maps: null,

    geoMap(rows, project, k) {
        if (typeof RecognizeGeo === 'undefined' || !project || !Array.isArray(project.roomWalls)) return null;
        if (k === null || k === undefined) k = project.roomWalls.length === 1 ? 0 : null;
        if (k === null || !project.roomWalls[k]) return null;
        const scope = project.roomWalls.length === 1 ? rows : rows.filter(r => r._sheet === k);
        const key = k + '|' + scope.map(r => r.name + ':' + r.area).join('|');
        // Карта строится раз на лист, а строки у разных шагов — разные
        // объекты с теми же названиями (помещения из PDF собираются до
        // того, как появятся строки экрана проверки). Храним номера подписей
        // в списке и привязываем карту к строкам того, кто спросил.
        this._maps = this._maps || new Map();
        const bind = got => got && got.map ? Object.assign({}, got.map, { rows: got.idx.map(i => scope[i]) }) : null;
        if (this._maps.has(key)) return bind(this._maps.get(key));
        const pos = this.roomPositions(scope, project.roomWords && project.roomWords[k]);
        const seeds = [], idx = [];
        scope.forEach((r, i) => { if (pos[i]) { seeds.push({ name: r.name, x: pos[i].x, y: pos[i].y }); idx.push(i); } });
        let map = null;
        if (seeds.length >= 2) {
            try { map = RecognizeGeo.buildFromWalls(project.roomWalls[k], seeds); } catch (e) { console.warn('Карта помещений:', e); map = null; }
        }
        // Масштаб в штампе («1:100») у выгруженного PDF бывает неверным: лист
        // «Хвойной 3» выведен примерно в 1:79 — проём 1550 мм на листе
        // выходил 1972 мм, окна в теплопотерях — на четверть шире. Сверяем
        // по экспликации: площадь каждой комнаты на карте против площади в
        // таблице; медиана отношений — поправка к длинам (корень из неё).
        if (map) {
            const ratios = [];
            idx.forEach((i, n) => {
                const a = scope[i].area, m = map.areas[n];
                if (a > 1 && m > 1) ratios.push(a / m);
            });
            ratios.sort((a, b) => a - b);
            const med = ratios.length >= 3 ? ratios[Math.floor(ratios.length / 2)] : 1;
            map.lenK = med > 0.25 && med < 4 ? Math.sqrt(med) : 1;
        }
        this._maps.set(key, { map, idx });
        return bind(this._maps.get(key));
    },

    rowAt(map, x, y, maxMm) {
        if (!map || x === undefined || y === undefined) return null;
        const i = RecognizeGeo.roomAt(map, x, y, maxMm);
        return i >= 0 ? map.rows[i] : null;
    },

    /**
     * Названия и площади — дословно из экспликации PDF
     * (RecognizeFiles.pageExplication). Строки модели сверяются с таблицей
     * по названию, затем по площади; чего модель не прочитала — добавляется,
     * лишнее остаётся неотмеченным с пометкой. Порядок — как в таблице.
     * Вызывать до окон и инженерных листов: они ссылаются на строки.
     */
    fitExplication(res, project) {
        const tabs = project && project.roomTables;
        if (!Array.isArray(tabs) || !tabs.some(Boolean) || !res || !Array.isArray(res.rows)) return [];
        const warnings = [];
        const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^а-яa-z0-9]/g, '');
        tabs.forEach((tab, k) => {
            if (!tab) return;
            const own = res.rows.filter(r => tabs.length === 1 || r._sheet === k);
            if (!own.length && tabs.length > 1) return;
            const tpl = own[0] || res.rows[0] || {};
            const used = new Set(), ordered = [];
            let added = 0;
            tab.rows.forEach(t => {
                let r = own.find(x => !used.has(x) && norm(x.name) === norm(t.name))
                    || own.find(x => !used.has(x) && x.area > 0 && Math.abs(x.area - t.area) < 0.015);
                if (!r) {
                    added++;
                    r = { _sheet: tpl._sheet !== undefined ? tpl._sheet : k, _sel: true, num: '', name: '', nameGuessed: false,
                        area: null, areaSrc: null, dims: '', windows: null, panoramic: 0, outerWalls: null, orient: null,
                        doubleHeight: false, heated: true, floorRaw: tpl.floorRaw !== undefined ? tpl.floorRaw : 1,
                        floor: tpl.floor !== undefined ? tpl.floor : 1, ownFloor: false, confidence: 1,
                        note: 'добавлено из экспликации — на плане модель его не нашла' };
                }
                used.add(r);
                r.num = t.num; r.name = t.name; r.area = t.area; r.areaSrc = 'table'; r.nameGuessed = false;
                this.setSrc(r, 'name', 'pdf');
                this.setSrc(r, 'area', 'pdf');
                ordered.push(r);
            });
            const extra = own.filter(x => !used.has(x));
            extra.forEach(x => {
                x._sel = false;
                x.note = [x.note, 'в экспликации такого помещения нет — в расчёт не отмечено'].filter(Boolean).join('; ');
                ordered.push(x);
            });
            const at = own.length ? res.rows.indexOf(own[0]) : res.rows.length;
            const rest = res.rows.filter(r => !own.includes(r));
            const pos = rest.filter((r, i) => res.rows.indexOf(r) < at).length;
            rest.splice(pos, 0, ...ordered);
            res.rows = rest;
            if (res.sheets && res.sheets[k]) res.sheets[k].totalArea = tab.total;
            if (added) warnings.push(`экспликация: ${added} ${RecognizeUI.plural(added, 'помещение добавлено', 'помещения добавлены', 'помещений добавлено')} из таблицы — на плане их не нашли`);
            if (extra.length) warnings.push(`в экспликации нет: ${extra.map(x => x.name).join(', ')} — не отмечено`);
        });
        return warnings;
    },

    /**
     * Помещения листов проекта — без модели. Названия и площади — из
     * экспликации, наружные стены — по карте помещений, окна — дальше по
     * обмерному плану (readWindows). Для каждого листа помещений — ответ в
     * том же виде, что у модели плана (RecognizePlan.normalizeSheet его
     * примет), или null — этот лист читает модель, как прежде.
     *
     * Модель на этом листе шла 2–4 минуты и была самым долгим шагом, а всё,
     * что она отсюда брала, в PDF лежит точно. Условие — есть экспликация,
     * стены заливкой и обмерный план с подписями окон: без него окна
     * считать не по чему, и лист остаётся модели.
     */
    HEATED_NOT_RE: /террас|балкон|лоджи|крыльц|веранд|навес|патио/i,

    plansFromPdf(project) {
        if (!project || !Array.isArray(project.roomTables) || typeof RecognizeGeo === 'undefined') return null;
        const winOk = !!(project.winSheet && project.winSheet.labels && project.winSheet.labels.length);
        if (!winOk || project.rooms.length !== 1) return null;
        const out = project.rooms.map((p, k) => {
            const tab = project.roomTables[k], walls = (project.roomWalls || [])[k];
            if (!tab || !walls) return null;
            const rows = tab.rows.map(t => ({ name: t.name, area: t.area, _sheet: k }));
            const map = this.geoMap(rows, project, k);
            if (!map) return null;
            const floor = typeof RecognizeFiles !== 'undefined' ? RecognizeFiles.sheetFloor(p.title) : null;
            return {
                docKind: 'floor_plan', floorLabel: p.title || null, floor: typeof floor === 'number' ? floor : null,
                ceilingH: null, hasTable: true, totalArea: tab.total, fromPdf: true,
                rooms: tab.rows.map((t, i) => {
                    const at = map.rows.indexOf(rows[i]);
                    const o = at >= 0 ? RecognizeGeo.outerSides(map, at) : null;
                    return {
                        num: t.num, name: t.name, area: t.area, areaSrc: 'table', windows: null, panoramic: 0,
                        outerWalls: o && o.count ? Math.min(3, o.count) : null, heated: !this.HEATED_NOT_RE.test(t.name), confidence: 1, note: null,
                        _outerSides: o ? o.sides : null,
                    };
                }),
                unclear: [],
            };
        });
        return out.some(Boolean) ? out : null;
    },

    setSrc(r, field, v) {
        r.eng = r.eng || {};
        r.eng.src = r.eng.src || {};
        r.eng.src[field] = v;
    },

    /**
     * Зоны тёплого пола и приборы отопления — по карте. Подписи «S=…» и
     * марки «РД-N» стоят внутри своих комнат. Перекладываем, только если
     * своя комната нашлась у каждой подписи (у зон) и у каждой марки (у
     * приборов): частичная раскладка хуже модели целиком.
     */
    geoHeat(sh, scope, map) {
        if (!map || !(sh.labels || []).length) return null;
        const zones = new Map(), marks = new Map(), pts = new Map();
        const lostZ = [], lostM = [];
        for (const l of sh.labels) {
            const r = this.rowAt(map, l.cx !== undefined ? l.cx : l.x, l.cy !== undefined ? l.cy : l.y, 600);
            if (!r || !scope.includes(r)) { (l.mark ? lostM : lostZ).push(l.s); continue; }
            if (l.mark) {
                if (!marks.has(r)) marks.set(r, []);
                if (!marks.get(r).includes(l.s)) {
                    marks.get(r).push(l.s);
                    // Где стоит прибор — чтобы отдать его ближайшему окну (fitRoom).
                    if (!pts.has(r)) pts.set(r, []);
                    const pt = { x: l.cx !== undefined ? l.cx : l.x, y: l.cy !== undefined ? l.cy : l.y };
                    // Ширина прибора по проекту — длина его символа рядом с маркой.
                    const sym = (sh.symbols || []).map(q => ({ q, d: Math.hypot(q.cx - pt.x, (q.cy - pt.y) * map.h / map.w) }))
                        .filter(o => o.d < 3).sort((a, b) => a.d - b.d)[0];
                    if (sym) pt.wMm = Math.round(sym.q.longPt * 25.4 / 72 * (sh.scale || 100) * (map.lenK || 1));
                    pts.get(r).push(pt);
                }
            } else {
                const a = this.num(String(l.s).replace(/^S=/i, '').replace(/м.*$/i, ''));
                if (a > 0) zones.set(r, (zones.get(r) || 0) + a);
            }
        }
        const out = [];
        if (zones.size && !lostZ.length) {
            let labeled = 0;
            const unl = [];
            scope.forEach(r => {
                const e = r.eng;
                if (zones.has(r)) {
                    e.ufh = true; e.ufhArea = Math.round(zones.get(r) * 100) / 100; e.ufhAreaSrc = 'label';
                    labeled += e.ufhArea;
                    this.setSrc(r, 'ufh', 'pdf');
                } else if (e.ufhAreaSrc === 'label') {
                    // Модель отдала сюда подписанную зону чужой комнаты.
                    e.ufh = false; e.ufhArea = null; e.ufhAreaSrc = null;
                    this.setSrc(r, 'ufh', 'pdf');
                } else if (e.ufh) unl.push(r);
            });
            // Зоны без подписи (гардеробные) — остаток спецификации заново:
            // сумма подписанных после раскладки могла измениться.
            const total = sh._ufhTotal;
            if (unl.length && total > labeled + 0.2) {
                const wt = r => r.eng.ufhArea > 0 ? r.eng.ufhArea : (r.area > 0 ? r.area : 1);
                const wSum = unl.reduce((a, r) => a + wt(r), 0);
                const rest = total - labeled;
                unl.forEach(r => {
                    let a = rest * wt(r) / wSum;
                    if (r.area > 0) a = Math.min(a, r.area);
                    r.eng.ufhArea = Math.round(a * 100) / 100;
                    r.eng.ufhAreaSrc = 'spec';
                });
            }
            out.push(`зоны тёплого пола — по подписям S= и стенам листа (${zones.size} ${RecognizeUI.plural(zones.size, 'помещение', 'помещения', 'помещений')})`);
        }
        if (marks.size && !lostM.length) {
            const typeOf = {};
            scope.forEach(r => (r.eng.heaterMarks || []).forEach(m => { if (r.eng.heaterType) typeOf[m] = r.eng.heaterType; }));
            let n = 0;
            scope.forEach(r => {
                const e = r.eng, mk = marks.get(r) || [];
                const types = mk.map(m => this.heaterTypeOfMark(m) || typeOf[m]).filter(Boolean);
                e.heaterType = mk.length ? (types[0] || e.heaterType || 'radiator') : null;
                e.heaters = mk.length;
                e.heaterMarks = mk;
                e.heaterPts = pts.get(r) || null;
                n += mk.length;
                this.setSrc(r, 'heaters', 'pdf');
            });
            out.push(`приборы ${n} — по маркам и стенам листа`);
        }
        const warnings = [];
        if (lostZ.length) warnings.push(`лист ${sh.num}: подписи зон ${lostZ.join(', ')} не попали ни в одно помещение — зоны разложены по картинке, проверьте`);
        if (lostM.length) warnings.push(`лист ${sh.num}: марки ${lostM.join(', ')} не попали ни в одно помещение — приборы разложены по картинке, проверьте`);
        return { summary: out, warnings };
    },

    // ------------------------------------------------------------------
    // Сколько это заняло бы руками
    //
    // Прежний счётчик считал 40 с на помещение: за проект на 92 листа — «~8
    // мин», что обесценивает работу. Честная оценка по шагам, которые
    // монтажник делает сам, по нижней границе. Норма на позицию сметы — та
    // же, что у распознавания смет (40 с: найти в прайсе, артикул, цена,
    // количество).
    // ------------------------------------------------------------------

    MANUAL_SEC: { page: 10, room: 90, window: 60, zone: 60, fixture: 40, note: 120, city: 180, bill: 40 },

    /**
     * { min, parts: [{ label, min }] } — разбор проекта руками. bill — число
     * позиций готовой сметы (оборудование и работы), если она уже посчитана.
     */
    manualEstimate(project, rows, bill) {
        const S = this.MANUAL_SEC, parts = [];
        const add = (label, n, sec) => { if (n > 0) parts.push({ label: label(n), min: n * sec / 60 }); };
        const pl = (n, a, b, c) => `${n} ${RecognizeUI.plural(n, a, b, c)}`;
        const p = project || {};
        add(n => `пролистать ${pl(n, 'лист', 'листа', 'листов')} и найти нужные`, (p.pages || []).length, S.page);
        const nRooms = (rows && rows.length) || ((p.roomTables || []).reduce((a, t) => a + (t ? t.rows.length : 0), 0));
        add(n => `${pl(n, 'помещение', 'помещения', 'помещений')}: название, площадь, стены`, nRooms, S.room);
        add(n => `${pl(n, 'окно', 'окна', 'окон')}: комната, размер, высота`, p.winSheet ? p.winSheet.labels.length : 0, S.window);
        const heat = (p.eng || []).filter(e => e.kind === 'heat').reduce((a, e) => a + (e.labels || []).length, 0);
        add(n => `${pl(n, 'зона и прибор', 'зоны и приборы', 'зон и приборов')} отопления по комнатам`, heat, S.zone);
        const fx = (p.eng || []).filter(e => e.kind === 'water').reduce((a, e) => a + (e.fixtures ? e.fixtures.marks.length : 0), 0);
        add(n => `${pl(n, 'марка', 'марки', 'марок')} сантехники по спецификации`, fx, S.fixture);
        add(n => `${pl(n, 'блок', 'блока', 'блоков')} примечаний прочитать и учесть`, (p.notes || []).length, S.note);
        if (p.address) add(() => 'город и климат по адресу', 1, S.city);
        add(n => `смета: ${pl(n, 'позиция', 'позиции', 'позиций')} подобрать в прайсе`, bill || 0, S.bill);
        const min = Math.round(parts.reduce((a, x) => a + x.min, 0));
        parts.forEach(x => { x.min = Math.max(1, Math.round(x.min)); });
        return { min, parts };
    },

    /**
     * Полотенцесушители из спецификации приборов текстом: «Полотенцесушитель
     * электро». По строке на прибор — сколько строк, столько и штук.
     */
    towelsOf(text) {
        const hits = String(text || '').match(/полотенцесушител\S*\s*(электр\S*|водян\S*)/gi) || [];
        if (!hits.length) return null;
        return { count: hits.length, type: hits.every(h => /водян/i.test(h)) ? 'water' : 'electric' };
    },

    /**
     * Сколько позиций будет в смете — пока распознавание идёт, её ещё нет.
     * Оценка по составу проекта: котельная и общие материалы (~80), плюс на
     * помещение, прибор отопления, марку сантехники и зону тёплого пола.
     * На «Хвойной 3» даёт ~240 при 243 в готовом КП № 415033-1.
     */
    billGuess(project) {
        const p = project || {};
        const rooms = (p.roomTables || []).reduce((a, t) => a + (t ? t.rows.length : 0), 0);
        const heat = (p.eng || []).filter(e => e.kind === 'heat');
        const marks = heat.reduce((a, e) => a + (e.labels || []).filter(l => l.mark).length, 0);
        const zones = heat.reduce((a, e) => a + (e.labels || []).filter(l => !l.mark).length, 0);
        const fx = (p.eng || []).filter(e => e.kind === 'water').reduce((a, e) => a + (e.fixtures ? e.fixtures.marks.length : 0), 0);
        return Math.round((80 + rooms * 3 + marks * 6 + fx * 5 + zones * 2) / 10) * 10;
    },

    /** «≈4,5 ч» — итог крупно: полчаса точности здесь достаточно. */
    roughTime(min) {
        if (min < 90) return `${Math.round(min / 5) * 5} мин`;
        const h = Math.round(min / 30) / 2;
        return `${String(h).replace('.', ',')} ч`;
    },

    /**
     * Что показывать про ручную работу: итог и строки «из чего» по очереди.
     * bill — число позиций готовой сметы; не передано — оценка billGuess.
     */
    savingPlan(project, rows, bill) {
        const guessed = !(bill > 0);
        const n = guessed ? this.billGuess(project) : bill;
        const est = this.manualEstimate(project, rows, 0);
        const billMin = Math.round(n * this.MANUAL_SEC.bill / 60);
        const lines = est.parts.map(x => `${x.label} — <b>${RecognizeUI.handTime(x.min)}</b>`);
        lines.push(`смета по проекту: ${guessed ? '≈' : ''}${n} ${RecognizeUI.plural(n, 'позиция', 'позиции', 'позиций')} по 40 с — <b>${RecognizeUI.handTime(billMin)}</b>`);
        const total = est.min + billMin;
        return { total, parse: est.min, billMin, bill: n, guessed, lines,
            totalLine: `разбор ${RecognizeUI.handTime(est.min)} + смета ${RecognizeUI.handTime(billMin)} = <b>≈${this.roughTime(total)} руками</b>` };
    },

    /** Итог спецификации тёплого пола из текста листа: «Водяной тёплый пол … 121,95». */
    ufhTotalOf(text) {
        // Число отдельной строкой после заголовка таблицы — не «S=4,22м2» с плана.
        const m = String(text || '').match(/спецификаци\S*\s+т[её]пл\S*\s+пол[\s\S]{0,200}?\n\s*(\d{1,4}[.,]\d{1,2})\s*(\n|$)/i);
        const v = m ? this.num(m[1]) : null;
        return v > 0 ? v : null;
    },

    /**
     * Тип прибора по марке. РД / Р — радиатор: так их и обозначают, и на
     * «Хвойной 3» РД-1…РД-5 — узкие радиаторы в простенках между окнами в
     * пол, а модель по окнам в пол назвала их конвекторами в полу, и в КП
     * ушли три внутрипольных конвектора с вентилятором по 62 тыс. КВ —
     * конвектор внутрипольный. Прочие марки — как решила модель.
     */
    heaterTypeOfMark(mark) {
        const p = String(mark || '').toUpperCase().replace(/-.*$/, '');
        if (p === 'РД' || p === 'Р') return 'radiator';
        if (p === 'КВ') return 'floor_convector';
        return null;
    },

    /**
     * Тип прибора по строке спецификации сантехники. Смеситель и сам прибор
     * — две марки одного прибора: считаем по большему из двух (раковина и
     * смеситель к ней — одна раковина). Гигиенический душ — не душ.
     */
    fixKind(t) {
        const s = String(t || '').toLowerCase().replace(/ё/g, 'е');
        if (/гигиен/.test(s)) return null;
        if (/унитаз/.test(s)) return /биде/.test(s) ? 'toiletHot' : 'toilet';
        if (/инсталляц/.test(s)) return 'toilet';
        if (/стиральн/.test(s)) return 'wash';
        if (/посудомо/.test(s)) return 'dish';
        if (/смесител|термостат/.test(s)) return /ванн/.test(s) ? 'bathMix' : /душ/.test(s) ? 'showerMix' : 'basinMix';
        if (/биде/.test(s)) return 'bidet';
        if (/трап/.test(s)) return 'drain';
        if (/ванн/.test(s)) return 'bath';
        if (/лейк|ручн\S*\s+душ/.test(s)) return 'showerHand';
        if (/душ/.test(s)) return 'shower';
        if (/раковин|умывальник|мойк/.test(s)) return 'basin';
        return null;
    },

    /**
     * Сантехника по маркам плана и спецификации — поверх модели. Стиральные,
     * посудомоечные и трапы на «Хвойной 3» подписаны выносками за стенами
     * дома, без марок, — их оставляем модели, если в спецификации их нет.
     */
    geoWater(sh, scope, map) {
        const fx = sh.fixtures;
        if (!map || !fx || !fx.marks || !fx.marks.length) return null;
        const per = new Map(), lost = [];
        for (const m of fx.marks) {
            const r = this.rowAt(map, m.cx, m.cy, 600);
            if (!r || !scope.includes(r)) { lost.push(m.s); continue; }
            if (!per.has(r)) per.set(r, []);
            per.get(r).push(this.fixKind(fx.spec[m.s]));
        }
        if (lost.length) {
            return { summary: [], warnings: [`лист ${sh.num}: марки сантехники ${lost.join(', ')} не попали ни в одно помещение — сантехника разложена по картинке, проверьте`] };
        }
        const specKinds = new Set(Object.values(fx.spec).map(t => this.fixKind(t)));
        scope.forEach(r => {
            const kinds = per.get(r) || [];
            const c = k => kinds.filter(x => x === k).length;
            const f = Object.assign({}, ...this.FIX_KEYS.map(k => ({ [k]: 0 })), r.eng.fix || {});
            f.toiletHot = c('toiletHot');
            f.toilet = c('toilet') + c('toiletHot');
            f.bidet = c('bidet');
            f.bath = Math.max(c('bath'), c('bathMix'));
            f.shower = Math.max(c('shower'), c('showerHand'), c('showerMix'));
            f.basin = Math.max(c('basin'), c('basinMix'));
            if (specKinds.has('drain')) f.drain = c('drain');
            if (specKinds.has('wash')) f.wash = c('wash');
            if (specKinds.has('dish')) f.dish = c('dish') + (r.eng.robot || 0);
            r.eng.fix = this.FIX_KEYS.some(k => f[k]) ? f : null;
            this.setSrc(r, 'fix', 'pdf');
        });
        return { summary: [`сантехника — по маркам спецификации и стенам листа (${fx.marks.length} ${RecognizeUI.plural(fx.marks.length, 'марка', 'марки', 'марок')})`], warnings: [] };
    },

    // ------------------------------------------------------------------
    // Требования из примечаний проекта
    //
    // Примечания собирает RecognizeFiles.collectNotes со всех листов, без
    // модели. Модель одним текстовым запросом (без картинки — дёшево)
    // оставляет то, что касается наших систем, и говорит, что с этим делать.
    // Монтажник отмечает нужное на экране проверки, отмеченное уходит в
    // state.projectReqs и висит плашкой в шапке сметы (app.projectReqsNote).
    // ------------------------------------------------------------------

    REQ_TOPICS: {
        heat: 'Отопление', ufh: 'Тёплый пол', water: 'Водоснабжение', sewer: 'Канализация',
        vent: 'Вентиляция', boiler: 'Котельная', general: 'Общее',
    },
    REQ_ACTIONS: {
        add: 'добавить в смету',
        check: 'уточнить',
        mount: 'учесть при монтаже',
    },

    async readNotes(project, onStatus) {
        this.reqs = [];
        const notes = (project && project.notes) || [];
        if (!notes.length) return { warnings: [] };
        const ui = RecognizeUI;
        if (onStatus) onStatus('Читаю примечания проекта…');
        const body = notes.map(n => `### Лист ${n.sheets.join(', ')} «${n.title}»\n${n.text}`).join('\n\n');
        try {
            const data = await ui.askModel([{ text: `Примечания и пометки со всех листов проекта:\n\n${body}\n\nВерни только JSON.` }],
                PROJECT_NOTES_PROMPT);
            const cand = data?.candidates?.[0];
            const text = cand?.content?.parts?.[0]?.text;
            if (!text) throw new Error('пустой ответ');
            const parsed = ui.parseModelJson(text, cand.finishReason);
            const sheetsAll = new Set(notes.flatMap(n => n.sheets));
            this.reqs = (Array.isArray(parsed.reqs) ? parsed.reqs : []).map(r => {
                r = r || {};
                const sheet = Math.round(this.num(r.sheet));
                const t = String(r.text || '').replace(/\s+/g, ' ').trim();
                if (!t) return null;
                return {
                    sheet: sheetsAll.has(sheet) ? sheet : null,
                    topic: this.REQ_TOPICS[r.topic] ? r.topic : 'general',
                    action: this.REQ_ACTIONS[r.action] ? r.action : 'mount',
                    text: t.slice(0, 220),
                    quote: String(r.quote || '').replace(/\s+/g, ' ').trim().slice(0, 240),
                    _sel: true,
                };
            }).filter(Boolean).slice(0, 30);
            return { warnings: [] };
        } catch (e) {
            if (e.quota) return { warnings: [e.message] };
            return { warnings: [`примечания проекта не разобраны: ${ui.cleanError(e.message).split('\n')[0]}`] };
        }
    },

    setReq(i, v) { if (this.reqs && this.reqs[i]) this.reqs[i]._sel = !!v; },

    /** Блок на экране проверки: требования с галочками, по разделам. */
    reqsBlock() {
        const reqs = this.reqs || [];
        if (!reqs.length) return '';
        const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const chip = a => `<span style="font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid var(--border,#cbd5e1);white-space:nowrap">${this.REQ_ACTIONS[a]}</span>`;
        const n = reqs.filter(r => r._sel).length;
        const rows = reqs.map((r, i) => `
            <label style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-top:1px solid var(--border,#e2e8f0);cursor:pointer">
              <input type="checkbox" ${r._sel ? 'checked' : ''} style="margin-top:3px" onchange="RecognizePlan.setReq(${i}, this.checked); RecognizePlan.renderReview()">
              <span style="flex:1;min-width:0">
                <span style="font-weight:600">${esc(this.REQ_TOPICS[r.topic])}.</span> ${esc(r.text)}
                <span style="display:block;font-size:11.5px;color:var(--text-sec,#64748b)">${r.sheet ? `лист ${r.sheet}` : 'проект'}${r.quote ? ` · «${esc(r.quote)}»` : ''}</span>
              </span>
              ${chip(r.action)}
            </label>`).join('');
        return `<details class="rec-tcheck" style="display:block" ${this._reqsOpen ? 'open' : ''} ontoggle="RecognizeProject._reqsOpen = this.open">
            <summary style="cursor:pointer">📝 Требования из примечаний проекта: <b>${n} из ${reqs.length}</b> в смету</summary>
            <div class="rec-tcheck-sub" style="margin:4px 0">Отмеченные попадут в смету плашкой «Требования проекта» — чтобы не потерялись при подборе и монтаже.</div>
            ${rows}</details>`;
    },

    /** Отмеченные требования — в состояние расчёта. */
    applyReqs(st) {
        const sel = (this.reqs || []).filter(r => r._sel)
            .map(({ sheet, topic, action, text, quote }) => ({ sheet, topic, action, text, quote }));
        if (!sel.length) return 0;
        st.projectReqs = sel;
        return sel.length;
    },

    // ------------------------------------------------------------------
    // Город расчёта по адресу объекта
    // ------------------------------------------------------------------

    /**
     * Город из CITIES_DB по адресу из штампа или обложки. Сперва — город,
     * названный в адресе словом («г. Истра»). Нет — по области
     * (CITY_REGION_MAP): её центр, если он есть в справочнике
     * (Калининград для «Калининградской обл.»), иначе первый её город.
     * Возвращает { city, index, by } или null.
     */
    cityFromAddress(addr) {
        if (!addr || typeof CITIES_DB === 'undefined') return null;
        const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
        const a = norm(addr);
        const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const asWord = n => new RegExp('(^|[^а-яa-z])' + esc(n) + '([^а-яa-z]|$)').test(a);
        const all = CITIES_DB.map((city, index) => ({ city, index, key: norm(city.name) }));
        const byName = all.filter(c => c.key.length > 2 && asWord(c.key)).sort((x, y) => y.key.length - x.key.length);
        if (byName.length) return { city: byName[0].city, index: byName[0].index, by: 'город' };
        if (typeof CITY_REGION_MAP === 'undefined') return null;
        const stem = s => norm(s).replace(/область|обл\.?|край|республика|респ\.?|автономный|округ/g, ' ').replace(/\s+/g, ' ').trim();
        const inRegion = all.filter(c => {
            const reg = CITY_REGION_MAP[c.key];
            const rs = reg ? stem(reg) : '';
            return rs.length > 3 && a.includes(rs);
        });
        if (!inRegion.length) return null;
        const center = inRegion.find(c => stem(CITY_REGION_MAP[c.key]).startsWith(c.key.slice(0, Math.max(4, c.key.length - 1)))) || inRegion[0];
        return { city: center.city, index: center.index, by: 'область' };
    },

    /** Город проекта: найти и запомнить для экрана проверки. */
    readCity(project) {
        const hit = this.cityFromAddress(project && project.address);
        this.city = hit ? Object.assign(hit, { address: project.address, use: true }) : null;
    },

    setCityUse(v) { if (this.city) this.city.use = !!v; },

    cityLine() {
        const c = this.city;
        if (!c) return '';
        const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
        const cur = (typeof app !== 'undefined' && app.state && app.state.selectedCity) ? app.state.selectedCity.name : '';
        return `<label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer">
            <input type="checkbox" ${c.use ? 'checked' : ''} style="margin-top:3px" onchange="RecognizePlan.setCityUse(this.checked)">
            <span>Город: <b>${esc(c.city.name)}</b> (${c.city.temp} °C)${
                cur && cur !== c.city.name ? `, сейчас ${esc(cur)}` : ''}</span></label>`;
    },

    applyCity(st) {
        const c = this.city;
        if (!c || !c.use) return '';
        st.selectedCity = c.city;
        // Та же формула, что в app.selectCity: K = (20 − T_нар) / 45.
        st.region = Math.round(((20 - c.city.temp) / 45) * 100);
        return `${c.city.name} (${c.city.temp} °C)`;
    },

    // ------------------------------------------------------------------
    // Окна по обмерному плану
    //
    // На плане мебели окно в пол не отличить от обычного, и модель путала:
    // на «Хвойной 3» насчитала 11 окон, в одном прогоне с 2 панорамными в
    // кухне, в другом без них. На обмерном плане у каждого окна подпись:
    // «Окна в пол (2 створки) hокна=2 400мм hот пола=0мм» — 17 окон, 12 в
    // пол. Подписи стоят на выносках за контуром дома, поэтому к комнате
    // окно относит модель по картинке, а высоты берутся из текста PDF.
    // ------------------------------------------------------------------

    async readWindows(rows, project, onStatus) {
        const ws = project && project.winSheet;
        if (!ws || !ws.labels || !ws.labels.length) return { summary: [], warnings: [] };
        const ui = RecognizeUI;

        // Сперва по карте помещений: конец выноски каждого окна — в стене
        // своей комнаты. Все окна нашли комнату — модель не нужна (и запрос
        // из лимита не тратится); часть — модель читает остальные.
        const map = this.geoMap(rows, project, 0);
        const geo = [];
        if (map) {
            ws.labels.forEach(l => {
                const r = l.wx !== undefined ? this.rowAt(map, l.wx, l.wy, 900) : null;
                if (r) geo.push({ l, r, width: RecognizeGeo.gapWidth(map, l.wx, l.wy) });
            });
            // Два окна в одном проёме (мастер-санузел «Хвойной 3»: две створки
            // в проёме 2,4 м) — ширина проёма на обоих. Концы выносок одной
            // комнаты ближе друг к другу, чем ширина проёма, и ширина та же —
            // это один проём, делим его поровну.
            const pctToM = d => d / 100 * map.w * map.mmPx * (map.lenK || 1) / 1000;
            const seen = new Set();
            geo.forEach(g => {
                if (seen.has(g) || !g.width) return;
                const same = geo.filter(o => o.r === g.r && o.width && Math.abs(o.width - g.width) < 0.06 &&
                    pctToM(Math.hypot(o.l.wx - g.l.wx, (o.l.wy - g.l.wy) * map.h / map.w)) < g.width);
                if (same.length < 2) return;
                const w = Math.round(g.width / same.length * 100) / 100;
                same.forEach(o => { o.width = w; seen.add(o); });
            });
        }
        const geoParsed = extra => {
            const byRow = new Map();
            geo.forEach(g => {
                if (!byRow.has(g.r)) byRow.set(g.r, []);
                byRow.get(g.r).push({ label: g.l.n, width: g.width });
            });
            const taken = new Set(geo.map(g => g.l.n));
            const rooms = [...byRow].map(([r, windows]) => ({ n: rows.indexOf(r) + 1, windows }));
            // Окна, которые разложила модель, — только из тех, что карта не нашла.
            ((extra && extra.rooms) || []).forEach(x => {
                const ws2 = (x.windows || []).filter(w => !taken.has(Math.round(this.num(w && w.label))));
                if (!ws2.length) return;
                const same = rooms.find(o => o.n === Math.round(this.num(x.n)));
                if (same) same.windows.push(...ws2); else rooms.push({ n: x.n, windows: ws2 });
            });
            return { rooms, unclear: extra && extra.unclear };
        };
        const markGeo = res => {
            const allGeo = geo.length === ws.labels.length;
            rows.forEach(r => {
                const mine = geo.filter(g => g.r === r).length;
                if (mine && mine === (r.windows || 0)) this.setSrc(r, 'windows', 'pdf');
                // Все окна листа нашли комнату (по чертежу или моделью), а у
                // этой их нет — значит, окон у неё и правда нет. Иначе
                // оставалась цифра с первого чтения плана: у гардеробной
                // «Хвойной 3» — окно, которого в проекте нет.
                const hasSpec = r.eng && r.eng.winSpec && r.eng.winSpec.length;
                // Помещения собраны из PDF без модели (windows === null) —
                // окна знает только обмерный план: нет своих подписей — 0,
                // а не «1 по умолчанию» у каждой кладовой.
                if ((!res.lost || r.windows === null) && !hasSpec) {
                    r.windows = 0; r.panoramic = 0;
                    if (allGeo) this.setSrc(r, 'windows', 'pdf');
                }
            });
            res.summary = res.summary.map(t => t.replace(/\.$/, '') + (geo.length
                ? `; ${geo.length} из ${ws.labels.length} — по концам выносок и стенам листа, без модели.` : '.'));
            return res;
        };
        if (geo.length && geo.length === ws.labels.length) return markGeo(this.takeWindows(geoParsed(null), rows, ws));

        if (onStatus) onStatus(`Читаю лист ${ws.num} — окна…`);
        const words = project.roomWords && project.roomWords.length === 1 ? project.roomWords[0] : null;
        const pos = this.roomPositions(rows, words);
        const list = rows.map((r, n) => `${n + 1}. ${r.name}${r.area > 0 ? `, ${this.fmt(r.area)} м²` : ''}` +
            (pos[n] ? `, подпись на плане (${pos[n].x}%, ${pos[n].y}%)` : '')).join('\n');
        const labels = ws.labels.map(l => `${l.n}. «${l.s}», высота ${this.fmt(l.h)} м, от пола ${
            l.sill === null ? '—' : this.fmt(l.sill) + ' м'} — подпись в точке (${l.x}%, ${l.y}%)` +
            (l.wx !== undefined ? `; само окно (конец выноски, из PDF точно) — в точке (${l.wx}%, ${l.wy}%)` : '')).join('\n');
        // Крупный кадр дома с метками: красные «№» у подписей окон, синие
        // «номер. Название» в помещениях. Не вышло — лист целиком, как прежде.
        let img = ws.img, marked = false, imgRooms = null;
        if (ws.crop) {
            try { img = await this.markWindowsImage(ws, rows, pos); marked = true; } catch (e) { img = ws.img; }
            // Второй кадр — та же рамка с листа помещений (после перепланировки).
            if (marked && ws.cropRooms) {
                try { imgRooms = await this.markWindowsImage(ws, rows, pos, ws.cropRooms, true); } catch (e) { imgRooms = null; }
            }
        }
        try {
            const data = await ui.askModel([
                { text: `Лист ${ws.num} «${ws.title}». Помещения дома (координаты подписей — с листа планировки, листы в одном масштабе и положении):\n${list}\n\n` +
                    `Подписи окон на этом листе (текст и координаты взяты из PDF точно):\n${labels}\n\n` +
                    (marked ? 'На картинке — только дом, крупно. Красная метка «№N» стоит у подписи окна N; синяя метка «N. Название» — ' +
                        'в помещении N списка. Иди по выноске от красной метки к окну и смотри, в стене какого помещения (синей метки) оно. ' +
                        'Координаты в тексте — по всему листу, а не по картинке.\n\n' : '') +
                    (imgRooms ? `Картинок две, в одном кадре и с одинаковыми метками. Первая — этот лист ${ws.num} с выносками к окнам ` +
                        `(он может показывать дом до перепланировки). Вторая — лист ${ws.roomsNum}, стены после перепланировки, выносок на нём нет; ` +
                        'на ней красная точка «№N» стоит прямо в окне N — это конец его выноски, найденный в PDF. ' +
                        'Помещение окна — то, в чьей наружной стене стоит точка на второй картинке: смотри на перегородки рядом с точкой, ' +
                        'а не на расстояние до синих меток. Окна без точки ищи по выноске на первой картинке.\n\n' : '') +
                    'Верни только JSON.' },
                { inline_data: { mime_type: 'image/jpeg', data: img } },
                ...(imgRooms ? [{ inline_data: { mime_type: 'image/jpeg', data: imgRooms } }] : []),
            ], PROJECT_WINDOWS_PROMPT);
            const cand = data?.candidates?.[0];
            const text = cand?.content?.parts?.[0]?.text;
            if (!text) throw new Error('пустой ответ');
            const parsed = ui.parseModelJson(text, cand.finishReason);
            return geo.length ? markGeo(this.takeWindows(geoParsed(parsed), rows, ws)) : this.takeWindows(parsed, rows, ws);
        } catch (e) {
            // Модель не ответила — то, что разложено по чертежу, всё равно в деле.
            if (geo.length) {
                const res = markGeo(this.takeWindows(geoParsed(null), rows, ws));
                res.warnings.push(e.quota ? e.message : `лист ${ws.num}: окна без выноски не прочитаны — ${ui.cleanError(e.message).split('\n')[0]}`);
                return res;
            }
            if (e.quota) return { summary: [], warnings: [e.message] };
            return { summary: [], warnings: [`лист ${ws.num} (окна) не прочитан: ${ui.cleanError(e.message).split('\n')[0]}`] };
        }
    },

    /**
     * Кадр обмерного плана с метками для модели. Координаты подписей окон
     * и помещений — в процентах листа, кадр — рамка ws.crop.box в тех же
     * процентах: пересчёт линейный. Метки полупрозрачные, чтобы не закрыть
     * выноски, и стоят чуть в стороне от точки подписи — сама подпись
     * остаётся читаемой.
     */
    async markWindowsImage(ws, rows, pos, src, atWindow) {
        const box = ws.crop.box;
        const b64 = src || ws.crop.b64;
        const im = new Image();
        await new Promise((ok, err) => { im.onload = ok; im.onerror = () => err(new Error('кадр не открылся')); im.src = 'data:image/jpeg;base64,' + b64; });
        const c = document.createElement('canvas');
        c.width = im.naturalWidth; c.height = im.naturalHeight;
        const g = c.getContext('2d');
        g.drawImage(im, 0, 0);
        const X = x => (x - box.x0) / (box.x1 - box.x0) * c.width;
        const Y = y => (y - box.y0) / (box.y1 - box.y0) * c.height;
        const fs = Math.max(14, Math.round(c.width / 90));
        const tag = (text, x, y, fill) => {
            g.font = `bold ${fs}px Arial, sans-serif`;
            const w = g.measureText(text).width + fs * 0.6, h = fs * 1.35;
            g.globalAlpha = 0.85;
            g.fillStyle = fill;
            g.fillRect(x, y - h / 2, w, h);
            g.globalAlpha = 1;
            g.fillStyle = '#fff';
            g.textBaseline = 'middle';
            g.fillText(text, x + fs * 0.3, y);
        };
        ws.labels.forEach(l => {
            const t = `№${l.n}`;
            g.font = `bold ${fs}px Arial, sans-serif`;
            // На плане после перепланировки выносок нет — метка ставится в
            // само окно (конец выноски, найденный в PDF): красная точка и номер.
            if (atWindow && l.wx !== undefined) {
                const cx = X(l.wx), cy = Y(l.wy);
                g.globalAlpha = 0.9; g.fillStyle = '#dc2626';
                g.beginPath(); g.arc(cx, cy, fs * 0.45, 0, Math.PI * 2); g.fill();
                g.globalAlpha = 1;
                tag(t, cx + fs * 0.6, cy - fs * 0.9, '#dc2626');
                return;
            }
            if (atWindow) return;       // точки нет — на втором кадре не гадаем
            tag(t, X(l.x) - g.measureText(t).width - fs * 1.2, Y(l.y) - fs * 0.4, '#dc2626');
        });
        rows.forEach((r, k) => { if (pos[k]) tag(`${k + 1}. ${r.name}`, X(pos[k].x), Y(pos[k].y) + fs * 1.3, '#1d4ed8'); });
        return c.toDataURL('image/jpeg', 0.85).split(',')[1];
    },

    takeWindows(parsed, rows, ws) {
        const warnings = [];
        const byN = new Map(ws.labels.map(l => [l.n, l]));
        const used = new Set();
        let nWin = 0, nFloor = 0;
        (Array.isArray(parsed.rooms) ? parsed.rooms : []).forEach(x => {
            const r = this.rowOf(rows, x && x.n);
            if (!r) return;
            const spec = [];
            (Array.isArray(x.windows) ? x.windows : []).forEach(w => {
                const l = byN.get(Math.round(this.num(w && w.label)));
                if (!l || used.has(l.n)) return;
                used.add(l.n);
                const width = this.num(w.width);
                spec.push({ h: l.h, sill: l.sill === null ? null : l.sill, floor: l.floor || (l.sill !== null && l.sill <= 0.3 && l.h >= 2),
                    wx: l.wx, wy: l.wy,
                    width: width > 300 ? Math.round(width) / 1000 : (width > 0.3 && width < 6 ? width : null) });
            });
            if (!spec.length) return;
            r.eng = r.eng || {};
            r.eng.winSpec = spec;
            r.eng.winSheet = ws.num;
            // Таблица проверки показывает то же, что уйдёт в расчёт.
            r.windows = spec.length;
            r.panoramic = spec.filter(s => s.floor).length;
            nWin += spec.length;
            nFloor += r.panoramic;
        });
        const lost = ws.labels.filter(l => !used.has(l.n));
        if (lost.length) warnings.push(`лист ${ws.num}: окна без помещения — ${lost.map(l => `№${l.n} «${l.s}»`).join(', ')}` +
            ' — добавьте их в «Окон» нужной строки');
        if (Array.isArray(parsed.unclear)) parsed.unclear.filter(Boolean)
            .forEach(u => warnings.push(`лист ${ws.num}: ${this.unclearText(u)}`));
        return {
            summary: [`Лист ${ws.num} «${ws.title}»: окон ${nWin} из ${ws.labels.length} подписанных, из них в пол ${nFloor} — высоты и подоконники по подписям листа.`],
            warnings,
            lost: lost.length,
        };
    },

    /** Пояснение модели строкой: бывает текстом, бывает объектом {label, reason}. */
    unclearText(u) {
        if (typeof u === 'string') return u;
        if (u && typeof u === 'object') {
            const parts = Object.entries(u).map(([k, v]) => (k === 'label' ? `окно №${v}` : String(v)));
            return parts.join(' — ');
        }
        return String(u);
    },

    /**
     * Окна строки поправили руками на экране проверки — подгоняем список
     * окон с обмерного плана, а не выбрасываем: высоты и подоконники с
     * листа остаются. Лишние окна срезаются с конца, недостающие повторяют
     * последнее обычное; «из них панорамных» — первые N окон в пол.
     */
    resizeWinSpec(r) {
        const spec = r.eng && r.eng.winSpec;
        if (!spec) return;
        const n = r.windows === null ? 1 : r.windows;
        if (n <= 0) { r.eng.winSpec = null; return; }
        const plain = spec.filter(s => !s.floor).slice(-1)[0] || { h: 1.5, sill: 0.8, floor: false, width: null };
        const next = spec.slice(0, n);
        while (next.length < n) next.push(Object.assign({}, plain));
        let pan = Math.min(r.panoramic || 0, n);
        const floorSpec = spec.find(s => s.floor) || { h: 2.4, sill: 0, floor: true, width: null };
        next.sort((a, b) => (b.floor ? 1 : 0) - (a.floor ? 1 : 0));
        next.forEach((s, k) => {
            if (k < pan && !s.floor) Object.assign(s, { h: floorSpec.h, sill: floorSpec.sill, floor: true });
            if (k >= pan && s.floor) Object.assign(s, { h: plain.h, sill: plain.sill, floor: false });
        });
        r.eng.winSpec = next;
    },

    /** Окна комнаты расчёта по обмерному плану — вместо окон по умолчанию. */
    fitWindows(room, r) {
        const spec = r.eng && r.eng.winSpec;
        if (!spec || !spec.length) return;
        const defW = (typeof app !== 'undefined' && typeof app.getDefaultWindowWidth === 'function')
            ? app.getDefaultWindowWidth(r.area) : 1.5;
        room.windows = spec.map((s, k) => {
            const w = { id: room.id + k + 1, width: s.width || defW, isPan: !!s.floor, height: Math.round(s.h * 100) / 100 };
            if (s.width) w.isManualWidth = true;
            if (s.sill !== null && s.sill !== undefined) w.sill = Math.round(s.sill * 100) / 100;
            return w;
        });
    },

    winNotes(r) {
        const spec = r.eng && r.eng.winSpec;
        if (!spec || !spec.length) return [];
        const groups = {};
        spec.forEach(s => {
            const k = s.floor ? `в пол ${this.fmt(s.h)} м` : `${this.fmt(s.h)} м, подок. ${s.sill === null ? '?' : this.fmt(s.sill)} м`;
            groups[k] = (groups[k] || 0) + 1;
        });
        return [`окна по листу ${r.eng.winSheet}: ` + Object.entries(groups).map(([k, n]) => `${n} × ${k}`).join('; ')];
    },

    SHEET_WHAT: { heat: 'отопления', water: 'сантехники', vent: 'вентиляции' },
    SHEET_TOPIC: {
        heat: 'отопление и тёплые полы',
        water: 'водоснабжение и канализация',
        vent: 'вентиляция и кондиционирование',
    },

    // ------------------------------------------------------------------
    // Вентиляция
    //
    // В расчёте это одна настройка на дом (app.state.ventilationType): от неё
    // кратность в нагреве приточного воздуха — 0,35 / 1,0 / 0,25 ч⁻¹. Ошибка
    // дорогая: «принудительная» втрое поднимает вентиляционную долю потерь и
    // с ней котёл. Поэтому настройку меняем, только когда тип назван ясно, и
    // показываем на экране проверки, по какому признаку решили.
    // ------------------------------------------------------------------

    VENT_NAMES: {
        natural: 'естественная',
        forced: 'принудительная, без рекуперации',
        recuperator: 'приточно-вытяжная с рекуперацией',
        ac_only: 'только кондиционирование — свежего воздуха не подаёт',
        unknown: 'по листу не понять',
    },

    /**
     * Тип по тексту листа, если он назван прямо. Рекуператор главнее
     * «приточной установки»: ПВУ с рекуператором — тоже приточная.
     */
    ventFromText(text) {
        const t = String(text || '');
        const hit = (re) => { const m = t.match(re); return m ? m[0].replace(/\s+/g, ' ').trim() : ''; };
        let ev = hit(/[^\n]*рекуперат[^\n]*/i);
        if (ev) return { system: 'recuperator', evidence: ev, byText: true };
        ev = hit(/[^\n]*(приточно[\s-]*вытяжн|приточн[а-я]*\s+установк|\bПВУ\b|вентустановк|вентиляционн[а-я]*\s+установк)[^\n]*/i);
        if (ev) return { system: 'forced', evidence: ev, byText: true };
        return null;
    },

    takeVent(parsed, sh) {
        const sys = this.VENT_NAMES[parsed && parsed.system] ? parsed.system : 'unknown';
        let evidence = String((parsed && parsed.evidence) || '').replace(/\s+/g, ' ').trim();
        if (evidence.length > 220) evidence = evidence.slice(0, 220).replace(/\s+\S*$/, '') + '…';
        const ac = this.cnt(parsed && parsed.conditioners);
        // В расчёт по умолчанию — только ясный ответ про приток. Кондиционер
        // гоняет воздух помещения по кругу и на теплопотери не влияет.
        const choice = (sys === 'natural' || sys === 'forced' || sys === 'recuperator') ? sys : '';
        this.vent = { sheet: sh.num, system: sys, evidence, conditioners: ac, choice, byText: !!(parsed && parsed.byText) };
        const warnings = [];
        if (Array.isArray(parsed && parsed.unclear)) parsed.unclear.filter(Boolean).forEach(u => warnings.push(`лист ${sh.num}: ${u}`));
        return {
            summary: `Лист ${sh.num} «${sh.title}»: вентиляция — ${this.VENT_NAMES[sys]}` +
                (evidence ? ` (${this.vent.byText ? 'в тексте листа' : 'признак'}: «${evidence}»)` : '') +
                (ac ? `; кондиционеров ${ac}` : '') + '.',
            warnings,
        };
    },

    /** Выбор на экране проверки: '' — настройку расчёта не трогать. */
    setVentChoice(v) {
        if (!this.vent) return;
        this.vent.choice = ['natural', 'forced', 'recuperator'].includes(v) ? v : '';
    },

    /** Выпадающий список над таблицей помещений. */
    ventSelect() {
        if (!this.vent) return '';
        const cur = (typeof app !== 'undefined' && app.state && app.state.ventilationEnabled)
            ? (app.state.ventilationType || 'natural') : 'natural';
        const opt = (v, t) => `<option value="${v}" ${this.vent.choice === v ? 'selected' : ''}>${t}</option>`;
        return `<label style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap">Вентиляция в расчёте:
            <select class="rec-f" style="width:auto;padding:2px 4px" onchange="RecognizePlan.setVent(this.value)">
              ${opt('', `не менять (сейчас ${this.VENT_NAMES[cur] ? this.VENT_NAMES[cur].split(',')[0] : 'естественная'})`)}
              ${opt('natural', 'естественная — 0,35 ч⁻¹')}
              ${opt('forced', 'принудительная — 1,0 ч⁻¹')}
              ${opt('recuperator', 'с рекуперацией — 0,25 ч⁻¹')}
            </select></label>`;
    },

    applyVent(st) {
        if (!this.vent || !this.vent.choice) return '';
        st.ventilationEnabled = true;
        st.ventilationType = this.vent.choice;
        return this.VENT_NAMES[this.vent.choice];
    },

    /**
     * Марки приборов отопления в тексте листа: РД-1, Р-2, К-3, КВ-1, КП-2.
     * \b в JS кириллицу не видит — границу слова задаём явно.
     */
    heaterMarks(text) {
        const set = new Set();
        const re = /(^|[^А-ЯЁA-Z\d-])((?:РД|КВ|КП|Р|К)-\d{1,2})(?!\d)/g;
        let m;
        while ((m = re.exec(String(text || '')))) set.add(m[2]);
        return [...set].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
    },

    /**
     * Строка по номеру из ответа модели (номера в списке — с единицы, общие
     * на весь дом). scope — строки этого листа: номер чужого этажа модели не
     * давали, и если она его назвала, это ошибка, а не находка.
     */
    rowOf(rows, n, scope) {
        const k = Math.round(this.num(n)) - 1;
        const r = (k >= 0 && k < rows.length) ? rows[k] : null;
        return r && (!scope || scope.includes(r)) ? r : null;
    },

    /**
     * scope — строки этажа этого листа (по умолчанию весь дом). Сбрасываем
     * только их: второй лист отопления (2-й этаж) не должен стирать то, что
     * первый уже разложил по комнатам 1-го.
     */
    takeHeat(parsed, rows, sh, scope) {
        const warnings = [];
        scope = scope || rows;
        scope.forEach(r => {
            r.eng = r.eng || {};
            r.eng.heatSheet = sh.num;       // лист прочитан: молчание о комнате — тоже ответ
            r.eng.ufh = false; r.eng.ufhArea = null; r.eng.ufhAreaSrc = null; r.eng.heaters = 0; r.eng.heaterType = null;
        });
        let ufhSum = 0, ufhRooms = 0, heaters = 0;
        // Подписи зон «S=…м2» из PDF: площадь, которой среди них нет (ни
        // одной подписи, ни суммы двух — у комнаты бывает две зоны), модель
        // не прочитала, а оценила — такую считаем зоной без подписи.
        const labelVals = (sh.labels || []).filter(l => !l.mark)
            .map(l => this.num(String(l.s).replace(/^S=/i, '').replace(/м.*$/i, ''))).filter(v => v > 0);
        const isLabel = a => !labelVals.length || labelVals.some((v, i) =>
            Math.abs(v - a) < 0.02 || labelVals.some((u, j) => j > i && Math.abs(v + u - a) < 0.02));
        const unlabeled = [];
        (Array.isArray(parsed.rooms) ? parsed.rooms : []).forEach(x => {
            const r = this.rowOf(rows, x && x.n, scope);
            if (!r) { if (x && x.name) warnings.push(`лист ${sh.num}: «${x.name}» не найдено среди помещений`); return; }
            if (x.ufh) {
                r.eng.ufh = true;
                const a = this.num(x.ufhArea);
                ufhRooms++;
                if (a > 0 && isLabel(a)) {
                    r.eng.ufhArea = Math.round(a * 100) / 100;
                    r.eng.ufhAreaSrc = 'label';
                    ufhSum += a;
                } else {
                    // Зона заштрихована, а площадь не подписана (гардеробные
                    // «Хвойной 3»): берём из остатка спецификации ниже.
                    r.eng.ufhArea = null;
                    r.eng._approx = this.num(x.ufhApprox) || (a > 0 ? a : null);
                    unlabeled.push(r);
                }
            }
            // Марки, отнесённые к помещению, надёжнее голого числа: их модель
            // нашла на листе поимённо, и лишний прибор без марки не пройдёт.
            const mk = Array.isArray(x.heaterMarks)
                ? [...new Set(x.heaterMarks.map(s => String(s).trim()).filter(Boolean))] : [];
            const h = mk.length ? Math.min(20, mk.length) : this.cnt(x.heaters);
            r.eng.heaterMarks = mk;
            if (h) {
                r.eng.heaters = h;
                // Марка точнее картинки: РД — радиатор, как бы ни стояли окна.
                const byMark = mk.map(m => this.heaterTypeOfMark(m)).find(Boolean);
                r.eng.heaterType = byMark || (this.HEATER_NAMES[x.heaterType] ? x.heaterType : 'radiator');
                heaters += h;
            }
        });

        const tr = parsed.towelRails || {};
        const trCount = this.cnt(tr.count);
        // Полотенцесушители с листов разных этажей складываются.
        if (trCount) {
            const type = tr.type === 'water' ? 'water' : 'electric';
            this.towel = this.towel
                ? { count: this.towel.count + trCount, type: this.towel.type }
                : { count: trCount, type };
        }

        const total = this.num(parsed.ufhTotal);
        sh._ufhTotal = total > 0 ? total : null;

        // Остаток спецификации — зонам без подписи: пропорционально оценке
        // модели по чертежу (нет оценки — площади комнаты), не больше самой
        // комнаты. Итога в спецификации нет — остаётся оценка модели.
        if (unlabeled.length) {
            const rest = total > 0 ? total - ufhSum : 0;
            const weight = r => r.eng._approx > 0 ? r.eng._approx : (r.area > 0 ? r.area : 1);
            const wSum = unlabeled.reduce((a, r) => a + weight(r), 0);
            unlabeled.forEach(r => {
                let a = rest > 0.2 ? rest * weight(r) / wSum : (r.eng._approx || null);
                if (a > 0 && r.area > 0) a = Math.min(a, r.area);
                r.eng.ufhArea = a > 0 ? Math.round(a * 100) / 100 : null;
                r.eng.ufhAreaSrc = rest > 0.2 ? 'spec' : 'approx';
                if (a > 0) ufhSum += a;
                delete r.eng._approx;
            });
        }
        const parts = [];
        if (ufhRooms) {
            parts.push(`тёплый пол в ${ufhRooms} ${RecognizeUI.plural(ufhRooms, 'помещении', 'помещениях', 'помещениях')}` +
                (ufhSum ? `, ${this.fmt(ufhSum)} м²` : '') +
                (total > 0 ? ` (по спецификации листа ${this.fmt(total)} м²)` : ''));
            if (total > 0 && ufhSum > 0 && Math.abs(ufhSum - total) > Math.max(1, total * 0.05)) {
                warnings.push(`лист ${sh.num}: по помещениям тёплого пола ${this.fmt(ufhSum)} м², ` +
                    `а в спецификации ${this.fmt(total)} м² — проверьте, не пропущена ли зона`);
            }
        }
        if (heaters) parts.push(`приборов отопления ${heaters}`);

        // Сверка с марками приборов в тексте листа (РД-1…РД-5): на «Хвойной 3»
        // модель поставила шестой прибор в кабинет, где его нет, — а марки
        // набраны в PDF, и их число известно точно.
        const marks = this.heaterMarks(sh.text);
        if (marks.length && marks.length !== heaters) {
            warnings.push(`лист ${sh.num}: марок приборов на листе ${marks.length} (${marks[0]}…${marks[marks.length - 1]}), ` +
                `а по помещениям ${heaters} — проверьте приборы в строках под помещениями`);
        }
        if (this.towel) parts.push(`полотенцесушителей ${this.towel.count} (${
            this.towel.type === 'water' ? 'водяные' : 'электрические'})`);
        if (Array.isArray(parsed.unclear)) parsed.unclear.filter(Boolean).forEach(u => warnings.push(`лист ${sh.num}: ${u}`));
        return {
            summary: `Лист ${sh.num} «${sh.title}»: ${parts.length ? parts.join(', ') : 'ничего не найдено'}.`,
            warnings,
        };
    },

    takeWater(parsed, rows, sh, scope) {
        const warnings = [];
        scope = scope || rows;
        scope.forEach(r => { r.eng = r.eng || {}; r.eng.waterSheet = sh.num; r.eng.fix = null; });
        const tot = {};
        (Array.isArray(parsed.rooms) ? parsed.rooms : []).forEach(x => {
            const r = this.rowOf(rows, x && x.n, scope);
            if (!r) { if (x && x.name) warnings.push(`лист ${sh.num}: «${x.name}» не найдено среди помещений`); return; }
            const f = {};
            this.FIX_KEYS.forEach(k => { f[k] = this.cnt(x[k]); });
            // Кухонная мойка в «Водоснабжении» — та же раковина (смеситель на
            // горячую и холодную), только в зоне «Кухня».
            f.basin += this.cnt(x.kitchenSink);
            // Станция робота-пылесоса — холодная вода и слив, как у посудомойки:
            // отдельного прибора в расчёте нет, считаем её посудомоечной.
            const robot = this.cnt(x.robot);
            f.dish += robot;
            if (robot) r.eng.robot = robot;
            f.toiletHot = Math.min(f.toiletHot, f.toilet);
            if (!this.FIX_KEYS.some(k => f[k])) return;
            r.eng.fix = f;
            this.FIX_KEYS.forEach(k => { tot[k] = (tot[k] || 0) + f[k]; });
        });
        const parts = this.FIX_KEYS.filter(k => tot[k]).map(k => `${this.FIX_NAMES[k]} — ${tot[k]}`);
        if (Array.isArray(parsed.unclear)) parsed.unclear.filter(Boolean).forEach(u => warnings.push(`лист ${sh.num}: ${u}`));
        return {
            summary: `Лист ${sh.num} «${sh.title}»: ${parts.length ? parts.join(', ') : 'приборов не найдено'}.`,
            warnings,
        };
    },

    /**
     * Примечания к помещению. Сами тёплый пол, приборы и сантехника видны и
     * правятся в строке под помещением (engRow), здесь — только то, что
     * требует внимания.
     */
    rowNotes(r) {
        const e = r.eng;
        if (!e) return [];
        const out = this.winNotes(r);
        if (e.robot && e.fix) out.push('вывод для робота-пылесоса учтён как посудомоечная (ХВС и слив)');
        if (!e.heatSheet) return out;
        if (e.ufh && e.ufhArea && r.area > 0 && e.ufhArea > r.area) {
            out.push(`зона тёплого пола больше комнаты — в расчёт пойдёт ${this.fmt(r.area)} м²`);
        }
        if (!e.ufh && !e.heaters) out.push(`на листе ${e.heatSheet} отопления нет — в расчёте без отопления`);
        if (e.ufh && e.ufhAreaSrc === 'spec') out.push(`зона тёплого пола без подписи площади — ${this.fmt(e.ufhArea)} м² по остатку спецификации листа`);
        if (e.ufh && e.ufhAreaSrc === 'approx') out.push(`зона тёплого пола без подписи площади — ${e.ufhArea ? this.fmt(e.ufhArea) + ' м² оценено по чертежу, проверьте' : 'площадь не определена, впишите'}`);
        if (e.heaters && e.heaterMarks && e.heaterMarks.length) out.push(`приборы на листе: ${e.heaterMarks.join(', ')}`);
        return out;
    },

    // ------------------------------------------------------------------
    // Правка на экране проверки
    //
    // Модель привязывает приборы к комнатам по картинке и может ошибиться
    // комнатой. Поправить это после переноса можно и в калькуляторе, но там
    // сантехника живёт отдельно от комнат, и связь «этот унитаз — из этого
    // санузла» уже потеряна. Поэтому правим здесь, пока всё рядом с планом.
    // ------------------------------------------------------------------

    FIX_SHORT: {
        toilet: 'унитаз', toiletHot: 'унитаз-биде (ГВС)', basin: 'раковина', bath: 'ванна', shower: 'душ',
        drain: 'трап', bidet: 'биде', wash: 'стиральная', dish: 'посудомоечная',
    },

    /** Какие листы прочитаны — от этого зависит, что показывать в строке. */
    sheetsRead(rows) {
        return {
            heat: rows.some(r => r.eng && r.eng.heatSheet),
            water: rows.some(r => r.eng && r.eng.waterSheet),
        };
    },

    /**
     * Строка правки под помещением. n — индекс строки в RecognizePlan._rows.
     *
     * Только то, что в помещении есть, — «пилюлями» с числом и крестиком;
     * чего нет — кнопкой «+ …». Прежняя строка выводила все девять счётчиков
     * сантехники нулями в каждой комнате, и под коридором стояло «унитаз 0
     * раковина 0 ванна 0…» в две строки.
     */
    engRow(r, n, read, cols) {
        if (!r.eng || (!read.heat && !read.water)) return '';
        const e = r.eng;
        const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const on = `RecognizePlan.setEng(${n}`;
        const pill = 'display:inline-flex;align-items:center;gap:4px;padding:1px 4px 1px 9px;border:1px solid var(--border,#cbd5e1);border-radius:999px;white-space:nowrap;background:var(--surface,transparent)';
        const ghost = 'padding:2px 9px;border:1px dashed var(--border,#cbd5e1);border-radius:999px;background:none;color:inherit;font:inherit;cursor:pointer;white-space:nowrap';
        const num = (field, val, w, step) =>
            `<input type="number" min="0" step="${step || 1}" value="${val ? esc(val) : ''}" placeholder="0"
                    style="width:${w}px;border:0;background:transparent;color:var(--text-main,inherit);font:inherit;font-weight:600;text-align:right;padding:0"
                    onchange="${on},'${field}',this.value)">`;
        const x = (field, val) => `<button type="button" title="Убрать" style="border:0;background:none;color:inherit;cursor:pointer;padding:0 4px;font-size:13px;line-height:1"
                    onclick="${on},'${field}',${val})">×</button>`;
        const src = e.src || {};
        const pdf = f => src[f] === 'pdf' ? `;${RecognizePlan.PDF_CELL}" title="${RecognizePlan.PDF_TIP}` : '';
        const parts = [];
        if (read.heat) {
            parts.push(e.ufh
                ? `<span style="${pill}${e.ufhAreaSrc === 'label' ? pdf('ufh') : ''}">♨️ тёплый пол ${num('ufhArea', e.ufhArea, 50, 0.01)} м²${x('ufh', 'false')}</span>`
                : `<button type="button" style="${ghost}" onclick="${on},'ufh',true)">+ тёплый пол</button>`);
            const typeOpt = (v) => `<option value="${v}" ${(e.heaterType || 'radiator') === v ? 'selected' : ''}>${this.HEATER_NAMES[v]}</option>`;
            parts.push(e.heaters
                ? `<span style="${pill}${pdf('heaters')}">🔥 ${num('heaters', e.heaters, 26)}
                     <select style="border:0;background:transparent;color:inherit;font:inherit;padding:0;cursor:pointer" onchange="${on},'heaterType',this.value)">
                       ${typeOpt('floor_convector')}${typeOpt('wall_convector')}${typeOpt('radiator')}</select>${x('heaters', 0)}</span>`
                : `<button type="button" style="${ghost}" onclick="${on},'heaters',1)">+ прибор</button>`);
        }
        if (read.water) {
            const f = e.fix || {};
            const have = this.FIX_KEYS.filter(k => f[k] > 0);
            // Трап, стиральная и посудомоечная берутся из спецификации, только
            // если они там есть, — иначе их разложила модель.
            const fixPdf = k => src.fix === 'pdf' && ['toilet', 'toiletHot', 'basin', 'bath', 'shower', 'bidet'].includes(k);
            have.forEach(k => parts.push(`<span style="${pill}${fixPdf(k) ? pdf('fix') : ''}">${this.FIX_SHORT[k]} ${num('fix.' + k, f[k], 24)}${x('fix.' + k, 0)}</span>`));
            const rest = this.FIX_KEYS.filter(k => !(f[k] > 0));
            if (rest.length) parts.push(`<select style="${ghost}" onchange="if(this.value){${on},'fix.'+this.value,1)}">
                <option value="">+ сантехника</option>${rest.map(k => `<option value="${k}">${this.FIX_SHORT[k]}</option>`).join('')}</select>`);
        }
        return `<tr class="rec-plan-eng"><td></td><td colspan="${cols - 1}" style="padding:0 6px 6px">
            <div style="display:flex;flex-wrap:wrap;gap:5px 6px;align-items:center;font-size:12px;color:var(--text-sec,#64748b)">
              ${parts.join('')}</div></td></tr>`;
    },

    /** Правка из строки под помещением. */
    setEng(r, field, val) {
        const e = r.eng || (r.eng = {});
        // Поправлено руками — зелёная отметка «из чертежа» снимается.
        if (e.src) {
            if (field === 'ufh' || field === 'ufhArea') delete e.src.ufh;
            else if (field === 'heaters' || field === 'heaterType') delete e.src.heaters;
            else if (field.startsWith('fix.')) delete e.src.fix;
        }
        if (field === 'ufh') {
            e.ufh = !!val;
            if (!e.ufh) e.ufhArea = null;
        } else if (field === 'ufhArea') {
            const a = this.num(val);
            e.ufhArea = a > 0 ? Math.round(a * 100) / 100 : null;
            e.ufhAreaSrc = 'manual';
            if (e.ufhArea) e.ufh = true;
        } else if (field === 'heaters') {
            e.heaters = this.cnt(val);
            e.heaterMarks = [];     // число правлено руками — марки с листа ему уже не опора
            if (e.heaters && !e.heaterType) e.heaterType = 'radiator';
        } else if (field === 'heaterType') {
            e.heaterType = this.HEATER_NAMES[val] ? val : 'radiator';
        } else if (field.startsWith('fix.')) {
            const k = field.slice(4);
            if (!this.FIX_KEYS.includes(k)) return;
            const f = Object.assign({}, ...this.FIX_KEYS.map(x => ({ [x]: 0 })), e.fix || {});
            f[k] = this.cnt(val);
            // Унитаз-биде — часть унитазов: добавили его — добавился и унитаз.
            if (k === 'toiletHot' && f.toiletHot > f.toilet) f.toilet = f.toiletHot;
            if (k === 'toilet' && f.toiletHot > f.toilet) f.toiletHot = f.toilet;
            e.fix = this.FIX_KEYS.some(x => f[x]) ? f : null;
        }
    },

    /** Что пойдёт в расчёт с отмеченных помещений — пересчитывается при правке. */
    totals(chosen) {
        const read = this.sheetsRead(chosen);
        const out = [];
        if (read.heat) {
            const ufh = chosen.filter(r => r.eng && r.eng.ufh);
            const ufhArea = ufh.reduce((s, r) => s + this.ufhAreaOf(r), 0);
            const heaters = chosen.reduce((s, r) => s + ((r.eng && r.eng.heaters) || 0), 0);
            out.push(`тёплый пол в ${ufh.length} ${RecognizeUI.plural(ufh.length, 'помещении', 'помещениях', 'помещениях')}` +
                (ufh.length ? ` (${this.fmt(ufhArea)} м²)` : '') + `, приборов отопления ${heaters}`);
        }
        if (read.water) {
            const tot = {};
            chosen.forEach(r => { if (r.eng && r.eng.fix) this.FIX_KEYS.forEach(k => { tot[k] = (tot[k] || 0) + r.eng.fix[k]; }); });
            const zones = chosen.filter(r => r.eng && r.eng.fix).length;
            const parts = this.FIX_KEYS.filter(k => tot[k]).map(k => `${this.FIX_NAMES[k]} — ${tot[k]}`);
            out.push(zones ? `водоснабжение: ${zones} ${RecognizeUI.plural(zones, 'помещение', 'помещения', 'помещений')} с приборами (${parts.join(', ')})`
                : 'сантехники в отмеченных помещениях нет');
        }
        if (this.towel) out.push(`полотенцесушителей ${this.towel.count}`);
        if (this.vent && this.vent.choice) out.push(`вентиляция ${this.VENT_NAMES[this.vent.choice].split(',')[0]}`);
        return out.length ? 'В расчёт пойдёт: ' + out.join('; ') + '.' : '';
    },

    /** Площадь тёплого пола помещения: зона с листа, но не больше комнаты. */
    ufhAreaOf(r) {
        const a = r.area > 0 ? r.area : 0;
        const z = r.eng && r.eng.ufhArea;
        return z > 0 ? Math.min(z, a) : a;
    },

    /**
     * Системы и окна комнаты по листу отопления. Лист прочитан — решает он:
     * радиатор только там, где нарисован прибор, тёплый пол — где заштрихован,
     * и ровно той площади, что подписана на листе (app.roomTpArea).
     */
    fitRoom(room, r) {
        const e = r.eng;
        if (!e || !e.heatSheet) return;
        // Лист прочитан — решает он. Ни прибора, ни зоны — по проекту
        // помещение не отапливается (хоз. комната «Хвойной 3»): раньше сюда
        // ставился радиатор «на всякий случай», и в смете прибавлялись
        // приборы, которых в проекте нет.
        const sys = [];
        if (e.heaters) sys.push('rad');
        if (e.ufh) sys.push('tp');
        room.sys = sys;
        if (e.ufh && e.ufhArea > 0 && e.ufhArea < room.area) room.tpArea = e.ufhArea;

        // Приборов больше, чем окон: лишние встают под «виртуальное» окно
        // той же ширины. Конвектор в полу — это панорамное окно расчёта.
        if (e.heaters > room.windows.length) {
            const width = room.windows[0] ? room.windows[0].width : 1.5;
            for (let k = room.windows.length; k < e.heaters; k++) {
                room.windows.push({ id: room.id + k + 1, width, isPan: false });
            }
        }
        // Приборов меньше, чем окон: прибор получают столько окон, сколько
        // приборов на листе, остальные — «без прибора» (app.render отдаёт их
        // потери соседям). Конвектору в полу — сперва окна в пол, радиатору —
        // сперва обычные. Без приборов вовсе — все окна без прибора: греет
        // тёплый пол, или помещение не отапливается.
        const conv = e.heaterType === 'floor_convector';
        // Места приборов и окон известны из чертежа — прибор отдаётся
        // ближайшему окну. На кухне «Хвойной 3» радиаторы РД-1…РД-3 стоят в
        // простенках между витражами, а под двумя обычными окнами приборов
        // нет; счёт «сперва обычные окна» ставил радиаторы именно туда, а
        // витражам — внутрипольные конвекторы, которых в проекте нет.
        const spec = e.winSpec;
        const byPlace = !!(e.heaterPts && e.heaterPts.length === (e.heaters || 0) && spec &&
            spec.length === room.windows.length && spec.every(s => s.wx !== undefined));
        let heatedIdx;
        const widthOf = new Map();     // окно → ширина прибора по проекту, мм
        if (byPlace) {
            heatedIdx = new Set();
            e.heaterPts.forEach(p => {
                let best = -1, bd = Infinity;
                spec.forEach((s, k) => {
                    if (heatedIdx.has(k)) return;
                    const d = Math.hypot(s.wx - p.x, s.wy - p.y);
                    if (d < bd) { bd = d; best = k; }
                });
                if (best >= 0) { heatedIdx.add(best); if (p.wMm) widthOf.set(best, p.wMm); }
            });
        } else {
            const key = w => conv ? (w.isPan ? 0 : 1) : (w.isPan ? 1 : 0);
            const order = room.windows.map((w, k) => ({ w, k }))
                .sort((a, b) => (key(a.w) - key(b.w)) || (a.k - b.k));
            heatedIdx = new Set(order.slice(0, e.heaters || 0).map(o => o.k));
        }
        room.windows.forEach((w, k) => {
            if (heatedIdx.has(k)) {
                delete w.noHeater;
                if (conv) { w.isPan = true; delete w.radInPier; }
                // Радиатор у окна в пол — в простенке: калькулятор иначе
                // поставил бы под витраж внутрипольный конвектор.
                else if (w.isPan) {
                    w.radInPier = true;
                    // Ширина прибора по проекту: шире калькулятор радиатор не поставит.
                    if (widthOf.has(k)) w.pierW = Math.round(widthOf.get(k)) / 1000;
                }
            } else w.noHeater = true;
        });
    },

    /** Были ли в разборе листы сантехники или отопления. */
    hasWater(rows) { return rows.some(r => r.eng && r.eng.fix); },

    /**
     * Сантехника — в «Водоснабжение»: зона на каждое помещение с приборами,
     * как их заводит монтажник руками. Возвращает число зон.
     */
    applyWater(st, chosen) {
        const withFix = chosen.filter(r => r.eng && r.eng.fix);
        if (!withFix.length) return 0;
        const dist = (st.area || 0) < 120 ? 6 : 10;
        const base = Date.now();
        st.waterZones = withFix.map((r, k) => ({
            id: base + k, name: r.name, dist,
            fixtures: Object.assign({}, r.eng.fix),
        }));
        st.water = true;
        // Есть приборы с горячей водой — нужен водонагреватель. В КП по
        // «Хвойной 3» разводка ГВС была, а бойлера не было: тумблер стоял
        // выключенным.
        if (withFix.some(r => this.HOT_KEYS.some(k => r.eng.fix[k] > 0))) st.hotWater = true;
        return withFix.length;
    },

    /** Полотенцесушители с листа отопления. */
    applyTowel(st) {
        if (!this.towel) return false;
        // countTouched — отметка «число задано, а не посчитано»: без неё
        // app.getTowelWarmer вернёт счёт в автомат (по одному на санузел).
        st.towelWarmer = Object.assign({}, st.towelWarmer || {},
            { enabled: true, type: this.towel.type, count: this.towel.count, countTouched: true });
        return true;
    },

    /**
     * Площадь тёплого пола на ползунках быстрого режима — по комнатам с листа.
     *
     * Включение подробного режима (app.toggleDetailedRooms) раскладывает
     * площадь с ползунков tp1/tp2 по комнатам через applyTpAreaToRooms. Там
     * стоял 0 — и тёплый пол, только что расставленный по листу отопления,
     * снимался со всех комнат, а комната с одним тёплым полом оставалась
     * вовсе без отопления. Совпадающая площадь раскладку не трогает.
     */
    syncUfhSliders(st) {
        if (!(st.rooms || []).some(r => r.sys && r.sys.includes('tp'))) return;
        const sum = f => st.rooms
            .filter(r => (f === 2 ? r.floor === 2 : r.floor !== 2) && r.sys && r.sys.includes('tp'))
            .reduce((s, r) => s + (typeof app.roomTpArea === 'function'
                ? app.roomTpArea(r) : (parseFloat(r.area) || 0)), 0);
        st.tp1 = sum(1);
        st.tp2 = sum(2);
        if (!(st.systems || []).includes('tp')) st.systems = (st.systems || []).concat('tp');
    },

    reset() { this.towel = null; this.vent = null; this.reqs = []; this.city = null; this._maps = null; },
};

window.RecognizeProject = RecognizeProject;

const PROJECT_ENG_PROMPT = `Ты разбираешь лист инженерных систем из дизайн-проекта или рабочего проекта частного дома (Россия). Помещения дома уже прочитаны с плана и даны списком с номерами. Твоя задача — привязать к ним то, что нарисовано на этом листе. Ничего не выдумывай: нет на листе — нет в ответе.

Задача указана в запросе словом heat, water или vent.

=== heat — отопление и тёплые полы ===
Тёплый пол на плане — заштрихованная зона (часто красной или косой штриховкой) с подписью площади «S=10,63м2». Для каждого помещения, где есть такая зона, укажи ufh=true и ufhArea — сумму подписанных площадей зон в этом помещении. Площадь бери из подписи на листе, не вычисляй.
Зона бывает и без подписи площади (гардеробная, кладовая, ниша — штриховка есть, «S=» нет; рядом часто стоит терморегулятор). Это тоже тёплый пол: ufh=true, ufhArea=null, ufhApprox — оценка площади зоны по размерам на чертеже. Не пропускай такие зоны.
Приборы отопления — радиаторы, конвекторы — обозначены марками (РД-1, Р-2, К-1, КВ-1…) и прямоугольниками у окон. heaters — сколько приборов в помещении. heaterType:
- "floor_convector" — прибор утоплен в пол вдоль остекления (узкий прямоугольник у окна в пол, решётка в полу), или в спецификации написано «внутрипольный»;
- "wall_convector" — настенный конвектор;
- "radiator" — радиатор на стене под окном; если непонятно — тоже "radiator".
Полотенцесушитель — не прибор отопления комнаты: считай его в towelRails, тип "electric" (электро) или "water" (водяной) по спецификации.
Терморегуляторы, датчики, выключатели — не считай.
ufhTotal — итог тёплого пола из спецификации листа, если он есть.

=== water — водоснабжение и канализация ===
Для каждого помещения с сантехникой посчитай приборы:
- toilet — унитаз (подвесной с инсталляцией, напольный, унитаз с функцией биде — всё это toilet);
- bidet — только отдельное биде; гигиенический душ и унитаз-биде сюда не входят;
- basin — раковина, умывальник (кроме кухонной мойки);
- kitchenSink — кухонная мойка;
- bath — ванна;
- shower — душ: душевая система, душевой трап, поддон; одна душевая = 1, даже если у неё и трап, и смеситель, и лейка;
- drain — трап в полу (душ без поддона: «подвод канализации для душевого трапа», трап на плане); одна душевая с трапом = 1;
- toiletHot — сколько из унитазов этого помещения требуют и горячую воду: «вывод ГВС/ХВС для инсталляции и унитаза-биде», унитаз с функцией биде со смесителем; toiletHot не больше toilet;
- wash — стиральная машина;
- dish — посудомоечная машина;
- robot — станция робота-пылесоса с водой и сливом («вывод ХВС и канализации для робота-пылесоса»).
Выводы для кофемашины, холодильника, кондиционера — не считай.
Прибор, помещение которого не удаётся определить, — опиши в unclear.

=== vent — вентиляция и кондиционирование ===
Нужен ТИП системы, подающей в дом СВЕЖИЙ наружный воздух (привязка к помещениям не нужна):
- "recuperator" — приточно-вытяжная установка с рекуператором (ПВУ, рекуператор, пластинчатый/роторный теплообменник, приток и вытяжка сходятся в одной установке);
- "forced" — механический приток без рекуператора: приточная установка, канальный вентилятор на притоке с калорифером;
- "natural" — только вытяжка (вентканалы, вытяжные вентиляторы в санузлах и на кухне), приток через окна и клапаны;
- "ac_only" — на листе только кондиционеры: настенные сплит-системы, канальные кондиционеры с решётками подачи и забора; они перемешивают воздух помещения, но наружного не подают;
- "unknown" — по листу не понять (например, решётки подачи нарисованы, а откуда воздух — не сказано и установки нет).
Решётки подачи воздуха сами по себе — не признак приточной вентиляции: так же выглядит канальный кондиционер. Ставь "forced" или "recuperator" только если нарисована или названа установка, воздуховод с улицы или рекуператор.
evidence — дословная надпись или короткое описание нарисованного, по которому ты решил.
conditioners — сколько кондиционеров (внутренних блоков) на листе, если они есть.

=== Привязка к помещениям ===
n — номер помещения из списка в запросе. Определи помещение по положению на листе и по подписям; если на листе помещения подписаны иначе, сопоставь по смыслу и площади. Если прибор стоит в помещении, которого в списке нет, — опиши его в unclear, n не придумывай.

=== Формат ответа ===
Только JSON, без пояснений.
heat:
{"rooms":[{"n":1,"name":"Кухня-гостиная","ufh":true,"ufhArea":57.54,"heaters":3,"heaterMarks":["Р-1","Р-2","Р-3"],"heaterType":"floor_convector"},
          {"n":4,"name":"Кладовая","ufh":true,"ufhArea":null,"ufhApprox":2.5,"heaters":0}],
 "towelRails":{"count":1,"type":"electric"},"ufhTotal":121.95,"unclear":[]}
water:
{"rooms":[{"n":5,"name":"Мастер-санузел","toilet":1,"toiletHot":0,"bidet":0,"basin":1,"kitchenSink":0,"bath":1,"shower":1,"drain":0,"wash":0,"dish":0,"robot":0}],
 "unclear":[]}
vent:
{"system":"natural","evidence":"вытяжные вентиляторы в санузлах, приток через оконные клапаны","conditioners":0,"unclear":[]}
Помещения без тёплого пола, приборов и сантехники в rooms не включай.`;

const PROJECT_NOTES_PROMPT = `Ты помогаешь монтажнику систем отопления, тёплого пола, водоснабжения и канализации частного дома (Россия) составить смету по чужому проекту (дизайн-проект или рабочий проект). Тебе дают примечания и пометки со всех листов проекта — текст, набранный на листах, с номером листа.

Задача — выбрать то, что влияет на смету и работу монтажника ЭТИХ систем, и сказать коротко, что с этим делать.

Бери:
- отопление, радиаторы, конвекторы, тёплый пол, терморегуляторы и датчики тёплого пола, котельная;
- водоснабжение, горячая вода, выводы к приборам, встраиваемые части смесителей, фильтры;
- канализация, трапы, шумоизоляция труб, дренажи кондиционеров в канализацию;
- вентиляция и кондиционирование — только то, что задевает наши системы (дренаж, приток, вытяжка из сушильного шкафа);
- отметки и высоты (от чистового или чернового пола) — они задают высоту выводов и толщину стяжки тёплого пола;
- «площади без запаса», отступы тёплого пола, кто и что покупает заранее, что уточнить у заказчика по нашим системам;
- кто поставляет и где ставит терморегуляторы тёплого пола — отдельным требованием. Если они «в группе с выключателями» или «из коллекции выключателей/розеток», их покупает и монтирует электрик, в нашу смету они не входят, но сервоприводы на коллекторы и коммутационный блок остаются нашими, а совместимость терморегулятора с датчиком пола и приводами надо уточнить (action "check");
- гидроизоляцию санузлов и зоны стиральной машины — только если она задевает трапы и выводы.

Не бери: мебель, свет, розетки, выключатели (кроме терморегуляторов тёплого пола), двери, отделку, покраску, демонтаж, согласование перепланировки, авторские и юридические оговорки дизайнера.

Для каждого требования:
- sheet — номер листа, откуда оно (если листов несколько — первый);
- topic — heat | ufh | water | sewer | vent | boiler | general;
- action:
  "add" — в смету надо добавить позицию или работу (например, сервоприводы на коллекторы, дренажные сифоны, шумоизоляция канализации, трапы);
  "check" — уточнить у заказчика или проектировщика до подбора (например, заведение тёплого пола на подиум, тип приборов);
  "mount" — выполнить при монтаже, в смете позиций не меняет (например, отступ тёплого пола 100 мм, датчик не ближе 300 мм от стены);
- text — что это значит для сметы или монтажа, одной фразой до 200 символов, своими словами, по делу; если из требования следует конкретная позиция — назови её;
- quote — короткая цитата из примечания (до 200 символов), по которой ты это решил.

Одно требование — одна запись; одинаковые с разных листов объединяй. Не выдумывай того, чего в тексте нет. Если ничего подходящего нет — пустой список.

Только JSON:
{"reqs":[{"sheet":14,"topic":"sewer","action":"add","text":"Стояки канализации обернуть шумоизоляцией — добавить изоляцию труб в раздел канализации","quote":"Канализационные стояки в санузлах выполнить в шумоизоляции"}]}`;

const PROJECT_WINDOWS_PROMPT = `Ты разбираешь обмерный план (или план с подписями окон) частного дома. У каждого окна на листе есть подпись на выноске: тип, высота окна, высота от пола. Подписи вынесены за контур дома, от подписи к окну идёт линия-выноска. Тебе даны: картинка листа, список подписей окон с номерами и точными координатами подписей и список помещений с координатами их названий (с листа планировки того же дома — листы нарисованы в одном масштабе и положении, x — % ширины слева, y — % высоты сверху).

Задача: каждое подписанное окно отнести к помещению, в наружную стену которого оно врезано.
- Иди от подписи по выноске к окну на чертеже; помещение — то, внутри контура стен которого это окно, если смотреть изнутри дома. Координаты названий помещений помогают понять, где какое помещение.
- Одна подпись — одно окно. Подписи-близнецы («Окна в пол (2 створки)» трижды подряд) — это разные окна, каждое по своей выноске.
- width — ширина проёма окна в миллиметрах по размерной цепочке у этого окна, если она читается; не читается — null.
- Окно, которое не удаётся отнести, опиши в unclear, номер не придумывай.

Только JSON:
{"rooms":[{"n":2,"windows":[{"label":3,"width":1550},{"label":4,"width":1550}]}],"unclear":[]}
Помещения без окон не включай.`;
