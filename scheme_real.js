/* «Реальный вид» котельной — лист справа от принципиальной схемы.
 *
 * Это тот же вид спереди, что выпускает проект (лист «Вид котельной спереди»,
 * project_layout.js): кадр из BIM-моделей — котёл, шины, стояки контуров с
 * настоящей арматурой, бак, насос, — с номерами контуров, размерной цепочкой и
 * выносками. Кадры без марок и логотипов лежат в img/scheme_real (только то,
 * что нужно этому листу; полный набор img/nodes3d в git намеренно не выкладывается).
 *
 * Нужные модули подгружаются при первом показе: project_layout.js и кадры.
 * Состав берётся из той же конфигурации схемы, что и принципиальная схема, и
 * из позиций сметы. Пока кадры не пришли — в панели «Загружаю…»; не пришли
 * вовсе — панель прячется, схема и проверка подбора остаются как были.
 *
 * Подключение: app.placeHydroCheckBox() кладёт панель в #scheme_real_side
 * рядом со схемой и зовёт SchemeReal.mount(); полный экран — open().
 */
(function () {
    'use strict';

    var DIR = 'img/scheme_real/';
    var cache = { frames: null, layout: null };

    function esc(t) {
        return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error(src)); };
            document.head.appendChild(s);
        });
    }

    // Модуль листов проекта: нужен только этой панели, поэтому грузим по требованию
    function layoutModule() {
        if (window.projectLayout && window.projectLayout.frontPanel) return Promise.resolve(window.projectLayout);
        if (!cache.layout) {
            cache.layout = loadScript('./project_layout.js?v=4.20')
                .then(function () { return window.projectLayout; })
                .catch(function (e) { cache.layout = null; throw e; });
        }
        return cache.layout;
    }

    // Описание кадров (размеры и точки выносок) — тот же формат, что в img/nodes3d/nodes3d.json
    function framesIndex() {
        if (!cache.frames) {
            cache.frames = fetch(DIR + 'nodes3d.json')
                .then(function (r) { return r.ok ? r.json() : {}; })
                .catch(function () { return {}; });
        }
        return cache.frames;
    }

    function frame(index, key) {
        var it = index && index[key];
        if (!it || !it.front || !it.front.w) return null;
        var f = it.front;
        var out = {
            url: DIR + key + '_front.jpg',
            ratio: f.w / f.h,
            marks: (f.marks || []).map(function (m) { return { t: m.t, x: m.x, y: m.y }; })
        };
        if (it.anchors) out.anchors = it.anchors;
        return out;
    }

    // Кадры фасада на разное число стояков: какой взять, решает лист по составу контуров
    function frontFrames(index) {
        var front = {};
        ['SR', 'CSR', 'DC', 'SRCSR', 'SRDC', 'SRSR', 'SRSRCSR', 'SRSRDC'].forEach(function (k) {
            var d = frame(index, 'boiler_front_' + k);
            if (d) front[k] = d;
        });
        return { front: Object.keys(front).length ? front : null, dhw: frame(index, 'boiler_dhw') };
    }

    function build(host, cfg, items, view) {
        return Promise.all([layoutModule(), framesIndex()]).then(function (r) {
            var F = frontFrames(r[1]);
            if (!F.front) return null;
            var svg = r[0].frontPanel(cfg, items, { front: F.front, frontDhw: F.dhw, view: view });
            return svg ? { svg: svg, hasDhw: !!(F.dhw && cfg.indirect) } : null;
        });
    }

    function tabs(view, hasDhw) {
        if (!hasDhw) return '';
        function b(v, t) {
            return '<button type="button" class="sr-tab' + (view === v ? ' on' : '') + '" onclick="event.stopPropagation();SchemeReal.show(\'' + v + '\')">' + t + '</button>';
        }
        return '<div class="sr-tabs">' + b('boilers', 'Котлы') + b('dhw', 'Бойлер') + '</div>';
    }

    var state = { host: null, cfg: null, items: null, view: 'boilers' };

    function paint() {
        var host = state.host;
        if (!host || !host.isConnected) return;
        build(host, state.cfg, state.items, state.view).then(function (res) {
            if (!host.isConnected) return;
            if (!res) { host.style.display = 'none'; var sch = host.closest('#dynamic_scheme'); if (sch) sch.classList.remove('hc-split'); return; }
            host.innerHTML =
                '<div class="sr-head"><span class="sr-title">Реальный вид: котельная спереди</span>' + tabs(state.view, res.hasDhw) + '</div>' +
                '<div class="sr-wrap" onclick="SchemeReal.open()" title="Открыть на весь экран">' + res.svg +
                '<button type="button" class="scheme-zoom-btn" aria-label="На весь экран">⛶ На весь экран</button></div>' +
                '<div class="sr-note">Кадры из BIM-моделей; крепёж и привязки условные — как в проекте.</div>';
        }).catch(function () {
            host.style.display = 'none';
            var sch = host.closest('#dynamic_scheme'); if (sch) sch.classList.remove('hc-split');
        });
    }

    // Показать панель в контейнере host по конфигурации схемы и позициям сметы
    function mount(host, cfg, items) {
        state.host = host; state.cfg = cfg; state.items = items || [];
        if (state.view === 'dhw' && !cfg.indirect) state.view = 'boilers';
        host.innerHTML = '<div class="sr-head"><span class="sr-title">Реальный вид: котельная спереди</span></div>' +
            '<div class="sr-wrap sr-wait">Загружаю…</div>';
        paint();
    }
    function show(view) { state.view = view; paint(); }

    // Полноэкранный просмотр: копия листа поверх страницы, закрывается щелчком или Esc
    function open() {
        var svg = document.querySelector('#scheme_real_side .sr-svg');
        if (!svg) return;
        close();
        var ov = document.createElement('div');
        ov.id = 'scheme_real_zoom';
        ov.setAttribute('role', 'dialog');
        ov.innerHTML = '<button type="button" class="sr-zoom-x" aria-label="Закрыть">✕</button>';
        var c = svg.cloneNode(true);
        c.setAttribute('class', 'sr-zoom-svg');
        ov.appendChild(c);
        ov.addEventListener('click', close);
        document.body.appendChild(ov);
        document.addEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    function close() {
        var ov = document.getElementById('scheme_real_zoom');
        if (ov) ov.remove();
        document.removeEventListener('keydown', onKey);
    }

    window.SchemeReal = { mount: mount, show: show, open: open, close: close };
})();
