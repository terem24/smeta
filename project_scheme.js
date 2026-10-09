/* project_scheme.js — лист «Принципиальная схема» (А3, ГОСТ 21.101)
 *
 * УГО, таблица обозначений, легенда трубопроводов и вся геометрия сняты
 * с листа ТМ-2 проекта 2025-191 (Boiler_Club_106m2.pdf, стр. 25) и листов
 * ТМ-03 проектов 2025-148 / 2025-1209R — не нарисованы по памяти.
 *
 * Схема не рисуется, а КОМПОНУЕТСЯ из конфигурации системы:
 *   { gas: {circuits}, el: {}, indirect: {vol}, fugas, loadPump,
 *     rad, tp, hydro: {kw}, water, recirc, tankHeating, tankDhw, dia }
 *
 * Требует project_sheets.js (рамка, штамп, текст). Глобал: window.projectScheme
 */
(function () {
  'use strict';

  // ─── Цвета трубопроводов (сняты с ТМ-2) ────────────────────────────────
  var COL = {
    supply: '#ff0000',   // подающий
    ret: '#0000ff',      // обратный
    loadS: '#800040',    // подающий загрузки бойлера
    loadR: '#8282ff',    // обратный загрузки бойлера
    dhw: '#ff8000',      // горячее водоснабжение
    recirc: '#ff00ff',   // рециркуляция ГВС
    cold: '#00ffff',     // холодное водоснабжение
    // Вторичный контур снеготаяния залит гликолем — это отдельная среда, и по
    // ГОСТ 21.205 её линии обязаны отличаться от контура отопления. Пара
    // «тёмная подача / светлая обратка» — та же, что у загрузки бойлера.
    snowS: '#7030a0',    // подающий трубопровод снеготаяния
    snowR: '#b799d8'     // обратный трубопровод снеготаяния
  };
  // Толщины: трубы схемы 0.2, образцы в легенде 0.35, тонкие выноски 0.08
  var LW = { pipe: 0.2, sym: 0.2, thin: 0.08, sample: 0.35 };
  var SZ = { txt: 3.68, dia: 2.05, head: 5.19, title: 7.36 };
  var GREY = { body: '#f0f0f0', edge: '#e1e1e1', icon: '#1e88c7' };

  function n(v) { return Math.round(v * 100) / 100; }
  // Труба или нет — по цвету среды и толщине: символы арматуры чёрные, образцы
  // легенды толще (LW.sample). Помеченные data-p линии клонирует подсветка
  // пути воды на экране; на сам чертёж атрибут не влияет.
  var PIPE_COLS = Object.keys(COL).map(function (k) { return COL[k]; });
  function isPipe(o) {
    return !!(o && o.c && (o.w || LW.sym) === LW.pipe && PIPE_COLS.indexOf(o.c) >= 0);
  }
  // Линии и прямоугольники задают вид инлайн-стилем: общий <style> листа
  // (.sheet-a3 line,rect {stroke:#000}) иначе перебьёт цвета трубопроводов.
  function ln(x1, y1, x2, y2, o) {
    o = o || {};
    return '<line x1="' + n(x1) + '" y1="' + n(y1) + '" x2="' + n(x2) + '" y2="' + n(y2) +
      '" style="stroke:' + (o.c || '#000') + ';stroke-width:' + (o.w || LW.sym) +
      (o.dash ? ';stroke-dasharray:' + o.dash : '') + '"' + (isPipe(o) ? ' data-p="1"' : '') + '/>';
  }
  function pline(pts, o) {
    o = o || {};
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + n(p[0]) + ',' + n(p[1]); }).join('');
    return '<path d="' + d + (o.close ? 'Z' : '') + '" fill="' + (o.f || 'none') +
      '" stroke="' + (o.c || (o.f && o.f !== 'none' ? 'none' : '#000')) +
      '" stroke-width="' + (o.w || LW.sym) + '"/>';
  }
  function path(d, o) {
    o = o || {};
    return '<path d="' + d + '" fill="' + (o.f || 'none') + '" stroke="' + (o.c || 'none') +
      '" stroke-width="' + (o.w || 0) + '"' + (isPipe(o) ? ' data-p="1"' : '') + '/>';
  }
  function circle(cx, cy, r, o) {
    o = o || {};
    return '<circle cx="' + n(cx) + '" cy="' + n(cy) + '" r="' + n(r) + '" style="fill:' + (o.f || 'none') +
      ';stroke:' + (o.c || (o.f ? 'none' : '#000')) + ';stroke-width:' + (o.w || LW.sym) + '"/>';
  }
  function rrect(x, y, w, h, r, o) {
    o = o || {};
    return '<rect x="' + n(x) + '" y="' + n(y) + '" width="' + n(w) + '" height="' + n(h) +
      '" rx="' + n(r) + '" style="fill:' + (o.f || 'none') + ';stroke:' + (o.c || 'none') +
      ';stroke-width:' + (o.w || 0) + '"/>';
  }
  function txt(x, y, s, o) { return window.projectSheets.text(x, y, s, o); }
  // Подписи на поле схемы (диаметры, резьбы, марки трубопроводов) ложатся
  // на трубы: стояк, обход-полукруг или магистраль проходят ровно под
  // строкой. Даём им белую подложку — линия под буквами прерывается, как
  // при маскировке текста на чертеже, и подпись читается в любом месте.
  var HALO = 0.55;
  // Приблизительная ширина строки чертёжным шрифтом (он узкий: знак около
  // половины кегля, дробные черты и кавычки уже). Нужна там, где под текст
  // отводится место на поле схемы, — например полке выноски.
  function textW(s, size) {
    s = String(s);
    var w = 0;
    for (var i = 0; i < s.length; i++) w += /[ "',./|]/.test(s[i]) ? 0.3 : 0.55;
    return w * size;
  }
  function txtM(x, y, s, o) {
    o = o || {};
    var c = { halo: HALO };
    for (var k in o) c[k] = o[k];
    return window.projectSheets.text(x, y, s, c);
  }

  // ─── УГО. Все размеры обмерены по колонке символов легенды ТМ-2 ───────

  /** Шаровый кран. (x,y) — центр. vert — на вертикальной трубе.
   *  Вдоль трубы 5, поперёк 3, шарик r 0.82. */
  function ballValve(x, y, vert) {
    function pt(u, v) { return vert ? [x + v, y + u] : [x + u, y + v]; }
    var o = [];
    o.push(pline([pt(-2.5, -1.5), pt(-2.5, 1.5)]));
    o.push(pline([pt(2.5, -1.5), pt(2.5, 1.5)]));
    [[-2.5, 1.5, -0.7, 0.41], [2.5, 1.5, 0.7, 0.41], [-2.5, -1.5, -0.7, -0.41], [2.5, -1.5, 0.7, -0.41]]
      .forEach(function (s) { o.push(pline([pt(s[0], s[1]), pt(s[2], s[3])])); });
    o.push(circle(x, y, 0.82));
    return o.join('');
  }

  /** Обратный клапан. flow: 'down'|'up'|'right'|'left' — куда пропускает.
   *  Две полные диагонали, залитый треугольник со стороны выхода, упор. */
  function checkValve(x, y, flow) {
    var vert = (flow === 'down' || flow === 'up');
    var sgn = (flow === 'down' || flow === 'right') ? 1 : -1;
    function pt(u, v) { u *= sgn; return vert ? [x + v, y + u] : [x + u, y + v]; }
    var o = [];
    o.push(pline([pt(-2.5, -1.5), pt(-2.5, 1.5)]));
    o.push(pline([pt(2.5, -1.5), pt(2.5, 1.5)]));
    o.push(pline([pt(-2.5, 1.5), pt(2.5, -1.5)]));
    o.push(pline([pt(-2.5, -1.5), pt(2.5, 1.5)]));
    o.push(pline([pt(2.5, 1.5), pt(2.5, -1.5), pt(0, 0)], { f: '#000' }));
    // упор-скобка у выходного торца (тонкая линия в оригинале)
    o.push(pline([pt(0.64, -1.08), pt(1.85, -1.81)], { w: LW.thin }));
    o.push(pline([pt(0.69, -2.5), pt(1.85, -1.81)], { w: LW.thin }));
    o.push(pline([pt(1.85, -1.81), pt(-1.98, -1.81)], { w: LW.thin }));
    return o.join('');
  }

  /** Циркуляционный насос. (x,y) — центр, r 2.92, треугольник по потоку. */
  function pump(x, y, dir) {
    var o = [circle(x, y, 2.92)];
    var tri = {
      down: [[x, y + 2.92], [x - 2.52, y - 1.46], [x + 2.52, y - 1.46]],
      up: [[x, y - 2.92], [x - 2.52, y + 1.46], [x + 2.52, y + 1.46]],
      right: [[x + 2.92, y], [x - 1.46, y - 2.52], [x - 1.46, y + 2.52]],
      left: [[x - 2.92, y], [x + 1.46, y - 2.52], [x + 1.46, y + 2.52]]
    }[dir || 'down'];
    o.push(pline(tri, { f: '#000', close: true }));
    return o.join('');
  }

  /** Патрубок клапана: торцевая черта 3 мм + две линии к шарику r 0.82.
   *  (x,y) — центр шарика, side: 'u'|'d'|'l'|'r', вынос торца 2.5. */
  function valvePort(x, y, side) {
    var o = [];
    if (side === 'u' || side === 'd') {
      var sy = side === 'u' ? -1 : 1;
      var ty = y + sy * 2.5;
      o.push(pline([[x - 1.5, ty], [x + 1.5, ty]]));
      o.push(pline([[x - 1.5, ty], [x - 0.41, y + sy * 0.68]]));
      o.push(pline([[x + 1.5, ty], [x + 0.41, y + sy * 0.68]]));
    } else {
      var sx = side === 'l' ? -1 : 1;
      var tx = x + sx * 2.5;
      o.push(pline([[tx, y - 1.5], [tx, y + 1.5]]));
      o.push(pline([[tx, y - 1.5], [x + sx * 0.68, y - 0.41]]));
      o.push(pline([[tx, y + 1.5], [x + sx * 0.68, y + 0.41]]));
    }
    return o.join('');
  }

  /** Трёхходовой клапан: три патрубка + шарик + кружок привода.
   *  kind: 'therm' («м»), 'servo' (линза), 'prio' (полукруг залит).
   *  ports: строка из 'u','d','l','r'. circleSide: свободная сторона. */
  function valve3(x, y, kind, ports, circleSide) {
    ports = ports || 'udr'; circleSide = circleSide || 'l';
    var o = [];
    for (var i = 0; i < ports.length; i++) o.push(valvePort(x, y, ports[i]));
    o.push(circle(x, y, 0.82));
    var C = { l: [-3.13, 0], r: [3.13, 0], u: [0, -3.13], d: [0, 3.13] }[circleSide];
    var cx = x + C[0], cy = y + C[1];
    o.push(circle(cx, cy, 1.5));
    o.push(pline([[cx + (x - cx) * 0.48, cy + (y - cy) * 0.48], [x - (x - cx) * 0.27, y - (y - cy) * 0.27]]));
    if (kind === 'therm') {
      o.push(txt(cx, cy + 1.25, 'м', { size: SZ.txt, anchor: 'middle' }));
    } else if (kind === 'servo') {
      // линза-полумесяц внутри кружка (УГО «клапан трехходовой с сервоприводом»)
      o.push(path('M' + n(cx) + ',' + n(cy - 1.5) + ' Q' + n(cx - 0.46) + ',' + n(cy - 0.75) + ' ' + n(cx) + ',' + n(cy) +
        ' Q' + n(cx + 0.46) + ',' + n(cy + 0.75) + ' ' + n(cx) + ',' + n(cy + 1.5), { c: '#000', w: LW.sym }));
    } else if (kind === 'prio') {
      // залитый полукруг (клапан приоритета бойлера)
      o.push(path('M' + n(cx) + ',' + n(cy - 1.5) + ' A1.5,1.5 0 0 0 ' + n(cx) + ',' + n(cy + 1.5) + ' Z',
        { f: '#000', c: '#000', w: LW.sym }));
    }
    return o.join('');
  }

  /** Предохранительный клапан: вход сбоку, сброс вниз, пружина-рычаг.
   *  (x,y) — центр шарика; mirror — вход слева (пружина справа). */
  function safetyValve(x, y, mirror) {
    var m = mirror ? -1 : 1;
    function pt(u, v) { return [x + m * u, y + v]; }
    var o = [];
    o.push(pline([pt(-1.5, 2.5), pt(1.5, 2.5)]));
    o.push(pline([pt(1.5, 2.5), pt(0.41, 0.68)]));
    o.push(pline([pt(-0.41, 0.68), pt(-1.5, 2.5)]));
    o.push(pline([pt(2.5, 1.5), pt(2.5, -1.5)]));
    o.push(pline([pt(2.5, 1.5), pt(0.68, 0.41)]));
    o.push(pline([pt(0.68, -0.41), pt(2.5, -1.5)]));
    o.push(circle(x, y, 0.82));
    o.push(pline([pt(-0.82, 0), pt(-1.76, 0), pt(-1.76, -0.83), pt(-2.42, 0.55),
      pt(-2.8, -0.23), pt(-3.69, -0.23)]));
    return o.join('');
  }

  /** Автоматический воздухоотводчик. (x,y) — точка посадки (низ ножки). */
  function airVent(x, y) {
    var o = [];
    o.push(pline([[x, y], [x, y - 1.26]]));
    o.push(pline([[x - 1, y - 1.26], [x + 1, y - 1.26]]));
    o.push(pline([[x - 1, y - 4.1], [x + 1, y - 4.1]]));
    o.push(pline([[x - 1, y - 1.26], [x - 1, y - 4.1]]));
    o.push(pline([[x + 1, y - 1.26], [x + 1, y - 4.1]]));
    o.push(pline([[x, y - 4.1], [x, y - 5.04]]));
    o.push(pline([[x - 1.5, y - 5.04], [x + 1.5, y - 5.04]]));
    o.push(pline([[x - 1.5, y - 5.04], [x, y - 7.54]]));
    o.push(pline([[x + 1.5, y - 5.04], [x, y - 7.54]]));
    return o.join('');
  }

  /** Термометр / манометр: круг r2 с буквой. */
  function gauge(x, y, letter) {
    return circle(x, y, 2) + txt(x, y + 1.28, letter, { size: SZ.txt, anchor: 'middle' });
  }

  /** Фильтр: ромб (полудиагональ 3.53), пунктирная ось горизонтальна. */
  function filterSym(x, y) {
    var r = 3.53, o = [];
    o.push(pline([[x, y - r], [x + r, y], [x, y + r], [x - r, y], [x, y - r]]));
    o.push(pline([[x - r, y], [x - r + 1.54, y]]));
    o.push(pline([[x - 1, y], [x + 1, y]]));
    o.push(pline([[x + r - 1.53, y], [x + r, y]]));
    return o.join('');
  }

  /** Сепаратор воздуха. Своего УГО у него в ГОСТ 21.205 нет, поэтому
   *  собираем из двух штатных ровно так, как устроен сам аппарат: корпус с
   *  сетчатой насадкой (ромб фильтра) плюс автоматический воздухоотводчик на
   *  патрубке 1/2" сверху. Патрубок выходит из ГРАНИ ромба наискось, а не из
   *  трубы — иначе картинка читалась бы как «фильтр, а рядом отдельный
   *  воздушник». (x,y) — центр корпуса на трубе. */
  function airSep(x, y) {
    var o = [];
    o.push(filterSym(x, y));
    o.push(pline([[x + 1.77, y - 1.77], [x + 3.6, y - 3.6]]));
    o.push(airVent(x + 3.6, y - 3.6));
    return o.join('');
  }

  /** Соединительное устройство для расширительного бака (символ легенды). */
  function expConn(x, y) {
    return path('M' + n(x - 1.25) + ',' + n(y - 1.9) + ' Q' + n(x) + ',' + n(y + 0.6) + ' ' + n(x + 1.25) + ',' + n(y - 1.9),
      { c: '#000', w: LW.sym }) +
      path('M' + n(x - 1.25) + ',' + n(y + 2.1) + ' Q' + n(x) + ',' + n(y - 0.4) + ' ' + n(x + 1.25) + ',' + n(y + 2.1),
        { c: '#000', w: LW.sym });
  }

  /** Группа безопасности котла. (x,y) — точка посадки на трубу (низ ножки).
   *  Офсеты сняты с УГО легенды (якорь оригинала 32.07,193.35). */
  function safetyGroup(x, y) {
    var dx = x - 32.07, dy = y - 193.35, o = [];
    function L(a, b, c, d) { o.push(pline([[a + dx, b + dy], [c + dx, d + dy]])); }
    L(32.07, 193.35, 32.07, 191.09);
    L(28.74, 191.09, 35.39, 191.09);
    L(28.74, 191.09, 28.74, 189.62);
    L(32.07, 191.09, 32.07, 189.57);
    o.push(gauge(32.07 + dx, 187.57 + dy, 'P'));
    L(35.39, 191.09, 35.39, 189.83);
    L(34.39, 189.83, 36.39, 189.83); L(34.39, 186.99, 36.39, 186.99);
    L(34.39, 186.99, 34.39, 189.83); L(36.39, 186.99, 36.39, 189.83);
    L(35.39, 186.99, 35.39, 186.05);
    L(33.89, 186.05, 36.89, 186.05); L(33.89, 186.05, 35.39, 183.55); L(36.89, 186.05, 35.39, 183.55);
    L(27.24, 189.62, 30.24, 189.62);
    L(26.24, 188.62, 26.24, 185.62);
    L(26.24, 188.62, 28.05, 187.53); L(27.24, 189.62, 28.32, 187.81);
    L(28.05, 186.7, 26.24, 185.62); L(29.15, 187.81, 30.24, 189.62);
    o.push(circle(28.6 + dx, 187.13 + dy, 0.82));
    L(28.74, 186.31, 28.74, 185.37); L(28.74, 185.37, 29.57, 185.37);
    L(29.57, 185.37, 28.19, 184.71); L(28.19, 184.71, 28.98, 184.33); L(28.98, 184.33, 28.98, 183.44);
    return o.join('');
  }

  /** Выноска размера: наклонная + полочка + текст. (ax,ay) — точка старта
   *  на арматуре. Геометрия снята с выносок 3/4" листа ТМ-2. */
  function leader(ax, ay, size) {
    // Полка длиной с саму надпись. Раньше она была всегда 4.32 мм, и длинные
    // размеры («1 1/4"») вылезали за неё вправо — на стояк, к которому
    // выноска и относится, а при сжатом шаге отводов и на соседний.
    var shelf = Math.max(4.32, textW(size, SZ.dia) + 0.5);
    return pline([[ax, ay], [ax - 1.06, ay - 1.06]], { w: LW.thin }) +
      pline([[ax - 1.06, ay - 1.06], [ax - shelf, ay - 1.06]], { w: LW.thin }) +
      txtM(ax - shelf + 0.14, ay - 1.48, size, { size: SZ.dia });
  }
  /** Выноска у вертикального крана с центром (vx,vy). */
  function leaderValve(vx, vy, size) { return leader(vx - 0.96, vy + 1.6, size); }
  /** Выноска у вертикального обратного клапана. Полка заводится СВЕРХУ:
   *  снизу у символа упор-скобка, и обычная выноска ложилась прямо на неё. */
  function leaderCheck(vx, vy, size) { return leader(vx - 0.96, vy - 2.6, size); }
  /** Выноска у фильтра с центром (fx,fy). */
  function leaderFilter(fx, fy, size) { return leader(fx - 0.96, fy - 1.77, size); }

  /** Гидравлический разделитель для схемы. (x,y) — центр корпуса 9×20.
   *  buf = { vol } — на его месте буферная ёмкость: те же подключения (воздухоотводчик сверху,
   *  дренаж снизу, термометр слева), корпус скруглён, внутри объём в литрах вместо кВт. */
  function hydroSep(x, y, kw, noThermo, buf) {
    var w = 9, h = 20, o = [];
    o.push(rrect(x - w / 2, y - h / 2, w, h, buf ? 2.6 : 1, { c: '#000', w: LW.sym }));
    if (buf) {
      o.push(txt(x, y - 0.6, String(buf.vol), { size: SZ.txt, anchor: 'middle' }));
      o.push(txt(x, y + 3.4, 'л', { size: SZ.txt, anchor: 'middle' }));
    } else if (kw) {
      o.push(txt(x, y - 0.6, String(kw), { size: SZ.txt, anchor: 'middle' }));
      o.push(txt(x, y + 3.4, 'кВт', { size: SZ.txt, anchor: 'middle' }));
    }
    o.push(pline([[x, y - h / 2], [x, y - h / 2 - 1.5]]));
    o.push(airVent(x, y - h / 2 - 1.5));
    o.push(leader(x - 0.9, y - h / 2 - 5.5, '1/2"'));
    o.push(pline([[x, y + h / 2], [x, y + h / 2 + 1.2]]));
    o.push(ballValve(x, y + h / 2 + 3.7, true));
    o.push(leaderValve(x, y + h / 2 + 3.7, '1/2"'));
    o.push(pline([[x - 0.92, y + h / 2 + 7.05], [x + 0.92, y + h / 2 + 7.05]]));
    o.push(pline([[x - 0.92, y + h / 2 + 7.05], [x, y + h / 2 + 8.58]]));
    o.push(pline([[x + 0.92, y + h / 2 + 7.05], [x, y + h / 2 + 8.58]]));
    // Контрольный термометр на боковом штуцере G 1/2" (паспорт «Гидравлический
    // разделитель», ред. 3 от 17.05.2021, п. 3.1 — третий штуцер узла). Влево:
    // справа корпус зажат стояками вторичной пары, а слева на уровне середины
    // корпуса свободно — горизонтали к насосным группам идут выше и ниже.
    // У коллектора со встроенным разделителем SDG-0018 гнёзд G 1/2" два — под
    // воздухоотводчик и слив (паспорт, ред. 30.03.2023, п. 5 и 4.3.6), термометру
    // места нет, и в смете его тогда нет (cfg.hydro.thermo === false).
    if (!noThermo) {
      o.push(pline([[x - w / 2, y], [x - w / 2 - 2.2, y]]));
      o.push(gauge(x - w / 2 - 4.2, y, 'Т'));
    }
    return o.join('');
  }

  /** Расширительный бак. (x,y) — точка подключения снизу.
   *  Корпус 15.2×21.7, все уровни сняты с бака «18 л.» листа ТМ-2. */
  /** Пластинчатый теплообменник: прямоугольник с зигзагом внутри.
   *  Патрубки по углам — первичный контур сверху, вторичный снизу.
   *  (x0,x1) — оси стояков пары, они же оси патрубков. */
  function plateHx(x0, x1, yTop, yBot) {
    var o = [];
    var pad = 2, L = Math.min(x0, x1) - pad, R = Math.max(x0, x1) + pad;
    o.push(rrect(L, yTop, R - L, yBot - yTop, 0.4, { f: '#fff', c: '#000', w: LW.sym }));
    // Зигзаг между патрубками — условное изображение пакета пластин.
    var m = (yTop + yBot) / 2, q = (yBot - yTop) / 4;
    o.push(pline([[L + 1.2, m - q], [R - 1.2, m - q * 0.2], [L + 1.2, m + q * 0.2], [R - 1.2, m + q]],
      { w: LW.sym }));
    return o.join('');
  }

  function expTank(x, y, color, vol) {
    var o = [];
    var d = 'M' + n(x - 7.62) + ',' + n(y - 17.01) +
      ' L' + n(x - 7.62) + ',' + n(y - 4.1) +
      ' Q' + n(x - 7.5) + ',' + n(y - 2.9) + ' ' + n(x - 6.6) + ',' + n(y - 2.35) +
      ' L' + n(x - 3.15) + ',' + n(y - 0.51) +
      ' L' + n(x + 3.15) + ',' + n(y - 0.51) +
      ' L' + n(x + 6.6) + ',' + n(y - 2.35) +
      ' Q' + n(x + 7.5) + ',' + n(y - 2.9) + ' ' + n(x + 7.62) + ',' + n(y - 4.1) +
      ' L' + n(x + 7.62) + ',' + n(y - 17.01) +
      ' Q' + n(x + 7.6) + ',' + n(y - 18.5) + ' ' + n(x + 6.7) + ',' + n(y - 19.2) +
      ' Q' + n(x + 3.6) + ',' + n(y - 20.25) + ' ' + n(x) + ',' + n(y - 20.45) +
      ' Q' + n(x - 3.6) + ',' + n(y - 20.25) + ' ' + n(x - 6.7) + ',' + n(y - 19.2) +
      ' Q' + n(x - 7.6) + ',' + n(y - 18.5) + ' ' + n(x - 7.62) + ',' + n(y - 17.01) + ' Z';
    o.push(path(d, { f: color, c: '#000', w: LW.thin }));
    o.push(pline([[x - 1.67, y - 20.34], [x - 0.54, y - 21.73], [x + 0.54, y - 21.73], [x + 1.67, y - 20.34]],
      { f: GREY.body, c: '#000', w: LW.thin, close: true }));
    o.push(rrect(x - 3.76, y - 0.51, 7.52, 0.51, 0.25, { f: GREY.body, c: '#000', w: LW.thin }));
    if (vol) {
      o.push(txt(x, y - 11.17, vol, { size: SZ.txt, anchor: 'middle' }));
      o.push(pline([[x - 6.57, y - 10.33], [x + 6.57, y - 10.33]], { w: LW.thin }));
    }
    return o.join('');
  }

  /** Котёл (газовый/электрический). (x,y) — левый верхний угол корпуса.
   *  w — ширина корпуса: 33 как в эталоне, 27 — компактный блок каскада. */
  function boilerUnit(x, y, kind, w) {
    w = w || 33;
    var h = 58, o = [];
    if (kind === 'gas') o.push(rrect(x + w / 2 - 5, y - 5, 10, 6, 1.5, { f: GREY.body, c: GREY.edge, w: 0.6 }));
    else o.push(rrect(x + w / 2 - 3.5, y - 2.5, 7, 3.5, 1, { f: GREY.body, c: GREY.edge, w: 0.6 }));
    o.push(rrect(x, y, w, h, 2, { f: GREY.body, c: GREY.edge, w: 0.6 }));
    o.push(pline([[x, y + 2], [x + w, y + 2]], { c: GREY.edge, w: 0.6 }));
    // Подпись держим внутри корпуса: у компактного блока каскада (w 27) она
    // иначе выходит за края и встречается с подписью соседнего котла.
    // Ужимаем только когда не влезает — на эталонном блоке 33 мм textLength
    // растянул бы её по всей ширине.
    var cap = kind === 'gas' ? 'Газовый котёл' : 'Электрический котёл';
    var capOpt = { size: SZ.txt, anchor: 'middle' };
    if (textW(cap, SZ.txt) > w - 4) capOpt.fit = w - 4;
    o.push(txt(x + w / 2, y + 7.9, cap, capOpt));
    var cx = x + w / 2, cy = y + 27;
    o.push(circle(cx, cy, 7.2, { f: GREY.icon }));
    if (kind === 'gas') {
      // язык пламени: острый хвост вверху, круглое основание, внутренний язычок
      o.push(path('M' + n(cx + 0.4) + ',' + n(cy - 4.8) +
        ' C' + n(cx + 0.6) + ',' + n(cy - 2.6) + ' ' + n(cx + 3.4) + ',' + n(cy - 1.6) + ' ' + n(cx + 3.4) + ',' + n(cy + 1.2) +
        ' C' + n(cx + 3.4) + ',' + n(cy + 3.5) + ' ' + n(cx + 1.9) + ',' + n(cy + 4.9) + ' ' + n(cx) + ',' + n(cy + 4.9) +
        ' C' + n(cx - 1.9) + ',' + n(cy + 4.9) + ' ' + n(cx - 3.4) + ',' + n(cy + 3.5) + ' ' + n(cx - 3.4) + ',' + n(cy + 1.2) +
        ' C' + n(cx - 3.4) + ',' + n(cy - 1.2) + ' ' + n(cx - 1.3) + ',' + n(cy - 2.2) + ' ' + n(cx - 1.9) + ',' + n(cy - 3.9) +
        ' C' + n(cx - 0.9) + ',' + n(cy - 3.6) + ' ' + n(cx - 0.1) + ',' + n(cy - 4) + ' ' + n(cx + 0.4) + ',' + n(cy - 4.8) + ' Z' +
        ' M' + n(cx) + ',' + n(cy + 3.6) +
        ' C' + n(cx + 1.1) + ',' + n(cy + 3.6) + ' ' + n(cx + 1.9) + ',' + n(cy + 2.7) + ' ' + n(cx + 1.9) + ',' + n(cy + 1.7) +
        ' C' + n(cx + 1.9) + ',' + n(cy + 0.9) + ' ' + n(cx + 1.3) + ',' + n(cy + 0.3) + ' ' + n(cx + 0.8) + ',' + n(cy - 0.3) +
        ' C' + n(cx + 0.5) + ',' + n(cy + 0.7) + ' ' + n(cx - 0.6) + ',' + n(cy + 1) + ' ' + n(cx - 1.1) + ',' + n(cy + 0.4) +
        ' C' + n(cx - 1.7) + ',' + n(cy + 1.1) + ' ' + n(cx - 1.9) + ',' + n(cy + 1.8) + ' ' + n(cx - 1.9) + ',' + n(cy + 2.2) +
        ' C' + n(cx - 1.9) + ',' + n(cy + 2.9) + ' ' + n(cx - 1) + ',' + n(cy + 3.6) + ' ' + n(cx) + ',' + n(cy + 3.6) + ' Z',
        { f: '#fff' }));
    } else {
      o.push(rrect(cx - 2.2, cy - 4.9, 1.15, 3.2, 0.55, { f: '#fff' }));
      o.push(rrect(cx + 1.05, cy - 4.9, 1.15, 3.2, 0.55, { f: '#fff' }));
      o.push(path('M' + n(cx - 3.1) + ',' + n(cy - 1.9) + ' L' + n(cx + 3.1) + ',' + n(cy - 1.9) +
        ' L' + n(cx + 3.1) + ',' + n(cy + 0.6) +
        ' Q' + n(cx + 3.1) + ',' + n(cy + 3.4) + ' ' + n(cx) + ',' + n(cy + 3.4) +
        ' Q' + n(cx - 3.1) + ',' + n(cy + 3.4) + ' ' + n(cx - 3.1) + ',' + n(cy + 0.6) + ' Z', { f: '#fff' }));
      o.push(rrect(cx - 0.55, cy + 3.4, 1.1, 1.9, 0.5, { f: '#fff' }));
    }
    o.push(rrect(x + w / 2 - 6, y + h - 11.5, 12, 4.5, 1.5, { f: '#fff', c: GREY.edge, w: 0.35 }));
    return o.join('');
  }

  /** Бойлер косвенного нагрева. (x,y) — левый верхний угол корпуса.
   *  Напольный 52×84; настенный вариант — тот же рисунок компактнее. */
  function indirectTank(x, y, w, h) {
    var o = [];
    o.push(rrect(x, y, w, h, 5, { f: GREY.body, c: GREY.edge, w: 0.6 }));
    o.push(txt(x + w / 2, y + 6.4, 'Бойлер косвенного нагрева', { size: SZ.txt, anchor: 'middle', fit: w - 3 }));
    var cy = y + h * 0.42, R = Math.min(19, h * 0.26);
    o.push(path('M' + n(x) + ',' + n(cy - R) + ' A' + n(R) + ',' + n(R) + ' 0 0 1 ' + n(x) + ',' + n(cy + R) + ' Z', { f: '#fff' }));
    // Змеевик — свой символ: у него своя подсказка (в нём почти всё
    // сопротивление контура загрузки) и своя строка в карточке.
    o.push('<g data-sym="coil" data-sym-name="Змеевик бойлера">');
    var loops = h > 70 ? 7 : 5;
    for (var i = 0; i < loops; i++) {
      var t = i / (loops - 1);
      var yy = cy - R + 3.2 + t * (2 * R - 6.4);
      var half = Math.sqrt(Math.max(0, R * R - (yy - cy) * (yy - cy))) - 1.6;
      var col = t < 0.5 ? COL.loadS : COL.loadR;
      o.push('<line x1="' + n(x + 0.8) + '" y1="' + n(yy) + '" x2="' + n(x + 0.8 + Math.max(4, half)) + '" y2="' + n(yy) +
        '" style="stroke:' + col + ';stroke-width:2;opacity:' + n(0.55 + 0.45 * Math.abs(1 - 2 * t)) + '" stroke-linecap="round"/>');
    }
    o.push('</g>');
    o.push(circle(x + w * 0.62, y + h * 0.42, 3.2, { f: '#555' }));
    o.push(circle(x + w * 0.5, y + h * 0.78, 4.6, { f: '#555' }));
    return o.join('');
  }

  /** Цветной патрубок-пилюля на кромке бойлера + марка. */
  function tankPort(x, y, color, mark) {
    return rrect(x - 1.5, y - 1.5, 3, 3, 1.5, { f: color, c: '#000', w: LW.thin }) +
      (mark ? txtM(x + 2.6, y + 1.25, mark, { size: SZ.txt }) : '');
  }

  /** Стрелка-«ласточкин хвост» на трубе. (x,y) — остриё. dir: 'down'|'up'. */
  function arrowSym(x, y, dir) {
    var s = dir === 'up' ? -1 : 1;
    return pline([[x, y], [x - 1.08, y - s * 3.14], [x, y - s * 2.68], [x + 1.08, y - s * 3.14]],
      { f: GREY.body, c: '#000', w: LW.sym, close: true });
  }

  /** Контурный наконечник на горизонтальной линии. dir — куда показывает. */
  function openArrow(x, y, dir, color) {
    var s = dir === 'left' ? -1 : 1;
    return pline([[x - s * 2.6, y - 1], [x, y]], { c: color, w: LW.pipe }) +
      pline([[x - s * 2.6, y + 1], [x, y]], { c: color, w: LW.pipe });
  }

  /** Торцевой штрих на конце линии (3 мм поперёк). */
  function tick(x, y, vert, color) {
    return vert ? ln(x - 1.5, y, x + 1.5, y, { c: color, w: LW.pipe })
      : ln(x, y - 1.5, x, y + 1.5, { c: color, w: LW.pipe });
  }

  /** Подпись диаметра вдоль вертикальной трубы (низ текста в (x-1, y)). */
  function diaV(x, y, dia) {
    return txtM(x - 1, y, dia, { size: SZ.dia, rotate: -90 });
  }
  /** Подпись диаметра над горизонтальной трубой, у правого конца. */
  function diaH(xRight, y, dia) {
    return txtM(xRight - textW(dia, SZ.dia) - 0.4, y - 0.7, dia, { size: SZ.dia });
  }

  /** Низ отвода после крана: чёрная линия-указатель, марка, стрелка.
   *  Геометрия обмерена: стрелка «вверх» — остриё 262.28 под краном,
   *  линия от хвоста до 274; «вниз» — линия от 262.28, остриё на 274. */
  function bottomMark(x, mark, dir) {
    var o = [];
    if (dir === 'up') {
      o.push(ln(x, 264.96, x, 274.0, { w: LW.pipe }));
      o.push(arrowSym(x, 262.28, 'up'));
    } else {
      o.push(ln(x, 262.28, x, 271.31, { w: LW.pipe }));
      o.push(arrowSym(x, 274.0, 'down'));
    }
    o.push(txtM(x - 2, 270.2, mark, { size: SZ.txt, rotate: -90 }));
    return o.join('');
  }

  /** Вертикальная труба с обходами-полукругами (r 2, выпуклость вправо)
   *  на пересечениях с горизонталями crossYs (соединения не обходятся). */
  function vpipe(x, y0, y1, color, crossYs) {
    if (y1 < y0) { var t = y0; y0 = y1; y1 = t; }
    var ys = (crossYs || []).filter(function (cy) { return cy > y0 + 2 && cy < y1 - 2; })
      .sort(function (a, b) { return a - b; });
    var d = 'M' + n(x) + ',' + n(y0);
    ys.forEach(function (cy) {
      d += ' L' + n(x) + ',' + n(cy - 2) + ' A2,2 0 0 1 ' + n(x) + ',' + n(cy + 2);
    });
    d += ' L' + n(x) + ',' + n(y1);
    return path(d, { c: color, w: LW.pipe });
  }

  function hpipe(x0, x1, y, color) {
    return ln(x0, y, x1, y, { c: color, w: LW.pipe });
  }

  // ─── Имена символов для подсказок на экране ────────────────────────────
  // Каждый символ заворачивается в <g data-sym="тип" data-sym-name="имя">:
  // по наведению подсказка называет элемент и объясняет, зачем он здесь, а
  // по клику даёт карточку. На чертёж обёртка не влияет — ни на печать, ни
  // на геометрию. Имя может зависеть от аргументов (valve3, gauge, котёл).
  // Заворачиваются и символы легенды — там подсказка тоже уместна.
  function sym(fn, type, name) {
    return function () {
      var out = fn.apply(null, arguments);
      var nm = typeof name === 'function' ? name.apply(null, arguments) : name;
      return '<g data-sym="' + type + '" data-sym-name="' + nm + '">' + out + '</g>';
    };
  }
  indirectTank = sym(indirectTank, 'tank', 'Бойлер косвенного нагрева');
  ballValve = sym(ballValve, 'valve', 'Шаровой кран');
  checkValve = sym(checkValve, 'check', 'Обратный клапан');
  pump = sym(pump, 'pump', 'Циркуляционный насос');
  valve3 = sym(valve3, 'valve3', function (x, y, kind) {
    return kind === 'prio' ? 'Клапан приоритета бойлера'
      : kind === 'servo' ? 'Смесительный клапан с сервоприводом'
        : 'Термостатический смесительный клапан';
  });
  safetyValve = sym(safetyValve, 'safety', 'Предохранительный клапан');
  airVent = sym(airVent, 'airvent', 'Автоматический воздухоотводчик');
  gauge = sym(gauge, 'gauge', function (x, y, letter) {
    return letter === 'М' ? 'Манометр' : 'Термометр / датчик температуры';
  });
  filterSym = sym(filterSym, 'filter', 'Фильтр-грязевик');
  airSep = sym(airSep, 'airsep', 'Сепаратор воздуха');
  safetyGroup = sym(safetyGroup, 'safetygroup', 'Группа безопасности котла');
  hydroSep = sym(hydroSep, 'hydro', function (x, y, kw, nt, buf) {
    return buf ? 'Буферная ёмкость' : 'Гидравлический разделитель';
  });
  expTank = sym(expTank, 'exptank', 'Расширительный бак');
  boilerUnit = sym(boilerUnit, 'boiler', function (x, y, kind) {
    return kind === 'gas' ? 'Газовый котёл' : 'Электрический котёл';
  });

  // ─── Таблица «Условные графические обозначения» ────────────────────────
  // Легенда фильтруется по составу конкретной схемы: символ, которого на
  // листе нет, в таблицу не попадает (раньше монтажник искал на схеме
  // термометры и группу безопасности, которых там не было никогда).
  // Высота рамки от этого плавает — низ считается по факту.
  function legendTable(cfg) {
    cfg = cfg || {};
    var L = 25.07, R = 127.65, S = 39.07, top = 12.35, o = [];
    var cx = (L + S) / 2, tx = (S + R) / 2;
    var twoC = !!(cfg.gas && cfg.gas.circuits === 2 && !cfg.indirect);
    var nBoilers = (cfg.gas ? Math.max(1, cfg.gas.count || 1) : 0) +
      (cfg.el ? Math.max(1, cfg.el.count || 1) : 0);
    var usePump = !!(cfg.tp || cfg.snow || cfg.hydro || cfg.recirc || cfg.loadPump || (cfg.el && cfg.el.polis));
    var useCheck = !!(nBoilers > 1 || cfg.indirect || cfg.tp || cfg.snow || cfg.hydro || cfg.recirc);

    // При автоматике узел ТП ведёт контроллер: смеситель с сервоприводом
    // вместо термостатического, плюс на схеме появляются датчики NTC
    var mixServo = !!(cfg.auto && cfg.auto.mixServo);
    var rows = [
      ['Шаровый кран', function (c) { return ballValve(cx, c, false); }, true],
      ['Обратный клапан', function (c) { return checkValve(cx, c, 'right'); }, useCheck],
      ['Циркуляционный насос', function (c) { return pump(cx, c, 'left'); }, usePump],
      ['Термостатический смесительный клапан', function (c) { return valve3(cx + 1.21, c, 'therm', 'udr', 'l'); }, (!!cfg.tp || !!cfg.snow || !!cfg.dhwMix) && !mixServo],
      ['Клапан трехходовой с сервоприводом', function (c) { return valve3(cx + 1.21, c, 'servo', 'udr', 'l'); }, (!!cfg.tp || !!cfg.snow) && mixServo],
      ['Предохранительный клапан', function (c) { return safetyValve(cx, c, false); }, (!!cfg.indirect && cfg.water !== false) || !!cfg.snow],
      ['Автоматический воздухоотводчик', function (c) { return airVent(cx, c + 3.77); }, !!cfg.hydro || !!cfg.airSep],
      ['Фильтр', function (c) { return filterSym(cx, c); }, true],
      ['Клапан приоритета бойлера', function (c) { return valve3(cx + 1.21, c, 'prio', 'udr', 'l'); }, !!cfg.fugas],
      ['Датчик температуры NTC (в гильзе)', function (c) { return gauge(cx, c, 'Т'); }, !!cfg.auto]
    ].filter(function (r) { return r[2]; });

    var marks = [
      ['Т1', 'Подача радиаторного отопления', cfg.rad !== false],
      ['Т2', 'Обратка радиаторного отопления', cfg.rad !== false],
      ['Т11', 'Подача напольного отопления', !!cfg.tp],
      ['Т21', 'Обратка напольного отопления', !!cfg.tp],
      ['В1', 'Холодное водоснабжение', twoC || !!cfg.water || !!cfg.indirect],
      ['Т3', 'Горячее водоснабжение', twoC || !!cfg.indirect],
      ['Т4', 'Рециркуляция горячего водоснабжения', !!cfg.recirc],
      ['Т12', 'Подача на узел снеготаяния', !!cfg.snow],
      ['Т22', 'Обратка от узла снеготаяния', !!cfg.snow]
    ].filter(function (m) { return m[2]; });

    var bottom = 22.35 + rows.length * 10 + (cfg.airSep ? 16 : 0) + (cfg.hydro ? 40 : 0) + marks.length * 6;
    o.push(pline([[L, top], [R, top], [R, bottom], [L, bottom], [L, top]]));
    o.push(ln(S, 22.35, S, bottom));
    o.push(txt((L + R) / 2, 19.05, 'Условные графические обозначения', { size: SZ.head, anchor: 'middle' }));
    o.push(ln(L, 22.35, R, 22.35));

    var y = 22.35;
    rows.forEach(function (r) {
      var y1 = y + 10, c = (y + y1) / 2;
      o.push(r[1](c));
      o.push(txt(tx, c + SZ.txt * 0.35, r[0], { size: SZ.txt, anchor: 'middle' }));
      o.push(ln(L, y1, R, y1));
      y = y1;
    });

    // сепаратор воздуха — своя ячейка 16 мм: воздухоотводчик поднимает символ
    // выше строки в 10 мм, и в общем ряду он лёг бы на соседа сверху
    if (cfg.airSep) {
      var sy0 = y, sy1 = y + 16;
      o.push(airSep(cx, sy1 - 4));
      o.push(txt(tx, (sy0 + sy1) / 2 + SZ.txt * 0.35, 'Сепаратор воздуха', { size: SZ.txt, anchor: 'middle' }));
      o.push(ln(L, sy1, R, sy1));
      y = sy1;
    }

    // гидравлический разделитель — ячейка 40 мм, символ по обмеру легенды
    if (cfg.hydro) {
      var hy0 = y, hy1 = y + 40;
      var bx = cx, bw = 8.3, bt = hy0 + 11.3, bb = hy1 - 12.7;
      o.push(airVent(bx, bt - 1.37));
      o.push(pline([[bx - 1.31, bt - 1.37], [bx - 1.31, bt]]));
      o.push(pline([[bx + 1.3, bt - 1.37], [bx + 1.3, bt]]));
      o.push(rrect(bx - bw / 2, bt, bw, bb - bt, cfg.hydro.buffer ? 2 : 0.4, { c: '#000', w: LW.sym }));
      o.push(pline([[bx - 1.31, bb], [bx - 1.31, bb + 1.37]]));
      o.push(pline([[bx + 1.3, bb], [bx + 1.3, bb + 1.37]]));
      o.push(pline([[bx - 1.31, bb + 1.37], [bx + 1.3, bb + 1.37]]));
      o.push(pline([[bx, bb + 1.37], [bx, bb + 2.57]]));
      o.push(ballValve(bx, bb + 5.07, true));
      o.push(pline([[bx - 0.92, bb + 8.61], [bx + 0.92, bb + 8.61]]));
      o.push(pline([[bx - 0.92, bb + 8.61], [bx, bb + 10.14]]));
      o.push(pline([[bx + 0.92, bb + 8.61], [bx, bb + 10.14]]));
      o.push(txt(tx, (hy0 + hy1) / 2 + SZ.txt * 0.35, cfg.hydro.buffer ? 'Буферная ёмкость' : 'Гидравлический разделитель', { size: SZ.txt, anchor: 'middle' }));
      o.push(ln(L, hy1, R, hy1));
      y = hy1;
    }

    marks.forEach(function (m) {
      var y1 = y + 6, c = (y + y1) / 2 + SZ.txt * 0.35;
      o.push(txt(cx, c, m[0], { size: SZ.txt, anchor: 'middle' }));
      o.push(txt(tx, c, m[1], { size: SZ.txt, anchor: 'middle' }));
      o.push(ln(L, y1, R, y1));
      y = y1;
    });
    return o.join('');
  }

  // ─── Легенда трубопроводов (низ листа, по составу схемы) ───────────────
  function pipeLegend(cfg) {
    cfg = cfg || {};
    var o = [];
    var twoC = !!(cfg.gas && cfg.gas.circuits === 2 && !cfg.indirect);
    var rows = [
      [COL.ret, 'обратный трубопровод', true],
      [COL.supply, 'подающий трубопровод', true],
      [COL.loadR, 'обратный трубопровод загрузки бойлера', !!cfg.indirect],
      [COL.loadS, 'подающий трубопровод загрузки бойлера', !!cfg.indirect],
      [COL.dhw, 'трубопровод горячего водоснабжения', twoC || !!cfg.indirect],
      [COL.recirc, 'трубопровод рециркуляции горячего водоснабжения', !!cfg.recirc],
      [COL.cold, 'трубопровод холодного водоснабжения', twoC || !!cfg.water || !!cfg.indirect],
    ].filter(function (r) { return r[2]; });
    // Штатно легенда занимает семь строк и упирается низом в 288,4 — дальше
    // внутренняя рамка листа (292). Со снеготаянием строк девять, и блок
    // поднимается ровно настолько, насколько не влезает: сжимать межстрочный
    // интервал под высоту шрифта нельзя — подписи слипнутся. Слева под котлами
    // это поле свободно, полосе отводов блок не мешает (см. TAP_X0_MIN).
    var top = 253.1 - Math.max(0, 258.4 + (rows.length - 1) * 5 - 290);
    o.push(txt(56.3, top, 'Условные обозначения трубопроводов', { size: SZ.head }));
    // Образец линии укоротили с 50 до 25 мм. Полоса отводов упирается влево
    // ровно в правый край этой таблицы, и полсотни миллиметров на образец
    // цвета — непозволительная роскошь: за счёт них насосные группы получают
    // штатный просвет вместо сжатого. Цвет по 25 мм читается так же.
    rows.forEach(function (r, i) {
      var y = top + 5.3 + i * 5;
      o.push(ln(28.2, y, 53.2, y, { c: r[0], w: LW.sample }));
      o.push(txt(59.7, y + 1.25, '-', { size: SZ.txt }));
      o.push(txt(62.7, y + 1.25, r[1], { size: SZ.txt }));
    });
    return o.join('');
  }

  /** Штриховая рамка узла заводской готовности. */
  function dashBox(x0, y0, x1, y1) {
    var c = { c: '#64748B', w: 0.35, dash: '1.8 1.4' };
    return ln(x0, y0, x1, y0, c) + ln(x1, y0, x1, y1, c) +
      ln(x1, y1, x0, y1, c) + ln(x0, y1, x0, y0, c);
  }

  /**
   * Схема узла снеготаяния — самостоятельный лист над разделом 4.4 сметы.
   *
   * На принципиальной схеме котельной снеготаяние показано одним смесительным
   * контуром Т12/Т22 со сноской: в полосе отводов между насосом первички и рядом
   * кранов 17 мм, и две заводские группы с теплообменником, группой безопасности
   * и баком туда не встают. Здесь у узла свой холст, и цепочка разворачивается
   * целиком: вход из котельной → смесительная группа → теплообменник → группа
   * вторичного контура → уличный коллектор с петлями.
   *
   * Состав групп — по паспортным схемам (SDG-0003 и SDG-0038 п. 3.1): со стороны
   * потребителя каждая группа снабжена шаровыми кранами, совмещёнными со
   * стрелочными термометрами, на возвратной линии кран совмещён с обратным
   * клапаном. Поэтому краны с термометрами нарисованы на границах обеих групп, а
   * не «подразумеваются».
   *
   * Раскладка идёт по сетке с явными колонками: подписи символов разведены по
   * трём уровням (над трубой, под трубой, вынос вверх), чтобы не пересекаться.
   */
  function snowScheme(sn) {
    if (!sn) return null;
    var o = [], W = 420, H = 214;
    var ys = 74, yr = 104;                   // оси подачи и обратки
    var bt = 52, bb = 124;                   // штриховые рамки групп
    var GL = sn.glycol, INKG = '#64748B', CARD = '#F8FAFC';

    // Узлов на объекте может быть несколько (расчёт делит контур, когда одному
    // насосу не хватает напора). Узлы одинаковые, поэтому чертёж один — но
    // подпись обязана сказать, что он один из нескольких, иначе по схеме
    // соберут половину системы.
    var NODES = Math.max(1, sn.nodes || 1);
    o.push(txt(W / 2, 14, NODES > 1 ? 'Схема узла снеготаяния (один из ' + NODES + ')' : 'Схема узла снеготаяния',
      { size: 6.2, anchor: 'middle' }));
    o.push(txt(W / 2, 21.6, sn.kw + ' кВт · площадка ' + sn.area + ' м² · ' + sn.loops +
      ' петель · вторичный контур — водный раствор пропиленгликоля ' + GL + ' %',
      { size: 3.1, anchor: 'middle' }));
    if (NODES > 1) {
      o.push(txt(W / 2, 26.4, 'узлов ' + NODES + ', узлы одинаковые' +
        (sn.loopsNode ? ' · на этом узле ' + sn.loopsNode + ' петель из ' + sn.loops : ''),
        { size: 3.1, anchor: 'middle' }));
    }

    /** Шаровой кран, совмещённый со стрелочным термометром (паспорт, поз. 2 и 4). */
    function valveTherm(x, y, up) {
      var dy = up ? -6.6 : 6.6;
      return ballValve(x, y, false) + ln(x, y + (up ? -2.6 : 2.6), x, y + dy * 0.72, { w: LW.thin }) +
        circle(x, y + dy, 2.5, { f: '#fff', c: '#000', w: 0.4 }) +
        pline([[x, y + dy], [x + 1.5, y + dy - 1.5]], { w: 0.35 });
    }

    // ── вход из котельной ───────────────────────────────────────────────
    var xin = 12, xg1 = 44, xg1e = 150;
    o.push(hpipe(xin, xg1, ys, COL.supply));
    o.push(hpipe(xin, xg1, yr, COL.ret));
    o.push(openArrow(xin + 6, ys, 'right', COL.supply));
    o.push(openArrow(xin + 6, yr, 'left', COL.ret));
    o.push(txtM(xin, ys - 4, 'Т12 · подача от коллектора', { size: 2.9 }));
    o.push(txtM(xin, yr + 7, 'Т22 · обратка в котельную', { size: 2.9 }));
    o.push(txtM(xin, yr + 12.4, 'см. принципиальную схему', { size: 2.4 }));

    // ── группа 1: смесительная, первичный контур ────────────────────────
    o.push(dashBox(xg1, bt, xg1e, bb));
    o.push(txt(xg1, bt - 3, 'Насосная группа со смесителем · первичный контур', { size: 3 }));
    o.push(hpipe(xg1, xg1e, ys, COL.supply));
    o.push(hpipe(xg1, xg1e, yr, COL.ret));
    o.push(valveTherm(xg1 + 12, ys, true));
    o.push(valveTherm(xg1 + 12, yr, false));
    var xmix = xg1 + 46;
    o.push(valve3(xmix, yr, sn.servo ? 'servo' : 'therm', 'lru', 'd'));
    o.push(ln(xmix, ys, xmix, yr - 2.5, { c: COL.supply, w: LW.pipe }));
    o.push(pump(xg1 + 84, ys, 'right'));
    o.push(txtM(xg1 + 74, ys - 8.4, 'насос', { size: 2.7 }));
    o.push(txtM(xmix - 16, yr + 15, sn.servo ? 'смеситель с сервоприводом' : 'термостатический смеситель', { size: 2.7 }));
    o.push(txtM(xg1 + 4, bb - 4, 'краны с термометрами', { size: 2.4 }));

    // ── группа 2: с теплообменником, вторичный контур ────────────────────
    var xg2 = xg1e + 10, xg2e = 296;
    o.push(dashBox(xg2, bt, xg2e, bb));
    o.push(txt(xg2, bt - 3, 'Насосная группа с теплообменником' +
      (sn.plates ? ' ' + sn.plates + ' пластин' : '') + ' · вторичный контур', { size: 3 }));
    o.push(hpipe(xg1e, xg2, ys, COL.supply));
    o.push(hpipe(xg1e, xg2, yr, COL.ret));

    // теплообменник: первичка слева, вторичка справа
    var hx0 = xg2 + 8, hx1 = hx0 + 28;
    o.push(hpipe(xg2, hx0, ys, COL.supply));
    o.push(hpipe(xg2, hx0, yr, COL.ret));
    o.push(rrect(hx0, ys - 10, hx1 - hx0, yr - ys + 20, 0.8, { f: '#fff', c: '#000', w: LW.sym }));
    var hm = (ys + yr) / 2, hq = (yr - ys) / 3;
    o.push(pline([[hx0 + 5, hm - hq], [hx1 - 5, hm - hq * 0.2],
    [hx0 + 5, hm + hq * 0.2], [hx1 - 5, hm + hq]], { w: LW.sym }));
    o.push(txtM(hx0 - 3, bb - 4, 'теплообменник пластинчатый', { size: 2.4 }));

    // вторичный контур: насос на подаче, кран с обратным клапаном на обратке
    o.push(hpipe(hx1, xg2e, ys, COL.snowS));
    o.push(hpipe(hx1, xg2e, yr, COL.snowR));
    var xp2 = hx1 + 22;
    o.push(pump(xp2, ys, 'right'));
    o.push(txtM(xp2 - 10, ys - 8.4, 'насос', { size: 2.7 }));
    o.push(checkValve(xp2, yr, 'left'));
    o.push(ballValve(xp2 + 9, yr, false));
    o.push(txtM(xp2 - 8, yr + 15, 'кран с обратным клапаном', { size: 2.7 }));
    // Датчик подачи и группа безопасности разведены по высоте: оба вынесены
    // вверх от подающей линии, но на разные уровни и с разных абсцисс.
    var xg = xp2 + 24, xsg = xp2 + 46;
    if (sn.auto) {
      o.push(ln(xg, ys, xg, ys - 6, { w: LW.thin }));
      o.push(gauge(xg, ys - 8.6, 'Т'));
      o.push(txtM(xg - 12, ys - 13.6, 'датчик подачи, ' + sn.supplyT + ' °C', { size: 2.4 }));
    }
    o.push(ln(xsg, ys, xsg, ys - 8, { c: COL.snowS, w: LW.pipe }));
    o.push(safetyValve(xsg, ys - 10.5, false));
    o.push(txtM(xsg - 14, ys - 20, 'группа безопасности, 3 бар', { size: 2.4 }));
    // расширительный бак — на обратке, ниже рамки группы
    if (sn.tank) {
      o.push(ln(xsg, yr, xsg, yr + 8, { c: COL.snowR, w: LW.pipe }));
      o.push(expTank(xsg, yr + 32, COL.snowR, sn.tank + ' л.'));
      o.push(txtM(xsg + 11, yr + 24, 'расширительный бак', { size: 2.4 }));
      o.push(txtM(xsg + 11, yr + 28.4, 'вторичного контура', { size: 2.4 }));
    }

    // ── уличный коллектор: карточка с расходомерами и петлями ───────────
    var mx0 = 306, mx1 = 410, yLoop = 168;
    o.push(rrect(mx0 - 4, bt, mx1 - mx0 + 8, 96, 3, { f: CARD, c: '#CBD5E1', w: 0.4 }));
    o.push(txt(mx0 - 2, bt - 3, 'Коллектор снеготаяния с расходомерами', { size: 3 }));
    o.push(hpipe(xg2e, mx0, ys, COL.snowS));
    o.push(hpipe(xg2e, mx0, yr, COL.snowR));
    o.push(rrect(mx0, ys - 3.4, mx1 - mx0, 6.8, 3.4, { f: '#fff', c: COL.snowS, w: 0.7 }));
    o.push(rrect(mx0, yr - 3.4, mx1 - mx0, 6.8, 3.4, { f: '#fff', c: COL.snowR, w: 0.7 }));

    // Петель рисуем не больше шести — дальше они сливаются в заливку; реальное
    // число подписано под площадкой.
    // Гребёнка здесь одного узла — значит и петли на ней его, а не всего объекта.
    var loopsNode = sn.loopsNode || sn.loops || 1;
    var nDraw = Math.min(loopsNode, 6);
    var span = (mx1 - mx0 - 10), step = span / nDraw;
    for (var i = 0; i < nDraw; i++) {
      var lx = mx0 + 5 + i * step + step * 0.18, rx2 = lx + step * 0.5;
      // расходомер на подающей гребёнке, запорный клапан на обратной
      o.push(rrect(lx - 1.6, ys + 3.4, 3.2, 5.2, 0.6, { f: '#fff', c: COL.snowS, w: 0.45 }));
      o.push(ln(lx, ys + 5, lx, ys + 7, { c: COL.snowS, w: 0.45 }));
      o.push(ln(lx, ys + 8.6, lx, yLoop - 5, { c: COL.snowS, w: LW.pipe }));
      o.push(ln(rx2, yr + 3.4, rx2, yLoop - 5, { c: COL.snowR, w: LW.pipe }));
      o.push(pline([[lx, yLoop - 5], [lx, yLoop], [rx2, yLoop], [rx2, yLoop - 5]], { c: COL.snowS, w: LW.pipe }));
    }
    // покрытие площадки
    o.push(rrect(mx0 - 4, yLoop + 5, mx1 - mx0 + 8, 8, 1, { f: '#EEF2F6', c: INKG, w: 0.4 }));
    for (var hxx = mx0 - 2; hxx < mx1 + 4; hxx += 7) o.push(ln(hxx, yLoop + 13, hxx + 4, yLoop + 6, { c: INKG, w: 0.3 }));
    o.push(txtM(mx0 - 4, yLoop + 19, 'петель ' + loopsNode + (NODES > 1 ? ' (на этом узле)' : '') +
      ' · труба ' + sn.dia + ' · шаг ' + sn.step + ' мм', { size: 2.6 }));
    if (loopsNode > nDraw) o.push(txtM(mx0 - 4, yLoop + 23.4, 'на схеме показано ' + nDraw, { size: 2.4 }));

    // ── легенда сред ────────────────────────────────────────────────────
    var lg = [[COL.supply, 'подача первичного контура — вода котельной'],
    [COL.ret, 'обратка первичного контура'],
    [COL.snowS, 'подача вторичного контура — пропиленгликоль ' + GL + ' %'],
    [COL.snowR, 'обратка вторичного контура']];
    lg.forEach(function (L, i) {
      var col = i % 2, rw = Math.floor(i / 2), xx = 14 + col * 152, yy = H - 16 + rw * 6.4;
      o.push(ln(xx, yy, xx + 14, yy, { c: L[0], w: 0.8 }));
      o.push(txt(xx + 17, yy + 1.2, L[1], { size: 2.8 }));
    });
    return { svg: o.join(''), w: W, h: H };
  }

  // ─── Композитор ────────────────────────────────────────────────────────
  /**
   * cfg: { gas: {circuits}|null, el: {}|null, indirect: {vol}|null,
   *        fugas, loadPump, rad, tp, hydro: {kw}|null, water, recirc,
   *        tankHeating: литры|0, tankDhw: литры|0, dia: 'Ø25х3,5 мм' }
   */
  function build(cfg) {
    cfg = cfg || {};
    // Контракт: клапан приоритета и насосная загрузка взаимоисключающие.
    // buildSchemeConfig оба флага из одного поля не выдаёт, но build() —
    // публичный, и при обоих true рисовались бы два разных узла сразу.
    if (cfg.fugas && cfg.loadPump) {
      cfg = { gas: cfg.gas, el: cfg.el, indirect: cfg.indirect, fugas: true, loadPump: false, rad: cfg.rad, tp: cfg.tp, hydro: cfg.hydro, water: cfg.water, recirc: cfg.recirc, tankHeating: cfg.tankHeating, tankDhw: cfg.tankDhw, dia: cfg.dia, sanDia: cfg.sanDia, recDia: cfg.recDia };
    }
    var o = [], dia = cfg.dia || 'Ø25х3,5 мм';
    // Санитарные линии (ГВС/ХВС) и рециркуляция — со своими диаметрами:
    // раньше на них ставился диаметр котловой магистрали, и рециркуляция
    // выходила «Ø40х5,5» при арматуре 1/2".
    var sanDia = cfg.sanDia || 'Ø22х1,2 мм';
    var recDia = cfg.recDia || 'Ø15х1,0 мм';
    // Резьба арматуры котлового контура и линий загрузки бойлера: 3/4" до
    // 30 кВт, 1" выше — тот же порог, по которому смета берёт переходники к
    // патрубкам котла и змеевика. Санитарные линии (В1/Т3/Т4) идут своими
    // размерами, к мощности котельной они не привязаны.
    var mainThread = cfg.mainThread || '3/4"';
    // Патрубки бойлера из его паспорта (cfg.tankPorts): змеевик, ГВС, ХВС,
    // рециркуляция, отдельный патрубок предохранительного клапана. У разных
    // серий они разные — арматуру у бака подписываем ими, а не размером
    // котловой магистрали. Без паспорта остаются прежние значения по умолчанию.
    var TP = cfg.tankPorts || {};
    var coilThread = TP.coil || mainThread;      // Т1/Т2 змеевика
    var dhwThread = TP.dhw || '3/4"';            // Т3 горячая вода
    var coldThread = TP.cold || '3/4"';          // В1 холодная вода
    var recircThread = TP.recirc || '1/2"';      // Т4 рециркуляция
    var safetyThread = TP.safety || '1/2"';      // предохранительный клапан
    var hasLoad = !!cfg.indirect;
    // Группа загрузки на коллекторе (насосная схема + гидрострелка) смотрит
    // ВНИЗ, как остальные группы: линии загрузки идут нижним полем листа,
    // а не поверху. Верхние линии загрузки остаются у фугаса и у узла на
    // магистрали без гидрострелки.
    var loadDown = hasLoad && !!cfg.loadPump && !!cfg.hydro;
    // уровни патрубков змеевика нужны раньше самого бойлера: по ним делают
    // обходы стояки, которые рисуются до него
    var wallT = !!(cfg.indirect && cfg.indirect.wall);
    var tYe = wallT ? 78 : 92, tHe = wallT ? 56 : 84;
    var pT1e = cfg.indirect ? tYe + tHe * 0.321 : 0;
    var pT2e = cfg.indirect ? tYe + tHe * 0.69 : 0;
    // Полосы линий загрузки под кранами отводов. Просвет между ними — тот же
    // шаг 9 мм, что между подачей и обраткой самой насосной группы.
    // Порядок полос обратный порядку стояков (левый стояк — дальняя полоса,
    // правый — ближняя), тогда спуски и подъёмы не пересекаются в принципе.
    var laneR = 272, laneS = 263;
    var twoCirc = !!(cfg.gas && cfg.gas.circuits === 2 && !hasLoad);

    // ── отводы коллектора и раскладка их полосы ────────────────────────────
    // Отводов столько, сколько насосных групп в спецификации (cfg.radGroups /
    // cfg.tpGroups). Контур без группы (местный узел подмеса, прямая обвязка
    // от котла) — один отвод, как раньше. Каждая группа занимает ПАРУ соседних
    // стояков «обратка + подача»: смесительной иначе некуда вести перемычку
    // подмеса, а по разнесённым Т2…Т1 не понять, какая пара чья.
    // Резьба арматуры — по DN самой группы: 3/4" у DN20, 1" у DN25, 1 1/4" у DN32.
    // Считается ДО раскладки котлов: при большом числе групп блоки котлов
    // сдвигаются влево, освобождая полосе место.
    var DN_THREAD = { 20: '3/4"', 25: '1"', 32: '1 1/4"' };
    function thread(dn) { return DN_THREAD[dn] || '3/4"'; }
    var radN = (cfg.rad !== false) ? Math.max(1, cfg.radGroups || 1) : 0;
    var tpN = cfg.tp ? Math.max(1, cfg.tpGroups || 1) : 0;
    // Номер в марке появляется только когда контуров больше одного: на схеме с
    // единственным контуром «Т1.1» читается как ошибка.
    function mk(base, i, n) { return n > 1 ? base + '.' + (i + 1) : base; }
    var taps = [];
    for (var ri = 0; ri < radN; ri++) {
      taps.push({ mark: mk('Т2', ri, radN), color: COL.ret, from: 'ret', dir: 'up', size: thread(cfg.radDn), hyd: 'rad', hydI: ri });
      taps.push({ mark: mk('Т1', ri, radN), color: COL.supply, from: 'supply', dir: 'down', group: !!cfg.hydro, size: thread(cfg.radDn), hyd: 'rad', hydI: ri });
    }
    var tpFrom = taps.length;
    for (var ti = 0; ti < tpN; ti++) {
      taps.push({ mark: mk('Т21', ti, tpN), color: COL.ret, from: 'ret', dir: 'up', mix: true, size: thread(cfg.tpDn), hyd: 'tp', hydI: ti });
      taps.push({ mark: mk('Т11', ti, tpN), color: COL.supply, from: 'supply', dir: 'down', pump: true, size: thread(cfg.tpDn), hyd: 'tp', hydI: ti });
    }
    // Группа загрузки бойлера — такой же отвод коллектора, как остальные:
    // тот же шаг, те же уровни арматуры. Отличие одно — внизу она не идёт
    // к потребителю с маркой, а уходит полосой к змеевику бойлера.
    if (loadDown) {
      taps.push({ color: COL.loadR, from: 'ret', load: 'ret', size: thread(cfg.loadDn) });
      taps.push({ color: COL.loadS, from: 'supply', load: 'sup', size: thread(cfg.loadDn) });
    }
    if (twoCirc) {
      taps.push({ mark: 'В1', color: COL.cold, from: 'cold', dir: 'up' });
      taps.push({ mark: 'Т3', color: COL.dhw, from: 'dhw', dir: 'down' });
    }
    // Снеготаяние — САМОЙ ПОСЛЕДНЕЙ парой в полосе: за ней справа встаёт
    // расширительный бак вторичного контура, а место под него есть только у
    // края полосы. Порядок стояков тот же, что у всех остальных групп —
    // обратка со смесителем слева, подача с насосом справа. Разворачивать её
    // зеркально нельзя: одна группа, собранная наоборот, читается как ошибка
    // монтажника, даже если геометрически так удобнее.
    // Снеготаяние на принципиальной схеме котельной — ОДИН смесительный контур,
    // как тёплый пол: всё, что за ним (теплообменник, вторичный контур на
    // гликоле, уличный коллектор), живёт на собственной схеме узла над разделом
    // 4.4 сметы. Здесь остаётся сноска, чтобы связь была видна.
    // Узлов снеготаяния может быть несколько: расчёт делит контур, когда одному
    // насосу не хватает напора. Первичка у них раздельная, значит и пар отводов
    // столько же — как у нескольких групп тёплого пола.
    if (cfg.snow) {
      var snowN = Math.max(1, cfg.snow.nodes || 1);
      for (var si = 0; si < snowN; si++) {
        // hyd: 'snow' — чтобы подсветка на экране знала контур. Зону карточки
        // на него не заводим (см. taps.forEach у зон): чисел узла на этой схеме
        // нет. Флаг t.snow не ставить — он включает старую ветку с HX_TOP.
        taps.push({ mark: mk('Т22', si, snowN), color: COL.ret, from: 'ret', dir: 'up', mix: true, size: thread(cfg.snow.dn), hyd: 'snow', hydI: si });
        taps.push({
          mark: mk('Т12', si, snowN), color: COL.supply, from: 'supply', dir: 'down', pump: true, size: thread(cfg.snow.dn),
          hyd: 'snow', hydI: si,
          note: snowN > 1 ? 'узел снеготаяния ' + (si + 1) + ' — см. схему' : 'узел снеготаяния — см. схему'
        });
      }
    }

    // Полоса отводов зажата между котлами слева и гидрострелкой справа: за её
    // правым концом встаёт стояк подачи загрузки (hydroX−17.5), сама стрелка и
    // канал стояков бойлера. При нижней разводке загрузки канал занят обраткой
    // змеевика — предел жёстче. Штатный шаг 9 мм снят с листа ТМ-2; ужимаем его
    // и сдвигаем котлы влево только когда групп больше, чем влезает.
    var TAP_X0_BASE = 235.13, TAP_STEP_BASE = 9;
    // Куда полоса может уехать ВЛЕВО.
    //   • С гидрострелкой отводы отходят от вторичной пары (y 161/173), а стояки
    //     котлов заканчиваются на котловой гребёнке (y ≤ 150) — под котлами полоса
    //     проходит свободно. Ограничивает её только легенда трубопроводов в левом
    //     нижнем углу: её подписи кончаются около x = 170, берём запас до 190.
    //   • Без стрелки отводы идут от самой котловой гребёнки, вровень со стояками
    //     котлов, — там полоса обязана начинаться правее блоков, и место под неё
    //     освобождается сдвигом самих блоков (не больше 14 мм: левее таблица УГО).
    // Предел задаёт правый край легенды трубопроводов: полоса отводов идёт
    // ровно над ней. Со срезанным до 25 мм образцом линии самая длинная строка
    // («обратный трубопровод рециркуляции горячего водоснабжения») кончается
    // около x = 148, поэтому полосе теперь можно до 155 вместо прежних 190.
    var TAP_X0_MIN = cfg.hydro ? 155 : 221.1;
    var TAP_STEP_MIN = 6.2;   // насос Ø5.84 мм + просвет: плотнее символы сливаются
    // Правый предел полосы. Полоса тянет за собой гидрострелку (hydroX =
    // tapsEnd+24), а за ней — весь правый край листа, и там два узких места:
    //   • стояк обратки стрелки (xu = hydroX+16.5) против стояка обратки
    //     загрузки бойлера (upR = tX−35.5 = 326) — при нижней разводке;
    //   • стояк расширительного бака отопления (mRight+12) против линии подачи
    //     загрузки к змеевику (lx1 = tX−22 = 339.5) — при клапане Fugas.
    // Оба сходятся на tapsEnd ≈ 280: там просветы те же 5–6 мм, что на штатной
    // схеме с тремя парами отводов. Дальше стояки сливаются в один.
    var TAP_RIGHT = 280.1;
    // РАССТОЯНИЕ ВНУТРИ ГРУППЫ НЕ СЖИМАЕТСЯ. Отводы идут парами «обратка +
    // подача» одной насосной группы, и между ними всегда штатные 9 мм: там
    // стоят перемычка подмеса, насос и арматура, и сжатая пара читается как
    // один узел с четырьмя стояками. Тесно становится — сокращаем ТОЛЬКО
    // просвет МЕЖДУ группами, до предела GAP_MIN.
    var PAIR_STEP = TAP_STEP_BASE;
    var GAP_MIN = 4.6;                 // меньше — арматура соседних групп сливается
    var nGroups = Math.ceil(taps.length / 2);
    var tapGap = PAIR_STEP, tapX0 = TAP_X0_BASE, tpDrawn = tpN;
    // Ширина полосы при заданном просвете: каждая группа занимает PAIR_STEP,
    // между группами — gap.
    function bandW(groups, gap) { return groups > 0 ? (groups - 1) * (PAIR_STEP + gap) + PAIR_STEP : 0; }
    if (nGroups > 0 && tapX0 + bandW(nGroups, tapGap) > TAP_RIGHT) {
      // Сначала РАСШИРЯЕМСЯ ВЛЕВО, штатный просвет не трогаем: слева место есть.
      tapX0 = Math.max(TAP_X0_MIN, TAP_RIGHT - bandW(nGroups, tapGap));
      if (tapX0 + bandW(nGroups, tapGap) > TAP_RIGHT && nGroups > 1) {
        tapGap = (TAP_RIGHT - tapX0 - PAIR_STEP) / (nGroups - 1) - PAIR_STEP;
      }
      if (tapGap < GAP_MIN) {
        // Не помещается даже с минимальным просветом. Снимаем с картинки лишние
        // ОДИНАКОВЫЕ пары ТП и дописываем их реальное число к последней паре
        // («× N шт.») — так же, как усечённый каскад котлов. Молча терять
        // контуры нельзя: по такой схеме соберут не то.
        tapGap = GAP_MIN;
        while (nGroups > 1 && tapX0 + bandW(nGroups, tapGap) > TAP_RIGHT && tpDrawn > 1) {
          taps.splice(tpFrom + (tpDrawn - 1) * 2, 2);
          tpDrawn--; nGroups--;
        }
        // Нумерацию оставшихся пар сохраняем: две одинаковые безномерные пары
        // читались бы как «контуров два», а подпись «× N шт.» у последней прямо
        // говорит, сколько их на самом деле.
        if (tpDrawn < tpN) {
          var lastTp = taps[tpFrom + (tpDrawn - 1) * 2 + 1];
          if (lastTp) lastTp.note = '× ' + tpN + ' шт.';
        }
      }
    }
    // Готовые оси стояков: внутри пары — PAIR_STEP, между парами — tapGap.
    var tapXs = taps.map(function (t, i) {
      return tapX0 + Math.floor(i / 2) * (PAIR_STEP + tapGap) + (i % 2) * PAIR_STEP;
    });
    // На сколько уезжают влево блоки котлов, чтобы не перекрыть полосу. При
    // гидрострелке полоса проходит НИЖЕ их стояков — двигать котлы не нужно.
    var boilerShift = cfg.hydro ? 0 : (TAP_X0_BASE - tapX0);

    // Блоки котлов: каскад одинаковых рисуется отдельными блоками, до четырёх.
    // Корпуса компактные (27), кроме блока-носителя ГВС/загрузки (29); эталон
    // одиночного котла — 33.
    //
    // Раньше потолок был три блока, и четвёртый котёл схлопывался в подпись
    // «× N шт.». Упиралось это в левый край: ряд выкладывался справа налево от
    // 226.9, и четвёртый корпус заезжал в таблицу УГО. Сужать корпуса нельзя —
    // оборудование на схеме держит натурный размер, — зато ряд можно двигать
    // ВПРАВО: правее котлов их полоса свободна до расширительного бака (319),
    // и стояки там опускаются в ту же гребёнку (она идёт до 307). Поэтому ряд
    // теперь упирается влево в таблицу УГО и растёт вправо, а не наоборот.
    var MAX_BLOCKS = 4;
    var blocks = [];
    var gasCount = cfg.gas ? Math.max(1, cfg.gas.count || 1) : 0;
    var elCount = cfg.el ? Math.max(1, cfg.el.count || 1) : 0;
    for (var gi = 0; gi < gasCount; gi++) blocks.push({ kind: 'gas' });
    for (var ei = 0; ei < elCount; ei++) blocks.push({ kind: 'el' });
    if (!blocks.length) blocks.push({ kind: 'el' });
    if (blocks.length > MAX_BLOCKS) {
      // Усечение каскада: раньше резался хвост массива, и при трёх газовых
      // электрокотёл пропадал со схемы целиком — вместе со своим узлом
      // загрузки. Потом стал сохраняться один блок на тип, а количество
      // дописываться на корпус («× N шт.»).
      //
      // Теперь при нехватке места первыми схлопываются ГАЗОВЫЕ. Каскад из двух
      // настенных газовых — это заводская схема с каскадным контроллером, она
      // читается и с подписью «× 2 шт.». Электрические же ставят порознь, у
      // каждого свой автомат и своя линия питания, и монтажнику надо видеть на
      // схеме два корпуса, а не один. Поэтому электрокотлам отдаём столько
      // блоков, сколько их есть, а газовым — что осталось (но не меньше одного).
      // Газовых оставляем хотя бы один, но только если они вообще есть: иначе
      // на схеме дома с четырьмя электрокотлами появился бы газовый призрак.
      var keepGas = gasCount > 0 ? Math.min(gasCount, Math.max(1, MAX_BLOCKS - elCount)) : 0;
      var keepEl = Math.min(elCount, MAX_BLOCKS - keepGas);
      blocks = [];
      for (var kg = 0; kg < keepGas; kg++) blocks.push({ kind: 'gas' });
      for (var ke = 0; ke < keepEl; ke++) blocks.push({ kind: 'el' });
    }
    var drawnGas = blocks.filter(function (b) { return b.kind === 'gas'; }).length;
    var drawnEl = blocks.filter(function (b) { return b.kind === 'el'; }).length;
    var multi = blocks.length > 1;
    var carrierIdx = 0;
    for (var ci = 0; ci < blocks.length; ci++) {
      if (blocks[ci].kind === 'gas') { carrierIdx = ci; break; }
    }
    // Пара загрузочных стояков (b.load) — у каких блоков рисуется узел
    // загрузки бойлера. Смета ставит клапан Fugas на КАЖДЫЙ ТИП котла
    // (газовый и электрический, кроме POLIS — у него нет автоматики под
    // клапан), а насосную группу загрузки — одну на систему. Схема обязана
    // совпадать со спецификацией, иначе по ней соберут не то.
    var polis = !!(cfg.el && cfg.el.polis);
    var seenKind = {};
    blocks.forEach(function (b, i) {
      var first = !seenKind[b.kind]; seenKind[b.kind] = true;
      // При насосной группе загрузки узел у котла не рисуется вовсе — группа
      // стоит на общей магистрали (см. блок после гребёнки). Врезка в стояк
      // одного газового котла читалась как «бойлер грузит только газовый».
      // dhwBuiltIn — клапан бойлера встроен в газовый котёл: узел загрузки
      // рисуется у газового, как патрубок самого котла, без клапана.
      b.load = hasLoad && first && (
        (cfg.fugas && (b.kind === 'gas' || !polis)) ||
        (cfg.dhwBuiltIn && b.kind === 'gas'));
      b.carrier = (i === carrierIdx) && twoCirc;
    });
    // POLIS — единственный источник, а бойлер есть: узел загрузки в смете
    // отсутствует (ГВС обычно держит газовый котёл). Рисуем голые стояки
    // загрузки от котла, без клапана — иначе змеевик бойлера повис бы в
    // воздухе. Сам клапан у POLIS не рисуется никогда (см. отрисовку узла).
    if (hasLoad && !cfg.loadPump && !blocks.some(function (b) { return b.load; })) blocks[carrierIdx].load = true;
    blocks.forEach(function (b) {
      // Широкая раскладка (3 стояка и больше) — у носителя ГВС-пары
      // двухконтурного и у блоков с узлом загрузки. При трёх блоках широкий
      // корпус ужимается до 29 с шагом стояков 8: раскладка [33,27,33]
      // уводила гребёнку влево до 121.8 — внутрь таблицы УГО (её правый
      // край 127.65). С [29,27,29] левый торец гребёнки — 129.8.
      b.wide = b.carrier || b.load;
      b.step = (blocks.length >= 3 && b.wide) ? 8 : 9;
      b.w = blocks.length >= 3 ? (b.wide ? 29 : 27) : 33;
    });

    o.push(legendTable(cfg));
    o.push(pipeLegend(cfg));
    // Заголовок листа отрисован ниже: его X зависит от того, куда встал ряд
    // котлов (см. titleX).

    // Датчик уличной температуры (погодозависимое регулирование) — вне
    // гидравлики, в правом верхнем углу листа
    if (cfg.auto) {
      o.push(gauge(401, 25.5, 'Т'));
      o.push(txt(401, 32.6, 'улица', { size: SZ.dia, anchor: 'middle' }));
    }

    // Примечание о подпитке — на листах без линии ХВС (нет ни двухконтурного
    // котла, ни бойлера с вводом воды). Узел подпитки сметой не подбирается,
    // а без него систему нечем заполнить — монтажник должен видеть текстом,
    // откуда брать воду (замечание из ревью: «по этой схеме систему
    // физически нечем заполнить»).
    if (!twoCirc && !cfg.indirect) {
      o.push(txt(302, 246, 'Примечание: заполнение и подпитка системы отопления —', { size: SZ.txt }));
      o.push(txt(302, 251, 'от ввода ХВС через шаровый кран 1/2" с обратным клапаном.', { size: SZ.txt }));
      o.push(txt(302, 256, 'Узел подпитки на схеме условно не показан.', { size: SZ.txt }));
    }

    // гребёнка котлового контура: подача 126.04, ниже с шагом 6 (обмер ТМ-2)
    var mY = { supply: 126.04, ret: 132.04 };
    var rows = 2;
    if (hasLoad) { mY.loadS = 126.04 + rows * 6; mY.loadR = 126.04 + rows * 6 + 6; rows += 2; }
    if (twoCirc) { mY.dhw = 126.04 + rows * 6; mY.cold = 126.04 + rows * 6 + 6; rows += 2; }
    var allYs = Object.keys(mY).map(function (k) { return mY[k]; });
    function others(y) { return allYs.filter(function (v) { return v !== y; }); }

    // раскладка блоков справа налево: правый край последнего блока — 226.9,
    // как у одиночного котла эталона; при трёх блоках зазор ужат, чтобы
    // гребёнка не налезла на таблицу УГО (её правый край — 127.65)
    var bTop = 18.9, bBot = bTop + 58;
    var gap = blocks.length >= 3 ? 2.5 : 10;
    var bXs = new Array(blocks.length);
    // Правый край последнего блока уезжает влево ровно на столько, на сколько
    // сдвинулось начало полосы отводов (см. boilerShift): иначе первый стояк
    // группы лёг бы на корпус котла.
    var edge = 226.9 - boilerShift;
    for (var k = blocks.length - 1; k >= 0; k--) {
      bXs[k] = edge - blocks[k].w;
      edge = bXs[k] - gap;
    }
    // Ряд не влез влево — сдвигаем его целиком ВПРАВО до упора в таблицу УГО.
    // Левый торец гребёнки не должен заходить за её правый край (127.65), и
    // 136.9 — то же положение первого корпуса, что у трёх блоков. Вправо
    // уходить есть куда: полоса котлов свободна до расширительного бака (319),
    // а гребёнка, в которую опускаются стояки, идёт до 307. Так четвёртый
    // котёл рисуется штатной ширины, вместо того чтобы схлопнуться в подпись.
    var BOILERS_LEFT = 136.9;
    if (bXs.length && bXs[0] < BOILERS_LEFT) {
      var dx = BOILERS_LEFT - bXs[0];
      for (var sx = 0; sx < bXs.length; sx++) bXs[sx] += dx;
    }
    var mLeft = bXs[0] - 7.1;
    // Заголовок листа стоит на 252.2 и при широком ряде оказался бы на
    // патрубке последнего котла — отодвигаем его за ряд.
    var titleX = Math.max(252.2, bXs[bXs.length - 1] + blocks[blocks.length - 1].w + 6);
    o.push(txt(titleX, 17.4, 'Принципиальная схема', { size: SZ.title }));

    // стрелки и Ø на стояках — в одной полосе, как в эталоне
    var stemArrowDown = mY.supply - 5.15, stemArrowUp = mY.supply - 8.29;
    var stemDiaY = mY.supply - 10.6;

    // Левые границы линий загрузки: подача начинается на стояке первого
    // узла загрузки, обратка — на перемычке в общую обратку у левого торца
    var loadSx = null;
    // Стояк «обратка бойлера» котла со своим патрубком — с него и начинается линия
    // обратки загрузки (перемычки в общую обратку тогда нет).
    var loadRBoilerX = null;
    // Правый край котловых стояков — по нему сажается сепаратор воздуха на
    // подаче (см. ниже): он должен встать ЗА котлом по потоку, но до отводов
    // и до гидрострелки, а полоса выносок Ø тянется вправо от каждого стояка.
    var maxStemX = 0;
    var firstElIdx = -1;
    for (var fe = 0; fe < blocks.length; fe++) {
      if (blocks[fe].kind === 'el') { firstElIdx = fe; break; }
    }

    blocks.forEach(function (b, bi) {
      var kind = b.kind, bx = bXs[bi], st = b.step;
      o.push(boilerUnit(bx, bTop, kind, b.w));
      // Каскад больше трёх блоков усечён — дописываем реальное количество
      if (kind === 'gas' && gasCount > drawnGas && bi === carrierIdx)
        o.push(txt(bx + b.w / 2, bTop + 12.3, '× ' + gasCount + ' шт.', { size: SZ.txt, anchor: 'middle' }));
      if (kind === 'el' && elCount > drawnEl && bi === firstElIdx)
        o.push(txt(bx + b.w / 2, bTop + 12.3, '× ' + elCount + ' шт.', { size: SZ.txt, anchor: 'middle' }));

      // Раскладка стояков. У котла ДВА гидравлических патрубка (подача и
      // обратка) — узел загрузки бойлера больше не рисуется отдельной парой
      // патрубков из корпуса (по такой картинке узел собирали бы четырьмя
      // врезками в котёл). Носитель ГВС двухконтурного — исключение: у него
      // патрубков действительно четыре (О+ГВС).
      var xs, xRet, xls = null, xg = null, xc = null, xlr = null;
      // Котёл со своими патрубками «загрузка» и «обратка» бойлера (Navien Deluxe
      // One, Vaillant VU) — четыре стояка, как у носителя ГВС двухконтурного.
      var retToBoiler = b.load && cfg.dhwBuiltIn && cfg.dhwReturnToBoiler && kind === 'gas';
      if (b.carrier) { xs = bx + 3.03; xg = xs + st; xc = xs + 2 * st; xRet = xs + 3 * st; }
      else if (retToBoiler) { xs = bx + 3.03; xls = xs + st; xlr = xs + 2 * st; xRet = xs + 3 * st; if (loadRBoilerX === null || xlr < loadRBoilerX) loadRBoilerX = xlr; }
      else if (b.load) { xs = bx + (b.w - 2 * st) / 2; xls = xs + st; xRet = xs + 2 * st; }
      else { xs = bx + (b.w - 9) / 2; xRet = xs + 9; }
      if (xls !== null && (loadSx === null || xls < loadSx)) loadSx = xls;
      [xs, xRet, xg, xc].forEach(function (v) { if (v !== null && v > maxStemX) maxStemX = v; });

      // POLIS — единственный электрокотёл без встроенного насоса: котловой контур
      // собирается на группе быстрого монтажа (насос на подаче + краны 1" с
      // термометрами). Подписываем её выноской у насоса.
      var isPolis = (kind === 'el' && cfg.el && cfg.el.polis);
      // POLIS присоединяется 1" независимо от мощности котельной — это его
      // собственные патрубки, а не сечение магистрали.
      // Патрубки котлов G3/4" (Haier, BAXI, Navien, STATUS) — краны и американки в смете
      // 3/4" при любой мощности; раньше подпись шла по магистрали (от 30 кВт — 1").
      var portSize = isPolis ? '1"' : '3/4"';

      // Группы маршрутов (data-hyd-part) — для подсветки пути воды на экране:
      // по наведению на стояк или котёл слой поверх схемы клонирует трубы
      // нужных групп. data-hyd-dir — куда бежит анимация вдоль линии:
      // fwd — как нарисовано (сверху вниз, слева направо), rev — обратно.
      // На чертёж группы не влияют.
      o.push('<g data-hyd-part="bsup" data-hyd-dir="fwd" data-hyd-b="' + bi + '">');
      // подача: кран → [насос ГБМ] → [Fugas или тройник загрузки] →
      // [обратный клапан при каскаде] → гребёнка
      o.push(ln(xs, bBot, xs, bBot + 2.53, { c: COL.supply, w: LW.pipe }));
      o.push(ballValve(xs, bBot + 5.03, true));
      o.push(leaderValve(xs, bBot + 5.03, portSize));
      var ys = bBot + 7.53;
      if (isPolis) {
        o.push(ln(xs, ys, xs, ys + 1.6, { c: COL.supply, w: LW.pipe }));
        o.push(pump(xs, ys + 4.52, 'down'));
        ys += 7.44;
        if (cfg.el.gbm) o.push(leader(xs - 3.4, bBot + 13.1, 'ГБМ'));
      }
      if (b.load && cfg.dhwBuiltIn && kind === 'gas') {
        // Клапан приоритета внутри котла (Haier NeoSlim 1.x, Vaillant VU,
        // Navien): у котла третий патрубок — «подача в змеевик бойлера»
        // (руководство Haier, стр. 30, поз. B), он и идёт на линию загрузки.
        // Арматуры на нём смета не кладёт — краны и американки стоят у
        // змеевика, — поэтому и здесь только труба. Подача отопления идёт
        // своим стояком без врезок.
        o.push('<g data-hyd-part="load" data-hyd-dir="fwd" data-hyd-b="' + bi + '">');
        o.push(vpipe(xls, bBot, mY.loadS, COL.loadS, [mY.supply, mY.ret]));
        o.push('</g>');
        o.push(diaV(xls, stemDiaY, dia));
        o.push(arrowSym(xls, stemArrowDown, 'down'));
        if (cfg.dhwPortSize) o.push(leader(xls - 0.96, bBot + 4.6, cfg.dhwPortSize));
        if (xlr !== null) {
          // Обратка змеевика — в свой патрубок котла («обратка бойлера»), а не в
          // общую обратку: перемычку у торца гребёнки тогда не рисуем (ниже).
          o.push('<g data-hyd-part="load" data-hyd-dir="rev" data-hyd-b="' + bi + '">');
          o.push(vpipe(xlr, bBot, mY.loadR, COL.loadR, [mY.supply, mY.ret, mY.loadS]));
          o.push('</g>');
          o.push(arrowSym(xlr, stemArrowUp, 'up'));
          if (cfg.dhwPortSize) o.push(leader(xlr - 0.96, bBot + 4.6, cfg.dhwPortSize));
        }
      } else if (b.load) {
        var drawFugas = cfg.fugas && !(kind === 'el' && polis);
        if (drawFugas) {
          // Клапан приоритета — В РАЗРЫВ подачи котла: вход сверху от котла,
          // прямой ход вниз в отопление, боковой отвод вправо на линию
          // загрузки. Раньше клапан висел на параллельном стояке, и подача
          // отопления шунтировала его — приоритет ГВС не обеспечивался.
          o.push(ln(xs, ys, xs, ys + 1.6, { c: COL.supply, w: LW.pipe }));
          o.push(valve3(xs, ys + 4.1, 'prio', 'udr', 'l'));
          o.push('<g data-hyd-part="load" data-hyd-dir="fwd" data-hyd-b="' + bi + '">');
          o.push(hpipe(xs + 2.5, xls, ys + 4.1, COL.loadS));
          o.push(vpipe(xls, ys + 4.1, mY.loadS, COL.loadS, [mY.supply, mY.ret]));
          o.push('</g>');
          ys += 6.6;
        } else {
          // Насосная группа загрузки — на тройнике от подачи после крана
          // котла: кран → насос → обратный клапан (без него стоящий насос
          // даёт паразитную циркуляцию через змеевик). Без насоса (прямая
          // ветка) — только кран.
          var yTee = ys + 1.4;
          o.push(ln(xs, ys, xs, ys + 2.8, { c: COL.supply, w: LW.pipe }));
          o.push('<g data-hyd-part="load" data-hyd-dir="fwd" data-hyd-b="' + bi + '">');
          o.push(hpipe(xs, xls, yTee, COL.loadS));
          o.push(ln(xls, yTee, xls, yTee + 1.2, { c: COL.loadS, w: LW.pipe }));
          o.push(ballValve(xls, yTee + 3.7, true));
          o.push(leaderValve(xls, yTee + 3.7, mainThread));
          if (cfg.loadPump) {
            o.push(ln(xls, yTee + 6.2, xls, yTee + 7.8, { c: COL.loadS, w: LW.pipe }));
            o.push(pump(xls, yTee + 10.72, 'down'));
            o.push(ln(xls, yTee + 13.64, xls, yTee + 15.2, { c: COL.loadS, w: LW.pipe }));
            o.push(checkValve(xls, yTee + 17.7, 'down'));
            o.push(vpipe(xls, yTee + 20.2, mY.loadS, COL.loadS, [mY.supply, mY.ret]));
          } else {
            o.push(vpipe(xls, yTee + 6.2, mY.loadS, COL.loadS, [mY.supply, mY.ret]));
          }
          o.push('</g>');
          ys += 2.8;
        }
        o.push(diaV(xls, stemDiaY, dia));
        o.push(arrowSym(xls, stemArrowDown, 'down'));
      }
      if (multi) {
        o.push(ln(xs, ys, xs, ys + 1.5, { c: COL.supply, w: LW.pipe }));
        o.push(checkValve(xs, ys + 4, 'down'));
        ys += 6.5;
      }
      o.push(vpipe(xs, ys, mY.supply, COL.supply, others(mY.supply)));
      o.push(diaV(xs, stemDiaY, dia));
      o.push(arrowSym(xs, stemArrowDown, 'down'));
      o.push('</g>');

      // обратка: кран + фильтр + кран. Обратный клапан каскада стоит на
      // подаче — дублировать его на обратке незачем (одного разрыва кольца
      // достаточно, лишний клапан — лишнее сопротивление).
      // Вода по обратке идёт вверх, в котёл, — анимация обратная.
      o.push('<g data-hyd-part="bret" data-hyd-dir="rev" data-hyd-b="' + bi + '">');
      o.push(ln(xRet, bBot, xRet, bBot + 2.53, { c: COL.ret, w: LW.pipe }));
      o.push(ballValve(xRet, bBot + 5.03, true));
      o.push(leaderValve(xRet, bBot + 5.03, portSize));
      o.push(ln(xRet, bBot + 7.53, xRet, bBot + 9.6, { c: COL.ret, w: LW.pipe }));
      o.push(filterSym(xRet, bBot + 13.14));
      o.push(leaderFilter(xRet, bBot + 13.14, '3/4"')); // фильтр RFW-0080 — 3/4" (catalog.filter_mag)
      o.push(ln(xRet, bBot + 16.67, xRet, bBot + 18.74, { c: COL.ret, w: LW.pipe }));
      o.push(ballValve(xRet, bBot + 21.24, true));
      o.push(leaderValve(xRet, bBot + 21.24, mainThread));
      o.push(vpipe(xRet, bBot + 23.74, mY.ret, COL.ret, others(mY.ret)));
      o.push(diaV(xRet, stemDiaY, dia));
      o.push(arrowSym(xRet, stemArrowUp, 'up'));
      o.push('</g>');

      // двухконтурный газовый: ГВС и ХВС из котла. В эталоне ТМ-2 эти стояки
      // были сплошными; краны добавлены сознательно — без них замена котла
      // требует слива всей водопроводной разводки.
      if (b.carrier && twoCirc) {
        o.push(ln(xg, bBot, xg, bBot + 2.53, { c: COL.dhw, w: LW.pipe }));
        o.push(ballValve(xg, bBot + 5.03, true));
        o.push(leaderValve(xg, bBot + 5.03, '3/4"'));
        o.push(vpipe(xg, bBot + 7.53, mY.dhw, COL.dhw, others(mY.dhw)));
        o.push(diaV(xg, stemDiaY, sanDia));
        o.push(arrowSym(xg, stemArrowDown, 'down'));
        o.push(ln(xc, bBot, xc, bBot + 2.53, { c: COL.cold, w: LW.pipe }));
        o.push(ballValve(xc, bBot + 5.03, true));
        o.push(leaderValve(xc, bBot + 5.03, '3/4"'));
        o.push(vpipe(xc, bBot + 7.53, mY.cold, COL.cold, others(mY.cold)));
        o.push(diaV(xc, stemDiaY, sanDia));
        o.push(arrowSym(xc, stemArrowUp, 'up'));
      }
    });

    // Обратка загрузки бойлера вливается в общую обратку котлового контура
    // одной перемычкой у левого торца гребёнки (тройник; дальше поток идёт
    // через фильтр того котла, который сейчас греет). Раньше она заходила в
    // котёл отдельным четвёртым патрубком, которого у котла нет.
    var jx = mLeft + 2.6;
    // У котла со своим патрубком «обратка бойлера» перемычки нет — обратка змеевика
    // уходит в котёл (см. xlr). Кроме случая, когда бойлер грузит ещё и резервный
    // электрокотёл через внешний клапан (cfg.fugas): его обратке нужна перемычка.
    if (hasLoad && !(cfg.loadPump && cfg.hydro) && !(cfg.dhwReturnToBoiler && !cfg.fugas)) {
      // при насосной группе на коллекторе (после гидрострелки) обратка
      // загрузки уходит во вторичный коллектор, а не в котловую обратку
      o.push('<g data-hyd-part="load" data-hyd-dir="rev">');
      o.push(vpipe(jx, mY.ret, mY.loadR, COL.loadR, [mY.loadS]));
      o.push('</g>');
    }

    // ── потребители ──
    var tapsEnd = tapXs.length ? tapXs[tapXs.length - 1] : tapX0;
    var srcY = mY, secPair = null, hydroX = 0, mRight = 0;

    if (cfg.hydro) {
      hydroX = Math.max(tapsEnd + 24, 296);
      secPair = { supply: 161, ret: 173 };
      var xd = hydroX + 11, xu = hydroX + 16.5;
      mRight = xu;
      // котловая пара к гидрострелке. Подача бежит от котлов вправо, к
      // стрелке (fwd); обратка — от стрелки влево, к котлам (rev).
      o.push('<g data-hyd-part="msup" data-hyd-dir="fwd">');
      o.push(hpipe(mLeft, xd, mY.supply, COL.supply));
      o.push(diaH(hydroX - 2, mY.supply, dia));
      o.push('</g><g data-hyd-part="mret" data-hyd-dir="rev">');
      o.push(hpipe(mLeft, xu, mY.ret, COL.ret));
      o.push(diaH(hydroX - 2, mY.ret, dia));
      o.push('</g>');
      // При нижней разводке загрузки стояки гидрострелки пересекает только
      // верхняя горизонталь к Т2 бойлера — на уровне его патрубка
      var loadYs = (hasLoad && !loadDown) ? [mY.loadS, mY.loadR] : (loadDown ? [pT2e] : []);
      // Стояки стрелки: подача вниз (fwd) и коротким отводом влево в стрелку
      // (rev — отвод нарисован слева направо); обратка из стрелки вправо
      // (fwd) и вверх к котлам (rev).
      o.push('<g data-hyd-part="hydro" data-hyd-dir="fwd">');
      o.push(vpipe(xd, mY.supply, secPair.supply, COL.supply, [mY.ret].concat(loadYs)));
      o.push('</g><g data-hyd-part="hydro" data-hyd-dir="rev">');
      o.push(hpipe(hydroX + 4.5, xd, secPair.supply, COL.supply));
      o.push(openArrow(hydroX + 6.4, secPair.supply, 'left', COL.supply));
      o.push(vpipe(xu, mY.ret, secPair.ret, COL.ret, loadYs));
      o.push('</g><g data-hyd-part="hydro" data-hyd-dir="fwd">');
      o.push(hpipe(hydroX + 4.5, xu, secPair.ret, COL.ret));
      o.push(openArrow(xu - 0.8, secPair.ret, 'right', COL.ret));
      o.push('</g><g data-hyd-part="hydro" data-hyd-dir="none">');
      o.push(hydroSep(hydroX, 167, cfg.hydro.kw, cfg.hydro.thermo === false, cfg.hydro.buffer || null));
      o.push('</g>');
      // датчик «Каскад» — на подаче за гидрострелкой (по нему контроллер
      // ведёт общую температуру каскада)
      if (cfg.auto && cfg.auto.cascade) {
        o.push(ln(hydroX - 10, secPair.supply - 2.4, hydroX - 10, secPair.supply, { w: LW.thin }));
        o.push(gauge(hydroX - 10, secPair.supply - 4.95, 'Т'));
      }
      // вторичная пара к насосным группам: подача идёт от стрелки влево, к
      // отводам (rev), обратка собирается с отводов и идёт вправо (fwd).
      o.push('<g data-hyd-part="ssup" data-hyd-dir="rev">');
      o.push(hpipe(tapX0 - 8, hydroX - 4.5, secPair.supply, COL.supply));
      o.push(tick(tapX0 - 8, secPair.supply, false, COL.supply));
      o.push(openArrow(hydroX - 15, secPair.supply, 'left', COL.supply));
      o.push('</g><g data-hyd-part="sret" data-hyd-dir="fwd">');
      o.push(hpipe(tapX0 - 8, hydroX - 4.5, secPair.ret, COL.ret));
      o.push(tick(tapX0 - 8, secPair.ret, false, COL.ret));
      o.push(openArrow(hydroX - 6.4, secPair.ret, 'right', COL.ret));
      o.push('</g>');
      srcY = { supply: secPair.supply, ret: secPair.ret, dhw: mY.dhw, cold: mY.cold };
    }

    var crossAll = allYs.concat(secPair ? [secPair.supply, secPair.ret] : []);
    function crossFor(fromY) {
      return crossAll.filter(function (yy) { return yy !== fromY; });
    }

    var tankBox = null;             // габариты бойлера — под зону подсветки
    var bottomValveY = 256.78;      // центр нижних кранов (обмер: 254.28+2.5)
    var loadRx = null;
    taps.forEach(function (t, i) {
      var x = tapXs[i];
      // Просвет до соседа справа — по нему разводят выноски и датчики.
      var nextGap = (i + 1 < tapXs.length) ? (tapXs[i + 1] - x) : (PAIR_STEP + tapGap);
      var yStart = srcY[t.from];
      var yTop = bottomValveY - 2.5;
      // Резьба арматуры стояка — по DN насосной группы этого контура
      // (санитарные отводы В1/Т3 идут своим размером, у них t.size нет).
      var tSize = t.size || '3/4"';
      // Стояк подачи: вода идёт вниз, как нарисовано (fwd); обратки — вверх (rev).
      o.push(t.hyd
        ? '<g data-hyd-part="tap" data-hyd-kind="' + t.hyd + '" data-hyd-i="' + (t.hydI || 0) +
          '" data-hyd-mark="' + (t.mark || '') +
          '" data-hyd-dir="' + (t.from === 'supply' ? 'fwd' : 'rev') + '">'
        : '<g>');
      if (t.load) {
        // Ровно та же группа, что у радиаторного контура: обратка — чистый
        // стояк, подача — обратный клапан + кран + насос на тех же высотах,
        // внизу у обеих веток кран в общем ряду. Отличие только в том, что
        // после крана ветки уходят не к потребителю, а к змеевику бойлера.
        var gyL = 212.5;
        if (t.load === 'sup') {
          o.push(vpipe(x, yStart, gyL, t.color, crossFor(yStart)));
          o.push(checkValve(x, gyL + 2.5, 'down'));
          o.push(leaderCheck(x, gyL + 2.5, tSize));
          o.push(ln(x, gyL + 5, x, gyL + 9.6, { c: t.color, w: LW.pipe }));
          o.push(ballValve(x, gyL + 12.1, true));
          o.push(leaderValve(x, gyL + 12.1, tSize));
          o.push(ln(x, gyL + 14.6, x, gyL + 18.24, { c: t.color, w: LW.pipe }));
          o.push(pump(x, gyL + 21.16, 'down'));
          o.push(ln(x, gyL + 24.08, x, yTop, { c: t.color, w: LW.pipe }));
          loadSx = x;
        } else {
          o.push(vpipe(x, yStart, yTop, t.color, crossFor(yStart)));
          loadRx = x;
        }
        o.push(ballValve(x, bottomValveY, true));
        o.push(leaderValve(x, bottomValveY, tSize));
        o.push(diaV(x, bottomValveY - 7.2, dia));
        o.push('</g>');
        return;
      }
      if (t.mix) {
        // узел ТП: клапан на обратке (как в ТМ-2), перемычка подмеса вправо
        // в подачу Т11. При автоматике котельной клапан с сервоприводом —
        // смесью управляет контроллер, термоголовка дублировала бы его
        var vy = 215.27;
        o.push(vpipe(x, yStart, vy - 2.5, t.color, crossFor(yStart)));
        o.push(valve3(x, vy, (cfg.auto && cfg.auto.mixServo) ? 'servo' : 'therm', 'udr', 'l'));
        o.push(leader(x - 0.96, vy - 2.6, tSize));
        o.push(hpipe(x + 2.5, x + PAIR_STEP, vy, COL.supply));
        o.push(ln(x, vy + 2.5, x, t.snow ? HX_TOP : yTop, { c: t.color, w: LW.pipe }));
      } else if (t.pump || t.group) {
        // насосный стояк: обратный клапан + кран + насос. Узел един для
        // радиаторной группы и подачи ТП — без обратного клапана на Т11
        // соседний насос гонял бы паразитный поток через контур ТП.
        var gy = 212.5;
        o.push(vpipe(x, yStart, gy, t.color, crossFor(yStart)));
        o.push(checkValve(x, gy + 2.5, 'down'));
        o.push(leaderCheck(x, gy + 2.5, tSize));
        o.push(ln(x, gy + 5, x, gy + 9.6, { c: t.color, w: LW.pipe }));
        o.push(ballValve(x, gy + 12.1, true));
        o.push(leaderValve(x, gy + 12.1, tSize));
        o.push(ln(x, gy + 14.6, x, gy + 18.24, { c: t.color, w: LW.pipe }));
        o.push(pump(x, gy + 21.16, 'down'));
        o.push(ln(x, gy + 24.08, x, t.snow ? HX_TOP : yTop, { c: t.color, w: LW.pipe }));
        // датчик подачи контура (ТН) — в гильзе после насоса; по нему
        // контроллер ведёт расчётную температуру контура. У снеготаяния он
        // стоит не здесь, а на подаче ВТОРИЧНОГО контура: контроллер держит
        // уставку в уличной стяжке, а не в первичке до теплообменника.
        if (cfg.auto && !t.snow) {
          // Кружок датчика прижимаем к своему стояку тем плотнее, чем теснее
          // стоят отводы: при сжатом шаге он на штатном выносе 4.66 налезал
          // на подпись диаметра соседнего стояка (она идёт в 2.5 мм левее его).
          var gOff = Math.max(2.4, Math.min(4.66, nextGap - 4.9));
          o.push(ln(x, gy + 27.6, x + gOff - 2, gy + 27.6, { w: LW.thin }));
          o.push(gauge(x + gOff, gy + 27.6, 'Т'));
        }
      } else {
        o.push(vpipe(x, yStart, yTop, t.color, crossFor(yStart)));
      }
      o.push(ballValve(x, bottomValveY, true));
      o.push(leaderValve(x, bottomValveY, tSize));
      o.push(diaV(x, bottomValveY - 7.2, (t.mark === 'В1' || t.mark === 'Т3') ? sanDia : dia));
      o.push(bottomMark(x, t.mark, t.dir));
      // Усечённые одинаковые контуры ТП — их реальное число у последней пары
      if (t.note) o.push(txt(x + 2.6, 270.2, t.note, { size: SZ.dia, rotate: -90 }));
      o.push('</g>');
    });

    // правый край котловой гребёнки (без гидрострелки). Если потребителей
    // нет (только ГВС), гребёнка обрезается сразу за котлами — раньше она
    // тянулась к пустому месту несуществующих отводов.
    // Узел загрузки насосной группой без гидрострелки сидит на общей
    // магистрали (коллектор групп прикручен прямо к ней) — гребёнку при
    // необходимости удлиняем, чтобы тройник узла не оказался за её торцом.
    var loadNodeX = (hasLoad && cfg.loadPump && !cfg.hydro) ? Math.max(tapsEnd + 6, 231) : null;
    if (!cfg.hydro) {
      mRight = taps.length ? tapsEnd + 14.7 : 229;
      if (loadNodeX !== null) mRight = Math.max(mRight, loadNodeX + 26);
      o.push('<g data-hyd-part="msup" data-hyd-dir="fwd">');
      o.push(hpipe(mLeft, mRight, mY.supply, COL.supply));
      o.push(tick(mRight, mY.supply, false, COL.supply));
      o.push(diaH(mRight, mY.supply, dia));
      o.push('</g>');
      // датчик «Каскад» без гидрострелки — на общей подающей магистрали
      if (cfg.auto && cfg.auto.cascade) {
        o.push(ln(mRight - 6, mY.supply - 2.4, mRight - 6, mY.supply, { w: LW.thin }));
        o.push(gauge(mRight - 6, mY.supply - 4.95, 'Т'));
      }
      var retRight = cfg.tankHeating ? mRight + 4.7 : mRight;
      o.push('<g data-hyd-part="mret" data-hyd-dir="rev">');
      o.push(hpipe(mLeft, retRight, mY.ret, COL.ret));
      if (!cfg.tankHeating) o.push(tick(retRight, mY.ret, false, COL.ret));
      o.push(diaH(mRight, mY.ret, dia));
      o.push('</g>');
      if (twoCirc) {
        o.push(hpipe(mLeft, mRight, mY.dhw, COL.dhw));
        o.push(tick(mRight, mY.dhw, false, COL.dhw));
        o.push(diaH(mRight, mY.dhw, sanDia));
        o.push(hpipe(mLeft, mRight, mY.cold, COL.cold));
        o.push(tick(mRight, mY.cold, false, COL.cold));
        o.push(diaH(mRight, mY.cold, sanDia));
      }
    } else if (twoCirc) {
      // ГВС/ХВС двухконтурного не проходят через гидрострелку — это
      // санитарные линии. Раньше при гидрострелке они не рисовались вовсе:
      // стояки котла и отводы В1/Т3 обрывались в воздухе.
      o.push(hpipe(mLeft, tapsEnd, mY.dhw, COL.dhw));
      o.push(diaH(tapX0 - 4, mY.dhw, sanDia));
      o.push(hpipe(mLeft, tapsEnd - PAIR_STEP, mY.cold, COL.cold));
      o.push(diaH(tapX0 - 4, mY.cold, sanDia));
    }
    // ── сепаратор воздуха на подаче ──
    // Ставится ЗА котлом по потоку и ДО потребителей: воздух выделяется в самой
    // горячей точке контура, а поймать его надо раньше, чем он уйдёт в отводы.
    // Рисуется после горизонталей — линия подачи проходит сквозь ромб по его
    // штриховой оси, как фильтр и принято изображать.
    // Правая граница: при гидрострелке — полоса выносок Ø перед ней, без неё —
    // первый отвод. Слева отступ 13 мм от последнего котлового стояка: ровно на
    // столько вправо уходит его собственная выноска Ø.
    var sepRight = cfg.hydro ? (hydroX - 16)
      : (tapXs.length ? tapXs[0] - 4 : mRight - 4);
    var sepX = Math.min(maxStemX + 13, sepRight - 3.6);
    if (cfg.airSep && sepX > maxStemX + 6) {
      o.push(airSep(sepX, mY.supply));
      o.push(leaderFilter(sepX, mY.supply, cfg.airSep));
    }

    // ── узел загрузки бойлера насосной группой ──
    // Кран → насос → обратный клапан (без него стоящий насос даёт паразитную
    // циркуляцию через змеевик).
    if (hasLoad && cfg.loadPump && loadNodeX !== null) {
      // Без гидрострелки коллектор групп прикручен к самой магистрали —
      // тройник от общей подачи вниз на линию загрузки, дальше горизонтально.
      var xn = loadNodeX;
      o.push(vpipe(xn, mY.supply, mY.loadS, COL.loadS, [mY.ret]));
      o.push(hpipe(xn, xn + 2.3, mY.loadS, COL.loadS));
      o.push(ballValve(xn + 4.8, mY.loadS, false));
      o.push(leader(xn + 3.9, mY.loadS - 1.2, '3/4"'));
      o.push(hpipe(xn + 7.3, xn + 9.7, mY.loadS, COL.loadS));
      o.push(pump(xn + 12.6, mY.loadS, 'right'));
      o.push(hpipe(xn + 15.5, xn + 17.4, mY.loadS, COL.loadS));
      o.push(checkValve(xn + 19.9, mY.loadS, 'right'));
      loadSx = xn + 22.4;
    }

    // левые торцы гребёнки; линии загрузки начинаются тройниками
    // (подача — от клапана/узла у котла, обратка — от перемычки в обратку),
    // торцов у них нет
    var colByKey = { supply: COL.supply, ret: COL.ret, dhw: COL.dhw, cold: COL.cold, loadS: COL.loadS, loadR: COL.loadR };
    Object.keys(mY).forEach(function (k) {
      if (k === 'loadS' || k === 'loadR') return;
      o.push(tick(mLeft, mY[k], false, colByKey[k]));
    });

    // ── расширительный бак отопления — на обратке котлового контура ──
    if (cfg.tankHeating) {
      var volTxt = cfg.tankHeating + ' л.';
      if (cfg.hydro) {
        var tx2 = hydroX + 28.5;
        o.push(hpipe(mRight, tx2, mY.ret, COL.ret));
        o.push(expTank(tx2, mY.ret - 26.9, '#ff0000', volTxt));
        o.push(ln(tx2, mY.ret - 26.9, tx2, mY.ret - 24.4, { c: COL.ret, w: LW.pipe }));
        o.push(ballValve(tx2, mY.ret - 21.9, true));
        o.push(leaderValve(tx2, mY.ret - 21.9, '3/4"'));
        // при нижней разводке загрузки на этом уровне проходит линия к Т1
        // змеевика — стояк бака обходит её
        o.push(vpipe(tx2, mY.ret - 19.4, mY.ret, COL.ret, loadDown ? [pT1e] : []));
      } else {
        // гребёнка заканчивается левее бака, пересечений нет — обходы не нужны
        var tx1 = mRight + 4.7, tTop = 87.17;
        o.push(expTank(tx1, tTop, '#ff0000', volTxt));
        o.push(ln(tx1, tTop, tx1, tTop + 5.5, { c: COL.ret, w: LW.pipe }));
        o.push(ballValve(tx1, tTop + 8, true));
        o.push(leaderValve(tx1, tTop + 8, '3/4"'));
        o.push(ln(tx1, tTop + 10.5, tx1, mY.ret, { c: COL.ret, w: LW.pipe }));
      }
    }

    // ── бойлер косвенного нагрева ──
    if (cfg.indirect) {
      // напольный 52×84 или настенный 40×56 — по креплению из настроек;
      // настенный висит выше, чтобы низ корпуса не лёг на гребёнку загрузки.
      // Патрубки распределены пропорционально высоте (для напольного это
      // те же уровни, что и раньше: +14 / +20.5 / +27 / +58 / +74)
      var wall = !!cfg.indirect.wall;
      var tW = wall ? 40 : 52, tH = wall ? 56 : 84, tX = 415 - tW - 1.5, tY = wall ? 78 : 92;
      o.push(indirectTank(tX, tY, tW, tH));
      tankBox = { x: tX, y: tY, w: tW, h: tH };
      // датчик ГВС — в штатной гильзе бойлера (режим «Бойлер» контроллера)
      if (cfg.auto && cfg.auto.dhwSensor) o.push(gauge(tX + tW - 7, tY + tH * 0.55, 'Т'));
      var pT3 = tY + tH * 0.167, pT4 = tY + tH * 0.244, pT1 = tY + tH * 0.321,
        pT2 = tY + tH * 0.69, pB1 = tY + tH - (wall ? 8 : 10);
      // арматура В1 всегда на уровне напольного патрубка — у настенного между
      // ней и корпусом остаётся спуск с обходами линий загрузки
      var armY = Math.max(pB1, 166);
      var portYs = [pT3, pT1, pT2, pB1].concat(cfg.recirc ? [pT4] : []);
      // Контур загрузки от узла у котла к патрубкам. Линия подачи начинается
      // на стояке узла загрузки (loadSx), обратка — на перемычке в общую
      // обратку (jx) — раньше обе шли от mLeft и висели с торцами в воздухе.
      var lx1 = tX - 22, lx2 = tX - 13;
      if (loadDown) {
        // От кранов группы линии идут вниз, двумя полосами вправо и
        // поднимаются к патрубкам змеевика в свободном канале слева от
        // гидрострелки. Кранов у бака нет — обе ветки отсекает сама группа.
        // Подача поднимается слева от гидрострелки и уходит к Т1 поверху —
        // выше воздухоотводчика. Обратка идёт к Т2 на уровне 150, а там
        // как раз воздухоотводчик стрелки с размером, поэтому её стояк
        // вынесен ПРАВЕЕ стрелки, в свободный канал перед стояком В1:
        // так линия не режет ни клапан, ни его выноску.
        var upS = hydroX - 17.5, upR = tX - 35.5;
        var hops = [secPair.supply, secPair.ret, mY.supply, mY.ret];
        o.push(ln(loadSx, bottomValveY + 2.5, loadSx, laneS, { c: COL.loadS, w: LW.pipe }));
        o.push(hpipe(loadSx, upS, laneS, COL.loadS));
        o.push(ln(loadRx, bottomValveY + 2.5, loadRx, laneR, { c: COL.loadR, w: LW.pipe }));
        o.push(hpipe(loadRx, upR, laneR, COL.loadR));
        o.push(vpipe(upS, laneS, pT1, COL.loadS, hops));
        o.push(hpipe(upS, tX - 1.5, pT1, COL.loadS));
        o.push(openArrow(tX - 3.2, pT1, 'right', COL.loadS));
        // Обратка поднимается ПРАВЕЕ гидрострелки, куда котловые магистрали и
        // вторичная пара не доходят, — обходить ей нечего. Единственное
        // пересечение — перемычка бака ГВС к стояку В1 на своей высоте.
        var dhwTeeY = (cfg.tankDhw && cfg.water !== false) ? (cfg.hydro ? 215 : 193) + 8.6 : null;
        o.push(vpipe(upR, laneR, pT2, COL.loadR, dhwTeeY !== null ? [dhwTeeY] : []));
        o.push(hpipe(upR, tX - 1.5, pT2, COL.loadR));
        o.push(openArrow(upR + 2.5, pT2, 'left', COL.loadR));
        // подпись — в просвете между полосами сразу за стояками группы:
        // правее начинаются отметки В1/Т3/Т4, туда её заводить нельзя
        // Подпись ставим ВЕРТИКАЛЬНО МЕЖДУ стояками пары: вправо она уходила
        // на 30 мм и налезала на соседнюю группу, как только справа от загрузки
        // появились отводы (снеготаяние). Между стояками пары ниже кранов пусто —
        // марок и стрелок у загрузки нет, там подпись никому не мешает.
        o.push(txtM(loadRx + PAIR_STEP / 2 - 1, 274, 'загрузка бойлера', { size: SZ.dia, rotate: -90 }));
      } else {
      o.push(hpipe(loadSx !== null ? loadSx : mLeft, lx1, mY.loadS, COL.loadS));
      o.push(hpipe(loadRx !== null ? loadRx : ((cfg.dhwReturnToBoiler && !cfg.fugas && loadRBoilerX !== null) ? loadRBoilerX : (hasLoad ? jx : mLeft)), lx2, mY.loadR, COL.loadR));
      o.push(diaH(lx1 - 2, mY.loadS, dia));
      o.push(diaH(lx1 - 2, mY.loadR, dia));
      o.push(vpipe(lx1, mY.loadS, pT1, COL.loadS, [mY.loadR, pB1]));
      // отсекающий кран на подаче загрузки у бойлера: без него для замены
      // бойлера пришлось бы сливать котловой контур
      o.push(hpipe(lx1, tX - 11.5, pT1, COL.loadS));
      o.push(ballValve(tX - 9, pT1, false));
      o.push(leader(tX - 9.9, pT1 - 1.1, coilThread));
      o.push(hpipe(tX - 6.5, tX - 1.5, pT1, COL.loadS));
      o.push(openArrow(tX - 3.2, pT1, 'right', COL.loadS));
      o.push(vpipe(lx2, mY.loadR, pT2, COL.loadR, [mY.loadS, pB1]));
      o.push(hpipe(lx2, lx2 + 2.8, pT2, COL.loadR));
      // кран по сечению линии загрузки; прежняя подпись 1/2" душила
      // бы весь расход загрузки бойлера
      o.push(ballValve(lx2 + 5.3, pT2, false));
      o.push(leader(lx2 + 4.4, pT2 - 1.1, coilThread));
      o.push(hpipe(lx2 + 7.8, tX - 1.5, pT2, COL.loadR));
      o.push(openArrow(lx2 + 2, pT2, 'left', COL.loadR));
      }
      o.push(tankPort(tX, pT1, COL.loadS, 'Т1'));
      o.push(tankPort(tX, pT2, COL.loadR, 'Т2'));
      o.push(tankPort(tX, pT3, COL.dhw, 'Т3'));
      o.push(tankPort(tX, pB1, COL.cold, 'В1'));
      if (cfg.recirc) o.push(tankPort(tX, pT4, COL.recirc, 'Т4'));

      // Стояк рециркуляции сдвинут с tX−21 на tX−17: на tX−21 он проходил
      // ровно сквозь пружину предохранительного клапана узла В1
      // При нижней разводке загрузки правее стрелки поднимается стояк
      // обратки бойлера — узел В1 и стояк рециркуляции сдвигаются вправо,
      // чтобы просвет до него был те же 9 мм, что между подачей и обраткой
      // насосной группы.
      var loadShift = loadDown ? 3.5 : 0;
      var bx1 = tX - 30 + loadShift, bx3 = tX - 17 + loadShift, bx2 = tX - 5.5;
      var yTopV = bottomValveY - 2.5;
      // В1: ввод холодной воды снизу. Порядок по потоку: кран → обратный
      // клапан → тройник расширительного бака ГВС → предохранительный
      // клапан → бойлер. Раньше тройник бака стоял ДО обратного клапана —
      // клапан отсекал бак от бойлера, и тепловое расширение сбрасывалось
      // предохранителем при каждом нагреве.
      if (cfg.water !== false) {
        var dtX = bx1 - 13.5, dtY = cfg.hydro ? 215 : 193;
        var checkY = cfg.tankDhw ? dtY + 16.6 : armY + 16.4;
        o.push(hpipe(bx1, tX - 1.5, pB1, COL.cold));
        if (armY > pB1) o.push(vpipe(bx1, pB1, armY, COL.cold, loadDown ? [] : [mY.loadS, mY.loadR]));
        o.push(ln(bx1, armY, bx1, armY + 6.4, { c: COL.cold, w: LW.pipe }));
        // предохранительный на отводе (сброс вниз), как на листе 2025-1209R
        o.push(hpipe(bx1, bx1 + 4.1, armY + 8.9, COL.cold));
        o.push(safetyValve(bx1 + 6.6, armY + 8.9, true));
        o.push(leader(bx1 + 5.6, armY + 7.8, safetyThread));
        // Дренажный кран бойлера — на том же узле В1, отвод вправо под
        // предохранительным клапаном: своего сливного патрубка у бойлера нет,
        // паспорт требует крана на обвязке (в смете — кран 3/4" НР/НР, 27.09.2026).
        var drY = armY + 16;
        o.push(hpipe(bx1, bx1 + 4.1, drY, COL.cold));
        o.push(ballValve(bx1 + 6.6, drY, false));
        o.push(leader(bx1 + 5.6, drY - 1.1, '3/4"'));
        // Подпись — под краном, а не правее: правее при рециркуляции идёт стояк Т4.
        o.push(txt(bx1 + 4.2, drY + 4.6, 'слив', { size: SZ.txt }));
        o.push(ln(bx1, armY + 6.4, bx1, checkY - 2.5, { c: COL.cold, w: LW.pipe }));
        o.push(checkValve(bx1, checkY, 'up'));
        // Узел В1 в смете собран на 3/4" при любом патрубке ХВС: у патрубка 1"
        // стоит муфта ВР 1" × НР 3/4". Подпись — по арматуре, а не по патрубку.
        o.push(leaderCheck(bx1, checkY, '3/4"'));
        o.push(ln(bx1, checkY + 2.5, bx1, yTopV, { c: COL.cold, w: LW.pipe }));
        o.push(ballValve(bx1, bottomValveY, true));
        o.push(leaderValve(bx1, bottomValveY, '3/4"'));
        o.push(diaV(bx1, bottomValveY - 7.2, sanDia));
        o.push(bottomMark(bx1, 'В1', 'up'));
        // расширительный бак ГВС — на своём отводе от В1, между обратным
        // клапаном и бойлером; при гидрострелке ниже, чтобы не задевать
        // её обвязку
        if (cfg.tankDhw) {
          o.push(expTank(dtX, dtY, '#00ffff', cfg.tankDhw + ' л.'));
          o.push(ln(dtX, dtY, dtX, dtY + 1.8, { c: COL.cold, w: LW.pipe }));
          o.push(ballValve(dtX, dtY + 4.3, true));
          o.push(leaderValve(dtX, dtY + 4.3, '3/4"'));
          o.push(ln(dtX, dtY + 6.8, dtX, dtY + 8.6, { c: COL.cold, w: LW.pipe }));
          o.push(hpipe(dtX, bx1, dtY + 8.6, COL.cold));
        }
      }
      // Т3: горячая вода к потребителю
      o.push(hpipe(bx2, tX - 1.5, pT3, COL.dhw));
      o.push(vpipe(bx2, pT3, yTopV, COL.dhw, portYs.filter(function (yy) { return yy !== pT3; })));
      o.push(ballValve(bx2, bottomValveY, true));
      o.push(leaderValve(bx2, bottomValveY, dhwThread));
      o.push(diaV(bx2, bottomValveY - 7.2, sanDia));
      o.push(bottomMark(bx2, 'Т3', 'down'));
      // Термостатический смесительный клапан ГВС на вертикали Т3: держит на разборе
      // 45–50 °C, подмешивая холодную, а бойлер остаётся на 60 °C против легионеллы.
      // Высота 200 выбрана по свободному коридору между стояками В1 и Т3 (177–229).
      // Линию подмеса от В1 тянуть через весь коридор нельзя — при рециркуляции она
      // пересекла бы стояк Т4, а перескоков у горизонталей здесь нет. Поэтому подвод
      // показан коротким отводом с подписью, как и узел подпитки на этом листе.
      if (cfg.dhwMix) {
        var mvY = 200;
        o.push(hpipe(bx2 - 9, bx2 - 3.13, mvY, COL.cold));
        o.push(valve3(bx2, mvY, 'therm', 'udl', 'r'));
        // Подпись левее стояка рециркуляции: при cfg.recirc он проходит по bx3,
        // и на -20,5 текст вставал к нему вплотную.
        o.push(txtM(bx2 - 22.5, mvY - 1.4, 'от В1', { size: SZ.txt }));
        o.push(leader(bx2 - 0.96, mvY - 4.4, cfg.dhwMix));
      }
      // Т4: рециркуляция — кран у бойлера (иначе замена насоса требует
      // слива бойлера), насос, обратный клапан, кран внизу. Арматура узла в
      // смете — 3/4" при любом патрубке (у патрубка 1" муфта ВР 1" × НР 3/4"),
      // поэтому подписи 3/4", а не размер патрубка (recircThread).
      if (cfg.recirc) {
        o.push(hpipe(bx3, tX - 1.5, pT4, COL.recirc));
        o.push(vpipe(bx3, pT4, 213.3, COL.recirc, loadDown ? [pT1, pT2, pB1] : [pT1, pB1, mY.loadR]));
        o.push(ballValve(bx3, 215.8, true));
        o.push(leaderValve(bx3, 215.8, '3/4"'));
        o.push(ln(bx3, 218.3, bx3, 223.1, { c: COL.recirc, w: LW.pipe }));
        o.push(pump(bx3, 226, 'up'));
        o.push(ln(bx3, 228.92, bx3, 230.5, { c: COL.recirc, w: LW.pipe }));
        o.push(checkValve(bx3, 233, 'up'));
        o.push(leaderCheck(bx3, 233, '3/4"'));
        o.push(ln(bx3, 235.5, bx3, yTopV, { c: COL.recirc, w: LW.pipe }));
        o.push(ballValve(bx3, bottomValveY, true));
        o.push(leaderValve(bx3, bottomValveY, '3/4"'));
        o.push(diaV(bx3, bottomValveY - 7.2, recDia));
        o.push(bottomMark(bx3, 'Т4', 'up'));
      }
    }

    // ── зоны гидравлики: прозрачные накладки для карточек на экране ──
    // Кладутся последними и поверх всего: попадание курсора в SVG решается
    // порядком отрисовки, и зона обязана лежать над линиями, которые накрывает.
    // На печати их нет — заливка прозрачная, обводки нет. Стили инлайном, а не
    // атрибутами: правило «.sheet-a3 rect{stroke:#000;fill:none}» из обёртки
    // листа иначе обвело бы каждую зону чёрным прямоугольником и сняло заливку,
    // а вместе с ней и попадание курсора.
    if (cfg.hyd) {
      var zone = function (tag, x0, y0, x1, y1, attrs) {
        return '<rect class="hyd-zone" data-hyd="' + tag + '"' + (attrs || '') +
          ' x="' + n(Math.min(x0, x1)) + '" y="' + n(Math.min(y0, y1)) +
          '" width="' + n(Math.abs(x1 - x0)) + '" height="' + n(Math.abs(y1 - y0)) +
          '" style="fill:rgba(0,0,0,0);stroke:none"/>';
      };
      var over = function (flag) { return flag ? ' data-hyd-over="1"' : ''; };
      var HP = cfg.hyd.parts || {};
      var trunkOver = cfg.hyd.overWhere === 'trunk';
      var tailOver = cfg.hyd.overWhere === 'beyond';
      var ufhOver = !!(cfg.hyd.ufh && cfg.hyd.ufh.vMax > cfg.hyd.ufh.vLimit);
      // Котлы: весь блок целиком — по нему показывают сопротивление
      // теплообменника и общие числа кольца.
      bXs.forEach(function (bx, bi) {
        if (bx == null || !blocks[bi]) return;
        o.push(zone('boiler', bx, bTop, bx + blocks[bi].w, bBot, ' data-hyd-b="' + bi + '"'));
      });
      // Бойлер: зона по корпусу бака. Рисуется он далеко не всегда (только
      // при косвенном нагреве), поэтому координаты берём с самого рисунка —
      // так зона не разъедется, если компоновку подвинут.
      if (cfg.hyd.dhw && tankBox) {
        o.push(zone('dhw', tankBox.x, tankBox.y, tankBox.x + tankBox.w, tankBox.y + tankBox.h));
      }
      // Отводы коллектора: полоса вдоль стояка от гребёнки до марки внизу.
      // Ширина 8 мм при шаге стояков 9 — между соседями остаётся миллиметр.
      // Уже делать нельзя: под сметой лист ужат до ~560 px, и на 5 мм полоса
      // выходила шириной в шесть пикселей — попасть в неё мышью не получалось.
      taps.forEach(function (t, i) {
        if (!t.hyd || t.snow || t.hyd === 'snow') return;
        var x = tapXs[i], y0 = srcY[t.from];
        if (x == null || y0 == null) return;
        o.push(zone(t.hyd === 'tp' ? 'ufh' : 'trunk', x - 4, y0 - 2, x + 4, 274,
          ' data-hyd-mark="' + (t.mark || '') + '" data-hyd-i="' + (t.hydI || 0) + '"' +
          over(t.hyd === 'tp' ? ufhOver : trunkOver)));
        // Узкое место за границей листа — отмечаем низ контура, от крана до
        // марки: дальше труба уходит к потребителю, где оно и находится.
        if (tailOver && t.hyd === 'rad') {
          o.push('<rect class="hyd-tail" x="' + n(x - 4) + '" y="248" width="8" height="26"' +
            ' style="fill:rgba(0,0,0,0);stroke:none"/>');
        }
      });
    }

    return o.join('');
  }

  // ─── Схема подключения автоматики (контроллер Thermatic 3001) ──────────
  // Схема-выноска в стиле фирменных схем подключения ZONT: прибор нарисован
  // плоско, с лицевой панели, с настоящими клеммными колодками; от каждой
  // ЗАДЕЙСТВОВАННОЙ клеммы отходит жгут к оборудованию, нарисованному тоже
  // плоско (без фотографий — они не читаются линиями).
  //
  // Пересечений жил нет по построению, и держится это на трёх правилах:
  //   • жгуты разложены по «этажам»: чем левее клемма, тем ближе её этаж
  //     к прибору (справа — зеркально). Тогда стояк соседнего жгута никогда
  //     не пересекает горизонталь нижнего;
  //   • внутри жгута жилы — параллельные Г-образные трассы с одинаковым шагом,
  //     но порядок их зависит от направления: жила из дальней клеммы обязана
  //     свернуть раньше ближних. У жгутов «вверх и налево» и «вниз и направо»
  //     порядок обратный, вместе с ними разворачивается и колодка потребителя;
  //   • приборы на одной шине RS-485 сидят шлейфом друг за другом, а не каждый
  //     своим жгутом от общих клемм.
  // Связи, которым при любой раскладке пришлось бы идти через весь чертёж
  // (шина щита, перемычка «Общ» ← L, планка тёплого пола), показаны не жилой,
  // а отводом с подписью или меткой.
  //
  // Назначение и символы клемм — карта клемм техдокументации
  // (Приложение 4 ML.TD.STOUT.3001.01): ∇ — клемма насоса, ◄/► — увеличение
  // и уменьшение прямого потока через смеситель, ⏚ — общий провод, L/N — фаза
  // и нейтраль 220 В, НР/Общ/НЗ — контакты релейных выходов.
  //
  // items — артикулы и названия подобранных позиций (см. renderAutomationScheme).
  // Возвращает { svg, w, h } — svg без обёртки, viewBox собирает вызывающий.
  // ── палитра и графика схем подключения автоматики ─────────────────────
  // Общие для обоих контроллеров: приборы разные, а язык чертежа один —
  // цвет жилы означает одно и то же на обеих схемах, и значок насоса не
  // должен отличаться от листа к листу.
  var INK = '#334155', FACE = '#E9EDF2', FACE2 = '#F8FAFC';
  var CL = '#DC2626', CN = '#2563EB', CPE1 = '#EAB308', CPE2 = '#16A34A';
  var CSIG = '#64748B', COPEN = '#B45309', CCLOSE = '#1F2937';
  var CBUS = '#0D9488', CBUS2 = '#F59E0B';
  var CRS = ['#1F2937', '#16A34A', '#EAB308', '#DC2626']; // ⏚ B A +12В
  var TC_ = { or: '#F97316', bl: '#2563EB', rd: '#DC2626', wh: '#F1F5F9', dk: '#475569', tl: '#0D9488', gy: '#C4CAD3', bk: '#2B3139' };
  var P = 3.2;      // шаг клемм (общий для прибора и потребителей)

  function cut(s, k) { s = String(s || ''); return s.length > k ? s.slice(0, k - 1) + '…' : s; }
  function seg(pts, c, w, dash) {
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + n(p[0]) + ',' + n(p[1]); }).join(' ');
    return '<path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="' + (w || 0.5) +
      '" stroke-linejoin="round" stroke-linecap="round"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>';
  }
  function peSeg(pts) { return seg(pts, CPE1, 0.55) + seg(pts, CPE2, 0.55, '1.4 1.4'); }
  // dir = -1 разворачивает знак вверх: у жгутов, где порядок жил обратный,
  // клемма ⏚ оказывается не внизу колодки потребителя, а вверху.
  function gndSym(x, y, dir) {
    dir = dir || 1;
    return seg([[x, y - 1.6 * dir], [x, y]], CPE2, 0.5) +
      seg([[x - 1.7, y], [x + 1.7, y]], CPE2, 0.5) +
      seg([[x - 1.1, y + 0.8 * dir], [x + 1.1, y + 0.8 * dir]], CPE2, 0.5) +
      seg([[x - 0.5, y + 1.6 * dir], [x + 0.5, y + 1.6 * dir]], CPE2, 0.5);
  }
  // ── реалистичные клеммные колодки: общий язык для всех схем автоматики ──
  // Вид и цвета — по фотографиям и паспортам приборов (STOUT Thermatic 3001,
  // стр. 10; STOUT STE-3050, стр. 3). Нужные клеммы показаны ярко и в зелёной
  // подсветке — сюда заводят провод; остальные тусклые, как на плате планки.
  function shade(hex, k) {            // k > 0 — к белому, k < 0 — к чёрному
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return hex;
    var v = [0, 2, 4].map(function (i) { return parseInt(m[1].slice(i, i + 2), 16); });
    return '#' + v.map(function (c) {
      var r = Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
      return ('0' + r.toString(16)).slice(-2);
    }).join('');
  }
  var HALO = { f: '#BBF7D0', c: '#22C55E', w: 0.5 };
  /**
   * Съёмная винтовая колодка Thermatic: цветной корпус с бликом, перегородки
   * между контактами, шлицевые винты и тёмное гнездо провода со стороны жилы.
   * Высота 6,4 мм, шаг контактов P; центр винта — на 3,2 мм от верха, туда же
   * приходит жила. groups — как колодка разбита на самостоятельные части
   * («Входы термостатов» — три отдельные колодки по два контакта).
   */
  function pluggable(x, y, nn, col, on, up, groups, pitch) {
    var h = 6.4, pp = pitch || P, pale = on === 'pale', lit = on === true;
    var s = '<g' + (lit || pale ? '' : ' opacity="0.4"') + '>';
    var parts = groups || [nn], k0 = 0, bound = {};
    parts.forEach(function (g) {
      bound[k0 + g] = true;
      var gx = x + k0 * pp, gw = g * pp - (parts.length > 1 ? 0.6 : 0);
      if (lit) s += rrect(gx - 0.9, y - 0.9, gw + 1.8, h + 1.8, 1.1, HALO);
      if (pale) s += rrect(gx - 0.6, y - 0.6, gw + 1.2, h + 1.2, 1.0, { f: '#DCFCE7', c: '#86C7A0', w: 0.4 });
      s += rrect(gx, y, gw, h, 0.7, { f: shade(col, -0.35), c: shade(col, -0.6), w: 0.3 });
      s += rrect(gx + 0.25, y + 0.25, gw - 0.5, h - 0.5, 0.5, { f: col });
      s += rrect(gx + 0.25, y + 0.25, gw - 0.5, 1.2, 0.5, { f: shade(col, 0.38) });
      k0 += g;
    });
    for (var i = 0; i < nn; i++) {
      var cx = x + pp / 2 + i * pp;
      if (i > 0 && !bound[i]) {
        s += ln(x + i * pp, y + 0.4, x + i * pp, y + h - 0.4, { c: shade(col, -0.45), w: 0.25 });
      }
      s += rrect(cx - 0.95, up ? y + 0.35 : y + h - 1.85, 1.9, 1.5, 0.3, { f: '#111827' });   // гнездо провода
      s += circle(cx, y + 3.2, 1.0, { f: '#E5E7EB', c: '#475569', w: 0.3 });                  // головка винта
      s += ln(cx - 0.62, y + 3.2, cx + 0.62, y + 3.2, { c: '#475569', w: 0.3 });              // шлиц
    }
    return s + '</g>';
  }
  /** Колодка потребителя: серая пружинная, провод входит с той стороны, откуда он идёт. */
  function vstrip(x, cy, labels, side) {
    var m = labels.length, h = m * P + 1.6, bw = 6.4, s = '';
    s += rrect(x - bw / 2 - 0.9, cy - h / 2 - 0.9, bw + 1.8, h + 1.8, 1.2, HALO);
    s += rrect(x - bw / 2, cy - h / 2, bw, h, 0.9, { f: '#B8B8BC', c: '#6B7280', w: 0.35 });
    s += rrect(x + side * (bw / 2 - 1.4) - 0.7, cy - h / 2, 1.4, h, 0.5, { f: '#9A9AA0' });
    labels.forEach(function (L, i) {
      var y = cy + (i - (m - 1) / 2) * P;
      s += circle(x - side * 0.5, y, 1.15, { f: '#27272A', c: '#15803D', w: 0.4 });          // гнездо провода
      s += rrect(x + side * 1.2 - 0.5, y - 0.9, 1.0, 1.8, 0.2, { f: '#D4D4D8', c: '#6B7280', w: 0.2 }); // рычажок
      s += txt(x + side * 5.6, y + 0.7, L, { size: 1.95, anchor: side > 0 ? 'start' : 'end' });
    });
    return s;
  }

  // ── плоские значки оборудования ──
  function icoPump(cx, cy, s) {
    return circle(cx - s * 0.1, cy, s * 0.34, { f: '#fff', c: INK, w: 0.5 }) +
      rrect(cx + s * 0.1, cy - s * 0.24, s * 0.4, s * 0.48, 0.8, { f: '#CBD5E1', c: INK, w: 0.5 }) +
      pline([[cx - s * 0.28, cy - s * 0.16], [cx + s * 0.04, cy], [cx - s * 0.28, cy + s * 0.16]], { f: INK, c: INK, w: 0.4, close: true }) +
      seg([[cx - s * 0.5, cy], [cx - s * 0.44, cy]], INK, 0.5);
  }
  function icoServo(cx, cy, s) {
    var vy = cy + s * 0.22;
    return rrect(cx - s * 0.3, cy - s * 0.5, s * 0.6, s * 0.42, 0.8, { f: '#CBD5E1', c: INK, w: 0.5 }) +
      txt(cx, cy - s * 0.19, 'М', { size: s * 0.3, anchor: 'middle' }) +
      seg([[cx, cy - s * 0.08], [cx, cy + s * 0.04]], INK, 0.5) +
      pline([[cx - s * 0.34, vy - s * 0.22], [cx - s * 0.34, vy + s * 0.22], [cx, vy]], { f: '#fff', c: INK, w: 0.5, close: true }) +
      pline([[cx + s * 0.34, vy - s * 0.22], [cx + s * 0.34, vy + s * 0.22], [cx, vy]], { f: '#fff', c: INK, w: 0.5, close: true }) +
      pline([[cx, vy], [cx + s * 0.2, vy + s * 0.4], [cx - s * 0.2, vy + s * 0.4]], { f: '#fff', c: INK, w: 0.5, close: true });
  }
  // Котёл: корпус с дисплеем и патрубками, в середине — знак вида топлива.
  // Газ — синее пламя, электричество — жёлтая молния (как на схемах STOUT).
  function icoBoiler(cx, cy, s, gas) {
    var g = rrect(cx - s * 0.36, cy - s * 0.5, s * 0.72, s, 1.2, { f: FACE2, c: INK, w: 0.55 }) +
      rrect(cx - s * 0.24, cy - s * 0.34, s * 0.48, s * 0.18, 0.5, { f: '#CBD5E1', c: INK, w: 0.4 }) +
      seg([[cx - s * 0.2, cy + s * 0.5], [cx - s * 0.2, cy + s * 0.62]], INK, 0.5) +
      seg([[cx + s * 0.2, cy + s * 0.5], [cx + s * 0.2, cy + s * 0.62]], INK, 0.5);
    var y0 = cy + s * 0.08;   // центр знака — ниже дисплея
    if (gas) {
      g += path('M' + n(cx) + ',' + n(y0 - s * 0.28) +
        ' C' + n(cx + s * 0.19) + ',' + n(y0 - s * 0.06) + ' ' + n(cx + s * 0.19) + ',' + n(y0 + s * 0.07) + ' ' + n(cx + s * 0.1) + ',' + n(y0 + s * 0.18) +
        ' C' + n(cx + s * 0.04) + ',' + n(y0 + s * 0.25) + ' ' + n(cx - s * 0.04) + ',' + n(y0 + s * 0.25) + ' ' + n(cx - s * 0.1) + ',' + n(y0 + s * 0.18) +
        ' C' + n(cx - s * 0.19) + ',' + n(y0 + s * 0.07) + ' ' + n(cx - s * 0.19) + ',' + n(y0 - s * 0.06) + ' ' + n(cx) + ',' + n(y0 - s * 0.28) + ' Z',
        { f: '#2563EB', c: '#1E3A8A', w: 0.3 });
      // внутренний язык пламени — светлее, чтобы знак читался и мелко
      g += path('M' + n(cx) + ',' + n(y0 - s * 0.06) +
        ' C' + n(cx + s * 0.09) + ',' + n(y0 + s * 0.04) + ' ' + n(cx + s * 0.07) + ',' + n(y0 + s * 0.14) + ' ' + n(cx) + ',' + n(y0 + s * 0.18) +
        ' C' + n(cx - s * 0.07) + ',' + n(y0 + s * 0.14) + ' ' + n(cx - s * 0.09) + ',' + n(y0 + s * 0.04) + ' ' + n(cx) + ',' + n(y0 - s * 0.06) + ' Z',
        { f: '#93C5FD' });
    } else {
      g += path('M' + n(cx + s * 0.09) + ',' + n(y0 - s * 0.28) +
        ' L' + n(cx - s * 0.15) + ',' + n(y0 + s * 0.04) +
        ' L' + n(cx - s * 0.01) + ',' + n(y0 + s * 0.04) +
        ' L' + n(cx - s * 0.09) + ',' + n(y0 + s * 0.28) +
        ' L' + n(cx + s * 0.16) + ',' + n(y0 - s * 0.05) +
        ' L' + n(cx + s * 0.02) + ',' + n(y0 - s * 0.05) + ' Z',
        { f: '#FACC15', c: '#A16207', w: 0.3 });
    }
    return g;
  }
  function icoProbe(cx, cy, s) {
    return rrect(cx - s * 0.14, cy - s * 0.36, s * 0.28, s * 0.72, s * 0.14, { f: '#EFF6FF', c: '#3B82F6', w: 0.5 }) +
      seg([[cx - s * 0.07, cy - s * 0.12], [cx + s * 0.07, cy - s * 0.12]], '#3B82F6', 0.4) +
      seg([[cx - s * 0.07, cy + s * 0.04], [cx + s * 0.07, cy + s * 0.04]], '#3B82F6', 0.4) +
      seg([[cx, cy - s * 0.36], [cx, cy - s * 0.5]], CSIG, 0.5);
  }
  function icoPanel(cx, cy, s) {
    return rrect(cx - s * 0.44, cy - s * 0.34, s * 0.88, s * 0.68, 1, { f: FACE2, c: INK, w: 0.55 }) +
      rrect(cx - s * 0.32, cy - s * 0.22, s * 0.64, s * 0.3, 0.5, { f: '#DBEAFE', c: INK, w: 0.4 }) +
      circle(cx - s * 0.18, cy + s * 0.19, s * 0.05, { f: INK }) +
      circle(cx, cy + s * 0.19, s * 0.05, { f: INK }) +
      circle(cx + s * 0.18, cy + s * 0.19, s * 0.05, { f: INK });
  }
  function icoPuck(cx, cy, s) {
    return circle(cx, cy, s * 0.36, { f: FACE2, c: INK, w: 0.55 }) +
      circle(cx, cy, s * 0.16, { f: '#CBD5E1', c: INK, w: 0.4 });
  }
  function icoDrop(cx, cy, s) {
    return path('M' + n(cx) + ',' + n(cy - s * 0.4) + ' C' + n(cx + s * 0.34) + ',' + n(cy) + ' ' +
      n(cx + s * 0.26) + ',' + n(cy + s * 0.34) + ' ' + n(cx) + ',' + n(cy + s * 0.34) +
      ' C' + n(cx - s * 0.26) + ',' + n(cy + s * 0.34) + ' ' + n(cx - s * 0.34) + ',' + n(cy) + ' ' +
      n(cx) + ',' + n(cy - s * 0.4) + ' Z', { f: '#DBEAFE', c: '#3B82F6', w: 0.5 });
  }
  function icoValveAct(cx, cy, s) {
    var vy = cy + s * 0.24;
    return rrect(cx - s * 0.28, cy - s * 0.5, s * 0.56, s * 0.4, 0.8, { f: '#CBD5E1', c: INK, w: 0.5 }) +
      txt(cx, cy - s * 0.21, 'М', { size: s * 0.28, anchor: 'middle' }) +
      seg([[cx, cy - s * 0.1], [cx, cy + s * 0.02]], INK, 0.5) +
      circle(cx, vy, s * 0.22, { f: '#fff', c: INK, w: 0.5 }) +
      seg([[cx - s * 0.46, vy], [cx - s * 0.22, vy]], INK, 0.6) +
      seg([[cx + s * 0.22, vy], [cx + s * 0.46, vy]], INK, 0.6);
  }
  function icoBreaker(cx, cy, s) {
    return rrect(cx - s * 0.3, cy - s * 0.5, s * 0.6, s, 0.8, { f: FACE2, c: INK, w: 0.55 }) +
      rrect(cx - s * 0.14, cy - s * 0.26, s * 0.28, s * 0.34, 0.4, { f: INK }) +
      txt(cx, cy + s * 0.34, 'C10', { size: s * 0.22, anchor: 'middle' });
  }
  // Бойлер косвенного нагрева: бак со змеевиком и гильзой под датчик.
  function icoTank(cx, cy, s) {
    return rrect(cx - s * 0.28, cy - s * 0.5, s * 0.56, s, s * 0.26, { f: FACE2, c: INK, w: 0.55 }) +
      seg([[cx - s * 0.12, cy - s * 0.18], [cx + s * 0.12, cy - s * 0.06],
        [cx - s * 0.12, cy + s * 0.06], [cx + s * 0.12, cy + s * 0.18]], '#3B82F6', 0.5) +
      seg([[cx + s * 0.28, cy - s * 0.3], [cx + s * 0.42, cy - s * 0.3]], INK, 0.5) +
      seg([[cx + s * 0.28, cy + s * 0.3], [cx + s * 0.42, cy + s * 0.3]], INK, 0.5);
  }
  function icoModule(cx, cy, s, ant) {
    return rrect(cx - s * 0.42, cy - s * 0.34, s * 0.84, s * 0.68, 0.8, { f: FACE2, c: INK, w: 0.55 }) +
      rrect(cx - s * 0.3, cy - s * 0.2, s * 0.6, s * 0.16, 0.3, { f: '#CBD5E1' }) +
      (ant ? seg([[cx, cy - s * 0.34], [cx, cy - s * 0.62]], INK, 0.5) + circle(cx, cy - s * 0.66, s * 0.06, { f: INK }) : '') +
      circle(cx - s * 0.2, cy + s * 0.16, s * 0.05, { f: '#22C55E' });
  }


  function automation(tc, items) {
    tc = tc || {};
    items = items || {};
    var nm = items.names || {};
    var o = [], W = 420;

    var LS = 19;      // шаг «этажей» выносок
    // Корпус выше, чем нужно одним клеммникам: на лицевой панели помещаются
    // экран с кнопками, как на приборе, и вертикальные подписи силовых клемм.
    // Высота подобрана так, чтобы экран встал ровно по центру панели и при
    // этом не задел подписи — они занимают нижние ~15 мм поля.
    // Пропорции сняты с фотографии прибора: лицевая панель ≈ 2,6:1, модуль
    // экрана ≈ 41 % её ширины и 54 % высоты, сам экран ≈ 1,5:1. Высота
    // корпуса из этого и получается: 75 мм панели + два клеммных ряда.
    var CX = 108, CW = 204, CH = 96;
    var DXL = 76, DXR = 344;          // где стоят колодки потребителей
    var ICL = 56, ICR = 364, ICO = 13; // центры и размер плоских значков


    // ── описание клеммных блоков прибора (порядок — как на корпусе) ──
    var TOP = [
      { k: 'tn1', n: 2, c: TC_.or, t: 'ТН-1' }, { k: 'tn2', n: 2, c: TC_.bl, t: 'ТН-2' },
      { k: 'tn3', n: 2, c: TC_.rd, t: 'ТН-3' }, { k: 'boiler', n: 2, c: TC_.wh, t: 'Бойлер' },
      { k: 'out', n: 2, c: TC_.gy, t: 'Улица' }, { k: 'casc', n: 2, c: TC_.bk, t: 'Каскад' },
      { k: 'ain', n: 3, c: TC_.gy, t: 'Входы' }, { k: 'vext', n: 3, c: TC_.tl, t: '+5/12В' },
      { k: 'thr', n: 6, c: TC_.gy, t: 'Термостаты', groups: [2, 2, 2] }, { k: 'ow', n: 2, c: TC_.gy, t: '1-Wire' },
      // Ethernet — не клеммник, а гнездо RJ45; по карте клемм стоит в том же
      // ряду, что и 1-Wire с RS-485 (Приложение 4), поэтому и рисуется здесь,
      // а не на лицевой панели: на приборе её лицевая сторона пустая
      { k: 'eth', n: 2, c: TC_.wh, t: 'Ethernet', jack: true },
      { k: 'rs', n: 4, c: TC_.gy, t: 'RS-485' }, { k: 'csh1', n: 2, c: TC_.bk, t: 'ЦШ1' },
      { k: 'csh2', n: 2, c: TC_.bk, t: 'ЦШ2' }
    ];
    var BOT = [
      { k: 'ko1p', n: 2, c: TC_.or, t: 'КО-1 Насос' }, { k: 'ko1m', n: 3, c: TC_.or, t: 'КО-1 Смеситель' },
      { k: 'ko2p', n: 2, c: TC_.bl, t: 'КО-2 Насос' }, { k: 'ko2m', n: 3, c: TC_.bl, t: 'КО-2 Смеситель' },
      { k: 'ko3p', n: 2, c: TC_.rd, t: 'КО-3 Насос' }, { k: 'ko3m', n: 3, c: TC_.rd, t: 'КО-3 Смеситель' },
      { k: 'dhwrc', n: 2, c: TC_.wh, t: 'ГВС РЦ' }, { k: 'dhwcn', n: 2, c: TC_.wh, t: 'ГВС ЦН' },
      { k: 'leak', n: 3, c: TC_.tl, t: 'Кран протечки' }, { k: 'trace', n: 3, c: TC_.tl, t: 'Насос трассы' },
      { k: 'rel1', n: 3, c: TC_.bk, t: 'Реле котёл 1' }, { k: 'rel2', n: 3, c: TC_.bk, t: 'Реле котёл 2' },
      { k: 'pwr', n: 2, c: TC_.tl, t: 'Питание 220В' }
    ];
    // раскладка блоков по ширине корпуса
    function layout(list) {
      var total = 0;
      list.forEach(function (b) { total += b.n * P; });
      var gap = (CW - 14 - total) / (list.length - 1);
      if (gap < 1.6) gap = 1.6;
      var x = CX + 7, map = {};
      list.forEach(function (b) {
        b.x = x; b.cx = x + b.n * P / 2; map[b.k] = b; x += b.n * P + gap;
      });
      return map;
    }
    var T = layout(TOP), B = layout(BOT);

    // ── что подключено ──
    var used = {};
    var topL = [], topR = [], botL = [], botR = [];

    var ntcMap = { 'ТН-1': 'tn1', 'ТН-2': 'tn2', 'ТН-3': 'tn3', 'Бойлер': 'boiler', 'Улица': 'out', 'Каскад': 'casc' };
    (tc.ntc || []).forEach(function (s) {
      var i = s.indexOf(' — '), term = i > 0 ? s.slice(0, i) : s, desc = i > 0 ? s.slice(i + 3) : '';
      var k = ntcMap[term]; if (!k) return;
      // «полярности нет» вынесено в легенду — в подписи оно не помещалось
      // в отведённое поле и наезжало на значок
      topL.push({
        blk: T[k], wires: [CSIG, '#94A3B8'], clamps: ['1', '2'], ico: icoProbe,
        title: 'Датчик NTC «' + term + '»', sub: cut(desc, 32)
      });
    });
    if (tc.leakQty > 0) topL.push({
      blk: T.ain, wires: [CSIG, '#94A3B8'], clamps: ['1', '⏚'], ico: icoDrop,
      title: 'Датчики протечки × ' + tc.leakQty, sub: 'шлейф на аналоговый вход «1»'
    });
    // Двухпозиционные термостаты сидят на «Входах термостатов» сухим
    // контактом — своя пара клемм на каждый контур КО-1…КО-3. Раньше при
    // выборе «Термостат» с сухим контактом на схеме не появлялось ничего.
    var dryUsed = 0;
    if (tc.airOn && tc.airKind === 'dry' && tc.airQty > 0) {
      var dq = Math.min(tc.airQty, tc.dryInputs || 3);
      for (var q = 0; q < dq; q++) topL.push({
        blk: T.thr, clampOffset: q * 2, wires: [CSIG, '#94A3B8'], clamps: ['1', '2'],
        ico: icoPanel, title: 'Термостат ' + ((tc.circuits || [])[q] ? (tc.circuits[q].name) : ('вход ' + (q + 1))),
        sub: cut(nm.air || 'сухой контакт (ON/OFF)', 30)
      });
      dryUsed = dq;
    }
    // Датчик осадков снеготаяния приходит на такой же «Вход термостата», но
    // ЧЕРЕЗ РЕЛЕ ВРЕМЕНИ. По техдокументации (п. 7.9) контур запрашивает тепло
    // при РАЗОМКНУТЫХ клеммах, а у датчика контакт нормально разомкнутый —
    // напрямую логика перевернулась бы. То же реле держит постпрогрев: штатный
    // «Выбег ЦН» контроллера ограничен 120 секундами. Питание датчика (12 В)
    // идёт мимо контроллера, поэтому в выноске только сигнальная цепь.
    // Вход берём следующий за занятыми комнатными термостатами.
    if (tc.snowSensor && dryUsed < (tc.dryInputs || 3)) {
      var snowKo = (tc.circuits || []).filter(function (c) { return c.src === 'snow'; })[0];
      topL.push({
        blk: T.thr, clampOffset: dryUsed * 2, wires: [CSIG, '#94A3B8'], clamps: ['1', '2'],
        ico: icoDrop, title: 'Датчик осадков' + (snowKo ? ' — ' + snowKo.name : ''),
        sub: 'через реле времени · режим «Термостат» · постпрогрев 2–8 ч'
      });
    }

    var rsDev = [];
    if (tc.panel) rsDev.push({ ico: icoPanel, title: 'Панель управления', sub: cut(nm.panel || 'МЛ-753', 34) });
    // Радиоприборы провода к контроллеру не имеют — их держит радиомодуль,
    // поэтому они уходят в его подпись, а не отдельной выноской «в никуда»
    var radioAir = (tc.airOn && tc.airQty > 0 && tc.airDevice && tc.airDevice.link === 'radio');
    if (tc.needRadio) rsDev.push({
      ico: function (a, b, c) { return icoModule(a, b, c, true); }, title: 'Радиомодуль',
      sub: radioAir ? ((tc.airKind === 'thermostat' ? 'термостаты' : 'датчики') + ' × ' + tc.airQty + ' по радио, 868 МГц')
        : cut(nm.radio || 'МЛ-590, 868 МГц', 34)
    });
    (tc.expansion || []).forEach(function (e) {
      rsDev.push({ ico: icoModule, title: 'Блок расширения ' + (e.id === 'ML00007406' ? 'EX-108' : 'EX-77') + (e.qty > 1 ? ' × ' + e.qty : ''), sub: '+' + (e.circuits * (e.qty || 1)) + ' контура' });
    });
    if (tc.airOn && tc.airKind !== 'dry' && tc.airQty > 0 && !radioAir)
      rsDev.push({
        ico: tc.airKind === 'thermostat' ? icoPanel : icoPuck,
        title: (tc.airKind === 'thermostat' ? 'Комнатные термостаты × ' : 'Датчики воздуха × ') + tc.airQty,
        sub: cut(nm.air || 'по шине RS-485', 34)
      });
    if (rsDev.length) {
      // все приборы RS-485 сидят на одной шине — показываем шлейфом от одной клеммы
      rsDev.forEach(function (d, i) {
        topR.push({
          blk: T.rs, wires: CRS, clamps: ['⏚', 'B', 'A', '+12'], ico: d.ico,
          title: d.title, sub: d.sub, chain: i > 0
        });
      });
    }

    // Котлов в смете может быть больше двух, а котловых каналов у контроллера
    // ровно два. Тот, кому канала не досталось (iface 'own'), живёт на своей
    // автоматике — проводов к прибору у него нет, и на схеме его быть не должно.
    var boilers = (tc.boilers || []).filter(function (b) { return b.iface !== 'own'; }).slice(0, 2);
    boilers.forEach(function (b, i) {
      var gas = b.kind === 'gas';
      var dev = {
        ico: function (a, c, s) { return icoBoiler(a, c, s, gas); },
        title: 'Котёл ' + (i + 1) + ' — ' + (gas ? 'газовый' : 'электрический'),
        sub: cut(nm['boiler' + i] || '', 20)
      };
      if (b.iface === 'digital') topR.push({
        blk: T[i === 0 ? 'csh1' : 'csh2'], wires: [CBUS, CBUS2], clamps: ['A', 'B'],
        // Плата цифровых шин — отдельная позиция сметы (одна на котёл),
        // поэтому она нарисована прибором в разрыве шины, а не упомянута
        // текстом: по схеме должно быть видно, что её надо купить и куда
        // поставить.
        inline: 'Плата ЦШ',
        ico: dev.ico, title: dev.title, sub: dev.sub || 'цифровая шина (OpenTherm/E-Bus)'
      });
      else botR.push({
        blk: B[i === 0 ? 'rel1' : 'rel2'], wires: [CCLOSE, '#6B7280'], clamps: ['T', 'T'],
        ico: dev.ico, title: dev.title, sub: (dev.sub ? dev.sub + ' · ' : '') + 'клеммы термостата'
      });
    });

    (tc.circuits || []).slice(0, 3).forEach(function (c, i) {
      var mix = c.type === 'mix', kind = c.src === 'ufh' ? 'тёплый пол' : c.src === 'snow' ? 'снеготаяние' : 'радиаторы';
      var grp = cut(mix ? (nm.mixGroup || 'насосная группа со смесителем') : (nm.dirGroup || 'прямая насосная группа'), 32);
      botL.push({
        blk: B[['ko1p', 'ko2p', 'ko3p'][i]], wires: [CL, CN], clamps: ['L', 'N', '⏚'], pe: true,
        ico: icoPump, title: 'Насос ' + c.name + ' — ' + kind, sub: grp
      });
      if (mix) botL.push({
        blk: B[['ko1m', 'ko2m', 'ko3m'][i]], wires: [COPEN, CCLOSE, CN], clamps: ['◄', '►', 'N', '⏚'], pe: true,
        ico: icoServo, title: 'Сервопривод смесителя ' + c.name, sub: 'на той же насосной группе'
      });
    });
    if (tc.dhw === 'boiler') botR.push({
      blk: B.dhwrc, wires: [CL, CN], clamps: ['L', 'N', '⏚'], pe: true,
      ico: icoPump, title: 'Насос загрузки бойлера', sub: cut(nm.dhwPump || 'из обвязки бойлера', 34)
    });
    if (tc.recirc) botR.push({
      blk: B.dhwcn, wires: [CL, CN], clamps: ['L', 'N', '⏚'], pe: true,
      ico: icoPump, title: 'Насос рециркуляции ГВС', sub: cut(nm.recircPump || 'линия Т4', 34)
    });
    if (tc.leakQty > 0 && tc.leakValve) botR.push({
      blk: B.leak, wires: [CL], clamps: ['L', 'N', '⏚'], pe: true, nStub: true, jumper: true,
      ico: icoValveAct, title: 'Кран защиты от протечки',
      sub: tc.leakSolenoid ? cut(nm.leakValve || 'соленоидный клапан 230 В', 34)
        : 'кран зональный + сервопривод (комплект)'
    });
    botR.push({
      blk: B.pwr, wires: [CL, CN], clamps: ['L', 'N'], ico: icoBreaker,
      title: 'Питание ~220 В, 50 Гц', sub: 'через автоматический выключатель C10'
    });

    // ── этажи: чем левее клемма, тем ближе этаж (справа — зеркально) ──
    topL.sort(function (a, b) { return a.blk.cx - b.blk.cx; });
    botL.sort(function (a, b) { return a.blk.cx - b.blk.cx; });
    topR.sort(function (a, b) { return b.blk.cx - a.blk.cx; });
    botR.sort(function (a, b) { return b.blk.cx - a.blk.cx; });
    var nTop = Math.max(topL.length, topR.length, 1);
    var nBot = Math.max(botL.length, botR.length, 1);

    var CY = 26 + (nTop - 1) * LS;
    var CB = CY + CH;
    // Автоматика тёплого пола вынесена на свой лист (ufhScheme): это
    // отдельная система, и в смете её картинка стоит над разделом 4.3.
    // Здесь остаётся только метка «А» — ссылка на неё у клемм термостатов.
    var ufh = items.ufh && (items.ufh.blocks || items.ufh.stats) ? items.ufh : null;
    // ── блоки расширения: контуры сверх трёх ──────────────────────────────
    // У контроллера три пары клеммников КО-1…КО-3, и четвёртый контур на них
    // уже не садится — он физически сидит на блоке EX-108 или EX-77. Раньше
    // плакат про такие контуры писал только «на блоке расширения EX»: куда
    // тянуть провода насоса и привода, монтажник не видел вовсе. Считаем
    // раскладку ДО расчёта высоты листа — блоки рисуются под нижними
    // выносками, и лист под них удлиняется.
    var EX_ROW_H = 30;
    function planExpansion() {
      var rest = (tc.circuits || []).slice(3);
      if (!rest.length) return { units: [], h: 0 };
      var units = [], k = 0;
      (tc.expansion || []).forEach(function (e) {
        for (var q = 0; q < (e.qty || 1) && k < rest.length; q++) {
          var take = rest.slice(k, k + (e.circuits || 1));
          k += take.length;
          if (take.length) units.push({
            name: 'Блок расширения ' + (e.id === 'ML00007406' ? 'EX-108' : 'EX-77'),
            no: q + 1, multi: (e.qty || 1) > 1, circuits: take
          });
        }
      });
      // Контуры без блока в смете (ручная правка количества) не теряем:
      // показываем их отдельным безымянным модулем, иначе провода повиснут.
      if (k < rest.length) units.push({ name: 'Блок расширения', no: 1, multi: false, circuits: rest.slice(k) });
      return { units: units, h: units.length ? EX_ROW_H + 10 : 0 };
    }
    var exPlan = planExpansion();

    function drawExpansion(y0) {
      if (!exPlan.units.length) return;
      var PADX = 5, COL_MIN = 40, COL_GAP = 6, UNIT_GAP = 9;
      // Ширина модуля — по числу его контуров; колонка контура не уже подписи.
      var widths = exPlan.units.map(function (u) {
        return PADX * 2 + u.circuits.length * COL_MIN + (u.circuits.length - 1) * COL_GAP;
      });
      var total = widths.reduce(function (a, b) { return a + b; }, 0) + (widths.length - 1) * UNIT_GAP;
      var x = Math.max(6, (W - total) / 2);
      exPlan.units.forEach(function (u, ui) {
        var uw = widths[ui];
        o.push(rrect(x, y0, uw, EX_ROW_H, 1.6, { f: FACE2, c: '#94A3B8', w: 0.5 }));
        o.push(txt(x + PADX, y0 + 5.2, u.name + (u.multi ? ' №' + u.no : ''), { size: 2.6, weight: 'bold' }));
        // Связь с контроллером — по той же шине RS-485, что и остальная
        // периферия. Длинную жилу через весь лист не тянем: она перечеркнула бы
        // выноски, поэтому ставим короткий отвод с подписью.
        o.push(seg([[x + uw - PADX - 22, y0], [x + uw - PADX - 22, y0 - 5]], CRS[2], 0.6, '1.6 1.2'));
        o.push(txt(x + uw - PADX - 20, y0 - 2.6, 'RS-485 от контроллера', { size: 2.1, fill: '#475569' }));
        u.circuits.forEach(function (c, ci) {
          var cx0 = x + PADX + ci * (COL_MIN + COL_GAP);
          var mix = c.type === 'mix';
          var kind = c.src === 'ufh' ? 'Тёплый пол' : c.src === 'snow' ? 'Снеготаяние' : 'Радиаторы';
          // Клеммы: у насоса L/N/PE, у привода ◄/►/N/PE — те же, что у КО-1…КО-3
          // на самом контроллере, поэтому и рисуются так же.
          var ty = y0 + 9.4;
          function term(tx, cl, col) {
            // та же съёмная колодка, что и на самом контроллере
            o.push(pluggable(tx, ty, cl.length, col, true, true));
            cl.forEach(function (L, i) {
              o.push(txt(tx + P / 2 + i * P, ty + 9.4, L, { size: 2.1, anchor: 'middle' }));
            });
            return tx + cl.length * P;
          }
          var tx = cx0;
          tx = term(tx, ['L', 'N', '⏚'], TC_.or);
          if (mix) term(tx + 3, ['◄', '►', 'N', '⏚'], TC_.bl);
          o.push(txt(cx0, y0 + 3.4, 'контур ' + (ci + 1), { size: 2.1, fill: '#94A3B8' }));
          o.push(txt(cx0, y0 + EX_ROW_H - 5.6, c.name + ' · ' + kind, { size: 2.4, weight: 'bold' }));
          o.push(txt(cx0, y0 + EX_ROW_H - 2.2, mix ? 'насос + сервопривод смесителя' : 'насос контура',
            { size: 2.1, fill: '#475569' }));
        });
        x += uw + UNIT_GAP;
      });
    }

    var H = CB + 12 + (nBot - 1) * LS + 44 + exPlan.h;

    // Climatic.V2 — тот же прибор, что Thermatic 3001 (паспорт ZONT ML.TD.ZHCL.V2.001,
    // Приложение 4: колодки и подписи клемм те же), отличается только марка.
    var devName = tc.brand === 'zont' ? 'ZONT Climatic.V2' : 'STOUT Thermatic 3001';
    o.push(txt(W / 2, 8.4, 'Схема подключения автоматики котельной — ' + devName,
      { size: 4.4, anchor: 'middle', weight: 'bold' }));

    // ── корпус прибора: плоский вид с лицевой панели ──
    // Рисуется ДО жил: жила должна доходить до самой клеммы, а клеммные
    // ряды рисуются последними и накрывают её торец — как на реальном щите.
    o.push(rrect(CX, CY, CW, CH, 2.4, { f: FACE, c: '#94A3B8', w: 0.6 }));
    // Лицевая панель — по внешнему виду прибора: слева шильдик, справа
    // утопленный модуль экрана с кнопками. Всё держится выше CY+36: ниже
    // идут вертикальные подписи силовых клемм.
    var fx = CX + 3, fy = CY + 10.6, fw = CW - 6, fh = CH - 21;
    o.push(rrect(fx, fy, fw, fh, 2.2, { f: FACE2, c: '#CBD5E1', w: 0.4 }));
    // шильдик: по фотографии — 14 % ширины от левого края, 36 % высоты
    o.push(txt(fx + fw * 0.06, fy + fh * 0.30, devName, { size: 6.4, fill: '#6B7280' }));

    // ── модуль экрана: 41 % ширины и 54 % высоты панели, поднят кверху ──
    var dw = fw * 0.41, dh = fh * 0.54, dx = fx + fw - dw - fw * 0.025, dy = fy + fh * 0.07;
    o.push(rrect(dx, dy, dw, dh, 1.6, { f: '#EDEFF2', c: '#B9C2CC', w: 0.45 }));
    // экран — 65 % модуля по ширине, отношение сторон ≈ 1,5:1 как на приборе
    var sw = dw * 0.655, sh = dh - dh * 0.16, sx = dx + dw * 0.028, sy = dy + dh * 0.08;
    o.push(rrect(sx, sy, sw, sh, 0.8, { f: '#fff', c: '#8A94A0', w: 0.45 }));
    // доли экрана — чтобы содержимое масштабировалось вместе с ним
    function px(f) { return sx + sw * f; }
    function py(f) { return sy + sh * f; }
    // строка состояния — тёмная полоса, как на приборе
    o.push(rrect(sx, sy, sw, sh * 0.155, 0.8, { f: '#3A4A63' }));
    o.push(rrect(sx, sy + sh * 0.08, sw, sh * 0.075, 0, { f: '#3A4A63' }));
    o.push(txt(px(0.04), py(0.115), '+12°', { size: sh * 0.075, fill: '#E2E8F0' }));
    o.push(txt(px(0.96), py(0.115), '15:30', { size: sh * 0.075, anchor: 'end', fill: '#E2E8F0' }));
    [0, 1, 2].forEach(function (i) {
      o.push(rrect(px(0.76) + i * sh * 0.05, py(0.115) - sh * 0.03 - i * sh * 0.018,
        sh * 0.03, sh * 0.045 + i * sh * 0.018, 0.15, { f: '#E2E8F0' }));
    });
    // пламя работы котла и текущая температура
    var flx = px(0.09), fly = py(0.46), flr = sh * 0.12;
    o.push(path('M' + n(flx) + ',' + n(fly - flr) +
      ' C' + n(flx + flr * 0.85) + ',' + n(fly) + ' ' + n(flx + flr * 0.7) + ',' + n(fly + flr * 0.85) + ' ' + n(flx) + ',' + n(fly + flr) +
      ' C' + n(flx - flr * 0.7) + ',' + n(fly + flr * 0.85) + ' ' + n(flx - flr * 0.85) + ',' + n(fly) + ' ' + n(flx) + ',' + n(fly - flr) + ' Z',
      { f: '#F97316' }));
    o.push(txt(px(0.15), py(0.58), '18°', { size: sh * 0.30, fill: '#1D4ED8' }));
    // стрелки прижаты к самому числу: ниже них идёт строка способа
    // регулирования, и на прежних местах они с ней перекрывались
    o.push(pline([[px(0.26), py(0.34)], [px(0.34), py(0.34)], [px(0.30), py(0.27)]], { f: '#94A3B8', c: 'none' }));
    o.push(pline([[px(0.26), py(0.63)], [px(0.34), py(0.63)], [px(0.30), py(0.70)]], { f: '#94A3B8', c: 'none' }));
    // расписание
    o.push(rrect(px(0.44), py(0.30), sh * 0.13, sh * 0.13, 0.4, { f: '#fff', c: '#64748B', w: 0.35 }));
    o.push(ln(px(0.44), py(0.30) + sh * 0.04, px(0.44) + sh * 0.13, py(0.30) + sh * 0.04, { c: '#64748B', w: 0.35 }));
    o.push(txt(px(0.51), py(0.58), 'Расписание', { size: sh * 0.075, anchor: 'middle', fill: '#64748B' }));
    // Способ терморегулирования выбранного контура — он же в «ПОЛЕ КОНТУРА»
    // на приборе. Единственная величина режима, которая выводится из сметы:
    // куплен на контур комнатный прибор — значит по воздуху.
    var c0m = (tc.circuits || [])[0];
    if (c0m) o.push(txt(px(0.50), py(0.79), 'регулирование ' + (c0m.byAir ? 'по воздуху' : 'по теплоносителю'),
      { size: sh * 0.07, anchor: 'middle', fill: '#64748B' }));
    // домик уставки
    // Уставка стоит слева от стойки домика, как на приборе: раньше текст
    // «24°» центрировался правее и перечёркивался этой стойкой.
    var hx = px(0.76), hy = py(0.48), hw = sw * 0.15, hh = sh * 0.22;
    o.push(pline([[hx - hw, hy], [hx, hy - hh], [hx + hw, hy]], { c: '#F5B700', w: sh * 0.05 }));
    o.push(ln(hx + hw * 0.72, hy - hh * 0.05, hx + hw * 0.72, hy + hh * 0.8, { c: '#F5B700', w: sh * 0.05 }));
    o.push(txt(hx - hw * 0.18, hy + hh * 0.62, '24°', { size: sh * 0.155, anchor: 'middle', fill: '#334155' }));
    // Нижняя строка — «СТРОКА КОНТУРА» (техдокументация, стр. 23): показывает
    // ВЫБРАННЫЙ контур, стрелки переключают между ними. Берём первый контур
    // из сметы, чтобы экран отвечал конфигурации, а не был картинкой.
    var scrLabel = 'Отопление';
    if ((tc.circuits || []).length) {
      var c0 = tc.circuits[0];
      scrLabel = c0.name + ' ' + (c0.src === 'ufh' ? 'Тёплый пол' : c0.src === 'snow' ? 'Снеготаяние' : 'Радиаторы');
    } else if (tc.dhw === 'boiler' || tc.dhw === 'boiler_ct') scrLabel = 'ГВС';
    o.push(rrect(px(0.02), py(0.845), sw * 0.96, sh * 0.13, 0.5, { f: '#1E6FD9' }));
    o.push(txt(px(0.5), py(0.94), '◄  ' + scrLabel + '  ►', { size: sh * 0.095, anchor: 'middle', fill: '#fff' }));

    // ── кнопки справа от экрана: две клавиши, круглый навипад, две клавиши ──
    var bzx = sx + sw, bzw = dx + dw - bzx;              // поле под кнопки
    var bw2 = bzw * 0.42, bh2 = dh * 0.15, bgap2 = bzw * 0.08;
    var bx0 = bzx + (bzw - bw2 * 2 - bgap2) / 2, bx1 = bx0 + bw2 + bgap2;
    var byT = dy + dh * 0.08, byB = dy + dh - dh * 0.08 - bh2;
    function keycap(x, y) {
      return rrect(x, y, bw2, bh2, bh2 * 0.28, { f: '#F8FAFC', c: '#9AA3AD', w: 0.35 });
    }
    o.push(keycap(bx0, byT));
    // «Назад» — контуром: глифа стрелки в чертёжном шрифте нет
    var rax = bx0 + bw2 / 2, ray = byT + bh2 / 2, rs = bh2 * 0.3;
    o.push(seg([[rax + rs * 1.2, ray - rs * 0.8], [rax - rs * 0.6, ray - rs * 0.8], [rax - rs * 0.6, ray + rs * 0.3]], '#64748B', 0.4));
    o.push(pline([[rax - rs * 1.3, ray + rs * 0.3], [rax + rs * 0.1, ray + rs * 0.3], [rax - rs * 0.6, ray + rs * 1.4]],
      { f: '#64748B', c: 'none', close: true }));
    o.push(keycap(bx1, byT));
    o.push(txt(bx1 + bw2 / 2, byT + bh2 * 0.68, 'OK', { size: bh2 * 0.52, anchor: 'middle', fill: '#64748B' }));
    // навигационная площадка
    var nx = (bx0 + bx1 + bw2) / 2, ny = dy + dh / 2, nr = dh * 0.215;
    o.push(circle(nx, ny, nr, { f: '#F8FAFC', c: '#9AA3AD', w: 0.35 }));
    // разрезы на четыре лепестка — площадка на приборе именно такая
    [45, 135, 225, 315].forEach(function (a3) {
      var r3 = a3 * Math.PI / 180;
      o.push(ln(nx + Math.cos(r3) * nr * 0.34, ny + Math.sin(r3) * nr * 0.34,
        nx + Math.cos(r3) * nr, ny + Math.sin(r3) * nr, { c: '#C7CDD4', w: 0.35 }));
    });
    o.push(circle(nx, ny, nr * 0.28, { f: '#fff', c: '#C7CDD4', w: 0.3 }));
    [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(function (d2) {
      var a1 = nx + d2[0] * nr * 0.6, b1 = ny + d2[1] * nr * 0.6, t2 = nr * 0.24;
      o.push(pline([[a1 - (d2[1] ? t2 : 0), b1 - (d2[0] ? t2 : 0)],
        [a1 + (d2[1] ? t2 : 0), b1 + (d2[0] ? t2 : 0)],
        [a1 + d2[0] * t2 * 1.2, b1 + d2[1] * t2 * 1.2]], { f: '#94A3B8', c: 'none', close: true }));
    });
    o.push(keycap(bx0, byB));
    o.push(txt(bx0 + bw2 / 2, byB + bh2 * 0.64, 'MODE', { size: bh2 * 0.36, anchor: 'middle', fill: '#64748B' }));
    o.push(keycap(bx1, byB));
    [0, 1, 2].forEach(function (i) {
      o.push(ln(bx1 + bw2 * 0.22, byB + bh2 * 0.3 + i * bh2 * 0.2,
        bx1 + bw2 * 0.78, byB + bh2 * 0.3 + i * bh2 * 0.2, { c: '#64748B', w: 0.35 }));
    });
    // Вентиляционная решётка — под экраном, как на приборе: утопленная
    // рамка с 14 овальными прорезями (пересчитано по рендеру прибора из
    // техдокументации). Это именно вентиляция корпуса, а не индикаторы:
    // раздел «Внешний вид, назначение выключателей и символов на экране»
    // перечисляет только клавиши и символы дисплея, светящихся элементов
    // на корпусе у прибора нет.
    // левый край решётки выровнен по левому краю экрана, как на приборе
    var vx = sx, vh = fh * 0.075, vw = dx + dw - sx, vy = fy + fh * 0.70;
    o.push(rrect(vx, vy, vw, vh, vh / 2, { f: FACE2, c: '#B9C2CC', w: 0.4 }));
    var vn = 14, vstep = (vw - vh * 1.4) / vn;
    for (var vd = 0; vd < vn; vd++) {
      o.push(rrect(vx + vh * 0.7 + vd * vstep + vstep * 0.15, vy + vh * 0.28,
        vstep * 0.62, vh * 0.44, vh * 0.22, { f: '#fff', c: '#B9C2CC', w: 0.3 }));
    }

    // ── жгуты ──
    function drawSide(list, edge, side) {
      list.forEach(function (d, i) {
        var lane = edge === 'top' ? CY - 12 - i * LS : CB + 12 + i * LS;
        // жила доходит до центра клеммы своего ряда
        var y0 = edge === 'top' ? CY + 5.4 : CB - 5.4;
        var dx = side < 0 ? DXL : DXR;
        var cl = d.clamps || [];
        var M = cl.length;
        d.lane = lane;
        /**
         * Жила k идёт из k-й клеммы прибора строго в k-ю клемму потребителя:
         * её горизонталь стоит ровно на высоте своей клеммы (шаг тот же P),
         * поэтому Г-образные трассы жгута остаются параллельными, а конец
         * жилы приходит точно в клемму, а не рядом с ней.
         *
         * А вот КАКАЯ клемма потребителя верхняя — зависит от того, куда жгут
         * идёт. Жила из дальней клеммы прибора обязана пройти мимо стояков
         * ближних, поэтому сворачивать она должна раньше них. У жгута «вниз и
         * направо» дальняя клемма — самая правая, у «вверх и налево» — тоже,
         * и на этих двух сочетаниях порядок обратный: иначе жилы одного жгута
         * перехлёстываются у самой колодки. Колодка потребителя разворачивается
         * вместе с ними — правая колонка выходит зеркалом левой.
         */
        var rev = (edge === 'top') === (side < 0);
        function offOf(k) { return ((rev ? M - 1 - k : k) - (M - 1) / 2) * P; }
        var strip0 = rev ? cl.slice().reverse() : cl;
        /**
         * Шлейф шины: прибор сидит не на клеммах контроллера, а на предыдущем
         * приборе той же шины — так RS-485 и монтируют, и раньше каждому
         * прибору рисовался свой полный жгут из одних и тех же клемм: верхний
         * шёл сквозь горизонтали нижнего, и в середине листа получался клубок.
         *
         * Соединять клемму с клеммой по отдельности тут нельзя: обе колодки
         * стоят на одном x, клеммы у них на одной высоте, и любая пара обходов
         * пересекается — куда стояки ни сдвигай. Поэтому от колодки к колодке
         * идёт пучок: жилы параллельны, входят в торец колодки и не пересекают
         * ничего по построению. Какая жила в какую клемму — видно по цвету и
         * по первому прибору, где жгут показан полностью.
         */
        if (d.chain && i > 0) {
          var prevLane = list[i - 1].lane, up = lane < prevLane;
          var hs = M * P + 1.6;                       // высота колодки (vstrip)
          var yA = prevLane + (up ? -hs / 2 : hs / 2);
          var yB = lane + (up ? hs / 2 : -hs / 2);
          // Шаг в пучке — свой: клеммным шагом P четыре жилы вылезли бы за
          // габарит колодки (она 4,8 мм) и упирались бы мимо торца.
          var NW = d.wires.length, st = NW > 1 ? Math.min(P, 3.6 / (NW - 1)) : 0;
          for (var c1 = 0; c1 < NW; c1++) {
            var xc = dx + (c1 - (NW - 1) / 2) * st;
            o.push(seg([[xc, yA], [xc, yB]], d.wires[c1], 0.55));
          }
          o.push(txt(dx - (NW - 1) * st / 2 - 2, (yA + yB) / 2 + 0.7,
            'шлейф', { size: 1.9, anchor: 'end' }));
        } else {
          for (var k = 0; k < d.wires.length; k++) {
            var off = offOf(k);
            // clampOffset — если на одном блоке несколько независимых пар
            // («Входы термостатов»: три входа по две клеммы)
            var cxw = d.blk.x + P / 2 + ((d.clampOffset || 0) + k) * P;
            var yw = lane + off;                     // высота своей клеммы
            o.push(seg([[cxw, y0], [cxw, yw], [dx - side * 2.4, yw]], d.wires[k], 0.55));
            o.push(circle(cxw, y0, 0.75, { f: d.wires[k] }));
          }
        }
        used[d.blk.k] = true;
        // прибор, стоящий В РАЗРЫВЕ жгута (плата цифровых шин): рисуется
        // поверх уже проложенных жил — они входят в него слева и выходят справа
        if (d.inline) {
          var mxc = side < 0 ? (DXL + CX) / 2 : (CX + CW + DXR) / 2;
          var mw = 19, mh = M * P + 5.4;
          o.push(rrect(mxc - mw / 2, lane - mh / 2, mw, mh, 1.2, { f: FACE2, c: INK, w: 0.5 }));
          o.push(rrect(mxc - mw / 2 + 2.4, lane - mh / 2 + 1.6, mw - 4.8, 2, 0.4, { f: '#CBD5E1' }));
          for (var g = 0; g < M; g++) {
            o.push(circle(mxc - mw / 2 + 2.2, lane + (g - (M - 1) / 2) * P, 0.7, { f: '#fff', c: INK, w: 0.3 }));
            o.push(circle(mxc + mw / 2 - 2.2, lane + (g - (M - 1) / 2) * P, 0.7, { f: '#fff', c: INK, w: 0.3 }));
          }
          o.push(txt(mxc, lane + mh / 2 + 2.8, d.inline, { size: 2, anchor: 'middle' }));
        }
        // колодка потребителя, значок и подписи
        o.push(vstrip(dx, lane, strip0, side));
        var icx = side < 0 ? ICL : ICR;
        o.push(seg([[icx - side * ICO * 0.5, lane], [dx + side * 2.4, lane]], INK, 0.4, '1 1'));
        o.push(d.ico(icx, lane, ICO));
        var tx2 = side < 0 ? icx - ICO * 0.55 - 4 : icx + ICO * 0.55 + 4;
        var an = side < 0 ? 'end' : 'start';
        o.push(txt(tx2, lane - 1.2, d.title, { size: 2.4, anchor: an, weight: 'bold' }));
        if (d.sub) o.push(txt(tx2, lane + 2.2, d.sub, { size: 2.1, anchor: an }));
        // Клеммы, к которым идёт не контроллер, а шины щита: N (там, где
        // контроллер даёт только коммутируемую фазу) и PE. Показываем
        // короткими отводами наружу — тянуть их через весь лист от вводного
        // автомата значило бы перечеркнуть схему.
        if (d.nStub) {
          var ny = lane + offOf(d.wires.length);
          o.push(seg([[dx - side * 2.4, ny], [dx - side * 8, ny]], CN, 0.55));
          o.push(txt(dx - side * 9, ny + 0.7, 'N щита', { size: 1.8, anchor: side > 0 ? 'end' : 'start' }));
        }
        if (d.pe) {
          // ⏚ — последняя клемма списка; у развёрнутого жгута она наверху,
          // и знак заземления уходит вверх, а не вниз.
          var pdir = rev ? -1 : 1, pey = lane + offOf(M - 1);
          o.push(peSeg([[dx, pey], [dx, pey + 2.2 * pdir]]));
          o.push(gndSym(dx, pey + 2.2 * pdir, pdir));
        }
      });
    }
    drawSide(topL, 'top', -1); drawSide(topR, 'top', 1);
    drawSide(botL, 'bot', -1); drawSide(botR, 'bot', 1);

    /**
     * Перемычка «Общ» ← L для реле крана протечки.
     *
     * Она связывает две клеммы на самом приборе, и прямой линией её можно
     * вести только по коридору между клеммным рядом и первым этажом выносок.
     * Коридор этот занят: через него вниз идут стояки всех нижних жгутов, и
     * когда между блоком крана и блоком питания есть занятые колодки (котлы
     * на релейном управлении), перемычка перечёркивает их жилы.
     *
     * Поэтому линию рисуем, только когда дорога свободна. Занята — показываем
     * меткой «Б» на обеих клеммах: тем же приёмом, каким на листе показана
     * связь с планкой тёплого пола (метка «А») и шины щита («N щита», PE).
     */
    var jm = botR.filter(function (d) { return d.jumper; })[0];
    if (jm) {
      var ax = B.leak.x + P * 1.5, bx = B.pwr.x + P / 2;
      var busy = BOT.some(function (b) { return used[b.k] && b.x > B.leak.x && b.x < B.pwr.x; });
      if (!busy) {
        var jy = CB + 6.5;
        o.push(seg([[ax, CB - 5.4], [ax, jy], [bx, jy], [bx, CB - 5.4]], CL, 0.55));
        o.push(txt((B.leak.x + B.pwr.x) / 2, jy + 2.4, 'перемычка «Общ» ← L', { size: 1.9, anchor: 'middle' }));
      } else {
        [ax, bx].forEach(function (mx) {
          o.push(seg([[mx, CB - 5.4], [mx, CB + 2.6]], CL, 0.55));
          o.push(circle(mx, CB + 4.1, 1.5, { f: '#fff', c: CL, w: 0.4 }));
          o.push(txt(mx, CB + 4.8, 'Б', { size: 2, anchor: 'middle', fill: CL }));
        });
        // Подпись ставим правее блока питания — он крайний, и справа от него
        // в коридоре ничего не проложено.
        o.push(txt(bx + 3.4, CB + 4.8,
          'Б — перемычка «Общ» крана протечки ← L клеммы «Питание 220В»', { size: 1.9 }));
      }
    }

    // ── Таблица контуров: что за контур, на каких он клеммах и как
    // регулируется. Ставится в свободное поле слева от прибора — полоса
    // между верхними и нижними выносками там пустая на всю высоту корпуса.
    (function () {
      var rw = [];
      (tc.circuits || []).forEach(function (c, i) {
        var term = c.type === 'mix'
          ? '«' + c.name + ' Насос» + «' + c.name + ' Смеситель»'
          : '«' + c.name + ' Насос»';
        if (i >= 3) {
          // Какому именно модулю достался контур — считает planExpansion,
          // и таблица обязана говорить то же самое, что нарисовано внизу листа.
          var host = null, slot = 0;
          exPlan.units.forEach(function (u) {
            var k = u.circuits.indexOf(c);
            if (k >= 0) { host = u; slot = k + 1; }
          });
          // Номер контура НА МОДУЛЕ обязателен: у EX-108 их три, и без него
          // все три строки таблицы читались бы одинаково.
          term = host ? (host.name + (host.multi ? ' №' + host.no : '') + ' · контур ' + slot +
            ' · клеммы «Насос»' + (c.type === 'mix' ? ' и «Смеситель»' : ''))
            : 'на блоке расширения EX';
        }
        rw.push({
          t: c.name + ' · ' + (c.src === 'ufh' ? 'Тёплый пол' : c.src === 'snow' ? 'Снеготаяние' : 'Радиаторы'),
          s: term + ' · ' + (c.byAir ? 'по воздуху' : 'по теплоносителю')
        });
      });
      if (tc.dhw === 'boiler') rw.push({ t: 'ГВС · загрузка бойлера', s: '«ГВС РЦ» · по датчику «Бойлер»' });
      else if (tc.dhw === 'boiler_ct') rw.push({ t: 'ГВС · через котёл', s: 'уставку котлу задаёт цифровая шина' });
      if (tc.recirc) rw.push({ t: 'ГВС · рециркуляция', s: '«ГВС ЦН» · по режиму «Комфорт»' });
      (tc.boilers || []).filter(function (b) { return b.iface !== 'own'; }).slice(0, 2).forEach(function (b, i) {
        rw.push({
          t: 'Котёл ' + (i + 1) + ' · ' + (b.kind === 'gas' ? 'газовый' : 'электрический'),
          s: b.iface === 'digital' ? '«ЦШ' + (i + 1) + '» · цифровая шина' : '«Реле котёл ' + (i + 1) + '» · сухой контакт'
        });
      });
      if (!rw.length) return;
      var tw = 96, th = 6.4 + rw.length * 8.2, tx0 = 6, ty0 = CY + (CH - th) / 2;
      o.push(rrect(tx0, ty0, tw, th, 1.6, { f: '#F8FAFC', c: '#CBD5E1', w: 0.4 }));
      o.push(txt(tx0 + 3, ty0 + 4.6, 'Контуры контроллера', { size: 2.6, weight: 'bold' }));
      o.push(ln(tx0 + 3, ty0 + 6, tx0 + tw - 3, ty0 + 6, { c: '#CBD5E1', w: 0.3 }));
      rw.forEach(function (r, i) {
        var ry2 = ty0 + 10.6 + i * 8.2;
        o.push(txt(tx0 + 3, ry2, r.t, { size: 2.4, weight: 'bold' }));
        o.push(txt(tx0 + 3, ry2 + 3.4, r.s, { size: 2.2, fill: '#475569' }));
      });
    })();

    // При автоматике ТП «Входы термостатов» задействованы: на них приходит
    // запрос тепла с коммутационного блока (сам блок — в полосе внизу листа).
    if (ufh && ufh.ko) {
      used.thr = true;
      // Метка «А» — та же, что у сухого контакта планки ТП внизу листа:
      // связь между двумя системами показана ссылкой, а не жилой через
      // весь чертёж, иначе она перечеркнула бы всю схему по диагонали.
      var thrX = T.thr.x + P * 1.5;
      o.push(seg([[thrX, CY + 5.4], [thrX, CY - 4]], CCLOSE, 0.6));
      o.push(circle(thrX, CY - 6.6, 2.6, { f: '#fff', c: CCLOSE, w: 0.5 }));
      o.push(txt(thrX, CY - 5.7, 'А', { size: 2.6, anchor: 'middle', weight: 'bold' }));
      o.push(txt(thrX + 4, CY - 5.9, 'запрос тепла от планки ТП', { size: 2.1 }));
    }

    // клеммные ряды — поверх жил
    function strip(list, y, labelBelow) {
      // Полочка корпуса под колодками — тёмно-серая планка, как на фото прибора
      // (паспорт STOUT, стр. 10): колодки съёмные и сидят в ней, а не прямо на панели.
      o.push(rrect(CX + 2.4, y - 1.4, CW - 4.8, 9.2, 1.2, { f: '#8E98A6', c: '#6B7280', w: 0.4 }));
      if (labelBelow) {
        // переключатель АКБ (ON / OFF) в начале верхнего ряда
        o.push(rrect(CX + 3.1, y - 0.2, 3.4, 6.8, 0.5, { f: '#F1F5F9', c: '#475569', w: 0.3 }));
        o.push(rrect(CX + 3.7, y + 0.6, 2.2, 2.6, 0.3, { f: '#334155' }));
        // три светодиода «Индикация» — между питанием внешних устройств и входами термостатов
        var ledX = (T.vext.x + 3 * P + T.thr.x) / 2;
        [['#EF4444', -1.6], ['#EAB308', 0], ['#22C55E', 1.6]].forEach(function (L) {
          o.push(circle(ledX + L[1], y + 3.2, 0.6, { f: L[0], c: '#475569', w: 0.15 }));
        });
      }
      list.forEach(function (b) {
        var on = !!used[b.k];
        if (b.jack) {
          // гнездо RJ45: металлический корпус с контактной колодкой, а не винтовые клеммы
          o.push('<g' + (on ? '' : ' opacity="0.4"') + '>' +
            (on ? rrect(b.x - 0.9, y - 0.9, b.n * P + 1.8, 8.2, 1.1, HALO) : '') +
            rrect(b.x, y - 0.3, b.n * P, 7, 0.6, { f: '#CBD5E1', c: '#64748B', w: 0.35 }) +
            rrect(b.x + 0.9, y + 0.9, b.n * P - 1.8, 4.2, 0.4, { f: '#1F2937' }) +
            rrect(b.x + b.n * P / 2 - 0.9, y + 0.3, 1.8, 0.9, 0.2, { f: '#CBD5E1' }) +
            [0, 1, 2, 3, 4, 5].map(function (q) {
              return rrect(b.x + 1.3 + q * ((b.n * P - 2.6) / 6), y + 3.6, 0.5, 1.5, 0.1, { f: '#EAB308' });
            }).join('') + '</g>');
        } else {
          o.push(pluggable(b.x, y, b.n, b.c, on, !labelBelow ? false : true, b.groups));
        }
        var col = on ? '#0F172A' : '#94A3B8';
        // Названия силовых клемм длиннее своих колодок («КО-1 Смеситель» —
        // 15 мм против 9.6 мм) и горизонтально наезжали на соседние. Ставим
        // их вертикально в поле лицевой панели, как на щитовых приборах.
        if (labelBelow) o.push(txt(b.cx, y + 9.4, b.t, { size: 1.85, anchor: 'middle', fill: col }));
        else o.push(txt(b.cx + 0.7, y - 1.6, b.t, { size: 1.85, rotate: -90, fill: col }));
      });
    }
    strip(TOP, CY + 2.2, true);
    strip(BOT, CY + CH - 8.6, false);

    // ── автоматика тёплого пола (раздел 4.3 сметы) ──
    // Блоки расширения — под нижними выносками, над легендой жил.
    drawExpansion(H - 12 - 6 - EX_ROW_H);

    // ── легенда жил ──
    var lg = [[CL, 'L — фаза (коммутирует реле контроллера)'], [CN, 'N — нейтраль'],
      [null, 'PE — на шину заземления щита'], [CSIG, 'датчики NTC (пара, полярности нет)'],
      [CRS[2], 'RS-485 (⏚ B A +12В)'], [CBUS, 'цифровая шина котла'],
      [COPEN, 'смеситель: ◄ открытие'], [CCLOSE, '► закрытие']];
    var lgY = H - 12;
    lg.forEach(function (L, i) {
      var col = i % 4, rw = Math.floor(i / 4);
      var xx = 14 + col * 102, yy = lgY + rw * 5;
      if (L[0] === null) o.push(peSeg([[xx, yy], [xx + 10, yy]]));
      else o.push(seg([[xx, yy], [xx + 10, yy]], L[0], 0.8));
      o.push(txt(xx + 12.5, yy + 1, L[1], { size: 2.1 }));
    });

    return { svg: o.join(''), w: W, h: H };
  }

  // ─── Схема подключения автоматики базового уровня (Thermatic 1002) ─────
  // Тот же язык чертежа, что и у старшего прибора, но хозяйство другое, и
  // потому другая композиция. У 1002 всего одна клеммная колодка и четыре
  // разъёма (инструкция, п. 1.5):
  //
  //   ЦШ ЦШ  — цифровая шина котла, полярности нет;
  //   ПУ ПУ  — клеммы штатной панели управления котла (байпас, необязательно);
  //   B A C  — единственное реле: B — НЗ, A — общий, C — НР;
  //   Т1, Т2 — проводные датчики температуры;
  //   Д1     — шлейф контактных датчиков, разъём 4P4C (RJ11);
  //   ДОП    — шина RS-485;
  //   ПИТ    — адаптер питания 12 В из комплекта.
  //
  // Отсюда и главное отличие от схемы 3001: там жгуты уходят к контурам, а
  // здесь узкое место — одно реле, и лист должен показывать, кому оно
  // досталось и чем закрыты остальные нагрузки. Радиоприборы LoRa проводов
  // не имеют вовсе — они уходят в выноску от антенны, а не в жгут.
  function automation1002(tc, items) {
    tc = tc || {};
    items = items || {};
    var nm = items.names || {};
    var o = [], W = 420;

    var LS = 19;                        // шаг «этажей» выносок
    // Габариты корпуса — паспортные: 160 × 140 мм (п. 1.3, ШхВ). Прибор
    // нарисован с лицевой стороны, как он снят в инструкции: разъёмы одним
    // рядом по нижней грани, антенны, SIM и кнопки — по верхней.
    var CW = 150, CH = 131, CX = (W - CW) / 2;
    var DXL = 92, DXR = 328;            // колодки потребителей
    var ICL = 62, ICR = 358, ICO = 13;
    var CD1 = '#7C3AED';                // шлейф контактных датчиков Д1
    var CRAD = '#94A3B8';               // радиоканал LoRa — связь без провода
    var JW = 5.4;                       // ширина розетки 4P4C (RJ11)

    /**
     * ── Разъёмы нижней грани, слева направо, как на корпусе (п. 1.5) ──
     *
     * Колодка с пружинными клеммами одна, и подписана она на приборе целиком:
     * «ЦШ ПУ В А С». Дальше идут четыре одинаковых розетки 4P4C и гнездо
     * питания. Названия и порядок — с фотографии панели, не придуманы:
     *   ЦШ — цифровая шина котла, полярности нет;
     *   ПУ — штатный термостат (панель управления) котла, необязательно;
     *   В — НЗ, А — общий, С — НР встроенного реле;
     *   Т1, Т2 — проводные датчики температуры;
     *   Д1 — контактные датчики; ДОП — внешние устройства; ПИТ — адаптер 12 В.
     */
    var ROW = [
      { k: 'trm', n: 7, t: 'ЦШ ПУ В А С', pins: true },
      { k: 't1', n: 1, t: 'Т1', jack: true },
      { k: 't2', n: 1, t: 'Т2', jack: true },
      { k: 'd1', n: 1, t: 'Д1', jack: true },
      { k: 'dop', n: 1, t: 'ДОП', jack: true },
      { k: 'pit', n: 1, t: 'ПИТ', round: true }
    ];
    (function layoutRow() {
      var total = 0;
      ROW.forEach(function (b) { b.w = (b.jack || b.round) ? JW : b.n * P; total += b.w; });
      var gap = (CW - 12 - total) / (ROW.length - 1);
      if (gap < 1.6) gap = 1.6;
      var x = CX + 6;
      ROW.forEach(function (b) { b.x = x; b.cx = x + b.w / 2; x += b.w + gap; });
    })();
    var T = {};
    ROW.forEach(function (b) { T[b.k] = b; });
    // Откуда выходит жила: у клеммной колодки — из своей клеммы, у розетки
    // 4P4C и гнезда питания все жилы идут из одной точки, самого разъёма.
    function wireX(blk, i) {
      return (blk.jack || blk.round) ? blk.cx : blk.x + P / 2 + i * P;
    }
    // Виртуальный «разъём» для радиоприборов: проводов у них нет, но этаж в
    // общей раскладке им нужен — ставим их за самым правым разъёмом.
    var RADIO_BLK = { k: 'radio', cx: CX + CW + 4, x: CX + CW + 4, w: 0 };

    var used = {}, botL = [], botR = [];

    // ── котлы ──
    // Первый котёл идёт по встроенной шине прямо с клемм «ЦШ», второй — через
    // адаптер на шине ДОП: адаптер рисуется прибором в разрыве жгута, чтобы
    // было видно, что его надо купить и куда поставить.
    var boilers = (tc.boilers || []).filter(function (b) { return b.iface !== 'own'; }).slice(0, 2);
    var relayBoilerIco = null, relayBoilerTitle = '';
    var boilerIco = function (gas) {
      return function (a, c, s) { return icoBoiler(a, c, s, gas); };
    };
    boilers.forEach(function (b, i) {
      var gas = b.kind === 'gas';
      var title = 'Котёл ' + (i + 1) + ' — ' + (gas ? 'газовый' : 'электрический');
      var sub = cut(nm['boiler' + i] || '', 30);
      if (b.iface === 'digital' && i === 0) {
        botL.push({
          blk: T.trm, clampOffset: 0, wires: [CBUS, CBUS2], clamps: ['ЦШ', 'ЦШ'],
          ico: boilerIco(gas), title: title, sub: sub || 'встроенная цифровая шина, полярности нет'
        });
      } else if (b.iface === 'digital') {
        // Второй котёл виден в два шага: по шине ДОП контроллер держит адаптер
        // на DIN-рейке, а уже от адаптера к котлу идёт его цифровая шина.
        // Поэтому у модуля в разрыве своя подпись, а на участке до котла —
        // подпись «ЦШ котла»: иначе непонятно, чем именно котёл подключён.
        botR.push({
          blk: T.dop, wires: CRS, clamps: ['⏚', 'B', 'A', '+12'],
          inline: 'Адаптер OpenTherm, DIN', inlineOut: 'ЦШ котла',
          clampsOut: ['ЦШ', 'ЦШ'], wiresOut: [CBUS, CBUS2],
          ico: boilerIco(gas), title: title,
          sub: sub || 'клеммы цифровой шины котла, полярности нет'
        });
      } else {
        // Котёл на релейном управлении: он попадает в список нагрузок реле,
        // и выноску ему рисует общий разбор ниже — здесь только запоминаем вид.
        relayBoilerIco = boilerIco(gas); relayBoilerTitle = title + ' (релейно)';
      }
    });

    // ── датчики температуры на проводных входах Т1 и Т2 ──
    // Порядок тот же, что и в getBasicAutoConfig: первым идёт тот, кому
    // достался комплектный датчик в гильзе.
    var SENS_ROLE = {
      dhw: { title: 'Датчик бойлера', sub: 'в гильзу бойлера ГВС' },
      flow: { title: 'Датчик теплоносителя', sub: 'в гильзу на подаче котла' },
      out: { title: 'Уличный датчик', sub: 'на северную стену, в тень' }
    };
    var wiredSens = (tc.sensors || []).filter(function (s) { return s.src !== 'bus'; });
    wiredSens.slice(0, 2).forEach(function (s, i) {
      var r = SENS_ROLE[s.role] || SENS_ROLE.out;
      botL.push({
        blk: T[i === 0 ? 't1' : 't2'], wires: [CSIG, '#94A3B8'], clamps: ['1', '2'],
        ico: s.role === 'dhw' ? icoTank : icoProbe,
        title: r.title, sub: s.src === 'kit' ? 'из комплекта · ' + r.sub : r.sub
      });
    });

    // ── шлейф Д1: протечка и манометр ──
    // Разъём один, поэтому со второго датчика в разрыв встаёт разветвитель —
    // он и нарисован прибором на жгуте, а не упомянут текстом.
    var dryN = (tc.leakQty || 0) + (tc.pressure ? 1 : 0);
    if (dryN > 0) {
      var spl = tc.splitter;
      botL.push({
        blk: T.d1, wires: [CD1, '#A78BFA'], clamps: ['3', '4'],
        inline: spl ? (spl.addressed ? 'Разветвитель адресный' : 'Разветвитель') : null,
        ico: icoDrop,
        title: tc.leakQty > 0 ? ('Датчики протечки × ' + tc.leakQty) : 'Манометр давления',
        sub: (tc.leakQty > 0 && tc.pressure) ? 'и манометр давления, тревоги адресные'
          : (spl ? 'шлейф «сухой контакт» на вход Д1' : 'вилка 4P4C прямо в Д1')
      });
    }

    // ── прочие устройства шины ДОП ──
    (tc.sensors || []).filter(function (s) { return s.src === 'bus'; }).forEach(function (s) {
      botR.push({
        blk: T.dop, wires: CRS, clamps: ['⏚', 'B', 'A', '+12'],
        ico: s.role === 'dhw' ? icoTank : icoProbe,
        title: (SENS_ROLE[s.role] || SENS_ROLE.out).title,
        sub: 'по шине — входы Т1 и Т2 заняты'
      });
    });
    var radioAir = !!(tc.airOn && tc.airQty > 0 && tc.airDevice && tc.airDevice.link === 'radio');
    if (tc.airOn && tc.airQty > 0 && !radioAir) botR.push({
      blk: T.dop, wires: CRS, clamps: ['⏚', 'B', 'A', '+12'],
      ico: tc.airKind === 'thermostat' ? icoPanel : icoPuck,
      title: (tc.airKind === 'thermostat' ? 'Комнатный термостат' : 'Датчик воздуха комнатный'),
      sub: cut(nm.air || 'по шине RS-485', 32)
    });
    if (tc.splitter && tc.splitter.addressed) botR.push({
      blk: T.dop, wires: CRS, clamps: ['⏚', 'B', 'A', '+12'], ico: icoModule,
      title: 'Адресный разветвитель', sub: 'адреса датчиков шлейфа Д1'
    });

    // питание — крайний правый разъём, поэтому и этаж у него самый дальний
    botR.push({
      blk: T.pit, wires: [CL, CN], clamps: ['+', '−'], ico: icoBreaker,
      title: 'Адаптер питания 12 В', sub: 'из комплекта · розетка ~220 В'
    });

    /**
     * ── Нагрузки 230 В ──
     *
     * Реле у прибора одно (клеммы «В А С»), и кому оно досталось, посчитал
     * getBasicAutoConfig. Всё, что не поместилось, висит на выносном реле
     * LoRa: проводов к контроллеру у него нет, поэтому на схеме оно связано с
     * прибором штриховой линией радиоканала, а питание берёт от своей нагрузки.
     */
    var loads = tc.loads || [];
    loads.forEach(function (l) {
      var isValve = /кран|соленоид/i.test(l.label);
      var isBoilerLoad = /котёл/i.test(l.label);
      var ico = isValve ? icoValveAct : isBoilerLoad ? (relayBoilerIco || icoModule) : icoPump;
      var title = isBoilerLoad ? (relayBoilerTitle || l.label) : l.label;
      var sub = isBoilerLoad ? 'клеммы термостата котла · перемычку снять'
        : isValve ? cut(nm.leakValve || 'на вводе ХВС', 32)
          : /бойлер/i.test(l.label) ? cut(nm.dhwPump || 'из обвязки бойлера', 32)
            : /рециркуляц/i.test(l.label) ? cut(nm.recircPump || 'линия Т4', 32)
              : 'ток не более 3 А';
      if (l.out === 'built') {
        botR.push({
          blk: T.trm, clampOffset: 5,
          wires: isBoilerLoad ? [CCLOSE, '#6B7280'] : [CL, CL],
          clamps: isBoilerLoad ? ['А', 'С'] : ['А', 'С', 'N'],
          pe: !isBoilerLoad, nStub: !isBoilerLoad,
          ico: ico, title: title, sub: sub
        });
      } else {
        botR.push({
          blk: RADIO_BLK, radio: true, wires: [CL, CN], clamps: ['L', 'N', '⏚'], pe: true,
          inline: 'Реле LoRa', ico: ico, title: title,
          sub: sub + ' · через выносное реле'
        });
      }
    });

    // ── этажи ──
    // Разъёмы у прибора в один ряд, поэтому и выноски все под ним: чем левее
    // разъём, тем ближе его этаж к корпусу (справа — зеркально).
    //
    // Но одного порядка этажей мало: сторону жгуту задаёт не тот список, в
    // который его выше положили, а место его клеммы: провод должен уходить
    // в ближнюю сторону. Иначе жила от клемм «В А С» бежит направо, встречная
    // от розетки «Т1» — налево, и на одном этаже они ложатся друг на друга:
    // через весь лист идёт одна длинная черта, а какая её половина чья —
    // не разобрать. У старшего прибора этого нет: там клеммных блоков много и
    // левые потребители сидят на левых блоках, а здесь колодка одна на всё.
    //
    // Условие «пересечений нет» тут простое: любая клемма левой колонки
    // должна быть левее любой клеммы правой — тогда стояк одного жгута
    // никогда не пересечёт горизонталь чужого этажа. Поэтому складываем всё
    // в один список, сортируем по клемме и режем надвое — по ближайшему к
    // середине разрезу, который это условие соблюдает: колонки выходят
    // вровень, и лист не выше, чем был.
    var bot = botL.concat(botR);
    bot.forEach(function (d) {
      var off = d.clampOffset || 0, m = (d.wires || []).length || 1;
      d.xLo = wireX(d.blk, off);            // самая левая жила жгута
      d.xHi = wireX(d.blk, off + m - 1);    // самая правая
    });
    bot.sort(function (a, b) { return (a.xLo - b.xLo) || (a.xHi - b.xHi); });
    var cutAt = 0, runHi = -Infinity, best = null;
    for (var s2 = 0; s2 <= bot.length; s2++) {
      if (s2 > 0) runHi = Math.max(runHi, bot[s2 - 1].xHi);
      if (s2 > 0 && s2 < bot.length && runHi > bot[s2].xLo) continue;
      var d2 = Math.abs(s2 - bot.length / 2);
      if (best === null || d2 < best) { best = d2; cutAt = s2; }
    }
    botL = bot.slice(0, cutAt);
    botR = bot.slice(cutAt).reverse();   // справа этажи идут от дальней клеммы
    var nBot = Math.max(botL.length, botR.length, 1);

    // Верхняя грань занята антеннами: рожок 12,6 мм плюс подпись над ним, и
    // всё это должно уместиться между заголовком листа и корпусом.
    var CY = 36;
    var CB = CY + CH;

    /**
     * ── Что в смете есть, но проводов к контроллеру не имеет ──
     *
     * Насосы контуров при базовом уровне работают постоянно: контуров у
     * прибора нет, температуру ведёт котёл. Автоматика тёплого пола (раздел
     * 4.3) — самостоятельная зональная система на 230 В. Молчать об этом
     * нельзя: оборудование в смете есть, и монтажник должен видеть, что к
     * контроллеру оно не идёт.
     */
    var offList = [];
    /**
     * Бойлер, который контроллер не грузит сам.
     *
     * Режим «Котёл+Бойлер»: бак висит на переключающем клапане котла, и котёл
     * сам решает, куда гнать теплоноситель, — проводов от бойлера к
     * контроллеру нет вовсе, он лишь передаёт котлу целевую температуру по
     * цифровой шине. Без этой строки включение бойлера в смете действительно
     * ничего не меняло на листе, и монтажник искал, куда его подключать.
     */
    if (tc.dhw === 'boiler_ct') offList.push({
      t: 'Бойлер ГВС · на переключающем клапане котла',
      s: cut(nm.tank || 'бойлер косвенного нагрева', 40) +
        ' — клапан и датчик бойлера подключаются к самому котлу; контроллер задаёт котлу уставку ГВС по цифровой шине'
    });
    if (tc.dhw === 'external') offList.push({
      t: 'Бойлер ГВС · мимо контроллера',
      s: cut(nm.tank || 'бойлер косвенного нагрева', 40) +
        ' — у котла нет цифровой шины, ГВС остаётся на его собственной автоматике'
    });
    if (tc.dhw === 'ct') offList.push({
      t: 'ГВС от двухконтурного котла',
      s: 'проточный теплообменник котла — отдельного бойлера в смете нет'
    });
    if ((tc.directCount || 0) > 0) offList.push({
      t: 'Насос радиаторного контура × ' + tc.directCount,
      s: cut(nm.dirGroup || 'прямая насосная группа', 44) + ' — питание от щита, работает постоянно'
    });
    if ((tc.mixCount || 0) > 0) offList.push({
      t: 'Насосная группа со смесителем × ' + tc.mixCount,
      s: cut(nm.mixGroup || 'узел тёплого пола', 44) + ' — температуру держит термостатическая головка'
    });
    if (onBlocks.length) offList.push({
      t: 'Блоки расширения ' + (f.blocks && f.blocks.n44 ? 'ZE-44 × ' + f.blocks.n44 : '') + (f.blocks && f.blocks.n22 ? (f.blocks.n44 ? ' · ' : '') + 'ZE-22 × ' + f.blocks.n22 : '') + ' (RS-485)',
      s: cut(onBlocks.map(function (a) { return a.label; }).join(', '), 70) + ' — клеммы блока по его паспорту'
    });
    var ufh = items.ufh || null;
    if (ufh && (ufh.blocks || ufh.stats || ufh.servos)) offList.push({
      t: 'Автоматика радиаторов и тёплого пола (раздел 4.5)',
      s: [ufh.stats ? 'термостаты × ' + ufh.stats : '', ufh.servos ? 'сервоприводы × ' + ufh.servos : '',
        ufh.blocks ? 'коммутационный блок × ' + ufh.blocks : ''].filter(Boolean).join(' · ') +
        ' — своя зональная система на 230 В'
    });
    if (radioAir) offList.push({
      t: (tc.airKind === 'thermostat' ? 'Комнатный термостат' : 'Датчик воздуха') + ' × ' + tc.airQty,
      s: cut(nm.air || 'радиоканал LoRa 868 МГц', 44) + ' — по радио, провода не нужны'
    });
    // Полоса внизу листа: заголовок, черта под ним и по две строки на пункт.
    var OFF_ROW = 8.6, offBoxH = offList.length ? 9.6 + offList.length * OFF_ROW : 0;
    var offH = offBoxH ? offBoxH + 6 : 0;
    var H = CB + 14 + (nBot - 1) * LS + 40 + offH;

    o.push(txt(W / 2, 8.4, 'Схема подключения автоматики котельной — STOUT Thermatic 1002',
      { size: 4.4, anchor: 'middle', weight: 'bold' }));

    // ── корпус: вид с лицевой стороны, пропорции паспортные (160 × 140 мм) ──
    o.push(rrect(CX, CY, CW, CH, 9, { f: '#FCFDFE', c: '#94A3B8', w: 0.6 }));
    var fx = CX + 5, fy = CY + 6, fw = CW - 10, fh = CH - 24;
    o.push(rrect(fx, fy, fw, fh, 7, { f: FACE2, c: '#CBD5E1', w: 0.4 }));

    /**
     * ── Верхняя грань: п. 1.5, семь позиций слева направо ──
     * УСТ · антенна GSM · SIM · антенна Wi-Fi «2,4G» · встроенный датчик
     * температуры · антенна LoRa «868Mhz» · ВКЛ.
     */
    var topItems = [
      { k: 'btn', t: 'УСТ' }, { k: 'ant', t: 'GSM' }, { k: 'sim', t: 'SIM' },
      { k: 'ant', t: '2,4G' }, { k: 'sens', t: 'датчик t°' },
      { k: 'ant', t: '868Mhz' }, { k: 'btn', t: 'ВКЛ' }
    ];
    var loraX = CX + CW * 0.5;
    topItems.forEach(function (it, i) {
      var ax = CX + CW * (i + 0.5) / topItems.length, ty = CY;
      if (it.t === '868Mhz') loraX = ax;
      if (it.k === 'ant') {
        o.push(rrect(ax - 1.4, ty - 2.6, 2.8, 3, 0.5, { f: '#E2E8F0', c: '#94A3B8', w: 0.4 }));
        o.push(rrect(ax - 1.05, ty - 15, 2.1, 12.6, 1.05, { f: '#F8FAFC', c: '#94A3B8', w: 0.45 }));
        o.push(txt(ax, ty - 16.4, it.t, { size: 1.9, anchor: 'middle', fill: '#64748B' }));
      } else if (it.k === 'sim') {
        o.push(rrect(ax - 3.6, ty - 3, 7.2, 3.4, 0.5, { f: '#fff', c: '#94A3B8', w: 0.4 }));
        o.push(txt(ax, ty - 4.4, it.t, { size: 1.9, anchor: 'middle', fill: '#64748B' }));
      } else if (it.k === 'sens') {
        o.push(circle(ax, ty - 1.6, 1.6, { f: '#fff', c: '#94A3B8', w: 0.4 }));
        o.push(circle(ax, ty - 1.6, 0.7, { f: '#CBD5E1' }));
        o.push(txt(ax, ty - 4.4, it.t, { size: 1.9, anchor: 'middle', fill: '#64748B' }));
      } else {
        o.push(circle(ax, ty - 1.8, 1.5, { f: '#F8FAFC', c: '#94A3B8', w: 0.45 }));
        o.push(txt(ax, ty - 4.4, it.t, { size: 1.9, anchor: 'middle', fill: '#64748B' }));
      }
    });

    /**
     * ── Лицевая панель: логотип в середине, индикаторы кольцом вокруг ──
     *
     * Именно так они и расположены на приборе (п. 1.5): в центре шестигранник
     * STOUT, вокруг него шесть индикаторов со своими значками — ПИТ сверху,
     * дальше по часовой стрелке КОТЕЛ, GSM, ЛК, WIFI, УСТ. Подписи на корпусе
     * не напечатаны, но на схеме они нужны: по ним читается, что горит.
     */
    (function frontPanel() {
      var mx = CX + CW / 2, my = fy + fh * 0.5, R = fh * 0.30;
      // шестигранник логотипа
      var hr = fh * 0.115, pts = [];
      for (var a = 0; a < 6; a++) {
        var ang = (a * 60 - 90) * Math.PI / 180;
        pts.push([mx + Math.cos(ang) * hr, my + Math.sin(ang) * hr]);
      }
      o.push(pline(pts, { c: '#94A3B8', w: 0.7, close: true }));
      o.push(txt(mx, my + hr * 0.42, 'S', { size: hr * 1.15, anchor: 'middle', fill: '#94A3B8' }));

      var leds = [
        { t: 'ПИТ', a: -90 }, { t: 'КОТЕЛ', a: -30 }, { t: 'GSM', a: 30 },
        { t: 'ЛК', a: 90 }, { t: 'WIFI', a: 150 }, { t: 'УСТ', a: 210 }
      ];
      leds.forEach(function (L) {
        var r = L.a * Math.PI / 180;
        var lx = mx + Math.cos(r) * R, ly = my + Math.sin(r) * R;
        o.push(circle(lx, ly, 1.15, { f: '#E2E8F0', c: '#94A3B8', w: 0.3 }));
        // подпись отодвинута от центра, чтобы не налезть на логотип
        var tx3 = mx + Math.cos(r) * (R + 7), ty3 = my + Math.sin(r) * (R + 7);
        o.push(txt(tx3, ty3 + 0.8, L.t, { size: 2.1, anchor: 'middle', fill: '#94A3B8' }));
      });
      o.push(txt(mx, fy + fh - 3.5, 'STOUT Thermatic 1002',
        { size: 4.2, anchor: 'middle', fill: '#6B7280' }));
    })();

    // ── жгуты ──
    // Все разъёмы у прибора в одном ряду, поэтому жгуты идут вниз: этажи
    // выносок лежат под корпусом, слева и справа от него.
    function drawSide(list, side) {
      list.forEach(function (d, i) {
        var lane = CB + 14 + i * LS;
        var y0 = CB - 0.6;   // жила выходит из самого разъёма нижней грани
        var dx = side < 0 ? DXL : DXR;
        var cl = d.clamps || [];
        var M = cl.length;
        // Прибор в разрыве жгута, за которым идёт ДРУГАЯ линия (адаптер
        // цифровой шины: к нему RS-485, от него — шина котла). Тогда жилы
        // контроллера доходят только до модуля, а дальше рисуется своя пара.
        var mw = 26, mxc = side < 0 ? (DXL + CX) / 2 : (CX + CW + DXR) / 2;
        var hasOut = !!(d.inline && d.wiresOut && d.clampsOut);
        var clStrip = hasOut ? d.clampsOut : cl;
        var inX = hasOut ? (side > 0 ? mxc - mw / 2 : mxc + mw / 2) : dx - side * 2.4;
        // Порядок жил в жгуте — тот же закон, что и у старшего прибора: жила
        // из дальней клеммы обязана свернуть раньше ближних, иначе перехлёст
        // у самого разъёма. Этажи здесь только под корпусом, поэтому обратный
        // порядок нужен жгутам, идущим направо.
        var rev = side > 0, Ms = clStrip.length;
        function offOf(k) { return ((rev ? M - 1 - k : k) - (M - 1) / 2) * P; }
        function offS(k) { return ((rev ? Ms - 1 - k : k) - (Ms - 1) / 2) * P; }
        if (d.radio) {
          // Радиоканал: провода к контроллеру нет вовсе, поэтому от корпуса к
          // этажу идёт штриховая линия от антенны 868 МГц.
          o.push(seg([[loraX, CY - 15], [loraX, CY - 19], [CX + CW + 6, CY - 19],
            [CX + CW + 6, lane], [dx - side * 2.4, lane]], CRAD, 0.5, '1.8 1.4'));
          o.push(txt(CX + CW + 8, (CY - 19 + lane) / 2, 'LoRa', { size: 2, fill: '#64748B' }));
        } else {
          for (var k = 0; k < d.wires.length; k++) {
            var off = offOf(k);
            var cxw = wireX(d.blk, (d.clampOffset || 0) + k);
            var yw = lane + off;
            o.push(seg([[cxw, y0], [cxw, yw], [inX, yw]], d.wires[k], 0.55));
            o.push(circle(cxw, y0, 0.75, { f: d.wires[k] }));
          }
          if (hasOut) {
            var outX = side > 0 ? mxc + mw / 2 : mxc - mw / 2;
            d.wiresOut.forEach(function (c, k2) {
              var yy = lane + offS(k2);
              o.push(seg([[outX, yy], [dx - side * 2.4, yy]], c, 0.55));
            });
            if (d.inlineOut) o.push(txt((outX + dx - side * 2.4) / 2, lane - Ms * P / 2 - 1.4,
              d.inlineOut, { size: 2, anchor: 'middle', fill: '#475569' }));
          }
        }
        used[d.blk.k] = true;
        if (d.inline) {
          var mh = Math.max(M, hasOut ? d.clampsOut.length : 0) * P + 5.4;
          o.push(rrect(mxc - mw / 2, lane - mh / 2, mw, mh, 1.2, { f: FACE2, c: INK, w: 0.5 }));
          o.push(rrect(mxc - mw / 2 + 2.4, lane - mh / 2 + 1.6, mw - 4.8, 2, 0.4, { f: '#CBD5E1' }));
          for (var g = 0; g < M; g++) {
            o.push(circle(mxc - mw / 2 + 2.2, lane + (g - (M - 1) / 2) * P, 0.7, { f: '#fff', c: INK, w: 0.3 }));
          }
          var Mo2 = hasOut ? d.clampsOut.length : M;
          for (var g2 = 0; g2 < Mo2; g2++) {
            o.push(circle(mxc + mw / 2 - 2.2, lane + (g2 - (Mo2 - 1) / 2) * P, 0.7, { f: '#fff', c: INK, w: 0.3 }));
          }
          o.push(txt(mxc, lane + mh / 2 + 2.8, d.inline, { size: 2, anchor: 'middle' }));
        }
        o.push(vstrip(dx, lane, rev ? clStrip.slice().reverse() : clStrip, side));
        var icx = side < 0 ? ICL : ICR;
        o.push(seg([[icx - side * ICO * 0.5, lane], [dx + side * 2.4, lane]], INK, 0.4, '1 1'));
        o.push(d.ico(icx, lane, ICO));
        var tx2 = side < 0 ? icx - ICO * 0.55 - 4 : icx + ICO * 0.55 + 4;
        var an = side < 0 ? 'end' : 'start';
        o.push(txt(tx2, lane - 1.2, cut(d.title, 40), { size: 2.4, anchor: an, weight: 'bold' }));
        // Слева подпись растёт влево от значка, и длинная строка уходила за
        // край листа: режем её по месту, которое там реально есть.
        if (d.sub) o.push(txt(tx2, lane + 2.2, cut(d.sub, side < 0 ? 40 : 46), { size: 2.1, anchor: an }));
        if (d.nStub) {
          var ny = lane + offS(d.wires.length);
          o.push(seg([[dx - side * 2.4, ny], [dx - side * 8, ny]], CN, 0.55));
          o.push(txt(dx - side * 9, ny + 0.7, 'N щита', { size: 1.8, anchor: side > 0 ? 'end' : 'start' }));
        }
        if (d.pe) {
          var pdir = rev ? -1 : 1, pey = lane + offS(Ms - 1);
          o.push(peSeg([[dx, pey], [dx, pey + 2.2 * pdir]]));
          o.push(gndSym(dx, pey + 2.2 * pdir, pdir));
        }
      });
    }
    drawSide(botL, -1); drawSide(botR, 1);

    // ── таблица: что ведёт контроллер ──
    (function () {
      var rw = [];
      rw.push({ t: 'Отопление', s: 'уставку держит котёл · ПЗА по уличному датчику' });
      if (tc.dhw === 'boiler') {
        // Куда сел насос загрузки, решает разбор нагрузок: реле у прибора одно,
        // и чаще оно достаётся крану протечки — тогда насос идёт на выносное.
        var dhwLoad = (tc.loads || []).filter(function (l) { return /бойлер/i.test(l.label); })[0];
        rw.push({
          t: 'ГВС · загрузка бойлера',
          s: 'насос на ' + (dhwLoad && dhwLoad.out === 'extra' ? 'выносном реле' : 'реле «А»–«С»') +
            ' · датчик бойлера на Т1/Т2'
        });
      }
      else if (tc.dhw === 'boiler_ct') rw.push({ t: 'ГВС · через котёл', s: 'уставку котлу задаёт цифровая шина' });
      else if (tc.dhw === 'ct') rw.push({ t: 'ГВС · котловой', s: 'проточный теплообменник котла' });
      (tc.boilers || []).filter(function (b) { return b.iface !== 'own'; }).slice(0, 2).forEach(function (b, i) {
        rw.push({
          t: 'Котёл ' + (i + 1) + ' · ' + (b.kind === 'gas' ? 'газовый' : 'электрический'),
          s: b.iface === 'digital'
            ? (i === 0 ? '«ЦШ» · встроенная цифровая шина' : 'адаптер на шине ДОП')
            : 'реле «В»–«А»–«С» · клеммы термостата'
        });
      });
      if (tc.cascade) rw.push({ t: 'Каскад', s: 'два котла с ротацией' });
      if (tc.leakQty > 0) rw.push({
        t: 'Защита от протечки',
        s: 'датчики в шлейф Д1 · кран на реле, открытие вручную'
      });
      var tw = 92, th = 6.4 + rw.length * 8.2, tx0 = 6, ty0 = CY + (CH - th) / 2;
      o.push(rrect(tx0, ty0, tw, th, 1.6, { f: '#F8FAFC', c: '#CBD5E1', w: 0.4 }));
      o.push(txt(tx0 + 3, ty0 + 4.6, 'Что ведёт контроллер', { size: 2.6, weight: 'bold' }));
      o.push(ln(tx0 + 3, ty0 + 6, tx0 + tw - 3, ty0 + 6, { c: '#CBD5E1', w: 0.3 }));
      rw.forEach(function (r, i) {
        var ry2 = ty0 + 10.6 + i * 8.2;
        o.push(txt(tx0 + 3, ry2, r.t, { size: 2.4, weight: 'bold' }));
        o.push(txt(tx0 + 3, ry2 + 3.4, cut(r.s, 44), { size: 2.2, fill: '#475569' }));
      });
    })();

    /**
     * ── Ряд разъёмов нижней грани — поверх жил ──
     *
     * Колодка нарисована зелёной с оранжевыми флажками, как на приборе, а
     * подписи стоят так же, как напечатаны на корпусе: «ЦШ» под своей парой,
     * «ПУ» под своей, дальше по одной букве — В, А, С. Розетки 4P4C и гнездо
     * питания подписаны своими именами.
     */
    (function drawRow() {
      var y = CB - 6.4;
      ROW.forEach(function (b) {
        var on = !!used[b.k];
        var col = on ? '#0F172A' : '#94A3B8';
        var g0 = '<g' + (on ? '' : ' opacity="0.4"') + '>';
        if (b.round) {
          // гнездо питания: чёрная втулка с центральным штырём
          o.push(g0 + (on ? circle(b.cx, y + 3.2, 4.0, HALO) : '') +
            circle(b.cx, y + 3.2, 2.7, { f: '#1F2937', c: '#111827', w: 0.4 }) +
            circle(b.cx, y + 3.2, 1.7, { f: '#374151' }) +
            circle(b.cx, y + 3.2, 0.7, { f: '#CBD5E1' }) + '</g>');
        } else if (b.jack) {
          // розетка 4P4C (RJ11): тёмный корпус, окно с четырьмя контактами и язычок
          o.push(g0 + (on ? rrect(b.x - 0.9, y - 0.9, b.w + 1.8, 8.2, 1.1, HALO) : '') +
            rrect(b.x, y - 0.3, b.w, 7, 0.6, { f: '#4B5563', c: '#1F2937', w: 0.35 }) +
            rrect(b.x + 0.7, y + 1.2, b.w - 1.4, 4.4, 0.4, { f: '#111827' }) +
            rrect(b.cx - 1.1, y + 0.1, 2.2, 1.2, 0.2, { f: '#374151' }) +
            [0, 1, 2, 3].map(function (q) {
              return rrect(b.x + 1.1 + q * ((b.w - 2.2) / 4), y + 3.4, 0.5, 1.9, 0.1, { f: '#EAB308' });
            }).join('') + '</g>');
        } else {
          // пружинная колодка: зелёный корпус, оранжевые рычажки, тёмные гнёзда провода
          var gw = b.n * P;
          var sp = g0 + (on ? rrect(b.x - 0.9, y - 0.9, gw + 1.8, 8.2, 1.1, HALO) : '') +
            rrect(b.x, y, gw, 6.4, 0.7, { f: '#1E8E4E', c: '#14532D', w: 0.35 }) +
            rrect(b.x + 0.25, y + 0.25, gw - 0.5, 1.1, 0.4, { f: '#4ADE80' });
          for (var i = 0; i < b.n; i++) {
            var cxx = b.x + P / 2 + i * P;
            if (i > 0) sp += ln(b.x + i * P, y + 0.4, b.x + i * P, y + 6.0, { c: '#14532D', w: 0.25 });
            sp += rrect(cxx - 1.05, y + 0.7, 2.1, 2.2, 0.3, { f: '#F59E0B', c: '#B45309', w: 0.25 });
            sp += rrect(cxx - 0.9, y + 3.7, 1.8, 1.8, 0.35, { f: '#111827' });
          }
          o.push(sp + '</g>');
        }
        if (b.pins) {
          var groups = [{ t: 'ЦШ', a: 0, b: 1 }, { t: 'ПУ', a: 2, b: 3 },
            { t: 'В', a: 4, b: 4 }, { t: 'А', a: 5, b: 5 }, { t: 'С', a: 6, b: 6 }];
          groups.forEach(function (g) {
            var gx = (b.x + P / 2 + g.a * P + b.x + P / 2 + g.b * P) / 2;
            o.push(txt(gx, y - 1.8, g.t, { size: 2, anchor: 'middle', fill: col }));
          });
        } else {
          o.push(txt(b.cx, y - 1.8, b.t, { size: 2, anchor: 'middle', fill: col }));
        }
      });
    })();

    // ── оборудование раздела, которое к контроллеру не подключается ──
    if (offH) {
      var oy = CB + 14 + (nBot - 1) * LS + 12;
      o.push(rrect(12, oy, W - 24, offBoxH, 1.6, { f: FACE2, c: '#94A3B8', w: 0.5 }));
      o.push(txt(17, oy + 5.8, 'В смете есть, но проводов к контроллеру не имеет',
        { size: 2.6, weight: 'bold' }));
      o.push(ln(17, oy + 7.2, W - 17, oy + 7.2, { c: '#CBD5E1', w: 0.3 }));
      offList.forEach(function (r, i) {
        var ry3 = oy + 11.8 + i * OFF_ROW;
        o.push(txt(17, ry3, r.t, { size: 2.4, weight: 'bold' }));
        o.push(txt(17, ry3 + 3.4, r.s, { size: 2.1, fill: '#475569' }));
      });
    }

    // ── легенда жил ──
    var lg = [[CL, 'L — фаза (коммутирует реле «А»–«С»)'], [CN, 'N — нейтраль'],
      [null, 'PE — на шину заземления щита'], [CSIG, 'датчики температуры (пара, полярности нет)'],
      [CRS[2], 'ДОП: шина RS-485 (⏚ B A +12В)'], [CBUS, 'цифровая шина котла'],
      [CD1, 'Д1: шлейф контактных датчиков'], [CRAD, 'радиоканал LoRa, провода нет']];
    var lgY = H - 10;
    lg.forEach(function (L, i) {
      var col = i % 4, rw3 = Math.floor(i / 4);
      var xx = 14 + col * 102, yy = lgY + rw3 * 5;
      if (L[0] === null) o.push(peSeg([[xx, yy], [xx + 10, yy]]));
      else o.push(seg([[xx, yy], [xx + 10, yy]], L[0], L[0] === CRAD ? 0.6 : 0.8, L[0] === CRAD ? '1.8 1.4' : null));
      o.push(txt(xx + 12.5, yy + 1, L[1], { size: 2.1 }));
    });

    return { svg: o.join(''), w: W, h: H };
  }

  // ─── Схема подключения автоматики базового уровня (ZONT SMART 2.0) ─────
  // Клеммы — по фотографии прибора в техдокументации ML.TD.ZHCONT.001.01
  // (п. 2 «Подключение», рис. на стр. 66): внизу корпуса один ряд, слева направо
  //
  //   Реле        О НЗ НР            — единственное реле, переключающий контакт
  //   Вход/Выход  1 2 3              — универсальные: вход под датчик или выход
  //                                    «открытый коллектор» (до 100 мА, 30 В)
  //   1-wire      ⏚ +t°              — цифровые датчики DS18B20 (до 10 шт.)
  //   NTC         ⏚ 1 2              — аналоговые датчики
  //   RS-485      A B ⏚ K-Line       — шина адаптера котла, радиомодуля, панелей
  //   +12–24 В    ⏚ +                — питание (блок из комплекта)
  //
  // Нагрузку 220 В выход «открытый коллектор» не включит — между ним и насосом
  // стоит реле 12 В (паспорт, п. 5.3): на схеме оно нарисовано прибором в разрыве
  // жгута, как адаптер шины. Что паспорт не показывает, того на схеме нет:
  // схема подключения извещателей протечки в нём не приведена, поэтому у шлейфа
  // подписано лишь, на какой вход он заходит.
  function automationSmart2(tc, items) {
    tc = tc || {};
    items = items || {};
    var nm = items.names || {};
    var o = [], W = 420;

    var LS = 19;
    var CW = 150, CH = 104, CX = (W - CW) / 2;
    var DXL = 92, DXR = 328;
    var ICL = 62, ICR = 358, ICO = 13;
    var CD1 = '#7C3AED';
    var CRAD = '#94A3B8';

    var ROW = [
      { k: 'rel', n: 3, t: 'Реле', pl: ['О', 'НЗ', 'НР'], col: '#22A855' },
      { k: 'uni', n: 3, t: 'Вход/Выход', pl: ['1', '2', '3'], col: '#9CA3AF' },
      { k: 'ow', n: 2, t: '1-wire', pl: ['⏚', '+t°'], col: '#9CA3AF' },
      { k: 'ntc', n: 3, t: 'NTC', pl: ['⏚', '1', '2'], col: '#9CA3AF' },
      { k: 'rs', n: 4, t: 'RS-485', pl: ['A', 'B', '⏚', 'K'], col: '#F1F5F9' },
      { k: 'pw', n: 2, t: '+12–24 В', pl: ['⏚', '+'], col: '#B91C1C' }
    ];
    (function layoutRow() {
      var total = 0;
      ROW.forEach(function (b) { b.w = b.n * P; total += b.w; });
      var gap = (CW - 12 - total) / (ROW.length - 1);
      if (gap < 1.6) gap = 1.6;
      var x = CX + 6;
      ROW.forEach(function (b) { b.x = x; b.cx = x + b.w / 2; x += b.w + gap; });
    })();
    var T = {};
    ROW.forEach(function (b) { T[b.k] = b; });
    function wireX(blk, i) { return blk.x + P / 2 + i * P; }
    var RADIO_X = CX + CW + 4;

    // Выход жилы: leg = { b: блок, i: номер клеммы в блоке, c: цвет, l: подпись у потребителя }.
    // Жилы жгута обязаны идти слева направо — на этом держится отсутствие пересечений.
    function legsOf(arr) {
      return arr.slice().sort(function (p, q) { return wireX(p.b, p.i) - wireX(q.b, q.i); });
    }
    var used = {}, botL = [], botR = [];
    function boilerIco(gas) { return function (a, c, s) { return icoBoiler(a, c, s, gas); }; }

    // ── котлы ──
    // По цифровой шине ведётся один котёл, и идёт он через адаптер на RS-485;
    // второй — только релейно (паспорт, п. 2), он попадает в нагрузки реле ниже.
    var relayBoilerIco = null, relayBoilerTitle = '';
    (tc.boilers || []).filter(function (b) { return b.iface !== 'own'; }).slice(0, 2).forEach(function (b, i) {
      var gas = b.kind === 'gas';
      var title = 'Котёл ' + (i + 1) + ' — ' + (gas ? 'газовый' : 'электрический');
      var sub = cut(nm['boiler' + i] || '', 30);
      if (b.iface === 'digital') {
        botR.push({
          legs: legsOf([{ b: T.rs, i: 0, c: CRS[2], l: 'A' }, { b: T.rs, i: 1, c: CRS[1], l: 'B' }, { b: T.rs, i: 2, c: CRS[0], l: '⏚' }]),
          inline: 'Адаптер цифровых шин', inlineOut: 'ЦШ котла',
          clampsOut: ['ЦШ', 'ЦШ'], wiresOut: [CBUS, CBUS2],
          ico: boilerIco(gas), title: title,
          sub: sub || 'питание адаптера — с клемм «+12–24 В»'
        });
      } else {
        relayBoilerIco = boilerIco(gas); relayBoilerTitle = title + ' (релейно)';
      }
    });

    // ── датчики температуры ──
    var SENS_ROLE = {
      dhw: { title: 'Датчик бойлера', sub: 'в гильзу бойлера ГВС' },
      flow: { title: 'Датчик теплоносителя', sub: 'в гильзу на подаче котла' },
      out: { title: 'Уличный датчик', sub: 'на северную стену, в тень' }
    };
    var sens = tc.sensors || [];
    var ds = sens.filter(function (s) { return s.wire1; });
    var ntcS = sens.filter(function (s) { return !s.wire1; });
    ntcS.slice(0, 2).forEach(function (s, i) {
      var r = SENS_ROLE[s.role] || SENS_ROLE.out;
      botL.push({
        legs: legsOf([{ b: T.ntc, i: 0, c: CRS[0], l: '⏚' }, { b: T.ntc, i: 1 + i, c: CSIG, l: '' + (1 + i) }]),
        ico: icoProbe, title: r.title, sub: r.sub + ' · вход NTC ' + (1 + i)
      });
    });
    if (ds.length) {
      botL.push({
        legs: legsOf([{ b: T.ow, i: 0, c: CRS[0], l: '⏚' }, { b: T.ow, i: 1, c: CSIG, l: '+t°' }]),
        ico: ds[0].role === 'dhw' ? icoTank : icoProbe,
        title: ds.length > 1 ? 'Датчики 1-Wire × ' + ds.length : (SENS_ROLE[ds[0].role] || SENS_ROLE.out).title,
        sub: ds.map(function (s) { return (SENS_ROLE[s.role] || SENS_ROLE.out).sub; }).join(' · ').slice(0, 46) +
          (ds.length > 1 ? ' · параллельно на одну шину' : '')
      });
    }

    // ── универсальные вход/выходы: сначала входы (шлейф, давление), остальное — выходы ──
    var uniNext = 0;
    function icoGauge(cx, cy, s) {
      return circle(cx, cy, s * 0.36, { f: FACE2, c: INK, w: 0.55 }) +
        seg([[cx, cy], [cx + s * 0.18, cy - s * 0.18]], INK, 0.55) +
        circle(cx, cy, s * 0.05, { f: INK });
    }
    if (tc.leakQty > 0) {
      botL.push({
        legs: legsOf([{ b: T.uni, i: uniNext++, c: CD1, l: 'Вх' }]),
        ico: icoDrop, title: 'Датчики протечки × ' + tc.leakQty,
        sub: 'шлейф АСТРА-361 на вход · полярность — паспорт, п. 3.4'
      });
    }
    if (tc.pressure) {
      // У датчика три жилы с двух разных колодок. Одним жгутом они бы пересекли
      // чужие этажи, поэтому датчик показан дважды: сигнал — от входа, питание —
      // от клемм «+12–24 В». Это один и тот же прибор.
      botL.push({
        legs: legsOf([{ b: T.uni, i: uniNext++, c: '#EAB308', l: 'сигнал' }]),
        ico: icoGauge, title: 'Датчик давления MLD-10.01 · сигнал',
        sub: 'жёлтая жила — на универсальный вход'
      });
      botR.push({
        legs: legsOf([{ b: T.pw, i: 0, c: CRS[0], l: '−' }, { b: T.pw, i: 1, c: CRS[3], l: '+12 В' }]),
        ico: icoGauge, title: 'Датчик давления MLD-10.01 · питание',
        sub: 'красная жила +12 В, чёрная — «минус»'
      });
    }

    // ── устройства шины RS-485 ──
    var radioAir = !!(tc.airOn && tc.airQty > 0 && tc.airDevice && tc.airDevice.link === 'radio');
    var busLegs = function () {
      return legsOf([{ b: T.rs, i: 0, c: CRS[2], l: 'A' }, { b: T.rs, i: 1, c: CRS[1], l: 'B' }, { b: T.rs, i: 2, c: CRS[0], l: '⏚' }]);
    };
    if (tc.airOn && tc.airQty > 0 && !radioAir) botR.push({
      legs: busLegs(), ico: tc.airKind === 'thermostat' ? icoPanel : icoPuck,
      title: tc.airKind === 'thermostat' ? 'Комнатный термостат' : 'Датчик воздуха комнатный',
      sub: cut(nm.air || 'по шине RS-485', 32)
    });
    if (tc.needRadio) botR.push({
      legs: busLegs(), ico: function (a, c, s) { return icoModule(a, c, s, true); },
      title: 'Радиомодуль МЛ-590', sub: 'радиодатчики 868 МГц · до 40 устройств'
    });

    // ── питание: блок 12 В из комплекта ──
    botR.push({
      legs: legsOf([{ b: T.pw, i: 0, c: CRS[0], l: '−' }, { b: T.pw, i: 1, c: CRS[3], l: '+12 В' }]),
      ico: icoBreaker, title: 'Блок питания 12 В', sub: 'из комплекта · розетка ~220 В'
    });

    // ── нагрузки ──
    // Встроенное реле — переключающее (О, НЗ, НР): кому оно досталось, посчитал
    // getBasicAutoConfig. Остальные нагрузки — на выходах «открытый коллектор»
    // через реле 12 В; у реле катушка берёт +12 В питания и «минус» выхода.
    (tc.loads || []).forEach(function (l) {
      var isValve = /кран|соленоид/i.test(l.label);
      var isBoilerLoad = /котёл/i.test(l.label);
      var ico = isValve ? icoValveAct : isBoilerLoad ? (relayBoilerIco || icoModule) : icoPump;
      var title = isBoilerLoad ? (relayBoilerTitle || l.label) : l.label;
      var sub = isBoilerLoad ? 'клеммы термостата котла · перемычку снять'
        : isValve ? cut(nm.leakValve || 'на вводе ХВС', 32)
          : /бойлер/i.test(l.label) ? cut(nm.dhwPump || 'из обвязки бойлера', 32)
            : /рециркуляц/i.test(l.label) ? cut(nm.recircPump || 'линия Т4', 32)
              : 'ток не более 3 А';
      if (l.out === 'built') {
        if (isBoilerLoad) botR.push({
          legs: legsOf([{ b: T.rel, i: 0, c: CCLOSE, l: 'О' }, { b: T.rel, i: 2, c: '#6B7280', l: 'НР' }]),
          ico: ico, title: title, sub: sub
        });
        else if (isValve) botR.push({
          legs: legsOf([{ b: T.rel, i: 0, c: CL, l: 'О' }, { b: T.rel, i: 1, c: CCLOSE, l: 'НЗ' }, { b: T.rel, i: 2, c: COPEN, l: 'НР' }]),
          pe: true, nStub: true, ico: ico, title: title, sub: sub
        });
        else botR.push({
          legs: legsOf([{ b: T.rel, i: 0, c: CL, l: 'О' }, { b: T.rel, i: 2, c: CL, l: 'НР' }]),
          pe: true, nStub: true, ico: ico, title: title, sub: sub
        });
      } else if (l.out === 'extra') {
        botR.push({
          legs: legsOf([{ b: T.uni, i: Math.min(uniNext++, 2), c: CD1, l: 'ОК' }]),
          inline: 'Реле 12 В', clampsOut: ['L', 'N', '⏚'], wiresOut: [CL, CN],
          pe: true, ico: ico, title: title, sub: sub + ' · через реле 12 В'
        });
      }
    });

    // ── этажи: тот же закон, что и у 1002 — клемма левее, этаж ближе к корпусу ──
    var bot = botL.concat(botR);
    bot.forEach(function (d) {
      d.xLo = Infinity; d.xHi = -Infinity;
      d.legs.forEach(function (g) { var x = wireX(g.b, g.i); d.xLo = Math.min(d.xLo, x); d.xHi = Math.max(d.xHi, x); });
    });
    bot.sort(function (a, b) { return (a.xLo - b.xLo) || (a.xHi - b.xHi); });
    var cutAt = 0, runHi = -Infinity, best = null;
    for (var s2 = 0; s2 <= bot.length; s2++) {
      if (s2 > 0) runHi = Math.max(runHi, bot[s2 - 1].xHi);
      if (s2 > 0 && s2 < bot.length && runHi > bot[s2].xLo) continue;
      var d2 = Math.abs(s2 - bot.length / 2);
      if (best === null || d2 < best) { best = d2; cutAt = s2; }
    }
    botL = bot.slice(0, cutAt);
    botR = bot.slice(cutAt).reverse();
    var nBot = Math.max(botL.length, botR.length, 1);
    var CY = 36, CB = CY + CH;

    // ── в смете есть, но проводов к контроллеру не имеет ──
    var offList = [];
    if (tc.dhw === 'boiler_ct') offList.push({
      t: 'Бойлер ГВС · на переключающем клапане котла',
      s: cut(nm.tank || 'бойлер косвенного нагрева', 40) + ' — клапан и датчик бойлера подключаются к самому котлу; контроллер задаёт котлу уставку ГВС по цифровой шине'
    });
    if (tc.dhw === 'external') offList.push({
      t: 'Бойлер ГВС · мимо контроллера',
      s: cut(nm.tank || 'бойлер косвенного нагрева', 40) + ' — у котла нет цифровой шины, ГВС остаётся на его собственной автоматике'
    });
    if (tc.dhw === 'ct') offList.push({ t: 'ГВС от двухконтурного котла', s: 'проточный теплообменник котла — отдельного бойлера в смете нет' });
    if ((tc.directCount || 0) > 0) offList.push({
      t: 'Насос радиаторного контура × ' + tc.directCount,
      s: cut(nm.dirGroup || 'прямая насосная группа', 44) + ' — питание от щита, работает постоянно'
    });
    if ((tc.mixCount || 0) > 0) offList.push({
      t: 'Насосная группа со смесителем × ' + tc.mixCount,
      s: cut(nm.mixGroup || 'узел тёплого пола', 44) + ' — температуру держит термостатическая головка'
    });
    var ufh = items.ufh || null;
    if (ufh && (ufh.blocks || ufh.stats || ufh.servos)) offList.push({
      t: 'Автоматика радиаторов и тёплого пола (раздел 4.5)',
      s: [ufh.stats ? 'термостаты × ' + ufh.stats : '', ufh.servos ? 'сервоприводы × ' + ufh.servos : '',
        ufh.blocks ? 'коммутационный блок × ' + ufh.blocks : ''].filter(Boolean).join(' · ') + ' — своя зональная система на 230 В'
    });
    if (radioAir) offList.push({
      t: (tc.airKind === 'thermostat' ? 'Комнатный термостат' : 'Датчик воздуха') + ' × ' + tc.airQty,
      s: cut(nm.air || 'радиоканал 868 МГц', 44) + ' — по радио через МЛ-590, провода не нужны'
    });
    var OFF_ROW = 8.6, offBoxH = offList.length ? 9.6 + offList.length * OFF_ROW : 0;
    var offH = offBoxH ? offBoxH + 6 : 0;
    var H = CB + 14 + (nBot - 1) * LS + 40 + offH;

    o.push(txt(W / 2, 8.4, 'Схема подключения автоматики котельной — ZONT SMART 2.0',
      { size: 4.4, anchor: 'middle', weight: 'bold' }));

    // ── корпус: вид с лицевой стороны, как на фото в паспорте ──
    o.push(rrect(CX, CY, CW, CH, 7, { f: '#FCFDFE', c: '#94A3B8', w: 0.6 }));
    var fx = CX + 5, fy = CY + 6, fw = CW - 10, fh = CH - 24;
    o.push(rrect(fx, fy, fw, fh, 5, { f: FACE2, c: '#CBD5E1', w: 0.4 }));
    // верхняя грань: антенна GSM, слот SIM, выключатель резервной АКБ
    (function () {
      var ax = CX + CW * 0.18;
      o.push(rrect(ax - 1.4, CY - 2.6, 2.8, 3, 0.5, { f: '#E2E8F0', c: '#94A3B8', w: 0.4 }));
      o.push(rrect(ax - 1.05, CY - 15, 2.1, 12.6, 1.05, { f: '#F8FAFC', c: '#94A3B8', w: 0.45 }));
      o.push(txt(ax, CY - 16.4, 'GSM', { size: 1.9, anchor: 'middle', fill: '#64748B' }));
      var sx = CX + CW * 0.5;
      o.push(rrect(sx - 3.6, CY - 3, 7.2, 3.4, 0.5, { f: '#fff', c: '#94A3B8', w: 0.4 }));
      o.push(txt(sx, CY - 4.4, 'SIM', { size: 1.9, anchor: 'middle', fill: '#64748B' }));
      var bx = CX + CW * 0.82;
      o.push(rrect(bx - 3.2, CY - 3, 6.4, 3.4, 0.5, { f: '#fff', c: '#94A3B8', w: 0.4 }));
      o.push(txt(bx, CY - 4.4, 'АКБ', { size: 1.9, anchor: 'middle', fill: '#64748B' }));
    })();
    // три индикатора на лицевой стороне: питание, нагрев, связь
    [['#EF4444', 'питание'], ['#EAB308', 'нагрев'], ['#22C55E', 'связь']].forEach(function (L, i) {
      var lx = CX + CW / 2 + (i - 1) * 14, ly = fy + 8;
      o.push(circle(lx, ly, 1.6, { f: L[0], c: '#94A3B8', w: 0.35 }));
      o.push(txt(lx, ly + 5, L[1], { size: 1.9, anchor: 'middle', fill: '#94A3B8' }));
    });
    o.push(txt(CX + CW / 2, fy + fh - 6, 'ZONT SMART 2.0', { size: 5.2, anchor: 'middle', fill: '#6B7280' }));

    // ── жгуты ──
    function drawSide(list, side) {
      list.forEach(function (d, i) {
        var lane = CB + 14 + i * LS;
        var y0 = CB - 0.6;
        var dx = side < 0 ? DXL : DXR;
        var legs = d.legs, M = legs.length;
        var hasOut = !!(d.inline && d.wiresOut && d.clampsOut);
        var mw = 26, mxc = side < 0 ? (DXL + CX) / 2 : (CX + CW + DXR) / 2;
        var clStrip = hasOut ? d.clampsOut : legs.map(function (g) { return g.l; });
        var Ms = clStrip.length;
        var inX = hasOut ? (side > 0 ? mxc - mw / 2 : mxc + mw / 2) : dx - side * 2.4;
        var rev = side > 0;
        function offOf(k) { return ((rev ? M - 1 - k : k) - (M - 1) / 2) * P; }
        function offS(k) { return ((rev ? Ms - 1 - k : k) - (Ms - 1) / 2) * P; }
        legs.forEach(function (g, k) {
          var cxw = wireX(g.b, g.i), yw = lane + offOf(k);
          used[g.b.k] = true;
          o.push(seg([[cxw, y0], [cxw, yw], [inX, yw]], g.c, 0.55));
          o.push(circle(cxw, y0, 0.75, { f: g.c }));
        });
        if (hasOut) {
          var outX = side > 0 ? mxc + mw / 2 : mxc - mw / 2;
          d.wiresOut.forEach(function (c, k2) {
            var yy = lane + offS(k2);
            o.push(seg([[outX, yy], [dx - side * 2.4, yy]], c, 0.55));
          });
          if (d.inlineOut) o.push(txt((outX + dx - side * 2.4) / 2, lane - Ms * P / 2 - 1.4,
            d.inlineOut, { size: 2, anchor: 'middle', fill: '#475569' }));
          var mh = Math.max(M, Ms) * P + 5.4;
          o.push(rrect(mxc - mw / 2, lane - mh / 2, mw, mh, 1.2, { f: FACE2, c: INK, w: 0.5 }));
          o.push(rrect(mxc - mw / 2 + 2.4, lane - mh / 2 + 1.6, mw - 4.8, 2, 0.4, { f: '#CBD5E1' }));
          for (var g1 = 0; g1 < M; g1++) o.push(circle(mxc - mw / 2 + 2.2, lane + (g1 - (M - 1) / 2) * P, 0.7, { f: '#fff', c: INK, w: 0.3 }));
          for (var g2 = 0; g2 < Ms; g2++) o.push(circle(mxc + mw / 2 - 2.2, lane + (g2 - (Ms - 1) / 2) * P, 0.7, { f: '#fff', c: INK, w: 0.3 }));
          o.push(txt(mxc, lane + mh / 2 + 2.8, d.inline, { size: 2, anchor: 'middle' }));
        }
        o.push(vstrip(dx, lane, rev ? clStrip.slice().reverse() : clStrip, side));
        var icx = side < 0 ? ICL : ICR;
        o.push(seg([[icx - side * ICO * 0.5, lane], [dx + side * 2.4, lane]], INK, 0.4, '1 1'));
        o.push(d.ico(icx, lane, ICO));
        var tx2 = side < 0 ? icx - ICO * 0.55 - 4 : icx + ICO * 0.55 + 4;
        var an = side < 0 ? 'end' : 'start';
        o.push(txt(tx2, lane - 1.2, cut(d.title, 40), { size: 2.4, anchor: an, weight: 'bold' }));
        if (d.sub) o.push(txt(tx2, lane + 2.2, cut(d.sub, side < 0 ? 40 : 46), { size: 2.1, anchor: an }));
        if (d.nStub) {
          var ny = lane + offS(Ms);
          o.push(seg([[dx - side * 2.4, ny], [dx - side * 8, ny]], CN, 0.55));
          o.push(txt(dx - side * 9, ny + 0.7, 'N щита', { size: 1.8, anchor: side > 0 ? 'end' : 'start' }));
        }
        if (d.pe) {
          var pdir = rev ? -1 : 1, pey = lane + offS(Ms - 1);
          o.push(peSeg([[dx, pey], [dx, pey + 2.2 * pdir]]));
          o.push(gndSym(dx, pey + 2.2 * pdir, pdir));
        }
      });
    }
    drawSide(botL, -1); drawSide(botR, 1);

    // ── таблица: что ведёт контроллер ──
    (function () {
      var rw = [];
      rw.push({ t: 'Отопление', s: 'уставку держит котёл · ПЗА по уличному датчику' });
      if (tc.dhw === 'boiler') {
        var dl = (tc.loads || []).filter(function (l) { return /бойлер/i.test(l.label); })[0];
        rw.push({ t: 'ГВС · загрузка бойлера', s: 'насос на ' + (dl && dl.out === 'built' ? 'реле «О»–«НР»' : 'выходе ОК через реле 12 В') + ' · датчик бойлера на 1-Wire' });
      } else if (tc.dhw === 'boiler_ct') rw.push({ t: 'ГВС · через котёл', s: 'уставку котлу задаёт цифровая шина' });
      else if (tc.dhw === 'ct') rw.push({ t: 'ГВС · котловой', s: 'проточный теплообменник котла' });
      (tc.boilers || []).filter(function (b) { return b.iface !== 'own'; }).slice(0, 2).forEach(function (b, i) {
        rw.push({
          t: 'Котёл ' + (i + 1) + ' · ' + (b.kind === 'gas' ? 'газовый' : 'электрический'),
          s: b.iface === 'digital' ? 'адаптер цифровых шин на RS-485' : 'реле или выход ОК · клеммы термостата'
        });
      });
      if (tc.cascade) rw.push({ t: 'Каскад', s: 'два котла, второй — релейно' });
      if (tc.leakQty > 0) rw.push({ t: 'Защита от протечки', s: 'шлейф на универсальный вход · кран на реле' });
      var tw = 92, th = 6.4 + rw.length * 8.2, tx0 = 6, ty0 = CY + (CH - th) / 2;
      o.push(rrect(tx0, ty0, tw, th, 1.6, { f: '#F8FAFC', c: '#CBD5E1', w: 0.4 }));
      o.push(txt(tx0 + 3, ty0 + 4.6, 'Что ведёт контроллер', { size: 2.6, weight: 'bold' }));
      o.push(ln(tx0 + 3, ty0 + 6, tx0 + tw - 3, ty0 + 6, { c: '#CBD5E1', w: 0.3 }));
      rw.forEach(function (r, i) {
        var ry2 = ty0 + 10.6 + i * 8.2;
        o.push(txt(tx0 + 3, ry2, r.t, { size: 2.4, weight: 'bold' }));
        o.push(txt(tx0 + 3, ry2 + 3.4, cut(r.s, 44), { size: 2.2, fill: '#475569' }));
      });
    })();

    // ── ряд клемм нижней грани — поверх жил ──
    (function drawRow() {
      var y = CB - 6.4;
      ROW.forEach(function (b) {
        var on = !!used[b.k];
        var col = on ? '#0F172A' : '#94A3B8';
        o.push(pluggable(b.x, y, b.n, b.col, on, false));
        b.pl.forEach(function (lab, i) {
          o.push(txt(wireX(b, i), y - 1.8, lab, { size: 1.9, anchor: 'middle', fill: col }));
        });
        o.push(txt(b.cx, y - 5.4, b.t, { size: 1.9, anchor: 'middle', weight: 'bold', fill: col }));
      });
    })();

    if (offH) {
      var oy = CB + 14 + (nBot - 1) * LS + 12;
      o.push(rrect(12, oy, W - 24, offBoxH, 1.6, { f: FACE2, c: '#94A3B8', w: 0.5 }));
      o.push(txt(17, oy + 5.8, 'В смете есть, но проводов к контроллеру не имеет', { size: 2.6, weight: 'bold' }));
      o.push(ln(17, oy + 7.2, W - 17, oy + 7.2, { c: '#CBD5E1', w: 0.3 }));
      offList.forEach(function (r, i) {
        var ry3 = oy + 11.8 + i * OFF_ROW;
        o.push(txt(17, ry3, r.t, { size: 2.4, weight: 'bold' }));
        o.push(txt(17, ry3 + 3.4, r.s, { size: 2.1, fill: '#475569' }));
      });
    }

    // ── легенда жил ──
    var lg = [[CL, 'L — фаза (реле «О»–«НР» или реле 12 В)'], [CN, 'N — нейтраль'],
      [null, 'PE — на шину заземления щита'], [CSIG, 'датчики температуры'],
      [CRS[2], 'RS-485: A B ⏚'], [CBUS, 'цифровая шина котла'],
      [CD1, 'универсальный вход / выход ОК'], [CRS[3], '+12 В питания']];
    var lgY = H - 10;
    lg.forEach(function (L, i) {
      var col = i % 4, rw3 = Math.floor(i / 4);
      var xx = 14 + col * 102, yy = lgY + rw3 * 5;
      if (L[0] === null) o.push(peSeg([[xx, yy], [xx + 10, yy]]));
      else o.push(seg([[xx, yy], [xx + 10, yy]], L[0], 0.8));
      o.push(txt(xx + 12.5, yy + 1, L[1], { size: 2.1 }));
    });

    return { svg: o.join(''), w: W, h: H };
  }

  // ─── Схема подключения автоматики на MyHeat ─────────────────────────────
  // Клеммы — по паспортам: GO! / GO!+ (п. 1.5), Smart 2 (п. 1.5, рис. паспорта блока на 2 выхода),
  // Pro (п. 1.5, паспорт блоков расширения), Eco Smart (п. 1.5, клеммы 1–32), блоки RL2 / RL2S / RL6 / RL6S.
  // Приборы MyHeat собираются из прибора и модулей, поэтому схема — карточки устройств: у каждого
  // нарисован корпус с колодками клемм в порядке паспорта (у контроллера и фото с myheat.net),
  // от каждой используемой клеммы линия-кабель идёт к потребителю,
  // над линией — марка кабеля (ориентир), справа у потребителя — как подключить. Линии идут лесенкой
  // (правая клемма — к верхнему потребителю), поэтому не пересекаются.
  function automationMyheat(tc, items) {
    tc = tc || {};
    items = items || {};
    var F = tc.mh;
    if (!F) return null;
    var nm = items.names || {};
    var o = [], W = 420, X0 = 10, WW = W - 20;
    var M = F.model, id = M.id;
    var GREEN = '#22A855', GREY = '#9CA3AF', RED = '#B91C1C', BLUE = '#2563EB', YEL = '#EAB308', WHITE = '#F1F5F9';

    function G(k, nn, t, pl, col) { return { k: k, n: nn, t: t, pl: pl || [], col: col || GREY }; }
    function pair(k, t, a, b, col) { return G(k, 2, t, [a || '', b || ''], col); }

    // ── колодки приборов: порядок — как на корпусе по паспорту ──
    var CTRL;
    if (id === '6280' || id === '6279') {
      CTRL = [G('bus', 2, 'BUS', ['', ''], BLUE), G('ow', 3, '1-wire', ['⏚', 'DAT', 'V+'], GREY), pair('pw', '+12VDC IN', 'V+', '⏚', RED),
        pair('rel', 'Relay', 'COM', 'NO', GREEN), pair('rel2', 'Relay', 'COM', 'NC', GREEN)];
    } else if (id === '6281') {
      CTRL = [pair('rel', 'Relay', '', '', GREEN)];
      for (var di = 1; di <= 4; di++) CTRL.push(pair('dio' + di, 'DIO ' + di, '●', '', BLUE));
      CTRL.push(pair('bus', 'BUS', '', '', BLUE), G('ow', 3, '1-wire', ['⏚', 'DAT', 'V+'], GREY), pair('pw', '+12VDC IN', 'V+', '⏚', RED));
    } else if (id === '6284') {
      CTRL = [];
      for (var ri = 1; ri <= 4; ri++) CTRL.push(pair('rls' + ri, 'RLS ' + ri, '', '', GREEN));
      for (var rj = 1; rj <= 4; rj++) CTRL.push(pair('rel' + rj, 'Relay ' + rj, '', '', GREEN));
      CTRL.push(pair('bus', 'BUS', '', '', BLUE), G('ow', 3, '1-wire', ['⏚', 'DAT', 'V+'], GREY), pair('i420', '4–20 mA', 'IN', 'V+', GREY),
        pair('ai', 'AI', '', '', GREY), pair('di1', 'DI 1', '', '', BLUE), pair('di2', 'DI 2', '', '', BLUE),
        pair('mod', 'Modbus', 'A', 'B', WHITE), pair('ext', 'EXT', 'A', 'B', YEL), pair('po', '+12VDC OUT', 'V+', '⏚', RED), pair('pi', '+12VDC IN', 'V+', '⏚', RED));
    } else {
      CTRL = [G('ow', 3, '1-wire', ['+5V', 'DAT', '⏚'], GREY), G('ext', 4, 'VDC OUT + EXT', ['+12V', '⏚', 'A', 'B'], YEL),
        pair('di1', 'DI 1', '⏚', 'DI', BLUE), G('di2', 3, 'DI 2', ['⏚', 'DI', '+12V'], BLUE),
        pair('bus1', 'BUS 1', '', '', BLUE), pair('bus2', 'BUS 2', '', '', BLUE),
        pair('ntc1', 'NTC см.1', '', '', GREY), pair('ntc2', 'NTC см.2', '', '', GREY), pair('ntc3', 'NTC бойл.', '', '', GREY), pair('ntc4', 'NTC касс.', '', '', GREY),
        pair('rel', 'Резерв. котёл', '', '', GREEN), pair('i420', '4–20 mA', 'IN', '+12V', GREY),
        { br: true },
        G('drv1', 4, 'Привод 1', ['N', 'L1', 'L2', '⏚'], GREEN), G('pmp1', 3, 'Насос 1', ['N', 'L', '⏚'], GREEN),
        G('drv2', 4, 'Привод 2', ['N', 'L1', 'L2', '⏚'], GREEN), G('pmp2', 3, 'Насос 2', ['N', 'L', '⏚'], GREEN),
        G('dir', 3, 'Прямой', ['N', 'L', '⏚'], GREEN), G('boil', 3, 'Бойлер', ['N', 'L', '⏚'], GREEN),
        G('vlv', 4, 'Кран воды', ['N', 'L1', 'L2', '⏚'], GREEN),
        G('pin', 3, '220 В вход', ['N', 'L', '⏚'], RED), G('pout', 3, '220 В выход', ['N', 'L', '⏚'], RED)];
    }

    // ── устройства: карточка = колодки + строки таблицы ──
    var devs = [];
    var ctrlDev = { title: 'Контроллер MyHeat ' + M.short, sub: 'клеммы — по паспорту прибора', groups: CTRL, rows: [], img: id };
    devs.push(ctrlDev);

    // Модули по порядку: сначала реле, потом симисторы, потом входы DI6.
    var MODS = [];
    (F.modules || []).forEach(function (m) {
      for (var q = 1; q <= m.qty; q++) MODS.push({ id: m.id, kind: m.kind, n: q });
    });
    var MODNAME = { '6295': 'RL2', '6296': 'RL2S', '6291': 'RL6', '6292': 'RL6S', '7010': 'RL6W', '7011': 'RL6SW', '6298': 'DI6' };
    var MODSTRIP = {
      '6295': function () { return [G('o1', 3, 'Реле 1', ['NO', 'NC', 'COM'], GREEN), G('o2', 3, 'Реле 2', ['NO', 'NC', 'COM'], GREEN), pair('pw', '12VDC', 'V+', '⏚', RED), G('ok1', 1, 'OK 1', [''], BLUE), G('ok2', 1, 'OK 2', [''], BLUE)]; },
      '6296': function () { return [G('o1', 3, 'Выходы', ['COM', 'R1', 'R2'], GREEN), pair('pw', '12VDC', 'V+', '⏚', RED), G('ok1', 1, 'OK 1', [''], BLUE), G('ok2', 1, 'OK 2', [''], BLUE)]; },
      '6291': function () { return [G('g1', 4, 'Группа 1', ['R1', 'R2', 'R3', 'COM'], GREEN), G('g2', 4, 'Группа 2', ['COM', 'R4', 'R5', 'R6'], GREEN), pair('pw', '12VDC', 'V+', '⏚', RED), pair('ext', 'EXT', 'A', 'B', YEL), G('ow', 3, '1-wire', ['⏚', 'DAT', 'V+'], GREY)]; }
    };
    MODSTRIP['6292'] = MODSTRIP['6291'];

    // Выходы по видам: у каждого есть подпись клемм для таблицы. Сначала выходы прибора, потом модулей.
    var OUT = { relay: [], triac: [] };
    function addOut(kind, dev, key, label, how) { OUT[kind].push({ dev: dev, key: key, label: label, how: how, used: false }); }
    if (id === '6281') addOut('relay', ctrlDev, 'rel', 'встроенное реле Relay', 'rel');
    else if (id === '6284') {
      for (var a = 1; a <= 4; a++) addOut('relay', ctrlDev, 'rel' + a, 'Relay ' + a, 'rel');
      for (var b = 1; b <= 4; b++) addOut('triac', ctrlDev, 'rls' + b, 'RLS ' + b, 'rls');
    } else if (id === '6280' || id === '6279') addOut('relay', ctrlDev, 'rel', 'Relay (COM–NO)', 'rel');
    MODS.forEach(function (mm) {
      var nmn = MODNAME[mm.id] + ' №' + mm.n;
      var strip = MODSTRIP[mm.id] ? MODSTRIP[mm.id]() : [];
      mm.dev = { title: nmn, sub: MODNAME[mm.id] === 'RL2' || MODNAME[mm.id] === 'RL2S' ? 'блок на 2 выхода — к Smart 2' : mm.id === '6298' ? 'блок дискретных входов — к Pro по EXT'
        : mm.kind === 'relay' ? 'блок реле — по ' + (id === '7007' ? 'Wi-Fi' : 'шине EXT') : 'блок симисторов — по ' + (id === '7007' ? 'Wi-Fi' : 'шине EXT'), groups: strip, rows: [], img: mm.id };
      devs.push(mm.dev);
      if (mm.id === '6295') { addOut('relay', mm.dev, 'o1', nmn + ', реле 1', 'rl2'); addOut('relay', mm.dev, 'o2', nmn + ', реле 2', 'rl2'); }
      else if (mm.id === '6296') { addOut('triac', mm.dev, 'o1', nmn + ', R1', 'rl2s'); addOut('triac', mm.dev, 'o1', nmn + ', R2', 'rl2s'); }
      else if (mm.id === '6291' || mm.id === '7010') for (var c = 1; c <= 6; c++) addOut('relay', mm.dev, c <= 3 ? 'g1' : 'g2', nmn + ', R' + c, 'rl6');
      else if (mm.id === '6292' || mm.id === '7011') for (var d = 1; d <= 6; d++) addOut('triac', mm.dev, d <= 3 ? 'g1' : 'g2', nmn + ', R' + d, 'rl6s');
    });
    function takeOut(kind, cnt) {
      var list = OUT[kind];
      for (var i = 0; i < list.length; i++) {
        // пара выходов — на одном устройстве, подряд
        var ok = true;
        for (var j = 0; j < cnt; j++) { if (!list[i + j] || list[i + j].used || list[i + j].dev !== list[i].dev) { ok = false; break; } }
        if (ok) { var res = []; for (var j2 = 0; j2 < cnt; j2++) { list[i + j2].used = true; res.push(list[i + j2]); } return res; }
      }
      return null;
    }

    function row(dev, keys, what, how) { dev.rows.push({ keys: keys, what: what, how: how }); }

    // ── питание ──
    if (id === '7007') row(ctrlDev, ['pin'], 'Питание прибора 220 В', 'N, L и PE — от отдельного автомата в щите; резервный аккумулятор Li-Ion стоит в корпусе. Выход 220 В («Выход 220 В») повторяет вход.');
    else row(ctrlDev, [id === '6284' ? 'pi' : 'pw'], 'Питание прибора 12 В', 'V+ и ⏚ — от блока питания 12 В из комплекта; блок включается в розетку 230 В через автомат щита.');

    // ── котлы ──
    var boilers = (tc.boilers || []).filter(function (b) { return b.iface !== 'own'; });
    var bi = 0;
    boilers.forEach(function (b, i) {
      var gas = b.kind === 'gas', t = 'Котёл ' + (i + 1) + ' — ' + (gas ? 'газовый' : 'электрический');
      var sub = cut(nm['boiler' + i] || '', 36);
      if (b.iface === 'digital') {
        bi++;
        if (bi === 1) row(ctrlDev, [id === '7007' ? 'bus1' : 'bus'], t, 'цифровая шина котла (OpenTherm, E-Bus, BridgeNet, Navien, BSB, Daesung, EMS): два провода на BUS, полярность не важна. ' + sub);
        else row(ctrlDev, [id === '6284' ? 'ext' : 'ext'], t + ' · через адаптер шины', 'адаптер цифровой шины на DIN-рейку: EXT A/B прибора → A/B адаптера, питание 12 В; к котлу адаптер идёт по его шине. ' + sub);
      } else {
        var o1 = takeOut('relay', 1);
        if (id === '7007' && !o1) o1 = null;
        if (id === '7007') row(ctrlDev, ['rel'], t + ' (релейно)', 'сухой контакт «Реле» (2 клеммы, нормально разомкнутый) — на клеммы термостата котла, перемычку снять. ' + sub);
        else if (o1) row(o1[0].dev, [o1[0].key], t + ' (релейно)', o1[0].label + ' — на клеммы термостата котла, перемычку снять. ' + sub);
      }
    });

    // ── нагрузки ──
    // Eco Smart: назначаем именные клеммы по ролям, а не по списку выше
    if (id === '7007') {
      var mixN = 0, pumpMix = 0, directDone = false;
      (F.assign || []).forEach(function (a) {
        if (a.how !== 'built') return;
        var isDrive = /Привод смесителя/i.test(a.label), isValve = /кран/i.test(a.label);
        if (isDrive) { mixN++; row(ctrlDev, [mixN === 1 ? 'drv1' : 'drv2'], a.label, 'клеммы «Привод смесительного узла ' + mixN + '»: N, L1 — открыть, L2 — закрыть, PE — на шину заземления. Привод 230 В, трёхпроводный.'); }
        else if (isValve) row(ctrlDev, ['vlv'], a.label, 'клеммы «Привод крана перекрытия воды»: N, L1, L2, PE — кран с приводом 230 В; ' + cut(nm.leakValve || 'на вводе ХВС', 40));
        else if (/бойлер/i.test(a.label)) row(ctrlDev, ['boil'], a.label, 'клеммы «Насос бойлера»: N, L, PE · ' + cut(nm.dhwPump || 'обвязка бойлера', 40));
        else if (a.circuit && (F.assign || []).some(function (z) { return z.pair && z.circuit === a.circuit; })) { pumpMix++; row(ctrlDev, [pumpMix === 1 ? 'pmp1' : 'pmp2'], a.label, 'клеммы «Насос смесительного узла ' + pumpMix + '»: N, L, PE.'); }
        else if (!directDone) { directDone = true; row(ctrlDev, ['dir'], a.label, 'клеммы «Насос прямого контура»: N, L, PE.'); }
      });
    }
    // остальные нагрузки — на реле и симисторах прибора и модулей
    (F.assign || []).forEach(function (a) {
      if (a.how === 'built') return;
      var isValve = /кран|соленоид/i.test(a.label), isDrive = /Привод смесителя/i.test(a.label), isBoilerLoad = /Котёл/i.test(a.label);
      if (isBoilerLoad) return;      // котлы на реле выданы выше
      var dest = isValve ? cut(nm.leakValve || 'на вводе ХВС', 40) : /бойлер/i.test(a.label) ? cut(nm.dhwPump || 'обвязка бойлера', 40)
        : /рециркуляц/i.test(a.label) ? cut(nm.recircPump || 'линия Т4', 40) : '';
      var kind = a.how === 'triac' ? 'triac' : 'relay';
      var outs = takeOut(kind, a.pair ? 2 : 1);
      if (!outs) return;
      var o1 = outs[0], o2 = outs[1];
      var dv = o1.dev;
      if (a.pair) {
        var how = kind === 'triac'
          ? (o1.how === 'rls'
            ? o1.label + ' и ' + o2.label + ' (симисторы): фаза L подаётся через каждый — с первого на «открыть», со второго на «закрыть»; N и PE привода — с шины щита. Симисторные выходы — только цепи переменного тока 230 В.'
            : o1.how === 'rl2s'
              ? 'COM — фаза L; R1 — «открыть», R2 — «закрыть»; N и PE привода — с шины щита. Симисторный выход — только цепи 230 В.'
              : 'COM группы — фаза L; ' + o1.label.split(', ')[1] + ' — «открыть», ' + o2.label.split(', ')[1] + ' — «закрыть»; N и PE — с шины щита.')
          : o1.label + ' и ' + o2.label + ': фаза L подаётся через каждое реле — с первого на «открыть», со второго на «закрыть»; два реле одновременно не включаются, но защиту от залипания контактов обеспечивает схема подключения привода.';
        row(dv, [o1.key].concat(o2.dev === dv && o2.key !== o1.key ? [o2.key] : []), a.label, how + (dest ? ' · ' + dest : ''));
      } else {
        var how1 = o1.how === 'rl2' ? 'COM — фаза L, NO — на нагрузку (нормально разомкнутый контакт); N и PE — с шины щита.'
          : o1.how === 'rl6' ? 'COM группы — фаза L, выход ' + o1.label.split(', ')[1] + ' — на нагрузку; N и PE — с шины щита.'
          : 'фаза L через ' + o1.label + ' — на нагрузку; N и PE — с шины щита. Ток не более 3 А.';
        row(dv, [o1.key], a.label, how1 + (dest ? ' · ' + dest : ''));
      }
    });

    // ── датчики ──
    var probes = F.probes || [];
    var flask = probes.filter(function (p) { return p.type === 'flask'; });
    var ntcP = probes.filter(function (p) { return p.type === 'ntc'; });
    if (id === '7007') {
      var ntcKeys = { mix: ['ntc1', 'ntc2'], dhw: ['ntc3'], cascade: ['ntc4'] }, mixK = 0;
      ntcP.forEach(function (p) {
        var key = p.role === 'mix' ? ntcKeys.mix[mixK++] : ntcKeys[p.role][0];
        row(ctrlDev, [key], p.label, 'датчик NTC 10K в колбе — 2 провода без полярности' + (p.kit ? ' (из комплекта)' : '') + '.');
      });
    }
    if (flask.length || F.airWired) {
      var parts = flask.map(function (p) { return p.label + (p.kit ? ' (из комплекта)' : ''); });
      if (F.airWired) parts.push((tc.airKind === 'thermostat' ? 'комнатные термостаты' : 'комнатные датчики') + ' × ' + F.airWired);
      row(ctrlDev, ['ow'], 'Датчики на шине 1-Wire × ' + (flask.length + F.airWired),
        'три жилы: ⏚ — GND, DAT — данные, V+ — питание; все параллельно на одну шину, до 5 на шину, шлейф до 60 м, не короче 1 м между приборами. ' + parts.join('; '));
    }
    if (F.airRadio || tc.needRadio) row(ctrlDev, ['ow'], 'Радиомодуль RDT2', 'подключается по 1-Wire; радиодатчики и радиотермостаты (868 МГц) работают через него.');

    // ── входы ──
    var inKeys = id === '6281' ? ['dio1', 'dio2', 'dio3', 'dio4'] : id === '6284' ? ['di1', 'di2'] : id === '7007' ? ['di1', 'di2'] : [];
    var dioUsed = 0;
    // Smart 2: каждый блок RL2 / RL2S занимает два DIO, остальные — датчикам
    if (id === '6281') {
      MODS.forEach(function (mm) {
        if (mm.id !== '6295' && mm.id !== '6296') return;
        var k1 = 'dio' + (dioUsed + 1), k2 = 'dio' + (dioUsed + 2); dioUsed += 2;
        row(ctrlDev, [k1, k2], MODNAME[mm.id] + ' №' + mm.n + ' — управление блоком', 'DIO ' + (dioUsed - 1) + ' → OK 1 блока, DIO ' + dioUsed + ' → OK 2 блока (открытый коллектор; сигнал — на клемму, отмеченную точкой); 12VDC блока — параллельно питанию прибора.');
        row(mm.dev, ['ok1', 'ok2', 'pw'], 'Управление и питание', 'OK 1 и OK 2 — на DIO ' + (dioUsed - 1) + ' и DIO ' + dioUsed + ' прибора; 12VDC V+ и ⏚ — параллельно +12VDC IN прибора, с того же блока питания.');
      });
    }
    var leakQ = tc.leakQty || 0, snowQ = tc.snowSensor ? 1 : 0, inUsed = id === '6281' ? dioUsed : 0;
    function nextIn(cnt) {
      var ks = [];
      for (var q = 0; q < cnt; q++) { if (inKeys[inUsed]) ks.push(inKeys[inUsed]); inUsed++; }
      return ks;
    }
    if (leakQ > 0 && inKeys.length) {
      var lk = nextIn(Math.min(leakQ, Math.max(0, inKeys.length - inUsed)));
      var viaDi6 = leakQ > lk.length;
      row(ctrlDev, lk.length ? lk : ['ow'], 'Датчики протечки × ' + leakQ,
        'Neptun SW005: три провода — красный +12–24 В, жёлтый — сигнал, зелёный — GND; сигнал каждого датчика на свой вход' + (lk.length ? ' (' + lk.length + ' шт. на входах прибора' + (viaDi6 ? ', остальные на блок DI6' : '') + ')' : ' — на блок DI6') + '; питание 12 В — с клемм «+12VDC».');
    } else if (leakQ > 0 && id === '6280') { /* GO!: датчиков протечки нет */ }
    if (leakQ > inKeys.length - (id === '6281' ? dioUsed : 0)) {
      var di6 = MODS.filter(function (mm) { return mm.id === '6298'; })[0];
      if (di6) row(di6.dev, [], 'Датчики протечки — входы блока DI6', 'по одному датчику на вход (до 6 на блок), красный +12–24 В, жёлтый — сигнал, зелёный — GND; питание блока 12 В — с «+12VDC OUT» или отдельного блока.');
    }
    if (snowQ && inKeys.length) row(ctrlDev, nextIn(1), 'Датчик осадков снеготаяния', 'сухой контакт реле времени на дискретный вход прибора.');
    if (F.pressureOn && (id === '6284' || id === '7007')) row(ctrlDev, ['i420'], 'Датчик давления 4–20 мА', 'IN — сигнал, ' + (id === '7007' ? '+12V' : 'V+') + ' — питание датчика; токовая петля, два провода.');

    // ── модули по EXT / Wi-Fi ──
    MODS.forEach(function (mm) {
      if (id === '6281') return;
      if (mm.id === '6298') { row(ctrlDev, ['ext'], 'Блок DI6 №' + mm.n, 'EXT A → A, EXT B → B (витая пара UTP cat.5, до 12 устройств в шлейфе); питание 12 В — с «+12VDC OUT» или от отдельного блока.'); return; }
      if (id === '7007') { row(ctrlDev, ['ext'], MODNAME[mm.id] + ' №' + mm.n + ' — блок расширения', 'по Wi-Fi: блок получает питание 9–24 В от отдельного блока питания и сопрягается с прибором в личном кабинете (до 3 блоков через сеть прибора).'); return; }
      row(ctrlDev, ['ext', 'po'], MODNAME[mm.id] + ' №' + mm.n + ' — блок расширения', 'EXT A → A, EXT B → B (витая пара UTP cat.5), 12VDC блока — с «+12VDC OUT» прибора (не более 6 Вт на все блоки) или параллельно питанию; блоки соединяются друг с другом тем же шлейфом.');
      row(mm.dev, ['ext', 'pw'], 'Шина и питание', 'EXT A/B — к прибору или к соседнему блоку; 12VDC V+ и ⏚ — питание; датчик смесительного узла — на разъём 1-wire того блока, который ведёт его привод.');
    });

    // ── размеры и рисование ──
    // Карточка прибора: корпус с колодками клемм слева, потребители и датчики справа, между ними —
    // провода (ломаная от клеммы вниз и вправо). Линия — один кабель; цвет — назначение,
    // над линией — марка кабеля. Провода идут «лесенкой»: самая правая клемма — к верхнему потребителю,
    // поэтому линии друг друга не пересекают.
    var GAP = 2.2, STRIPW = 214, XB = X0 + 262, BW = X0 + WW - 4 - XB, LANE = 4.6;
    var out = [], y = 14;
    out.push(txt(W / 2, 8.4, 'Схема подключения автоматики котельной — MyHeat ' + M.short, { size: 4.4, anchor: 'middle', weight: 'bold' }));

    // Шаг клемм подбирается по карточке: колодки растягиваются на отведённую ширину, но не крупнее 5,4 мм
    function layoutGroups(groups, pp) {
      var rowsG = [[]], x = 0, fits = true;
      groups.forEach(function (g) {
        if (g.br) { rowsG.push([]); x = 0; return; }
        var w = g.n * pp;
        if (x + w > STRIPW - 4 && rowsG[rowsG.length - 1].length) { rowsG.push([]); x = 0; }
        if (x + w > STRIPW) fits = false;
        g.rx = x; g.w = w; x += w + GAP; rowsG[rowsG.length - 1].push(g);
      });
      rowsG.fits = fits;
      return rowsG;
    }
    function layoutBest(groups) {
      var tries = [5.4, 5.0, 4.6, 4.2, 3.8, 3.5, P], want = groups.some(function (g) { return g.br; }) ? 2 : 1, pick = null;
      for (var i = 0; i < tries.length; i++) {
        var r = layoutGroups(groups, tries[i]);
        if (r.length <= want && r.fits) { pick = { rows: r, pp: tries[i] }; break; }
      }
      if (!pick) pick = { rows: layoutGroups(groups, P), pp: P };
      return pick;
    }
    // цвет линии — по назначению клеммы; марка кабеля — ориентир (нагрузка до 3 А)
    function wireColor(g) {
      return g.col === GREEN ? '#C2410C' : g.col === RED ? '#B91C1C' : g.col === BLUE ? '#0D9488' : g.col === YEL ? '#B45309' : '#475569';
    }
    function cableOf(r, g) {
      var w = String(r.what || '').toLowerCase(), t = String(g.t || '').toLowerCase();
      if (g.col === YEL) return 'UTP cat.5';
      if (g.col === RED) return /220/.test(t) ? 'ПВС 3×1,5' : '2×0,75';
      if (g.col === BLUE || g.col === WHITE) return '2×0,5';
      if (g.col === GREY) return g.k === 'ow' ? '3×0,5' : '2×0,5';
      if (/котёл|котел/.test(w)) return '2×0,75';
      if (/привод/.test(w)) return 'ПВС 4×0,75';
      if (/кран|соленоид/.test(w)) return 'ПВС 3×0,75';
      return 'ПВС 3×1,5';
    }
    function iconOf(what) {
      var w = String(what || '').toLowerCase();
      if (/питание прибора 220/.test(w)) return icoBreaker;
      if (/котёл|котел/.test(w)) return function (a, b, s) { return icoBoiler(a, b, s, /газов/.test(w)); };
      if (/привод/.test(w)) return icoServo;
      if (/кран|соленоид/.test(w)) return icoValveAct;
      if (/насос/.test(w)) return icoPump;
      if (/протечк/.test(w)) return icoDrop;
      if (/термостат/.test(w)) return icoPanel;
      if (/датчик|ntc|1-wire/.test(w)) return icoProbe;
      return function (a, b, s) { return icoModule(a, b, s, /радио|rdt/.test(w)); };
    }
    function wrapTxt(s, k, maxLines) {
      var words = String(s || '').split(/\s+/), lines = [], cur = '';
      words.forEach(function (wd) {
        if ((cur + ' ' + wd).trim().length > k) { if (cur) lines.push(cur); cur = wd; } else cur = (cur + ' ' + wd).trim();
      });
      if (cur) lines.push(cur);
      if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = cut(lines[maxLines - 1] + '…', k); }
      return lines;
    }
    var badgeN = 0;
    devs.forEach(function (dv) {
      if (!dv.rows.length && dv !== ctrlDev) return;
      var lay = layoutBest(dv.groups), rowsG = lay.rows, pp = lay.pp;
      var cy0 = y, idx = out.length;
      out.push('');   // сюда ляжет рамка карточки, когда станет известна высота
      out.push(txt(X0 + 4, cy0 + 5.4, dv.title, { size: 3, weight: 'bold' }));
      out.push(txt(X0 + WW - 4, cy0 + 5.4, dv.sub, { size: 2.1, anchor: 'end', fill: '#64748B' }));
      out.push(ln(X0 + 3, cy0 + 7, X0 + WW - 3, cy0 + 7, { c: '#CBD5E1', w: 0.3 }));
      // номера: у клеммы и у потребителя
      var num = {};
      dv.rows.forEach(function (r) { badgeN++; r.n = badgeN; (r.keys || []).forEach(function (k) { if (!num[k]) num[k] = []; num[k].push(badgeN); }); });
      var cur = cy0 + 9;
      // какому ряду колодок принадлежит строка таблицы — по первой найденной клемме
      var rowOf = dv.rows.map(function (r) {
        for (var q = 0; q < rowsG.length; q++) for (var q2 = 0; q2 < rowsG[q].length; q2++) {
          if ((r.keys || []).indexOf(rowsG[q][q2].k) >= 0) return q;
        }
        return rowsG.length - 1;
      });
      rowsG.forEach(function (rg, ri) {
        var hTop = cur + 4, yy = hTop + 12, hBot = yy + 13.5, hx = X0 + 3, hw = STRIPW + 6;
        // корпус
        out.push(rrect(hx, hTop, hw, hBot - hTop, 2.2, { f: '#EEF1F5', c: '#94A3B8', w: 0.5 }));
        out.push(rrect(hx + 1, hTop + 1, hw - 2, 2.6, 1, { f: '#DDE3EA' }));
        out.push(txt(hx + 3, hTop + 3.2, ri === 0 ? (dv === ctrlDev ? 'MyHeat ' + M.short : dv.title) : 'нижний ряд клемм корпуса',
          { size: 2, weight: 'bold', fill: '#475569' }));
        if (ri === 0 && dv === ctrlDev && id !== '7007') {   // антенна у GO!, Smart 2 и Pro
          out.push(seg([[hx + hw - 14, hTop], [hx + hw - 14, hTop - 4]], '#334155', 0.8));
          out.push(circle(hx + hw - 14, hTop - 4.3, 0.8, { f: '#334155' }));
        }
        // фото прибора с myheat.net — рядом с корпусом, чтобы было видно, как он выглядит
        if (ri === 0 && dv.img) out.push('<image href="img/' + dv.img + '.jpg" x="' + n(XB + (BW - 46) / 2) + '" y="' + n(hTop - 1) + '" width="46" height="28.3" preserveAspectRatio="xMidYMid meet"/>' +
          rrect(XB + (BW - 46) / 2, hTop - 1, 46, 28.3, 1, { f: 'none', c: '#CBD5E1', w: 0.3 }));
        // колодки
        var pos = {};
        rg.forEach(function (g) {
          var on = !!num[g.k], gx = X0 + 6 + g.rx, cx = gx + g.w / 2;
          pos[g.k] = cx;
          out.push(pluggable(gx, yy, g.n, g.col, on, false, null, pp));
          g.pl.forEach(function (lab, i) { out.push(txt(gx + pp / 2 + i * pp, yy - 1.6, lab, { size: 1.9, anchor: 'middle', fill: on ? '#0F172A' : '#94A3B8' })); });
          out.push(txt(gx + g.w / 2, yy - 5, g.t, { size: 1.9, anchor: 'middle', weight: 'bold', fill: on ? '#0F172A' : '#94A3B8' }));
        });
        // строки этого ряда: по самой правой клемме — справа налево, чтобы провода не пересекались
        var mine = [];
        dv.rows.forEach(function (r, i) { if (rowOf[i] === ri) mine.push(r); });
        mine.forEach(function (r) {
          r.ws = (r.keys || []).filter(function (k) { return pos[k] !== undefined; }).sort(function (a, b) { return pos[b] - pos[a]; });
          r.mx = r.ws.length ? pos[r.ws[0]] : -1;
        });
        mine.sort(function (a, b) { return b.mx - a.mx; });
        var gk = {}; rg.forEach(function (g) { gk[g.k] = g; });
        var ry = hBot + 4;
        mine.forEach(function (r) {
          var how = wrapTxt(r.how, 70, 3);
          var bh = Math.max(11, 9.6 + how.length * 3.3, r.ws.length * LANE + 3);
          // потребитель
          out.push(rrect(XB, ry, BW, bh, 1.4, { f: '#FFFFFF', c: '#94A3B8', w: 0.4 }));
          out.push(circle(XB + 4.2, ry + 4.4, 2.2, { f: '#DCFCE7', c: '#15803D', w: 0.5 }));
          out.push(txt(XB + 4.2, ry + 5.3, String(r.n), { size: 2.3, anchor: 'middle', weight: 'bold', fill: '#14532D' }));
          out.push(iconOf(r.what)(XB + 12, ry + bh / 2 + 1, 8));
          out.push(txt(XB + 19, ry + 3.6, cut(r.what, 58), { size: 2.35, weight: 'bold' }));
          var cab = r.ws.length ? cableOf(r, gk[r.ws[0]]) : '';
          if (cab) out.push(txt(XB + 19, ry + 6.9, 'кабель ' + cab, { size: 2.0, weight: 'bold', fill: wireColor(gk[r.ws[0]]) }));
          how.forEach(function (ln1, li) { out.push(txt(XB + 19, ry + 10.2 + li * 3.3, ln1, { size: 1.75, fill: '#475569' })); });
          // провода от клемм
          r.ws.forEach(function (k, j) {
            var g = gk[k], cx = pos[k], ly = ry + 4.2 + j * LANE, col = wireColor(g);
            out.push(seg([[cx, yy + 7], [cx, ly], [XB, ly]], col, 0.7));
            out.push(circle(cx, ly, 0.55, { f: col }));
            out.push(txt(XB - 2, ly - 0.9, cableOf(r, g), { size: 1.85, anchor: 'end', fill: col, weight: 'bold' }));
          });
          ry += bh + 1.6;
        });
        // номера под колодками — поверх проводов, чтобы связь «клемма — потребитель» читалась
        rg.forEach(function (g) {
          if (!num[g.k]) return;
          var label = num[g.k].join(','), bw2 = Math.max(4.4, label.length * 1.6 + 2.2);
          out.push(rrect(pos[g.k] - bw2 / 2, yy + 8.1, bw2, 4, 2, { f: '#DCFCE7', c: '#15803D', w: 0.4 }));
          out.push(txt(pos[g.k], yy + 11, label, { size: 2.2, anchor: 'middle', weight: 'bold', fill: '#14532D' }));
        });
        cur = Math.max(ry, hBot + 4) + 1;
      });
      out[idx] = rrect(X0, cy0, WW, cur - cy0 + 1, 1.6, { f: '#FCFDFE', c: '#CBD5E1', w: 0.5 });
      y = cur + 5;
    });

    // ── условные обозначения ──
    var LEG = [['#C2410C', 'нагрузка 230 В (насос, привод, котёл)'], ['#B91C1C', 'питание'], ['#0D9488', 'шина и дискретные входы'], ['#B45309', 'шина EXT к блокам'], ['#475569', 'датчики']];
    out.push(rrect(X0, y, WW, 11.5, 1.6, { f: FACE2, c: '#CBD5E1', w: 0.5 }));
    var lx = X0 + 5;
    LEG.forEach(function (L) {
      out.push(seg([[lx, y + 4.4], [lx + 8, y + 4.4]], L[0], 0.9));
      out.push(txt(lx + 10, y + 5.1, L[1], { size: 2.0, fill: '#334155' }));
      lx += 12 + L[1].length * 1.75;
    });
    out.push(txt(X0 + 5, y + 9.4, 'Одна линия — один кабель, над линией его марка. Сечения ориентировочные: ток нагрузки до 3 А, длины и сечение силовых — по паспортам нагрузки.', { size: 1.85, fill: '#64748B' }));
    y += 15.5;

    // ── что в смете есть, но проводов к контроллеру не имеет ──
    var offList = [];
    boilers = tc.boilers || [];
    if (tc.dhw === 'boiler_ct') offList.push('Бойлер ГВС на переключающем клапане котла — клапан и датчик бойлера подключаются к самому котлу, контроллер задаёт уставку по шине.');
    if (tc.dhw === 'external') offList.push('Бойлер ГВС мимо контроллера — у котла нет цифровой шины, ГВС остаётся на его собственной автоматике.');
    if (tc.dhw === 'ct') offList.push('ГВС от двухконтурного котла — проточный теплообменник котла, отдельного бойлера в смете нет.');
    if (!F.pumpsOn && (tc.directCount || 0) > 0) offList.push('Насосы радиаторных контуров × ' + tc.directCount + ' — питание от щита, работают постоянно; температуру ведёт котёл.');
    if (boilers.some(function (b) { return b.iface === 'own'; })) offList.push('Котлы сверх подчинённых контроллеру — на собственной автоматике, в каскад не входят.');
    if (tc.airOn && tc.airQty > 0 && F.airRadio) offList.push('Комнатные радиоприборы × ' + tc.airQty + ' — по радио (868 МГц), провода не нужны.');
    if (offList.length) {
      var oh = 9.6 + offList.length * 5.2;
      out.push(rrect(X0, y, WW, oh, 1.6, { f: FACE2, c: '#94A3B8', w: 0.5 }));
      out.push(txt(X0 + 4, y + 5.4, 'В смете есть, но проводов к контроллеру не имеет', { size: 2.6, weight: 'bold' }));
      offList.forEach(function (t, i) { out.push(txt(X0 + 4, y + 10.6 + i * 5.2, cut(t, 215), { size: 2.1, fill: '#475569' })); });
      y += oh + 4;
    }
    var H = y + 4;
    o = o.concat(out);
    return { svg: o.join(''), w: W, h: H };
  }

  // ─── Схема подключения автоматики на ZONT серии H (PRO.V2) ─────────────
  // Клеммы — по фотографиям приборов в паспорте ML.TD.ZHContPRO.V2.001
  // (стр. 10–11, 64–66). Две кромки, как на самом приборе:
  //   сверху  — датчики: NTC (⏚ и по два входа на колодку), 1-Wire, RS-485;
  //   снизу   — питание (⏚, +12 В вход, +12 В выход), универсальные вход/выходы,
  //             реле (три контакта: 1 НЗ, 2 общий, 3 НР) или выходы ОК (H1500+).
  // Порядок клемм в ряду — по фото; номера контактов реле — по рисункам паспорта
  // (стр. 164, 166): фаза на общий (2), нагрузка с НР (3).
  //
  // Привод смесителя 220 В: на двух встроенных реле по схеме паспорта (стр. 164) —
  // фаза на общий первого реле, «закрыть» с его НР, а его НЗ питает общий второго
  // реле, с НР которого идёт «открыть»: оба входа привода сразу под напряжением
  // оказаться не могут. На выходах ОК то же самое делают два реле 12 В.
  // Нагрузка 220 В на выход ОК напрямую не вешается (паспорт, стр. 79, 166).
  function automationH(tc, items) {
    tc = tc || {};
    items = items || {};
    var nm = items.names || {};
    var f = tc.hser || {};
    var M = f.model || { short: 'H1000+', name: 'ZONT H1000+ PRO.V2', relays: 4, uni: 2, oc: 0, ntc: 4, id: '' };
    var o = [], W = 420;
    var LS = 19, CH = 70;
    var DXL = 92, DXR = 328, ICL = 62, ICR = 358, ICO = 13;
    var CJ = '#EA580C';                 // перемычка блокировки реле
    var CD1 = '#7C3AED';

    // ── колодки (слева направо) ──
    var relPins = ['НЗ', 'О', 'НР'];
    var bot = [{ k: 'pw', n: 3, t: 'Питание', pl: ['⏚', '+12 Вх', '+12 Вых'], col: '#B91C1C' }];
    if (M.short === 'H1500+') {
      bot.push({ k: 'u1', n: 6, t: 'Вход/Выход 1–6', pl: ['1', '2', '3', '4', '5', '6'], col: '#2563EB' });
      bot.push({ k: 'oc', n: 6, t: 'Выходы ОК 7–12', pl: ['7', '8', '9', '10', '11', '12'], col: '#16A34A' });
    } else {
      bot.push({ k: 'u1', n: 2, t: 'Вход/Выход', pl: M.short === 'H2000+' ? ['1', '2'] : ['1', '2'], col: '#2563EB' });
      for (var r = 1; r <= M.relays; r++) bot.push({ k: 'r' + r, n: 3, t: 'Реле ' + r, pl: relPins, col: '#16A34A', relay: true });
      if (M.short === 'H2000+') bot.push({ k: 'u2', n: 2, t: 'Вход/Выход', pl: ['3', '4'], col: '#2563EB' });
    }
    var ntcN = Math.min(M.ntc, 8), ntcGroups = [];
    for (var g = 0; g < ntcN; g += 2) {
      var pair = (g + 1 < ntcN) ? [g + 1, g + 2] : [g + 1];
      ntcGroups.push({ k: 'n' + g, n: 1 + pair.length, t: 'NTC', pl: ['⏚'].concat(pair.map(String)), col: '#9CA3AF' });
    }
    var top = ntcGroups.concat([
      { k: 'ow', n: 2, t: '1-Wire', pl: ['⏚', '1w'], col: '#9CA3AF' },
      { k: 'rs', n: 3, t: 'RS-485 (интерфейс)', pl: ['⏚', 'B', 'A'], col: '#F1F5F9' }
    ]);
    function layout(row, W0) {
      var total = 0; row.forEach(function (b) { b.w = b.n * P; total += b.w; });
      var gap = Math.max(1.6, (W0 - 12 - total) / Math.max(1, row.length - 1));
      var x = 6;
      row.forEach(function (b) { b.x = x; b.cx = x + b.w / 2; x += b.w + gap; });
    }
    var botPins = bot.reduce(function (a, b) { return a + b.n; }, 0);
    var CW = Math.max(150, Math.min(250, botPins * P + (bot.length - 1) * 2.4 + 14));
    var CX = (W - CW) / 2;
    layout(bot, CW); layout(top, CW);
    bot.forEach(function (b) { b.x += CX; b.cx += CX; });
    top.forEach(function (b) { b.x += CX; b.cx += CX; });
    var T = {}; bot.concat(top).forEach(function (b) { T[b.k] = b; });
    function wireX(blk, i) { return blk.x + P / 2 + i * P; }
    function legsOf(arr) { return arr.slice().sort(function (p, q) { return wireX(p.b, p.i) - wireX(q.b, q.i); }); }
    function boilerIco(gas) { return function (a, c, s) { return icoBoiler(a, c, s, gas); }; }
    function icoGauge(cx, cy, s) {
      return circle(cx, cy, s * 0.36, { f: FACE2, c: INK, w: 0.55 }) + seg([[cx, cy], [cx + s * 0.18, cy - s * 0.18]], INK, 0.55) +
        circle(cx, cy, s * 0.05, { f: INK });
    }

    var dn = [], up = [];   // выноски нижней и верхней кромки

    // ── распределение выходов: так же, как zontHFit() — в порядке нагрузок ──
    var relIdx = 0;         // следующее свободное встроенное реле
    var uniPins = [];       // свободные выходы ОК
    var uniAll = [];
    if (M.short === 'H1500+') {
      for (var q = 0; q < 6; q++) uniAll.push({ b: T.oc, i: q });
      for (var q2 = 0; q2 < 6; q2++) uniAll.push({ b: T.u1, i: q2 });
    } else {
      for (var q3 = 0; q3 < 2; q3++) uniAll.push({ b: T.u1, i: q3 });
      if (T.u2) for (var q4 = 0; q4 < 2; q4++) uniAll.push({ b: T.u2, i: q4 });
    }
    var uniIn = [];         // входы: шлейф протечки, датчик давления
    function takeIn() {
      // входы берём с универсальных клемм (не с отдельных ОК-выходов H1500+)
      var k = uniAll.findIndex(function (u) { return u.b.k !== 'oc'; });
      return k < 0 ? null : uniAll.splice(k, 1)[0];
    }
    if (tc.leakQty > 0) uniIn.push({ what: 'leak', pin: takeIn() });
    if (f.pressureOn) uniIn.push({ what: 'press', pin: takeIn() });
    if (f.snowIn) uniIn.push({ what: 'snow', pin: takeIn() });
    function nextRelay() { return relIdx < M.relays ? T['r' + (++relIdx)] : null; }
    function nextOc() { return uniAll.length ? uniAll.shift() : null; }

    var relayBoilerIco = null;
    (tc.boilers || []).filter(function (b) { return b.iface === 'relay'; }).slice(0, 2).forEach(function (b) {
      relayBoilerIco = boilerIco(b.kind === 'gas');
    });

    // питание: блок 12 В из комплекта
    dn.push({
      legs: legsOf([{ b: T.pw, i: 0, c: CRS[0], l: '−' }, { b: T.pw, i: 1, c: CRS[3], l: '+12 В' }]),
      ico: icoBreaker, title: 'Блок питания 12 В', sub: 'из комплекта · розетка ~220 В'
    });

    var onBlocks = (f.assign || []).filter(function (a) { return a.block; });
    (f.assign || []).forEach(function (a) {
      if (a.block) return;   // клеммы блока расширения — по паспорту блока, здесь не рисуем
      var isValve = /кран|соленоид/i.test(a.label), isBoiler = /котёл/i.test(a.label);
      var isMix = /смесител/i.test(a.label);
      var ico = isMix ? icoServo : isValve ? icoValveAct : isBoiler ? (relayBoilerIco || icoModule) : icoPump;
      var circ = (tc.circuits || []).filter(function (c) { return c.name === a.circuit; })[0];
      var sub = isMix ? cut(nm.mixServo || 'сервопривод смесителя, 230 В', 36)
        : isValve ? cut(nm.leakValve || 'на вводе ХВС', 32)
          : isBoiler ? 'клеммы термостата котла · перемычку снять'
            : /бойлер/i.test(a.label) ? cut(nm.dhwPump || 'из обвязки бойлера', 32)
              : /рециркуляц/i.test(a.label) ? cut(nm.recircPump || 'линия Т4', 32)
                : cut(nm[(circ && circ.type === 'mix' ? 'mixGroup' : 'dirGroup')] || 'насосная группа', 32);
      if (a.how === 'built' && a.pair) {
        // «открыть» — первое реле, «закрыть» — второе: перемычка блокировки идёт
        // от НЗ второго к общему первого и пересекает ровно одну жилу
        var ro = nextRelay(), rc = nextRelay();
        if (!ro || !rc) return;
        dn.push({
          legs: legsOf([{ b: ro, i: 2, c: COPEN, l: 'откр.' }, { b: rc, i: 1, c: CL, l: 'L' }, { b: rc, i: 2, c: CCLOSE, l: 'закр.' }]),
          jump: { from: { b: rc, i: 0 }, to: { b: ro, i: 1 } },
          nStub: true, pe: true, ico: ico, title: a.label, sub: sub + ' · блокировка'
        });
      } else if (a.how === 'built') {
        var rb = nextRelay();
        if (!rb) return;
        if (isValve) dn.push({
          legs: legsOf([{ b: rb, i: 0, c: CCLOSE, l: 'НЗ' }, { b: rb, i: 1, c: CL, l: 'О' }, { b: rb, i: 2, c: COPEN, l: 'НР' }]),
          nStub: true, pe: true, ico: ico, title: a.label, sub: sub
        });
        else if (isBoiler) dn.push({
          legs: legsOf([{ b: rb, i: 1, c: CCLOSE, l: 'О' }, { b: rb, i: 2, c: '#6B7280', l: 'НР' }]),
          ico: ico, title: a.label, sub: sub
        });
        else dn.push({
          legs: legsOf([{ b: rb, i: 1, c: CL, l: 'О' }, { b: rb, i: 2, c: CL, l: 'НР' }]),
          nStub: true, pe: true, ico: ico, title: a.label, sub: sub
        });
      } else if (a.pair) {
        var p1 = nextOc(), p2 = nextOc();
        if (!p1 || !p2) return;
        dn.push({
          legs: legsOf([{ b: T.pw, i: 2, c: CRS[3], l: '+12' }, { b: p1.b, i: p1.i, c: CD1, l: 'ОК' }, { b: p2.b, i: p2.i, c: CD1, l: 'ОК' }]),
          inline: 'Реле 12 В × 2 (блокировка)', clampsOut: ['откр.', 'L', 'закр.'], wiresOut: [COPEN, CL, CCLOSE],
          nStub: true, pe: true, ico: ico, title: a.label, sub: sub + ' · через реле 12 В'
        });
      } else {
        var p0 = nextOc();
        if (!p0) return;
        dn.push({
          legs: legsOf([{ b: T.pw, i: 2, c: CRS[3], l: '+12' }, { b: p0.b, i: p0.i, c: CD1, l: 'ОК' }]),
          inline: 'Реле 12 В', clampsOut: ['L', 'N', '⏚'], wiresOut: [CL, CN, CPE2],
          pe: false, ico: ico, title: a.label, sub: sub + ' · через реле 12 В'
        });
      }
    });

    // шлейф протечки и датчик давления на универсальных входах
    uniIn.forEach(function (u) {
      if (!u.pin) return;
      if (u.what === 'leak') dn.push({
        legs: legsOf([{ b: u.pin.b, i: u.pin.i, c: CD1, l: 'Вх' }]), ico: icoDrop,
        title: 'Датчики протечки × ' + tc.leakQty, sub: 'шлейф АСТРА-361 на вход · полярность — паспорт'
      });
      else if (u.what === 'snow') {
        // Сухой контакт реле времени датчика осадков: один провод на вход, второй — на «минус» питания.
        dn.push({
          legs: legsOf([{ b: u.pin.b, i: u.pin.i, c: CD1, l: 'Вх' }]), ico: icoModule,
          title: 'Датчик осадков · через реле времени', sub: 'сухой контакт на вход · тип «Дискретный», полярность в сервисе'
        });
        dn.push({
          legs: legsOf([{ b: T.pw, i: 0, c: CRS[0], l: '−' }]), ico: icoModule,
          title: 'Датчик осадков · общий провод', sub: 'второй провод контакта — на «минус» питания'
        });
      } else {
        dn.push({
          legs: legsOf([{ b: u.pin.b, i: u.pin.i, c: '#EAB308', l: 'сигнал' }]), ico: icoGauge,
          title: 'Датчик давления MLD-10.01 · сигнал', sub: 'жёлтая жила — на универсальный вход'
        });
        dn.push({
          legs: legsOf([{ b: T.pw, i: 0, c: CRS[0], l: '−' }, { b: T.pw, i: 1, c: CRS[3], l: '+12 В' }]), ico: icoGauge,
          title: 'Датчик давления MLD-10.01 · питание', sub: 'красная жила +12 В, чёрная — «минус»'
        });
      }
    });

    // ── датчики температуры (верхняя кромка) ──
    var ntcPin = 0;                 // следующий свободный вход NTC
    function ntcLegs() {
      var gi = Math.floor(ntcPin / 2), within = ntcPin % 2, blk = ntcGroups[gi];
      if (!blk) return null;
      ntcPin++;
      return legsOf([{ b: blk, i: 0, c: CRS[0], l: '⏚' }, { b: blk, i: 1 + within, c: CSIG, l: '' + (ntcPin) }]);
    }
    var SROLE = {
      out: { t: 'Уличный датчик МЛ-773', s: 'на северную стену, в тень · из комплекта', ico: icoProbe },
      supply: { t: 'Датчик подачи в гильзу', s: 'в гильзу на подаче контура · из комплекта', ico: icoProbe },
      dhw: { t: 'Датчик бойлера', s: 'в гильзу бойлера ГВС · из комплекта', ico: icoTank },
      cascade: { t: 'Датчик каскада', s: 'в гильзу за гидрострелкой · из комплекта', ico: icoProbe }
    };
    var dsList = [];
    (f.sensors || []).forEach(function (sn) {
      if (sn.src === 'ds') { dsList.push(sn); return; }
      var lg = ntcLegs(), rl = SROLE[sn.role] || SROLE.supply;
      if (!lg) { dsList.push(sn); return; }
      up.push({ legs: lg, ico: rl.ico, title: sn.role === 'supply' ? rl.t + ' · ' + sn.label.replace(/^Подача /, '') : rl.t, sub: rl.s });
    });
    if (dsList.length) up.push({
      legs: legsOf([{ b: T.ow, i: 0, c: CRS[0], l: '⏚' }, { b: T.ow, i: 1, c: CSIG, l: '1w' }]),
      ico: icoProbe, title: 'Датчики 1-Wire × ' + dsList.length,
      sub: cut(dsList.map(function (x) { return x.label; }).join(' · '), 44) + ' · параллельно'
    });

    // ── RS-485: адаптеры котлов, приборы воздуха, радиомодуль ──
    function busLegs() {
      return legsOf([{ b: T.rs, i: 0, c: CRS[0], l: '⏚' }, { b: T.rs, i: 1, c: CRS[1], l: 'B' }, { b: T.rs, i: 2, c: CRS[2], l: 'A' }]);
    }
    (tc.boilers || []).filter(function (b) { return b.iface === 'digital'; }).slice(0, 2).forEach(function (b, i) {
      up.push({
        legs: busLegs(), inline: 'Адаптер цифровых шин', clampsOut: ['ЦШ', 'ЦШ'], wiresOut: [CBUS, CBUS2], inlineOut: 'ЦШ котла',
        ico: boilerIco(b.kind === 'gas'), title: 'Котёл ' + (i + 1) + ' — ' + (b.kind === 'gas' ? 'газовый' : 'электрический'),
        sub: cut(nm['boiler' + i] || 'питание адаптера — от «+12 В выход»', 40)
      });
    });
    var radioAir = !!(tc.airOn && tc.airQty > 0 && tc.airDevice && tc.airDevice.link === 'radio');
    if (tc.airOn && tc.airQty > 0 && !radioAir) up.push({
      legs: busLegs(), ico: tc.airKind === 'thermostat' ? icoPanel : icoPuck,
      title: tc.airKind === 'thermostat' ? 'Комнатный термостат' : 'Датчик воздуха комнатный', sub: cut(nm.air || 'по шине RS-485', 32)
    });
    if (tc.needRadio) up.push({
      legs: busLegs(), ico: function (a, c, s) { return icoModule(a, c, s, true); },
      title: 'Радиомодуль МЛ-590', sub: 'радиодатчики 868 МГц · до 40 устройств'
    });

    // ── этажи ──
    function split(list) {
      list.forEach(function (d) {
        d.xLo = Infinity; d.xHi = -Infinity;
        d.legs.forEach(function (g) { var x = wireX(g.b, g.i); d.xLo = Math.min(d.xLo, x); d.xHi = Math.max(d.xHi, x); });
      });
      list.sort(function (a, b) { return (a.xLo - b.xLo) || (a.xHi - b.xHi); });
      var cutAt = 0, runHi = -Infinity, best = null;
      for (var s2 = 0; s2 <= list.length; s2++) {
        if (s2 > 0) runHi = Math.max(runHi, list[s2 - 1].xHi);
        if (s2 > 0 && s2 < list.length && runHi > list[s2].xLo) continue;
        var d2 = Math.abs(s2 - list.length / 2);
        if (best === null || d2 < best) { best = d2; cutAt = s2; }
      }
      return { L: list.slice(0, cutAt), R: list.slice(cutAt).reverse() };
    }
    var dS = split(dn), uS = split(up);
    var nUp = Math.max(uS.L.length, uS.R.length, 0), nDn = Math.max(dS.L.length, dS.R.length, 1);
    var CY = 26 + (nUp ? 4 + nUp * LS : 0), CB = CY + CH;

    // ── в смете есть, но проводов к контроллеру не имеет ──
    var offList = [];
    if (tc.dhw === 'boiler_ct') offList.push({ t: 'Бойлер ГВС · на переключающем клапане котла', s: cut(nm.tank || 'бойлер косвенного нагрева', 40) + ' — клапан и датчик бойлера подключаются к самому котлу' });
    if (tc.dhw === 'external') offList.push({ t: 'Бойлер ГВС · мимо контроллера', s: cut(nm.tank || 'бойлер косвенного нагрева', 40) + ' — у котла нет цифровой шины' });
    if (tc.dhw === 'ct') offList.push({ t: 'ГВС от двухконтурного котла', s: 'проточный теплообменник котла' });
    var ufh = items.ufh || null;
    if (ufh && (ufh.blocks || ufh.stats || ufh.servos)) offList.push({
      t: 'Автоматика радиаторов и тёплого пола (раздел 4.5)',
      s: [ufh.stats ? 'термостаты × ' + ufh.stats : '', ufh.servos ? 'сервоприводы × ' + ufh.servos : '', ufh.blocks ? 'коммутационный блок × ' + ufh.blocks : ''].filter(Boolean).join(' · ') + ' — своя зональная система на 230 В'
    });
    if (radioAir) offList.push({ t: (tc.airKind === 'thermostat' ? 'Комнатный термостат' : 'Датчик воздуха') + ' × ' + tc.airQty, s: cut(nm.air || 'радиоканал 868 МГц', 44) + ' — по радио через МЛ-590' });
    var OFF_ROW = 8.6, offBoxH = offList.length ? 9.6 + offList.length * OFF_ROW : 0;
    var offH = offBoxH ? offBoxH + 6 : 0;
    var H = CB + 14 + (nDn - 1) * LS + 40 + offH;

    o.push(txt(W / 2, 8.4, 'Схема подключения автоматики котельной — ' + M.name, { size: 4.4, anchor: 'middle', weight: 'bold' }));
    o.push(rrect(CX, CY, CW, CH, 6, { f: '#FCFDFE', c: '#94A3B8', w: 0.6 }));
    o.push(rrect(CX + 5, CY + 7, CW - 10, CH - 24, 4, { f: FACE2, c: '#CBD5E1', w: 0.4 }));
    o.push(txt(CX + CW / 2, CY + CH / 2 - 1, M.name, { size: 5, anchor: 'middle', fill: '#6B7280' }));
    o.push(txt(CX + CW / 2, CY + CH / 2 + 6, 'универсальный контроллер', { size: 2.6, anchor: 'middle', fill: '#94A3B8' }));

    var used = {};
    function drawSide(list, side, dir) {
      list.forEach(function (d, i) {
        var lane = dir > 0 ? CB + 14 + i * LS : CY - 14 - i * LS;
        var y0 = dir > 0 ? CB - 0.6 : CY + 0.6;
        var dx = side < 0 ? DXL : DXR;
        var legs = d.legs, Mn = legs.length;
        var hasOut = !!(d.inline && d.wiresOut && d.clampsOut);
        var mw = 28, mxc = side < 0 ? (DXL + CX) / 2 : (CX + CW + DXR) / 2;
        var clStrip = hasOut ? d.clampsOut : legs.map(function (g) { return g.l; });
        var Ms = clStrip.length;
        var inX = hasOut ? (side > 0 ? mxc - mw / 2 : mxc + mw / 2) : dx - side * 2.4;
        var rev = side > 0;
        function offOf(k) { return ((rev ? Mn - 1 - k : k) - (Mn - 1) / 2) * P * (dir > 0 ? 1 : -1); }
        function offS(k) { return ((rev ? Ms - 1 - k : k) - (Ms - 1) / 2) * P; }
        legs.forEach(function (g, k) {
          var cxw = wireX(g.b, g.i), yw = lane + offOf(k);
          used[g.b.k] = true;
          o.push(seg([[cxw, y0], [cxw, yw], [inX, yw]], g.c, 0.55));
          o.push(circle(cxw, y0, 0.75, { f: g.c }));
        });
        if (d.jump) {
          var xa = wireX(d.jump.from.b, d.jump.from.i), xb = wireX(d.jump.to.b, d.jump.to.i);
          used[d.jump.from.b.k] = true; used[d.jump.to.b.k] = true;
          o.push(seg([[xa, y0], [xa, y0 + 2.4], [xb, y0 + 2.4], [xb, y0]], CJ, 0.5, '1.3 1'));
          o.push(circle(xa, y0, 0.75, { f: CJ })); o.push(circle(xb, y0, 0.75, { f: CJ }));
        }
        if (hasOut) {
          var outX = side > 0 ? mxc + mw / 2 : mxc - mw / 2;
          d.wiresOut.forEach(function (c, k2) {
            var yy = lane + offS(k2) * (dir > 0 ? 1 : 1);
            o.push(seg([[outX, yy], [dx - side * 2.4, yy]], c, 0.55));
          });
          if (d.inlineOut) o.push(txt((outX + dx - side * 2.4) / 2, lane - Ms * P / 2 - 1.4, d.inlineOut, { size: 2, anchor: 'middle', fill: '#475569' }));
          var mh = Math.max(Mn, Ms) * P + 5.4;
          o.push(rrect(mxc - mw / 2, lane - mh / 2, mw, mh, 1.2, { f: FACE2, c: INK, w: 0.5 }));
          o.push(rrect(mxc - mw / 2 + 2.4, lane - mh / 2 + 1.6, mw - 4.8, 2, 0.4, { f: '#CBD5E1' }));
          for (var g1 = 0; g1 < Mn; g1++) o.push(circle(mxc - mw / 2 + 2.2, lane + (g1 - (Mn - 1) / 2) * P * (dir > 0 ? 1 : -1), 0.7, { f: '#fff', c: INK, w: 0.3 }));
          for (var g2 = 0; g2 < Ms; g2++) o.push(circle(mxc + mw / 2 - 2.2, lane + (g2 - (Ms - 1) / 2) * P, 0.7, { f: '#fff', c: INK, w: 0.3 }));
          o.push(txt(mxc, lane + mh / 2 + 2.8, d.inline, { size: 2, anchor: 'middle' }));
        }
        o.push(vstrip(dx, lane, rev ? clStrip.slice().reverse() : clStrip, side));
        var icx = side < 0 ? ICL : ICR;
        o.push(seg([[icx - side * ICO * 0.5, lane], [dx + side * 2.4, lane]], INK, 0.4, '1 1'));
        o.push(d.ico(icx, lane, ICO));
        var tx2 = side < 0 ? icx - ICO * 0.55 - 4 : icx + ICO * 0.55 + 4;
        var an = side < 0 ? 'end' : 'start';
        o.push(txt(tx2, lane - 1.2, cut(d.title, 40), { size: 2.4, anchor: an, weight: 'bold' }));
        if (d.sub) o.push(txt(tx2, lane + 2.2, cut(d.sub, side < 0 ? 40 : 46), { size: 2.1, anchor: an }));
        if (d.nStub) {
          var ny = lane + offS(Ms);
          o.push(seg([[dx - side * 2.4, ny], [dx - side * 8, ny]], CN, 0.55));
          o.push(txt(dx - side * 9, ny + 0.7, 'N щита', { size: 1.8, anchor: side > 0 ? 'end' : 'start' }));
        }
        if (d.pe) {
          var pdir = rev ? -1 : 1, pey = lane + offS(Ms - 1);
          o.push(peSeg([[dx, pey], [dx, pey + 2.2 * pdir]]));
          o.push(gndSym(dx, pey + 2.2 * pdir, pdir));
        }
      });
    }
    drawSide(dS.L, -1, 1); drawSide(dS.R, 1, 1); drawSide(uS.L, -1, -1); drawSide(uS.R, 1, -1);

    // ── ряды клемм поверх жил ──
    function drawRow(row, y, upEdge) {
      row.forEach(function (b) {
        var on = !!used[b.k];
        var col = on ? '#0F172A' : '#94A3B8';
        o.push(pluggable(b.x, y, b.n, b.col, on, !!upEdge));
        b.pl.forEach(function (lab, i) { o.push(txt(wireX(b, i), upEdge ? y + 9.6 : y - 1.8, lab, { size: 1.7, anchor: 'middle', fill: col })); });
        o.push(txt(b.cx, upEdge ? y + 12.6 : y - 5.0, b.t, { size: 1.8, anchor: 'middle', weight: 'bold', fill: col }));
      });
    }
    drawRow(bot, CB - 6.4, false);
    drawRow(top, CY - 0.0, true);

    // ── таблица: что ведёт контроллер ──
    (function () {
      var rw = [];
      rw.push({ t: 'Отопление', s: 'контуров ' + (tc.circuitCount || 0) + ' · ПЗА по уличному датчику' });
      if (tc.dhw === 'boiler') rw.push({ t: 'ГВС · загрузка бойлера', s: 'насос на выходе контроллера · датчик бойлера' });
      else if (tc.dhw === 'boiler_ct') rw.push({ t: 'ГВС · через котёл', s: 'уставку котлу задаёт цифровая шина' });
      (tc.boilers || []).filter(function (b) { return b.iface !== 'own'; }).slice(0, 2).forEach(function (b, i) {
        rw.push({ t: 'Котёл ' + (i + 1) + ' · ' + (b.kind === 'gas' ? 'газовый' : 'электрический'), s: b.iface === 'digital' ? 'адаптер цифровых шин на RS-485' : 'реле контроллера · клеммы термостата' });
      });
      if (tc.leakQty > 0) rw.push({ t: 'Защита от протечки', s: 'шлейф на универсальный вход · кран на реле' });
      var tw = 92, th = 6.4 + rw.length * 8.2, tx0 = 6, ty0 = CY + (CH - th) / 2;
      if (CX < tx0 + tw + 4) return;   // широкий корпус занимает место таблицы
      o.push(rrect(tx0, ty0, tw, th, 1.6, { f: '#F8FAFC', c: '#CBD5E1', w: 0.4 }));
      o.push(txt(tx0 + 3, ty0 + 4.6, 'Что ведёт контроллер', { size: 2.6, weight: 'bold' }));
      o.push(ln(tx0 + 3, ty0 + 6, tx0 + tw - 3, ty0 + 6, { c: '#CBD5E1', w: 0.3 }));
      rw.forEach(function (r, i) {
        var ry2 = ty0 + 10.6 + i * 8.2;
        o.push(txt(tx0 + 3, ry2, r.t, { size: 2.4, weight: 'bold' }));
        o.push(txt(tx0 + 3, ry2 + 3.4, cut(r.s, 44), { size: 2.2, fill: '#475569' }));
      });
    })();

    if (offH) {
      var oy = CB + 14 + (nDn - 1) * LS + 12;
      o.push(rrect(12, oy, W - 24, offBoxH, 1.6, { f: FACE2, c: '#94A3B8', w: 0.5 }));
      o.push(txt(17, oy + 5.8, 'В смете есть, но проводов к контроллеру не имеет', { size: 2.6, weight: 'bold' }));
      o.push(ln(17, oy + 7.2, W - 17, oy + 7.2, { c: '#CBD5E1', w: 0.3 }));
      offList.forEach(function (r, i) {
        var ry3 = oy + 11.8 + i * OFF_ROW;
        o.push(txt(17, ry3, r.t, { size: 2.4, weight: 'bold' }));
        o.push(txt(17, ry3 + 3.4, r.s, { size: 2.1, fill: '#475569' }));
      });
    }

    var lg = [[CL, 'L — фаза (общий контакт реле)'], [CN, 'N — нейтраль'], [null, 'PE — на шину заземления щита'],
      [CSIG, 'датчики температуры'], [CRS[1], 'RS-485: ⏚ B A'], [CBUS, 'цифровая шина котла'],
      [CD1, 'выход ОК / универсальный вход'], [CJ, 'перемычка блокировки: НЗ → общий']];
    var lgY = H - 10;
    lg.forEach(function (L, i) {
      var col = i % 4, rw3 = Math.floor(i / 4);
      var xx = 14 + col * 102, yy = lgY + rw3 * 5;
      if (L[0] === null) o.push(peSeg([[xx, yy], [xx + 10, yy]]));
      else o.push(seg([[xx, yy], [xx + 10, yy]], L[0], 0.8, L[0] === CJ ? '1.3 1' : null));
      o.push(txt(xx + 12.5, yy + 1, L[1], { size: 2.1 }));
    });
    return { svg: o.join(''), w: W, h: H };
  }

  // ─── Схема подключения автоматики тёплого пола (STE-3050) ──────────────
  // Композиция повторяет функциональную схему подключения из паспорта
  // (п. 3.5): термостаты зон сверху, плата посередине, приводы снизу,
  // насос и сухой контакт справа. Расположение клемм — по фотографии платы
  // (стр. 3): ВЕРХНИЙ ряд каждой зоны — клемма управляющего устройства
  // (L / N / «упр», поз. 3), НИЖНИЙ — клемма исполнительных устройств
  // (L N L N, два привода, поз. 2); справа насос (поз. 9), COM/NC/NO
  // (поз. 10) и питание (поз. 11); переключатель задержки (поз. 8) и
  // светодиоды зон (поз. 4) с POWER / BOILER / PUMP (поз. 5–7).
  function ufhScheme(ufh) {
    ufh = ufh || {};
    var o = [], W = 420;
    var INK = '#334155', FACE2 = '#F8FAFC', GREY = '#94A3B8';
    var CL = '#DC2626', CN = '#2563EB', COPEN = '#B45309', CCLOSE = '#1F2937';
    var no = ufh.servoType === 'no', v24 = ufh.servoVolt === 24;
    // Номера клемм термостата — только по паспорту; у моделей без паспорта в руках
    // клеммы не выдумываем. Обе схемы — п. 5.2 паспортов STE-2001 (ред. 12.02.2025)
    // и STE-2002 (ред. 12.12.2024):
    //   3 А (STE-2001-13…, STE-2002-33…): L на клемму 2, N на 1, перемычка 2–5,
    //     при нагреве напряжение на клемме 3;
    //   16 А (STE-2001-11…, STE-2002-31…): L на клемму 3, N на 1, при нагреве
    //     напряжение на клемме 4, нагрузка включается между клеммами 2 и 4.
    var sid = ufh.statId || '';
    var kind = /^STE-(2002-33|2001-13)/.test(sid) ? '3a' : (/^STE-(2002-31|2001-11)/.test(sid) ? '16a' : '');
    var known = !!kind;
    var T = kind === '16a' ? { N: 1, L: 3, U: 4 } : { N: 1, L: 2, U: 3 };

    function seg(pts, c, w, dash) {
      var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + n(p[0]) + ',' + n(p[1]); }).join(' ');
      return '<path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="' + (w || 0.5) +
        '" stroke-linejoin="round" stroke-linecap="round"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>';
    }
    function cut(s, k) { s = String(s || ''); return s.length > k ? s.slice(0, k - 1) + '…' : s; }
    // термоэлектрический привод: колпачок со штоком
    function icoAct(cx, cy, s, ghost) {
      var c = ghost ? GREY : INK;
      return rrect(cx - s * 0.34, cy - s * 0.40, s * 0.68, s * 0.62, s * 0.16, { f: ghost ? '#F8FAFC' : '#F1F5F9', c: c, w: 0.5 }) +
        rrect(cx - s * 0.12, cy - s * 0.14, s * 0.24, s * 0.26, 0.3, { f: '#fff', c: c, w: 0.35 }) +
        rrect(cx - s * 0.2, cy + s * 0.22, s * 0.4, s * 0.16, 0.2, { f: '#CBD5E1', c: c, w: 0.4 });
    }
    // выноска-номер: связывает участок жил с таблицей кабелей внизу листа
    function mark(x, y, k) {
      return circle(x, y, 2.1, { f: '#fff', c: INK, w: 0.45 }) +
        txt(x, y + 0.8, String(k), { size: 2.3, anchor: 'middle', weight: 'bold' });
    }
    // Клеммные колодки платы — серые, как на фото из паспорта (пружинные, у каждого
    // контакта большое круглое гнездо для провода, рычажок и малое гнездо).
    // Режимы: 'on' — ярко, сюда заводят провод; 'pale' — такая же зона из сметы,
    // подключается так же; 'dim' — не используется, плата показана тускло.
    //   vertical: контакты столбиком, провод — слева (клеммы зон);
    //   иначе контакты в ряд, провод — снизу (клеммы внизу справа).
    function wago(x, y, w, h, nn, mode, vertical) {
      var s = '<g opacity="' + (mode === 'on' ? 1 : (mode === 'pale' ? 0.85 : 0.3)) + '">';
      if (mode === 'on') s += rrect(x - 1.3, y - 1.3, w + 2.6, h + 2.6, 1.6, { f: '#86EFAC', c: '#16A34A', w: 0.6 });
      if (mode === 'pale') s += rrect(x - 0.7, y - 0.7, w + 1.4, h + 1.4, 1.2, { f: '#DCFCE7', c: '#86C7A0', w: 0.4 });
      s += rrect(x, y, w, h, 0.8, { f: '#B8B8BC', c: '#6B7280', w: 0.3 });
      if (vertical) s += rrect(x + w - 3.2, y, 3.2, h, 0.6, { f: '#9A9AA0', c: '#6B7280', w: 0.2 });
      var ring = mode === 'on' ? '#15803D' : '#52525B';
      for (var i = 0; i < nn; i++) {
        if (vertical) {
          var cy = y + (i + 0.5) * h / nn;
          s += rrect(x + 8.2, cy - 1.5, 1.6, 3, 0.3, { f: '#D4D4D8', c: '#6B7280', w: 0.2 });
          s += circle(x + 4.4, cy, 1.5, { f: '#27272A', c: ring, w: 0.4 });
          s += circle(x + w - 5.4, cy, 0.8, { f: '#52525B' });
        } else {
          var cx = x + (i + 0.5) * w / nn;
          s += circle(cx, y + 3.2, 0.8, { f: '#52525B' });
          s += rrect(cx - 1.5, y + h / 2 - 0.8, 3, 1.6, 0.3, { f: '#D4D4D8', c: '#6B7280', w: 0.2 });
          s += circle(cx, y + h - 3.6, 1.5, { f: '#27272A', c: ring, w: 0.4 });
        }
      }
      return s + '</g>';
    }
    // Положение на фото паспорта (862×402 px) → мм схемы. Фото масштабировано 0,4:
    // так все колодки и детали платы стоят там же, где на настоящей плате.
    var BX0 = 96, BY0 = 84;
    function P(px, py) { return [(px - 112) * 0.4 + BX0, (py - 112) * 0.4 + BY0]; }

    var stats = ufh.stats || 0, servos = ufh.servos || 0, blocks = Math.max(1, ufh.blocks || 1);

    o.push(txt(W / 2, 9, 'Схема подключения автоматики — вся плата, пример одной зоны: 1 термостат, 1 сервопривод',
      { size: 4.2, anchor: 'middle', weight: 'bold' }));
    o.push(txt(W / 2, 14.4, 'раздел 4.5 сметы · STOUT STE-3050 · остальные зоны подключаются точно так же, каждая на свою клемму' +
      (ufh.auto ? ' · с контроллером котельной связана одним сухим контактом' : ''),
      { size: 2.2, anchor: 'middle', fill: '#475569' }));

    // ── термостат зоны ──
    var tx = 16, tw = 66, ty = 26, th = 40;
    o.push(txt(tx, 19, 'Термостат зоны (по одному на комнату)', { size: 2.6, weight: 'bold' }));
    o.push(txt(tx, 22.6, cut(ufh.statName, 46), { size: 2.1, fill: '#475569' }));
    o.push(rrect(tx, ty, tw, th, 1.6, { f: '#fff', c: INK, w: 0.5 }));
    o.push(rrect(tx + 6, ty + 5, tw - 12, 18, 1, { f: '#DBEAFE', c: '#64748B', w: 0.35 }));
    o.push(txt(tx + tw / 2, ty + 17, '22', { size: 9, anchor: 'middle', fill: '#1D4ED8' }));
    // терминал: номер клеммы n стоит в позиции X(n) слева направо 7…1, как в паспорте
    function X(k) { return tx + 6 + (7 - k) * 8; }
    var wy0;
    if (known) {
      var sy = ty + th + 4;                       // верх колодки термостата
      o.push(rrect(tx, sy, tw, 10, 0.8, { f: '#E2E8F0', c: INK, w: 0.45 }));
      var fn = kind === '16a' ? { 1: 'N', 2: 'N', 3: 'L', 4: 'L вых' } : { 1: 'N', 2: 'L', 3: 'NO', 4: 'NC', 5: 'COM' };
      for (var k = 7; k >= 1; k--) {
        o.push(circle(X(k), sy + 6.5, 1.5, { f: '#fff', c: INK, w: 0.35 }));
        o.push(txt(X(k), sy + 3.6, String(k), { size: 2.2, anchor: 'middle', weight: 'bold' }));
        if (fn[k]) o.push(txt(X(k), ty + th - 2.4, fn[k], { size: 2.1, anchor: 'middle' }));
      }
      o.push(txt((X(6) + X(7)) / 2, ty + th - 2.4, 'датчик пола', { size: 1.7, anchor: 'middle', fill: '#475569' }));
      // перемычка между клеммами 2 и 5 (3 А, п. 5.2.1); у 16 А её нет
      if (kind === '3a') {
        o.push(seg([[X(2), sy + 6.5], [X(2), sy - 2.2], [X(5), sy - 2.2], [X(5), sy + 6.5]], CCLOSE, 0.6, '1.2 0.8'));
        o.push(txt(X(5) - 1.2, sy - 3.4, 'перемычка 2–5', { size: 1.8, anchor: 'middle', fill: '#475569' }));
      }
      wy0 = sy + 10;
    } else {
      o.push(txt(tx + tw / 2, ty + th - 3, 'клеммы — по паспорту термостата', { size: 1.9, anchor: 'middle', fill: '#B45309' }));
      wy0 = ty + th;
    }

    // ── плата STE-3050: вид и расположение клемм — как на фото из паспорта (п. 3.1) ──
    var nUsed = Math.max(1, Math.min(stats, 8));
    var DIMT = '#94A3B8', DARK = '#0F172A';
    var UPW = 18.8, UPH = 20, LOH = 22.8, ZP = 55.4 * 0.4;
    var zx0 = P(147.5, 155)[0], zyU = P(147.5, 155)[1], zyL = P(147.5, 207)[1];
    function cU(i) { return zyU + (i + 0.5) * UPH / 3; }
    function cL(i) { return zyL + (i + 0.5) * LOH / 4; }
    var holeX = zx0 + 4.4;                       // гнездо провода у клеммы зоны 1
    // печатная плата и надписи на ней
    o.push(txt(98, 81, 'Плата STOUT STE-3050 — вид сверху, как на фото в паспорте' + (blocks > 1 ? ' (в смете таких плат ' + blocks + ')' : ''), { size: 2.5, weight: 'bold' }));
    o.push(rrect(98, 84, 248, 86, 2, { f: '#DCE6F0', c: '#94A3B8', w: 0.5 }));
    // ряд «домиков» со светодиодами зон (поз. 4) и светодиоды POWER / BOILER / PUMP (поз. 5–7)
    for (var h = 0; h < 8; h++) {
      var hp = P(184 + 32.5 * h, 134);
      o.push('<g opacity="0.6">' + seg([[hp[0] - 2, hp[1] + 1.2], [hp[0], hp[1] - 1.3], [hp[0] + 2, hp[1] + 1.2], [hp[0] - 2, hp[1] + 1.2]], '#475569', 0.3) +
        rrect(hp[0] + 2.8, hp[1] - 0.5, 2.6, 1.3, 0.6, { f: h === 0 ? '#22C55E' : '#F1F5F9', c: '#94A3B8', w: 0.25 }) + '</g>');
    }
    [['POWER', 91.2], ['BOILER', 94.4], ['PUMP', 97.6]].forEach(function (L) {
      o.push(txt(221, L[1] + 0.4, L[0], { size: 1.3, fill: DIMT, anchor: 'end' }));
      o.push(circle(222.6, L[1], 0.55, { f: L[0] === 'BOILER' ? '#F59E0B' : '#22C55E' }));
    });
    // переключатель задержки (поз. 8)
    o.push(rrect(254, 91.2, 13, 7.6, 0.6, { f: '#1F2937', c: '#0F172A', w: 0.3 }));
    o.push(rrect(256, 92.6, 3.2, 1.8, 0.3, { f: '#F8FAFC' })); o.push(rrect(260.6, 92.6, 3.2, 1.8, 0.3, { f: '#F8FAFC' }));
    o.push(rrect(256, 95.6, 3.2, 1.8, 0.3, { f: '#F8FAFC' })); o.push(rrect(260.6, 95.6, 3.2, 1.8, 0.3, { f: '#F8FAFC' }));
    o.push(txt(269, 95.4, 'задержка насоса и котла (поз. 8)', { size: 1.4, fill: DIMT }));
    // детали: предохранитель (зелёный), трансформатор (жёлтый), реле (чёрные) — приглушены
    o.push('<g opacity="0.55">' +
      rrect(283.2, 119.6, 13.6, 27.6, 1, { f: '#4CAF50', c: '#2E7D32', w: 0.4 }) + rrect(286, 127, 8, 12, 0.5, { f: '#2E7D32' }) +
      rrect(311.2, 105.6, 20, 16, 1, { f: '#FACC15', c: '#92400E', w: 0.4 }) + rrect(314, 105.6, 3.4, 16, 0, { f: '#1F2937' }) + rrect(325.2, 105.6, 3.4, 16, 0, { f: '#1F2937' }) +
      rrect(307.2, 128, 18, 21, 0.8, { f: '#111827' }) + rrect(326, 128, 18, 21, 0.8, { f: '#111827' }) +
      circle(335, 97, 3.2, { f: '#1E3A8A' }) + circle(303, 109, 2.2, { f: '#1E3A8A' }) + '</g>');
    // клеммы зон: сверху три контакта (L, N, ←), снизу четыре (L N L N, два привода)
    for (var z = 0; z < 8; z++) {
      var zx = zx0 + z * ZP, md = z === 0 ? 'on' : (z < nUsed ? 'pale' : 'dim');
      var lc = md === 'dim' ? '#CBD5E1' : '#1E3A8A';
      o.push(wago(zx, zyU, UPW, UPH, 3, md, true));
      o.push(wago(zx, zyL, UPW, LOH, 4, md, true));
      // надписи на плате: слева от клеммы зоны «L N ←» (у зоны 1 там жилы — вместо них метки на жилах)
      if (z > 0) ['L', 'N', '←'].forEach(function (L, i) { o.push(txt(zx - 2.6, cU(i) + 0.6, L, { size: 1.6, anchor: 'middle', fill: lc })); });
      ['L', 'N', 'L', 'N'].forEach(function (L, i) { o.push(txt(zx + UPW + 2.4, cL(i) + 0.6, L, { size: 1.5, anchor: 'middle', fill: lc })); });
      o.push(txt(zx + UPW / 2, zyU - 1.4, 'зона ' + (z + 1) + (z === 0 ? ' (поз. 3, 2)' : ''), { size: 1.6, anchor: 'middle', weight: z === 0 ? 'bold' : undefined, fill: md === 'dim' ? DIMT : DARK }));
    }

    // жилы термостат → клемма зоны 1. Контакты на плате сверху вниз: L, N, «упр»
    // (←). У термостата клеммы N, L, «упр» идут слева направо в обратном порядке, поэтому
    // одно пересечение неизбежно: жила L перескакивает жилу N дугой.
    var xN = known ? X(T.N) : 70, xL = known ? X(T.L) : 62, xU = known ? X(T.U) : 54;
    o.push(seg([[xN, wy0], [xN, cU(1)], [holeX, cU(1)]], CN, 0.5));
    o.push(seg([[xU, wy0], [xU, cU(2)], [holeX, cU(2)]], COPEN, 0.5));
    o.push('<path d="M' + n(xL) + ',' + n(wy0) + ' L' + n(xL) + ',' + n(cU(0)) + ' L' + n(xN - 2.6) + ',' + n(cU(0)) + ' A2.6,2.6 0 0 1 ' + n(xN + 2.6) + ',' + n(cU(0)) +
      ' L' + n(holeX) + ',' + n(cU(0)) + '" fill="none" stroke="' + CL + '" stroke-width="0.5" stroke-linejoin="round" stroke-linecap="round"/>');
    [['L', 0, CL], ['N', 1, CN], ['упр', 2, COPEN]].forEach(function (t) {
      o.push(rrect(100.2, cU(t[1]) - 1.5, t[0] === 'упр' ? 7 : 5, 3, 1.2, { f: '#fff', c: t[2], w: 0.35 }));
      o.push(txt(100.2 + (t[0] === 'упр' ? 3.5 : 2.5), cU(t[1]) + 0.6, t[0], { size: 1.7, anchor: 'middle', weight: 'bold', fill: t[2] }));
    });
    o.push(mark(90, cU(1), 1));
    // подписи жил — слева от жил, под термостатом; номера клемм — только в известной раскладке
    o.push(txt(16, 92, known ? 'N → клемма ' + T.N : 'N', { size: 1.9, fill: CN }));
    o.push(txt(16, 96, known ? 'L → клемма ' + T.L : 'L', { size: 1.9, fill: CL }));
    o.push(txt(16, 100, known ? '«упр» ← клемма ' + T.U + (kind === '3a' ? ' (NO)' : '') : '«упр»', { size: 1.9, fill: COPEN }));

    // ── сервопривод 1 и второй (по желанию): жилы уходят влево от клеммы приводов зоны 1 ──
    // L сворачивает вниз левее N — жилы не пересекаются
    var s1 = 50, s2 = 79, syc = 162;
    o.push(icoAct(s1, syc, 12));
    o.push(seg([[holeX, cL(0)], [s1 - 4, cL(0)], [s1 - 4, syc - 6]], CL, 0.5));
    o.push(seg([[holeX, cL(1)], [s1 + 2, cL(1)], [s1 + 2, syc - 6]], CN, 0.5));
    o.push(mark(88, cL(0), 2));
    o.push(icoAct(s2, syc, 10, true));
    o.push(seg([[holeX, cL(2)], [s2 - 3, cL(2)], [s2 - 3, syc - 5]], GREY, 0.45, '1.4 1'));
    o.push(seg([[holeX, cL(3)], [s2 + 3, cL(3)], [s2 + 3, syc - 5]], GREY, 0.45, '1.4 1'));
    o.push(txt(12, 172, 'Сервопривод — ' + (no ? 'НО' : 'НЗ') + ', ' + (ufh.servoVolt || 230) + ' В', { size: 2.1, weight: 'bold', fill: no ? '#B45309' : DARK }));
    o.push(txt(12, 175.2, cut(ufh.servoName, 40), { size: 1.9 }));
    o.push(txt(68, 154, 'второй — по желанию', { size: 1.7, fill: '#64748B' }));

    // ── клеммы внизу справа: INPUT (поз. 11), PUMP (поз. 9), COM/NC/NO (поз. 10); провод входит снизу ──
    var by = P(0, 276)[1], bh = 15.6, bx1 = 281.6, bx2 = 299.6, bx3 = 318.6;
    o.push(wago(bx1, by, 16.4, bh, 2, 'on', false));
    o.push(wago(bx2, by, 16.4, bh, 2, 'on', false));
    o.push(wago(bx3, by, 24.6, bh, 3, ufh.auto ? 'on' : 'dim', false));
    var hy = by + bh - 3.6;
    function hx(x, w, nn, i) { return x + (i + 0.5) * w / nn; }
    var DX = 356;
    function lead(x, lvl, c) { o.push(seg([[x, hy], [x, lvl], [DX, lvl]], c, 0.5)); }
    // Потребитель: рамка, значок оборудования в том же стиле, что на схемах Thermatic
    // (icoBreaker / icoPump / icoPanel), и подпись справа от него.
    function dest(y, t1, t2, ico) {
      o.push(rrect(DX, y, 54, 12, 1, { f: '#fff', c: INK, w: 0.4 }));
      if (ico) o.push(ico(DX + 6.5, y + 6, 8.4));
      o.push(txt(DX + 32, y + 4.7, t1, { size: 1.8, anchor: 'middle', weight: 'bold' }));
      if (t2) o.push(txt(DX + 32, y + 8.6, t2, { size: 1.5, anchor: 'middle', fill: '#475569' }));
    }
    // чем глубже уходит жила вниз, тем левее клемма — жилы не пересекаются
    lead(hx(bx1, 16.4, 2, 1), 197, CN); lead(hx(bx1, 16.4, 2, 0), 202, CL);
    dest(194, 'Щит · автомат 10 А', 'питание L, N + PE', icoBreaker); o.push(mark(DX - 4.5, 199.5, 3));
    lead(hx(bx2, 16.4, 2, 1), 182, CN); lead(hx(bx2, 16.4, 2, 0), 187, CL);
    dest(179, 'Насос группы ТП', 'вариант Б · до 3 А', icoPump); o.push(mark(DX - 4.5, 184.5, 4));
    if (ufh.auto) {
      lead(hx(bx3, 24.6, 3, 1), 168, CCLOSE); lead(hx(bx3, 24.6, 3, 0), 173, CCLOSE);
      dest(164, 'Контроллер котельной', 'метка А · ' + (ufh.ko || 'вход термостатов'), icoPanel); o.push(mark(DX - 4.5, 170.5, 5));
    } else {
      o.push(txt(DX, 169, 'сухой контакт — не используется', { size: 1.6, fill: DIMT }));
    }
    // подписи клемм: названия на плате и номера позиций паспорта
    o.push(txt(bx1 + 8.2, hy + 7.4, 'INPUT', { size: 1.3, anchor: 'middle', fill: '#475569' }));
    o.push(txt(bx2 + 8.2, hy + 7.4, 'PUMP', { size: 1.3, anchor: 'middle', fill: '#475569' }));
    // винт заземления (поз. 1): внизу в середине платы, два контакта и знак земли
    var ex = P(425, 288)[0], ey = P(425, 288)[1];
    o.push(wago(ex, ey, 12, 10.8, 2, 'on', false));
    o.push(txt(ex + 6, ey - 1.2, '⏚', { size: 2.4, anchor: 'middle', fill: '#14532D' }));
    o.push(txt(ex - 2, 174, 'Земля (поз. 1) — сюда защитный проводник (PE) питания платы', { size: 1.7, anchor: 'end', fill: '#475569' }));

    // легенда подсветки
    var lgY = 214;
    function sw(x, f, c, t) { return rrect(x, lgY - 2.2, 6, 3.2, 0.5, { f: f, c: c, w: 0.4 }) + txt(x + 8, lgY + 0.4, t, { size: 1.9 }); }
    o.push(sw(12, '#86EFAC', '#16A34A', 'ярко — сюда заводят провод'));
    o.push(sw(100, '#DCFCE7', '#86C7A0', 'такие же зоны вашей сметы — подключаются так же'));
    o.push(sw(260, '#E5E7EB', '#CBD5E1', 'тускло — не используется'));

    // ── что в смете ──
    var ny = 222;
    o.push(txt(12, ny, 'Сколько всего — по вашей смете:', { size: 2.5, weight: 'bold' })); ny += 4;
    if (stats) {
      o.push(txt(12, ny, '• Термостатов ' + stats + ' — по одному на комнату: каждый подключается на свою клемму зоны платы (зона 1, 2, 3 … по порядку), как на схеме.', { size: 2.1 })); ny += 3.6;
    }
    if (servos) {
      o.push(txt(12, ny, '• Сервоприводов ' + servos + ' — по одному на петлю тёплого пола или прибор. Приводы одной комнаты идут на клемму её зоны (до двух), если их больше — ' +
        'вторая пара клемм той же зоны.', { size: 2.1 })); ny += 3.6;
    }
    o.push(txt(12, ny, '• Плата ' + blocks + ' шт. — на каждой 8 зон и 16 приводов (вместе ' + blocks * 8 + ' зон, ' + blocks * 16 + ' приводов). Зоны сверх восьми — на следующей плате.', { size: 2.1 })); ny += 3.6;
    if (stats > blocks * 8 || servos > blocks * 16) {
      o.push(txt(12, ny, '⚠ Термостатов или приводов больше, чем помещается на плате: проверьте число плат в смете.', { size: 2.1, weight: 'bold', fill: '#DC2626' })); ny += 3.6;
    }
    ny += 1.6;
    o.push(txt(12, ny, 'Питание платы — да, 230 В нужно: L и N на клемму поз. 11 от отдельного автомата 10 А, защитный проводник на винт земли поз. 1.', { size: 2.1, weight: 'bold' })); ny += 3.6;
    o.push(txt(12, ny, 'С платы 230 В получают приводы (клеммы поз. 2) и насос (поз. 9, вариант Б, до 3 А); термостат питается с клеммы зоны. Защитный проводник насоса идёт в щит, мимо платы.', { size: 2.1 })); ny += 5;
    o.push(txt(12, ny, 'Насос группы тёплого пола — один из двух вариантов, оба рабочие:', { size: 2.2, weight: 'bold' })); ny += 3.8;
    o.push(txt(12, ny, 'А. Насос на клемме «' + (ufh.ko || 'КО-1') + ' Насос» контроллера котельной. Плата даёт только запрос тепла; закрылись все зоны — запрос снят, насос останавливает контроллер.', { size: 2.1 })); ny += 3.4;
    o.push(txt(12, ny, 'Б. Насос на клемму «Насос» платы (показана выше) — она отключит его сразу, как закроется последняя зона. Подключать насос к обоим выходам одновременно нельзя.', { size: 2.1 })); ny += 5;
    o.push(txt(12, ny, 'Тип сервоприводов в смете — ' + (no ? 'НО, нормально открытые:' : 'НЗ, нормально закрытые:'), { size: 2.2, weight: 'bold' })); ny += 3.8;
    if (!no) {
      o.push(txt(12, ny, 'Зона запитана — клапан открывается. Когда в комнате холодно, термостат подаёт фазу с выходной клеммы на «упр» платы. Светодиод зоны на плате горит при протоке.', { size: 2.1 })); ny += 3.8;
    } else {
      o.push(txt(12, ny, 'Зона запитана — клапан ЗАКРЫВАЕТСЯ. Термостат подключать через обратный контакт (охлаждение): «упр» должна появляться, когда тепло НЕ нужно.', { size: 2.1, fill: '#B45309' })); ny += 3.8;
      o.push(txt(12, ny, 'Индикация зон инверсная (паспорт STE-3050, п. 3.3), по той же причине инвертируются насос и сухой контакт: запрос тепла уйдёт котлу при закрытых петлях.', { size: 2.1, fill: '#B45309' })); ny += 3.8;
      o.push(txt(12, ny, 'Для STE-3050 рекомендуются приводы НЗ — замените их в разделе 4.5 сметы.', { size: 2.1, weight: 'bold', fill: '#DC2626' })); ny += 3.8;
    }
    if (v24) { o.push(txt(12, ny, '⚠ Приводы 24 В, а STE-3050 коммутирует 230 В: напрямую подключать нельзя — нужен контроллер на 24 В либо приводы 230 В.', { size: 2.1, weight: 'bold', fill: '#DC2626' })); ny += 3.8; }

    // ── кабели: марки и сечения по выноскам 1…5 ──
    ny += 1.2;
    o.push(txt(12, ny, 'Кабели — выноски 1…' + (ufh.auto ? 5 : 4) + ' на схеме (сколько жил и куда):', { size: 2.2, weight: 'bold' })); ny += 3.8;
    var cableList = [
      '1. Термостат → клемма зоны платы — ВВГнг(А)-LS 3×1,5: три жилы N, L и «упр». ' + (known
        ? (kind === '3a'
          ? 'У этого термостата: N — клемма 1, L — клемма 2 (и перемычка 2–5), «упр» — клемма 3. Четвёртая жила не нужна; датчик пола (клеммы 6–7) — отдельным кабелем.'
          : 'У этого термостата (16 А): N — клемма 1, L — клемма 3, «упр» — клемма 4 (L вых). Четвёртая жила не нужна; датчик пола (клеммы 6–7) — отдельным кабелем.')
        : 'Клеммы термостата — по его паспорту: питание L и N, выход нагрева идёт на «упр» платы. Механическому термостату без электроники ноль обычно не нужен.'),
      '2. Клемма приводов → сервопривод — ВВГнг(А)-LS 2×1,5 на каждый привод: две жилы L и N. Гибкий вывод самого привода наращивают в распаячной коробке, в клемму платы его не заводят.',
      '3. Питание платы (поз. 11) — ВВГнг(А)-LS 3×1,5 от отдельного автомата 10 А: суммарная нагрузка платы до 10 А. Защитный проводник — на винт заземления поз. 1.',
      '4. Насос (поз. 9) — ВВГнг(А)-LS 3×1,5 от клеммы насоса до насосной группы тёплого пола (вариант Б).'
    ];
    if (ufh.auto) cableList.push('5. Сухой контакт (поз. 10) → контроллер котельной — экранированный МКЭШ 2×0,5 или UTP. Вести отдельно от силовых линий, не пересекать их под углом, отличным от прямого.');
    cableList.forEach(function (L) { o.push(txt(12, ny, L, { size: 2.1 })); ny += 3.4; });
    o.push(txt(12, ny, 'Сечение 1,5 мм² — практика монтажа, паспорта STE-3050 и STE-2002 сечения линий не задают (у термостата рекомендовано 1 мм² для нагрузки 3 А).', { size: 1.9, fill: '#475569' })); ny += 3.4;
    o.push(txt(12, ny, 'Метраж по ' + (ufh.auto ? 'этим пяти позициям' : 'этим четырём позициям') + ' посчитан и включён в подраздел 4.5.1 сметы «Провода и кабели (автоматика отопления)».', { size: 2.1 }));

    return { svg: o.join(''), w: W, h: ny + 6 };
  }

  // ─── Схема подключения зональной автоматики ENGO (центр коммутации ECB62-ZB) ───
  // Клеммы и их порядок — по Quick Guide v6.1 производителя (engocontrols.com):
  //   INPUT_A / INPUT_B — проводные зоны, по три контакта N, L, SLA (SLB);
  //   OUTPUT_A, OUTPUT_B, OUTPUT_1…6 — приводы 230 В NC, по четыре контакта
  //     N, SLx, N, SLx (до 6 приводов по 2 Вт на зону);
  //   WIRELESS ZONE_1…6 — радиозоны Zigbee, клемм нет, привязка кнопками SELECT и PAIR;
  //   POWER SUPPLY N L N L, PE, PUMP OUTPUT N L N L (до 3 А), BOILER OUTPUT NO COM NC (до 6 А).
  // Проводной термостат — паспорта ESIMPLE-230 (N, L, SL) и EASY-230 (N, L, COM, NO;
  // перемычка L–COM, жила на планку — с клеммы NO).
  // e: bars, wired, radio, heads, servos, gateway, statKind ('simple' | 'easy'),
  //    statName, servoName, servoVolt, auto (есть контроллер котельной), ko.
  function ufhSchemeEngo(e) {
    e = e || {};
    var o = [], W = 420;
    var DARK = '#0F172A', GREY = '#94A3B8';
    var wired = e.wired || 0, radio = e.radio || 0, heads = e.heads || 0, servos = e.servos || 0;
    var bars = Math.max(1, e.bars || 1), easy = e.statKind === 'easy';
    var PE_ = 5.0;                                   // шаг контактов, мм схемы
    var BXL = 14, BW = 330, BY = 80, BH = 110;
    // положение на рисунке Quick Guide (2000 px) → схема; колонки: A, B, зоны 1…6
    function gx(px) { return BXL + (px - 610) * BW / 1330; }
    function col(k) { return gx(700 + 98 * k); }
    var yT = BY + 8, yB = BY + BH - 14.4;            // верхний и нижний ряд клемм

    function pill(x, y, t, c, w) {
      return rrect(x - w / 2, y - 1.4, w, 2.8, 1.2, { f: '#fff', c: c, w: 0.35 }) +
        txt(x, y + 0.6, t, { size: 1.6, anchor: 'middle', weight: 'bold', fill: c });
    }
    function mark(x, y, k) {
      return circle(x, y, 2.1, { f: '#fff', c: INK, w: 0.45 }) + txt(x, y + 0.8, String(k), { size: 2.3, anchor: 'middle', weight: 'bold' });
    }
    function act(cx, cy, s, ghost) {
      var c = ghost ? GREY : INK;
      return rrect(cx - s * 0.34, cy - s * 0.40, s * 0.68, s * 0.62, s * 0.16, { f: ghost ? '#F8FAFC' : '#F1F5F9', c: c, w: 0.5 }) +
        rrect(cx - s * 0.12, cy - s * 0.14, s * 0.24, s * 0.26, 0.3, { f: '#fff', c: c, w: 0.35 }) +
        rrect(cx - s * 0.2, cy + s * 0.22, s * 0.4, s * 0.16, 0.2, { f: '#CBD5E1', c: c, w: 0.4 });
    }

    o.push(txt(W / 2, 9, 'Схема подключения автоматики — ENGO ECB62-ZB, пример: 1 зона, 1 термостат, 1 привод', { size: 4.0, anchor: 'middle', weight: 'bold' }));
    o.push(txt(W / 2, 14.4, 'раздел 4.5 сметы · остальные зоны подключаются точно так же, каждая на свои клеммы' +
      (e.auto ? ' · котёл на контроллере котельной через сухой контакт' : ''), { size: 2.2, anchor: 'middle', fill: '#475569' }));

    // ── корпус: тёмный, с салатовой полосой индикации, как у прибора ──
    o.push(txt(BXL + BW - 22, BY - 2.4, 'ENGO ECB62-ZB — вид с открытой крышкой, 330 × 110 мм' + (bars > 1 ? ' (в смете таких блоков ' + bars + ')' : ''), { size: 2.5, weight: 'bold', anchor: 'end' }));
    o.push(rrect(BXL, BY, BW, BH, 3, { f: '#2B3036', c: '#111418', w: 0.6 }));
    o.push(rrect(BXL + 3, BY + BH / 2 - 7.5, BW - 6, 15, 2, { f: '#8DC63F', c: '#5B8A1E', w: 0.3 }));
    o.push(txt(BXL + BW - 6, BY + BH / 2 + 1.2, 'ENGO', { size: 3.4, anchor: 'end', weight: 'bold', fill: '#2B3036' }));

    var haveWired = wired > 0, haveRadio = radio > 0 || !haveWired;
    // режимы колонок: 0 — A, 1 — B, 2…7 — радиозоны 1…6
    function modeCol(k) {
      if (k === 0) return haveWired ? 'on' : 'dim';
      if (k === 1) return wired > 1 ? 'pale' : 'dim';
      if (k === 2) return haveRadio ? 'on' : 'dim';
      return (k - 2) < radio ? 'pale' : 'dim';
    }
    function pm(m) { return m === 'on' ? true : (m === 'pale' ? 'pale' : false); }
    var LB = '#E5E7EB';

    // ── верхний ряд: INPUT_A, INPUT_B и радиозоны ──
    ['INPUT_A', 'INPUT_B'].forEach(function (nm, k) {
      var m = modeCol(k), x0 = col(k) - 1.5 * PE_;
      o.push(pluggable(x0, yT, 3, '#DDE1E6', pm(m), true, null, PE_));
      o.push(txt(col(k), yT - 1.6, nm, { size: 1.5, anchor: 'middle', fill: m === 'dim' ? '#6B7280' : LB }));
      ['N', 'L', k ? 'SLB' : 'SLA'].forEach(function (L, i) {
        o.push(txt(x0 + PE_ / 2 + i * PE_, yT + 9.4, L, { size: 1.4, anchor: 'middle', fill: m === 'dim' ? '#6B7280' : LB }));
      });
    });
    for (var z = 1; z <= 6; z++) {
      var cz = col(z + 1), mz = modeCol(z + 1);
      o.push('<g' + (mz === 'dim' ? ' opacity="0.45"' : '') + '>' +
        rrect(cz - 9, yT - 1.2, 18, 11.6, 1.6, { f: '#F1F5F9', c: mz === 'on' ? '#16A34A' : (mz === 'pale' ? '#86C7A0' : '#94A3B8'), w: mz === 'on' ? 1.0 : 0.5 }) +
        [2.2, 3.6, 5.0].map(function (r) { return '<path d="M' + n(cz - r) + ',' + n(yT + 4.2) + ' A' + r + ',' + r + ' 0 0 1 ' + n(cz + r) + ',' + n(yT + 4.2) + '" fill="none" stroke="#475569" stroke-width="0.35"/>'; }).join('') +
        circle(cz, yT + 5.2, 0.5, { f: '#475569' }) +
        txt(cz, yT + 8.6, 'ZIGBEE', { size: 1.2, anchor: 'middle', fill: '#475569' }) + '</g>');
      o.push(txt(cz, yT - 1.9, 'ZONE_' + z, { size: 1.5, anchor: 'middle', fill: mz === 'dim' ? '#6B7280' : LB }));
    }
    // кнопки SELECT / PAIR, светодиоды PUMP / BOILER / POWER и антенна
    o.push(rrect(gx(1452), BY + BH / 2 - 17, 7, 7, 1, { f: '#E5E7EB', c: '#111418', w: 0.3 }));
    o.push(rrect(gx(1498), BY + BH / 2 - 17, 7, 7, 1, { f: '#E5E7EB', c: '#111418', w: 0.3 }));
    o.push(txt(gx(1452) + 3.5, BY + BH / 2 - 18.4, 'SELECT', { size: 1.3, anchor: 'middle', fill: LB }));
    o.push(txt(gx(1498) + 3.5, BY + BH / 2 - 18.4, 'PAIR', { size: 1.3, anchor: 'middle', fill: LB }));
    [['PUMP', 1550, '#22C55E'], ['BOILER', 1610, '#22C55E'], ['POWER', 1670, '#EF4444']].forEach(function (L) {
      o.push(circle(gx(L[1]) + 3, BY + BH / 2 - 13.6, 1.2, { f: L[2], c: '#111418', w: 0.25 }));
      o.push(txt(gx(L[1]) + 3, BY + BH / 2 - 18.4, L[0], { size: 1.3, anchor: 'middle', fill: LB }));
    });
    o.push(rrect(gx(1855), BY + 5, 14, 11, 1.4, { f: '#E5E7EB', c: '#111418', w: 0.3 }));
    o.push(txt(gx(1855) + 7, BY + 3.4, 'ANTENNA', { size: 1.3, anchor: 'middle', fill: LB }));
    // светодиоды зон 1…8
    for (var l = 0; l < 8; l++) {
      var lit = (l === 0 && haveWired) || (l === 2 && haveRadio) || (l === 1 && wired > 1) || (l > 2 && (l - 2) < radio);
      o.push(circle(col(l), BY + BH / 2, 1.5, { f: lit ? '#22C55E' : '#C6E58B', c: '#5B8A1E', w: 0.3 }));
      o.push(txt(col(l) + 3.2, BY + BH / 2 + 0.8, String(l + 1), { size: 1.6, fill: '#2B3036' }));
    }

    // ── нижний ряд: OUTPUT_A, OUTPUT_B, OUTPUT_1…6 (приводы), предохранитель, питание, PE, насос, котёл ──
    var outNames = ['OUTPUT_A', 'OUTPUT_B', 'OUTPUT_1', 'OUTPUT_2', 'OUTPUT_3', 'OUTPUT_4', 'OUTPUT_5', 'OUTPUT_6'];
    var xOut = [];
    outNames.forEach(function (nm, k) {
      var m = modeCol(k), x0 = col(k) - 2 * PE_;
      xOut.push(x0);
      o.push(pluggable(x0, yB, 4, '#DDE1E6', pm(m), false, null, PE_));
      o.push(txt(col(k), yB - 1.6, nm, { size: 1.5, anchor: 'middle', fill: m === 'dim' ? '#6B7280' : LB }));
    });
    var xFu = gx(1440);
    o.push(rrect(xFu, yB - 0.6, 26, 7.6, 1, { f: '#E5E7EB', c: '#111418', w: 0.3 }));
    o.push(txt(xFu + 13, yB + 4.4, 'FUSE 10 A', { size: 1.7, anchor: 'middle', fill: '#2B3036' }));
    var xPw = gx(1550), xPe = gx(1650), xPu = gx(1725), xBo = gx(1820);
    o.push(pluggable(xPw, yB, 4, '#DDE1E6', true, false, null, PE_));
    o.push(txt(xPw + 2 * PE_, yB - 1.6, 'POWER SUPPLY', { size: 1.3, anchor: 'middle', fill: LB }));
    o.push(pluggable(xPe, yB, 3, '#DDE1E6', true, false, null, PE_));
    o.push(txt(xPe + 1.5 * PE_, yB - 1.6, 'PE', { size: 1.5, anchor: 'middle', fill: LB }));
    o.push(pluggable(xPu, yB, 4, '#DDE1E6', true, false, null, PE_));
    o.push(txt(xPu + 2 * PE_, yB - 1.6, 'PUMP OUTPUT', { size: 1.3, anchor: 'middle', fill: LB }));
    o.push(pluggable(xBo, yB, 3, '#DDE1E6', true, false, null, PE_));
    o.push(txt(xBo + 1.5 * PE_, yB - 1.6, 'BOILER OUTPUT', { size: 1.3, anchor: 'middle', fill: LB }));
    ['NO', 'COM', 'NC'].forEach(function (L, i) { o.push(txt(xBo + PE_ / 2 + i * PE_, yB + 9.4, L, { size: 1.4, anchor: 'middle', fill: LB })); });
    ['N', 'L', 'N', 'L'].forEach(function (L, i) {
      o.push(txt(xPw + PE_ / 2 + i * PE_, yB + 9.4, L, { size: 1.4, anchor: 'middle', fill: LB }));
      o.push(txt(xPu + PE_ / 2 + i * PE_, yB + 9.4, L, { size: 1.4, anchor: 'middle', fill: LB }));
    });
    o.push(txt(xPe + 1.5 * PE_, yB + 9.4, '⏚', { size: 2.0, anchor: 'middle', fill: LB }));

    // ── проводной термостат над INPUT_A: жилы идут прямо вниз, N → N, L → L, SL → SLA ──
    var tx = col(0), bx = tx - 1.5 * PE_;            // центр термостата и левый контакт INPUT_A
    if (haveWired) {
      var ty = 22, tw = 56, th = 30;
      o.push(txt(tx - tw / 2, ty - 1.6, 'Проводной термостат ENGO ' + (easy ? 'EASY' : 'SIMPLE') + ' · 230 В', { size: 2.0, weight: 'bold' }));
      o.push(rrect(tx - tw / 2, ty, tw, th, 1.6, { f: '#fff', c: INK, w: 0.5 }));
      o.push(rrect(tx - tw / 2 + 6, ty + 3, tw - 12, 11, 1, { f: '#DBEAFE', c: '#64748B', w: 0.35 }));
      o.push(txt(tx, ty + 11, '22', { size: 6, anchor: 'middle', fill: '#1D4ED8' }));
      // клеммы термостата: ESIMPLE — N, L, SL; EASY — N, L, COM, NO (перемычка L–COM)
      var tt = easy ? ['N', 'L', 'COM', 'NO'] : ['N', 'L', 'SL'];
      var sy = ty + th - 6;
      o.push(rrect(tx - tw / 2 + 4, sy - 1.6, tw - 8, 7.6, 0.8, { f: '#E2E8F0', c: INK, w: 0.4 }));
      var tpos = tt.map(function (L, i) { return bx + PE_ / 2 + i * PE_; });
      tt.forEach(function (L, i) {
        o.push(circle(tpos[i], sy + 1.2, 1.3, { f: '#fff', c: '#475569', w: 0.35 }));
        o.push(ln(tpos[i] - 0.8, sy + 1.2, tpos[i] + 0.8, sy + 1.2, { c: '#475569', w: 0.3 }));
        o.push(txt(tpos[i], sy + 4.9, L, { size: 1.5, anchor: 'middle' }));
      });
      var yCut = BY - 8, yEnd = yT + 3.2;
      var cN = bx + PE_ / 2, cL = bx + PE_ * 1.5, cS = bx + PE_ * 2.5;   // контакты INPUT_A
      o.push(seg([[tpos[0], sy + 6], [tpos[0], yEnd]], CN, 0.5));
      o.push(seg([[tpos[1], sy + 6], [tpos[1], yEnd]], CL, 0.5));
      if (easy) {
        // перемычка L–COM на термостате; жила SL идёт с клеммы NO и выравнивается по контакту SLA
        o.push('<path d="M' + n(tpos[1]) + ',' + n(sy + 6) + ' L' + n(tpos[1]) + ',' + n(sy + 8.6) + ' L' + n(tpos[2]) + ',' + n(sy + 8.6) + ' L' + n(tpos[2]) + ',' + n(sy + 6) +
          '" fill="none" stroke="' + CCLOSE + '" stroke-width="0.5" stroke-dasharray="1.2 0.8"/>');
        o.push(txt(tx + tw / 2 + 1.6, sy + 3.6, '← перемычка L–COM', { size: 1.4, fill: '#475569' }));
        o.push(seg([[tpos[3], sy + 6], [tpos[3], yCut], [cS, yCut], [cS, yEnd]], COPEN, 0.5));
      } else {
        o.push(seg([[tpos[2], sy + 6], [tpos[2], yEnd]], COPEN, 0.5));
      }
      o.push(mark(tpos[1], (sy + 6 + yEnd) / 2 + 3, 1));
      o.push(pill(tpos[0], BY - 4.2, 'N', CN, 3.6));
      o.push(pill(tpos[1], BY - 4.2, 'L', CL, 3.6));
      o.push(pill(easy ? cS : tpos[2], BY - 4.2, 'SL', COPEN, 4.6));
    }

    // ── радиотермостат над зоной 1: проводов нет, связь по радио ──
    if (haveRadio) {
      var rx = col(2), ry = 22, rw = 40, rh = 22;
      o.push(txt(rx + 0.0, ry - 1.6, 'Радиотермостат ENGO E25 / ONE (Zigbee)', { size: 2.0, weight: 'bold' }));
      o.push(rrect(rx - rw / 2 + 12, ry, rw, rh, 1.6, { f: '#fff', c: INK, w: 0.5 }));
      o.push(rrect(rx - rw / 2 + 17, ry + 3, rw - 10, 9, 1, { f: '#DBEAFE', c: '#64748B', w: 0.35 }));
      o.push(txt(rx + 12, ry + 10, '22', { size: 5, anchor: 'middle', fill: '#1D4ED8' }));
      var rcx = rx + 12;
      o.push('<path d="M' + n(rcx) + ',' + n(ry + rh + 0.5) + ' L' + n(rcx) + ',' + n(yT - 1.8) + '" fill="none" stroke="#475569" stroke-width="0.5" stroke-dasharray="1.4 1.1"/>');
      o.push(txt(rcx + 2, (ry + rh + yT) / 2 + 0.6, 'по радио: SELECT → PAIR', { size: 1.7, fill: '#475569' }));
      o.push(mark(rcx - 5, (ry + rh + yT) / 2, 2));
    }

    // ── приводы под OUTPUT: N и SLx идут прямо вниз ──
    function actPair(k, n1) {
      var x0 = xOut[k], cN1 = x0 + PE_ / 2, cS1 = x0 + PE_ * 1.5, cN2 = x0 + PE_ * 2.5, cS2 = x0 + PE_ * 3.5;
      var sy0 = yB + 6.4 + 22, y0 = yB + 3.2;
      o.push(act((cN1 + cS1) / 2, sy0, 11));
      o.push(seg([[cN1, y0], [cN1, sy0 - 3.4]], CN, 0.5));
      o.push(seg([[cS1, y0], [cS1, sy0 - 3.4]], COPEN, 0.5));
      o.push(act((cN2 + cS2) / 2, sy0, 11, true));
      o.push(seg([[cN2, y0], [cN2, sy0 - 3.4]], GREY, 0.45, '1.4 1'));
      o.push(seg([[cS2, y0], [cS2, sy0 - 3.4]], GREY, 0.45, '1.4 1'));
      o.push(txt(cN1, sy0 + 8, 'N', { size: 1.6, anchor: 'middle', fill: CN }));
      o.push(txt(cS1, sy0 + 8, n1, { size: 1.6, anchor: 'middle', fill: COPEN }));
      return sy0;
    }
    var sA = null;
    if (haveWired) { sA = actPair(0, 'SLA'); o.push(mark(xOut[0] - 4.5, yB + 12, 3)); }
    if (haveRadio) { sA = actPair(2, 'SL1'); if (!haveWired) o.push(mark(xOut[2] - 4.5, yB + 12, 3)); }
    var sBase = (sA || yB + 28) + 9;
    o.push(txt(14, sBase + 5, 'Сервопривод — ' + (e.servoVolt === 24 ? '24 В' : 'НЗ, 230 В'), { size: 2.1, weight: 'bold' }));
    o.push(txt(14, sBase + 8.2, cut(e.servoName || 'сервопривод термоэлектрический NC', 44), { size: 1.9 }));
    o.push(txt(14, sBase + 11.4, 'второй привод на ту же зону — пунктиром; до 6 приводов (2 Вт) на зону', { size: 1.8, fill: '#475569' }));

    // ── питание, насос, котёл → щит, насос, котёл; уровни: чем левее клемма, тем глубже жила ──
    var DX = 356, yb0 = yB + 3.2, lv0 = BY + BH + 6;
    function hxp(x0, i) { return x0 + PE_ / 2 + i * PE_; }
    function lead(x, lvl, c, dash) { o.push(seg([[x, yb0], [x, lvl], [DX, lvl]], c, 0.5, dash)); }
    function dest(y, hgt, t1, t2, ico) {
      o.push(rrect(DX, y, 54, hgt, 1, { f: '#fff', c: INK, w: 0.4 }));
      if (ico) o.push(ico(DX + 6.5, y + hgt / 2, 8.4));
      o.push(txt(DX + 32, y + hgt / 2 - 0.8, t1, { size: 1.8, anchor: 'middle', weight: 'bold' }));
      if (t2) o.push(txt(DX + 32, y + hgt / 2 + 3, t2, { size: 1.5, anchor: 'middle', fill: '#475569' }));
    }
    var L0 = lv0, STEP = 5;
    // котёл: COM (c1) выше, NO (c0) глубже
    lead(hxp(xBo, 1), L0, CCLOSE); lead(hxp(xBo, 0), L0 + STEP, CCLOSE);
    dest(L0 - 3.5, 11, e.auto ? 'Контроллер котельной' : 'Котёл', e.auto ? 'вход термостатов · COM + NO' : 'клеммы термостата · COM + NO', e.auto ? icoPanel : function (a, b, s) { return icoBoiler(a, b, s, true); });
    o.push(mark(DX - 4.5, L0 + STEP / 2, 5));
    // насос: L (c3) выше, N (c2) глубже — первая пара N L
    lead(hxp(xPu, 1), L0 + 2 * STEP + 1, CL); lead(hxp(xPu, 0), L0 + 3 * STEP + 1, CN);
    dest(L0 + 8.5, 12, 'Насос группы ТП', 'до 3 А · PE насоса в щит', icoPump);
    o.push(mark(DX - 4.5, L0 + 13.5, 4));
    // питание и PE → щит
    lead(hxp(xPe, 0), L0 + 4 * STEP + 2, CPE2, '1.6 1.2');
    lead(hxp(xPw, 1), L0 + 5 * STEP + 2, CL); lead(hxp(xPw, 0), L0 + 6 * STEP + 2, CN);
    dest(L0 + 21, 15, 'Щит · автомат 10 А', 'питание L, N + PE', icoBreaker);
    o.push(mark(DX - 4.5, L0 + 27, 6));

    // ── шлюз Zigbee: нужен радиоголовкам и телефону; радиосвязь — пунктиром ──
    if (e.gateway) {
      var gxp = 292, gy = 18;
      o.push(rrect(gxp, gy, 52, 17, 1.2, { f: '#fff', c: INK, w: 0.4 }));
      o.push(icoModule(gxp + 8, gy + 9, 10, true));
      o.push(txt(gxp + 28, gy + 7.2, 'Шлюз Zigbee', { size: 1.9, anchor: 'middle', weight: 'bold' }));
      o.push(txt(gxp + 28, gy + 11, 'EGATEZB · Wi-Fi 2,4 ГГц', { size: 1.5, anchor: 'middle', fill: '#475569' }));
      o.push('<path d="M' + n(gxp + 40) + ',' + n(gy + 17) + ' L' + n(gxp + 40) + ',' + n(BY + 5) + '" fill="none" stroke="#475569" stroke-width="0.5" stroke-dasharray="1.4 1.1"/>');
    }

    // ── что в смете и как подключать ──
    var ny = Math.max(L0 + 6 * STEP + 14, sBase + 18);
    function line(t, o2) { o.push(txt(12, ny, t, o2 || { size: 2.1 })); ny += 3.6; }
    line('Сколько всего — по вашей смете:', { size: 2.5, weight: 'bold' });
    line('• Блоков ECB62-ZB ' + bars + ' — на каждом 2 проводные зоны (A, B), 6 радиозон Zigbee, до 50 приводов 230 В.');
    if (wired) line('• Проводных термостатов ' + wired + ' — каждый на свой INPUT (A, B): три жилы N, L, SL, четвёртой нет' +
      (easy ? '; у EASY перемычка L–COM, жила SL идёт с клеммы NO.' : '.'));
    if (radio) line('• Радиотермостатов ' + radio + ' — клемм на плате нет: SELECT выбирает зону, PAIR запускает привязку, на термостате удерживают кнопки до «bind»; плата и термостат — в одной сети шлюза.');
    if (heads) line('• Радиоголовок ETRV ' + heads + ' — по радио через термостат E25 (до 6 голов на один), нужен шлюз.');
    if (servos) line('• Сервоприводов ' + servos + ' — на OUTPUT своей зоны, клеммы N и SLx; до 6 приводов на зону, только НЗ (NC).');
    ny += 1.4;
    line('Питание платы — да, 230 В: POWER SUPPLY (N, L) и PE от отдельного автомата 10 А; на плате вставка 10 А, суммарная нагрузка до 10 А.', { size: 2.1, weight: 'bold' });
    line('С платы 230 В получают приводы (OUTPUT), насос (PUMP OUTPUT, до 3 А) и проводные термостаты; PE насоса идёт в щит, мимо платы.');
    line('Насос включается через 3 минуты после запроса тепла от любой зоны и выключается, когда запросов нет; котёл (BOILER OUTPUT, до 6 А) — так же.');
    ny += 1.4;
    line('Кабели — выноски 1…6 на схеме (сечения — паспорт ENGO ECB62-ZB, Quick Guide v6.1):', { size: 2.2, weight: 'bold' });
    if (wired) line('1. Проводной термостат → INPUT: 3 жилы N, L, SL, 0,75–1,0 мм² (клемма принимает до 1,0): кабель ПВС 3×1,0 в гофре.');
    line('2. Радиотермостат: провода нет; питание E25/ONE — свое (батарея или 230 В), смотрите паспорт термостата.');
    line('3. Привод → OUTPUT: 2 жилы N и SLx; привод идёт с проводом, наращивать в коробке; сечение паспорт платы не задаёт.');
    line('4. Насос → PUMP OUTPUT: 3 жилы N, L, PE, 1,0–1,5 мм². 5. Котёл → BOILER OUTPUT: 2 жилы COM–NO, 0,75–1,0 мм².');
    line('6. Питание → POWER SUPPLY: 3 жилы N, L, PE, 1,0–1,5 мм² от отдельного автомата 10 А.');

    return { svg: o.join(''), w: W, h: ny + 6 };
  }


  /** Готовый лист: рамка + штамп формы 6 + схема. */
  function sheetSvg(cfg, opts) {
    opts = opts || {};
    return window.projectSheets.sheet({
      code: opts.code, sheet: opts.sheet,
      body: build(cfg)
    });
  }

  window.projectScheme = {
    build: build, sheet: sheetSvg, automation: automation, automation1002: automation1002, automationSmart2: automationSmart2, automationH: automationH, automationMyheat: automationMyheat, ufhScheme: ufhScheme, ufhSchemeEngo: ufhSchemeEngo,
    snowScheme: snowScheme,
    // отдельные УГО пригодятся будущим листам узлов обвязки
    sym: {
      ballValve: ballValve, checkValve: checkValve, pump: pump, valve3: valve3,
      safetyValve: safetyValve, airVent: airVent, gauge: gauge, filter: filterSym,
      hydroSep: hydroSep, expTank: expTank, boilerUnit: boilerUnit,
      indirectTank: indirectTank, safetyGroup: safetyGroup, arrowSym: arrowSym
    },
    COL: COL
  };
})();
