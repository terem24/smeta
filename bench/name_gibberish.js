/**
 * Стенд детектора «имя набрано наугад» (app.nameJunkScore).
 *
 * Идея: слово русского имени подчиняется звуковым правилам — какие согласные могут стоять
 * вместе в начале, в конце и внутри слова. Набор букв («Уупкф», «Сфоарис», «Уфр») их нарушает.
 * Разрешённые сочетания выведены из словаря настоящих имён bench/name_corpus.txt (фамилии
 * славянские, тюркские, кавказские, среднеазиатские, немецкие и др.) плюс ручные добавки.
 *
 * Запуск:  node bench/name_gibberish.js            — показать таблицы и прогон
 *          node bench/name_gibberish.js --print    — вывести строки для app.js
 *
 * Проверка идёт по контрольному списку «живых» слов из базы (слова, которых нет в словаре)
 * и по набору заведомой чепухи. Правило для формы: два нарушения и больше на всё ФИО.
 */
const fs = require('fs');
const path = require('path');

const V = 'аеёиоуыэюяй';
const isV = ch => V.indexOf(ch) !== -1;
const isSoft = ch => ch === 'ь' || ch === 'ъ';

const corpus = fs.readFileSync(path.join(__dirname, 'name_corpus.txt'), 'utf8')
    .toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(w => /^[а-я-]+$/.test(w));

function clusters(word) {
    // → { init, fin, mid: [пары], runs: [длины], hasV }
    const w = word.replace(/ё/g, 'е');
    const res = { init: '', fin: '', mid: [], runs: [] };
    let i = 0;
    let run = '';
    const flush = (pos) => {
        if (!run) return;
        res.runs.push(run);
        if (pos === 'start') res.init = run;
        run = '';
    };
    // разбираем на цепочки согласных
    const segs = [];
    let cur = '', curStart = 0;
    for (let k = 0; k < w.length; k++) {
        const ch = w[k];
        if (isV(ch) || isSoft(ch) || ch === '-') {
            if (cur) segs.push({ s: cur, start: curStart, end: k });
            cur = '';
        } else {
            if (!cur) curStart = k;
            cur += ch;
        }
    }
    if (cur) segs.push({ s: cur, start: curStart, end: w.length });
    return segs.map(g => ({
        s: g.s,
        pos: g.start === 0 ? 'init' : (g.end === w.length ? 'fin' : 'mid'),
        // после мягкого знака цепочка смыкается (напр. «льц»): помечаем, чтобы не мешать
        afterSoft: g.start > 0 && isSoft(w[g.start - 1])
    }));
}

function build() {
    const init = new Set(), fin = new Set(), pair = new Set();
    corpus.forEach(w => {
        clusters(w).forEach(c => {
            if (c.s.length >= 2) {
                if (c.pos === 'init') init.add(c.s);
                else if (c.pos === 'fin') fin.add(c.s);
                for (let k = 0; k < c.s.length - 1; k++) pair.add(c.s.slice(k, k + 2));
            }
        });
    });
    // ручные добавки: настоящие, но редкие в словаре сочетания
    'шт шк шл шм шн шв шп сл см сн св ск сп ст сх сц хл хм хв хр кл кн кв кр гл гн гр пл пр пс пш бл бр вл вр вс вз вн вм зд зв зл зн зм мл мн мс мч тв тк тр дв дн др дж чк цв жд жг жм жб фр фл ксн рж рц рч чх чв зб кт мр пч ср'.split(' ')
        .forEach(x => { init.add(x); pair.add(x.slice(0, 2)); });
    // конечные: имена на согласную после согласной (Петр, Берг, Гольц, Штерн, Макс)
    'ст нт рт нд рд рг нг лд лт рк рн рс рм рл лл нс мс кс ск нк лк лм кт пт нц лц рц тр др кр рх рш нш ндр рк рф лф нф'.split(' ')
        .forEach(x => { fin.add(x); if (x.length === 2) pair.add(x); });
    'гг нв жж мх лх бх зб вв кк тс дс нм мп нл тп кп бс зг зт зх мв мд рв сб сд сч тц хк'.split(' ').forEach(x => pair.add(x));
    return { init, fin, pair };
}

const T = build();

// 4+ согласных подряд допустимы только в этих связках (вств, нств, здр, стр, ндр…)
const RUN4_OK = /(мкрт|нтск|ндск|нгск|стск|рдск|лтск|вств|нств|рств|мств|здр|стр|ндр|нтр|стрн|вств|ндск|рнск|рвск|ртск|нцк|цств)/;

/** Нарушения в одном слове: массив кодов. */
function violations(word) {
    const w = String(word || '').toLowerCase().replace(/ё/g, 'е');
    const out = [];
    if (!/[а-я]/.test(w)) return out;
    if (/^[ыьъ]/.test(w)) out.push('нач:' + w[0]);
    if (/[аеиоуыэюя]ь/.test(w)) out.push('ь после гласной');
    if (/(.{2,3})\1\1/.test(w) || /(.)\1\1/.test(w)) out.push('повтор');
    if (/[аеиоуыэюя]{4}/.test(w)) out.push('гласные подряд');
    if (/уу/.test(w) && !/уулу$/.test(w)) out.push('уу');
    if (/(оа|ыа|ыо|ыу|ыи|ыэ|ээ|иы|еы|ъо)/.test(w) && !/^гоар/.test(w)) out.push('гласные');
    if (/(чы|щы|чя|щя|чю|щю|жя|шя|шю|жю|цы[^а-я]|ьй|йй)/.test(w)) out.push('правописание');
    clusters(w).forEach(c => {
        const s = c.s;
        if (s.length >= 5 || (s.length === 4 && !RUN4_OK.test(s))) { out.push('цепочка:' + s); return; }
        if (s.length < 2) return;
        const pairsOk = t => { for (let k = 0; k < t.length - 1; k++) if (!T.pair.has(t.slice(k, k + 2))) return false; return true; };
        if (c.pos === 'init' && !c.afterSoft && !T.init.has(s) && !(s.length === 3 && T.init.has(s.slice(0, 2)) && pairsOk(s))) out.push('начало:' + s);
        else if (c.pos === 'fin' && !T.fin.has(s)) out.push('конец:' + s);
        else {
            for (let k = 0; k < s.length - 1; k++) {
                if (!T.pair.has(s.slice(k, k + 2))) { out.push('пара:' + s.slice(k, k + 2)); break; }
            }
        }
    });
    return out;
}

module.exports = { violations, T };

if (require.main === module) {
    if (process.argv.includes('--print')) {
        const j = s => Array.from(s).sort().join(' ');
        console.log('INIT:', j(T.init)); console.log('FIN:', j(T.fin)); console.log('PAIR:', j(T.pair));
        process.exit(0);
    }
    const real = 'а айвазов александр александрович александровна алексеевич алексеевна алексей андреевич андрей аникиев антон антонович бакаев бордовский борисов борисович брагунец буканов бухтояров бычковский вадим вадимович валерий валтер вероника виктор викторович виноградов виталий владимир владимирович владислав владыченко власовец вольский вячеславович вячеславовна галина гарцман геннадьевич глазкова дарья денис дмитрий дорохович дугина евгений евгения евгеньевич екатерина ещенко жолобов забелин земляков зиновьев ибатуллин иван иванова иванович ивановна игорь ильин ильич ильиченко иосифович исмайлов калягин камелин камран карцев кирилл кичакин кокорин колодин комиссаров константин корябкин краковецкий крупа ксенофонтов кяйвяряйнен лавроненко лауцевичус любовь мазухин майдебура максим меньшиков мешков михаил михайлович михайловна мокеев монашов морозова мусабеков мутовкин мясников нежельский нехаева никита николаевич николаевна николай олегович ольга павлов панченко петренко петров петрович петухов писаревский прожорин рамазанович решетников романов романович романовна руг руслан рыжов свешников свириденко сенилов сергеевич сергеевна сергей серова скляров смирнов сотников стадник станислав станиславович степан степанович сушков тимур трубило фоменко фролов хисамутдинов цап чекмасов шаркова шиняев шишков шкляев эльвирович эркинович юрий юрьевич яковлев якшин'.split(' ');
    // слова вне словаря — честный контроль (то, что в словаре, проходит заведомо)
    const cs = new Set(corpus);
    const fresh = real.filter(w => !cs.has(w));
    console.log('Живых слов вне словаря:', fresh.length);
    let bad = 0;
    fresh.forEach(w => { const v = violations(w); if (v.length) { bad++; console.log('  нарушение у живого:', w, v.join(',')); } });
    console.log('Ложных срабатываний:', bad);

    const junk = ['уупкф', 'сфоарис', 'уфр', 'фывфыв', 'йцукен', 'ыыыы', 'пыпыпы', 'ячсмить', 'аввваа', 'ггггг', 'ждлорп', 'ъъъъ', 'лрпш', 'бкфгшт', 'щщщ', 'хзщш', 'ждддд', 'тесттт', 'укуук', 'впрол', 'зхщшг', 'фкпыв', 'ячсвап', 'ыпрвм', 'аоеуы', 'ррррр'];
    junk.forEach(w => console.log((violations(w).length ? 'ловит ' : 'ПРОПУСК '), w, violations(w).join(',')));

    // Случайная чепуха: слова из букв наугад длиной 4–9 (равномерно по алфавиту)
    const al = 'абвгдежзийклмнопрстуфхцчшщыэюя';
    let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let caught1 = 0, caught2 = 0, N = 20000;
    for (let i = 0; i < N; i++) {
        let n = 0;
        for (let k = 0; k < 3; k++) {
            const len = 4 + Math.floor(rnd() * 6);
            let w = '';
            for (let q = 0; q < len; q++) w += al[Math.floor(rnd() * al.length)];
            n += violations(w).length;
        }
        if (n >= 1) caught1++; if (n >= 2) caught2++;
    }
    console.log('Случайные «ФИО» из букв наугад: ≥1 нарушения', (100 * caught1 / N).toFixed(1) + '%, ≥2 нарушений', (100 * caught2 / N).toFixed(1) + '%');
}
