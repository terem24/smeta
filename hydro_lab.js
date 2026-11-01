/* hydro_lab.js — «Гидролаборатория»: расход и напор контуров на принципиальной схеме и график насоса.
 *
 * Зачем. Расход и напор каждого контура уже посчитаны (app.buildHydroCheckData — те же
 * числа, что в карточке «Проверка подбора»), но на самом листе их нет: в печать и PDF
 * схема уходит без них. Здесь три вещи:
 *   1. таблица «Характеристики контуров» на свободном поле листа — попадает в печать,
 *      PDF и полноэкранный режим, потому что они берут схему из DOM;
 *   2. выноска с полкой у контура, на который навели при включённой подсветке;
 *   3. график рабочей точки насоса в раскрытой строке «Проверки подбора» (только экран).
 *
 * Чего здесь НЕТ: своего гидравлического расчёта. Все числа приходят готовыми из
 * app.buildHydroCheckData() и cfg.hyd схемы, поэтому разойтись со сметой не могут.
 * Смету и схему этот файл не меняет — только добавляет поверх листа свои группы.
 *
 * Включение. Включено у всех (с 02.11.2026; до этого было пробой под ?lab=1).
 * ?lab=0 в адресе выключает до конца сессии вкладки — аварийный выключатель на случай,
 * если на каком-то листе вставка мешает; ?lab=1 включает обратно.
 *
 * Глобал: window.hydroLab = { on, afterScheme, onHover, offHover, pumpChartHtml }.
 */
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var KEY = 'hcHydroLab';
  var SHEET_W = 420, SHEET_H = 297;           // лист А3, мм — viewBox схемы
  var FONT_TABLE = 2.5, FONT_TITLE = 3.67, FONT_CO = 2.9;
  var CHAR_W = 0.5;                            // ширина знака ISOCPEUR в долях кегля (с запасом)
  var GAP = 2.5;                               // зазор от чертежа, мм

  function on() {
    try {
      var p = new URLSearchParams(root.location.search).get('lab');
      if (p === '0') root.sessionStorage.setItem(KEY, '0');
      if (p === '1') root.sessionStorage.removeItem(KEY);
      return root.sessionStorage.getItem(KEY) !== '0';
    } catch (e) {
      return !/[?&]lab=0(&|$)/.test(root.location.search);
    }
  }

  function num(v, k) {
    return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(k).replace('.', ',');
  }

  function el(tag, attrs, text) {
    var e = root.document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  function font() {
    return (root.projectSheets && root.projectSheets.FONT) || "'ISOCPEUR','GOST type A','Arial Narrow',sans-serif";
  }

  // Текст чертежа: чёрный без обводки — так же, как правило .sheet-a3 text у листа.
  var INK = 'fill:#000;stroke:none';
  var LINE = 'stroke:#000;fill:none;stroke-width:';

  // ── Препятствия: прямоугольники всего, что нарисовано на листе, в мм листа ──
  // Берём экранные рамки и переводим в координаты viewBox: так не важны вложенные
  // transform у групп композитора. Подложка листа, невидимые зоны наведения и сами
  // вставки лаборатории препятствиями не считаются.
  function obstacles(svg) {
    var box = svg.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    var kx = SHEET_W / box.width, ky = SHEET_H / box.height, out = [];
    var all = svg.querySelectorAll('line,rect,path,text,circle,ellipse,polyline,polygon,use,image');
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (n.closest('.hyd-lab-co, .hyd-ov') ||n.classList.contains('hyd-zone') || n.classList.contains('hyd-hit')) continue;
      var r = n.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      var x = (r.left - box.left) * kx, y = (r.top - box.top) * ky, w = r.width * kx, h = r.height * ky;
      if (w > SHEET_W * 0.9 && h > SHEET_H * 0.9) continue;    // подложка листа
      out.push([x, y, x + w, y + h]);
    }
    return out;
  }

  function free(obs, x0, y0, x1, y1) {
    if (x0 < 8 || y0 < 8 || x1 > SHEET_W - 8 || y1 > SHEET_H - 8) return false;
    for (var i = 0; i < obs.length; i++) {
      var o = obs[i];
      if (o[0] < x1 + GAP && o[2] > x0 - GAP && o[1] < y1 + GAP && o[3] > y0 - GAP) return false;
    }
    return true;
  }

  // ── 1. Таблица «Характеристики контуров» ─────────────────────────────────
  var MARK = { rad: 'Т1, Т2', ufh: 'Т11, Т21' };
  var NAME = { boiler: 'Котловой контур', rad: 'Радиаторы', ufh: 'Тёплый пол', dhw: 'Загрузка бойлера' };

  function pumpShort(s) {
    if (!s) return '—';
    if (/встроенн|штатн/i.test(s)) return 'котла';
    s = String(s).split(/[,(]/)[0].trim();
    return s.length > 14 ? s.slice(0, 13) + '…' : s;
  }

  function rowName(r, regime) {
    var base = NAME[r.id] || String(r.title || r.id).split(':')[0];
    var tail = String(r.title || '').split(':')[1];
    if (r.id === 'rad' && regime) return base + ' ' + regime;
    if (r.id === 'ufh' && tail) return base + ', ' + tail.trim().replace(/\s*этаж$/, ' эт.');
    return base;
  }

  function tableGroup(app, data) {
    var cfg = app._schemeCfgCache || {};
    var regime = cfg.hyd && cfg.hyd.regime;
    var rows = (data.rows || []).filter(function (r) { return r && r.flow > 0; });
    if (!rows.length) return null;
    var cols = [['Обозн.', 13], ['Контур', 38], ['G, м³/ч', 15], ['Hтр, м', 14], ['Hнас, м', 14], ['Насос', 21]];
    var W = cols.reduce(function (a, c) { return a + c[1]; }, 0);
    var rowH = 6.2, H = rowH * (rows.length + 1), head = 5.5;
    var g = el('g', { 'class': 'hyd-lab hyd-lab-table', 'font-family': font(), 'font-size': FONT_TABLE });
    g.appendChild(el('text', { x: W / 2, y: head - 2, 'text-anchor': 'middle', 'font-size': FONT_TITLE, style: INK }, 'Характеристики контуров'));
    g.appendChild(el('rect', { x: 0, y: head, width: W, height: H, style: LINE + '.3' }));
    var cx = 0;
    cols.forEach(function (c, i) {
      if (i) g.appendChild(el('line', { x1: cx, y1: head, x2: cx, y2: head + H, style: LINE + '.2' }));
      g.appendChild(el('text', { x: cx + c[1] / 2, y: head + rowH / 2 + 0.9, 'text-anchor': 'middle', style: INK }, c[0]));
      cx += c[1];
    });
    // Второй и следующие коллекторы тёплого пола на схеме маркируются Т11.2/Т21.2 и т. д.
    var ufhN = 0;
    rows.forEach(function (r, i) {
      var y = head + rowH * (i + 1);
      g.appendChild(el('line', { x1: 0, y1: y, x2: W, y2: y, style: LINE + '.2' }));
      var mark = MARK[r.id] || '—';
      if (r.id === 'ufh') { ufhN++; if (ufhN > 1) mark = 'Т11.' + ufhN + ', Т21.' + ufhN; }
      var cells = [mark,rowName(r, regime), num(r.flow, 2), num(r.need, 1), num(r.have, 1), pumpShort(r.pump)];
      var xx = 0;
      cells.forEach(function (t, j) {
        g.appendChild(el('text', {
          x: j === 1 ? xx + 1.2 : xx + cols[j][1] / 2, y: y + rowH / 2 + 0.9,
          'text-anchor': j === 1 ? 'start' : 'middle', style: INK
        }, t));
        xx += cols[j][1];
      });
    });
    return { g: g, w: W, h: head + H };
  }

  // Первое свободное место, слева направо и сверху вниз: на обычном листе это поле
  // под таблицей УГО. Места нет — таблицу не рисуем, а не кладём поверх чертежа.
  function placeTable(obs, w, h) {
    for (var x = 25.5; x + w <= SHEET_W - 8; x += 5) {
      for (var y = 12; y + h <= SHEET_H - 8; y += 2) {
        if (free(obs, x, y, x + w, y + h)) return { x: x, y: y };
      }
    }
    return null;
  }

  function afterScheme(app) {
    if (!on()) return;
    var svg = root.document.querySelector('#dynamic_scheme svg.scheme-svg');
    if (!svg || typeof app.buildHydroCheckData !== 'function') return;
    var data;
    try { data = app.buildHydroCheckData(); } catch (e) { console.warn('[hydroLab] данные проверки:', e); return; }
    if (!data) return;
    var t = tableGroup(app, data);
    if (!t) return;
    var obs = obstacles(svg);
    if (!obs) {
      // Лист ещё не на экране (страница скрыта, пока идёт вход или заставка): мерить
      // нечего. Ждём, когда у него появится размер, и ставим таблицу тогда — иначе
      // она не появлялась до следующей перерисовки сметы.
      waitVisible(svg, function () { place(svg, t); });
      return;
    }
    place(svg, t, obs);
  }

  function waitVisible(svg, done) {
    if (svg.__hydLabWait) return;
    svg.__hydLabWait = true;
    var fire = function () {
      if (!svg.isConnected) return true;            // схему уже перерисовали — эта не нужна
      var r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      done();
      return true;
    };
    if (root.ResizeObserver) {
      var ro = new root.ResizeObserver(function () { if (fire()) ro.disconnect(); });
      ro.observe(svg);
    } else {
      var n = 0, tick = function () { if (!fire() && ++n < 600) root.setTimeout(tick, 500); };
      root.setTimeout(tick, 500);
    }
  }

  function place(svg, t, obs) {
    if (svg.querySelector('.hyd-lab-table')) return;
    obs = obs || obstacles(svg);
    if (!obs) return;
    var at = placeTable(obs, t.w, t.h);
    if (!at) { console.info('[hydroLab] на листе нет места под таблицу контуров'); return; }
    t.g.setAttribute('transform', 'translate(' + at.x + ' ' + at.y + ')');
    // Прямо в <svg>, а не в группу чертежа: приглушение при подсветке гасит детей
    // группы, а таблица должна оставаться читаемой.
    svg.appendChild(t.g);
  }

  // ── 2. Выноска у контура при подсветке ───────────────────────────────────
  function calloutLines(app, d) {
    var cfg = app._schemeCfgCache || {}, hyd = cfg.hyd || {};
    var rows = {};
    try { ((app.buildHydroCheckData() || {}).rows || []).forEach(function (r) { rows[r.id] = r; }); } catch (e) { /* без таблицы */ }
    if (d.kind === 'trunk' && rows.rad) {
      return ['Радиаторы' + (hyd.regime ? ' ' + hyd.regime + ' °C' : ''),
        'G = ' + num(rows.rad.flow, 2) + ' м³/ч, Hтр = ' + num(rows.rad.need, 1) + ' м'];
    }
    if (d.kind === 'ufh') {
      var m = hyd.ufh && hyd.ufh.mans ? hyd.ufh.mans[d.i || 0] : null;
      if (m) return ['Тёплый пол' + (m.label ? ', ' + m.label : ''),
        'G = ' + num(m.flow, 2) + ' м³/ч, Hтр = ' + num(m.need, 1) + ' м'];
      if (rows.ufh) return ['Тёплый пол', 'G = ' + num(rows.ufh.flow, 2) + ' м³/ч, Hтр = ' + num(rows.ufh.need, 1) + ' м'];
    }
    if (d.kind === 'dhw' && hyd.dhw) {
      return ['Загрузка бойлера, ' + num(hyd.dhw.kw, 0) + ' кВт',
        'G = ' + num(hyd.dhw.flow, 2) + ' м³/ч, Hтр = ' + num(hyd.dhw.head, 1) + ' м'];
    }
    if ((d.kind === 'boiler' || d.kind === 'main') && rows.boiler) {
      return ['Котловой контур', 'G = ' + num(rows.boiler.flow, 2) + ' м³/ч, Hтр = ' + num(rows.boiler.need, 1) + ' м'];
    }
    return null;
  }

  // Точка, к которой тянем выноску: середина невидимой зоны наведения контура.
  function anchorOf(svg, d) {
    var sel = 'rect.hyd-zone[data-hyd="' + d.kind + '"]' + (d.mark ? '[data-hyd-mark="' + d.mark + '"]' : '');
    var z = svg.querySelector(sel);
    var x, y, w, h;
    if (z) {
      x = +z.getAttribute('x'); y = +z.getAttribute('y'); w = +z.getAttribute('width'); h = +z.getAttribute('height');
    } else if (d.el && d.el.getBBox) {
      var b = d.el.getBBox(); x = b.x; y = b.y; w = b.width; h = b.height;
    } else return null;
    var tall = h > w * 3;
    return { x: x + w / 2, y: tall ? y + h * 0.6 : y + h / 2, half: w / 2 };
  }

  function offHover() {
    var list = root.document.querySelectorAll('.hyd-lab-co');
    for (var i = 0; i < list.length; i++) list[i].remove();
  }

  function onHover(app, d) {
    offHover();
    if (!on() || !d || !d.svg) return;
    var lines = calloutLines(app, d);
    if (!lines) return;
    var a = anchorOf(d.svg, d);
    if (!a) return;
    var obs = d.svg.__hydLabObs || (d.svg.__hydLabObs = obstacles(d.svg)) || [];
    var textW = Math.max.apply(null, lines.map(function (s) { return s.length; })) * FONT_CO * CHAR_W + 2;
    // Перебираем полки: влево и вправо от контура, выше и ниже точки. Первая, под
    // которой нет чертежа, — наша. Свободной нет — берём первую и подкладываем белое.
    var tries = [], dy = [-10, -16, 10, -24, 18, -32, 26];
    dy.forEach(function (v) { tries.push({ dir: -1, dy: v }); tries.push({ dir: 1, dy: v }); });
    var pick = null;
    for (var i = 0; i < tries.length && !pick; i++) {
      var t = tries[i], sy = a.y + t.dy, kx = a.x + t.dir * (a.half + 8);
      var x0 = t.dir < 0 ? kx - textW : kx, x1 = t.dir < 0 ? kx : kx + textW;
      if (free(obs, x0, sy - FONT_CO * 1.4, x1, sy + FONT_CO * 1.9)) pick = { t: t, sy: sy, kx: kx, x0: x0, x1: x1 };
    }
    var solid = !pick;
    if (!pick) {
      var t0 = tries[0], sy0 = a.y + t0.dy, kx0 = a.x - (a.half + 8);
      pick = { t: t0, sy: sy0, kx: kx0, x0: kx0 - textW, x1: kx0 };
    }
    var g = el('g', { 'class': 'hyd-lab hyd-lab-co', 'font-family': font(), 'font-size': FONT_CO, 'pointer-events': 'none' });
    if (solid) g.appendChild(el('rect', { x: pick.x0 - 0.8, y: pick.sy - FONT_CO * 1.5, width: pick.x1 - pick.x0 + 1.6, height: FONT_CO * 3.4, style: 'fill:#fff;stroke:none;opacity:.92' }));
    g.appendChild(el('circle', { cx: a.x, cy: a.y, r: 0.7, style: 'fill:#000;stroke:none' }));
    g.appendChild(el('line', { x1: a.x, y1: a.y, x2: pick.kx, y2: pick.sy, style: LINE + '.25' }));
    g.appendChild(el('line', { x1: pick.x0, y1: pick.sy, x2: pick.x1, y2: pick.sy, style: LINE + '.25' }));
    g.appendChild(el('text', { x: pick.x0 + 1, y: pick.sy - 1.3, style: INK }, lines[0]));
    if (lines[1]) g.appendChild(el('text', { x: pick.x0 + 1, y: pick.sy + FONT_CO * 1.25, style: INK }, lines[1]));
    d.svg.appendChild(g);
  }

  // ── 3. Рабочая точка насоса в строке карточки «Проверка подбора» ─────────
  // Кривая насоса — r.headAt (та же, по которой посчитано «Насос даёт»), кривая сети
  // проходит через расчётную точку: H = Hтр · (G / Gрасч)². Пересечение — расход, который
  // насос прогонит, если лишний напор ничем не гасить.
  function niceStep(span, maxTicks) {
    var steps = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) if (span / steps[i] <= maxTicks) return steps[i];
    return 20;
  }

  function lmtd(a, b, room) {
    var x = a - room, y = b - room;
    return Math.abs(x - y) < 1e-6 ? x : (x - y) / Math.log(x / y);
  }

  // Радиаторы при расходе k × расчётного: обратка и отдача (закон 1,3 по логарифмическому
  // напору, баланс по расходу). Возвращает { tr, p } — обратка, °C, и отдача в долях расчёта.
  function radAt(app, k) {
    var reg = app.radRegime ? app.radRegime() : { dt: 20 };
    var tm = reg.tMean || 70, ts = tm + reg.dt / 2, tr0 = tm - reg.dt / 2, room = 20;
    var ref = lmtd(ts, tr0, room), best = null;
    for (var tr = ts - 0.02; tr > room + 0.5; tr -= 0.02) {
      var g = Math.abs(k * (ts - tr) - (ts - tr0) * Math.pow(lmtd(ts, tr, room) / ref, 1.3));
      if (!best || g < best.g) best = { g: g, tr: tr };
    }
    return best ? { tr: best.tr, tr0: tr0, p: k * (ts - best.tr) / (ts - tr0) } : null;
  }

  function pumpChartHtml(app, r) {
    if (!r || typeof r.headAt !== 'function' || !(r.flow > 0) || !(r.need > 0)) return '';
    var H = function (q) { var v = r.headAt(q); return (v > 0 && isFinite(v)) ? v : 0; };
    var Q = r.flow, Hn = r.need, sys = function (q) { return Hn * (q / Q) * (q / Q); };
    var h0 = H(0);
    if (!(h0 > 0)) return '';
    // Где кончается кривая насоса
    var qEnd = 0, lim = Math.max(Q * 4, 6);
    for (var q = 0; q <= lim; q += lim / 400) { if (H(q) > 0) qEnd = q; else if (q > Q) break; }
    // Пересечение с кривой сети
    var lo = 0, hi = Math.max(qEnd, Q);
    for (var i = 0; i < 60; i++) { var m = (lo + hi) / 2; if (H(m) > sys(m)) lo = m; else hi = m; }
    var qF = lo, hF = H(qF), have = H(Q);

    // Ось — до 2,5 рабочих расходов: у длинной кривой (25/80) иначе вся интересная часть
    // сжималась у левого края. Кривая насоса за краем просто обрезается.
    var xMax = Math.max(Math.min(qEnd, Math.max(qF, Q) * 2.5), qF * 1.2, Q * 1.3), xs = niceStep(xMax, 6); xMax = Math.ceil(xMax / xs) * xs;
    var yMax = Math.max(h0, Hn, have) * 1.12, ys = niceStep(yMax, 6); yMax = Math.ceil(yMax / ys) * ys;
    // Рисунок — функцией от размера: в карточке он маленький (340×176, растягивается до
    // 420 px), а в окне «на весь экран» перерисовывается под фактическую область (fitCharts),
    // чтобы подписи оставались своего кегля, а не раздувались вместе с картинкой.
    var draw = function (W, Ht, f) {
    var big = !!f; f = f || 10;
    var L = Math.round(f * 3), R = 10, T = Math.round(f * 2), B = Math.round(f * 2.6), pr = f * 0.45;
    var X = function (v) { return L + v / xMax * (W - L - R); };
    var Y = function (v) { return Ht - B - v / yMax * (Ht - B - T); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + Ht + '" role="img" aria-label="Кривая насоса, кривая сети и рабочая точка" style="' +
      (big ? 'width:' + W + 'px;height:' + Ht + 'px;max-width:100%' : 'width:100%;max-width:420px') +
      ';display:block;margin:6px 0 2px;font:' + f + 'px system-ui,sans-serif">';
    for (var y = 0; y <= yMax + 1e-9; y += ys) {
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(y) + '" y2="' + Y(y) + '" stroke="currentColor" opacity=".12"/>' +
        '<text x="' + (L - 5) + '" y="' + (Y(y) + f * 0.3) + '" text-anchor="end" fill="currentColor" opacity=".6">' + num(y, ys < 1 ? 1 : 0) + '</text>';
    }
    for (var x = 0; x <= xMax + 1e-9; x += xs) {
      s += '<text x="' + X(x) + '" y="' + (Ht - B + f * 1.3) + '" text-anchor="middle" fill="currentColor" opacity=".6">' + num(x, xs < 0.1 ? 2 : xs < 1 ? 1 : 0) + '</text>';
    }
    s += '<text x="' + (W - R) + '" y="' + (Ht - 2) + '" text-anchor="end" fill="currentColor" opacity=".6">м³/ч</text>' +
      '<text x="' + (L - 5) + '" y="' + (T - f * 0.9) + '" text-anchor="end" fill="currentColor" opacity=".6">м</text>';
    var pp = [];
    for (var k = 0; k <= 120; k++) { var qq = Math.min(qEnd, xMax) * k / 120, hh = H(qq); if (hh > 0) pp.push(X(qq).toFixed(1) + ',' + Y(hh).toFixed(1)); }
    s += '<polyline points="' + pp.join(' ') + '" fill="none" stroke="#3b82f6" stroke-width="2"/>';
    var sp = [];
    for (var j = 0; j <= 120; j++) { var q2 = xMax * j / 120, h2 = sys(q2); if (h2 <= yMax) sp.push(X(q2).toFixed(1) + ',' + Y(h2).toFixed(1)); }
    s += '<polyline points="' + sp.join(' ') + '" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="5 4"/>';
    if (have > Hn) s += '<line x1="' + X(Q) + '" x2="' + X(Q) + '" y1="' + Y(have) + '" y2="' + Y(Hn) + '" stroke="currentColor" opacity=".45" stroke-dasharray="2 2"/>';
    s += '<circle cx="' + X(Q) + '" cy="' + Y(Hn) + '" r="' + pr + '" fill="#10b981"/>';
    s += '<circle cx="' + X(qF) + '" cy="' + Y(hF) + '" r="' + pr + '" fill="none" stroke="#f59e0b" stroke-width="2"/>';
    s += '<text x="' + (X(0) + 6) + '" y="' + (Y(h0) - f * 0.5) + '" fill="#3b82f6" font-weight="600">насос</text></svg>';
    return s;
    };
    var s = draw(340, 176);
    var id = ++chartSeq;
    charts[id] = draw;

    var dhw = r.id === 'dhw';
    var openTxt = dhw ? 'фактически' : (r.id === 'ufh' ? 'расходомеры открыты' : 'клапаны открыты');
    var legend = '<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;margin:2px 0 4px">' +
      '<span><b style="color:#10b981">●</b> расчёт: ' + num(Q, 2) + ' м³/ч, ' + num(Hn, 1) + ' м</span>' +
      '<span><b style="color:#f59e0b">○</b> ' + openTxt + ': ' + num(qF, 2) + ' м³/ч, ' + num(hF, 1) + ' м</span>' +
      '<span style="opacity:.7"><span style="color:#f59e0b">- -</span> сеть</span></div>';

    var txt;
    if (have < Hn) {
      txt = 'Насос на расчётном расходе даёт ' + num(have, 1) + ' м при нужных ' + num(Hn, 1) + ' м: реально пойдёт около ' +
        num(qF, 2) + ' м³/ч вместо ' + num(Q, 2) + '.';
      if (r.id === 'rad') { var a = radAt(app, qF / Q); if (a) txt += ' Приборы отдадут около ' + Math.round(a.p * 100) + ' % расчёта, обратка ' + num(a.tr, 0) + ' °C.'; }
    } else if (dhw) {
      txt = 'Регулировки на змеевике нет, поэтому насос гонит столько, где его кривая пересекает сеть: ' + num(qF, 2) +
        ' м³/ч при ' + num(hF, 1) + ' м. Расчётный расход ' + num(Q, 2) + ' м³/ч обеспечен.';
    } else {
      txt = 'На расчётном расходе насос даёт ' + num(have, 1) + ' м при нужных ' + num(Hn, 1) + ' м. Лишние ' + num(have - Hn, 1) +
        ' м гасят ' + (r.id === 'ufh' ? 'расходомеры и смесительный узел' : 'термоклапаны и балансировка') + '. ';
      if (r.id === 'ufh') {
        txt += 'Если расходомеры открыты полностью, насос прогонит ' + num(qF, 2) + ' м³/ч.';
      } else {
        txt += 'Если клапаны открыты полностью (весна, комната остыла), насос прогонит ' + num(qF, 2) + ' м³/ч';
        var b = radAt(app, qF / Q);
        if (b) txt += ': обратка поднимется до ' + num(b.tr, 0) + ' °C вместо ' + num(b.tr0, 0) + ', приборы отдадут на ' + Math.max(0, Math.round((b.p - 1) * 100)) + ' % больше расчёта';
        var tp = (r.parts || []).filter(function (p) { return p.tag === 'trunk' && p.v > 0; })[0];
        var hyd = (app._schemeCfgCache || {}).hyd || {}, vLim = hyd.parts && hyd.parts.trunk ? hyd.parts.trunk.vLim : null;
        if (tp) txt += ', скорость в трассе вырастет до ' + num(tp.v * qF / Q, 2) + ' м/с' + (vLim ? ' (предел ' + num(vLim, 1) + ')' : '');
        txt += '.';
      }
    }
    return '<div class="hc-lab-chart" data-hl="' + id + '" style="margin:8px 0 4px;padding-top:8px;border-top:1px solid var(--border,rgba(127,127,127,.25))">' +
      '<div style="font-weight:700;font-size:12px">Рабочая точка насоса</div>' + s + legend +
      '<div style="font-size:11.5px;line-height:1.45;opacity:.85">' + txt + '</div></div>';
  }

  // Рисунки графиков по номеру: fitCharts перерисовывает их под размер окна. Карточка
  // пересобирается при каждом пересчёте, поэтому старые номера просто вытесняются.
  var charts = {}, chartSeq = 0;

  // Окно «на весь экран»: график раскрытого пункта занимает всё свободное по высоте место
  // и всю ширину пункта. Сначала сжимаем рисунок до нуля и смотрим, сколько места остаётся
  // под остальным содержимым, — столько ему и отдаём (не меньше 180 px).
  function fitCharts(scroller) {
    if (!scroller) return;
    var list = scroller.querySelectorAll('details[open] .hc-lab-chart[data-hl]');
    for (var i = 0; i < list.length; i++) {
      var box = list[i], draw = charts[box.getAttribute('data-hl')], svg = box.querySelector('svg');
      if (!draw || !svg) continue;
      svg.style.height = '0px'; svg.style.width = '0px';
      var w = Math.floor(box.clientWidth);
      // Свободное место — высота окна минус высота содержимого со сжатым рисунком.
      // scrollHeight для этого не годится: он не бывает меньше видимой высоты.
      var cs = root.getComputedStyle(scroller), inner = 0;
      for (var c = scroller.firstElementChild; c; c = c.nextElementSibling) inner += c.getBoundingClientRect().height;
      var free = scroller.clientHeight - inner - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      var h = Math.max(180, Math.floor(free / list.length) - 4);
      // Слишком вытянутый в ширину график читается хуже: не шире трёх высот
      w = Math.max(280, Math.min(w, h * 3));
      var f = w < 520 ? 11 : 13;
      svg.outerHTML = draw(w, h, f);
    }
  }

  root.hydroLab = { on: on, afterScheme: afterScheme, onHover: onHover, offHover: offHover, pumpChartHtml: pumpChartHtml, fitCharts: fitCharts };
})(typeof window !== 'undefined' ? window : this);
