/**
 * Заготовка для equivalents.js из ручных замен монтажников.
 *
 * Читает ту же выгрузку архива, что и bench/from_archive.js, берёт строки, где
 * монтажник сам выбрал артикул (manual) или подставилась его прошлая замена
 * (fromMem), и печатает кандидатов в таблицу прямых замен. Регулярка строится
 * по артикулу чужого изделия, если он есть в строке, иначе по началу названия.
 * Кандидат — не решение: пара встречается в нескольких сметах разных людей —
 * тогда в списке выше (count), и только после проверки её переносят в
 * equivalents.js.
 *
 * Запуск: node bench/equiv_from_archive.js путь/к/выгрузке > новые_замены.json
 */
const fs = require('fs'), path = require('path');
const DIR = process.argv[2];
if (!DIR) { console.error('Укажите папку с json-ами архива'); process.exit(1); }

function collect(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collect(full, out);
    else if (e.name.toLowerCase().endsWith('.json') && !/^(limits|access)\.json$/i.test(e.name)) out.push(full);
  }
  return out;
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CODE = /[A-Za-zА-Яа-я][A-Za-z0-9А-Яа-я.\-\/]{6,}/g;

const pairs = new Map();
for (const f of collect(DIR)) {
  let data; try { data = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { continue; }
  for (const r of (Array.isArray(data && data.result) ? data.result : [])) {
    if (!(r.manual || r.fromMem) || !r.matched || r.matched.id == null) continue;
    const raw = String(r.raw || '').trim();
    if (raw.length < 6) continue;
    const code = (raw.match(CODE) || []).find((t) => (t.match(/\d/g) || []).length >= 2 && /[A-Za-z]/.test(t));
    const re = code ? esc(code) : esc(raw.toLowerCase().replace(/\s+/g, ' ').slice(0, 40));
    const key = re + '→' + r.matched.id;
    const e = pairs.get(key) || { re, flags: 'i', id: String(r.matched.id), note: 'ручная замена монтажников: ' + (r.matched.name || ''), example: raw, count: 0 };
    e.count++;
    pairs.set(key, e);
  }
}
const list = [...pairs.values()].sort((a, b) => b.count - a.count);
console.log(JSON.stringify(list, null, 2));
console.error(`кандидатов: ${list.length}, из них повторяются в нескольких сметах: ${list.filter((x) => x.count > 1).length}`);
