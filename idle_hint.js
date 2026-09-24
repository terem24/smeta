/**
 * Подсказка «Смета за минуту» для тех, кто ходит, но не считает.
 *
 * КОМУ. Тем же людям, что попадают в фильтр админки «Ходит, но не считает»: визитов
 * не меньше app.IDLE_MIN_VISITS, и ни одного расчёта — ни отметки в invoice_events с
 * номером расчёта, ни сохранённой сметы. Условие одно на оба места намеренно: иначе в
 * панели был бы список людей, из которых подсказку видит непонятно кто.
 *
 * ЗАЧЕМ, ЕСЛИ ЕСТЬ ОКНО БЫСТРОГО СТАРТА. Оно показывается новичку трижды за жизнь
 * браузера и потом молчит навсегда. Кто закрыл его три раза не глядя и продолжает
 * заходить, до сих пор не получал больше ничего.
 *
 * ПОЧЕМУ ОКНО ПО ЦЕНТРУ, А НЕ КАРТОЧКА В УГЛУ. Первая версия была карточкой справа
 * внизу, и на проверке владелец её просто не заметил: угол экрана у калькулятора
 * занят кнопкой ИИ-заполнения, сметой и подвалом с кнопками, взгляд туда не идёт.
 * Человеку, который неделю ходит и не начинает, тихая карточка не поможет — нужен
 * один заметный вопрос. Раз в день и не больше пяти раз это не навязчиво.
 *
 * КОГДА. Не сразу при входе, а когда человек провёл на пустом калькуляторе полминуты и
 * так и не начал: зашёл посмотреть цену или прочитать сообщение — не трогаем. Не чаще
 * раза в день и не больше MAX_SHOWS раз всего; после «Больше не показывать» или после
 * того, как человек взял типовой объект, — никогда.
 *
 * ЧТО ИЗМЕРЯЕМ. Показ и нажатия уходят экранами в счётчик визитов (hint:idle*), а смета,
 * начатая из подсказки, получает в событии 'calculated' метку via: 'idle_hint'
 * (см. ensureCalcId). Так видно, работает ли подсказка, а не только сколько раз висела.
 */
window.IdleHint = {

    DELAY_MS: 30 * 1000,             // сколько человек должен провести на пустом калькуляторе
    POLL_MS: 5 * 1000,               // как часто смотрим на экран
    GIVE_UP_MS: 10 * 60 * 1000,      // за столько с входа не сложилось — в этот заход не показываем
    MAX_SHOWS: 5,                    // всего показов за жизнь браузера на одного человека

    // Режим проверки для владельца (app.isAnalyticsOwner): true — подсказка показывается
    // ему без трёх визитов, без проверки расчётов и без ограничений по дням и числу
    // показов; условия экрана — как у всех. Нужен, чтобы посмотреть подсказку вживую:
    // у учёток владельца расчёты есть, и по обычным правилам он её не увидит никогда.
    // Включали 13.09.2026 на проверку, выключено. В проде держать false.
    TEST_OWNER: false,

    _timer: null,
    _started: 0,
    _emptySince: 0,                  // с какого момента расчёт пуст без перерыва

    // Запись в localStorage — своя у каждого аккаунта: на одном компьютере
    // бывает несколько учёток, и «больше не показывать» одной не касается другой.
    key: function (userId) { return 'idle_hint_' + userId; },

    read: function (userId) {
        try { return JSON.parse(localStorage.getItem(this.key(userId)) || '{}') || {}; } catch (e) { return {}; }
    },

    write: function (userId, rec) {
        try { localStorage.setItem(this.key(userId), JSON.stringify(rec)); } catch (e) { }
    },

    today: function () {
        const d = new Date();
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    },

    /**
     * Зовётся после входа, когда строка пользователя уже пришла из базы.
     * Сначала всё, что проверяется без запросов, и только потом — запросы.
     */
    consider: async function (uRow) {
        try {
            if (!uRow || !uRow.id || typeof app === 'undefined') return;
            const ownerTest = this.TEST_OWNER && app.isAnalyticsOwner && app.isAnalyticsOwner();
            const minVisits = app.IDLE_MIN_VISITS || 3;
            if (!ownerTest && !((uRow.sess_visits || 0) >= minVisits)) return;

            // Открыта смета по ссылке, печать, просмотр менеджером — человек пришёл
            // читать документ, а не считать (те же признаки, что у быстрого старта).
            const q = new URLSearchParams(window.location.search || '');
            if (['id', 'print', 'view', 'manager', 'share', 'code'].some(k => q.has(k))) return;
            if ((window.location.hash || '').indexOf('data=') > -1) return;

            if (!ownerTest) {
                const rec = this.read(uRow.id);
                if (rec.off) return;
                if ((rec.shown || 0) >= this.MAX_SHOWS) return;
                if (rec.day === this.today()) return;
                try { if (localStorage.getItem('quick_start_used') === '1') return; } catch (e) { }

                if (await this.hasCalcs(uRow)) return;
            }

            this._started = Date.now();
            this._emptySince = 0;
            clearInterval(this._timer);
            this._timer = setInterval(() => this.poll(uRow), this.POLL_MS);
        } catch (e) {
            console.warn('[IdleHint]', e && e.message);
        }
    },

    // Три счётчика без тела ответа: сохранённые сметы, отметки расчётов по номеру
    // учётки и по почте (старые отметки подписаны только адресом). Не ответила база —
    // считаем, что расчёты есть: лишний раз промолчать лучше, чем предложить «первую
    // смету» тому, у кого их полсотни.
    hasCalcs: async function (uRow) {
        try {
            const jobs = [
                supabaseClient.from('estimates').select('id', { count: 'exact', head: true })
                    .eq('user_id', uRow.id),
                supabaseClient.from('invoice_events').select('calc_id', { count: 'exact', head: true })
                    .eq('user_id', String(uRow.id)).not('calc_id', 'is', null)
            ];
            const email = app.state && app.state.tgUser && app.state.tgUser.email;
            if (email) {
                jobs.push(supabaseClient.from('invoice_events').select('calc_id', { count: 'exact', head: true })
                    .eq('user_email', String(email).trim().toLowerCase()).not('calc_id', 'is', null));
            }
            const res = await Promise.all(jobs);
            if (res.some(r => r.error)) return true;
            return res.some(r => (r.count || 0) > 0);
        } catch (e) { return true; }
    },

    // Экран свободен: расчёт всё ещё пуст, поверх ничего не открыто, обучение не
    // ведёт человека по шагам, вкладка на виду.
    screenFree: function () {
        if (document.hidden) return false;
        // Анкета не заполнена целиком — никакие новичковые окна не показываем
        // (то же правило, что у окна быстрого старта, см. app.onboardingAllowed).
        if (typeof app.onboardingAllowed === 'function' && !app.onboardingAllowed()) return false;
        if (!app.isCalcEmpty()) return false;
        if (document.querySelector('.custom-modal-overlay.active')) return false;
        if (document.getElementById('quick_start_overlay')) return false;
        if (typeof Tour !== 'undefined' && Tour.active()) return false;
        return true;
    },

    /**
     * Полминуты считаются от момента, когда расчёт стал пустым, а не от входа.
     *
     * Первая версия заводила один таймер при входе и через полминуты сдавалась, если
     * расчёт был не пуст. А он у многих не пуст при входе: в браузере остаётся
     * прошлый расчёт, и человек сначала жмёт «Сбросить». Такому подсказка не
     * показывалась до следующей перезагрузки — ровно так её не увидел владелец на
     * проверке. Теперь смотрим на экран раз в пять секунд: начал считать — отсчёт
     * обнуляется, сбросил расчёт — пошёл заново.
     */
    poll: function (uRow) {
        const now = Date.now();
        if (document.getElementById('idle_hint_card') || now - this._started > this.GIVE_UP_MS) {
            clearInterval(this._timer);
            return;
        }
        if (!app.isCalcEmpty()) { this._emptySince = 0; return; }
        if (!this._emptySince) this._emptySince = now;
        if (now - this._emptySince < this.DELAY_MS) return;
        if (!this.screenFree()) return;
        clearInterval(this._timer);
        this.show(uRow);
    },

    show: function (uRow) {
        if (document.getElementById('idle_hint_card')) return;
        const rec = this.read(uRow.id);
        rec.shown = (rec.shown || 0) + 1;
        rec.day = this.today();
        this.write(uRow.id, rec);
        if (window.SessionTrack) SessionTrack.screen('hint:idle');

        // У продавца монтажных работ в смете нет — и обещать их незачем.
        const seller = typeof app.canUseWorks === 'function' ? !app.canUseWorks() : (app.isSellerOnly && app.isSellerOnly());
        const what = seller ? 'котёл, радиаторы и трубы' : 'оборудование и работы';

        // Разметка и классы — те же, что у окна быстрого старта (custom-modal-overlay /
        // custom-modal): затемнение, размытие фона и вид окна уже настроены в style.css
        // и одинаково ведут себя в тёмной теме и на телефоне. Размытие здесь сильнее
        // обычного: окно должно заметно отделять вопрос от калькулятора под ним.
        //
        // display задан прямо в стиле: у класса display:none, и переключение его на
        // block одновременно с .active убивает плавное появление.
        const wrap = document.createElement('div');
        wrap.id = 'idle_hint_card';
        wrap.className = 'custom-modal-overlay';
        wrap.style.cssText = 'display:block; backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); background:rgba(0,0,0,0.55);';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.setAttribute('aria-label', 'Смета за минуту');
        wrap.onclick = (e) => { if (e.target === wrap) IdleHint.close('later'); };
        wrap.innerHTML = `
            <div class="custom-modal" style="max-width:460px; padding:34px 30px 24px; text-align:center;
                 transition:transform .3s ease; transform:translate(-50%, -46%) scale(.97);">
                <span class="auth-modal-close" onclick="IdleHint.close('later')"
                    style="top:6px; right:8px; padding:10px 14px;">&times;</span>
                <div style="font-size:46px; line-height:1; margin-bottom:12px;">🏠</div>
                <div class="custom-modal-title" style="font-size:22px; margin-bottom:8px;">Смета за минуту</div>
                <div class="custom-modal-text" style="font-size:14px; margin-bottom:22px;">
                    Возьмите готовый объект, похожий на ваш, — калькулятор сразу подберёт ${what}.
                    Площадь и регион поправите уже по готовой смете.
                </div>
                <button type="button" class="custom-modal-btn" onclick="IdleHint.pick()"
                    style="height:46px; font-size:15px;">Выбрать типовой объект</button>
                <button type="button" class="custom-modal-btn custom-modal-close" onclick="IdleHint.tour()"
                    style="color:var(--text-main);">Показать, куда нажимать</button>
                <div style="margin-top:14px;">
                    <a href="#" onclick="IdleHint.close('off'); return false;"
                       style="font-size:12px; color:var(--text-sec); text-decoration:none;">Больше не показывать</a>
                </div>
            </div>`;
        wrap.dataset.user = uRow.id;
        document.body.appendChild(wrap);

        // Escape закрывает, как крестик
        this._onKey = (e) => { if (e.key === 'Escape') IdleHint.close('later'); };
        document.addEventListener('keydown', this._onKey);

        // Через таймер, а не кадр: в фоновой вкладке кадры не рисуются (см. showQuickStart)
        setTimeout(() => {
            wrap.classList.add('active');
            const box = wrap.querySelector('.custom-modal');
            if (box) box.style.transform = 'translate(-50%, -50%) scale(1)';
        }, 20);
    },

    // how: 'later' — крестик, завтра можно снова; 'off' — не показывать никогда;
    // 'used' — человек пошёл по подсказке, дальше она не нужна.
    close: function (how) {
        const wrap = document.getElementById('idle_hint_card');
        if (!wrap) return;
        const userId = wrap.dataset.user;
        if (userId && (how === 'off' || how === 'used')) {
            const rec = this.read(userId);
            rec.off = true;
            this.write(userId, rec);
        }
        if (window.SessionTrack && how === 'off') SessionTrack.screen('hint:idle_off');
        if (this._onKey) { document.removeEventListener('keydown', this._onKey); this._onKey = null; }
        // Уходит по нажатию «Выбрать типовой объект» — сразу, без затухания: следом
        // открывается окно быстрого старта, и два затемнения на миг наложились бы.
        if (how === 'used') { wrap.remove(); return; }
        wrap.classList.remove('active');
        const box = wrap.querySelector('.custom-modal');
        if (box) box.style.transform = 'translate(-50%, -46%) scale(.97)';
        setTimeout(() => wrap.remove(), 300);
    },

    pick: function () {
        if (window.SessionTrack) SessionTrack.screen('hint:idle_pick');
        // Метка для события 'calculated': смета начата из подсказки (см. ensureCalcId)
        app._idleHintUsed = true;
        this.close('used');
        app.showQuickStart();
    },

    tour: function () {
        if (window.SessionTrack) SessionTrack.screen('hint:idle_tour');
        app._idleHintUsed = true;
        this.close('used');
        if (typeof Tour !== 'undefined') {
            Tour.rememberChoice();
            Tour.toggle(true);
        }
    }
};
