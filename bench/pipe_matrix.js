// Матрица: материал трубы × схема × этажи → какие фитинги семейств SFA/RFA (аксиал) и SFP (пресс) в разделах 3–6
const app = require('./env.js');
const ROOMS = () => [
    { id: 11, name: 'Гостиная', area: 30, floor: 1, sys: ['rad'], windows: [{ id: 12, width: 3, isPan: true }] },
    { id: 21, name: 'Спальня', area: 16, floor: 2, sys: ['rad'], windows: [{ id: 22, width: 1.5, isPan: false }] }
];
const fam = id => /^[SR]FA-/.test(id) ? 'аксиал' : /^SFP-/.test(id) ? 'пресс' : /^[SR]?FC-|^SFC-/.test(id) ? 'евроконус' : null;
const log = console.log; console.log = () => { };
const out = [];
['insulated', 'split', 'insulated_mp', 'split_mp', 'stable_16'].forEach(pt => {
    ['collector', 'tee'].forEach(sch => {
        [1, 2].forEach(fl => {
            const o = { area: 200, floors: fl, systems: ['rad'], detailedRooms: true, rooms: ROOMS(), convectorType: 'scn', pipeType: pt };
            if (sch === 'tee') o.radConnectionScheme = 'tee';
            app.__setup(o);
            const rows = app.currentEquipmentList.filter(it => /^3\./.test(String(it.sectionTitle || '')) && fam(String(it.originalId || it.id)));
            const fams = {};
            rows.forEach(it => { const f = fam(String(it.originalId || it.id)); (fams[f] = fams[f] || []).push(it.id + '×' + it.q); });
            out.push(pt.padEnd(13) + sch.padEnd(10) + 'этажей ' + fl + '  ' + Object.keys(fams).map(f => f + ': ' + fams[f].join(' ')).join('  |  '));
        });
    });
});
console.log = log;
out.forEach(l => log(l));
