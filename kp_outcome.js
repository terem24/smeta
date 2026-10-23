// ═══ Итог КП: «чем закончилось?» ═════════════════════════════════════════
//
// Сметы считаются и уходят клиентам, а дальше доска планировщика ничего о них не
// знает: до «В оплату» карточка доходит, только если счёт запросили внутри
// калькулятора. Купил клиент у другого продавца, ушёл к другому монтажнику или
// отказался — карточка навсегда остаётся «на согласовании».
//
// Поэтому у КП, ушедшего клиенту (события sent / printed), есть срок ответа —
// DAYS дней от последней отправки. Срок вышел — при входе всплывает окно со всеми
// такими КП сразу, у каждого три кнопки:
//   · «Клиент согласился» (won, meta.where — где покупает);
//   · «Отказ» (lost, meta.reason — причина из списка, у части причин комментарий
//     обязателен: это и есть обратная связь для доработки калькулятора);
//   · «Ещё думает — продлить» (extended) — не больше MAX_EXT раз за жизнь КП.
//
// На тарифе без Профи КП, просроченные дольше GRACE_DAYS после окна, блокируют
// отправку новых, когда их набирается GATE. Закрыть — десять секунд в том же окне.
// Баллов за ответы нет сознательно: награда за то, что нельзя проверить, накручивается
// пустыми сметами. Мотивация — снятие блока.
//
// Всё считается по журналу invoice_events: отдельной таблицы нет, история КП и
// доска планировщика читают те же строки.
const KpOutcome = {
    // Настройки задаёт админ («Оплата подписки» → «Лимит КП» → «Итог КП»),
    // без них (страница ещё не прочитала настройки) — эти значения
    FALLBACK: { outcomeOn: true, outcomeAudBase: true, outcomeAudPro: true, outcomeAudMgr: true, outcomeGate: true,
        outcomeDays: 30, outcomeDaysMin: 14, outcomeDaysMax: 60, outcomeExt: 2, outcomeGateN: 2, outcomeGrace: 3,
        outcomeAutoMonths: 12, excludeTerem: true },
    cfg: function () {
        try { if (typeof Subscription !== 'undefined' && Subscription.limitSettings) return Subscription.limitSettings(); } catch (e) { }
        return this.FALLBACK;
    },
    get DAYS() { return this.cfg().outcomeDays; },
    get MAX_EXT() { return this.cfg().outcomeExt; },
    get GATE() { return this.cfg().outcomeGateN; },
    get GRACE_DAYS() { return this.cfg().outcomeGrace; },
    // Старые КП, ушедшие задолго до появления окна, получают срок не раньше этого
    // дня: иначе в первый же вход у всех разом сработал бы блок
    START: '2026-10-23',

    SEND_EVENTS: ['sent', 'printed'],
    // Сделка состоялась: отметка монтажника или запрос/выставление/оплата счёта
    WON_EVENTS: ['won', 'invoice_requested', 'invoice_issued', 'paid'],
    // События, по которым ясно, что КП дошло до клиента, даже если отправку не записали
    PROOF_EVENTS: ['confirmed', 'needs_revision', 'refresh_requested', 'invoice_requested', 'invoice_issued', 'paid'],
    EVENTS: ['sent', 'printed', 'won', 'lost', 'extended', 'invoice_requested', 'invoice_issued', 'paid',
        'opened', 'confirmed', 'needs_revision', 'refresh_requested'],

    WHERE: [
        { key: 'terem', label: 'Счёт у моего поставщика' },
        { key: 'other_seller', label: 'Купили у другого продавца' },
        { key: 'self', label: 'Клиент купил сам, я монтирую' }
    ],
    // need — комментарий обязателен; ask — подсказка в поле
    REASONS: [
        { key: 'price_eq', label: 'Дорого: оборудование' },
        { key: 'price_work', label: 'Дорого: монтаж' },
        { key: 'other_installer', label: 'Выбрали другого монтажника' },
        { key: 'self_buy', label: 'Клиент купил оборудование сам' },
        { key: 'other_brand', label: 'Выбрали другой бренд', ask: 'Какой бренд?' },
        { key: 'postponed', label: 'Стройку отложили' },
        { key: 'calc_error', label: 'В смете ошибка, посчитано не то', need: true, ask: 'Что не так в смете?' },
        { key: 'other', label: 'Другое', need: true, ask: 'Почему отказались?' },
        // Служебная: ставит система, когда ответа не было слишком долго. В окне итога её нет
        { key: 'timeout', label: 'Нет ответа (авто)', sys: true }
    ],
    MIN_COMMENT: 10,

    DAY: 86400000,

    esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
    fmtDate: function (t) { return new Date(t).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }); },
    reasonLabel: function (key) { const r = this.REASONS.find(x => x.key === key); return r ? r.label : (key || ''); },
    whereLabel: function (key) { const r = this.WHERE.find(x => x.key === key); return r ? r.label : (key || ''); },

    /**
     * Состояние каждого КП по строкам журнала (любой порядок, любые смеси смет).
     * В расчёт идут только сметы, хоть раз ушедшие клиенту. Владелец КП — автор
     * первой отправки: «счёт выставлен» пишет менеджер под своим именем.
     */
    // Кто смотрит: менеджер/админ/наблюдатель, Профи или Базовый (бесплатный)
    audience: function () {
        if (typeof app === 'undefined') return 'base';
        if (app.getAdminRole() !== 'base') return 'manager';
        return app.isPro() ? 'pro' : 'base';
    },
    // Включено ли окно этому человеку: общий выключатель и галочка его аудитории
    enabledForMe: function () {
        const c = this.cfg();
        if (!c.outcomeOn) return false;
        const a = this.audience();
        return a === 'manager' ? c.outcomeAudMgr !== false : (a === 'pro' ? c.outcomeAudPro !== false : c.outcomeAudBase !== false);
    },
    // Личный срок монтажника («Настройки → КП и счета») внутри границ админа
    myDays: function () {
        const c = this.cfg();
        let v = NaN;
        try {
            if (typeof app !== 'undefined') {
                if (!app.installerSettings && app.loadInstallerSettingsLocal) app.loadInstallerSettingsLocal();
                v = Math.round(Number(app.installerSettings && app.installerSettings.kpOutcomeDays));
            }
        } catch (e) { }
        if (!isFinite(v) || v <= 0) return c.outcomeDays;
        return Math.min(c.outcomeDaysMax, Math.max(c.outcomeDaysMin, v));
    },

    build: function (rows, now, days) {
        now = now || Date.now();
        const D = days || this.DAYS;
        const start = new Date(this.START + 'T00:00:00').getTime();
        const by = {};
        (rows || []).forEach(r => {
            if (!r || !r.calc_id) return;
            (by[String(r.calc_id)] = by[String(r.calc_id)] || []).push(r);
        });
        const out = [];
        Object.keys(by).forEach(id => {
            const evs = by[id].slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            let sends = evs.filter(e => this.SEND_EVENTS.includes(e.event));
            if (!sends.length) {
                // Отправку не записали (ссылку отдали до журнала или мимо кнопки), но КП точно
                // дошло до клиента: он его одобрил, просил правки или по нему идёт счёт. Тогда
                // «отправкой» считаем первое такое событие или открытие ссылки до него.
                if (!evs.some(e => this.PROOF_EVENTS.includes(e.event))) return;
                sends = [evs.find(e => this.PROOF_EVENTS.includes(e.event) || e.event === 'opened')];
            }
            const first = sends[0], lastSend = sends[sends.length - 1];
            // Хозяин КП — автор первой отправки. Если «отправкой» стало событие клиента
            // (у него автора нет), берём автора из событий самого монтажника
            const owner = (first.user_id || first.user_email) ? first
                : (evs.find(e => (e.user_id || e.user_email) && ['saved', 'calculated', 'recognized', 'invoice_requested'].includes(e.event)) || first);
            const lastSentAt = new Date(lastSend.created_at).getTime();
            const ext = evs.filter(e => e.event === 'extended');
            const lastExtAt = ext.length ? new Date(ext[ext.length - 1].created_at).getTime() : 0;
            const won = evs.slice().reverse().find(e => this.WON_EVENTS.includes(e.event));
            // Отказ закрывает КП, пока клиенту не ушла новая версия: вернулся — снова в работе
            const lost = evs.slice().reverse().find(e => e.event === 'lost' && new Date(e.created_at).getTime() >= lastSentAt);
            // Без ответа слишком долго (по умолчанию 12 месяцев с последней отправки или
            // продления) — КП само становится «отклонено». В базе то же делает ежедневная
            // close_stale_kp_outcomes (пишет событие lost, reason timeout); здесь — чтобы
            // статус был верным и до её запуска. 0 месяцев — выключено.
            const autoM = this.cfg().outcomeAutoMonths;
            let autoLost = false;
            if (!won && !lost && autoM > 0) {
                const dd = new Date(Math.max(lastSentAt, lastExtAt));
                dd.setMonth(dd.getMonth() + autoM);
                autoLost = now >= dd.getTime();
            }
            const outcome = won ? 'won' : ((lost || autoLost) ? 'lost' : null);
            const due = Math.max(lastSentAt, lastExtAt, start - D * this.DAY) + D * this.DAY;
            const overdue = !outcome && now >= due;
            let kpV = 0;
            evs.forEach(e => { const v = e.meta && Number(e.meta.kp_version); if (v > kpV) kpV = v; });
            out.push({
                calcId: id,
                project: (lastSend.project_name || first.project_name || evs.map(e => e.project_name).filter(Boolean).pop() || ''),
                userId: owner.user_id || null,
                userEmail: String(owner.user_email || '').toLowerCase(),
                userName: owner.user_name || '',
                firstSentAt: new Date(first.created_at).getTime(),
                lastSentAt: lastSentAt,
                kpVersion: kpV,
                ext: ext.length,
                outcome: outcome,
                outcomeEvent: outcome === 'won' ? won : (outcome === 'lost' ? (lost || { event: 'lost', meta: { reason: 'timeout', auto: true, label: 'Нет ответа ' + autoM + ' мес. (авто)' } }) : null),
                auto: autoLost || !!(lost && lost.meta && lost.meta.auto),
                due: due,
                days: D,
                overdue: overdue,
                overdueDays: overdue ? Math.floor((now - due) / this.DAY) : 0,
                blocking: overdue && now >= due + this.GRACE_DAYS * this.DAY
            });
        });
        return out.sort((a, b) => a.due - b.due);
    },

    // ── Свои КП ────────────────────────────────────────────────────────────
    myId: function () {
        const tg = (typeof app !== 'undefined' && app.state && app.state.tgUser) || {};
        return tg.id ? String(tg.id) : '';
    },

    // Свои отправленные КП за год и вся их история. Два запроса: в истории есть
    // строки не от меня («счёт выставлен» пишет менеджер).
    // noSums — без сумм смет (для значка и подсветки они не нужны); reuse — взять
    // результат последнего чтения, если ему меньше 30 секунд (вход: значок и окно
    // читают одно и то же)
    loadMine: async function (noSums, reuse) {
        const me = this.myId();
        if (!me || typeof supabaseClient === 'undefined') return [];
        if (reuse && this._mine && this._mineFor === me && Date.now() - this._mineAt < 30000) {
            if (!noSums && !this._mineSums) { await this.attachSums(this._mine); this._mineSums = true; }
            return this._mine;
        }
        const since = new Date(Date.now() - 365 * this.DAY).toISOString();
        const { data: mine, error } = await supabaseClient.from('invoice_events').select('calc_id')
            .eq('user_id', me).in('event', this.SEND_EVENTS.concat(['invoice_requested'])).gte('created_at', since).limit(2000);
        if (error) throw error;
        const ids = [...new Set((mine || []).map(r => String(r.calc_id)).filter(Boolean))];
        if (!ids.length) return [];
        const rows = [];
        for (let i = 0; i < ids.length; i += 80) {
            const { data, error: e2 } = await supabaseClient.from('invoice_events')
                .select('calc_id, event, user_id, user_name, user_email, project_name, meta, created_at')
                .in('calc_id', ids.slice(i, i + 80)).in('event', this.EVENTS.concat(this.NEWS_EVENTS)).limit(5000);
            if (e2) throw e2;
            rows.push(...(data || []));
        }
        // КП, которые я отправлял, но первым их отправил кто-то другой (копия, общий
        // расчёт), — не мои: отвечать за них должен автор
        const list = this.build(rows, undefined, this.myDays()).filter(k => String(k.userId || '') === me);
        // Что нового по КП: последнее событие не от меня (клиент, менеджер)
        const news = this.newsMap(rows, me);
        list.forEach(k => { k.news = news[k.calcId] || null; });
        this._mine = list; this._mineAt = Date.now(); this._mineFor = me; this._mineSums = false;
        if (!noSums) { await this.attachSums(list); this._mineSums = true; }
        return list;
    },

    // Последнее «новое» событие по каждому КП: ответ клиента, счёт, оплата, отметка
    // менеджера. То, что сделал сам монтажник, новостью для него не считается.
    newsMap: function (rows, me) {
        const m = {};
        (rows || []).forEach(r => {
            if (!r || !r.calc_id || this.NEWS_EVENTS.indexOf(r.event) < 0) return;
            if (String(r.user_id || '') === me) return;
            const t = Date.parse(r.created_at);
            if (!(t > ((m[r.calc_id] || {}).at || 0))) return;
            m[r.calc_id] = { event: r.event, at: t };
        });
        return m;
    },

    // ── Значок на «Объектах» и подсветка в списке ─────────────────────────
    // Что требует внимания монтажника: КП, по которым вышел срок ответа и нет итога
    // («overdue»), и КП, по которым что-то изменилось с прошлого раза («news»: клиент
    // одобрил или просит правки, выставлен счёт, менеджер отметил итог). Число таких
    // КП — на значке иконки «Объекты», как непрочитанные на телефоне. «Новое» гасится,
    // когда человек увидел список; «нужен итог» — только когда итог отмечен.
    NEWS_EVENTS: ['confirmed', 'needs_revision', 'refresh_requested', 'invoice_issued', 'paid', 'rejected', 'won', 'lost'],

    seenKey: function () { return 'kp_seen_' + this.myId(); },
    seenLoad: function () {
        try { const v = JSON.parse(localStorage.getItem(this.seenKey()) || 'null'); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
    },
    seenSave: function (map) { try { localStorage.setItem(this.seenKey(), JSON.stringify(map)); } catch (e) { } },

    // Что с этим КП: 'overdue' | 'news' | null (по последнему подсчёту)
    attnOf: function (calcId) { return (this._attn && calcId && this._attn.by[String(calcId)]) || null; },

    /**
     * Пересчитать, что требует внимания, и перекрасить значок. true — набор изменился.
     * Первый запуск на устройстве «новым» уже случившееся не считает: иначе в первый
     * же вход значок показал бы всю историю.
     */
    refreshAttention: async function () {
        try {
            if (typeof app === 'undefined' || !this.myId()) return false;
            try { await app.loadAppSettings(); } catch (e) { }
            const list = await this.loadMine(true);
            const on = this.enabledForMe();
            let seen = this.seenLoad();
            const fresh = seen === null;
            if (fresh) seen = {};
            const by = {}, newsAt = {};
            list.forEach(k => {
                const nw = k.news;
                if (fresh && nw) seen[k.calcId] = nw.at;
                if (on && k.overdue) by[k.calcId] = 'overdue';
                else if (nw && nw.at > (seen[k.calcId] || 0)) { by[k.calcId] = 'news'; newsAt[k.calcId] = nw.at; }
            });
            if (fresh) this.seenSave(seen);
            const prev = this._attn ? JSON.stringify(this._attn.by) : null;
            this._attn = { by: by, newsAt: newsAt, count: Object.keys(by).length, at: Date.now() };
            this.paintBadge();
            return prev !== JSON.stringify(by);
        } catch (e) {
            console.warn('[итог КП] значок не посчитан:', e);
            return false;
        }
    },

    // «Новое» увидено: гасим его на значке и в следующих отрисовках списка
    markNewsSeen: function () {
        const a = this._attn;
        if (!a) return;
        const seen = this.seenLoad() || {};
        let ch = false;
        Object.keys(a.by).forEach(id => {
            if (a.by[id] === 'news' && a.newsAt[id]) { seen[id] = a.newsAt[id]; delete a.by[id]; ch = true; }
        });
        if (ch) { a.count = Object.keys(a.by).length; this.seenSave(seen); this.paintBadge(); }
    },

    // Значок-счётчик на иконке «Объекты»: в боковом меню и в списке разделов на телефоне
    paintBadge: function (tries) {
        this.injectCss();
        const n = this._attn ? this._attn.count : 0;
        const els = document.querySelectorAll('.lk-rail-item[data-rail="objects"], #profile_nav .lk-nav-item[data-tab="objects"]');
        // Меню кабинета строится при первом открытии — значок докрасится, когда оно появится
        if (!els.length && n && (tries || 0) < 6) { setTimeout(() => this.paintBadge((tries || 0) + 1), 2000); return; }
        els.forEach(el => {
            if (!el.dataset.kpoTitle) el.dataset.kpoTitle = el.title || '';
            let b = el.querySelector('.kpo-badge');
            if (!n) {
                if (b) b.remove();
                el.classList.remove('kpo-has-badge');
                el.title = el.dataset.kpoTitle;
                return;
            }
            if (!b) { b = document.createElement('span'); b.className = 'kpo-badge'; el.appendChild(b); }
            b.textContent = n > 9 ? '9+' : String(n);
            el.classList.add('kpo-has-badge');
            el.title = (el.dataset.kpoTitle ? el.dataset.kpoTitle + ' · ' : '') + 'Требуют внимания: ' + n + ' КП (итог или новый статус)';
        });
    },

    // Список «Объектов» нарисован: подсчёт мог устареть — обновляем и перерисовываем;
    // «новое» гасится через несколько секунд после показа, когда его успели увидеть
    afterListRender: function () {
        this.injectCss();
        clearTimeout(this._seenTimer);
        if (!this._attn || Date.now() - this._attn.at > 60000) {
            this.refreshAttention().then(changed => {
                if (changed && app._cloudEstimates && typeof app.renderCloudList === 'function') {
                    app.renderCloudList(app._cloudEstimates, app._cloudSharedStatuses || {}, app._cloudEventStatuses || {});
                }
            });
        }
        this._seenTimer = setTimeout(() => this.markNewsSeen(), 3500);
    },

    // «Отметить итог» из списка «Объектов»: после записи пересчитать значок и список
    markFromList: function (calcId) {
        return this.openForCalc(calcId, () => this.refreshAttention().then(() => { if (typeof app.loadFromCloudList === 'function') app.loadFromCloudList(); }), true);
    },

    // Сумма сметы — для узнавания объекта в окне. Не нашлась — окно и без неё понятно.
    attachSums: async function (list) {
        const ids = list.map(k => k.calcId);
        if (!ids.length) return;
        try {
            const { data } = await supabaseClient.from('estimates')
                .select('total_sum, created_at, calc_id:calc_data->>calc_id')
                .in('calc_data->>calc_id', ids).order('created_at', { ascending: false }).limit(500);
            const sum = {};
            (data || []).forEach(r => { if (r.calc_id && sum[r.calc_id] === undefined) sum[r.calc_id] = Number(r.total_sum) || 0; });
            list.forEach(k => { k.sum = sum[k.calcId] || 0; });
        } catch (e) { /* без сумм */ }
    },

    // Касается ли блок этого человека. Как лимит КП: только без Профи, не сотрудники
    gateApplies: function () {
        if (typeof app === 'undefined') return false;
        if (this.cfg().outcomeGate === false || !this.enabledForMe()) return false;
        if (app.getAdminRole() !== 'base') return false;
        if (app.isPro()) return false;
        const tg = app.state.tgUser || {};
        const acc = tg.account_type || app.state.accountType || 'base';
        if (acc !== 'free' && acc !== 'base') return false;
        if (typeof Subscription !== 'undefined' && Subscription.limitSettings().excludeTerem && app.isTeremStaff()) return false;
        return true;
    },

    /**
     * Перед отправкой КП (из app.sendLimitOk). true — можно продолжать. Набралось
     * GATE просроченных — показываем окно, и если после него их меньше, пускаем
     * дальше без второго нажатия. Сбой подсчёта не блокирует.
     */
    gateOk: async function () {
        try {
            if (!this.gateApplies()) return true;
            const list = await this.loadMine();
            const block = list.filter(k => k.blocking);
            if (block.length < this.GATE) return true;
            await this.openDialog(list.filter(k => k.overdue), { gate: true });
            const after = (await this.loadMine()).filter(k => k.blocking);
            return after.length < this.GATE;
        } catch (e) {
            console.warn('[итог КП] блок не проверен, пропускаем:', e);
            return true;
        }
    },

    // После входа. Не чаще раза в сутки на устройстве, если человек закрыл окно,
    // ничего не отметив; блок проверяется при отправке независимо от этого.
    afterLogin: function () {
        if (this._loginTimer) return;
        // Сначала значок на «Объектах», затем окно: оба читают одни и те же события
        this._loginTimer = setTimeout(() => { this._loginTimer = null; this.refreshAttention().then(() => this.check()); }, 5000);
    },

    check: async function (force) {
        try {
            if (typeof app === 'undefined' || !this.myId()) return;
            // Настройки админа (кому показывать, срок) — до проверки, а не после
            try { await app.loadAppSettings(); } catch (e) { }
            if (!this.enabledForMe()) return;
            const day = new Date().toISOString().slice(0, 10);
            let shown = '';
            try { shown = localStorage.getItem('kp_outcome_day') || ''; } catch (e) { }
            if (!force && shown === day) return;
            const list = (await this.loadMine(false, true)).filter(k => k.overdue);
            if (!list.length) return;
            // Не поверх другого окна и не посреди обучения: попробуем при следующем входе
            if (!force && (document.querySelector('.calc-dialog-overlay.active, #custom_modal_overlay.active') || document.body.classList.contains('tour-active'))) return;
            try { localStorage.setItem('kp_outcome_day', day); } catch (e) { }
            await this.openDialog(list, {});
        } catch (e) {
            console.warn('[итог КП] проверка не прошла:', e);
        }
    },

    // ── Запись итога ───────────────────────────────────────────────────────
    // staff — отметку ставит менеджер/админ за монтажника (из планировщика или
    // сводки менеджера): meta.by_staff, автором карточки он не становится.
    write: async function (k, event, meta, staff) {
        const tg = (app.state && app.state.tgUser) || {};
        const row = {
            calc_id: String(k.calcId),
            event: event,
            user_id: tg.id ? String(tg.id) : null,
            user_name: tg.first_name || tg.username || null,
            user_email: tg.email || null,
            project_name: k.project || null,
            meta: Object.assign({}, meta, staff ? { by_staff: true } : {}, k.kpVersion ? { kp_version: k.kpVersion } : {})
        };
        const { error } = await supabaseClient.from('invoice_events').insert([row]);
        if (error) throw error;
        if (staff && typeof app.logTeamActivity === 'function') {
            app.logTeamActivity('status_change', { target: k.calcId, meta: { status: event, project: k.project || null } });
        }
    },

    extend: async function (k, staff) {
        const d = k.days || this.DAYS;
        const until = Date.now() + d * this.DAY;
        await this.write(k, 'extended', { n: k.ext + 1, until: new Date(until).toISOString(), comment: 'Продлено на ' + d + ' дн., до ' + this.fmtDate(until) }, staff);
    },

    // ── Окно ───────────────────────────────────────────────────────────────
    /**
     * Список КП с кнопками итога. opts.gate — открыто блоком отправки (другой
     * заголовок), opts.staff — отмечает сотрудник за монтажника, opts.onDone —
     * вызвать после каждой записи. Возвращает промис, который разрешается при закрытии.
     */
    openDialog: function (list, opts) {
        opts = opts || {};
        this.injectCss();
        const items = list.slice();
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'calc-dialog-overlay kpo-overlay';
            const state = {}; // calcId → { mode: 'won'|'lost', pick, comment }

            // Коротко: почему окно, что даёт, что будет без отметки
            const lead = () => {
                if (opts.staff) return 'Монтажник увидит отметку в истории сметы.';
                if (opts.manual) return 'Клиент уже решил? Отметьте итог — он попадёт в «Мои показатели». Если ещё думает, просто закройте окно.';
                if (opts.gate) return `Новые КП не отправляются, пока у ${this.GATE} КП нет итога. Отметьте — и отправка откроется. Считать можно как обычно.`;
                const gateLine = this.gateApplies()
                    ? `<br><small>Без Профи: если итога нет у ${this.GATE} КП, новые не отправятся. Считать можно всегда.</small>`
                    : '';
                return `КП ушли клиентам больше ${(items[0] && items[0].days) || this.DAYS} дней назад. Отметьте итог — в «Моих показателях» будет видно, сколько КП стали сделками. Ошибка в смете — напишите, исправим.${gateLine}`;
            };

            const itemHtml = (k) => {
                const st = state[k.calcId] || {};
                const left = this.MAX_EXT - k.ext;
                const sum = k.sum ? ' · ' + Math.round(k.sum).toLocaleString('ru-RU') + ' ₽' : '';
                const who = opts.staff && k.userName ? `<div class="kpo-sub">${this.esc(k.userName)}</div>` : '';
                let body = '';
                if (st.mode === 'won') {
                    body = `<div class="kpo-q">Где покупают?</div>
                        <div class="kpo-chips">${this.WHERE.map(w => `<button type="button" class="kpo-chip${st.pick === w.key ? ' on' : ''}" data-act="pick" data-id="${k.calcId}" data-v="${w.key}">${this.esc(w.label)}</button>`).join('')}</div>
                        <textarea class="kpo-ta" data-id="${k.calcId}" rows="2" placeholder="Комментарий, если есть">${this.esc(st.comment || '')}</textarea>
                        <div class="kpo-row"><button type="button" class="kpo-btn" data-act="back" data-id="${k.calcId}">Назад</button><button type="button" class="kpo-btn kpo-ok" data-act="save" data-id="${k.calcId}">Сохранить</button></div>`;
                } else if (st.mode === 'lost') {
                    const r = this.REASONS.find(x => x.key === st.pick);
                    body = `<div class="kpo-q">Почему отказались?</div>
                        <div class="kpo-chips">${this.REASONS.filter(x => !x.sys).map(x => `<button type="button" class="kpo-chip${st.pick === x.key ? ' on' : ''}" data-act="pick" data-id="${k.calcId}" data-v="${x.key}">${this.esc(x.label)}</button>`).join('')}</div>
                        <textarea class="kpo-ta" data-id="${k.calcId}" rows="2" placeholder="${this.esc((r && r.ask) || 'Комментарий, если есть')}${r && r.need ? ' (обязательно)' : ''}">${this.esc(st.comment || '')}</textarea>
                        <div class="kpo-row"><button type="button" class="kpo-btn" data-act="back" data-id="${k.calcId}">Назад</button><button type="button" class="kpo-btn kpo-ok" data-act="save" data-id="${k.calcId}">Сохранить</button></div>`;
                } else {
                    body = `<div class="kpo-row">
                        <button type="button" class="kpo-btn kpo-won" data-act="won" data-id="${k.calcId}">✓ Клиент согласился</button>
                        <button type="button" class="kpo-btn kpo-lost" data-act="lost" data-id="${k.calcId}">✕ Отказ</button>
                        ${opts.manual && !k.overdue ? '' : left > 0
                            ? `<button type="button" class="kpo-btn" data-act="extend" data-id="${k.calcId}" title="Спросим снова через ${k.days || this.DAYS} дней. Продлений осталось: ${left}">⏳ Думает, +${k.days || this.DAYS} дн.</button>`
                            : `<span class="kpo-sub">Продлений больше нет</span>`}
                    </div>`;
                }
                return `<div class="kpo-item${k.blocking && !opts.staff ? ' kpo-block' : ''}" data-item="${k.calcId}">
                    <div class="kpo-name">${this.esc(k.project || 'Без названия')}</div>
                    ${who}
                    <div class="kpo-sub">КП № ${this.esc(k.calcId)}${k.kpVersion ? '-' + k.kpVersion : ''}${sum} · отправлено ${this.fmtDate(k.lastSentAt)}${k.ext ? ' · продлено ' + k.ext + ' р.' : ''}</div>
                    ${st.err ? `<div class="kpo-err">${this.esc(st.err)}</div>` : ''}
                    ${body}
                </div>`;
            };

            // На телефоне — по одному КП: отметил, и следующее встаёт на его место
            const one = window.matchMedia && window.matchMedia('(max-width: 480px)').matches;
            const render = () => {
                if (!items.length) return close(true);
                const shown = one ? items.slice(0, 1) : items;
                const pager = one && items.length > 1
                    ? `<div class="kpo-row kpo-pager"><span class="kpo-sub">Осталось ${items.length}</span><button type="button" class="kpo-btn" data-act="next">Следующее ›</button></div>`
                    : '';
                overlay.innerHTML = `<div class="calc-dialog-card kpo-card">
                    <h3 class="calc-dialog-title">${opts.gate || opts.manual ? 'Отметьте итог КП' : 'Чем закончились КП?'}</h3>
                    <p class="calc-dialog-message">${lead()}</p>
                    <div class="kpo-list">${shown.map(itemHtml).join('')}</div>${pager}
                    <div class="calc-dialog-buttons"><button type="button" class="calc-dialog-btn calc-dialog-btn-cancel" data-act="close">${opts.gate || opts.staff || opts.manual ? 'Закрыть' : 'Напомнить завтра'}</button></div>
                </div>`;
            };

            let closed = false;
            const close = (val) => {
                if (closed) return;
                closed = true;
                overlay.classList.remove('active');
                setTimeout(() => { overlay.remove(); resolve(val); }, 200);
            };

            overlay.addEventListener('input', (e) => {
                const id = e.target && e.target.getAttribute('data-id');
                if (id && e.target.classList.contains('kpo-ta')) (state[id] = state[id] || {}).comment = e.target.value;
            });
            overlay.addEventListener('click', async (e) => {
                if (e.target === overlay) return close(false);
                const btn = e.target.closest && e.target.closest('[data-act]');
                if (!btn || btn.disabled) return;
                const act = btn.getAttribute('data-act'), id = btn.getAttribute('data-id');
                if (act === 'close') return close(false);
                // «Следующее» — текущее КП уходит в конец очереди, без отметки
                if (act === 'next') { items.push(items.shift()); return render(); }
                const k = items.find(x => x.calcId === id);
                if (!k) return;
                const st = state[id] = state[id] || {};
                st.err = '';
                if (act === 'won' || act === 'lost') { st.mode = act; st.pick = null; return render(); }
                if (act === 'back') { st.mode = null; return render(); }
                if (act === 'pick') { st.pick = btn.getAttribute('data-v'); return render(); }
                try {
                    if (act === 'extend') {
                        btn.disabled = true;
                        await this.extend(k, !!opts.staff);
                    } else if (act === 'save') {
                        const comment = String(st.comment || '').trim();
                        if (!st.pick) { st.err = st.mode === 'won' ? 'Выберите, где покупают.' : 'Выберите причину.'; return render(); }
                        if (st.mode === 'lost') {
                            const r = this.REASONS.find(x => x.key === st.pick);
                            if (r && r.need && comment.length < this.MIN_COMMENT) { st.err = 'Напишите коротко, что не так.'; return render(); }
                        }
                        btn.disabled = true;
                        const meta = st.mode === 'won' ? { where: st.pick } : { reason: st.pick };
                        if (comment) meta.comment = comment;
                        // Подпись для истории сметы и карточки на доске
                        meta.label = st.mode === 'won' ? this.whereLabel(st.pick) : this.reasonLabel(st.pick);
                        await this.write(k, st.mode, meta, !!opts.staff);
                        if (st.mode === 'won' && st.pick === 'terem' && !opts.staff) {
                            setTimeout(() => app.alert('Отмечено. Счёт: «Мои объекты» → смета → «Получить счёт».'), 300);
                        }
                    } else return;
                    items.splice(items.indexOf(k), 1);
                    delete state[id];
                    // Отметили — значок на «Объектах» пересчитывается
                    if (!opts.staff) this.refreshAttention();
                    if (typeof opts.onDone === 'function') opts.onDone(k);
                    render();
                } catch (err) {
                    console.warn('[итог КП] запись не прошла:', err);
                    st.err = 'Не сохранилось, проверьте связь и нажмите ещё раз.';
                    render();
                }
            });

            render();
            document.body.appendChild(overlay);
            setTimeout(() => overlay.classList.add('active'), 10);
        });
    },

    // Отметка итога по одному КП: читаем историю этой сметы целиком. По умолчанию — за
    // монтажника из планировщика (staff); mine — монтажник отмечает своё КП из «Моих
    // объектов» («⋯» → «Отметить итог КП») и не ждёт срока в 30 дней
    openForCalc: async function (calcId, onDone, mine) {
        try {
            const { data, error } = await supabaseClient.from('invoice_events')
                .select('calc_id, event, user_id, user_name, user_email, project_name, meta, created_at')
                .eq('calc_id', String(calcId)).in('event', this.EVENTS);
            if (error) throw error;
            const k = this.build(data || [], undefined, mine ? this.myDays() : undefined)[0];
            if (!k) { app.alert('Это КП ещё не уходило клиенту — итог ставить не по чему.'); return; }
            if (k.outcome) {
                const ev = k.outcomeEvent || {};
                if (!await app.confirm('У КП уже есть итог: ' + (k.outcome === 'won' ? 'клиент согласился' : 'отказ') + (ev.meta && ev.meta.label ? ' (' + ev.meta.label + ')' : '') + '. Поставить другой?')) return;
                k.outcome = null;
            }
            await this.openDialog([k], mine ? { manual: true, onDone: onDone } : { staff: true, onDone: onDone });
        } catch (e) {
            console.warn('[итог КП] карточка:', e);
            app.alert('Не удалось прочитать историю КП: ' + (e.message || e));
        }
    },

    // ── Конверсия КП в сделку (дашборд владельца) ─────────────────────────
    /**
     * Чем кончились КП, отправленные клиентам за последние opts.days (90) дней.
     *
     * Четыре корзины: согласились (won), отказ (lost), без ответа (срок вышел, итога
     * нет) и «в срок» (срок ещё идёт — их в конверсию не берём, иначе свежие КП
     * занижали бы её). Конверсия = согласились / (согласились + отказ + без ответа).
     * «Согласились» включает КП, по которым запросили/выставили счёт или пришла оплата:
     * они закрываются сами.
     *
     * Считаются только КП, ушедшие с START: до запуска итоги не отмечали, и «без
     * ответа» у старых КП было бы не ответом клиента, а отсутствием кнопки.
     *
     * rows — события invoice_events (достаточно calc_id, event, created_at, user_email,
     * project_name). opts.userOf(email) → { dist, tariff, region } или null;
     * opts.keep(k, u) — фильтр (регион). Срок — по умолчанию из настроек, личный срок
     * монтажника с дашборда не виден.
     */
    stats: function (rows, opts) {
        opts = opts || {};
        const now = opts.now || Date.now();
        const since = Math.max(now - (opts.days || 90) * this.DAY, new Date(this.START + 'T00:00:00').getTime());
        const mk = () => ({ n: 0, won: 0, lost: 0, silent: 0, wait: 0 });
        const add = (b, k) => {
            b.n++;
            if (k.outcome === 'won') b.won++;
            else if (k.outcome === 'lost') b.lost++;
            else if (k.overdue) b.silent++;
            else b.wait++;
        };
        const out = { total: mk(), byDist: {}, byTariff: {}, since: since };
        this.build(rows, now).forEach(k => {
            if (k.firstSentAt < since) return;
            const u = (opts.userOf && opts.userOf(k.userEmail)) || null;
            if (opts.keep && !opts.keep(k, u)) return;
            add(out.total, k);
            const d = (u && u.dist) || '';
            const t = (u && u.tariff) || 'unknown';
            add(out.byDist[d] || (out.byDist[d] = mk()), k);
            add(out.byTariff[t] || (out.byTariff[t] = mk()), k);
        });
        return out;
    },
    // Конверсия и доля КП с итогом по корзине; null — считать не из чего
    conv: function (b) {
        const decided = b.won + b.lost + b.silent;
        return {
            rate: decided ? b.won / decided : null,
            marked: decided ? (b.won + b.lost) / decided : null,
            decided: decided
        };
    },

    // ── Виджет «Итоги» на дашборде владельца ──────────────────────────────
    PERIODS: [
        { key: '7', label: '7 дн.', days: 7 }, { key: '30', label: '30 дн.', days: 30 },
        { key: 'q', label: 'Квартал', days: 91 }, { key: 'y', label: 'Год', days: 365 }, { key: 'all', label: 'Все', days: 0 }
    ],

    /**
     * Данные для виджета: считаются один раз, дальше metric() режет их по периоду.
     * rows — события invoice_events; users — пользователи (id, email, created_at);
     * estimates — сметы (user_id). opts.userOf(email) → { region } для фильтра по региону,
     * opts.region — выбранный регион (иначе все).
     *
     * «Расчёт» — смета, которую сохранили или отправили клиенту: черновик, где нажали
     * только «посчитать», расчётом не считаем. «Счёт» — запрошен или выставлен.
     */
    prep: function (rows, users, estimates, opts) {
        opts = opts || {};
        const now = opts.now || Date.now();
        const region = opts.region || '';
        const regionOf = (email) => { const u = opts.userOf && opts.userOf(String(email || '').toLowerCase()); return u ? (u.region || '') : null; };
        const hasEst = {};
        (estimates || []).forEach(e => { if (e && e.user_id != null) hasEst[String(e.user_id)] = true; });
        const us = (users || []).filter(u => !region || (u.region || '') === region)
            .map(u => ({ t: Date.parse(u.created_at) || 0, ok: !!hasEst[String(u.id)] }));
        const by = {};
        (rows || []).forEach(r => {
            if (!r || !r.calc_id) return;
            const c = by[r.calc_id] || (by[r.calc_id] = { id: String(r.calc_id), email: '', real: 0, sent: 0, inv: 0, issued: 0 });
            const t = Date.parse(r.created_at);
            if (!t) return;
            if (r.user_email && !c.email) c.email = String(r.user_email).toLowerCase();
            const min = (f) => { c[f] = c[f] ? Math.min(c[f], t) : t; };
            if (['saved', 'sent', 'printed'].indexOf(r.event) >= 0) min('real');
            if (r.event === 'sent' || r.event === 'printed') min('sent');
            if (r.event === 'invoice_requested' || r.event === 'invoice_issued') min('inv');
            if (r.event === 'invoice_issued') min('issued');
        });
        const keepCard = (email) => !region || regionOf(email) === region;
        const cards = Object.keys(by).map(k => by[k]).filter(c => keepCard(c.email));
        const kps = this.build(rows, now).filter(k => keepCard(k.userEmail));
        return { now: now, users: us, cards: cards, kps: kps };
    },

    // Показатель по периоду: n — число, total — с чем сравниваем, ok — сколько успешных
    metric: function (P, kind, days) {
        const since = days ? P.now - days * this.DAY : 0;
        const pct = (a, b) => b ? a / b : null;
        if (kind === 'users') { const ok = P.users.filter(u => u.ok).length; return { n: P.users.length, total: P.users.length, ok: ok, pct: pct(ok, P.users.length) }; }
        if (kind === 'regs') { const s = P.users.filter(u => u.t >= since), ok = s.filter(u => u.ok).length; return { n: s.length, total: s.length, ok: ok, pct: pct(ok, s.length) }; }
        if (kind === 'calcs') { const s = P.cards.filter(c => c.real && c.real >= since), ok = s.filter(c => c.sent).length; return { n: s.length, total: s.length, ok: ok, pct: pct(ok, s.length) }; }
        if (kind === 'invoices') { const s = P.cards.filter(c => c.inv && c.inv >= since), ok = s.filter(c => c.issued).length; return { n: s.length, total: s.length, ok: ok, pct: pct(ok, s.length) }; }
        // deals: КП, отправленные в период, и чем они кончились
        const s = P.kps.filter(k => k.firstSentAt >= since);
        const b = { won: 0, lost: 0, auto: 0, silent: 0, wait: 0 };
        s.forEach(k => {
            if (k.outcome === 'won') b.won++;
            else if (k.outcome === 'lost') { b.lost++; if (k.auto) b.auto++; }
            else if (k.overdue) b.silent++;
            else b.wait++;
        });
        return { n: b.won, total: s.length, ok: b.won, pct: pct(b.won, s.length), b: b, list: s };
    },

    // Конечный статус КП: ключ, подпись и пояснение (причина, где покупают, срок)
    statusInfo: function (k, now) {
        now = now || Date.now();
        const m = (k.outcomeEvent && k.outcomeEvent.meta) || {};
        if (k.outcome === 'won') {
            const ev = k.outcomeEvent && k.outcomeEvent.event;
            const how = ev === 'won' ? (m.label || this.whereLabel(m.where) || '')
                : ({ invoice_requested: 'счёт запрошен', invoice_issued: 'счёт выставлен', paid: 'оплачено' }[ev] || '');
            return { key: 'won', label: 'Ушло в реализацию', detail: how, comment: m.comment || '' };
        }
        if (k.outcome === 'lost') {
            if (k.auto) return { key: 'auto', label: 'Отклонено (авто)', detail: m.label || 'нет ответа', comment: '' };
            return { key: 'lost', label: 'Отклонено', detail: m.label || this.reasonLabel(m.reason) || '', comment: m.comment || '' };
        }
        if (k.overdue) return { key: 'silent', label: 'Без ответа', detail: k.overdueDays ? 'срок вышел ' + k.overdueDays + ' дн. назад' : 'срок вышел', comment: '' };
        return { key: 'wait', label: 'Ждём ответа', detail: 'срок до ' + this.fmtDate(k.due), comment: '' };
    },

    // ── Сводка менеджера ──────────────────────────────────────────────────
    // rows — история смет его монтажников (fetchInvoiceHistoryByEmails), emails —
    // их почты. Возвращает разметку блока «КП без итога» и число для плитки.
    managerBlock: function (rows, emails) {
        const set = new Set((emails || []).map(e => String(e || '').toLowerCase()));
        const list = this.build(rows).filter(k => set.has(k.userEmail));
        const open = list.filter(k => k.overdue);
        const closed = list.filter(k => k.outcome);
        const won = closed.filter(k => k.outcome === 'won').length;
        this._mgrOpen = open;
        const rowsHtml = open.slice(0, 8).map(k => `
            <div class="lk-row lk-row-link" onclick="KpOutcome.managerMark('${this.esc(k.calcId)}')">
                <div class="lk-row-main"><b>${this.esc(k.project || 'Без названия')}</b><small>${this.esc(k.userName || k.userEmail)} · КП № ${this.esc(k.calcId)} · отправлено ${this.fmtDate(k.lastSentAt)}</small></div>
                <b class="lk-row-r" style="color:${k.overdueDays >= 14 ? '#EF4444' : '#F97316'};">${k.overdueDays ? k.overdueDays + ' дн.' : 'сегодня'}</b>
                <span class="lk-row-chev">›</span>
            </div>`).join('');
        const html = `<div class="lk-subhead">КП без итога</div>`
            + (open.length
                ? `<div class="lk-list">${rowsHtml}</div>`
                  + (open.length > 8 ? `<p class="lk-hint" style="margin-top:6px;">и ещё ${open.length - 8}</p>` : '')
                  + `<p class="lk-hint" style="margin-top:6px;">Больше ${this.DAYS} дней без итога. Позвоните монтажнику или нажмите на строку и отметьте сами.</p>`
                : `<p class="lk-hint">КП без итога нет.</p>`);
        return {
            html: html,
            open: open.length,
            closedShare: list.length ? Math.round(closed.length / list.length * 100) : 0,
            won: won,
            total: list.length
        };
    },

    managerMark: async function (calcId) {
        await this.openForCalc(calcId, () => {
            if (app._managedInstallersCache) app.renderManagerSummary(app._managedInstallersCache);
        });
    },

    // ── Отчёт по причинам отказа (планировщик) ───────────────────────────
    // events — все события доски. Свёрнутый блок над колонками, как «Облако не
    // ответило»: причины и комментарии с ошибками сметы — для доработки калькулятора.
    reasonsHtml: function (events) {
        const latest = {};
        (events || []).forEach(e => {
            if (e.event !== 'lost' && e.event !== 'won') return;
            const t = new Date(e.created_at).getTime();
            if (!latest[e.calc_id] || t > latest[e.calc_id].t) latest[e.calc_id] = { e: e, t: t };
        });
        const all = Object.values(latest).map(x => x.e);
        if (!all.length) return '';
        const lost = all.filter(e => e.event === 'lost');
        const won = all.length - lost.length;
        const cnt = {};
        lost.forEach(e => { const r = (e.meta && e.meta.reason) || 'other'; cnt[r] = (cnt[r] || 0) + 1; });
        const bars = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).map(r => {
            const pct = Math.round(cnt[r] / lost.length * 100);
            return `<div style="display:flex; align-items:center; gap:8px; margin:4px 0; font-size:12px;">
                <span style="flex:0 0 230px; color:var(--text-main);">${this.esc(this.reasonLabel(r))}</span>
                <span style="flex:1; height:8px; background:var(--surface); border-radius:4px; overflow:hidden;"><span style="display:block; height:100%; width:${pct}%; background:#EF4444;"></span></span>
                <b style="flex:0 0 60px; text-align:right; color:var(--text-main);">${cnt[r]} · ${pct}%</b></div>`;
        }).join('');
        const notes = lost.filter(e => e.meta && e.meta.comment).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 30).map(e => `
            <tr style="border-top:1px solid var(--border);">
                <td style="padding:6px 8px; white-space:nowrap; color:var(--text-sec);">${this.fmtDate(e.created_at)}</td>
                <td style="padding:6px 8px;">${this.esc(e.project_name || '—')}</td>
                <td style="padding:6px 8px; white-space:nowrap;">${this.esc(this.reasonLabel(e.meta.reason))}</td>
                <td style="padding:6px 8px;">${this.esc(e.meta.comment)}</td>
            </tr>`).join('');
        return `<details style="background:var(--surface-light); border:1px solid var(--border); border-left:3px solid #059669; border-radius:10px; margin-bottom:16px;">
            <summary style="padding:10px 14px; cursor:pointer; font-size:12.5px; color:var(--text-main);">
                🏁 <b>Итоги КП:</b> согласились ${won}, отказ ${lost.length}
                <span style="color:var(--text-sec);">— причины отказов и комментарии. Нажмите, чтобы раскрыть</span>
            </summary>
            <div style="padding:0 14px 12px; overflow-x:auto;">
                ${bars || '<div style="font-size:12px; color:var(--text-sec);">Отказов пока нет.</div>'}
                ${notes ? `<table style="width:100%; border-collapse:collapse; font-size:11.5px; margin-top:10px;">
                    <thead><tr style="color:var(--text-sec); text-align:left;"><th style="padding:6px 8px; font-weight:600;">Когда</th><th style="padding:6px 8px; font-weight:600;">Объект</th><th style="padding:6px 8px; font-weight:600;">Причина</th><th style="padding:6px 8px; font-weight:600;">Комментарий</th></tr></thead>
                    <tbody>${notes}</tbody></table>` : ''}
            </div>
        </details>`;
    },

    injectCss: function () {
        if (document.getElementById('kpo_css')) return;
        const st = document.createElement('style');
        st.id = 'kpo_css';
        st.textContent = `
/* Окно не выше экрана (и экрана с открытой клавиатурой — dvh): прокручивается
   только список КП, заголовок и «Напомнить завтра» всегда видны */
.kpo-card { max-width: 560px; text-align: left; max-height: calc(100vh - 32px); max-height: calc(100dvh - 32px); box-sizing: border-box; }
.kpo-list { display: flex; flex-direction: column; gap: 10px; flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; }
.kpo-list > .kpo-item { flex-shrink: 0; }
.kpo-item { border: 1px solid var(--border); border-radius: 12px; padding: 12px; background: var(--surface-light); }
.kpo-item.kpo-block { border-left: 3px solid #EF4444; }
.kpo-name { font-weight: 700; font-size: 14px; color: var(--text-main); }
.kpo-sub { font-size: 12px; color: var(--text-sec); margin-top: 2px; }
.kpo-q { font-size: 12.5px; font-weight: 600; color: var(--text-main); margin: 10px 0 6px; }
.kpo-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; align-items: center; }
.kpo-btn { font: inherit; font-size: 13px; font-weight: 600; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text-main); cursor: pointer; }
.kpo-btn:disabled { opacity: .5; cursor: default; }
.kpo-won { background: #059669; border-color: #059669; color: #fff; }
.kpo-lost { background: transparent; border-color: #EF4444; color: #EF4444; }
.kpo-ok { background: var(--primary); border-color: var(--primary); color: var(--on-primary, #fff); }
.kpo-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.kpo-chip { font: inherit; font-size: 12.5px; padding: 6px 10px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); color: var(--text-main); cursor: pointer; }
.kpo-chip.on { background: var(--primary); border-color: var(--primary); color: var(--on-primary, #fff); }
.kpo-ta { width: 100%; box-sizing: border-box; margin-top: 8px; font: inherit; font-size: 16px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg, var(--surface)); color: var(--text-main); resize: vertical; }
.kpo-err { font-size: 12px; color: #EF4444; margin-top: 6px; }
/* Значок «сколько КП требуют внимания» на иконке «Объекты» — как непрочитанные на телефоне */
.kpo-badge { box-sizing: border-box; min-width: 17px; height: 17px; padding: 0 5px; border-radius: 999px; background: #EF4444; color: #fff;
  font-size: 10px; font-weight: 800; line-height: 17px; text-align: center; box-shadow: 0 2px 5px rgba(239, 68, 68, .45); pointer-events: none; }
.lk-rail-item .kpo-badge { position: absolute; top: 2px; right: 8px; }
.lk-nav-item .kpo-badge { margin-left: auto; flex: 0 0 auto; }
.lk-rail-item.kpo-has-badge { animation: kpo-glow 2.4s ease-in-out infinite; }
@keyframes kpo-glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); } 50% { box-shadow: 0 0 0 3px rgba(239, 68, 68, .28); } }
@media (prefers-reduced-motion: reduce) { .lk-rail-item.kpo-has-badge { animation: none; box-shadow: 0 0 0 2px rgba(239, 68, 68, .3); } }
/* Подсветка строк списка смет: нужен итог (оранжевая) / появилось новое (синяя) */
tr.kpo-row-overdue > td:first-child { box-shadow: inset 4px 0 0 #F97316; }
tr.kpo-row-news > td:first-child { box-shadow: inset 4px 0 0 #3B82F6; }
tr.kpo-row-overdue, tr.kpo-row-news { background: rgba(249, 115, 22, .06); }
tr.kpo-row-news { background: rgba(59, 130, 246, .07); }
.kpo-chip-attn { display: inline-block; margin-left: 6px; padding: 2px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 800; color: #fff; vertical-align: middle; white-space: nowrap; }
.kpo-chip-attn.kpo-over { background: #F97316; }
.kpo-chip-attn.kpo-new { background: #3B82F6; }
.lk-btn-sm.kpo-btn-mark { background: #F97316; border-color: #F97316; color: #fff; font-weight: 700; }
@media (max-width: 480px) {
  .kpo-btn { flex: 1 1 100%; }
  .kpo-pager { justify-content: space-between; margin-top: 0; }
  .kpo-pager .kpo-btn { flex: 0 0 auto; }
  .kpo-won, .kpo-lost, .kpo-row .kpo-ok, .kpo-row [data-act="back"] { flex: 1 1 calc(50% - 4px); }
  .calc-dialog-card.kpo-card { padding: 16px; width: 100%; gap: 12px; }
}
`;
        document.head.appendChild(st);
    }
};
window.KpOutcome = KpOutcome;
