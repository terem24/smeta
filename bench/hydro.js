/**
 * Стенд сводной проверки гидравлики — см. шапку hydro_check.js.
 *
 * Запуск (из корня репозитория):
 *   node bench/hydro.js          типовые объекты: по каждому — таблица контуров и вердикты
 *   node bench/hydro.js json     то же в JSON (для сравнения до/после правки)
 *
 * Стенд меряет ЧИСЛА сводки (расход, нужный и располагаемый напор, запас), а не вёрстку.
 * Кроме печати, проверяет самосогласованность: у каждого контура есть расход и
 * требуемый напор; вердикт соответствует запасу; сводка не падает ни на одном объекте.
 */
const app = require('./env.js');
const hc = app.__ctx.hydroCheck;
if (!hc) throw new Error('hydro_check.js не загрузился в песочницу');

const mode = process.argv[2] || '';

const OBJECTS = [
    { title: 'КП 152693: 180 м², электро STATUS, радиаторы + пол 31 м²', o: { area: 180, fuels: ['el'], systems: ['rad', 'tp'], tp1: 31 } },
    { title: '120 м², электро, радиаторы', o: { area: 120, fuels: ['el'], systems: ['rad'] } },
    { title: '180 м², газ Haier, радиаторы', o: { area: 180, fuels: ['gas'], systems: ['rad'] } },
    { title: '260 м², газ, радиаторы (гидрострелка по напору)', o: { area: 260, fuels: ['gas'], systems: ['rad'] } },
    { title: '2 этажа 160 м², электро, радиаторы', o: { area: 160, floors: 2, fuels: ['el'], systems: ['rad'] } },
    { title: '150 м², электро, пол 130 м² (два узла подмеса)', o: { area: 150, fuels: ['el'], systems: ['rad', 'tp'], tp1: 130 } },
    { title: '180 м², газ + электрорезерв, радиаторы + пол 100 м²', o: { area: 180, fuels: ['gas', 'el'], systems: ['rad', 'tp'], tp1: 100 } },
    { title: '200 м², электро, пол 200 м² (группа DN25 под сервопривод)', o: { area: 200, fuels: ['el'], systems: ['tp'], tp1: 200 } },
    { title: '150 м², газ, радиаторы + бойлер косвенного нагрева', o: { area: 150, fuels: ['gas'], systems: ['rad'], hotWater: true } },
    // Автоисправление схемы по проверке: кольцо не тянуло — добавлены группа / ветка
    { title: 'ИСПРАВЛЕНИЕ: 200 м², электро, режим 75/65 (добавляется ветка)', o: { area: 200, fuels: ['el'], systems: ['rad'], radRegime: 'r7565' } },
    { title: 'ИСПРАВЛЕНИЕ: 240 м², 2 этажа, газ, тройниковая (добавляется группа)', o: { area: 240, floors: 2, fuels: ['gas'], systems: ['rad'], radConnectionScheme: 'tee' } },
    { title: 'ОТКАТ: 280 м², электро, 75/65 (четырёх веток мало — схема остаётся)', o: { area: 280, fuels: ['el'], systems: ['rad'], radRegime: 'r7565' } }
];

const f1 = v => (v == null ? '—' : v.toFixed(1));
const f2 = v => (v == null ? '—' : v.toFixed(2));
let bad = 0;
const out = [];

OBJECTS.forEach(({ title, o }) => {
    app.state.brandMode = 'stout';
    app.__setup(o);
    const data = app.buildHydroCheckData();
    const res = hc.evaluate(data, { reserve: app.RAD_PUMP_RESERVE });
    out.push({ title, scheme: data.scheme && data.scheme.text,
        rows: res.rows.map(r => ({ id: r.id, title: r.title, flow: r.flow, need: r.need, have: r.have, k: r.k, verdict: r.verdict })) });
    if (mode === 'json') return;
    console.log('\n=== ' + title + ' ===');
    console.log('  схема: ' + (data.scheme && data.scheme.text));
    (app._hcApplied || []).forEach(t => console.log('  ✔ исправлено: ' + t));
    if (app._hcTried) console.log('  ↺ ' + app._hcTried);
    // Дополнения карточки (подробный режим) не должны падать ни на одном объекте
    try {
        const ex = app.hydroExtras(res);
        if (mode === 'extras') console.log(ex.replace(/<summary>/g, '\n  § ').replace(/<li>/g, '\n    - ').replace(/<[^>]*>/g, ''));
    } catch (e) { bad++; console.log('  ✗ hydroExtras упал: ' + e.message); }
    res.rows.forEach(r => {
        console.log('  ' + r.verdictRu.padEnd(10) + ' ' + r.title.padEnd(62) + ' G ' + f2(r.flow) + '  нужно ' + f1(r.need) + '  насос ' + f1(r.have) + '  ×' + (r.k == null ? '—' : f2(r.k)));
        if (r.advice) console.log('             → ' + r.advice);
        r.flags.forEach(fl => console.log('             ! ' + fl));
    });
    if (!res.rows.length) console.log('  контуров нет');

    // Самосогласованность
    res.rows.forEach(r => {
        const why = [];
        if (!(r.flow > 0)) why.push('нет расхода');
        if (!(r.need > 0)) why.push('нет требуемого напора');
        if (r.k != null) {
            const want = r.k < 1 ? 'fail' : (r.k < (r.reserve || res.reserve) ? 'tight' : 'ok');
            if (want !== r.verdict) why.push('вердикт не по запасу');
        }
        if (why.length) { bad++; console.log('  ✗ ' + r.title + ': ' + why.join(', ')); }
    });
});

if (mode === 'json') console.log(JSON.stringify(out, null, 1));
else console.log(bad ? '\nНесогласованностей: ' + bad : '\nСводка самосогласована на всех объектах');
process.exit(bad ? 1 : 0);
