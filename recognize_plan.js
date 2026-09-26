/**
 * Распознавание планов этажей — вторая специальность вкладки
 * «3. Распознавание».
 *
 * Смета и план — разные документы с разным результатом: из сметы выходят
 * позиции с артикулами, из плана — помещения для расчёта по комнатам
 * (название, площадь, этаж, окна, наружные стены). Поэтому у плана свои
 * правила для модели, свой экран проверки и свой перенос — в state.rooms
 * подробного расчёта, а не в userAddedEq.
 *
 * Общее с распознаванием сметы берётся из RecognizeUI как есть: загрузка и
 * подготовка снимков, запрос к модели с перебором и ожиданием (askModel),
 * починка JSON (parseModelJson), индикатор хода, отметки на миниатюрах,
 * лимит запросов и архив. Здесь только то, что относится к плану.
 *
 * Как сюда попадают: либо монтажник сам выбрал «План этажа» на экране
 * загрузки, либо модель, разбирая лист по правилам сметы, ответила
 * {"docKind":"floor_plan"} — тогда RecognizeUI сам переключается сюда.
 */

const RecognizePlan = {

    CACHE_KEY: 'rec_plans_v1',
    CACHE_MAX: 40,

    /**
     * Границы высоты потолка — те же, что у ползунков inp_h1/inp_h2 в
     * index.html. Прочитанное с листа «H=2580» ниже нижней границы, и
     * ползунок такое значение не покажет; ужимаем к границе.
     */
    H_MIN: 2.7,
    H_MAX: 5.0,

    _rows: [],       // помещения на экране проверки, они же правятся
    _sheets: [],     // сведения по листам: этаж, потолок, итог экспликации
    _warning: '',    // что не прочиталось — показывается над таблицей
    _undo: null,     // снимок комнат расчёта до применения — для отката
    _calls: 0,       // сколько запросов стоило это распознавание
    _fromCache: 0,
    _busy: false,    // идёт дочитывание листа
    _busyText: '',
    _addNote: '',    // чем кончилось последнее дочитывание

    reset() {
        this._rows = [];
        this._sheets = [];
        this._warning = '';
        this._calls = 0;
        this._fromCache = 0;
        this._busy = false;
        this._busyText = '';
        this._addNote = '';
        this._engSummary = [];
        this._resUse = true;
        this._deleted = [];
        // Полотенцесушители прошлого проекта не должны доехать до
        // следующего плана, у которого листа отопления нет вовсе.
        if (typeof RecognizeProject !== 'undefined') RecognizeProject.reset();
    },

    /** Ответ модели — про план, а не про смету. */
    isPlanResult(parsed) {
        if (!parsed || typeof parsed !== 'object') return false;
        if (parsed.docKind === 'floor_plan') return true;
        return Array.isArray(parsed.rooms) && parsed.rooms.length > 0
            && !(Array.isArray(parsed.items) && parsed.items.length);
    },

    // ------------------------------------------------------------------
    // Память по листам — как у сметы (RecognizeUI.rememberSheet), но своя:
    // разбор по правилам плана и по правилам сметы — разные ответы на один и
    // тот же снимок, и класть их в одну память нельзя.
    // ------------------------------------------------------------------

    promptVersion() {
        if (this._promptV) return this._promptV;
        const s = String(typeof FLOOR_PLAN_PROMPT !== 'undefined' ? FLOOR_PLAN_PROMPT : '');
        let h = 0;
        for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
        this._promptV = String(h);
        return this._promptV;
    },

    readCache() {
        try {
            const raw = localStorage.getItem(this.CACHE_KEY);
            const data = raw ? JSON.parse(raw) : null;
            return (data && typeof data === 'object') ? data : {};
        } catch (e) { return {}; }
    },

    cached(b64) {
        const key = RecognizeUI.sheetKey(b64);
        if (!key) return null;
        const rec = this.readCache()[key];
        if (!rec || rec.v !== this.promptVersion() || !rec.data) return null;
        return rec.data;
    },

    remember(b64, parsed) {
        const key = RecognizeUI.sheetKey(b64);
        if (!key || !parsed || !Array.isArray(parsed.rooms)) return;
        try {
            const all = this.readCache();
            all[key] = { v: this.promptVersion(), at: Date.now(), data: parsed };
            const keys = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
            for (const k of keys.slice(this.CACHE_MAX)) delete all[k];
            localStorage.setItem(this.CACHE_KEY, JSON.stringify(all));
        } catch (e) {
            try { localStorage.removeItem(this.CACHE_KEY); } catch (e2) { /* память необязательна */ }
        }
    },

    // ------------------------------------------------------------------
    // Разбор листов
    // ------------------------------------------------------------------

    /**
     * Номер этажа по имени файла: «1 этаж.pdf», «План 2-го этажа.jpg»,
     * «Цоколь.png». Файлы с планами почти всегда так и названы, а на самом
     * листе подпись этажа бывает мелкой или её нет вовсе.
     */
    floorHint(name) {
        const s = String(name || '').toLowerCase();
        if (!s) return null;
        // Страница многостраничного PDF: имя файла описывает весь документ
        // («Дом 2 этажа.pdf»), а не эту страницу.
        if (/стр\./.test(s)) return null;
        if (/подвал|цокол|техподпол/.test(s)) return 0;
        if (/мансард|чердак/.test(s)) return 2;
        let m = s.match(/(?:^|[^\d])(\d)\s*(?:-?\s*(?:й|го|ый|ой|ий))?\s*эт/);
        if (m) return +m[1];
        // \w в JS кириллицу не видит — буквы перечисляем явно.
        m = s.match(/эт[а-яё]*[\s._-]*(\d)(?!\d)/);
        if (m) return +m[1];
        if (/перв/.test(s)) return 1;
        if (/втор/.test(s)) return 2;
        if (/трет/.test(s)) return 3;
        return null;
    },

    /** Этаж расчёта: калькулятор знает только первый и второй. */
    calcFloor(raw) {
        const n = parseInt(raw, 10);
        if (isNaN(n)) return 1;
        return n >= 2 ? 2 : 1;
    },

    num(v) {
        if (v === null || v === undefined || v === '') return null;
        const n = parseFloat(String(v).replace(',', '.').replace(/[^\d.\-]/g, ''));
        return isNaN(n) ? null : n;
    },

    /**
     * Название — с большой буквы и без хвостов. Модель иногда возвращает
     * «спальня» или «Спальня 8,2 м2» — площадь у нас в своей колонке.
     */
    cleanName(s) {
        let n = String(s || '').replace(/\s+/g, ' ').trim();
        n = n.replace(/\s*[\d.,]+\s*(м²|м2|кв\.?\s*м|m2)\s*$/i, '').trim();
        // Номер помещения, прилипший к названию («101 Спальня», «3. Кухня»).
        n = n.replace(/^\d{1,3}[.)]?\s+(?=[^\d])/, '').trim();
        if (!n) return 'Помещение';
        return n.charAt(0).toUpperCase() + n.slice(1);
    },

    /**
     * Один разобранный лист -> сведения о листе и строки помещений.
     *
     * fallback — какой этаж считать, если он не подписан ни на листе, ни в
     * имени файла. Задаётся при дочитывании: лист, добавленный к уже
     * прочитанному первому этажу, это скорее второй, а не ещё один первый.
     */
    normalizeSheet(parsed, i, fileName, sheetsTotal, fallback) {
        const hint = this.floorHint(fileName);
        let raw = this.num(parsed.floor);
        if (raw === null) raw = hint;
        // Этаж не подписан нигде: у одного листа это первый этаж, у пачки —
        // порядок листов. Монтажник поправит в шапке листа.
        let floorGuessed = false;
        if (raw === null) {
            raw = (fallback !== null && fallback !== undefined)
                ? fallback : (sheetsTotal > 1 ? i + 1 : 1);
            floorGuessed = true;
        }
        raw = Math.round(raw);

        const ceilingH = this.num(parsed.ceilingH);
        const sheet = {
            i,
            name: fileName || '',
            label: parsed.floorLabel ? String(parsed.floorLabel).trim() : '',
            floorRaw: raw,
            floor: this.calcFloor(raw),
            floorGuessed,
            ceilingH: (ceilingH > 1.8 && ceilingH < 8) ? Math.round(ceilingH * 100) / 100 : null,
            totalArea: this.num(parsed.totalArea),
            unclear: Array.isArray(parsed.unclear) ? parsed.unclear.map(String).filter(Boolean) : [],
        };

        const rows = (Array.isArray(parsed.rooms) ? parsed.rooms : []).map(r => {
            r = r || {};
            let area = this.num(r.area);
            const w = this.num(r.w), l = this.num(r.l);
            let areaSrc = r.areaSrc || null;
            if (!(area > 0) && w > 0 && l > 0) { area = w * l; areaSrc = 'dims'; }
            if (area > 0) area = Math.round(area * 100) / 100; else area = null;

            const rFloorRaw = this.num(r.floor);
            const ownFloor = rFloorRaw !== null && Math.round(rFloorRaw) !== raw;
            const fr = ownFloor ? Math.round(rFloorRaw) : raw;

            let windows = this.num(r.windows);
            windows = windows === null ? null : Math.max(0, Math.round(windows));
            let pan = this.num(r.panoramic);
            pan = pan === null ? 0 : Math.max(0, Math.round(pan));
            if (windows !== null) pan = Math.min(pan, windows);

            let outer = this.num(r.outerWalls);
            outer = (outer !== null && outer >= 1 && outer <= 3) ? Math.round(outer) : null;

            const orient = /^(N|NE|E|SE|S|SW|W|NW)$/.test(String(r.orient || '')) ? r.orient : null;
            const heated = r.heated !== false;
            const conf = this.num(r.confidence);

            return {
                _sheet: i,
                _sel: heated && area > 0,
                num: r.num ? String(r.num).trim() : '',
                name: this.cleanName(r.name),
                nameGuessed: !!r.nameGuessed,
                area,
                areaSrc,
                dims: (w > 0 && l > 0) ? `${this.fmt(w)}×${this.fmt(l)}` : '',
                windows,
                panoramic: pan,
                outerWalls: outer,
                orient,
                doubleHeight: !!r.doubleHeight,
                heated,
                floorRaw: fr,
                floor: this.calcFloor(fr),
                ownFloor,
                confidence: conf === null ? 1 : conf,
                note: r.note ? String(r.note).trim() : '',
            };
        });

        // Безымянные помещения нумеруем, иначе в расчёте будет пять строк
        // «Помещение» подряд и не понять, какая из них какая.
        const generic = rows.filter(r => /^помещение$/i.test(r.name));
        if (generic.length > 1) generic.forEach((r, k) => { r.name = `Помещение ${k + 1}`; });

        return { sheet, rows };
    },

    fmt(n) {
        return (Math.round(n * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
    },

    /**
     * Полистный разбор планов. Каждый лист — свой запрос, как у сметы;
     * упавший лист не отменяет остальные.
     *
     * opts.offset — номер первого листа в общем наборе снимков: при
     * дочитывании этажа новые листы идут следом за уже прочитанными, и
     * `_sheet` у строк должен указывать на тот же снимок, что и раньше.
     * opts.fallbackFloor — этаж для листа без подписи (см. normalizeSheet).
     *
     * Возвращает { sheets, rows, warnings, failed, quotaHit }.
     */
    async run(imgs, names, opts) {
        const ui = RecognizeUI;
        const off = (opts && opts.offset) || 0;
        const fallback = opts ? opts.fallbackFloor : null;
        const sheets = [], rows = [], warnings = [], failed = [];
        let quotaHit = false;
        ui._sheetsTotal = off + imgs.length;
        ui._sheetsDone = off;
        ui._itemsSoFar = 0;

        for (let i = 0; i < imgs.length; i++) {
            const name = names && names[i] ? names[i] : '';
            const at = off + i;    // место листа в общем наборе снимков
            try {
                // Комплект листов проекта: помещения уже собраны из PDF
                // (RecognizeProject.plansFromPdf) — модель этому листу не нужна.
                const pre = opts && opts.preParsed ? opts.preParsed[i] : null;
                let parsed = pre || this.cached(imgs[i]);
                if (pre) {
                    this.status(`Лист ${at + 1} — помещения из экспликации PDF`);
                } else if (parsed) {
                    this._fromCache++;
                    this.status(`Лист ${at + 1} — из памяти`);
                } else {
                    this.status(ui._sheetsTotal > 1
                        ? `Читаю план, лист ${at + 1} из ${ui._sheetsTotal}…`
                        : 'Читаю план этажа…');
                    const before = ui._apiCalls || 0;
                    const data = await ui.askModel([
                        { text: 'Разбери этот план этажа по правилам. ' +
                                (ui._sheetsTotal > 1 ? `Это лист ${at + 1} из ${ui._sheetsTotal}. ` : '') +
                                (name ? `Имя файла: «${name.replace(/[«»"]/g, '')}» — оно может подсказывать номер этажа. ` : '') +
                                'Верни только JSON.' },
                        { inline_data: { mime_type: 'image/jpeg', data: imgs[i] } },
                    ], FLOOR_PLAN_PROMPT);
                    this._calls += (ui._apiCalls || 0) - before;
                    const cand = data?.candidates?.[0];
                    const text = cand?.content?.parts?.[0]?.text;
                    if (!text) throw new Error('пустой ответ');
                    parsed = ui.parseModelJson(text, cand.finishReason);
                    if (ui._parseWarning) warnings.push(`лист ${at + 1}: ${ui._parseWarning}`);
                    if (!ui._parseWarning && this.isPlanResult(parsed)) this.remember(imgs[i], parsed);
                }

                // Эскиз котельной — один лист со своим разбором: дальше
                // RecognizeUI.run читает его правилами эскиза.
                if (parsed && parsed.docKind === 'boiler_sketch' && imgs.length === 1 && !off) {
                    const err = new Error('На листе эскиз котельной, а не план этажа.');
                    err.sketch = true;
                    throw err;
                }
                if (!this.isPlanResult(parsed)) {
                    // Лист не план: счёт, фасад, фото. Отдельная ошибка на весь
                    // разбор, только если планов не нашлось вовсе.
                    failed.push(at + 1);
                    ui.markSheet(at, 'fail');
                    warnings.push(`лист ${at + 1}: это не план этажа — помещений на нём не нашлось`);
                    continue;
                }

                const n = this.normalizeSheet(parsed, at, name, ui._sheetsTotal,
                    fallback === null || fallback === undefined ? null : fallback + sheets.length);
                if (parsed.fromPdf) n.rows.forEach(r => {
                    if (r.outerWalls === null) return;
                    r.eng = r.eng || {};
                    r.eng.src = Object.assign(r.eng.src || {}, { outerWalls: 'pdf' });
                });
                sheets.push(n.sheet);
                rows.push(...n.rows);
                if (!n.rows.length) warnings.push(`лист ${at + 1}: помещений не прочитано`);

                ui._sheetsDone++;
                ui._itemsSoFar = rows.length;
                ui.markSheet(at, 'done');
            } catch (e) {
                if (e.sketch) throw e;
                failed.push(at + 1);
                ui.markSheet(at, 'fail');
                if (e.quota) {
                    quotaHit = true;
                    for (let k = i + 1; k < imgs.length; k++) ui.markSheet(off + k, 'fail');
                    warnings.push(e.message);
                    break;
                }
                warnings.push(`лист ${at + 1} не прочитан: ${ui.cleanError(e.message).split('\n')[0]}`);
            }
        }

        if (!rows.length) {
            // Ни на одном листе не оказалось помещений — модель разобрала их
            // и сказала, что это не планы. Помечаем ошибку: RecognizeUI по
            // этой пометке возвращается к разбору сметы, если план был лишь
            // догадкой по картинке (см. planScore).
            const notPlan = !sheets.length && failed.length === imgs.length
                && !quotaHit && warnings.every(w => /не план этажа/.test(w));
            const err = new Error(sheets.length
                ? 'На плане не удалось прочитать ни одного помещения.\n' + warnings.join('\n')
                : (notPlan
                    ? 'На листе не нашлось ни сметы, ни плана этажа. Нужен план: чертёж, скан или эскиз с помещениями.'
                    : 'Не удалось прочитать план.\n' + warnings.join('\n')));
            err.notPlan = notPlan;
            throw err;
        }
        this.status('');
        return { sheets, rows, warnings, failed, quotaHit };
    },

    /**
     * Ход работы. На экране загрузки это обычная строка состояния, на экране
     * проверки — подпись в плашке «Читаю ещё один этаж»: там строки состояния
     * нет, а дочитывание идёт те же полминуты.
     */
    status(text) {
        this._busyText = text || '';
        RecognizeUI.setStatus(text || '');
        const el = document.getElementById('rec_plan_busy');
        if (el) el.textContent = this._busyText;
    },

    // ------------------------------------------------------------------
    // Дочитывание этажа
    //
    // Планы этажей лежат по файлу на этаж, и монтажник почти никогда не
    // грузит их все разом: сначала первый, посмотрел — потом второй. Раньше
    // для второго надо было начинать заново («Другой файл» стирает разбор), а
    // это и потерянная правка помещений, и лишние запросы к распознаванию за
    // уже прочитанный лист.
    // ------------------------------------------------------------------

    addFloor() {
        if (this._busy) return;
        RecognizeUI.pickFiles(files => this.addFiles(files));
    },

    async addFiles(files) {
        if (this._busy || !files || !files.length) return;
        this._busy = true;
        this._addNote = '';
        this.renderReview();          // плашка «читаю» появляется сразу
        this.status('Готовлю лист…');

        const ui = RecognizeUI;
        const before = this._rows.length;
        try {
            const prep = await ui.prepareImages(files, (t) => this.status(t));
            if (!prep.imgs.length) {
                throw new Error('План не прочитался. Нужен чертёж, скан, фото или PDF — ' +
                    'Excel, Word и HTML для плана не подходят.');
            }

            // Снимки складываем в общий набор: по нему работают архив и
            // память листов, и новый лист должен лежать там же, где первый.
            const had = (ui._imgs && ui._imgs.length) ? ui._imgs.slice()
                : (ui._img ? [ui._img] : []);
            const offset = had.length;
            ui._imgs = had.concat(prep.imgs);
            ui._img = null;
            ui._fileKind = 'image';
            ui._fileName = `${ui._imgs.length} листов`;

            // Этаж по умолчанию — следующий за самым верхним из прочитанных:
            // к первому этажу докладывают второй, а не ещё один первый.
            const top = this._sheets.reduce((m, s) => Math.max(m, s.floorRaw), 0);
            const res = await this.run(prep.imgs, prep.imgs.map(b => ui.imgNameOf(b)),
                { offset, fallbackFloor: top + 1 });

            this._sheets = this._sheets.concat(res.sheets);
            this._rows = this._rows.concat(res.rows);
            this.arrangeFloors();
            if (res.warnings.length) {
                this._warning = [this._warning, ...res.warnings].filter(Boolean).join(' · ');
            }
            const added = this._rows.length - before;
            this._addNote = `Лист добавлен: помещений ${added}` +
                (prep.skipped ? ` · не удалось прочитать файлов: ${prep.skipped}` : '');
        } catch (e) {
            // Разобранное не теряем: дочитывание не удалось — на экране всё,
            // что было до него, плюс объяснение.
            this._addNote = 'Лист не добавлен. ' + ui.cleanError(e.message).split('\n')[0];
        }
        this._busy = false;
        this._busyText = '';
        ui.setStatus('');
        this.renderReview();
    },

    // ------------------------------------------------------------------
    // Шаг 2 — проверка помещений
    // ------------------------------------------------------------------

    startReview(res) {
        this._sheets = res.sheets || [];
        this._rows = res.rows || [];
        this._warning = (res.warnings || []).join(' · ');
        this._engSummary = res.engSummary || [];
        this.arrangeFloors();
        RecognizeUI.progressStop();
        RecognizeUI.step(2);
        RecognizeUI.setHead('plan');
        this.renderReview();
    },

    esc(s) {
        return String(s ?? '').replace(/[&<>"]/g,
            c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    },

    /** Что не так со строкой — коротко, для колонки примечаний. */
    rowNotes(r) {
        const notes = [];
        if (!(r.area > 0)) notes.push('площадь не прочитана — впишите');
        else if (r.areaSrc === 'estimate') notes.push('площадь оценена по пропорциям — проверьте');
        else if (r.areaSrc === 'dims' && r.dims) notes.push(`по размерам ${r.dims}`);
        if (r.nameGuessed) notes.push('название предположено по обстановке');
        if (!r.heated) notes.push('неотапливаемое');
        if (r.doubleHeight) notes.push('второй свет');
        if (r.ownFloor) notes.push(`на плане это ${r.floorRaw}-й уровень`);
        if (r.warmBelow) notes.push('под полом тёплый уровень — грунт не считается');
        if (r.warmAbove) notes.push('над потолком тёплый уровень — кровля не считается');
        if (r.windows === null) notes.push('окна не разобраны — поставлено 1');
        if (r.confidence < 0.5 && r.area > 0 && r.areaSrc !== 'estimate') notes.push('прочитано неуверенно');
        if (r.note) notes.push(r.note);
        if (r.eng && typeof RecognizeProject !== 'undefined') notes.push(...RecognizeProject.rowNotes(r));
        return notes;
    },

    floorTitle(s) {
        if (s.label) return s.label;
        if (s.floorRaw === 0) return 'подвал / цоколь';
        return `${s.floorRaw}-й этаж${s.floorGuessed ? ' (этаж не подписан)' : ''}`;
    },

    /**
     * Развести листы по этажам расчёта.
     *
     * Планы грузят как придётся — бывает, что вторым файлом идёт первый этаж, а
     * подписи этажа нет ни на листе, ни в имени файла. Тогда лист, чей этаж мы
     * только угадали, уступает место листу с подписанным этажом и встаёт на
     * свободный. Подписанные листы не трогаем никогда: там сказано прямо.
     */
    arrangeFloors() {
        if (this._sheets.length < 2) return;
        const taken = new Set(this._sheets.filter(s => !s.floorGuessed).map(s => s.floor));
        this._sheets.forEach(s => {
            if (!s.floorGuessed || !taken.has(s.floor)) { taken.add(s.floor); return; }
            const free = [1, 2].find(f => !taken.has(f));
            if (!free) return;   // оба этажа заняты — решать монтажнику
            this.setSheetFloor(s.i, free, true);
            taken.add(free);
        });
        this.markStacked();
    },

    /**
     * Соседи снизу и сверху у помещений сложенных листов.
     *
     * Этажей в расчёте два, а уровней в доме бывает три: цоколь, первый,
     * второй. Тогда два листа ложатся на «первый этаж», и расчёт посчитал бы
     * пол по грунту обоим — хотя первый этаж стоит на тёплом цоколе. Отмечаем:
     * у всех, кроме самого нижнего листа этажа, под полом тёплое; у всех, кроме
     * самого верхнего, над потолком тёплое. Один лист на этаж — признаков нет,
     * всё считается как раньше.
     *
     * Считается заново при каждой перестановке этажей: монтажник мог развести
     * листы по разным этажам, и тогда снимать уже нечего.
     */
    markStacked() {
        const byFloor = {};
        this._sheets.forEach(s => { (byFloor[s.floor] = byFloor[s.floor] || []).push(s); });
        this._rows.forEach(r => { delete r.warmBelow; delete r.warmAbove; });

        Object.keys(byFloor).forEach(f => {
            const stack = byFloor[f].slice().sort((a, b) => a.floorRaw - b.floorRaw);
            if (stack.length < 2) return;
            stack.forEach((s, k) => {
                this._rows.forEach(r => {
                    if (r._sheet !== s.i || r.floor !== s.floor) return;
                    if (k > 0) r.warmBelow = true;                  // под ним лист ниже
                    if (k < stack.length - 1) r.warmAbove = true;   // над ним лист выше
                });
            });
        });
    },

    /** Поменять этажи местами: листы загрузили в обратном порядке. */
    swapFloors() {
        if (this._busy) return;
        this._sheets.forEach(s => {
            s.floor = s.floor === 2 ? 1 : 2;
            s.floorRaw = s.floor;
            s.floorGuessed = false;
        });
        this._rows.forEach(r => {
            r.floor = r.floor === 2 ? 1 : 2;
            r.floorRaw = r.floor;
        });
        this.markStacked();
        this.renderReview();
    },

    // Ячейка, взятая из чертежа точно (r.eng.src[поле] === 'pdf'): зелёная.
    // Её можно не перепроверять — проверять остальное.
    PDF_CELL: 'background:rgba(22,163,74,.12);border-color:rgba(22,163,74,.55)',
    PDF_TIP: 'Из чертежа PDF: по координатам и стенам листа, без модели',

    // ------------------------------------------------------------------
    // Журнал исправлений
    //
    // Что монтажник поправил на экране проверки — и есть ошибки
    // распознавания. Строка запоминает, как её прочитали (r._orig), и при
    // переносе в архив уходит и прочитанное, и итог; удалённые строки — тоже.
    // Разбор архива показывает, какое правило добавить: какие поля правят
    // чаще, на каких листах, после модели или после чертежа.
    // ------------------------------------------------------------------

    snapRow(r) {
        const e = r.eng || {};
        return {
            name: r.name, area: r.area, windows: r.windows, panoramic: r.panoramic, outerWalls: r.outerWalls,
            heated: r.heated, floor: r.floor,
            ufh: e.ufh === undefined ? undefined : !!e.ufh, ufhArea: e.ufhArea, heaters: e.heaters,
            fix: e.fix ? Object.assign({}, e.fix) : (e.waterSheet ? null : undefined),
            src: e.src ? Object.assign({}, e.src) : undefined,
        };
    },

    /** Поля, которые монтажник поменял: { поле: [было, стало] }. */
    rowEdits(r) {
        if (!r._orig) return null;
        const now = this.snapRow(r), out = {};
        const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
        ['name', 'area', 'windows', 'panoramic', 'outerWalls', 'floor', 'ufh', 'ufhArea', 'heaters', 'fix'].forEach(k => {
            if (!same(r._orig[k], now[k])) out[k] = [r._orig[k] ?? null, now[k] ?? null];
        });
        return Object.keys(out).length ? out : null;
    },

    /** Строка «руками было бы» для проекта: сколько и из чего. */
    manualRow(P) {
        let plan;
        try { plan = P.savingPlan(RecognizeUI._project, this._rows, 0); } catch (e) { return ''; }
        if (!plan || plan.total < 5) return '';
        const secs = RecognizeUI._elapsed ? Math.max(1, Math.round(RecognizeUI._elapsed / 1000)) : null;
        const took = secs === null ? '' : secs < 90 ? `${secs} с` : `${Math.round(secs / 60)} мин`;
        return `<div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-top:1px solid var(--border,#e2e8f0);font-size:13px">⏱
            <span>Руками это <b style="color:#16a34a">≈${P.roughTime(plan.total)}</b>: разбор проекта ${RecognizeUI.handTime(plan.parse)} и смета
              ${plan.guessed ? '≈' : ''}${plan.bill} позиций ${RecognizeUI.handTime(plan.billMin)}${took ? `. Здесь — <b>${took}</b>` : ''}.
              <details style="display:inline"><summary style="display:inline;cursor:pointer;color:var(--text-sec,#64748b)">из чего</summary>
                ${plan.lines.map(x => `<div style="color:var(--text-sec,#64748b)">${x}</div>`).join('')}
                <div style="color:var(--text-sec,#64748b)">Нормы — по нижней границе: 10 с на лист, 1–1,5 мин на помещение, окно, зону и прибор, 40 с на марку и на позицию сметы, 2 мин на блок примечаний.</div>
              </details></span></div>`;
    },

    renderReview() {
        if (!this._busy) this._rows.forEach(r => { if (!r._orig) r._orig = this.snapRow(r); });
        const esc = this.esc;
        const fmt = (n) => this.fmt(n);
        const cell = v => (v === null || v === undefined) ? '' : v;

        const chosen = this._rows.filter(r => r._sel);
        const chosenArea = chosen.reduce((s, r) => s + (r.area > 0 ? r.area : 0), 0);
        const noArea = chosen.filter(r => !(r.area > 0)).length;
        const maxA = (typeof app !== 'undefined' && app.MAX_AREA) || 360;

        // Сводка над таблицей: сколько взято и укладываемся ли в предел расчёта.
        let sumCls = 'ok', sumIco = '✓', sumText, sumSub = '';
        if (!chosen.length) {
            sumCls = 'warn'; sumIco = '!';
            sumText = 'Ни одно помещение не отмечено';
            sumSub = 'Отметьте галочками помещения, которые пойдут в расчёт по комнатам.';
        } else if (chosenArea > maxA) {
            sumCls = 'bad'; sumIco = '!';
            sumText = `Отмечено ${chosen.length} ${RecognizeUI.plural(chosen.length, 'помещение', 'помещения', 'помещений')} · ${fmt(chosenArea)} м²`;
            sumSub = `Расчёт рассчитан максимум на ${maxA} м² — снимите часть помещений (например, подвал или гараж) или уменьшите площади.`;
        } else {
            sumText = `Отмечено ${chosen.length} ${RecognizeUI.plural(chosen.length, 'помещение', 'помещения', 'помещений')} · ${fmt(chosenArea)} м²`;
            const f1 = chosen.filter(r => r.floor !== 2).length, f2 = chosen.length - f1;
            sumSub = (f2 ? `1-й этаж: ${f1}, 2-й этаж: ${f2}. ` : '') +
                (noArea ? `У ${noArea} ${RecognizeUI.plural(noArea, 'помещения', 'помещений', 'помещений')} нет площади — впишите её или снимите отметку. `
                    : 'Проверьте названия, площади и окна — по ним считаются теплопотери и подбираются приборы.');
            if (noArea) sumCls = 'warn', sumIco = '!';
            // Второго этажа в разборе нет — напоминаем, что его можно дочитать
            // сюда же: догадаться, что «Другой файл» не единственный путь, не
            // по чему, а планы почти всегда лежат по файлу на этаж.
            if (!f2 && !this._busy) {
                sumSub += ' Второй этаж — кнопкой «➕ Добавить этаж», разобранное не потеряется.';
            }
        }

        // Два листа на одном этаже расчёта. Бывает честно (подвал и первый:
        // калькулятор считает два этажа, третьему деваться некуда), а бывает
        // и ошибкой чтения — сказать надо в обоих случаях.
        const perFloor = {};
        this._sheets.forEach(s => { (perFloor[s.floor] = perFloor[s.floor] || []).push(s); });
        const stacked = Object.keys(perFloor).filter(f => perFloor[f].length > 1)
            .map(f => `${f}-й этаж: ${perFloor[f].map(s => this.floorTitle(s)).join(' + ')}`);
        if (stacked.length && chosen.length) {
            // Это не обязательно ошибка: этажей в расчёте два, а уровней в доме
            // бывает три, и цоколю с первым этажом деваться некуда. Поэтому
            // говорим не «поправьте», а что из этого следует.
            sumSub += ` Несколько листов легли на один этаж расчёта (${stacked.join('; ')}) — ` +
                'так и задумано, этажей в расчёте два. Площади сложатся, а у верхнего уровня ' +
                'пол уже не по грунту — это учтено. Если листы перепутаны, поправьте ' +
                '«Этаж в расчёте» в шапке листа.';
        }

        // Листы инженерных систем из комплекта проекта: под каждым помещением
        // строка правки тёплого пола, приборов и сантехники.
        const engRead = (typeof RecognizeProject !== 'undefined' && (this._engSummary || []).length)
            ? RecognizeProject.sheetsRead(this._rows) : null;

        const floorOpt = (v, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${v}-й</option>`;
        const outerOpt = (v, t, cur) => `<option value="${v}" ${String(cur ?? '') === String(v) ? 'selected' : ''}>${t}</option>`;

        const body = this._sheets.map(s => {
            const sRows = this._rows.map((r, n) => ({ r, n })).filter(x => x.r._sheet === s.i);
            const readArea = sRows.reduce((a, x) => a + (x.r.area > 0 ? x.r.area : 0), 0);

            // Сверка с итогом экспликации — как сверка с итогом счёта у сметы:
            // расхождение значит потерянное или лишнее помещение.
            let check = '';
            if (s.totalArea > 0) {
                const d = readArea - s.totalArea;
                check = Math.abs(d) < 0.5
                    ? `<span class="rec-plan-ok">экспликация ${fmt(s.totalArea)} м² — прочитано столько же ✓</span>`
                    : `<span class="rec-plan-warn">экспликация ${fmt(s.totalArea)} м², прочитано ${fmt(readArea)} м² — ${
                        d < 0 ? 'возможно, помещение пропущено' : 'возможно, помещение задвоено'}</span>`;
            }

            const head = `<tr class="rec-plan-group"><td colspan="10">
                <div class="rec-plan-group-row">
                  <b>${this._sheets.length > 1 ? `Лист ${s.i + 1} · ` : ''}${esc(this.floorTitle(s))}</b>
                  ${s.name ? `<span class="rec-art">${esc(s.name)}</span>` : ''}
                  <label>Этаж в расчёте:
                    <select class="rec-f rec-plan-sel" onchange="RecognizePlan.setSheetFloor(${s.i}, this.value)">
                      ${floorOpt(1, s.floor)}${floorOpt(2, s.floor)}
                    </select></label>
                  <label>Потолок:
                    <input class="rec-f rec-plan-h" type="number" step="0.1" min="${this.H_MIN}" max="${this.H_MAX}"
                           value="${s.ceilingH ? esc(s.ceilingH) : ''}" placeholder="как в расчёте"
                           onchange="RecognizePlan.setSheetH(${s.i}, this.value)"> м</label>
                  ${check}
                  ${sRows.length ? '' : '<span class="rec-plan-warn">помещений не прочитано</span>'}
                </div>
                ${s.unclear.length ? `<div class="rec-art">Не разобрано: ${esc(s.unclear.join('; '))}</div>` : ''}
              </td></tr>`;

            const trs = sRows.map(({ r, n }) => {
                const notes = this.rowNotes(r);
                const src = (r.eng && r.eng.src) || {};
                const pdfWin = src.windows === 'pdf' ? ` style="${this.PDF_CELL}" title="${this.PDF_TIP}"` : '';
                const cls = !(r.area > 0) ? 'rec-nomatch'
                    : (r.areaSrc === 'estimate' ? 'rec-plan-est' : '');
                return `<tr class="${cls}">
                  <td><input type="checkbox" ${r._sel ? 'checked' : ''}
                             onchange="RecognizePlan.sel(${n}, this.checked)"></td>
                  <td class="rec-raw">${esc(r.num)}</td>
                  <td><input class="rec-f" value="${esc(r.name)}"${src.name === 'pdf' ? ` style="${this.PDF_CELL}" title="Из экспликации PDF дословно"` : ''}
                             onchange="RecognizePlan.set(${n},'name',this.value)"></td>
                  <td><input class="rec-f rec-f-s" type="number" step="0.1" min="0" value="${esc(cell(r.area))}"${src.area === 'pdf' ? ` style="${this.PDF_CELL}" title="Из экспликации PDF дословно"` : ''}
                             onchange="RecognizePlan.set(${n},'area',this.value)"></td>
                  <td><input class="rec-f rec-f-s" type="number" step="1" min="0" value="${r.windows === null ? 1 : r.windows}"${pdfWin}
                             onchange="RecognizePlan.set(${n},'windows',this.value)"></td>
                  <td><input class="rec-f rec-f-s" type="number" step="1" min="0" value="${r.panoramic}"${pdfWin}
                             onchange="RecognizePlan.set(${n},'panoramic',this.value)"></td>
                  <td><select class="rec-f"${src.outerWalls === 'pdf' ? ` style="${this.PDF_CELL}" title="По стенам листа: с этих сторон за стеной улица"` : ''} onchange="RecognizePlan.set(${n},'outerWalls',this.value)">
                        ${outerOpt('', 'авто', r.outerWalls)}${outerOpt(1, '1', r.outerWalls)}${outerOpt(2, '2', r.outerWalls)}${outerOpt(3, '3', r.outerWalls)}
                      </select></td>
                  <td><select class="rec-f" onchange="RecognizePlan.set(${n},'floor',this.value)">
                        ${floorOpt(1, r.floor)}${floorOpt(2, r.floor)}
                      </select></td>
                  <td class="rec-plan-notes">${notes.map(t => `<div>${esc(t)}</div>`).join('')}</td>
                  <td class="rec-acts"><button onclick="RecognizePlan.del(${n})" title="Убрать строку">✕</button></td>
                </tr>${engRead ? RecognizeProject.engRow(r, n, engRead, 10) : ''}`;
            }).join('');

            return head + trs;
        }).join('');

        const st = (typeof app !== 'undefined' && app.state) || {};
        const hasRooms = !!(st.detailedRooms && Array.isArray(st.rooms) && st.rooms.length);
        // Пока дочитывается лист, менять нечего: строки вот-вот прибавятся, а
        // перенос в расчёт на середине разбора отдал бы половину дома.
        const busy = this._busy ? 'disabled' : '';
        const disabled = (this._busy || !chosen.length || noArea || chosenArea > maxA) ? 'disabled' : '';

        // Предупреждения без повторов: при обрыве по лимиту одна и та же фраза
        // приходила от каждого листа и склеивалась через «·». Первое на виду,
        // остальные — под «ещё N».
        const warns = [...new Set(String(this._warning || '').split(' · ').map(s => s.trim()).filter(Boolean))];
        const warnHtml = warns.length ? `<div class="rec-err">${esc(warns[0])}${warns.length > 1 ? `
            <details style="margin-top:4px"><summary style="cursor:pointer">ещё ${warns.length - 1}</summary>
              ${warns.slice(1).map(w => `<div style="margin-top:3px">${esc(w)}</div>`).join('')}</details>` : ''}</div>` : '';

        // Одна сводка вместо стопки плашек: заголовок, по строке на город,
        // проживающих, итог «в расчёт пойдёт» и вентиляцию; пояснения и
        // сводки по листам — под «подробнее».
        const P = typeof RecognizeProject !== 'undefined' ? RecognizeProject : null;
        const rowSt = 'display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-top:1px solid var(--border,#e2e8f0);font-size:13px';
        const sumRows = [
            P && P.city ? `<div style="${rowSt}">📍 ${P.cityLine()}</div>` : '',
            this.resRow() ? `<div style="${rowSt}">👪 ${this.resRow()}</div>` : '',
            P && (this._engSummary || []).length ? `<div style="${rowSt}">🔧 <span>${esc(P.totals(chosen))}
                <span style="color:var(--text-sec,#64748b)">Что к какой комнате — в строке под помещением.</span></span></div>` : '',
            P && P.vent ? `<div style="${rowSt}">🌬️ ${P.ventSelect()}</div>` : '',
            P && RecognizeUI._project ? this.manualRow(P) : '',
            this._rows.some(r => r.eng && r.eng.src && Object.values(r.eng.src).includes('pdf'))
                ? `<div style="${rowSt}"><span style="display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid rgba(22,163,74,.55);background:rgba(22,163,74,.12);flex:none;margin-top:2px"></span>
                    <span>Зелёным — взято из чертежа точно, по координатам и стенам листа: это можно не перепроверять. Остальное прочитано по картинке — его проверьте.</span></div>` : '',
        ].filter(Boolean).join('');
        const details = [
            sumSub,
            ...(this._engSummary || []).map(t => esc(t)),
            this.resDetail(),
            P && P.city ? `Адрес проекта: «${esc(P.city.address)}».` : '',
            (this._engSummary || []).length ? 'При переносе тёплый пол и приборы встанут в комнаты, сантехника — в «Водоснабжение» по помещениям.' : '',
        ].filter(Boolean);
        const summaryHtml = `<div class="rec-tcheck ${sumCls}" style="display:block">
            <div style="display:flex;gap:10px;align-items:center">
              <div class="rec-tcheck-ico">${sumIco}</div><div style="font-weight:600">${sumText}</div></div>
            ${sumRows ? `<div style="margin-top:6px">${sumRows}</div>` : ''}
            ${details.length ? `<details ${this._sumOpen ? 'open' : ''} ontoggle="RecognizePlan._sumOpen = this.open" style="margin-top:4px">
                <summary class="rec-tcheck-sub" style="cursor:pointer">Подробнее</summary>
                ${details.map(t => `<div class="rec-tcheck-sub" style="margin-top:3px">${t}</div>`).join('')}</details>` : ''}
          </div>`;

        document.getElementById('rec_body').innerHTML = `
          ${warnHtml}
          ${this._busy ? `
            <div class="rec-tcheck warn">
              <div class="rec-tcheck-ico">⏳</div>
              <div><div>Читаю ещё один этаж</div>
                   <div class="rec-tcheck-sub" id="rec_plan_busy">${esc(this._busyText)}</div>
                   <div class="rec-tcheck-sub">Уже прочитанное останется на месте.</div></div>
            </div>` : ''}
          ${this._addNote ? `<div class="rec-tcheck ${/не добавлен/.test(this._addNote) ? 'bad' : 'ok'}">
              <div class="rec-tcheck-ico">${/не добавлен/.test(this._addNote) ? '!' : '✓'}</div>
              <div><div>${esc(this._addNote)}</div></div>
            </div>` : ''}
          ${summaryHtml}
          ${P ? P.reqsBlock() : ''}
          <div class="rec-toolbar">
            <button class="rec-btn-g" ${busy} onclick="RecognizePlan.selAll(true)">Отметить все</button>
            <button class="rec-btn-g" ${busy} onclick="RecognizePlan.selAll(false)">Снять все</button>
            <button class="rec-btn-g" ${busy} onclick="RecognizePlan.selHeated()">Только отапливаемые</button>
            ${this._sheets.length > 1 || this._rows.some(r => r.floor === 2)
                ? `<button class="rec-btn-g" ${busy} onclick="RecognizePlan.swapFloors()"
                           title="Листы загрузили в обратном порядке: первый этаж станет вторым и наоборот">⇅ Поменять этажи местами</button>` : ''}
            <div class="rec-tb-right">
              <button class="rec-btn-g rec-btn-accent" ${busy} onclick="RecognizePlan.addFloor()"
                      title="Дочитать план другого этажа к уже разобранному">➕ Добавить этаж</button>
              <button class="rec-btn-g" ${busy} onclick="RecognizeUI.resetAll()">↩ Другой файл</button>
            </div>
          </div>
          <div class="rec-tablewrap">
            <table class="rec-table rec-plan-table">
              <colgroup><col style="width:30px"><col style="width:46px"><col style="width:190px">
                <col style="width:92px"><col style="width:62px"><col style="width:84px">
                <col style="width:92px"><col style="width:66px"><col><col style="width:34px"></colgroup>
              <thead><tr>
                <th><input type="checkbox" ${chosen.length && chosen.length === this._rows.length ? 'checked' : ''}
                           title="Отметить все / снять все"
                           onchange="RecognizePlan.selAll(this.checked)"></th>
                <th>№</th><th>Помещение</th><th>Площадь, м²</th><th>Окон</th>
                <th title="Витражи от пола, окна выше 2 м или шире 2,5 м — под них подбирается конвектор">Из них в&nbsp;пол</th>
                <th title="Сколько стен помещения выходят на улицу — влияет на теплопотери">Наружных стен</th>
                <th>Этаж</th><th>Примечание</th><th></th>
              </tr></thead>
              <tbody>${body}</tbody>
            </table>
          </div>
          <div class="rec-foot">
            <div class="rec-total">В расчёт: <b>${chosen.length}</b> ${RecognizeUI.plural(chosen.length, 'помещение', 'помещения', 'помещений')}, ${fmt(chosenArea)} м²</div>
            ${hasRooms
                ? `<button class="calc-dialog-btn calc-dialog-btn-cancel" ${disabled} onclick="RecognizePlan.apply('new')">Заменить комнаты расчёта</button>
                   <button class="calc-dialog-btn calc-dialog-btn-confirm" ${disabled} onclick="RecognizePlan.apply('add')">Добавить к комнатам</button>`
                : `<button class="calc-dialog-btn calc-dialog-btn-confirm" ${disabled} onclick="RecognizePlan.apply('new')">В расчёт по комнатам</button>`}
          </div>`;

        // Итог дочитывания показывается один раз: он про только что сделанное
        // действие, и висеть над таблицей до конца проверки ему незачем.
        this._addNote = '';
    },

    // ------------------------------------------------------------------
    // Правки на экране проверки
    // ------------------------------------------------------------------

    set(i, field, val) {
        const r = this._rows[i];
        if (!r) return;
        if ((field === 'name' || field === 'area' || field === 'outerWalls') && r.eng && r.eng.src) delete r.eng.src[field];
        if (field === 'name') r.name = this.cleanName(val);
        else if (field === 'area') {
            const n = this.num(val);
            r.area = n > 0 ? Math.round(n * 100) / 100 : null;
            // Вписанная руками площадь — уже не оценка и не «не прочитано».
            r.areaSrc = r.area ? 'manual' : r.areaSrc;
            if (r.area > 0 && r.heated && !r._sel) r._sel = true;
        }
        else if (field === 'windows') {
            const n = this.num(val);
            r.windows = n === null ? 1 : Math.max(0, Math.round(n));
            r.panoramic = Math.min(r.panoramic, r.windows);
        }
        else if (field === 'panoramic') {
            const n = this.num(val);
            r.panoramic = Math.max(0, Math.round(n || 0));
            if (r.windows === null) r.windows = 1;
            if (r.panoramic > r.windows) r.windows = r.panoramic;
        }
        // Поправлено руками — уже не «из чертежа».
        if ((field === 'windows' || field === 'panoramic') && r.eng && r.eng.src) delete r.eng.src.windows;
        // Окна с обмерного плана проекта: подогнать их список под правку.
        if ((field === 'windows' || field === 'panoramic') && r.eng && r.eng.winSpec
            && typeof RecognizeProject !== 'undefined') RecognizeProject.resizeWinSpec(r);
        if (field === 'outerWalls') {
            const n = parseInt(val, 10);
            r.outerWalls = (n >= 1 && n <= 3) ? n : null;
        }
        else if (field === 'floor') {
            r.floor = this.calcFloor(val);
            r.floorRaw = r.floor;
            r.ownFloor = false;
            this.markStacked();
        }
        this.renderReview();
    },

    // ------------------------------------------------------------------
    // Проживающие по спальням
    //
    // От числа проживающих (state.res) зависят объём бойлера и расход ГВС
    // (app.dhwTankPlan, dhwDesignFlow). С плана он не переносился, и КП по
    // «Хвойной 3» ушло с «Проживающих: 0» и бойлером на 100 л при ванне и
    // двух душах. Оценка по практике: в самой большой спальне двое, в каждой
    // следующей спальне и детской — по одному. Гостиная, кабинет, гардеробная
    // — не спальни.
    // ------------------------------------------------------------------

    BEDROOM_RE: /спальн|детск/i,
    _resUse: true,

    residentsFromRows(rows) {
        const beds = rows.filter(r => r._sel && this.BEDROOM_RE.test(r.name || '') && !/гардероб/i.test(r.name || ''))
            .sort((a, b) => (b.area || 0) - (a.area || 0));
        if (!beds.length) return null;
        const parts = beds.map((r, k) => ({ name: r.name, n: k === 0 ? 2 : 1 }));
        const n = Math.min(10, parts.reduce((a, p) => a + p.n, 0));
        return { n, parts };
    },

    setResUse(v) { this._resUse = !!v; this.renderReview(); },

    /**
     * Проверка числа проживающих по водоразборным приборам — теми же
     * формулами, что подберут бойлер в смете (app.dhwTankPlan: большее из
     * «по людям» и «по пиковому разбору приборов»; app.dhwDesignFlow — расход
     * по СП 30.13330.2020). Считаем на временном состоянии: сантехника с
     * листа проекта ещё не перенесена в расчёт. Сантехники нет — null.
     */
    resCheck(n) {
        if (typeof app === 'undefined' || typeof app.dhwTankPlan !== 'function') return null;
        const zones = this._rows.filter(r => r._sel && r.eng && r.eng.fix)
            .map((r, k) => ({ id: k + 1, name: r.name, dist: 6, fixtures: Object.assign({}, r.eng.fix) }));
        if (!zones.length) return null;
        const st = app.state;
        const keep = { water: st.water, waterZones: st.waterZones, res: st.res, tankVol: st.tankVol };
        try {
            Object.assign(st, { water: true, waterZones: zones, res: n, tankVol: null });
            const plan = app.dhwTankPlan();
            const flow = typeof app.dhwDesignFlow === 'function' ? app.dhwDesignFlow() : null;
            const volByRes = n >= 10 ? 500 : n >= 7 ? 300 : n >= 5 ? 200 : n >= 3 ? 150 : 100;
            return { plan, flow, volByRes };
        } finally {
            Object.assign(st, keep);
        }
    },

    /**
     * Строка сводки: проживающие по спальням и итог проверки по приборам в
     * три слова. Расклад по спальням и сама проверка — в resDetail
     * («подробнее»).
     */
    resRow() {
        const est = this.residentsFromRows(this._rows);
        if (!est) return '';
        const chk = this.resCheck(est.n);
        let tail = '';
        if (chk) {
            const warn = (chk.plan.fixturesVol || 0) > chk.volByRes;
            tail = warn
                ? ` — <b style="color:#b45309">приборам нужно больше, бойлер ${chk.plan.vol} л по приборам</b>`
                : ` — бойлер ${chk.plan.vol} л, приборам хватает`;
        }
        return `<label style="display:flex;gap:6px;align-items:flex-start;cursor:pointer">
            <input type="checkbox" ${this._resUse ? 'checked' : ''} style="margin-top:3px" onchange="RecognizePlan.setResUse(this.checked)">
            <span>Проживающих: <b>${est.n}</b> по спальням${tail}</span></label>`;
    },

    resDetail() {
        const est = this.residentsFromRows(this._rows);
        if (!est) return '';
        const cur = (typeof app !== 'undefined' && app.state) ? (parseInt(app.state.res) || 0) : 0;
        const chk = this.resCheck(est.n);
        let s = `Проживающие: ${this.esc(est.parts.map(p => `${p.name} — ${p.n}`).join(', '))}` +
            (cur && cur !== est.n ? `; сейчас в расчёте ${cur}` : '') + '. От этого числа — объём бойлера и расход горячей воды.';
        if (chk) {
            const f = chk.plan.fixtures || {};
            const fxList = [f.bath ? `ванн ${f.bath}` : '', f.shower ? `душей ${f.shower}` : '', f.basin ? `раковин и биде ${f.basin}` : '']
                .filter(Boolean).join(', ');
            s += ` Проверка по приборам (${fxList || 'без ванн и душей'}): пиковый разбор горячей воды ≈ ${chk.plan.fixturesVol || 0} л, ` +
                `по ${est.n} проживающим — ${chk.volByRes} л; бойлер берётся по большему.` +
                (chk.flow ? ` Расчётный расход ГВС по СП 30.13330.2020 — ${this.fmt(Math.round(chk.flow.qh * 100) / 100)} л/с.` : '');
        } else {
            s += ' Проверки по приборам нет: сантехника по помещениям не распознана.';
        }
        return s;
    },

    /** Город из адреса проекта — подставить в расчёт или нет. */
    setCityUse(v) {
        if (typeof RecognizeProject === 'undefined') return;
        RecognizeProject.setCityUse(v);
        this.renderReview();
    },

    /** Требование из примечаний проекта — взять в смету или нет. */
    setReq(i, v) {
        if (typeof RecognizeProject === 'undefined') return;
        RecognizeProject.setReq(i, v);
        this.renderReview();
    },

    /** Тип вентиляции с листа проекта — выбор над таблицей. */
    setVent(v) {
        if (typeof RecognizeProject === 'undefined') return;
        RecognizeProject.setVentChoice(v);
        this.renderReview();
    },

    /** Тёплый пол, приборы, сантехника — из строки под помещением. */
    setEng(i, field, val) {
        const r = this._rows[i];
        if (!r || typeof RecognizeProject === 'undefined') return;
        RecognizeProject.setEng(r, field, val);
        this.renderReview();
    },

    sel(i, v) { if (this._rows[i]) { this._rows[i]._sel = !!v; this.renderReview(); } },
    selAll(v) { this._rows.forEach(r => r._sel = !!v); this.renderReview(); },
    selHeated() { this._rows.forEach(r => r._sel = r.heated && r.area > 0); this.renderReview(); },
    del(i) {
        const r = this._rows[i];
        if (r && r._orig) (this._deleted = this._deleted || []).push(r._orig);
        this._rows.splice(i, 1);
        this.renderReview();
    },

    /**
     * Этаж всем помещениям листа разом: один лист — один этаж.
     * quiet — правка идёт из разведения листов, перерисовка будет потом.
     */
    setSheetFloor(si, val, quiet) {
        const s = this._sheets.find(x => x.i === si);
        if (!s) return;
        s.floor = this.calcFloor(val);
        s.floorRaw = s.floor;
        s.floorGuessed = false;
        this._rows.forEach(r => {
            if (r._sheet !== si || r.ownFloor) return;
            r.floor = s.floor;
            r.floorRaw = s.floor;
        });
        if (!quiet) { this.markStacked(); this.renderReview(); }
    },

    setSheetH(si, val) {
        const s = this._sheets.find(x => x.i === si);
        if (!s) return;
        const n = this.num(val);
        s.ceilingH = (n > 1.8 && n < 8) ? Math.round(n * 100) / 100 : null;
        this.renderReview();
    },

    // ------------------------------------------------------------------
    // Шаг 3 — в расчёт по комнатам
    // ------------------------------------------------------------------

    /**
     * Комната калькулятора из строки проверки. Поля те же, что создаёт
     * app.addRoom, плюс уточнения, которые есть только у плана: число
     * наружных стен, сторона света, второй свет.
     */
    toCalcRoom(r, id, st) {
        const win = r.windows === null ? 1 : r.windows;
        const width = (typeof app.getDefaultWindowWidth === 'function')
            ? app.getDefaultWindowWidth(r.area) : 1.5;
        const windows = [];
        for (let k = 0; k < win; k++) {
            windows.push({ id: id + k + 1, width, isPan: k < r.panoramic });
        }
        // Радиаторы — всегда, тёплый пол — если он включён в объекте и уместен в
        // помещении (санузел, кухня, жилая — да, кладовая и котельная — нет).
        const sys = ['rad'];
        const wantsTp = (st.systems || []).includes('tp') &&
            (typeof app.roomWantsUfh !== 'function' || app.roomWantsUfh({ name: r.name }));
        if (wantsTp) sys.push('tp');

        const room = { id, name: r.name, area: r.area, floor: r.floor, sys, windows };
        if (r.outerWalls) room.outerWalls = r.outerWalls;
        if (r.orient) room.orient = r.orient;
        if (r.doubleHeight) room.doubleHeight = true;
        // Три уровня в двух этажах расчёта: у помещения над цоколем пол не по
        // грунту, а по тёплому — иначе оно получит лишние потери (см. markStacked).
        if (r.warmBelow) room.warmBelow = true;
        if (r.warmAbove) room.warmAbove = true;
        // Комплект листов проекта: окна — по обмерному плану (высоты,
        // подоконники, окна в пол), затем системы и приборы — по листу
        // отопления; приборы раскладываются уже по настоящим окнам.
        if (r.eng && typeof RecognizeProject !== 'undefined') {
            RecognizeProject.fitWindows(room, r);
            RecognizeProject.fitRoom(room, r);
        }
        return room;
    },

    async apply(mode) {
        if (typeof app === 'undefined' || this._busy) return;
        const st = app.state;
        const chosen = this._rows.filter(r => r._sel);
        if (!chosen.length) { app.alert('Отметьте хотя бы одно помещение.'); return; }

        const noArea = chosen.filter(r => !(r.area > 0));
        if (noArea.length) {
            app.alert('У отмеченных помещений нет площади: ' +
                noArea.map(r => r.name).join(', ') + '. Впишите площадь или снимите отметку.');
            return;
        }

        const hasRooms = !!(st.detailedRooms && Array.isArray(st.rooms) && st.rooms.length);
        const keep = (mode === 'add' && hasRooms) ? st.rooms : [];
        const total = keep.reduce((s, r) => s + (parseFloat(r.area) || 0), 0) +
            chosen.reduce((s, r) => s + r.area, 0);
        const maxA = app.MAX_AREA || 360;
        // Расчёт рассчитан максимум на MAX_AREA, и syncRoomsToState при переборе
        // молча ужал бы ВСЕ комнаты пропорционально — площади разошлись бы с
        // планом. Не применяем.
        if (total > maxA) {
            app.alert(`С этими помещениями площадь дома выходит ${this.fmt(total)} м², а расчёт рассчитан максимум на ${maxA} м². Снимите часть помещений или уменьшите площади.`);
            return;
        }

        if (mode === 'new' && hasRooms) {
            const ok = await app.confirm('Комнаты текущего расчёта будут заменены помещениями с плана. Продолжить?');
            if (!ok) return;
        }

        // Расчёт по комнатам требует входа. Проверяем до того, как трогать
        // состояние: окно входа при полуперенесённых комнатах — худший вариант.
        if (!st.detailedRooms && typeof app.checkAccess === 'function' && !app.checkAccess('pro')) return;

        // Листы, с которых пришли отмеченные помещения, — они же подложки для
        // редактора планов. Снимаем их СЕЙЧАС: ниже вкладка чистит за собой и
        // _imgs, и _sheets, а картинки нужны уже после этой чистки.
        const _shots = (() => {
            const imgs = (RecognizeUI._imgs && RecognizeUI._imgs.length)
                ? RecognizeUI._imgs : (RecognizeUI._img ? [RecognizeUI._img] : []);
            return this._sheets
                .filter(sh => imgs[sh.i] && chosen.some(r => r._sheet === sh.i))
                .slice()
                .sort((x, y) => x.floorRaw - y.floorRaw)
                .map(sh => ({ b64: imgs[sh.i] }));
        })();

        RecognizeUI.step(3);
        this.archive(mode, chosen);

        // Снимок для отката: перенос трогает комнаты, этажность и высоты, и
        // откатывать это по одному полю нельзя.
        this._undo = JSON.parse(JSON.stringify({
            rooms: st.rooms || [], floors: st.floors, h1: st.h1, h2: st.h2,
            detailedRooms: st.detailedRooms, area: st.area, tp1: st.tp1, tp2: st.tp2,
            win: st.win, systems: st.systems || [], ufhZones: st.ufhZones,
            showDetailedRoomsPanel: st.showDetailedRoomsPanel,
            water: st.water, waterZones: st.waterZones || [], towelWarmer: st.towelWarmer || null, hotWater: st.hotWater, res: st.res,
            ventilationEnabled: st.ventilationEnabled, ventilationType: st.ventilationType,
            projectReqs: st.projectReqs || null,
            selectedCity: st.selectedCity || null, region: st.region,
        }));

        const base = Date.now();
        const rooms = chosen.map((r, i) => this.toCalcRoom(r, base + i * 1000, st));

        st.rooms = keep.concat(rooms);
        st.floors = st.rooms.some(r => r.floor === 2) ? 2 : 1;
        if (st.floors === 1) st.tp2 = 0;

        // Высота потолка с листа — в высоту этажа расчёта. Лист подвала,
        // попавший на первый этаж, не должен перебивать лист самого первого
        // этажа: предпочитаем лист, чей номер совпадает с этажом расчёта.
        [1, 2].forEach(f => {
            const used = this._sheets.filter(s => s.ceilingH > 0 &&
                chosen.some(r => r._sheet === s.i && r.floor === f));
            if (!used.length) return;
            const s = used.find(x => x.floorRaw === f) || used[0];
            const h = Math.min(this.H_MAX, Math.max(this.H_MIN, Math.round(s.ceilingH * 10) / 10));
            if (f === 1) st.h1 = h; else st.h2 = h;
        });

        // Площадь объекта — по комнатам: иначе включение подробного режима
        // сгенерировало бы шаблонные комнаты поверх наших.
        st.area = Math.round(total * 10) / 10;

        // Сантехника и полотенцесушители с листов проекта. Зоны водоснабжения
        // заменяются целиком: в проекте перечислены все приборы дома, и
        // шаблонные «Санузел 1», «Санузел 2» рядом с ними были бы лишними.
        let waterZones = 0, towel = false, vent = '', reqs = 0, city = '';
        if (typeof RecognizeProject !== 'undefined') {
            city = RecognizeProject.applyCity(st);
            waterZones = RecognizeProject.applyWater(st, chosen);
            towel = RecognizeProject.applyTowel(st);
            vent = RecognizeProject.applyVent(st);
            reqs = RecognizeProject.applyReqs(st);
            if (chosen.some(r => r.eng && r.eng.heatSheet)) RecognizeProject.syncUfhSliders(st);
        }

        // Проживающие — по спальням (см. residentsFromRows): от них бойлер.
        let resN = 0;
        const _res = this.residentsFromRows(this._rows);
        if (_res && this._resUse) { st.res = _res.n; resN = _res.n; }

        if (!st.detailedRooms) {
            app.toggleDetailedRooms(true);
            if (!st.detailedRooms) {
                // Не включился — нет входа. Возвращаем как было.
                this.undoApply(true);
                return;
            }
        }
        // Второй свет: высоту помещения считаем от высоты этажа, как это делает
        // toggleRoomDoubleHeight — но уже после того, как известны h1/h2.
        st.rooms.forEach(r => {
            if (r.doubleHeight && !r.customHeight && typeof app.getRoomHeightBounds === 'function') {
                const b = app.getRoomHeightBounds(r);
                r.customHeight = Math.min(b.hMax, Math.max(b.hMin, Math.round(b.normalH * 2 * 10) / 10));
            }
        });
        st.showDetailedRoomsPanel = true;
        const chkPanel = document.getElementById('chk_detailed_rooms_toggle');
        if (chkPanel) chkPanel.checked = true;

        app.syncRoomsToState();
        if (typeof app.autoCalcZones === 'function') app.autoCalcZones();
        if (waterZones && typeof app.renderZonesUI === 'function') app.renderZonesUI();
        app.syncUI();
        app.render();
        if (typeof app.saveState === 'function') app.saveState();

        // Тот же лист, что читало распознавание, кладём подложкой в редактор
        // планов: файл монтажник уже выбрал, второй раз спрашивать незачем.
        // Не вышло (нет доступа к проектированию, нет входа, молчит сервер
        // подложек) — перенос комнат от этого не страдает.
        let planNote = '';
        try {
            const got = await app.adoptPlanBackdrops(_shots);
            if (got) planNote = '\n\nПодложки перенесены в «План этажей»: ' + got + ' ' +
                (got === 1 ? 'лист' : 'листа') +
                (got < _shots.length
                    ? ' из ' + _shots.length + ' (остальные не загрузились — добавьте их в редакторе).'
                    : '. Откройте его — масштаб подберётся сам, дальше «Распознать комнаты».');
        } catch (e) {
            console.warn('[план] подложки не перенесены:', e.message);
        }

        // Сколько это заняло бы руками — считаем до того, как набор листов
        // проекта сброшен: смета уже посчитана, её позиции — тоже работа.
        let manual = null;
        if (RecognizeUI._project && typeof RecognizeProject !== 'undefined') {
            try {
                const bill = (app.currentEquipmentList || []).length + (app.currentWorksList || []).length;
                manual = RecognizeProject.manualEstimate(RecognizeUI._project, chosen, bill);
            } catch (e) { manual = null; }
        }
        const isProject = !!RecognizeUI._project;

        // Вкладка должна открыться чистой в следующий раз.
        RecognizeUI.dropDraft();
        RecognizeUI.clearFileState();
        RecognizeUI._rows = [];
        this.reset();
        const panel = document.getElementById('panel_recognize');
        if (panel) panel.innerHTML = '';
        RecognizeUI.close();
        this.showRooms();

        const f2 = rooms.filter(r => r.floor === 2).length;
        const parts = [`В расчёт ${mode === 'add' ? 'добавлено' : 'перенесено'} помещений: ${rooms.length}` +
            (f2 ? ` (1-й этаж: ${rooms.length - f2}, 2-й этаж: ${f2})` : '')];
        parts.push(`Площадь по комнатам: ${this.fmt(st.area)} м²`);
        const hs = this._undo && (this._undo.h1 !== st.h1 || this._undo.h2 !== st.h2);
        if (hs) parts.push(`Высота потолка взята с плана: ${st.h1}${st.floors === 2 ? ' / ' + st.h2 : ''} м`);
        if (waterZones) parts.push(`Водоснабжение включено, приборы по помещениям: ${waterZones}`);
        if (towel) parts.push(`Полотенцесушители: ${st.towelWarmer.count}`);
        if (vent) parts.push(`Вентиляция: ${vent}`);
        if (city) parts.push(`Город расчёта по адресу проекта: ${city}`);
        if (resN) parts.push(`Проживающих: ${resN} (по спальням)`);
        if (reqs) parts.push(`Требования из примечаний проекта: ${reqs} — плашкой в шапке сметы`);
        if (manual && manual.min >= 5) {
            // Одной строкой: раскладку «из чего» монтажник уже видел, пока
            // шло распознавание, и на экране проверки.
            parts.push('');
            parts.push(`⏱ Руками это около ${RecognizeUI.handTime(manual.min)}`);
        }
        // Помещения проекта уже распознаны — «Распознать комнаты» в редакторе
        // планов только путало: подложка лежит там для листов проекта.
        if (isProject && planNote) planNote = '\n\nЛист плана положен подложкой в «План этажей».';
        app.alert(parts.join('\n') +
            '\n\nПроверьте окна и системы отопления в карточках комнат. ' +
            'Вернуть комнаты как было — кнопка «↶ Вернуть комнаты» во вкладке распознавания.' + planNote, 'Готово');
    },

    /** Показать карточки комнат: расчёт по комнатам открыт, лента у первой карточки. */
    showRooms() {
        try {
            if (app.isMobileLayout && app.isMobileLayout() && app.state.mobTab !== 'inputs') {
                app.state.mobTab = 'inputs';
                if (typeof app.syncMobileUI === 'function') app.syncMobileUI();
            }
            const blk = document.getElementById('blk_detailed_calc');
            if (blk) blk.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) { /* прокрутка необязательна */ }
    },

    /** Откат переноса: комнаты, этажность и высоты — как до применения. */
    async undoApply(silent) {
        if (!this._undo || typeof app === 'undefined') return;
        if (!silent && !await app.confirm('Вернуть комнаты расчёта такими, какими они были до переноса с плана?')) return;
        const u = this._undo;
        const st = app.state;
        st.rooms = u.rooms;
        st.floors = u.floors;
        st.h1 = u.h1; st.h2 = u.h2;
        st.detailedRooms = u.detailedRooms;
        st.area = u.area; st.tp1 = u.tp1; st.tp2 = u.tp2; st.win = u.win;
        st.systems = u.systems; st.ufhZones = u.ufhZones;
        st.showDetailedRoomsPanel = u.showDetailedRoomsPanel;
        if ('water' in u) {
            st.water = u.water; st.waterZones = u.waterZones;
            if (u.towelWarmer) st.towelWarmer = u.towelWarmer;
            st.ventilationEnabled = u.ventilationEnabled; st.ventilationType = u.ventilationType;
            if (u.projectReqs) st.projectReqs = u.projectReqs; else delete st.projectReqs;
            st.selectedCity = u.selectedCity; st.region = u.region;
            st.hotWater = u.hotWater;
            st.res = u.res;
            if (typeof app.renderZonesUI === 'function') app.renderZonesUI();
        }
        this._undo = null;
        const chkD = document.getElementById('chk_detailed_rooms');
        if (chkD) chkD.checked = !!st.detailedRooms;
        const chkPanel = document.getElementById('chk_detailed_rooms_toggle');
        if (chkPanel) chkPanel.checked = !!st.showDetailedRoomsPanel;
        app.syncRoomsToState();
        if (typeof app.autoCalcZones === 'function') app.autoCalcZones();
        app.syncUI();
        app.render();
        if (typeof app.saveState === 'function') app.saveState();
        const u2 = document.getElementById('rec_undo_plan');
        if (u2) u2.style.display = 'none';
        if (!silent) app.alert('Комнаты расчёта возвращены.');
    },

    /**
     * Архив на Beget — тот же, что у смет: по нему считается месячный лимит
     * запросов, и распознавание плана стоит их так же. Имя файла помечаем
     * словом «план», чтобы в админке такая запись не выглядела сметой без
     * единой подобранной позиции.
     */
    async archive(mode, chosen) {
        try {
            const ui = RecognizeUI;
            const urow = (typeof app.accessUserRow === 'function')
                ? (app.accessUserRow() || {}) : (app._currentUserRow || {});
            const payload = {
                user: ui.userKey(),
                region: urow.region || '',
                distributorId: urow.distributor_id || (app.state && app.state.distributorId) || '',
                source: 'floor_plan',
                fileName: 'План этажа · ' + (ui._fileName || ''),
                mode: 'plan-' + mode,
                counts: {
                    recognized: this._rows.length + (this._deleted || []).length,
                    applied: chosen.length,
                    // Исправлено руками — строк с правками и удалённых.
                    replaced: this._rows.filter(r => this.rowEdits(r)).length + (this._deleted || []).length,
                    fromMemory: 0, noMatch: 0,
                },
                calcId: app.state.calc_id || null,
                projectName: app.state.projectName || '',
                calls: this._calls || 0,
                fromCache: this._fromCache || 0,
                sheets: this._sheets.map(s => ({
                    i: s.i, label: s.label, floor: s.floorRaw, ceilingH: s.ceilingH, totalArea: s.totalArea,
                })),
                // В записи архива сервер хранит только известные поля, поэтому
                // журнал правок едет внутри result: rec — как прочитано,
                // edits — что поменял монтажник, src — что взято из чертежа.
                result: this._rows.map(r => ({
                    num: r.num, name: r.name, area: r.area, areaSrc: r.areaSrc, floor: r.floor,
                    windows: r.windows, panoramic: r.panoramic, outerWalls: r.outerWalls,
                    heated: r.heated, applied: !!r._sel,
                    ufh: r.eng ? !!r.eng.ufh : undefined, ufhArea: r.eng ? r.eng.ufhArea : undefined,
                    heaters: r.eng ? r.eng.heaters : undefined, fix: r.eng ? r.eng.fix : undefined,
                    src: r.eng && r.eng.src ? r.eng.src : undefined,
                    edits: this.rowEdits(r) || undefined,
                })).concat((this._deleted || []).map(o => ({ name: o.name, area: o.area, deleted: true, rec: o }))),
            };
            const shot = ui._img || (ui._imgs && ui._imgs[0]);
            if (shot) { payload.file = true; payload.fileExt = 'jpg'; payload.fileData = shot; }
            await fetch('https://proxy.heatcalc.ru/recognize_archive.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        } catch (e) {
            console.warn('План не заархивирован:', e.message);
        }
    },
};

/**
 * Правила разбора плана этажа. Каждое правило закрывает конкретную ошибку,
 * которую модель делает на реальных планах: печатных чертежах с экспликацией
 * и эскизах в клетку, где кроме названий и «12 м2» ничего нет.
 */
const FLOOR_PLAN_PROMPT = `Ты разбираешь ПЛАНЫ ЭТАЖЕЙ жилых домов и квартир (Россия): чертежи из проекта, сканы, фотографии и эскизы, нарисованные от руки на бумаге или в клетку. Цель — список помещений этажа для расчёта отопления: название, площадь, этаж, окна, наружные стены.

Верни СТРОГО JSON по схеме. Никакого текста вне JSON. Дробные числа пиши с точкой (13.77), без единиц измерения. Кавычки внутри строк не используй.

СХЕМА:
{
  "docKind": "floor_plan" | "boiler_sketch" | "other",
  "floorLabel": "как подписан этаж на листе (План 1-го этажа, Мансарда, Цокольный этаж) или null",
  "floor": число или null,
  "ceilingH": высота потолка в метрах или null,
  "hasTable": true | false,
  "totalArea": итог экспликации в м² или null,
  "rooms": [{
    "num": "101" или null,
    "name": "Спальня",
    "nameGuessed": false,
    "area": 13.77 или null,
    "areaSrc": "table" | "label" | "dims" | "estimate" | null,
    "w": 3.5 или null,
    "l": 4.0 или null,
    "windows": число или null,
    "panoramic": число,
    "outerWalls": 0 | 1 | 2 | 3 | null,
    "orient": "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" | null,
    "doubleHeight": false,
    "heated": true,
    "floor": число или null,
    "confidence": 0.0-1.0,
    "note": "пояснение, если что-то неясно"
  }],
  "unclear": ["что не удалось прочитать"]
}

ПРАВИЛА:

1. НЕ ПЛАН. Если на изображении не план этажа (список материалов, счёт, фасад, разрез, фотография комнаты) — верни {"docKind":"other","rooms":[]} и больше ничего. Если это схема или эскиз КОТЕЛЬНОЙ — котлы (прямоугольники с подписью «Эл», «Газ» и мощностью), бойлеры (цилиндры со змеевиком), насосы (кружки с треугольником), гидрострелка и трубы между ними, даже если контур котельной обведён как комната, — верни {"docKind":"boiler_sketch","rooms":[]} и больше ничего.

2. ЭТАЖ. Номер этажа бери из подписи листа: «План 1 этажа», «1-й этаж», «Первый этаж» -> 1; «второй», «2 эт.» -> 2; «подвал», «цокольный», «0 этаж» -> 0; «мансарда», «мансардный» -> этаж НАД верхним полным (в доме с одним этажом — 2, с двумя — 3). Номера помещений вида 101–114 означают первый этаж, 201–2xx — второй, 001–0xx — подвал. Имя файла в запросе — тоже подсказка («1 этаж.pdf»). Ничего этого нет -> floor=null, не угадывай.
   Если на ОДНОМ листе нарисовано несколько этажей или отдельным контуром показано помещение другого уровня («Мансарда 8,2 м2» поверх кухни) — у такого помещения проставь своё "floor", у остальных оставь null (возьмётся общий этаж листа).

3. ЭКСПЛИКАЦИЯ ВАЖНЕЕ ЧЕРТЕЖА. Если на листе есть таблица «Экспликация помещений» (№, наименование, площадь) — список помещений и площади бери из неё (areaSrc="table"), а чертёж используй для окон и наружных стен: помещение с номером на плане ищи по тому же номеру в таблице. Число строк таблицы = число помещений. Итог таблицы (например «177,87») верни в totalArea как напечатан. НЕ СКЛАДЫВАЙ площади сам: по итогу проверяется, все ли помещения прочитаны, и посчитанная тобой сумма эту проверку обесценивает. Итога нет -> null.

4. ПЛОЩАДЬ. Подписана в помещении («19,16 м2», «S=12», «12 кв.м») -> area, areaSrc="label". Подписаны только размеры помещения («4х3,5», «4000х3500» в миллиметрах, размерные цепочки вдоль стен) -> area = произведение в метрах, areaSrc="dims", w и l заполни. Есть только общие габариты дома, размеры по осям или сетка клеток — оцени площадь помещения по его доле в плане (или по клеткам, если известен размер клетки), areaSrc="estimate", confidence не выше 0.5. Не по чему оценить -> area=null. Запятая в числе — десятичный разделитель: «13,77» -> 13.77. Не путай площадь с номером помещения и с высотой (H=2700).

5. НАЗВАНИЕ. Пиши как подписано, раскрывая сокращения: «С/у», «сан.узел», «сануз.» -> «Санузел»; «Кух.» -> «Кухня»; «Гост.» -> «Гостиная»; «Спал.», «Сп.» -> «Спальня»; «Дет.» -> «Детская»; «Каб.» -> «Кабинет»; «Гард.» -> «Гардеробная»; «Кор.» -> «Коридор»; «Прих.» -> «Прихожая»; «Кот.» -> «Котельная»; «Терр.» -> «Терраса»; «Кл.», «Клад.» -> «Кладовая». Название с площадью в одной подписи («Спальня 8,2 м2») — в name только слово. Не подписано — предположи по обстановке и поставь nameGuessed=true: ванна или душ -> «Ванная»; унитаз и раковина без ванны -> «Санузел»; кровать -> «Спальня»; плита, мойка, кухонный гарнитур -> «Кухня»; диван, кресла, телевизор -> «Гостиная»; кухонный гарнитур и диван в одном помещении -> «Кухня-гостиная»; письменный стол -> «Кабинет»; автомобиль -> «Гараж»; котёл, бойлер -> «Котельная»; лестница и проходное помещение -> «Холл»; шкафы вдоль стен -> «Гардеробная»; помещение при входе -> «Прихожая». Обстановки нет и понять нельзя -> «Помещение».

6. ОКНА. Считай проёмы с остеклением в НАРУЖНЫХ стенах помещения: на чертеже это разрыв толстой стены с тонкими линиями рамы, на эскизе — двойная линия, разрыв в наружной стене или пометка «окно». Остеклённую дверь на террасу или балкон считай окном. Дверь в соседнее помещение — не окно; вентканалы, ниши и дымоходы — не окна. Угловое или составное окно считай одним. panoramic — сколько из этих окон панорамные: витраж от пола до потолка, окно выше 2 м или шире 2,5 м. Окон не видно и понять нельзя -> windows=null (не 0). Помещение внутри дома без наружных стен -> windows=0.

7. НАРУЖНЫЕ СТЕНЫ. outerWalls — сколько сторон помещения выходят на улицу (0–3). Стена к неотапливаемой террасе, крыльцу, холодной веранде или гаражу — тоже наружная. Не понятно по чертежу -> null.

8. СТОРОНА СВЕТА. orient заполняй ТОЛЬКО если на листе есть стрелка севера или роза ветров: румб, куда смотрит наружная стена помещения (у угловой — средний). Стрелки нет -> null: «верх листа» сам по себе не север.

9. ОТАПЛИВАЕМОСТЬ. heated=false у террас, крылец, балконов, лоджий, открытых веранд, навесов, холодных тамбуров и неотапливаемых чердаков — но в список их включи, решать будет монтажник. Гараж, котельная, кладовая, тамбур внутри тёплого контура — heated=true.

10. ВТОРОЙ СВЕТ. Пометки «второй свет», «2 света», «двусветное» — doubleHeight=true у этого помещения. Это не отдельное помещение.

11. ВЫСОТА ПОТОЛКА. Подпись «H=2700», «h=2,7», «Высота этажа 3,0 м» -> ceilingH в метрах (2.7). Несколько разных (H=2580 и H2=3000) — бери основную, остальное в unclear. Нет подписи -> null.

12. НЕ ВЫДУМЫВАЙ. Не читается — null и пояснение в note или unclear. Не добавляй помещений, которых нет на листе; не дели помещение на части по мебели; лестничную клетку, если она подписана отдельным помещением, включи как «Лестница». Цветные рамки, стрелки, размерные линии, штриховка и подписи поверх плана — пометки, а не стены и не помещения. Один и тот же номер помещения — одно помещение.

13. ПОРЯДОК. Помещения перечисляй в порядке экспликации, а без неё — по номерам, затем слева направо и сверху вниз.

14. ПРИМЕЧАНИЕ (note) — только то, что монтажнику надо проверить: расхождение или опечатка в проекте (два помещения с одним номером, площадь в таблице не совпадает с подписью на плане), площадь или название угаданы, помещение неотапливаемое или спорное. Не описывай помещение: «входная зона», «большое помещение с камином», «с обеденной зоной» — это видно по названию и чертежу, такое примечание только отнимает время. Нечего сказать -> note=null.`;

window.RecognizePlan = RecognizePlan;
