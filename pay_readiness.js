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
        box.innerHTML = '<div style="color:var(--text-sec); font-size:13px;">Считаю по базе…</div>';
        this.load().then(() => this.renderAll());
    },
    reload: function () {
        this._data = null;
        const box = document.getElementById('admin_payready_box');
        if (box) box.innerHTML = '<div style="color:var(--text-sec); font-size:13px;">Перечитываю базу…</div>';
        this.load(true).then(() => this.renderAll());
    },

    card: function (title, body, note) {
        return `<div style="border:1px solid var(--border); border-radius:12px; padding:14px 16px; margin-bottom:14px;">
            <div style="font-size:14px; font-weight:700; margin-bottom:${note ? 4 : 10}px;">${title}</div>
            ${note ? `<div style="font-size:12px; color:var(--text-sec); line-height:1.5; margin-bottom:10px;">${note}</div>` : ''}
            ${body}</div>`;
    },

    renderAll: function () {
        const box = document.getElementById('admin_payready_box');
        if (!box) return;
        if (this._error || !this._data) {
            box.innerHTML = `<div style="color:#EF4444; font-size:13px;">Отчёт не загрузился: ${this.esc(this._error || 'нет данных')}</div>
                <button type="button" class="admin-btn" style="margin-top:8px;" onclick="PayReadiness.reload()">Повторить</button>`;
            return;
        }
        const a = this._data;
        const tile = (v, l) => `<div style="flex:1 1 130px; border:1px solid var(--border); border-radius:12px; padding:10px 12px;">
            <div style="font-size:20px; font-weight:800; line-height:1.1;">${v}</div><div style="font-size:11px; color:var(--text-sec); margin-top:3px;">${l}</div></div>`;
        const hot = a.people.filter(p => p.level === 'hot').length, warm = a.people.filter(p => p.level === 'warm').length;
        const paid = a.funnel[a.funnel.length - 1].n;
        const noPayTable = a.payments === null
            ? '<div style="font-size:12px; color:#D97706; margin-bottom:10px;">Таблицы оплат (subscription_payments) в базе нет — шаги «Я оплатил» и «Оплатили» считать нечем.</div>' : '';

        box.innerHTML = `
            ${noPayTable}
            <div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
                ${tile(a.people.length, 'человек в расчёте (без админов и наблюдателей)')}
                ${tile(hot, 'горячих — готовы платить')}
                ${tile(warm, 'тёплых — присматриваются')}
                ${tile(this.rub(a.medianEst), 'медианная смета (' + a.estCount + ' шт.)')}
                ${tile(this.rub(a.medianWorks), 'медиана работ в смете')}
                ${tile(paid, 'оплатили')}
            </div>
            <div style="margin-bottom:10px;"><button type="button" class="admin-btn" onclick="PayReadiness.reload()" title="Перечитать базу">Обновить</button></div>
            ${this.card('Воронка', this.funnelHtml(a), 'Где люди отваливаются на пути к оплате. Процент — от тех, кто зарегистрировался.')}
            ${this.card('Выручка при ваших ценах', '<div id="pr_forecast"></div>', 'Ориентир, а не прогноз: сколько вышло бы, если бы часть горячих и тёплых оплатила. Цены и процент хранятся только в этом браузере.')}
            ${this.card('Кто готов платить', this.groupsHtml(a), 'Горячие — те, кто уже делает смету и отправляет КП. Строки отсортированы по числу горячих.')}
            ${this.card('Люди', '<div id="pr_people"></div>', 'Балл: смета за 30 дней 2–3, отправленный КП/счёт 3, заходы в 3+ разных дня 2, визит за неделю 1, смета от 500 тыс. ₽ 1. Горячий — ' + this.HOT_FROM + '+, тёплый — ' + this.WARM_FROM + '–' + (this.HOT_FROM - 1) + '.')}`;
        this.renderForecast();
        this.renderPeople();
    },

    funnelHtml: function (a) {
        const top = a.funnel[0].n || 1;
        return a.funnel.map(s => {
            const w = Math.max(2, Math.round(s.n * 100 / top));
            return `<div style="display:flex; align-items:center; gap:10px; margin-bottom:6px; font-size:13px;">
                <div style="flex:0 0 210px;">${this.esc(s.label)}</div>
                <div style="flex:1 1 auto; background:var(--bg-sec, rgba(127,127,127,.12)); border-radius:6px; height:14px;"><div style="width:${w}%; height:100%; border-radius:6px; background:#3B82F6;"></div></div>
                <div style="flex:0 0 90px; text-align:right; font-weight:700;">${s.n} <span style="font-weight:400; color:var(--text-sec);">${this.pct(s.n, top)}</span></div>
            </div>`;
        }).join('');
    },

    groupsHtml: function (a) {
        const th = 'text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.03em; color:var(--text-sec); padding:6px 8px; border-bottom:1px solid var(--border); white-space:nowrap;';
        const td = 'padding:6px 8px; border-bottom:1px solid var(--border); font-size:13px;';
        const table = (title, rows) => `<div style="font-size:12px; font-weight:700; margin:10px 0 4px;">${title}</div>
            <div style="overflow-x:auto;"><table style="border-collapse:collapse; width:100%; min-width:420px;">
            <tr><th style="${th}">Группа</th><th style="${th}">Людей</th><th style="${th}">Горячих</th><th style="${th}">Тёплых</th><th style="${th}">Смет</th><th style="${th}">КП и счетов</th></tr>
            ${rows.map(g => `<tr><td style="${td}">${this.esc(g.label)}</td><td style="${td}">${g.n}</td><td style="${td} font-weight:700;">${g.hot}</td><td style="${td}">${g.warm}</td><td style="${td}">${g.est}</td><td style="${td}">${g.inv}</td></tr>`).join('')}
            </table></div>`;
        return table('По роли в анкете', a.byRole) + table('По региону', a.byRegion) + table('По дистрибьютору', a.byDist);
    },

    renderForecast: function () {
        const el = document.getElementById('pr_forecast');
        if (!el || !this._data) return;
        const a = this._data, inp = this.inputs(), f = this.forecast(a, inp);
        const field = (key, label, suffix) => `<label style="display:flex; flex-direction:column; gap:3px; font-size:12px; color:var(--text-sec);">${label}
            <span><input type="number" min="0" step="${key === 'conv' ? 5 : 100}" value="${inp[key]}" onchange="PayReadiness.setInput('${key}', this.value)"
            style="width:100px; padding:7px 9px; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--text-main); font-size:14px; font-weight:700;"> ${suffix}</span></label>`;
        let cur = '';
        try {
            if (typeof Subscription !== 'undefined') {
                const p = Subscription.settings().plans;
                if (p.month && p.year) cur = `<div style="font-size:12px; color:var(--text-sec); margin-top:8px;">Сейчас в «Оплате подписки»: месяц ${this.rub(p.month.rub)}, год ${this.rub(p.year.rub)}.
                    ${a.medianEst ? 'Год «Профи» — ' + (Math.round(p.year.rub * 1000 / a.medianEst) / 10) + ' % от медианной сметы.' : ''}</div>`;
            }
        } catch (e) { }
        el.innerHTML = `<div style="display:flex; flex-wrap:wrap; gap:16px; margin-bottom:12px;">
                ${field('proPrice', 'Профи (монтажник), в месяц', '₽')}
                ${field('shopPrice', 'Магазин, за точку в месяц', '₽')}
                ${field('conv', 'Сколько горячих и тёплых оплатят', '%')}
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:10px;">
                <div style="flex:1 1 200px; border:1px solid var(--border); border-radius:10px; padding:10px 12px;">
                    <div style="font-size:12px; color:var(--text-sec);">Профи: из ${f.proPool} человек оплатят ${f.proN}</div>
                    <div style="font-size:18px; font-weight:800;">${this.rub(f.pro)}/мес</div></div>
                <div style="flex:1 1 200px; border:1px solid var(--border); border-radius:10px; padding:10px 12px;">
                    <div style="font-size:12px; color:var(--text-sec);">Магазин: из ${f.shopPool} точек оплатят ${f.shopN}</div>
                    <div style="font-size:18px; font-weight:800;">${this.rub(f.shop)}/мес</div></div>
                <div style="flex:1 1 200px; border:1px solid var(--border); border-radius:10px; padding:10px 12px;">
                    <div style="font-size:12px; color:var(--text-sec);">Итого в месяц / в год</div>
                    <div style="font-size:18px; font-weight:800;">${this.rub(f.total)} / ${this.rub(f.total * 12)}</div></div>
            </div>
            <div style="font-size:11px; color:var(--text-sec); margin-top:8px; line-height:1.5;">Магазин считается по дистрибьюторам, у которых не меньше двух горячих или тёплых продавцов; Профи — по остальным горячим и тёплым.</div>
            ${cur}`;
    },

    setHeat: function (f) { this._heatFilter = f; this.renderPeople(); },

    renderPeople: function () {
        const el = document.getElementById('pr_people');
        if (!el || !this._data) return;
        const a = this._data;
        const counts = { hot: 0, warm: 0, cold: 0 };
        a.people.forEach(p => counts[p.level]++);
        const chips = [['hot', 'Горячие'], ['warm', 'Тёплые'], ['cold', 'Холодные']].map(([id, label]) =>
            `<button type="button" class="ad-chip${this._heatFilter === id ? ' active' : ''}" onclick="PayReadiness.setHeat('${id}')">${label} <span class="ad-chip-n">${counts[id]}</span></button>`).join(' ');
        const list = a.people.filter(p => p.level === this._heatFilter).sort((x, y) => y.score - x.score || y.estSum - x.estSum).slice(0, 200);
        const th = 'text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.03em; color:var(--text-sec); padding:6px 8px; border-bottom:1px solid var(--border); white-space:nowrap;';
        const td = 'padding:6px 8px; border-bottom:1px solid var(--border); font-size:13px;';
        const dn = {}; a.byDist.forEach(g => { dn[g.key] = g.label; });
        const rows = list.map(p => `<tr>
            <td style="${td}">${this.esc(p.name)}<div style="font-size:11px; color:var(--text-sec);">${this.esc(p.email)}</div></td>
            <td style="${td}">${this.ROLE_LABEL[p.role]}</td>
            <td style="${td}">${this.esc(p.city || '—')}</td>
            <td style="${td}">${this.esc(p.dist ? (dn[p.dist] || '') : '—')}</td>
            <td style="${td}">${p.est30}/${p.est}</td>
            <td style="${td}">${p.invoices}</td>
            <td style="${td}">${p.days}</td>
            <td style="${td} font-weight:700;">${p.score}</td>
            <td style="${td}">${p.offer === 'shop' ? 'Магазин' : 'Профи'}</td></tr>`).join('');
        el.innerHTML = `<div style="margin-bottom:8px;">${chips}</div>` + (list.length
            ? `<div style="overflow-x:auto;"><table style="border-collapse:collapse; width:100%; min-width:720px;">
                <tr><th style="${th}">Кто</th><th style="${th}">Роль</th><th style="${th}">Город</th><th style="${th}">Дистрибьютор</th><th style="${th}">Смет 30д / всего</th><th style="${th}">КП, счетов</th><th style="${th}">Дней</th><th style="${th}">Балл</th><th style="${th}">Что предлагать</th></tr>
                ${rows}</table></div>`
            : '<div style="color:var(--text-sec); font-size:13px;">В этой группе никого нет.</div>');
    }
};

if (typeof module !== 'undefined' && module.exports) module.exports = PayReadiness;
