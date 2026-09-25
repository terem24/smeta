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

    FIX_KEYS: ['toilet', 'basin', 'bath', 'shower', 'bidet', 'wash', 'dish'],
    FIX_NAMES: {
        toilet: 'унитаз', basin: 'раковина', bath: 'ванна', shower: 'душ',
        bidet: 'биде', wash: 'стиральная машина', dish: 'посудомоечная машина',
    },
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
            const labelsHint = labels.length
                ? 'Положение надписей на листе (x — % ширины слева, y — % высоты сверху; взято из PDF точно): ' +
                  labels.map(l => `${l.s} (${l.x}%, ${l.y}%)`).join('; ') +
                  '. Марка прибора стоит у окна своего помещения — обычно ближе всего к подписи площади зоны тёплого пола ' +
                  'этого же помещения; помещение каждой марки определяй по этим координатам, а не по картинке.\n\n'
                : '';
            try {
                const data = await ui.askModel([
                    { text: `Лист ${sh.num} «${sh.title}» — ${this.SHEET_TOPIC[sh.kind] || ''}. ` +
                        `Задача: ${sh.kind}.\n\nПомещения, уже прочитанные с плана:\n${list}\n\n` +
                        (sh.kind !== 'vent' && pos.some(Boolean) ? posHint : '') + marksHint + labelsHint +
                        (sh.text ? `Текст листа (набран в PDF, ему можно верить больше, чем картинке):\n${sh.text}\n\n` : '') +
                        'Верни только JSON.' },
                    { inline_data: { mime_type: 'image/jpeg', data: sh.img } },
                ], PROJECT_ENG_PROMPT);
                const cand = data?.candidates?.[0];
                const text = cand?.content?.parts?.[0]?.text;
                if (!text) throw new Error('пустой ответ');
                const parsed = ui.parseModelJson(text, cand.finishReason);
                const res = sh.kind === 'heat' ? this.takeHeat(parsed, rows, sh, scopeRows)
                    : sh.kind === 'vent' ? this.takeVent(parsed, sh)
                    : this.takeWater(parsed, rows, sh, scopeRows);
                summary.push(res.summary);
                warnings.push(...res.warnings);
            } catch (e) {
                if (e.quota) { warnings.push(e.message); break; }
                warnings.push(`лист ${sh.num} (${what}) не прочитан: ${ui.cleanError(e.message).split('\n')[0]}`);
            }
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
        return rows.map(r => {
            const k = norm(r.name);
            if (dup[k] > 1) return null;
            const hits = onPlan.filter(w => norm(w.s) === k);
            return hits.length === 1 ? { x: hits[0].x, y: hits[0].y } : null;
        });
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
              <input type="checkbox" ${r._sel ? 'checked' : ''} style="margin-top:3px" onchange="RecognizePlan.setReq(${i}, this.checked)">
              <span style="flex:1;min-width:0">
                <span style="font-weight:600">${esc(this.REQ_TOPICS[r.topic])}.</span> ${esc(r.text)}
                <span style="display:block;font-size:11.5px;color:var(--text-sec,#64748b)">${r.sheet ? `лист ${r.sheet}` : 'проект'}${r.quote ? ` · «${esc(r.quote)}»` : ''}</span>
              </span>
              ${chip(r.action)}
            </label>`).join('');
        return `<div class="rec-tcheck warn" style="display:block">
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:4px">
              <div class="rec-tcheck-ico">📝</div>
              <div><div>Требования из примечаний проекта</div>
                <div class="rec-tcheck-sub">Отмеченные (${n} из ${reqs.length}) попадут в смету плашкой «Требования проекта» — чтобы не потерялись при подборе и монтаже.</div></div>
            </div>${rows}</div>`;
    },

    /** Отмеченные требования — в состояние расчёта. */
    applyReqs(st) {
        const sel = (this.reqs || []).filter(r => r._sel)
            .map(({ sheet, topic, action, text, quote }) => ({ sheet, topic, action, text, quote }));
        if (!sel.length) return 0;
        st.projectReqs = sel;
        return sel.length;
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
            r.eng.ufh = false; r.eng.ufhArea = null; r.eng.heaters = 0; r.eng.heaterType = null;
        });
        let ufhSum = 0, ufhRooms = 0, heaters = 0;
        (Array.isArray(parsed.rooms) ? parsed.rooms : []).forEach(x => {
            const r = this.rowOf(rows, x && x.n, scope);
            if (!r) { if (x && x.name) warnings.push(`лист ${sh.num}: «${x.name}» не найдено среди помещений`); return; }
            if (x.ufh) {
                r.eng.ufh = true;
                const a = this.num(x.ufhArea);
                r.eng.ufhArea = a > 0 ? Math.round(a * 100) / 100 : null;
                ufhRooms++;
                if (a > 0) ufhSum += a;
            }
            // Марки, отнесённые к помещению, надёжнее голого числа: их модель
            // нашла на листе поимённо, и лишний прибор без марки не пройдёт.
            const mk = Array.isArray(x.heaterMarks)
                ? [...new Set(x.heaterMarks.map(s => String(s).trim()).filter(Boolean))] : [];
            const h = mk.length ? Math.min(20, mk.length) : this.cnt(x.heaters);
            r.eng.heaterMarks = mk;
            if (h) {
                r.eng.heaters = h;
                r.eng.heaterType = this.HEATER_NAMES[x.heaterType] ? x.heaterType : 'radiator';
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
        if (!e || !e.heatSheet) return [];
        const out = [];
        if (e.ufh && e.ufhArea && r.area > 0 && e.ufhArea > r.area) {
            out.push(`зона тёплого пола больше комнаты — в расчёт пойдёт ${this.fmt(r.area)} м²`);
        }
        if (!e.ufh && !e.heaters) out.push(`на листе ${e.heatSheet} отопления нет — в расчёте будет радиатор`);
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
        toilet: 'унитаз', basin: 'раковина', bath: 'ванна', shower: 'душ',
        bidet: 'биде', wash: 'стиральная', dish: 'посудомоечная',
    },

    /** Какие листы прочитаны — от этого зависит, что показывать в строке. */
    sheetsRead(rows) {
        return {
            heat: rows.some(r => r.eng && r.eng.heatSheet),
            water: rows.some(r => r.eng && r.eng.waterSheet),
        };
    },

    /** Строка правки под помещением. n — индекс строки в RecognizePlan._rows. */
    engRow(r, n, read, cols) {
        if (!r.eng || (!read.heat && !read.water)) return '';
        const e = r.eng;
        const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const on = `RecognizePlan.setEng(${n}`;
        const numIn = (field, val, w, step) =>
            `<input class="rec-f" type="number" min="0" step="${step || 1}" value="${val ? esc(val) : ''}" placeholder="0"
                    style="width:${w}px;padding:2px 4px" onchange="${on},'${field}',this.value)">`;
        const parts = [];
        if (read.heat) {
            parts.push(`<label style="white-space:nowrap"><input type="checkbox" ${e.ufh ? 'checked' : ''}
                    onchange="${on},'ufh',this.checked)"> тёплый пол</label>
                ${e.ufh ? `${numIn('ufhArea', e.ufhArea, 64, 0.01)} м²` : ''}`);
            const typeOpt = (v) => `<option value="${v}" ${(e.heaterType || 'radiator') === v ? 'selected' : ''}>${this.HEATER_NAMES[v]}</option>`;
            parts.push(`<span style="white-space:nowrap">приборов ${numIn('heaters', e.heaters, 44)}
                ${e.heaters ? `<select class="rec-f" style="width:auto;padding:2px 4px" onchange="${on},'heaterType',this.value)">
                    ${typeOpt('floor_convector')}${typeOpt('wall_convector')}${typeOpt('radiator')}</select>` : ''}</span>`);
        }
        if (read.water) {
            const f = e.fix || {};
            parts.push(this.FIX_KEYS.map(k => `<span style="white-space:nowrap">${this.FIX_SHORT[k]} ${numIn('fix.' + k, f[k], 40)}</span>`).join(' '));
        }
        return `<tr class="rec-plan-eng"><td></td><td colspan="${cols - 1}" style="padding-top:0">
            <div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:12px;color:var(--text-sec,#64748b)">
              ${parts.join('')}</div></td></tr>`;
    },

    /** Правка из строки под помещением. */
    setEng(r, field, val) {
        const e = r.eng || (r.eng = {});
        if (field === 'ufh') {
            e.ufh = !!val;
            if (!e.ufh) e.ufhArea = null;
        } else if (field === 'ufhArea') {
            const a = this.num(val);
            e.ufhArea = a > 0 ? Math.round(a * 100) / 100 : null;
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
        const sys = [];
        if (e.heaters) sys.push('rad');
        if (e.ufh) sys.push('tp');
        if (!sys.length) sys.push('rad');
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
        if (e.heaterType === 'floor_convector') {
            room.windows.forEach((w, k) => { if (k < e.heaters) w.isPan = true; });
        }
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

    reset() { this.towel = null; this.vent = null; this.reqs = []; },
};

window.RecognizeProject = RecognizeProject;

const PROJECT_ENG_PROMPT = `Ты разбираешь лист инженерных систем из дизайн-проекта или рабочего проекта частного дома (Россия). Помещения дома уже прочитаны с плана и даны списком с номерами. Твоя задача — привязать к ним то, что нарисовано на этом листе. Ничего не выдумывай: нет на листе — нет в ответе.

Задача указана в запросе словом heat, water или vent.

=== heat — отопление и тёплые полы ===
Тёплый пол на плане — заштрихованная зона (часто красной или косой штриховкой) с подписью площади «S=10,63м2». Для каждого помещения, где есть такая зона, укажи ufh=true и ufhArea — сумму подписанных площадей зон в этом помещении. Площадь бери из подписи на листе, не вычисляй.
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
- wash — стиральная машина;
- dish — посудомоечная машина.
Выводы для робота-пылесоса, кофемашины, холодильника, кондиционера — не считай.
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
{"rooms":[{"n":1,"name":"Кухня-гостиная","ufh":true,"ufhArea":57.54,"heaters":3,"heaterMarks":["Р-1","Р-2","Р-3"],"heaterType":"floor_convector"}],
 "towelRails":{"count":1,"type":"electric"},"ufhTotal":121.95,"unclear":[]}
water:
{"rooms":[{"n":5,"name":"Мастер-санузел","toilet":1,"bidet":0,"basin":1,"kitchenSink":0,"bath":1,"shower":1,"wash":0,"dish":0}],
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
