// Живая замена трубы строкой сметы (как кнопка «Заменить»): после неё в разделе не должно
// остаться фитингов прежней системы. node bench/pipe_swap_clicks.js
const app = require('./env.js');
const log = console.log;
const ROOMS = () => [
    { id: 11, name: 'Гостиная', area: 30, floor: 1, sys: ['rad', 'tp'], windows: [{ id: 12, width: 3, isPan: true }] },
    { id: 21, name: 'Спальня', area: 16, floor: 1, sys: ['rad', 'tp'], windows: [{ id: 22, width: 1.5, isPan: false }] }
];
const AXIAL = /^[SR]FA-(0020|0001|0034|0013|0014)-/;
const PRESS = /^SFP-/;
const quiet = f => { console.log = () => { }; try { return f(); } finally { console.log = log; } };
const rows = (re) => app.currentEquipmentList.filter(it => re.test(String(it.sectionTitle || '')));
const idOf = it => String(it.originalId || it.id);
let bad = 0;
function report(title, sectionRe, wantMp) {
    const foreign = rows(sectionRe).filter(it => (wantMp ? AXIAL : PRESS).test(idOf(it)));
    if (foreign.length) bad++;
    log((foreign.length ? '✗ ' : '✓ ') + title + (foreign.length ? ' — чужих: ' + foreign.map(i => i.id + '×' + i.q).join(' ') : ''));
}
function click(pickRow, chosen) {
    const r = app.currentEquipmentList.find(pickRow);
    if (!r) { log('  (нет строки для клика)'); bad++; return false; }
    quiet(() => { app.selectSwapAlternative(r.originalId || r.id, chosen); app.render(); });
    return true;
}

// 1. Радиаторная труба: PEX → МП → стабильная → PEX
quiet(() => app.__setup({ area: 200, systems: ['rad'], detailedRooms: true, rooms: ROOMS(), convectorType: 'scn' }));
if (click(it => /_rad$/.test(idOf(it)) && /^3\./.test(it.sectionTitle), 'split_mp')) report('радиаторы: клик на металлопластик', /^3\./, true);
if (click(it => /_rad$/.test(idOf(it)) && /^3\./.test(it.sectionTitle), 'stable_16')) report('радиаторы: клик на стабильную', /^3\./, false);
if (click(it => /_rad$/.test(idOf(it)) && /^3\./.test(it.sectionTitle), 'insulated')) report('радиаторы: клик обратно на PEX', /^3\./, false);

// 2. Тёплый пол
quiet(() => app.__setup({ area: 200, systems: ['rad', 'tp'], tp1: 80 }));
const ufhRow = it => /^4\./.test(it.sectionTitle) && (/_ufh$/.test(idOf(it)) || /^(SPX-0002-|SPM-0001-|SPS-0002-)/.test(idOf(it)));
const mpAlt = (app.UFH_PIPES.find(p => p.material === 'metal_plastic') || {}).coils;
if (mpAlt && click(ufhRow, mpAlt[0])) report('тёплый пол: клик на металлопластик', /^4\./, true);

// 3. Вода
quiet(() => app.__setup({ area: 150, systems: ['rad', 'water'], water: true, waterZones: [{ id: 1, name: 'С/у', floor: 1, dist: 8, fixtures: { toilet: 1, basin: 1, shower: 1, bath: 0, wash: 1, dish: 1, bidet: 0 } }] }));
const waterRow = it => /^5\./.test(it.sectionTitle) && /^SPX-0001-/.test(idOf(it));
if (click(waterRow, 'SPM-0001-101620')) report('вода: клик на металлопластик', /^5\./, true);

process.exit(bad ? 1 : 0);
