/**
 * subscription.js — подписка Профи: цены и ссылки на оплату, акции, региональные
 * цены, учёт заявок и оплат, вкладка «Оплата подписки» в панели управления.
 *
 * Настройки лежат в базе, в app_settings под ключом `subscription`
 * (таблица и политика «пишет только администратор» уже есть — те же, что у
 * вкладки «Тарифы»). Пока в базе ничего не записано, работают значения
 * BASE_PLANS — ровно те, что раньше были зашиты в app.proPaymentLinks.
 *
 *   {
 *     v: 1,
 *     plans:   { month: { title, label, months, rub, url, enabled }, year: {…}, <свой id>: {…} },
 *     promos:  [ { id, title, kind: 'percent'|'rub'|'price', value, plans: [id…], regions: [строки], from, to, url, enabled } ],
 *     regions: [ { id, title, match: [строки], prices: { <plan>: { rub, url } }, enabled } ],
 *     note:    'текст под QR-кодом в окне оплаты',
 *     benefits: { installer: [строки], seller: [строки] }   // свой текст в окне тарифа, пусто = собирается из таблицы «Тарифы»
 *   }
 *
 * Цена для конкретного человека считается в resolve(): тариф → региональная
 * цена (по полю «регион» анкеты) → лучшая из действующих акций. У каждой
 * цены своя ссылка на перевод: сумма в ссылке Т-Банка зашита, поэтому цена
 * без своей ссылки — ошибка настройки, вкладка её подсвечивает.
 *
 * Учёт: таблица subscription_payments (supabase/migrations/20260927_subscription_payments.sql).
 * Кнопка «Я оплатил» пишет заявку (logRequest), владелец во вкладке отмечает
 * «Оплачено» — тогда же продлевается Профи в карточке пользователя
 * (demo_ends_at и pro_expires_at, как это делает карточка в «Пользователях»).
 *
 * Что из калькулятора сюда ходит: app.openPaymentModal (цена, ссылка, QR,
 * подпись), notifyPayment (заявка), app.showModal('pro') (текст преимуществ и
 * карточки тарифов), app.proPlan (ИИ-помощник).
 */
const Subscription = {
    KEY: 'subscription',
    TABLE: 'subscription_payments',
    SQL_FILE: 'supabase/migrations/20260927_subscription_payments.sql',

    // Как было до вкладки: два тарифа, ссылки Т-Банка на перевод физлицу
    BASE_PLANS: {
        month: { title: 'Подписка на месяц', label: 'Профи 1 месяц', months: 1, rub: 5000, url: 'https://www.tbank.ru/cf/59ivYDZRKQK', enabled: true },
        year: { title: 'Подписка на год', label: 'Профи 1 год', months: 12, rub: 48000, url: 'https://tbank.ru/cf/7tE93xi7saP', enabled: true }
    },

    // Как функция таблицы «Тарифы» называется в окне тарифа для монтажника
    BENEFIT_TEXT: {
        rommer: 'ассортимент ROMMER и подбор аналогов',
        terem: 'весь прайс-лист ТЕРЕМ в поиске и распознавании',
        works: 'монтажные работы в смете, КП и счёте',
        analog: 'вторая смета «Бюджетнее» с обоснованием',
        recognize: 'распознавание смет и проектов из PDF, Excel и фото',
        design: 'листы проекта и редактор планов этажей',
        money: 'вкладка «Деньги» — маржа по каждому разделу сметы',
        docs: 'договор подряда, акты и гарантийный талон',
        disc1c: 'скидки от прайса ТЕРЕМ при просмотре КП'
    },

    // Где в калькуляторе открывается окно тарифа — для раздела «Как выглядит».
    // Список составлен по вызовам app.showModal('pro') в app.js; добавили
    // новую точку — допишите строку, иначе раздел будет врать.
    TRIGGERS: [
        { where: 'Кабинет → «Профиль», карточка «Текущий тариф»', when: 'кнопка «Оформить Профи» / «Продлить»' },
        { where: 'Вкладка «Деньги» (маржа)', when: 'учётка без Профи нажимает вкладку или пытается изменить настройку маржи' },
        { where: 'Переключатель «Бюджетнее» и ассортимент ROMMER', when: 'у учётки без Профи, если её тарифу «Профи» этот столбец открыт в таблице «Тарифы»' },
        { where: 'Замки на переключателях сметы (режим Профи, функции с пометкой «Профи»)', when: 'нажатие на закрытый переключатель' },
        { where: 'Окно «Нужен промокод магазина»', when: 'ссылка «Посмотреть платные тарифы»' },
        { where: 'ИИ-помощник', when: 'вопрос про тариф или оплату — открывает окно и даёт ссылки на оплату' }
    ],

    _view: 'plans',
    _saving: false,
    _saveError: null,
    _qrCache: {},

    // ═══ Настройки ═══════════════════════════════════════════════════════
    raw: function () {
        return (typeof app !== 'undefined' && app.appSettings && app.appSettings[this.KEY]) || {};
    },

    settings: function () {
        const raw = this.raw();
        const plans = {};
        Object.keys(this.BASE_PLANS).forEach(k => { plans[k] = Object.assign({ id: k }, this.BASE_PLANS[k]); });
        Object.keys(raw.plans || {}).forEach(k => {
            if (!/^[a-z0-9_]{1,24}$/.test(k)) return;
            plans[k] = Object.assign({ id: k }, this.BASE_PLANS[k] || {}, raw.plans[k], { id: k });
        });
        return {
            v: 1,
            plans: plans,
            promos: Array.isArray(raw.promos) ? raw.promos.filter(p => p && p.id) : [],
            regions: Array.isArray(raw.regions) ? raw.regions.filter(r => r && r.id) : [],
            note: typeof raw.note === 'string' ? raw.note : '',
            benefits: raw.benefits || {}
        };
    },

    // Тарифы по возрастанию срока. all = вместе с выключенными (для панели)
    planList: function (all) {
        const s = this.settings();
        return Object.keys(s.plans).map(k => s.plans[k])
            .filter(p => all || p.enabled !== false)
            .sort((a, b) => (this.num(a.months) || 0) - (this.num(b.months) || 0));
    },

    num: function (v) { const n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; },
    esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
    fmtRub: function (n) { return Math.round(this.num(n)).toLocaleString('ru-RU') + ' ₽'; },
    fmtDate: function (d) { if (!d) return '—'; const t = new Date(d); return isNaN(t) ? '—' : t.toLocaleDateString('ru-RU'); },
    fmtDateTime: function (d) { if (!d) return '—'; const t = new Date(d); return isNaN(t) ? '—' : t.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); },
    today: function () { return new Date().toISOString().slice(0, 10); },
    newId: function (prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); },
    monthsWord: function (n) { n = Math.round(this.num(n)); const m = n % 10, h = n % 100; if (h >= 11 && h <= 14) return n + ' месяцев'; if (m === 1) return n + ' месяц'; if (m >= 2 && m <= 4) return n + ' месяца'; return n + ' месяцев'; },

    // Регион человека: анкета (users.region) → сохранённый профиль
    userRegion: function () {
        if (typeof app === 'undefined') return '';
        const row = app._currentUserRow || {};
        const tg = (app.state && app.state.tgUser) || {};
        return String(row.region || tg.region || '').trim();
    },

    // Учётная запись для текста преимуществ: продавец / монтажник
    userAccount: function () {
        try { const a = app.tariffAccount(); return a === 'seller' ? 'seller' : 'installer'; } catch (e) { return 'installer'; }
    },

    matchRegion: function (list, region) {
        const r = String(region || '').toLowerCase();
        if (!r) return false;
        return (list || []).some(m => { const s = String(m || '').trim().toLowerCase(); return s && r.indexOf(s) >= 0; });
    },

    regionRuleFor: function (region) {
        return this.settings().regions.find(r => r.enabled !== false && this.matchRegion(r.match, region)) || null;
    },

    // Действует ли акция в момент at (по местному дню; «до» — включительно)
    promoActive: function (p, at) {
        if (!p || p.enabled === false) return false;
        const day = (at ? new Date(at) : new Date());
        const d = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
        if (p.from && d < p.from) return false;
        if (p.to && d > p.to) return false;
        return true;
    },

    promoState: function (p) {
        if (p.enabled === false) return { id: 'off', label: 'выключена', color: '#64748B' };
        const d = this.today();
        if (p.from && d < p.from) return { id: 'soon', label: 'начнётся ' + this.fmtDate(p.from), color: '#2563EB' };
        if (p.to && d > p.to) return { id: 'ended', label: 'закончилась ' + this.fmtDate(p.to), color: '#64748B' };
        return { id: 'on', label: p.to ? 'действует до ' + this.fmtDate(p.to) : 'действует', color: '#10B981' };
    },

    applyPromo: function (rub, p) {
        const v = this.num(p.value);
        let r = rub;
        if (p.kind === 'percent') r = rub * (1 - v / 100);
        else if (p.kind === 'rub') r = rub - v;
        else if (p.kind === 'price') r = v;
        r = Math.max(0, Math.round(r / 10) * 10);
        return r;
    },

    /**
     * Цена тарифа для человека: тариф → региональная цена → лучшая акция.
     * ctx: { region, account, at } — для предпросмотра в панели; без ctx берётся сам пользователь.
     */
    resolve: function (planId, ctx) {
        ctx = ctx || {};
        const s = this.settings();
        const p = s.plans[planId];
        if (!p) return null;
        const region = ctx.region !== undefined ? ctx.region : this.userRegion();
        let rub = this.num(p.rub), url = p.url || '', urlOwn = !!p.url, src = 'plan';
        const rule = this.regionRuleFor(region);
        if (rule && rule.prices && rule.prices[planId] && this.num(rule.prices[planId].rub) > 0) {
            rub = this.num(rule.prices[planId].rub);
            if (rule.prices[planId].url) { url = rule.prices[planId].url; urlOwn = true; } else urlOwn = false;
            src = 'region';
        }
        const baseRub = rub;
        let promo = null, best = rub;
        s.promos.forEach(pr => {
            if (!this.promoActive(pr, ctx.at)) return;
            if (Array.isArray(pr.plans) && pr.plans.length && pr.plans.indexOf(planId) < 0) return;
            if (Array.isArray(pr.regions) && pr.regions.length && !this.matchRegion(pr.regions, region)) return;
            const r = this.applyPromo(baseRub, pr);
            if (r < best) { best = r; promo = pr; }
        });
        if (promo) {
            rub = best;
            if (promo.url) { url = promo.url; urlOwn = true; } else urlOwn = false;
            src = 'promo';
        }
        const months = Math.max(1, Math.round(this.num(p.months)) || 1);
        const monthly = s.plans.month && s.plans.month.enabled !== false ? this.num(s.plans.month.rub) : 0;
        return {
            id: planId, title: p.title || p.label || planId, label: p.label || p.title || planId,
            months: months, rub: rub, baseRub: baseRub, url: url, urlOwn: urlOwn, src: src,
            promo: promo, rule: rule, region: region,
            perMonth: Math.round(rub / months),
            promoPct: promo && baseRub ? Math.round((1 - rub / baseRub) * 100) : 0,
            // Скидка за срок относительно помесячной оплаты — как было «-20 %» у года
            termPct: (months > 1 && monthly) ? Math.round((1 - rub / (monthly * months)) * 100) : 0,
            tariffName: (p.label || p.title || planId) + (promo ? ' · акция «' + (promo.title || '') + '»' : '')
        };
    },

    // ═══ Пробный Профи: предложение после сохранения сметы ═══════════════
    // Настройки лежат там же, в app_settings.subscription.trial. Пока их нет,
    // предложение включено, сотрудникам ТЕРЕМ не показывается.
    TRIAL_DEFAULTS: { enabled: true, from: '', to: '', days: 14, excludeTerem: true },

    trialSettings: function () {
        const t = Object.assign({}, this.TRIAL_DEFAULTS, this.raw().trial || {});
        t.days = Math.min(60, Math.max(1, Math.round(this.num(t.days)) || 14));
        // Дата с годом до 2000 — след старого поля, где ввод года застревал на «0020»; такой даты не бывает
        if (String(t.from || '') < '2000') t.from = '';
        if (String(t.to || '') < '2000') t.to = '';
        return t;
    },

    // Местный день в виде ГГГГ-ММ-ДД, как у акций (today() считает по UTC)
    localDay: function () {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    },

    trialStatus: function () {
        const t = this.trialSettings(), d = this.localDay();
        if (!t.enabled) return { on: false, label: 'выключено', color: '#64748B' };
        if (t.from && d < t.from) return { on: false, label: 'начнётся ' + this.fmtDate(t.from), color: '#2563EB' };
        if (t.to && d > t.to) return { on: false, label: 'закончилось ' + this.fmtDate(t.to), color: '#64748B' };
        return { on: true, label: t.to ? 'идёт до ' + this.fmtDate(t.to) : 'идёт без срока окончания', color: '#10B981' };
    },

    // Показывать ли предложение этому человеку: переключатель и даты, затем сотрудники ТЕРЕМ
    trialOfferAllowed: function () {
        if (!this.trialStatus().on) return false;
        if (this.trialSettings().excludeTerem && typeof app !== 'undefined' && app.isTeremStaff()) return false;
        return true;
    },

    setTrialField: function (field, value) {
        if (['enabled', 'from', 'to', 'days', 'excludeTerem'].indexOf(field) < 0) return;
        if (field === 'enabled' || field === 'excludeTerem') value = !!value;
        else if (field === 'days') value = Math.min(60, Math.max(1, Math.round(this.num(value)) || 14));
        else value = /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
        this.apply(v => { v.trial = Object.assign({}, v.trial || {}, { [field]: value }); return v; });
        this.render();
    },

    // Обе даты за один раз: одна запись в базу и одна перерисовка. Раньше у каждой даты было
    // своё нативное поле, и перерисовка по change стирала ввод посреди года («0020»).
    setTrialRange: function (from, to) {
        const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '';
        from = ok(from); to = ok(to);
        if (from && to && to < from) { const x = from; from = to; to = x; }
        this.apply(v => { v.trial = Object.assign({}, v.trial || {}, { from: from, to: to }); return v; });
        this.render();
    },

    trialRangeLabel: function (t) {
        if (!t.from && !t.to) return 'Без ограничения по датам';
        if (t.from && !t.to) return 'с ' + this.fmtDate(t.from) + ' без конца';
        if (!t.from && t.to) return 'до ' + this.fmtDate(t.to);
        return this.fmtDate(t.from) + ' — ' + this.fmtDate(t.to);
    },

    // ── календарь выбора периода ────────────────────────────────────────
    _cal: null,
    dayStr: function (y, m, d) { return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'); },

    // Тот же календарь для одной даты — «Лимит КП → Действует с даты». Нативное поле
    // даты здесь не годится: change срабатывает на «0002», перерисовка стирает ввод.
    openLimitFrom: function () {
        const t = this.limitSettings();
        const base = t.from || this.localDay();
        this._cal = { mode: 'limit', from: t.from || '', to: '', y: +base.slice(0, 4), m: +base.slice(5, 7) - 1 };
        this.renderCal();
    },

    openTrialRange: function () {
        const t = this.trialSettings();
        const base = t.from || this.localDay();
        this._cal = { from: t.from || '', to: t.to || '', y: +base.slice(0, 4), m: +base.slice(5, 7) - 1 };
        this.renderCal();
    },

    closeCal: function () {
        const el = document.getElementById('sub_cal_overlay');
        if (el) el.remove();
        this._cal = null;
    },

    calNav: function (delta) {
        const c = this._cal; if (!c) return;
        const d = new Date(c.y, c.m + delta, 1);
        c.y = d.getFullYear(); c.m = d.getMonth();
        this.renderCal();
    },

    // Первый щелчок — начало, второй — конец (раньше начала — меняем местами); третий начинает заново
    calPick: function (day) {
        const c = this._cal; if (!c) return;
        if (c.mode === 'limit') { this.setLimitField('from', day); this.closeCal(); return; }
        if (!c.from || (c.from && c.to)) { c.from = day; c.to = ''; this.renderCal(); return; }
        c.to = day;
        if (c.to < c.from) { const x = c.from; c.from = c.to; c.to = x; }
        this.setTrialRange(c.from, c.to);
        this.closeCal();
    },
    calApplyOpenEnd: function () { const c = this._cal; if (!c || !c.from) return; this.setTrialRange(c.from, ''); this.closeCal(); },
    calClear: function () {
        const lim = this._cal && this._cal.mode === 'limit';
        if (lim) this.setLimitField('from', ''); else this.setTrialRange('', '');
        this.closeCal();
    },

    renderCal: function () {
        const c = this._cal; if (!c) return;
        let el = document.getElementById('sub_cal_overlay');
        if (!el) {
            el = document.createElement('div');
            el.id = 'sub_cal_overlay';
            // Выше окон-оверлеев админки (у них 9999999+): со 100000 календарь открывался под панелью
            el.style.cssText = 'position:fixed; inset:0; z-index:2147483000; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; padding:16px;';
            el.addEventListener('mousedown', e => { if (e.target === el) this.closeCal(); });
            document.body.appendChild(el);
        }
        const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
        const today = this.localDay();
        const first = new Date(c.y, c.m, 1);
        const lead = (first.getDay() + 6) % 7;               // неделя с понедельника
        const total = new Date(c.y, c.m + 1, 0).getDate();
        const cell = 'width:38px; height:36px; border:0; border-radius:8px; font-size:13px; cursor:pointer; background:transparent; color:var(--text-main);';
        let grid = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(w => `<div style="width:38px; text-align:center; font-size:11px; color:var(--text-sec); padding-bottom:4px;">${w}</div>`).join('');
        for (let i = 0; i < lead; i++) grid += '<div style="width:38px;"></div>';
        for (let d = 1; d <= total; d++) {
            const s = this.dayStr(c.y, c.m, d);
            const edge = s === c.from || s === c.to;
            const mid = c.from && c.to && s > c.from && s < c.to;
            let st = cell;
            if (edge) st += 'background:#2563EB; color:#fff; font-weight:700;';
            else if (mid) st += 'background:rgba(37,99,235,.22);';
            else if (s === today) st += 'box-shadow:inset 0 0 0 1px #2563EB;';
            grid += `<button type="button" style="${st}" onclick="Subscription.calPick('${s}')">${d}</button>`;
        }
        const hint = c.mode === 'limit' ? 'Выберите день начала действия лимита' : (!c.from ? 'Выберите первый день' : (!c.to ? 'Теперь выберите последний день' : 'Период выбран'));
        const btn = 'height:32px; padding:0 12px; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--text-main); font-size:12.5px; cursor:pointer;';
        el.innerHTML = `<div style="background:var(--bg); color:var(--text-main); border:1px solid var(--border); border-radius:14px; padding:16px; box-shadow:0 20px 50px rgba(0,0,0,.4); max-width:100%;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
                <button type="button" style="${btn}" onclick="Subscription.calNav(-1)">‹</button>
                <b style="font-size:14px;">${MONTHS[c.m]} ${c.y}</b>
                <button type="button" style="${btn}" onclick="Subscription.calNav(1)">›</button>
            </div>
            <div style="font-size:12px; color:var(--text-sec); text-align:center; margin-bottom:10px;">${hint}${c.from ? ': ' + this.fmtDate(c.from) + (c.to ? ' — ' + this.fmtDate(c.to) : '') : ''}</div>
            <div style="display:flex; flex-wrap:wrap; width:${38 * 7}px; margin:0 auto 12px;">${grid}</div>
            <div style="display:flex; flex-wrap:wrap; gap:8px; justify-content:center;">
                ${c.mode !== 'limit' && c.from && !c.to ? `<button type="button" style="${btn}" onclick="Subscription.calApplyOpenEnd()">Без даты окончания</button>` : ''}
                <button type="button" style="${btn}" onclick="Subscription.calClear()">${c.mode === 'limit' ? 'Сразу, без даты' : 'Без дат'}</button>
                <button type="button" style="${btn}" onclick="Subscription.closeCal()">Закрыть</button>
            </div></div>`;
    },

    viewTrial: function (canEdit) {
        const t = this.trialSettings(), st = this.trialStatus(), dis = !canEdit;
        const u = this.ui;
        const row = (title, hint, control) => `<div style="display:flex; align-items:center; justify-content:space-between; gap:16px; padding:12px 0; border-bottom:1px solid var(--border);">
                <div style="min-width:0;"><div style="font-size:13px; font-weight:600; color:var(--text-main);">${title}</div><div style="font-size:12px; color:var(--text-sec); margin-top:2px; line-height:1.45;">${hint}</div></div>
                <div style="flex:0 0 auto;">${control}</div></div>`;
        return `<p style="${u.hint}">После того как человек сохранил смету и закрыл окно «Смета сохранена», ему один раз предлагается попробовать Профи бесплатно. Включается только по его нажатию; карта не нужна, по окончании доступ возвращается к базовому. Предложение видят только пользователи без Профи, у которых пробного периода ещё не было, не чаще раза в 3 дня и не больше двух раз.</p>
            <div style="${u.card} max-width:760px;">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;"><b style="font-size:14px; color:var(--text-main);">Сейчас:</b> ${this.chip(st.label, st.color)}</div>
                ${row('Предлагать пробный Профи', 'Общий выключатель. Выключено — предложение не показывается никому, уже включённые пробные периоды не прерываются.',
                    this.toggleHtml(!!t.enabled, `Subscription.setTrialField('enabled', ${!t.enabled})`, dis))}
                ${row('Период показа', 'Нажмите и выберите в календаре первый и последний день (оба включительно). Без дат — предложение показывается в любой день.',
                    `<button type="button" ${dis ? 'disabled' : ''} onclick="Subscription.openTrialRange()" style="${u.input} min-width:230px; text-align:left; cursor:${dis ? 'default' : 'pointer'};">${this.trialRangeLabel(t)}</button>`)}
                ${row('Длительность пробного периода', 'В днях, от 1 до 60. Действует для тех, кто включит его после изменения.',
                    `<input type="number" min="1" max="60" value="${t.days}" ${dis ? 'disabled' : ''} onchange="Subscription.setTrialField('days', this.value)" style="${u.input} width:80px;">`)}
                ${row('Не показывать сотрудникам ТЕРЕМ', 'Почта на @teremopt.ru (основная или рабочая) либо привязка к компании «ТЕРЕМ» или её обособленному подразделению.',
                    this.toggleHtml(!!t.excludeTerem, `Subscription.setTrialField('excludeTerem', ${!t.excludeTerem})`, dis))}
            </div>`;
    },

    // ═══ Лимит КП на бесплатном тарифе ═══════════════════════════════════
    // Настройки — app_settings.subscription.limit. По умолчанию ВЫКЛЮЧЕН. Считается
    // число разных КП (по номеру расчёта), которые мастер за календарный месяц отправил
    // клиенту: PDF, Excel или ссылка (события printed и sent в invoice_events).
    // Повторная отправка того же КП лимит не тратит. Блокирует только на тарифе без
    // Профи (free и base); пробный и платный Профи, менеджеры, наблюдатели, админы
    // и (по умолчанию) сотрудники ТЕРЕМ лимит не видят. Любой сбой при подсчёте —
    // пропускаем: лимит не должен мешать работать.
    LIMIT_DEFAULTS: { enabled: false, from: '', perMonth: 3, excludeTerem: true },

    limitSettings: function () {
        const t = Object.assign({}, this.LIMIT_DEFAULTS, this.raw().limit || {});
        t.perMonth = Math.min(100, Math.max(1, Math.round(this.num(t.perMonth)) || 3));
        return t;
    },

    limitStatus: function () {
        const t = this.limitSettings(), d = this.localDay();
        if (!t.enabled) return { on: false, label: 'выключен', color: '#64748B' };
        if (t.from && d < t.from) return { on: false, label: 'начнётся ' + this.fmtDate(t.from), color: '#2563EB' };
        return { on: true, label: t.from ? 'действует с ' + this.fmtDate(t.from) : 'действует', color: '#10B981' };
    },

    setLimitField: function (field, value) {
        if (['enabled', 'from', 'perMonth', 'excludeTerem'].indexOf(field) < 0) return;
        if (field === 'enabled' || field === 'excludeTerem') value = !!value;
        else if (field === 'perMonth') value = Math.min(100, Math.max(1, Math.round(this.num(value)) || 3));
        else value = /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
        this.apply(v => { v.limit = Object.assign({}, v.limit || {}, { [field]: value }); return v; });
        this.render();
    },

    // Касается ли лимит этого человека (без подсчёта отправленных КП)
    limitApplies: function () {
        if (!this.limitStatus().on) return false;
        const tg = (app.state && app.state.tgUser) || {};
        const acc = tg.account_type || app.state.accountType || 'base';
        if (acc !== 'free' && acc !== 'base') return false;
        if (app.isPro()) return false;
        if (this.limitSettings().excludeTerem && app.isTeremStaff()) return false;
        return true;
    },

    // Спрос по журналу событий: сколько бесплатных мастеров сколько КП отправили в
    // прошлом и текущем месяце. Читает админ, invoice_events и users ему доступны.
    loadLimitDemand: async function () {
        this._demand = { loading: true };
        this.render();
        try {
            const now = new Date();
            const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const { data: ev, error } = await supabaseClient.from('invoice_events')
                .select('user_id, calc_id, created_at').in('event', ['printed', 'sent'])
                .gte('created_at', prevStart.toISOString()).limit(5000);
            if (error) throw error;
            const { data: us, error: e2 } = await supabaseClient.from('users')
                .select('id, account_type, email, work_email').in('account_type', ['free', 'base']).limit(2000);
            if (e2) throw e2;
            const excl = this.limitSettings().excludeTerem;
            const isTerem = u => /@([a-z0-9-]+\.)*teremopt\.ru$/i.test(String(u.email || '')) || /@([a-z0-9-]+\.)*teremopt\.ru$/i.test(String(u.work_email || ''));
            const pool = (us || []).filter(u => !(excl && isTerem(u)));
            const ids = new Set(pool.map(u => String(u.id)));
            const key = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            const months = {};
            [prevStart, now].forEach(d => { months[key(d)] = {}; });
            (ev || []).forEach(r => {
                if (!ids.has(String(r.user_id))) return;
                const m = key(new Date(r.created_at));
                if (!months[m]) return;
                (months[m][r.user_id] = months[m][r.user_id] || new Set()).add(r.calc_id);
            });
            const out = {};
            Object.keys(months).forEach(m => {
                out[m] = Object.keys(months[m]).map(uid => months[m][uid].size);
            });
            this._demand = { total: pool.length, months: out };
        } catch (e) {
            console.warn('[лимит КП] спрос не посчитан:', e);
            this._demand = { error: String((e && e.message) || e).slice(0, 160) };
        }
        this.render();
    },

    viewLimit: function (canEdit) {
        const t = this.limitSettings(), st = this.limitStatus(), dis = !canEdit, u = this.ui;
        if (!this._demand) this.loadLimitDemand();
        const row = (title, hint, control) => `<div style="display:flex; align-items:center; justify-content:space-between; gap:16px; padding:12px 0; border-bottom:1px solid var(--border);">
                <div style="min-width:0;"><div style="font-size:13px; font-weight:600; color:var(--text-main);">${title}</div><div style="font-size:12px; color:var(--text-sec); margin-top:2px; line-height:1.45;">${hint}</div></div>
                <div style="flex:0 0 auto;">${control}</div></div>`;
        const D = this._demand || {};
        let demand;
        if (D.loading || !this._demand) demand = '<div style="font-size:12.5px; color:var(--text-sec);">Считаем по журналу событий…</div>';
        else if (D.error) demand = `<div style="font-size:12.5px; color:var(--c-bad,#EF4444);">Не посчиталось: ${this.esc(D.error)}</div>`;
        else {
            const names = { '01': 'январь', '02': 'февраль', '03': 'март', '04': 'апрель', '05': 'май', '06': 'июнь', '07': 'июль', '08': 'август', '09': 'сентябрь', '10': 'октябрь', '11': 'ноябрь', '12': 'декабрь' };
            const keys = Object.keys(D.months).sort();
            demand = keys.map(k => {
                const arr = D.months[k];
                const bucket = (a, b) => arr.filter(n => n >= a && n <= b).length;
                const hit = arr.filter(n => n > t.perMonth).length;
                const cell = (l, n) => `<td style="${u.td} text-align:center;"><div style="font-size:11px; color:var(--text-sec);">${l}</div><b>${n}</b></td>`;
                return `<div style="margin-bottom:12px;"><div style="font-size:13px; font-weight:600; color:var(--text-main); margin-bottom:6px;">${names[k.slice(5)]} ${k.slice(0, 4)}: отправили КП ${arr.length} из ${D.total} бесплатных мастеров</div>
                    <table style="border-collapse:collapse;"><tr>${cell('1', bucket(1, 1))}${cell('2', bucket(2, 2))}${cell('3', bucket(3, 3))}${cell('4–5', bucket(4, 5))}${cell('6+', bucket(6, 999))}</tr></table>
                    <div style="font-size:12px; color:var(--text-sec); margin-top:4px;">Лимит «${t.perMonth} в месяц» затронул бы: ${hit} ${hit === 1 ? 'человека' : 'человек'} (отправили больше ${t.perMonth}).</div></div>`;
            }).join('');
        }
        return `<p style="${u.hint}">Бесплатный тариф: сколько разных КП в месяц мастер может отправить клиентам (PDF, Excel или ссылкой). Дальше предлагается Профи. Повторная отправка того же КП лимит не тратит. Пробный и платный Профи, менеджеры, наблюдатели и админы лимита не видят. Сбой подсчёта лимит не включает: человека пропускаем.</p>
            <div style="${u.card} max-width:760px;">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;"><b style="font-size:14px; color:var(--text-main);">Сейчас:</b> ${this.chip(st.label, st.color)}</div>
                ${row('Включить лимит', 'Выключено — отправлять КП можно без ограничений, как и раньше.', this.toggleHtml(!!t.enabled, `Subscription.setLimitField('enabled', ${!t.enabled})`, dis))}
                ${row('Бесплатных КП в месяц', 'Календарный месяц, считаются разные КП. От 1 до 100.', `<input type="number" min="1" max="100" value="${t.perMonth}" ${dis ? 'disabled' : ''} onchange="Subscription.setLimitField('perMonth', this.value)" style="${u.input} width:80px;">`)}
                ${row('Действует с даты', 'Нажмите и выберите день в календаре (включительно). Без даты — сразу, как только лимит включён.', `<button type="button" ${dis ? 'disabled' : ''} onclick="Subscription.openLimitFrom()" style="${u.input} min-width:230px; text-align:left; cursor:${dis ? 'default' : 'pointer'};">${t.from ? 'с ' + this.fmtDate(t.from) : 'Сразу, как только включён'}</button>`)}
                ${row('Не применять к сотрудникам ТЕРЕМ', 'Почта @teremopt.ru или привязка к компании «ТЕРЕМ».', this.toggleHtml(!!t.excludeTerem, `Subscription.setLimitField('excludeTerem', ${!t.excludeTerem})`, dis))}
            </div>
            <div style="${u.card} max-width:760px; margin-top:14px;">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;"><b style="font-size:14px; color:var(--text-main);">Сколько КП отправляют бесплатные мастера</b>
                <button type="button" class="admin-btn" onclick="Subscription._demand=null; Subscription.render()">Пересчитать</button></div>
                ${demand}
            </div>`;
    },

    // ═══ Окно тарифа: карточки и текст преимуществ ═══════════════════════

    // Функции, которые Профи добавляет этой учётке сверх Базового — по таблице «Тарифы»
    benefitRows: function (account) {
        if (typeof app === 'undefined' || !app.TARIFF_FEATURES) return [];
        return app.TARIFF_FEATURES.filter(f => !f.locked).map(f => ({
            f: f,
            base: app.tariffCell(account, 'base', f.id),
            pro: app.tariffCell(account, 'pro', f.id)
        }));
    },

    benefitsText: function (account) {
        account = account || this.userAccount();
        const custom = (this.settings().benefits[account] || []).map(s => String(s || '').trim()).filter(Boolean);
        if (custom.length) return 'Преимущества подписки: ' + custom.join(', ') + '.';
        const items = this.benefitRows(account)
            .filter(r => r.pro !== 'off' && r.base === 'off')
            .map(r => this.BENEFIT_TEXT[r.f.id] || r.f.label.toLowerCase());
        if (!items.length) return 'Подписка Профи: все функции калькулятора без ограничений.';
        return 'Преимущества подписки: ' + items.join(', ') + '.';
    },

    cardsHtml: function (ctx, preview) {
        const plans = this.planList(false);
        return plans.map(p => {
            const r = this.resolve(p.id, ctx);
            if (!r) return '';
            const pct = r.promo ? r.promoPct : r.termPct;
            const badge = pct > 0 ? `<div class="badge">-${pct}%</div>` : '';
            const sub = r.months > 1
                ? `в месяц (<span class="curr-amount" data-rub="${r.rub}">${Math.round(r.rub).toLocaleString('ru-RU')}</span> <span class="curr-symbol">₽</span> за ${this.esc(this.monthsWord(r.months))})`
                : 'в месяц';
            const promoLine = r.promo
                ? `<div style="font-size:11px; color:var(--c-warn,#D97706); font-weight:700; margin:2px 0 8px; text-align:center;">🔥 ${this.esc(r.promo.title || 'Акция')}${r.promo.to ? ' до ' + this.fmtDate(r.promo.to) : ''}<span style="color:var(--text-sec); font-weight:500;"> · было ${this.esc(this.fmtRub(r.baseRub))}</span></div>`
                : '';
            const click = preview ? `Subscription.previewPlan('${p.id}')` : `app.openPaymentModal('${p.id}')`;
            return `<div class="tariff-card">
                        ${badge}
                        <h3>${this.esc(String(r.title).toUpperCase())}</h3>
                        <div class="price"><span class="curr-amount" data-rub="${r.perMonth}">${r.perMonth.toLocaleString('ru-RU')}</span> <span class="curr-symbol">₽</span></div>
                        <div class="price-sub">${sub}</div>
                        ${promoLine}
                        <button type="button" class="btn-subscribe" onclick="${click}">Оформить подписку</button>
                    </div>`;
        }).join('');
    },

    // Перерисовать карточки в настоящем окне тарифа по настройкам
    syncCards: function () {
        const box = document.querySelector('#custom_modal_overlay .tariff-cards');
        if (!box) return;
        box.innerHTML = this.cardsHtml(null, false);
        try { app.applyPricingCurrencyDisplay(); } catch (e) { }
    },

    // ═══ Заявка «Я оплатил» ══════════════════════════════════════════════
    logRequest: async function (info) {
        if (typeof supabaseClient === 'undefined' || !supabaseClient) return;
        try {
            const row = {
                email: String(info.email || '').trim().toLowerCase() || null,
                user_id: (app._currentUserRow && app._currentUserRow.id) || null,
                plan: info.plan || null,
                months: info.months || null,
                rub: info.rub || null,
                promo: info.promo || null,
                region: info.region || this.userRegion() || null,
                status: 'requested',
                source: 'site'
            };
            const { error } = await supabaseClient.from(this.TABLE).insert(row);
            if (error) throw error;
        } catch (e) {
            console.warn('[подписка] заявка не записана:', e.message || e);
        }
    },

    // ═══ Запись настроек ═════════════════════════════════════════════════
    canEdit: function () { return typeof app !== 'undefined' && app.getAdminRole() === 'super_admin'; },

    // Как saveTariffsQueued: перечитать строку, применить патч, записать. Очередь —
    // чтобы быстрые правки подряд не обгоняли друг друга и не затирали чужие ключи.
    save: function (patch) {
        if (!this.canEdit()) { app.alert('Настройки подписки меняет только владелец.'); return Promise.resolve(); }
        this._chain = (this._chain || Promise.resolve()).then(async () => {
            this._saving = true; this.renderStatus();
            try {
                const { data, error: readErr } = await supabaseClient.from('app_settings').select('value').eq('key', this.KEY).maybeSingle();
                if (readErr) throw readErr;
                const value = patch(JSON.parse(JSON.stringify((data && data.value) || {})));
                value.v = 1;
                const me = (app._currentUserRow && app._currentUserRow.email) || (app.state.tgUser && app.state.tgUser.email) || null;
                const { error } = await supabaseClient.from('app_settings')
                    .upsert({ key: this.KEY, value: value, updated_at: new Date().toISOString(), updated_by: me }, { onConflict: 'key' });
                if (error) throw error;
                app.appSettings = Object.assign({}, app.appSettings, { [this.KEY]: value });
                this._saveError = null;
            } catch (e) {
                console.error('[подписка] запись не прошла:', e);
                this._saveError = e.message || String(e);
                await app.loadAppSettings(true);
                app.alert('Не удалось сохранить настройки подписки: ' + this._saveError);
                this.render();
            } finally {
                this._saving = false; this.renderStatus();
                this.syncCards();
            }
        });
        return this._chain;
    },

    // Локально сразу, в базу — очередью
    apply: function (patch) {
        const cur = JSON.parse(JSON.stringify(this.raw()));
        app.appSettings = Object.assign({}, app.appSettings, { [this.KEY]: patch(cur) });
        return this.save(patch);
    },

    // ── тарифы ─────────────────────────────────────────────────────────
    setPlanField: function (id, field, value) {
        if (['title', 'label', 'months', 'rub', 'url', 'enabled'].indexOf(field) < 0) return;
        if (field === 'months') value = Math.max(1, Math.round(this.num(value)) || 1);
        if (field === 'rub') value = Math.max(0, Math.round(this.num(value)));
        if (field === 'url') value = String(value || '').trim();
        if (field === 'enabled') value = !!value;
        this.apply(v => { v.plans = v.plans || {}; v.plans[id] = Object.assign({}, v.plans[id] || {}, { [field]: value }); return v; });
        if (field === 'enabled' || field === 'months') this.render();
        else this.refreshPlanCard(id);
    },

    addPlan: function () {
        const id = this.newId('p');
        this.apply(v => { v.plans = v.plans || {}; v.plans[id] = { title: 'Подписка на квартал', label: 'Профи 3 месяца', months: 3, rub: 13500, url: '', enabled: false }; return v; });
        this.render();
    },

    removePlan: async function (id) {
        if (this.BASE_PLANS[id]) { app.alert('Месяц и год — основные тарифы, их можно только выключить.'); return; }
        if (!await app.confirm('Удалить этот тариф? Оплаты по нему в учёте останутся.')) return;
        this.apply(v => { if (v.plans) delete v.plans[id]; return v; });
        this.render();
    },

    resetPlan: async function (id) {
        if (!this.BASE_PLANS[id]) return;
        if (!await app.confirm('Вернуть этому тарифу исходную цену и ссылку?')) return;
        this.apply(v => { if (v.plans) delete v.plans[id]; return v; });
        this.render();
    },

    setNote: function (text) {
        this.apply(v => { v.note = String(text || '').trim(); return v; });
    },

    // ── акции ──────────────────────────────────────────────────────────
    addPromo: function () {
        const id = this.newId('a');
        const to = new Date(); to.setMonth(to.getMonth() + 1);
        this.apply(v => {
            v.promos = v.promos || [];
            v.promos.push({ id: id, title: 'Новая акция', kind: 'percent', value: 10, plans: [], regions: [], from: this.today(), to: to.toISOString().slice(0, 10), url: '', enabled: false });
            return v;
        });
        this.render();
    },

    setPromoField: function (id, field, value) {
        if (['title', 'kind', 'value', 'regions', 'from', 'to', 'url', 'enabled'].indexOf(field) < 0) return;
        if (field === 'value') value = Math.max(0, this.num(value));
        if (field === 'regions') value = String(value || '').split(',').map(s => s.trim()).filter(Boolean);
        if (field === 'enabled') value = !!value;
        if (field === 'kind' && ['percent', 'rub', 'price'].indexOf(value) < 0) return;
        this.apply(v => { const p = (v.promos || []).find(x => x.id === id); if (p) p[field] = value; return v; });
        if (field === 'enabled' || field === 'kind') this.render(); else this.refreshPromoRow(id);
    },

    togglePromoPlan: function (id, planId) {
        this.apply(v => {
            const p = (v.promos || []).find(x => x.id === id); if (!p) return v;
            p.plans = Array.isArray(p.plans) ? p.plans : [];
            const i = p.plans.indexOf(planId);
            if (i >= 0) p.plans.splice(i, 1); else p.plans.push(planId);
            return v;
        });
        this.refreshPromoRow(id);
    },

    removePromo: async function (id) {
        if (!await app.confirm('Удалить акцию? Оплаты, прошедшие по ней, в учёте останутся.')) return;
        this.apply(v => { v.promos = (v.promos || []).filter(x => x.id !== id); return v; });
        this.render();
    },

    // ── регионы ────────────────────────────────────────────────────────
    addRegion: function () {
        const id = this.newId('r');
        this.apply(v => { v.regions = v.regions || []; v.regions.push({ id: id, title: 'Казахстан', match: ['Казахстан', 'Алматы', 'Астана'], prices: {}, enabled: false }); return v; });
        this.render();
    },

    setRegionField: function (id, field, value) {
        if (['title', 'match', 'enabled'].indexOf(field) < 0) return;
        if (field === 'match') value = String(value || '').split(',').map(s => s.trim()).filter(Boolean);
        if (field === 'enabled') value = !!value;
        this.apply(v => { const r = (v.regions || []).find(x => x.id === id); if (r) r[field] = value; return v; });
        if (field === 'enabled') this.render();
    },

    setRegionPrice: function (id, planId, field, value) {
        if (field === 'rub') value = Math.max(0, Math.round(this.num(value)));
        else if (field === 'url') value = String(value || '').trim();
        else return;
        this.apply(v => {
            const r = (v.regions || []).find(x => x.id === id); if (!r) return v;
            r.prices = r.prices || {}; r.prices[planId] = Object.assign({}, r.prices[planId] || {}, { [field]: value });
            return v;
        });
        this.refreshRegionRow(id);
    },

    removeRegion: async function (id) {
        if (!await app.confirm('Удалить региональную цену?')) return;
        this.apply(v => { v.regions = (v.regions || []).filter(x => x.id !== id); return v; });
        this.render();
    },

    // ── преимущества ───────────────────────────────────────────────────
    setBenefitsText: function (account, text) {
        const lines = String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
        this.apply(v => { v.benefits = v.benefits || {}; v.benefits[account] = lines; return v; });
        const prev = document.getElementById('sub_benefit_preview_' + account);
        if (prev) prev.textContent = this.benefitsText(account);
    },

    // Ячейка таблицы «Тарифы» — та же, что во вкладке «Тарифы» (app.setTariffCell)
    toggleFeature: function (account, plan, featureId) {
        const f = app.TARIFF_FEATURES.find(x => x.id === featureId);
        if (!f || f.locked) return;
        const cur = app.tariffCell(account, plan, featureId);
        let next;
        if (f.list) next = cur === 'on' ? 'list' : (cur === 'list' ? 'off' : 'on');
        else next = cur === 'on' ? 'off' : 'on';
        app.setTariffCell(account, plan, featureId, next);
        this.render();
    },

    // ═══ Учёт оплат ══════════════════════════════════════════════════════
    _pay: null,          // { rows, users, missing, error }
    _payLoading: false,

    loadPayments: async function (force) {
        if (this._payLoading) return;
        if (this._pay && !force) return;
        this._payLoading = true;
        const out = { rows: [], users: [], missing: false, error: null };
        try {
            const { data, error } = await supabaseClient.from(this.TABLE).select('*').order('created_at', { ascending: false }).limit(1000);
            if (error) throw error;
            out.rows = data || [];
        } catch (e) {
            const msg = (e && e.message) || String(e);
            if (/does not exist|not find the table|schema cache/i.test(msg)) out.missing = true; else out.error = msg;
        }
        try {
            const { data } = await supabaseClient.from('users')
                .select('id, email, username, first_name, last_name, region, account_type, demo_ends_at, pro_expires_at, distributor_id');
            out.users = data || [];
        } catch (e) { console.warn('[подписка] пользователи не прочитаны:', e); }
        this._pay = out;
        this._payLoading = false;
        if (app._adminTab === 'subscription') this.render();
    },

    userByEmail: function (email) {
        const e = String(email || '').trim().toLowerCase();
        if (!e || !this._pay) return null;
        return this._pay.users.find(u => String(u.email || '').toLowerCase() === e) || null;
    },
    userName: function (u) { return u ? ([u.last_name, u.first_name].filter(Boolean).join(' ') || u.username || u.email || '') : ''; },

    addMonths: function (from, months) {
        const d = new Date(from);
        const day = d.getDate();
        d.setMonth(d.getMonth() + months);
        if (d.getDate() !== day) d.setDate(0);   // 31 января + 1 мес = 28/29 февраля, а не 3 марта
        return d;
    },

    // До какой даты продлить: от текущего срока, если он ещё идёт, иначе от сегодня.
    // 2099 год — «навсегда» (промокод дистрибьютора): оплата тогда ничего не продлевает.
    proUntilFor: function (u, months) {
        const now = new Date();
        let from = now;
        if (u && u.demo_ends_at) {
            const cur = new Date(u.demo_ends_at);
            if (cur > now && cur.getFullYear() < 2090) from = cur;
        }
        return this.addMonths(from, months);
    },

    // Продлить Профи в карточке: как «Сохранить» в карточке пользователя с
    // источником «Оплата» (demo_ends_at — срок, pro_expires_at — признак «платный»).
    activatePro: async function (u, until) {
        const upd = { demo_ends_at: until.toISOString(), pro_expires_at: until.toISOString() };
        // Администратору, наблюдателю и менеджеру тип не трогаем — у них Профи живёт в сроке
        if (['admin', 'viewer', 'manager'].indexOf(u.account_type) < 0) upd.account_type = 'pro';
        const { error } = await supabaseClient.from('users').update(upd).eq('id', u.id);
        if (error) throw error;
        Object.assign(u, upd);
        // Список «Пользователей» мог быть уже загружен — обновим и его
        try { const au = (app.adminData && app.adminData.users || []).find(x => String(x.id) === String(u.id)); if (au) Object.assign(au, upd); } catch (e) { }
    },

    // Раскрыть строку заявки формой подтверждения
    openConfirm: function (id) {
        this._confirmId = this._confirmId === id ? null : id;
        this._manualOpen = false;
        this.render();
    },

    confirmPaid: async function (id) {
        if (!this.canEdit()) { app.alert('Подтверждать оплаты может только владелец.'); return; }
        const row = (this._pay.rows || []).find(r => r.id === id);
        if (!row) return;
        const g = k => { const el = document.getElementById('sub_cf_' + k); return el ? el.value : ''; };
        const paidRub = Math.round(this.num(g('rub')));
        const months = Math.max(1, Math.round(this.num(g('months'))) || 1);
        const paidAt = g('date') ? new Date(g('date') + 'T12:00:00') : new Date();
        const extend = !!(document.getElementById('sub_cf_extend') || {}).checked;
        const note = g('note');
        if (!paidRub) { app.alert('Укажите сумму, которая пришла.'); return; }
        const u = this.userByEmail(row.email);
        if (extend && !u) { app.alert('Учётной записи с почтой ' + row.email + ' нет в базе — продлить Профи некому. Снимите галочку продления или найдите человека в «Пользователях».'); return; }
        try {
            let until = null;
            if (extend) { until = this.proUntilFor(u, months); await this.activatePro(u, until); }
            const me = (app._currentUserRow && app._currentUserRow.email) || null;
            const upd = { status: 'paid', paid_at: paidAt.toISOString(), paid_rub: paidRub, months: months, pro_until: until ? until.toISOString() : null, note: note || null, confirmed_by: me, user_id: row.user_id || (u ? u.id : null) };
            const { error } = await supabaseClient.from(this.TABLE).update(upd).eq('id', id);
            if (error) throw error;
            this._confirmId = null;
            await this.loadPayments(true);
        } catch (e) {
            app.alert('Не удалось отметить оплату: ' + (e.message || e));
        }
    },

    rejectRequest: async function (id) {
        if (!this.canEdit()) return;
        if (!await app.confirm('Отметить заявку как неоплаченную (отклонить)?')) return;
        try {
            const { error } = await supabaseClient.from(this.TABLE).update({ status: 'rejected', confirmed_by: (app._currentUserRow && app._currentUserRow.email) || null }).eq('id', id);
            if (error) throw error;
            await this.loadPayments(true);
        } catch (e) { app.alert('Не удалось: ' + (e.message || e)); }
    },

    removePayment: async function (id) {
        if (!this.canEdit()) return;
        if (!await app.confirm('Удалить запись из учёта? Срок Профи в карточке человека не изменится.')) return;
        try {
            const { error } = await supabaseClient.from(this.TABLE).delete().eq('id', id);
            if (error) throw error;
            await this.loadPayments(true);
        } catch (e) { app.alert('Не удалось: ' + (e.message || e)); }
    },

    openManual: function (email) {
        this._manualOpen = !this._manualOpen || !!email;
        this._manualEmail = email || '';
        this._confirmId = null;
        this.render();
        const el = document.getElementById('sub_manual_form');
        if (el) el.scrollIntoView({ block: 'nearest' });
    },

    addManual: async function () {
        if (!this.canEdit()) { app.alert('Записывать оплаты может только владелец.'); return; }
        const g = k => { const el = document.getElementById('sub_mf_' + k); return el ? el.value : ''; };
        const email = String(g('email')).trim().toLowerCase();
        const planId = g('plan');
        const plan = this.settings().plans[planId];
        const rub = Math.round(this.num(g('rub')));
        const months = Math.max(1, Math.round(this.num(g('months'))) || 1);
        const paidAt = g('date') ? new Date(g('date') + 'T12:00:00') : new Date();
        const extend = !!(document.getElementById('sub_mf_extend') || {}).checked;
        if (!email) { app.alert('Укажите почту учётной записи.'); return; }
        if (!rub) { app.alert('Укажите сумму.'); return; }
        const u = this.userByEmail(email);
        if (extend && !u) { app.alert('Учётной записи с почтой ' + email + ' нет в базе. Снимите галочку продления или проверьте почту.'); return; }
        try {
            let until = null;
            if (extend) { until = this.proUntilFor(u, months); await this.activatePro(u, until); }
            const me = (app._currentUserRow && app._currentUserRow.email) || null;
            const row = {
                email: email, user_id: u ? u.id : null, plan: planId || null, months: months, rub: rub, promo: g('promo') || null,
                region: (u && u.region) || null, status: 'paid', paid_at: paidAt.toISOString(), paid_rub: rub,
                pro_until: until ? until.toISOString() : null, note: g('note') || null, confirmed_by: me, source: 'manual'
            };
            const { error } = await supabaseClient.from(this.TABLE).insert(row);
            if (error) throw error;
            this._manualOpen = false;
            await this.loadPayments(true);
        } catch (e) { app.alert('Не удалось записать оплату: ' + (e.message || e)); }
    },

    // Сводка по подтверждённым оплатам
    stats: function () {
        const rows = (this._pay && this._pay.rows) || [];
        const paid = rows.filter(r => r.status === 'paid');
        const now = new Date();
        const ym = d => { const t = new Date(d); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0'); };
        const curYm = ym(now);
        const d30 = now.getTime() - 30 * 86400000;
        const sum = arr => arr.reduce((a, r) => a + this.num(r.paid_rub != null ? r.paid_rub : r.rub), 0);
        const by = (key) => {
            const m = {};
            paid.forEach(r => { const k = key(r) || '—'; m[k] = m[k] || { n: 0, sum: 0 }; m[k].n++; m[k].sum += this.num(r.paid_rub != null ? r.paid_rub : r.rub); });
            return Object.keys(m).map(k => ({ key: k, n: m[k].n, sum: m[k].sum })).sort((a, b) => b.sum - a.sum);
        };
        const months = [];
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const k = ym(d);
            const inMonth = paid.filter(r => ym(r.paid_at || r.created_at) === k);
            months.push({ key: k, label: d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' }), n: inMonth.length, sum: sum(inMonth) });
        }
        const plans = this.settings().plans;
        return {
            total: sum(paid), count: paid.length,
            month: sum(paid.filter(r => ym(r.paid_at || r.created_at) === curYm)),
            d30: sum(paid.filter(r => new Date(r.paid_at || r.created_at).getTime() >= d30)),
            pending: rows.filter(r => r.status === 'requested').length,
            months: months,
            byPlan: by(r => (plans[r.plan] && (plans[r.plan].label || plans[r.plan].title)) || r.plan),
            byPromo: by(r => r.promo || 'без акции'),
            byRegion: by(r => r.region || 'регион не указан'),
            activePaid: ((this._pay && this._pay.users) || []).filter(u => u.pro_expires_at && new Date(u.demo_ends_at || u.pro_expires_at) > now).length
        };
    },

    // ═══ Вкладка ═════════════════════════════════════════════════════════
    VIEWS: [
        { id: 'plans', icon: '💳', label: 'Тарифы и QR' },
        { id: 'promos', icon: '🔥', label: 'Акции' },
        { id: 'regions', icon: '🌍', label: 'Регионы' },
        { id: 'payments', icon: '📒', label: 'Заявки и оплаты' },
        { id: 'preview', icon: '👁', label: 'Как выглядит' },
        { id: 'benefits', icon: '⭐', label: 'Преимущества Профи' },
        { id: 'trial', icon: '🎁', label: 'Пробный период' },
        { id: 'limit', icon: '🚦', label: 'Лимит КП' }
    ],

    setView: function (v) {
        if (!this.VIEWS.some(x => x.id === v)) return;
        this._view = v;
        this.render();
        const c = document.getElementById('admin_content');
        if (c) c.scrollTop = 0;
    },

    renderStatus: function () {
        const el = document.getElementById('sub_status');
        if (!el) return;
        if (this._saving) el.innerHTML = '<span style="color:var(--text-sec);">Сохраняю…</span>';
        else if (this._saveError) el.innerHTML = '<span style="color:var(--c-bad,#EF4444);">Не сохранено</span>';
        else el.innerHTML = '';
    },

    // Общие кусочки вёрстки (те же, что во вкладке «Тарифы»)
    ui: {
        th: 'padding:8px 6px; text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-sec); background:var(--surface-light); border-bottom:1px solid var(--border); white-space:nowrap;',
        td: 'padding:8px 6px; text-align:left; border-bottom:1px solid var(--border); vertical-align:middle; font-size:12.5px; color:var(--text-main);',
        input: 'height:32px; padding:0 8px; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--text-main); font-size:12.5px; box-sizing:border-box;',
        card: 'background:var(--surface-light); border:1px solid var(--border); border-radius:12px; padding:14px 16px;',
        hint: 'margin:0 0 12px; font-size:12.5px; line-height:1.5; color:var(--text-sec); max-width:900px;'
    },

    toggleHtml: function (on, onclick, dis, titles) {
        titles = titles || ['Включено — нажмите, чтобы выключить', 'Выключено — нажмите, чтобы включить'];
        return `<button type="button" ${dis ? 'disabled' : ''} role="switch" aria-checked="${on}" title="${on ? titles[0] : titles[1]}" onclick="${onclick}"
            style="position:relative; width:40px; height:22px; border-radius:999px; border:none; padding:0; cursor:${dis ? 'default' : 'pointer'}; background:${on ? '#10B981' : 'var(--border)'}; transition:background .15s; vertical-align:middle; flex:0 0 auto;">
            <span style="position:absolute; top:3px; left:${on ? '21px' : '3px'}; width:16px; height:16px; border-radius:50%; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.25); transition:left .15s;"></span></button>`;
    },

    chip: function (text, color) {
        return `<span style="display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; background:${color}22; color:${color}; white-space:nowrap;">${this.esc(text)}</span>`;
    },

    render: function () {
        const box = document.getElementById('admin_subscription_box');
        if (!box) return;
        const canEdit = this.canEdit();
        const tabs = this.VIEWS.map(v => {
            const act = v.id === this._view;
            const badge = (v.id === 'payments' && this._pay && this.stats().pending) ? ` <span style="background:#D97706; color:#fff; border-radius:999px; padding:0 6px; font-size:10px;">${this.stats().pending}</span>` : '';
            return `<button type="button" class="admin-btn" onclick="Subscription.setView('${v.id}')" style="${act ? 'background:var(--primary); color:#fff; border-color:var(--primary);' : ''}">${v.icon} ${v.label}${badge}</button>`;
        }).join('');
        let body = '';
        if (this._view === 'plans') body = this.viewPlans(canEdit);
        else if (this._view === 'promos') body = this.viewPromos(canEdit);
        else if (this._view === 'regions') body = this.viewRegions(canEdit);
        else if (this._view === 'payments') body = this.viewPayments(canEdit);
        else if (this._view === 'preview') body = this.viewPreview();
        else if (this._view === 'benefits') body = this.viewBenefits(canEdit);
        else if (this._view === 'trial') body = this.viewTrial(canEdit);
        else if (this._view === 'limit') body = this.viewLimit(canEdit);
        box.innerHTML = `
            <div style="display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-bottom:12px;">
                <h3 style="margin:0; color:var(--text-main);">💳 Оплата подписки</h3>
                <span id="sub_status" style="font-size:12px;"></span>
                ${canEdit ? '' : '<span style="font-size:12px; color:var(--c-warn,#D97706); font-weight:600;">Только просмотр: менять может владелец.</span>'}
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:16px;">${tabs}</div>
            ${body}`;
        this.renderStatus();
        this.fillQrs(box);
        if (this._view === 'payments' && !this._pay) this.loadPayments();
    },

    // QR-картинки: <img data-qr="ссылка" data-size="120">; рисует qrcode.js через app.qrDataUrl
    fillQrs: async function (root) {
        const imgs = [...(root || document).querySelectorAll('img[data-qr]')];
        for (const img of imgs) {
            const url = img.getAttribute('data-qr'), size = parseInt(img.getAttribute('data-size')) || 140;
            if (!url) { img.style.display = 'none'; continue; }
            const key = size + '|' + url;
            if (!this._qrCache[key]) { try { this._qrCache[key] = await app.qrDataUrl(url, size); } catch (e) { this._qrCache[key] = ''; } }
            if (!img.isConnected) continue;
            if (this._qrCache[key]) { img.src = this._qrCache[key]; img.style.display = ''; }
            else img.style.display = 'none';
        }
    },

    // ── Тарифы и QR ────────────────────────────────────────────────────
    viewPlans: function (canEdit) {
        const s = this.settings();
        const dis = canEdit ? '' : 'disabled';
        const cards = this.planList(true).map(p => this.planCardHtml(p, canEdit)).join('');
        return `
            <p style="${this.ui.hint}">
                Цена и ссылка на перевод у каждого тарифа. QR-код рисуется из ссылки сам: вставили новую ссылку — код обновился и в окне оплаты.
                Ссылка на перевод физлицу берётся в приложении банка (Т-Банк: «Переводы» → «Ссылка на перевод» → задать сумму → «Скопировать»).
                <b>Сумма зашита в ссылке</b>, поэтому меняя цену — меняйте и ссылку, иначе человек переведёт старую сумму.
            </p>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:14px; margin-bottom:14px;">${cards}</div>
            <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:18px;">
                <button class="admin-btn" ${dis} onclick="Subscription.addPlan()">+ Добавить тариф</button>
            </div>
            <div style="${this.ui.card} max-width:900px;">
                <div style="font-weight:700; font-size:13px; color:var(--text-main); margin-bottom:6px;">Подпись под QR-кодом в окне оплаты</div>
                <textarea ${dis} rows="2" placeholder="Например: В комментарии к переводу укажите почту, на которую зарегистрированы." onchange="Subscription.setNote(this.value)"
                    style="width:100%; ${this.ui.input} height:auto; padding:8px; resize:vertical; line-height:1.4;">${this.esc(s.note)}</textarea>
                <div style="font-size:11.5px; color:var(--text-sec); margin-top:4px;">Пусто — подписи нет. Как это выглядит — в разделе «Как выглядит».</div>
            </div>`;
    },

    planCardHtml: function (p, canEdit) {
        const dis = canEdit ? '' : 'disabled';
        const base = this.BASE_PLANS[p.id];
        const changed = base && (this.num(p.rub) !== base.rub || (p.url || '') !== base.url || p.label !== base.label || p.title !== base.title || p.enabled === false);
        const inp = (field, val, type, extra) => `<input ${dis} type="${type || 'text'}" value="${this.esc(val)}" ${extra || ''} onchange="Subscription.setPlanField('${p.id}','${field}',this.value)" style="${this.ui.input} width:100%;">`;
        const lbl = t => `<div style="font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-sec); margin:8px 0 3px;">${t}</div>`;
        return `<div id="sub_plan_${p.id}" style="${this.ui.card} ${p.enabled === false ? 'opacity:.75;' : ''}">
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:4px;">
                <b style="font-size:14px; color:var(--text-main); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis;">${this.esc(p.label || p.id)}</b>
                ${this.toggleHtml(p.enabled !== false, `Subscription.setPlanField('${p.id}','enabled',${p.enabled === false})`, !canEdit, ['Тариф показывается в окне — нажмите, чтобы скрыть', 'Тариф скрыт — нажмите, чтобы показать'])}
            </div>
            <div style="display:flex; gap:14px; align-items:flex-start;">
                <div style="flex:1; min-width:0;">
                    ${lbl('Заголовок карточки')}${inp('title', p.title || '')}
                    ${lbl('Название тарифа (в окне оплаты и заявке)')}${inp('label', p.label || '')}
                    <div style="display:flex; gap:10px;">
                        <div style="flex:1;">${lbl('Месяцев')}${inp('months', p.months || 1, 'number', 'min="1" step="1"')}</div>
                        <div style="flex:2;">${lbl('Цена, ₽')}${inp('rub', Math.round(this.num(p.rub)), 'number', 'min="0" step="10"')}</div>
                    </div>
                    ${lbl('Ссылка на перевод')}${inp('url', p.url || '', 'url', 'placeholder="https://www.tbank.ru/cf/…"')}
                </div>
                <div style="flex:0 0 132px; text-align:center;">
                    ${lbl('QR в окне оплаты')}
                    <div style="background:#fff; border-radius:10px; padding:6px; display:inline-block; min-width:120px; min-height:120px;">
                        <img data-qr="${this.esc(p.url || '')}" data-size="120" alt="QR" style="width:120px; height:120px; display:${p.url ? 'block' : 'none'};">
                        ${p.url ? '' : '<div style="font-size:11px; color:#64748B; padding:40px 4px 0;">нет ссылки</div>'}
                    </div>
                    <div id="sub_plan_meta_${p.id}" style="font-size:11px; color:var(--text-sec); margin-top:6px; line-height:1.4;">${this.planMetaHtml(p)}</div>
                </div>
            </div>
            <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; align-items:center;">
                ${p.url ? `<a class="admin-btn" href="${this.esc(p.url)}" target="_blank" rel="noopener" style="text-decoration:none;">Открыть ссылку</a>` : ''}
                ${base ? (changed ? `<button class="admin-btn" ${dis} onclick="Subscription.resetPlan('${p.id}')">Вернуть исходное</button>` : '<span style="font-size:11px; color:var(--text-sec);">как было изначально</span>') : `<button class="admin-btn danger" ${dis} onclick="Subscription.removePlan('${p.id}')">Удалить тариф</button>`}
            </div>
        </div>`;
    },

    planMetaHtml: function (p) {
        const months = Math.max(1, Math.round(this.num(p.months)) || 1);
        const rub = this.num(p.rub);
        const per = months > 1 ? `${this.fmtRub(Math.round(rub / months))} в месяц` : '';
        const warn = !p.url ? '<div style="color:var(--c-bad,#EF4444);">Без ссылки окно оплаты покажет только «Я оплатил»</div>' : '';
        return `${this.fmtRub(rub)} за ${this.monthsWord(months)}${per ? '<br>' + per : ''}${warn}`;
    },

    // После правки поля — обновить QR и подпись без перерисовки (не терять фокус)
    refreshPlanCard: function (id) {
        const p = this.settings().plans[id];
        const card = document.getElementById('sub_plan_' + id);
        if (!p || !card) return;
        const img = card.querySelector('img[data-qr]');
        if (img) { img.setAttribute('data-qr', p.url || ''); this.fillQrs(card); }
        const meta = document.getElementById('sub_plan_meta_' + id);
        if (meta) meta.innerHTML = this.planMetaHtml(p);
        const b = card.querySelector('b');
        if (b) b.textContent = p.label || p.id;
    },

    // ── Акции ──────────────────────────────────────────────────────────
    viewPromos: function (canEdit) {
        const s = this.settings();
        const dis = canEdit ? '' : 'disabled';
        const rows = s.promos.length
            ? s.promos.map(p => this.promoRowHtml(p, canEdit)).join('')
            : `<div style="padding:20px; text-align:center; color:var(--text-sec); font-size:13px; border:1px dashed var(--border); border-radius:12px;">Акций пока нет. Добавьте первую — например «-20 % до конца месяца» или «Год за 40 000 ₽ для Казахстана».</div>`;
        return `
            <p style="${this.ui.hint}">
                Акция сама применяется в окне тарифа в свои даты: у карточки появляется плашка «-N %», старая цена зачёркнута, а в заявке
                и учёте записывается её название. Если акций несколько — берётся самая выгодная для человека. <b>Своя ссылка на перевод</b> у акции
                обязательна: сумма в ссылке Т-Банка зашита, без своей ссылки человек переведёт полную цену.
            </p>
            <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:14px;">${rows}</div>
            <button class="admin-btn" ${dis} onclick="Subscription.addPromo()">+ Добавить акцию</button>`;
    },

    promoRowHtml: function (p, canEdit) {
        const dis = canEdit ? '' : 'disabled';
        const st = this.promoState(p);
        const plans = this.planList(true);
        const inp = (field, val, type, extra) => `<input ${dis} type="${type || 'text'}" value="${this.esc(val)}" ${extra || ''} onchange="Subscription.setPromoField('${p.id}','${field}',this.value)" style="${this.ui.input} width:100%;">`;
        const lbl = t => `<div style="font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-sec); margin:8px 0 3px;">${t}</div>`;
        const kindSel = `<select ${dis} onchange="Subscription.setPromoField('${p.id}','kind',this.value)" style="${this.ui.input} width:100%;">
            <option value="percent" ${p.kind === 'percent' ? 'selected' : ''}>Скидка, %</option>
            <option value="rub" ${p.kind === 'rub' ? 'selected' : ''}>Скидка, ₽</option>
            <option value="price" ${p.kind === 'price' ? 'selected' : ''}>Цена по акции, ₽</option></select>`;
        const planChips = plans.map(pl => {
            const on = !Array.isArray(p.plans) || !p.plans.length || p.plans.indexOf(pl.id) >= 0;
            const explicit = Array.isArray(p.plans) && p.plans.length;
            return `<label style="display:inline-flex; align-items:center; gap:5px; font-size:12px; color:var(--text-main); margin:2px 10px 2px 0; cursor:pointer;">
                <input type="checkbox" ${dis} ${on ? 'checked' : ''} onchange="Subscription.togglePromoPlan('${p.id}','${pl.id}')" style="margin:0;"> ${this.esc(pl.label || pl.id)}${(!explicit) ? '' : ''}</label>`;
        }).join('');
        return `<div id="sub_promo_${p.id}" style="${this.ui.card} ${st.id !== 'on' ? 'opacity:.85;' : ''}">
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                <b style="font-size:14px; color:var(--text-main); flex:1; min-width:120px;">${this.esc(p.title || 'Акция')}</b>
                <span id="sub_promo_state_${p.id}">${this.chip(st.label, st.color)}</span>
                ${this.toggleHtml(p.enabled !== false, `Subscription.setPromoField('${p.id}','enabled',${p.enabled === false})`, !canEdit)}
                <button class="admin-btn danger" ${dis} onclick="Subscription.removePromo('${p.id}')" title="Удалить акцию">✕</button>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:0 12px;">
                <div style="grid-column:1 / -1;">${lbl('Название (видно в карточке тарифа и в учёте)')}${inp('title', p.title || '')}</div>
                <div>${lbl('Вид')}${kindSel}</div>
                <div>${lbl(p.kind === 'percent' ? 'Процент' : (p.kind === 'rub' ? 'Скидка, ₽' : 'Цена, ₽'))}${inp('value', this.num(p.value), 'number', 'min="0"')}</div>
                <div>${lbl('С даты')}${inp('from', p.from || '', 'date')}</div>
                <div>${lbl('По дату (включительно)')}${inp('to', p.to || '', 'date')}</div>
                <div style="grid-column:1 / -1;">${lbl('Ссылка на перевод суммы по акции')}${inp('url', p.url || '', 'url', 'placeholder="https://www.tbank.ru/cf/…"')}</div>
                <div style="grid-column:1 / -1;">${lbl('Регионы (через запятую; пусто — везде). Сравнивается с полем «регион» анкеты')}${inp('regions', (p.regions || []).join(', '), 'text', 'placeholder="Казахстан, Беларусь"')}</div>
                <div style="grid-column:1 / -1;">${lbl('Какие тарифы')}<div>${planChips}</div></div>
            </div>
            <div id="sub_promo_calc_${p.id}" style="margin-top:10px; font-size:12px; color:var(--text-sec); line-height:1.5;">${this.promoCalcHtml(p)}</div>
        </div>`;
    },

    // Что акция даст на каждом тарифе — чтобы не считать в уме
    promoCalcHtml: function (p) {
        const plans = this.planList(true).filter(pl => !Array.isArray(p.plans) || !p.plans.length || p.plans.indexOf(pl.id) >= 0);
        if (!plans.length) return 'Ни один тариф не выбран — акция ничего не меняет.';
        const parts = plans.map(pl => {
            const base = this.num(pl.rub), r = this.applyPromo(base, p);
            return `${this.esc(pl.label || pl.id)}: <b style="color:var(--text-main);">${this.fmtRub(r)}</b> <s>${this.fmtRub(base)}</s>`;
        });
        const warn = !p.url ? ' <span style="color:var(--c-bad,#EF4444);">Нет своей ссылки — в окне оплаты останется ссылка на полную цену.</span>' : '';
        return 'По акции: ' + parts.join(' · ') + warn;
    },

    refreshPromoRow: function (id) {
        const p = this.settings().promos.find(x => x.id === id);
        if (!p) return;
        const st = document.getElementById('sub_promo_state_' + id);
        if (st) { const s = this.promoState(p); st.innerHTML = this.chip(s.label, s.color); }
        const calc = document.getElementById('sub_promo_calc_' + id);
        if (calc) calc.innerHTML = this.promoCalcHtml(p);
        const row = document.getElementById('sub_promo_' + id);
        const b = row && row.querySelector('b');
        if (b) b.textContent = p.title || 'Акция';
    },

    // ── Регионы ────────────────────────────────────────────────────────
    viewRegions: function (canEdit) {
        const s = this.settings();
        const dis = canEdit ? '' : 'disabled';
        // Какие регионы вообще встречаются в анкетах — подсказка, что писать в «совпадение»
        const users = (this._pay && this._pay.users) || (app.adminData && app.adminData.users) || [];
        const regCount = {};
        users.forEach(u => { const r = String(u.region || '').trim(); if (r) regCount[r] = (regCount[r] || 0) + 1; });
        const regChips = Object.keys(regCount).sort((a, b) => regCount[b] - regCount[a]).slice(0, 30)
            .map(r => `<span style="display:inline-block; margin:2px 6px 2px 0; padding:2px 8px; border-radius:999px; background:var(--surface-light); border:1px solid var(--border); font-size:11px; color:var(--text-main);">${this.esc(r)} <span style="color:var(--text-sec);">${regCount[r]}</span></span>`).join('');
        const rows = s.regions.length
            ? s.regions.map(r => this.regionRowHtml(r, canEdit)).join('')
            : `<div style="padding:20px; text-align:center; color:var(--text-sec); font-size:13px; border:1px dashed var(--border); border-radius:12px;">Региональных цен нет: все платят по общему тарифу.</div>`;
        return `
            <p style="${this.ui.hint}">
                Своя цена для региона: человеку из анкеты с таким регионом карточки тарифов показывают эту цену и эту ссылку,
                акции считаются уже от неё. Совпадение — по вхождению слова в поле «регион» анкеты (регистр не важен), первое подходящее правило сверху.
                Пустая цена тарифа в правиле — общая цена.
            </p>
            ${regChips ? `<div style="margin-bottom:12px; font-size:12px; color:var(--text-sec);">Регионы в анкетах: ${regChips}</div>` : ''}
            <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:14px;">${rows}</div>
            <button class="admin-btn" ${dis} onclick="Subscription.addRegion()">+ Добавить регион</button>`;
    },

    regionRowHtml: function (r, canEdit) {
        const dis = canEdit ? '' : 'disabled';
        const plans = this.planList(true);
        const lbl = t => `<div style="font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-sec); margin:8px 0 3px;">${t}</div>`;
        const priceRows = plans.map(pl => {
            const pr = (r.prices || {})[pl.id] || {};
            return `<tr>
                <td style="${this.ui.td} white-space:nowrap;">${this.esc(pl.label || pl.id)}<div style="font-size:11px; color:var(--text-sec);">обычно ${this.fmtRub(pl.rub)}</div></td>
                <td style="${this.ui.td} width:130px;"><input ${dis} type="number" min="0" step="10" value="${pr.rub ? Math.round(this.num(pr.rub)) : ''}" placeholder="общая" onchange="Subscription.setRegionPrice('${r.id}','${pl.id}','rub',this.value)" style="${this.ui.input} width:100%;"></td>
                <td style="${this.ui.td}"><input ${dis} type="url" value="${this.esc(pr.url || '')}" placeholder="https://www.tbank.ru/cf/…" onchange="Subscription.setRegionPrice('${r.id}','${pl.id}','url',this.value)" style="${this.ui.input} width:100%;"></td>
                <td style="${this.ui.td} width:70px; text-align:center;"><img data-qr="${this.esc(pr.rub && pr.url ? pr.url : '')}" data-size="56" alt="" style="width:56px; height:56px; background:#fff; border-radius:6px; display:${pr.rub && pr.url ? 'block' : 'none'};"></td>
            </tr>`;
        }).join('');
        return `<div id="sub_region_${r.id}" style="${this.ui.card}">
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                <b style="font-size:14px; color:var(--text-main); flex:1; min-width:120px;">${this.esc(r.title || 'Регион')}</b>
                ${this.toggleHtml(r.enabled !== false, `Subscription.setRegionField('${r.id}','enabled',${r.enabled === false})`, !canEdit)}
                <button class="admin-btn danger" ${dis} onclick="Subscription.removeRegion('${r.id}')" title="Удалить">✕</button>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:0 12px;">
                <div>${lbl('Название')}<input ${dis} type="text" value="${this.esc(r.title || '')}" onchange="Subscription.setRegionField('${r.id}','title',this.value)" style="${this.ui.input} width:100%;"></div>
                <div>${lbl('Совпадение в анкете (через запятую)')}<input ${dis} type="text" value="${this.esc((r.match || []).join(', '))}" placeholder="Казахстан, Алматы, Астана" onchange="Subscription.setRegionField('${r.id}','match',this.value)" style="${this.ui.input} width:100%;"></div>
            </div>
            <div style="overflow-x:auto; margin-top:10px;">
                <table style="width:100%; border-collapse:collapse; min-width:520px;">
                    <thead><tr><th style="${this.ui.th}">Тариф</th><th style="${this.ui.th}">Цена, ₽</th><th style="${this.ui.th}">Ссылка на перевод</th><th style="${this.ui.th} text-align:center;">QR</th></tr></thead>
                    <tbody>${priceRows}</tbody>
                </table>
            </div>
            <div id="sub_region_warn_${r.id}" style="font-size:12px; color:var(--c-bad,#EF4444); margin-top:6px;">${this.regionWarnHtml(r)}</div>
        </div>`;
    },

    regionWarnHtml: function (r) {
        const bad = this.planList(true).filter(pl => { const pr = (r.prices || {})[pl.id]; return pr && this.num(pr.rub) > 0 && !pr.url; });
        return bad.length ? 'Без своей ссылки: ' + bad.map(pl => this.esc(pl.label || pl.id)).join(', ') + ' — человек увидит региональную цену, а переведёт по общей ссылке.' : '';
    },

    refreshRegionRow: function (id) {
        const r = this.settings().regions.find(x => x.id === id);
        const row = document.getElementById('sub_region_' + id);
        if (!r || !row) return;
        const warn = document.getElementById('sub_region_warn_' + id);
        if (warn) warn.innerHTML = this.regionWarnHtml(r);
        [...row.querySelectorAll('tbody tr')].forEach((tr, i) => {
            const pl = this.planList(true)[i]; if (!pl) return;
            const pr = (r.prices || {})[pl.id] || {};
            const img = tr.querySelector('img[data-qr]');
            if (img) { img.setAttribute('data-qr', pr.rub && pr.url ? pr.url : ''); }
        });
        this.fillQrs(row);
    },

    // ── Заявки и оплаты ────────────────────────────────────────────────
    viewPayments: function (canEdit) {
        const dis = canEdit ? '' : 'disabled';
        if (!this._pay) return '<div style="padding:30px; text-align:center; color:var(--text-sec);">Загружаю учёт…</div>';
        if (this._pay.missing) {
            return `<div style="background:rgba(217,119,6,0.12); border:1px solid #D97706; border-radius:10px; padding:14px 16px; font-size:13px; line-height:1.6; color:var(--text-main); max-width:820px;">
                <b>Таблица учёта ещё не создана.</b> Выполните в Supabase → SQL Editor файл
                <code style="background:var(--surface-light); padding:1px 6px; border-radius:4px;">${this.SQL_FILE}</code> из репозитория — он заводит таблицу
                <code>${this.TABLE}</code> и права: заявку пишет кто угодно, смотрит и подтверждает — администратор. После этого обновите страницу.
            </div>`;
        }
        if (this._pay.error) return `<div style="color:var(--c-bad,#EF4444); font-size:13px;">Учёт не прочитан: ${this.esc(this._pay.error)}</div>`;
        const st = this.stats();
        const tile = (val, label, color) => `<div style="${this.ui.card} text-align:center; min-width:150px; flex:1;">
            <div style="font-size:22px; font-weight:800; color:${color || 'var(--text-main)'}; line-height:1.1;">${val}</div>
            <div style="font-size:11.5px; color:var(--text-sec); margin-top:4px;">${label}</div></div>`;
        const tiles = `<div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
            ${tile(this.fmtRub(st.total), 'получено всего · ' + st.count + ' оплат')}
            ${tile(this.fmtRub(st.month), 'за этот месяц')}
            ${tile(this.fmtRub(st.d30), 'за 30 дней')}
            ${tile(st.pending, 'ждут подтверждения', st.pending ? '#D97706' : undefined)}
            ${tile(st.activePaid, 'платных Профи сейчас', '#10B981')}
        </div>`;
        const maxSum = Math.max(1, ...st.months.map(m => m.sum));
        const monthsHtml = `<div style="${this.ui.card} margin-bottom:14px;">
            <div style="font-weight:700; font-size:13px; color:var(--text-main); margin-bottom:8px;">По месяцам, ₽</div>
            <div style="display:flex; align-items:flex-end; gap:6px; height:110px;">
                ${st.months.map(m => `<div title="${this.esc(m.label)}: ${this.esc(this.fmtRub(m.sum))}, оплат: ${m.n}" style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%;">
                    <div style="font-size:10px; color:var(--text-sec); margin-bottom:2px;">${m.sum ? Math.round(m.sum / 1000) + 'к' : ''}</div>
                    <div style="width:100%; max-width:34px; height:${Math.max(2, Math.round(m.sum / maxSum * 70))}px; background:${m.sum ? 'var(--primary)' : 'var(--border)'}; border-radius:4px 4px 0 0;"></div>
                    <div style="font-size:9.5px; color:var(--text-sec); margin-top:3px; white-space:nowrap;">${this.esc(m.label)}</div>
                </div>`).join('')}
            </div></div>`;
        const mini = (title, list) => `<div style="${this.ui.card} flex:1; min-width:200px;">
            <div style="font-weight:700; font-size:13px; color:var(--text-main); margin-bottom:6px;">${title}</div>
            ${list.length ? list.slice(0, 8).map(x => `<div style="display:flex; justify-content:space-between; gap:8px; font-size:12px; padding:3px 0; border-bottom:1px solid var(--border);"><span style="color:var(--text-main); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${this.esc(x.key)} <span style="color:var(--text-sec);">×${x.n}</span></span><b style="white-space:nowrap;">${this.fmtRub(x.sum)}</b></div>`).join('') : '<div style="font-size:12px; color:var(--text-sec);">пока нет</div>'}
        </div>`;
        const cuts = `<div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:16px;">${mini('По тарифам', st.byPlan)}${mini('По акциям', st.byPromo)}${mini('По регионам', st.byRegion)}</div>`;

        const plans = this.settings().plans;
        const rows = this._pay.rows;
        const statusChip = r => r.status === 'paid' ? this.chip('оплачено', '#10B981') : (r.status === 'rejected' ? this.chip('отклонено', '#64748B') : this.chip('ждёт', '#D97706'));
        const trs = rows.length ? rows.map(r => {
            const u = this.userByEmail(r.email);
            const planLabel = (plans[r.plan] && (plans[r.plan].label || plans[r.plan].title)) || r.plan || '—';
            const open = this._confirmId === r.id;
            let html = `<tr style="${r.status === 'requested' ? 'background:rgba(217,119,6,.06);' : ''}">
                <td style="${this.ui.td} white-space:nowrap;">${this.fmtDateTime(r.created_at)}${r.source === 'manual' ? '<div style="font-size:10px; color:var(--text-sec);">записано вручную</div>' : ''}</td>
                <td style="${this.ui.td}"><div style="font-weight:600;">${this.esc(r.email || '—')}</div>${u ? `<div style="font-size:11px; color:var(--text-sec);">${this.esc(this.userName(u))}${u.region ? ' · ' + this.esc(u.region) : ''}</div>` : '<div style="font-size:11px; color:var(--c-bad,#EF4444);">учётки с такой почтой нет</div>'}</td>
                <td style="${this.ui.td} white-space:nowrap;">${this.esc(planLabel)}${r.months ? `<div style="font-size:11px; color:var(--text-sec);">${this.esc(this.monthsWord(r.months))}</div>` : ''}</td>
                <td style="${this.ui.td} white-space:nowrap;">${r.rub != null ? this.fmtRub(r.rub) : '—'}${r.promo ? `<div style="font-size:11px; color:var(--c-warn,#D97706);">🔥 ${this.esc(r.promo)}</div>` : ''}</td>
                <td style="${this.ui.td}">${statusChip(r)}${r.status === 'paid' ? `<div style="font-size:11px; color:var(--text-sec); margin-top:3px;">${this.fmtDate(r.paid_at)} · <b style="color:var(--text-main);">${this.fmtRub(r.paid_rub != null ? r.paid_rub : r.rub)}</b>${r.pro_until ? '<br>Профи до ' + this.fmtDate(r.pro_until) : ''}</div>` : ''}${r.note ? `<div style="font-size:11px; color:var(--text-sec); margin-top:2px;">${this.esc(r.note)}</div>` : ''}</td>
                <td style="${this.ui.td} white-space:nowrap; text-align:right;">
                    ${r.status === 'requested' ? `<button class="admin-btn" ${dis} style="color:var(--c-ok,#10B981);" onclick="Subscription.openConfirm('${r.id}')">${open ? 'Свернуть' : '✓ Оплачено'}</button>
                    <button class="admin-btn" ${dis} onclick="Subscription.rejectRequest('${r.id}')">✗</button>` : ''}
                    <button class="admin-btn danger" ${dis} title="Удалить запись" onclick="Subscription.removePayment('${r.id}')">🗑</button>
                </td></tr>`;
            if (open) {
                const months = r.months || (plans[r.plan] && plans[r.plan].months) || 1;
                const until = this.proUntilFor(u, months);
                html += `<tr><td colspan="6" style="${this.ui.td} background:var(--surface-light);">
                    <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end;">
                        <label style="font-size:11px; color:var(--text-sec);">Пришло, ₽<br><input id="sub_cf_rub" type="number" min="0" step="10" value="${Math.round(this.num(r.rub))}" style="${this.ui.input} width:120px;"></label>
                        <label style="font-size:11px; color:var(--text-sec);">Дата оплаты<br><input id="sub_cf_date" type="date" value="${this.today()}" style="${this.ui.input} width:150px;"></label>
                        <label style="font-size:11px; color:var(--text-sec);">Месяцев Профи<br><input id="sub_cf_months" type="number" min="1" step="1" value="${months}" style="${this.ui.input} width:90px;"></label>
                        <label style="font-size:11px; color:var(--text-sec);">Заметка<br><input id="sub_cf_note" type="text" placeholder="например, номер перевода" style="${this.ui.input} width:220px;"></label>
                        <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--text-main); height:32px;"><input id="sub_cf_extend" type="checkbox" ${u ? 'checked' : 'disabled'} style="margin:0;"> продлить Профи в карточке${u ? ` <span style="color:var(--text-sec);">(до ${this.fmtDate(until)})</span>` : ' <span style="color:var(--c-bad,#EF4444);">— учётки нет</span>'}</label>
                        <button class="admin-btn" style="background:#10B981; color:#fff; border-color:#10B981;" onclick="Subscription.confirmPaid('${r.id}')">Подтвердить оплату</button>
                    </div></td></tr>`;
            }
            return html;
        }).join('') : `<tr><td colspan="6" style="${this.ui.td} text-align:center; color:var(--text-sec); padding:24px;">Заявок пока нет. Они появляются, когда человек нажимает «Я оплатил» в окне оплаты.</td></tr>`;

        // Кто оплатил до появления учёта: в карточке источник «Оплата», а строки здесь нет
        const known = new Set(rows.map(r => String(r.email || '').toLowerCase()));
        const legacy = (this._pay.users || []).filter(u => u.pro_expires_at && !known.has(String(u.email || '').toLowerCase()));
        const legacyHtml = legacy.length ? `<div style="${this.ui.card} margin-top:16px;">
            <div style="font-weight:700; font-size:13px; color:var(--text-main); margin-bottom:4px;">Оплатили до появления учёта — сумма не записана</div>
            <div style="font-size:12px; color:var(--text-sec); margin-bottom:8px;">В карточке у них источник Профи «Оплата», но в учёте строки нет, поэтому в «получено всего» они не входят. Запишите сумму — и цифры сойдутся.</div>
            ${legacy.map(u => `<div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px; font-size:12.5px; padding:5px 0; border-bottom:1px solid var(--border);">
                <span style="flex:1; min-width:180px; color:var(--text-main);"><b>${this.esc(u.email)}</b> <span style="color:var(--text-sec);">${this.esc(this.userName(u))}${u.region ? ' · ' + this.esc(u.region) : ''} · Профи до ${this.fmtDate(u.demo_ends_at || u.pro_expires_at)}</span></span>
                <button class="admin-btn" ${dis} onclick="Subscription.openManual('${this.esc(u.email)}')">Записать сумму</button></div>`).join('')}
        </div>` : '';

        const planOpts = this.planList(true).map(p => `<option value="${p.id}" data-rub="${Math.round(this.num(p.rub))}" data-months="${p.months || 1}">${this.esc(p.label || p.id)} — ${this.fmtRub(p.rub)}</option>`).join('');
        const manual = this._manualOpen ? `<div id="sub_manual_form" style="${this.ui.card} margin-top:12px; border-color:var(--primary);">
            <div style="font-weight:700; font-size:13px; color:var(--text-main); margin-bottom:8px;">Записать оплату вручную</div>
            <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end;">
                <label style="font-size:11px; color:var(--text-sec);">Почта учётки<br><input id="sub_mf_email" type="email" value="${this.esc(this._manualEmail || '')}" placeholder="name@mail.ru" style="${this.ui.input} width:220px;"></label>
                <label style="font-size:11px; color:var(--text-sec);">Тариф<br><select id="sub_mf_plan" onchange="var o=this.options[this.selectedIndex]; document.getElementById('sub_mf_rub').value=o.dataset.rub; document.getElementById('sub_mf_months').value=o.dataset.months;" style="${this.ui.input} width:200px;">${planOpts}</select></label>
                <label style="font-size:11px; color:var(--text-sec);">Пришло, ₽<br><input id="sub_mf_rub" type="number" min="0" step="10" value="${Math.round(this.num((this.planList(true)[0] || {}).rub))}" style="${this.ui.input} width:120px;"></label>
                <label style="font-size:11px; color:var(--text-sec);">Месяцев<br><input id="sub_mf_months" type="number" min="1" step="1" value="${(this.planList(true)[0] || {}).months || 1}" style="${this.ui.input} width:90px;"></label>
                <label style="font-size:11px; color:var(--text-sec);">Дата<br><input id="sub_mf_date" type="date" value="${this.today()}" style="${this.ui.input} width:150px;"></label>
                <label style="font-size:11px; color:var(--text-sec);">Акция<br><input id="sub_mf_promo" type="text" placeholder="если была" style="${this.ui.input} width:150px;"></label>
                <label style="font-size:11px; color:var(--text-sec);">Заметка<br><input id="sub_mf_note" type="text" style="${this.ui.input} width:200px;"></label>
                <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--text-main); height:32px;"><input id="sub_mf_extend" type="checkbox" ${this._manualEmail ? '' : 'checked'} style="margin:0;"> продлить Профи в карточке</label>
                <button class="admin-btn" style="background:var(--primary); color:#fff; border-color:var(--primary);" onclick="Subscription.addManual()">Записать</button>
                <button class="admin-btn" onclick="Subscription.openManual()">Отмена</button>
            </div>
            <div style="font-size:11.5px; color:var(--text-sec); margin-top:6px;">Для тех, кто оплатил раньше и уже имеет Профи в карточке, галочку продления снимите — иначе срок сдвинется ещё раз.</div>
        </div>` : '';

        return `${tiles}${monthsHtml}${cuts}
            <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-bottom:8px;">
                <b style="font-size:13px; color:var(--text-main);">Заявки и оплаты</b>
                <span style="font-size:12px; color:var(--text-sec);">${rows.length} записей</span>
                <span style="flex:1;"></span>
                <button class="admin-btn" onclick="Subscription.loadPayments(true)">Обновить</button>
                <button class="admin-btn" ${dis} onclick="Subscription.openManual()">+ Записать оплату</button>
            </div>
            ${manual}
            <div style="overflow-x:auto; border:1px solid var(--border); border-radius:10px; background:var(--bg); margin-top:${manual ? 12 : 0}px;">
                <table style="width:100%; min-width:760px; border-collapse:collapse;">
                    <thead><tr><th style="${this.ui.th}">Когда</th><th style="${this.ui.th}">Кто</th><th style="${this.ui.th}">Тариф</th><th style="${this.ui.th}">К оплате</th><th style="${this.ui.th}">Статус</th><th style="${this.ui.th}"></th></tr></thead>
                    <tbody>${trs}</tbody>
                </table>
            </div>
            ${legacyHtml}`;
    },

    // ── Как выглядит ───────────────────────────────────────────────────
    _pv: { account: 'installer', region: '', plan: null },

    setPreview: function (field, value) { this._pv[field] = value; this.render(); },
    previewPlan: function (id) { this._pv.plan = id; this.render(); },

    viewPreview: function () {
        const s = this.settings();
        const pv = this._pv;
        const plans = this.planList(false);
        if (!plans.some(p => p.id === pv.plan)) pv.plan = plans.length ? plans[0].id : null;
        const ctx = { region: pv.region, account: pv.account };
        const r = pv.plan ? this.resolve(pv.plan, ctx) : null;
        const seg = (opts, cur, onpick) => `<span style="display:inline-flex; border:1px solid var(--border); border-radius:8px; overflow:hidden; vertical-align:middle;">${opts.map((o, k) => `<button type="button" onclick="${onpick(o.v)}" style="border:none; ${k ? 'border-left:1px solid var(--border);' : ''} margin:0; padding:5px 10px; font-size:12px; font-weight:${o.v === cur ? 700 : 500}; cursor:pointer; background:${o.v === cur ? 'var(--primary)' : 'transparent'}; color:${o.v === cur ? '#fff' : 'var(--text-main)'}; white-space:nowrap;">${this.esc(o.label)}</button>`).join('')}</span>`;
        const regionOpts = [{ v: '', label: 'Обычный регион' }].concat(s.regions.filter(x => x.enabled !== false).map(x => ({ v: (x.match || [])[0] || x.title, label: x.title || 'Регион' })));
        const controls = `<div style="display:flex; flex-wrap:wrap; gap:10px 16px; align-items:center; margin-bottom:14px; font-size:12px; color:var(--text-sec);">
            <span>Смотрит: ${seg([{ v: 'installer', label: 'Монтажник' }, { v: 'seller', label: 'Продавец' }], pv.account, v => `Subscription.setPreview('account','${v}')`)}</span>
            ${regionOpts.length > 1 ? `<span>Регион: ${seg(regionOpts, pv.region, v => `Subscription.setPreview('region','${this.esc(v)}')`)}</span>` : ''}
            ${plans.length ? `<span>В окне оплаты: ${seg(plans.map(p => ({ v: p.id, label: p.label || p.id })), pv.plan, v => `Subscription.previewPlan('${v}')`)}</span>` : ''}
        </div>`;

        const modalTariff = `<div style="${this.ui.card} flex:1 1 420px; min-width:0;">
            <div style="font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-sec); margin-bottom:8px;">1. Окно «Подписка Профи» — так его видит ${pv.account === 'seller' ? 'продавец' : 'монтажник'}</div>
            <div style="background:var(--bg); border:1px solid var(--border); border-radius:16px; padding:18px 14px; text-align:center;">
                <h2 style="margin:0 0 8px; font-size:20px; color:var(--text-main);">Подписка Профи</h2>
                <p style="font-size:13px; color:var(--text-sec); line-height:1.5; margin:0 0 12px;">${this.esc(this.benefitsText(pv.account))}</p>
                <div class="tariff-cards" style="flex-wrap:wrap;">${this.cardsHtml(ctx, true)}</div>
                <div style="font-size:11px; color:var(--text-sec); margin-top:6px;">Нажмите «Оформить подписку» на карточке — справа откроется её окно оплаты.</div>
            </div>
        </div>`;

        const modalPay = r ? `<div style="${this.ui.card} flex:0 1 380px; min-width:0;">
            <div style="font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-sec); margin-bottom:8px;">2. Окно оплаты после нажатия «Оформить подписку»</div>
            <div style="background:var(--bg); border:1px solid var(--border); border-radius:16px; padding:18px 16px; text-align:center; max-width:360px; margin:0 auto;">
                <h3 style="margin:0 0 4px; font-size:17px; color:var(--text-main);">Оплата подписки</h3>
                <p style="color:var(--text-sec); font-size:13px; margin:0 0 10px;">Тариф: ${this.esc(r.tariffName)} (${this.esc(this.fmtRub(r.rub))})</p>
                <div style="display:inline-block; background:#fff; border-radius:10px; padding:6px; min-width:200px; min-height:200px;">
                    <img data-qr="${this.esc(r.url)}" data-size="200" alt="QR" style="width:200px; height:200px; display:${r.url ? 'block' : 'none'};">
                    ${r.url ? '' : '<div style="font-size:12px; color:var(--c-bad,#EF4444); padding:80px 8px 0;">ссылки нет — QR не рисуется</div>'}
                </div>
                ${s.note ? `<p style="font-size:12px; color:var(--text-sec); margin:8px 0 0; line-height:1.4;">${this.esc(s.note)}</p>` : ''}
                <a href="${this.esc(r.url || '#')}" target="_blank" rel="noopener" class="btn-subscribe" style="margin:12px 0; text-decoration:none; height:44px;">🔗 Оплатить по ссылке</a>
                <div style="text-align:left; background:var(--surface-light); border:1px solid var(--border); border-radius:12px; padding:14px;">
                    <div style="font-size:10px; font-weight:700; color:var(--text-sec); text-transform:uppercase; margin-bottom:6px;">Подтверждение платежа</div>
                    <input type="email" disabled placeholder="Ваш Email учетной записи" style="${this.ui.input} width:100%; height:40px; margin-bottom:8px;">
                    <button type="button" disabled class="btn-subscribe" style="height:42px; opacity:.8;">✅ Я оплатил</button>
                </div>
                <p style="font-size:10px; color:var(--text-sec); margin:8px 0 0; line-height:1.3;">После нажатия «Я оплатил» мы проверим поступление средств и активируем статус Профи в ближайшее время.</p>
            </div>
            <div style="font-size:12px; color:var(--text-sec); margin-top:10px; line-height:1.5;">
                Цена: <b style="color:var(--text-main);">${this.esc(this.fmtRub(r.rub))}</b>${r.src === 'promo' ? ` по акции «${this.esc(r.promo.title || '')}» (было ${this.esc(this.fmtRub(r.baseRub))})` : (r.src === 'region' ? ` — региональная цена «${this.esc(r.rule.title || '')}»` : ' — общий тариф')}.
                Ссылка: ${r.url ? `<a href="${this.esc(r.url)}" target="_blank" rel="noopener" style="color:var(--primary);">${this.esc(r.url.replace(/^https?:\/\//, ''))}</a>` : '<span style="color:var(--c-bad,#EF4444);">не задана</span>'}${r.url && !r.urlOwn ? ' <span style="color:var(--c-bad,#EF4444);">— это ссылка на другую сумму!</span>' : ''}.
                «Я оплатил» → заявка в раздел «Заявки и оплаты», уведомление в Телеграм и на почту.
            </div>
        </div>` : '';

        const triggers = `<div style="${this.ui.card} margin-top:14px; max-width:900px;">
            <div style="font-weight:700; font-size:13px; color:var(--text-main); margin-bottom:6px;">Где в калькуляторе открывается окно тарифа</div>
            <table style="width:100%; border-collapse:collapse; font-size:12.5px;">
                ${this.TRIGGERS.map(t => `<tr><td style="${this.ui.td} width:45%;">${this.esc(t.where)}</td><td style="${this.ui.td} color:var(--text-sec);">${this.esc(t.when)}</td></tr>`).join('')}
            </table>
            <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:12px;">
                <button class="admin-btn" onclick="app.showModal('pro')">Открыть настоящее окно тарифа</button>
                ${r ? `<button class="admin-btn" onclick="app.openPaymentModal('${r.id}')">Открыть настоящее окно оплаты</button>` : ''}
            </div>
            <div style="font-size:11.5px; color:var(--text-sec); margin-top:6px;">Настоящие окна откроются поверх панели с вашими данными — это те же окна, что видит монтажник, но цена для вас считается по вашему региону.</div>
        </div>`;

        return controls + `<div style="display:flex; flex-wrap:wrap; gap:14px; align-items:flex-start;">${modalTariff}${modalPay}</div>` + triggers;
    },

    // ── Преимущества Профи ─────────────────────────────────────────────
    viewBenefits: function (canEdit) {
        const s = this.settings();
        const canCells = typeof app !== 'undefined' && app.canEditTariffs && app.canEditTariffs();
        const block = (account, title, who) => {
            const rows = this.benefitRows(account);
            const cell = (plan, r) => {
                const v = plan === 'base' ? r.base : r.pro;
                const on = v !== 'off';
                const label = v === 'list' ? 'по доступу' : (on ? 'да' : 'нет');
                const color = v === 'list' ? '#D97706' : (on ? '#10B981' : '#64748B');
                return `<button type="button" ${canCells ? '' : 'disabled'} onclick="Subscription.toggleFeature('${account}','${plan}','${r.f.id}')" title="${this.esc(r.f.hint || '')}${r.f.list ? ' — нажатием: да → по доступу → нет' : ''}"
                    style="border:1px solid ${color}; background:${on ? color + '22' : 'transparent'}; color:${color}; border-radius:999px; padding:3px 10px; font-size:11.5px; font-weight:700; cursor:${canCells ? 'pointer' : 'default'}; min-width:64px;">${label}</button>`;
            };
            const trs = rows.map(r => {
                const gain = r.pro !== 'off' && r.base === 'off';
                return `<tr>
                    <td style="${this.ui.td}"><b>${this.esc(r.f.label)}</b><div style="font-size:11px; color:var(--text-sec);">${this.esc(this.BENEFIT_TEXT[r.f.id] || r.f.hint || '')}</div></td>
                    <td style="${this.ui.td} text-align:center;">${cell('base', r)}</td>
                    <td style="${this.ui.td} text-align:center;">${cell('pro', r)}</td>
                    <td style="${this.ui.td} text-align:center;">${gain ? '<span style="color:var(--c-ok,#10B981); font-weight:700;">★ преимущество</span>' : (r.pro === 'off' ? '<span style="color:var(--text-sec);">закрыто и на Профи</span>' : '<span style="color:var(--text-sec);">есть и на Базовом</span>')}</td>
                </tr>`;
            }).join('');
            const custom = (s.benefits[account] || []).join('\n');
            return `<div style="${this.ui.card} margin-bottom:14px;">
                <div style="font-weight:700; font-size:14px; color:var(--text-main);">${title}</div>
                <div style="font-size:12px; color:var(--text-sec); margin-bottom:8px;">${who}</div>
                <div style="overflow-x:auto;">
                <table style="width:100%; border-collapse:collapse; min-width:560px;">
                    <thead><tr><th style="${this.ui.th}">Функция</th><th style="${this.ui.th} text-align:center;">Базовый</th><th style="${this.ui.th} text-align:center;">Профи</th><th style="${this.ui.th} text-align:center;">Что даёт подписка</th></tr></thead>
                    <tbody>${trs}</tbody>
                </table></div>
                <div style="margin-top:12px; font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-sec);">Текст в окне тарифа</div>
                <div id="sub_benefit_preview_${account}" style="font-size:12.5px; color:var(--text-main); background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:8px 10px; margin:4px 0 8px; line-height:1.5;">${this.esc(this.benefitsText(account))}</div>
                <textarea ${canEdit ? '' : 'disabled'} rows="3" placeholder="Свой текст — по одному преимуществу в строке. Пусто — текст собирается сам из строк со ★." onchange="Subscription.setBenefitsText('${account}', this.value)"
                    style="width:100%; ${this.ui.input} height:auto; padding:8px; resize:vertical; line-height:1.4;">${this.esc(custom)}</textarea>
            </div>`;
        };
        return `
            <p style="${this.ui.hint}">
                Здесь те же переключатели, что в таблице «Тарифы»: строка «Профи» — что открывает подписка, строка «Базовый» — что есть и без неё.
                Преимущество — то, что на Профи открыто, а на Базовом закрыто; из таких строк собирается текст в окне тарифа. Меняется сразу и у людей.
                ${canCells ? '' : '<b style="color:var(--c-warn,#D97706);">Переключать функции может администратор.</b>'}
            </p>
            ${block('installer', '🔧 Монтажник', 'все, у кого в анкете есть монтаж, и гости без входа')}
            ${block('seller', '🏪 Продавец', 'в анкете только «продажа», без монтажа')}`;
    }
};
