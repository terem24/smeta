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
        const list = rows.map((r, n) => `${n + 1}. ${r.name}${r.area > 0 ? `, ${this.fmt(r.area)} м²` : ''}` +
            `${r.floor === 2 ? ', 2-й этаж' : ''}`).join('\n');

        for (const sh of (project && project.eng) || []) {
            const what = sh.kind === 'heat' ? 'отопления' : 'сантехники';
            if (onStatus) onStatus(`Читаю лист ${sh.num} — ${what}…`);
            try {
                const data = await ui.askModel([
                    { text: `Лист ${sh.num} «${sh.title}» — ${sh.kind === 'heat'
                        ? 'отопление и тёплые полы' : 'водоснабжение и канализация'}. ` +
                        `Задача: ${sh.kind}.\n\nПомещения, уже прочитанные с плана:\n${list}\n\n` +
                        (sh.text ? `Текст листа (набран в PDF, ему можно верить больше, чем картинке):\n${sh.text}\n\n` : '') +
                        'Верни только JSON.' },
                    { inline_data: { mime_type: 'image/jpeg', data: sh.img } },
                ], PROJECT_ENG_PROMPT);
                const cand = data?.candidates?.[0];
                const text = cand?.content?.parts?.[0]?.text;
                if (!text) throw new Error('пустой ответ');
                const parsed = ui.parseModelJson(text, cand.finishReason);
                const res = sh.kind === 'heat'
                    ? this.takeHeat(parsed, rows, sh) : this.takeWater(parsed, rows, sh);
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

    /** Строка по номеру из ответа модели (номера в списке — с единицы). */
    rowOf(rows, n) {
        const k = Math.round(this.num(n)) - 1;
        return (k >= 0 && k < rows.length) ? rows[k] : null;
    },

    takeHeat(parsed, rows, sh) {
        const warnings = [];
        rows.forEach(r => {
            r.eng = r.eng || {};
            r.eng.heatSheet = sh.num;       // лист прочитан: молчание о комнате — тоже ответ
            r.eng.ufh = false; r.eng.ufhArea = null; r.eng.heaters = 0; r.eng.heaterType = null;
        });
        let ufhSum = 0, ufhRooms = 0, heaters = 0;
        (Array.isArray(parsed.rooms) ? parsed.rooms : []).forEach(x => {
            const r = this.rowOf(rows, x && x.n);
            if (!r) { if (x && x.name) warnings.push(`лист ${sh.num}: «${x.name}» не найдено среди помещений`); return; }
            if (x.ufh) {
                r.eng.ufh = true;
                const a = this.num(x.ufhArea);
                r.eng.ufhArea = a > 0 ? Math.round(a * 100) / 100 : null;
                ufhRooms++;
                if (a > 0) ufhSum += a;
            }
            const h = this.cnt(x.heaters);
            if (h) {
                r.eng.heaters = h;
                r.eng.heaterType = this.HEATER_NAMES[x.heaterType] ? x.heaterType : 'radiator';
                heaters += h;
            }
        });

        const tr = parsed.towelRails || {};
        const trCount = this.cnt(tr.count);
        this.towel = trCount ? { count: trCount, type: tr.type === 'water' ? 'water' : 'electric' } : null;

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

    takeWater(parsed, rows, sh) {
        const warnings = [];
        rows.forEach(r => { r.eng = r.eng || {}; r.eng.waterSheet = sh.num; r.eng.fix = null; });
        const tot = {};
        (Array.isArray(parsed.rooms) ? parsed.rooms : []).forEach(x => {
            const r = this.rowOf(rows, x && x.n);
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

    reset() { this.towel = null; },
};

window.RecognizeProject = RecognizeProject;

const PROJECT_ENG_PROMPT = `Ты разбираешь лист инженерных систем из дизайн-проекта или рабочего проекта частного дома (Россия). Помещения дома уже прочитаны с плана и даны списком с номерами. Твоя задача — привязать к ним то, что нарисовано на этом листе. Ничего не выдумывай: нет на листе — нет в ответе.

Задача указана в запросе словом heat или water.

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

=== Привязка к помещениям ===
n — номер помещения из списка в запросе. Определи помещение по положению на листе и по подписям; если на листе помещения подписаны иначе, сопоставь по смыслу и площади. Если прибор стоит в помещении, которого в списке нет, — опиши его в unclear, n не придумывай.

=== Формат ответа ===
Только JSON, без пояснений.
heat:
{"rooms":[{"n":1,"name":"Кухня-гостиная","ufh":true,"ufhArea":57.54,"heaters":3,"heaterType":"floor_convector"}],
 "towelRails":{"count":1,"type":"electric"},"ufhTotal":121.95,"unclear":[]}
water:
{"rooms":[{"n":5,"name":"Мастер-санузел","toilet":1,"bidet":0,"basin":1,"kitchenSink":0,"bath":1,"shower":1,"wash":0,"dish":0}],
 "unclear":[]}
Помещения без тёплого пола, приборов и сантехники в rooms не включай.`;
