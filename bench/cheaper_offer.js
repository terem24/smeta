/**
 * «Могла бы стоить дешевле»: для каждой последней сметы считает, сколько она
 * стоила бы в режиме «Бюджетнее» (ROMMER и аналоги) против STOUT, и печатает
 * экономию в рублях и процентах. Считает сама смета через песочницу bench/env.js,
 * без отдельных формул, — поэтому цифра совпадает с тем, что увидит клиент в программе.
 *
 * Вход — JSON-файл: массив { id, name, calc_data } (calc_data — состояние сметы,
 * поле estimates.calc_data). Сохранить выгрузку можно вне репозитория, например
 * в scratch/ (она в .gitignore не попадает, поэтому файл не коммитьте).
 *
 *   node bench/cheaper_offer.js <выгрузка.json> [--out отчёт.json] [--sql запись.sql]
 *
 * В --out пишется { id: { base, cheap, saveRub, savePct } }.
 * В --sql пишется upsert для таблицы offer_savings: её читает админка в предложении «Профи».
 * В выгрузке у каждой строки нужен estimate_id (e.id), иначе он будет пустым.
 */
const fs = require('fs');
const app = require('./env.js');

const args = process.argv.slice(2);
const inFile = args[0];
const outIdx = args.indexOf('--out');
const outFile = outIdx > -1 ? args[outIdx + 1] : null;
if (!inFile) { console.error('Нужен JSON-файл с массивом { id, name, calc_data }'); process.exit(1); }

const rows = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const report = {};
// Значения по умолчанию, которые init() кладёт в состояние; сохранённая смета поверх них
const defaults = JSON.parse(JSON.stringify(app.state || {}));

for (const row of rows) {
    try {
        // Копия состояния сметы поверх умолчаний; эта правка только в песочнице, в базу ничего не пишется
        const state = Object.assign(JSON.parse(JSON.stringify(defaults)), JSON.parse(JSON.stringify(row.calc_data || {})));
        state.brandMode = 'rommer';
        state.sectionAnalog = {};
        app.state = state;
        app._boilerRangeCache = null;
        // Базовая смета (STOUT без аналогов) и тихий прогон — тем же кодом, что у кнопки «Бюджетнее»
        app.computeCheapBaseline();
        const base = app._cheapBase && app._cheapBase.eq;
        app.render(true);
        const cheap = Math.round(app.calcFinalTotal || 0);
        if (!base || !cheap) { report[row.id] = { name: row.name, error: 'смета не посчиталась' }; continue; }
        const saveRub = base - cheap;
        report[row.id] = {
            name: row.name,
            base,
            cheap,
            saveRub,
            savePct: Math.round((saveRub / base) * 1000) / 10
        };
    } catch (e) {
        report[row.id] = { name: row.name, error: String(e && e.message || e) };
    }
}

for (const [id, r] of Object.entries(report)) {
    if (r.error) console.log(`${id}  ${r.name || ''}  — ошибка: ${r.error}`);
    else console.log(`${id}  ${r.name || ''}  STOUT ${r.base} ₽ → Бюджетнее ${r.cheap} ₽  экономия ${r.saveRub} ₽ (${r.savePct} %)`);
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');

// --sql <файл> — SQL для таблицы offer_savings (миграция 20261029_offer_savings.sql):
// строка на пользователя, при повторе перезаписывается
const sqlIdx = args.indexOf('--sql');
if (sqlIdx > -1) {
    const esc = (s) => String(s).replace(/'/g, "''");
    const lines = rows.filter(r => report[r.id] && !report[r.id].error).map(r => {
        const x = report[r.id];
        const est = r.estimate_id ? `'${esc(r.estimate_id)}'` : 'null';
        return `('${esc(r.id)}', ${est}, ${x.base}, ${x.cheap}, ${x.saveRub}, ${x.savePct})`;
    });
    const sql = lines.length
        ? 'insert into public.offer_savings (user_id, estimate_id, base_sum, cheap_sum, save_rub, save_pct) values\n'
          + lines.join(',\n')
          + '\non conflict (user_id) do update set estimate_id = excluded.estimate_id, base_sum = excluded.base_sum,'
          + ' cheap_sum = excluded.cheap_sum, save_rub = excluded.save_rub, save_pct = excluded.save_pct, computed_at = now();\n'
        : '-- нет посчитанных смет\n';
    fs.writeFileSync(args[sqlIdx + 1], sql, 'utf8');
}
