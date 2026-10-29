/**
 * Скрытый расчёт «могла бы стоить дешевле» для предложения «Профи».
 *
 * Открывается только как index.html?probe=1 — внутри iframe админки (pay_readiness.js).
 * Localstorage в этом режиме заменён памятью (см. скрипт в <head> index.html), поэтому
 * смета пользователя нигде не сохраняется и не перезаписывает состояние владельца.
 *
 * Протокол (postMessage, только same-origin):
 *   iframe → родитель: { type: 'probe-ready' }      — приложение поднялось
 *   родитель → iframe: { type: 'probe', id, state } — состояние сметы (calc_data)
 *   iframe → родитель: { type: 'probe-result', id, base, cheap, error }
 *
 * base — смета в STOUT без аналогов, cheap — та же смета в режиме «Бюджетнее».
 * Считает сама программа (computeCheapBaseline и render), а не отдельная формула.
 */
(function () {
    if (!/[?&]probe=1(&|$)/.test(location.search)) return;

    var defaults = null;

    function isReady() {
        return typeof app !== 'undefined' && app && typeof app.render === 'function'
            && typeof app.computeCheapBaseline === 'function' && app.state;
    }

    function reply(msg) {
        if (window.parent && window.parent !== window) window.parent.postMessage(msg, location.origin);
    }

    function calc(id, state) {
        try {
            // Умолчания программы + сохранённая смета поверх; меняем только в этом iframe
            if (!defaults) defaults = JSON.parse(JSON.stringify(app.state));
            var s = Object.assign(JSON.parse(JSON.stringify(defaults)), JSON.parse(JSON.stringify(state || {})));
            s.brandMode = 'rommer';
            s.sectionAnalog = {};
            app.state = s;
            app._boilerRangeCache = null;
            app.computeCheapBaseline();
            var base = app._cheapBase && app._cheapBase.eq;
            app.render(true);
            var cheap = Math.round(app.calcFinalTotal || 0);
            if (!base || !cheap) return reply({ type: 'probe-result', id: id, error: 'смета не посчиталась' });
            reply({ type: 'probe-result', id: id, base: base, cheap: cheap });
        } catch (e) {
            reply({ type: 'probe-result', id: id, error: String((e && e.message) || e) });
        }
    }

    window.addEventListener('message', function (e) {
        if (e.origin !== location.origin || !e.data || e.data.type !== 'probe') return;
        if (!isReady()) return reply({ type: 'probe-result', id: e.data.id, error: 'приложение ещё не готово' });
        calc(e.data.id, e.data.state);
    });

    var tries = 0;
    var timer = setInterval(function () {
        tries++;
        if (isReady()) {
            clearInterval(timer);
            reply({ type: 'probe-ready' });
        } else if (tries > 300) {
            clearInterval(timer);
            reply({ type: 'probe-result', error: 'приложение не поднялось за 60 секунд' });
        }
    }, 200);
})();
