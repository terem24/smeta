/**
 * Стенд схемы подключения ectoControl: рисует лист «Схема подключения автоматики» для типовых котельных
 * и складывает SVG в папку (по умолчанию — scratch/ecto_scheme), чтобы открыть глазами.
 *
 * Запуск из корня репозитория:
 *   node bench/myheat_scheme.js [папка]
 *   node bench/myheat_scheme.js [папка] --png   — ещё и снимок через headless Chrome (нужен Chrome в обычном месте)
 *
 * Чего стенд не видит: настоящих стилей страницы и шрифтов листов — SVG собирается как есть,
 * шрифт подставляет браузер. Проверяет состав строк, нумерацию и то, что функция не падает.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const app = require('./env.js');

const out = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(__dirname, '..', 'scratch', 'ecto_scheme'));
fs.mkdirSync(out, { recursive: true });
const wantPng = process.argv.includes('--png');

const root = path.join(__dirname, '..');
['project_sheets.js', 'project_scheme.js'].forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), app.__ctx, { filename: f });
});

const PRO = { accountType: 'pro', tgUser: { id: 1, account_type: 'pro' }, boilerAuto: true, boilerAutoBrand: 'ecto' };
const OBJECTS = [
    { name: 'plain', title: '120 м², радиаторы', o: { area: 120, res: 3 } },
    { name: 'mix', title: '200 м², радиаторы + тёплый пол', o: { area: 200, systems: ['rad', 'tp'], tp1: 80 } },
    { name: 'recirc', title: '150 м², рециркуляция', o: { area: 150, recirc: true } },
    { name: 'full', title: '200 м², подробный: протечка, воздух, давление', o: { area: 200, systems: ['rad', 'tp'], tp1: 80, detailedRooms: true, leakProtect: true, airControl: true, airDeviceType: 'sensor', airLink: 'wired', heatingFeed: true } },
    { name: 'cascade', title: '300 м², газ + резервный электрокотёл', o: { area: 300, res: 6, systems: ['rad', 'tp'], tp1: 120, fuels: ['gas', 'el'] } },
    { name: 'snow', title: '200 м², снеготаяние', o: { area: 200, systems: ['rad', 'tp'], tp1: 80, snowMelt: true } }
];

let bad = 0;
OBJECTS.forEach(({ name, title, o }) => {
    try {
        app.__setup(Object.assign({}, PRO, o));
        const art = app.automationSchemeArt();
        if (!art || !art.svg) { console.log('  ' + name + ' — схемы нет'); bad++; return; }
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + art.w + ' ' + art.h + '" width="1680" height="' + Math.round(1680 * art.h / art.w) + '" style="background:#fff;font-family:Arial,sans-serif">' + art.svg + '</svg>';
        const f = path.join(out, name + '.svg');
        fs.writeFileSync(f, svg);
        const cfg = app.thermaticConfig;
        console.log('  ' + name.padEnd(12) + ' ' + (cfg.ec ? cfg.ec.model.short : '?').padEnd(10) + ' h=' + Math.round(art.h) + '  ' + title);
        if (wantPng) {
            const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
            if (chrome) spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--screenshot=' + path.join(out, name + '.png'),
                '--window-size=1700,' + (Math.round(1680 * art.h / art.w) + 40), 'file:///' + f.replace(/\\/g, '/')], { stdio: 'ignore', timeout: 60000 });
        }
    } catch (e) {
        bad++;
        console.log('  ' + name + ' — ПАДЕНИЕ: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
    }
});
console.log(bad ? '\nПроблем: ' + bad : '\nСхемы построены: ' + out);
process.exit(bad ? 1 : 0);
