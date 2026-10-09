/**
 * pay_readiness.js — вкладка «Готовность платить» в панели управления (только владелец).
 *
 * Зачем. Цены на подписку нельзя выбрать из головы: платящих пока нет, и единственное,
 * что можно измерить заранее, — кто уже делает то, за что платят. Вкладка собирает из базы
 * воронку «пришёл → работает → отправляет КП → просит оплату → оплатил», режет её по роли
 * (продавец / монтажник), региону и дистрибьютору, ставит каждому человеку балл «жара» и
 * считает потенциальную выручку при ценах, которые владелец вводит тут же.
 *
 * Ничего не пишет в базу: только чтение users, estimates, shared_invoices,
 * subscription_payments, distributors. Загружается лениво (HC_LAZY.pay_readiness).
 *
 * Связи таблиц (проверено по базе): estimates.user_id = users.id, а
 * shared_invoices.user_id = users.auth_user_id — это разные ключи.
 *
 * Расчёт вынесен в analyze(): чистая функция от выгрузки, её гоняет
 * scratch/smoke_pay_readiness.js без браузера и базы.
 */
const PayReadiness = {
    DAY: 86400000,
    // Свои цены для калькулятора выручки; только в этом браузере, в базу не пишутся
    LS_KEY: 'pay_readiness_inputs',
    DEFAULTS: { proPrice: 1290, shopPrice: 5900, conv: 20 },

    _data: null,
    _loading: false,
    _error: null,
    _view: null,
    _heatFilter: 'hot',

    // ── баллы «жара» ──────────────────────────────────────────────────
    // Правило нарочно простое, чтобы владелец мог его пересказать:
    //   смета за 30 дней: 1+ → 2 балла, 3+ → 3;  КП или счёт отправлен → 3;
    //   зашёл в 3+ разных дня → 2;  был за последние 7 дней → 1;  смета от 500 тыс. ₽ → 1.
    HOT_FROM: 6,
    WARM_FROM: 3,

    heatOf: function (p) {
        let s = 0;
        if (p.est30 >= 3) s += 3; else if (p.est30 >= 1) s += 2;
        if (p.invoices > 0) s += 3;
        if (p.days >= 3) s += 2;
        if (p.active7) s += 1;
        if (p.maxEst >= 500000) s += 1;
        return s;
    },
    levelOf: function (score) { return score >= this.HOT_FROM ? 'hot' : (score >= this.WARM_FROM ? 'warm' : 'cold'); },

    regionGroup: function (r) {
        const s = String(r || '').toLowerCase();
        if (!s.trim()) return 'Не указан';
        if (s.indexOf('москв') >= 0) return 'Москва и область';
        if (s.indexOf('санкт') >= 0 || s.indexOf('ленинград') >= 0) return 'Санкт-Петербург и область';
        if (s.indexOf('калинин') >= 0) return 'Калининградская область';
        return 'Другие регионы';
    },

    roleOf: function (types) {
        const a = Array.isArray(types) ? types : [];
        const sell = a.indexOf('Продавец') >= 0, inst = a.indexOf('Монтажник') >= 0;
        if (sell && inst) return 'both';
        if (sell) return 'seller';
        if (inst) return 'installer';
        return 'unknown';
    },
    ROLE_LABEL: { seller: 'Продавец', installer: 'Монтажник', both: 'Продавец и монтажник', unknown: 'Не указано' },
    // Кому что предлагать: магазину — тариф магазина, монтажнику — «Профи»
    OFFER: { seller: 'shop', both: 'shop', installer: 'pro', unknown: 'pro' },

    median: function (arr) {
        const a = arr.filter(x => isFinite(x)).sort((x, y) => x - y);
        if (!a.length) return null;
        const m = a.length >> 1;
        return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    },

    /**
     * Из сырой выгрузки — всё, что рисует вкладка.
     * raw = { users, estimates, invoices, payments, distributors, now }
     */
    analyze: function (raw) {
        const now = raw.now || Date.now();
        const t = x => { const v = x ? new Date(x).getTime() : NaN; return isFinite(v) ? v : null; };
        const people = (raw.users || [])
            .filter(u => u.account_type !== 'admin' && u.account_type !== 'viewer' && !u.is_blocked)
            .map(u => ({
                id: u.id, auth: u.auth_user_id,
                name: [u.last_name, u.first_name].filter(Boolean).join(' ') || u.username || u.email || '—',
                email: u.email || '',
                first: u.first_name || '',
                rawRegion: u.region || '',
                type: u.account_type || '',
                role: this.roleOf(u.activity_types),
                region: this.regionGroup(u.region),
                city: u.city || u.region || '',
                dist: u.distributor_id || null,
                reg: t(u.registered_at) || t(u.created_at),
                last: t(u.last_visited),
                days: +u.sess_days || 0,
                est: 0, est30: 0, maxEst: 0, estSum: 0, invoices: 0, payReq: 0, paid: 0
            }));
        const byId = {}, byAuth = {};
        people.forEach(p => { byId[p.id] = p; if (p.auth) byAuth[p.auth] = p; });

        const estSums = [], workSums = [];
        (raw.estimates || []).forEach(e => {
            const p = byId[e.user_id];
            if (!p) return;
            p.est++;
            const sum = +e.total_sum || 0;
            if (t(e.created_at) > now - 30 * this.DAY) p.est30++;
            if (sum > p.maxEst) p.maxEst = sum;
            p.estSum += sum;
            if (sum > 0) estSums.push(sum);
            if (+e.works_sum > 0) workSums.push(+e.works_sum);
        });
        (raw.invoices || []).forEach(i => { const p = byAuth[i.user_id]; if (p) p.invoices++; });
        (raw.payments || []).forEach(x => {
            const p = byId[x.user_id] || byAuth[x.user_id];
            if (!p) return;
            if (x.status === 'paid') p.paid++; else if (x.status === 'requested') p.payReq++;
        });

        people.forEach(p => {
            p.active30 = !!(p.last && p.last > now - 30 * this.DAY);
            p.active7 = !!(p.last && p.last > now - 7 * this.DAY);
            p.score = this.heatOf(p);
            p.level = this.levelOf(p.score);
            p.offer = this.OFFER[p.role];
        });

        const cnt = f => people.filter(f).length;
        const funnel = [
            { id: 'reg', label: 'Зарегистрировались', n: people.length },
            { id: 'act', label: 'Заходили за 30 дней', n: cnt(p => p.active30) },
            { id: 'est', label: 'Сохранили смету', n: cnt(p => p.est > 0) },
            { id: 'est30', label: 'Смета за последние 30 дней', n: cnt(p => p.est30 > 0) },
            { id: 'inv', label: 'Отправили КП или счёт', n: cnt(p => p.invoices > 0) },
            { id: 'req', label: 'Нажали «Я оплатил»', n: cnt(p => p.payReq > 0 || p.paid > 0) },
            { id: 'paid', label: 'Оплатили', n: cnt(p => p.paid > 0) }
        ];

        const group = (keyFn, labelFn) => {
            const m = {};
            people.forEach(p => {
                const k = keyFn(p);
                const g = m[k] || (m[k] = { key: k, label: labelFn(k), n: 0, hot: 0, warm: 0, est: 0, inv: 0 });
                g.n++; if (p.level === 'hot') g.hot++; if (p.level === 'warm') g.warm++;
                g.est += p.est; g.inv += p.invoices;
            });
            return Object.keys(m).map(k => m[k]).sort((a, b) => (b.hot * 3 + b.warm) - (a.hot * 3 + a.warm) || b.n - a.n);
        };
        const distName = {};
        (raw.distributors || []).forEach(d => { distName[d.id] = d.company_name || 'Без названия'; });

        return {
            now, people, funnel,
            byRole: group(p => p.role, k => this.ROLE_LABEL[k]),
            byRegion: group(p => p.region, k => k),
            byDist: group(p => p.dist || 'none', k => k === 'none' ? 'Без дистрибьютора' : (distName[k] || 'Дистрибьютор')),
            medianEst: this.median(estSums),
            medianWorks: this.median(workSums),
            estCount: estSums.length,
            payments: raw.payments || null
        };
    },

    /**
     * Потенциальная выручка в месяц.
     * Профи платят монтажники (и все без роли) из горячих и тёплых × конверсия;
     * тариф магазина — по дистрибьюторам, где есть хотя бы двое горячих/тёплых продавцов.
     */
    forecast: function (a, inp) {
        const conv = Math.max(0, Math.min(100, +inp.conv || 0)) / 100;
        const live = p => p.level !== 'cold';
        const proPool = a.people.filter(p => live(p) && p.offer === 'pro').length;
        const shopDist = {};
        a.people.forEach(p => { if (live(p) && p.offer === 'shop' && p.dist) shopDist[p.dist] = (shopDist[p.dist] || 0) + 1; });
        const shopPool = Object.keys(shopDist).filter(k => shopDist[k] >= 2).length;
        const proN = Math.round(proPool * conv), shopN = Math.round(shopPool * conv);
        const pro = proN * (+inp.proPrice || 0), shop = shopN * (+inp.shopPrice || 0);
        return { proPool, shopPool, proN, shopN, pro, shop, total: pro + shop };
    },

    // ── загрузка ──────────────────────────────────────────────────────
    load: async function (force) {
        if (this._data && !force) return this._data;
        if (this._loading) return this._loading;
        this._error = null;
        this._loading = (async () => {
            try {
                if (typeof supabaseClient === 'undefined' || !supabaseClient) throw new Error('нет связи с базой');
                const q = (table, cols, order) => {
                    let r = supabaseClient.from(table).select(cols).limit(5000);
                    if (order) r = r.order(order, { ascending: false });
                    return r;
                };
                const [u, e, i, p, d] = await Promise.all([
                    q('users', 'id, auth_user_id, account_type, is_blocked, created_at, registered_at, last_visited, activity_types, region, city, distributor_id, sess_days, first_name, last_name, username, email'),
                    q('estimates', 'user_id, total_sum, works_sum, created_at'),
                    q('shared_invoices', 'user_id, created_at'),
                    q('subscription_payments', 'user_id, status, paid_rub, created_at'),
                    q('distributors', 'id, company_name')
                ]);
                if (u.error) throw u.error;
                if (e.error) throw e.error;
                if (i.error) throw i.error;
                if (d.error) throw d.error;
                // Таблицы оплат может не быть (миграция subscription_payments) — это не ошибка вкладки
                this._data = this.analyze({
                    users: u.data, estimates: e.data, invoices: i.data,
                    payments: p.error ? null : p.data, distributors: d.data
                });
            } catch (err) {
                this._error = (err && err.message) || String(err);
                this._data = null;
            } finally {
                this._loading = false;
            }
            return this._data;
        })();
        return this._loading;
    },

    // ── отрисовка ─────────────────────────────────────────────────────
    // Оформление — общее для админки: .ad-card, .admin-stat-grid, .ad-chip, .admin-btn;
    // своё только для таблиц и воронки (.pr-* в style.css).
    _groupBy: 'role',

    esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); },
    rub: function (n) { return n == null ? '—' : Math.round(n).toLocaleString('ru-RU') + ' ₽'; },
    pct: function (a, b) { return b ? Math.round(a * 100 / b) + ' %' : '—'; },

    inputs: function () {
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem(this.LS_KEY) || '{}') || {}; } catch (e) { }
        return Object.assign({}, this.DEFAULTS, saved);
    },
    setInput: function (key, val) {
        const inp = this.inputs();
        inp[key] = parseFloat(val) || 0;
        try { localStorage.setItem(this.LS_KEY, JSON.stringify(inp)); } catch (e) { }
        this.renderForecast();
    },

    render: function () {
        const box = document.getElementById('admin_payready_box');
        if (!box) return;
        box.innerHTML = '<div class="ad-card-note">Считаю по базе…</div>';
        this.load().then(() => this.renderAll());
    },
    reload: function () {
        this._data = null;
        const box = document.getElementById('admin_payready_box');
        if (box) box.innerHTML = '<div class="ad-card-note">Перечитываю базу…</div>';
        this.load(true).then(() => this.renderAll());
    },

    card: function (title, note, body) {
        return `<div class="ad-card" style="margin-bottom:14px;">
            <div class="ad-card-h"><span class="ad-card-title">${title}</span></div>
            ${note ? `<div class="ad-card-note" style="padding:0;">${note}</div>` : ''}
            ${body}</div>`;
    },

    renderAll: function () {
        const box = document.getElementById('admin_payready_box');
        if (!box) return;
        if (this._error || !this._data) {
            box.innerHTML = `<div class="ad-card-note ad-warn">Отчёт не загрузился: ${this.esc(this._error || 'нет данных')}</div>
                <button type="button" class="admin-btn" style="margin-top:8px;" onclick="PayReadiness.reload()">Повторить</button>`;
            return;
        }
        const a = this._data;
        const tile = (label, value, sub) => `<div class="control-card"><span class="lbl">${label}</span><span>${value}</span><span>${sub}</span></div>`;
        const hot = a.people.filter(p => p.level === 'hot').length, warm = a.people.filter(p => p.level === 'warm').length;
        const paid = a.funnel[a.funnel.length - 1].n;
        const noPay = a.payments === null
            ? '<div class="ad-card-note ad-warn" style="margin-bottom:12px;">Таблицы оплат (subscription_payments) в базе нет — шаги «Я оплатил» и «Оплатили» считать нечем.</div>' : '';

        box.innerHTML = `
            <div class="ad-page-h">
                <div class="ad-sub" style="max-width:640px; line-height:1.5;">Кто уже делает то, за что платят: смету, КП, счёт. Помогает выбрать цены на подписку по фактам. Данные читаются из базы, ничего не меняется.</div>
                <button type="button" class="admin-btn" onclick="PayReadiness.reload()" title="Перечитать базу">Обновить</button>
            </div>
            ${noPay}
            <div class="admin-stat-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px;">
                ${tile('Человек в расчёте', a.people.length, 'без админов и наблюдателей')}
                ${tile('Горячих', hot, 'тёплых: ' + warm)}
                ${tile('Медианная смета', this.rub(a.medianEst), 'работ в ней: ' + this.rub(a.medianWorks) + ' · смет: ' + a.estCount)}
                ${tile('Оплатили', paid, 'подписок оплачено')}
            </div>
            ${this.card('Воронка', 'Где люди отваливаются на пути к оплате. Процент — от зарегистрировавшихся.', this.funnelHtml(a))}
            ${this.card('Выручка при ваших ценах', 'Ориентир, а не прогноз: сколько вышло бы, если бы часть горячих и тёплых оплатила. Цены и процент хранятся только в этом браузере.', '<div id="pr_forecast"></div>')}
            ${this.card('Кто готов платить', 'Срезы по роли в анкете, региону и дистрибьютору. Строки отсортированы по числу горячих.', '<div id="pr_groups"></div>')}
            ${this.card('Люди', 'Балл: смета за 30 дней 2–3, отправленный КП или счёт 3, заходы в 3+ разных дня 2, визит за неделю 1, смета от 500 тыс. ₽ 1. Горячий — ' + this.HOT_FROM + '+, тёплый — ' + this.WARM_FROM + '–' + (this.HOT_FROM - 1) + '.', '<div id="pr_people"></div>')}`;
        this.renderForecast();
        this.renderGroups();
        this.renderPeople();
    },

    funnelHtml: function (a) {
        const top = a.funnel[0].n || 1;
        return '<div class="pr-funnel">' + a.funnel.map(s => {
            const w = s.n ? Math.max(2, Math.round(s.n * 100 / top)) : 0;
            return `<div class="pr-fun-row"><div class="pr-fun-label">${this.esc(s.label)}</div>
                <div class="pr-fun-track"><div class="pr-fun-bar" style="width:${w}%;"></div></div>
                <div class="pr-fun-n"><b>${s.n}</b><span>${this.pct(s.n, top)}</span></div></div>`;
        }).join('') + '</div>';
    },

    setGroupBy: function (g) { this._groupBy = g; this.renderGroups(); },

    renderGroups: function () {
        const el = document.getElementById('pr_groups');
        if (!el || !this._data) return;
        const a = this._data;
        const SETS = [['role', 'По роли', a.byRole], ['region', 'По региону', a.byRegion], ['dist', 'По дистрибьютору', a.byDist]];
        const cur = SETS.find(s => s[0] === this._groupBy) || SETS[0];
        const chips = SETS.map(s => `<button type="button" class="ad-chip${s[0] === cur[0] ? ' active' : ''}" onclick="PayReadiness.setGroupBy('${s[0]}')">${s[1]}</button>`).join('');
        const rows = cur[2].map(g => `<tr><td>${this.esc(g.label)}</td><td class="n">${g.n}</td><td class="n pr-strong">${g.hot}</td><td class="n">${g.warm}</td><td class="n">${g.est}</td><td class="n">${g.inv}</td></tr>`).join('');
        el.innerHTML = `<div class="ad-chips" style="margin:0 0 4px;">${chips}</div>
            <div class="pr-wrap"><table class="pr-table"><thead><tr><th>Группа</th><th class="n">Людей</th><th class="n">Горячих</th><th class="n">Тёплых</th><th class="n">Смет</th><th class="n">КП и счетов</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    },

    renderForecast: function () {
        const el = document.getElementById('pr_forecast');
        if (!el || !this._data) return;
        const a = this._data, inp = this.inputs(), f = this.forecast(a, inp);
        const field = (key, label, suffix) => `<label class="pr-field">${label}
            <span><input type="number" min="0" step="${key === 'conv' ? 5 : 100}" value="${inp[key]}" onchange="PayReadiness.setInput('${key}', this.value)" class="pr-input"> ${suffix}</span></label>`;
        let cur = '';
        try {
            if (typeof Subscription !== 'undefined') {
                const p = Subscription.settings().plans;
                if (p.month && p.year) cur = `<div class="ad-card-note" style="padding:0;">Сейчас в «Оплате подписки»: месяц ${this.rub(p.month.rub)}, год ${this.rub(p.year.rub)}.${a.medianEst ? ' Год «Профи» — ' + (Math.round(p.year.rub * 1000 / a.medianEst) / 10) + ' % от медианной сметы.' : ''}</div>`;
            }
        } catch (e) { }
        const res = (label, value) => `<div class="pr-res"><div class="pr-res-l">${label}</div><div class="pr-res-v">${value}</div></div>`;
        el.innerHTML = `<div class="pr-fields">
                ${field('proPrice', 'Профи (монтажник), в месяц', '₽')}
                ${field('shopPrice', 'Магазин, за точку в месяц', '₽')}
                ${field('conv', 'Сколько горячих и тёплых оплатят', '%')}
            </div>
            <div class="pr-results">
                ${res('Профи: из ' + f.proPool + ' человек оплатят ' + f.proN, this.rub(f.pro) + '/мес')}
                ${res('Магазин: из ' + f.shopPool + ' точек оплатят ' + f.shopN, this.rub(f.shop) + '/мес')}
                ${res('Итого в месяц / в год', this.rub(f.total) + ' / ' + this.rub(f.total * 12))}
            </div>
            <div class="ad-card-note" style="padding:0;">Магазин считается по дистрибьюторам, у которых не меньше двух горячих или тёплых продавцов; Профи — по остальным горячим и тёплым.</div>
            ${cur}`;
    },

    // ── «Предложить»: готовое сообщение с преимуществами и ссылками на оплату ──
    // Цены и ссылки — те же, что видит сам человек в окне тарифа: Subscription.resolve
    // с его регионом (региональная цена и действующая акция учитываются).
    // Магазинного тарифа в «Оплате подписки» пока нет, поэтому продавцу тоже уходит «Профи»,
    // но с перечнем преимуществ именно для продавца.
    LS_SENT: 'pay_readiness_offers',

    sentMap: function () {
        try { return JSON.parse(localStorage.getItem(this.LS_SENT) || '{}') || {}; } catch (e) { return {}; }
    },

    offerCell: function (p) {
        if (p.type === 'pro') return '<span class="pr-sent">уже Профи</span>';
        const sent = this.sentMap()[p.id];
        const mark = sent ? `<span class="pr-sent" title="Предложение уже отправляли">отправлено ${new Date(sent).toLocaleDateString('ru-RU')}</span>` : '';
        return `<button type="button" class="admin-btn" onclick="PayReadiness.openOffer('${this.esc(p.id)}')">Предложить</button>${mark}`;
    },

    // Ссылка, по которой сайт сам открывает окно оплаты выбранного тарифа (app.openPayFromUrl)
    PAY_LINK: 'https://heatcalc.ru/?pay=',

    // Что даёт каждая функция — для человека, а не для таблицы тарифов. Ключи — id функций.
    OFFER_PERKS: {
        rommer: 'Товары ROMMER и подбор аналогов — смета подороже или подешевле в один клик',
        terem: 'Поиск по всему прайсу — любую позицию можно найти и добавить в смету',
        works: 'Монтажные работы прямо в смете, КП и счёте — клиент видит полную стоимость',
        analog: 'Вторая смета «Подешевле» с пояснением, на чём сэкономили, — удобно показать клиенту',
        recognize: 'Смета из проекта: загрузите PDF, Excel или фото — калькулятор разберёт сам',
        design: 'Листы проекта и план этажей — готовые чертежи к смете',
        money: 'Ваша маржа по каждому разделу сметы — видно, сколько вы зарабатываете',
        docs: 'Договор подряда, акты и гарантийный талон — одним нажатием',
        disc1c: 'Скидки клиенту прямо в КП — без ручных пересчётов'
    },

    plural: function (n, one, few, many) {
        const a = Math.abs(n) % 100, b = a % 10;
        if (a > 10 && a < 20) return many;
        if (b > 1 && b < 5) return few;
        return b === 1 ? one : many;
    },

    // Текст для человека p. Возвращает { text, missing } — missing: тарифы без ссылки на оплату
    offerText: function (p) {
        const S = (typeof Subscription !== 'undefined') ? Subscription : null;
        const account = (p.role === 'seller' || p.role === 'both') ? 'seller' : 'installer';
        const lines = [];
        lines.push(p.first ? 'Здравствуйте, ' + p.first + '!' : 'Здравствуйте!');
        lines.push('');
        const facts = [];
        if (p.est30 > 0) facts.push(p.est30 + ' ' + this.plural(p.est30, 'смета', 'сметы', 'смет') + ' за месяц');
        if (p.invoices > 0) facts.push(p.invoices + ' ' + this.plural(p.invoices, 'КП или счёт', 'КП и счёта', 'КП и счетов') + ' клиентам');
        lines.push(facts.length
            ? 'Вы уже собрали в HeatCalc ' + facts.join(' и ') + ' — отлично! Подключите «Профи», чтобы это шло ещё быстрее.'
            : 'Это команда HeatCalc. Подключите «Профи» — сметы будут собираться ещё быстрее.');
        // Функции, которые Профи добавляет сверх Базового (по таблице «Тарифы»), — простыми словами
        const perks = S ? S.benefitRows(account)
            .filter(r => r.pro !== 'off' && r.base === 'off' && this.OFFER_PERKS[r.f.id])
            .map(r => this.OFFER_PERKS[r.f.id]) : [];
        if (perks.length) {
            lines.push('');
            lines.push('Что вы получите:');
            perks.forEach(t => lines.push('✔ ' + t));
        }
        const missing = [];
        if (S) {
            const plans = S.planList(false).map(pl => S.resolve(pl.id, { region: p.rawRegion })).filter(Boolean);
            if (plans.length) {
                lines.push('');
                lines.push('Оплата — в два нажатия: откройте ссылку, окно оплаты появится прямо в калькуляторе.');
                plans.forEach(r => {
                    let row = '• ' + r.label + ' — ' + S.fmtRub(r.rub);
                    const pct = r.promo ? r.promoPct : r.termPct;
                    if (r.months > 1) row += ' (' + S.fmtRub(r.perMonth) + ' в месяц' + (pct > 0 ? ', скидка ' + pct + ' %' : '') + ')';
                    else if (pct > 0) row += ' (скидка ' + pct + ' %)';
                    if (r.promo && r.promo.title) row += ', акция «' + r.promo.title + '»';
                    lines.push(row);
                    lines.push('  ' + this.PAY_LINK + encodeURIComponent(r.id));
                    if (!r.url) missing.push(r.label);
                });
                lines.push('');
                lines.push('После оплаты нажмите в окне «Я оплатил» — подключим доступ.');
            }
        }
        lines.push('Вопросы — просто ответьте на это сообщение.');
        return { text: lines.join('\n'), missing: missing };
    },

    _offerFor: null,

    openOffer: function (id) {
        const p = this._data && this._data.people.find(x => x.id === id);
        if (!p) return;
        this._offerFor = p;
        const o = this.offerText(p);
        let el = document.getElementById('pr_offer_overlay');
        if (el) el.remove();
        el = document.createElement('div');
        el.id = 'pr_offer_overlay';
        el.style.cssText = 'position:fixed; inset:0; z-index:2147483000; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; padding:16px;';
        el.addEventListener('mousedown', e => { if (e.target === el) this.closeOffer(); });
        const warn = o.missing.length ? `<div class="ad-card-note ad-warn" style="padding:0;">У тарифа без ссылки на оплату: ${this.esc(o.missing.join(', '))}. Добавьте её в «Оплате подписки» или впишите в текст вручную.</div>` : '';
        el.innerHTML = `<div class="pr-offer">
            <div class="pr-offer-h"><b>Предложение: ${this.esc(p.name)}</b><button type="button" class="admin-btn" onclick="PayReadiness.closeOffer()">✕</button></div>
            <div class="ad-card-note" style="padding:0;">Текст собран автоматически: преимущества для роли «${this.ROLE_LABEL[p.role]}», цены и ссылки с учётом региона${p.rawRegion ? ' (' + this.esc(p.rawRegion) + ')' : ''}. Можно поправить перед отправкой.</div>
            <textarea id="pr_offer_text" class="pr-offer-text" rows="14">${this.esc(o.text)}</textarea>
            ${warn}
            <div class="pr-offer-btns">
                <button type="button" class="admin-btn" onclick="PayReadiness.copyOffer()">Скопировать</button>
                <button type="button" class="admin-btn pr-offer-send" onclick="PayReadiness.sendOffer()">Отправить в сообщения</button>
                <span id="pr_offer_status" class="ad-card-note" style="padding:0;"></span>
            </div></div>`;
        document.body.appendChild(el);
    },

    closeOffer: function () {
        const el = document.getElementById('pr_offer_overlay');
        if (el) el.remove();
        this._offerFor = null;
    },

    offerStatus: function (msg) {
        const s = document.getElementById('pr_offer_status');
        if (s) s.textContent = msg;
    },

    copyOffer: async function () {
        const ta = document.getElementById('pr_offer_text');
        if (!ta) return;
        try {
            await navigator.clipboard.writeText(ta.value);
            this.offerStatus('Скопировано');
        } catch (e) {
            ta.select();
            this.offerStatus('Выделено — нажмите Ctrl+C');
        }
    },

    // Личное сообщение в «Сообщения» человека; дальше как у sendAdminMessage: пуш получателю
    sendOffer: async function () {
        const p = this._offerFor, ta = document.getElementById('pr_offer_text');
        if (!p || !ta || !ta.value.trim()) return;
        // _currentUserRow заполняется только при загрузке своих смет — берём строку так же, как переписка
        const me = (typeof app !== 'undefined') && (app._meRow || app._currentUserRow || await app.resolveMeRow());
        if (!me || !me.id) { this.offerStatus('Не нашёл вашу учётную запись — скопируйте текст и отправьте вручную.'); return; }
        this.offerStatus('Отправляю…');
        try {
            const { data: inserted, error } = await supabaseClient.from('messages')
                .insert({ sender_id: me.id, recipient_id: p.id, text: ta.value.trim(), type: 'private' })
                .select('id').maybeSingle();
            if (error) throw error;
            if (inserted && inserted.id && typeof appPush !== 'undefined') appPush.notify('broadcast', inserted.id);
            const m = this.sentMap(); m[p.id] = Date.now();
            try { localStorage.setItem(this.LS_SENT, JSON.stringify(m)); } catch (e) { }
            this.closeOffer();
            this.renderPeople();
        } catch (e) {
            this.offerStatus('Не отправилось: ' + ((e && e.message) || e));
        }
    },

    setHeat: function (f) { this._heatFilter = f; this.renderPeople(); },

    renderPeople: function () {
        const el = document.getElementById('pr_people');
        if (!el || !this._data) return;
        const a = this._data;
        const counts = { hot: 0, warm: 0, cold: 0 };
        a.people.forEach(p => counts[p.level]++);
        const chips = [['hot', 'Горячие'], ['warm', 'Тёплые'], ['cold', 'Холодные']].map(([id, label]) =>
            `<button type="button" class="ad-chip${this._heatFilter === id ? ' active' : ''}" onclick="PayReadiness.setHeat('${id}')">${label} <span class="ad-chip-n">${counts[id]}</span></button>`).join('');
        const list = a.people.filter(p => p.level === this._heatFilter).sort((x, y) => y.score - x.score || y.estSum - x.estSum).slice(0, 200);
        const dn = {}; a.byDist.forEach(g => { dn[g.key] = g.label; });
        const rows = list.map(p => `<tr>
            <td class="pr-who"><b>${this.esc(p.name)}</b><span>${this.esc(p.email)}</span></td>
            <td>${this.ROLE_LABEL[p.role]}</td>
            <td>${this.esc(p.city || '—')}</td>
            <td>${this.esc(p.dist ? (dn[p.dist] || '') : '—')}</td>
            <td class="n">${p.est30} / ${p.est}</td>
            <td class="n">${p.invoices}</td>
            <td class="n">${p.days}</td>
            <td class="n"><span class="pr-score pr-${p.level}">${p.score}</span></td>
            <td>${p.offer === 'shop' ? 'Магазин' : 'Профи'}</td>
            <td class="pr-act">${this.offerCell(p)}</td></tr>`).join('');
        el.innerHTML = `<div class="ad-chips" style="margin:0 0 4px;">${chips}</div>` + (list.length
            ? `<div class="pr-wrap"><table class="pr-table pr-people"><thead><tr><th>Кто</th><th>Роль</th><th>Город</th><th>Дистрибьютор</th><th class="n">Смет 30д / всего</th><th class="n">КП, счетов</th><th class="n">Дней</th><th class="n">Балл</th><th>Что предлагать</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
            : '<div class="ad-card-note">В этой группе никого нет.</div>');
    }
};

if (typeof module !== 'undefined' && module.exports) module.exports = PayReadiness;
