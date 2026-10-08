// Матрица: тёплый пол и вода × материал трубы → фитинги семейств аксиал/пресс/евроконус по разделам
const app = require('./env.js');
const fam = id => /^[SR]FA-/.test(id) ? 'аксиал' : /^SFP-/.test(id) ? 'пресс' : /^SFC-0020/.test(id) ? 'евроконус' : null;
const log = console.log; console.log = () => { };
const out = [];
function dump(title, o, re) {
    app.__setup(o);
    const by = {};
    app.currentEquipmentList.filter(it => re.test(String(it.sectionTitle || ''))).forEach(it => {
        const f = fam(String(it.originalId || it.id)); if (!f) return;
        const k = String(it.sectionTitle).slice(0, 24) + ' / ' + f; (by[k] = by[k] || []).push(it.id + '×' + it.q);
    });
    out.push('== ' + title); Object.keys(by).forEach(k => out.push('   ' + k + ': ' + by[k].join(' ')));
}
[['pex16', 'pex'], ['mp16', 'metal_plastic'], ['stable16', 'stable']].forEach(([k, m]) =>
    dump('ТП ' + k, { area: 200, systems: ['rad', 'tp'], tp1: 80, ufhPipe: k, ufhPipeMaterial: m }, /^4\./));
['pex', 'metal_plastic'].forEach(m =>
    dump('вода ' + m, { area: 150, water: true, houseBaths: 2, waterPipeMaterial: m }, /^(5|6|7)\./));
console.log = log; out.forEach(l => log(l));
