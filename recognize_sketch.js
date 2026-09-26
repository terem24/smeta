/**
 * Распознавание эскиза котельной, нарисованного от руки, — третья
 * специальность вкладки «Распознавание» после сметы и плана этажа.
 *
 * С эскиза берётся только крупное оборудование: котлы (тип и мощность),
 * бойлеры (объём), гидрострелка (расход), насосы, расширительные баки,
 * коллектор. Обвязку по ним калькулятор собирает сам — так же, как при
 * ручном вводе, — поэтому трубы, краны и фитинги с эскиза не читаются.
 *
 * Модель возвращает у каждого прибора его место на снимке (box_2d), и на
 * экране проверки прибор обведён рамкой прямо поверх эскиза: монтажник
 * видит, что именно прочитано, и правит прибор нажатием на рамку.
 *
 * Сюда попадают так же, как в план: модель, разбирая снимок по правилам
 * сметы или плана, отвечает {"docKind":"boiler_sketch"}.
 */

const RecognizeSketch = {

    CACHE_KEY: 'rec_sketch_v1',
    CACHE_MAX: 20,

    KINDS: {
        boiler: 'Котёл',
        tank: 'Бойлер',
        hydro: 'Гидрострелка',
        pump: 'Насос',
        exp_tank: 'Расширительный бак',
        manifold: 'Коллектор',
    },
    FUELS: { el: 'электрический', gas: 'газовый', solid: 'твердотопливный' },

    STAGES: [
        'Готовим изображение',
        'Ищем котлы, бойлеры и насосы',
        'Читаем подписи: мощность, объём, расход',
        'Раскладываем приборы по эскизу',
    ],
    TIPS: [
        () => 'Ищу котлы: прямоугольник с подписью «Эл» или «Газ» и мощностью',
        () => 'Бойлер — цилиндр со змеевиком внутри, рядом объём в литрах',
        () => 'Насос — кружок с треугольником внутри',
        () => 'Гидрострелка — труба между котлами и насосами, рядом расход в м³/ч',
        () => 'Надписи на полях пропускаю: нужны подписи на самих приборах',
    ],

    _items: [],      // приборы на экране проверки, они же правятся
    _notes: [],      // надписи на полях — показываются, в расчёт не идут
    _img: null,      // снимок, по которому считаны рамки
    _sel: -1,        // выбранный прибор
    _draw: false,    // режим «обвести прибор на эскизе»
    _area: null,     // площадь дома, если в расчёте её ещё нет
    _undo: null,     // снимок полей расчёта до применения
    _calls: 0,
    _fromCache: 0,
    _deleted: [],

    reset() {
        this._items = [];
        this._notes = [];
        this._img = null;
        this._sel = -1;
        this._draw = false;
        this._area = null;
        this._calls = 0;
        this._fromCache = 0;
        this._deleted = [];
        this._pv = null;
        this._pvKey = '';
    },

    isSketchResult(parsed) {
        return !!(parsed && typeof parsed === 'object' && parsed.docKind === 'boiler_sketch');
    },

    // ------------------------------------------------------------------
    // Память по снимкам — как у плана: один и тот же эскиз даёт один разбор
    // и не тратит второй запрос из лимита.
    // ------------------------------------------------------------------

    promptVersion() {
        if (this._promptV) return this._promptV;
        const s = String(BOILER_SKETCH_PROMPT);
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
        return (rec && rec.v === this.promptVersion() && rec.data) ? rec.data : null;
    },

    remember(b64, parsed) {
        const key = RecognizeUI.sheetKey(b64);
        if (!key) return;
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
    // Разбор
    // ------------------------------------------------------------------

    num(v) {
        if (v === null || v === undefined || v === '') return null;
        const n = parseFloat(String(v).replace(',', '.').replace(/[^\d.\-]/g, ''));
        return isNaN(n) || n <= 0 ? null : n;
    },

    /** box_2d модели — [ymin, xmin, ymax, xmax] в тысячных долях снимка. */
    toBox(b) {
        if (!Array.isArray(b) || b.length !== 4) return null;
        let [y0, x0, y1, x1] = b.map(v => Math.max(0, Math.min(1000, +v || 0)) / 1000);
        if (x1 < x0) [x0, x1] = [x1, x0];
        if (y1 < y0) [y0, y1] = [y1, y0];
        if (x1 - x0 < 0.005 || y1 - y0 < 0.005) return null;
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    },

    normalize(parsed) {
        const items = (Array.isArray(parsed.items) ? parsed.items : []).map(r => {
            r = r || {};
            const kind = this.KINDS[r.kind] ? r.kind : '';
            const fuel = /^(el|gas|solid)$/.test(String(r.fuel || '')) ? r.fuel : null;
            const conf = +r.confidence;
            const it = {
                kind,
                fuel: kind === 'boiler' ? fuel : null,
                power: kind === 'boiler' ? this.num(r.power) : null,
                vol: (kind === 'tank' || kind === 'exp_tank') ? this.num(r.vol) : null,
                flow: kind === 'hydro' ? this.num(r.flow) : null,
                outputs: kind === 'manifold' ? (Math.round(this.num(r.outputs)) || null) : null,
                label: r.label ? String(r.label).trim() : '',
                note: r.note ? String(r.note).trim() : '',
                box: this.toBox(r.box_2d),
                confidence: isNaN(conf) ? 0.5 : conf,
                edited: false,
            };
            it._orig = this.snap(it);
            return it;
        }).filter(it => it.kind);
        // Сверху вниз, слева направо — в том же порядке, в каком смотрит глаз.
        items.sort((a, b) => ((a.box ? a.box.y : 1) - (b.box ? b.box.y : 1)) || ((a.box ? a.box.x : 1) - (b.box ? b.box.x : 1)));
        const notes = (Array.isArray(parsed.notes) ? parsed.notes : []).map(s => String(s || '').trim()).filter(Boolean);
        return { items, notes };
    },

    snap(it) {
        return { kind: it.kind, fuel: it.fuel, power: it.power, vol: it.vol, flow: it.flow, outputs: it.outputs };
    },

    edits(it) {
        if (!it._orig) return null;
        const o = it._orig, d = {};
        ['kind', 'fuel', 'power', 'vol', 'flow', 'outputs'].forEach(k => {
            if ((o[k] ?? null) !== (it[k] ?? null)) d[k] = { was: o[k] ?? null, now: it[k] ?? null };
        });
        return Object.keys(d).length ? d : null;
    },

    /** Один снимок — один запрос. Бросает ошибку с notSketch, если модель схемы не увидела. */
    async run(img) {
        const ui = RecognizeUI;
        this.reset();
        this._img = img;
        let parsed = this.cached(img);
        if (parsed) {
            this._fromCache = 1;
        } else {
            ui.setStatus('Читаю эскиз котельной…');
            const before = ui._apiCalls || 0;
            const data = await ui.askModel([
                { text: 'Разбери этот эскиз котельной по правилам. Верни только JSON.' },
                { inline_data: { mime_type: 'image/jpeg', data: img } },
            ], BOILER_SKETCH_PROMPT);
            this._calls += (ui._apiCalls || 0) - before;
            const cand = data?.candidates?.[0];
            const text = cand?.content?.parts?.[0]?.text;
            if (!text) throw new Error('Разбор эскиза вернулся пустым. Попробуйте ещё раз.');
            parsed = ui.parseModelJson(text, cand.finishReason);
            if (!ui._parseWarning && this.isSketchResult(parsed)) this.remember(img, parsed);
        }
        if (!this.isSketchResult(parsed)) {
            const err = new Error('На снимке не нашлось схемы котельной.');
            err.notSketch = true;
            throw err;
        }
        const n = this.normalize(parsed);
        this._items = n.items;
        this._notes = n.notes;
        if (!this._items.length) {
            throw new Error('На эскизе не нашлось ни котла, ни бойлера, ни насосов. ' +
                'Сфотографируйте лист целиком и поровнее — или отметьте приборы на эскизе вручную.');
        }
    },

    startReview() {
        RecognizeUI.progressStop();
        RecognizeUI.setStatus('');
        RecognizeUI.step(2);
        RecognizeUI.setHead('sketch');
        const st = app.state || {};
        if (!(st.area > 0) && !(this._area > 0)) this._area = this.areaGuess();
        this.renderReview();
    },

    // ------------------------------------------------------------------
    // Экран проверки
    // ------------------------------------------------------------------

    /**
     * Памятка «как рисовать» — те же условные знаки, что читает модель
     * (BOILER_SKETCH_PROMPT). Свёрнута по умолчанию: мешать не должна, а
     * открыть её нужно один раз перед следующим эскизом, не при каждом.
     */
    howToHtml() {
        const rows = [
            ['▭', 'Котёл', 'прямоугольник, внутри подпись «Эл» или «Газ» и мощность в кВт: «Эл 12».'],
            ['⚙', 'Бойлер', 'цилиндр или овал со змеевиком (спираль, петли) внутри, рядом объём в литрах: «200 л».'],
            ['◎', 'Насос', 'кружок с треугольником внутри. Каждый насос — свой кружок, даже если стоят в ряд.'],
            ['▬', 'Гидрострелка', 'толстая труба между котлами и насосами, рядом расход в м³/ч.'],
            ['○', 'Расширительный бак', 'кружок без треугольника и без змеевика, рядом объём в литрах.'],
        ];
        return `<details class="rs-howto">
            <summary>📐 Как рисовать эскиз, чтобы распознавание работало лучше</summary>
            <div class="rs-howto-body">
              ${rows.map(([ico, name, text]) => `<div class="rs-howto-row"><span class="rs-howto-ico">${ico}</span><div><b>${this.esc(name)}</b> — ${this.esc(text)}</div></div>`).join('')}
              <div class="rs-howto-row"><span class="rs-howto-ico">✎</span><div>Число подписывайте прямо у прибора, а не сбоку списком — надписи на полях в расчёт не попадают.</div></div>
            </div>
          </details>`;
    },

    esc(s) {
        return String(s ?? '').replace(/[&<>"]/g,
            c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    },

    fmt(n) {
        return (Math.round(n * 10) / 10).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
    },

    /** Подпись прибора: «Электрокотёл 12 кВт», «Бойлер 200 л». */
    title(it) {
        switch (it.kind) {
            case 'boiler': {
                const t = it.fuel === 'el' ? 'Электрокотёл' : it.fuel === 'gas' ? 'Газовый котёл'
                    : it.fuel === 'solid' ? 'Твердотопливный котёл' : 'Котёл';
                return t + (it.power ? ` ${this.fmt(it.power)} кВт` : '');
            }
            case 'tank': return 'Бойлер' + (it.vol ? ` ${this.fmt(it.vol)} л` : '');
            case 'hydro': return 'Гидрострелка' + (it.flow ? ` ${this.fmt(it.flow)} м³/ч` : '');
            case 'exp_tank': return 'Расширительный бак' + (it.vol ? ` ${this.fmt(it.vol)} л` : '');
            case 'manifold': return 'Коллектор' + (it.outputs ? ` на ${it.outputs}` : '');
            case 'pump': return 'Насос';
            default: return 'Что это?';
        }
    },

    /** Чего не хватает прибору, чтобы попасть в расчёт. Пусто — всё есть. */
    missing(it) {
        if (!it.kind) return 'выберите, что это за прибор';
        if (it.kind === 'boiler') {
            if (!it.fuel) return 'укажите тип котла';
            if (!it.power) return 'впишите мощность';
        }
        if (it.kind === 'tank' && !it.vol) return 'впишите объём';
        return '';
    },

    /** Зелёная рамка — прочитано уверенно или подтверждено руками, янтарная — проверить. */
    isSure(it) {
        return !this.missing(it) && (it.edited || it.confidence >= 0.7);
    },

    /**
     * Площадь дома, когда в расчёте её нет: без площади калькулятор котёл не
     * подбирает вовсе (см. render, «Без заданной площади…»). Оценка — обратным
     * счётом: при какой площади теплопотери калькулятора (с его запасом котла)
     * дают нарисованную мощность. По грубым 100 Вт/м² газовый 24 кВт давал
     * площадь, на которую калькулятор ставил уже два котла.
     * Мощность котельной — как в подборе труб: однотипные котлы складываются
     * (каскад), газовый и электрический друг друга дублируют — берётся газ.
     */
    areaGuess() {
        const sum = (fuel) => this._items.filter(it => it.kind === 'boiler' && it.fuel === fuel && it.power)
            .reduce((a, it) => a + it.power, 0);
        const gas = sum('gas'), el = sum('el');
        const kw = gas || el;
        const maxA = (typeof app !== 'undefined' && app.MAX_AREA) || 360;
        if (!kw) return null;
        let perM2 = 0.1;
        try {
            const st = app.state, was = st.area;
            st.area = 100;
            const q = +app.getHouseHeatLoss() || 0;
            st.area = was;
            if (q > 0) perM2 = q / 100;
        } catch (e) { /* оценка по 100 Вт/м² */ }
        const k = gas ? (app.BOILER_RESERVE_K || 1.15) : 1;
        // Вниз, а не до ближайшего: 208,7 м² → 210 давали 24,15 кВт с запасом,
        // и котёл 24 кВт превращался в каскад из двух.
        const a = kw / k / perM2;
        return Math.max(20, Math.min(maxA, Math.floor(a / 5) * 5));
    },

    renderReview() {
        const body = document.getElementById('rec_body');
        if (!body) return;
        const esc = (s) => this.esc(s);
        const st = app.state || {};
        const needArea = !(st.area > 0);

        const boxes = this._items.map((it, i) => {
            if (!it.box) return '';
            const b = it.box;
            const cls = ['rs-box', this.isSure(it) ? 'ok' : 'warn', i === this._sel ? 'sel' : ''].join(' ');
            // Подпись над рамкой, а у верхнего края листа — под ней: иначе она
            // уходит за край снимка.
            const below = b.y < 0.06 ? ' below' : '';
            return `<div class="${cls}" style="left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%"
                        onclick="event.stopPropagation();RecognizeSketch.pick(${i})">
                      <span class="rs-tag${below}">${esc(this.title(it))}</span></div>`;
        }).join('');

        const counts = {};
        this._items.forEach(it => { counts[it.kind] = (counts[it.kind] || 0) + 1; });
        const bad = this._items.filter(it => this.missing(it)).length;
        const unsure = this._items.filter(it => !this.isSure(it)).length;

        const sumLine = Object.keys(this.KINDS).filter(k => counts[k])
            .map(k => `${this.KINDS[k].toLowerCase()}${counts[k] > 1 ? ' ×' + counts[k] : ''}`).join(', ');

        const cards = this._items.map((it, i) => this.cardHtml(it, i)).join('');

        const areaHtml = needArea ? `
            <div class="rs-area">
              <label>Площадь дома, м²
                <input class="rec-f rec-f-s" type="number" min="10" step="1" value="${this._area || ''}"
                       onchange="RecognizeSketch.setArea(this.value)"></label>
              <div class="rec-tcheck-sub">В расчёте площадь не задана, а без неё котёл не подбирается.
                ${this._area ? 'Подставлена оценка: при такой площади расчёт калькулятора даёт мощность котла с эскиза. Поправьте, если знаете точную.' : 'Впишите площадь.'}</div>
            </div>` : '';

        const canApply = this._items.some(it => ['boiler', 'tank', 'hydro'].includes(it.kind) && !this.missing(it))
            && (!needArea || this._area > 0) && !bad;

        // Справа — схема обвязки из пробного расчёта. Без котла и площади
        // калькулятор котёл не подбирает, и схемы у пробной сметы нет.
        const hasBoiler = this._items.some(it => it.kind === 'boiler' && !this.missing(it));
        const pv = (hasBoiler && (!needArea || this._area > 0)) ? this.preview()
            : { svg: '', notes: [], bill: [], err: hasBoiler ? 'Впишите площадь дома — без неё котёл не подбирается.' : 'Укажите у котла тип и мощность — тогда здесь появится схема обвязки.' };
        const font = (window.projectSheets && window.projectSheets.FONT) || "'ISOCPEUR','GOST type A','Arial Narrow',sans-serif";
        const schemeHtml = pv.svg
            ? `<svg xmlns="http://www.w3.org/2000/svg" class="sheet-a3 rs-scheme-svg" viewBox="0 0 420 297">
                 <style>.sheet-a3 text{fill:#000;stroke:none}.sheet-a3 line,.sheet-a3 rect{stroke:#000;fill:none}</style>
                 <rect x="0" y="0" width="420" height="297" style="fill:#fff;stroke:none"/>
                 <g stroke-linecap="square" font-family="${font}" font-size="3.67">${pv.svg}</g>
                 <g id="rs_marks"></g>
               </svg>`
            : `<div class="rs-scheme-empty">${esc(pv.err)}</div>`;
        const billHtml = pv.bill.length ? `<div class="rs-bill"><b>В смету встанет:</b> ${
            pv.bill.map(b => esc((b.q > 1 ? b.q + ' × ' : '') + b.name)).join(' · ')}</div>` : '';
        const pvNotes = pv.notes.length ? `<div class="rs-pv-notes">${pv.notes.map(t => `<div>⚠ ${esc(t)}</div>`).join('')}</div>` : '';

        body.innerHTML = `
          <div class="rec-tcheck ${bad ? 'warn' : 'ok'}" style="display:block">
            <div style="display:flex;gap:10px;align-items:center">
              <div class="rec-tcheck-ico">${bad ? '!' : '✓'}</div>
              <div style="font-weight:600">На эскизе: ${esc(sumLine || 'ничего')}</div>
            </div>
            <div class="rec-tcheck-sub" style="margin-top:4px">${bad
                ? `У ${bad} ${RecognizeUI.plural(bad, 'прибора', 'приборов', 'приборов')} не хватает данных — они отмечены на эскизе янтарным. Нажмите на рамку и допишите.`
                : unsure
                    ? `Янтарным — прочитано неуверенно (${unsure}), проверьте. Нажмите на рамку, чтобы поправить.`
                    : 'Нажмите на рамку, чтобы поправить прибор. Обвязку по этим приборам калькулятор соберёт сам.'}</div>
          </div>
          ${this.howToHtml()}
          <div class="rs-wrap">
            <div class="rs-left">
              <div class="rs-col-h">Эскиз</div>
              <div class="rs-toolbar">
                <button class="rec-btn-g ${this._draw ? 'rec-btn-accent' : ''}" onclick="RecognizeSketch.toggleDraw()"
                        title="Прибор не нашёлся — обведите его на эскизе">${this._draw ? '✕ Отменить' : '➕ Отметить прибор'}</button>
                ${this._draw ? '<span class="rec-tcheck-sub">Обведите прибор на эскизе — протяните рамку</span>' : ''}
              </div>
              <div class="rs-stage${this._draw ? ' drawing' : ''}" id="rs_stage" onclick="RecognizeSketch.pick(-1)">
                <img src="data:image/jpeg;base64,${this._img}" alt="эскиз котельной" draggable="false">
                ${boxes}
                <div class="rs-box rs-ghost" id="rs_ghost" style="display:none"></div>
              </div>
            </div>
            <div class="rs-right">
              <div class="rs-col-h">Как соберёт калькулятор</div>
              <div class="rs-scheme" id="rs_scheme">${schemeHtml}</div>
              ${billHtml}
              ${pvNotes}
            </div>
          </div>
          <div class="rs-bottom">
            <div class="rs-cards">${cards}</div>
            <div class="rs-side">
              ${areaHtml}
              ${this._notes.length ? `<details class="rs-notes"><summary>Надписи на полях — в расчёт не идут (${this._notes.length})</summary>
                  ${this._notes.map(t => `<div>${esc(t)}</div>`).join('')}</details>` : ''}
            </div>
          </div>
          <div class="rec-foot">
            <div class="rec-total">Приборов: <b>${this._items.length}</b></div>
            <button class="rec-btn-g" onclick="RecognizeUI.resetAll()">↩ Другой файл</button>
            <button class="calc-dialog-btn calc-dialog-btn-confirm" ${canApply ? '' : 'disabled'}
                    onclick="RecognizeSketch.apply()">В расчёт</button>
          </div>`;

        this.bindDraw();
        this.linkScheme();
        this.mountVoice();
    },

    // ------------------------------------------------------------------
    // Голос и текст в карточке прибора — те же правила разбора, что у
    // «Умного заполнения» (regex по ключевым словам и числам, без модели):
    // фраза уже сказана человеком вслух, второй раз спрашивать модель не за чем.
    // ------------------------------------------------------------------

    KIND_WORDS: [
        ['tank', /бойлер|водонагреват/i],
        ['hydro', /гидрострелк|гидравлическ\S*\s+раздел/i],
        ['exp_tank', /расширительн\S*\s+бак/i],
        ['manifold', /коллектор|гребёнк|гребенк/i],
        ['boiler', /кот[её]л/i],
        ['pump', /насос/i],
    ],

    /** Свободная фраза о приборе → {kind?, fuel?, power?, vol?, flow?, outputs?}. */
    parseVoiceText(text) {
        const raw = ' ' + String(text || '').toLowerCase().replace(/ё/g, 'е') + ' ';
        // Числительные словами ("двести литров") — как в parseHouseQuery.
        const t = (typeof app !== 'undefined' && app._numeralsToDigits) ? app._numeralsToDigits(raw) : raw;
        const res = {};
        for (const [kind, re] of this.KIND_WORDS) { if (re.test(t)) { res.kind = kind; break; } }
        if (/электр|(?<![а-я])эл(?![а-я])/i.test(t)) res.fuel = 'el';
        else if (/газов|(?<![а-я])газ(?![а-я])/i.test(t)) res.fuel = 'gas';
        else if (/твердотопливн|дров[а-я]*|(?<![а-я])тт(?![а-я])/i.test(t)) res.fuel = 'solid';
        const num = (re) => { const m = t.match(re); return m ? parseFloat(m[1].replace(',', '.')) : null; };
        let v = num(/(\d+(?:[.,]\d+)?)\s*(?:квт|киловатт)/); if (v != null) res.power = v;
        v = num(/(\d+(?:[.,]\d+)?)\s*(?:л|литр[а-я]*)(?![а-я])/); if (v != null) res.vol = v;
        v = num(/(\d+(?:[.,]\d+)?)\s*(?:м3|м³|куб[а-я]*)/); if (v != null) res.flow = v;
        v = num(/(\d+)\s*(?:выход[а-я]*|контур[а-я]*)/); if (v != null) res.outputs = Math.round(v);
        return res;
    },

    /**
     * Разобранная фраза ложится в прибор одним разом — не через set() по полю:
     * тот перерисовывает экран (и пересчитывает пробную схему) на КАЖДЫЙ вызов,
     * а из одной фразы полей выходит сразу несколько.
     */
    applyVoiceText(i, text) {
        const it = this._items[i];
        if (!it || !String(text || '').trim()) return;
        const r = this.parseVoiceText(text);
        if (!Object.keys(r).length) {
            const mount = document.querySelector(`.rs-voice-mount[data-i="${i}"]`);
            if (mount) {
                const note = document.createElement('div');
                note.className = 'rec-tcheck-sub';
                note.textContent = 'Не разобрал — назовите прибор, тип и число с единицей: «электрический 12 квт».';
                mount.parentElement.appendChild(note);
                setTimeout(() => note.remove(), 4000);
            }
            return;
        }
        if (r.kind && r.kind !== it.kind) {
            it.kind = r.kind;
            if (it.kind !== 'boiler') { it.fuel = null; it.power = null; }
            if (it.kind !== 'tank' && it.kind !== 'exp_tank') it.vol = null;
            if (it.kind !== 'hydro') it.flow = null;
            if (it.kind !== 'manifold') it.outputs = null;
        }
        if (r.fuel && it.kind === 'boiler') it.fuel = r.fuel;
        if (r.power != null && it.kind === 'boiler') it.power = r.power;
        if (r.vol != null && (it.kind === 'tank' || it.kind === 'exp_tank')) it.vol = r.vol;
        if (r.flow != null && it.kind === 'hydro') it.flow = r.flow;
        if (r.outputs != null && it.kind === 'manifold') it.outputs = r.outputs;
        it.edited = true;
        if (r.power != null && !(app.state.area > 0)) this._area = this.areaGuess() || this._area;
        this.renderReview();
    },

    /** Кнопка микрофона в открытой карточке — тот же переиспользуемый компонент, что у «Умного заполнения». */
    mountVoice() {
        const mount = document.querySelector('.rs-voice-mount');
        if (!mount || typeof app === 'undefined' || !app._createVoiceMicButton) return;
        const i = +mount.dataset.i;
        const mic = app._createVoiceMicButton((text) => this.applyVoiceText(i, text));
        if (!mic) return;
        mount.appendChild(mic.micBtn);
        mount.appendChild(mic.micStatus);
    },

    // ------------------------------------------------------------------
    // Связь эскиза со схемой: k-й котёл эскиза — k-й котёл схемы (слева
    // направо), так же бойлер, гидрострелка, насосы, баки. Все связанные
    // приборы схемы обведены тонко, выбранный — ярко; нажатие на прибор схемы
    // открывает его карточку.
    // ------------------------------------------------------------------

    SYM_OF: { boiler: 'boiler', tank: 'tank', hydro: 'hydro', pump: 'pump', exp_tank: 'exptank' },

    /** Приборы схемы одного вида — без таблицы условных обозначений и вложенных символов. */
    schemeSyms(svg, type) {
        return [...svg.querySelectorAll(`g[data-sym="${type}"]`)]
            .filter(g => !(g.parentElement && g.parentElement.closest('g[data-sym]')))
            .map(g => { let b = null; try { b = g.getBBox(); } catch (e) { b = null; } return { g, b }; })
            // Таблица УГО занимает левый край листа, до 128 мм.
            .filter(s => s.b && s.b.width > 0 && s.b.x >= 128)
            .sort((a, b) => (a.b.x - b.b.x) || (a.b.y - b.b.y));
    },

    linkScheme() {
        const svg = document.querySelector('#rs_scheme svg');
        const marks = svg && svg.querySelector('#rs_marks');
        if (!svg || !marks) return;
        const byType = {};
        const seen = {};
        let html = '';
        this._items.forEach((it, i) => {
            const type = this.SYM_OF[it.kind];
            if (!type) return;
            const list = byType[type] || (byType[type] = this.schemeSyms(svg, type));
            const k = seen[type] = (seen[type] || 0) + 1;
            const s = list[k - 1];
            if (!s) return;
            s.g.style.cursor = 'pointer';
            s.g.onclick = (e) => { e.stopPropagation(); this.pick(i); };
            const pad = 1.5, sel = i === this._sel;
            html += `<rect x="${s.b.x - pad}" y="${s.b.y - pad}" width="${s.b.width + pad * 2}" height="${s.b.height + pad * 2}" rx="1"
                style="fill:${sel ? 'rgba(2,132,199,.14)' : 'none'};stroke:${sel ? '#0284c7' : (this.isSure(it) ? '#16a34a' : '#f59e0b')};stroke-width:${sel ? 0.9 : 0.4};${sel ? '' : 'stroke-dasharray:1.5 1;'}pointer-events:none"/>`;
        });
        marks.innerHTML = html;
        // Выбранный прибор, которого на схеме нет, — сказать об этом в карточке.
        const it = this._items[this._sel];
        const hint = document.querySelector('.rs-card.open .rs-onscheme');
        if (it && hint) {
            const type = this.SYM_OF[it.kind];
            const k = this._items.slice(0, this._sel + 1).filter(x => x.kind === it.kind).length;
            const has = type && byType[type] && byType[type][k - 1];
            hint.textContent = has ? 'На схеме справа — обведён синим.' : 'На схеме справа этого прибора нет.';
        }
    },

    cardHtml(it, i) {
        const esc = (s) => this.esc(s);
        const open = i === this._sel;
        const miss = this.missing(it);
        const head = `<div class="rs-card-head" onclick="RecognizeSketch.pick(${open ? -1 : i})">
            <span class="rs-dot ${this.isSure(it) ? 'ok' : 'warn'}"></span>
            <b>${esc(this.title(it))}</b>
            ${it.label ? `<span class="rec-art">«${esc(it.label)}»</span>` : ''}
            ${miss ? `<span class="rs-miss">${esc(miss)}</span>` : ''}
          </div>`;
        if (!open) return `<div class="rs-card">${head}</div>`;

        const opt = (v, t, cur) => `<option value="${v}" ${String(cur ?? '') === String(v) ? 'selected' : ''}>${t}</option>`;
        const numIn = (field, val, unit, step) => `<label>${unit}
            <input class="rec-f rec-f-s" type="number" min="0" step="${step || 1}" value="${val ?? ''}"
                   onchange="RecognizeSketch.set(${i}, '${field}', this.value)"></label>`;
        let fields = '';
        if (it.kind === 'boiler') {
            fields = `<label>Тип
                <select class="rec-f" onchange="RecognizeSketch.set(${i}, 'fuel', this.value)">
                  ${opt('', '— выберите —', it.fuel)}${opt('el', 'электрический', it.fuel)}${opt('gas', 'газовый', it.fuel)}${opt('solid', 'твердотопливный', it.fuel)}
                </select></label>${numIn('power', it.power, 'Мощность, кВт', 0.5)}`;
        } else if (it.kind === 'tank') {
            fields = numIn('vol', it.vol, 'Объём, л', 10);
        } else if (it.kind === 'hydro') {
            fields = numIn('flow', it.flow, 'Расход, м³/ч', 0.1);
        } else if (it.kind === 'exp_tank') {
            fields = numIn('vol', it.vol, 'Объём, л', 1);
        } else if (it.kind === 'manifold') {
            fields = numIn('outputs', it.outputs, 'Выходов', 1);
        }
        return `<div class="rs-card open">${head}
            <div class="rs-card-body">
              <label>Прибор
                <select class="rec-f" onchange="RecognizeSketch.set(${i}, 'kind', this.value)">
                  ${it.kind ? '' : opt('', '— выберите —', '')}
                  ${Object.keys(this.KINDS).map(k => opt(k, this.KINDS[k], it.kind)).join('')}
                </select></label>
              ${fields}
              ${it.note ? `<div class="rec-tcheck-sub">${esc(it.note)}</div>` : ''}
              ${this.SYM_OF[it.kind] ? '<div class="rec-tcheck-sub rs-onscheme"></div>' : ''}
              <div class="rs-voice">
                <input class="rec-f rs-voice-input" type="text" placeholder="Или скажите/напишите: «газовый 24 квт», «бойлер 200 литров»"
                       onkeydown="if(event.key==='Enter'){event.preventDefault();RecognizeSketch.applyVoiceText(${i}, this.value); this.value='';}">
                <span class="rs-voice-mount" data-i="${i}"></span>
              </div>
              <div class="rs-card-acts">
                <button class="rec-btn-g" onclick="RecognizeSketch.del(${i})">✕ Убрать прибор</button>
              </div>
            </div></div>`;
    },

    pick(i) {
        if (this._drawJustEnded) { this._drawJustEnded = false; return; }
        if (this._draw) return;
        this._sel = (i >= 0 && i < this._items.length) ? i : -1;
        this.renderReview();
        const card = document.querySelector('.rs-card.open');
        if (card) try { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
    },

    set(i, field, val) {
        const it = this._items[i];
        if (!it) return;
        if (field === 'kind') {
            it.kind = this.KINDS[val] ? val : '';
            if (it.kind !== 'boiler') { it.fuel = null; it.power = null; }
            if (it.kind !== 'tank' && it.kind !== 'exp_tank') it.vol = null;
            if (it.kind !== 'hydro') it.flow = null;
            if (it.kind !== 'manifold') it.outputs = null;
        } else if (field === 'fuel') {
            it.fuel = /^(el|gas|solid)$/.test(val) ? val : null;
        } else if (field === 'outputs') {
            it.outputs = Math.round(this.num(val)) || null;
        } else {
            it[field] = this.num(val);
        }
        it.edited = true;
        if (field === 'power' && !(app.state.area > 0)) this._area = this.areaGuess() || this._area;
        this.renderReview();
    },

    setArea(v) {
        const n = this.num(v);
        const maxA = (typeof app !== 'undefined' && app.MAX_AREA) || 360;
        this._area = n ? Math.min(maxA, Math.round(n)) : null;
        this.renderReview();
    },

    del(i) {
        const it = this._items[i];
        if (!it) return;
        if (it._orig && !it._hand) this._deleted.push(Object.assign({ label: it.label }, it._orig));
        this._items.splice(i, 1);
        this._sel = -1;
        this.renderReview();
    },

    // ------------------------------------------------------------------
    // Отметить прибор, которого модель не нашла: рамка протягивается по эскизу.
    // ------------------------------------------------------------------

    toggleDraw() {
        this._draw = !this._draw;
        this._sel = -1;
        this.renderReview();
    },

    bindDraw() {
        const stage = document.getElementById('rs_stage');
        const ghost = document.getElementById('rs_ghost');
        if (!stage || !ghost || !this._draw) return;
        let start = null;
        const at = (e) => {
            const r = stage.getBoundingClientRect();
            return {
                x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
                y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
            };
        };
        const boxOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
        const show = (b) => {
            ghost.style.display = '';
            ghost.style.left = b.x * 100 + '%'; ghost.style.top = b.y * 100 + '%';
            ghost.style.width = b.w * 100 + '%'; ghost.style.height = b.h * 100 + '%';
        };
        stage.onpointerdown = (e) => {
            e.preventDefault();
            start = at(e);
            try { stage.setPointerCapture(e.pointerId); } catch (_) {}
            show({ x: start.x, y: start.y, w: 0, h: 0 });
        };
        stage.onpointermove = (e) => { if (start) show(boxOf(start, at(e))); };
        stage.onpointerup = (e) => {
            if (!start) return;
            const b = boxOf(start, at(e));
            start = null;
            ghost.style.display = 'none';
            // Случайное касание — не рамка.
            if (b.w < 0.02 || b.h < 0.02) return;
            const it = { kind: '', fuel: null, power: null, vol: null, flow: null, outputs: null,
                label: '', note: '', box: b, confidence: 1, edited: true, _hand: true };
            this._items.push(it);
            this._draw = false;
            this._drawJustEnded = true;
            this._sel = this._items.length - 1;
            this.renderReview();
            setTimeout(() => { this._drawJustEnded = false; }, 0);
        };
    },

    // ------------------------------------------------------------------
    // Перенос в расчёт
    // ------------------------------------------------------------------

    /** Бойлер каталога по объёму: наименьший не меньше нарисованного, иначе самый большой. */
    tankFor(vol) {
        const pools = [['optibase', catalog.tanks_optibase || []], ['standard', catalog.tanks_standard || []]];
        let best = null;
        pools.forEach(([type, list]) => list.forEach(t => {
            if (!(t.vol > 0)) return;
            const c = { type, vol: t.vol };
            if (t.vol >= vol) { if (!best || !best.fits || t.vol < best.vol) best = Object.assign(c, { fits: true }); }
            else if (!best || (!best.fits && t.vol > best.vol)) best = Object.assign(c, { fits: false });
        }));
        return best;
    },

    /** Газовый котёл автоподбора по мощности: при бойлере — одноконтурный. */
    gasFor(power, withTank) {
        const list = (catalog.boilers_gas || []).slice().sort((a, b) => a.power - b.power);
        const want = withTank ? 1 : 2;
        return list.find(b => b.power >= power && b.circuits === want)
            || list.find(b => b.power >= power)
            || list[list.length - 1] || null;
    },

    /** Насосных групп в смете — для сверки с насосами на эскизе. */
    billPumpGroups() {
        return (app.currentEquipmentList || [])
            .filter(i => !i.isOpt && /(насосн\S*\s+групп|групп\S*\s+насосн)/i.test(String(i.name || '')) && !/коллектор/i.test(String(i.name || '')))
            .reduce((a, i) => a + Math.max(1, Math.round(+i.q) || 1), 0);
    },

    /**
     * Приборы эскиза → поля расчёта. Одна функция и для пробного прогона
     * (схема справа от эскиза), и для настоящего переноса: иначе схема
     * показала бы не то, что уедет в смету.
     * Возвращает { out, notes, el, hydro, pumps } — что перенесено и о чём
     * сказать ещё до пересчёта.
     */
    toState(st) {
        const items = this._items.filter(it => !this.missing(it));
        const boilers = items.filter(it => it.kind === 'boiler');
        const tanks = items.filter(it => it.kind === 'tank');
        const hydro = items.find(it => it.kind === 'hydro') || null;
        const pumps = items.filter(it => it.kind === 'pump').length;
        const out = [], notes = [];

        if (!(st.area > 0) && this._area > 0) {
            st.area = this._area;
            out.push(`Площадь дома: ${this._area} м² — оценка, поправьте в расчёте`);
        }

        // Котлы. Твердотопливных калькулятор не подбирает — о них только плашка.
        const el = boilers.filter(b => b.fuel === 'el');
        const gas = boilers.filter(b => b.fuel === 'gas');
        const solid = boilers.filter(b => b.fuel === 'solid');
        const fuels = [];
        if (gas.length) fuels.push('gas');
        if (el.length) fuels.push('el');
        if (fuels.length) st.fuels = fuels;

        // Один электрокотёл — ровно той мощности, что на эскизе: ручной
        // типоразмер подбор не переигрывает. Два и больше — каскад, его
        // калькулятор собирает сам по теплопотерям, ручной мощности у каскада нет.
        if (el.length === 1) {
            st.elBoilerPower = el[0].power;
            out.push(`Электрокотёл ${this.fmt(el[0].power)} кВт`);
        } else if (el.length > 1) {
            st.elBoilerPower = null;
            out.push(`Электрокотлов: ${el.length}`);
        } else if (fuels.length) {
            st.elBoilerPower = null;
        }
        if (gas.length) {
            const g = this.gasFor(Math.max.apply(null, gas.map(b => b.power)), tanks.length > 0);
            st.swaps = st.swaps || {};
            if (g) st.swaps['gas_boiler_auto'] = g.id;
            out.push(`Газовый котёл ${this.fmt(gas[0].power)} кВт` + (gas.length > 1 ? ` ×${gas.length}` : ''));
            if (g && g.power !== gas[0].power) notes.push(`Газового котла ${this.fmt(gas[0].power)} кВт в линейке нет — взят ближайший: ${g.name}.`);
        } else if (fuels.length && st.swaps) {
            delete st.swaps['gas_boiler_auto'];
        }
        if (solid.length) notes.push('Твердотопливный котёл калькулятор не подбирает — добавьте его в смету вручную.');

        // Бойлер: ГВС включается, объём — ближайший в каталоге не меньше нарисованного.
        if (tanks.length) {
            const vol = Math.max.apply(null, tanks.map(t => t.vol));
            const t = this.tankFor(vol);
            st.hotWater = true;
            if (!st.res) st.res = 3;
            st.tankMount = 'floor';
            st.tankHeat = 'cos';
            if (t) { st.boilerType = t.type; st.tankVol = t.vol; }
            out.push(`Бойлер ${t ? t.vol : this.fmt(vol)} л`);
            if (t && !t.fits) notes.push(`Бойлера на ${this.fmt(vol)} л в каталоге нет — взят самый большой, ${t.vol} л.`);
            if (tanks.length > 1) notes.push(`На эскизе ${tanks.length} бойлера — калькулятор ставит один; второй добавьте в смету вручную.`);
        }

        if (hydro) {
            st.boilerScheme = 'hydro';
            out.push('Схема с гидрострелкой' + (hydro.flow ? ` (на эскизе ${this.fmt(hydro.flow)} м³/ч)` : ''));
        }

        // Насосы и гидрострелка на эскизе — это контуры отопления. Калькулятор
        // ставит группы и стрелку только под потребителей, и в пустом расчёте
        // без системы отопления их бы не было вовсе. Радиаторы — самый частый
        // случай; монтажник переключит в левой панели, если у него тёплый пол.
        if ((pumps || hydro) && !(st.systems || []).length) {
            st.systems = ['rad'];
            out.push('Отопление: радиаторы — тип отопления в расчёте не был задан, поправьте в левой панели');
        }

        return { out, notes, el, hydro, pumps };
    },

    /** Что сказать после пересчёта — по тому, что реально встало в смету. */
    billNotes(r) {
        const notes = [];
        const list = (app.currentEquipmentList || []).filter(i => !i.isOpt);
        // Каскад электрокотлов калькулятор собирает сам по теплопотерям — ручной
        // мощности у каскада нет, поэтому говорим, что именно встало в смету.
        if (r.el.length > 1) {
            const got = list.filter(i => /котёл электрическ|котел электрическ/i.test(String(i.name || '')))
                .map(i => (Math.round(+i.q) > 1 ? Math.round(+i.q) + ' × ' : '') + i.name);
            notes.push(`На эскизе ${r.el.length} электрокотла (${r.el.map(b => this.fmt(b.power) + ' кВт').join(' + ')}), ` +
                `калькулятор по теплопотерям поставил: ${got.join(', ') || 'ничего'}. Если нужны именно такие котлы — замените в смете.`);
        }
        if (r.hydro && !list.some(i => /гидрострел|гидравлическ\S*\s+(стрелк|раздел)/i.test(String(i.name || '')))) {
            notes.push('Гидрострелка встанет в смету, когда в расчёте будут системы отопления — радиаторы или тёплый пол (левая панель, «Тип отопления»).');
        }
        if (r.pumps) {
            const groups = this.billPumpGroups();
            if (groups !== r.pumps) {
                notes.push(`Насосов на эскизе: ${r.pumps}, насосных групп в смете: ${groups}. Группы подбираются по системам дома — радиаторы и тёплый пол по этажам; задайте их в левой панели.`);
            }
        }
        return notes;
    },

    /**
     * Пробный расчёт: поля эскиза кладутся в сам state, смета считается тихим
     * прогоном (render(true) страницу не трогает), по ней строится схема —
     * и state возвращается как был. Тот же приём, что у второй сметы режима
     * «Подешевле» (computeCheapBaseline). После возврата смета считается ещё
     * раз: иначе currentEquipmentList остался бы от пробного прогона.
     */
    preview() {
        const key = JSON.stringify([this._items.map(it => this.snap(it)), this._area]);
        if (this._pv && this._pvKey === key) return this._pv;
        const pv = { svg: '', notes: [], bill: [], err: '' };
        if (!window.projectScheme || typeof app.buildSchemeConfig !== 'function') {
            pv.err = 'Модуль схемы ещё не загрузился — схема появится после обновления страницы.';
            this._pv = pv; this._pvKey = key;
            return pv;
        }
        const st = app.state;
        const snapshot = JSON.parse(JSON.stringify(st));
        app._cheapComparing = true;
        try {
            const r = this.toState(st);
            app._boilerRangeCache = null;
            app.render(true);
            pv.notes = r.notes.concat(this.billNotes(r));
            pv.bill = (app.currentEquipmentList || [])
                .filter(i => !i.isOpt && /котёл|котел|бойлер|водонагреват|гидрострел|гидравлическ\S*\s+раздел|(насосн\S*\s+групп|групп\S*\s+насосн)/i.test(String(i.name || ''))
                    && !/коллектор|кронштейн|комплект|бак для/i.test(String(i.name || '')))
                .map(i => ({ q: Math.max(1, Math.round(+i.q) || 1), name: String(i.name || '') }));
            const cfg = app.buildSchemeConfig();
            if (cfg) pv.svg = window.projectScheme.build(cfg);
            else pv.err = 'Котла в пробной смете нет — схема не строится. Укажите тип и мощность котла.';
        } catch (e) {
            console.warn('[эскиз] пробный расчёт:', e);
            pv.err = 'Схему по эскизу построить не удалось.';
        } finally {
            Object.keys(st).forEach(k => { if (!(k in snapshot)) delete st[k]; });
            Object.assign(st, snapshot);
            app._boilerRangeCache = null;
            try { app.render(true); } catch (e) { /* смета пересчитается при следующей отрисовке */ }
            app._cheapComparing = false;
        }
        this._pv = pv; this._pvKey = key;
        return pv;
    },

    apply() {
        const st = app.state;
        this._undo = JSON.parse(JSON.stringify({
            fuels: st.fuels || [], elBoilerPower: st.elBoilerPower ?? null,
            gasSwap: (st.swaps || {})['gas_boiler_auto'] ?? null,
            hotWater: st.hotWater, res: st.res, tankVol: st.tankVol ?? null,
            boilerType: st.boilerType, tankMount: st.tankMount, tankHeat: st.tankHeat,
            boilerScheme: st.boilerScheme, area: st.area, systems: st.systems || [],
        }));

        const r = this.toState(st);

        RecognizeUI.step(3);
        this.archive();

        app.syncUI();
        app.render();
        if (typeof app.saveState === 'function') app.saveState();

        const notes = r.notes.concat(this.billNotes(r));

        const undoBtn = document.getElementById('rec_undo_sketch');
        if (undoBtn) undoBtn.style.display = '';

        RecognizeUI.dropDraft();
        RecognizeUI.clearFileState();
        this.reset();
        const panel = document.getElementById('panel_recognize');
        if (panel) panel.innerHTML = '';
        RecognizeUI.close();

        app.alert('В расчёт перенесено:\n' + r.out.map(s => '• ' + s).join('\n') +
            (notes.length ? '\n\nПроверьте:\n' + notes.map(s => '• ' + s).join('\n') : '') +
            '\n\nОбвязка котельной собрана по этим приборам. Вернуть как было — кнопка «↶ Вернуть котельную» во вкладке распознавания.', 'Готово');
    },

    async undoApply() {
        if (!this._undo || typeof app === 'undefined') return;
        if (!await app.confirm('Вернуть котлы, бойлер, тип отопления и схему котельной такими, какими они были до переноса с эскиза?')) return;
        const u = this._undo, st = app.state;
        st.fuels = u.fuels; st.elBoilerPower = u.elBoilerPower;
        st.swaps = st.swaps || {};
        if (u.gasSwap) st.swaps['gas_boiler_auto'] = u.gasSwap; else delete st.swaps['gas_boiler_auto'];
        st.hotWater = u.hotWater; st.res = u.res; st.tankVol = u.tankVol;
        st.boilerType = u.boilerType; st.tankMount = u.tankMount; st.tankHeat = u.tankHeat;
        st.boilerScheme = u.boilerScheme; st.area = u.area;
        if (u.systems) st.systems = u.systems;
        this._undo = null;
        app.syncUI();
        app.render();
        if (typeof app.saveState === 'function') app.saveState();
        const b = document.getElementById('rec_undo_sketch');
        if (b) b.style.display = 'none';
        app.alert('Котельная возвращена.');
    },

    /** Архив на Beget — тот же, что у смет и планов: лимит запросов и журнал правок. */
    async archive() {
        try {
            const ui = RecognizeUI;
            const urow = (typeof app.accessUserRow === 'function')
                ? (app.accessUserRow() || {}) : (app._currentUserRow || {});
            const payload = {
                user: ui.userKey(),
                region: urow.region || '',
                distributorId: urow.distributor_id || (app.state && app.state.distributorId) || '',
                source: 'boiler_sketch',
                fileName: 'Эскиз котельной · ' + (ui._fileName || ''),
                mode: 'sketch',
                counts: {
                    recognized: this._items.filter(it => !it._hand).length + this._deleted.length,
                    applied: this._items.filter(it => !this.missing(it)).length,
                    replaced: this._items.filter(it => it._hand || this.edits(it)).length + this._deleted.length,
                    fromMemory: 0, noMatch: 0,
                },
                calcId: app.state.calc_id || null,
                projectName: app.state.projectName || '',
                calls: this._calls || 0,
                fromCache: this._fromCache || 0,
                result: this._items.map(it => ({
                    kind: it.kind, fuel: it.fuel, power: it.power, vol: it.vol, flow: it.flow,
                    outputs: it.outputs, label: it.label, box: it.box, hand: it._hand || undefined,
                    edits: this.edits(it) || undefined,
                })).concat(this._deleted.map(o => Object.assign({ deleted: true }, o))),
            };
            if (this._img) { payload.file = true; payload.fileExt = 'jpg'; payload.fileData = this._img; }
            await fetch('https://proxy.heatcalc.ru/recognize_archive.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        } catch (e) {
            console.warn('Эскиз не заархивирован:', e.message);
        }
    },
};

/**
 * Правила разбора эскиза котельной. Условные знаки — те, которыми монтажники
 * рисуют котельную от руки; подписи на приборах важнее всего остального.
 */
const BOILER_SKETCH_PROMPT = `Ты разбираешь ЭСКИЗЫ КОТЕЛЬНЫХ частного дома (Россия), нарисованные монтажником от руки: гидравлическую схему обвязки — котлы, бойлеры, гидрострелку, насосы. Цель — список КРУПНОГО оборудования с его параметрами и местом на снимке. Обвязку (трубы, краны, фильтры, фитинги) не перечисляй: её подберёт калькулятор.

Верни СТРОГО JSON по схеме. Никакого текста вне JSON. Дробные числа — с точкой, без единиц измерения. Кавычки внутри строк не используй.

СХЕМА:
{
  "docKind": "boiler_sketch" | "other",
  "items": [{
    "kind": "boiler" | "tank" | "hydro" | "pump" | "exp_tank" | "manifold",
    "fuel": "el" | "gas" | "solid" | null,
    "power": мощность котла в кВт или null,
    "vol": объём бойлера или бака в литрах или null,
    "flow": расход гидрострелки в м3/ч или null,
    "outputs": число выходов коллектора или null,
    "label": "подпись у прибора как написана",
    "box_2d": [ymin, xmin, ymax, xmax],
    "confidence": 0.0-1.0,
    "note": "что неясно, коротко"
  }],
  "notes": ["надписи на полях, не относящиеся к приборам, как написаны"]
}

box_2d — рамка вокруг знака прибора вместе с его подписью, координаты от 0 до 1000 по высоте и ширине снимка.

УСЛОВНЫЕ ЗНАКИ:
1. КОТЁЛ (boiler) — прямоугольник или квадрат, обычно с подписью внутри или рядом. «Эл», «эл», «L», «ЭК», «Э», «электр» — электрический (fuel=el). «Газ», «Г», «ГК», «газ.» — газовый (gas). «ТТ», «дрова», «твёрд» — твердотопливный (solid). Число рядом — мощность в кВт (12, 24, 9). Тип не подписан — fuel=null.
2. БОЙЛЕР (tank) — цилиндр, овал или вытянутый прямоугольник со ЗМЕЕВИКОМ внутри: спираль, петли, «ооо», волнистая линия. Число — объём в литрах (100, 200, 300, 1000).
3. ГИДРОСТРЕЛКА (hydro) — узкий прямоугольник или толстая труба, к которой с одной стороны подходят котлы, с другой — насосы и коллектор. Число с «м3/ч», «м³/ч», «куб», «м3» — расход (flow).
4. НАСОС (pump) — окружность с треугольником внутри (или с буквой Н). Каждый насос — отдельный item, даже если несколько стоят в ряд. Насос котла и насосная группа контура — тоже насосы.
5. РАСШИРИТЕЛЬНЫЙ БАК (exp_tank) — окружность или овал без треугольника и без змеевика на отводе от трубы, часто с числом литров.
6. КОЛЛЕКТОР (manifold) — длинная труба-гребёнка, от которой отходят несколько контуров с насосами. outputs — сколько контуров от неё отходит.

ПРАВИЛА:
7. Подпись читай у самого прибора. Надписи на полях — списки, расчёты, количества вроде «кр=15», «м/п 20=12» — к приборам не относятся: перепиши их в notes, в items не включай.
8. Лист может быть сфотографирован повёрнутым на 90° — читай подписи в любой ориентации.
9. Не угадывай числа. Цифра неразборчива («12 или 72») — поле null, прочитанное — в label, сомнение — в note, confidence ниже 0.6.
10. Стены помещения, двери, окна, мебель — не приборы. Две линии трубы — не прибор.
11. Если на снимке НЕ схема котельной (смета списком, план этажа, счёт, фотография) — верни ровно {"docKind":"other","items":[]}.`;

window.RecognizeSketch = RecognizeSketch;
