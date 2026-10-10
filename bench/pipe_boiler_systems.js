// Система обвязки котельной (раздел 1–2): в смете не должно быть труб и фитингов чужой системы.
// node bench/pipe_boiler_systems.js [detail]
const app = require('./env.js');
const detail = process.argv[2] === 'detail';

// Что ЧУЖОЕ для системы: регэкспы по артикулу (originalId или id)
const FOREIGN = {
    ss304: [/^SFP-/, /^SPM-/, /^RPM-/, /^SPS-/, /^RPS-/, /^SFA-00(20|01)-/, /^SSS-/, /^PA\d|^RCT/],
    ss316: [/^SFP-/, /^SPM-/, /^RPM-/, /^SPS-/, /^RPS-/, /^SFA-00(20|01)-/, /^RSS-/, /^PA\d|^RCT/],
    ppr: [/^SFP-/, /^SPM-/, /^RPM-/, /^SPS-/, /^RPS-/, /^SFA-00(20|01)-/, /^SSS-/, /^RSS-/],
    mp: [/^SPS-/, /^RPS-/, /^SFA-00(20|01)-/, /^RFA-/, /^SSS-/, /^RSS-/, /^PA\d|^RCT/],
    mp_r: [/^SPS-/, /^RPS-/, /^SFA-00(20|01)-/, /^RFA-/, /^SSS-/, /^RSS-/, /^PA\d|^RCT/],
    stable: [/^SFP-/, /^SPM-/, /^RPM-/, /^SSS-/, /^RSS-/, /^PA\d|^RCT/],
    stable_r: [/^SFP-/, /^SPM-/, /^RPM-/, /^SSS-/, /^RSS-/, /^PA\d|^RCT/]
};
const OBJECTS = [
    { t: '200 м², радиаторы + ТП', o: { area: 200, systems: ['rad', 'tp'], tp1: 80 } },
    { t: '150 м², рециркуляция ГВС', o: { area: 150, recirc: true } },
    { t: '300 м², газ + эл.котёл', o: { area: 300, res: 6, fuels: ['gas', 'el'], systems: ['rad', 'tp'], tp1: 80 } }
];
const log = console.log; let bad = 0; const lines = [];
Object.keys(FOREIGN).forEach(sys => {
    OBJECTS.forEach(({ t, o }) => {
        console.log = () => { };
        app.state.brandMode = 'stout';
        app.state.accountType = 'pro';
        app.__setup(Object.assign({ boilerPipeSystem: sys, accountType: 'pro' }, o));
        console.log = log;
        const foreign = app.currentEquipmentList.filter(it => /^[12]\./.test(String(it.sectionTitle || '')) &&
            FOREIGN[sys].some(re => re.test(String(it.originalId || it.id))));
        if (foreign.length) bad++;
        lines.push((foreign.length ? '✗ ' : '✓ ') + sys.padEnd(9) + t + (foreign.length ? ' — чужих: ' + foreign.length : ''));
        if (foreign.length || detail) foreign.forEach(it => lines.push('     ' + it.sectionTitle.slice(0, 20) + ' | ' + it.id + ' | ' + it.name + ' ×' + it.q));
    });
});
lines.forEach(l => log(l));
process.exit(bad ? 1 : 0);
