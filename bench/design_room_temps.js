/**
 * Внутренние температуры по типам помещений: что ставят проектировщики (Тв в
 * листах «Расчет теплопотерь») против наших ROOM_KINDS.
 *
 * Название комнаты берётся из экспликации (galf_rooms.csv, bench/heat_rooms.js),
 * Тв — из листа расчёта (galf_heatcalc.json, bench/heat_calc_sheets.js); связь —
 * по номеру помещения в пределах проекта.
 *
 * Запуск (из корня worktree):
 *   node bench/design_room_temps.js "D:\galf_chat2\galf_rooms.csv" "D:\galf_chat2\galf_heatcalc.json"
 */
const fs = require('fs');
const path = require('path');

const [csvPath, jsonPath] = process.argv.slice(2);
if (!csvPath || !jsonPath) { console.log('node bench/design_room_temps.js <galf_rooms.csv> <galf_heatcalc.json>'); process.exit(0); }

// Типы и температуры — из самого калькулятора, а не копией.
process.chdir(path.join(__dirname, '..'));
const app = require('./env.js');
const OURS = app.ROOM_KINDS.map(k => ({ id: k.id, name: k.name, t: k.t, re: k.re }));
const kindOf = name => { const n = String(name).toLowerCase(); const k = OURS.find(k => k.re.test(n)); return k ? k.id : null; };

function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
        else if (c === '"') q = true; else if (c === ';') { row.push(cell); cell = ''; }
        else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const head = rows.shift().map(h => h.replace(/^\ufeff/, ''));
    return rows.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
// «1.01» и «1.1», «2» и «02» — один и тот же номер.
const normId = s => String(s).trim().replace(/^0+(?=\d)/, '').split(/[.,]/).map(p => p.replace(/^0+(?=\d)/, '')).join('.');

const rooms = parseCsv(fs.readFileSync(csvPath, 'utf8'));
const byFile = new Map();
rooms.forEach(r => { if (!byFile.has(r['проект'])) byFile.set(r['проект'], new Map()); byFile.get(r['проект']).set(normId(r['номер']), r); });
const calc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

const stat = {}; let matched = 0, total = 0, unk = 0;
const unknownNames = new Map();
for (const p of calc) {
    const names = byFile.get(p.file);
    for (const rm of p.rooms) {
        if (!rm.rows.length) continue;
        total++;
        const tv = rm.rows[0].tv;
        const hit = names && names.get(normId(rm.id));
        if (!hit) continue;
        matched++;
        const k = kindOf(hit['помещение']);
        if (!k) { unk++; const n = hit['помещение'].toLowerCase().trim(); unknownNames.set(n, (unknownNames.get(n) || 0) + 1); continue; }
        (stat[k] = stat[k] || []).push(tv);
    }
}
const med = a => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const mode = a => { const m = new Map(); a.forEach(v => m.set(v, (m.get(v) || 0) + 1)); return [...m].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([v, n]) => `${v}°×${n}`).join(' '); };
console.log(`Комнат в расчётах: ${total}; названия найдены: ${matched}; тип не узнан по нашим правилам: ${unk}`);
console.log('\nтип помещения (наш)                    наш Tв   проектировщик: медиана   чаще всего                  комнат');
for (const k of OURS) {
    const a = stat[k.id]; if (!a) continue;
    console.log(`${k.name.padEnd(38)} ${String(k.t).padStart(5)}   ${String(med(a)).padStart(10)}              ${mode(a).padEnd(26)} ${String(a.length).padStart(6)}`);
}
console.log('\nНазвания, которых наши правила не узнают (чаще всего):');
[...unknownNames].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([n, c]) => console.log(`  ${String(c).padStart(4)}  ${n}`));
