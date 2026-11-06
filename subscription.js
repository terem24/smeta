/**
 * subscription.js — подписка Профи: цены и ссылки на оплату, акции, региональные
 * цены, учёт заявок и оплат, вкладка «Оплата подписки» в панели управления.
 *
 * Настройки лежат в базе, в app_settings под ключом `subscription`
 * (таблица и политика «пишет только администратор» уже есть — те же, что у
 * вкладки «Тарифы»). Пока в базе ничего не записано, работают значения
 * BASE_PLANS. Это единственное место с ценами в коде.
 *
 *   {
 *     v: 1,
 *     plans:   { month: { title, label, months, rub, url, enabled }, year: {…}, <свой id>: {…} },
 *     promos:  [ { id, title, kind: 'percent'|'rub'|'price', value, plans: [id…], regions: [строки], from, to, url, enabled,
 *                  audience: 'all' | 'after_trial' } ],   // after_trial — был пробный Профи и ни одной оплаты
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

    // Тарифы по умолчанию — только на случай, когда в базе (app_settings.subscription) ничего нет;
    // настоящие цены, ссылки и региональные цены (Москва, Санкт-Петербург и области дороже)
    // живут в настройках и меняются во вкладке «Оплата подписки». Здесь стоят базовые цены,
    // те же, что в настройках сейчас (23.10.2026): остальные регионы. Других мест с ценами
    // в коде нет (ни в окне тарифа, ни в app.proPlan).
    //   object — «Один расчёт»: days > 0, оплата начисляет кредит на одну смету (pro_objects),
    //            days — окно правок после открытия;
    //   month, year — подписка на months месяцев.
    BASE_PLANS: {
        object: { title: 'Один расчёт', label: 'Профи: один расчёт', months: 1, days: 30, rub: 499, url: '', enabled: true },
        month: { title: 'Подписка на месяц', label: 'Профи 1 месяц', months: 1, rub: 1950, url: '', enabled: true },
        year: { title: 'Подписка на год', label: 'Профи 1 год', months: 12, rub: 29000, url: '', enabled: false }
    },

    // Как функция таблицы «Тарифы» называется в окне тарифа для монтажника
    BENEFIT_TEXT: {
        rommer: 'ROMMER и аналоги',
        terem: 'расширенный прайс с заменами',
        works: 'монтаж в смете и КП',
        analog: 'смета «Бюджетнее»',
        recognize: 'распознавание смет и проектов',
        design: 'проект и планы этажей',
        ufhplan: 'раскладка тёплого пола',
        opcost: 'расходы на эксплуатацию',
        branding: 'свои реквизиты и логотип',
        money: 'маржа по разделам',
        docs: 'договор, акты, гарантия',
        disc1c: 'скидки в КП'
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
            .sort((a, b) => this.planSpan(a) - this.planSpan(b));
    },

    // Срок тарифа в месяцах для сортировки: «Один расчёт» (14 дней) идёт перед месяцем
    planSpan: function (p) {
        const d = Math.round(this.num(p && p.days));
        return d > 0 ? d / 30 : (this.num(p && p.months) || 0);
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

    // Был ли у человека пробный Профи без единой оплаты — для акций «после пробного»
    userAfterTrial: function () {
        try {
            const tg = (app.state && app.state.tgUser) || {};
            const row = app._currentUserRow || {};
            const demo = tg.demo_ends_at || row.demo_ends_at;
            const paid = tg.pro_expires_at || row.pro_expires_at;
            return !!demo && !paid;
        } catch (e) { return false; }
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
        // «После пробного»: был пробный Профи (demo_ends_at) и ни одной оплаты (pro_expires_at
        // пуст). После первой оплаты акция сама перестаёт действовать — отсюда «первый месяц».
        // В предпросмотре панели (ctx передан без afterTrial) считаем, что условие выполнено.
        const afterTrial = ctx.afterTrial !== undefined ? !!ctx.afterTrial : (Object.keys(ctx).length ? true : this.userAfterTrial());
        s.promos.forEach(pr => {
            if (!this.promoActive(pr, ctx.at)) return;
            if (pr.audience === 'after_trial' && !afterTrial) return;
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
        const days = Math.max(0, Math.round(this.num(p.days)));
        const monthly = s.plans.month && s.plans.month.enabled !== false ? this.num(s.plans.month.rub) : 0;
        return {
            id: planId, title: p.title || p.label || planId, label: p.label || p.title || planId,
            months: months, days: days, rub: rub, baseRub: baseRub, url: url, urlOwn: urlOwn, src: src,
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
            </div>
            <div style="${u.card} max-width:760px; margin-top:12px;">
                ${row('Бонус за обучение: Профи на 10 дней', 'Кто пройдёт обучение полностью (все блоки, доступные его тарифу), получает Профи на 10 дней сразу, без кнопки. Один раз на аккаунт: только без оплаты и без прошлого пробного периода. Сотрудникам ТЕРЕМ бонус не выдаётся и подсказка не показывается. Выключено — бонус не выдаётся всем, обучение работает как прежде.',
                    this.toggleHtml(this.tourBonusSettings().enabled, `Subscription.setTourBonusEnabled(${!this.tourBonusSettings().enabled})`, dis))}
            </div>
            <div style="${u.card} max-width:760px; margin-top:12px;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px;">
                    <b style="font-size:14px; color:var(--text-main);">Воронка обучения «Первый объект»</b>
                    <select onchange="Subscription.loadTourFunnel(this.value)" style="${u.input}">
                        <option value="7">7 дней</option><option value="30" selected>30 дней</option><option value="90">90 дней</option>
                    </select>
                </div>
                <div id="tour_funnel_box" style="font-size:12.5px; color:var(--text-sec);">Загрузка…</div>
                ${(setTimeout(() => this.loadTourFunnel(30), 0), '')}
            </div>`;
    },

    // Сколько человек начали блок «Первый объект», дошли до каждого шага, пропустили его или
    // закрыли обучение на нём, и медиана секунд на шаге. Данные — tour_funnel (только админу),
    // порядок и названия шагов — из Tour.STEPS. Журнал шагов пишется с 02.11.2026.
    loadTourFunnel: async function (days) {
        const box = document.getElementById('tour_funnel_box');
        if (!box) return;
        try {
            const { data, error } = await supabaseClient.rpc('tour_funnel', { p_days: parseInt(days, 10) || 30 });
            if (error) throw error;
            const rows = (data || []).filter(r => r.block === 'basic');
            const by = {}; rows.forEach(r => { by[r.step] = r; });
            const started = (by['·start'] && Number(by['·start'].reached)) || 0;
            const done = (by['·done'] && Number(by['·done'].reached)) || 0;
            if (!started && !rows.length) { box.innerHTML = 'За этот период событий нет. Журнал шагов пишется с 02.11.2026.'; return; }
            const steps = (typeof Tour !== 'undefined' ? Tour.STEPS : []).filter(x => x.block === 'basic');
            const pct = n => started ? Math.round(n / started * 100) + '%' : '—';
            const bar = n => `<div style="height:6px; border-radius:999px; background:var(--border); overflow:hidden; min-width:80px;"><i style="display:block; height:100%; width:${started ? Math.min(100, n / started * 100) : 0}%; background:linear-gradient(90deg,#0A84FF,#5E5CE6);"></i></div>`;
            const u = this.ui;
            let html = `<table style="width:100%; border-collapse:collapse;"><thead><tr>
                <th style="${u.th}">Шаг</th><th style="${u.th}">Дошли</th><th style="${u.th}"></th><th style="${u.th}">Пропустили</th><th style="${u.th}">Закрыли</th><th style="${u.th}">Медиана</th></tr></thead><tbody>`;
            html += `<tr><td style="${u.td}"><b>Начали</b></td><td style="${u.td}"><b>${started}</b></td><td style="${u.td}">${bar(started)}</td><td style="${u.td}"></td><td style="${u.td}"></td><td style="${u.td}"></td></tr>`;
            steps.forEach(st => {
                const r = by[st.key] || {};
                const n = Number(r.reached) || 0;
                html += `<tr><td style="${u.td}">${this.esc(st.title)}</td><td style="${u.td}">${n} <span style="color:var(--text-sec);">${pct(n)}</span></td><td style="${u.td}">${bar(n)}</td>
                    <td style="${u.td}">${Number(r.skipped) || ''}</td><td style="${u.td}; color:${Number(r.closed) ? '#EF4444' : 'inherit'}">${Number(r.closed) || ''}</td>
                    <td style="${u.td}">${r.median_sec != null ? r.median_sec + ' с' : ''}</td></tr>`;
            });
            html += `<tr><td style="${u.td}"><b>Сохранили — блок засчитан</b></td><td style="${u.td}"><b>${done}</b> <span style="color:var(--text-sec);">${pct(done)}</span></td><td style="${u.td}">${bar(done)}</td><td style="${u.td}"></td><td style="${u.td}"></td><td style="${u.td}"></td></tr>`;
            box.innerHTML = html + '</tbody></table>';
        } catch (e) {
            box.textContent = 'Не удалось загрузить воронку: ' + ((e && e.message) || e);
        }
    },

    // ═══ Бонус за обучение: Профи на 10 дней ═════════════════════════════
    // Выключатель — app_settings.subscription.tourBonus.enabled. Выдаёт бонус функция
    // mark_tour_done в базе и читает тот же флаг (миграция 20261031_tour_bonus_toggle.sql);
    // подсказка в обучении показывается только когда флаг включён. По умолчанию включён.
    TOUR_BONUS_DEFAULTS: { enabled: true },

    tourBonusSettings: function () {
        const t = Object.assign({}, this.TOUR_BONUS_DEFAULTS, this.raw().tourBonus || {});
        t.enabled = t.enabled !== false;
        return t;
    },

    setTourBonusEnabled: function (value) {
        const v2 = !!value;
        this.apply(v => { v.tourBonus = Object.assign({}, v.tourBonus || {}, { enabled: v2 }); return v; });
        this.render();
    },

    // ═══ Лимит КП на бесплатном тарифе ═══════════════════════════════════
    // Настройки — app_settings.subscription.limit. По умолчанию ВЫКЛЮЧЕН. Считается
    // число разных КП (по номеру расчёта), которые мастер за календарный месяц отправил
    // клиенту: PDF, Excel или ссылка (события printed и sent в invoice_events).
    // Монтажнику: первые perMonth КП месяца идут с работами, следующие perMonthPlain —
    // только с оборудованием, дальше отправка закрыта (app.sendLimitOk / app.kpWorksLocked).
    // Продавцу без монтажа — perMonthPlain КП в месяц. Повторная отправка лимит не тратит. Блокирует только на тарифе без
    // Профи (free и base); пробный и платный Профи, менеджеры, наблюдатели, админы
    // и (по умолчанию) сотрудники ТЕРЕМ лимит не видят. Любой сбой при подсчёте —
    // пропускаем: лимит не должен мешать работать.
    // outcomeGate — блок отправки, пока у двух КП нет итога (kp_outcome.js). Включён по
    // умолчанию и от «Включить лимит» не зависит; excludeTerem действует на оба.
    LIMIT_DEFAULTS: { enabled: false, from: '', perMonth: 1, perMonthPlain: 1, excludeTerem: true, outcomeGate: true,
        // Окно «Чем закончились КП?» (kp_outcome.js): включено ли, кому показывать,
        // срок ответа и границы, в которых монтажник сам меняет срок («КП и счета»),
        // число продлений, порог блока отправки и льгота после срока
        outcomeOn: true, outcomeAudBase: true, outcomeAudPro: true, outcomeAudMgr: true,
        outcomeDays: 30, outcomeDaysMin: 14, outcomeDaysMax: 60, outcomeExt: 2, outcomeGateN: 2, outcomeGrace: 3,
        // Через сколько месяцев без ответа КП само становится «отклонено» (0 — выключено)
        outcomeAutoMonths: 6,
        // С какого дня просрочки окно итога нельзя закрыть без отметки (0 — не требовать)
        outcomeHardDays: 14,
        // То же для Профи, менеджеров, админов и сотрудников ТЕРЕМ: запас времени больше, отмечать итог всё равно обязательно
        outcomeProExt: 4, outcomeProExtDays: 45, outcomeProGateN: 5, outcomeProGrace: 7, outcomeProHardDays: 30,
        // Через сколько дней без движения неотправленный расчёт закрывается сам (0 — не закрывать)
        outcomeUnsentDays: 30 },

    limitSettings: function () {
        const t = Object.assign({}, this.LIMIT_DEFAULTS, this.raw().limit || {});
        t.perMonth = Math.min(100, Math.max(1, Math.round(this.num(t.perMonth)) || 1));
        // Целое из цифр, иначе значение по умолчанию — как разбирает те же поля база
        // (send_kp_outcome_reminders: ширина w цифр), чтобы окно и рассылка не расходились
        const cl = (v, lo, hi, d, w) => { const x = String(v == null ? '' : v).trim(); return new RegExp('^\\d{1,' + (w || 3) + '}$').test(x) ? Math.min(hi, Math.max(lo, parseInt(x, 10))) : d; };
        t.perMonthPlain = cl(t.perMonthPlain, 0, 100, 1);
        t.outcomeDaysMin = cl(t.outcomeDaysMin, 7, 90, 14);
        t.outcomeDaysMax = Math.max(t.outcomeDaysMin, cl(t.outcomeDaysMax, 7, 180, 60));
        t.outcomeDays = Math.min(t.outcomeDaysMax, Math.max(t.outcomeDaysMin, cl(t.outcomeDays, 7, 180, 30)));
        t.outcomeExt = cl(t.outcomeExt, 0, 5, 2, 2);
        t.outcomeGateN = cl(t.outcomeGateN, 1, 10, 2);
        t.outcomeGrace = cl(t.outcomeGrace, 0, 30, 3);
        t.outcomeAutoMonths = cl(t.outcomeAutoMonths, 0, 60, 6, 2);
        t.outcomeHardDays = cl(t.outcomeHardDays, 0, 60, 14, 2);
        t.outcomeProExt = cl(t.outcomeProExt, 0, 10, 4, 2);
        t.outcomeProExtDays = cl(t.outcomeProExtDays, 7, 180, 45);
        t.outcomeProGateN = cl(t.outcomeProGateN, 1, 20, 5, 2);
        t.outcomeProGrace = cl(t.outcomeProGrace, 0, 60, 7, 2);
        t.outcomeProHardDays = cl(t.outcomeProHardDays, 0, 120, 30);
        t.outcomeUnsentDays = cl(t.outcomeUnsentDays, 0, 180, 30);
        return t;
    },

    limitStatus: function () {
        const t = this.limitSettings(), d = this.localDay();
        if (!t.enabled) return { on: false, label: 'выключен', color: '#64748B' };
        if (t.from && d < t.from) return { on: false, label: 'начнётся ' + this.fmtDate(t.from), color: '#2563EB' };
        return { on: true, label: t.from ? 'действует с ' + this.fmtDate(t.from) : 'действует', color: '#10B981' };
    },

    setLimitField: function (field, value) {
        const BOOL = ['enabled', 'excludeTerem', 'outcomeGate', 'outcomeOn', 'outcomeAudBase', 'outcomeAudPro', 'outcomeAudMgr'];
        const NUM = { perMonthPlain: [0, 100, 1], outcomeDays: [7, 180, 30], outcomeDaysMin: [7, 90, 14], outcomeDaysMax: [7, 180, 60], outcomeExt: [0, 5, 2], outcomeGateN: [1, 10, 2], outcomeGrace: [0, 30, 3], outcomeAutoMonths: [0, 60, 6], outcomeHardDays: [0, 60, 14], outcomeProExt: [0, 10, 4], outcomeProExtDays: [7, 180, 45], outcomeProGateN: [1, 20, 5], outcomeProGrace: [0, 60, 7], outcomeProHardDays: [0, 120, 30], outcomeUnsentDays: [0, 180, 30] };
        if (['from', 'perMonth'].indexOf(field) < 0 && BOOL.indexOf(field) < 0 && !NUM[field]) return;
        if (BOOL.indexOf(field) >= 0) value = !!value;
        else if (NUM[field]) { const n = Math.round(this.num(value)); value = isFinite(n) ? Math.min(NUM[field][1], Math.max(NUM[field][0], n)) : NUM[field][2]; }
        else if (field === 'perMonth') value = Math.min(100, Math.max(1, Math.round(this.num(value)) || 1));
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
                const hit = arr.filter(n => n > t.perMonth).length, hitAll = arr.filter(n => n > t.perMonth + t.perMonthPlain).length;
                const cell = (l, n) => `<td style="${u.td} text-align:center;"><div style="font-size:11px; color:var(--text-sec);">${l}</div><b>${n}</b></td>`;
                return `<div style="margin-bottom:12px;"><div style="font-size:13px; font-weight:600; color:var(--text-main); margin-bottom:6px;">${names[k.slice(5)]} ${k.slice(0, 4)}: отправили КП ${arr.length} из ${D.total} бесплатных мастеров</div>
                    <table style="border-collapse:collapse;"><tr>${cell('1', bucket(1, 1))}${cell('2', bucket(2, 2))}${cell('3', bucket(3, 3))}${cell('4–5', bucket(4, 5))}${cell('6+', bucket(6, 999))}</tr></table>
                    <div style="font-size:12px; color:var(--text-sec); margin-top:4px;">Монтаж закрылся бы у ${hit} ${hit === 1 ? 'человека' : 'человек'} (больше ${t.perMonth} КП), отправка — у ${hitAll} (больше ${t.perMonth + t.perMonthPlain}).</div></div>`;
            }).join('');
        }
        return `<p style="${u.hint}">Бесплатный тариф, календарный месяц. Монтажник: первые КП (поле «с монтажом») уходят клиенту с монтажными работами, следующие (поле «без монтажа») — только с оборудованием, в окне выбора разделов монтаж стоит с замком «с Профи»; дальше отправка закрыта до Профи. Монтаж в смете на экране виден всегда. Продавцу (монтажа нет) действует только поле «без монтажа». Повторная отправка уже отправленного КП лимит не тратит и монтаж не добавляет и не убирает. Пробный и платный Профи, менеджеры, наблюдатели и админы лимита не видят. Сбой подсчёта лимит не включает: человека пропускаем.</p>
            <div style="${u.card} max-width:760px;">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;"><b style="font-size:14px; color:var(--text-main);">Сейчас:</b> ${this.chip(st.label, st.color)}</div>
                ${row('Включить лимит', 'Выключено — отправлять КП можно без ограничений, как и раньше.', this.toggleHtml(!!t.enabled, `Subscription.setLimitField('enabled', ${!t.enabled})`, dis))}
                ${row('Бесплатных КП с монтажом в месяц', 'Календарный месяц, считаются разные КП по порядку отправки. От 1 до 100.', `<input type="number" min="1" max="100" value="${t.perMonth}" ${dis ? 'disabled' : ''} onchange="Subscription.setLimitField('perMonth', this.value)" style="${u.input} width:80px;">`)}
                ${row('Бесплатных КП без монтажа в месяц', 'Монтажнику — сколько КП сверх КП с монтажом можно отправить только с оборудованием; продавцу — сколько КП в месяц всего. Дальше отправка закрыта до Профи. От 0 до 100.', `<input type="number" min="0" max="100" value="${t.perMonthPlain}" ${dis ? 'disabled' : ''} onchange="Subscription.setLimitField('perMonthPlain', this.value)" style="${u.input} width:80px;">`)}
                ${row('Действует с даты', 'Нажмите и выберите день в календаре (включительно). Без даты — сразу, как только лимит включён.', `<button type="button" ${dis ? 'disabled' : ''} onclick="Subscription.openLimitFrom()" style="${u.input} min-width:230px; text-align:left; cursor:${dis ? 'default' : 'pointer'};">${t.from ? 'с ' + this.fmtDate(t.from) : 'Сразу, как только включён'}</button>`)}
                ${row('Не применять к сотрудникам ТЕРЕМ', 'Почта @teremopt.ru или привязка к компании «ТЕРЕМ».', this.toggleHtml(!!t.excludeTerem, `Subscription.setLimitField('excludeTerem', ${!t.excludeTerem})`, dis))}
            </div>
            <div style="${u.card} max-width:760px; margin-top:14px;">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;"><b style="font-size:14px; color:var(--text-main);">Итог КП</b></div>
                <p style="${u.hint}">Через заданный срок после отправки КП клиенту монтажнику при входе показывается окно «Чем закончились КП?»: согласился, отказ с причиной или «ещё думает» (продление). Причины отказов собираются в «Планировщике». Срок и сообщения менеджерам в 09:20 считает та же настройка.</p>
                ${row('Окно «Чем закончились КП?»', 'Общий выключатель окна, блока и сообщений на 30-й день. Выключено — никому ничего не показывается, как до запуска.', this.toggleHtml(t.outcomeOn !== false, `Subscription.setLimitField('outcomeOn', ${t.outcomeOn === false})`, dis))}
                ${row('Показывать монтажникам без Профи', 'Базовый и бесплатный тариф. Блок отправки действует на всех, без исключений; здесь только показ окна.', this.toggleHtml(t.outcomeAudBase !== false, `Subscription.setLimitField('outcomeAudBase', ${t.outcomeAudBase === false})`, dis))}
                ${row('Показывать монтажникам на Профи', 'Окно, сообщения и блок отправки (его порог у Профи свой, ниже). Сам Профи окно отключить не может.', this.toggleHtml(t.outcomeAudPro !== false, `Subscription.setLimitField('outcomeAudPro', ${t.outcomeAudPro === false})`, dis))}
                ${row('Показывать менеджерам и админам', 'Менеджеры, админы и сотрудники ТЕРЕМ отмечают итог по своим КП так же, как все. Отметка за монтажника в планировщике работает всегда.', this.toggleHtml(t.outcomeAudMgr !== false, `Subscription.setLimitField('outcomeAudMgr', ${t.outcomeAudMgr === false})`, dis))}
                ${row('Срок ответа, дней', 'По умолчанию для всех. Считается от последней отправки КП: ссылкой, PDF, печатью или Excel.', `<input type="number" min="7" max="180" value="${t.outcomeDays}" ${dis ? 'disabled' : ''} onchange="Subscription.setLimitField('outcomeDays', this.value)" style="${u.input} width:80px;">`)}
                ${row('Монтажник может менять срок от, дней', 'Нижняя граница личной настройки в «Настройки → КП и счета». Срок вне границ приводится к ближайшей.', `<input type="number" min="7" max="90" value="${t.outcomeDaysMin}" ${dis ? 'disabled' : ''} onchange="Subscription.setLimitField('outcomeDaysMin', this.value)" style="${u.input} width:80px;">`)}
                ${row('Монтажник может менять срок до, дней', 'Верхняя граница личной настройки.', `<input type="number" min="7" max="180" value="${t.outcomeDaysMax}" ${dis ? 'disabled' : ''} onchange="Subscription.setLimitField('outcomeDaysMax', this.value)" style="${u.input} width:80px;">`)}
                ${row('Продлений «ещё думает» (базовый)', 'Сколько раз можно продлить срок одного КП. 0 — без продлений.', `<input type="number" min="0" max="5" value="${t.outcomeExt}" ${dis ? 'disabled' : ''} onchange="Subscription.setLimitField('outcomeExt', this.value)" style="${u.input} width:80px;">`)}
                ${row('Блок отправки без Профи', 'Касается всех тарифов и сотрудников. Если выключить, окно остаётся, а отправка КП не блокируется. Не зависит от «Лимита КП» выше.', this.toggleHtml(t.outcomeGate !== false, `Subscription.setLimitField('outcomeGate', ${t.outcomeGate === false})`, dis))}
                ${row('Блок: сколько КП без итога (базовый)', 'Когда столько КП без итога просрочены дольше льготы, новое КП не уходит, пока монтажник не отметит итог.', `<input type="number" min="1" max="10" value="${t.outcomeGateN}" ${dis ? 'disabled' : ''} onchange="Subscription.setLimitField('outcomeGateN', this.value)" style="${u.input} width:80px;">`)}
                ${row('Блок: льгота после срока, дней (базовый)', 'Сколько дней после срока КП ещё не блокирует отправку.', `<input type="number" min="0" max="30" value="${t.outcomeGrace}" ${dis ? 'disabled' : ''} onchange="Subscription.setLimitField('outcomeGrace', this.value)" style="${u.input} width:80px;">`)}
                ${row('Жёсткое окно после просрочки, дней (базовый)', 'КП без итога дольше стольких дней после срока: окно при входе показывается каждый раз, без кнопки «Напомнить завтра», и закрывается, только когда по таким КП отмечен итог (или «ещё думает», пока есть продления). Действует на всех, включая Профи, менеджеров, админов и сотрудников ТЕРЕМ. 0 — не требовать. По умолчанию 14.', `<input type="number" min="0" max="60" value="${t.outcomeHardDays}" ${dis ? 'disabled' : ''} onchange="Subscription.setLimitField('outcomeHardDays', this.value)" style="${u.input} width:80px;">`)}
                ${row('Профи и сотрудники: продлений «ещё думает»', 'Профи, менеджеры, админы и сотрудники ТЕРЕМ могут откладывать итог дольше.', `<input type="number" min="0" max="10" value="${t.outcomeProExt}" ${dis ? 'disabled' : ''} onchange="Subscription.setLimitField('outcomeProExt', this.value)" style="${u.input} width:80px;">`)}
                ${row('Профи и сотрудники: длина продления, дней', 'На сколько дней откладывается итог при нажатии «Думает».', `<input type="number" min="7" max="180" value="${t.outcomeProExtDays}" ${dis ? 'disabled' : ''} onchange="Subscription.setLimitField('outcomeProExtDays', this.value)" style="${u.input} width:80px;">`)}
                ${row('Профи и сотрудники: блок, сколько КП без итога', 'Столько просроченных КП допустимо, прежде чем новое КП не уйдёт клиенту.', `<input type="number" min="1" max="20" value="${t.outcomeProGateN}" ${dis ? 'disabled' : ''} onchange="Subscription.setLimitField('outcomeProGateN', this.value)" style="${u.input} width:80px;">`)}
                ${row('Профи и сотрудники: льгота после срока, дней', 'Сколько дней после срока КП ещё не считается просроченным для блока.', `<input type="number" min="0" max="60" value="${t.outcomeProGrace}" ${dis ? 'disabled' : ''} onchange="Subscription.setLimitField('outcomeProGrace', this.value)" style="${u.input} width:80px;">`)}
                ${row('Профи и сотрудники: жёсткое окно, дней', 'С какого дня просрочки окно нельзя закрыть без отметки. 0 — не требовать.', `<input type="number" min="0" max="120" value="${t.outcomeProHardDays}" ${dis ? 'disabled' : ''} onchange="Subscription.setLimitField('outcomeProHardDays', this.value)" style="${u.input} width:80px;">`)}
                ${row('Неотправленные расчёты: закрывать само через, дней', 'Расчёт, который не отправляли клиенту и не трогали столько дней, получает статус «Не отправлено клиенту (авто)». Нужен для честного среза по всем расчётам. 0 — не закрывать.', `<input type="number" min="0" max="180" value="${t.outcomeUnsentDays}" ${dis ? 'disabled' : ''} onchange="Subscription.setLimitField('outcomeUnsentDays', this.value)" style="${u.input} width:80px;">`)}
                ${row('Автоотклонение без ответа, месяцев', 'КП без итога и без движения столько месяцев само становится «Отклонено» (причина «Нет ответа (авто)»): в базе это делает ежедневная проверка. 0 — не отклонять. По умолчанию 6.', `<input type="number" min="0" max="60" value="${t.outcomeAutoMonths}" ${dis ? 'disabled' : ''} onchange="Subscription.setLimitField('outcomeAutoMonths', this.value)" style="${u.input} width:80px;">`)}
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
        if (custom.length) return 'В Профи: ' + custom.join(', ') + '.';
        const items = this.benefitRows(account)
            .filter(r => r.pro !== 'off' && r.base === 'off')
            .map(r => this.BENEFIT_TEXT[r.f.id] || r.f.label.toLowerCase());
        if (!items.length) return 'Подписка Профи: все функции калькулятора без ограничений.';
        return 'В Профи: ' + items.join(', ') + '.';
    },

    // Блок для окна тарифа: одна ссылка на страницу сравнения. Список функций
    // здесь не выводим — он на tariffs.html, а окно должно вести к оплате.
    // Шапка окна тарифа — минимально: одна серая строка и ссылка «Что входит →».
    // Строка — три главных отличия коротко через точку (монтаж первым, если лимит
    // действует); если окно открыто замком («Вы хотели…»), строку пишет showModal.
    BENEFIT_SHORT: { rommer: 'ROMMER', terem: 'все марки прайса', analog: '«Бюджетнее»', recognize: 'распознавание смет', design: 'проект', ufhplan: 'раскладка ТП', opcost: 'эксплуатация', branding: 'свой логотип', money: 'маржа объекта', docs: 'договор и акты', disc1c: 'скидки в КП' },
    benefitsHtml: function (account, noLine) {
        const link = '<a class="pro-compare" href="#" onclick="app.closeModal(); app.showProfileModal(false, &quot;subscription&quot;); return false;">Что входит</a>';
        if (noLine) return link;
        let items = [];
        try {
            account = account || this.userAccount();
            if (this.limitStatus().on && app.canUseWorks()) items.push('монтаж во всех КП');
            const custom = (this.settings().benefits[account] || []).map(x => String(x || '').trim()).filter(Boolean);
            const rows = custom.length ? custom : this.benefitRows(account)
                .filter(r => r.pro !== 'off' && r.base === 'off' && r.f.id !== 'works')
                .map(r => this.BENEFIT_SHORT[r.f.id] || this.BENEFIT_TEXT[r.f.id] || r.f.label.toLowerCase());
            items = items.concat(rows).slice(0, 3);
        } catch (e) { items = []; }
        if (items.length) items[0] = items[0].charAt(0).toUpperCase() + items[0].slice(1);
        return (items.length ? '<div class="pro-line">' + items.map(x => this.esc(x)).join(' · ') + '</div>' : '') + link;
    },

    cardsHtml: function (ctx, preview) {
        const plans = this.planList(false);
        // Рекомендуемый тариф — самый длинный из подписок (год, иначе месяц): у него
        // заливка и метка «Выгоднее», у остальных — кнопка-контур. Две одинаковые синие
        // кнопки рядом не подсказывали, что выбрать.
        const subs = plans.filter(x => !(Math.round(this.num(x.days)) > 0));
        const bestId = plans.length > 1 && subs.length ? subs[subs.length - 1].id : null;
        return plans.map(p => {
            const r = this.resolve(p.id, ctx);
            if (!r) return '';
            const pct = r.promo ? r.promoPct : r.termPct;
            const badge = pct > 0 ? `<div class="badge">-${pct}%</div>` : '';
            const sub = r.days > 0
                ? `1 объект · ${r.days} дн. на правки`
                : r.months > 1
                    ? `в месяц (<span class="curr-amount" data-rub="${r.rub}">${Math.round(r.rub).toLocaleString('ru-RU')}</span> <span class="curr-symbol">₽</span> за ${this.esc(this.monthsWord(r.months))})`
                    : 'в месяц · без лимита объектов';
            const promoLine = r.promo
                ? `<div style="font-size:11px; color:var(--c-warn,#D97706); font-weight:700; margin:2px 0 8px; text-align:center;">🔥 ${this.esc(r.promo.title || 'Акция')}${r.promo.to ? ' до ' + this.fmtDate(r.promo.to) : ''}<span style="color:var(--text-sec); font-weight:500;"> · было ${this.esc(this.fmtRub(r.baseRub))}</span></div>`
                : '';
            const click = preview ? `Subscription.previewPlan('${p.id}')` : `app.openPaymentModal('${p.id}')`;
            // Якорь: сколько сэкономит человек против помесячной оплаты
            let saveLine = '';
            if (r.months > 1 && !r.days) {
                const mp = plans.find(x => !x.days && Math.round(this.num(x.months)) === 1), mr = mp && this.resolve(mp.id, ctx);
                const save = mr ? Math.round(mr.rub * r.months - r.rub) : 0;
                if (save > 0) saveLine = `<div style="font-size:11px; color:#10B981; font-weight:700; margin:2px 0 6px; text-align:center;">Выгоднее помесячной оплаты на ${this.esc(this.fmtRub(save))}</div>`;
            } else if (r.months === 1 && !r.days) {
                // Месяц против «Одного расчёта»: с какого объекта подписка дешевле
                const op = plans.find(x => x.days > 0), or = op && this.resolve(op.id, ctx);
                if (or && or.rub > 0 && r.rub > or.rub) {
                    const n = Math.floor(r.rub / or.rub) + 1;
                    saveLine = `<div style="font-size:11px; color:#10B981; font-weight:700; margin:2px 0 6px; text-align:center;">Выгоднее одного расчёта с ${n}-го объекта</div>`;
                }
            }
            const best = p.id === bestId;
            const label = r.days > 0 ? 'Купить 1 расчёт' : (r.months >= 12 ? 'Подписаться на год' : (r.months > 1 ? 'Подписаться на ' + this.monthsWord(r.months) : 'Подписаться на месяц'));
            const badgeHtml = badge || (best ? '<div class="badge">Выгоднее</div>' : '');
            return `<div class="tariff-card${best ? ' is-best' : ''}">
                        ${badgeHtml}
                        <h3>${this.esc(String(r.title).toUpperCase())}</h3>
                        <div class="price"><span class="curr-amount" data-rub="${r.days > 0 ? r.rub : r.perMonth}">${(r.days > 0 ? Math.round(r.rub) : r.perMonth).toLocaleString('ru-RU')}</span> <span class="curr-symbol">₽</span></div>
                        <div class="price-sub">${sub}</div>
                        ${saveLine}
                        ${promoLine}
                        <button type="button" class="btn-subscribe${best || !bestId ? '' : ' is-secondary'}" onclick="${click}">${label}</button>
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

    // ═══ Подсказки оплаты ════════════════════════════════════════════════
    // Мягкие предложения Профи в момент пользы: после отправки КП и когда Профи
    // закончился (за 2 дня и в последний день напоминает trialEndCheck ниже, он берёт
    // отсюда текст цены). Настройки — app_settings.subscription.nudges. Показывается
    // только человеку без Профи, не чаще gapDays и не больше трёх раз на причину; любой
    // сбой — тишина. Окно с «Не сейчас» — тариф сам не включается и ничего не списывается.
    NUDGE_DEFAULTS: { enabled: true, gapDays: 7, kp: true, kpFrom: 2, expiry: true, lock: true, save: true, trialEnd: true },
    NUDGE_LS: 'hc_pay_nudge',

    nudgeSettings: function () {
        const t = Object.assign({}, this.NUDGE_DEFAULTS, this.raw().nudges || {});
        t.gapDays = Math.min(60, Math.max(1, Math.round(this.num(t.gapDays)) || 7));
        t.kpFrom = Math.min(20, Math.max(1, Math.round(this.num(t.kpFrom)) || 2));
        return t;
    },

    setNudgeField: function (field, value) {
        if (['enabled', 'gapDays', 'kp', 'kpFrom', 'expiry', 'lock', 'save', 'trialEnd'].indexOf(field) < 0) return;
        if (field === 'gapDays') value = Math.min(60, Math.max(1, Math.round(this.num(value)) || 7));
        else if (field === 'kpFrom') value = Math.min(20, Math.max(1, Math.round(this.num(value)) || 2));
        else value = !!value;
        this.apply(v => { v.nudges = Object.assign({}, v.nudges || {}, { [field]: value }); return v; });
        this.render();
    },

    nudgeLoad: function () {
        try { return JSON.parse(localStorage.getItem(this.NUDGE_LS) || '{}') || {}; } catch (e) { return {}; }
    },

    // Запомнить показ: общая пауза между подсказками и счётчик по причине
    nudgeTouch: function (reason) {
        const st = this.nudgeLoad();
        st.t = Date.now();
        st.by = st.by || {};
        st.by[reason] = { n: ((st.by[reason] && st.by[reason].n) || 0) + 1, t: st.t };
        try { localStorage.setItem(this.NUDGE_LS, JSON.stringify(st)); } catch (e) { }
    },

    nudgeGapOk: function (reason, cap) {
        const st = this.nudgeLoad(), now = Date.now(), DAY = 86400000;
        if (st.t && now - st.t < this.nudgeSettings().gapDays * DAY) return false;
        if (((st.by && st.by[reason] && st.by[reason].n) || 0) >= cap) return false;
        // Пробный период только что предлагали — не накладываем второе окно
        try { const tr = JSON.parse(localStorage.getItem('hc_trial_offer') || '{}') || {}; if (tr.t && now - tr.t < DAY) return false; } catch (e) { }
        return true;
    },

    // Подсказки получает только вошедший человек без Профи (free/base), не сотрудник ТЕРЕМ
    nudgeEligible: function () {
        try {
            if (!this.nudgeSettings().enabled) return false;
            const tg = (app.state && app.state.tgUser) || {};
            if (!tg.authUserId && !tg.email && !tg.id) return false;
            const acc = tg.account_type || app.state.accountType || 'base';
            // 'pro' с истёкшим сроком — тоже адресат: у него isPro() уже ложь
            if (['admin', 'viewer', 'manager'].indexOf(acc) >= 0) return false;
            if (app.isPro() || app.isTeremStaff()) return false;
            return true;
        } catch (e) { return false; }
    },

    // Цена для окна: год как якорь («4 000 ₽ в месяц вместо 5 000») и действующая акция с датой
    priceLine: function () {
        try {
            const plans = this.planList(false).map(p => this.resolve(p.id)).filter(Boolean);
            if (!plans.length) return '';
            const month = plans.find(r => r.months === 1 && !r.days);
            const best = plans.filter(r => r.months > 1 && !r.days).sort((a, b) => b.months - a.months)[0];
            const one = plans.find(r => r.days > 0);
            const out = [];
            if (best) {
                const save = month ? Math.round(month.rub * best.months - best.rub) : 0;
                out.push('Профи на ' + (best.months === 12 ? 'год' : this.monthsWord(best.months)) + ' — ' + this.fmtRub(best.perMonth) + ' в месяц'
                    + (month ? ' вместо ' + this.fmtRub(month.rub) : '') + (save > 0 ? ', выгоднее на ' + this.fmtRub(save) : '') + '.');
            } else if (month) out.push('Профи — ' + this.fmtRub(month.rub) + ' в месяц' + (one ? ', либо ' + this.fmtRub(one.rub) + ' за один объект (' + one.days + ' дней на правки).' : '.'));
            const promo = plans.map(r => r.promo).find(Boolean);
            if (promo) out.push('Акция «' + (promo.title || 'скидка') + '»' + (promo.to ? ' до ' + this.fmtDate(promo.to) : '') + '.');
            return out.join('\n');
        } catch (e) { return ''; }
    },

    // Сколько разных КП человек отправлял клиентам за всё время
    kpCount: async function () {
        const tg = (app.state && app.state.tgUser) || {};
        if (!tg.id) return 0;
        const { data, error } = await supabaseClient.from('invoice_events').select('calc_id')
            .eq('user_id', String(tg.id)).in('event', ['printed', 'sent']).limit(1000);
        if (error) throw error;
        return new Set((data || []).map(r => String(r.calc_id))).size;
    },

    // Вызывается из app.logInvoiceEvent после отправки КП: ждём, пока закроется окно отправки
    afterKpSent: function () {
        setTimeout(async () => {
            try {
                if (this._nudgeBusy) return;
                await app.loadAppSettings();
                const s = this.nudgeSettings();
                if (!s.kp || !this.nudgeEligible() || !this.nudgeGapOk('kp', 3)) return;
                const n = await this.kpCount();
                if (n < s.kpFrom) return;
                await this.nudge('kp', { n: n });
            } catch (e) { console.warn('[подсказка оплаты] КП:', e); }
        }, 6000);
    },

    // Профи закончился: один раз при входе, пока человек его не продлил
    afterProExpired: function () {
        setTimeout(async () => {
            try {
                if (this._nudgeBusy) return;
                // Кончились 24 часа после «Я оплатил», а оплату ещё не подтвердили
                const gr = this.graceInfo();
                if (gr && !gr.active) {
                    try { localStorage.removeItem(this.GRACE_LS); } catch (e) { }
                    this.alarmPro();
                    return;
                }
                await app.loadAppSettings();
                if (!this.nudgeSettings().expiry || !this.nudgeEligible() || !this.nudgeGapOk('expired', 2)) return;
                await this.nudge('expired', {});
            } catch (e) { console.warn('[подсказка оплаты] конец Профи:', e); }
        }, 2500);
    },

    // ── Конец Профи: за 2 дня и в последний день ─────────────────────────
    // Плашка под шапкой калькулятора (#trial_end_banner), пока до конца Профи 2 дня
    // и меньше, и окно один раз на стадию: «за 2 дня» (послезавтра/завтра) и «последний
    // день» (сегодня или осталось меньше суток). Проверяется при входе и раз в 20 минут,
    // чтобы открытая вкладка тоже узнала о последнем дне. Пробному/промокоду — «оставить
    // Профи», оплаченному (pro_expires_at) — «продлить». После конца — afterProExpired.
    TE_HIDE_LS: 'hc_trial_end_hide',
    TE_SHOWN_LS: 'hc_trial_end_shown',

    trialEndInfo: function () {
        try {
            if (typeof app === 'undefined' || !this.nudgeSettings().trialEnd) return null;
            const tg = (app.state && app.state.tgUser) || {};
            if (tg.account_type !== 'pro' || !tg.demo_ends_at) return null;
            if (app.isTeremStaff()) return null;
            const gr = this.graceInfo();
            if (gr && gr.active) return null;   // 24 часа после «Я оплатил» — свою плашку показывает syncTrialEndBanner
            const end = new Date(tg.demo_ends_at), ms = end.getTime() - Date.now();
            if (isNaN(ms) || ms <= 0) return null;
            const d0 = new Date(); d0.setHours(0, 0, 0, 0);
            const d1 = new Date(end); d1.setHours(0, 0, 0, 0);
            const days = Math.round((d1 - d0) / 86400000);   // 0 — сегодня, 1 — завтра, 2 — послезавтра
            if (days > 2) return null;
            const time = end.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            const date = end.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
            const when = days <= 0 ? 'сегодня в ' + time : (days === 1 ? (ms < 86400000 ? 'завтра в ' + time : 'завтра, ' + date) : 'послезавтра, ' + date);
            return {
                end: end, endKey: end.toISOString().slice(0, 16), days: days, when: when,
                stage: (days <= 0 || ms < 86400000) ? 'last' : '2d',
                paid: !!tg.pro_expires_at
            };
        } catch (e) { return null; }
    },

    // Что пропадёт без Профи — по таблице «Тарифы» для этой учётки, плюс лимит монтажа в КП
    trialEndLosses: function () {
        const acc = this.userAccount();
        const out = [];
        try {
            if (this.limitStatus().on && app.canUseWorks()) out.push('монтаж в КП — только в ' + this.limitSettings().perMonth + ' КП в месяц');
        } catch (e) { }
        this.benefitRows(acc).filter(r => r.pro !== 'off' && r.base === 'off').forEach(r => {
            if (r.f.id === 'works') return;
            out.push(this.BENEFIT_TEXT[r.f.id] || r.f.label.toLowerCase());
        });
        return out;
    },

    trialEndPrice: function () {
        try {
            const r = this.resolve('month');
            if (r && r.rub > 0 && this.settings().plans.month.enabled !== false) return this.fmtRub(r.rub) + ' в месяц';
        } catch (e) { }
        return '';
    },

    syncTrialEndBanner: function () {
        try {
            const host = document.getElementById('trial_end_banner');
            if (!host) return;
            if (this.objectGraceInfo()) this.graceWatch();
            const gr = this.graceInfo();
            if (gr && gr.active) {
                this.graceWatch();
                const t = gr.until.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                host.className = 'no-print trial-end-banner te-ok';
                host.innerHTML = '<div class="teb" style="cursor:default;">' +
                    '<span class="teb-body"><span class="teb-title">Профи включён до ' + this.esc(t) + ' — проверяем оплату</span>' +
                    '<span class="teb-sub">Как только поступление подтвердится, Профи продлится на оплаченный срок. Ничего делать не нужно.</span></span></div>';
                host.style.display = '';
                return;
            }
            const info = this.trialEndInfo();
            // Пробный уже закончился, а акция «после пробного» действует — плашка с ценой
            if (!info) { const pr = this.afterTrialPromoInfo(); if (pr) { this.renderPromoBanner(host, pr); return; } }
            let hidden = '';
            try { hidden = localStorage.getItem(this.TE_HIDE_LS) || ''; } catch (e) { }
            if (!info || hidden === info.endKey + ':' + info.stage) { host.style.display = 'none'; host.innerHTML = ''; return; }
            const loss = this.trialEndLosses();
            const price = this.trialEndPrice();
            const title = (info.paid ? 'Профи заканчивается ' : 'Пробный Профи заканчивается ') + info.when;
            const sub = loss.length ? 'Без Профи: ' + loss.slice(0, 4).join(', ') + (loss.length > 4 ? ' и ещё ' + (loss.length - 4) : '') + '. Сметы останутся.' : 'Сметы останутся, функции Профи станут недоступны.';
            const cta = (info.paid ? 'Продлить' : 'Оставить Профи') + (price ? ' — ' + price : '');
            host.className = 'no-print trial-end-banner' + (info.stage === 'last' ? ' te-last' : '');
            host.innerHTML = '<div class="teb" role="button" tabindex="0" onclick="Subscription.trialEndGo()" onkeydown="if(event.key===\'Enter\'){event.preventDefault();Subscription.trialEndGo();}">' +
                '<span class="teb-body"><span class="teb-title">' + this.esc(title) + '</span><span class="teb-sub">' + this.esc(sub) + '</span></span>' +
                '<span class="teb-cta">' + this.esc(cta) + '</span>' +
                '<button type="button" class="teb-x" onclick="event.stopPropagation();Subscription.trialEndHide()" title="Скрыть" aria-label="Скрыть">&times;</button></div>';
            host.style.display = '';
        } catch (e) { }
    },

    // ── Плашка «Первый месяц Профи — 990 ₽» тем, у кого кончился пробный ─────
    // Показывается под шапкой, пока: человек вошёл, Профи у него нет, пробный период был
    // и закончился, оплат не было, а акция на месяц с условием «после пробного» действует
    // (resolve сам проверяет и даты, и условие). Крестик прячет на сутки. Нажатие — сразу
    // окно оплаты месяца по цене акции. После первой оплаты плашка пропадает сама.
    PROMO_HIDE_LS: 'hc_promo_banner_hide',
    afterTrialPromoInfo: function () {
        try {
            if (typeof app === 'undefined') return null;
            const tg = (app.state && app.state.tgUser) || {};
            if (!tg.id && !tg.email) return null;
            if (['admin', 'viewer', 'manager'].indexOf(tg.account_type) >= 0) return null;
            if (app.isPro() || app.isTeremStaff()) return null;
            const ends = tg.demo_ends_at ? new Date(tg.demo_ends_at) : null;
            if (!ends || isNaN(ends) || ends.getTime() > Date.now() || tg.pro_expires_at) return null;
            const plan = this.settings().plans.month;
            if (!plan || plan.enabled === false) return null;
            const r = this.resolve('month');
            if (!r || !r.promo || r.promo.audience !== 'after_trial' || !(r.rub > 0) || !(r.rub < r.baseRub)) return null;
            let hid = null;
            try { hid = JSON.parse(localStorage.getItem(this.PROMO_HIDE_LS) || 'null'); } catch (e) { }
            if (hid && hid.id === r.promo.id && Date.now() - hid.t < 86400000) return null;
            return r;
        } catch (e) { return null; }
    },

    renderPromoBanner: function (host, r) {
        const left = r.promo.to ? Math.ceil((new Date(r.promo.to + 'T23:59:59') - Date.now()) / 86400000) : 0;
        const until = r.promo.to ? (left > 0 && left <= 3 ? 'осталось ' + left + ' ' + (left === 1 ? 'день' : 'дня') : 'до ' + this.fmtDate(r.promo.to)) : '';
        host.className = 'no-print trial-end-banner te-promo';
        host.innerHTML = '<div class="teb" role="button" tabindex="0" onclick="Subscription.promoBannerGo()" onkeydown="if(event.key===\'Enter\'){event.preventDefault();Subscription.promoBannerGo();}">' +
            '<span class="teb-body"><span class="teb-title">Первый месяц Профи — ' + this.esc(this.fmtRub(r.rub)) + '</span>' +
            '<span class="teb-sub">Вместо ' + this.esc(this.fmtRub(r.baseRub)) + (until ? ' · ' + this.esc(until) : '') + '</span></span>' +
            '<span class="teb-cta">Взять за ' + this.esc(this.fmtRub(r.rub)) + '</span>' +
            '<button type="button" class="teb-x" onclick="event.stopPropagation();Subscription.promoBannerHide()" title="Скрыть на сутки" aria-label="Скрыть на сутки">&times;</button></div>';
        host.style.display = '';
        if (!this._promoBannerSeen) { this._promoBannerSeen = true; try { app.logPaywall('seen', 'Акция: плашка на главной'); } catch (e) { } }
    },

    promoBannerGo: function () {
        try { app.logPaywall('tariff_open', 'Акция: плашка на главной'); } catch (e) { }
        app.openPaymentModal('month');
    },

    promoBannerHide: function () {
        const r = this.afterTrialPromoInfo();
        if (r) try { localStorage.setItem(this.PROMO_HIDE_LS, JSON.stringify({ id: r.promo.id, t: Date.now() })); } catch (e) { }
        this.syncTrialEndBanner();
    },

    trialEndGo: function () {
        const info = this.trialEndInfo();
        try { app.logPaywall('tariff_open', 'Конец Профи: плашка ' + (info ? info.stage : '')); } catch (e) { }
        app.showModal('pro', { why: info ? ((info.paid ? 'Профи заканчивается ' : 'Пробный Профи заканчивается ') + info.when) : '' });
    },

    trialEndHide: function () {
        const info = this.trialEndInfo();
        if (info) try { localStorage.setItem(this.TE_HIDE_LS, info.endKey + ':' + info.stage); } catch (e) { }
        this.syncTrialEndBanner();
    },

    // Сколько разных КП ушло клиентам за время Профи — для окна «за 2 дня / последний день»
    kpCountSince: async function (since) {
        const tg = (app.state && app.state.tgUser) || {};
        if (!tg.id) return 0;
        const { data, error } = await supabaseClient.from('invoice_events').select('calc_id')
            .eq('user_id', String(tg.id)).in('event', ['printed', 'sent']).gte('created_at', since.toISOString()).limit(1000);
        if (error) throw error;
        return new Set((data || []).map(r => String(r.calc_id))).size;
    },

    // Что Профи дал человеку за период — по его же сметам, для окна «Профи заканчивается».
    //   objects — сколько разных объектов посчитано (сметы, разные calc_id);
    //   hours   — сэкономленное время: ≈ MIN_SAVED_PER_OBJECT минут на объект против ручного
    //             расчёта (подбор, спецификация, КП в Excel — около 2,5 ч, в калькуляторе ~20 мин);
    //   works   — монтаж, заложенный в КП (works_sum последней версии каждого объекта) —
    //             деньги монтажника, которые Профи помог посчитать и показать клиенту;
    //   cheaper — экономия «Бюджетнее» по последней смете (offer_savings), если считалась в период;
    //   kp      — сколько разных КП ушло клиентам.
    MIN_SAVED_PER_OBJECT: 130,
    proResults: async function (since) {
        const tg = (app.state && app.state.tgUser) || {};
        const res = { objects: 0, hours: 0, works: 0, cheaper: 0, kp: 0 };
        if (!tg.id) return res;
        const iso = since.toISOString();
        const [est, kp, sav] = await Promise.all([
            supabaseClient.from('estimates').select('created_at, works_sum, calc_id:calc_data->>calc_id')
                .eq('user_id', tg.id).gte('created_at', iso).order('created_at', { ascending: true }).limit(1000)
                .then(r => r.data || [], () => []),
            this.kpCountSince(since).catch(() => 0),
            supabaseClient.from('offer_savings').select('save_rub, computed_at').eq('user_id', tg.id).maybeSingle()
                .then(r => r.data || null, () => null)
        ]);
        const byObj = {};
        est.forEach((e, i) => { byObj[e.calc_id || ('_' + i)] = Number(e.works_sum) || 0; });   // по возрастанию — остаётся последняя версия
        res.objects = Object.keys(byObj).length;
        res.works = Math.round(Object.values(byObj).reduce((a, b) => a + b, 0));
        res.hours = Math.round(res.objects * this.MIN_SAVED_PER_OBJECT / 60);
        res.kp = kp || 0;
        if (sav && sav.save_rub > 0 && sav.computed_at && new Date(sav.computed_at) >= since) res.cheaper = Math.round(sav.save_rub);
        return res;
    },

    trialEndCheck: async function () {
        try {
            if (typeof app !== 'undefined' && app.loadAppSettings) await app.loadAppSettings();
            this.syncTrialEndBanner();
            if (!this._teTimer) this._teTimer = setInterval(() => { this.trialEndCheck(); }, 20 * 60 * 1000);
            const info = this.trialEndInfo();
            if (!info || this._nudgeBusy) return;
            let shown = {};
            try { shown = JSON.parse(localStorage.getItem(this.TE_SHOWN_LS) || '{}') || {}; } catch (e) { shown = {}; }
            if (shown.end !== info.endKey) shown = { end: info.endKey };
            // Каждая стадия — одно окно; зашёл впервые уже в последний день — «за 2 дня» не догоняем
            if (shown[info.stage]) return;
            if (document.querySelector('#custom_modal_overlay.active')) return;
            shown[info.stage] = Date.now();
            try { localStorage.setItem(this.TE_SHOWN_LS, JSON.stringify(shown)); } catch (e) { }
            let stats = null;
            try {
                const span = info.paid ? 30 : (app.trialDays ? app.trialDays() : 14);
                // Не держим окно дольше 4 секунд из-за подсчёта: без него окно тоже полное
                stats = await Promise.race([this.proResults(new Date(info.end.getTime() - span * 86400000)), new Promise(r => setTimeout(() => r(null), 4000))]);
            } catch (e) { stats = null; }
            const head = (info.paid ? 'Ваш Профи заканчивается ' : 'Пробный Профи заканчивается ') + info.when + '.';
            this._nudgeBusy = true;
            try { app.logPaywall('seen', 'Конец Профи: окно ' + info.stage); } catch (e) { }
            try {
                const pick = await this.endOfferModal(info, stats);
                if (pick === 'month' || pick === 'object') {
                    try { app.logPaywall('tariff_open', 'Конец Профи: окно ' + info.stage + ' → ' + pick); } catch (e) { }
                    if (this._eoIds && this._eoIds[pick]) app.openPaymentModal(this._eoIds[pick]);
                    else app.showModal('pro', { why: head });
                } else if (pick === 'all') app.showModal('pro', { why: head });
            } finally { this._nudgeBusy = false; }
        } catch (e) { console.warn('[конец Профи] напоминание:', e); }
    },

    // Что даёт Профи — коротко, для карточек «Профи включён» и «Профи заканчивается»
    proGains: function (max) {
        let out = [];
        try {
            if (this.limitStatus().on && app.canUseWorks()) out.push('монтаж во всех КП');
            out = out.concat(this.benefitRows(this.userAccount())
                .filter(r => r.pro !== 'off' && r.base === 'off' && r.f.id !== 'works')
                .map(r => this.BENEFIT_TEXT[r.f.id] || r.f.label.toLowerCase()));
        } catch (e) { }
        return out.slice(0, max || 4);
    },

    // ── Окно «Профи заканчивается»: коротко, с выгодой и кнопкой оплаты ──
    // В стиле окна «Профи включён» (celebratePro): иконка, заголовок, галочки, большая кнопка.
    // Возвращает Promise: 'month' | 'object' | 'all' | null (позже).
    endOfferModal: function (info, stats) {
        return new Promise(resolve => {
            const old = document.getElementById('pro_end_win'); if (old) old.remove();
            let month = null, one = null;
            try {
                const plans = this.planList(false).map(p => this.resolve(p.id)).filter(Boolean);
                month = plans.find(r => r.months === 1 && !r.days) || null;
                one = plans.find(r => r.days > 0) || null;
            } catch (e) { }
            this._eoIds = { month: month && month.id, object: one && one.id };
            const st = stats || {};
            // Цифры «что Профи уже дал»: только ненулевые, максимум три
            const nums = [];
            if (st.hours > 0) nums.push([st.hours + ' ч', 'сэкономлено']);
            if (st.works > 0) nums.push([this.fmtRub(st.works), 'монтажа в КП']);
            if (st.cheaper > 0) nums.push([this.fmtRub(st.cheaper), 'выгода клиенту']);
            else if (st.kp > 0) nums.push([String(st.kp), 'КП отправлено']);
            const gains = this.proGains(3);
            const last = info.stage === 'last';
            const label = last ? 'Последний день' : (info.days === 1 ? 'Остался 1 день' : 'Осталось 2 дня');
            const title = info.paid ? 'Продлите Профи' : 'Оставьте Профи';
            const sub = 'Действует до ' + info.when + '. Сметы и КП сохранятся в любом случае.';
            const perDay = month && month.rub > 0 ? Math.round(month.rub / 30) : 0;
            const priceLine = month && month.rub > 0
                ? (month.promo && month.baseRub > month.rub ? '<s style="opacity:.55;">' + this.esc(this.fmtRub(month.baseRub)) + '</s> ' : '')
                    + this.esc(this.fmtRub(month.rub)) + ' в месяц' + (perDay ? ' · около ' + this.esc(this.fmtRub(perDay)) + ' в день' : '')
                : '';
            const accent = 'var(--primary,#0A84FF)';
            const font = '-apple-system,BlinkMacSystemFont,SF Pro Text,Inter,Segoe UI,Roboto,sans-serif';
            const check = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style="flex:none;"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            const hair = 'border-top:1px solid var(--border,rgba(127,127,127,.2));';

            const wrap = document.createElement('div');
            wrap.id = 'pro_end_win';
            wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483300;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);padding:16px;';
            wrap.innerHTML = '<div role="dialog" aria-modal="true" aria-labelledby="pew_t" style="position:relative;max-width:360px;width:100%;background:var(--surface,#fff);color:var(--text-main,#1d1d1f);border-radius:22px;padding:28px 24px 14px;text-align:center;font-family:' + font + ';box-shadow:0 30px 80px rgba(0,0,0,.35);">'
                + '<div style="font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:' + (last ? '#FF9F0A' : 'var(--text-sec)') + ';">' + this.esc(label) + '</div>'
                + '<h3 id="pew_t" style="margin:6px 0 6px;font-size:26px;font-weight:700;letter-spacing:-.02em;line-height:1.15;">' + this.esc(title) + '</h3>'
                + '<p style="margin:0 auto;max-width:280px;font-size:14px;line-height:1.4;color:var(--text-sec);">' + this.esc(sub) + '</p>'
                + (nums.length ? '<div style="display:flex;margin:22px 0 0;padding:16px 0;' + hair + '">'
                    + nums.map((n, i) => '<div style="flex:1;min-width:0;' + (i ? 'border-left:1px solid var(--border,rgba(127,127,127,.2));' : '') + '">'
                        + '<div style="font-size:19px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;">' + this.esc(n[0]) + '</div>'
                        + '<div style="font-size:11.5px;color:var(--text-sec);margin-top:2px;">' + this.esc(n[1]) + '</div></div>').join('')
                    + '</div>' : '')
                + (gains.length ? '<div style="text-align:left;padding:14px 4px 0;' + hair + (nums.length ? '' : 'margin-top:20px;') + '">'
                    + gains.map(g => '<div style="display:flex;gap:10px;align-items:center;font-size:14.5px;line-height:1.3;padding:5px 0;"><span style="color:' + accent + ';display:flex;">' + check + '</span>' + this.esc(g.charAt(0).toUpperCase() + g.slice(1)) + '</div>').join('')
                    + '</div>' : '')
                + '<button type="button" data-a="' + (month ? 'month' : 'all') + '" style="width:100%;margin-top:20px;padding:14px;border:0;border-radius:14px;background:' + accent + ';color:#fff;font:600 16px ' + font + ';cursor:pointer;">'
                + this.esc(info.paid ? 'Продлить Профи' : 'Оставить Профи') + '</button>'
                + (priceLine ? '<div style="font-size:12.5px;color:var(--text-sec);margin-top:8px;">' + priceLine + '</div>' : '')
                + (one && one.rub > 0 ? '<button type="button" data-a="object" style="display:block;width:100%;margin-top:10px;padding:8px;border:0;background:transparent;color:' + accent + ';font:500 14px ' + font + ';cursor:pointer;">Только один объект — ' + this.esc(this.fmtRub(one.rub)) + '</button>' : '')
                + '<button type="button" data-a="later" style="display:block;width:100%;padding:8px;border:0;background:transparent;color:var(--text-sec);font:400 14px ' + font + ';cursor:pointer;">Не сейчас</button>'
                + '</div>';
            document.body.appendChild(wrap);
            const done = v => { document.removeEventListener('keydown', onKey); wrap.remove(); resolve(v); };
            const onKey = e => { if (e.key === 'Escape') done(null); };
            document.addEventListener('keydown', onKey);
            wrap.addEventListener('click', e => {
                if (e.target === wrap) return done(null);
                const b = e.target.closest('[data-a]');
                if (b) done(b.getAttribute('data-a') === 'later' ? null : b.getAttribute('data-a'));
            });
        });
    },

    // ── После сохранения сметы: выгода в рублях ──────────────────────────
    // Экономию «Бюджетнее» считает app.cheaperSavingForOffer тем же движком, что смету.
    // Своя пауза (раз в 2 дня, не больше 6 раз на устройстве) — общую паузу подсказок
    // не трогаем, чтобы не глушить подсказку после отправки КП.
    SAVE_LS: 'hc_save_value',
    saveValueAllowed: function () {
        try {
            if (!this.nudgeSettings().save || !this.nudgeEligible()) return false;
            const st = JSON.parse(localStorage.getItem(this.SAVE_LS) || '{}') || {};
            if ((st.n || 0) >= 6) return false;
            if (st.t && Date.now() - st.t < 2 * 86400000) return false;
            return true;
        } catch (e) { return false; }
    },

    afterSaveValue: async function (sv) {
        if (this._nudgeBusy || !this.saveValueAllowed()) return;
        if (document.querySelector('#custom_modal_overlay.active')) return;
        const acc = app.tariffAccount();
        const lines = [];
        const saveLine = app.saveLine(sv);
        if (saveLine) lines.push(saveLine);
        if (app.tariffCell(acc, 'pro', 'money') === 'on' && app.tariffAccess('money') !== 'on')
            lines.push('Ваша маржа на объекте: закупка по вашим скидкам поставщика, оплата бригады, накладные и что остаётся вам по каждому разделу — во вкладке «Деньги» в Профи.');
        if (!lines.length) return;
        try {
            const lim = this.limitSettings();
            if (this.limitApplies() && app.canUseWorks()) lines.push('Монтаж в КП клиенту: бесплатно — в ' + lim.perMonth + ' КП в месяц, с Профи — без ограничений.');
        } catch (e) { }
        try {
            const st = JSON.parse(localStorage.getItem(this.SAVE_LS) || '{}') || {};
            localStorage.setItem(this.SAVE_LS, JSON.stringify({ n: (st.n || 0) + 1, t: Date.now() }));
        } catch (e) { }
        const price = this.priceLine();
        this._nudgeBusy = true;
        try { app.logPaywall('seen', 'После сохранения: ' + (saveLine ? 'экономия' : 'маржа')); } catch (e) { }
        try {
            const yes = await app.confirmChoice(lines.join('\n\n') + (price ? '\n\n' + price : ''), 'Смета сохранена. Что даст Профи на этом объекте', 'Оформить Профи', 'Не сейчас');
            if (yes) app.showModal('pro', { why: saveLine ? 'Вы хотели показать клиенту вариант «Бюджетнее» — он входит в Профи' : 'Вы хотели посмотреть маржу по объекту — вкладка «Деньги» входит в Профи' });
        } finally { this._nudgeBusy = false; }
    },

    nudge: async function (reason, ctx) {
        ctx = ctx || {};
        if (document.querySelector('#custom_modal_overlay.active')) return;
        // Коротко: три главных отличия вместо полного списка — длинный абзац не читали
        const loss = this.trialEndLosses().slice(0, 3);
        const benefits = loss.length ? 'Без Профи: ' + loss.join(', ') + '.' : '';
        const price = this.priceLine().split('\n')[0];
        let title, lead, why;
        if (reason === 'kp') {
            title = 'КП ушло клиенту';
            lead = 'Отправлено КП: ' + (ctx.n || 1) + '. ';
            why = 'Вы отправили КП клиентам — на Профи они уходят с работами и скидками';
        } else {
            title = 'Профи закончился';
            lead = 'Сметы сохранились. ';
            why = 'Продлите Профи, чтобы вернуть его функции';
            // Действует акция на месяц (например «после пробного») — она главная мысль окна
            try {
                const m = this.resolve('month');
                if (m && m.promo && m.rub < m.baseRub) {
                    title = 'Первый месяц Профи — ' + this.fmtRub(m.rub);
                    lead = 'Вместо ' + this.fmtRub(m.baseRub) + (m.promo.to ? ', только до ' + this.fmtDate(m.promo.to) : '') + '. Сметы сохранились. ';
                    why = 'Акция «' + (m.promo.title || '') + '»: месяц Профи за ' + this.fmtRub(m.rub);
                }
            } catch (e) { }
        }
        this._nudgeBusy = true;
        this.nudgeTouch(reason);
        try {
            const yes = await app.confirmChoice(lead + benefits + (price ? '\n\n' + price : ''), title, 'Оформить Профи', 'Не сейчас');
            if (yes) app.showModal('pro', { why: why });
        } finally { this._nudgeBusy = false; }
    },

    viewNudges: function (canEdit) {
        const t = this.nudgeSettings(), dis = !canEdit, u = this.ui;
        const row = (title, hint, control) => `<div style="display:flex; align-items:center; justify-content:space-between; gap:16px; padding:12px 0; border-bottom:1px solid var(--border);">
                <div style="min-width:0;"><div style="font-size:13px; font-weight:600; color:var(--text-main);">${title}</div><div style="font-size:12px; color:var(--text-sec); margin-top:2px; line-height:1.45;">${hint}</div></div>
                <div style="flex:0 0 auto;">${control}</div></div>`;
        return `<p style="${u.hint}">Мягкие предложения Профи в момент пользы. Их видит только вошедший человек без Профи (не сотрудник ТЕРЕМ): окно с кнопками «Оформить Профи» и «Не сейчас», тариф сам не включается. В тексте — преимущества из вкладки «Преимущества Профи», цена года в пересчёте на месяц и действующая акция с датой окончания.</p>
            <div style="${u.card} max-width:760px;">
                ${row('Подсказки оплаты', 'Общий выключатель. Выключено — подсказки не показываются никому. Напоминание о конце Профи (у него свой выключатель ниже) и окно лимита КП это не затрагивает.',
                    this.toggleHtml(!!t.enabled, `Subscription.setNudgeField('enabled', ${!t.enabled})`, dis))}
                ${row('Не чаще, чем раз в … дней', 'Пауза между любыми двумя подсказками на одном устройстве. От 1 до 60.',
                    `<input type="number" min="1" max="60" value="${t.gapDays}" ${dis ? 'disabled' : ''} onchange="Subscription.setNudgeField('gapDays', this.value)" style="${u.input} width:80px;">`)}
                ${row('После отправки КП', 'Когда человек отправил КП клиенту (ссылкой, в PDF или Excel). Не больше трёх раз на человека.',
                    this.toggleHtml(!!t.kp, `Subscription.setNudgeField('kp', ${!t.kp})`, dis))}
                ${row('Начиная с какого по счёту КП', 'Первое КП подсказкой не омрачаем: по умолчанию с 2-го.',
                    `<input type="number" min="1" max="20" value="${t.kpFrom}" ${dis ? 'disabled' : ''} onchange="Subscription.setNudgeField('kpFrom', this.value)" style="${u.input} width:80px;">`)}
                ${row('Когда Профи закончился', 'При входе после окончания платного или пробного Профи. Не больше двух раз на человека.',
                    this.toggleHtml(!!t.expiry, `Subscription.setNudgeField('expiry', ${!t.expiry})`, dis))}
                ${row('После сохранения сметы: выгода в рублях', 'Когда человек без Профи сохранил смету: на сколько вариант «Бюджетнее» по этому объекту дешевле (считает сам калькулятор, ROMMER и аналоги) и что маржа объекта — во вкладке «Деньги». Если ещё можно предложить пробный Профи, цифра идёт в окно пробного периода. Не чаще раза в 2 дня, не больше 6 раз. Экономия пишется в «Готовность к оплате».',
                    this.toggleHtml(t.save !== false, `Subscription.setNudgeField('save', ${t.save === false})`, dis))}
                ${row('Конец Профи: за 2 дня и в последний день', 'Плашка под шапкой калькулятора с датой окончания и что пропадёт без Профи, плюс окно один раз за 2 дня и один раз в последний день. Пробному периоду — «оставить Профи», оплаченному — «продлить».',
                    this.toggleHtml(t.trialEnd !== false, `Subscription.setNudgeField('trialEnd', ${t.trialEnd === false})`, dis))}
                ${row('Подпись «Вы хотели…» в окне тарифа', 'Когда человек нажал на закрытую функцию (ROMMER, «Бюджетнее», деньги, ZONT), вверху окна — что именно он хотел сделать.',
                    this.toggleHtml(!!t.lock, `Subscription.setNudgeField('lock', ${!t.lock})`, dis))}
            </div>`;
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

    // ═══ «Я оплатил» → Профи на 24 часа ════════════════════════════════
    // pay_request_grace (миграция 20261105) пишет заявку и, если можно, включает Профи
    // на 24 часа. Гостю и при сбое функции — обычная заявка (logRequest). Возвращает
    // { granted, until, reason } или null.
    GRACE_LS: 'hc_pay_grace',
    requestWithGrace: async function (info) {
        try {
            const { data: sess } = await supabaseClient.auth.getSession();
            if (!sess || !sess.session) { await this.logRequest(info); return null; }
            const { data, error } = await supabaseClient.rpc('pay_request_grace', {
                p_email: String(info.email || ''), p_plan: info.plan || null,
                p_months: info.months ? Math.round(info.months) : null, p_rub: info.rub || null,
                p_promo: info.promo || null, p_region: this.userRegion() || null
            });
            if (error) throw error;
            if (!data || !data.ok) { await this.logRequest(info); return data || null; }
            // Владельцу в бот — заявка с кнопками «Оплачено / Отклонить» (pay-notify → tg-webhook).
            // Не ушло — notifyPayment пошлёт обычное уведомление, как раньше.
            if (data.id) {
                try {
                    // Через тот же прокси, что и остальная база (supabaseProxyFetch в app.js)
                    const resp = await supabaseProxyFetch(supabaseUrl + '/functions/v1/pay-notify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: 'Bearer ' + sess.session.access_token },
                        body: JSON.stringify({ id: data.id })
                    });
                    const nt = resp.ok ? await resp.json().catch(() => null) : null;
                    data.tgSent = !!(nt && nt.ok);
                } catch (e) { data.tgSent = false; }
            }
            if (data.granted && data.object) {
                // «Один расчёт»: кредит на объект уже лежит в pro_objects, срок аккаунта не трогали —
                // никаких «Профи заканчивается». Сверка с базой ловит только отказ.
                try { localStorage.setItem(this.GRACE_LS, JSON.stringify({ object: true, id: data.id, plan: info.plan || '', at: new Date(Date.now() - 60000).toISOString() })); } catch (e) { }
                try { app._proObjects = undefined; app._proObjectsBusy = false; await app.loadProObjects(); } catch (e) { }
                this.graceWatch();
                this.celebratePro({
                    emoji: '🏠', title: 'Профи на объект — ваш!',
                    sub: 'Откройте смету и нажмите «Открыть Профи для этого объекта». ' + app.objectDays() + ' дней на правки. Оплату проверим сами — делать ничего не нужно.',
                    cta: 'К смете'
                });
            } else if (data.granted && data.until) {
                try { localStorage.setItem(this.GRACE_LS, JSON.stringify({ until: data.until, plan: info.plan || '', at: new Date(Date.now() - 60000).toISOString() })); } catch (e) { }
                const st = app.state;
                st.demoUsed = true;
                if (st.tgUser) {
                    if (['admin', 'viewer', 'manager'].indexOf(st.tgUser.account_type) < 0) { st.tgUser.account_type = 'pro'; st.accountType = 'pro'; }
                    st.tgUser.demo_ends_at = data.until;
                }
                try { app.saveState(); app.syncUI(); } catch (e) { }
                this.syncTrialEndBanner();
                this.graceWatch();
            }
            return data;
        } catch (e) {
            console.warn('[подписка] Профи на 24 часа не включён, пишем обычную заявку:', e.message || e);
            await this.logRequest(info);
            return null;
        }
    },

    // ── Окно тарифа в одном стиле ─────────────────────────────────────────
    // Общий каркас окон «Профи включён», «Оплата подтверждена», «Оплату не нашли»: без эмодзи,
    // системный шрифт, тонкий значок в круге, одна главная кнопка (как endOfferModal).
    // o: { id, glyph: 'check' | 'alert', title, sub, items: [строки с галочкой], note: html,
    //      primary, secondary, secondaryHref, dismiss } → Promise: 'primary' | 'secondary' | null
    SHEET_FONT: '-apple-system,BlinkMacSystemFont,SF Pro Text,Inter,Segoe UI,Roboto,sans-serif',
    sheet: function (o) {
        return new Promise(resolve => {
            const old = document.getElementById(o.id); if (old) old.remove();
            const font = this.SHEET_FONT;
            const accent = 'var(--primary,#0A84FF)';
            const tint = o.glyph === 'alert' ? '#FF9F0A' : '#30D158';
            const glyph = o.glyph === 'alert'
                ? '<path d="M12 7v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.6" r="1.2" fill="currentColor"/>'
                : '<path class="sh-ck" d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
            const check = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style="flex:none;"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            if (!document.getElementById('pro_sheet_css')) {
                const st = document.createElement('style'); st.id = 'pro_sheet_css';
                st.textContent = '@keyframes proSheetIn{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}'
                    + '@keyframes proSheetCk{from{stroke-dashoffset:20}to{stroke-dashoffset:0}}'
                    + '.pro-sheet-card{animation:proSheetIn .28s cubic-bezier(.2,.8,.2,1) both}'
                    + '.pro-sheet-card .sh-ck{stroke-dasharray:20;animation:proSheetCk .45s .15s ease-out both}'
                    + '@media (prefers-reduced-motion: reduce){.pro-sheet-card,.pro-sheet-card .sh-ck{animation:none}}';
                document.head.appendChild(st);
            }
            const wrap = document.createElement('div');
            wrap.id = o.id;
            wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483300;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);padding:16px;';
            wrap.innerHTML = '<div class="pro-sheet-card" role="dialog" aria-modal="true" aria-labelledby="' + o.id + '_t" style="position:relative;max-width:360px;width:100%;background:var(--surface,#fff);color:var(--text-main,#1d1d1f);border-radius:22px;padding:28px 24px 14px;text-align:center;font-family:' + font + ';box-shadow:0 30px 80px rgba(0,0,0,.35);">'
                + '<div style="width:52px;height:52px;margin:0 auto;border-radius:50%;display:flex;align-items:center;justify-content:center;color:' + tint + ';border:1.5px solid ' + tint + ';">'
                + '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">' + glyph + '</svg></div>'
                + '<h3 id="' + o.id + '_t" style="margin:14px 0 6px;font-size:24px;font-weight:700;letter-spacing:-.02em;line-height:1.2;">' + this.esc(o.title) + '</h3>'
                + (o.sub ? '<p style="margin:0 auto;max-width:290px;font-size:14px;line-height:1.45;color:var(--text-sec);">' + this.esc(o.sub) + '</p>' : '')
                + (o.items && o.items.length ? '<div style="text-align:left;margin-top:18px;padding:12px 4px 0;border-top:1px solid var(--border,rgba(127,127,127,.2));">'
                    + o.items.map(g => '<div style="display:flex;gap:10px;align-items:center;font-size:14.5px;line-height:1.3;padding:5px 0;"><span style="color:' + accent + ';display:flex;">' + check + '</span>' + this.esc(g.charAt(0).toUpperCase() + g.slice(1)) + '</div>').join('')
                    + '</div>' : '')
                + (o.note ? '<div style="margin-top:14px;font-size:13px;line-height:1.45;color:var(--text-sec);">' + o.note + '</div>' : '')
                + '<button type="button" data-a="primary" style="width:100%;margin-top:20px;padding:14px;border:0;border-radius:14px;background:' + accent + ';color:#fff;font:600 16px ' + font + ';cursor:pointer;">' + this.esc(o.primary || 'Готово') + '</button>'
                + (o.secondary ? (o.secondaryHref
                    ? '<a data-a="secondary" href="' + o.secondaryHref + '" style="display:block;margin-top:10px;padding:8px;color:' + accent + ';font:500 14px ' + font + ';text-decoration:none;">' + this.esc(o.secondary) + '</a>'
                    : '<button type="button" data-a="secondary" style="display:block;width:100%;margin-top:10px;padding:8px;border:0;background:transparent;color:' + accent + ';font:500 14px ' + font + ';cursor:pointer;">' + this.esc(o.secondary) + '</button>') : '')
                + (o.dismiss ? '<button type="button" data-a="dismiss" style="display:block;width:100%;padding:8px;border:0;background:transparent;color:var(--text-sec);font:400 14px ' + font + ';cursor:pointer;">' + this.esc(o.dismiss) + '</button>' : '<div style="height:6px;"></div>')
                + '</div>';
            document.body.appendChild(wrap);
            const done = v => { document.removeEventListener('keydown', onKey); wrap.remove(); resolve(v); };
            const onKey = e => { if (e.key === 'Escape') done(null); };
            document.addEventListener('keydown', onKey);
            wrap.addEventListener('click', e => {
                if (e.target === wrap) return done(null);
                const b = e.target.closest('[data-a]');
                if (!b) return;
                const a = b.getAttribute('data-a');
                if (a === 'secondary' && o.secondaryHref) { setTimeout(() => done('secondary'), 0); return; }   // ссылке дать открыться
                done(a === 'dismiss' ? null : a);
            });
        });
    },

    // ── Профи включён / оплата подтверждена ──────────────────────────────
    // opts: { title, sub, chips: bool, cta, reload } — reload: перезагрузить страницу по кнопке,
    // чтобы функции Профи включились везде (как после пробного). opts.emoji больше не рисуется.
    celebratePro: function (opts) {
        opts = opts || {};
        return this.sheet({
            id: 'pro_win', glyph: 'check',
            title: String(opts.title || 'Профи включён').replace(/!+$/, ''),
            sub: opts.sub || '',
            items: opts.chips ? this.proGains(4) : [],
            primary: opts.cta || 'Начать работать'
        }).then(() => { if (opts.reload && typeof app.softReload === 'function') app.softReload(200); });
    },

    // Оплату не нашли: спокойное окно без вспышек и звука. Кнопки: оплатить снова или написать нам.
    alarmPro: function () {
        try { app.logPaywall('seen', 'Оплата: не нашли'); } catch (e) { }
        this.sheet({
            id: 'pro_alarm', glyph: 'alert',
            title: 'Оплата не найдена',
            sub: 'Профи пока выключен. Если вы уже заплатили — напишите нам, включим в тот же день.',
            note: 'MAX: <span style="color:var(--text-main);font-weight:600;">+7 982 610-95-48</span>',
            primary: 'Оплатить снова',
            secondary: 'Написать на почту',
            secondaryHref: 'mailto:kovdor24@yandex.ru?subject=' + encodeURIComponent('Оплата Профи'),
            dismiss: 'Закрыть'
        }).then(v => { if (v === 'primary') app.showModal('pro', { why: 'Оплата не найдена — можно оплатить ещё раз' }); });
    },

    // ── Пока идут 24 часа: сверка с базой ─────────────────────────────────
    // Решение владельца (кнопки в Telegram или вкладка «Оплата подписки») открытая
    // страница сама не видит. Сверяемся при возврате на вкладку и раз в 2 минуты:
    // отклонили — Профи выключаем сразу; подтвердили — праздник «Профи продлён».
    graceWatch: function () {
        if (this._graceTimer) return;
        const gr = this.graceInfo();
        if ((!gr || !gr.active) && !this.objectGraceInfo()) return;
        const onVis = () => { if (document.visibilityState === 'visible') this.graceCheck(); };
        this._graceVis = onVis;
        document.addEventListener('visibilitychange', onVis);
        this._graceTimer = setInterval(() => this.graceCheck(), 2 * 60 * 1000);
    },
    graceStop: function () {
        if (this._graceTimer) clearInterval(this._graceTimer);
        this._graceTimer = null;
        if (this._graceVis) document.removeEventListener('visibilitychange', this._graceVis);
        this._graceVis = null;
    },
    graceCheck: async function () {
        try {
            // «Один расчёт» с кредитом авансом: смотрим на сам кредит (заявки человеку не видны).
            // Пропал или закрыт — оплату отклонили; granted_by сменился — подтвердили.
            const og = this.objectGraceInfo();
            if (og) {
                const { data: po, error: poErr } = await supabaseClient.from('pro_objects').select('granted_by, calc_id, expires_at').eq('payment_id', og.id).limit(1);
                if (poErr || !Array.isArray(po)) return;
                const rec = po[0];
                const rejected = !rec || (rec.calc_id && rec.expires_at && new Date(rec.expires_at) <= new Date());
                if (rejected) {
                    localStorage.removeItem(this.GRACE_LS); this.graceStop();
                    try { app._proObjects = undefined; app._proObjectsBusy = false; await app.loadProObjects(); } catch (e) { }
                    this.alarmPro();
                } else if (rec.granted_by !== 'grace') {
                    localStorage.removeItem(this.GRACE_LS); this.graceStop();
                    try { app.showInfoToast('✓', 'Оплата подтверждена', 'Профи на объект — ваш. Спасибо!'); } catch (e) { }
                }
                return;
            }
            const gr = this.graceInfo();
            if (!gr) { this.graceStop(); return; }
            const tg = (app.state && app.state.tgUser) || {};
            const uid = (app._currentUserRow && app._currentUserRow.id) || tg.id;
            if (!uid) return;
            const { data: u, error } = await supabaseClient.from('users').select('account_type, demo_ends_at, pro_expires_at').eq('id', uid).maybeSingle();
            if (error || !u) return;
            const end = u.demo_ends_at ? new Date(u.demo_ends_at) : null;
            let g0 = {};
            try { g0 = JSON.parse(localStorage.getItem(this.GRACE_LS) || '{}') || {}; } catch (e) { g0 = {}; }
            // «Один расчёт» подтвердили: срок не меняется, появляется кредит в pro_objects
            if (g0.plan === 'object' && g0.at) {
                const { data: po } = await supabaseClient.from('pro_objects').select('id').eq('user_id', uid).gte('granted_at', g0.at).limit(1);
                if (Array.isArray(po) && po.length) {
                    localStorage.removeItem(this.GRACE_LS); this.graceStop(); this.syncTrialEndBanner();
                    try { app.loadProObjects(); } catch (e) { }
                    this.celebratePro({ emoji: '🏆', title: 'Оплата подтверждена!', sub: 'Профи для одного объекта начислен. Откройте смету и в окне Профи нажмите «Открыть Профи для этого объекта». Спасибо!', cta: 'Готово' });
                    return;
                }
            }
            if (!end || end.getTime() <= Date.now()) {
                // Отклонили (или вышли сутки): Профи выключаем сразу, а не при следующем входе
                localStorage.removeItem(this.GRACE_LS); this.graceStop();
                if (tg) { tg.demo_ends_at = u.demo_ends_at; tg.account_type = ['admin', 'viewer', 'manager'].indexOf(u.account_type) >= 0 ? u.account_type : 'base'; }
                if (['admin', 'viewer', 'manager'].indexOf(u.account_type) < 0) app.state.accountType = 'base';
                try { app.saveState(); app.syncUI(); app.render(); } catch (e) { }
                this.syncTrialEndBanner();
                this.alarmPro();
                return;
            }
            if (u.pro_expires_at && Math.abs(end - gr.until) > 5 * 60000) {
                // Подтвердили оплату — срок продлён
                localStorage.removeItem(this.GRACE_LS); this.graceStop();
                tg.demo_ends_at = u.demo_ends_at; tg.pro_expires_at = u.pro_expires_at;
                try { app.saveState(); app.syncUI(); } catch (e) { }
                this.syncTrialEndBanner();
                this.celebratePro({ emoji: '🏆', title: 'Оплата подтверждена!', sub: 'Профи продлён до ' + end.toLocaleDateString('ru-RU') + '. Спасибо, что с нами!', cta: 'Готово' });
            }
        } catch (e) { console.warn('[подписка] сверка 24 часов:', e); }
    },

    // «Один расчёт» оплачен через «Я оплатил», кредит выдан авансом, оплату ещё проверяем
    objectGraceInfo: function () {
        try {
            const g = JSON.parse(localStorage.getItem(this.GRACE_LS) || 'null');
            return g && g.object && g.id ? { id: g.id, at: g.at } : null;
        } catch (e) { return null; }
    },

    // Профи сейчас держится на 24 часах после «Я оплатил» (на этом устройстве)
    graceInfo: function () {
        try {
            const g = JSON.parse(localStorage.getItem(this.GRACE_LS) || 'null');
            if (!g || !g.until) return null;
            const tg = (app.state && app.state.tgUser) || {};
            const until = new Date(g.until);
            const demo = tg.demo_ends_at ? new Date(tg.demo_ends_at) : null;
            // Срок продлён дальше 24 часов (оплату подтвердили) — отметка больше не нужна
            if (demo && demo - until > 5 * 60000) { localStorage.removeItem(this.GRACE_LS); return null; }
            // Срок короче 24 часов — заявку отклонили: 24 часа больше не идут, но помним, что
            // это была оплата — afterProExpired покажет «Оплату не нашли», а не общее окно
            const rejected = !!(demo && until - demo > 5 * 60000);
            return { until: until, active: !rejected && until.getTime() > Date.now(), rejected: rejected };
        } catch (e) { return null; }
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
        if (['title', 'label', 'months', 'days', 'rub', 'url', 'enabled'].indexOf(field) < 0) return;
        if (field === 'months') value = Math.max(1, Math.round(this.num(value)) || 1);
        if (field === 'days') value = Math.min(366, Math.max(0, Math.round(this.num(value))));
        if (field === 'rub') value = Math.max(0, Math.round(this.num(value)));
        if (field === 'url') value = String(value || '').trim();
        if (field === 'enabled') value = !!value;
        this.apply(v => { v.plans = v.plans || {}; v.plans[id] = Object.assign({}, v.plans[id] || {}, { [field]: value }); return v; });
        if (field === 'enabled' || field === 'months' || field === 'days') this.render();
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
        if (['title', 'kind', 'value', 'regions', 'from', 'to', 'url', 'enabled', 'audience'].indexOf(field) < 0) return;
        if (field === 'audience' && ['all', 'after_trial'].indexOf(value) < 0) return;
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
    proUntilFor: function (u, months, row) {
        const now = new Date();
        let from = now;
        // Заявка включала Профи на 24 часа: продлеваем от срока, который был до них,
        // иначе к оплаченному сроку прибавились бы лишние сутки
        const curRaw = row && row.grace_until ? row.grace_prev_ends : (u && u.demo_ends_at);
        if (curRaw) {
            const cur = new Date(curRaw);
            if (cur > now && cur.getFullYear() < 2090) from = cur;
        }
        return this.addMonths(from, months);
    },

    // Тариф «Один расчёт» (days > 0): оплата даёт кредит на одну смету, а не срок Профи
    isObjectPlan: function (planId) {
        const p = planId && this.settings().plans[planId];
        return !!p && Math.round(this.num(p.days)) > 0;
    },

    // Начислить кредит «Один расчёт» (строка в pro_objects без calc_id); тратит его человек сам
    grantObjectCredit: async function (u, paymentId) {
        const me = (app._currentUserRow && app._currentUserRow.email) || null;
        const { error } = await supabaseClient.from('pro_objects').insert({ user_id: u.id, payment_id: paymentId || null, granted_by: me });
        if (error) throw error;
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
            if (extend && this.isObjectPlan(row.plan)) {
                // Кредит мог быть выдан авансом при «Я оплатил» — второй не начисляем
                const { data: had } = await supabaseClient.from('pro_objects').select('id').eq('payment_id', id).limit(1);
                if (Array.isArray(had) && had.length) {
                    const me0 = (app._currentUserRow && app._currentUserRow.email) || 'admin';
                    const { error: gErr } = await supabaseClient.from('pro_objects').update({ granted_by: me0 }).eq('payment_id', id);
                    if (gErr) throw gErr;
                } else await this.grantObjectCredit(u, id);
            }
            else if (extend) { until = this.proUntilFor(u, months, row); await this.activatePro(u, until); }
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
        const row = ((this._pay && this._pay.rows) || []).find(r => r.id === id);
        const graceOn = row && row.grace_until && new Date(row.grace_until) > new Date();
        if (!await app.confirm('Отметить заявку как неоплаченную (отклонить)?' + (graceOn ? ' Профи на 24 часа, включённый по этой заявке, будет снят сразу.' : '') + (row && row.grace_object ? ' Кредит «Один расчёт», выданный авансом, будет снят.' : ''))) return;
        try {
            // Снять 24 часа: вернуть прежний срок, если он ещё идёт, иначе закончить сейчас
            if (graceOn) {
                const u = (row.user_id && (this._pay.users || []).find(x => String(x.id) === String(row.user_id))) || this.userByEmail(row.email);
                if (u) {
                    const prev = row.grace_prev_ends ? new Date(row.grace_prev_ends) : null;
                    const end = prev && prev > new Date() ? prev : new Date();
                    const { error: uErr } = await supabaseClient.from('users').update({ demo_ends_at: end.toISOString() }).eq('id', u.id);
                    if (uErr) throw uErr;
                    u.demo_ends_at = end.toISOString();
                }
            }
            // «Один расчёт» авансом: свободный кредит убрать, уже открытую смету закрыть
            if (row && row.grace_object) {
                const { error: dErr } = await supabaseClient.from('pro_objects').delete().eq('payment_id', id).is('calc_id', null);
                if (dErr) throw dErr;
                const { error: xErr } = await supabaseClient.from('pro_objects').update({ expires_at: new Date().toISOString() }).eq('payment_id', id).not('calc_id', 'is', null);
                if (xErr) throw xErr;
            }
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
            if (extend && this.isObjectPlan(planId)) await this.grantObjectCredit(u, null);
            else if (extend) { until = this.proUntilFor(u, months); await this.activatePro(u, until); }
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
        { id: 'plans', label: 'Тарифы и QR' },
        { id: 'promos', label: 'Акции' },
        { id: 'regions', label: 'Регионы' },
        { id: 'payments', label: 'Заявки и оплаты' },
        { id: 'preview', label: 'Как выглядит' },
        { id: 'benefits', label: 'Преимущества Профи' },
        { id: 'trial', label: 'Пробный период' },
        { id: 'limit', label: 'Лимит КП' },
        { id: 'nudges', label: 'Подсказки оплаты' }
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
            return `<button type="button" class="admin-btn" onclick="Subscription.setView('${v.id}')" style="${act ? 'background:var(--primary); color:#fff; border-color:var(--primary);' : ''}">${v.label}${badge}</button>`;
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
        else if (this._view === 'nudges') body = this.viewNudges(canEdit);
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
                <b>Тарифы бывают двух типов</b> (тип выбирается в самой карточке):<br>
                · <b>Подписка</b> — оплата продлевает Профи на заданное число месяцев.<br>
                · <b>Один объект</b> — оплата даёт один расчёт: человек сам открывает Профи для одной сохранённой сметы, и в ней можно править заданное число дней
                (площадь не больше ±30 %, тот же город). Профи на весь аккаунт такая оплата не включает. Подтверждаете её так же, как подписку, во вкладке «Заявки и оплаты».<br>
                QR-код рисуется из ссылки сам: вставили новую ссылку — код обновился и в окне оплаты. Если в ссылке на перевод сумму вводит сам человек,
                напишите ему в подписи под QR, сколько переводить; если сумма зашита в ссылке — меняя цену, меняйте и ссылку.
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

    // Тип тарифа в карточке: подписка (months) или «Один объект» (days > 0)
    setPlanKind: function (id, kind) {
        if (kind === 'object') this.setPlanField(id, 'days', 30);
        else this.setPlanField(id, 'days', 0);
    },

    planCardHtml: function (p, canEdit) {
        const dis = canEdit ? '' : 'disabled';
        const isObj = Math.round(this.num(p.days)) > 0;
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
                    ${lbl('Тип тарифа')}
                    <select ${dis} onchange="Subscription.setPlanKind('${p.id}', this.value)" style="${this.ui.input} width:100%;">
                        <option value="sub" ${isObj ? '' : 'selected'}>Подписка: продлевает Профи на месяцы</option>
                        <option value="object" ${isObj ? 'selected' : ''}>Один объект: Профи для одной сметы</option>
                    </select>
                    <div style="display:flex; gap:10px;">
                        <div style="flex:1;">${isObj
                            ? lbl('Дней на правки') + inp('days', Math.round(this.num(p.days)) || 30, 'number', 'min="1" max="366" step="1"')
                            : lbl('Месяцев') + inp('months', p.months || 1, 'number', 'min="1" step="1"')}</div>
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

    // Цена, которую этот тариф показывает самому открывшему вкладку: в карточке стоит базовая цена («остальные регионы»),
    // а в окне тарифов, обучении и оплате человек видит региональную цену или акцию — иначе владелец из Московской области
    // видел 1 950 в карточке и 3 950 в окне и принимал это за расхождение.
    ownPriceHtml: function (p) {
        try {
            const r = this.resolve(p.id);
            if (!r || r.src === 'plan') return '';
            const why = r.src === 'promo' ? 'акция «' + this.esc(r.promo && r.promo.title || '') + '»' : 'региональная цена, регион «' + this.esc(r.region) + '»';
            return `<div style="color:var(--c-warn,#D97706); margin-top:4px;">Вам показывается ${this.fmtRub(r.rub)}: ${why}</div>`;
        } catch (e) { return ''; }
    },

    planMetaHtml: function (p) {
        const months = Math.max(1, Math.round(this.num(p.months)) || 1);
        const rub = this.num(p.rub);
        const days = Math.round(this.num(p.days));
        const own = this.ownPriceHtml(p);
        if (days > 0) return `${this.fmtRub(rub)} за один объект, ${days} дней на правки${own}${!p.url ? '<div style="color:var(--c-bad,#EF4444);">Без ссылки окно оплаты покажет только «Я оплатил»</div>' : ''}`;
        const per = months > 1 ? `${this.fmtRub(Math.round(rub / months))} в месяц` : '';
        const warn = !p.url ? '<div style="color:var(--c-bad,#EF4444);">Без ссылки окно оплаты покажет только «Я оплатил»</div>' : '';
        return `${this.fmtRub(rub)} за ${this.monthsWord(months)}${per ? '<br>' + per : ''}${own}${warn}`;
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
                <div style="grid-column:1 / -1;">${lbl('Кому')}<select ${dis} onchange="Subscription.setPromoField('${p.id}','audience',this.value)" style="${this.ui.input} width:100%;">
                    <option value="all" ${p.audience !== 'after_trial' ? 'selected' : ''}>Всем</option>
                    <option value="after_trial" ${p.audience === 'after_trial' ? 'selected' : ''}>Только после пробного: был пробный Профи и ещё ни одной оплаты (после первой оплаты акция для человека пропадает)</option></select></div>
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
        const graceChip = r => (r.status === 'requested' && r.grace_until) ? `<div style="font-size:11px; color:#059669; margin-top:3px;">${new Date(r.grace_until) > new Date() ? 'Профи на 24 ч до ' + this.fmtDateTime(r.grace_until) : 'Профи на 24 ч закончился ' + this.fmtDateTime(r.grace_until)}</div>` : '';
        const statusChip = r => (r.status === 'paid' ? this.chip('оплачено', '#10B981') : (r.status === 'rejected' ? this.chip('отклонено', '#64748B') : this.chip('ждёт', '#D97706'))) + graceChip(r);
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
