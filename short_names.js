/**
 * Названия оборудования для документов, уходящих наружу: PDF, Excel и страница
 * клиента по ссылке.
 *
 * Зачем. Смета, полученная клиентом, пересылается другим монтажникам, и те
 * подбирают её заново — у себя, по названию и артикулу. Убираем то, по чему
 * позиция узнаётся сразу: артикул (его прячет вызывающий код) и название модели.
 * Остаётся то, что нужно клиенту, чтобы понять, что он покупает: тип прибора,
 * размер, мощность, резьба, число секций. По этим признакам смету всё равно
 * можно собрать заново, но уже вручную, а не поиском по названию.
 *
 * Что считается названием модели:
 *  - слово с двумя и более латинскими буквами подряд (Space, OptiBase, RHS,
 *    Thermatic, бренд STOUT/ROMMER), кроме технических обозначений из WHITE
 *    (PE-Xa, PPR, PN, DN, XPS, EPDM…);
 *  - обозначения вида «МЛ-778», «ШРН-0», серии «АНТИЛЁД», «ПРОТЕКТ ПРО»;
 *  - число из трёх и более цифр сразу за убранным словом («Thermatic 3001»).
 * Бренд — отдельная колонка, из названия он не нужен.
 *
 * Котлы Baxi, Vaillant и Navien названы одной моделью без русского слова,
 * поэтому для них название собирается заново из каталога: тип, число
 * контуров, мощность — так же, как у Haier.
 *
 * Функции чистые: ничего не читают из состояния калькулятора и пригодны и в
 * app.js, и в invoice.html. Каталог (глобальный `catalog`) нужен только
 * котлам и теплоносителю; без него они просто проходят общий разбор.
 */
(function (root) {
    'use strict';

    // Технические обозначения, которые латиницей пишут все производители и
    // которые клиенту нужны: материал трубы, класс давления, диаметр, стандарт.
    var WHITE = /^(PE-?X(-?[abc])?|PEX(-?[abc])?|PE-?RT|PE|RT|EVOH|PP-?R(CT)?|PPR|PVC|PVDF|PN\d*|DN\d*|Dn\d*|XPS|EPDM|FPM|NBR|NTC|DIN|IP\d+|AISI|Al|HP|II|III|Kv|RS-?485|eBUS|LED|UV|SDR\d*|SN\d*|PTFE|PET|LS|NO|NC|AC|DC|PWM|DHW|WiFi|Wi-Fi|GSM|USB|LoRa|ZigBee|Bluetooth|UTP|FTP|R[pc]?|G)$/i;

    // Слова-серии, написанные кириллицей
    var CYR_SERIES = /^(АНТИЛ[ЕЁ]Д|ПРОТЕКТ)$/i;
    var CYR_SERIES_CASE = /^ПРО$/;
    // Обозначения вида «МЛ-778», «ШРН-180-0»: буквы, дефис, цифры
    var CYR_CODE = /^[А-ЯЁ]{2,5}-\d[\d\-]*$/;
    // Единицы, после которых число — размер, а не номер модели
    var UNIT_AFTER = /^(мм|см|м|л|кг|г|шт|вых|кВт|Вт|А|В|бар|°C|°|МПа|кПа|м²|м³|секц|секций|секции|контура|контуров|конт|Гц|МГц|мкм)\.?[,;)]?$/i;

    function stripPunct(w) {
        var m = /^([("'«\[]*)(.*?)([)"'»\],;:.]*)$/.exec(w);
        return m ? { pre: m[1], core: m[2], post: m[3] } : { pre: '', core: w, post: '' };
    }

    // Слово — часть названия модели?
    function isModelWord(core) {
        if (!core) return false;
        if (/^ВВГнг/.test(core)) return false;                       // марка кабеля
        if (CYR_SERIES.test(core) || CYR_SERIES_CASE.test(core)) return true;
        if (CYR_CODE.test(core)) return true;
        // Размеры и резьба: «20xR3/4"», «Rp3/4"», «Dn63», «A4» — цифры и короткие
        // буквенные приставки (до двух букв подряд), это не название модели
        if (/^\d/.test(core)) return false;                              // размер вида «25xRp3/4"»
        if (/\d/.test(core)) {
            var runs = core.match(/[A-Za-z]+/g) || [];
            var longest = 0;
            for (var r = 0; r < runs.length; r++) if (runs[r].length > longest) longest = runs[r].length;
            if (longest <= 2) return false;
        }
        // Составное «PE-Xb/Al/PE-Xb»: убираем, только если не все части технические
        var parts = core.split('/');
        var hasLat2 = false;
        for (var i = 0; i < parts.length; i++) {
            if (/[A-Za-z]{2,}/.test(parts[i]) && !WHITE.test(parts[i])) { hasLat2 = true; break; }
        }
        return hasLat2;
    }

    function tidy(s) {
        s = s.replace(/\(\s*[,;]?\s*\)/g, '');                          // пустые скобки
        s = s.replace(/\(\s*[,;]\s*/g, '(').replace(/\s*[,;]\s*\)/g, ')');
        s = s.replace(/\s+([,;.)])/g, '$1').replace(/([(])\s+/g, '$1');
        s = s.replace(/(^|[\s(])[,;]+\s*/g, '$1');                      // запятая в начале фрагмента
        s = s.replace(/,\s*,+/g, ',');
        s = s.replace(/\s{2,}/g, ' ').trim();
        s = s.replace(/^[\s,;:\-–—]+|[\s,;:\-–—]+$/g, '');
        return s;
    }

    function cyrCount(s) { return (String(s).match(/[А-Яа-яЁё]/g) || []).length; }

    // Разбор одного фрагмента без скобок верхнего уровня: выбрасываем слова-модели
    // и числа-номера за ними. Возвращает текст и число убранных слов.
    function stripFlat(name) {
        var words = String(name || '').split(/\s+/);
        var out = [];
        var prevRemoved = false;
        var removed = 0;
        var carryOpen = '';
        for (var i = 0; i < words.length; i++) {
            var p = stripPunct(words[i]);
            var drop = isModelWord(p.core);
            // «Haier A4»: буква и цифра сразу за убранным словом — тоже модель
            if (!drop && prevRemoved && /^[A-Z]\d$/.test(p.core)) drop = true;
            // Номер модели: «Thermatic 3001», «NOVA QUAD 001» — три и более цифры подряд
            // сразу за убранным словом, если дальше не единица измерения
            if (!drop && prevRemoved && /^\d{3,}$/.test(p.core)) {
                var next = stripPunct(words[i + 1] || '').core;
                if (!UNIT_AFTER.test(next)) drop = true;
            }
            if (drop) {
                removed++;
                prevRemoved = true;
                // Скобки слова-модели не должны пропасть или повиснуть
                if (/\(/.test(p.pre) && !/\)/.test(p.post)) carryOpen = '(';
                else if (/\)/.test(p.post) && !/\(/.test(p.pre) && out.length) out[out.length - 1] += ')';
                continue;
            }
            prevRemoved = false;
            out.push(carryOpen + words[i]);
            carryOpen = '';
        }
        return { text: out.join(' '), removed: removed };
    }

    // --- Размеры и резьба ---
    // Дюймы («3/4"», «1''»), пары размеров («25xR3/4"», «16x2.0», «60/100», «32x20x25»),
    // диаметры («DN25», «Dn63», «D110»), Kv и вид резьбы (ВР, НР, ВР/НР, Н-В) —
    // по ним позицию подбирают заново проще всего.
    // Мощность, объём, число секций, длина и толщина остаются: по ним клиент оценивает смету.
    var Q = '(?:"\'|"|”|\'\'|’’|″)';
    var PFX = '(?:R[pc]?|G|D)?';
    var NUM = '\\d+(?:[.,]\\d+)?(?:\\/\\d+)?';
    var SPEC_INCH = new RegExp('^\\d+(?:\\/\\d+)?' + Q + '$');
    var SPEC_DIM = new RegExp('^' + PFX + NUM + Q + '?(?:[xх×\\/]' + PFX + NUM + Q + '?)+$', 'i');
    var SPEC_DIAM = /^(?:D[Nn]?|Ø)\d+$/;
    var SPEC_THREAD_TAIL = /^\d+[xх×](?:R[pc]?|G)$/i;          // «16xR» перед «1/2"»
    var SPEC_GENDER = /^(?:ВР|НР|ВН|НВ|ВПр|НПр|(?:ВР|НР|ВН|НВ|ВПр|НПр|Н|В)(?:[\/-](?:ВР|НР|ВН|НВ|ВПр|НПр|Н|В|накидная))+)$/;
    var SPEC_LETTER = /^(?:R[pc]?|G)$/;                                 // «Rp 1"» через пробел
    var SPEC_PUMP = /^\d+\/\d+-\d+$/;                                   // насос «25/60-180»: DN / напор / длина
    var SPEC_DN_WORD = /^D[Nn]$/;
    var SPEC_KV_WORD = /^Kv$/i;
    var IS_NUM = /^\d+(?:[.,]\d+)?$/;

    function isSpecWord(core, next) {
        if (!core) return false;
        if (SPEC_INCH.test(core) || SPEC_DIM.test(core) || SPEC_DIAM.test(core)) return true;
        if (SPEC_THREAD_TAIL.test(core) || SPEC_GENDER.test(core) || SPEC_PUMP.test(core)) return true;
        if (SPEC_LETTER.test(core) && SPEC_INCH.test(next || '')) return true;
        return false;
    }

    function stripSpecs(name) {
        var s = String(name || '')
            .replace(/\((?:п|м|п-м|м-м|п-п|м-п)\)/g, '')   // (п) (м) (п-м)…
            .replace(/\s+с\s+(?:наружной|внутренней)\s+резьбой/gi, '')
            .replace(/\s*\((?:Газо-жидкостная|Жидкостная|Бабочка|Рычаг)\)/gi, '');
        // Коллектор «3/4"х1/2"х3 вых.», «1"/3/4"x7»: резьба уходит, число выходов — характеристика
        if (/Коллектор/i.test(s)) {
            s = s.replace(/\S*["”'’][xх×](\d+)(?:\s+вых\.?)?/gi, '$1 вых.');
        }
        // Сечение кабеля «3×1,5» — электрическая характеристика, а не диаметр
        var cable = /^(?:Кабель|Провод)/i.test(s);
        var words = s.split(/\s+/);
        var out = [];
        for (var i = 0; i < words.length; i++) {
            // Кавычки-дюймы остаются в слове: stripPunct их отрезал бы, и «1"» стал бы числом «1»
            var p = { core: words[i].replace(/^\(+/, '').replace(/[,;.)]+$/, '') };
            var nextCore = (words[i + 1] || '').replace(/^\(+/, '').replace(/[,;.)]+$/, '');
            if (SPEC_KV_WORD.test(p.core) && IS_NUM.test(nextCore)) { i++; continue; }          // Kv 1,8
            if (SPEC_DN_WORD.test(p.core) && IS_NUM.test(nextCore)) { i++; continue; }          // DN 25
            if (cable && /^\d+[xх×]/.test(p.core)) { out.push(words[i]); continue; }
            if (/^[xх×]$/i.test(p.core)) continue;                                    // «1" х 3/4"»: знак между убранными размерами
            if (isSpecWord(p.core, nextCore)) {
                // «1 1/4"»: целая часть осталась в предыдущем слове
                if (/^\d\/\d/.test(p.core) && out.length && /^\d$/.test(stripPunct(out[out.length - 1]).core)) out.pop();
                // Закрывающая скобка убранного слова переезжает к предыдущему, если скобка была открыта
                var closing = (words[i].match(/\)+$/) || [''])[0];
                if (closing && out.length) {
                    var soFar = out.join(' ');
                    var open = (soFar.match(/\(/g) || []).length - (soFar.match(/\)/g) || []).length;
                    if (open > 0) out[out.length - 1] += closing.slice(0, open);
                }
                // «16/500 мм»: единица без числа не нужна
                if (/^(?:мм|см)[,;.)]*$/.test(nextCore) && !SPEC_GENDER.test(p.core)) i++;
                // «с НР», «с ВР»: предлог без слова не нужен
                if (SPEC_GENDER.test(p.core) && out.length && /^(?:с|со)$/i.test(out[out.length - 1])) out.pop();
                // «НР/накидная гайка»: слово «гайка» относится к убранной паре
                if (/накидная$/.test(p.core) && /^гайка/.test(nextCore)) i++;
                continue;
            }
            out.push(words[i]);
        }
        // «1" x 4 вых»: после дюйма остался одинокий «x»
        return out.join(' ').replace(/(^|\s)[xх×]\s+(?=\d)/gi, '$1');
    }

    function strip(name) {
        var s = stripSpecs(name);
        // Скобки обрабатываем отдельно: перечень совместимости «(BAXI кроме ECO Nova,
        // Ariston…)» после удаления моделей превращается в «(кроме)» — такую скобку
        // убираем целиком
        s = s.replace(/\(([^()]*)\)/g,function (m, inner) {
            var r = stripFlat(inner);
            if (r.removed >= 1 && (cyrCount(r.text) < 8 || /^кроме(\s|$)/i.test(r.text))) return '';
            if (r.removed >= 2 && cyrCount(r.text) < 12) return '';
            if (!r.text) return '';
            return '(' + r.text + ')';
        });
        return tidy(stripFlat(s).text);
    }

    // --- Котлы и теплоноситель: названия собираются из каталога ---
    var byId = null;
    var MODEL_CATS = ['boilers_baxi', 'boilers_vaillant', 'boilers_navien', 'coolants'];

    function index() {
        if (byId) return byId;
        byId = {};
        var cat = (typeof catalog !== 'undefined') ? catalog : (root.catalog || null);
        if (!cat) return byId;
        MODEL_CATS.forEach(function (k) {
            (cat[k] || []).forEach(function (it) { if (it && it.id) byId[it.id] = { cat: k, it: it }; });
        });
        return byId;
    }

    function boilerName(it) {
        var p = it.power ? ' (' + it.power + ' кВт)' : '';
        var circ = it.circuits === 1 ? 'одноконтурный' : (it.circuits === 2 ? 'двухконтурный' : '');
        return 'Котёл газовый' + (it.cond ? ' конденсационный' : '') + (circ ? ', ' + circ : '') + p;
    }

    function coolantName(it) {
        var m = /(\d+\s*(?:л|кг))\s*$/i.exec(it.name || '');
        var vol = m ? ', ' + m[1].replace(/\s+/, ' ').replace(/(\d)(л|кг)/, '$1 $2') : '';
        return (it.type === 'water' ? 'Теплоноситель на основе воды' : 'Теплоноситель незамерзающий') + vol;
    }

    /**
     * Короткое название позиции для документа наружу.
     * @param {{id?:string, name?:string}} item позиция сметы или каталога
     * @returns {string} название без модели; при неудаче разбора — исходное
     */
    function shortName(item) {
        var name = String((item && item.name) || '');
        if (!name) return name;
        var hit = item && item.id ? index()[item.id] : null;
        if (hit) {
            if (hit.cat === 'coolants') return coolantName(hit.it);
            return boilerName(hit.it);
        }
        var s = strip(name);
        // Остались одни цифры и обрывки — разбор съел слишком много, отдаём как есть.
        // Лучше показать модель, чем строку без смысла.
        if ((s.match(/[А-Яа-яЁё]/g) || []).length < 4) return name;
        return s;
    }

    root.HcShortName = { of: shortName, strip: strip };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.HcShortName;
})(typeof window !== 'undefined' ? window : globalThis);
