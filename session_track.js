/**
 * Сколько времени человек реально провёл в калькуляторе и чем занимался.
 *
 * ЗАЧЕМ. В панели видно, сколько у монтажника смет и когда он заходил в последний раз, но
 * не видно, что он делает в те дни, когда не считает. «Заходит каждый день и ничего не
 * считает» — это пять разных людей: один смотрит цены, второй сидит за прилавком в
 * магазине, третий застрял на первом экране, четвёртый упёрся в закрытый раздел, пятый
 * зашёл прочитать сообщение. Отличить их можно только по тому, где он был и сколько там
 * пробыл.
 *
 * ЧТО СЧИТАЕТСЯ ВРЕМЕНЕМ. Только активное: вкладка на переднем плане И за последнюю минуту
 * была мышь, клавиатура, прокрутка или касание. Открытая с утра и забытая вкладка даёт
 * ноль. Иначе у продавца, который не закрывает калькулятор весь день, набегало бы восемь
 * часов, и средняя цифра по базе не значила бы ничего.
 *
 * ЧТО СЧИТАЕТСЯ ВИЗИТОМ. Непрерывная работа с разрывом меньше 30 минут: ушёл на обед и
 * вернулся — это второй визит, перезагрузил страницу — тот же самый. Номер визита лежит в
 * localStorage, общем для всех вкладок одного браузера, поэтому три открытые вкладки дают
 * один визит, а не три, и время в них не складывается (тикает только видимая).
 *
 * ЧТО УХОДИТ НА СЕРВЕР. Одна запись на визит, обновляемая по мере накопления: номер визита,
 * секунды, карта открытых экранов, название устройства. Не «сердцебиение» каждые полминуты
 * — на бесплатном плане Supabase 5 ГБ egress в месяц, и мы в них уже упирались на опросе
 * уведомлений. Кто это был, сервер определяет сам по сессии (см. record_visit в
 * supabase/migrations/20260911_user_sessions.sql), браузер своего имени не сообщает.
 *
 * Гостей не считаем: строки в users у них нет, приписать визит некому.
 */
window.SessionTrack = {

    KEY: 'hc_visit',                 // localStorage, общий для всех вкладок браузера
    GAP_MS: 30 * 60 * 1000,          // разрыв, после которого начинается новый визит
    IDLE_MS: 60 * 1000,              // столько без действий — секунды не капают
    TICK_MS: 5000,                   // шаг счётчика
    FLUSH_SEC: 120,                  // накопилось столько новых секунд — досылаем на сервер

    lastAct: 0,
    token: null,
    uid: null,                       // чей сейчас вход (auth.users.id); null — гость
    authKnown: false,                // ответ о сессии уже пришёл
    started: false,

    init: function () {
        if (this.started) return;
        this.started = true;
        this.lastAct = Date.now();

        const touch = () => { this.lastAct = Date.now(); };
        ['mousedown', 'keydown', 'wheel', 'touchstart', 'scroll', 'mousemove'].forEach(ev => {
            window.addEventListener(ev, touch, { passive: true });
        });

        setInterval(() => this.tick(), this.TICK_MS);

        // Два самых частых экрана ловим здесь, а не правками по всему калькулятору.
        //
        // «params» — человек тронул хоть одно поле в колонке параметров. Это и есть
        // граница между «зашёл посмотреть» и «начал считать»: у тех, кто уходит, ни
        // одного изменения за визит нет вовсе.
        document.addEventListener('change', (e) => {
            const t = e.target;
            if (t && t.closest && t.closest('.input-panel')) this.screen('params');
        }, true);
        // Разделы кабинета — по нажатию на пункт меню, неважно, колонкой оно сейчас
        // или лентой сверху: разметка у них общая (.lk-rail-item[data-rail]).
        document.addEventListener('click', (e) => {
            const t = e.target;
            const item = t && t.closest ? t.closest('.lk-rail-item[data-rail]') : null;
            if (item) this.screen('lk:' + item.getAttribute('data-rail'));
        }, true);

        // Свернули окно или ушли на другую вкладку — визит может на этом и закончиться,
        // поэтому досылаем накопленное сразу. Вернулись — считаем это действием, иначе
        // первую минуту после возвращения таймер бы стоял.
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.flush(true); else this.lastAct = Date.now();
        });
        // pagehide, а не beforeunload: на телефонах beforeunload часто не приходит вовсе.
        window.addEventListener('pagehide', () => this.flush(true));

        // Токен доступа держим под рукой: при закрытии окна спрашивать его уже поздно,
        // ответ придёт, когда страницы не будет.
        this.refreshToken();
        // Вход, выход и смена аккаунта без перезагрузки страницы — см. onAuth.
        try {
            if (typeof supabaseClient !== 'undefined' && supabaseClient) {
                supabaseClient.auth.onAuthStateChange((event, session) => this.onAuth(session));
            }
        } catch (e) { }
    },

    /**
     * Визит принадлежит одному аккаунту.
     *
     * Номер визита живёт в браузере, а не в аккаунте. Без этой проверки вышло бы так:
     * вышел из одной учётки, через десять минут вошёл в другую — браузер продолжает
     * тот же визит, сервер видит, что строка с этим номером чужая, и молча отбрасывает
     * всё время второй учётки. Чужому оно не приписывалось (это сервер не даёт), но
     * терялось целиком — а владелец как раз проверяет сайт под несколькими учётками.
     *
     * Поэтому при смене хозяина прежний визит досылаем его же токеном (он ещё
     * действует, даже после выхода — до конца срока) и закрываем, а дальше счёт идёт
     * новым визитом. Гость, который вошёл, — тот же человек: его визит просто
     * получает владельца и продолжается.
     */
    onAuth: function (session) {
        const uid = (session && session.user && session.user.id) || null;
        if (this.authKnown && this.uid && uid !== this.uid) {
            this.flush(true);
            try { localStorage.removeItem(this.KEY); } catch (e) { }
        }
        this.uid = uid;
        this.token = (session && session.access_token) || null;
        this.authKnown = true;
    },

    // ── визит в localStorage ────────────────────────────────────────────────

    newVisit: function (now) {
        return { id: this.uuid(), uid: this.uid, start: now, beat: now, sec: 0, sent: 0, screens: {} };
    },

    // create=false — только прочитать; пустой ответ означает «визита нет, и заводить его
    // сейчас не надо» (так отправка не выдумывает визит на пустом месте).
    load: function (now, create) {
        let v = null;
        try { v = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { v = null; }
        // Визит другого аккаунта — тоже чужой. Сюда попадаем, когда смена входа прошла
        // не в этой вкладке (в соседней или в установленном приложении) и onAuth её не
        // видел: досылать прежний визит тут уже нечем, начинаем новый.
        const foreign = !!(v && v.uid && this.uid && v.uid !== this.uid);
        const stale = !v || !v.id || foreign || !(now - (v.beat || 0) < this.GAP_MS);
        if (stale) return create ? this.newVisit(now) : null;
        if (!v.screens || typeof v.screens !== 'object') v.screens = {};
        if (!v.uid && this.uid) v.uid = this.uid;          // гость вошёл — визит его
        return v;
    },

    save: function (v) {
        try { localStorage.setItem(this.KEY, JSON.stringify(v)); } catch (e) { }
    },

    uuid: function () {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    },

    // ── счётчик ─────────────────────────────────────────────────────────────

    tick: function () {
        const now = Date.now();
        if (document.hidden) return;
        if (!this.authKnown) return;                        // ещё не знаем, чей визит
        if (now - this.lastAct > this.IDLE_MS) return;      // человек отошёл
        const v = this.load(now, true);
        v.sec += Math.round(this.TICK_MS / 1000);
        v.beat = now;
        this.save(v);
        if (v.sec - (v.sent || 0) >= this.FLUSH_SEC) this.flush(false);
    },

    /**
     * Отметить, что человек открыл экран.
     *
     * Внутри визита считаем, сколько раз открывал, — но в итоги по человеку уходит не это
     * число, а сам факт: сервер прибавляет по единице за визит, в котором экран
     * встретился. Иначе тот, кто десять раз дёрнул ползунок площади, выглядел бы
     * активнее того, кто спокойно посчитал смету.
     */
    screen: function (name) {
        if (!name) return;
        const now = Date.now();
        this.lastAct = now;
        const v = this.load(now, true);
        const key = String(name).slice(0, 40);
        v.screens[key] = (v.screens[key] || 0) + 1;
        v.beat = now;
        this.save(v);
    },

    // ── отправка ────────────────────────────────────────────────────────────

    refreshToken: function () {
        try {
            if (typeof supabaseClient === 'undefined' || !supabaseClient) return Promise.resolve(null);
            return supabaseClient.auth.getSession().then(({ data }) => {
                this.onAuth(data && data.session);
                return this.token;
            }).catch(() => null);
        } catch (e) { return Promise.resolve(null); }
    },

    /**
     * final=true — окно закрывается или уходит в фон. Тогда токен берём из кэша (ждать
     * ответа auth уже некогда) и просим браузер дослать запрос после ухода со страницы
     * (keepalive). Обычная досылка сначала освежает токен.
     *
     * Отправляем прямым запросом, а не через supabase-js: клиентская библиотека при
     * закрытии вкладки свой fetch отменяет, и последние минуты визита терялись бы.
     */
    flush: function (final) {
        const now = Date.now();
        const v = this.load(now, false);
        if (!v || v.sec <= 0 || v.sec === (v.sent || 0)) return;

        const send = (token) => {
            if (!token) return;                                  // гость — считать некому
            const body = JSON.stringify({
                p_visit: v.id,
                p_sec: v.sec,
                p_screens: v.screens || {},
                p_device: (typeof app !== 'undefined' && app.getDeviceName) ? app.getDeviceName() : null
            });
            fetch(supabaseUrl + '/rest/v1/rpc/record_visit', {
                method: 'POST',
                keepalive: true,
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': supabaseKey,
                    'Authorization': 'Bearer ' + token
                },
                body: body
            }).then(r => {
                if (!r.ok) return;
                // Засчитываем отправленное в той записи, что лежит сейчас: пока шёл
                // запрос, секунды могли прибавиться, и перезаписывать их нельзя.
                const cur = this.load(Date.now(), false);
                if (cur && cur.id === v.id) { cur.sent = v.sec; this.save(cur); }
            }).catch(() => { });
        };

        if (final) send(this.token);
        else this.refreshToken().then(send);
    }
};

document.addEventListener('DOMContentLoaded', function () {
    try { window.SessionTrack.init(); } catch (e) { console.warn('[SessionTrack]', e && e.message); }
});
