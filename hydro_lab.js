/* hydro_lab.js — «Гидролаборатория»: проба новых подписей на принципиальной схеме.
 *
 * Зачем. Расход и напор каждого контура уже посчитаны (app.buildHydroCheckData — те же
 * числа, что в карточке «Проверка подбора»), но на самом листе их нет: в печать и PDF
 * схема уходит без них. Здесь две пробы:
 *   1. таблица «Характеристики контуров» на свободном поле листа — попадает в печать,
 *      PDF и полноэкранный режим, потому что они берут схему из DOM;
 *   2. выноска с полкой у контура, на который навели при включённой подсветке.
 *
 * Чего здесь НЕТ: своего гидравлического расчёта. Все числа приходят готовыми из
 * app.buildHydroCheckData() и cfg.hyd схемы, поэтому разойтись со сметой не могут.
 * Смету и схему этот файл не меняет — только добавляет поверх листа свои группы.
 *
 * Включение. Проба выключена по умолчанию: ?lab=1 в адресе включает её до конца
 * сессии вкладки, ?lab=0 выключает. Без флага экран такой же, как без этого файла.
 *
 * Глобал: window.hydroLab = { on, afterScheme, onHover, offHover }.
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
      if (p === '1') root.sessionStorage.setItem(KEY, '1');
      if (p === '0') root.sessionStorage.removeItem(KEY);
      return root.sessionStorage.getItem(KEY) === '1';
    } catch (e) {
      return /[?&]lab=1(&|$)/.test(root.location.search);
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

  root.hydroLab = { on: on, afterScheme: afterScheme, onHover: onHover, offHover: offHover };
})(typeof window !== 'undefined' ? window : this);
