/* Учёт визитов на контентных страницах (статьи, города, новости).
 *
 * Калькулятор (app.js) ведёт визиты сам, но статьи его не загружают: человек, пришедший
 * из поиска на статью и прочитавший три страницы, в админке раньше не появлялся вовсе.
 * Этот файл делает для статей то же самое и пользуется теми же ключами localStorage:
 *   hc_vid — анонимный UUID браузера, hc_av — текущий визит {id, vid, at, sec}.
 * Поэтому статья и калькулятор продолжают один и тот же визит, а каждая загрузка
 * страницы добавляет к нему просмотр (visit_hit) — так считается глубина просмотра.
 *
 * Подгружается из seo-theme.js (он есть на всех контентных страницах), в HTML ничего
 * добавлять не нужно. Без миграции 20261112_visit_pages.sql вызов visit_hit просто
 * молча не срабатывает, остальное работает как раньше.
 * Персональных данных нет; свои устройства (hc_noc) и роботы не считаются.
 */
(function () {
    'use strict';
    try {
        if (window.__hcVisitPages || window.__HC_NATIVE__) return;
        window.__hcVisitPages = 1;
        if (!/(^|\.)heatcalc\.ru$/.test(location.hostname)) return;

        var URL_ = 'https://ahanbwugsmcyvrwbmtlx.supabase.co';
        var KEY = 'sb_publishable_gcMJ-PvJmKavObbnePFGZQ_O-pu5O2p';
        var VID_KEY = 'hc_vid', VISIT_KEY = 'hc_av', NOC_KEY = 'hc_noc', GAP = 30 * 60 * 1000;
        var ua = navigator.userAgent || '';
        if (/bot|crawl|spider|slurp|headless|lighthouse|pagespeed|facebookexternalhit|preview|python-|curl\/|wget|yandex(images|metrika|direct|market|turbo|video|media|favicons|screenshot)/i.test(ua)) return;

        function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
        function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
        if (ls(NOC_KEY) === '1') return;

        function rpc(fn, body) {
            return fetch(URL_ + '/rest/v1/rpc/' + fn, {
                method: 'POST', keepalive: true,
                headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        }

        var vid = ls(VID_KEY) || '';
        if (!vid) {
            vid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
            if (!lsSet(VID_KEY, vid)) return;
        }

        var q = new URLSearchParams(location.search);
        var s = q.get('utm_source'), m = q.get('utm_medium'), c = q.get('utm_campaign');
        var ref = '';
        try {
            if (document.referrer) ref = new URL(document.referrer).hostname.replace(/^www\./, '');
        } catch (e) { }
        var foreign = ref && !/(^|\.)heatcalc\.ru$/.test(ref) && !/^(localhost|127\.)/.test(ref);
        var fresh = s || m || c || foreign;

        var cur = null;
        try { cur = JSON.parse(ls(VISIT_KEY) || 'null'); } catch (e) { }
        var visit = null;

        function save(v) { lsSet(VISIT_KEY, JSON.stringify(v)); }

        function startTime() {
            var shownAt = document.visibilityState === 'visible' ? Date.now() : 0, sent = -1;
            function flush(send) {
                if (!visit) return;
                var v = visit;
                try {
                    var st = JSON.parse(ls(VISIT_KEY) || 'null');
                    if (st && st.id === v.id) v = visit = st;
                } catch (e) { }
                if (shownAt) {
                    v.sec = (v.sec || 0) + Math.round((Date.now() - shownAt) / 1000);
                    shownAt = document.visibilityState === 'visible' ? Date.now() : 0;
                }
                v.at = Date.now();
                save(v);
                if (send && v.sec !== sent) {
                    sent = v.sec;
                    rpc('end_visit', { p_id: v.id, p_visitor: v.vid, p_seconds: v.sec }).catch(function () { });
                }
            }
            document.addEventListener('visibilitychange', function () {
                if (document.visibilityState === 'visible') shownAt = Date.now(); else flush(true);
            });
            window.addEventListener('pagehide', function () { flush(true); });
            setInterval(function () { if (document.visibilityState === 'visible') flush(true); }, 5 * 60 * 1000);
        }

        if (cur && cur.id && cur.vid === vid && !fresh && Date.now() - (cur.at || 0) < GAP) {
            // продолжение визита: ещё одна страница
            visit = cur; cur.at = Date.now(); save(cur);
            rpc('visit_hit', { p_id: cur.id, p_visitor: vid, p_path: location.pathname || '/', p_calc: false }).catch(function () { });
            startTime();
            return;
        }

        var tablet = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
        var mobile = !tablet && /Mobi|iPhone|iPod|Android/i.test(ua);
        var os = /Windows/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android'
            : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Mac OS X|Macintosh/i.test(ua) ? 'macOS'
            : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/i.test(ua) ? 'Linux' : 'Другая';
        var br = /YaBrowser|YaApp|YaSearchBrowser/i.test(ua) ? 'Яндекс Браузер'
            : /Telegram/i.test(ua) ? 'Telegram' : /VKClient|vkclient|VKAndroidApp/i.test(ua) ? 'ВКонтакте'
            : /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
            : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Другой';
        rpc('log_visit', {
            p_visitor: vid, p_landing: location.pathname || '/', p_referrer: foreign ? ref : '',
            p_source: s, p_medium: m, p_campaign: c, p_label: null,
            p_device: tablet ? 'tablet' : mobile ? 'mobile' : 'desktop', p_os: os, p_browser: br
        }).then(function (r) { return r.ok ? r.json() : null; }).then(function (id) {
            if (!id) return;
            visit = { id: id, vid: vid, at: Date.now(), sec: 0 };
            save(visit);
            rpc('visit_mark', { p_id: id, p_visitor: vid, p_path: location.pathname || '/', p_calc: false }).catch(function () { });
            startTime();
        }).catch(function () { });
    } catch (e) { }
})();
