/** Все открытые стенды распознавания подряд. Запуск: node bench/all.js (exit 1 при любом провале). */
const { spawnSync } = require('child_process');
let bad = 0;
for (const f of ['spec_galf.js', 'replay.js', 'estimate_order.js']) {
    console.log(`\n=== ${f} ===`);
    const r = spawnSync(process.execPath, [require('path').join(__dirname, f)], { stdio: 'inherit' });
    if (r.status) bad++;
}
console.log(bad ? `\nПровалено стендов: ${bad}` : '\nВсе стенды зелёные');
process.exit(bad ? 1 : 0);
