// ===================== Режим обучения =====================
//
// Устроено блоками (см. BLOCKS): «Первый объект» — практика, где человек сам собирает
// дом 150 м² (площадь → газ/электро → радиаторы и тёплый пол → бойлер → вода →
// скважинный насос → замена радиатора и подключения) и сохраняет его; остальные блоки —
// короткий обзор функций. На шаге с заданием проверяется состояние калькулятора, а
// палец и кольцо сидят на настоящей кнопке страницы. Какие блоки и шаги увидит человек,
// решают тариф, сфера деятельности (продавцу не показываем про маржу и договоры) и
// доступы: недоступные шаги выпадают, блок без шагов запирается и ведёт к тарифу.
// Отметка «прошёл обучение» в админке ставится, когда засчитан блок «Первый объект».
//
// Шаги, которые видит не каждый (умное заполнение, распознавание, «Деньги», панель
// разделов, документы), пропускаются сами по скрытому элементу — отдельных проверок
// тарифа и доступа здесь нет намеренно, иначе правило пришлось бы держать в двух
// местах и оно бы разъехалось с интерфейсом.
//
// Карточка стоит в углу экрана и не двигается за элементом; тексты — одно предложение
// «зачем», а «что сделать» — задание с галочкой. Выполнил — обучение само идёт дальше.
//
// Зачем это вообще: по журналу видно, что из 42 заведённых аккаунтов 18 не сделали
// ни одной сметы, и у 17 из них нет ни одного события — люди не «посчитали и не
// сохранили», а не посчитали ничего. Окно быстрого старта даёт готовую смету одним
// касанием, но не объясняет, что с ней делать дальше; обучение как раз про «дальше».
//
// Живёт отдельным файлом, а не внутри app.js, намеренно: app.js правят сразу
// несколько человек, и любая мелочь там даётся ценой разбора конфликтов. Здесь же
// всё своё — разметка, стили и логика, а в index.html уходит только галочка.
//
// У продавца (сфера деятельности «Продавец» без монтажа, app.isSellerOnly) экран
// другой: нет вкладок «Монтажные работы» и «Деньги», в шапке нет суммы монтажа и
// переключателя темы, в меню разделов нет «Прайса», а наружу — в ссылку клиенту,
// PDF и Excel — уходит одно оборудование. Обучение об этом знать обязано: подсказка,
// которая ведёт к отсутствующей кнопке, хуже, чем её отсутствие. Такие шаги держат
// второй вариант текста в поле seller (см. view), а шаг про работы у продавца
// выпадает целиком (seller.skip).
const Tour = {

    // Ключи в localStorage: включён ли режим и на каком шаге остановились.
    // Шаг храним, чтобы обучение пережило перезагрузку страницы — а она случится
    // обязательно, человек будет пробовать кнопки.
    LS_ON: 'tour_on',
    LS_STEP: 'tour_step',
    LS_STEP_KEY: 'tour_step_key',
    LS_STEP_VER: 'tour_step_ver',
    // Отметка «человек решил сам». Без неё нельзя отличить выключенное обучение от
    // ещё не заданного: новичку мы включаем подсказки сами, и без этой отметки они
    // возвращались бы после каждой перезагрузки тому, кто их выключил.
    LS_CHOICE: 'tour_choice',
    // Прошёл до конца (на этом устройстве) и «не навязывать до»: после крестика или
    // выключения кнопкой принудительное включение молчит SNOOZE_DAYS дней.
    LS_DONE: 'tour_done',
    LS_SNOOZE: 'tour_force_snooze',
    SNOOZE_DAYS: 3,
    // Где остановились: блок, вид карточки ('menu' — список блоков, 'step' — шаг блока,
    // 'done' — блок пройден) и какие блоки пройдены на этом устройстве.
    LS_BLOCK: 'tour_block',
    LS_VIEW: 'tour_view',
    LS_BLOCKS: 'tour_blocks',

    // Блоки обучения. Раньше было одно длинное прохождение на 26 шагов, и до конца его
    // не доходил почти никто. Теперь человек выбирает, что освоить, а каждый блок
    // короткий (3–9 шагов) и заканчивается отметкой «пройден».
    //
    // Первый блок — практика, а не экскурсия: на каждом шаге есть задание, которое
    // проверяется по состоянию калькулятора (app.state), и блок засчитывается, только
    // когда человек сам собрал объект и сохранил его. Остальные блоки — обзор функций.
    // must — блок, который ждём от каждого новичка (его и пишем в админку как «прошёл»);
    // fallback — куда вести, если ни один шаг блока человеку недоступен (тариф).
    BLOCKS: [
        { id: 'basic', icon: '🏠', title: 'Первый объект', sub: 'Учебный дом 150 м²: смета, откуда мощность котла, замена, схема — и сохранение', min: 9, must: true },
        { id: 'estimate', icon: '📄', title: 'Смета и клиент', sub: 'Замена позиций, ссылка клиенту, PDF и счёт', min: 2 },
        { id: 'cabinet', icon: '🧭', title: 'Меню и кнопки', sub: 'Шапка, боковое меню, что входит в ваш тариф', min: 2 },
        // Только в Профи: в списке лежат под сворачиваемым заголовком, на базовом тарифе заперты
        { id: 'sell', icon: '💰', title: 'Деньги и договор', sub: 'Монтаж, ваша маржа, «Бюджетнее», договор и акты', min: 3, pro: true, noSeller: true, fallback: { block: 'cabinet', key: 'plan' } },
        { id: 'project', icon: '📐', title: 'Комнаты и проект', sub: 'Расчёт по комнатам, план дома, листы проекта, сканы', min: 3, pro: true, fallback: { block: 'cabinet', key: 'plan' } }
    ],

    // Шаги. Текст — одно предложение «зачем»; что делать — в заданиях (tasks), а где —
    // показывает палец на настоящем элементе. Карточка стоит в одном месте экрана и не
    // повторяет интерфейс картинками: раньше в ней был ролик-«пример», и люди путались,
    // куда нажимать — в карточку или на страницу.
    //   sel     — что подсветить (строка для querySelector или функция);
    //   block   — к какому блоку относится шаг (порядок внутри блока — порядок здесь);
    //   tasks   — задания «сделайте сами»: [{ label, done(snap) }]; когда выполнены все,
    //             обучение само переходит дальше; пока нет — вместо «Дальше» «Пропустить»;
    //   snap()  — состояние при входе на шаг, для заданий «поменяйте что-нибудь»;
    //   point   — на что показывать пальцем (по умолчанию — подсвеченный элемент);
    //   actions — настоящие кнопки в карточке (например, «Сохранить» на телефоне);
    //   seller  — что показать продавцу вместо title/text; seller.skip убирает шаг.
    // Шаг, чей элемент скрыт по тарифу, роли или доступу, пропускается сам: отдельных
    // проверок тарифа здесь нет, иначе правило жило бы в двух местах и разъехалось.
    STEPS: [
        // ───────────── Блок 1. Первый объект (практика) ─────────────
        {
            // Начинаем не с пустой формы (на «Площадь: 0 м²» уходило больше всего людей), а с
            // готового результата: подставляем учебный дом и показываем смету с итогом.
            // Площадь трогаем, только если её нет — свой объект человека не переписываем.
            block: 'basic', key: 'result', mob: 'output',
            before: () => Tour.seedHouse(),
            sel: () => { const t = document.getElementById('total_sum'); return (t && t.offsetParent) ? t.parentElement : document.getElementById('header_totals'); },
            title: 'Готовая смета за секунду',
            text: 'Мы подставили учебный дом 150 м². В смете уже котёл, приборы, трубы и фитинги с ценами. Дальше вы меняете параметры — и смотрите, как пересчитывается итог.',
            extra: function () { return this.totalHtml(); },
            point: () => document.getElementById('total_sum')
        },
        {
            block: 'basic', key: 'area', mob: 'inputs',
            sel: '#blk_main_area',
            title: 'Площадь дома',
            text: 'Главное число расчёта: от него зависят котёл, радиаторы и трубы. Смета пересчитывается сразу после каждого действия.',
            snap: () => JSON.stringify({ a: Math.round(Tour.st().area || 0) }),
            tasks: [{ label: 'Поменяйте площадь — например, на 180 м²: нажмите на число, впишите и Enter (или потяните ползунок)', done: snap => Math.round(Tour.st().area || 0) !== JSON.parse(snap).a }],
            now: () => Math.round(Tour.st().area || 0) + ' м², оборудование ' + Tour.money(Tour.eqSum()),
            point: '#val_area'
        },
        {
            block: 'basic', key: 'fuel', mob: 'inputs',
            sel: () => document.getElementById('fuel_gas') && document.getElementById('fuel_gas').closest('.control-item'),
            title: 'Тип котла',
            text: 'Можно один котёл или оба сразу — например, газ и резервный электро.',
            // Кнопки — переключатели. По умолчанию горит «Электро»: раньше задание требовало
            // «только Газ», и приходилось включать газ, выключать электро и включать его снова.
            // Теперь достаточно включить «Газ» — электро остаётся запасным, обе кнопки горят.
            tasks: [
                { label: 'Дом газифицирован — включите «Газ»', done: () => (Tour.st().fuels || []).indexOf('gas') > -1 },
                { label: 'Электрокотёл оставьте включённым как запасной: пусть горят обе кнопки', done: () => { const f = Tour.st().fuels || []; return f.indexOf('gas') > -1 && f.indexOf('el') > -1; } }
            ],
            now: () => { const f = Tour.st().fuels || []; return f.length ? f.map(x => x === 'gas' ? 'Газ' : 'Электро').join(' + ') : 'ничего'; },
            point: () => document.getElementById((Tour.st().fuels || []).indexOf('gas') < 0 ? 'fuel_gas' : 'fuel_el')
        },
        {
            block: 'basic', key: 'sys', mob: 'inputs',
            sel: () => document.getElementById('sys_rad') && document.getElementById('sys_rad').closest('.control-item'),
            title: 'Чем греем',
            text: 'В учебном доме будут и радиаторы, и тёплый пол. Кнопка без площади в смету ничего не добавит.',
            tasks: [
                { label: 'Включите «Радиаторы»', done: () => (Tour.st().systems || []).indexOf('rad') > -1 },
                { label: 'Включите «Тёплый пол»', done: () => (Tour.st().systems || []).indexOf('tp') > -1 },
                // Включённая кнопка при площади 0 м² ничего не добавляет в смету
                { label: 'Задайте площадь тёплого пола — например, 60 м²: нажмите на число, впишите и нажмите Enter', done: () => (Tour.st().systems || []).indexOf('tp') > -1 && Number(Tour.st().tp1) > 0 }
            ],
            now: () => { const s = Tour.st().systems || []; const n = s.map(x => x === 'rad' ? 'Радиаторы' : 'Тёплый пол' + (Number(Tour.st().tp1) > 0 ? ' ' + Number(Tour.st().tp1) + ' м²' : ' 0 м²')); return n.length ? n.join(' + ') : 'ничего'; },
            point: () => {
                const s = Tour.st().systems || [];
                if (s.indexOf('rad') < 0) return document.getElementById('sys_rad');
                if (s.indexOf('tp') < 0) return document.getElementById('sys_tp');
                return document.getElementById('val_tp1') || document.getElementById('sys_tp');
            }
        },
        {
            block: 'basic', key: 'hw', mob: 'inputs',
            sel: () => document.getElementById('chk_hw') && document.getElementById('chk_hw').closest('.control-item'),
            title: 'Горячая вода',
            text: 'Бойлер подберётся по числу жильцов.',
            tasks: [
                { label: 'Включите «Горячая вода»', done: () => !!Tour.st().hotWater },
                { label: 'Поставьте 4 жильца', done: () => !!Tour.st().hotWater && Number(Tour.st().res) === 4 }
            ],
            now: () => Tour.st().hotWater ? 'горячая вода включена, жильцов: ' + Number(Tour.st().res) : 'горячая вода выключена',
            point: () => {
                if (!Tour.st().hotWater) return document.querySelector('#blk_hw_row .switch');
                // Жильцов больше четырёх — показываем на «−», меньше — на «+»
                return document.querySelector(Number(Tour.st().res) > 4 ? '#blk_res .step-btn:first-child' : '#blk_res .step-btn:last-child');
            }
        },
        {
            block: 'basic', key: 'water', mob: 'inputs',
            sel: () => document.getElementById('chk_water') && document.getElementById('chk_water').closest('.control-item'),
            title: 'Водоснабжение',
            text: 'Трубы до кухни и санузлов; из них считается расход воды для насоса.',
            tasks: [{ label: 'Включите «Водоснабжение»', done: () => !!Tour.st().water }],
            point: () => document.querySelector('#chk_water') && document.querySelector('#chk_water').closest('.label-row').querySelector('.switch')
        },
        {
            block: 'basic', key: 'well', mob: 'inputs',
            sel: '#blk_well_wrap',
            title: 'Скважинный насос',
            text: 'Насос подберётся по глубине и расходу воды.',
            tasks: [
                { label: 'Включите «Скважинный насос»', done: () => !!Tour.st().well },
                { label: 'Глубина установки — 60 м (нажмите на число, впишите, Enter)', done: () => !!Tour.st().well && Number(Tour.st().wellDepth) === 60 }
            ],
            now: () => Tour.st().well ? 'насос включён, глубина ' + Number(Tour.st().wellDepth) + ' м' : 'насос выключен',
            point: () => Tour.st().well ? document.getElementById('val_wellDepth') : document.querySelector('#blk_well_wrap .switch')
        },
        {
            // Точность: откуда взялась мощность котла. Без заданий — это объяснение, но на
            // настоящих числах этого дома, а не общими словами.
            block: 'basic', key: 'why', mob: 'output',
            sel: () => { const r = Tour.boilerRow(); if (r) return r.tr; const t = document.getElementById('total_sum'); return (t && t.offsetParent) ? t.parentElement : null; },
            title: 'Почему такой котёл',
            text: function () { return this.whyText(); },
            extra: function () { return this.whyFormula(); },
            point: () => { const r = Tour.boilerRow(); return r ? (r.tr.querySelector('.col-name') || r.tr) : null; }
        },
        {
            // Строка с радиатором: ищем по названию (колонка «Наименование»). В окне замены
            // радиатора есть фильтры «Тип прибора», «Подключение» (боковое или нижнее) и «Высота».
            // Окно закрывается, как только модель выбрана, поэтому задания идут в порядке
            // действий человека: открыть окно → сменить подключение → выбрать модель.
            block: 'basic', key: 'replace', mob: 'output',
            // Радиаторы могут лежать в свёрнутом подразделе сметы (группировка у Профи) — тогда
            // их строк на экране нет, и подсветка уезжала на вкладку «Оборудование». Разворачиваем.
            before: () => Tour.openRadGroup(),
            sel: () => { const r = Tour.radRow() || Tour.anySwapRow(); return r ? r.tr : document.getElementById('tab_equipment'); },
            title: 'Замена радиатора',
            titleAlt: () => Tour.radRow() ? null : 'Замена позиции сметы',
            text: function () {
                if (!this.radRow()) return 'Радиаторов в этой смете не видно, поэтому покажем замену на любой другой позиции (подсвечена стрелкой). Окно замены открывается по клику на фото позиции.';
                return 'Любую позицию сметы можно заменить. Окно замены открывается по клику на фото позиции; фильтры «Тип прибора» и «Подключение» — внутри этого окна.';
            },
            snap: () => { Tour._radWin = false; return JSON.stringify({ sw: Tour.st().swaps || {} }); },
            // Радиатора в смете нет (редкий случай: свёрнуто или убран) — одно задание про любую позицию
            tasks: () => {
                const picked = snap => JSON.stringify(Tour.st().swaps || {}) !== JSON.stringify(JSON.parse(snap).sw);
                if (!Tour.radRow()) return [{ label: 'Нажмите на фото любой позиции сметы и выберите другую', done: picked }];
                return [
                    { label: 'Нажмите на фото радиатора — откроется окно замены', done: () => !!Tour._radWin || Tour.radWinOpen() },
                    { label: 'В окне замены нажмите фильтр «Подключение» и смените его', done: () => Tour.clicked('[onclick*="switchSwapRadConnection"]') },
                    { label: 'Выберите в списке другой радиатор', done: picked }
                ];
            },
            point: () => { const r = Tour.radRow() || Tour.anySwapRow(); return r ? r.btn : null; }
        },
        {
            // Визуализация. Переключатель скрыт без привязки к магазину — тогда шаг пропустится сам.
            // Схема — функция Профи: на базовом тарифе задания нет, только объяснение (клик по
            // переключателю открыл бы окно оплаты посреди обучения).
            block: 'basic', key: 'scheme', mob: 'output',
            sel: () => { const w = document.getElementById('scheme_wrapper'); return (w && w.offsetParent) ? w : null; },
            title: 'Схема по смете',
            text: function () {
                if (this.planInfo().isPro) return 'Оборудование из сметы встаёт на схему подключения котельной. Схему можно приложить к PDF — клиенту и бригаде.';
                let bonus = false;
                try { bonus = typeof Subscription !== 'undefined' && Subscription.tourBonusSettings().enabled; } catch (e) { }
                return 'Схема подключения рисуется по смете автоматически — это функция Профи.' +
                    (bonus ? ' Закончите этот блок — Профи откроется на 10 дней, и схема включится этим переключателем.' : '');
            },
            tasks: () => Tour.planInfo().isPro ? [{ label: 'Включите переключатель «Схема»', done: () => !!Tour.st().showScheme }] : null,
            point: () => document.querySelector('#scheme_wrapper .switch')
        },
        {
            // На телефоне дискета спрятана в меню шапки — сохранить можно и кнопкой в карточке.
            block: 'basic', key: 'save', mob: 'output',
            sel: () => {
                const b = document.getElementById('btn_save_main');
                if (b && b.offsetParent) return b;
                return document.querySelector('.menu-toggle-btn');
            },
            title: 'Сохраните объект',
            text: 'Без сохранения расчёт живёт только в этом браузере.',
            tasks: [{ label: 'Нажмите «Сохранить»', done: () => Tour._savedAt >= Tour._enteredAt }],
            actions: [{ label: '💾 Сохранить объект', run: 'Tour.saveNow()' }],
            point: () => { const b = document.getElementById('btn_save_main'); return (b && b.offsetParent) ? b : null; }
        },

        // ───────────── Блок 2. Смета и клиент ─────────────
        {
            block: 'estimate', key: 'eq', mob: 'output',
            sel: '#tab_equipment',
            title: 'Смета',
            text: 'Количество меняется прямо в строке, лишнее убирает ✖, замена — по фото.',
            snap: () => JSON.stringify([Tour.st().qtyOverrides || {}, Tour.st().optItems || {}]),
            tasks: [{ label: 'Поменяйте количество в любой строке или уберите позицию крестиком', done: snap => JSON.stringify([Tour.st().qtyOverrides || {}, Tour.st().optItems || {}]) !== snap }],
            noMobTasks: true,
            point: () => { const i = document.querySelector('.qty-num-input'); return (i && i.offsetParent) ? i : null; },
            seller: { title: 'Спецификация' }
        },
        {
            block: 'estimate', key: 'send', mob: 'output',
            sel: () => {
                const share = document.getElementById('btn_share_trigger');
                if (share && share.offsetParent) return share;
                return document.getElementById('btn_print_trigger');
            },
            title: 'Отдать клиенту',
            text: 'Ссылка открывает смету у клиента на телефоне. Рядом — PDF, Excel и «Запросить счёт».',
            tasks: [{ label: 'Нажмите «Поделиться» — ссылка на смету создастся и скопируется', done: () => Tour.clicked('#btn_share_trigger') }],
            point: () => { const b = document.getElementById('btn_share_trigger'); return (b && b.offsetParent) ? b : null; }
        },

        // ───────────── Блоки 4–5. Профи: деньги и договор; проект и сканы ─────────────
        {
            block: 'sell', key: 'works', mob: 'output',
            sel: '#tab_works',
            title: 'Монтажные работы',
            text: 'Работы с объёмами и вашими расценками — задаются один раз в «Прайсе».',
            tasks: [{ label: 'Откройте вкладку «Монтаж»', done: () => Tour.st().viewMode === 'works' }],
            seller: { skip: true }
        },
        {
            block: 'sell', key: 'money', mob: 'output',
            sel: '#tab_money',
            title: 'Ваша прибыль',
            text: 'Маржа по объекту с учётом закупочных скидок, доли бригады и накладных.',
            tasks: [{ label: 'Откройте вкладку «Деньги»', done: () => Tour.st().viewMode === 'money' }],
            seller: { skip: true }
        },
        {
            // Закрыт тарифом или без ROMMER — обёртка скрыта, шаг пропустится
            block: 'sell', key: 'cheaper', mob: 'output',
            sel: '#cheaper_wrapper',
            title: 'Бюджетнее',
            text: 'Вторая смета на равноценных аналогах — покажите клиенту, сколько можно сэкономить.',
            tasks: [{ label: 'Включите переключатель «Бюджетнее»', done: () => Tour.clicked('#cheaper_wrapper') }],
            point: () => document.getElementById('cheaper_wrapper')
        },
        {
            // Документы — у заказа в разделе «Объекты»; у гостя и на телефоне панели нет
            block: 'sell', key: 'docs',
            sel: '.lk-rail-item[data-rail="objects"]',
            title: 'Договор и акты',
            text: 'В «Объектах» у заказа кнопка «Документы»: договор, спецификация и акт из сметы.',
            seller: { skip: true }
        },
        {
            // Кнопка есть только в режиме «По комнатам» и при открытой функции — иначе пропуск
            block: 'project', key: 'ufhplan', mob: 'inputs',
            sel: '#btn_ufhplan',
            title: 'План дома',
            text: 'Загрузите план этажа — комнаты, тёплый пол и радиаторы разложатся по нему и уйдут в КП.'
        },
        {
            block: 'project', key: 'design', mob: 'output',
            sel: '#btn_sheets_trigger',
            title: 'Листы проекта',
            text: 'Схема, узлы котельной, планы и спецификации — комплект для бригады.'
        },
        {
            // Вкладка открыта не всем (RecognizeUI.syncButton) — иначе пропуск
            block: 'project', key: 'recognize', mob: 'output',
            sel: '#tab_recognize',
            title: 'Сканы',
            text: 'Загрузите чужую смету, накладную или план — позиции подберутся по каталогу.'
        },

        // ───────────── Блок 6. Кабинет и тариф ─────────────
        {
            block: 'cabinet', key: 'header',
            sel: () => {
                const row = document.querySelector('.header-main-controls');
                if (row && row.offsetParent) return row;
                return document.querySelector('.menu-toggle-btn');
            },
            title: 'Кнопки шапки',
            text: 'Сохранить, открыть по коду, начать заново, тема и обучение. Наведите — подскажут. На телефоне — в меню ☰.',
            seller: { text: 'Сохранить, открыть по коду, начать заново и обучение. Наведите — подскажут. На телефоне — в меню ☰.' }
        },
        {
            // Панели нет у гостя и на телефоне — шаг пропустится сам
            block: 'cabinet', key: 'rail',
            sel: '#lk_rail',
            title: 'Разделы',
            text: 'Объекты, заказы, свой прайс на монтаж, реквизиты — открываются рядом со сметой.',
            seller: { text: 'Объекты, заказы, сводка, свои замены, реквизиты — открываются рядом с расчётом.' }
        },
        {
            // Любимые материалы — вкладка внутри «Прайса»; у продавца пункта нет
            block: 'cabinet', key: 'prefs',
            sel: '.lk-rail-item[data-rail="workprices"]',
            title: 'Любимые материалы',
            text: 'В «Прайс → Любимые материалы» отметьте, что ставите чаще, — новые сметы будут считаться так.',
            seller: { skip: true }
        },
        {
            // Итог: что открыто на тарифе и что добавит «Профи», с кнопками оплаты
            block: 'cabinet', key: 'plan',
            sel: () => {
                const r = document.getElementById('lk_rail');
                if (r && r.offsetParent) return r;
                const b = document.getElementById('btn_tour');
                if (b && b.offsetParent) return b;
                return document.querySelector('.menu-toggle-btn');
            },
            title: 'Ваш тариф',
            text: function () { return this.planText(); },
            extra: function () { return this.planExtra(); },
            last: true
        }
    ],

    _step: 0,
    _timer: null,
    _view: 'menu',        // menu | step | done
    _block: null,         // id текущего блока
    _lastShown: -1,       // индекс шага, который уже встречали (чтобы снять snap один раз)
    _snap: null,          // состояние калькулятора при входе на шаг — для заданий «поменяйте»
    _enteredAt: 0,        // когда вошли на шаг (для «сохранили уже после входа»)
    _savedAt: 0,          // когда последний раз нажали «Сохранить» руками и всё получилось

    // ── Короткие помощники для шагов ─────────────────────────────────────
    st: function () {
        try { return (typeof app !== 'undefined' && app.state) || {}; } catch (e) { return {}; }
    },

    // Первая видимая строка сметы с радиатором и её значок замены. Ищем по названию:
    // отдельного признака «это радиатор» у строки в разметке нет.
    swapRow: function (test) {
        try {
            const btns = document.querySelectorAll('.img-wrap[onclick*="openSwapModal"], .swap-inline-btn[onclick*="openSwapModal"]');
            for (const b of btns) {
                if (!b.offsetParent) continue;
                const tr = b.closest('tr');
                // Только название позиции: в строке есть ещё подсказка «i» с длинным текстом
                // («клапан», «насос» и т. п.), и поиск по всей строке принимал радиатор за не-радиатор
                const nm = tr && tr.querySelector('.col-name');
                if (tr && test((nm || tr).textContent || '', tr)) return { tr: tr, btn: b };
            }
        } catch (e) { }
        return null;
    },

    RAD_RE: /радиатор/i,
    // «Группа насосная … радиаторы: 15 из 48 кВт» тоже содержит слово — это не радиатор
    RAD_NOT: /коллектор|шкаф|клапан|головк|узел|фитинг|кронштейн|набор|комплект|кран|групп|насос|смесит|гидравл/i,

    // Сначала строка, название которой начинается с «Радиатор» (перед ним в тексте строки
    // только номер): «Монтажный набор для подключения радиатора» стоит в смете выше самих
    // радиаторов, и стрелка уводила в его окно замены. Нет такой — любая строка со словом.
    radRow: function () {
        return this.swapRow(t => /^\s*радиатор/i.test(t)) ||
            this.swapRow(t => this.RAD_RE.test(t) && !this.RAD_NOT.test(t)) ||
            // В названии нет слова «радиатор»: «Стальной панельный Ventil (Тип 22), 1100 мм (нижнее
            // подключение)», «Space 11 секций». Тогда по артикулу из каталога приборов, а если
            // и его не нашли — по типу прибора в названии.
            this.swapRow((t, tr) => {
                const sku = ((tr && tr.textContent) || '').match(/[A-Z]{3}-\d{4}-\d{6}/);
                return !!sku && this.isRadSku(sku[0]);
            }) ||
            this.swapRow(t => this.RAD_KIND.test(t) && !this.RAD_NOT.test(t));
    },

    RAD_KIND: /панельн|секционн|биметалл|ventil|compact|space|profil/i,

    // Артикул из каталога приборов отопления (и серий замены, и ROMMER-аналогов)
    isRadSku: function (sku) {
        try {
            const ids = this._radSkus || (this._radSkus = (() => {
                const out = new Set();
                const add = it => { if (it && it.id) out.add(it.id); if (it && it.rommer && it.rommer.id) out.add(it.rommer.id); };
                (catalog.rads || []).forEach(add);
                try { app._getSecRadSeries().forEach(x => (x.arr || []).forEach(add)); } catch (e) { }
                return out;
            })());
            return ids.has(sku);
        } catch (e) { return false; }
    },

    // Радиатора в смете не видно — любая строка, которую можно заменить: подсветка на строке
    // сметы честнее, чем на вкладке, где нажимать нечего.
    anySwapRow: function () {
        return this.swapRow(() => true);
    },

    // Строка котла в смете (для шага «Почему такой котёл»)
    BOILER_NOT: /дымоход|кронштейн|рама|набор|комплект|кран|группа|насос|бак|бойлер|датчик|термостат|коаксиал|труб/i,
    boilerRow: function () {
        return this.swapRow(t => /^\s*(электро)?котел|^\s*(электро)?котёл/i.test(t)) ||
            this.swapRow(t => /котел|котёл/i.test(t) && !this.BOILER_NOT.test(t));
    },

    // Учебный дом: площадь 150 м², если своей ещё нет
    seedHouse: function () {
        try {
            if ((parseFloat(app.state.area) || 0) > 0 || this._seeded) return;
            this._seeded = true;
            app.setArea(150);
            if (typeof app.syncUI === 'function') app.syncUI();
            if (typeof app.render === 'function') app.render();
        } catch (e) { }
    },

    eqSum: function () {
        try { return Math.round(app.lastEqSum || 0); } catch (e) { return 0; }
    },

    money: function (n) {
        return (Math.round(n) || 0).toLocaleString('ru-RU') + ' ₽';
    },

    totalHtml: function () {
        const n = this.eqSum();
        if (!n) return '';
        return '<div class="tour-stat"><span>Оборудование по смете</span><b>' + this.money(n) + '</b></div>';
    },

    // Откуда мощность: теплопотери этого дома и то, из чего они сложились
    heatInfo: function () {
        try {
            const s = app.state;
            const kw = parseFloat(app.getHouseHeatLoss()) || 0;
            const area = parseFloat(s.area) || 0;
            const h = s.floors === 2 ? ((s.h1 || 2.7) + (s.h2 || 2.7)) / 2 : (s.h1 || 2.7);
            const t = typeof app.boilerTargetPower === 'function' ? app.boilerTargetPower(kw) : null;
            const city = s.selectedCity && s.selectedCity.name ? String(s.selectedCity.name) : '';
            return { kw: kw, area: area, h: h, city: city, rooms: !!(s.detailedRooms && (s.rooms || []).length),
                need: t ? t.kw : kw, byDhw: !!(t && t.byDhw) };
        } catch (e) { return null; }
    },

    whyText: function () {
        const i = this.heatInfo();
        if (!i || !i.kw) return 'Котёл подбирается по теплопотерям дома: их калькулятор считает сам по площади, высоте, климату города и материалу стен.';
        const perM2 = i.area ? Math.round(i.kw * 1000 / i.area) : 0;
        return 'Теплопотери этого дома — <b>' + this.fmt1(i.kw) + ' кВт</b>' + (perM2 ? ' (≈ ' + perM2 + ' Вт на м²)' : '') + '. ' +
            'Котёл берём не слабее' + (i.byDhw ? ', а с бойлером — с запасом на нагрев воды: <b>' + this.fmt1(i.need) + ' кВт</b>' : '') + '. ' +
            'Город и стены меняются в «Параметрах объекта» — мощность и смета пересчитаются.';
    },

    fmt1: function (n) { return (Math.round((n || 0) * 10) / 10).toLocaleString('ru-RU'); },

    whyFormula: function () {
        const i = this.heatInfo();
        if (!i || !i.kw || i.rooms || !i.area) return '';
        const k = i.kw * 1000 / (i.area * i.h * 37);
        return '<div class="tour-formula">' +
            '<span><b>' + Math.round(i.area) + ' м²</b><small>площадь</small></span><i>×</i>' +
            '<span><b>' + this.fmt1(i.h) + ' м</b><small>потолки</small></span><i>×</i>' +
            '<span><b>37 Вт/м³</b><small>норма</small></span><i>×</i>' +
            '<span><b>' + k.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</b><small>' + (i.city ? this.esc(i.city) + ', стены' : 'климат, стены') + '</small></span><i>=</i>' +
            '<span class="is-res"><b>' + this.fmt1(i.kw) + ' кВт</b><small>теплопотери</small></span>' +
            '</div>';
    },

    // Подраздел с радиаторами свёрнут (app.toggleGroup) — разворачиваем
    openRadGroup: function () {
        try {
            if (this.radRow() || !app.state.groupItems) return;
            const cg = app.state.collapsedGroups || [];
            const it = (app.currentEquipmentList || []).find(i => i && i.group && cg.indexOf(i.group) > -1 &&
                this.RAD_RE.test(i.name || '') && !this.RAD_NOT.test(i.name || ''));
            if (it) app.toggleGroup(it.group);
        } catch (e) { }
    },

    // Открыто ли окно замены радиатора (у него свои фильтры «Подключение» и «Тип прибора»)
    radWinOpen: function () {
        const body = document.getElementById('swap_modal_body');
        return !!(this.swapOpen() && body && body.querySelector('[onclick*="switchSwapRadConnection"]'));
    },

    // Настоящее сохранение из карточки: на телефоне дискета спрятана в меню ☰, и
    // «нажмите дискету» там было заданием без кнопки.
    saveNow: function () {
        try { app.saveToCloud(); } catch (e) { console.warn('[Tour] сохранение:', e); }
    },

    // Узнаём о сохранении, не трогая app.js: оборачиваем saveToCloud. Тихое автосохранение
    // (silent) не считаем — задание про осознанное «Сохранить».
    hookSave: function () {
        try {
            if (this._saveHooked || typeof app === 'undefined' || typeof app.saveToCloud !== 'function') return;
            this._saveHooked = true;
            const orig = app.saveToCloud;
            app.saveToCloud = async function (silent) {
                const r = await orig.apply(this, arguments);
                if (r === true && !silent) { try { Tour.onSaved(); } catch (e) { } }
                return r;
            };
        } catch (e) { }
    },

    // Нажимали ли после входа на шаг элемент, подходящий под селектор
    clicked: function (sel) {
        return (this._clicks || []).some(c => c.t >= this._enteredAt && c.el && c.el.closest && c.el.closest(sel));
    },

    onSaved: function () {
        this._savedAt = Date.now();
        const cur = this.STEPS[this._step];
        if (this._view === 'step' && cur && cur.key === 'save') this._basicSaved = true;
        if (this.active() && this._view === 'step') this.refreshTasks();
    },

    // ── Сфера деятельности ───────────────────────────────────────────────
    // Продавец: сфера «Продавец» без монтажа. Решает это app.isSellerOnly — там же,
    // где прячутся вкладки и разделы, о которых говорит обучение. Своей проверки
    // здесь намеренно нет: два правила разошлись бы, и подсказки начали бы врать.
    // app может быть ещё не готов (обучение восстанавливается из localStorage
    // раньше, чем закончится авторизация) — тогда считаем, что это монтажник, и
    // тексты подменятся на следующем такте tick.
    isSeller: function () {
        try {
            // Именно `app`, а не `window.app`: в app.js он объявлен через const, а
            // const на верхнем уровне свойством window не становится — проверка через
            // window.app молча возвращала «не продавец» и подсказки оставались
            // монтажничьими. typeof прикрывает случай, когда app.js ещё не выполнился.
            if (typeof app === 'undefined' || !app || typeof app.isSellerOnly !== 'function') return false;
            return !!app.isSellerOnly();
        } catch (e) { return false; }
    },

    // Шаг целиком выпадает: у продавца нет того, о чём он рассказывает.
    skipped: function (s) {
        // Функции тарифа: шаг показывается, только если таблица «Тарифы» (и личные
        // отметки) открыли её этому человеку — то же самое решение, что прячет кнопку
        // в интерфейсе, берём у app, а не повторяем здесь. Метода нет (старый app.js в
        // кэше) — шаг остаётся, его уберёт проверка по скрытому элементу.
        try {
            const gate = s && this.GATES[s.key];
            if (gate && typeof app !== 'undefined' && typeof app[gate] === 'function' && !app[gate]()) return true;
        } catch (e) { }
        return !!(s && s.seller && s.seller.skip && this.isSeller());
    },

    // Шаг → метод app, который отвечает «открыта ли функция этому человеку».
    // «Сканы» сюда не входят: у вкладки своя проверка (RecognizeUI), и скрытую кнопку
    // пропускает общий механизм.
    GATES: {
        docs: 'canUseDocs',
        works: 'canUseWorks',
        money: 'canUseMoney',
        cheaper: 'canUseAnalog',
        design: 'canUseDesign',
        ufhplan: 'canUseUfhPlan',
        planedit: 'canUseUfhPlan',
        opcost: 'canUseOpCost',
        branding: 'canUseBranding'
    },

    // Что открыто на тарифе и что добавит «Профи» — для последнего шага. Подписи
    // совпадают со столбцами таблицы «Тарифы»; «открыто» берём теми же проверками, что и
    // GATES (личные отметки и компания учтены), «что даст Профи» — по ячейке строки
    // этого же человека на тарифе pro.
    FEATURES: [
        ['works', 'монтажные работы в смете и документах'],
        ['analog', 'вторая смета «Бюджетнее» и вкладка «Почему дешевле»'],
        ['money', 'вкладка «Деньги» — ваша маржа по объекту'],
        ['docs', 'договор подряда и акты'],
        ['branding', 'свой логотип и реквизиты в КП и счёте'],
        ['ufhplan', 'план отопления по комнатам: раскладка петель и радиаторов'],
        ['opcost', 'стоимость отопления за сезон'],
        ['recognize', 'распознавание чужих смет, накладных и планов'],
        ['design', 'листы проекта'],
        ['rommer', 'ассортимент ROMMER']
    ],

    planInfo: function () {
        const open = [], gain = [];
        let label = '', isPro = false;
        try {
            isPro = app.tariffPlan() === 'pro';
            const acc = app.tariffAccount();
            const m = { works: 'canUseWorks', analog: 'canUseAnalog', money: 'canUseMoney', docs: 'canUseDocs',
                branding: 'canUseBranding', ufhplan: 'canUseUfhPlan', opcost: 'canUseOpCost', design: 'canUseDesign' };
            this.FEATURES.forEach(f => {
                const id = f[0];
                let cur;
                if (m[id] && typeof app[m[id]] === 'function') cur = !!app[m[id]]();
                else if (id === 'rommer') cur = !!app.canUseBrand('ROMMER');
                else cur = app.tariffAccess(id) !== 'off';
                if (cur) { open.push(f[1]); return; }
                // у «Профи» эта функция для этой учётки включена?
                if (!isPro && app.tariffCell(acc, 'pro', id) !== 'off') gain.push(f[1]);
            });
            const accLabel = (app.TARIFF_ACCOUNTS.find(a => a.id === acc) || {}).label || '';
            label = (isPro ? 'Профи' : 'Базовый') + (accLabel ? ' · ' + accLabel : '');
        } catch (e) { }
        return { open: open, gain: gain, label: label, isPro: isPro };
    },

    planText: function () {
        const p = this.planInfo();
        const li = (arr, cls, mark) => '<ul class="tour-plan-list">' + arr.map(x =>
            '<li class="' + cls + '"><span class="tour-plan-mark">' + mark + '</span><span>' + x + '</span></li>').join('') + '</ul>';
        let t = (p.label ? '<div class="tour-plan-badge">' + (p.isPro ? '★ ' : '') + p.label + '</div>' : '');
        if (p.open.length) t += '<div class="tour-plan-h">Уже открыто</div>' + li(p.open, 'tour-plan-ok', '✓');
        if (p.gain.length) {
            t += '<div class="tour-plan-h">Откроет Профи</div>' + li(p.gain, 'tour-plan-no', '✕');
        } else if (p.isPro) {
            t += '<div class="tour-plan-foot">Подписка Профи включает всё, что вы видели в обучении.</div>';
        }
        return t;
    },

    // Кнопки оплаты под текстом последнего шага. Цены — из app.proPlan (региональная
    // цена и акции модуля подписки), а не зашитые числа. Нажатие считается «дошёл до
    // конца»: обучение закрывается, поверх открывается окно тарифа или оплаты.
    planExtra: function () {
        let m = null, y = null;
        try { m = app.proPlan('month'); y = app.proPlan('year'); } catch (e) { }
        const money = n => { try { return app.formatCurrencyAmount(n); } catch (e) { return String(n) + ' ₽'; } };
        const isPro = this.planInfo().isPro;
        let h = '<div class="tour-pay">';
        if (y) h += '<button type="button" class="tour-pay-btn tour-pay-year" onclick="Tour.pay(\'year\')"><span class="tour-pay-tag">Выгоднее</span><b>' + (isPro ? 'Продлить на год' : 'Год') + '</b><span>' + money(Math.round(y.rub / 12)) + '/мес</span></button>';
        if (m) h += '<button type="button" class="tour-pay-btn tour-pay-month" onclick="Tour.pay(\'month\')"><b>' + (isPro ? 'Продлить на месяц' : 'Месяц') + '</b><span>' + money(m.rub) + '</span></button>';
        h += '<a href="#" class="tour-pay-all" onclick="Tour.pay(); return false;">Сравнить тарифы и ввести промокод</a></div>';
        return h;
    },

    // Без аргумента — окно с тарифами, с 'month' | 'year' — сразу окно оплаты
    pay: function (type) {
        this.finish('pay');
        try {
            if (type) app.openPaymentModal(type);
            else app.showModal('pro');
        } catch (e) { console.warn('[Tour] оплата:', e); }
    },

    // Метка для архива: «installer.pro» — по ней видно, на каком тарифе человек прошёл
    planKey: function () {
        try { return app.tariffAccount() + '.' + app.tariffPlan(); } catch (e) { return ''; }
    },

    // Шага у этого человека не будет вовсе: либо он убран по сфере деятельности,
    // либо его элемент спрятан насовсем — нет тарифа («Деньги»), нет доступа
    // (распознавание), не вошёл (умное заполнение). Смотрим только на инлайновый
    // display: его ставит app.js, когда прячет вкладку или кнопку по правам.
    //
    // Скрытое вёрсткой — другая вкладка телефона, узкий экран — сюда намеренно не
    // попадает: такие шаги показываются, стоит переключить вкладку, и вычитать их
    // из счётчика значило бы менять «из скольки» на каждом движении пальцем.
    unavailable: function (s) {
        if (this.skipped(s)) return true;
        let el = null;
        try { el = typeof s.sel === 'function' ? s.sel() : document.querySelector(s.sel); } catch (e) { return false; }
        if (!el) return true;
        if (el.style && el.style.display === 'none') return true;
        // У шага без mob нет двойника на второй вкладке телефона: спрятать его может
        // только право или ширина экрана, и за время обучения это не изменится. Тогда
        // спрашиваем ровно так же, как спрашивает показ шага (target), — иначе счётчик
        // и показ разойдутся: у гостя панель разделов в счёт попадала, а на экран нет,
        // и номер прыгал через два.
        if (!s.mob) return !this.target(s);
        return false;
    },

    // План прохода: какие шаги вообще будут показаны. Считается один раз на запуск,
    // а не на каждую карточку, — иначе «из скольки» пляшет по ходу обучения. Кнопка
    // умного заполнения, например, живёт только на вкладке «Оборудование», и стоит
    // обучению уйти на работы, как она пропадает: пересчёт на месте показывал то
    // 17, то 18. Права за один проход не меняются, а если всё-таки изменились —
    // план пересобирается там, где это заметно (см. show и tick).
    buildPlan: function () {
        this._plan = this.STEPS.map(s => !this.unavailable(s));
    },

    planned: function (i) {
        if (!this._plan) this.buildPlan();
        return !!this._plan[i];
    },

    // План — предположение, а показ шага и его пропуск — факт. Факт сильнее: шаг,
    // который человек видит, считается всегда, а пропущенный не считается никогда.
    // Без этого номер повторялся или прыгал там, где предположение не сошлось —
    // например, кнопка умного заполнения живёт только на вкладке «Оборудование»,
    // и на момент составления плана её могло не быть на экране.
    plan1: function (i) {
        if (!this._plan) this.buildPlan();
        this._plan[i] = true;
    },

    unplan: function (i) {
        if (!this._plan) this.buildPlan();
        this._plan[i] = false;
    },

    // Шаг с учётом сферы: поля из seller перекрывают основные (title, text, anim).
    // Возвращаем копию, а не правим сам шаг: сфера меняется на лету — и локальной
    // панелью на localhost, и правкой анкеты, — а исходные тексты нужны обратно.
    view: function (s) {
        if (!s) return s;
        let v = s;
        if (s.seller && this.isSeller()) {
            v = Object.assign({}, s, s.seller);
            delete v.seller;
        }
        // text-функция — для шагов, чей текст зависит от тарифа (см. шаг 'plan')
        if (typeof v.text === 'function') v = Object.assign({}, v, { text: v.text.call(this) });
        // titleAlt — запасной заголовок, когда шаг про радиатор, а радиатора в смете нет
        // (подсветка падает на другую позицию, и «Замена радиатора» над котлом сбивает с толку).
        // Сам title не трогаем: его читают списки блоков и «Продолжаем с места…».
        if (typeof v.titleAlt === 'function') { try { const t = v.titleAlt.call(this); if (t) v = Object.assign({}, v, { title: t }); } catch (e) { } }
        return v;
    },

    active: function () {
        try { return localStorage.getItem(this.LS_ON) === '1'; } catch (e) { return false; }
    },

    // Обучение — только вошедшим. Гостю не показываем ни карточки, ни кнопку в
    // шапке (её прячет body.guest-mode в style.css): половина шагов до входа
    // упирается в окно авторизации. Судим по app.state.tgUser, а не по классу
    // guest-mode на body — Tour.init срабатывает раньше, чем авторизация
    // успевает проставить класс, а tgUser восстанавливается из localStorage
    // сразу при загрузке.
    allowed: function () {
        try { return !!(typeof app !== 'undefined' && app.state && app.state.tgUser); } catch (e) { return false; }
    },

    // Человек сам решил, нужны ему подсказки или нет: нажал кнопку в шапке, закрыл
    // карточку крестиком или дошёл до конца. С этого момента за него не решаем.
    userChose: function () {
        try { return localStorage.getItem(this.LS_CHOICE) === '1'; } catch (e) { return false; }
    },

    rememberChoice: function () {
        try { localStorage.setItem(this.LS_CHOICE, '1'); } catch (e) { }
    },

    toggle: function (on) {
        try { localStorage.setItem(this.LS_ON, on ? '1' : '0'); } catch (e) { }
        if (on) {
            this.restore();
            this.start();
        } else {
            this.stop();
        }
        this.syncButton();
    },

    // Кнопка в шапке сайта (#btn_tour). Гостю она скрыта, но на всякий случай
    // (мобильное меню, устаревшая вёрстка в кэше) не запускаем обучение и отсюда.
    toggleFromButton: function () {
        if (!this.allowed()) return;
        this.rememberChoice();
        if (this.active()) this.snoozeForce();
        this.toggle(!this.active());
    },

    // ── Принудительное включение из админки ──────────────────────────────
    // Список лежит в app_settings.tour_force (вкладка «Тарифы → Обучение»):
    //   users:   { почта: true|false }  — личная отметка, сильнее всего;
    //   dists:   { id дистрибьютора: true };
    //   regions: { регион: true };
    //   tariffs: { 'installer.base': true } — строка таблицы «Тарифы»;
    //   all:     true — всем, кто ещё не прошёл.
    // Включает обучение только тому, кто его ещё не прошёл до конца; крестик или
    // выключение кнопкой откладывают повтор на SNOOZE_DAYS дней, а не навсегда.
    // Правило решения только здесь, админка его лишь показывает (forceDecisionFor).
    forceDecisionFor: function (row, account, plan) {
        const tf = (typeof app !== 'undefined' && app.appSettings && app.appSettings.tour_force) || null;
        if (!tf) return { on: false, by: '' };
        const login = String((row && (row.email || row.username)) || '').trim().toLowerCase();
        const own = app.accessFlagFor(tf.users, login);
        if (own !== undefined) return { on: own, by: 'own' };
        const dist = row && row.distributor_id;
        if (dist && (tf.dists || {})[dist]) return { on: true, by: 'dist' };
        if (row && row.region && app.regionFlagFor(tf.regions, row.region)) return { on: true, by: 'region' };
        if (account && (tf.tariffs || {})[account + '.' + plan]) return { on: true, by: 'tariff' };
        if (tf.all) return { on: true, by: 'all' };
        return { on: false, by: '' };
    },

    snoozeForce: function () {
        try { localStorage.setItem(this.LS_SNOOZE, String(Date.now() + this.SNOOZE_DAYS * 864e5)); } catch (e) { }
    },

    applyForce: async function () {
        try {
            if (!this.allowed() || this.active()) return;
            try { if (localStorage.getItem(this.LS_DONE) === '1') return; } catch (e) { }
            try { if (Date.now() < parseInt(localStorage.getItem(this.LS_SNOOZE) || '0', 10)) return; } catch (e) { }
            if (typeof app.loadAppSettings === 'function') await app.loadAppSettings();
            const row = app.accessUserRow();
            if (!row.distributor_id && app.state.distributorId) row.distributor_id = app.state.distributorId;
            const d = this.forceDecisionFor(row, app.tariffAccount(), app.tariffPlan());
            if (!d.on) return;
            // Уже прошёл на другом устройстве — не гоняем второй раз. Не прочиталось
            // (нет политики, нет колонки) — считаем, что не проходил.
            try {
                if (typeof supabaseClient !== 'undefined' && row.id) {
                    const { data, error } = await supabaseClient.from('users').select('tour_done_at').eq('id', row.id).maybeSingle();
                    if (!error && data && data.tour_done_at) { try { localStorage.setItem(this.LS_DONE, '1'); } catch (e) { } return; }
                }
            } catch (e) { }
            if (this.active() || !this.allowed()) return;
            this.rememberChoice();
            this.resetPosition();
            this.toggle(true);
        } catch (e) { console.warn('[Tour] принудительное включение:', e); }
    },

    // Вид кнопки: включённый режим подсвечен, подсказка объясняет, что будет по нажатию
    syncButton: function () {
        const btn = document.getElementById('btn_tour');
        if (!btn) return;
        const on = this.active();
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.title = on
            ? 'Режим обучения включён: подсказки на каждом шаге. Нажмите, чтобы выключить'
            : 'Режим обучения: подсказки на каждом шаге';
        this.syncBonusBanner();
    },

    // Умолчание для тех, кто ещё не решал сам: новичку подсказки включаем, а тому,
    // у кого сметы уже сохранены, — нет, он и так знает, куда нажимать. Есть ли
    // сохранённые объекты, выясняет app.decideNewcomerDefaults (один запрос-счётчик
    // и только пока выбор не сделан). Зовут отсюда только вошедшего: у гостя смет
    // нет по определению, и обучение ему на входе не включаем.
    // Переключаем всегда, без проверки «а не в этом ли состоянии уже находимся»:
    // проверка сверялась с записью в localStorage, а она может разойтись с тем, что
    // на экране (запись потёрли, а карточка обучения осталась висеть) — и тогда
    // выключение молча ничего не выключало.
    applyDefault: function (hasObjects) {
        if (this.userChose()) return;
        this.toggle(!hasObjects);
    },

    // Восстановление после перезагрузки страницы
    init: function () {
        this.syncButton();
        if (!this.allowed()) return;
        if (this.active()) {
            this.restore();
            this.start();
            return;
        }
        this.applyForce();
        // Сами подсказки больше никому не включаем на входе. Гостю обучение не
        // показываем вовсе (см. allowed). Вошедшему — потому что первым делом ему
        // показывают окно быстрого старта, а обучение включится после него: этим
        // занимается app.decideNewcomerDefaults и позовёт applyDefault сам.
    },

    // ── Положение: блок, вид карточки, шаг ──────────────────────────────
    ls: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    lsSet: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { } },

    blockById: function (id) { return this.BLOCKS.find(b => b.id === id) || null; },

    // Блоки, которые видит этот человек. Продавцу блок про маржу и договоры подряда не
    // нужен вовсе — не «заперт тарифом», а просто не его; блок без единого доступного шага
    // и без запасного пути не показываем.
    visibleBlocks: function () {
        const seller = this.isSeller();
        return this.BLOCKS.filter(b => {
            if (b.noSeller && seller) return false;
            return this.blockSteps(b.id).length > 0 || !!b.fallback;
        });
    },

    // Какие блоки пройдены на этом устройстве: { basic: 1, estimate: 1 }
    doneMap: function () {
        try { return JSON.parse(this.ls(this.LS_BLOCKS) || '{}') || {}; } catch (e) { return {}; }
    },

    // Шаг запоминаем ещё и по ключу: номер сдвигается, когда в блок добавляют шаги, и
    // человек продолжил бы не с того места. Старые записи (только номер) читаются как раньше.
    _savedStep: function () {
        const key = this.ls(this.LS_STEP_KEY);
        if (key) {
            const j = this.STEPS.findIndex(x => (x.block + ':' + x.key) === key);
            if (j > -1) return j;
        }
        if (key === null && this.ls(this.LS_STEP_VER) !== '2') return 0;
        const n = parseInt(this.ls(this.LS_STEP) || '0', 10);
        return (isNaN(n) || n < 0 || n >= this.STEPS.length) ? 0 : n;
    },

    // Продолжаем с того места, где остановились; нет сохранённого места (первый раз,
    // старая версия обучения, всё пройдено) — показываем список блоков.
    restore: function () {
        const b = this.ls(this.LS_BLOCK), v = this.ls(this.LS_VIEW), n = this._savedStep(), s = this.STEPS[n];
        if (v === 'step' && this.blockById(b) && s && s.block === b) {
            this._block = b; this._step = n; this._view = 'step';
            const first = this.STEPS.findIndex(x => x.block === b);
            if (n > first) this._resumeNote = 'Продолжаем с места, где остановились: «' + s.title + '»';
        } else if (v === 'done' && this.blockById(b)) {
            this._block = b; this._view = 'done';
        } else {
            this._block = null; this._step = 0; this._view = 'menu';
        }
        this._lastShown = -1;
    },

    resetPosition: function () {
        this._block = null; this._step = 0; this._view = 'menu'; this._lastShown = -1;
        this.save();
    },

    save: function () {
        this.lsSet(this.LS_STEP, String(this._step));
        const cur = this.STEPS[this._step];
        this.lsSet(this.LS_STEP_KEY, cur ? cur.block + ':' + cur.key : '');
        this.lsSet(this.LS_STEP_VER, '2');
        this.lsSet(this.LS_BLOCK, this._block || '');
        this.lsSet(this.LS_VIEW, this._view);
    },

    // Сколько шагов блока этот человек увидит (по тарифу, роли и доступам).
    blockSteps: function (id) {
        const out = [];
        this.STEPS.forEach((s, i) => { if (s.block === id && !this.unavailable(s)) out.push(i); });
        return out;
    },

    // Первый по порядку блок, который ещё не пройден и в котором есть что показать.
    recommended: function () {
        const dm = this.doneMap();
        for (const b of this.visibleBlocks()) {
            if (!dm[b.id] && this.blockSteps(b.id).length) return b;
        }
        return null;
    },

    startBlock: function (id, key) {
        if (!this.blockById(id)) return;
        this._block = id; this._view = 'step';
        let i = this.STEPS.findIndex(s => s.block === id && (!key || s.key === key));
        if (i < 0) i = 0;
        this._step = i; this._lastShown = -1;
        if (id === 'basic') { this._basicSaved = false; this._seeded = false; }
        this.logEv('start');
        this.save();
        this.buildPlan();
        this.show();
    },

    resume: function () {
        this._view = 'step'; this._lastShown = -1;
        this.save();
        this.show();
    },

    openMenu: function () {
        this._view = 'menu'; this._lastShown = -1;
        this.save();
        this.show();
    },

    // Блок только для Профи, а у человека Базовый: шагов в обучении не показываем, сразу окно тарифа
    proOnlyLocked: function (b) {
        return !!(b && b.pro) && !this.planInfo().isPro;
    },

    // Блок можно открыть, только если в нём есть шаги; иначе (чаще всего — «Профи» на
    // базовом тарифе) ведём туда, где объясняют, что даёт тариф.
    openBlock: function (id) {
        const b = this.blockById(id);
        if (!b) return;
        if (this.proOnlyLocked(b)) { this.pay(); return; }
        if (!this.blockSteps(id).length && b.fallback) { this.startBlock(b.fallback.block, b.fallback.key); return; }
        this.startBlock(id);
    },

    // Блок кончился. «Первый объект» засчитываем только после сохранения — это и есть
    // доказательство, что человек собрал объект сам; остальные — по доходу до конца.
    endBlock: function () {
        const id = this._block;
        const ok = id !== 'basic' || !!this._basicSaved;
        if (ok) { this.logEv('done'); this.markBlock(id); }
        this._view = 'done'; this._lastShown = -1;
        this.save();
        this.show();
    },

    markBlock: function (id) {
        const m = this.doneMap();
        const first = !m[id];
        m[id] = 1;
        this.lsSet(this.LS_BLOCKS, JSON.stringify(m));
        const b = this.blockById(id);
        if (first && b && b.must) {
            // Окно поздравления ждёт ответ базы (там может быть выдан пробный Профи), но не дольше 1,5 с
            const wait = new Promise(res => setTimeout(() => res(null), 1500));
            Promise.race([this.reportDone(this.blockSteps(id).length), wait])
                .then(until => { try { this.celebrate(until); } catch (e) { } });
        }
    },

    // Enter листает обучение вперёд, как «Дальше». Не трогаем поля ввода (там Enter
    // нужен для данных) и кнопки карточки: их Enter нажимает сам браузер.
    // Слушатель вешаем один раз; он сам проверяет, что обучение сейчас на экране.
    bindKeys: function () {
        if (this._keyBound) return;
        this._keyBound = true;
        document.addEventListener('keydown', e => {
            if (e.key !== 'Enter' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
            if (!this.active() || this.blocked()) return;
            const card = document.getElementById('tour_card');
            if (!card || card.style.display === 'none') return;
            const t = e.target;
            if (t && t.closest) {
                if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
                if (t.closest('#tour_card')) return;
            }
            e.preventDefault();
            this.onEnter();
        });
        // Для заданий «нажмите кнопку»: помним клики, сделанные после входа на шаг
        document.addEventListener('click', e => {
            this._clicks = (this._clicks || []).filter(c => Date.now() - c.t < 600000).slice(-30);
            this._clicks.push({ t: Date.now(), el: e.target });
        }, true);
        // Палец-подсказка ездит за элементом при прокрутке и смене размера окна
        const kick = () => {
            if (this._raf) return;
            this._raf = requestAnimationFrame(() => { this._raf = 0; this.updatePointer(); });
        };
        window.addEventListener('scroll', kick, true);
        window.addEventListener('resize', kick);
    },

    onEnter: function () {
        if (this._view === 'menu') {
            const r = this.recommended();
            if (r) this.startBlock(r.id);
            return;
        }
        if (this._view === 'done') { this.doneAction(); return; }
        const s = this.STEPS[this._step];
        if (this.tasksPending(s)) { this.nudgeTasks(); return; }
        this.next();
    },

    start: function () {
        if (!this.allowed()) return;
        this.injectStyles();
        this.bindKeys();
        this.hookSave();
        document.body.classList.add('tour-running');
        this.buildPlan();
        this.show();
        if (this._timer) clearInterval(this._timer);
        // Полсекунды — компромисс: реакция на действие человека ощущается сразу,
        // а нагрузки нет. Следим за двумя вещами: не выполнил ли он задание и не
        // уехал ли подсвеченный элемент после перерисовки сметы.
        this._timer = setInterval(() => this.tick(), 500);
    },

    stop: function () {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        document.body.classList.remove('tour-running');
        this.clearSpot();
        this.hidePointer();
        const card = document.getElementById('tour_card');
        if (card) card.remove();
        this.syncButton();
    },

    // Крестик на карточке и закрытие после последнего блока. И то и другое — решение
    // человека, поэтому сами подсказки ему больше не включаем.
    //
    // Крестик запоминает место: нажмёт кнопку в шапке ещё раз — обучение продолжится с
    // того же шага. Отметка «прошёл обучение» в учётке ставится не здесь, а когда
    // засчитан блок «Первый объект» (см. markBlock) — крестик на втором шаге её не ставит.
    //   kind === true  — закрыл сам после «всё пройдено»: при следующем запуске список блоков
    //   kind === 'pay' — ушёл к оплате тарифа: не откладываем показ на 3 дня
    finish: function (kind) {
        if (kind !== true && kind !== 'pay' && this._view === 'step') this.logEv('close');
        if (kind !== true && kind !== 'pay') this.snoozeForce();
        if (kind === true) this.resetPosition(); else this.save();
        this.rememberChoice();
        this.toggle(false);
    },

    // Поздравление, когда засчитан блок «Первый объект» (первый раз). Всё свое, без CSS-файла: канва с конфетти из
    // двух нижних углов, фанфары на WebAudio (звук стартует из клика «Готово», поэтому
    // браузер его разрешает; если нет — тихо без звука) и карточка с кнопкой в «Любимые материалы».
    celebrate: function (proUntil) {
        if (document.getElementById('tour_win')) return;
        let canPrefs = false;
        try { canPrefs = !!(typeof app !== 'undefined' && app.state && app.state.tgUser && !app.isSellerOnly()); } catch (e) { }
        if (canPrefs) { try { localStorage.setItem('prefs_offer_shown', '1'); } catch (e) { } }

        const wrap = document.createElement('div');
        wrap.id = 'tour_win';
        wrap.style.cssText = 'position:fixed;inset:0;z-index:60000100;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.55);padding:16px;';
        wrap.innerHTML = '<div style="position:relative;max-width:420px;width:100%;background:var(--bg-card,#fff);color:var(--text-main,#0f172a);border-radius:18px;padding:28px 22px 22px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.35);">'
            + '<div style="font-size:56px;line-height:1;">🏆</div>'
            + '<h3 style="margin:10px 0 8px;font-size:22px;">Поздравляем!</h3>'
            + '<p style="margin:0 0 6px;font-size:15px;font-weight:600;">Обучение пройдено</p>'
            + (proUntil ? '<p style="margin:0 0 12px;font-size:15px;font-weight:700;color:#059669;">Вам открыт Профи на 10 дней — до ' + new Date(proUntil).toLocaleDateString('ru-RU') + '</p>' : '')
            + '<p style="margin:0 0 18px;font-size:14px;line-height:1.5;opacity:.85;">'
            + (canPrefs ? 'Остался последний шаг: выберите любимые материалы, схемы и бренд — новые сметы будут считаться по ним сразу. Менять и сбрасывать можно в любой момент.'
                : 'Теперь вы знаете весь путь от расчёта до счёта клиенту. Удачных смет!')
            + '</p>'
            + (canPrefs ? '<button type="button" id="tour_win_go" style="width:100%;padding:13px;border:0;border-radius:12px;background:var(--primary,#2563eb);color:#fff;font-size:15px;font-weight:700;cursor:pointer;margin-bottom:8px;">Выбрать любимые материалы</button>' : '')
            + '<button type="button" id="tour_win_close" style="width:100%;padding:11px;border:0;border-radius:12px;background:transparent;color:inherit;font-size:14px;cursor:pointer;opacity:.7;">' + (canPrefs ? 'Позже' : 'Закрыть') + '</button>'
            + '</div>';
        document.body.appendChild(wrap);

        const cv = document.createElement('canvas');
        cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:60000200;pointer-events:none;';
        document.body.appendChild(cv);
        const stopFx = this._confetti(cv);
        this._fanfare();

        const close = () => { stopFx(); cv.remove(); wrap.remove(); };
        wrap.querySelector('#tour_win_close').onclick = close;
        const go = wrap.querySelector('#tour_win_go');
        if (go) go.onclick = () => { close(); try { app.showProfileModal(false, 'prefs'); } catch (e) { } };
    },

    _confetti: function (cv) {
        const ctx = cv.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const fit = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
        fit();
        const colors = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#facc15'];
        const parts = [];
        const burst = (side, n) => {
            for (let i = 0; i < n; i++) {
                const ang = (side === 'l' ? -1 : 1) * (0.35 + Math.random() * 0.55) - Math.PI / 2;
                const sp = (9 + Math.random() * 11) * dpr;
                parts.push({ x: (side === 'l' ? 0 : innerWidth) * dpr, y: innerHeight * 0.85 * dpr,
                    vx: (side === 'l' ? 1 : -1) * Math.abs(Math.cos(ang)) * sp,
                    vy: -Math.abs(Math.sin(ang)) * sp * 1.15, w: (6 + Math.random() * 6) * dpr, h: (4 + Math.random() * 5) * dpr,
                    r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: colors[(Math.random() * colors.length) | 0] });
            }
        };
        burst('l', 90); burst('r', 90);
        let t0 = performance.now(), raf = 0, stopped = false, again = false;
        const tick = (now) => {
            if (stopped) return;
            const el = now - t0;
            if (!again && el > 1400) { again = true; burst('l', 60); burst('r', 60); }
            ctx.clearRect(0, 0, cv.width, cv.height);
            for (let i = parts.length - 1; i >= 0; i--) {
                const p = parts[i];
                p.vy += 0.32 * dpr; p.vx *= 0.992; p.x += p.vx; p.y += p.vy; p.r += p.vr;
                if (p.y > cv.height + 40) { parts.splice(i, 1); continue; }
                ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
            }
            if (parts.length) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => { stopped = true; cancelAnimationFrame(raf); };
    },

    _fanfare: function () {
        try {
            const C = window.AudioContext || window.webkitAudioContext;
            if (!C) return;
            const ac = new C(), t = ac.currentTime;
            // до-ми-соль-до с коротким тутти в конце — «приз получен»
            [[523.25, 0, .16], [659.25, .16, .16], [783.99, .32, .16], [1046.5, .48, .5], [783.99, .48, .5], [659.25, .48, .5]].forEach(n => {
                const o = ac.createOscillator(), g = ac.createGain();
                o.type = 'square'; o.frequency.value = n[0];
                g.gain.setValueAtTime(0.0001, t + n[1]);
                g.gain.exponentialRampToValueAtTime(0.12, t + n[1] + .02);
                g.gain.exponentialRampToValueAtTime(0.0001, t + n[1] + n[2]);
                o.connect(g); g.connect(ac.destination);
                o.start(t + n[1]); o.stop(t + n[1] + n[2] + .05);
            });
            setTimeout(() => { try { ac.close(); } catch (e) { } }, 1500);
        } catch (e) { }
    },

    // Отметка в базе (users.tour_done_at, supabase/migrations/20261015_tour_done.sql).
    // Видна в админке администратору, владельцу, менеджеру и наблюдателю. Ставится один
    // раз — повторный проход её не меняет (так решает сама функция). Сбой молча
    // игнорируем: обучение от записи не зависит, а миграция может быть ещё не выполнена.
    // Где обучение бросают: шаг, на котором нажали «Пропустить шаг» или закрыли крестиком.
    // Пишем в журнал на сервере (supabase/migrations/20261023_tour_events.sql); без миграции
    // запрос тихо падает, обучение от него не зависит.
    logEv: function (kind) {
        try {
            if (typeof supabaseClient === 'undefined' || !this.allowed()) return;
            const st = this.STEPS[this._step];
            Promise.resolve(supabaseClient.rpc('log_tour_event', {
                p_kind: kind, p_block: this._block || '', p_step: (st && st.key) || '', p_plan: this.planKey()
            })).catch(() => { });
        } catch (e) { }
    },

    // Возвращает промис срока пробного Профи (строка ISO) или null — если не выдан, не записан
    // или миграция ещё не выполнена. Промис не отклоняется.
    reportDone: function (steps) {
        try { localStorage.setItem(this.LS_DONE, '1'); } catch (e) { }
        try {
            const n = steps || (this._plan || []).filter(Boolean).length;
            if (typeof supabaseClient === 'undefined' || !this.allowed()) return Promise.resolve(null);
            return Promise.resolve(supabaseClient.rpc('mark_tour_done', { p_steps: n, p_plan: this.planKey() }))
                .then(r => {
                    if (r && r.error) { console.warn('[Tour] отметка не записана:', r.error.message); return null; }
                    const until = r && r.data && r.data.pro_until ? r.data.pro_until : null;
                    if (until) this.applyTrialPro(until);
                    return until;
                })
                .catch(() => null);
        } catch (e) { }
        return Promise.resolve(null);
    },

    // Пробный Профи выдан в базе: переносим это в открытый калькулятор, без перезагрузки.
    // Тот же ключ pro_trial_until, что у обычного пробного периода, — значит, и подпись «пробный»
    // и срок в профиле выглядят так же.
    applyTrialPro: function (until) {
        try { localStorage.setItem('pro_trial_until', String(new Date(until).getTime())); } catch (e) { }
        try {
            if (typeof app === 'undefined' || !app.state) return;
            app.state.accountType = 'pro';
            app.state.demoUsed = true;
            if (app.state.tgUser) { app.state.tgUser.account_type = 'pro'; app.state.tgUser.demo_ends_at = until; }
            app.saveState();
            app.syncUI();
        } catch (e) { }
    },

    _nextIdx: function (from) {
        for (let i = from + 1; i < this.STEPS.length; i++) if (this.STEPS[i].block === this._block) return i;
        return -1;
    },

    // Назад перешагиваем шаги, которых человеку не показывают, — по плану, а не только
    // по сфере деятельности. Иначе «Назад» упирался бы в шаг, который show() тут же
    // уводит вперёд, и кнопка выглядела бы сломанной.
    _prevIdx: function (from) {
        for (let i = from - 1; i >= 0; i--) if (this.STEPS[i].block === this._block && this.planned(i)) return i;
        return -1;
    },

    next: function () {
        try { if (this._view === 'step' && this.tasksPending(this.STEPS[this._step])) this.logEv('skip'); } catch (e) { }
        const j = this._nextIdx(this._step);
        if (j < 0) { this.endBlock(); return; }
        this._step = j;
        this.save();
        this.show();
    },

    prev: function () {
        const j = this._prevIdx(this._step);
        if (j < 0) return;
        this._step = j;
        this.save();
        this.show();
    },

    // Палец-указатель на настоящем элементе страницы (см. updatePointer)
    HAND: '<svg class="ta-hand-i" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">' +
        '<path d="M5 2.5l13.5 7.8-6 1.6-3 6.6z" fill="#fff" stroke="#111827" stroke-width="1.3" stroke-linejoin="round"/></svg>',

    target: function (step) {
        const s = step || this.STEPS[this._step];
        if (!s) return null;
        let el = null;
        try { el = typeof s.sel === 'function' ? s.sel() : document.querySelector(s.sel); } catch (e) { return null; }
        // offsetParent === null означает, что элемент или его родитель скрыты. Такой
        // шаг показывать нечестно: подсветка легла бы в пустоту.
        if (!el || (!el.offsetParent && getComputedStyle(el).position !== 'fixed')) return null;
        return el;
    },

    // Вкладка телефона: 'inputs' — параметры, 'output' — смета. На широком экране
    // обе колонки на месте и переключать нечего.
    mobTab: function (which) {
        try {
            if (!app.isMobileLayout || !app.isMobileLayout()) return;
            if ((app.state.mobTab || 'inputs') === which) return;
            app.switchMobileTab(which);
        } catch (e) { }
    },

    clearSpot: function () {
        document.querySelectorAll('.tour-spot').forEach(e => e.classList.remove('tour-spot'));
    },

    // Пока на экране окно быстрого старта, подсказки прячем. Оба окна лежат поверх
    // сметы, перекрывают друг друга и вместе читаются как одна каша — а выбрать
    // типовой объект человек в этот момент всё равно не может, карточка обучения
    // закрывает половину списка. Окно закроют — tick вернёт карточку сам.
    blocked: function () {
        if (document.getElementById('quick_start_overlay')) return true;
        // Окно замены позиции лежит поверх сметы и само объясняет, что выбирать; карточка
        // поверх него закрывала бы список аналогов. Закроют окно — tick вернёт карточку.
        // Исключение — шаг про замену: задание выполняется как раз в этом окне, и карточка,
        // пропавшая в самый нужный момент, заставляла перечитывать задание по памяти. Здесь
        // она не прячется, а сжимается до рамки с заданием (см. place и .tour-card-swap).
        if (this.swapOpen()) {
            const cur = this._view === 'step' && this.STEPS[this._step];
            return !(cur && cur.key === 'replace');
        }
        return false;
    },

    swapOpen: function () {
        const sw = document.getElementById('swap_modal_overlay');
        return !!(sw && getComputedStyle(sw).display !== 'none' && sw.getClientRects().length);
    },

    // Куда показывать пальцем в окне замены. У радиатора свои задания (открыть окно → сменить
    // подключение → выбрать модель): пока подключение не сменили — на кнопку фильтра
    // «Подключение», потом — на первую модель списка. У прочих позиций окно общее
    // (selectSwapAlternative) и задание одно — выбрать, туда и показываем.
    swapPointTarget: function (step) {
        const body = document.getElementById('swap_modal_body');
        if (!body) return null;
        const fl = this.taskFlags(step);
        const rows = Array.prototype.slice.call(body.querySelectorAll('tr[onclick*="selectSwapAlternative"], tr[onclick*="selectSwapRadiator"]'))
            .filter(r => r.offsetParent && !/selected|active/.test(r.className));
        const rc = Array.prototype.slice.call(body.querySelectorAll('[onclick*="switchSwapRadConnection"]')).filter(c => c.offsetParent);
        if (fl.length === 3 && !fl[1] && rc.length) {
            // Любое подключение, кроме нынешнего («Все» не считаем — оно не «смена»)
            const chip = rc.find(c => !c.classList.contains('active') && /'(side|bottom)'/.test(c.getAttribute('onclick')));
            if (chip) return chip;
        }
        if (fl.length === 3 && fl[1] && !rows.length) {
            // С новым подключением в этом материале нет прибора нужной мощности — список
            // пуст. Показываем на «Тип прибора → Все»: там модели находятся.
            const all = Array.prototype.slice.call(body.querySelectorAll('[onclick*="switchSwapRadMaterial"]'))
                .find(c => c.offsetParent && c.getAttribute('onclick').indexOf("'all'") > -1 && !c.classList.contains('active'));
            if (all) return all;
        }
        return rows[0] || null;
    },

    hideCard: function () {
        this.clearSpot();
        this.hidePointer();
        const card = document.getElementById('tour_card');
        if (card) card.style.display = 'none';
    },

    ensureCard: function () {
        let card = document.getElementById('tour_card');
        if (!card) {
            card = document.createElement('div');
            card.id = 'tour_card';
            document.body.appendChild(card);
        }
        // Карточку могли спрятать на время окна быстрого старта — возвращаем
        card.style.display = '';
        return card;
    },

    // Новая карточка (шаг, список блоков, итог): содержимое въезжает лесенкой — по
    // элементу с задержкой. Только при смене экрана: задания и кнопки внутри шага
    // перерисовываются без анимации (refreshTasks меняет лишь их содержимое).
    animIn: function (card) {
        try {
            Array.prototype.forEach.call(card.children, (c, i) => {
                c.classList.add('tour-enter');
                c.style.animationDelay = Math.min(i, 8) * 35 + 'ms';
            });
        } catch (e) { }
    },

    esc: function (s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    // ── Задания: «сделайте сами», проверяются по состоянию калькулятора ─────
    // noMobTasks — на телефоне задания у шага нет: в мобильной смете колонка количества и
    // крестик скрыты, и задание «поменяйте количество» там было не выполнить ничем.
    tasksOf: function (step) {
        if (!step || !step.tasks) return null;
        if (step.noMobTasks && window.innerWidth < 760) return null;
        // tasks-функция — когда задание возможно не у всех (кнопки нет по тарифу): null — шаг без задания
        if (typeof step.tasks === 'function') { try { return step.tasks.call(Tour) || null; } catch (e) { return null; } }
        return step.tasks;
    },

    taskFlags: function (step) {
        return (this.tasksOf(step) || []).map(t => { try { return !!t.done(this._snap); } catch (e) { return false; } });
    },

    tasksPending: function (step) {
        return this.taskFlags(step).some(f => !f);
    },

    tasksHtml: function (step) {
        const fl = this.taskFlags(step);
        let nowLine = '';
        try { const n = typeof step.now === 'function' ? step.now() : ''; if (n) nowLine = '<div class="tour-now">Сейчас: ' + this.esc(n) + '</div>'; } catch (e) { }
        return (this.tasksOf(step) || []).map((t, i) =>
            '<div class="tour-task' + (fl[i] ? ' is-done' : '') + '"><span class="tour-task-mark">' + (fl[i] ? '✓' : '') +
            '</span><span class="tour-task-t">' + t.label + (this._pre && this._pre[i] && fl[i] ? ' <i class="tour-task-pre">уже стоит</i>' : '') + '</span></div>').join('') + nowLine;
    },

    // Кнопки внизу карточки. Пока задание не сделано — тихое «Пропустить»; сделано —
    // обучение само перейдёт дальше через секунду, а «Дальше» горит для нетерпеливых.
    btnsHtml: function (step) {
        const pending = this.tasksPending(step);
        const lastInBlock = this._nextIdx(this._step) < 0;
        let h = '';
        if (this._prevIdx(this._step) >= 0) h += '<button type="button" class="tour-btn tour-btn-ghost tour-btn-back" onclick="Tour.prev()" title="Назад" aria-label="Назад">←</button>';
        if (pending) {
            h += '<button type="button" class="tour-btn tour-btn-ghost tour-btn-skip" onclick="Tour.next()" title="Перейти к следующему шагу, не выполняя задание">Пропустить шаг</button>';
        } else {
            const label = step.last ? 'Готово' : (lastInBlock ? 'Завершить блок' : 'Дальше');
            h += '<button type="button" class="tour-btn' + (this.tasksOf(step) ? ' tour-btn-ready' : '') + '" onclick="Tour.next()" title="' + label + ' (или клавиша Enter)">' +
                label + '<kbd class="tour-kbd">Enter ↵</kbd></button>';
        }
        return h;
    },

    // Задание выполнено (или отменено) — перерисовываем только задания и кнопки, а не
    // всю карточку. Все задания выполнены — через секунду идём дальше сами: человек
    // делает дело на странице, и обучение следует за ним, не требуя ещё и «Дальше».
    // Передумал за эту секунду (сдвинул ползунок с 150) — переход отменяется.
    refreshTasks: function () {
        if (this._view !== 'step') return;
        const step = this.STEPS[this._step];
        const card = document.getElementById('tour_card');
        if (!step || !card || card.style.display === 'none') return;
        const wasDone = card.dataset.t && card.dataset.t.indexOf('false') < 0;
        const box = document.getElementById('tour_tasks');
        const btns = document.getElementById('tour_btns');
        const before = (card.dataset.t || '').match(/true|false/g) || [];
        if (box) box.innerHTML = this.tasksHtml(step);
        if (btns) btns.innerHTML = this.btnsHtml(step);
        card.dataset.t = this.taskFlags(step).join('');
        // Только что выполненное задание — галочка «выпрыгивает»
        if (box) this.taskFlags(step).forEach((f, i) => {
            if (f && before[i] === 'false') { const t = box.querySelectorAll('.tour-task')[i]; if (t) t.classList.add('is-new'); }
        });
        const done = !this.tasksPending(step);
        if (box) box.classList.toggle('is-done', done);
        this._autoAt = (done && !wasDone) ? Date.now() + 1100 : (done ? this._autoAt : 0);
        this.updatePointer();
    },

    note: function (text) {
        const n = document.getElementById('tour_note');
        if (!n) return;
        n.textContent = text;
        n.classList.add('on');
        clearTimeout(this._noteT);
        this._noteT = setTimeout(() => n.classList.remove('on'), 4500);
    },

    nudgeTasks: function () {
        const box = document.getElementById('tour_tasks');
        if (box) { box.classList.remove('tour-shake'); void box.offsetWidth; box.classList.add('tour-shake'); }
        this.note('Сделайте задание на странице — палец показывает, куда нажать. Или «Пропустить».');
        this.updatePointer();
    },

    // ── Палец-подсказка на настоящем элементе страницы ─────────────────
    // Единственная подсказка «куда нажать»: палец и пульсирующее кольцо сидят прямо на
    // нужной кнопке и исчезают, когда задание выполнено.
    hidePointer: function () {
        const p = document.getElementById('tour_pointer');
        if (p) p.style.display = 'none';
    },

    // Элемент, на который показывает палец: point шага, иначе подсвеченный элемент.
    // Окно замены лежит поверх страницы — там показываем на его строки и фильтры.
    pointEl: function (step) {
        if (!step) return null;
        let t = null;
        if (this.swapOpen() && step.key === 'replace') t = this.swapPointTarget(step);
        if (!t && step.point) t = typeof step.point === 'function' ? step.point() : document.querySelector(step.point);
        if (!t || !t.offsetParent) t = this.target(step);
        return t || null;
    },

    updatePointer: function () {
        try {
            const step = this.STEPS[this._step];
            if (!this.active() || this._view !== 'step' || !step || !this.tasksOf(step) || this.blocked() || !this.tasksPending(step)) { this.hidePointer(); return; }
            const card = document.getElementById('tour_card');
            if (!card || card.style.display === 'none') { this.hidePointer(); return; }
            const t = this.pointEl(step);
            if (!t) { this.hidePointer(); return; }
            // В окне замены нужная строка или фильтр часто ниже края окна (на телефоне список
            // моделей начинается на втором экране). Подкручиваем к каждой новой цели и ещё
            // 2,5 с после этого, если она уехала под карточку (окно дорисовывает картинки и
            // строку сдвигает вниз); дальше человек листает сам, и обучение с ним не борется.
            if (this.swapOpen()) {
                if (this._swapScrolled !== t) { this._swapScrolled = t; this._swapSeenAt = Date.now(); this._swapDone = false; }
                const rr = t.getBoundingClientRect(), cr = card.getBoundingClientRect();
                const ty = rr.top + Math.min(rr.height / 2, 24);
                const hidden = rr.bottom < 0 || rr.top > window.innerHeight ||
                    (ty > cr.top && ty < cr.bottom && rr.left < cr.right && rr.right > cr.left);
                if (!this._swapDone || (hidden && Date.now() - this._swapSeenAt < 2500)) {
                    this._swapDone = true;
                    try { t.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch (e) { }
                }
            }
            const r = t.getBoundingClientRect();
            if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) { this.hidePointer(); return; }
            const x = r.width > 260 ? r.left + 70 : r.left + r.width / 2;
            const y = r.top + Math.min(r.height / 2, 24);
            const px = Math.round(Math.max(6, Math.min(x, window.innerWidth - 6)));
            const py = Math.round(Math.max(6, Math.min(y, window.innerHeight - 6)));
            // Элемент закрыт чем-то сверху — открытым меню ☰, окном, самой карточкой. Стрелка
            // поверх меню показывала «в пустоту»: на пункт меню, которого задание не касается.
            // Показываем только на то, что сейчас можно нажать.
            const top = document.elementFromPoint(px, py);
            if (!top || !(t === top || t.contains(top) || top.contains(t))) { this.hidePointer(); return; }
            let p = document.getElementById('tour_pointer');
            if (!p) {
                p = document.createElement('div');
                p.id = 'tour_pointer';
                p.setAttribute('aria-hidden', 'true');
                // Бордовая стрелка прилетает со стороны карточки и смотрит туда, куда летит:
                // наконечник на элементе, хвост за ним сужается и гаснет к карточке — взгляд
                // идёт от текста задания к кнопке. Всё внутри .tp-rot повёрнуто по направлению
                // «элемент → карточка» (--ang), поэтому рисуем как будто карточка справа.
                p.innerHTML = '<span class="tp-ring"></span><span class="tp-hand"><span class="tp-rot">' +
                    '<span class="tp-tail"></span>' +
                    '<svg class="tp-arrow" viewBox="0 0 30 24" width="35" height="28" aria-hidden="true">' +
                    '<path d="M1 12L27 1.5 20.5 12 27 22.5z" fill="#9F1239" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>' +
                    '</span></span>';
                document.body.appendChild(p);
            }
            p.style.left = px + 'px';
            p.style.top = py + 'px';
            // Откуда прилетает: со стороны карточки. Пролёт короткий — 56 px: длинный (было
            // до 140) начинался на соседнем тумблере, и на снимке экрана стрелка «показывала»
            // не туда. Карточка совсем рядом — прилетаем справа снизу.
            const c = card.getBoundingClientRect();
            let dx = (c.left + c.width / 2) - px, dy = (c.top + c.height / 2) - py;
            let len = Math.hypot(dx, dy);
            if (len < 70) { dx = 1; dy = 0.7; len = Math.hypot(dx, dy); }
            const ux = dx / len, uy = dy / len;
            const tl = Math.round(Math.max(40, Math.min(len - 40, 120)));
            const set = (k, v) => { if (p.style.getPropertyValue(k) !== v) p.style.setProperty(k, v); };
            set('--fx', Math.round(ux * 56) + 'px');
            set('--fy', Math.round(uy * 56) + 'px');
            set('--ang', Math.round(Math.atan2(uy, ux) * 180 / Math.PI) + 'deg');
            set('--tl', tl + 'px');
            p.style.display = '';
        } catch (e) { }
    },

    // Группы параметров слева («Котельная и отопление», «Вода») сворачиваются, и свёрнутая
    // группа не прячет элементы от offsetParent: подсветка ложилась на невидимое. Перед
    // показом шага разворачиваем группу, в которой лежит нужный элемент.
    revealGroup: function (el) {
        try {
            let n = el;
            while (n && n !== document.body && !(n.classList && n.classList.contains('pg-collapsed'))) n = n.parentElement;
            if (!n || n === document.body) return;
            let t = n.previousElementSibling;
            while (t && !(t.classList && t.classList.contains('pg-title'))) t = t.previousElementSibling;
            if (t && t.classList.contains('pg-closed')) app.togglePanelGroup(parseInt(t.dataset.pg, 10));
        } catch (e) { }
    },

    // Заголовок карточки: где я (блок и шаг), список блоков и крестик
    headHtml: function (num) {
        return '<div class="tour-card-head">' +
            '<span class="tour-card-num">' + num + '</span>' +
            '<span class="tour-card-tools">' +
            (this._view !== 'menu' ? '<button type="button" class="tour-card-blocks" onclick="Tour.openMenu()" title="Все блоки обучения">☰ Блоки</button>' : '') +
            '<span class="tour-card-x" onclick="Tour.finish()" title="Выключить обучение" role="button" aria-label="Выключить обучение">&times;</span>' +
            '</span></div>';
    },

    plural: function (n, a, b, c) {
        const m = Math.abs(n) % 100, d = m % 10;
        if (m > 10 && m < 20) return c;
        if (d > 1 && d < 5) return b;
        return d === 1 ? a : c;
    },

    // Бонус за обучение (Профи на 10 дней) — баннер под шапкой, а не строка в карточке.
    // Показываем вошедшему, кто ещё не прошёл главный блок и не на Профи, пока бонус включён
    // в админке: Subscription.tourBonusSettings (app_settings.subscription.tourBonus) — тот же
    // флаг, что читает база при выдаче. Крестик прячет баннер на 2 дня. Любой сбой — тишина.
    LS_BONUS_HIDE: 'tour_bonus_banner_hidden_until',
    BONUS_HIDE_MS: 2 * 24 * 60 * 60 * 1000,

    bonusEligible: function () {
        try {
            if (typeof Subscription === 'undefined' || !Subscription.tourBonusSettings().enabled) return false;
            if (!this.allowed() || this.doneMap().basic || this.planInfo().isPro) return false;
            if (app.isTeremStaff()) return false;
            try { if (localStorage.getItem(this.LS_DONE) === '1') return false; } catch (e) { }
            if (typeof app.hasAdminAccess === 'function' && app.hasAdminAccess()) return false;
            // Сведения из базы (тестовая учётка, обучение пройдено на другом устройстве,
            // человек стоит менеджером/наблюдателем). Пока не прочитались — не показываем:
            // лучше на пару секунд позже, чем мигнуть баннером тому, кому он не положен.
            const bp = this.bonusProfile();
            if (!bp || bp.hide) return false;
            // Те же условия, что у базы (mark_tour_done): бонус только тому, у кого ещё не было ни
            // пробного, ни платного Профи, и только бесплатному или базовому аккаунту. Иначе баннер
            // обещал бы то, что база не выдаст (например, на новом устройстве, где doneMap пуст).
            const tg = app.state.tgUser || {};
            if (tg.demo_ends_at || tg.pro_expires_at || app.state.demoUsed) return false;
            if (['free', 'base'].indexOf(tg.account_type || app.state.accountType || 'base') < 0) return false;
            return true;
        } catch (e) { return false; }
    },

    // Кому баннер не положен по данным базы — читается один раз на вход (кэш по id учётки):
    //  · тестовая учётка (users.is_test);
    //  · обучение уже пройдено (users.tour_done_at) — в том числе на другом устройстве;
    //  · служебная роль (admin / viewer / manager) или назначенные наблюдателю компании;
    //  · сотрудник ТЕРЕМ: почта (основная или рабочая) на teremopt.ru;
    //  · почта стоит менеджером или директором в карточке дистрибьютора.
    // Сбой чтения — баннер не показываем (тишина безопаснее навязчивости).
    _bonusProfile: null,
    _bonusProfileKey: null,
    _bonusProfileLoading: false,

    bonusProfile: function () {
        const tg = (app && app.state && app.state.tgUser) || {};
        const key = String(tg.id || tg.email || tg.authUserId || '');
        if (!key) return null;
        if (this._bonusProfileKey === key && this._bonusProfile) return this._bonusProfile;
        if (this._bonusProfileKey !== key) { this._bonusProfile = null; this._bonusProfileKey = key; this._bonusProfileLoading = false; }
        if (!this._bonusProfileLoading) {
            this._bonusProfileLoading = true;
            this.loadBonusProfile().then(p => {
                if (this._bonusProfileKey !== key) return;
                this._bonusProfile = p;
                this._bonusProfileLoading = false;
                this.syncBonusBanner();
            });
        }
        return null;
    },

    loadBonusProfile: async function () {
        try {
            if (typeof supabaseClient === 'undefined' || !supabaseClient) return { hide: true };
            const { data: { session } } = await supabaseClient.auth.getSession();
            const authId = (session && session.user && session.user.id) || (app.state.tgUser && app.state.tgUser.authUserId);
            if (!authId) return { hide: true };
            const { data: u, error } = await supabaseClient.from('users').select('*').eq('auth_user_id', authId).maybeSingle();
            if (error || !u) return { hide: true };
            if (u.is_test) return { hide: true, why: 'test' };
            if (u.tour_done_at) {
                try { localStorage.setItem(this.LS_DONE, '1'); } catch (e) { }
                return { hide: true, why: 'done' };
            }
            if (['admin', 'viewer', 'manager'].indexOf(u.account_type || '') > -1) return { hide: true, why: 'role' };
            if (Array.isArray(u.viewer_distributor_ids) && u.viewer_distributor_ids.length) return { hide: true, why: 'viewer' };
            const mails = (typeof app.userEmails === 'function') ? app.userEmails(u)
                : [u.email, u.work_email].filter(Boolean).map(x => String(x).trim().toLowerCase());
            if (mails.some(m => /@([a-z0-9-]+\.)*teremopt\.ru$/.test(m))) return { hide: true, why: 'terem' };
            if (mails.length && typeof app.emailsOrFilter === 'function') {
                const f = app.emailsOrFilter('manager_email', mails) + ',' + app.emailsOrFilter('director_email', mails);
                const { data: d, error: de } = await supabaseClient.from('distributors').select('id').or(f).limit(1);
                if (de) return { hide: true };
                if (d && d.length) return { hide: true, why: 'manager' };
            }
            return { hide: false };
        } catch (e) { return { hide: true }; }
    },

    bonusBannerHidden: function () {
        const until = parseInt(this.ls(this.LS_BONUS_HIDE) || '0', 10);
        return !isNaN(until) && until > Date.now();
    },

    syncBonusBanner: function () {
        try {
            const host = document.getElementById('tour_bonus_banner');
            if (!host) return;
            const show = this.bonusEligible() && !this.bonusBannerHidden() && !this.active();
            if (!show) { if (host.style.display !== 'none') { host.style.display = 'none'; host.innerHTML = ''; } return; }
            if (host.firstChild) { host.style.display = ''; return; }
            this.injectBonusStyles();
            host.innerHTML =
                '<div class="tbb" role="button" tabindex="0" onclick="Tour.bonusGo()" ' +
                'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();Tour.bonusGo();}" ' +
                'aria-label="Пройти обучение и получить Профи на 10 дней бесплатно">' +
                '<span class="tbb-glow" aria-hidden="true"></span>' +
                '<span class="tbb-ic" aria-hidden="true">🎁</span>' +
                '<span class="tbb-body">' +
                '<span class="tbb-title">Пройдите обучение — получите <b>Профи на 10 дней</b> бесплатно</span>' +
                '<span class="tbb-sub">Соберите учебный дом и сохраните его · ≈ 8 минут</span>' +
                '</span>' +
                '<span class="tbb-cta">Начать <span aria-hidden="true">→</span></span>' +
                '<button type="button" class="tbb-x" onclick="event.stopPropagation();Tour.bonusHide()" ' +
                'title="Скрыть на 2 дня" aria-label="Скрыть на 2 дня">&times;</button>' +
                '</div>';
            host.style.display = '';
        } catch (e) { }
    },

    bonusGo: function () {
        this.rememberChoice();
        if (!this.active()) this.toggle(true);
        this.startBlock('basic');
        this.syncBonusBanner();
    },

    bonusHide: function () {
        this.lsSet(this.LS_BONUS_HIDE, String(Date.now() + this.BONUS_HIDE_MS));
        this.syncBonusBanner();
    },

    injectBonusStyles: function () {
        if (document.getElementById('tour_bonus_styles')) return;
        const st = document.createElement('style');
        st.id = 'tour_bonus_styles';
        st.textContent = `
#tour_bonus_banner { margin: 0 20px 12px; }
.tbb { position: relative; overflow: hidden; display: flex; align-items: center; gap: 14px;
  padding: 12px 52px 12px 16px; border-radius: 14px; cursor: pointer; color: #fff;
  background: linear-gradient(110deg, #4338ca 0%, #2563eb 45%, #059669 100%);
  box-shadow: 0 6px 20px rgba(37, 99, 235, .25); transition: transform .18s ease, box-shadow .18s ease;
  animation: tbbIn .4s ease both; outline: none; }
.tbb:hover { transform: translateY(-1px); box-shadow: 0 10px 28px rgba(37, 99, 235, .35); }
.tbb:focus-visible { box-shadow: 0 0 0 3px rgba(255,255,255,.9), 0 0 0 6px #2563eb; }
.tbb-glow { position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,.22) 50%, transparent 70%);
  transform: translateX(-100%); animation: tbbShine 4.5s ease-in-out 1s infinite; }
.tbb-ic { flex: none; width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center;
  font-size: 22px; background: rgba(255,255,255,.18); backdrop-filter: blur(4px); }
.tbb-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.tbb-title { font-size: 15px; font-weight: 600; line-height: 1.3; }
.tbb-title b { font-weight: 800; color: #fef08a; }
.tbb-sub { font-size: 12.5px; opacity: .85; }
.tbb-cta { flex: none; padding: 8px 16px; border-radius: 999px; background: #fff; color: #1e3a8a;
  font-weight: 700; font-size: 14px; white-space: nowrap; transition: background .15s ease; }
.tbb:hover .tbb-cta { background: #fef9c3; }
.tbb-x { position: absolute; top: 50%; right: 10px; transform: translateY(-50%); width: 30px; height: 30px;
  border: 0; border-radius: 50%; background: rgba(255,255,255,.14); color: #fff; font-size: 20px; line-height: 1;
  cursor: pointer; display: grid; place-items: center; transition: background .15s ease; }
.tbb-x:hover { background: rgba(255,255,255,.3); }
@keyframes tbbIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
@keyframes tbbShine { 0% { transform: translateX(-100%); } 40%, 100% { transform: translateX(100%); } }
@media (max-width: 640px) {
  #tour_bonus_banner { margin: 0 10px 10px; }
  .tbb { flex-wrap: wrap; gap: 10px 12px; padding: 12px 44px 12px 12px; }
  .tbb-ic { width: 34px; height: 34px; font-size: 18px; }
  .tbb-title { font-size: 14px; }
  .tbb-cta { width: 100%; text-align: center; }
  .tbb-x { top: 10px; transform: none; }
}
@media (prefers-reduced-motion: reduce) { .tbb, .tbb-glow { animation: none; } .tbb:hover { transform: none; } }
@media print { #tour_bonus_banner { display: none !important; } }
`;
        document.head.appendChild(st);
    },

    renderMenu: function () {
        const card = this.ensureCard();
        this.clearSpot();
        this.hidePointer();
        const dm = this.doneMap();
        const rec = this.recommended();
        const vis = this.visibleBlocks();
        const doneN = vis.filter(b => dm[b.id]).length;
        const rowOf = b => {
            const n = this.blockSteps(b.id).length;
            const locked = n === 0 || this.proOnlyLocked(b);
            const done = !!dm[b.id];
            const isRec = !!(rec && rec.id === b.id);
            const st = done ? '<span class="tour-blk-st is-ok">✓ Пройден</span>'
                : locked ? '<span class="tour-blk-st is-lock">🔒 Профи</span>'
                    : isRec ? '<span class="tour-blk-st is-rec">Начать</span>'
                        : '<span class="tour-blk-st">Открыть</span>';
            const meta = locked ? 'Откроется на тарифе Профи — покажем, что он даёт'
                : '≈ ' + b.min + ' мин · ' + n + ' ' + this.plural(n, 'шаг', 'шага', 'шагов');
            return '<button type="button" class="tour-blk' + (done ? ' is-done' : '') + (isRec ? ' is-rec' : '') + (locked ? ' is-locked' : '') +
                '" onclick="Tour.openBlock(\'' + b.id + '\')">' +
                '<span class="tour-blk-ic">' + b.icon + '</span>' +
                '<span class="tour-blk-body"><b>' + b.title + (b.must && !done ? ' <i class="tour-blk-must">главный</i>' : '') + '</b>' +
                '<small>' + b.sub + '</small><small class="tour-blk-meta">' + meta + '</small></span>' + st + '</button>';
        };
        // Обычные блоки — списком, «Профи» — сворачиваемой секцией: карточка влезает в один экран
        const baseBlocks = vis.filter(b => !b.pro), proBlocks = vis.filter(b => b.pro);
        let rows = baseBlocks.map(rowOf).join('');
        if (proBlocks.length) {
            const isPro = this.planInfo().isPro;
            const openPro = !!(rec && rec.pro);
            rows += '<details class="tour-pro"' + (openPro ? ' open' : '') + '><summary><span>' +
                (isPro ? 'Новое в Профи' : 'Только в Профи') + '</span><i class="tour-pro-new">NEW</i></summary>' +
                '<div class="tour-blks">' + proBlocks.map(rowOf).join('') + '</div></details>';
        }
        let resumeBtn = '';
        const rs = this.STEPS[this._step], rb = this.blockById(this._block);
        if (rb && rs && rs.block === rb.id && !dm[rb.id] && this._step > this.STEPS.findIndex(x => x.block === rb.id)) {
            resumeBtn = '<button type="button" class="tour-btn tour-btn-ready tour-resume" onclick="Tour.resume()">▶ Продолжить: «' +
                this.esc(rb.title) + '», ' + this.esc(rs.title) + '</button>';
        }
        card.innerHTML = this.headHtml('Обучение · пройдено ' + doneN + ' из ' + vis.length) +
            '<div class="tour-card-title">Что хотите освоить?</div>' +
            '<div class="tour-card-text">Начните с первого: соберите учебный дом.</div>' +
            resumeBtn +
            '<div class="tour-blks">' + rows + '</div>' +
            '<div class="tour-card-foot">' +
            (rec ? '<span class="tour-kbd-line"> Клавиша <kbd class="tour-kbd tour-kbd-plain">Enter ↵</kbd> — начать «' + rec.title + '».</span>' : '') + '</div>';
        this.animIn(card);
        this.placeFree(card);
    },

    // Блок закончен: итог и куда идти дальше
    renderDone: function () {
        const card = this.ensureCard();
        this.clearSpot();
        this.hidePointer();
        const b = this.blockById(this._block) || this.BLOCKS[0];
        const ok = !!this.doneMap()[b.id];
        const rec = this.recommended();
        let body, btns;
        if (ok) {
            if (b.id === 'basic') {
                const s = this.st();
                const chips = [];
                if (s.area) chips.push(Math.round(s.area) + ' м²');
                if ((s.fuels || []).length) chips.push((s.fuels || []).map(f => f === 'gas' ? 'газ' : 'электро').join(' + '));
                if ((s.systems || []).length) chips.push((s.systems || []).map(f => f === 'rad' ? 'радиаторы' : 'тёплый пол').join(' + '));
                if (s.hotWater) chips.push('бойлер');
                if (s.water) chips.push('водоснабжение');
                if (s.well) chips.push('скважинный насос');
                try { const t = document.getElementById('total_sum'); const tt = t && (t.textContent || '').trim(); if (tt) chips.push('смета ' + tt); } catch (e) { }
                body = 'Объект собран и лежит в «Объектах». Следующий шаг — отправить смету клиенту: ссылка, PDF или Excel.' +
                    (chips.length ? '<div class="tour-chips">' + chips.map(c => '<span>' + c + '</span>').join('') + '</div>' : '');
            } else {
                body = 'Вернуться к нему можно из списка блоков.';
            }
            btns = rec
                ? '<button type="button" class="tour-btn tour-btn-ready" onclick="Tour.doneAction()">Дальше: «' + rec.title + '»<kbd class="tour-kbd">Enter ↵</kbd></button>'
                : '<button type="button" class="tour-btn tour-btn-ready" onclick="Tour.doneAction()">Закрыть обучение<kbd class="tour-kbd">Enter ↵</kbd></button>';
        } else {
            body = 'Практика засчитывается после сохранения объекта.';
            btns = '<button type="button" class="tour-btn tour-btn-ready" onclick="Tour.doneAction()">К сохранению<kbd class="tour-kbd">Enter ↵</kbd></button>';
        }
        const locked = ok ? this.lockedSteps(b.id) : [];
        if (locked.length) body += '<div class="tour-locked">Не показали — не входит в ваш тариф: ' + locked.map(x => this.esc(x)).join(', ') + '.</div>';
        card.innerHTML = this.headHtml(ok ? 'Блок пройден' : 'Блок не засчитан') +
            '<div class="tour-card-title tour-done-title">' + (ok ? '<span class="tour-done-mark">✓</span> ' : '') + b.title + '</div>' +
            '<div class="tour-card-text">' + body + '</div>' +
            '<div class="tour-card-btns"><button type="button" class="tour-btn tour-btn-ghost" onclick="Tour.openMenu()">Все блоки</button>' + btns + '</div>';
        this.animIn(card);
        this.placeFree(card);
    },

    // Главная кнопка итога блока (и Enter на нём)
    doneAction: function () {
        const b = this.blockById(this._block);
        const ok = b && !!this.doneMap()[b.id];
        if (!ok) { this.startBlock(this._block || 'basic', 'save'); return; }
        const rec = this.recommended();
        if (rec) this.openBlock(rec.id); else this.finish(true);
    },

    // Шаги блока, которых нет из-за тарифа или личных доступов (а не из-за экрана): человек
    // должен знать, что пропустил, а не гадать, куда делась часть обучения.
    lockedSteps: function (id) {
        const out = [];
        this.STEPS.forEach(st => {
            if (st.block !== id) return;
            try {
                const gate = this.GATES[st.key];
                if (gate && typeof app !== 'undefined' && typeof app[gate] === 'function' && !app[gate]() && !(st.seller && st.seller.skip && this.isSeller())) out.push(st.title);
            } catch (e) { }
        });
        return out;
    },

    // Список и итог — карточка по центру, без привязки к элементу страницы
    placeFree: function (card) {
        const narrow = window.innerWidth < 760;
        if (narrow) {
            card.className = 'tour-card tour-card-free tour-card-bottom';
            card.style.left = ''; card.style.top = '';
            card.style.bottom = (this.bottomBusy() + 10) + 'px';
            return;
        }
        card.style.bottom = '';
        card.className = 'tour-card tour-card-free';
        const w = card.offsetWidth || 400, h = card.offsetHeight || 360;
        card.style.left = Math.round(Math.max(8, (window.innerWidth - w) / 2)) + 'px';
        card.style.top = Math.round(Math.max(8, (window.innerHeight - h) / 2 - 20)) + 'px';
    },

    // Шаг пропущен насовсем — идём к следующему шагу блока; блок кончился — итог
    _skipForward: function () {
        const j = this._nextIdx(this._step);
        if (j < 0) { this.endBlock(); return false; }
        this._step = j;
        return true;
    },

    show: function () {
        if (this.blocked()) { this.hideCard(); return; }
        if (this._view === 'menu') { this.renderMenu(); return; }
        if (this._view === 'done') { this.renderDone(); return; }
        // Пропускаем шаги, которым нечего подсветить
        let guard = 0;
        while (guard++ < this.STEPS.length) {
            const s = this.STEPS[this._step];
            if (!s || s.block !== this._block) { this.endBlock(); return; }
            // Шаг не про этого человека: у продавца нет того, что он показывает
            if (this.skipped(s)) {
                this.unplan(this._step);
                if (!this._skipForward()) return;
                continue;
            }
            // Шаг может сам открыть свёрнутый блок — иначе подсвечивать нечего
            if (s.before) { try { s.before(); } catch (e) { } }
            let el = this.target(s);
            // На телефоне параметры и смета живут на разных вкладках, и половина
            // шагов оказывалась в скрытой. Переключаем вкладку только когда иначе шаг
            // пришлось бы пропустить — чтобы не выдёргивать человека, если он сам
            // ушёл посмотреть другое.
            if (!el && s.mob) { this.mobTab(s.mob); el = this.target(s); }
            if (el) break;
            // Шаг пропущен на самом деле — вычёркиваем его из плана, иначе номер
            // следующей карточки перескочит через него.
            this.unplan(this._step);
            if (!this._skipForward()) return;
        }
        this.save();
        const step = this.STEPS[this._step];
        const el = this.target(step);
        if (!el) { this.finish(); return; }

        this.revealGroup(el);

        // Вошли на новый шаг: запоминаем состояние для заданий «поменяйте что-нибудь»
        const fresh = this._lastShown !== this._step;
        if (fresh) {
            this._lastShown = this._step;
            this._enteredAt = Date.now();
            this.logEv('step');
            try { this._snap = step.snap ? step.snap() : null; } catch (e) { this._snap = null; }
            // Что уже выполнено к моменту входа (4 жильца и 60 м по умолчанию): такие задания
            // помечаем «уже стоит», иначе галочка загорается без действия и сбивает с толку.
            this._pre = this.taskFlags(step);
        }

        this.clearSpot();
        el.classList.add('tour-spot');
        // Прокрутка мгновенная, а не плавная: задача шага — показать элемент, и
        // анимация тут не украшение, а лишний способ не доехать. Плавная прокрутка
        // считается композитором и в части окружений (свёрнутая вкладка, часть
        // встроенных браузеров) не двигается вовсе — подсветка оставалась за экраном.
        try { el.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch (e) { }
        this._settleUntil = Date.now() + 2500;

        const card = this.ensureCard();
        // Сфера деятельности решает, какой текст показать. Запоминаем её на карточке:
        // на localhost сферу переключают панелью прямо на ходу, и tick по этой метке
        // увидит, что тексты устарели, и пересоберёт шаг.
        card.dataset.seller = this.isSeller() ? '1' : '0';
        // Шаги, которых у этого человека нет, из счётчика убираем: «Шаг 10 из 14» с
        // пропущенной десяткой читается как сбой обучения. Счёт — внутри блока.
        // Шаг на экране — значит он в счёте, что бы там ни решил план заранее.
        this.plan1(this._step);
        const inBlock = [];
        this.STEPS.forEach((s, i) => { if (s.block === this._block) inBlock.push(i); });
        const total = inBlock.filter(i => this._plan[i]).length;
        const n = inBlock.filter(i => i <= this._step && this._plan[i]).length;
        const v = this.view(step);
        const b = this.blockById(this._block);
        card.dataset.t = this.taskFlags(step).join('');
        this._autoAt = 0;
        card.innerHTML =
            this.headHtml((b ? b.icon + ' ' + b.title + ' · ' : '') + n + ' / ' + total) +
            '<div class="tour-prog"><i style="width:' + Math.round(n / Math.max(total, 1) * 100) + '%"></i></div>' +
            '<div class="tour-card-title">' + v.title + '</div>' +
            '<div class="tour-card-text">' + v.text + '</div>' +
            (this.tasksOf(step) ? '<div class="tour-tasks' + (this.tasksPending(step) ? '' : ' is-done') + '" id="tour_tasks">' + this.tasksHtml(step) + '</div>' : '') +
            (step.actions ? '<div class="tour-actions">' + step.actions.map(a =>
                '<button type="button" class="tour-act" onclick="' + a.run + '">' + a.label + '</button>').join('') + '</div>' : '') +
            (typeof v.extra === 'function' ? v.extra.call(this) : '') +
            '<div class="tour-note" id="tour_note" role="status"></div>' +
            '<div class="tour-card-btns" id="tour_btns">' + this.btnsHtml(step) + '</div>';
        if (fresh) this.animIn(card);
        this.chooseDock(card, el);
        this.updatePointer();
        if (this._resumeNote) { this.note(this._resumeNote); this._resumeNote = ''; }
    },

    // ── Где стоит карточка ──────────────────────────────────────────────
    // Раньше карточка вставала рядом с подсвеченным элементом — над, под или сбоку, — и
    // на каждом шаге прыгала по экрану, а то и ложилась на соседние поля. Теперь у неё
    // постоянное место: правый нижний угол (на телефоне — полоса снизу). Взгляд знает,
    // куда смотреть, а палец на странице показывает, куда нажимать.
    //
    // Угол выбирается один раз на шаг (chooseDock), а не на каждом такте: если нужный
    // элемент оказался под карточкой, сначала пробуем увести его прокруткой вверх, и
    // только если не вышло — переставляем карточку в левый угол (на телефоне — наверх).
    // Справа оставляем 96 px под плавающие кнопки калькулятора (ИИ, «вверх/вниз»).
    DOCK_RIGHT_GAP: 96,

    overlaps: function (card, el) {
        const a = card.getBoundingClientRect(), r = el.getBoundingClientRect();
        return !(r.right < a.left - 8 || r.left > a.right + 8 || r.bottom < a.top - 8 || r.top > a.bottom + 8);
    },

    chooseDock: function (card, el) {
        const narrow = window.innerWidth < 760;
        this._dock = narrow ? 'bottom' : 'right';
        this.place(card, el);
        if (!this.overlaps(card, el)) return;
        // Уводим элемент прокруткой в свободную часть экрана — над карточкой
        const a = card.getBoundingClientRect(), r = el.getBoundingClientRect();
        if (r.height < a.top - 70) {
            const shift = r.bottom - (a.top - 16);
            if (shift > 2) window.scrollBy(0, Math.round(shift));
            else if (r.top < 60) window.scrollBy(0, Math.round(r.top - 70));
        }
        if (!this.overlaps(card, el)) return;
        this._dock = narrow ? 'top' : 'left';
        this.place(card, el);
        if (this.overlaps(card, el)) { this._dock = narrow ? 'bottom' : 'right'; this.place(card, el); }
    },

    place: function (card, el) {
        const narrow = window.innerWidth < 760;
        card.style.right = '';
        // Окно замены на весь экран: карточка сжимается до рамки с заданием в нижнем углу
        if (this.swapOpen()) {
            card.className = 'tour-card tour-card-swap';
            card.style.left = ''; card.style.top = '';
            card.style.bottom = (this.bottomBusy() + 12) + 'px';
            card.style.right = '12px';
            // Телефон: карточка во всю ширину закрывала низ окна, а список моделей там и
            // кончается — докрутить строку выше нельзя, и стрелке некуда было показать.
            // Нужное место в нижней половине экрана — карточку наверх.
            if (window.innerWidth < 760) {
                let low = false;
                try {
                    const pt = this.pointEl(this.STEPS[this._step]);
                    const r = pt && pt.getBoundingClientRect();
                    low = !!(r && r.top + Math.min(r.height / 2, 24) > window.innerHeight * 0.55);
                } catch (e) { }
                if (low) { card.classList.add('tour-card-swap-top'); card.style.bottom = ''; }
            }
            return;
        }
        if (narrow) {
            const top = this._dock === 'top';
            card.className = 'tour-card tour-card-bottom' + (top ? ' tour-card-atop' : '');
            card.style.left = ''; card.style.top = '';
            card.style.bottom = top ? '' : (this.bottomBusy() + 10) + 'px';
            return;
        }
        card.style.bottom = '';
        this._prevPos = [parseFloat(card.style.left), parseFloat(card.style.top)];
        card.className = 'tour-card tour-card-dock';
        const w = card.offsetWidth || 340, h = card.offsetHeight || 220;
        const left = this._dock === 'left' ? 16 : window.innerWidth - w - this.DOCK_RIGHT_GAP;
        // Баннер cookie лежит в левом нижнем углу — поднимаемся над ним, только если он под нами
        const busy = this.bottomBusy(left, left + w);
        const top = window.innerHeight - busy - h - 16;
        card.style.left = Math.round(Math.max(8, left)) + 'px';
        card.style.top = Math.round(Math.max(8, top)) + 'px';
        this.placeNear(card, w, h, left, top, busy);
    },

    // Угол — постоянное место, но если место действия далеко от него (поле слева, карточка
    // справа внизу), задание читают по памяти, а карточку даже не замечают. Тогда карточка
    // встаёт рядом с тем, куда показывает палец: под ним, иначе над, иначе сбоку.
    placeNear: function (card, w, h, left, top, busy) {
        try {
            const step = this.STEPS[this._step];
            const keep = () => {
                const pl = (this._prevPos || [])[0], pt = (this._prevPos || [])[1];
                if (this._wasNear && isFinite(pl) && isFinite(pt)) { card.style.left = pl + 'px'; card.style.top = pt + 'px'; }
            };
            if (!this.active() || this._view !== 'step' || !step || !this.tasksOf(step) || !this.tasksPending(step)) { keep(); return; }
            const t = this.pointEl(step);
            if (!t) { keep(); return; }
            const b = t.getBoundingClientRect();
            if (b.bottom < 0 || b.top > window.innerHeight) return;
            const far = Math.hypot((b.left + b.width / 2) - (left + w / 2), (b.top + b.height / 2) - (top + h / 2));
            if (far < 420) { this._wasNear = false; return; }
            this._wasNear = true;
            // Зазор 64 px: в нём живёт стрелка с хвостом, иначе она уходит под карточку.
            // Порядок: сбоку справа (там чаще пустая смета, а не параметры, которые человек
            // трогает), под элементом, над ним, слева. Карточка не должна закрывать ни сам
            // элемент, ни соседние поля вокруг него.
            const gap = 64, floor = window.innerHeight - busy - 8;
            const roomR = window.innerWidth - b.right - gap - 8, roomL = b.left - gap - 8;
            let L = b.left + b.width / 2 - w / 2, T = b.bottom + gap;
            if (roomR >= w) { L = b.right + gap; if (b.right < 420) L = Math.max(L, 474); else if (b.left > 430 && b.width < 80 && roomR >= w + 300) L = b.right + 360; T = b.top + b.height / 2 - h / 2; }
            else if (T + h > floor) {
                if (b.top - gap - h > 8) T = b.top - gap - h;
                else if (roomL >= w) { L = b.left - gap - w; T = b.top + b.height / 2 - h / 2; }
            }
            L = Math.max(8, Math.min(L, window.innerWidth - w - 8));
            T = Math.max(8, Math.min(T, floor - h));
            // Липкость: если карточка уже стоит рядом (в пределах 260 px от нужного места) и
            // не закрывает цель вместе с зазором под стрелку — остаётся где есть, не дёргается.
            const cl = (this._prevPos || [])[0], ct = (this._prevPos || [])[1];
            if (isFinite(cl) && isFinite(ct) && Math.hypot(cl - L, ct - T) < 200 &&
                (cl + w < b.left - 40 || cl > b.right + 40 || ct + h < b.top - 40 || ct > b.bottom + 40)) {
                card.style.left = cl + 'px'; card.style.top = ct + 'px';
                return;
            }
            card.style.left = Math.round(L) + 'px';
            card.style.top = Math.round(T) + 'px';
        } catch (e) { }
    },

    // Сколько снизу занято чужим: сейчас это баннер cookie, но если появится ещё
    // что-то прижатое к низу, добавлять сюда.
    bottomBusy: function (x1, x2) {
        const banner = document.querySelector('.hc-cookie-banner');
        if (!banner) return 0;
        if (getComputedStyle(banner).display === 'none') return 0;
        const r = banner.getBoundingClientRect();
        if (r.bottom < window.innerHeight - 40) return 0;
        if (x1 !== undefined && (r.right < x1 || r.left > x2)) return 0;
        return Math.round(r.height) + 8;
    },

    tick: function () {
        if (!this.active()) { this.stop(); return; }
        if (this.blocked()) { this.hideCard(); return; }
        // Карточки ещё нет или её спрятало окно быстрого старта / замены, а его уже
        // закрыли — собираем шаг заново, иначе подсказка не вернётся до следующего действия
        const shown = document.getElementById('tour_card');
        if (!shown || shown.style.display === 'none') { this.show(); return; }
        // Список блоков и итог привязаны к экрану, а не к элементу страницы
        if (this._view !== 'step') { this.placeFree(shown); return; }
        const step = this.STEPS[this._step];
        if (!step) { this.finish(); return; }
        // Сфера деятельности выясняется не сразу: обучение восстанавливается из
        // localStorage раньше, чем закончится вход, а на localhost её ещё и
        // переключают на ходу. Разошлась с тем, что нарисовано, — собираем заново.
        if (shown.dataset.seller !== (this.isSeller() ? '1' : '0')) { this.buildPlan(); this.show(); return; }
        if (this.skipped(step)) { this.show(); return; }
        if (step.key === 'replace') {
            const open = this.radWinOpen();
            if (open) this._radWin = true;
            // Окно закрыли, не выбрав модель, — палец уже вернулся на фото радиатора, поясняем словами
            else if (this._radWasOpen && this.tasksPending(step)) this.note('Окно замены закрылось. Нажмите на фото радиатора снова — палец покажет где.');
            this._radWasOpen = open;
        }
        // Застрял на задании: через 30 секунд напоминаем, что шаг можно пропустить (один раз на шаг)
        if (this.tasksOf(step) && this.tasksPending(step) && this._stuckKey !== this._step + ':' + this._enteredAt && Date.now() - this._enteredAt > 30000) {
            this._stuckKey = this._step + ':' + this._enteredAt;
            this.note('Не получается? Нажмите «Пропустить шаг» — вернуться можно кнопкой ←.');
        }
        // Человек выполнил (или отменил) задание — обновляем галочки и кнопки
        if (this.tasksOf(step) && shown.dataset.t !== this.taskFlags(step).join('')) this.refreshTasks();
        // Всё выполнено и секунда прошла — дальше сами (см. refreshTasks)
        if (this._autoAt && Date.now() >= this._autoAt) {
            this._autoAt = 0;
            if (this.tasksOf(step) && !this.tasksPending(step)) { this.next(); return; }
        }
        // Смета перерисовалась, элемент уехал или исчез — поправляем подсветку
        const el = this.target(step);
        if (!el) { this.show(); return; }
        if (!el.classList.contains('tour-spot')) { this.clearSpot(); el.classList.add('tour-spot'); }
        // Смета после включённой функции перерисовывается с задержкой, и подсвеченная
        // строка могла уехать за экран уже после прокрутки. Первые секунды шага возвращаем
        // её на место; потом не трогаем — иначе обучение дралось бы с рукой человека.
        if (Date.now() < (this._settleUntil || 0)) {
            const r = el.getBoundingClientRect();
            if (r.bottom < 0 || r.top > window.innerHeight) { try { el.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch (e) { } }
        }
        this.place(shown, el);
        this.updatePointer();
    },

    // Телефон: нажали в поле — открылась клавиатура, и карточка поверх страницы закрывает поле,
    // в которое надо вписать значение. Пока человек печатает, карточка и палец прячутся
    // (см. body.tour-typing в стилях); ушёл из поля — возвращаются.
    hookTyping: function () {
        if (this._typingHooked) return;
        this._typingHooked = true;
        // Число площади — не input, а contenteditable-span, поэтому смотрим и на isContentEditable
        const isField = t => !!(t && t.tagName && !(t.closest && t.closest('#tour_card')) &&
            ((/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !/^(checkbox|radio|button|range|submit)$/.test(t.type || '')) || t.isContentEditable));
        document.addEventListener('focusin', e => {
            if (window.innerWidth < 760 && this.active() && isField(e.target)) document.body.classList.add('tour-typing');
        });
        document.addEventListener('focusout', () => {
            setTimeout(() => { if (!isField(document.activeElement)) document.body.classList.remove('tour-typing'); }, 150);
        });
    },

    injectStyles: function () {
        this.hookTyping();
        if (document.getElementById('tour_styles')) return;
        const st = document.createElement('style');
        st.id = 'tour_styles';
        st.textContent = `
.tour-spot {
    outline: 2px solid var(--primary);
    outline-offset: 3px;
    border-radius: 10px;
    animation: tour-pulse 1.6s ease-in-out infinite;
}
@keyframes tour-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.35); }
    50% { box-shadow: 0 0 0 7px rgba(99, 102, 241, 0); }
}
.tour-card {
    position: fixed;
    z-index: 60000000;
    width: 320px;
    max-width: calc(100vw - 16px);
    background: var(--surface);
    color: var(--text-main);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
    padding: 14px 16px 12px;
    /* Потолок по высоте: телефон в альбомной ориентации даёт 375 px экрана, а
       самые длинные карточки («Зачем менять параметры объекта», «Меню разделов»)
       выходят за 430 — они просто не помещались, и кнопка «Дальше» оказывалась
       за краем. Лишнее прокручивается внутри карточки. */
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    overscroll-behavior: contain;
}
/* Плавный переезд вместо скачка по экрану; только для десктопных углов и места у цели */
.tour-card-dock { transition: left .35s ease, top .35s ease; }
body.dark-mode .tour-card { background: #1E1E1E; border-color: #333333; }
.tour-card-bottom {
    left: 8px !important;
    right: 8px;
    width: auto;
    top: auto !important;
    bottom: 10px;
}
.tour-card-atop {
    top: 10px !important;
    bottom: auto !important;
}
.tour-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.tour-card-num { font-size: 12px; font-weight: 700; color: var(--primary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tour-card-x { font-size: 22px; line-height: 1; color: var(--text-sec); cursor: pointer; padding: 4px 8px; margin: -4px -8px 0 0; }
.tour-card-title { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
.tour-card-text { font-size: 13px; line-height: 1.45; color: var(--text-sec); }
.tour-card-btns { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
.tour-btn {
    font: inherit; font-size: 13px; font-weight: 700;
    padding: 8px 16px; min-height: 36px; border-radius: 8px;
    border: none; background: var(--primary); color: #fff; cursor: pointer;
}
.tour-btn-ghost { background: transparent; color: var(--text-sec); border: 1px solid var(--border); }
.tour-plan-badge {
    display: inline-block; margin: 2px 0 4px; padding: 4px 12px; border-radius: 999px;
    font-size: 12.5px; font-weight: 800; color: #fff;
    background: linear-gradient(135deg, #3B82F6, #2563EB);
}
.tour-plan-h { margin: 10px 0 5px; font-size: 11px; font-weight: 800; letter-spacing: .4px; text-transform: uppercase; color: var(--text-sec); }
.tour-plan-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.tour-plan-list li { display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; line-height: 1.35; color: var(--text-main); }
.tour-plan-mark {
    flex: 0 0 18px; width: 18px; height: 18px; border-radius: 50%; margin-top: 1px;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 800; color: #fff;
}
.tour-plan-ok .tour-plan-mark { background: #10B981; }
.tour-plan-no .tour-plan-mark { background: #EF4444; }
.tour-plan-no { color: var(--text-sec); }
.tour-plan-no span:last-child { text-decoration: line-through; text-decoration-color: rgba(239, 68, 68, 0.6); }
.tour-plan-foot { margin-top: 10px; font-size: 12.5px; color: var(--text-sec); }
.tour-pay { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.tour-pay-btn {
    position: relative; font: inherit; width: 100%; min-height: 48px; padding: 8px 14px;
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    border: none; border-radius: 12px; cursor: pointer; font-size: 14px;
    transition: transform .15s ease, box-shadow .15s ease;
}
.tour-pay-btn b { font-weight: 800; }
.tour-pay-btn span { font-weight: 700; }
.tour-pay-btn:hover { transform: translateY(-1px); }
.tour-pay-year { color: #fff; background: linear-gradient(135deg, #3B82F6, #1D4ED8); box-shadow: 0 6px 16px rgba(37, 99, 235, 0.32); }
.tour-pay-year:hover { box-shadow: 0 10px 22px rgba(37, 99, 235, 0.4); }
.tour-pay-month { color: var(--primary); background: transparent; border: 1.5px solid var(--primary); }
.tour-pay-tag {
    position: absolute; top: -8px; right: 12px; padding: 1px 8px; border-radius: 999px;
    font-size: 10px; font-weight: 800; color: #fff; background: #10B981;
}
.tour-pay-all { text-align: center; font-size: 12px; font-weight: 600; color: var(--primary); text-decoration: none; }

/* Телефон лёжа: 375 px высоты на всё. Карточку жмём до 45 % экрана, кнопки держим
   прилипшими к её низу, чтобы до «Дальше» не приходилось прокручивать текст. */
@media screen and (max-height: 520px) {
    .tour-card { max-height: 45vh; }
    .tour-card-btns {
        position: sticky;
        bottom: -12px;
        margin-bottom: -12px;
        padding: 8px 0 12px;
        background: var(--surface);
    }
    body.dark-mode .tour-card-btns { background: #1E1E1E; }
}

/* Баннер cookie прячем на время обучения там, где иначе оно не работает: телефон
   лёжа (159 px из 375) и телефон стоймя (181 px из 812). На узком экране карточка
   и так полоса снизу, баннер поднимает её ещё выше, а увести подсвеченный элемент
   прокруткой не выходит — страница короткая, крутить нечего. Замер: с баннером
   карточка закрывала кнопку «Типовой объект» на 97 %, тумблер параметров на 18 %;
   без него оба шага чистые.

   На экранах пошире баннер не трогаем: там места хватает, и его обходит расчётом
   Tour.bottomBusy(). Возвращается сразу, как обучение выключат, — метку
   tour-running снимает Tour.stop(). */
@media screen and (max-height: 520px), screen and (max-width: 760px) {
    body.tour-running .hc-cookie-banner { display: none !important; }
}

/* ---------- Блоки, задания, палец-подсказка ---------- */
.tour-card-tools { display: flex; align-items: center; gap: 4px; }
.tour-card-blocks {
    font: inherit; font-size: 11px; font-weight: 700; color: var(--primary); background: transparent;
    border: 1px solid var(--border); border-radius: 999px; padding: 4px 10px; min-height: 28px; cursor: pointer;
}
.tour-card-blocks:hover { background: var(--primary-light, rgba(99, 102, 241, 0.1)); }
.tour-card-x { min-width: 32px; min-height: 32px; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; }
.tour-prog { height: 4px; border-radius: 2px; background: var(--border); margin: 0 0 8px; overflow: hidden; }
.tour-prog i { display: block; height: 100%; border-radius: 2px; background: var(--primary); transition: width .3s ease; }
/* Карточка шага — всегда в углу экрана (см. Tour.place) */
.tour-card-dock { width: 340px; }
.tour-card-free { width: 400px; }
.tour-card-foot { margin-top: 10px; font-size: 11.5px; line-height: 1.45; color: var(--text-sec); }

.tour-tasks {
    margin-top: 10px; padding: 10px 12px; border-radius: 10px;
    border: 1.5px solid var(--primary); background: var(--primary-light, rgba(99, 102, 241, 0.08));
}
.tour-tasks.is-done { border-color: #10B981; background: rgba(16, 185, 129, 0.1); }
.tour-tasks.is-done::after { content: '✓ Готово — переходим дальше'; display: block; margin-top: 8px; font-size: 12px; font-weight: 700; color: #059669; }
.tour-task { display: flex; align-items: flex-start; gap: 8px; font-size: 13.5px; line-height: 1.4; color: var(--text-main); font-weight: 600; }
.tour-task + .tour-task { margin-top: 6px; }
.tour-task-pre { font-style: normal; font-weight: 600; font-size: 11.5px; color: var(--text-sec); white-space: nowrap; }
.tour-task-mark {
    flex: 0 0 18px; width: 18px; height: 18px; margin-top: 1px; box-sizing: border-box; border-radius: 50%;
    border: 2px solid var(--primary); display: inline-flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 800; color: #fff;
}
.tour-task.is-done .tour-task-mark { background: #10B981; border-color: #10B981; }
.tour-task.is-done .tour-task-t { color: var(--text-sec); text-decoration: line-through; text-decoration-color: rgba(16, 185, 129, 0.6); }
.tour-shake { animation: tour-shake .45s ease; }
@keyframes tour-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(4px); } }

.tour-actions { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.tour-act {
    font: inherit; font-size: 14px; font-weight: 800; min-height: 44px; padding: 10px 14px; border-radius: 10px;
    border: none; cursor: pointer; color: #fff; background: linear-gradient(135deg, #3B82F6, #1D4ED8);
    box-shadow: 0 6px 16px rgba(37, 99, 235, 0.3);
}
.tour-act:hover { transform: translateY(-1px); }

.tour-note {
    display: none; margin-top: 10px; padding: 8px 10px; border-radius: 8px; font-size: 12px; line-height: 1.4; font-weight: 600;
    color: #92400E; background: #FEF3C7; border: 1px solid #FCD34D;
}
.tour-note.on { display: block; }
body.dark-mode .tour-note { color: #FDE68A; background: rgba(245, 158, 11, 0.16); border-color: rgba(245, 158, 11, 0.5); }

.tour-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
.tour-btn-skip { font-weight: 600; border-style: dashed; }
@media screen and (max-width: 759px) { .tour-card .tour-card-text { font-size: 12.5px; } .tour-now { margin-top: 4px; padding-top: 4px; } }
.tour-resume { width: 100%; margin: 0 0 10px; justify-content: flex-start; text-align: left; }
.tour-locked { margin-top: 8px; font-size: 12px; line-height: 1.4; color: var(--text-sec); }
.tour-now { margin-top: 8px; padding-top: 6px; border-top: 1px dashed var(--border); font-size: 12px; font-weight: 600; color: var(--text-sec); }
.tour-card-btns .tour-btn-back { margin-right: auto; min-width: 40px; padding: 8px 12px; font-size: 16px; }
.tour-btn-ready { animation: tour-ready 1.8s ease-in-out infinite; }
@keyframes tour-ready { 0%, 100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.45); } 50% { box-shadow: 0 0 0 6px rgba(99, 102, 241, 0); } }
.tour-kbd {
    font: inherit; font-size: 10.5px; font-weight: 700; line-height: 1; padding: 3px 6px; border-radius: 5px;
    background: rgba(255, 255, 255, 0.22); border: 1px solid rgba(255, 255, 255, 0.45); color: inherit; white-space: nowrap;
}
.tour-kbd-plain { background: var(--surface-light); border-color: var(--border); color: var(--text-main); }
/* На телефоне клавиши Enter нет — подсказку про неё не показываем */
@media (hover: none), (max-width: 760px) { .tour-kbd, .tour-kbd-line { display: none; } }

/* Список блоков */
.tour-blks { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.tour-blk { padding: 8px 10px; }
.tour-blk-body small:not(.tour-blk-meta) { display: none; }
.tour-blk.is-rec .tour-blk-body small:not(.tour-blk-meta) { display: block; }
.tour-pro { margin-top: 6px; }
.tour-pro > summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 800; color: var(--text-sec); padding: 6px 2px; user-select: none; }
.tour-pro > summary::-webkit-details-marker { display: none; }
.tour-pro > summary::before { content: '▸'; font-size: 11px; transition: transform .15s; }
.tour-pro[open] > summary::before { transform: rotate(90deg); }
.tour-pro-new { font-style: normal; font-size: 9.5px; font-weight: 800; color: #fff; background: #F59E0B; border-radius: 999px; padding: 2px 7px; }
.tour-pro > .tour-blks { margin-top: 2px; }
.tour-blk {
    font: inherit; width: 100%; display: flex; align-items: center; gap: 12px; text-align: left; cursor: pointer;
    padding: 10px 12px; min-height: 56px; border-radius: 12px; color: var(--text-main);
    background: var(--surface-light); border: 1px solid var(--border);
    transition: border-color .15s ease, transform .15s ease;
}
.tour-blk:hover { border-color: var(--primary); transform: translateY(-1px); }
.tour-blk.is-rec { border: 1.5px solid var(--primary); background: var(--primary-light, rgba(99, 102, 241, 0.08)); }
.tour-blk.is-locked { opacity: .85; }
.tour-blk-ic { flex: 0 0 34px; width: 34px; height: 34px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; font-size: 18px; background: var(--surface); border: 1px solid var(--border); }
.tour-blk-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.tour-blk-body b { font-size: 13.5px; font-weight: 700; }
.tour-blk-body small { font-size: 11.5px; line-height: 1.35; color: var(--text-sec); }
.tour-blk-meta { opacity: .85; }
.tour-blk-must { font-style: normal; font-size: 9.5px; font-weight: 800; letter-spacing: .3px; text-transform: uppercase; color: #fff; background: var(--primary); border-radius: 999px; padding: 2px 6px; margin-left: 4px; vertical-align: 1px; }
.tour-blk-st { flex: 0 0 auto; font-size: 11px; font-weight: 800; color: var(--text-sec); white-space: nowrap; }
.tour-blk-st.is-ok { color: #059669; }
.tour-blk-st.is-lock { color: var(--text-sec); }
.tour-blk-st.is-rec { color: #fff; background: var(--primary); border-radius: 999px; padding: 5px 12px; }
body.dark-mode .tour-blk-st.is-ok { color: #34D399; }
body.dark-mode .tour-blk { background: #171717; border-color: #333333; }
body.dark-mode .tour-blk.is-rec { background: rgba(99, 102, 241, 0.16); border-color: var(--primary); }
body.dark-mode .tour-blk-ic { background: #1E1E1E; border-color: #333333; }

/* Итог блока */
.tour-done-title { display: flex; align-items: center; gap: 8px; font-size: 17px; }
.tour-done-mark { width: 26px; height: 26px; border-radius: 50%; background: #10B981; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 15px; }
.tour-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
.tour-chips span { font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 999px; background: var(--primary-light, rgba(99, 102, 241, 0.1)); color: var(--primary); border: 1px solid var(--border); }

/* Палец и кольцо на настоящем элементе страницы */
#tour_pointer { position: fixed; z-index: 60000010; width: 0; height: 0; pointer-events: none; }
#tour_pointer .tp-ring {
    position: absolute; left: -26px; top: -26px; width: 52px; height: 52px; box-sizing: border-box;
    border: 4px solid #9F1239; border-radius: 50%; opacity: 0; animation: tp-ring 2.2s ease-out infinite;
}
#tour_pointer .tp-hand { position: absolute; left: 0; top: 0; width: 0; height: 0; animation: tp-fly 2.2s cubic-bezier(.3, .1, .2, 1) infinite; }
/* Повёрнутая система: ось x смотрит от элемента к карточке, наконечник в нуле */
#tour_pointer .tp-rot { position: absolute; left: 0; top: 0; width: 0; height: 0; transform: rotate(var(--ang, 35deg)); }
#tour_pointer .tp-arrow { position: absolute; left: -1px; top: -14px; filter: drop-shadow(0 2px 3px rgba(159, 18, 57, 0.5)); animation: tp-tap 2.2s ease-in-out infinite; }
/* Хвост: широкий у стрелки, сужается в точку и гаснет к карточке */
#tour_pointer .tp-tail { position: absolute; left: 20px; top: -5px; width: var(--tl, 90px); height: 10px;
    background: linear-gradient(90deg, rgba(159, 18, 57, 0.85), rgba(159, 18, 57, 0)); clip-path: polygon(0 0, 100% 50%, 0 100%);
    animation: tp-tail 2.2s ease-out infinite; }
@keyframes tp-fly {
    0% { transform: translate(var(--fx, 46px), var(--fy, 32px)); opacity: 0; }
    12% { opacity: 1; }
    40%, 90% { transform: translate(0, 0); opacity: 1; }
    100% { transform: translate(0, 0); opacity: 0; }
}
/* Тычок наконечником в элемент — вдоль направления полёта */
@keyframes tp-tap { 0%, 44% { transform: translateX(0); } 52% { transform: translateX(-5px); } 62%, 100% { transform: translateX(0); } }
@keyframes tp-tail { 0%, 6% { opacity: 0; } 16%, 46% { opacity: 1; } 70%, 100% { opacity: 0.25; } }
@keyframes tp-ring { 0%, 48% { opacity: 0; transform: scale(.4); } 56% { opacity: .95; transform: scale(.7); } 90%, 100% { opacity: 0; transform: scale(1.35); } }

/* Окно замены на весь экран: карточка — только рамка с заданием в углу */
.tour-card-swap { left: auto !important; top: auto !important; width: 300px; max-height: 60vh; border: 2px solid #9F1239; box-shadow: 0 14px 38px rgba(159, 18, 57, 0.28); }
.tour-card-swap .tour-card-text, .tour-card-swap .tour-actions, .tour-card-swap .tour-prog, .tour-card-swap .tour-card-blocks,
.tour-card-swap .tour-btn-back { display: none; }

/* Тёмная тема: кнопки читаются, а не сливаются с карточкой */
body.dark-mode .tour-btn-ghost { color: #E5E7EB; border-color: #4B5563; }
body.dark-mode .tour-btn-ghost:hover { background: rgba(255, 255, 255, 0.06); }
body.dark-mode .tour-card-blocks { color: #A5B4FC; border-color: #4B5563; }
body.dark-mode .tour-task-mark { border-color: #A5B4FC; }
body.dark-mode .tour-tasks.is-done::after { color: #34D399; }
body.dark-mode .tour-card-num { color: #A5B4FC; }
body.dark-mode .tour-kbd-plain { background: #262626; border-color: #4B5563; color: #E5E7EB; }
body.dark-mode .tour-card-x { color: #D1D5DB; }
/* В тёмной теме --primary светло-серый (#E4E4E7): белый текст на нём не читался — ни на
   «Дальше», ни на «Начать», ни на значке «главный». Ставим тёмный текст. */
body.dark-mode .tour-btn:not(.tour-btn-ghost),
body.dark-mode .tour-blk-st.is-rec,
body.dark-mode .tour-blk-must { color: #111827; }
body.dark-mode .tour-btn:not(.tour-btn-ghost) .tour-kbd { background: rgba(17, 24, 39, 0.1); border-color: rgba(17, 24, 39, 0.35); }
body.dark-mode .tour-btn-ready { animation-name: tour-ready-dark; }
@keyframes tour-ready-dark { 0%, 100% { box-shadow: 0 0 0 0 rgba(228, 228, 231, 0.5); } 50% { box-shadow: 0 0 0 6px rgba(228, 228, 231, 0); } }

/* Телефон: кнопки и крестик — не меньше 44 px под палец */
@media (max-width: 760px) {
    .tour-card-swap { left: 8px !important; right: 8px !important; width: auto; max-height: 32vh; }
    .tour-card-swap.tour-card-swap-top { top: 8px !important; bottom: auto !important; }
    /* В окне замены на телефоне от карточки остаётся задание: заголовок съедал строки
       списка моделей, на которые показывает стрелка */
    .tour-card-swap .tour-card-title { display: none; }
    body.tour-typing .tour-card, body.tour-typing #tour_pointer { display: none !important; }
    /* Открыто меню ☰: оно выпадает сверху на всю ширину и тянется почти до низа (его высота —
       экран минус 130 px). Полноценная карточка внизу ложилась поверх нижних пунктов меню и
       перекрывала их. Пока меню открыто, карточка — тонкая полоса: только задание и кнопки. */
    body.menu-open .tour-card { padding: 6px 12px 4px; max-height: 120px; bottom: 6px !important; top: auto !important; }
    body.menu-open .tour-card .tour-card-head, body.menu-open .tour-card .tour-prog, body.menu-open .tour-card .tour-card-title,
    body.menu-open .tour-card .tour-card-text, body.menu-open .tour-card .tour-actions, body.menu-open .tour-card .tour-plan-badge { display: none !important; }
    body.menu-open .tour-card .tour-tasks { margin: 0 0 4px; padding: 6px 10px; }
    body.menu-open .tour-card .tour-btn { min-height: 38px; }
    body.menu-open .tour-card .tour-card-btns { position: static; margin: 0; padding: 0; }
    .tour-card { padding: 12px 14px 10px; }
    .tour-card-free { width: auto; }
    .tour-btn { min-height: 44px; }
    .tour-card-blocks { min-height: 36px; }
    .tour-card-x { min-width: 44px; min-height: 44px; margin: -8px -10px -4px 0; }
    .tour-card-btns { position: sticky; bottom: -10px; margin-bottom: -10px; padding: 8px 0 10px; background: var(--surface); }
    body.dark-mode .tour-card-btns { background: #1E1E1E; }
    .tour-blk { min-height: 56px; padding: 8px 10px; }
    /* Список блоков на телефоне — короче: описание блока убираем, остаются название и «≈ мин · шагов» */
    .tour-blk-body small:not(.tour-blk-meta) { display: none; }
    .tour-blk-ic { flex-basis: 30px; width: 30px; height: 30px; font-size: 16px; }
    .tour-blks { gap: 6px; margin-top: 8px; }
}

/* Человек попросил систему не двигать картинки — без пульсаций и тряски */
@media (prefers-reduced-motion: reduce) {
    .tour-spot, .tour-btn-ready, #tour_pointer *, .tour-shake { animation: none !important; }
}

/* ═════════ Оформление 2026: стекло, мягкие тени, пружинные анимации ═════════
   Слой поверх базовых правил выше: раскладку и поведение не меняет, только вид.
   Цвета — системные синий/зелёный (как в iOS), чтобы обучение читалось отдельно
   от интерфейса калькулятора и одинаково в светлой и тёмной теме. */
.tour-card {
    --t-accent: #0A84FF; --t-accent2: #5E5CE6; --t-ok: #34C759;
    --t-bg: rgba(255, 255, 255, 0.84); --t-line: rgba(15, 23, 42, 0.08); --t-fill: rgba(120, 120, 128, 0.12);
    --t-text: #0B0B0F; --t-sec: #6E6E73;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", Roboto, sans-serif;
    background: var(--t-bg); color: var(--t-text);
    -webkit-backdrop-filter: saturate(180%) blur(24px); backdrop-filter: saturate(180%) blur(24px);
    border: 1px solid var(--t-line); border-radius: 22px;
    box-shadow: 0 30px 60px -18px rgba(15, 23, 42, 0.35), 0 2px 8px rgba(15, 23, 42, 0.06);
    padding: 16px 18px 14px;
    animation: tour-card-in .55s cubic-bezier(.16, 1, .3, 1) both;
}
body.dark-mode .tour-card {
    --t-bg: rgba(28, 28, 30, 0.82); --t-line: rgba(255, 255, 255, 0.09); --t-fill: rgba(118, 118, 128, 0.24);
    --t-text: #F5F5F7; --t-sec: #A1A1A6;
    background: var(--t-bg); border-color: var(--t-line);
    box-shadow: 0 30px 70px -18px rgba(0, 0, 0, 0.7), 0 0 0 0.5px rgba(255, 255, 255, 0.06) inset;
}
@keyframes tour-card-in { from { opacity: 0; transform: translateY(14px) scale(.96); } to { opacity: 1; transform: none; } }
.tour-enter { animation: tour-rise .5s cubic-bezier(.16, 1, .3, 1) both; }
@keyframes tour-rise { from { opacity: 0; transform: translateY(8px); filter: blur(3px); } to { opacity: 1; transform: none; filter: none; } }

.tour-card .tour-card-num { color: var(--t-sec) !important; font-size: 11.5px; font-weight: 600; letter-spacing: .02em; }
.tour-card .tour-card-title { font-size: 19px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; margin: 2px 0 6px; color: var(--t-text); }
.tour-card .tour-card-text { font-size: 14px; line-height: 1.5; color: var(--t-sec); }
.tour-card .tour-card-text b { color: var(--t-text); font-weight: 650; }
.tour-card .tour-card-x {
    width: 30px; height: 30px; min-width: 30px; min-height: 30px; margin: -4px -6px 0 0; padding: 0; border-radius: 50%;
    background: var(--t-fill); color: var(--t-sec) !important; font-size: 18px; transition: background .2s, transform .2s;
}
.tour-card .tour-card-x:hover { background: rgba(120, 120, 128, 0.22); transform: scale(1.06); }
.tour-card .tour-card-blocks { border: none; background: var(--t-fill); color: var(--t-text) !important; font-weight: 600; transition: background .2s; }
.tour-card .tour-card-blocks:hover { background: rgba(120, 120, 128, 0.22); }

/* Прогресс — тонкая полоса с переливом */
.tour-card .tour-prog { height: 5px; border-radius: 999px; background: var(--t-fill); margin: 2px 0 12px; }
.tour-card .tour-prog i { border-radius: 999px; background: linear-gradient(90deg, var(--t-accent), var(--t-accent2)); transition: width .6s cubic-bezier(.16, 1, .3, 1); position: relative; overflow: hidden; }
.tour-card .tour-prog i::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,.55), transparent); transform: translateX(-100%); animation: tour-sheen 2.4s ease-in-out .6s infinite; }
@keyframes tour-sheen { 0% { transform: translateX(-100%); } 60%, 100% { transform: translateX(100%); } }

/* Кнопки — «пилюли» */
.tour-card .tour-btn { border-radius: 999px; padding: 9px 18px; min-height: 38px; font-weight: 650; letter-spacing: -0.01em;
    transition: transform .2s cubic-bezier(.16, 1, .3, 1), box-shadow .2s, background .2s; }
.tour-card .tour-btn:not(.tour-btn-ghost), body.dark-mode .tour-card .tour-btn:not(.tour-btn-ghost) {
    background: linear-gradient(180deg, #2E95FF, var(--t-accent)); color: #fff; box-shadow: 0 6px 16px -4px rgba(10, 132, 255, 0.55); }
.tour-card .tour-btn:hover { transform: translateY(-1px); }
.tour-card .tour-btn:active { transform: scale(.97); }
.tour-card .tour-btn-ghost, body.dark-mode .tour-card .tour-btn-ghost { background: var(--t-fill); border: none; color: var(--t-text); }
.tour-card .tour-btn-skip { border-style: none; color: var(--t-sec); }
.tour-card .tour-kbd, body.dark-mode .tour-card .tour-btn:not(.tour-btn-ghost) .tour-kbd { background: rgba(255,255,255,.2); border-color: rgba(255,255,255,.35); color: #fff; }
.tour-card .tour-btn-ready { animation: tour-ready-blue 2s ease-in-out infinite; }
@keyframes tour-ready-blue { 0%, 100% { box-shadow: 0 6px 16px -4px rgba(10,132,255,.55), 0 0 0 0 rgba(10,132,255,.4); } 50% { box-shadow: 0 6px 16px -4px rgba(10,132,255,.55), 0 0 0 7px rgba(10,132,255,0); } }
.tour-card .tour-card-btns { margin-top: 14px; }
@media (max-width: 760px), screen and (max-height: 520px) {
    .tour-card .tour-card-btns, body.dark-mode .tour-card .tour-card-btns { background: transparent;
        -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); }
}
.tour-card .tour-act { border-radius: 14px; background: linear-gradient(180deg, #2E95FF, var(--t-accent)); box-shadow: 0 8px 20px -6px rgba(10,132,255,.6); transition: transform .2s; }

/* Задания */
.tour-card .tour-tasks { border: none; border-radius: 16px; padding: 12px 14px; background: rgba(10, 132, 255, 0.08); transition: background .4s; }
body.dark-mode .tour-card .tour-tasks { background: rgba(10, 132, 255, 0.16); }
.tour-card .tour-tasks.is-done { background: rgba(52, 199, 89, 0.12); }
.tour-card .tour-tasks.is-done::after { content: 'Готово — переходим дальше'; color: #248A3D; font-weight: 650; animation: tour-rise .4s cubic-bezier(.16,1,.3,1) both; }
body.dark-mode .tour-card .tour-tasks.is-done::after { color: #30D158; }
.tour-card .tour-task { font-size: 14px; font-weight: 550; color: var(--t-text); }
.tour-card .tour-task + .tour-task { margin-top: 8px; }
.tour-card .tour-task-mark, body.dark-mode .tour-card .tour-task-mark { flex-basis: 20px; width: 20px; height: 20px; border: 2px solid var(--t-accent); transition: background .25s, border-color .25s; }
.tour-card .tour-task.is-done .tour-task-mark { background: var(--t-ok); border-color: var(--t-ok); }
.tour-card .tour-task.is-done .tour-task-t { color: var(--t-sec); text-decoration-color: rgba(52, 199, 89, .7); }
.tour-card .tour-task.is-new .tour-task-mark { animation: tour-check .5s cubic-bezier(.34, 1.56, .64, 1) both; }
@keyframes tour-check { 0% { transform: scale(.4); } 60% { transform: scale(1.18); } 100% { transform: scale(1); } }
.tour-card .tour-now { border-top: 1px solid var(--t-line); color: var(--t-sec); font-weight: 500; }
.tour-card .tour-note { border-radius: 12px; border: none; }

/* Итог в рублях и формула мощности */
.tour-stat { margin-top: 12px; padding: 12px 14px; border-radius: 16px; display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
    background: linear-gradient(135deg, rgba(10,132,255,.1), rgba(94,92,230,.1)); }
.tour-stat span { font-size: 12.5px; color: var(--t-sec); }
.tour-stat b { font-size: 22px; font-weight: 750; letter-spacing: -0.02em; color: var(--t-text); font-variant-numeric: tabular-nums; }
.tour-formula { margin-top: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.tour-formula span { display: inline-flex; flex-direction: column; align-items: center; padding: 6px 9px; border-radius: 12px; background: var(--t-fill); min-width: 44px; }
.tour-formula span b { font-size: 13px; font-weight: 700; color: var(--t-text); white-space: nowrap; }
.tour-formula span small { font-size: 10px; color: var(--t-sec); white-space: nowrap; }
.tour-formula span.is-res { background: linear-gradient(135deg, var(--t-accent), var(--t-accent2)); }
.tour-formula span.is-res b, .tour-formula span.is-res small { color: #fff; }
.tour-formula i { font-style: normal; font-weight: 600; color: var(--t-sec); }
.tour-formula > * { animation: tour-rise .45s cubic-bezier(.16,1,.3,1) both; }
.tour-formula > *:nth-child(3) { animation-delay: .08s; } .tour-formula > *:nth-child(5) { animation-delay: .16s; }
.tour-formula > *:nth-child(7) { animation-delay: .24s; } .tour-formula > *:nth-child(9) { animation-delay: .34s; }

/* Список блоков */
.tour-card .tour-blk, body.dark-mode .tour-card .tour-blk { border: 1px solid transparent; border-radius: 16px; background: var(--t-fill); min-height: 60px;
    transition: transform .25s cubic-bezier(.16,1,.3,1), background .2s, box-shadow .25s; }
.tour-card .tour-blk:hover { transform: translateY(-2px) scale(1.005); box-shadow: 0 10px 24px -12px rgba(15,23,42,.35); border-color: transparent; }
.tour-card .tour-blk.is-rec, body.dark-mode .tour-card .tour-blk.is-rec { background: linear-gradient(var(--t-bg), var(--t-bg)) padding-box,
    linear-gradient(135deg, var(--t-accent), var(--t-accent2)) border-box; border: 1.5px solid transparent; }
.tour-card .tour-blk-ic, body.dark-mode .tour-card .tour-blk-ic { border: none; border-radius: 12px; background: var(--t-bg); box-shadow: 0 2px 6px rgba(15,23,42,.08); }
.tour-card .tour-blk-body b { font-size: 14px; font-weight: 650; color: var(--t-text); }
.tour-card .tour-blk-must, body.dark-mode .tour-card .tour-blk-must { background: linear-gradient(135deg, var(--t-accent), var(--t-accent2)); color: #fff; }
.tour-card .tour-blk-st.is-rec, body.dark-mode .tour-card .tour-blk-st.is-rec { background: var(--t-accent); color: #fff; }
.tour-card .tour-blk-st.is-ok { color: #248A3D; }
.tour-card .tour-blks > .tour-blk { animation: tour-rise .5s cubic-bezier(.16,1,.3,1) both; }
.tour-card .tour-blks > .tour-blk:nth-child(2) { animation-delay: .05s; } .tour-card .tour-blks > .tour-blk:nth-child(3) { animation-delay: .1s; }
.tour-card .tour-blks > .tour-blk:nth-child(4) { animation-delay: .15s; } .tour-card .tour-blks > .tour-blk:nth-child(5) { animation-delay: .2s; }
.tour-card .tour-done-mark { background: var(--t-ok); animation: tour-check .6s cubic-bezier(.34,1.56,.64,1) both; box-shadow: 0 6px 14px -4px rgba(52,199,89,.6); }
.tour-card .tour-chips span { border: none; background: rgba(10,132,255,.1); color: var(--t-accent); }

/* Подсветка элемента: мягкое свечение вместо жёсткой рамки */
.tour-spot { outline: 2px solid rgba(10, 132, 255, 0.95); outline-offset: 4px; border-radius: 12px; animation: tour-glow 2s ease-in-out infinite; }
@keyframes tour-glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(10,132,255,.32), 0 0 24px 2px rgba(10,132,255,.18); } 50% { box-shadow: 0 0 0 9px rgba(10,132,255,0), 0 0 30px 6px rgba(10,132,255,.26); } }
/* Палец — в цвет обучения */
#tour_pointer .tp-arrow path { fill: #0A84FF; }
#tour_pointer .tp-arrow { filter: drop-shadow(0 3px 6px rgba(10, 132, 255, 0.5)); }
#tour_pointer .tp-ring { border-color: #0A84FF; }
#tour_pointer .tp-tail { background: linear-gradient(90deg, rgba(10, 132, 255, 0.85), rgba(94, 92, 230, 0)); }
.tour-card.tour-card-swap { border: 1.5px solid rgba(10, 132, 255, 0.9); box-shadow: 0 20px 44px -12px rgba(10, 132, 255, 0.45); }

@media (prefers-reduced-motion: reduce) {
    .tour-card, .tour-enter, .tour-formula > *, .tour-blks > .tour-blk, .tour-task.is-new .tour-task-mark,
    .tour-done-mark, .tour-prog i::after, .tour-tasks.is-done::after { animation: none !important; }
}
@media print { .tour-card, .tour-spot { display: none !important; outline: none !important; } }
`;
        document.head.appendChild(st);
    }
};

// Обучение поднимаем после калькулятора: шаги читают app.state, и до его
// инициализации им нечего показывать.
window.addEventListener('load', () => {
    setTimeout(() => { try { Tour.init(); } catch (e) { console.warn('[Tour]', e); } }, 1200);
    // Баннер бонуса зависит от входа, тарифа и настроек из базы — всё приходит позже
    // загрузки страницы и меняется без перезагрузки. Проверка дешёвая: раз в 3 секунды.
    setInterval(() => { try { Tour.syncBonusBanner(); } catch (e) { } }, 3000);
});
