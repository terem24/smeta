/**
 * Песочница: поднимает catalog.js и app.js вне браузера и отдаёт готовый объект app.
 *
 * Зачем. Смета считается в render() — это пять тысяч строк, и проверить правку в
 * ней можно было только глазами, открыв сайт и пощёлкав. На таком способе
 * незаметны ровно те ошибки, которые дороже всего: позиция не исчезает с экрана,
 * а тихо меняет артикул или количество. Здесь смета считается целиком, и её
 * можно сравнить числом — до правки и после.
 *
 * Что это даёт на практике: за несколько дней стенд поймал подстановку хомута не
 * в ту ветку кода (падало только на полипропилене), интерполяцию, возвращавшую
 * ноль ровно в последней точке кривой насоса, и подпись «переходной тройник» у
 * равнопроходного артикула. Ни одну из трёх не видно, если просто смотреть на
 * смету.
 *
 * Как устроено. app.js пишет в десятки узлов страницы и создаёт клиента Supabase
 * на верхнем уровне, поэтому DOM и supabase-js заменены заглушками. Заглушки
 * намеренно «согласные»: getElementById всегда возвращает элемент, а не null, и
 * querySelectorAll — непустой список. Иначе render() падает на первой же записи
 * в innerHTML, не досчитав смету. Настоящую вёрстку так не проверить — стенд
 * меряет ЧИСЛА, а не внешний вид.
 *
 * Использование (запускать из корня репозитория — здесь лежат catalog.js и app.js):
 *   const app = require('./bench/env.js');
 *   app.state.area = 200; app.render();
 *   app.currentEquipmentList.forEach(...)
 *
 * render(true) считает смету, не трогая страницу и не отмечая расчёт в аналитике.
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const noop = () => {};

// Элемент-заглушка. Свойства, в которые пишет код (innerHTML, value, checked),
// хранятся по-настоящему: иначе не проверить, что именно туда положили.
const mkEl = () => new Proxy({
    style: { setProperty: noop, removeProperty: noop, getPropertyValue: () => '' },
    dataset: {}, value: '', innerHTML: '', textContent: '', checked: false,
    // syncUI ходит по вкладкам через .children[i] — список должен быть непустым.
    get children() { return Array.from({ length: 8 }, () => mkEl()); }
}, {
    get: (t, k) => {
        if (k in t) return t[k];
        if (k === 'classList') return { add: noop, remove: noop, toggle: noop, contains: () => false };
        if (k === 'parentNode' || k === 'firstChild' || k === 'lastChild' || k === 'nextSibling') return null;
        if (k === 'getBoundingClientRect') return () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 });
        if (k === 'querySelector') return () => mkEl();
        if (k === 'querySelectorAll') return () => [];
        // style отдаём строкой, а не null: у авторизованного пользователя render
        // правит инлайн-стили через getAttribute('style').replace(...), и на null
        // расчёт падал — то есть ПРОФИ-ветки стендом было не проверить вовсе.
        if (k === 'getAttribute') return (name) => (name === 'style' ? '' : null);
        if (k === 'closest') return () => null;
        return typeof k === 'string' ? noop : undefined;
    },
    set: (t, k, v) => { t[k] = v; return true; }
});

// Элементы помним по id: иначе каждая запись в innerHTML уходит в новый объект,
// и проверить, ЧТО именно код положил на страницу, нельзя — а это половина смысла
// стенда (текст подсказки, состав таблицы замены).
const _els = {};
const doc = {
    getElementById: (id) => (_els[id] || (_els[id] = mkEl())),
    querySelector: () => mkEl(),
    querySelectorAll: () => Array.from({ length: 8 }, () => mkEl()),
    createElement: () => mkEl(), createTextNode: () => mkEl(),
    addEventListener: noop, removeEventListener: noop,
    body: mkEl(), documentElement: mkEl(), head: mkEl(),
    cookie: '', readyState: 'complete'
};

const store = { getItem: () => null, setItem: noop, removeItem: noop, clear: noop };

const ctx = {
    console, document: doc, localStorage: store, sessionStorage: store,
    // Хост обязан быть localhost: в начале app.js стоит блокировка по домену.
    location: {
        hostname: 'localhost', host: 'localhost', href: 'http://localhost/',
        search: '', hash: '', protocol: 'http:', origin: 'http://localhost', reload: noop
    },
    navigator: { userAgent: 'node', language: 'ru', serviceWorker: { register: () => Promise.resolve() } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    addEventListener: noop, removeEventListener: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    getComputedStyle: () => ({ getPropertyValue: () => '', width: '0px', height: '0px', display: 'block' }),
    Image: function () {}, URL: { createObjectURL: () => '' },
    requestAnimationFrame: noop, performance: { now: () => 0 },
    alert: noop, confirm: () => false, prompt: () => null
};

// supabase-js: app.js создаёт клиента на верхнем уровне. Прокси возвращает сам
// себя на любое обращение, поэтому цепочки .from().select().eq() не падают.
const chain = new Proxy(function () {}, {
    get: (t, k) => (k === 'then' ? undefined : chain),
    apply: () => chain,
    construct: () => chain
});
ctx.supabase = { createClient: () => chain };

ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx; ctx.top = ctx; ctx.parent = ctx;
vm.createContext(ctx);

// Файлы объявляют catalog и app через const — в песочнице они не становятся
// свойствами контекста, поэтому вытаскиваем их явным присваиванием.
const root = path.resolve(__dirname, '..');
const load = (file, expose) => {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    vm.runInContext(src + '\n' + expose, ctx, { filename: file });
};
load('catalog.js', 'globalThis.__catalog = catalog;');
load('app.js', 'globalThis.__app = app;');

const app = ctx.__app;
if (!app || typeof app.render !== 'function') {
    throw new Error('app.js не поднялся: объект app или его render недоступны');
}
app.__catalog = ctx.__catalog;
// Доступ к странице-заглушке: нужен, чтобы прочитать, что код в неё записал.
app.__doc = doc;

/** Состояние объекта: только то, что задаёт расчёт, остальное — по умолчанию. */
app.__setup = function (over) {
    Object.assign(this.state, {
        area: 200, floors: 1, region: 100, fuels: ['gas'], res: 5,
        hotWater: true, systems: ['rad'], water: false, snowMelt: false,
        detailedRooms: false, rooms: [], swaps: {}, boilerPipeSystem: 'ss304'
    }, over || {});
    this.render();
    return this;
};

/** Сумма раздела сметы по номеру («2.» — вся котельная). */
app.__sum = function (prefix) {
    return Math.round((this.currentEquipmentList || []).reduce((acc, it) =>
        String(it.group || '').indexOf(prefix) === 0 ? acc + (it.price || 0) * (it.q || 1) : acc, 0));
};

module.exports = app;
