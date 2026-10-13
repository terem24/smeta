/**
 * Экран распознавания вне браузера: RecognizeUI + RecognizeMatch + каталог и прайс.
 *
 * Нужен стенду bench/replay.js: он подаёт в startReview готовый ответ модели и
 * смотрит, что получилось в таблице проверки — тот же путь, что на сайте, только
 * без сети и без страницы. DOM заменён «согласными» заглушками, как в bench/env.js.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

function load() {
    const el = () => new Proxy(function () {}, {
        get: (t, k) => k === Symbol.toPrimitive ? () => '' : el(), apply: () => el(), set: () => true,
    });
    const sb = {
        console: { log() {}, warn() {}, error() {}, info() {} },
        setTimeout, clearTimeout, setInterval: () => 0,
        navigator: { userAgent: 'node' },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        document: { readyState: 'complete', getElementById: () => null, createElement: () => el(),
            addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], body: el() },
        app: { state: { pprSystemBrand: 'proaqua' }, beginRecognitionCard() {} },
        module: undefined,
    };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
    vm.runInContext([read('catalog.js'), read('equivalents.js'), read('recognize_match.js'), read('recognize.js')]
        .join('\n;\n').replace(/^const RecognizeUI\b/m, 'var RecognizeUI')
        + '\n;globalThis.__U = RecognizeUI; globalThis.__M = RecognizeMatch;', sb, { filename: 'recognize-bundle.js' });
    const U = sb.__U, M = sb.__M;
    M.setPriceIndex(JSON.parse(read('price_index.json')).items);
    // Всё, что рисует и ходит в сеть, — вхолостую.
    for (const f of ['renderReview', 'saveDraft', 'step', 'progressTo', 'progressStop', 'setHead', 'dropDraft', 'renderCompare']) U[f] = () => {};
    U.cardTitle = () => 'bench';
    return { U, M, sb };
}
module.exports = { load, ROOT };
