
// === ЗАЩИТА ДОМЕНА (DOMAIN LOCK) ===
(function () {
    var currentHost = window.location.hostname;
    // Разрешенные домены
    var allowedHosts = ['heatcalc.ru', 'www.heatcalc.ru', 'terem24.github.io', 'localhost', '127.0.0.1'];

    // Если текущего домена нет в списке разрешенных (включая запуск из папки через file://)
    if (allowedHosts.indexOf(currentHost) === -1) {
        document.body.innerHTML = '<div style="text-align:center; padding:100px; font-family:Arial, sans-serif; background:#f3f4f6; height:100vh;"><h2>⚠️ Доступ запрещен</h2><p>Этот калькулятор является интеллектуальной собственностью и работает только на официальном сайте.</p></div>';
        throw new Error("Domain Lock: Несанкционированный запуск на чужом сайте или локальном компьютере.");
    }
})();
// ===================================

const supabaseUrl = 'https://ahanbwugsmcyvrwbmtlx.supabase.co';
const supabaseKey = 'sb_publishable_gcMJ-PvJmKavObbnePFGZQ_O-pu5O2p';
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

window.onTelegramAuth = async function (user) {
    let loc = await app.getGeoLocation();
    let photoUrl = user.photo_url || '';
    let tgUsername = user.username ? '@' + user.username : '';
    let utm = localStorage.getItem('stout_utm') || '';

    app.state.tgUser = { ...user, avatar_url: photoUrl };
    app.saveState();
    try {
        let { data: uDataList } = await supabaseClient.from('users').select('id, account_type, demo_ends_at').eq('telegram_id', user.id).limit(1);
        let uData = uDataList ? uDataList[0] : null;

        let updatePayload = {
            last_visited: new Date().toISOString(),
            last_device: app.getDeviceName() + " (TG)",
            avatar_url: photoUrl,
            tg_username: tgUsername,
            location: loc
        };

        if (!uData) {
            let { data: newUList } = await supabaseClient.from('users').insert([{
                telegram_id: user.id,
                username: user.first_name || 'Монтажник',
                utm_source: utm,
                ...updatePayload
            }]).select('account_type');
            let newU = newUList ? newUList[0] : null;
            if (newU) app.state.accountType = newU.account_type;
        } else {
            let accType = uData.account_type;
            let demoEnds = uData.demo_ends_at;

            if (demoEnds) {
                app.state.demoUsed = true;
                if (accType === 'pro' && new Date() > new Date(demoEnds)) {
                    accType = 'base';
                    updatePayload.account_type = 'base';
                }
            }
            app.state.accountType = accType;
            await supabaseClient.from('users').update(updatePayload).eq('telegram_id', user.id);
        }
        app.saveState();
    } catch (error) { console.error(error); }
    app.syncUI();
};



const app = {
    state: { waterInput: false, convConnectionType: 'straight', detailedRooms: false, rooms: [], convectorType: 'scq', well: true, wellDepth: 40, wellDist: 10, wellAutoType: 'sirio', h1: 2.7, h2: 2.7, viewMode: 'equipment', showScheme: false, optItems: {}, darkMode: false, area: 150, floors: 1, region: 100, mat: 1.0, fuels: ['el'], systems: [], hotWater: false, recirc: false, res: 3, win: 4, tp1: 0, tp2: 0, showSku: false, coolant: 'water', groupItems: false, collapsedGroups: [], swaps: {}, showSwapFor: null, radType: 'space', headType: 'gas', connectionType: 'angled', boilerType: 'optibase', ufhZones: 1, ufhCtrl: 'mech', pumpType: 'default', boilerSeries: 'plus', hydroType: 'combo', pipeType: 'insulated', ufhBaseType: 'mat', radManifoldType: 'standard', water: false, waterZones: [], ufhAuto: false, projectName: "", brandMode: "stout", customWorks: {} },

    isAppReady: false,
    hasUnsavedChanges: false,
    lastSavedStateString: "",

    getStateSignature: function () {
        let s = { ...this.state };
        // Удаляем чисто визуальные параметры, чтобы они не вызывали кнопку "Сохранить"
        delete s.viewMode;
        delete s.darkMode;
        delete s.collapsedGroups;
        delete s.showSwapFor;
        delete s.tgUser;
        delete s.accountType;
        delete s.demoUsed;
        return JSON.stringify(s);
    },

    updateSaveBtnUI: function () {
        if (this.hasUnsavedChanges) {
            this.markAsUnsaved();
        } else {
            this.markAsSaved();
        }
    },

    getGeoLocation: async function () {
        try { let res = await fetch('https://ipapi.co/json/'); let data = await res.json(); if (data && data.city && data.country_name) return data.city + ', ' + data.country_name; } catch (e) { }
        return '';
    },
    // Плавная анимация бегущих цифр (эффект кассы)
    animateNumber: function (obj, start, end, duration) {
        if (!obj) return;
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            // Вычисляем прогресс от 0 до 1
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            // Супер-вязкое замедление к концу анимации (степень 8)
            const easeOut = 1 - Math.pow(1 - progress, 8);
            const currentVal = Math.floor(start + easeOut * (end - start));

            obj.innerText = currentVal.toLocaleString('ru-RU') + " ₽";

            if (progress < 1) {
                // Продолжаем анимацию
                obj.dataset.animId = window.requestAnimationFrame(step);
            } else {
                // Финализируем точным значением
                obj.innerText = end.toLocaleString('ru-RU') + " ₽";
            }
        };

        // Отменяем предыдущую анимацию, если цифра снова изменилась до завершения старой
        if (obj.dataset.animId) window.cancelAnimationFrame(obj.dataset.animId);
        obj.dataset.animId = window.requestAnimationFrame(step);
    },
    // === ЛОГИКА ОТСЛЕЖИВАНИЯ НЕ-СОХРАНЕНИЯ ===
    hasUnsavedChanges: false,

    // Включить красную подсветку
    markAsUnsaved: function () {
        this.hasUnsavedChanges = true;
        let btn = document.getElementById('btn_save_main');
        if (btn) {
            btn.classList.add('btn-unsaved');
            btn.setAttribute('title', 'Параметры изменены и не сохранены в облако!');
        }
    },

    // Выключить красную подсветку (после сохранения)
    markAsSaved: function () {
        this.hasUnsavedChanges = false;
        let btn = document.getElementById('btn_save_main');
        if (btn) {
            btn.classList.remove('btn-unsaved');
            btn.setAttribute('title', 'Сохранить текущую смету в облако');
        }
    },
    captureUTM: function () {
        try {
            let params = new URLSearchParams(window.location.search);
            let s = params.get('utm_source'), m = params.get('utm_medium'), c = params.get('utm_campaign');
            if (s || m || c) {
                let arr = [];
                if (s) arr.push(`src: ${s}`); if (m) arr.push(`med: ${m}`); if (c) arr.push(`cmp: ${c}`);
                localStorage.setItem('stout_utm', arr.join(' | '));
            }
        } catch (e) { }
    },
    setProjectName: function (val) {
        if (!this.checkAccess('base')) { this.syncUI(); return; }
        let clean = String(val).trim();
        // Защита от системных глюков и плейсхолдера
        if (clean === "Название объекта" || clean === "true" || clean === "false") {
            clean = "";
        }
        this.state.projectName = clean;
        this.saveState();
    },

    setBrand: function (val) {
        this.state.brandMode = val;
        this.saveState();
        this.render();
    },

    // Открыть ввод своего оборудования (аналог монтажных работ)
    addCustomEqPrompt: function () {
        let name = prompt("Введите наименование оборудования:");
        if (!name) return;
        let price = parseFloat(prompt("Введите цену за единицу, ₽:", "0")) || 0;
        let qty = parseInt(prompt("Введите количество, шт:", "1")) || 1;

        if (!this.state.userAddedEq) this.state.userAddedEq = [];
        this.state.userAddedEq.push({
            id: 'custom_' + Date.now(),
            name: name,
            price: price,
            q: qty,
            brand: " ", // Пробел обманывает дефолтную проверку, чтобы не писался STOUT
            desc: "Добавлено самостоятельно в ручном режиме" // Включает системный значок (i)
        });
        this.saveState();
        this.render();
    },

    // Удаление своего оборудования
    deleteEq: function (id) {
        if (!this.state.userAddedEq) return;
        this.state.userAddedEq = this.state.userAddedEq.filter(eq => eq.id !== id);
        this.saveState();
        this.render();
    },

    setH: function (floor, val) {
        let v = parseFloat(val);
        if (isNaN(v) || v < 2.7) v = 2.7;
        if (v > 5.0) v = 5.0;
        if (floor === 1) this.state.h1 = v; else this.state.h2 = v;
        this.saveState(); this.syncUI(); this.render();
    },

    toggleScheme: function (chk, event) {
        if (!this.checkAccess('pro', event)) {
            let el = document.getElementById('chk_scheme');
            if (el) el.checked = false;
            return;
        }
        this.state.showScheme = !!chk; // Принудительно делаем boolean
        this.saveState();
        this.render();
    },

    checkAccess: function (featureLvl, event) {
        let isGuest = !this.state.tgUser;
        let isPro = this.state.accountType === 'pro';

        if (featureLvl === 'base' && isGuest) {
            if (event) event.preventDefault();
            this.showModal('guest');
            return false;
        }
        if (featureLvl === 'pro' && !isPro) {
            if (event) event.preventDefault();
            this.showModal('pro');
            return false;
        }
        return true;
    },

    showModal: function (type) {
        let overlay = document.getElementById('custom_modal_overlay');
        let icon = document.getElementById('custom_modal_icon');
        let title = document.getElementById('custom_modal_title');
        let text = document.getElementById('custom_modal_text');
        let okBtn = document.getElementById('custom_modal_btn_ok');

        if (type === 'guest') {
            icon.innerHTML = "🔒";
            title.innerHTML = "Требуется авторизация";
            text.innerHTML = "Авторизуйтесь через Email, Google или Telegram, чтобы получить доступ к этой функции и сохранять сметы в облако.";
            let demoBtn = document.getElementById('custom_modal_btn_demo');
            if (demoBtn) demoBtn.style.display = 'none';
            if (okBtn) {
                okBtn.innerText = "Войти в аккаунт";
                okBtn.onclick = function () { app.closeModal(); app.showAuthModal(); };
            }
        } else if (type === 'pro') {
            icon.innerHTML = "⭐️";
            title.innerHTML = "Доступно в тарифе PRO";
            text.innerHTML = "Профессиональные функции: монтажные работы, водоснабжение и артикулы доступны только по подписке.";
            if (okBtn) {
                okBtn.innerText = "Понятно";
                okBtn.onclick = function () { app.closeModal(); };
            }

            let demoBtn = document.getElementById('custom_modal_btn_demo');
            if (demoBtn) {
                // Если демо еще не использовалось, показываем кнопку
                if (!this.state.demoUsed) {
                    demoBtn.style.display = 'block';
                    text.innerHTML += "<br><br><b>Активируйте бесплатный тестовый период на 7 дней прямо сейчас!</b>";
                } else {
                    demoBtn.style.display = 'none';
                }
            }
        }
        overlay.classList.add('active');
    },

    closeModal: function () {
        let overlay = document.getElementById('custom_modal_overlay');
        if (overlay) overlay.classList.remove('active');
    },

    activateDemo: async function () {
        const tgUser = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) ? window.Telegram.WebApp.initDataUnsafe.user : this.state.tgUser;
        if (!tgUser) {
            alert("Сначала авторизуйтесь!");
            return;
        }

        let btn = document.getElementById('custom_modal_btn_demo');
        if (btn) btn.innerText = "Активация...";

        try {
            // Дата окончания = текущее время + 3 суток
            let endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

            let query = supabaseClient.from('users').update({ account_type: 'pro', demo_ends_at: endDate });
            if (tgUser.isGoogle) query = query.eq('email', tgUser.email);
            else query = query.eq('telegram_id', tgUser.id);
            const { error } = await query;

            if (error) throw error;

            this.state.accountType = 'pro';
            this.state.demoUsed = true;
            this.saveState();
            this.syncUI();
            this.closeModal();

            alert("🎉 ДЕМО-доступ на 7 дней успешно активирован! Вам открыты все профессиональные функции.");
        } catch (e) {
            console.error("Ошибка активации:", e);
            alert("Ошибка активации. Попробуйте позже.");
            if (btn) btn.innerText = "🎁 Попробовать PRO (7 дней)";
        }
    },

    saveToCloud: async function () {
        let pName = this.state.projectName;
        if (!pName) {
            pName = prompt("Введите название объекта для сохранения в облаке:", "Новый объект");
            if (!pName) return;
            this.state.projectName = pName;
            this.saveState();
            this.render();
        }

        // ИСПРАВЛЕНИЕ 1: Считаем работы только если у пользователя тариф PRO
        let eq = app.lastEqSum || 0;
        let wk = (this.state.accountType === 'pro') ? (app.lastWorksSum || 0) : 0;
        const total = eq + wk;

        const tgUser = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) ? window.Telegram.WebApp.initDataUnsafe.user : this.state.tgUser;

        try {
            let dbUserId = null;
            if (tgUser && (tgUser.id || tgUser.email)) {
                let uQuery = supabaseClient.from('users').select('id');
                if (tgUser.isGoogle) uQuery = uQuery.eq('email', tgUser.email);
                else uQuery = uQuery.eq('telegram_id', tgUser.id);

                let { data: uData } = await uQuery.single();
                if (uData) {
                    dbUserId = uData.id;
                } else {
                    let insertObj = { username: tgUser.username || tgUser.first_name || 'Монтажник' };
                    if (tgUser.isGoogle) insertObj.email = tgUser.email;
                    else insertObj.telegram_id = tgUser.id;

                    let utm = localStorage.getItem('stout_utm');
                    if (utm) insertObj.utm_source = utm;
                    let geo = localStorage.getItem('stout_geo');
                    if (geo) insertObj.location = geo;
                    let avatar = localStorage.getItem('stout_avatar');
                    if (avatar) insertObj.avatar_url = avatar;

                    let { data, error } = await supabaseClient.from('users').insert([insertObj]).select();
                    if (data && data[0]) dbUserId = data[0].id;
                }
            }

            // ИСПРАВЛЕНИЕ 2: Явно отправляем eq_sum и works_sum в базу
            const insertData = {
                project_name: pName,
                calc_data: this.state,
                total_sum: total,
                eq_sum: eq,
                works_sum: wk
            };
            if (dbUserId) insertData.user_id = dbUserId;

            const { error } = await supabaseClient.from('estimates').insert([insertData]);
            if (error) throw error;

            this.lastSavedStateString = this.getStateSignature();
            this.markAsSaved();
            alert("✅ Смета успешно сохранена!");
        } catch (error) {
            console.error("Ошибка Supabase:", error);
            alert("❌ Ошибка при сохранении: " + error.message);
        }
    },

    loadFromCloudList: async function () {
        const tgUser = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) ? window.Telegram.WebApp.initDataUnsafe.user : this.state.tgUser;
        try {
            let query = supabaseClient.from('estimates').select('id, project_name, total_sum, created_at').order('created_at', { ascending: false }).limit(20);
            if (tgUser && (tgUser.id || tgUser.email)) {
                let uQuery = supabaseClient.from('users').select('id');
                if (tgUser.isGoogle) uQuery = uQuery.eq('email', tgUser.email);
                else uQuery = uQuery.eq('telegram_id', tgUser.id);
                let { data: uData } = await uQuery.single();
                if (uData) query = query.eq('user_id', uData.id);
                else { alert("У вас пока нет сохраненных смет."); return; }
            }
            const { data, error } = await query;
            if (error) throw error;
            if (!data || data.length === 0) { alert("В облаке пока нет сохраненных смет."); return; }
            let text = "Сохраненные сметы:\n\n";
            data.forEach((item, index) => {
                let date = new Date(item.created_at).toLocaleDateString();
                let sum = item.total_sum ? item.total_sum.toLocaleString() + " ₽" : "? ₽";
                text += `${index + 1}. [${date}] ${item.project_name} — ${sum}\n`;
            });
            text += "\nВведите НОМЕР сметы (или нажмите Отмена):";
            let choice = prompt(text);
            if (!choice) return;
            let idx = parseInt(choice) - 1;
            if (idx >= 0 && idx < data.length) this.loadSingleEstimate(data[idx].id);
            else alert("Неверный номер.");
        } catch (error) { alert("Ошибка загрузки: " + error.message); }
    },

    loadSingleEstimate: async function (id) {
        try {
            const { data, error } = await supabaseClient.from('estimates').select('calc_data').eq('id', id).single();
            if (error) throw error;
            let loadedState = data.calc_data;
            delete loadedState.tgUser; delete loadedState.accountType; delete loadedState.demoUsed; delete loadedState.darkMode;
            this.state = { ...this.state, ...loadedState };
            this.saveState(); this.syncUI(); this.render();

            this.lastSavedStateString = this.getStateSignature();
            this.hasUnsavedChanges = false;
            this.updateSaveBtnUI();
            alert("✅ Смета успешно загружена!");
        } catch (error) { alert("Ошибка загрузки сметы: " + error.message); }
    },

    loginGoogle: async function () {
        const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.origin + window.location.pathname }
        });
        if (error) alert("Ошибка при входе через Google");
    },

    logout: async function () {
        await supabaseClient.auth.signOut();
        delete this.state.tgUser; this.state.accountType = 'base';
        this.saveState(); this.syncUI(); this.render();
    },

    showAuthModal: function () {
        document.getElementById('auth_modal_overlay').style.display = 'flex';
        let tgWrapper = document.getElementById('auth_modal_tg_wrapper');
        if (tgWrapper && tgWrapper.children.length === 0) {
            let script = document.createElement('script');
            script.async = true;
            script.src = "https://telegram.org/js/telegram-widget.js?22";
            script.setAttribute("data-telegram-login", "stout_calc_bot");
            script.setAttribute("data-size", "large");
            script.setAttribute("data-onauth", "onTelegramAuth(user)");
            script.setAttribute("data-request-access", "write");
            tgWrapper.appendChild(script);
        }
    },
    closeAuthModal: function () { document.getElementById('auth_modal_overlay').style.display = 'none'; },

    showProfileModal: function () {
        let tgUser = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) ? window.Telegram.WebApp.initDataUnsafe.user : this.state.tgUser;
        if (!tgUser) return;
        document.getElementById('profile_name_input').value = tgUser.first_name || tgUser.username || '';
        document.getElementById('profile_phone_input').value = tgUser.phone || '';
        document.getElementById('profile_modal_overlay').style.display = 'flex';
    },
    closeProfileModal: function () { document.getElementById('profile_modal_overlay').style.display = 'none'; },

    showAdminModal: function () {
        document.getElementById('admin_modal_overlay').style.display = 'flex';
        this.loadAdminData();
    },
    closeAdminModal: function () { document.getElementById('admin_modal_overlay').style.display = 'none'; },

    loadAdminData: async function () {
        document.getElementById('admin_content').innerHTML = '<div style="text-align: center; color: var(--text-sec); padding: 50px;">Загрузка данных...</div>';
        try {
            let { data: users, error: errU } = await supabaseClient.from('users').select('*').order('created_at', { ascending: false });
            let { data: estimates, error: errE } = await supabaseClient.from('estimates').select('*, users(username, phone)').order('created_at', { ascending: false });
            if (errU || errE) throw new Error("Ошибка загрузки");
            this.adminData = { users: users || [], estimates: estimates || [] };
            this.renderAdminMain();
        } catch (error) { document.getElementById('admin_content').innerHTML = `Ошибка: ${error.message}`; }
    },

    renderAdminMain: function () {
        let users = this.adminData.users;
        let estimates = this.adminData.estimates;
        let totalEq = 0, totalWorks = 0;
        estimates.forEach(e => { totalEq += e.eq_sum || 0; totalWorks += e.works_sum || 0; });

        users.forEach(u => {
            let uEsts = estimates.filter(e => String(e.user_id) === String(u.id));
            u.projectsCount = uEsts.length;
            u.ltv = 0;
            let totalArea = 0;
            uEsts.forEach(e => {
                u.ltv += (e.total_sum || 0);
                if (e.calc_data && e.calc_data.area) totalArea += parseFloat(e.calc_data.area);
            });
            u.avgArea = u.projectsCount > 0 ? Math.round(totalArea / u.projectsCount) : 0;
        });

        let h = `
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                        <div class="control-card" style="background: rgba(37, 99, 235, 0.1); border-color: var(--primary); padding: 15px;"><span class="lbl" style="color: var(--text-sec);">Пользователей</span><span style="font-size: 24px; font-weight: 800; color: var(--primary);">${users.length}</span></div>
                        <div class="control-card" style="background: rgba(16, 185, 129, 0.1); border-color: #10B981; padding: 15px;"><span class="lbl" style="color: var(--text-sec);">Смет сохранено</span><span style="font-size: 24px; font-weight: 800; color: #10B981;">${estimates.length}</span></div>
                        <div class="control-card" style="background: rgba(99, 102, 241, 0.1); border-color: #6366F1; padding: 15px;"><span class="lbl" style="color: var(--text-sec);">Оборудование (Сумма)</span><span style="font-size: 20px; font-weight: 800; color: #6366F1;">${totalEq.toLocaleString()} ₽</span></div>
                        <div class="control-card" style="background: rgba(249, 115, 22, 0.1); border-color: #F97316; padding: 15px;"><span class="lbl" style="color: var(--text-sec);">Работы (Сумма)</span><span style="font-size: 20px; font-weight: 800; color: #F97316;">${totalWorks.toLocaleString()} ₽</span></div>
                    </div>
                    
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
                        <h4 style="margin: 0;">👥 Монтажники</h4>
                        <div style="display: flex; gap: 10px; width: 100%; max-width: 480px;">
                            <input type="text" id="admin_search_input" placeholder="🔍 Поиск по имени..." style="flex: 1; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text-main); font-size: 12px; outline: none;" onkeyup="app.filterAdminData(this.value)">
                            <button class="btn-header-blue" style="background: #10B981; color: white; border-color: #10B981; font-weight: bold; padding: 0 15px; height: 34px;" onclick="app.exportAdminToExcel()">📊 Excel</button>
                        </div>
                    </div>

                    <table class="inv-table" style="margin-bottom: 30px;">
                        <thead><tr><th style="width:30px;">#</th><th>Имя / Контакты</th><th>Статистика (LTV)</th><th>Тариф / Устройство</th><th style="text-align:right;">Вход</th></tr></thead>
                        <tbody>
                `;
        users.forEach((u, i) => {
            let date = new Date(u.created_at).toLocaleDateString();
            let badge = u.account_type === 'pro' ? '<span style="color:#D97706; font-weight:bold;">PRO</span>' : 'Базовый';
            let name = u.username || u.email || 'Без имени';
            let phone = u.phone || 'Нет телефона';
            let device = u.last_device || 'Неизвестно';
            let lastVis = u.last_visited ? new Date(u.last_visited).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : date;
            let avatarImg = u.avatar_url ? `<img src="${u.avatar_url}" style="width:32px; height:32px; border-radius:50%; vertical-align:middle; margin-right:10px; object-fit:cover; border:1px solid #E5E7EB;">` : `<span style="font-size:24px; vertical-align:middle; margin-right:10px;">👤</span>`;
            let tgLink = u.tg_username ? `<a href="https://t.me/${u.tg_username.replace('@', '')}" target="_blank" style="color:var(--primary); text-decoration:none; margin-left:5px;" onclick="event.stopPropagation()"><b>${u.tg_username}</b></a>` : '';
            let locHTML = u.location ? `<div style="font-size:10px;color:var(--text-sec); margin-top:2px;">📍 ${u.location}</div>` : '';
            let searchStr = `${name} ${phone} ${u.email || ''} ${u.tg_username || ''} ${u.location || ''}`.toLowerCase();

            h += `<tr class="active-row admin-list-row" data-search="${searchStr}" style="cursor: pointer; transition: 0.2s;" onclick="app.viewAdminUser('${u.id}')" onmouseover="this.style.background='var(--primary-light)'" onmouseout="this.style.background='transparent'">
                        <td style="color:var(--text-sec);">${i + 1}</td>
                        <td><div style="display:flex; align-items:center;">${avatarImg} <div><b style="font-size:13px;">${name}</b><br><span style="font-size:11px;color:var(--text-sec);">${phone}</span>${tgLink}${locHTML}</div></div></td>
                        <td><b style="color:var(--primary);">${u.ltv.toLocaleString()} ₽</b><br><span style="font-size:10px;color:var(--text-sec);">Смет: ${u.projectsCount} | Ср.объект: ${u.avgArea} м²</span></td>
                        <td>${badge}<br><span style="font-size:10px;color:var(--text-sec);">${device}</span></td>
                        <td style="text-align:right;">${lastVis}</td>
                    </tr>`;
        });

        h += `</tbody></table><h4 style="margin: 0 0 10px 0;">📋 Последние сметы</h4><table class="inv-table"><thead><tr><th style="width:30px;">#</th><th>Объект</th><th>Монтажник</th><th>Сумма</th><th style="text-align:right;">Дата</th></tr></thead><tbody>`;

        estimates.slice(0, 50).forEach((e, i) => {
            let date = new Date(e.created_at).toLocaleDateString();
            let sum = e.total_sum ? e.total_sum.toLocaleString() + ' ₽' : '0 ₽';
            let author = e.users ? (e.users.username || 'Без имени') : 'Неизвестен';
            let estSearchStr = `${e.project_name} ${author} ${sum}`.toLowerCase();

            h += `<tr class="active-row admin-list-row" data-search="${estSearchStr}" style="cursor: pointer; transition: 0.2s;" onclick="app.viewAdminEstimate('${e.id}')" onmouseover="this.style.background='var(--primary-light)'" onmouseout="this.style.background='transparent'">
                        <td style="color:var(--text-sec);">${i + 1}</td>
                        <td><b>${e.project_name}</b></td>
                        <td>${author}</td>
                        <td style="font-weight:bold; color:var(--primary);">${sum}</td>
                        <td style="text-align:right;">${date}</td>
                    </tr>`;
        });
        h += `</tbody></table>`;
        document.getElementById('admin_content').innerHTML = h;
    },
    filterAdminData: function (query) {
        let lowerQuery = query.toLowerCase().trim();
        let rows = document.querySelectorAll('.admin-list-row');
        rows.forEach(row => {
            let dataSearch = row.getAttribute('data-search') || '';
            if (!lowerQuery || dataSearch.includes(lowerQuery)) row.style.display = '';
            else row.style.display = 'none';
        });
    },
    renderScheme: function () {
        const s = this.state;
        const spec = this.currentSpec || [];
        const basePath = 'img/scheme/';
        const layers = [];

        // Вспомогательные функции для поиска оборудования в спецификации
        const hasItem = (namePart) => spec.some(i => i.name.toLowerCase().includes(namePart.toLowerCase()));
        const hasCat = (catPart) => spec.some(i => i.id && i.id.toLowerCase().includes(catPart.toLowerCase()));

        // 1. Базовый слой (всегда виден)
        layers.push('bg_frame.png');

        // 2. Расширительный бак отопления (только если есть в смете)
        if (spec.some(i => i.name.toLowerCase().includes("бак") && (i.name.toLowerCase().includes("отопл") || (i.group && i.group.toLowerCase().includes("котельн"))) && !i.name.toLowerCase().includes("гвс"))) {
            layers.push('tank_heating.png');
        }

        // 3. Блок Котлов и магистралей
        const hasGasBoiler = hasItem("Газовый") || hasCat("gas");
        const hasElBoiler = hasItem("Электрический") || hasCat("se-") || hasCat("seb-");

        if (hasGasBoiler) {
            layers.push('boiler_gas.png');
            layers.push('piping_gas.png');
        }
        if (hasElBoiler) {
            layers.push('boiler_el.png');
            layers.push('piping_el.png');
        }

        // Общая магистраль
        const boilerCount = (hasGasBoiler ? 1 : 0) + (hasElBoiler ? 1 : 0);
        if (boilerCount >= 2 || s.hotWater || s.systems.length > 0) {
            layers.push('podacha_obratka.png');
        }

        // 4. Блок Бойлера (ГВС)
        if (s.hotWater && (hasItem("Бойлер") || hasItem("Водонагреватель"))) {
            layers.push('bkn_tank.png');

            // Бак ГВС (синий)
            if (spec.some(i => (i.name.toLowerCase().includes("бак") && i.name.toLowerCase().includes("гвс")) || hasCat("exp_dhw"))) {
                layers.push('tank_water.png');
            }

            // Комплекты Fugas
            if (hasItem("Fugas") || hasItem("fugas") || hasItem("фугас")) {
                if (hasGasBoiler) layers.push('fugas_gas.png');
                if (hasElBoiler) layers.push('fugas_el.png');
            }

            // Рециркуляция
            if (s.recirc) {
                layers.push('recirc_loop.png');
            }
        }

        // 5. Ввод холодной воды
        if (s.water) {
            layers.push('water_input.png');
        }

        // 6. Распределение и Потребители
        if (hasItem("Гидрострелка") || hasItem("разделитель") || hasCat("hydro_")) {
            layers.push('hydro_manifold.png');
        }
        if (hasItem("Радиатор") && hasItem("группа")) {
            layers.push('system_rad.png');
        }
        if (hasItem("пол") && hasItem("группа")) {
            layers.push('system_tp.png');
        }

        // Генерация HTML с CSS-правилами для ночного режима и ПЕЧАТИ
        let html = `
                <style>
                    #dynamic_scheme {
                        position: relative; width: 100%; height: 70vh; min-height: 400px; max-height: 800px;
                        background: transparent; overflow: hidden; border-radius: 8px; margin-bottom: 20px;
                    }
                    #dynamic_scheme img {
                        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                        object-fit: contain; mix-blend-mode: multiply; transition: filter 0.3s ease, opacity 0.3s ease;
                    }
                    body.dark-mode #dynamic_scheme img {
                        filter: invert(1) hue-rotate(180deg); mix-blend-mode: screen; opacity: 0.85;
                    }
                    
                    /* === ЖЕСТКИЕ ПРАВИЛА ДЛЯ ИДЕАЛЬНОЙ ПЕЧАТИ === */
            /* Правила для вывода на отдельный альбомный лист */
            @media print {
                @page scheme-page { 
                    size: A4 landscape; 
                    margin: 10mm; 
                }
                #dynamic_scheme {
                    page: scheme-page !important;
                    page-break-before: always !important;
                    break-before: page !important;
                    page-break-after: avoid !important;
                    break-after: avoid !important;
                    height: 170mm !important; /* Оптимизировано, чтобы не вызывать пустой лист */
                    min-height: 170mm !important;
                    max-height: 170mm !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    overflow: hidden !important;
                }
                #dynamic_scheme img {
                    object-fit: contain !important;
                    object-position: center center !important;
                }
            }
                </style>
                <div id="dynamic_scheme">`;

        layers.forEach(layer => {
            // Текст прижимаем влево, оборудование - вправо
            let position = (layer === 'bg_frame.png') ? 'left center' : 'right center';
            html += `<img src="${basePath}${layer}" alt="${layer}" style="object-position: ${position};" onerror="this.style.display='none'">`;
        });

        html += `</div>`;
        return html;
    },
    exportAdminToExcel: function () {
        let users = this.adminData.users;
        let estimates = this.adminData.estimates;
        let csv = '\uFEFF';
        csv += "Имя;Телефон;Email;Telegram;Тариф;Регистрация;Локация;UTM Источник;Кол-во смет;Ср. площадь (м2);LTV (Сумма руб)\n";
        users.forEach(u => {
            let uEsts = estimates.filter(e => String(e.user_id) === String(u.id));
            let projectsCount = uEsts.length;
            let ltv = 0, totalArea = 0;
            uEsts.forEach(e => {
                ltv += (e.total_sum || 0);
                if (e.calc_data && e.calc_data.area) totalArea += parseFloat(e.calc_data.area);
            });
            let avgArea = projectsCount > 0 ? Math.round(totalArea / projectsCount) : 0;
            let name = (u.username || u.email || 'Без имени').replace(/;/g, ' ');
            let phone = (u.phone || '').replace(/;/g, ' ');
            let email = (u.email || '').replace(/;/g, ' ');
            let tg = (u.tg_username || '').replace(/;/g, ' ');
            let tariff = u.account_type === 'pro' ? 'PRO' : 'Base';
            let reg = new Date(u.created_at).toLocaleDateString();
            let loc = (u.location || '').replace(/;/g, ' ');
            let utm = (u.utm_source || '').replace(/;/g, ' ');
            csv += `${name};${phone};${email};${tg};${tariff};${reg};${loc};${utm};${projectsCount};${avgArea};${ltv}\n`;
        });
        let blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        let link = document.createElement("a");
        link.setAttribute("href", URL.createObjectURL(blob));
        link.setAttribute("download", "STOUT_CRM_Users.csv");
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },
    viewAdminUser: function (userId) {
        let user = this.adminData.users.find(u => String(u.id) === String(userId));
        if (!user) return;
        let userEstimates = this.adminData.estimates.filter(e => String(e.user_id) === String(userId));
        let date = new Date(user.created_at).toLocaleDateString();
        let lastVis = user.last_visited ? new Date(user.last_visited).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Нет данных';
        let proDateInput = user.demo_ends_at ? user.demo_ends_at.split('T')[0] : '';

        let ltv = 0, totalArea = 0;
        userEstimates.forEach(e => { ltv += (e.total_sum || 0); if (e.calc_data && e.calc_data.area) totalArea += parseFloat(e.calc_data.area); });
        let avgArea = userEstimates.length > 0 ? Math.round(totalArea / userEstimates.length) : 0;

        let h = `
                    <button class="btn-header-blue" style="margin-bottom: 20px; width: fit-content;" onclick="app.renderAdminMain()">← Назад</button>
                    <div style="background: var(--surface-light); padding: 25px; border-radius: 16px; border: 1px solid var(--border); box-shadow: 0 4px 20px rgba(0,0,0,0.05); margin-bottom: 30px;">
                        <div style="display:flex; align-items:center; gap:20px; margin-bottom:25px;">
                            ${user.avatar_url ? `<img src="${user.avatar_url}" style="width:80px; height:80px; border-radius:50%; object-fit:cover; border:2px solid var(--primary);">` : `<div style="width:80px; height:80px; border-radius:50%; background:var(--primary-light); display:flex; align-items:center; justify-content:center; font-size:40px; color:var(--primary);">👤</div>`}
                            <div>
                                <h2 style="margin:0; color:var(--text-main);">${user.username || user.email || 'Без имени'}</h2>
                                <div style="display:flex; gap:15px; margin-top:5px; font-size:13px; color:var(--text-sec);">
                                    <span>📱 ${user.phone || '—'}</span>
                                    ${user.tg_username ? `<a href="https://t.me/${user.tg_username.replace('@', '')}" target="_blank" style="color:var(--primary); text-decoration:none;">✈️ ${user.tg_username}</a>` : ''}
                                </div>
                                ${user.location ? `<div style="font-size:12px; color:var(--text-sec); margin-top:5px;">📍 ${user.location}</div>` : ''}
                                ${user.utm_source ? `<div style="display:inline-block; background:var(--primary-light); color:var(--primary); font-size:10px; font-weight:700; padding:2px 8px; border-radius:10px; margin-top:8px;">${user.utm_source}</div>` : ''}
                            </div>
                        </div>

                        <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:15px; margin-bottom:25px;">
                            <div style="background:var(--bg); padding:15px; border-radius:12px; text-align:center; border:1px solid var(--border);">
                                <div style="font-size:11px; color:var(--text-sec); text-transform:uppercase; font-weight:700; margin-bottom:5px;">Выручка (LTV)</div>
                                <div style="font-size:20px; font-weight:800; color:var(--primary);">${ltv.toLocaleString()} ₽</div>
                            </div>
                            <div style="background:var(--bg); padding:15px; border-radius:12px; text-align:center; border:1px solid var(--border);">
                                <div style="font-size:11px; color:var(--text-sec); text-transform:uppercase; font-weight:700; margin-bottom:5px;">Проектов</div>
                                <div style="font-size:20px; font-weight:800; color:var(--text-main);">${userEstimates.length}</div>
                            </div>
                            <div style="background:var(--bg); padding:15px; border-radius:12px; text-align:center; border:1px solid var(--border);">
                                <div style="font-size:11px; color:var(--text-sec); text-transform:uppercase; font-weight:700; margin-bottom:5px;">Ср. площадь</div>
                                <div style="font-size:20px; font-weight:800; color:var(--text-main);">${avgArea} м²</div>
                            </div>
                        </div>

                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; padding-top:20px; border-top:1px dashed var(--border);">
                            <div>
                                <h4 style="margin:0 0 15px 0; font-size:14px; color:var(--text-main);">⚙️ Управление тарифом</h4>
                                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:15px;">
                                    <div>
                                        <label style="display:block; font-size:11px; color:var(--text-sec); margin-bottom:4px;">Тип аккаунта</label>
                                        <select id="admin_edit_tariff" style="width:100%; padding:6px; border-radius:6px; background:var(--bg); color:var(--text-main); border:1px solid var(--border); font-size:12px;">
                                            <option value="base" ${user.account_type === 'base' ? 'selected' : ''}>Базовый</option>
                                            <option value="pro" ${user.account_type === 'pro' ? 'selected' : ''}>PRO ⭐️</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label style="display:block; font-size:11px; color:var(--text-sec); margin-bottom:4px;">Истекает (для PRO)</label>
                                        <input type="date" id="admin_edit_date" value="${proDateInput}" style="width:100%; padding:6px; border-radius:6px; background:var(--bg); color:var(--text-main); border:1px solid var(--border); font-size:12px;">
                                    </div>
                                </div>
                                <button class="auth-btn-base btn-email-submit" style="width:100%; height:34px; font-size:12px;" onclick="app.updateAdminUserTariff('${user.id}')">💾 Применить настройки</button>
                            </div>
                            <div style="font-size:12px;">
                                <h4 style="margin:0 0 15px 0; font-size:14px; color:var(--text-main);">📂 Техническая инфо</h4>
                                <div style="display:grid; grid-template-columns:1fr 1.5fr; gap:8px;">
                                    <span style="color:var(--text-sec);">Зарегистрирован:</span> <span style="color:var(--text-main); font-weight:600;">${date}</span>
                                    <span style="color:var(--text-sec);">Последний визит:</span> <span style="color:var(--text-main); font-weight:600;">${lastVis}</span>
                                    <span style="color:var(--text-sec);">Устройство:</span> <span style="color:var(--text-main); font-weight:600;">${user.last_device || 'Неизвестно'}</span>
                                    <span style="color:var(--text-sec);">Email:</span> <span style="color:var(--text-main); font-weight:600;">${user.email || '—'}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <h4 style="margin:0 0 15px 10px; color:var(--text-main);">📋 Сметы пользователя (${userEstimates.length})</h4>
                    <table class="inv-table">
                        <thead><tr><th>Название объекта</th><th>Сумма</th><th style="text-align:right;">Дата</th></tr></thead>
                        <tbody>
                `;
        if (userEstimates.length > 0) {
            userEstimates.forEach(e => {
                let edate = new Date(e.created_at).toLocaleDateString();
                let esum = e.total_sum ? e.total_sum.toLocaleString() + ' ₽' : '0 ₽';
                h += `<tr class="active-row" style="cursor: pointer;" onclick="app.viewAdminEstimate('${e.id}')">
                            <td style="font-weight:600;">${e.project_name}</td>
                            <td style="color:var(--primary); font-weight:bold;">${esum}</td>
                            <td style="text-align:right; color:var(--text-sec);">${edate}</td>
                        </tr>`;
            });
        } else {
            h += `<tr><td colspan="3" style="text-align:center; padding:30px; color:var(--text-sec);">Пользователь еще не сохранял сметы</td></tr>`;
        }
        h += `</tbody></table>`;
        document.getElementById('admin_content').innerHTML = h;
    },
    viewAdminEstimate: function (estId) {
        let est = this.adminData.estimates.find(e => String(e.id) === String(estId));
        if (!est) return;
        let author = est.users ? (est.users.username || 'Без имени') : 'Неизвестен';
        let phone = est.users ? (est.users.phone || 'Не указан') : '—';
        let date = new Date(est.created_at).toLocaleDateString();
        let objArea = est.calc_data && est.calc_data.area ? est.calc_data.area + ' м²' : 'Не указана';

        let h = `
                    <button class="btn-header-blue" style="margin-bottom: 20px; width: fit-content;" onclick="app.renderAdminMain()">← Назад</button>
                    <div style="background: var(--surface-light); padding: 20px; border-radius: 12px; border: 1px solid var(--border); margin-bottom: 20px;">
                        <h3 style="margin-top:0; color: var(--text-main);">📋 ${est.project_name}</h3>
                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 13px; color: var(--text-main); margin-bottom: 20px;">
                            <div><b style="color: var(--text-sec);">Монтажник:</b> ${author}</div>
                            <div><b style="color: var(--text-sec);">Телефон:</b> ${phone}</div>
                            <div><b style="color: var(--text-sec);">Дата сохранения:</b> ${date}</div>
                            <div><b style="color: var(--text-sec);">Площадь объекта:</b> <span style="font-weight: bold; color: var(--text-main);">${objArea}</span></div>
                            
                            <div style="grid-column: span 2; height: 1px; background: var(--border); margin: 5px 0;"></div>
                            
                            <div><b style="color: var(--text-sec);">Оборудование:</b> <span style="color: #6366F1; font-weight: bold;">${est.eq_sum ? est.eq_sum.toLocaleString() : '0'} ₽</span></div>
                            <div><b style="color: var(--text-sec);">Монтажные работы:</b> <span style="color: #F97316; font-weight: bold;">${est.works_sum ? est.works_sum.toLocaleString() : '0'} ₽</span></div>
                            <div style="grid-column: span 2; font-size: 14px; margin-top: 5px;"><b style="color: var(--text-sec);">Итоговая сумма:</b> <span style="color:var(--primary); font-weight:bold; font-size: 18px;">${est.total_sum ? est.total_sum.toLocaleString() : '0'} ₽</span></div>
                        </div>
                        <div style="font-size:12px; color:var(--text-sec); margin-bottom: 15px; line-height: 1.4;">
                            <i>* В базе данных сохраняются только общие суммы.<br>Чтобы посмотреть детальную спецификацию по позициям, скопируйте код ниже, закройте окно и нажмите иконку 📥 (Загрузить код).</i>
                        </div>
                        <button class="auth-btn-base btn-email-submit" style="width: 100%; height: 40px; margin-bottom: 10px;" onclick="app.copyAdminEstimateCode('${estId}')">📋 Скопировать код сметы</button>
                    </div>
                `;
        document.getElementById('admin_content').innerHTML = h;
    },
    copyAdminEstimateCode: function (estId) {
        let est = this.adminData.estimates.find(e => String(e.id) === String(estId));
        if (!est || !est.calc_data) { alert('Нет данных для копирования'); return; }
        let exportState = {};
        let st = est.calc_data;
        for (let key in st) {
            let val = st[key];
            if (val === false || val === 0 || val === "" || key === 'viewMode' || key === 'showSwapFor' || key === 'collapsedGroups') continue;
            if (key === 'tgUser' || key === 'accountType' || key === 'demoUsed' || key === 'darkMode') continue;
            if (Array.isArray(val) && val.length === 0) continue;
            if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) continue;
            exportState[key] = val;
        }
        let settings = btoa(unescape(encodeURIComponent(JSON.stringify(exportState))));
        navigator.clipboard.writeText(settings).then(() => {
            alert('✅ Код сметы скопирован!\\n\\nЗакройте админку, нажмите иконку 📥 (Загрузить код) в верхней панели и вставьте его.');
        }).catch(err => {
            console.error('Ошибка копирования: ', err);
            prompt('Скопируйте этот код вручную:', settings);
        });
    },
    updateAdminUserTariff: async function (userId) {
        let type = document.getElementById('admin_edit_tariff').value;
        let dateVal = document.getElementById('admin_edit_date').value;
        let updateData = { account_type: type };
        if (dateVal) updateData.demo_ends_at = new Date(dateVal).toISOString();
        else updateData.demo_ends_at = null;
        try {
            const { error } = await supabaseClient.from('users').update(updateData).eq('id', userId);
            if (error) throw error;
            alert("✅ Тариф успешно обновлен!");
            this.loadAdminData();
        } catch (e) {
            console.error(e);
            alert("Ошибка обновления: " + e.message);
        }
    },
    saveProfile: async function () {
        let name = document.getElementById('profile_name_input').value.trim();
        let phone = document.getElementById('profile_phone_input').value.trim();
        if (!name) { alert('Имя не может быть пустым.'); return; }
        if (phone && phone.length < 18) { alert('Введите корректный номер телефона (11 цифр).'); return; }
        let tgUser = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) ? window.Telegram.WebApp.initDataUnsafe.user : this.state.tgUser;
        if (!tgUser) return;
        this.state.tgUser.first_name = name;
        this.state.tgUser.phone = phone;
        this.saveState();
        try {
            let query = supabaseClient.from('users').update({ username: name, phone: phone });
            if (tgUser.isGoogle) query = query.eq('email', tgUser.email);
            else query = query.eq('telegram_id', tgUser.id);
            const { error } = await query;
            if (error) throw error;
            if (tgUser.isGoogle || tgUser.email) await supabaseClient.auth.updateUser({ data: { full_name: name, phone: phone } });
            this.syncUI();
            this.closeProfileModal();
            alert('✅ Профиль успешно сохранен!');
        } catch (error) {
            console.error('Ошибка сохранения профиля:', error);
            alert('Ошибка: ' + error.message);
        }
    },
    maskPhone: function (input) {
        let val = input.value.replace(/\D/g, '');
        if (!val) { input.value = ''; return; }
        if (val[0] === '8' || val[0] === '9') val = '7' + (val[0] === '9' ? '9' : val.substring(1));
        if (val[0] !== '7') val = '7' + val;
        let res = '+7 ';
        let core = val.substring(1);
        if (core.length > 0) res += '(' + core.substring(0, 3);
        if (core.length >= 3) res += ') ' + core.substring(3, 6);
        if (core.length >= 6) res += '-' + core.substring(6, 8);
        if (core.length >= 8) res += '-' + core.substring(8, 10);
        input.value = res;
    },
    getDeviceName: function () {
        let ua = navigator.userAgent || '';
        let os = "Неизвестно";
        if (/Windows/i.test(ua)) os = "Windows";
        else if (/Mac/i.test(ua) && !/iPhone|iPad/i.test(ua)) os = "Mac";
        else if (/iPhone|iPad/i.test(ua)) os = "iOS";
        else if (/Android/i.test(ua)) os = "Android";
        else if (/Linux/i.test(ua)) os = "Linux";
        let browser = "Браузер";
        if (/YaBrowser/i.test(ua)) browser = "Yandex";
        else if (/Edg/i.test(ua)) browser = "Edge";
        else if (/Chrome/i.test(ua)) browser = "Chrome";
        else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
        else if (/Firefox/i.test(ua)) browser = "Firefox";
        else if (/Telegram/i.test(ua)) browser = "Telegram";
        return os + " | " + browser;
    },
    sendMagicLink: async function () {
        let emailInput = document.getElementById('auth_email_input');
        let email = emailInput ? emailInput.value.trim() : '';
        if (!email || !email.includes('@')) { alert("Пожалуйста, введите корректный Email."); return; }
        try {
            const { error } = await supabaseClient.auth.signInWithOtp({ email: email, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
            if (error) throw error;
            alert("Ссылка для входа отправлена! Проверьте вашу почту (и папку Спам). Окно можно закрыть.");
            if (emailInput) emailInput.value = '';
            this.closeAuthModal();
        } catch (error) {
            console.error("Ошибка отправки Magic Link:", error);
            alert("Ошибка: " + error.message);
        }
    },

    handleGoogleAuth: async function (session) {
        if (!session || !session.user) return;
        let user = session.user;
        let email = user.email;
        let fullName = (user.user_metadata && user.user_metadata.full_name) ? user.user_metadata.full_name : email.split('@')[0];
        let phone = (user.user_metadata && user.user_metadata.phone) ? user.user_metadata.phone : '';
        let avatar = (user.user_metadata && user.user_metadata.avatar_url) ? user.user_metadata.avatar_url : ((user.user_metadata && user.user_metadata.picture) ? user.user_metadata.picture : '');

        let loc = await this.getGeoLocation();
        let utm = localStorage.getItem('stout_utm') || '';

        this.state.tgUser = { id: user.id, first_name: fullName, phone: phone, email: email, avatar_url: avatar, isGoogle: true };
        this.saveState();

        let updatePayload = { last_visited: new Date().toISOString(), last_device: this.getDeviceName(), avatar_url: avatar, location: loc };

        try {
            let { data: uDataList } = await supabaseClient.from('users').select('id, account_type, demo_ends_at, username, phone').eq('email', email).limit(1);
            let uData = uDataList ? uDataList[0] : null;
            if (!uData) {
                let { data: newUList } = await supabaseClient.from('users').insert([{ email: email, username: fullName, phone: phone, utm_source: utm, ...updatePayload }]).select('account_type');
                let newU = newUList ? newUList[0] : null;
                if (newU) this.state.accountType = newU.account_type;
            } else {
                let accType = uData.account_type;
                let demoEnds = uData.demo_ends_at;
                if (demoEnds) {
                    this.state.demoUsed = true;
                    if (accType === 'pro' && new Date() > new Date(demoEnds)) { accType = 'base'; updatePayload.account_type = 'base'; }
                }
                this.state.accountType = accType;
                if (uData.phone) this.state.tgUser.phone = uData.phone;
                if (uData.username) this.state.tgUser.first_name = uData.username;
                await supabaseClient.from('users').update(updatePayload).eq('email', email);
            }
            this.saveState();
        } catch (error) { console.error(error); }
        this.syncUI(); this.render();
    },
    deleteWork: function (name) {
        if (!confirm(`Удалить работу "${name}"?`)) return;
        if (!this.state.deletedWorks) this.state.deletedWorks = [];
        this.state.deletedWorks.push(name);
        // Если это была ручная работа - удаляем и из массива ручных
        if (this.state.userAddedWorks) {
            this.state.userAddedWorks = this.state.userAddedWorks.filter(w => w.name !== name);
        }
        this.saveState();
        this.render();
    },

    addCustomWork: function () {
        if (!this.checkAccess('pro')) return;
        let name = prompt("Введите название работы:", "Дополнительная работа");
        if (!name) return;
        let q = parseFloat(prompt("Количество:", "1").replace(',', '.')) || 1;
        let price = parseFloat(prompt("Цена за единицу (₽):", "1000").replace(',', '.')) || 0;

        if (!this.state.userAddedWorks) this.state.userAddedWorks = [];
        this.state.userAddedWorks.push({ name: name, q: q, price: price, unit: "шт", group: "5. Дополнительные работы" });
        this.saveState();
        this.render();
    },

    updateWorkPrice: function (name, val) {
        if (!this.state.customWorks) this.state.customWorks = {};
        // Очищаем от пробелов и оставляем только цифры
        let num = parseInt(val.replace(/[^\d]/g, ''));
        if (!isNaN(num)) {
            this.state.customWorks[name] = num;
        } else {
            // Если поле пустое - удаляем кастомную цену (возврат к базовой)
            delete this.state.customWorks[name];
        }
        this.saveState();
        this.render();
    },

    setViewMode: function (mode) {
        if (mode === 'works' && !this.checkAccess('pro')) return;
        this.state.viewMode = mode;
        let tEq = document.getElementById('tab_equipment');
        let tWk = document.getElementById('tab_works');
        if (tEq && tWk) {
            tEq.classList.toggle('active', mode === 'equipment');
            tWk.classList.toggle('active', mode === 'works');
        }
        document.body.classList.toggle('work-mode', mode === 'works');
        this.render();
    },
    toggleOpt: function (id) { this.state.optItems[id] = !this.state.optItems[id]; this.render(); },
    toggleDark: function (chk, event) {
        if (!this.checkAccess('base', event)) {
            document.getElementById('chk_dark').checked = this.state.darkMode;
            return;
        }
        this.state.darkMode = chk; document.body.classList.toggle('dark-mode', chk); this.saveState();
    },
    // Новая функция для переключения автоматики
    toggleUfhAuto: function (chk) { this.state.ufhAuto = chk; this.syncUI(); this.render(); },

    toggleGroup: function (name) {
        const idx = this.state.collapsedGroups.indexOf(name);
        if (idx === -1) this.state.collapsedGroups.push(name);
        else this.state.collapsedGroups.splice(idx, 1);
        this.render();
    },
    toggleMerge: function () {
        let isPro = (this.state.accountType === 'pro');
        let chk = document.getElementById('chk_merge');

        if (!isPro) {
            // Принудительно отщелкиваем тумблер в выключенное состояние
            setTimeout(() => { chk.checked = this.state.groupItems; }, 50);
            if (typeof app.showModal === 'function') app.showModal('pro');
            else alert("Группировка сметы доступна только в тарифе PRO ⭐️");
            return;
        }

        // Сохраняем состояние (true = показывать группы, false = сплошной список)
        this.state.groupItems = chk.checked;
        this.render();
    },
    download: function () {
        if (!this.checkAccess('base')) return;
        const tgUser = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) ? window.Telegram.WebApp.initDataUnsafe.user : this.state.tgUser;

        if (!tgUser || !tgUser.first_name || !tgUser.phone || tgUser.phone.length < 16) {
            alert("Пожалуйста, укажите Ваше Имя и Телефон в профиле. Они необходимы для формирования красивой печатной сметы.");
            this.showProfileModal();
            return;
        }

        const printBlock = document.getElementById('print_master_contacts');
        if (tgUser && printBlock) {
            document.getElementById('print_master_name').innerText = tgUser.first_name || tgUser.username || '';
            document.getElementById('print_master_phone').innerText = tgUser.phone || '';
            printBlock.style.display = 'block';
        }

        // Временно отключаем темную тему перед печатью для светлого фона документа
        const wasDark = document.body.classList.contains('dark-mode');
        if (wasDark) document.body.classList.remove('dark-mode');

        window.print();

        // Возвращаем тему обратно
        if (wasDark) document.body.classList.add('dark-mode');
    },
    sendTg: function () {
        const myLogin = "dima_ibatullin";

        // Очистка кода для компактности
        let exportState = {};
        for (let key in this.state) {
            let val = this.state[key];
            if (val === false || val === 0 || val === "" || key === 'viewMode' || key === 'showSwapFor' || key === 'collapsedGroups') continue;
            if (key === 'tgUser' || key === 'accountType' || key === 'demoUsed' || key === 'darkMode') continue; // Исключаем личные данные и тему
            if (Array.isArray(val) && val.length === 0) continue;
            if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) continue;
            exportState[key] = val;
        }
        let settings = btoa(unescape(encodeURIComponent(JSON.stringify(exportState))));

        let a = this.state.area;
        let f = this.state.floors;
        let fLabel = f === 1 ? '1 этаж' : f + ' этажа';

        let regionName = "Сибирь";
        if (this.state.region === 120) regionName = "Урал";
        if (this.state.region === 100) regionName = "Центр";
        if (this.state.region === 60) regionName = "Юг";

        let wallText = "Стандарт (Кирпич)";
        if (this.state.mat === 1.3) wallText = "Холодный (Дерево)";
        else if (this.state.mat === 0.8) wallText = "Тёплый (Газобетон)";

        let fuelArr = [];
        if (this.state.fuels.includes('el')) fuelArr.push('Электро');
        if (this.state.fuels.includes('gas')) fuelArr.push('Газ');
        let fuelStr = fuelArr.length > 0 ? fuelArr.join(' / ') : 'Не выбрано';

        let heatArr = [];
        if (this.state.systems.includes('rad')) heatArr.push('Радиаторы');
        if (this.state.systems.includes('tp')) heatArr.push('Тёплый пол');
        let heatStr = heatArr.length > 0 ? heatArr.join(' / ') : 'Не выбрано';

        let text = `👋 Новый заказ с сайта HeatCalc.ru - Калькулятор Монтажника!\n`;
        text += `━━━━━━━━━━━━━━━━━━━━━\n`;

        let pName = this.state.projectName ? this.state.projectName : "Без названия";
        text += `🏠 Название проекта: ${pName} | Объект: ${a} м² (${fLabel})\n`;
        text += `📍 Регион: ${regionName}\n`;
        text += `🧱 Стены: ${wallText}\n`;
        text += `🔥 Котёл: ${fuelStr}\n`;
        text += `🌡 Отопление: ${heatStr}\n`;

        if (this.state.hotWater) {
            text += `💧 ГВС: Да (Бойлер)\n`;
            if (this.state.recirc) text += `🔄 Рециркуляция: Да\n`;
        } else {
            text += `💧 ГВС: Нет\n`;
        }

        if (this.state.water) {
            let wZonesCount = this.state.waterZones ? this.state.waterZones.length : 0;
            text += `🚰 ХВС: Да (Зон: ${wZonesCount})\n`;
        }

        text += `\n`;
        text += `💰 Итого (Оборудование и материалы): ${(app.lastEqSum || 0).toLocaleString('ru-RU')} ₽\n`;
        text += `💰 Итого (Монтажные работы): ${(app.lastWorksSum || 0).toLocaleString('ru-RU')} ₽\n`;
        text += `━━━━━━━━━━━━━━━━━━━━━\n`;
        text += `📋 Код расчета для менеджера:\n`;
        text += `${settings}\n\n`;
        text += `Требуется проверка расчета.`;

        let url = `https://t.me/${myLogin}?text=${encodeURIComponent(text)}`;
        window.open(url, '_blank');
    },
    loadFromCode: function () {
        let code = prompt("Вставьте код расчета (начинается с { ):");
        if (code) {
            try {
                let cleanCode = code.replace(/`/g, '').trim();
                let savedState = {};
                if (cleanCode.startsWith('{')) { savedState = JSON.parse(cleanCode); }
                else { savedState = JSON.parse(decodeURIComponent(escape(atob(cleanCode)))); }

                // Удаляем чужие личные данные перед загрузкой сметы
                delete savedState.tgUser;
                delete savedState.accountType;
                delete savedState.demoUsed;
                delete savedState.darkMode; // Не копируем чужую тему оформления

                this.state = { ...this.state, ...savedState };
                this.syncUI();
                this.render();
            } catch (e) {
                alert("Ошибка! Неверный код. Попробуйте скопировать снова.");
            }
        }
    },
    // === НОВАЯ ФУНКЦИЯ СБРОСА ===
    reset: function () {
        if (!confirm("Сбросить все настройки и начать расчет заново?")) return;

        // Запоминаем важные данные перед сбросом
        const currentDarkMode = this.state.darkMode;
        const currentTgUser = this.state.tgUser;
        const currentAccType = this.state.accountType;

        // Полный сброс данных расчета
        this.state = {
            viewMode: 'equipment', optItems: {}, darkMode: currentDarkMode,
            area: 150, floors: 1, region: 100, mat: 1.0, fuels: ['el'], systems: [],
            hotWater: false, recirc: false, res: 3, win: 4, tp1: 0, tp2: 0,
            showSku: false, coolant: 'water', groupItems: false, collapsedGroups: [],
            swaps: {}, showSwapFor: null, radType: 'space', headType: 'gas',
            connectionType: 'angled', boilerType: 'optibase', ufhZones: 1,
            ufhCtrl: 'mech', pumpType: 'default', boilerSeries: 'plus',
            hydroType: 'combo', pipeType: 'insulated', ufhBaseType: 'mat',
            radManifoldType: 'standard', water: false, waterInput: false, waterZones: [], ufhAuto: false, projectName: "", customWorks: {},
            showScheme: false,
            // ВОЗВРАЩАЕМ АВТОРИЗАЦИЮ И ТАРИФ НА МЕСТО
            tgUser: currentTgUser,
            accountType: currentAccType
        };

        this.saveState();
        this.syncUI();
        this.render();
    },
    // =============================
    saveState: function () { localStorage.setItem('stout_save', JSON.stringify(this.state)); },
    init: function () {
        this.captureUTM();
        if (localStorage.getItem('stout_save')) {
            try { this.state = { ...this.state, ...JSON.parse(localStorage.getItem('stout_save')) }; } catch (e) { console.error("Ошибка загрузки сохранения", e); }
        }
        let radAlts = [catalog.rads[0], titanRads[0], steelRads[0]];
        catalog.rads.forEach(rad => { rad.alts = radAlts; }); titanRads.forEach(rad => { rad.alts = radAlts; }); steelRads.forEach(rad => { rad.alts = radAlts; });
        let hAlts = catalog.h_valves; catalog.h_valves.forEach(v => { v.alts = hAlts; });
        let boilerAlts = [catalog.tanks_optibase[0], catalog.tanks_standard[0]]; catalog.tanks_optibase.forEach(t => { t.alts = boilerAlts; }); catalog.tanks_standard.forEach(t => { t.alts = boilerAlts; });
        let pumpAlts = catalog.pumps_dn25; catalog.pumps_dn25.forEach(p => { p.alts = pumpAlts; });
        let elBoilerAlts = [catalog.boilers_plus[0], catalog.boilers_status[0]]; catalog.boilers_plus.forEach(b => { b.alts = elBoilerAlts; }); catalog.boilers_status.forEach(b => { b.alts = elBoilerAlts; });
        let hydroAlts = catalog.hydro_modular_dn20; catalog.hydro_dn20.forEach(h => { h.alts = hydroAlts; }); catalog.hydro_modular_dn20.forEach(h => { h.alts = catalog.hydro_dn20; });
        let pipeAlts = catalog.rad_pipes_grey; catalog.insulated_pipes.forEach(p => { p.alts = pipeAlts; }); catalog.rad_pipes_grey.forEach(p => { p.alts = catalog.insulated_pipes; });
        if (catalog.manifolds_rad && catalog.manifolds_chrome_blocks) { let chromeAlt = catalog.manifolds_chrome_blocks[0]; catalog.manifolds_rad.forEach(m => { m.alts = [chromeAlt]; }); catalog.manifolds_chrome_blocks.forEach(m => { m.alts = [catalog.manifolds_rad[0]]; }); }
        let xpsAlt = catalog.xps_kit[0]; catalog.mats.forEach(m => { m.alts = [xpsAlt]; }); catalog.xps_kit[0].alts = catalog.mats;
        if (catalog.well_auto) { let waAlts = catalog.well_auto; catalog.well_auto.forEach(a => { a.alts = waAlts; }); }
        this.syncUI(); this.render();

        this.isAppReady = true;
        this.lastSavedStateString = this.getStateSignature();
        this.hasUnsavedChanges = false;
        this.updateSaveBtnUI();

        // Подписка на изменения авторизации Supabase
        supabaseClient.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' && session) {
                this.handleGoogleAuth(session);
            } else if (event === 'SIGNED_OUT') {
                // Обработка выхода из Google-сессии
                // this.logout() можно было бы вызвать, 
                // но мы уже стираем статус в самой ф-ции logout()
            }
        });

        // Проверка текущей сессии при загрузке
        supabaseClient.auth.getSession().then(({ data: { session } }) => {
            if (session) {
                this.handleGoogleAuth(session);
            } else {
                // Проверяем статус PRO-подписки в фоне при загрузке (для TG юзера, если есть)
                setTimeout(async () => {
                    const tgUser = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) ? window.Telegram.WebApp.initDataUnsafe.user : this.state.tgUser;
                    if (tgUser && !tgUser.isGoogle) {
                        try {
                            let query = supabaseClient.from('users').select('id, account_type, demo_ends_at');
                            if (tgUser.id) query = query.eq('telegram_id', tgUser.id);
                            let { data: dList } = await query.limit(1);
                            let data = dList ? dList[0] : null;

                            if (data && data.account_type) {
                                let accType = data.account_type;
                                let demoEnds = data.demo_ends_at;

                                if (demoEnds) {
                                    app.state.demoUsed = true;
                                    if (accType === 'pro' && new Date() > new Date(demoEnds)) {
                                        accType = 'base';
                                        await supabaseClient.from('users').update({ account_type: 'base' }).eq('telegram_id', tgUser.id);
                                    }
                                }
                                this.state.accountType = accType;
                                this.saveState();
                                this.syncUI();
                            }
                        } catch (e) { }
                    }
                }, 500);
            }
        });

        // Скрываем прелоадер после полной инициализации
        setTimeout(() => {
            let preloader = document.getElementById('stout_preloader');
            if (preloader) {
                preloader.style.opacity = '0';
                preloader.style.visibility = 'hidden';
                setTimeout(() => preloader.remove(), 500); // Удаляем из DOM после затухания
            }
        }, 300);
    },
    toggleSwapUI: function (id) { if (this.state.showSwapFor === id) { this.state.showSwapFor = null; } else { this.state.showSwapFor = id; } this.render(); },
    cycleSwap: function (originalId) {
        let isRad = (catalog.rads.find(x => x.id === originalId) || titanRads.find(x => x.id === originalId) || steelRads.find(x => x.id === originalId));
        if (isRad) { if (this.state.radType === 'space') this.state.radType = 'titan'; else if (this.state.radType === 'titan') this.state.radType = 'steel'; else this.state.radType = 'space'; }
        else if ((originalId.startsWith('SHT') || (originalId.startsWith('STE') && originalId.includes('2070'))) && !originalId.includes('2001') && !originalId.includes('2002')) { if (this.state.headType === 'gas') this.state.headType = 'liquid'; else if (this.state.headType === 'liquid') this.state.headType = 'smart'; else this.state.headType = 'gas'; }
        else if (originalId.startsWith('SVH')) { if (this.state.connectionType === 'angled') this.state.connectionType = 'straight'; else this.state.connectionType = 'angled'; }
        else if (originalId.startsWith('SWH')) { this.state.boilerType = (this.state.boilerType === 'optibase') ? 'standard' : 'optibase'; }
        else if (originalId.startsWith('SPC-') && originalId.includes('180')) { if (this.state.pumpType === 'default') this.state.pumpType = 'std'; else if (this.state.pumpType === 'std') this.state.pumpType = 'mini'; else if (this.state.pumpType === 'mini') this.state.pumpType = 'pro'; else this.state.pumpType = 'default'; }
        else if (originalId.startsWith('SEB-')) { this.state.boilerSeries = (this.state.boilerSeries === 'plus') ? 'status' : 'plus'; }
        else if (originalId.startsWith('SDG-0018') || originalId.startsWith('SDG-0016')) { this.state.hydroType = (this.state.hydroType === 'combo') ? 'modular' : 'combo'; }
        else if (originalId.startsWith('SMS-0922') || originalId.startsWith('SMB-6850')) { this.state.radManifoldType = (this.state.radManifoldType === 'standard') ? 'chrome' : 'standard'; }
        else if (originalId.startsWith('SPI-') || originalId.startsWith('SPX-')) { this.state.pipeType = (this.state.pipeType === 'insulated') ? 'split' : 'insulated'; }
        else if (originalId.startsWith('SMF-0001') || originalId === '418318') { this.state.ufhBaseType = (this.state.ufhBaseType === 'mat') ? 'xps' : 'mat'; }
        else if (originalId.startsWith('SCS-0001')) {
            if (this.state.wellAutoType === 'sirio') this.state.wellAutoType = 'top';
            else if (this.state.wellAutoType === 'top') this.state.wellAutoType = 'base';
            else this.state.wellAutoType = 'sirio';
        }
        else if (originalId.startsWith('SCQ') || originalId.startsWith('SCN')) { this.state.convectorType = (this.state.convectorType === 'scq') ? 'scn' : 'scq'; }
        else if (originalId.startsWith('SVT') || originalId.startsWith('SVL')) { this.state.convConnectionType = (this.state.convConnectionType === 'straight') ? 'angled' : 'straight'; }
        this.state.showSwapFor = null; this.render();
    },
    syncRoomsToState: function () {
        if (this.state.detailedRooms && this.state.rooms && this.state.rooms.length > 0) {
            let tA = 0, tW = 0, tTp1 = 0, tTp2 = 0;
            this.state.rooms.forEach(r => {
                tA += (parseFloat(r.area) || 0);
                tW += r.windows.length;
                if (r.sys && r.sys.includes('tp')) {
                    if (r.floor === 2) tTp2 += (parseFloat(r.area) || 0);
                    else tTp1 += (parseFloat(r.area) || 0);
                }
            });
            this.state.area = tA > 0 ? tA : 50;
            this.state.win = tW > 0 ? tW : 1;
            this.state.tp1 = tTp1;
            this.state.tp2 = tTp2;

            if ((tTp1 + tTp2) > 0 && !this.state.systems.includes('tp')) this.state.systems.push('tp');
            else if ((tTp1 + tTp2) === 0 && this.state.systems.includes('tp')) this.state.systems = this.state.systems.filter(s => s !== 'tp');

            let hasAnyRad = this.state.rooms.some(r => !r.sys || r.sys.includes('rad'));
            if (hasAnyRad && !this.state.systems.includes('rad')) this.state.systems.push('rad');
            else if (!hasAnyRad && this.state.systems.includes('rad')) this.state.systems = this.state.systems.filter(s => s !== 'rad');
        }
    },
    toggleDetailedRooms: function (chk, event) {
        if (!this.checkAccess('base', event)) {
            document.getElementById('chk_detailed_rooms').checked = this.state.detailedRooms;
            return;
        }
        this.state.detailedRooms = chk;

        if (chk) {
            // Считаем текущую сумму комнат
            let currentRoomsArea = 0;
            if (this.state.rooms) {
                this.state.rooms.forEach(r => currentRoomsArea += (parseFloat(r.area) || 0));
            }

            // Если комнат нет ИЛИ ползунок общей площади сдвинули (площадь не совпадает) -> создаем 3 новые комнаты
            if (!this.state.rooms || this.state.rooms.length === 0 || Math.abs(currentRoomsArea - this.state.area) > 1) {
                let totalA = parseFloat(this.state.area) || 150;
                let a = Math.round(totalA / 3);
                this.state.rooms = [
                    { id: Date.now(), name: "Комната 1", area: a, floor: 1, sys: ['rad'], windows: [{ id: Date.now() + 1, width: 1.5, isPan: false }] },
                    { id: Date.now() + 10, name: "Комната 2", area: a, floor: 1, sys: ['rad'], windows: [{ id: Date.now() + 11, width: 1.5, isPan: false }] },
                    { id: Date.now() + 20, name: "Комната 3", area: totalA - a * 2, floor: 1, sys: ['rad'], windows: [{ id: Date.now() + 21, width: 1.5, isPan: false }] }
                ];
            }
        } else {
            // При выключении: суммируем площади всех комнат и отдаем эту цифру общему ползунку
            if (this.state.rooms && this.state.rooms.length > 0) {
                let totalA = 0;
                this.state.rooms.forEach(r => totalA += (parseFloat(r.area) || 0));
                this.state.area = totalA > 0 ? totalA : 50;
            }
        }

        this.syncRoomsToState();
        this.syncUI();
        this.render();
    },
    addRoom: function () {
        if (!this.state.rooms) this.state.rooms = [];
        let f = 1;
        if (this.state.rooms.length > 0) f = this.state.rooms[this.state.rooms.length - 1].floor || 1;
        this.state.rooms.push({ id: Date.now(), name: "Комната " + (this.state.rooms.length + 1), area: 15, floor: f, sys: ['rad'], windows: [{ id: Date.now() + 1, width: 1.5, isPan: false }] });
        this.syncRoomsToState(); this.renderRoomsUI(); this.syncUI(); this.render();
    },
    addFloor: function () {
        if (this.state.floors === 2) return;
        this.state.floors = 2;
        if (document.getElementById('chk_floors')) document.getElementById('chk_floors').checked = true;
        if (!this.state.rooms) this.state.rooms = [];
        this.state.rooms.push({ id: Date.now(), name: "Комната " + (this.state.rooms.length + 1), area: 15, floor: 2, sys: ['rad'], windows: [{ id: Date.now() + 1, width: 1.5, isPan: false }] });
        this.syncRoomsToState(); this.renderRoomsUI(); this.syncUI(); this.render();
    },
    toggleRoomSys: function (roomId, sysType) {
        let r = this.state.rooms.find(x => x.id === roomId);
        if (r) {
            if (!r.sys) r.sys = ['rad'];
            if (r.sys.includes(sysType)) r.sys = r.sys.filter(s => s !== sysType);
            else r.sys.push(sysType);
            this.syncRoomsToState(); this.renderRoomsUI(); this.syncUI(); this.render();
        }
    },
    removeRoom: function (id) {
        this.state.rooms = this.state.rooms.filter(r => r.id !== id);
        this.syncRoomsToState(); this.renderRoomsUI(); this.syncUI(); this.render();
    },
    addWindow: function (roomId) {
        let r = this.state.rooms.find(x => x.id === roomId);
        if (r) r.windows.push({ id: Date.now(), width: 1.5, isPan: false });
        this.syncRoomsToState(); this.renderRoomsUI(); this.syncUI(); this.render();
    },
    removeWindow: function (roomId, winId) {
        let r = this.state.rooms.find(x => x.id === roomId);
        if (r) { r.windows = r.windows.filter(w => w.id !== winId); if (r.windows.length === 0) r.windows.push({ id: Date.now(), width: 1.5, isPan: false }); }
        this.syncRoomsToState(); this.renderRoomsUI(); this.syncUI(); this.render();
    },
    updRoom: function (id, field, val) {
        let r = this.state.rooms.find(x => x.id === id);
        if (r) { r[field] = field === 'area' ? (parseFloat(val) || 1) : val; this.syncRoomsToState(); this.syncUI(); this.render(); }
    },
    updWindow: function (roomId, winId, field, val) {
        let r = this.state.rooms.find(x => x.id === roomId);
        if (r) {
            let w = r.windows.find(x => x.id === winId);
            if (w) { w[field] = field === 'width' ? (parseFloat(val) || 1.0) : val; this.render(); }
        }
    },
    renderRoomsUI: function () {
        const c1 = document.getElementById('rooms_list_1');
        const c2 = document.getElementById('rooms_list_2');
        if (!c1) return; c1.innerHTML = "";
        if (c2) c2.innerHTML = "";

        if (!this.state.rooms) return;
        this.state.rooms.forEach((r, idx) => {
            let hasRad = !r.sys || r.sys.includes('rad');
            let hasTp = r.sys && r.sys.includes('tp');
            let winsHtml = "";
            r.windows.forEach((w, wIdx) => {
                winsHtml += `<div style="display:inline-flex; align-items:center; background:var(--surface); border:1px solid var(--border); padding:2px 4px; border-radius:4px; gap:4px; font-size:10px; flex-shrink:0;">
                            <span style="font-weight:600; color:var(--text-sec);">Окно</span>
                            <input type="number" style="width:44px; border:1px solid var(--border); border-radius:3px; padding:2px; text-align:center; font-size:11px; background:var(--bg); color:var(--text-main);" value="${w.width}" step="0.1" onchange="app.updWindow(${r.id}, ${w.id}, 'width', this.value)">
                            <span style="color:var(--text-sec);">м</span>
                            <label style="display:flex; align-items:center; gap:2px; cursor:pointer; color:var(--text-main); font-size:10px; margin-left:2px;">
                                <input type="checkbox" ${w.isPan ? 'checked' : ''} onchange="app.updWindow(${r.id}, ${w.id}, 'isPan', this.checked)" style="margin:0; width:12px; height:12px;"> Панорамное
                            </label>
                            <span style="color:#EF4444; cursor:pointer; font-weight:bold; margin-left:2px; font-size:14px; line-height:1;" onclick="app.removeWindow(${r.id}, ${w.id})">×</span>
                        </div>`;
            });

            let floorSel = this.state.floors === 2 ? `<select style="font-size:10px; padding:0 2px 0 0; border:none; border-right:1px solid #D1D5DB; background:transparent; color:var(--text-sec); font-weight:600; margin-right:2px; outline:none; cursor:pointer;" onchange="app.updRoom(${r.id}, 'floor', parseInt(this.value))"><option value="1" ${r.floor === 1 ? 'selected' : ''}>1 Эт</option><option value="2" ${r.floor === 2 ? 'selected' : ''}>2 Эт</option></select>` : '';
            let accentColor = r.floor === 2 ? '#10B981' : 'var(--primary)';

            // ИСПРАВЛЕНИЕ: Используем динамический фон и тень на основе темы
            let cardBg = this.state.darkMode ? 'var(--surface-light)' : '#fff';
            let cardShadow = this.state.darkMode ? 'none' : '0 1px 2px rgba(0,0,0,0.02)';

            let html = `<div class="zone-card" style="padding:8px; margin-bottom:0; border:1px solid var(--border); border-left:4px solid ${accentColor}; border-radius:6px; background:${cardBg}; box-shadow: ${cardShadow};">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:nowrap; gap:4px;">
                            <div style="display:flex; align-items:center; flex:1; min-width:0;">
                                <span contenteditable="true" style="font-weight:700; color:var(--text-main); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; outline:none; padding-right:2px;" onblur="app.updRoom(${r.id}, 'name', this.innerText)">${r.name}</span>
                            </div>
                            
                            <div style="display:flex; align-items:center; gap:4px; flex-shrink:0;">
                                <div style="display:flex; align-items:center; gap:2px; background:var(--bg); padding:2px 4px; border-radius:6px; border:1px solid var(--border);">
                                    ${floorSel}
                                    <input type="number" style="width:46px; border:none; background:transparent; font-weight:800; font-size:13px; text-align:center; padding:0; outline:none; color:var(--primary);" value="${r.area}" onchange="app.updRoom(${r.id}, 'area', this.value)">
                                    <span style="font-size:10px; color:var(--text-sec); font-weight:600; margin-right:2px;">м²</span>
                                    <div style="display:flex; gap:2px; border-left:1px solid #D1D5DB; padding-left:4px;">
                                        <button onclick="app.toggleRoomSys(${r.id}, 'rad')" style="background:${hasRad ? 'var(--primary-light)' : 'transparent'}; border:1px solid ${hasRad ? 'var(--primary)' : 'transparent'}; border-radius:4px; padding:2px; cursor:pointer; font-size:12px; filter: ${hasRad ? 'none' : 'grayscale(1) opacity(0.3)'}; transition:0.2s;" title="Радиаторы">🌡️</button>
                                        <button onclick="app.toggleRoomSys(${r.id}, 'tp')" style="background:${hasTp ? '#ECFDF5' : 'transparent'}; border:1px solid ${hasTp ? '#10B981' : 'transparent'}; border-radius:4px; padding:2px; cursor:pointer; font-size:12px; filter: ${hasTp ? 'none' : 'grayscale(1) opacity(0.3)'}; transition:0.2s;" title="Тёплый пол">♨️</button>
                                    </div>
                                </div>
                                <span style="color:#EF4444; cursor:pointer; font-size:18px; line-height:1; opacity:0.6; padding:0 2px;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6" onclick="app.removeRoom(${r.id})">×</span>
                            </div>
                        </div>
                        
                        <div style="display:flex; flex-wrap:wrap; align-items:center; gap:4px; margin-top:8px; padding-top:8px; border-top:1px dashed var(--border);">
                            ${winsHtml}
                            <button style="background:transparent; border:1px dashed #9CA3AF; color:#6B7280; padding:2px 6px; height:24px; border-radius:4px; font-size:10px; font-weight:600; cursor:pointer; transition:0.2s; white-space:nowrap;" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background='transparent'" onclick="app.addWindow(${r.id})">+ Окно</button>
                        </div>
                    </div>`;

            if (r.floor === 2 && c2) {
                c2.insertAdjacentHTML('beforeend', html);
            } else {
                c1.insertAdjacentHTML('beforeend', html);
            }
        });
    },
    setUfhCtrl: function (type) { this.state.ufhCtrl = type; this.syncUI(); this.render(); },
    updZones: function (d) { let n = this.state.ufhZones + d; if (n < 1) n = 1; if (n > 16) n = 16; this.state.ufhZones = n; this.syncUI(); this.render(); },
    setZones: function (v) { let n = parseInt(v); if (isNaN(n) || n < 1) n = 1; if (n > 16) n = 16; this.state.ufhZones = n; this.syncUI(); this.render(); },
    syncUI: function () {
        document.getElementById('inp_area').value = this.state.area; document.getElementById('val_area').innerText = this.state.area;
        if (document.getElementById('blk_h2_wrapper')) document.getElementById('blk_h2_wrapper').style.display = (this.state.floors === 2) ? 'flex' : 'none';
        if (document.getElementById('btn_add_floor')) document.getElementById('btn_add_floor').style.display = (this.state.floors === 2) ? 'none' : 'block';
        if (document.getElementById('inp_h1')) document.getElementById('inp_h1').value = this.state.h1 || 2.7;
        if (document.getElementById('val_h1')) document.getElementById('val_h1').innerText = parseFloat(this.state.h1 || 2.7).toFixed(1);
        if (document.getElementById('inp_h2')) document.getElementById('inp_h2').value = this.state.h2 || 2.7;
        if (document.getElementById('val_h2')) document.getElementById('val_h2').innerText = parseFloat(this.state.h2 || 2.7).toFixed(1);
        document.getElementById('val_win').innerText = this.state.win; document.getElementById('chk_floors').checked = (this.state.floors === 2); document.getElementById('div_tp2').style.display = (this.state.floors === 2) ? 'block' : 'none';
        document.getElementById('fuel_el').className = this.state.fuels.includes('el') ? 'tab multi-active' : 'tab'; document.getElementById('fuel_gas').className = this.state.fuels.includes('gas') ? 'tab multi-active' : 'tab';
        const hasTp = this.state.systems.includes('tp'); document.getElementById('sys_rad').className = this.state.systems.includes('rad') ? 'tab multi-active' : 'tab'; document.getElementById('sys_tp').className = hasTp ? 'tab multi-active' : 'tab';
        document.getElementById('blk_tp_sliders').style.display = hasTp ? 'block' : 'none'; document.getElementById('blk_ufh_ctrl').style.display = hasTp ? 'block' : 'none';
        document.getElementById('chk_hw').checked = this.state.hotWater; document.getElementById('blk_res').style.display = this.state.hotWater ? 'flex' : 'none'; document.getElementById('val_res').innerText = this.state.res; document.getElementById('val_zones').innerText = this.state.ufhZones;
        const ufhTabs = document.querySelectorAll('.ufh-tab'); ufhTabs.forEach(t => { t.className = 'tab ufh-tab'; if (t.dataset.type === this.state.ufhCtrl) t.classList.add('multi-active'); });
        const regTabs = document.getElementById('reg_tabs').children; for (let t of regTabs) t.classList.remove('active');
        if (this.state.region === 130) regTabs[0].classList.add('active'); if (this.state.region === 120) regTabs[1].classList.add('active'); if (this.state.region === 100) regTabs[2].classList.add('active'); if (this.state.region === 60) regTabs[3].classList.add('active');
        const matTabs = document.getElementById('mat_tabs').children; for (let t of matTabs) t.classList.remove('active');
        if (this.state.mat === 1.3) matTabs[0].classList.add('active'); if (this.state.mat === 1.0) matTabs[1].classList.add('active'); if (this.state.mat === 0.8) matTabs[2].classList.add('active');
        const cTabs = document.querySelectorAll('.cool-tab'); cTabs.forEach(t => { t.classList.remove('active'); if (t.dataset.type === this.state.coolant) t.classList.add('active'); });
        document.getElementById('inp_tp1').max = this.state.area; document.getElementById('inp_tp2').max = this.state.area; document.getElementById('inp_tp1').value = this.state.tp1; document.getElementById('val_tp1').innerText = this.state.tp1; document.getElementById('inp_tp2').value = this.state.tp2; document.getElementById('val_tp2').innerText = this.state.tp2;
        document.getElementById('chk_sku').checked = this.state.showSku;
        if (document.getElementById('chk_scheme')) {
            document.getElementById('chk_scheme').checked = this.state.showScheme;
        }
        // Логика доступа для переключателя "УДЕШЕВИТЬ"
        let cw = document.getElementById('cheaper_wrapper');
        let cl = document.getElementById('cheaper_lock');
        let sl = document.getElementById('cheaper_switch_label');
        let chk = document.getElementById('chk_cheaper');

        if (cw && chk && cl && sl) {
            // 1. Универсальная проверка авторизации (TG, Google, Email)
            let isAuthenticated = this.state.tgUser || this.state.user || this.state.currentUser;

            if (!isAuthenticated) {
                // Если вообще нет авторизации — скрываем блок полностью
                cw.style.display = 'none';
            } else {
                cw.style.display = 'flex'; // Показываем блок для любого авторизованного

                // 2. Проверяем тариф
                let isPro = (this.state.accountType === 'pro' || this.state.accountType === 'PRO');

                if (isPro) {
                    // Тариф PRO: всё работает
                    cl.style.display = 'none';
                    sl.style.opacity = '1';
                    sl.style.pointerEvents = 'auto';
                    chk.disabled = false;
                    chk.checked = (this.state.brandMode === 'rommer');
                } else {
                    // Базовый тариф: показываем замок, блокируем переключатель
                    cl.style.display = 'inline-block';
                    sl.style.opacity = '0.5';
                    sl.style.pointerEvents = 'none';
                    chk.disabled = true;
                    chk.checked = false; // Принудительно выключаем

                    // Если пользователь без PRO как-то включил режим, сбрасываем его
                    if (this.state.brandMode === 'rommer') {
                        this.state.brandMode = 'stout';
                        setTimeout(() => this.render(), 10);
                    }
                }
            }
        }
        if (document.getElementById('chk_hw')) document.getElementById('chk_hw').checked = this.state.hotWater;
        if (document.getElementById('chk_recirc')) document.getElementById('chk_recirc').checked = this.state.recirc;
        if (document.getElementById('chk_water_input')) document.getElementById('chk_water_input').checked = this.state.waterInput;
        if (document.getElementById('chk_water')) document.getElementById('chk_water').checked = this.state.water;
        if (document.getElementById('blk_water_zones')) document.getElementById('blk_water_zones').style.display = this.state.water ? 'flex' : 'none';
        if (document.getElementById('chk_detailed_rooms')) document.getElementById('chk_detailed_rooms').checked = this.state.detailedRooms;
        if (document.getElementById('blk_fast_calc')) document.getElementById('blk_fast_calc').style.display = this.state.detailedRooms ? 'none' : 'block';
        if (document.getElementById('blk_detailed_calc')) document.getElementById('blk_detailed_calc').style.display = this.state.detailedRooms ? 'flex' : 'none';
        if (this.state.detailedRooms) this.renderRoomsUI();
        if (document.getElementById('chk_well')) document.getElementById('chk_well').checked = this.state.well;
        if (document.getElementById('blk_well')) document.getElementById('blk_well').style.display = this.state.well ? 'flex' : 'none';
        if (document.getElementById('inp_wellDepth')) { document.getElementById('inp_wellDepth').value = this.state.wellDepth; document.getElementById('val_wellDepth').innerText = this.state.wellDepth; }
        if (document.getElementById('inp_wellDist')) { document.getElementById('inp_wellDist').value = this.state.wellDist; document.getElementById('val_wellDist').innerText = this.state.wellDist; }

        // Синхронизация Автоматики ТП
        if (document.getElementById('chk_ufh_auto')) document.getElementById('chk_ufh_auto').checked = this.state.ufhAuto;
        if (document.getElementById('blk_ufh_settings')) document.getElementById('blk_ufh_settings').style.display = this.state.ufhAuto ? 'block' : 'none';

        // Синхронизация имени и проверка прав на его редактирование
        let nameEdit = document.getElementById('project_name_edit');
        if (nameEdit) {
            // Если имя пустое или с глюком, выводим красивую заглушку
            let currentName = this.state.projectName;
            if (currentName === "true" || currentName === "false") currentName = "";
            nameEdit.innerText = currentName || "Название объекта";

            // Определяем, является ли пользователь Гостем (нет tgUser)
            const tgUser = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) ? window.Telegram.WebApp.initDataUnsafe.user : this.state.tgUser;
            let isGuest = !tgUser;

            if (isGuest) {
                // Запрещаем ввод текста
                nameEdit.removeAttribute('contenteditable');
                // Вешаем вызов модального окна по клику
                nameEdit.onclick = function (e) {
                    e.preventDefault();
                    if (typeof app.showModal === 'function') app.showModal('guest');
                };
                nameEdit.onfocus = null;
                nameEdit.onblur = null;
            } else {
                // Разрешаем ввод текста для авторизованных
                nameEdit.setAttribute('contenteditable', 'true');
                // Снимаем блокирующий обработчик клика
                nameEdit.onclick = null;

                // UX: Очищаем заглушку при фокусе для удобного ввода
                nameEdit.onfocus = function () {
                    if (this.innerText === "Название объекта") this.innerText = "";
                };
                // Возвращаем заглушку и сохраняем при потере фокуса
                nameEdit.onblur = function () {
                    if (this.innerText.trim() === "") this.innerText = "Название объекта";
                    app.setProjectName(this.innerText);
                };
            }
        }


        // Отрисовка профиля ТГ / Google
        let authContainer = document.getElementById('tg-auth-container');
        if (authContainer) {
            let tgUser = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) ? window.Telegram.WebApp.initDataUnsafe.user : this.state.tgUser;

            if (tgUser) {
                let accType = this.state.accountType || 'base';
                let badge = accType === 'pro' ? `<span style="background: linear-gradient(135deg, #F59E0B, #D97706); color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 800; letter-spacing: 0.05em; margin-left: 8px; box-shadow: 0 2px 4px rgba(217, 119, 6, 0.3);">PRO</span>` : `<span style="color: var(--text-sec); font-size: 11px; font-weight: 500; margin-left: 8px;">(Базовый)</span>`;
                let uName = tgUser.first_name || tgUser.username || 'Монтажник';
                let avatarImg = tgUser.avatar_url || tgUser.photo_url;
                let icon = avatarImg ? `<img src="${avatarImg}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;">` : (tgUser.isGoogle ? 'G' : '👤');

                // ПРОВЕРКА НА АДМИНА
                let adminEmails = ['kovdorekb@gmail.com', 'kovdor24@yandex.ru', 'dima24ba@gmail.com'];
                let adminBtn = (tgUser.email && adminEmails.includes(tgUser.email.toLowerCase()))
                    ? `<div style="font-size: 12px; font-weight: 700; color: #10B981; cursor: pointer; border: 1px solid #10B981; padding: 4px 10px; border-radius: 8px; background: #ECFDF5; margin-right: 10px;" onclick="app.showAdminModal()" title="Панель владельца">👑 Админка</div>`
                    : '';

                authContainer.innerHTML = `<div style="display: flex; align-items: center; gap: 15px; padding-right: 15px; border-right: 1px solid var(--border);">${adminBtn}<div style="font-size: 13px; font-weight: 600; color: var(--text-main); display: flex; align-items: center; cursor: pointer; transition: 0.2s; padding: 4px 8px; border-radius: 6px;" onclick="app.showProfileModal()" title="Настроить профиль" onmouseover="this.style.background='var(--primary-light)'" onmouseout="this.style.background='transparent'">${icon} <span style="border-bottom: 1px dashed var(--text-sec); margin-left: 5px;">${uName}</span> ${badge}</div><div style="font-size: 12px; color: #EF4444; cursor:pointer; font-weight: 500; padding: 4px;" onclick="app.logout()">Выйти</div></div>`;
            } else {
                // Если пользователь не авторизован - показываем только одну аккуратную кнопку
                authContainer.innerHTML = `
                            <div style="padding-right: 15px; border-right: 1px solid var(--border); display: flex; align-items: center;">
                                <button style="background: #3B82F6; color: white; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 13px; transition: 0.2s;" onclick="app.showAuthModal()" onmouseover="this.style.background='#2563EB'" onmouseout="this.style.background='#3B82F6'">Войти</button>
                            </div>
                        `;
            }
        }
        if (document.getElementById('chk_dark')) document.getElementById('chk_dark').checked = this.state.darkMode; document.body.classList.toggle('dark-mode', this.state.darkMode);

        // === БЛОКИРОВКИ ===
        const isGuest = !this.state.tgUser;
        const isPro = this.state.accountType === 'pro';

        const cloudBtns = document.querySelector('.header-cloud-btns');
        if (cloudBtns) cloudBtns.style.display = isGuest ? 'none' : 'flex';

        const applyLock = (elId, reqLvl) => {
            let container;
            let el = document.getElementById(elId);
            if (!el) return;

            if (elId === 'chk_dark' || elId === 'chk_water' || elId === 'chk_sku' || elId === 'chk_merge' || elId === 'chk_detailed_rooms' || elId === 'chk_scheme') {
                container = el.closest('.switch');
            } else {
                container = el;
            }
            if (!container) return;

            container.classList.remove('locked-guest', 'locked-pro');
            if (reqLvl === 'base' && isGuest) {
                container.classList.add('locked-guest');
            } else if (reqLvl === 'pro' && !isPro) {
                if (isGuest) container.classList.add('locked-guest');
                else container.classList.add('locked-pro');
            }

            if (elId === 'project_name_edit') {
                container.setAttribute('contenteditable', String(!isGuest));
            }
        };

        // Гость не может редактировать имя и переключать тему
        applyLock('project_name_edit', 'base');
        applyLock('chk_dark', 'base');
        applyLock('chk_detailed_rooms', 'base');

        // Гость и Базовый не могут использовать PRO фичи
        applyLock('tab_works', 'pro');
        applyLock('chk_water', 'pro');

        if (document.getElementById('chk_merge')) document.getElementById('chk_merge').checked = this.state.groupItems;
        if (document.getElementById('chk_sku')) document.getElementById('chk_sku').checked = this.state.showSku;
        if (document.getElementById('chk_scheme')) document.getElementById('chk_scheme').checked = this.state.showScheme;

        applyLock('chk_merge', 'pro');
        applyLock('chk_sku', 'pro');
        applyLock('chk_scheme', 'pro');
        applyLock('btn_print_trigger', 'base');

        document.body.classList.toggle('work-mode', this.state.viewMode === 'works');
        const viewTabs = document.getElementById('view_tabs');
        if (viewTabs) {
            for (let t of viewTabs.children) {
                t.classList.remove('active', 'work-active');
                if (t.dataset.type === this.state.viewMode) {
                    t.classList.add('active');
                    if (this.state.viewMode === 'works') t.classList.add('work-active');
                }
            }
        }

        let tEq = document.getElementById('tab_equipment');
        let tWk = document.getElementById('tab_works');
        if (tEq && tWk) {
            tEq.classList.toggle('active', this.state.viewMode === 'equipment');
            tWk.classList.toggle('active', this.state.viewMode === 'works');
        }

        this.renderZonesUI();
        this.updateInfo();
    },
    setArea: function (v) {
        if (this.state.detailedRooms) { this.syncUI(); return; } // Блокировка ползунка, если включен покомнатный расчет
        v = parseInt(v);
        if (isNaN(v) || v < 50) v = 50;
        if (v > 300) v = 300; // Жесткий лимит площади
        this.state.area = v;
        if (this.state.tp1 > v) this.state.tp1 = v;
        if (this.state.tp1 + this.state.tp2 > v) this.state.tp2 = v - this.state.tp1;
        this.state.waterZones.forEach(z => z.dist = this.state.area < 120 ? 6 : 10);
        this.syncUI(); this.render();
    },
    updWin: function (d) {
        if (this.state.detailedRooms) { this.syncUI(); return; } // Блокировка кнопок окон
        let n = this.state.win + d; if (n < 1) n = 1; this.state.win = n; this.syncUI(); this.render();
    },
    setWin: function (v) {
        if (this.state.detailedRooms) { this.syncUI(); return; } // Блокировка ввода окон
        let n = parseInt(v); if (isNaN(n) || n < 1) n = 1; if (n > 50) n = 50; this.state.win = n; this.syncUI(); this.render();
    },
    toggleFloors: function (chk) {
        this.state.floors = chk ? 2 : 1; if (!chk) this.state.tp2 = 0;
        // Автообновление метража для воды
        this.state.waterZones.forEach(z => z.dist = this.state.area < 120 ? 6 : 10);
        this.syncUI(); this.render();
    },
    setRegion: function (v) { this.state.region = v; this.syncUI(); this.render(); },
    setMat: function (v) { this.state.mat = v; this.syncUI(); this.render(); },
    updateInfo: function () { document.getElementById('desc_reg').innerHTML = `<span>📍</span> ${REGION_DESC[this.state.region]}`; document.getElementById('desc_mat').innerHTML = WALL_DESC[this.state.mat]; },
    toggleFuel: function (f) { let idx = this.state.fuels.indexOf(f); if (idx > -1) { if (this.state.fuels.length > 1) this.state.fuels.splice(idx, 1); } else { this.state.fuels.push(f); } this.syncUI(); this.render(); },
    toggleSys: function (s) { let i = this.state.systems.indexOf(s); if (i > -1) { if (this.state.systems.length > 1) this.state.systems.splice(i, 1); } else this.state.systems.push(s); this.syncUI(); this.render(); },
    toggleHW: function (chk) { this.state.hotWater = chk; this.render(); },
    toggleRecirc: function (chk) { this.state.recirc = chk; this.render(); },
    toggleWaterInput: function (chk) { this.state.waterInput = chk; this.render(); },
    toggleWell: function (chk) { this.state.well = chk; this.syncUI(); this.render(); },
    setWellDepth: function (v) { let n = parseInt(v); if (isNaN(n) || n < 10) n = 10; if (n > 150) n = 150; this.state.wellDepth = n; this.syncUI(); this.render(); },
    setWellDist: function (v) { let n = parseInt(v); if (isNaN(n) || n < 0) n = 0; if (n > 150) n = 150; this.state.wellDist = n; this.syncUI(); this.render(); },
    toggleWater: function (chk, event) {
        if (!this.checkAccess('pro', event)) {
            document.getElementById('chk_water').checked = this.state.water;
            return;
        }
        setTimeout(() => {
            this.state.water = chk;
            if (chk && this.state.waterZones.length === 0) this.addZone();
            this.syncUI();
            this.render();
        }, 50);
    },
    addZone: function () {
        let id = Date.now();
        let dist = this.state.area < 120 ? 6 : 10;
        this.state.waterZones.push({ id: id, name: "Санузел " + (this.state.waterZones.length + 1), dist: dist, fixtures: { toilet: 0, basin: 0, bath: 0, shower: 0, wash: 0, dish: 0 } });
        this.syncUI(); this.render();
    },
    removeZone: function (id) { this.state.waterZones = this.state.waterZones.filter(z => z.id !== id); this.syncUI(); this.render(); },
    updZoneFixture: function (id, type, delta) {
        let z = this.state.waterZones.find(x => x.id === id);
        if (z) {
            if (z.fixtures[type] === undefined) z.fixtures[type] = 0;
            z.fixtures[type] += delta;
            if (z.fixtures[type] < 0) z.fixtures[type] = 0;
        }
        this.renderZonesUI(); this.render();
    },
    updZoneDist: function (id, val) {
        let z = this.state.waterZones.find(x => x.id === id);
        if (z) z.dist = parseInt(val) || 0;
        this.render();
    },
    renderZonesUI: function () {
        const container = document.getElementById('zones_list');
        if (!container) return;
        container.innerHTML = "";
        const labels = { toilet: "🚽 Унитаз", basin: "🚰 Раковина", bath: "🛁 Ванна", shower: "🚿 Душ", wash: "🧺 Стиралка", dish: "🍽️ ПММ" };
        this.state.waterZones.forEach((z, idx) => {
            let itemsHtml = "";
            for (let [key, name] of Object.entries(labels)) {
                let val = z.fixtures[key] || 0; // Защита для старых сохранений
                itemsHtml += `<div class="zone-row"><span style="font-size:11px;">${name}</span><div class="stepper"><button class="step-btn" onclick="app.updZoneFixture(${z.id}, '${key}', -1)">−</button><div class="step-val">${val}</div><button class="step-btn" onclick="app.updZoneFixture(${z.id}, '${key}', 1)">+</button></div></div>`;

            }
            let html = `<div class="zone-card"><div class="zone-header"><span class="zone-title" contenteditable="true" onblur="app.state.waterZones[${idx}].name=this.innerText">${z.name}</span><div class="zone-remove" onclick="app.removeZone(${z.id})">×</div></div><div style="margin-bottom:10px; font-size:11px; display:flex; align-items:center; gap:5px;"><span>Трасса (м):</span><input type="number" class="zone-input" value="${z.dist}" onchange="app.updZoneDist(${z.id}, this.value)"></div>${itemsHtml}</div>`;
            container.insertAdjacentHTML('beforeend', html);
        });
    },
    updRes: function (d) { let n = this.state.res + d; if (n < 1) n = 1; if (n > 10) n = 10; this.state.res = n; this.syncUI(); this.render(); },
    setRes: function (v) { let n = parseInt(v); if (isNaN(n) || n < 1) n = 1; if (n > 10) n = 10; this.state.res = n; this.syncUI(); this.render(); },
    updTp: function (f, v) {
        v = parseInt(v);
        if (isNaN(v) || v < 0) v = 0;
        let max = this.state.area;
        if (v > max) v = max; // Пол не может быть больше площади дома

        if (f === 1) {
            this.state.tp1 = v;
            if (this.state.tp1 + this.state.tp2 > max) this.state.tp2 = max - this.state.tp1;
        } else {
            this.state.tp2 = v;
            if (this.state.tp1 + this.state.tp2 > max) this.state.tp1 = max - this.state.tp2;
        }
        this.syncUI(); this.render();
    },
    setCoolant: function (t) { this.state.coolant = t; this.syncUI(); this.render(); },
    toggleSku: function (event) {
        if (!this.checkAccess('pro', event)) {
            document.getElementById('chk_sku').checked = this.state.showSku;
            return;
        }
        setTimeout(() => {
            this.state.showSku = document.getElementById('chk_sku').checked;
            const panel = document.querySelector('.output-panel');
            if (this.state.showSku) panel.classList.add('show-sku-mode'); else panel.classList.remove('show-sku-mode');
            this.render();
        }, 50);
    },

    // === НОВАЯ ФУНКЦИЯ ДЛЯ ПОДСКАЗОК ===
    getDesc: function (type, val1, val2, val3) {
        const styles = "font-size:11px; line-height:1.4;";
        const head = "font-weight:700; color:#93C5FD; display:block; margin-bottom:4px;";

        // Логика для коллекторов
        if (type === 'manifold') {
            let formula = "";
            let why = "Равномерное распределение, балансировка петель.";
            if (val2 === 'cw') {
                formula = `<b>Тип:</b> ХВС (Холодная вода).<br><b>Формула:</b> Сумма всех водоразеток.<br><b>Итого точек:</b> ${val1}.`;
            } else if (val2 === 'hw_std') {
                formula = `<b>Тип:</b> ГВС (Тупиковая).<br><b>Формула:</b> Сумма приборов с горячей водой.<br><b>Итого точек:</b> ${val1}.`;
            } else if (val2 === 'hw_recirc') {
                formula = `<b>Тип:</b> ГВС (Лучевая).<br><b>Формула:</b> 1 выход на 1 зону (санузел/кухню).<br><b>Итого петель:</b> ${val1}.`;
            } else if (val2 === 'recirc') {
                formula = `<b>Тип:</b> Рециркуляция.<br><b>Формула:</b> Равно числу петель ГВС.<br><b>Итого линий:</b> ${val1}.`;
            } else if (val2 === 'rad') {
                formula = `<b>Тип:</b> Радиаторное отопление.<br><b>Формула:</b> 1 пара выходов на 1 радиатор.<br><b>Радиаторов:</b> ${val1} шт.`;
            } else if (val2 === 'ufh') {
                formula = `<b>Тип:</b> Тёплый пол.<br><b>Формула:</b> Площадь ТП / 12 м² (макс. площадь одной петли).<br><b>Контуров:</b> ${val1} шт.`;
            }
            let minWarn = (val1 === 1) ? "<br><br><i>*Выбран блок на 2 выхода (заводской минимум). 1 выход — резерв.</i>" : "";
            return `<span style="${styles}"><span style="${head}">Коллекторный блок</span><b>Зачем:</b> ${why}<br><br>${formula}${minWarn}</span>`;
        }

        switch (type) {
            // === 1. КОТЕЛЬНАЯ ===
            case 'boiler_gas':
                return `<span style="${styles}"><span style="${head}">Газовый котел</span><b>Зачем:</b> Основной источник тепла.<br><b>Формула:</b> (Площадь × H_потолков × Утепление) + 20% запас.<br><b>Потребность:</b> ${val1} кВт.<br><b>Норматив:</b> СП 60.13330.2020.</span>`;
            case 'boiler_el':
                return `<span style="${styles}"><span style="${head}">Электрический котел</span><b>Зачем:</b> Резервный или основной источник.<br><b>Расчет:</b> По теплопотерям здания.<br><b>Потребность:</b> ${val1} кВт.</span>`;
            case 'boiler_tank':
                let calcStr = `Жильцы (${val1} чел) × 50 л.`;
                if (val3 && val3 > (val1 * 50)) calcStr = `Пиковый водоразбор санузлов (${val3} л).`;
                return `<span style="${styles}"><span style="${head}">Бойлер косвенного нагрева</span><b>Зачем:</b> Комфортное ГВС (запас воды).<br><b>База расчета:</b> ${calcStr}<br><b>Подобранный объем:</b> ${val2} л.<br><b>Норматив:</b> СП 30.13330.2020.</span>`;
            case 'chimney':
                return `<span style="${styles}"><span style="${head}">Дымоход коаксиальный</span><b>Зачем:</b> Безопасный выброс газов и забор воздуха с улицы.<br><b>Стандарт:</b> 60/100 мм (для турбированных котлов).<br><b>Норматив:</b> СП 402.1325800.2018.</span>`;
            case 'stab':
                return `<span style="${styles}"><span style="${head}">Стабилизатор напряжения</span><b>Зачем:</b> Защита дорогой электроники котла.<br><b>Важно:</b> Обязательное условие гарантии большинства производителей.</span>`;
            case 'exp_h':
                return `<span style="${styles}"><span style="${head}">Расширительный бак (Отопление)</span><b>Зачем:</b> Компенсация расширения воды при нагреве.<br><b>Формула:</b> V_системы (${val1} л) × 0.12 (коэфф. расширения).<br><b>Норматив:</b> СП 41-104-2000.</span>`;
            case 'exp_d':
                return `<span style="${styles}"><span style="${head}">Расширительный бак (ГВС)</span><b>Зачем:</b> Компенсация давления при нагреве бойлера.<br><b>Формула:</b> 10% от объема бойлера (${val1} л).<br><b>Расчет:</b> ${val2} л.</span>`;
            case 'fugas':
                return `<span style="${styles}"><span style="${head}">Комплект Fugas</span><b>Зачем:</b> Трехходовой клапан для подключения бойлера к одноконтурному котлу.<br><b>Функция:</b> Переключает поток на нагрев воды по датчику.</span>`;
            case 'pump_std':
                return `<span style="${styles}"><span style="${head}">Насос циркуляционный</span><b>Зачем:</b> Прокачка теплоносителя по системе.<br><b>Параметры:</b> 25/60 (Напор 6м).<br><b>Подбор:</b> По гидравлическому сопротивлению самой длинной петли.</span>`;

            // === 3. РАДИАТОРЫ ===
            case 'rad_item':
                return `<span style="${styles}"><span style="${head}">Радиатор отопления</span><b>Зачем:</b> Компенсация теплопотерь через окна/стены.<br><b>Формула:</b> Теплопотери помещения / Теплоотдача секции.<br><b>Мощность:</b> ${val1} Вт.<br><b>Норматив:</b> ГОСТ 31311-2005.</span>`;
            case 'rad_valves':
                return `<span style="${styles}"><span style="${head}">Узел нижнего подключения</span><b>Зачем:</b> Эстетичное подключение труб из стены/пола.<br><b>Функция:</b> Позволяет перекрыть и снять радиатор без слива системы.</span>`;
            case 'rad_head':
                return `<span style="${styles}"><span style="${head}">Термоголовка</span><b>Зачем:</b> Климат-контроль в каждой комнате.<br><b>Экономия:</b> Снижает расход газа/электричества на 15-20% за счет отсутствия перетопа.</span>`;
            case 'rad_pipe':
                return `<span style="${styles}"><span style="${head}">Труба (Лучевая разводка)</span><b>Зачем:</b> Индивидуальная трасса к каждому радиатору.<br><b>Формула:</b> (Ср. расстояние до коллектора × 2) + Подъемы.<br><b>Всего:</b> ${val1} м.</span>`;

            // === 4. ТЕПЛЫЙ ПОЛ ===
            case 'ufh_pipe':
                return `<span style="${styles}"><span style="${head}">Труба теплого пола</span><b>Зачем:</b> Греющий элемент системы.<br><b>Формула:</b> Площадь пола × 7 м (при шаге укладки 150 мм).<br><b>Общая длина:</b> ${val1} м.<br><b>Норматив:</b> СП 60.13330.2020.</span>`;
            case 'ufh_mat':
                return `<span style="${styles}"><span style="${head}">Мат с бобышками</span><b>Зачем:</b> Быстрый монтаж и фиксация трубы.<br><b>Расчет:</b> Чистая площадь ТП (${val1} м²) + 5% запас на подрезку.</span>`;
            case 'ufh_xps':
                return `<span style="${styles}"><span style="${head}">Пенополистирол (XPS)</span><b>Зачем:</b> Теплоизоляция от перекрытия/грунта.<br><b>Толщина:</b> 50 мм (стандарт для 1 этажа).<br><b>Расчет:</b> Площадь ТП + 5% запас.</span>`;
            case 'actuator':
                return `<span style="${styles}"><span style="${head}">Сервопривод</span><b>Зачем:</b> Автоматическое открывание петель.<br><b>Управление:</b> По команде от комнатного термостата.<br><b>Кол-во:</b> 1 шт на каждую петлю коллектора.</span>`;
            case 'thermostat':
                return `<span style="${styles}"><span style="${head}">Термостат</span><b>Зачем:</b> Измерение температуры воздуха в комнате.<br><b>Расчет:</b> 1 шт на одну независимую зону (комнату).</span>`;

            // === 5. ВОДОСНАБЖЕНИЕ ===
            case 'pipe_cw':
                return `<span style="${styles}"><span style="${head}">Труба PEX-a (ХВС)</span><b>Зачем:</b> Питьевая холодная вода.<br><b>Расчет:</b> Сумма длин трасс до приборов.<br><b>Всего:</b> ${val1} м.<br><b>Норматив:</b> СП 30.13330.2020.</span>`;
            case 'pipe_hw':
                return `<span style="${styles}"><span style="${head}">Труба PEX-a (ГВС)</span><b>Зачем:</b> Горячая вода (до 95°C).<br><b>Расчет:</b> Трассы подачи + подъемы.<br><b>Всего:</b> ${val1} м.</span>`;
            case 'ins_blue':
                return `<span style="${styles}"><span style="${head}">Изоляция (Синяя)</span><b>Зачем:</b> Защита от конденсата (чтобы труба не "потела").<br><b>Расчет:</b> По длине трубы ХВС (${val1} м).<br><b>Норматив:</b> СП 61.13330.2012.</span>`;
            case 'ins_red':
                return `<span style="${styles}"><span style="${head}">Изоляция (Красная)</span><b>Зачем:</b> Снижение теплопотерь (чтобы вода не остывала).<br><b>Расчет:</b> По длине трубы ГВС (${val1} м).</span>`;
            case 'socket':
                return `<span style="${styles}"><span style="${head}">Водорозетка</span><b>Зачем:</b> Жесткая фиксация выхода для смесителя.<br><b>Тип:</b> ${val1}.<br><b>Кол-во:</b> ${val2} шт.</span>`;
            case 'sleeve':
                return `<span style="${styles}"><span style="${head}">Гильза монтажная</span><b>Зачем:</b> Опрессовка соединения (вечное соединение).<br><b>Расход:</b> ${val1}.</span>`;
            case 'install':
                return `<span style="${styles}"><span style="${head}">Инсталляция</span><b>Зачем:</b> Несущая рама для подвесного унитаза.<br><b>Нагрузка:</b> Испытано на 400 кг.<br><b>Комплект:</b> Рама, бачок, кнопка, крепеж.</span>`;
            case 'eurocone_water':
                return `<span style="${styles}"><span style="${head}">Евроконус 16</span><b>Зачем:</b> Подключение трубы к коллектору (разборное).<br><b>Формула:</b> 1 шт на каждый выход коллектора.<br><b>Кол-во:</b> ${val1} шт.</span>`;

            case 'convector':
                return `<span style="${styles}"><span style="${head}">Внутрипольный конвектор</span><b>Мощность по ГОСТ (90/70°C):</b> ${val1} Вт.<br><b style="color:var(--primary);">Факт. теплоотдача (75/65°C):</b> ~${val2} Вт.<br><b>Примечание:</b> В реальной системе мощность падает на ~35%. Прибор подобран с нужным запасом.<br><b>Важно:</b> Требует глубину стяжки не менее 85 мм.</span>`;
            case 'rad_tooltip': {
                let o = val1;
                let dev = (o.isRommer && o.item.rommer) ? o.item.rommer : o.item;
                let isPanel = dev.isPanel || (dev.name && dev.name.toLowerCase().includes("панельный"));
                let passPwr = dev.passportPower || Math.round(dev.power50 / 0.65) || 'undefined';

                let headLine = `Выбран: ${dev.name}`;
                let pwrLine = "";
                if (isPanel) {
                    pwrLine = `Размер: ${dev.sec} мм. Мощность: ${dev.power50} Вт (ΔT=50°C)`;
                } else {
                    pwrLine = `Секций: ${dev.sec}. Мощность секции: ${dev.power50} Вт (ΔT=50°C)`;
                }

                let margin = Math.round((o.fact / o.demand) * 100) - 100;
                let marginText = margin >= 0 ? `+${margin}% запас` : `${Math.abs(margin)}% дефицит`;
                let coverageColor = margin >= 0 ? '#10B981' : '#F59E0B';
                let coverageIcon = margin >= 0 ? '✅' : '⚠️';

                let warnWin = "";
                if (o.count > o.win) {
                    warnWin = `<br><span style="color:#F59E0B; font-weight:700; display:block; margin-top:4px;">⚠️ Окон (${o.win}) мало! Добавлено приборов: ${o.count - o.win} шт.</span>`;
                }

                return `<span style="font-size:12px; line-height:1.5; display:block; min-width:240px;">
                    <b style="display:block; margin-bottom:2px; font-size:13px;">${headLine}</b>
                    <b style="display:block; margin-bottom:2px;">${pwrLine}</b>
                    <span style="color:#9CA3AF; font-size:11px;">(Паспортная мощность: ${passPwr} Вт при ΔT=70°C)</span>
                    <hr style="margin:8px 0; border:none; border-top:1px dashed #4B5563;">
                    <b style="display:block; margin-bottom:2px;">${o.demandLabel}: ${o.demand} Вт</b>
                    <b style="display:block; margin-bottom:4px;">Фактическая мощность: ${o.fact} Вт (${o.count} шт).</b>
                    <span style="color:${coverageColor}; font-weight:700;">${coverageIcon} Покрытие: ${margin + 100}% (${marginText})</span>
                    ${warnWin}
                </span>`;
            }
            case 'rad_item_detailed':
                return `<span style="${styles}"><span style="${head}">Прибор отопления</span><b>Мощность по ГОСТ (90/70°C):</b> ${val1} Вт.<br><b style="color:var(--primary);">Факт. теплоотдача (75/65°C):</b> ${val2} Вт.<br><b>Примечание:</b> Прибор подобран с учетом реального температурного графика современных котлов и правила перекрытия окна на 70%.</span>`;
            case 'coolant':
                return `<span style="${styles}"><span style="${head}">Теплоноситель</span><b>Зачем:</b> Заполнение системы.<br><b>Формула:</b> V_котлов + V_радиаторов + V_труб + V_ТП + Запас.<br><b>Объем системы:</b> ~${val1} л.</span>`;

            default: return "";
        }
    },
    // ====================================
    render: function () {
        this.calcBaseTotal = 0;
        this.calcFinalTotal = 0;
        app.lastEqSum = 0;
        app.lastWorksSum = 0;
        app.tempWarns = []; // Массив для сбора предупреждений о дефиците мощности
        this.currentSpec = []; // Список оборудования для генерации схемы
        let isPro = (this.state.accountType === 'pro');
        // Схлопываем смету (forceMerge = true), если нет PRO или тумблер "Группировать" ВЫКЛЮЧЕН
        let forceMerge = !isPro || !this.state.groupItems;
        let h1 = this.state.h1 || 2.7, h2 = this.state.h2 || 2.7;
        let avgH = (this.state.floors === 2) ? (h1 + h2) / 2 : h1;

        let pwr = 0;
        if (this.state.detailedRooms && this.state.rooms && this.state.rooms.length > 0) {
            let totalLoadW = 0;
            this.state.rooms.forEach(r => {
                let rHeight = (r.floor === 2) ? h2 : h1;
                let heightCoef = rHeight / 2.7;
                // Считаем стены
                let baseRoomLoad = (r.area * heightCoef * 70 * (this.state.region / 100) * this.state.mat);
                totalLoadW += baseRoomLoad;
                // Прибавляем все окна
                r.windows.forEach(w => {
                    let wHeight = w.isPan ? 2.5 : 1.5;
                    let wArea = parseFloat(w.width || 1) * wHeight;
                    totalLoadW += (wArea * 150 * (this.state.region / 100) * this.state.mat);
                });
            });
            pwr = (totalLoadW / 1000).toFixed(1);
        } else {
            pwr = (this.state.area * avgH * 37 * (this.state.region / 100) * this.state.mat / 1000).toFixed(1);
        }

        let regionName = "Сибирь"; if (this.state.region === 120) regionName = "Урал"; if (this.state.region === 100) regionName = "Центр"; if (this.state.region === 60) regionName = "Юг";

        // Заголовок спецификации
        document.getElementById('doc_summary').innerHTML = `<span>Объект: <b>${this.state.area} м²</b> (${this.state.floors === 2 ? 2 : 1} эт)</span> <span class="sep">•</span> <span>Теплопотери: <b>${pwr} кВт</b></span> <span class="sep">•</span> <span>Регион: <b>${regionName}</b></span> <span class="sep">•</span> <span>Проживающих: <b>${this.state.res}</b></span> <span style="margin-left: auto;">Дата: <b>${new Date().toLocaleDateString()}</b></span>`;

        let bill = [];
        const addToBill = (item, qty, tip, group = null) => {
            if (!item || qty <= 0) return;

            let itemsToAdd = [];
            if (this.state.brandMode === 'rommer' && item.rommer) {
                // Считаем базу ОДИН РАЗ для этого исходного товара
                this.calcBaseTotal += (item.price || 0) * qty;

                if (Array.isArray(item.rommer)) {
                    // Если это массив аналогов (сборка или пирог)
                    item.rommer.forEach(sub => {
                        let finalSub = { ...sub };
                        finalSub.brand = sub.brand || "ROMMER"; // Явно прописываем бренд, если не указан
                        itemsToAdd.push({ itm: finalSub, q: qty });
                    });
                } else {
                    // Одиночный аналог
                    let finalItem = { ...item };
                    finalItem.id = item.rommer.id;
                    finalItem.name = item.rommer.name;
                    finalItem.price = item.rommer.price;
                    finalItem.brand = item.rommer.brand || "ROMMER";
                    if (item.rommer.alts) finalItem.alts = item.rommer.alts;
                    itemsToAdd.push({ itm: finalItem, q: qty });
                }
            } else {
                this.calcBaseTotal += (item.price || 0) * qty;
                itemsToAdd.push({ itm: { ...item }, q: qty });
            }

            // Добавляем все сформированные позиции в смету
            itemsToAdd.forEach(entry => {
                let finalItem = entry.itm;
                let finalQty = entry.q;

                this.currentSpec.push({ ...finalItem, q: finalQty, group: group });
                this.calcFinalTotal += (finalItem.price || 0) * finalQty;

                if (forceMerge) {
                    let existing = bill.find(x => x.id === finalItem.id && x.group === group);
                    if (existing) {
                        existing.q += finalQty;
                        existing.sum += finalItem.price * finalQty;
                        if (tip && tip.includes('|||')) {
                            let parts = tip.split('|||');
                            let locInfo = parts[0];
                            let devInfo = parts[1];
                            if (!existing.locs) {
                                let oldParts = existing.qtyTip ? existing.qtyTip.split('|||') : [];
                                existing.locs = oldParts.length > 1 ? [oldParts[0]] : [existing.qtyTip];
                            }
                            if (!existing.locs.includes(locInfo)) existing.locs.push(locInfo);
                            existing.qtyTip = existing.locs.join('<br>') + '<hr style="margin:6px 0; border:none; border-top:1px dashed #4B5563;">' + devInfo;
                        } else if (tip && (!existing.qtyTip || !existing.qtyTip.includes(tip))) {
                            existing.qtyTip = existing.qtyTip ? existing.qtyTip + "<br>" + tip : tip;
                        }
                    } else {
                        let finalTip = tip;
                        if (tip && tip.includes('|||')) {
                            let parts = tip.split('|||');
                            finalItem.locs = [parts[0]];
                            finalTip = parts[0] + '<hr style="margin:6px 0; border:none; border-top:1px dashed #4B5563;">' + parts[1];
                        }
                        bill.push({ ...finalItem, q: finalQty, sum: finalItem.price * finalQty, displaySku: finalItem.id, qtyTip: finalTip || "", group: group, originalId: finalItem.id });
                    }
                } else {
                    let finalTip = tip;
                    if (tip && tip.includes('|||')) finalTip = tip.split('|||').join('<hr style="margin:6px 0; border:none; border-top:1px dashed #4B5563;">');
                    bill.push({ ...finalItem, q: finalQty, sum: finalItem.price * finalQty, displaySku: finalItem.id, qtyTip: finalTip || "", group: group, originalId: finalItem.id });
                }
            });
        };
        let worksBill = [];
        const addToWorks = (name, qty, basePrice, unit, group = null) => {
            if (qty <= 0) return;
            if (this.state.deletedWorks && this.state.deletedWorks.includes(name)) return;
            // Проверяем, есть ли ручная цена
            let price = (this.state.customWorks && this.state.customWorks[name] !== undefined) ? this.state.customWorks[name] : basePrice;

            let existing = worksBill.find(x => x.name === name && x.group === group);
            if (existing) {
                existing.q += qty;
                existing.sum += price * qty;
            } else {
                worksBill.push({ name: name, q: qty, price: price, sum: price * qty, unit: unit, group: group });
            }
        };

        let h = "", sum = 0, globalIdx = 1, showSku = document.getElementById('chk_sku').checked;

        const flushBill = (title, warn) => {
            if (bill.length === 0) return;

            // Считаем сумму оборудования всегда
            let localSecTotal = 0;
            bill.forEach(i => { let lookupId = i.originalId || i.id; if (!this.state.optItems[lookupId]) localSecTotal += i.sum; });
            app.lastEqSum += localSecTotal;

            // Но рендерим HTML только если мы на вкладке Оборудования
            if (this.state.viewMode === 'works') { bill = []; return; }

            let groupTotals = {};
            bill.forEach(i => { if (i.group) { if (!groupTotals[i.group]) groupTotals[i.group] = 0; groupTotals[i.group] += i.sum; } });
            let secTotal = 0, rows = "";
            let titleHtml = title + (warn ? `<div class="warn-box">${warn}</div>` : "");
            h += `<tr class="row-sec"><td colspan="9">${titleHtml}</td></tr>`;
            let lastGroup = null;
            bill.forEach((i, arrIndex) => {
                let lookupId = i.originalId || i.id;
                let isOpt = this.state.optItems[lookupId];
                if (!isOpt) secTotal += i.sum;
                let isCollapsed = (!forceMerge && i.group && this.state.collapsedGroups.includes(i.group));
                let isSubSection = (i.group && i.group.match(/^\d+\.\d+/));
                const dashStyle = "1px dashed rgba(0, 0, 0, 0.2)";
                if (!forceMerge && i.group && i.group !== lastGroup) {
                    let icon = ""; if (i.group.includes("Газового")) icon = "🔥"; else if (i.group.includes("Электрического")) icon = "⚡"; else if (i.group.includes("Водонагревателя")) icon = "💧";
                    let arrow = isCollapsed ? "▶" : "⤵";
                    let txtUnit = isCollapsed ? "компл." : ""; let txtQty = isCollapsed ? "1" : ""; let txtSum = isCollapsed ? groupTotals[i.group].toLocaleString() : "";
                    let headStyle = "";
                    if (isSubSection) { headStyle = `style="background:var(--surface-light); border: ${dashStyle}; border-bottom: none; color:var(--text-main);"`; if (isCollapsed) headStyle = `style="background:var(--surface-light); border: ${dashStyle}; color:var(--text-main);"`; }
                    let titleColSpan = showSku ? 5 : 4;
                    rows += `<tr class="group-header" ${headStyle} onclick="app.toggleGroup('${i.group}')" title="Свернуть/Развернуть"><td colspan="${titleColSpan}" style="text-align:left; padding-left:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><b>${arrow} ${icon} ${i.group}</b></td><td class="col-unit" style="color:#9CA3AF; font-size:10px;">${txtUnit}</td><td class="col-qty" style="font-weight:700;">${txtQty}</td><td class="col-price"></td><td class="col-sum">${txtSum}</td></tr>`;
                    lastGroup = i.group;
                }
                let rowStyle = "";
                if (isCollapsed) { rowStyle = 'style="display:none;"'; }
                else if (!forceMerge && isSubSection) { let borders = `border-left: ${dashStyle}; border-right: ${dashStyle};`; let nextItem = bill[arrIndex + 1]; if (!nextItem || nextItem.group !== i.group) borders += ` border-bottom: ${dashStyle};`; else borders += " border-bottom: 1px solid var(--border);"; rowStyle = `style="background:var(--surface); ${borders}"`; }
                else if (!forceMerge && i.group) { if (i.group.includes("Газового") || i.group.includes("Электрического")) rowStyle = 'style="background-color: var(--primary-light);"'; }

                let optStyle = isOpt ? 'opacity: 0.4; text-decoration: line-through; filter: grayscale(1);' : '';
                if (optStyle) {
                    if (rowStyle) rowStyle = rowStyle.replace('style="', `style="${optStyle} `);
                    else rowStyle = `style="${optStyle}"`;
                }
                let tipHtml = i.qtyTip ? `<div class="tooltip-wrapper"><div class="info-icon">i</div><div class="tooltip-content">${i.qtyTip}</div></div>` : "";
                let qHtml = `<div class="qty-wrap">${i.q}${tipHtml} <span class="opt-btn" onclick="event.stopPropagation(); app.toggleOpt('${lookupId}')">${!isOpt ? '🗑️' : '➕'}</span></div>`;
                let imgContent = getImg(i);
                // lookupId hoisted above
                let hasAlts = (i.alts && i.alts.length > 0) || this.state.swaps[lookupId];
                let imgCellHtml = "";
                if (hasAlts) {
                    let isOpen = (this.state.showSwapFor === lookupId);
                    let wrapClass = isOpen ? "img-wrap show-swap-ui" : "img-wrap";
                    let svgIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path><path d="M16 21h5v-5"></path></svg>`;
                    imgCellHtml = `<td class="col-img swappable-cursor"><div class="${wrapClass}" onclick="app.toggleSwapUI('${lookupId}')" title="Нажмите, чтобы заменить"><div class="swap-cycle-btn" onclick="event.stopPropagation(); app.cycleSwap('${lookupId}')">${svgIcon}</div>${imgContent}</div></td>`;
                } else { imgCellHtml = `<td class="col-img">${imgContent}</td>`; }
                rows += `<tr ${rowStyle} onclick="this.classList.toggle('active-row')"><td class="col-idx">${globalIdx++}</td>${imgCellHtml}<td class="col-name">${i.name}</td><td class="col-sku col-art ${showSku ? '' : 'hidden-col'}">${i.displaySku}</td><td class="col-brand">${i.brand || 'STOUT'}</td><td class="col-unit">${i.unit || 'шт'}</td><td class="col-qty">${qHtml}</td><td class="col-price">${i.price.toLocaleString()}<span class="mob-mult" style="display:none;"> × ${i.q}</span></td><td class="col-sum">${i.sum.toLocaleString()}</td></tr>`;
            });
            h += rows + `<tr class="row-subtotal"><td colspan="9">Итого: ${secTotal.toLocaleString()} ₽</td></tr>`;
            sum += secTotal; bill = [];
        };

        const flushWorks = () => {
            if (worksBill.length === 0) return;

            // Считаем сумму работ всегда
            worksBill.forEach(w => { app.lastWorksSum += w.sum; });

            if (this.state.viewMode !== 'works') return; // Рендерим HTML только если выбраны работы

            let worksByGroup = {};
            worksBill.forEach(w => {
                let g = w.group || "Прочее";
                if (!worksByGroup[g]) worksByGroup[g] = [];
                worksByGroup[g].push(w);
            });

            let sortedGroups = Object.keys(worksByGroup).sort();
            for (let g of sortedGroups) {
                let secTotal = 0;
                worksByGroup[g].forEach(w => secTotal += w.sum);

                // Главный заголовок секции выводится всегда
                h += `<tr class="row-sec"><td colspan="9">${g}</td></tr>`;

                let rows = "";
                const dashStyle = "1px dashed rgba(0, 0, 0, 0.2)";
                let isCollapsed = false;

                // Логика тумблера "Объединять": выводим вложенный список только если он выключен
                if (!forceMerge) {
                    let groupId = 'works_' + g;
                    isCollapsed = (this.state.collapsedGroups.includes(groupId));
                    let arrow = isCollapsed ? "▶" : "⤵";
                    let icon = "🔧";

                    // ИСПРАВЛЕНИЕ ВЕРСТКИ: colspan = 2 (т.к. 3 колонки скрыты CSS-ом)
                    let titleColSpan = 2;

                    let txtUnit = isCollapsed ? "компл." : "";
                    let txtQty = isCollapsed ? "1" : "";
                    let txtSum = isCollapsed ? secTotal.toLocaleString() : "";

                    let headStyle = `style="background:var(--surface-light); border: ${dashStyle}; color:var(--text-main);"`;
                    if (!isCollapsed) headStyle = `style="background:var(--surface-light); border: ${dashStyle}; border-bottom: none; color:var(--text-main);"`;

                    rows += `<tr class="group-header" ${headStyle} onclick="app.toggleGroup('${groupId}')" title="Свернуть/Развернуть"><td colspan="${titleColSpan}" style="text-align:left; padding-left:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><b>${arrow} ${icon} Детализация</b></td><td class="col-unit" style="color:#9CA3AF; font-size:10px;">${txtUnit}</td><td class="col-qty" style="font-weight:700;">${txtQty}</td><td class="col-price"></td><td class="col-sum">${txtSum}</td></tr>`;
                }

                // Рендер самих строк
                worksByGroup[g].forEach((w, idx) => {
                    let rowStyle = "";
                    if (!forceMerge) {
                        if (isCollapsed) {
                            rowStyle = 'style="display:none;"';
                        } else {
                            let borders = `border-left: ${dashStyle}; border-right: ${dashStyle};`;
                            if (idx !== worksByGroup[g].length - 1) borders += ` border-bottom: ${dashStyle};`;
                            else borders += ` border-bottom: 1px solid var(--border);`;
                            rowStyle = `style="background:var(--surface); ${borders}"`;
                        }
                    }

                    rows += `<tr ${rowStyle} onclick="this.classList.toggle('active-row')"><td class="col-idx">${globalIdx++}</td><td class="col-img hidden-col"></td><td class="col-name"><span class="work-del-btn" onclick="event.stopPropagation(); app.deleteWork('${w.name}')" title="Удалить работу">✖</span>${w.name}</td><td class="col-sku col-art ${showSku ? '' : 'hidden-col'}">-</td><td class="col-brand hidden-col"></td><td class="col-unit">${w.unit}</td><td class="col-qty"><div class="qty-wrap">${w.q}</div></td><td class="col-price"><span class="price-edit" contenteditable="true" onblur="app.updateWorkPrice('${w.name}', this.innerText)" title="Изменить цену">${w.price.toLocaleString()}</span><span class="mob-mult" style="display:none;"> × ${w.q}</span></td><td class="col-sum">${w.sum.toLocaleString()}</td></tr>`;
                });

                h += rows + `<tr class="row-subtotal"><td colspan="9">Итого: ${secTotal.toLocaleString()} ₽</td></tr>`;
                sum += secTotal;
            }

            // Кнопка добавления своей работы (в едином стиле с оборудованием)
            h += `<tr class="hide-custom-work-btn no-print"><td colspan="9" style="padding:15px; text-align:center;">
                    <div onclick="app.addCustomWork()" style="display:inline-block; padding:10px 30px; border:2px dashed var(--border); border-radius:10px; color:var(--text-sec); cursor:pointer; font-weight:600; font-size:14px; transition:all 0.2s ease;" onmouseover="this.style.borderColor='var(--primary)'; this.style.color='var(--primary)'" onmouseout="this.style.borderColor='var(--border)'; this.style.color='var(--text-sec)'">
                        + Добавить свою работу
                    </div>
                  </td></tr>`;
        };

        // === 1. КОТЁЛ + ВОДОНАГРЕВАТЕЛЬ ===
        let selBoilers = [], boilerCnt = 0;
        ['gas', 'el'].forEach(ft => {
            if (this.state.fuels.includes(ft)) {
                let needed = parseFloat(pwr);
                let db = (ft === 'gas') ? catalog.boilers_gas : (this.state.boilerSeries === 'status' ? catalog.boilers_status : catalog.boilers_plus);
                let b = db.find(x => x.power >= needed);
                if (ft === 'el') {
                    if (!b && needed > 27) { let half = needed / 2; let b2 = db.find(x => x.power >= half); if (b2) { b2.alts = (this.state.boilerSeries === 'status') ? catalog.boilers_plus : catalog.boilers_status; addToBill(b2, 2, this.getDesc('boiler_el', needed)); selBoilers.push(b2, b2); } }
                    else { let t = b || db[db.length - 1]; t.alts = (this.state.boilerSeries === 'status') ? catalog.boilers_plus : catalog.boilers_status; addToBill(t, 1, this.getDesc('boiler_el', needed)); selBoilers.push(t); }
                } else if (ft === 'gas') {
                    let t = (needed > 31) ? db.find(x => x.id === "100022963") : (b || db.find(x => x.id === "100022963"));
                    let q = (needed > 31) ? 2 : 1; addToBill(t, q, this.getDesc('boiler_gas', needed)); for (let k = 0; k < q; k++) selBoilers.push(t);
                }
            }
        });
        boilerCnt = selBoilers.length;

        if (this.state.hotWater) {
            let hw_fixtures_vol = 0;
            // Считаем потребность по санузлам (60°C вода)
            if (this.state.water && this.state.waterZones) {
                let b = 0, s = 0, bs = 0;
                this.state.waterZones.forEach(z => { b += (z.fixtures.bath || 0); s += (z.fixtures.shower || 0); bs += (z.fixtures.basin || 0); });
                hw_fixtures_vol = (b * 120) + (s * 50) + (bs * 10);
            }

            let volByRes = this.state.res >= 10 ? 500 : this.state.res >= 7 ? 300 : this.state.res >= 5 ? 200 : this.state.res >= 3 ? 150 : 100;
            let targetVol = Math.max(volByRes, hw_fixtures_vol);

            let vol = 100;
            if (targetVol > 100 && targetVol <= 150) vol = 150;
            else if (targetVol > 150 && targetVol <= 200) vol = 200;
            else if (targetVol > 200 && targetVol <= 300) vol = 300;
            else if (targetVol > 300) vol = 500;

            let tankDb = (this.state.boilerType === 'optibase') ? catalog.tanks_optibase : catalog.tanks_standard;
            let t = tankDb.find(x => x.vol === vol) || tankDb[tankDb.length - 1];
            t.alts = [catalog.tanks_optibase[0], catalog.tanks_standard[0]];

            let warn = targetVol > 500 ? `<br><b style="color:#EF4444; font-size:10px;">⚠️ Требуемый объем ГВС превышает 500л! Добавьте в смету второй бойлер вручную или проверьте количество потребителей ГВС.</b>` : "";

            addToBill(t, 1, this.getDesc('boiler_tank', this.state.res, vol, hw_fixtures_vol) + warn);
        }
        flushBill("1. Котёл + водонагреватель");

        // === 2. ОБВЯЗКА КОТЕЛЬНОЙ ===
        selBoilers.forEach(b => {
            if (b.type === 'gas') {
                let grp = "2.1. Обвязка Газового котла";
                addToBill(catalog.chimneys[0], 1, this.getDesc('chimney'), grp);
                addToBill(catalog.stabs[0], 1, this.getDesc('stab'), grp);
                addToBill(catalog.american_34, 2, "Разъемное соед.", grp);
                addToBill(catalog.ball_valve_34, 2, "Запорная арматура.", grp);
                addToBill(catalog.filter_mag, 1, "Защита от шлама.", grp);
                if (this.state.hotWater) { addToBill(catalog.valves[0], 1, this.getDesc('fugas'), grp); addToBill(catalog.nipple_34, 2, "Для фугаса.", grp); }
                if (selBoilers.length > 1) addToBill(catalog.check_valve_34, 1, "Обратный клапан.", grp);
            }
        });
        selBoilers.forEach(b => {
            if (b.type !== 'gas') {
                let grp = "2.2. Обвязка Электрического котла";
                let s = b.power <= 18 ? catalog.stabs[1] : catalog.stabs[2]; addToBill(s, 1, this.getDesc('stab'), grp);
                addToBill(catalog.american_34, 2, "Разъемное соед.", grp);
                addToBill(catalog.ball_valve_34, 2, "Запорная арматура.", grp);
                addToBill(catalog.filter_mag, 1, "Защита от шлама.", grp);
                if (this.state.hotWater) { addToBill(catalog.valves[0], 1, this.getDesc('fugas'), grp); addToBill(catalog.nipple_34, 2, "Для фугаса.", grp); }
                if (selBoilers.length > 1) addToBill(catalog.check_valve_34, 1, "Обратный клапан.", grp);
            }
        });
        if (this.state.hotWater) {
            let grp = "2.3. Обвязка Водонагревателя";
            let vol = this.state.res >= 10 ? 500 : this.state.res >= 7 ? 300 : this.state.res >= 5 ? 200 : this.state.res >= 3 ? 150 : 100;
            let exp = catalog.exp_dhw.find(x => x.vol >= vol * 0.1) || catalog.exp_dhw[2];
            addToBill(exp, 1, this.getDesc('exp_d', vol, exp.vol), grp);
            addToBill(catalog.tank_mount, 1, "Крепление", grp); addToBill(catalog.tank_kit, 1, "Подключение бака", grp);
            addToBill(catalog.dhw_fittings[0], 2, "Американка 1\" (Змеевик)", grp); addToBill(catalog.dhw_fittings[1], 2, "Кран 1\" (Змеевик)", grp);
            addToBill(catalog.dhw_fittings[2], 1, "Американка 3/4\" (ГВС)", grp); addToBill(catalog.dhw_fittings[3], 1, "Кран 3/4\" (ГВС)", grp);
            addToBill(catalog.dhw_fittings[4], 1, "Клапан 6 бар", grp); addToBill(catalog.dhw_fittings[5], 1, "Крестовина 3/4\"", grp); addToBill(catalog.dhw_fittings[6], 1, "Клапан обратный (ХВС)", grp); addToBill(catalog.dhw_fittings[7], 1, "Кран 3/4\" (ХВС)", grp);
            if (this.state.recirc) { addToBill(catalog.dhw_pump[0], 1, "Насос ГВС", grp); addToBill(catalog.dhw_fittings[2], 1, "Американка 3/4\" (Рецирк.)", grp); addToBill(catalog.dhw_fittings[3], 1, "Кран 3/4\" (Рецирк.)", grp); addToBill(catalog.dhw_fittings[6], 1, "Обратный клапан (Рецирк.)", grp); }
        }
        let hasRad = this.state.systems.includes('rad');
        let hasTp = this.state.systems.includes('tp');
        let radSecs = 0, radMeters = 0, tpMeters = 0;
        let tpArea = this.state.tp1 + this.state.tp2;
        if (hasRad) { let load = (hasTp && tpArea > 0) ? pwr * 1000 * 0.7 : pwr * 1000; radSecs = Math.ceil(load / 117); if (radSecs > 0) { let pipe = Math.ceil(this.state.win * (Math.sqrt(this.state.area / (this.state.floors === 2 ? 2 : 1)) + 3) * 1.1); radMeters = pipe * 2; } }
        tpMeters = hasTp ? tpArea * 7 : 0;
        // Заранее считаем необходимое количество коллекторов ТП
        let estMans = 0;
        if (hasTp && tpArea > 0) {
            let l1 = this.state.tp1 > 0 ? Math.ceil((this.state.tp1 * 7) / 85) : 0; if (l1 === 1) l1 = 2;
            let l2 = this.state.tp2 > 0 ? Math.ceil((this.state.tp2 * 7) / 85) : 0; if (l2 === 1) l2 = 2;
            if (l1 > 0) estMans += Math.ceil(l1 / 12);
            if (l2 > 0) estMans += Math.ceil(l2 / 12);
        }

        // Эко-схема (локальные узлы) ставится, если нет радиаторов и коллекторов ТП не больше 2-х
        let useEco = (!hasRad && hasTp && estMans <= 2);

        // Логика расчета насосных групп
        let rQ = 0, tQ = 0;
        if (hasRad) {
            // Если есть радиаторы и дом большой/2 этажа - ставим группы на радиаторы
            if (this.state.area > 150 || this.state.floors === 2 || pwr > 20) {
                rQ = (this.state.floors === 2) ? 2 : 1;
            }
        }

        if (hasTp && tpArea > 0) {
            // Если Эко-схема, в котельной группы ТП не ставим. Иначе - ставим по группе на каждый коллектор ТП (но минимум 1).
            tQ = useEco ? 0 : (estMans > 0 ? estMans : 1);
        }

        // Коллектор нужен, если общих групп быстрого монтажа >= 2
        let needCollector = (rQ + tQ) >= 2;

        // Расчет объема системы (для бака)
        let boilersVol = 0; if (selBoilers.length > 0) { selBoilers.forEach(b => { boilersVol += (b.vol !== undefined ? b.vol : 6); }); }
        let vSys = (boilersVol + radSecs * 0.25 + radMeters * 0.11 + tpMeters * 0.113 + (needCollector ? 5 : 0)) * 1.15;
        let reqExp = vSys * 0.12; let bltin = 0; if (selBoilers.length > 0) { selBoilers.forEach(b => { bltin += (b.exp !== undefined ? b.exp : 0); }); }
        let def = reqExp - bltin; if (def > 0) { let et = catalog.exp_heating.find(t => t.vol >= def) || catalog.exp_heating[4]; addToBill(et, 1, this.getDesc('exp_h', Math.round(vSys))); if (et.vol <= 25) addToBill(catalog.tank_mount, 1, "Крепление бака."); addToBill(catalog.tank_kit, 1, "Подключение бака."); }

        // Вывод оборудования котельной
        if (!useEco) {
            let big = (pwr > 30 || tpArea > 120);
            let dn25 = big;
            let pmp = null;

            // Добавляем коллектор/стрелку только если нужно
            if (needCollector) {
                let circuits = rQ + tQ;
                let idx = (circuits > 2) ? 1 : 0;
                if (dn25) {
                    let item = catalog.hydro_dn25[idx]; addToBill(item, 1, "Гидравлическая развязка (DN25).");
                } else {
                    if (this.state.hydroType === 'combo') {
                        let item = catalog.hydro_dn20[idx]; item.alts = catalog.hydro_modular_dn20; addToBill(item, 1, "Коллектор-гидрострелка (Комби).");
                    } else {
                        let item = catalog.hydro_modular_dn20[idx]; item.alts = catalog.hydro_dn20; addToBill(item, 1, "Распр. коллектор."); addToBill(catalog.hydro_arrow, 1, "Гидравлическая стрелка.");
                    }
                }
            }

            let grps = dn25 ? catalog.groups_dn25 : catalog.groups_dn20;
            if (dn25) {
                let activePump = catalog.pumps_dn25.find(p => p.type === this.state.pumpType) || catalog.pumps_dn25[0]; activePump.alts = catalog.pumps_dn25; pmp = activePump;
            } else {
                pmp = catalog.pumps_dn20[0];
            }

            // Добавляем группы и насосы ТОЛЬКО если они рассчитаны и нужен коллектор
            // Если коллектора нет (1 группа), то группа обычно не ставится, насос берется встроенный в котел или ставится отдельно на трубу (здесь упрощение: если нет коллектора, группы не ставим)
            if (needCollector) {
                if (rQ > 0) {
                    addToBill(grps[0], rQ, "Группа прямая (Радиаторы).");
                }
                if (tQ > 0) {
                    addToBill(grps[1], tQ, "Группа смесительная (ТП).");
                }
                if ((rQ + tQ) > 0) addToBill(pmp, rQ + tQ, this.getDesc('pump_std'));
            }
        }
        flushBill("2. Обвязка котельной");

        if (hasRad && radSecs > 0) {
            let totalRadCount = 0;
            let totalConvCount = 0;
            let totalVartronic = 0;
            let heatLoadTotal = Math.round((hasTp && tpArea > 0) ? pwr * 700 : pwr * 1000);

            if (this.state.detailedRooms && this.state.rooms && this.state.rooms.length > 0) {
                this.state.rooms.forEach(r => {
                    let roomSCQCount = 0;

                    // 1. Физика: Базовые потери коробки (учитываем высоту)
                    let rHeight = (r.floor === 2) ? (this.state.h2 || 2.7) : (this.state.h1 || 2.7);
                    let heightCoef = rHeight / 2.7;
                    let baseRoomLoad = (r.area * heightCoef * 70 * (this.state.region / 100) * this.state.mat);

                    let roomHasTp = r.sys && r.sys.includes('tp');
                    let roomHasRad = !r.sys || r.sys.includes('rad');
                    if (roomHasTp) baseRoomLoad = baseRoomLoad * 0.7; // Локальный ТП забирает 30% теплопотерь

                    r.windows.forEach((w, wIdx) => {
                        // 2. Физика: Теплопотери через площадь стекла
                        let wHeight = w.isPan ? 2.5 : 1.5;
                        let wArea = parseFloat(w.width || 1) * wHeight;
                        let windowHeatLoss = wArea * 150 * (this.state.region / 100) * this.state.mat;

                        // 3. Итоговая нагрузка: окно + доля стен
                        let wLoad = windowHeatLoss + (baseRoomLoad / r.windows.length);

                        let locInfo = `<span style="font-size:11px; line-height:1.2;">• <b>${r.name} (Окно ${wIdx + 1})</b>: ${w.width}м | Потери: <b>${Math.round(wLoad)} Вт</b></span>`;

                        if (w.isPan) {
                            let reqPower70 = wLoad / 0.65;
                            let db = this.state.convectorType === 'scn' ? catalog.convectors_scn : catalog.convectors_scq;
                            let item = db.find(x => x.power70 >= reqPower70 && x.len >= w.width * 0.7);
                            if (!item) item = db[db.length - 1];
                            item.alts = [catalog.convectors_scq[0], catalog.convectors_scn[0]];

                            let factPower = Math.round(item.power70 * 0.65);

                            if (factPower < Math.round(wLoad)) {
                                app.tempWarns.push(`• <b>${r.name} (Окно ${wIdx + 1}):</b> дефицит конвектора ~${Math.round(wLoad) - factPower} Вт. Переключите на вентиляторную модель (SCQ).`);
                            }

                            let devInfo = this.getDesc('convector', item.power70, factPower);
                            let cDesc = locInfo + "|||" + devInfo;

                            addToBill(item, 1, cDesc, "3. Приборы отопления");
                            totalConvCount++;
                            if (this.state.convectorType === 'scq') roomSCQCount++;
                        } else if (roomHasRad) {
                            let isRommer = (this.state.brandMode === 'rommer');
                            let reqPwr = Math.round(wLoad);
                            let p50_space = (isRommer && catalog.rads[0].rommer) ? (catalog.rads[0].rommer.power50 || 117) : 117;
                            let p50_titan = (isRommer && titanRads[0].rommer) ? (titanRads[0].rommer.power50 || 128) : 128;

                            let reqSecsSpace = Math.max(4, Math.ceil(reqPwr / p50_space));
                            if ((reqSecsSpace * 0.08) < w.width * 0.7) reqSecsSpace = Math.max(reqSecsSpace, Math.ceil((w.width * 0.7) / 0.08));
                            if (reqSecsSpace > 14) reqSecsSpace = 14;
                            let itemSpace = catalog.rads.find(x => x.sec === reqSecsSpace) || catalog.rads[catalog.rads.length - 1];

                            let reqSecsTitan = Math.max(4, Math.ceil(reqPwr / p50_titan));
                            if ((reqSecsTitan * 0.08) < w.width * 0.7) reqSecsTitan = Math.max(reqSecsTitan, Math.ceil((w.width * 0.7) / 0.08));
                            if (reqSecsTitan > 14) reqSecsTitan = 14;
                            let itemTitan = titanRads.find(x => x.sec === reqSecsTitan) || titanRads[titanRads.length - 1];

                            let bestPanel = steelRads.find(s => s.power50 >= reqPwr && (s.sec / 1000) >= w.width * 0.7) || steelRads.find(s => s.power50 >= reqPwr) || steelRads[steelRads.length - 1];

                            let altsList = [itemSpace, itemTitan, bestPanel];
                            itemSpace.alts = altsList; itemTitan.alts = altsList; bestPanel.alts = altsList;

                            let activeItem, factPower;
                            if (this.state.radType === 'steel') {
                                activeItem = bestPanel; factPower = bestPanel.power50;
                            } else if (this.state.radType === 'titan') {
                                activeItem = itemTitan; factPower = itemTitan.sec * p50_titan;
                            } else {
                                activeItem = itemSpace; factPower = itemSpace.sec * p50_space;
                            }

                            if (factPower < reqPwr) {
                                app.tempWarns.push(`• <b>${r.name} (Окно ${wIdx + 1}):</b> дефицит мощности радиатора ~${reqPwr - factPower} Вт.`);
                            }

                            let devInfo = app.getDesc('rad_tooltip', {
                                item: activeItem,
                                isRommer: isRommer,
                                demand: reqPwr,
                                fact: factPower,
                                count: 1,
                                win: 1,
                                demandLabel: "Потребность на окно"
                            });

                            let wDesc = locInfo + "|||" + devInfo;
                            addToBill(activeItem, 1, wDesc, "3. Приборы отопления");
                            totalRadCount++;
                        }
                    });
                    if (roomSCQCount > 0) { totalVartronic += Math.ceil(roomSCQCount / 12); }
                });
            } else {
                let win = this.state.win;
                let isRommer = (this.state.brandMode === 'rommer');
                let p50_space = (isRommer && catalog.rads[0].rommer) ? (catalog.rads[0].rommer.power50 || 117) : 117;
                let p50_titan = (isRommer && titanRads[0].rommer) ? (titanRads[0].rommer.power50 || 128) : 128;
                let loadPerWindow = heatLoadTotal / win;

                let totalSecSpace = Math.ceil(heatLoadTotal / p50_space);
                let countSpace = Math.max(win, Math.ceil(totalSecSpace / 14));
                let secPerRadSpace = Math.max(4, Math.min(14, Math.ceil(totalSecSpace / countSpace)));
                let itemSpace = catalog.rads.find(x => x.sec === secPerRadSpace) || catalog.rads[catalog.rads.length - 1];

                let totalSecTitan = Math.ceil(heatLoadTotal / p50_titan);
                let countTitan = Math.max(win, Math.ceil(totalSecTitan / 14));
                let secPerRadTitan = Math.max(4, Math.min(14, Math.ceil(totalSecTitan / countTitan)));
                let itemTitan = titanRads.find(x => x.sec === secPerRadTitan) || titanRads[titanRads.length - 1];

                let bestPanel = steelRads.find(s => s.power50 >= loadPerWindow) || steelRads[steelRads.length - 1];
                let countSteel = Math.max(win, Math.ceil(heatLoadTotal / bestPanel.power50));

                let altsList = [itemSpace, itemTitan, bestPanel];
                itemSpace.alts = altsList; itemTitan.alts = altsList; bestPanel.alts = altsList;

                let activeItem, factPowerTotal, totalCount;

                if (this.state.radType === 'steel') {
                    activeItem = bestPanel; totalCount = countSteel; factPowerTotal = activeItem.power50 * totalCount;
                } else if (this.state.radType === 'titan') {
                    activeItem = itemTitan; totalCount = countTitan; factPowerTotal = activeItem.sec * p50_titan * totalCount;
                } else {
                    activeItem = itemSpace; totalCount = countSpace; factPowerTotal = activeItem.sec * p50_space * totalCount;
                }
                totalRadCount = totalCount;

                let devInfo = app.getDesc('rad_tooltip', {
                    item: activeItem,
                    isRommer: isRommer,
                    demand: heatLoadTotal,
                    fact: factPowerTotal,
                    count: totalCount,
                    win: win,
                    demandLabel: "Потребность дома"
                });

                addToBill(activeItem, totalCount, devInfo, "3. Приборы отопления");
            }

            // Обвязка РАДИАТОРОВ (только для обычных окон)
            if (totalRadCount > 0) {
                let grp = "3.1. Обвязка радиаторов";
                let activeHead = catalog.heads.find(h => h.type === this.state.headType) || catalog.heads[0]; activeHead.alts = catalog.heads; addToBill(activeHead, totalRadCount, this.getDesc('rad_head'), grp);
                if (activeHead.type === 'smart') { let radHubs = Math.ceil(totalRadCount / 15); addToBill(catalog.smart_hub, radHubs, `Шлюз Zigbee.`, grp); }
                let activeHValve = catalog.h_valves.find(v => v.type === this.state.connectionType) || catalog.h_valves[0]; activeHValve.alts = catalog.h_valves; addToBill(activeHValve, totalRadCount, this.getDesc('rad_valves'), grp);
                if (this.state.radType === 'steel' && !this.state.detailedRooms) { addToBill(catalog.rad_kits[0], totalRadCount * 2, "Ниппель переходной.", grp); }
                if (activeHValve.id === 'SVH-0002-000020') { addToBill(catalog.rad_tube_set[0], totalRadCount * 2, "Трубка Г-образная.", grp); addToBill(catalog.rad_tube_set[1], totalRadCount, "Скоба фиксатор.", grp); addToBill(catalog.rad_tube_set[2], totalRadCount * 2, "Гильза 16.", grp); addToBill(catalog.rad_tube_set[3], totalRadCount * 2, "Фитинг компрессионный.", grp); }
                addToBill(catalog.parts[1], totalRadCount * 2, "Евроконус 16 (Рад).", grp); addToBill(catalog.parts[2], totalRadCount * 2, "Фиксатор 90°.", grp); addToBill(catalog.protective_sleeves[0], totalRadCount, "Втулка (под).", grp); addToBill(catalog.protective_sleeves[1], totalRadCount, "Втулка (обр).", grp); addToBill(catalog.label_kits[0], 1, "Наклейки.", grp);
            }

            // Обвязка КОНВЕКТОРОВ (строго без биноклей)
            if (totalConvCount > 0) {
                let grpC = "3.2. Обвязка конвекторов";

                let isAngled = (this.state.convConnectionType === 'angled');
                let vSupply = isAngled ? catalog.conv_valves[2] : catalog.conv_valves[0];
                let vReturn = isAngled ? catalog.conv_valves[3] : catalog.conv_valves[1];

                vSupply.alts = [catalog.conv_valves[0], catalog.conv_valves[2]];
                vReturn.alts = [catalog.conv_valves[1], catalog.conv_valves[3]];

                addToBill(vSupply, totalConvCount, "На подачу в конвектор.", grpC);
                addToBill(vReturn, totalConvCount, "На обратку из конвектора.", grpC);

                addToBill(catalog.conv_parts[0], totalConvCount * 2, "Монтажная гильза.", grpC);
                addToBill(catalog.conv_parts[1], totalConvCount * 2, "Переходник на резьбу 1/2.", grpC);

                if (this.state.convectorType === 'scq') {
                    // Для вентиляторных
                    addToBill(catalog.actuators, totalConvCount, "На термостатический клапан.", grpC);
                    if (totalVartronic > 0) {
                        addToBill(catalog.conv_parts[2], totalVartronic, "Настенный регулятор Vartronic (1 шт на комнату, до 12 шт).", grpC);
                    } else if (!this.state.detailedRooms) {
                        addToBill(catalog.conv_parts[2], 1, "Настенный регулятор Vartronic.", grpC);
                    }
                }
                // Для естественной конвекции (SCN) автоматика не выводится
            }

            let totalDevicesCount = totalRadCount + totalConvCount;
            let floorArea = this.state.area / (this.state.floors === 2 ? 2 : 1); let avgRun = Math.sqrt(floorArea) + 3; let totalMeters = totalDevicesCount * avgRun * 1.1; let neededPipe = Math.ceil(totalMeters);
            let pipeGrp = "3.3. Трубы отопления";
            if (neededPipe > 0) {
                if (this.state.pipeType === 'insulated') {
                    let coils = Math.ceil(neededPipe / 100); let halfCoils = Math.ceil(coils / 2);
                    let itemRed = catalog.insulated_pipes[0]; itemRed.alts = catalog.rad_pipes_grey; addToBill(itemRed, halfCoils, `Труба в красной изол.`, pipeGrp);
                    let itemBlue = catalog.insulated_pipes[1]; itemBlue.alts = catalog.rad_pipes_grey; addToBill(itemBlue, halfCoils, `Труба в синей изол.`, pipeGrp);
                } else {
                    let grayItem = (neededPipe > 200) ? catalog.rad_pipes_grey[1] : catalog.rad_pipes_grey[0]; grayItem.alts = catalog.insulated_pipes; addToBill(grayItem, Math.ceil(neededPipe / grayItem.len), this.getDesc('rad_pipe', neededPipe), pipeGrp);
                    let insLen = Math.ceil(neededPipe / 2); if (insLen % 2 !== 0) insLen++; addToBill(catalog.insulation[0], insLen, "Изоляция красная.", pipeGrp); addToBill(catalog.insulation[1], insLen, "Изоляция синяя.", pipeGrp);
                }
            }

            let reqLoops = (this.state.floors === 2 ? Math.ceil(totalDevicesCount / 2) : totalDevicesCount); if (reqLoops > 12) reqLoops = 12; let manifoldsCount = (this.state.floors === 2) ? 2 : 1;
            if (this.state.radManifoldType === 'standard') { let m = catalog.manifolds_rad.find(x => x.loops === reqLoops) || catalog.manifolds_rad[catalog.manifolds_rad.length - 1]; if (m) { m.alts = [catalog.manifolds_chrome_blocks[0]]; addToBill(m, manifoldsCount, this.getDesc('manifold', totalDevicesCount, 'rad'), pipeGrp); } }
            else {
                const assemblyMap = { 2: [0, 0, 1], 3: [0, 1, 0], 4: [1, 0, 0], 5: [0, 1, 1], 6: [0, 2, 0], 7: [1, 1, 0], 8: [2, 0, 0], 9: [1, 1, 1], 10: [1, 2, 0], 11: [2, 1, 0], 12: [3, 0, 0] }; let plan = assemblyMap[reqLoops] || [3, 0, 0]; let b4 = catalog.manifolds_chrome_blocks[2]; let b3 = catalog.manifolds_chrome_blocks[1]; let b2 = catalog.manifolds_chrome_blocks[0]; let stdAlt = catalog.manifolds_rad.find(x => x.loops === reqLoops) || catalog.manifolds_rad[0];[b4, b3, b2].forEach(b => b.alts = [stdAlt]); let multiplier = manifoldsCount * 2;
                if (plan[0] > 0) addToBill(b4, plan[0] * multiplier, `Блок 4 вых.`, pipeGrp); if (plan[1] > 0) addToBill(b3, plan[1] * multiplier, `Блок 3 вых.`, pipeGrp); if (plan[2] > 0) addToBill(b2, plan[2] * multiplier, `Блок 2 вых.`, pipeGrp); addToBill(catalog.manifold_brackets, manifoldsCount, "Кронштейны.", pipeGrp);
            }

            addToWorks("Монтаж радиатора отопления", totalRadCount, workPrices.rad_point, "точка", "1.2 Монтаж радиаторного отопления");
            if (totalConvCount > 0) addToWorks("Монтаж внутрипольного конвектора", totalConvCount, 8500, "шт", "1.2 Монтаж радиаторного отопления");
            if (manifoldsCount > 0) addToWorks("Монтаж коллектора радиаторов", manifoldsCount, workPrices.manifold, "шт", "1.2 Монтаж радиаторного отопления");
        }

        let heatWarnHtml = null;
        if (app.tempWarns && app.tempWarns.length > 0) {
            let hasConvWarn = app.tempWarns.some(w => w.includes('конвектора'));
            let hasRadWarn = app.tempWarns.some(w => w.includes('радиатора'));
            let advice = "";
            if (hasConvWarn && !hasRadWarn) advice = "Для компенсации теплопотерь измените тип приборов (например, нажмите 🔄 для переключения конвектора SCN на вентиляторный SCQ).";
            else if (!hasConvWarn && hasRadWarn) advice = "Для компенсации теплопотерь добавьте дополнительные радиаторы в проблемные помещения.";
            else advice = "Для компенсации теплопотерь измените тип конвекторов (SCN на SCQ) или добавьте дополнительные радиаторы в проблемные помещения.";

            heatWarnHtml = `⚠️ <b>ВНИМАНИЕ: Нехватка мощности отопления!</b><br>` + app.tempWarns.join('<br>') + `<br><span style="font-weight: 500; display:block; margin-top:6px;">${advice}</span>`;
        }
        flushBill("3. Приборы отопления", heatWarnHtml);

        if (hasTp && tpMeters > 0) {
            let q5 = Math.floor(tpMeters / 500); let q1 = Math.ceil((tpMeters % 500) / 100);
            if (q5) addToBill(catalog.pipes[1], q5, this.getDesc('ufh_pipe', tpMeters)); if (q1) addToBill(catalog.pipes[0], q1, this.getDesc('ufh_pipe', tpMeters));
            let loops = 0, mans = 0;
            const proc = (a, lbl) => {
                if (a <= 0) return; let l = Math.ceil((a * 7) / 85); if (l === 1) l = 2; loops += l; let n = Math.ceil(l / 12);
                for (let i = 0; i < n; i++) { let sz = Math.floor(l / n) + (i < (l % n) ? 1 : 0); let m = catalog.manifolds.find(x => x.loops === sz); if (m) { addToBill({ ...m, name: `Коллектор ТП ${sz} вых (${lbl})` }, 1, this.getDesc('manifold', sz, 'ufh')); mans++; if (useEco) { addToBill(catalog.mixing_units[0], 1, this.getDesc('ufh_mix')); addToBill(catalog.pumps_mix[0], 1, this.getDesc('pump_std')); } } }
            };
            proc(this.state.tp1, "1 этаж"); proc(this.state.tp2, "2 этаж");
            addToBill(catalog.parts[0], mans * 2, "Концевые фитинги."); addToBill(catalog.parts[3], loops * 2, "Евроконус 16 (ТП)."); addToBill(catalog.parts[2], loops * 2, "Фиксатор 90°.");
            addToBill(catalog.protective_sleeves[0], loops, "Втулка красная."); addToBill(catalog.protective_sleeves[1], loops, "Втулка синяя."); addToBill(catalog.label_kits[1], 1, "Наклейки.");
            let grpIns = "4.1. УТЕПЛИТЕЛЬ И КРЕПЁЖ";
            if (this.state.ufhBaseType === 'mat') { let mt = catalog.mats[0]; mt.alts = [catalog.xps_kit[0]]; let mc = Math.ceil((tpArea / mt.area) * 1.05); addToBill(mt, mc, this.getDesc('ufh_mat', tpArea), grpIns); }
            else { let xpsItem = catalog.xps_kit[0]; xpsItem.alts = catalog.mats; let sheets = Math.ceil((tpArea / xpsItem.area) * 1.05); addToBill(xpsItem, sheets, this.getDesc('ufh_xps', tpArea), grpIns); let totalDowels = Math.ceil(tpArea * 5); addToBill(catalog.xps_kit[1], Math.ceil(totalDowels / 100), `Дюбеля.`, grpIns); let totalStaples = Math.ceil(tpMeters * 2.5); addToBill(catalog.xps_kit[2], Math.ceil(totalStaples / 25), `Скобы.`, grpIns); let tapeRolls = Math.ceil((sheets * 1.76 * 1.1) / 50); addToBill(catalog.xps_kit[3], tapeRolls, `Скотч.`, grpIns); }

            if (this.state.ufhAuto) {
                let grpAuto = "4.2. АВТОМАТИКА ТЁПЛОГО ПОЛА";
                addToBill(catalog.actuators, loops, this.getDesc('actuator'), grpAuto);
                let zones = this.state.ufhZones;
                let activeStatBase = (this.state.ufhCtrl === 'mech') ? catalog.ufh_mech[0] : catalog.ufh_electro[0];
                addToBill(activeStatBase, zones, this.getDesc('thermostat'), grpAuto);
                let cntByZones = Math.ceil(zones / 8); let cntByFloors = (this.state.floors === 2 && this.state.tp2 > 0) ? 2 : 1;
                let finalCnt = Math.max(cntByZones, cntByFloors);
                addToBill(catalog.wiring_center, finalCnt, "Коммутационный блок.", grpAuto);
            }

            let warn = null;
            if (!hasRad && tpArea > 0) {
                let f = (pwr * 1000) / tpArea;
                if (f > 75) {
                    warn = `⚠️ <b>ВНИМАНИЕ: Одного только тёплого пола может не хватить для обогрева!</b><br>
                            Расчетная потребность: <b>${Math.round(f)} Вт/м²</b> (комфортный предел теплоотдачи пола: до 75 Вт/м²).<br>
                            <span style="font-weight: 500;">Чтобы покрыть такие теплопотери в сильные морозы, пол придется нагревать выше санитарных норм (поверхность будет некомфортно горячей для ног). Настоятельно рекомендуется добавить радиаторы отопления.</span>`;
                }
            }
            flushBill("4. Водяной тёплый пол", warn);
        }

        if (this.state.water && this.state.waterZones.length > 0) {
            let mainTitle = "5. Внутреннее водоснабжение";
            let isMerge = this.state.mergeItems;
            let grpCold = isMerge ? mainTitle : "5. Внутреннее водоснабжение";
            let grpHot = isMerge ? mainTitle : "5.1. Внутреннее ГВС";
            let grpRecirc = isMerge ? mainTitle : "5.2. Рециркуляция";
            let grpGen = isMerge ? mainTitle : "5.3. Общие материалы";
            let totalColdPoints = 0, totalHotPoints = 0, totalToilets = 0;
            let totalPipeCold = 0, totalPipeHot = 0;
            let recirc = this.state.recirc;

            this.state.waterZones.forEach(z => {
                let f = z.fixtures;
                totalToilets += f.toilet;
                let cw_only = f.toilet + f.wash + f.dish;
                let mix = f.basin + f.shower + (f.bath || 0);
                let zoneCold = cw_only + mix;
                let zoneHot = mix;
                totalColdPoints += zoneCold;
                totalPipeCold += (z.dist * zoneCold * 1.1);
                if (recirc) {
                    totalHotPoints++;
                    if (zoneHot > 0) totalPipeHot += ((z.dist * 2) + (zoneHot * 2));
                } else {
                    totalHotPoints += zoneHot;
                    if (zoneHot > 0) totalPipeHot += (z.dist * zoneHot * 1.1);
                }
            });

            if (totalColdPoints > 0) {
                let needed = totalColdPoints, q4 = Math.floor(needed / 4), rem = needed % 4, q3 = 0, q2 = 0;
                if (rem === 3) q3 = 1; else if (rem === 2) q2 = 1; else if (rem === 1) { if (q4 > 0) { q4--; q3 = 1; q2 = 1 } else { q2 = 1 } }
                let descColl = this.getDesc('manifold', totalColdPoints, 'cw');
                if (q4) addToBill(catalog.water_manifolds_cold[2], q4, descColl, grpCold);
                if (q3) addToBill(catalog.water_manifolds_cold[1], q3, descColl, grpCold);
                if (q2) addToBill(catalog.water_manifolds_cold[0], q2, descColl, grpCold);
                addToBill(catalog.water_parts[0], totalColdPoints, this.getDesc('eurocone_water', totalColdPoints), grpCold);
                addToBill(catalog.water_parts[2], 1, "Заглушка коллектора", grpCold);
                let pLen = Math.ceil(totalPipeCold);
                addToBill(catalog.water_pipes[0], pLen, this.getDesc('pipe_cw', `${pLen} м`), grpCold);
                addToBill(catalog.water_insulation[1], pLen, this.getDesc('ins_blue', pLen), grpCold);
                let socketsCold = totalColdPoints - totalToilets;
                if (socketsCold > 0) {
                    addToBill(catalog.water_fittings[0], socketsCold, this.getDesc('socket', 'Тупиковая (ХВС)', socketsCold), grpCold);
                    addToBill(catalog.water_parts[7], socketsCold, this.getDesc('sleeve', '1 шт на розетку'), grpCold);
                    addToBill(catalog.water_fittings[4], socketsCold, "Пробка синяя (опрессовка)", grpCold);
                    addToBill(catalog.water_fittings[6], socketsCold, "Фиксатор 90°", grpCold);
                }
                if (totalToilets > 0) addToBill(catalog.water_fittings[8], totalToilets, "Фиксатор трубы (к инсталляции)", grpCold);
            }

            if (totalPipeHot > 0) {
                let needed = totalHotPoints, q4 = Math.floor(needed / 4), rem = needed % 4, q3 = 0, q2 = 0;
                if (rem === 3) q3 = 1; else if (rem === 2) q2 = 1; else if (rem === 1) { if (q4 > 0) { q4--; q3 = 1; q2 = 1 } else { q2 = 1 } }
                let descColl = this.getDesc('manifold', totalHotPoints, recirc ? 'hw_recirc' : 'hw_std');
                if (q4) addToBill(catalog.water_manifolds_hot[2], q4, descColl, grpHot);
                if (q3) addToBill(catalog.water_manifolds_hot[1], q3, descColl, grpHot);
                if (q2) addToBill(catalog.water_manifolds_hot[0], q2, descColl, grpHot);
                addToBill(catalog.water_parts[0], totalHotPoints, this.getDesc('eurocone_water', totalHotPoints), grpHot);
                addToBill(catalog.water_parts[2], 1, "Заглушка коллектора", grpHot);
                let pLen = Math.ceil(recirc ? (totalPipeHot / 2) : totalPipeHot);
                addToBill(catalog.water_pipes[0], pLen, this.getDesc('pipe_hw', `${pLen} м`), grpHot);
                addToBill(catalog.water_insulation[0], pLen, this.getDesc('ins_red', pLen), grpHot);
                let totalMixers = 0;
                this.state.waterZones.forEach(z => totalMixers += (z.fixtures.basin + z.fixtures.shower));
                if (totalMixers > 0) {
                    let socketItem = recirc ? catalog.water_fittings[1] : catalog.water_fittings[0];
                    let sName = recirc ? "Угольник проточный (Бронза)" : "Водорозетка тупиковая";
                    let sCount = recirc ? 2 : 1;
                    addToBill(socketItem, totalMixers, this.getDesc('socket', sName, totalMixers), grpHot);
                    addToBill(catalog.water_parts[7], totalMixers * sCount, this.getDesc('sleeve', `${sCount} шт на розетку`), grpHot);
                    addToBill(catalog.water_fittings[5], totalMixers, "Пробка красная (опрессовка)", grpHot);
                    let fixCount = recirc ? totalMixers * 2 : totalMixers;
                    addToBill(catalog.water_fittings[6], fixCount, "Фиксатор 90°", grpHot);
                }
            }

            if (recirc && totalHotPoints > 0) {
                let needed = totalHotPoints, q4 = Math.floor(needed / 4), rem = needed % 4, q3 = 0, q2 = 0;
                if (rem === 3) q3 = 1; else if (rem === 2) q2 = 1; else if (rem === 1) { if (q4 > 0) { q4--; q3 = 1; q2 = 1 } else { q2 = 1 } }
                let descColl = this.getDesc('manifold', totalHotPoints, 'recirc');
                if (q4) addToBill(catalog.water_manifolds_recirc[2], q4, descColl, grpRecirc);
                if (q3) addToBill(catalog.water_manifolds_recirc[1], q3, descColl, grpRecirc);
                if (q2) addToBill(catalog.water_manifolds_recirc[0], q2, descColl, grpRecirc);
                addToBill(catalog.water_parts[0], totalHotPoints, this.getDesc('eurocone_water', totalHotPoints), grpRecirc);
                addToBill(catalog.water_parts[2], 1, "Заглушка коллектора", grpRecirc);
                let pLen = Math.ceil(totalPipeHot / 2);
                addToBill(catalog.water_pipes[0], pLen, this.getDesc('pipe_hw', `${pLen} м (Обратка)`), grpRecirc);
                addToBill(catalog.water_insulation[0], pLen, this.getDesc('ins_red', pLen), grpRecirc);
            }

            let collGroups = (totalColdPoints > 0 ? 1 : 0) + (totalHotPoints > 0 ? 1 : 0) + (recirc ? 1 : 0);
            if (collGroups > 0) addToBill(catalog.manifold_brackets, collGroups, "Пара кронштейнов на каждый коллектор", grpGen);
            addToBill(catalog.water_parts[3], 1, "Наклейки", grpGen);
            let totalBrackets = 0;
            this.state.waterZones.forEach(z => { totalBrackets += (z.fixtures.basin + z.fixtures.shower + (z.fixtures.bath || 0) + z.fixtures.wash); });
            if (totalBrackets > 0) addToBill(catalog.water_fittings[3], totalBrackets, "Монтажная планка (Для смесителей)", grpGen);
            let allPipe = totalPipeCold + totalPipeHot;
            if (allPipe > 0) addToBill(catalog.water_fittings[8], Math.ceil(allPipe * 2), "Дюбель-крюк двойной", grpGen);

            if (isMerge) {
                flushBill(mainTitle);
            } else {
                flushBill(grpCold);
                flushBill(grpHot);
                flushBill(grpRecirc);
                flushBill(grpGen);
            }

            // === 6. СКВАЖИНА (Внешнее водоснабжение) ===
            if (this.state.well) {
                let grpWell = "6. Внешнее водоснабжение";
                let q = 0;
                if (this.state.waterZones && this.state.waterZones.length > 0) {
                    this.state.waterZones.forEach(z => {
                        q += (z.fixtures.toilet * 0.1) + (z.fixtures.basin * 0.15) + (z.fixtures.shower * 0.3) + ((z.fixtures.bath || 0) * 0.4) + (z.fixtures.wash * 0.2) + (z.fixtures.dish * 0.2);
                    });
                }
                if (q > 4.5) q = 4.5 + (q - 4.5) * 0.5;
                if (q < 1.5) q = 1.5;

                let floorsH = this.state.floors === 2 ? 3 : 0;
                let h = (this.state.wellDepth + (this.state.wellDist / 10) + floorsH + 30) * 1.1;

                let validPumps = catalog.well_pumps.filter(p => p.q_max >= (q * 0.9) && p.h_max >= (h + 20));
                let pump = validPumps.length > 0 ? validPumps[0] : catalog.well_pumps[catalog.well_pumps.length - 1];

                let pumpDesc = `<span style="font-size:11px; line-height:1.4;"><span style="font-weight:700; color:#93C5FD; display:block; margin-bottom:4px;">Скважинный насос ROMMER</span><b>Расчет:</b> Потребность ${q.toFixed(1)} м³/ч, Напор ${Math.round(h)} м.<br><b>Формула напора:</b> Глубина (${this.state.wellDepth}м) + Трасса/10 + Высота этажей + 30м (Давление) + 10% запас.<br><i>*Насос включает кабель питания.</i></span>`;

                addToBill(pump, 1, pumpDesc, grpWell);
                let grpWellTie = "6.1. Обвязка скважинного насоса";

                let activeAuto;
                let autoDesc = "";
                if (this.state.wellAutoType === 'sirio') {
                    activeAuto = catalog.well_auto.find(a => a.id === 'SCS-0001-000070');
                    autoDesc = `<span style="font-size:11px; line-height:1.4;"><b>Автоматика (Инвертор):</b> Частотный преобразователь STOUT SIRIO. Поддерживает идеальное давление (как в квартире) за счет плавного изменения оборотов насоса. Гарантирует плавный пуск, защищает от гидроударов и экономит ресурс двигателя.</span>`;
                } else if (this.state.wellAutoType === 'top') {
                    activeAuto = catalog.well_auto.find(a => a.id === 'SCS-0001-000063');
                    autoDesc = `<span style="font-size:11px; line-height:1.4;"><b>Автоматика (Премиум):</b> Цифровой контроллер STOUT BRIO-TOP. Настройка давления включения/выключения с кнопок, защита от сухого хода с авто-рестартом, защита от замерзания.</span>`;
                } else {
                    activeAuto = catalog.well_auto.find(a => a.id === 'SCS-0001-000064');
                    autoDesc = `<span style="font-size:11px; line-height:1.4;"><b>Автоматика (Базовая):</b> Электронное реле STOUT BRIO. Включает насос при падении давления и выключает при прекращении потока. Имеет базовую защиту от "сухого хода".</span>`;
                }
                if (!activeAuto) activeAuto = catalog.well_auto[0];
                addToBill(activeAuto, 1, autoDesc, grpWellTie);

                let t24 = catalog.well_parts.find(x => x.id === "STW-0001-000024");
                let t50 = catalog.well_parts.find(x => x.id === "STW-0002-000050");
                let t80 = catalog.well_parts.find(x => x.id === "STW-0002-000080");
                let t100 = catalog.well_parts.find(x => x.id === "STW-0002-000100");
                let t150 = catalog.well_parts.find(x => x.id === "STW-0002-000150");

                let tankVol = 50;
                let tankItem = t50;
                let tankDesc = "";

                if (this.state.wellAutoType === 'sirio') {
                    tankVol = 24;
                    tankItem = t24;
                    tankDesc = `<span style="font-size:11px; line-height:1.4;"><b>Назначение:</b> Компенсирует микро-утечки в системе.<br><b style="color:var(--primary);">Расчет:</b> ${tankVol} л. При использовании частотного преобразователя SIRIO большой гидроаккумулятор не требуется, так как насос работает плавно и подстраивается под любой расход.</span>`;
                } else {
                    if (q > 3.5) { tankVol = 150; tankItem = t150; }
                    else if (q > 2.5) { tankVol = 100; tankItem = t100; }
                    else if (q > 1.5) { tankVol = 80; tankItem = t80; }
                    let usefulVol = Math.round(tankVol * 0.33);
                    tankDesc = `<span style="font-size:11px; line-height:1.4;"><b>Назначение:</b> Создает запас воды (~${usefulVol} л) и защищает насос от губительных частых включений. Гасит гидроудары.<br><b style="color:var(--primary);">Расчет:</b> Емкость ${tankVol} л подобрана на основе расчетного пикового водоразбора (${q.toFixed(1)} м³/ч).</span>`;
                }

                if (tankItem) addToBill(tankItem, 1, tankDesc, grpWellTie);

                let cableLen = parseInt(this.state.wellDepth) + 3;
                let coilsCount = Math.ceil(cableLen / 250);
                let cableDesc = `<span style="font-size:11px; line-height:1.4;">Расчетная длина троса: <b>${cableLen} м</b>.<br>Трос 4 мм: Разрывная нагрузка ~920 кг.</span>`;
                addToBill(catalog.well_parts[1], coilsCount, cableDesc, grpWellTie);

                addToBill(catalog.well_parts[3], 1, 'Скважинный оголовок — предназначен для герметизации окончания обсадной трубы скважины с наружным диаметром от 125 до 133 мм после установки в нее погружного насоса с диаметром напорной трубы 32 мм.<br>выходное отверстие (внутренняя резьба): 1"', grpWellTie);

                let valveDesc = `<span style="font-size:11px; line-height:1.4;"><b>Назначение:</b> Удерживает столб воды в трубе при выключенном насосе, защищая систему от гидроударов.<br><b>Почему металлическое седло?</b> В отличие от клапанов с пластиковым внутренним механизмом, металлическое седло (золотник) выдерживает колоссальное давление воды в глубоких скважинах и не ломается при постоянных жестких включениях насоса.</span>`;
                addToBill(catalog.well_parts[4], 1, valveDesc, grpWellTie);

                let pipeLen = parseInt(this.state.wellDepth) + parseInt(this.state.wellDist) + 5;
                let pipePieces = Math.ceil(pipeLen / 5);
                let pipeDesc = `<span style="font-size:11px; line-height:1.4;">Расчетная длина: <b>${pipeLen} м</b>.<br><b>Почему 32х3.0 питьевая?</b> Стенка 3.0 мм (PN16) гарантированно выдерживает высокое давление глубоководного насоса без сплющивания и разрывов. Питьевая труба (из первичного полиэтилена с синей полосой) абсолютно безопасна для здоровья и не придает воде химический запах.</span>`;
                addToBill(catalog.well_parts[0], pipePieces, pipeDesc, grpWellTie);

                let muftaDesc = `<span style="font-size:11px; line-height:1.4;"><b>Назначение:</b> Компрессионный переходник для соединения пластиковой трубы с металлическим оборудованием.<br><b>Монтаж:</b> 2 штуки. Первая муфта вкручивается в обратный клапан насоса (внизу), вторая — в скважинный оголовок (наверху).</span>`;
                addToBill(catalog.well_parts[5], 2, muftaDesc, grpWellTie);

                let clipDesc = `<span style="font-size:11px; line-height:1.4;"><b>Монтаж:</b> По 2 зажима на каждую петлю (снизу у насоса и сверху у оголовка) для надежной фиксации и страховки.<br><b>Назначение:</b> Надежно фиксируют петли страховочного троса. Рекомендуется использовать зажимы, устойчивые к коррозии, чтобы избежать обрыва в агрессивной среде скважины.</span>`;
                addToBill(catalog.well_parts[2], 4, clipDesc, grpWellTie);

                let thimbleDesc = `<span style="font-size:11px; line-height:1.4;"><b>Назначение:</b> Вставляется внутрь петли троса. Защищает трос от перетирания и излома в местах крепления к насосу и оголовку.</span>`;
                addToBill(catalog.well_parts[6], 2, thimbleDesc, grpWellTie);

                flushBill(grpWell);
                flushBill(grpWellTie);
            }

            // === 7. КАНАЛИЗАЦИЯ ===
            if (totalToilets > 0) {
                let totalFixtures = 0;
                this.state.waterZones.forEach(z => {
                    totalFixtures += z.fixtures.toilet + z.fixtures.basin + z.fixtures.shower + (z.fixtures.bath || 0) + z.fixtures.wash + z.fixtures.dish;
                });
                addToBill(catalog.water_parts[6], totalToilets, this.getDesc('install'), "7. Канализация");
                flushBill("7. Канализация");
            }

            if (totalColdPoints > 0 || totalHotPoints > 0) {
                // ==========================================
                // БЛОК: 2.1 Внешнее водоснабжение
                // ==========================================
                let extWaterGroup = "2.1 Внешнее водоснабжение";
                if (this.state.hotWater) {
                    addToWorks("Подключение ХВС к бойлеру косвенного нагрева ГВС", 1, 5000, "компл", extWaterGroup);
                }
                if (this.state.well) {
                    addToWorks("Монтаж скважинного насоса (опуск, оголовок, автоматика)", 1, 15000, "компл", extWaterGroup);
                    addToWorks("Прокладка трубы ПНД в траншее", this.state.wellDist, 400, "м.p.", extWaterGroup);
                    addToWorks("Ввод воды в дом (греющий кабель, теплоизоляция)", 1, 5000, "компл", extWaterGroup);
                }

                // ==========================================
                // БЛОК: 2.2 Внутреннее водоснабжение
                // ==========================================
                let wGroup2 = "2.2 Внутреннее водоснабжение";
                if (totalColdPoints > 0) addToWorks("Точка присоединения ХВС (монтаж трубопроводов, водорозетки)", totalColdPoints, 3700, "точка", wGroup2);
                if (totalHotPoints > 0) addToWorks("Точка присоединения ГВС (монтаж трубопроводов, водорозетки)", totalHotPoints, 4500, "точка", wGroup2);
                if (this.state.recirc && totalHotPoints > 0) addToWorks("Точка присоединения рециркуляции ГВС", totalHotPoints, 3700, "точка", wGroup2);
                if (typeof collGroups !== 'undefined' && collGroups > 0) addToWorks("Установка и подключение коллектора системы водоснабжения", collGroups, 4500, "шт", wGroup2);

                // ==========================================
                // БЛОК: 3.1 Внутренняя канализация
                // ==========================================
                let totalFixtures = 0;
                this.state.waterZones.forEach(z => {
                    totalFixtures += z.fixtures.toilet + z.fixtures.basin + z.fixtures.shower + z.fixtures.wash + z.fixtures.dish;
                });

                let sewerGroup = "3.1 Внутренняя канализация";
                if (totalFixtures > 0) addToWorks("Монтаж труб канализации (без метража)", totalFixtures, 3500, "точка", sewerGroup);
                if (totalToilets > 0) addToWorks("Монтаж инсталляции унитаза", totalToilets, 8000, "шт", sewerGroup);
            }
        }

        // === 8. ДОПОЛНИТЕЛЬНЫЕ МАТЕРИАЛЫ ===
        let cl = catalog.coolants.find(c => c.type === this.state.coolant);
        if (cl) {
            if (cl.type === 'pro65') {
                let vP = vSys * 0.65; let vH = vSys * 0.35; let p1 = catalog.coolants[2]; let p2 = catalog.coolants[0];
                addToBill(p1, Math.ceil(vP / p1.vol), "Концентрат.", "8. Дополнительные материалы"); addToBill(p2, Math.ceil(vH / p2.vol), "Вода.", "8. Дополнительные материалы");
            } else {
                addToBill(cl, Math.ceil(vSys / cl.vol), this.getDesc('coolant', Math.round(vSys)), "8. Дополнительные материалы");
            }
        }
        flushBill("8. Дополнительные материалы");

        // 9. СВОЁ ОБОРУДОВАНИЕ (Только для вкладки оборудования)
        if (this.state.viewMode === 'equipment') {
            if (this.state.userAddedEq && this.state.userAddedEq.length > 0) {
                this.state.userAddedEq.forEach(eq => {
                    // Передаем объект как есть, без крестиков, выравнивание будет стандартным
                    let customEqItem = { ...eq, brand: " " };
                    addToBill(customEqItem, eq.q, eq.desc || "", "9. Своё оборудование");
                });
                flushBill("9. Своё оборудование");
            }

            // Кнопка добавления (со специальным классом no-print для скрытия при печати)
            h += `<tr class="hide-custom-eq-btn no-print"><td colspan="7" style="padding:15px; text-align:center;">
                    <div onclick="app.addCustomEqPrompt()" style="display:inline-block; padding:10px 30px; border:2px dashed var(--border); border-radius:10px; color:var(--text-sec); cursor:pointer; font-weight:600; font-size:14px; transition:all 0.2s ease;" onmouseover="this.style.borderColor='var(--primary)'; this.style.color='var(--primary)'" onmouseout="this.style.borderColor='var(--border)'; this.style.color='var(--text-sec)'">
                        + Добавить своё оборудование
                    </div>
                  </td></tr>`;
        }
        // ==========================================
        // БЛОК: 1.1 Монтаж котельной (Логика работ)
        // ==========================================
        let wGroup = "1.1 Монтаж котельной";

        // 1. Котлы и дымоудаление
        let gasCount = this.state.fuels.includes('gas') ? 1 : 0;
        let elCount = this.state.fuels.includes('el') ? 1 : 0;

        if (elCount > 0) addToWorks("Mонтаж электрического котла", elCount, 18000, "шт", wGroup);
        if (gasCount > 0) {
            addToWorks("Монтаж газового котла", gasCount, 20000, "шт", wGroup);
            addToWorks("Монтаж коаксиального дымохода", gasCount, 10000, "шт", wGroup);
            addToWorks("Монтаж отверстия под дымоход", gasCount, 6000, "шт", wGroup);
        }

        // 2. Бойлер и водоснабжение
        if (this.state.hotWater) {
            addToWorks("Монтаж водонагревателя / бойлера", 1, 9000, "шт", wGroup);
            addToWorks("Подключение бойлера косвенного нагрева (монтаж гидравлики)", 1, 12000, "компл", wGroup);
            addToWorks("Установка расширительного бака водоснабжения", 1, 4500, "шт", wGroup);
            addToWorks("Монтаж гидравлики ГВС (подпитка СО + подключение ГВС)", 1, 9000, "компл", wGroup);
            if (this.state.recirc) {
                addToWorks("Монтаж системы рециркуляции", 1, 8000, "компл", wGroup);
            }
        }

        if (this.state.water) {
            addToWorks("Монтаж гидравлики ХВС (узел ввода, фильтры, байпас)", 1, 20000, "компл", wGroup);
        }

        // 3. Распределительная гидравлика
        let isCombo = (this.state.systems.includes('rad') && this.state.systems.includes('tp'));
        if (isCombo) {
            addToWorks("Монтаж коллектора и гидрострелки", 1, 12000, "шт", wGroup);
            addToWorks("Монтаж насосной группы", 2, 6500, "шт", wGroup); // Группа на ТП и на Радиаторы
        } else if (this.state.systems.includes('tp')) {
            addToWorks("Монтаж узла смешения теплого пола", 1, 9000, "шт", wGroup);
        }

        // 4. Трассы (Магистрали)
        if (this.state.systems.includes('tp') && this.state.area > 0) {
            addToWorks("Монтаж ГИДРАВЛИКИ: от котла до коллектора т.пола", 1, 15000, "компл", wGroup);
        }
        if (this.state.systems.includes('rad')) {
            addToWorks("Монтаж ГИДРАВЛИКИ: от котла - магистральные трубопроводы радиаторов", 1, 9000, "компл", wGroup);
        }

        // 5. Общие и пусконаладочные работы
        addToWorks("Монтаж ГИДРАВЛИКИ: расширительные баки, предохранительные клапаны", 1, 9000, "компл", wGroup);
        addToWorks("Опрессовка котельной", 1, 5000, "компл", wGroup);
        addToWorks("Пусконаладка котельной", 1, 12000, "компл", wGroup);
        addToWorks("Монтаж электрики котельной", 1, 12000, "компл", wGroup);
        // ==========================================

        // ==========================================
        // БЛОК: 1.2 Монтаж радиаторного отопления
        // ==========================================
        let radGroup = "1.2 Монтаж радиаторного отопления";
        if (this.state.systems.includes('rad') && typeof activeCount !== 'undefined' && activeCount > 0) {
            addToWorks("Монтаж трубопроводов PEX-a... и подключение радиатора", activeCount, 6500, "шт", radGroup);

            if (typeof manifoldsCount !== 'undefined' && manifoldsCount > 0) {
                addToWorks("Установка коллектора для радиаторов", manifoldsCount, 6000, "пара", radGroup);

                // Если есть коллектор, добавляем шкаф (только если клиент не отключил их в настройках, проверим по bill)
                let radCabs = bill.filter(x => x.group === "Радиаторы" && x.name.toLowerCase().includes("шкаф")).reduce((sum, x) => sum + x.q, 0);
                if (radCabs > 0) addToWorks("Монтаж и обвязка распределительных шкафов", radCabs, 4000, "шт", radGroup);
            }
        }

        // ==========================================
        // БЛОК: 1.3 Монтаж водяного теплого пола
        // ==========================================
        let tpGroup = "1.3 Монтаж водяного теплого пола";
        if (this.state.systems.includes('tp') && typeof tpArea !== 'undefined' && tpArea > 0) {
            addToWorks("Монтаж труб водяного тёплого пола", tpArea, 450, "м²", tpGroup);
            addToWorks("Монтаж утеплителя для укладки ТП", tpArea, 390, "м²", tpGroup);

            if (typeof mans !== 'undefined' && mans > 0) {
                addToWorks("Установка и подключение коллектора теплого пола", mans, 6500, "пара", tpGroup);

                // Шкафы берем из фактического наличия в спецификации
                let tpCabs = bill.filter(x => x.group === "Тёплый пол" && x.name.toLowerCase().includes("шкаф")).reduce((sum, x) => sum + x.q, 0);
                if (tpCabs > 0) addToWorks("Монтаж и обвязка распределительных шкафов", tpCabs, 6000, "шт", tpGroup);
            }

            // Если используется Эко-схема (локальный подмес)
            if (typeof useEco !== 'undefined' && useEco) {
                addToWorks("Сборка и установка узла подмеса", 1, 6000, "шт", tpGroup);
                addToWorks("Установка насоса", 1, 3000, "шт", tpGroup);
            }

            addToWorks("Опрессовка систем водяного тёплого пола", 1, 5000, "компл", tpGroup);
        }

        // ==========================================
        // БЛОК: 1.4 Автоматика для теплого пола
        // ==========================================
        let autoGroup = "1.4 Автоматика для теплого пола";
        if (this.state.systems.includes('tp') && this.state.ufhAuto) {
            if (typeof finalCnt !== 'undefined' && finalCnt > 0) {
                addToWorks("Монтаж коммутационного блока", finalCnt, 5000, "шт", autoGroup);
            }

            // Берем количество сервоприводов из спецификации (чтобы не было расхождений)
            let servos = bill.filter(x => x.name.toLowerCase().includes("сервопривод")).reduce((sum, x) => sum + x.q, 0);
            if (servos > 0) addToWorks("Монтаж сервоприводов", servos, 1000, "шт", autoGroup);

            let therms = this.state.ufhZones || 0;
            if (therms > 0) {
                addToWorks("Монтаж термостатов", therms, 4500, "шт", autoGroup);
                addToWorks("Монтаж закладной для датчика пола", therms, 1000, "шт", autoGroup);
                addToWorks("Прокладка провода на термостаты", therms * 15, 100, "м.p.", autoGroup);
            }
        }

        // Добавляем ручные работы перед финальной отрисовкой
        if (this.state.userAddedWorks) {
            this.state.userAddedWorks.forEach(w => {
                addToWorks(w.name, w.q, w.price, w.unit, w.group);
            });
        }

        flushWorks();

        document.getElementById('tbody').innerHTML = h;
        document.getElementById('total_sum').innerText = sum.toLocaleString() + " ₽";
        let d = showSku ? 'table-cell' : 'none'; document.querySelectorAll('.col-sku').forEach(e => e.style.display = d); document.querySelector('.col-sku-head').style.display = d;

        // === ОБНОВЛЕНИЕ СУММ В ЛИПКОЙ ШАПКЕ (С АНИМАЦИЕЙ) ===
        let headerTotals = document.getElementById('header_totals');
        if (headerTotals) {
            // Проверяем тариф (может быть pro в accountType или внутри tgUser)
            let isPro = (this.state.accountType === 'pro' || (this.state.tgUser && ['pro', 'admin'].includes(this.state.tgUser.account_type)));

            // Строим HTML каркас только 1 раз (или при смене тарифа), чтобы не сбрасывать анимацию
            if (!headerTotals.innerHTML.includes('anim_eq_sum') || headerTotals.dataset.isPro !== String(isPro)) {
                let html = `<span style="color:var(--text-sec); font-size:11px; margin-right:4px;">Оборудование:</span> <b id="anim_eq_sum" style="color:var(--primary); font-size:14px;">0 ₽</b>`;
                if (isPro) {
                    html += `<span style="margin:0 10px; color:var(--border);">|</span> <span style="color:var(--text-sec); font-size:11px; margin-right:4px;">Монтаж:</span> <b id="anim_works_sum" style="color:#F97316; font-size:14px;">0 ₽</b>`;
                }
                headerTotals.innerHTML = html;
                headerTotals.dataset.isPro = String(isPro);
                headerTotals.dataset.lastEq = 0;
                headerTotals.dataset.lastWorks = 0;
            }

            // Запускаем анимацию Оборудования
            let elEq = document.getElementById('anim_eq_sum');
            let oldEq = parseFloat(headerTotals.dataset.lastEq) || 0;
            let newEq = app.lastEqSum || 0;
            if (oldEq !== newEq && elEq) {
                app.animateNumber(elEq, oldEq, newEq, 2400); // Замедлено до 2.4 секунд
                headerTotals.dataset.lastEq = newEq;
            }

            // Запускаем анимацию Монтажа
            if (isPro) {
                let elWorks = document.getElementById('anim_works_sum');
                let oldWorks = parseFloat(headerTotals.dataset.lastWorks) || 0;
                let newWorks = app.lastWorksSum || 0;
                if (oldWorks !== newWorks && elWorks) {
                    app.animateNumber(elWorks, oldWorks, newWorks, 2400); // Замедлено до 2.4 секунд
                    headerTotals.dataset.lastWorks = newWorks;
                }
            }

            headerTotals.style.display = 'flex';
        }
        // ===================================================

        // Очищаем старую схему и вставляем новую ПЕРЕД таблицей спецификации
        let oldScheme = document.getElementById('dynamic_scheme');
        if (oldScheme) oldScheme.remove();
        if (this.state.viewMode === 'equipment' && this.state.showScheme) {
            let tableWrapper = document.querySelector('.table-responsive');
            if (tableWrapper) {
                tableWrapper.insertAdjacentHTML('beforebegin', this.renderScheme());
            }
        }
        this.saveState();

        if (this.isAppReady) {
            // Сравниваем текущие инженерные настройки с последними сохраненными
            let isDifferent = (this.lastSavedStateString !== this.getStateSignature());
            if (isDifferent) this.markAsUnsaved();
            else this.markAsSaved();
        }

        // Моментальное обновление бейджа с процентом экономии
        let dBadge = document.getElementById('discount_badge');
        if (dBadge) {
            if (this.state.brandMode === 'rommer' && this.calcBaseTotal > this.calcFinalTotal) {
                let diff = this.calcBaseTotal - this.calcFinalTotal;
                let percent = Math.round((diff / this.calcBaseTotal) * 100);
                dBadge.textContent = 'Экономия ' + percent + '%';
                dBadge.style.display = 'block';
            } else {
                dBadge.style.display = 'none';
            }
        }
    },
};
document.addEventListener('DOMContentLoaded', function () { app.init(); });

// Автоматическая генерация мульти-страничного документа перед печатью
window.addEventListener('beforeprint', function () {
    document.body.classList.remove('dark-mode');

    // 1. Создаем или очищаем скрытый контейнер, который увидит только принтер
    let printBin = document.getElementById('print_bin');
    if (!printBin) {
        printBin = document.createElement('div');
        printBin.id = 'print_bin';
        document.body.appendChild(printBin);
    }
    printBin.innerHTML = '';

    // Запоминаем текущее состояние
    let originalMode = app.state.viewMode;
    let printArea = document.getElementById('print-area');

    if (printArea) {
        // --- ШАГ 1: ЛИСТ ОБОРУДОВАНИЯ ---
        app.state.viewMode = 'equipment';
        app.render();
        let eqClone = printArea.cloneNode(true);
        eqClone.id = 'print_eq_clone';
        // Убираем схему и табы
        let eqScheme = eqClone.querySelector('#dynamic_scheme');
        if (eqScheme) eqScheme.remove();
        let eqTabs = eqClone.querySelector('.main-view-tabs');
        if (eqTabs) eqTabs.style.display = 'none';
        printBin.appendChild(eqClone);

        // --- ШАГ 2: ЛИСТ МОНТАЖНЫХ РАБОТ (Если есть PRO) ---
        let isPro = (app.state.accountType === 'pro' || (app.state.tgUser && ['pro', 'admin'].includes(app.state.tgUser.account_type)));
        if (isPro) {
            app.state.viewMode = 'works';
            app.render();
            let worksClone = printArea.cloneNode(true);
            worksClone.id = 'print_works_clone';
            worksClone.classList.add('print-page-break'); // Разрыв страницы
            let worksScheme = worksClone.querySelector('#dynamic_scheme');
            if (worksScheme) worksScheme.remove();
            let wTabs = worksClone.querySelector('.main-view-tabs');
            if (wTabs) wTabs.style.display = 'none';

            // === ВЫРЕЗАЕМ ЛИШНИЕ КОЛОНКИ ДЛЯ ЭКОНОМИИ МЕСТА ===
            worksClone.querySelectorAll('table').forEach(table => {
                let headers = table.querySelectorAll('thead th');
                let hideIdx = [];
                // Ищем индексы ненужных колонок
                headers.forEach((th, idx) => {
                    let txt = th.innerText.trim().toUpperCase();
                    if (txt === 'БРЕНД' || txt === 'АРТИКУЛ' || txt === 'ФОТО') {
                        hideIdx.push(idx);
                    }
                });
                // Скрываем эти ячейки во всех строках
                if (hideIdx.length > 0) {
                    table.querySelectorAll('tr').forEach(row => {
                        let cells = row.children;
                        hideIdx.forEach(idx => {
                            if (cells[idx]) cells[idx].style.display = 'none';
                        });
                    });
                }
            });
            // ==================================================

            printBin.appendChild(worksClone);
        }

        // --- ШАГ 3: СХЕМА (На отдельном листе) ---
        if (app.state.showScheme) {
            app.state.viewMode = 'equipment'; // Схема генерится только на этой вкладке
            app.render();
            let currentScheme = document.getElementById('dynamic_scheme');
            if (currentScheme) {
                let schemeClone = currentScheme.cloneNode(true);
                printBin.appendChild(schemeClone);
            }
        }

        // --- ШАГ 4: ПРЯЧЕМ ОРИГИНАЛ ОТ ПРИНТЕРА ---
        printArea.classList.add('hide-original-for-print');
        let liveScheme = document.getElementById('dynamic_scheme');
        if (liveScheme) liveScheme.classList.add('hide-original-for-print');

        // Возвращаем интерфейс в исходное состояние
        app.state.viewMode = originalMode;
        app.render();
    }
});

// Возврат к нормальной жизни после закрытия окна печати
window.addEventListener('afterprint', function () {
    if (app && app.state && app.state.darkMode) {
        document.body.classList.add('dark-mode');
    }

    // Возвращаем видимость оригинальному интерфейсу
    let printArea = document.getElementById('print-area');
    let liveScheme = document.getElementById('dynamic_scheme');
    if (printArea) printArea.classList.remove('hide-original-for-print');
    if (liveScheme) liveScheme.classList.remove('hide-original-for-print');

    // Очищаем корзину печати
    let printBin = document.getElementById('print_bin');
    if (printBin) printBin.innerHTML = '';
});

// Датчик прокрутки для сужения шапки
window.addEventListener('scroll', function () {
    let header = document.querySelector('.site-header');
    if (header) {
        // Если прокрутили больше чем на 40 пикселей - включаем режим "узкой шапки"
        if (window.scrollY > 40) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    }
});