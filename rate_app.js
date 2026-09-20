/**
 * Просьба оценить приложение в RuStore.
 *
 * ЗАЧЕМ. Оценки и отзывы весят в магазине больше всего остального: по ним карточку
 * и выбирают, и ранжируют. Сами их почти никто не пишет — спросить придётся.
 *
 * КОГДА. Ровно в одну минуту: когда человек только что выгрузил смету в PDF. Это
 * единственный момент, где он видел результат своими глазами и доволен. Спросить
 * раньше — на первом экране, при входе, «через три дня пользования» — значит
 * собрать единицы от тех, кто ещё не разобрался: в оценке магазина люди отвечают
 * не про приложение, а про своё настроение в секунду вопроса.
 *
 * ГДЕ. Только внутри приложения (__HC_NATIVE__). На сайте эта просьба бессмысленна:
 * у человека приложения может не быть вовсе, а оценить в RuStore то, чего не
 * ставил, нельзя — для него на сайте есть плашка установки (install_app.js).
 *
 * ЧТО ВИДНО ПОТОМ. Ничего, кроме числа оценок в консоли RuStore: Яндекс.Метрика
 * внутри приложения выключена намеренно (cookie-consent.js), целей отсюда не
 * послать. Поэтому и считать нечего — смотреть на «Отзывы» в консоли.
 *
 * СКОЛЬКО РАЗ. Согласился — больше никогда. Отказался — не раньше, чем через
 * полгода и после ещё трёх выгрузок: человек, которому некогда, не станет добрее
 * от повторов через неделю, а вот удалить приложение может.
 */
(function () {

    var STORE_URL = 'https://www.rustore.ru/catalog/app/ru.heatcalc.app';
    var KEY = 'hc_rate';
    var DELAY_MS = 2500;          // дать закрыться системному листу «Поделиться»
    var AGAIN_MS = 180 * 864e5;   // отказался — полгода тишины
    var AGAIN_PDF = 3;            // и ещё три выгрузки сверх того

    if (!window.__HC_NATIVE__) return;

    var st;
    try { st = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { st = null; }
    if (!st || typeof st !== 'object') st = { pdfs: 0, askedAt: 0, done: false };

    function save() {
        try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { }
    }

    // Окно собираем теми же классами, что app.confirm, — чтобы оно выглядело своим,
    // а не чужой вставкой. Свой код нужен из-за подписей: у app.confirm кнопки
    // жёстко «Да» и «Отмена», а здесь спрашивают не согласие, а одолжение.
    function ask() {
        var overlay = document.createElement('div');
        overlay.className = 'calc-dialog-overlay';

        var card = document.createElement('div');
        card.className = 'calc-dialog-card';

        var title = document.createElement('h3');
        title.className = 'calc-dialog-title';
        title.innerText = 'Оцените приложение';
        card.appendChild(title);

        var msg = document.createElement('p');
        msg.className = 'calc-dialog-message';
        msg.innerText = 'Смета готова. Если приложение пригодилось, поставьте оценку в RuStore — '
            + 'по ней его находят другие монтажники. Это минута.';
        card.appendChild(msg);

        var btns = document.createElement('div');
        btns.className = 'calc-dialog-buttons';

        var later = document.createElement('button');
        later.className = 'calc-dialog-btn calc-dialog-btn-cancel';
        later.innerText = 'Не сейчас';
        later.onclick = function () {
            st.askedAt = Date.now();
            st.pdfs = 0;
            save();
            close();
        };

        var go = document.createElement('button');
        go.className = 'calc-dialog-btn calc-dialog-btn-confirm';
        go.innerText = 'Оценить';
        go.onclick = function () {
            st.done = true;
            save();
            close();
            // Во встроенном браузере window.open молча возвращает пустоту
            // (onCreateWindow у Capacitor не реализован) — только присваивание
            // адреса, его перехватывает launchIntent и отдаёт магазину.
            location.href = STORE_URL;
        };

        btns.appendChild(later);
        btns.appendChild(go);
        card.appendChild(btns);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        setTimeout(function () { overlay.classList.add('active'); }, 10);

        function close() {
            overlay.classList.remove('active');
            setTimeout(function () { overlay.remove(); }, 200);
        }
    }

    document.addEventListener('hc:pdf-done', function () {
        st.pdfs = (st.pdfs || 0) + 1;
        save();
        if (st.done) return;
        if (st.askedAt) {
            // Отказ: ждём и срок, и новые выгрузки. Одного срока мало — человек
            // мог полгода не открывать приложение вовсе.
            if (Date.now() - st.askedAt < AGAIN_MS) return;
            if (st.pdfs < AGAIN_PDF) return;
        }
        setTimeout(ask, DELAY_MS);
    });

})();
