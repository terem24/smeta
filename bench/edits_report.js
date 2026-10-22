/**
 * Разбор правок монтажников в архиве распознавания планов и проектов.
 *
 * Правило 6 из CLAUDE.md: правки пишутся в архив (result[].edits, rec, src; counts.replaced), и раз в
 * неделю по ним ищут повторяющиеся ошибки, чтобы превратить их в правила. Этот скрипт и есть
 * «раз в неделю»: из выгрузки архива он собирает, какие поля правят чаще, как именно, на каких
 * источниках (модель или чертёж) и что удаляют.
 *
 * Архив лежит на Beget, читать его может только администратор (вкладка «Распознавание» в приложении),
 * поэтому json-ы выкачиваются руками, как для bench/from_archive.js, и кладутся в любую папку.
 *
 * Запуск:
 *   node bench/edits_report.js путь/к/папке            отчёт в консоль
 *   node bench/edits_report.js путь/к/папке --since 2026-10-01   только записи с этой даты (по имени папки)
 *   node bench/edits_report.js путь/к/папке --json > отчёт.json
 *
 * Что считается ошибкой распознавания, а что нет. Правка поля, которое взято из чертежа
 * (src[поле] = 'pdf'), — самая тревожная: программа прочла чертёж и ошиблась, или чертёж прочитан
 * верно, а монтажник знает лучше. Правка поля от модели — ожидаемая цена зрения. Удаление строки —
 * лишнее помещение. Поэтому отчёт делит правки на эти три корзины.
 */

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const DIR = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--since');
const AS_JSON = argv.includes('--json');
const sinceAt = argv.indexOf('--since');
const SINCE = sinceAt >= 0 ? argv[sinceAt + 1] : null;

if (!DIR) {
  console.error('Укажите папку с json-ами архива: node bench/edits_report.js ./выгрузка');
  process.exit(1);
}

function collect(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collect(full, out);
    else if (e.name.toLowerCase().endsWith('.json') && !/^(limits|access)\.json$/i.test(e.name)) out.push(full);
  }
  return out;
}

/** Дата записи из пути: archive/2026-10-05/123_user.json. */
function dayOf(file) {
  const m = file.replace(/\\/g, '/').match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

const files = collect(DIR).filter((f) => !SINCE || dayOf(f) >= SINCE);
if (!files.length) {
  console.error('В папке нет json-файлов' + (SINCE ? ' с ' + SINCE : '') + '.');
  process.exit(1);
}

const stat = {
  records: 0, withRows: 0, rows: 0, editedRows: 0, deletedRows: 0, skipped: 0,
  users: new Set(),
};
// поле → { n, bySrc: { pdf, model } }
const fields = {};
// «поле: было → стало» → сколько раз (для названий и малых значений)
const pairs = {};
// числовые поля: распределение сдвига (стало − было)
const deltas = { area: [], windows: [], outerWalls: [], heaters: [] };
const deleted = {};
const pdfEdits = [];   // правки полей, взятых из чертежа: самые ценные для разбора

function bump(map, key, by = 1) { map[key] = (map[key] || 0) + by; }

for (const f of files) {
  let data;
  try { data = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { stat.skipped++; continue; }
  const rows = Array.isArray(data && data.result) ? data.result : null;
  if (!rows) { stat.skipped++; continue; }
  stat.records++;
  if (data.user) stat.users.add(String(data.user));
  let any = false;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    stat.rows++;
    if (r.deleted) {
      stat.deletedRows++; any = true;
      bump(deleted, norm(r.name) || '(без названия)');
      continue;
    }
    const e = r.edits;
    if (!e || typeof e !== 'object') continue;
    stat.editedRows++; any = true;
    for (const k of Object.keys(e)) {
      const pair = e[k];
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const [was, now] = pair;
      const fromPdf = !!(r.src && r.src[k] === 'pdf');
      const rec = fields[k] || (fields[k] = { n: 0, pdf: 0, model: 0 });
      rec.n++; rec[fromPdf ? 'pdf' : 'model']++;
      if (k === 'name') bump(pairs, `название: «${was}» → «${now}»`);
      else if (k === 'ufh' || k === 'panoramic' || k === 'fix') bump(pairs, `${k}: ${JSON.stringify(was)} → ${JSON.stringify(now)}`);
      if (typeof was === 'number' && typeof now === 'number' && deltas[k]) deltas[k].push(now - was);
      if (fromPdf) pdfEdits.push({ day: dayOf(f), room: r.name, field: k, was, now });
    }
  }
  if (any) stat.withRows++;
}

const top = (map, n) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);
function summarize(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, median: q(0.5), p25: q(0.25), p75: q(0.75), up: s.filter((x) => x > 0).length, down: s.filter((x) => x < 0).length };
}

const report = {
  files: files.length,
  records: stat.records,
  skipped: stat.skipped,
  users: stat.users.size,
  rows: stat.rows,
  editedRows: stat.editedRows,
  deletedRows: stat.deletedRows,
  editedShare: stat.rows ? +(100 * (stat.editedRows + stat.deletedRows) / stat.rows).toFixed(1) : 0,
  fields,
  deltas: Object.fromEntries(Object.entries(deltas).map(([k, v]) => [k, summarize(v)])),
  topPairs: top(pairs, 20),
  topDeleted: top(deleted, 15),
  pdfEdits: pdfEdits.slice(0, 40),
};

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const out = [];
out.push(`Файлов: ${report.files}, записей с помещениями: ${report.records}, пропущено: ${report.skipped}, пользователей: ${report.users}`);
out.push(`Строк всего: ${report.rows}; правили: ${report.editedRows}; удалили: ${report.deletedRows} (${report.editedShare} % строк тронуты)`);
out.push('');
out.push('Какие поля правят (всего / из чертежа / от модели):');
Object.entries(fields).sort((a, b) => b[1].n - a[1].n).forEach(([k, v]) => {
  out.push(`  ${k.padEnd(11)} ${String(v.n).padStart(5)}   pdf ${String(v.pdf).padStart(4)}   модель ${String(v.model).padStart(4)}`);
});
const dl = Object.entries(report.deltas).filter(([, v]) => v);
if (dl.length) {
  out.push('');
  out.push('Сдвиг числовых правок (стало − было): медиана [25–75 %], вверх / вниз:');
  dl.forEach(([k, v]) => out.push(`  ${k.padEnd(11)} ${v.median} [${v.p25}…${v.p75}]  ↑${v.up} ↓${v.down}  (n=${v.n})`));
}
if (report.topPairs.length) {
  out.push('');
  out.push('Повторяющиеся исправления (кандидаты в правила):');
  report.topPairs.filter(([, n]) => n > 1).forEach(([k, n]) => out.push(`  ${String(n).padStart(3)}×  ${k}`));
}
if (report.topDeleted.length) {
  out.push('');
  out.push('Чаще всего удаляют (лишние помещения):');
  report.topDeleted.forEach(([k, n]) => out.push(`  ${String(n).padStart(3)}×  ${k}`));
}
if (pdfEdits.length) {
  out.push('');
  out.push(`Правки полей, ВЗЯТЫХ ИЗ ЧЕРТЕЖА (${pdfEdits.length}) — сначала разбирать их:`);
  pdfEdits.slice(0, 20).forEach((p) => out.push(`  ${p.day} ${p.room}: ${p.field} ${JSON.stringify(p.was)} → ${JSON.stringify(p.now)}`));
}
console.log(out.join('\n'));
