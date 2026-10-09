/**
 * Стенд «одна система труб на весь раздел»: после смены материала трубы
 * (металлопластик ↔ сшитый полиэтилен) в смете не должно остаться фитингов
 * другой системы. Аксиальные (гильзы, переходники) — только под PEX и стабильную,
 * пресс SFP- — только под металлопластик.
 *
 *   node bench/pipe_system.js          итог
 *   node bench/pipe_system.js detail   плюс список позиций каждого объекта
 */
const app = require('./env.js');
const detail = process.argv[2] === 'detail';

// Аксиальная линейка (PEX): монтажные гильзы, переходники, тройники
const AXIAL = /^(SFA-0020-|SFA-0001-|SFA-0034-|SFA-0013-|SFA-0014-|RFA-0020-|RFA-0034-)/;
const PRESS = /^SFP-/;

// Две комнаты: гостиная с окном в пол (внутрипольный конвектор) и спальня с обычным окном
const ROOMS = () => [
    { id: 11, name: 'Гостиная', area: 30, floor: 1, sys: ['rad'], windows: [{ id: 12, width: 3, isPan: true }] },
    { id: 21, name: 'Спальня', area: 16, floor: 1, sys: ['rad'], windows: [{ id: 22, width: 1.5, isPan: false }] }
];

const CASES = [
    { title: 'радиаторы + конвектор, МП', mp: true, o: { area: 200, systems: ['rad'], detailedRooms: true, rooms: ROOMS(), convectorType: 'scn', pipeType: 'insulated_mp' } },
    { title: 'радиаторы, МП без изоляции', mp: true, o: { area: 150, systems: ['rad'], pipeType: 'split_mp' } },
    { title: 'тёплый пол, МП', mp: true, o: { area: 200, systems: ['rad', 'tp'], tp1: 80, ufhPipe: 'mp16', ufhPipeMaterial: 'metal_plastic', pipeType: 'insulated_mp' } },
    { title: 'вода, МП', mp: true, o: { area: 150, water: true, waterPipeMaterial: 'metal_plastic', pipeType: 'insulated_mp' } },
    { title: 'радиаторы + конвектор, PEX (контроль)', mp: false, o: { area: 200, systems: ['rad'], detailedRooms: true, rooms: ROOMS(), convectorType: 'scn', pipeType: 'insulated' } }
];

let bad = 0;
CASES.forEach(({ title, mp, o }) => {
    app.state.brandMode = 'stout';
    app.__setup(o);
    const foreign = app.currentEquipmentList.filter(it =>
        /^[3-6]\./.test(String(it.sectionTitle || '')) &&
        (mp ? AXIAL : PRESS).test(String(it.originalId || it.id || '')));
    console.log((foreign.length ? '✗ ' : '✓ ') + title + (foreign.length ? ' — чужая система: ' + foreign.length : ''));
    if (foreign.length) bad++;
    if (detail || foreign.length) foreign.forEach(it => console.log('     ' + it.sectionTitle + ' | ' + it.id + ' | ' + it.name + ' × ' + it.q));
});
process.exit(bad ? 1 : 0);
