/**
 * Плашка «поставьте приложение» для тех, кто считает с телефона.
 *
 * ЗАЧЕМ. Приложение лежит в RuStore, но само себя не продаёт: человек, который уже
 * считает смету в мобильном браузере, — это и есть тот, кому оно нужно, и другого
 * такого же тёплого канала у нас нет.
 *
 * КОМУ НЕ ПОКАЗЫВАЕМ. Внутри самого приложения (метка __HC_NATIVE__ от native-ui.js),
 * всем, кроме Android (версии под iOS нет — предлагать нечего), и тому, кто уже
 * запустил сайт с экрана «Домой» как PWA: иконка у него и так есть.
 *
 * КОГДА ПОКАЗЫВАЕМ. Не новичку на первом экране. Новичок в первую минуту решает,
 * пользоваться ли калькулятором вообще, и предложение поставить ещё и приложение в
 * этот момент только мешает — а первая смета у нас и без того узкое место. Поэтому
 * плашка ждёт либо второго захода, либо того, что человек тронул хоть одно поле
 * параметров: и то, и другое означает, что он уже работает, а не смотрит.
 *
 * КАК ЧАСТО. Закрыл — месяц тишины. Ушёл в магазин — полгода: если поставил,
 * плашка ему больше не нужна, а если передумал, повторное предложение через неделю
 * выглядит как выпрашивание. Постоянный вход остаётся в меню кабинета («Приложение»),
 * так что отказ ничего не отрезает.
 *
 * Файл самостоятельный: свои стили, своя разметка, в app.js ничего не трогает.
 * Тот же приём, что у cookie-consent.js.
 */
(function () {

    var STORE_URL = 'https://www.rustore.ru/catalog/app/ru.heatcalc.app';
    var PAGE_URL = '/prilozhenie/';
    var KEY = 'hc_app_promo';
    var GAP_MS = 30 * 60 * 1000;          // столько без визита — считаем заход новым
    var HIDE_CLOSED = 30 * 864e5;         // закрыл — месяц
    var HIDE_WENT = 180 * 864e5;          // ушёл в магазин — полгода
    var DELAY_MS = 20000;                 // не выскакивать под руку сразу после загрузки

    if (window.__HC_NATIVE__) return;
    if (!/Android/i.test(navigator.userAgent || '')) return;
    try {
        if (window.matchMedia && matchMedia('(display-mode: standalone)').matches) return;
        if (navigator.standalone) return;
    } catch (e) { }

    var now = Date.now();
    var st;
    try { st = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { st = null; }
    if (!st || typeof st !== 'object') st = { visits: 0, seen: 0, hide: 0 };
    if (st.hide > now) return;

    // Новый заход — тот, между которым и прошлым прошло больше получаса. Мерка та же,
    // что у счётчика визитов в session_track.js, чтобы «второй заход» означал одно и
    // то же в обоих местах.
    if (now - (st.seen || 0) > GAP_MS) st.visits = (st.visits || 0) + 1;
    st.seen = now;
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { }

    var shown = false;

    function remember(ms) {
        st.hide = Date.now() + ms;
        try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { }
    }

    function goal(name) {
        try { if (window.ym) ym(109490947, 'reachGoal', name); } catch (e) { }
    }

    function style() {
        var css = document.createElement('style');
        css.textContent = [
            '.hc-app-promo{position:fixed;left:12px;right:12px;z-index:1000000;',
            'display:flex;align-items:center;gap:12px;padding:12px 14px;',
            'background:#fff;color:#111827;border:1px solid #E5E7EB;border-radius:16px;',
            'box-shadow:0 10px 30px rgba(0,0,0,.16);font-family:inherit;',
            'transform:translateY(160%);transition:transform .42s cubic-bezier(.32,.72,0,1);}',
            '.hc-app-promo.open{transform:translateY(0);}',
            'body.dark-mode .hc-app-promo{background:#1E1E1E;color:#F3F4F6;border-color:#2A2A2A;',
            'box-shadow:0 10px 30px rgba(0,0,0,.5);}',
            '.hc-app-promo-icon{flex:none;width:38px;height:38px;border-radius:10px;object-fit:contain;}',
            '.hc-app-promo-text{flex:1;min-width:0;text-decoration:none;color:inherit;display:block;}',
            '.hc-app-promo-text b{display:block;font-size:14px;font-weight:700;line-height:1.25;}',
            '.hc-app-promo-text span{display:block;font-size:12px;line-height:1.35;opacity:.7;margin-top:2px;}',
            '.hc-app-promo-go{flex:none;background:#2563EB;color:#fff;text-decoration:none;',
            'font-size:13px;font-weight:700;padding:9px 14px;border-radius:10px;white-space:nowrap;}',
            '.hc-app-promo-go:active{transform:scale(.96);}',
            '.hc-app-promo-close{flex:none;background:none;border:0;color:inherit;opacity:.45;',
            'font-size:22px;line-height:1;padding:4px 2px;cursor:pointer;}',
            '@media print{.hc-app-promo{display:none;}}'
        ].join('');
        document.head.appendChild(css);
    }

    function place(box) {
        // Высоту нижней навигации меряем, а не вписываем числом: она разная с
        // безопасной зоной айфоноподобных вырезов и меняется вместе со стилями.
        var nav = document.querySelector('.mobile-bottom-nav');
        var h = (nav && nav.offsetHeight) ? nav.offsetHeight : 0;
        box.style.bottom = (h + 12) + 'px';
    }

    function show() {
        if (shown) return;
        shown = true;
        style();

        var box = document.createElement('div');
        box.className = 'hc-app-promo';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-label', 'Приложение HeatCalc для Android');
        box.innerHTML =
            '<img class="hc-app-promo-icon" src="/img/logo_HC.png" alt="">' +
            '<a class="hc-app-promo-text" href="' + PAGE_URL + '">' +
            '<b>Калькулятор в телефоне</b>' +
            '<span>Считает смету и печатает PDF без интернета</span>' +
            '</a>' +
            '<a class="hc-app-promo-go" href="' + STORE_URL + '" rel="noopener">Установить</a>' +
            '<button class="hc-app-promo-close" type="button" aria-label="Закрыть">&times;</button>';

        document.body.appendChild(box);
        place(box);
        window.addEventListener('resize', function () { place(box); }, { passive: true });
        requestAnimationFrame(function () { box.classList.add('open'); });
        goal('app_banner_show');

        box.querySelector('.hc-app-promo-go').addEventListener('click', function () {
            goal('app_install_click');
            remember(HIDE_WENT);
        });
        box.querySelector('.hc-app-promo-text').addEventListener('click', function () {
            remember(HIDE_WENT);
        });
        box.querySelector('.hc-app-promo-close').addEventListener('click', function () {
            goal('app_banner_close');
            remember(HIDE_CLOSED);
            box.classList.remove('open');
            setTimeout(function () { box.remove(); }, 450);
        });
    }

    function arm() {
        if (st.visits >= 2) {
            setTimeout(show, DELAY_MS);
            return;
        }
        // Первый заход: ждём, пока человек начнёт считать. Признак тот же, по которому
        // session_track отличает «начал считать» от «зашёл посмотреть», — изменение
        // любого поля в колонке параметров.
        document.addEventListener('change', function (e) {
            var t = e.target;
            if (t && t.closest && t.closest('.input-panel')) setTimeout(show, DELAY_MS);
        }, true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', arm);
    } else {
        arm();
    }

})();
