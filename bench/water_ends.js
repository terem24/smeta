/**
 * Стенд «сходится ли раздел 5 (водоснабжение) по концам коллекторов».
 *
 * Для каждого коллектора ХВС/ГВС/рециркуляции проверяется:
 *   1. заглушка торца или футорка под компенсатор гидроудара — того же размера,
 *      что вход коллектора (торец — внутренняя резьба размера входа; у блока 1"×3/4"
 *      это 1", у 3/4"×3/4" — 3/4");
 *   2. число евроконусов равно числу выходов коллекторов с выходом «евроконус 3/4"»;
 *      у цанговых выходов (1/2", connType compression) евроконусов быть не должно;
 *   3. в каждой линии (5.1/5.2/5.3) ровно один торец закрыт (заглушка или компенсатор
 *      с футоркой).
 *
 * Запуск (из корня репозитория):  node bench/water_ends.js
 * Выход с кодом 1, если есть расхождения.
 */
const app = require('./env.js');

const zones = () => [
    { name: 'санузел 1', dist: 8, fixtures: { toilet: 1, basin: 2, shower: 1, bath: 1, wash: 1, dish: 1 } },
    { name: 'санузел 2', dist: 6, fixtures: { toilet: 1, basin: 1, shower: 0, bath: 0, wash: 0, dish: 0 } },
    { name: 'кухня', dist: 5, fixtures: { toilet: 0, basin: 1, shower: 0, bath: 0, wash: 0, dish: 2 } }
];

const OBJECTS = [];
['pex', 'metal_plastic'].forEach(mat => ['standard', 'block'].forEach(mt => [false, true].forEach(rc => ['stout', 'rommer'].forEach(br =>
    OBJECTS.push({ title: `${mat} / ${mt} / ${rc ? 'с рециркуляцией' : 'без рециркуляции'} / ${br}`, o: { area: 200, water: true, recirc: rc, waterPipeMaterial: mat, waterManifoldType: mt, waterZones: zones(), brandMode: br } })))));
// ручная замена коллектора на 3/4"×3/4"
OBJECTS.push({ title: 'замена коллектора на 3/4"×3/4"', o: { area: 200, water: true, recirc: true, waterZones: zones(), swaps: { 'SMB-6851-343402_water': 'SMB-6851-343402', 'SMB-6851-343403_water': 'SMB-6851-343403', 'SMB-6851-343404_water': 'SMB-6851-343404' } } });

const inOf = n => { const m = n.match(/(\d(?:\/\d)?)["″]\s?[\/xх×]\s?\d(?:\/\d)?["″]/) || n.match(/блок (\d(?:\/\d)?)["″]/i); return m ? m[1] : null; };
const outOf = n => { const m = n.match(/\d(?:\/\d)?["″]\s?[\/xх×]\s?(\d(?:\/\d)?)["″]/); return m ? m[1] : '3/4'; };

let bad = 0;
OBJECTS.forEach(({ title, o }) => {
    app.state.brandMode = 'stout';
    app.__setup(o);
    const list = (app.currentEquipmentList || []).filter(i => /^5\./.test(String(i.sectionTitle || i.group || '')));
    const problems = [];
    ['5.1.', '5.2.', '5.3.'].forEach(g => {
        const L = list.filter(i => String(i.group || i.sectionTitle).startsWith(g));
        const colls = L.filter(i => /коллектор|блок/i.test(i.name) && !/заглушк|компенсатор|евроконус/i.test(i.name));
        if (!colls.length) return;
        const inSz = inOf(colls[0].name) || '3/4';
        const plugs = L.filter(i => /^Заглушка/i.test(i.name));
        const adapters = L.filter(i => /^Футорка/i.test(i.name));
        const hammers = L.filter(i => /омпенсатор гидроудара/i.test(i.name));
        const ends = plugs.length + hammers.length;
        if (ends !== 1) problems.push(`${g} торцов закрыто ${ends}, должен быть 1`);
        plugs.forEach(p => { const m = p.name.match(/(\d(?:\/\d)?)["″]/); if (m && m[1] !== inSz) problems.push(`${g} заглушка ${m[1]}" в торец ${inSz}": ${p.name}`); });
        adapters.forEach(p => { const m = p.name.match(/(\d(?:\/\d)?)["″]/); if (m && m[1] !== inSz) problems.push(`${g} футорка ${m[1]}" в торец ${inSz}": ${p.name}`); });
        if (hammers.length && !adapters.length) problems.push(`${g} компенсатор без футорки`);
        const euro = L.filter(i => /Евроконус/i.test(i.name)).reduce((s, i) => s + (i.q || 1), 0);
        const ek = colls.some(c => outOf(c.name) === '3/4') && !colls.some(c => /запорными клапанами.*1\/2|шаровыми.*1\/2/i.test(c.name));
        const comp = colls.some(c => outOf(c.name) === '1/2');
        if (comp && euro > 0 && ek === false) problems.push(`${g} евроконусы (${euro}) у коллектора с цанговыми выходами 1/2": ${colls.map(c => c.name).join('; ')}`);
    });
    console.log('=== ' + title + (problems.length ? '' : '  — сходится'));
    problems.forEach(p => { console.log('  ✗ ' + p); bad++; });
});
console.log(bad ? `\nРасхождений: ${bad}` : '\nВсе объекты сходятся');
process.exit(bad ? 1 : 0);
