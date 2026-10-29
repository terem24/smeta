// Сборка app.min.js из app.js — именно его грузит index.html (app.js тяжелее в два раза).
// Запуск после каждой правки app.js:  node tools/minify_app.js
// Проверка без записи (для предпушевого шага):  node tools/minify_app.js --check
// Terser берётся через npx, package.json в проекте не нужен.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const out = path.join(root, 'app.min.js');
const check = process.argv.includes('--check');

const tmp = path.join(root, 'app.min.tmp.js');
// Пути с пробелами и «&» в имени папки: запускаем из корня, без shell и с относительными именами
const run = spawnSync('npx', ['--yes', 'terser@5', 'app.js', '-c', '-m', '-o', 'app.min.tmp.js'], { cwd: root, shell: true, stdio: 'inherit' });
if (run.status !== 0) { console.error('terser не отработал'); process.exit(1); }

const fresh = fs.readFileSync(tmp, 'utf8');
fs.unlinkSync(tmp);

const syntax = spawnSync(process.execPath, ['--check', '-'], { input: fresh });
if (syntax.status !== 0) { console.error('app.min.js не проходит node --check'); process.exit(1); }

if (check) {
    const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (current !== fresh) { console.error('app.min.js устарел: запустите node tools/minify_app.js'); process.exit(1); }
    console.log('app.min.js актуален');
} else {
    fs.writeFileSync(out, fresh, 'utf8');
    console.log('app.min.js записан: ' + fresh.length + ' байт');
}
