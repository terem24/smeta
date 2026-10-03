/**
 * warranty_admin.js — вкладка «Гарантия STOUT» в панели управления: порог доли
 * STOUT для бланка гарантии, порог по отдельному объекту, реестр объектов.
 *
 * Откуда данные. Доля STOUT считается в калькуляторе монтажника (app.stoutShare)
 * и при каждом сохранении сметы в облако уезжает снимком в calc_data.warranty
 * (app.warrantySnapshot → stateForCloud): проценты, суммы, адрес и заказчик.
 * Панель не пересчитывает смету — ей достаточно снимка. Сметы, сохранённые до
 * появления снимка, в реестр не попадают, пока монтажник не пересохранит их.
 *
 * Настройки — app_settings, ключ `warranty` (та же таблица и политика «пишет
 * только администратор», что у тарифов и подписки):
 *   { v: 1, threshold: 90, overrides: { '<calc_id>': 80, … } }
 * Порог по объекту сильнее общего. Оба читает app.warrantyThreshold() у
 * монтажника — так чип в смете и бланк на печати видят то же, что панель.
 *
 * Реестр — и есть «регистрация объекта у продавца», которой требует гарантия
 * STOUT (stout.ru/guarantee: продавец регистрирует талон). ТЕРЕМ — продавец,
 * поэтому список здесь не справка, а основание для бланка.
 */
const WarrantyAdmin = {
    KEY: 'warranty',
    DEFAULT_THRESHOLD: 90,
    LIMIT: 300,

    _rows: null,
    _loading: false,
    _loadError: null,
    _filter: 'passed',   // passed | near | all
    _q: '',
    _chain: null,
    _saving: false,
    _saveError: null,

    raw: function () { return (app.appSettings && app.appSettings[this.KEY]) || {}; },

    settings: function () {
        const r = this.raw();
        const t = parseFloat(r.threshold);
        return {
            threshold: (t > 0 && t <= 100) ? t : this.DEFAULT_THRESHOLD,
            overrides: (r.overrides && typeof r.overrides === 'object') ? r.overrides : {}
        };
    },

    // Порог для объекта: свой, если задан, иначе общий
    thresholdFor: function (calcId) {
        const s = this.settings();
        const o = parseFloat(s.overrides[String(calcId || '')]);
        return (o > 0 && o <= 100) ? o : s.threshold;
    },

    canEdit: function () { return typeof app !== 'undefined' && !app.isReadOnlyAdmin(); },

    // Как Subscription.save: перечитать строку, применить патч, записать; очередью,
    // чтобы быстрые правки подряд не затирали друг друга
    save: function (patch) {
        if (!this.canEdit()) { app.alert('Режим просмотра: порог гарантии менять нельзя.'); return Promise.resolve(); }
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
                console.error('[гарантия STOUT] запись не прошла:', e);
                this._saveError = e.message || String(e);
                await app.loadAppSettings(true);
                app.alert('Не удалось сохранить настройки гарантии: ' + this._saveError);
                this.render();
            } finally {
                this._saving = false; this.renderStatus();
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

    setThreshold: function (v) {
        const t = Math.round(parseFloat(v));
        if (!(t > 0 && t <= 100)) { app.alert('Порог — число от 1 до 100.'); this.render(); return; }
        this.apply(s => { s.threshold = t; return s; });
        this.render();
    },

    setOverride: function (calcId, v) {
        const id = String(calcId || '');
        if (!id) return;
        const t = Math.round(parseFloat(v));
        this.apply(s => {
            s.overrides = (s.overrides && typeof s.overrides === 'object') ? s.overrides : {};
            if (t > 0 && t <= 100) s.overrides[id] = t; else delete s.overrides[id];
            return s;
        });
        this.renderTable();
    },

    // ── данные ────────────────────────────────────────────────────────
    load: async function (force) {
        if (this._rows && !force) return this._rows;
        if (this._loading) return this._rows || [];
        this._loading = true; this._loadError = null;
        try {
            let q = supabaseClient.from('estimates')
                .select('id, project_name, created_at, user_id, share_id, eq_sum, total_sum, w:calc_data->warranty, calc_id:calc_data->>calc_id, users(username, phone, email)')
                .not('calc_data->warranty', 'is', null)
                .order('created_at', { ascending: false })
                .limit(this.LIMIT);
            if (typeof app.scopeQueryToManager === 'function') q = app.scopeQueryToManager(q, 'user_id');
            const { data, error } = await q;
            if (error) throw error;
            this._rows = (data || []).filter(r => r.w && typeof r.w === 'object');
        } catch (e) {
            console.error('[гарантия STOUT] реестр не загрузился:', e);
            this._loadError = e.message || String(e);
            this._rows = [];
        } finally {
            this._loading = false;
        }
        return this._rows;
    },

    // Строка реестра с посчитанными полями
    row: function (r) {
        const w = r.w || {};
        const pct = Number(w.pct);
        const thr = this.thresholdFor(r.calc_id);
        return {
            id: r.id,
            calcId: r.calc_id || '',
            date: r.created_at ? new Date(r.created_at) : null,
            address: String(w.address || '').trim() || String(r.project_name || '').trim() || '—',
            client: String(w.client || '').trim(),
            installer: (r.users && (r.users.username || r.users.email)) || '',
            phone: (r.users && r.users.phone) || '',
            pct: isFinite(pct) ? pct : null,
            pctAll: isFinite(Number(w.pctAll)) ? Number(w.pctAll) : null,
            eq: Number(r.eq_sum) || Number(w.total) || 0,
            thr: thr,
            own: !!this.settings().overrides[String(r.calc_id || '')],
            passed: isFinite(pct) && pct >= thr,
            near: isFinite(pct) && pct < thr && pct >= thr - 10,
            hasDetails: !!(w.address && w.client)
        };
    },

    rows: function () { return (this._rows || []).map(r => this.row(r)); },

    shown: function () {
        const q = this._q.trim().toLowerCase();
        return this.rows().filter(x => {
            if (this._filter === 'passed' && !x.passed) return false;
            if (this._filter === 'near' && !x.near) return false;
            if (!q) return true;
            return [x.address, x.client, x.installer, x.calcId].join(' ').toLowerCase().indexOf(q) >= 0;
        });
    },

    setFilter: function (f) { this._filter = f; this.renderTable(); },
    setQuery: function (q) { this._q = q || ''; this.renderTable(); },

    // ── отрисовка ─────────────────────────────────────────────────────
    esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); },
    rub: function (n) { return Math.round(n || 0).toLocaleString('ru-RU') + ' ₽'; },
    dateRu: function (d) { return d ? d.toLocaleDateString('ru-RU') : ''; },

    render: function () {
        const box = document.getElementById('admin_warranty_box');
        if (!box) return;
        const s = this.settings();
        const canEdit = this.canEdit();
        const e = this.esc;
        box.innerHTML = `
            <div style="display:flex; flex-wrap:wrap; gap:14px; align-items:flex-start; margin-bottom:14px;">
                <div style="flex:1 1 320px; border:1px solid var(--border); border-radius:12px; padding:14px 16px;">
                    <div style="font-size:14px; font-weight:700; margin-bottom:6px;">Порог доли STOUT</div>
                    <div style="font-size:12px; color:var(--text-sec); line-height:1.5; margin-bottom:10px;">
                        Бланк «Гарантия на объект STOUT» печатается последним листом КП, когда доля STOUT в смете
                        не ниже порога. Доля считается по сумме там, где STOUT мог стоять: газовый котёл, инсталляции,
                        защита от протечек и теплоноситель в расчёт не входят. По объекту порог можно задать свой — в таблице.
                    </div>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <input type="number" min="1" max="100" step="1" id="wa_threshold" value="${s.threshold}" ${canEdit ? '' : 'disabled'}
                            style="width:90px; padding:8px 10px; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--text-main); font-size:15px; font-weight:700;">
                        <span style="font-size:13px;">% по умолчанию для всех</span>
                        ${canEdit ? `<button type="button" class="admin-btn" onclick="WarrantyAdmin.setThreshold(document.getElementById('wa_threshold').value)">Сохранить</button>` : ''}
                        <span id="wa_status" style="font-size:12px; color:var(--text-sec);"></span>
                    </div>
                </div>
                <div id="wa_tiles" style="flex:1 1 320px; display:flex; flex-wrap:wrap; gap:10px;"></div>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:10px;">
                <span id="wa_chips"></span>
                <input type="search" placeholder="Адрес, заказчик, монтажник, № расчёта" value="${e(this._q)}" oninput="WarrantyAdmin.setQuery(this.value)"
                    style="flex:1 1 220px; min-width:180px; padding:7px 10px; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--text-main); font-size:13px;">
                <button type="button" class="admin-btn" onclick="WarrantyAdmin.reload()" title="Перечитать реестр из базы">Обновить</button>
            </div>
            <div id="wa_table"><div style="color:var(--text-sec); font-size:13px;">Загружаю реестр…</div></div>`;
        this.renderStatus();
        this.load().then(() => { this.renderTiles(); this.renderTable(); });
    },

    reload: function () {
        this._rows = null;
        const t = document.getElementById('wa_table');
        if (t) t.innerHTML = '<div style="color:var(--text-sec); font-size:13px;">Загружаю реестр…</div>';
        this.load(true).then(() => { this.renderTiles(); this.renderTable(); });
    },

    renderStatus: function () {
        const el = document.getElementById('wa_status');
        if (!el) return;
        el.textContent = this._saving ? 'сохраняю…' : (this._saveError ? 'ошибка записи' : '');
    },

    renderTiles: function () {
        const el = document.getElementById('wa_tiles');
        if (!el) return;
        const all = this.rows();
        const passed = all.filter(x => x.passed);
        const withPct = all.filter(x => x.pct !== null);
        const avg = withPct.length ? Math.round(withPct.reduce((a, x) => a + x.pct, 0) / withPct.length) : null;
        const eqPassed = passed.reduce((a, x) => a + x.eq, 0);
        const tile = (v, l) => `<div style="flex:1 1 120px; border:1px solid var(--border); border-radius:12px; padding:10px 12px;">
            <div style="font-size:20px; font-weight:800; line-height:1.1;">${v}</div><div style="font-size:11px; color:var(--text-sec); margin-top:3px;">${l}</div></div>`;
        el.innerHTML = tile(all.length, 'объектов со снимком доли')
            + tile(passed.length, 'прошли порог — бланк выдан')
            + tile(avg === null ? '—' : avg + ' %', 'средняя доля STOUT')
            + tile(this.rub(eqPassed), 'оборудование по прошедшим');
    },

    renderTable: function () {
        const chips = document.getElementById('wa_chips');
        const t = document.getElementById('wa_table');
        if (!t) return;
        const all = this.rows();
        const counts = { passed: all.filter(x => x.passed).length, near: all.filter(x => x.near).length, all: all.length };
        if (chips) {
            chips.innerHTML = [['passed', 'Прошли порог'], ['near', 'Близко к порогу'], ['all', 'Все']].map(([id, label]) =>
                `<button type="button" class="ad-chip${this._filter === id ? ' active' : ''}" onclick="WarrantyAdmin.setFilter('${id}')">${label} <span class="ad-chip-n">${counts[id]}</span></button>`
            ).join('');
        }
        if (this._loadError) {
            t.innerHTML = `<div style="color:#EF4444; font-size:13px;">Реестр не загрузился: ${this.esc(this._loadError)}</div>`;
            return;
        }
        const list = this.shown();
        if (!list.length) {
            t.innerHTML = `<div style="color:var(--text-sec); font-size:13px; padding:10px 0;">
                ${all.length ? 'По этому срезу объектов нет.' : 'Снимков доли пока нет: они появляются при сохранении сметы в облако после выхода этой версии калькулятора.'}
            </div>`;
            return;
        }
        const e = this.esc;
        const canEdit = this.canEdit();
        const th = 'text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.03em; color:var(--text-sec); padding:8px 8px; border-bottom:1px solid var(--border); white-space:nowrap;';
        const td = 'padding:8px 8px; border-bottom:1px solid var(--border); vertical-align:top; font-size:12.5px;';
        const pctCell = (x) => {
            if (x.pct === null) return '<span style="color:var(--text-sec);">—</span>';
            const color = x.passed ? '#16A34A' : (x.near ? '#D97706' : 'var(--text-sec)');
            const all = (x.pctAll !== null && x.pctAll !== x.pct) ? `<br><span style="font-size:10.5px; color:var(--text-sec);" title="По всей смете, включая то, чего STOUT не делает">по всей смете ${x.pctAll} %</span>` : '';
            return `<b style="color:${color}; font-size:14px;">${x.pct} %</b>${all}`;
        };
        const rows = list.map(x => `<tr>
            <td style="${td} white-space:nowrap;">${e(this.dateRu(x.date))}<br><span style="font-size:10.5px; color:var(--text-sec);">№ ${e(x.calcId || '—')}</span></td>
            <td style="${td}"><b>${e(x.address)}</b>${x.client ? '<br>' + e(x.client) : '<br><span style="font-size:10.5px; color:#D97706;">заказчик не указан</span>'}</td>
            <td style="${td}">${e(x.installer)}${x.phone ? '<br><span style="font-size:10.5px; color:var(--text-sec);">' + e(x.phone) + '</span>' : ''}</td>
            <td style="${td} text-align:right;">${pctCell(x)}</td>
            <td style="${td} text-align:right; white-space:nowrap;">${this.rub(x.eq)}</td>
            <td style="${td} white-space:nowrap;">
                <input type="number" min="1" max="100" step="1" value="${x.own ? x.thr : ''}" placeholder="${this.settings().threshold}" ${canEdit ? '' : 'disabled'}
                    title="Порог для этого объекта; пусто — общий"
                    onchange="WarrantyAdmin.setOverride('${e(x.calcId)}', this.value)"
                    style="width:62px; padding:5px 6px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text-main); font-size:12.5px; ${x.own ? 'font-weight:700;' : ''}"> %
            </td>
            <td style="${td} white-space:nowrap;">${x.passed
                ? (x.hasDetails ? '<span style="color:#16A34A; font-weight:700;">бланк</span>' : '<span style="color:#D97706;" title="Порог пройден, но адрес или заказчик не заполнены — бланк не печатается">нет адреса</span>')
                : '<span style="color:var(--text-sec);">—</span>'}</td>
            <td style="${td} white-space:nowrap; text-align:right;">
                <button type="button" class="lk-btn-sm" onclick="app.viewAdminEstimate('${e(x.id)}')" title="Открыть смету">Смета</button>
                <button type="button" class="lk-btn-sm" onclick="app.viewAdminEstimateInvoice('${e(x.id)}')" title="Как видит клиент">КП</button>
            </td>
        </tr>`).join('');
        t.innerHTML = `<div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; min-width:860px;">
            <thead><tr>
                <th style="${th}">Дата</th><th style="${th}">Объект · заказчик</th><th style="${th}">Монтажник</th>
                <th style="${th} text-align:right;">Доля STOUT</th><th style="${th} text-align:right;">Оборудование</th>
                <th style="${th}">Порог</th><th style="${th}">Бланк</th><th style="${th}"></th>
            </tr></thead><tbody>${rows}</tbody></table></div>
            ${all.length >= this.LIMIT ? `<div style="font-size:11.5px; color:var(--text-sec); margin-top:8px;">Показаны последние ${this.LIMIT} объектов.</div>` : ''}`;
    }
};
