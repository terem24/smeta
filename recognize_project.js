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

    /** Что с листов инженерных систем относится к помещению — для примечаний. */
    rowNotes(r) {
        const e = r.eng;
        if (!e) return [];
        const out = [];
        if (e.heatSheet) {
            if (e.ufh) out.push(`тёплый пол${e.ufhArea ? ` ${this.fmt(e.ufhArea)} м²` : ''} (лист ${e.heatSheet})` +
                (e.ufhArea && r.area > 0 && e.ufhArea < r.area * 0.9 ? ' — в расчёте ляжет на всю комнату' : ''));
            if (e.heaters) out.push(`${this.HEATER_NAMES[e.heaterType] || 'прибор'}: ${e.heaters}`);
            if (!e.ufh && !e.heaters) out.push(`на листе ${e.heatSheet} отопления нет — поставлен радиатор, проверьте`);
        }
        if (e.fix) {
            out.push('сантехника: ' + this.FIX_KEYS.filter(k => e.fix[k])
                .map(k => this.FIX_NAMES[k] + (e.fix[k] > 1 ? ` ×${e.fix[k]}` : '')).join(', '));
        }
        return out;
    },

    /**
     * Системы и окна комнаты по листу отопления. Лист прочитан — решает он:
     * радиатор только там, где нарисован прибор, тёплый пол — где заштрихован.
     */
    fitRoom(room, r) {
        const e = r.eng;
        if (!e || !e.heatSheet) return;
        const sys = [];
        if (e.heaters) sys.push('rad');
        if (e.ufh) sys.push('tp');
        if (!sys.length) sys.push('rad');
        room.sys = sys;

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
        st.towelWarmer = Object.assign({}, st.towelWarmer || {},
            { enabled: true, type: this.towel.type, count: this.towel.count });
        return true;
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
