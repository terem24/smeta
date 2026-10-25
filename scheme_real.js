/* «Реальный вид» котельной — лист справа от принципиальной схемы.
 *
 * Те же узлы, что на схеме, но как они выглядят в жизни: рендеры оборудования из
 * img/nodes (без марок и логотипов), расставленные по составу системы и
 * соединённые подающей (красной) и обратной (синей) магистралями.
 * Состав берётся из той же конфигурации, что и схема (app.buildSchemeConfig):
 * газовый/электрический котёл, бойлер, баки, гидрострелка, насосные группы,
 * коллекторы. Чего в смете нет — того на листе нет.
 *
 * Модели и количества лист не называет — они в смете; здесь только узлы и связи.
 * Подключение: app.placeHydroCheckBox() кладёт результат render() в
 * #scheme_real_side рядом со схемой; полноэкранный просмотр — open().
 */
(function () {
    'use strict';

    var IMG = 'img/scheme_real/';
    // Размеры кадров (px): по ним считаются пропорции на листе
    var DIM = {
        boiler_gas: [280, 700], boiler_el: [229, 700], dhw: [288, 700],
        exp_heat: [280, 700], exp_dhw: [431, 464], sep: [280, 620],
        pump: [189, 700], ufh: [554, 700], rad: [554, 700]
    };
    var SHEET = { w: 420, h: 297 };    // как у принципиальной схемы (лист А3)
    var MARGIN = 14;
    var RED = '#e11d1d', BLUE = '#1d3fe1';

    function esc(t) {
        return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    // Подпись в одну-две строки под ширину кадра (в мм листа)
    function wrap(text, wmm) {
        var max = Math.max(10, Math.floor(wmm / 2.3));
        var words = String(text).split(' '), lines = [], cur = '';
        words.forEach(function (w) {
            if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; }
            else cur = (cur + ' ' + w).trim();
        });
        if (cur) lines.push(cur);
        return lines.slice(0, 3);
    }

    // Состав листа по конфигурации схемы: два ряда. Верхний — источники и баки,
    // нижний — потребители (насосные группы и коллекторы).
    function parts(cfg) {
        var top = [], low = [];
        if (cfg.gas) top.push({ img: 'boiler_gas', h: 92, hot: true,
            cap: 'Котёл газовый' + (cfg.gas.count > 1 ? ' ×' + cfg.gas.count : '') });
        if (cfg.el) top.push({ img: 'boiler_el', h: 92, hot: true,
            cap: 'Котёл электрический' + (cfg.el.count > 1 ? ' ×' + cfg.el.count : '') });
        if (cfg.indirect) top.push({ img: 'dhw', h: 100, hot: true,
            cap: 'Бойлер косвенного нагрева' + (cfg.indirect.vol ? ', ' + cfg.indirect.vol + ' л' : '') });
        if (cfg.tankHeating) top.push({ img: 'exp_heat', h: 70, hot: true,
            cap: 'Расширительный бак отопления, ' + cfg.tankHeating + ' л' });
        if (cfg.hydro && !cfg.hydro.buffer) top.push({ img: 'sep', h: 66, hot: true, cap: 'Гидрострелка' });
        if (cfg.tankDhw) top.push({ img: 'exp_dhw', h: 44, hot: false,
            cap: 'Расширительный бак ГВС, ' + cfg.tankDhw + ' л' });

        if (cfg.rad && cfg.radGroups > 0) {
            low.push({ img: 'pump', h: 72, hot: true, n: Math.min(2, cfg.radGroups),
                cap: 'Насосная группа радиаторов' + (cfg.radGroups > 1 ? ' ×' + cfg.radGroups : '') });
            low.push({ img: 'rad', h: 64, hot: false, cap: 'Коллектор радиаторов' });
        }
        if (cfg.tp && (cfg.tpGroups > 0 || cfg.tpUnit)) {
            if (cfg.tpGroups > 0) low.push({ img: 'pump', h: 72, hot: true, n: Math.min(2, cfg.tpGroups),
                cap: 'Насосная группа тёплого пола' + (cfg.tpGroups > 1 ? ' ×' + cfg.tpGroups : '') });
            low.push({ img: 'ufh', h: 64, hot: !(cfg.tpGroups > 0), cap: 'Коллектор тёплого пола' });
        }
        return { top: top, low: low };
    }

    // Раскладка ряда: кадры слева направо, при нехватке места — пропорциональное сжатие
    function layout(row, baseline, scaleCap) {
        var gap = 14, avail = SHEET.w - 2 * MARGIN;
        var items = [];
        row.forEach(function (p) {
            var copies = p.n || 1;
            for (var k = 0; k < copies; k++) items.push({ p: p, k: k });
        });
        var widths = items.map(function (it) { var d = DIM[it.p.img]; return it.p.h * d[0] / d[1]; });
        var total = widths.reduce(function (a, b) { return a + b; }, 0) + gap * (items.length - 1);
        var s = Math.min(scaleCap || 1, total > avail ? (avail - gap * (items.length - 1)) / (total - gap * (items.length - 1)) : 1);
        if (s < 1) widths = widths.map(function (w) { return w * s; });
        var sum = widths.reduce(function (a, b) { return a + b; }, 0);
        var g = items.length > 1 ? Math.max(6, Math.min(26, (avail - sum) / (items.length - 1))) : 0;
        var x = MARGIN + Math.max(0, (avail - sum - g * (items.length - 1)) / 2);
        return items.map(function (it, i) {
            var w = widths[i], h = w * DIM[it.p.img][1] / DIM[it.p.img][0];
            var o = { p: it.p, k: it.k, x: x, y: baseline - h, w: w, h: h };
            x += w + g;
            return o;
        });
    }

    function render(cfg) {
        if (!cfg) return '';
        var P = parts(cfg);
        if (!P.top.length) return '';
        var hasLow = P.low.length > 0;
        var yTop = hasLow ? 128 : 190;
        var trunkR = 150, trunkB = 155, yLow = 248;
        var top = layout(P.top, yTop);
        var low = hasLow ? layout(P.low, yLow) : [];
        var out = [];

        // Магистрали — под кадрами: у кадров белый фон, линии за ними не видны
        var lines = [];
        var minX = 1e9, maxX = -1e9;
        function vline(x, y1, y2, color) {
            lines.push('<line x1="' + x.toFixed(1) + '" y1="' + y1 + '" x2="' + x.toFixed(1) + '" y2="' + y2 + '" stroke="' + color + '" stroke-width="1.5"/>');
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        }
        if (hasLow) {
            top.forEach(function (b) {
                if (!b.p.hot) return;
                vline(b.x + b.w * 0.32, yTop, trunkR, RED);
                vline(b.x + b.w * 0.68, yTop, trunkB, BLUE);
            });
            low.forEach(function (b) {
                if (!b.p.hot) return;
                vline(b.x + b.w * 0.30, trunkR, yLow - b.h, RED);
                vline(b.x + b.w * 0.70, trunkB, yLow - b.h, BLUE);
            });
            if (maxX > minX) {
                lines.push('<line x1="' + (minX - 2).toFixed(1) + '" y1="' + trunkR + '" x2="' + (maxX + 2).toFixed(1) + '" y2="' + trunkR + '" stroke="' + RED + '" stroke-width="1.8"/>');
                lines.push('<line x1="' + (minX - 2).toFixed(1) + '" y1="' + trunkB + '" x2="' + (maxX + 2).toFixed(1) + '" y2="' + trunkB + '" stroke="' + BLUE + '" stroke-width="1.8"/>');
            }
        }
        out.push(lines.join(''));

        function image(b) {
            return '<image href="' + IMG + b.p.img + '.jpg" x="' + b.x.toFixed(1) + '" y="' + b.y.toFixed(1) +
                '" width="' + b.w.toFixed(1) + '" height="' + b.h.toFixed(1) + '" preserveAspectRatio="xMidYMid meet"/>';
        }
        function caption(b, below) {
            var L = wrap(b.p.cap, Math.max(b.w, 38)), fs = 5.0;
            var cx = b.x + b.w / 2;
            var y0 = below ? b.y + b.h + 5.5 : b.y - 2 - (L.length - 1) * fs * 1.15;
            return L.map(function (t, i) {
                return '<text x="' + cx.toFixed(1) + '" y="' + (y0 + i * fs * 1.15).toFixed(1) + '" text-anchor="middle" font-size="' + fs + '">' + esc(t) + '</text>';
            }).join('');
        }
        var seen = {};
        top.forEach(function (b) { out.push(image(b)); if (!b.k) out.push(caption(b, false)); });
        low.forEach(function (b) {
            out.push(image(b));
            // подпись группы из двух кадров — одна, под первым
            var key = b.p.cap;
            if (!seen[key]) { seen[key] = 1; out.push(caption(b, true)); }
        });

        // Легенда магистралей и пометка о наглядности
        var ly = 281;
        out.push('<line x1="' + MARGIN + '" y1="' + ly + '" x2="' + (MARGIN + 12) + '" y2="' + ly + '" stroke="' + RED + '" stroke-width="1.8"/>' +
            '<text x="' + (MARGIN + 15) + '" y="' + (ly + 1.5) + '" font-size="4.8">подача</text>' +
            '<line x1="' + (MARGIN + 38) + '" y1="' + ly + '" x2="' + (MARGIN + 50) + '" y2="' + ly + '" stroke="' + BLUE + '" stroke-width="1.8"/>' +
            '<text x="' + (MARGIN + 53) + '" y="' + (ly + 1.5) + '" font-size="4.8">обратка</text>' +
            '<text x="' + (SHEET.w - MARGIN) + '" y="' + (ly + 1.5) + '" font-size="4.2" text-anchor="end" fill="#555">Фото оборудования для наглядности: модели и количество — в смете</text>');

        return '<div class="sr-wrap" onclick="SchemeReal.open()" title="Открыть на весь экран">' +
            '<svg xmlns="http://www.w3.org/2000/svg" class="sr-svg" viewBox="0 0 ' + SHEET.w + ' ' + SHEET.h + '" font-family="Arial Narrow, Arial, sans-serif" fill="#111">' +
            '<rect x="0" y="0" width="' + SHEET.w + '" height="' + SHEET.h + '" fill="#fff"/>' +
            '<text x="' + MARGIN + '" y="12" font-size="5.2" font-weight="700">Как это выглядит в котельной</text>' +
            out.join('') + '</svg>' +
            '<button type="button" class="scheme-zoom-btn" aria-label="На весь экран">⛶ На весь экран</button></div>';
    }

    // Полноэкранный просмотр: копия листа поверх страницы, закрывается щелчком или Esc
    function open() {
        var svg = document.querySelector('#scheme_real_side .sr-svg');
        if (!svg) return;
        close();
        var ov = document.createElement('div');
        ov.id = 'scheme_real_zoom';
        ov.setAttribute('role', 'dialog');
        ov.innerHTML = '<button type="button" class="sr-zoom-x" aria-label="Закрыть">✕</button>';
        var c = svg.cloneNode(true);
        c.removeAttribute('class');
        c.setAttribute('class', 'sr-zoom-svg');
        ov.appendChild(c);
        ov.addEventListener('click', close);
        document.body.appendChild(ov);
        document.addEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    function close() {
        var ov = document.getElementById('scheme_real_zoom');
        if (ov) ov.remove();
        document.removeEventListener('keydown', onKey);
    }

    window.SchemeReal = { render: render, open: open, close: close };
})();
