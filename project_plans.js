/* project_plans.js — листы «План N этажа» и «Тёплый пол N этажа».
 *
 * Данные готовит редактор plan_editor.html и кладёт в localStorage
 * ('floor_plans_v1'): этажи с масштабом pxPerM и зонами (тёплый пол /
 * радиаторы / котельная), точки зон — в пикселях изображения подложки.
 *
 * Сама подложка (даунскейл ~1600 px) лежит на Beget, в разметке от неё
 * остаётся имя файла; в адрес его разворачивает страница листов
 * (project.html), сюда f.img приходит уже готовой ссылкой. У записей,
 * сделанных до переноса, там по-прежнему data:-картинка — работает и так.
 *
 * Лист плана: подложка + зоны (штриховка 45° у ТП, контуры, подписи с
 * площадями), легенда, печатный масштаб. Лист ТП: подложка приглушена,
 * в зонах — змейка укладки с шагом из сметы, таблица петель.
 *
 * Петли считает floorLoops() — тем же расчётом пользуется смета (app.js):
 * длина трубы и число выходов коллектора берутся из нарисованной укладки,
 * иначе на листе было бы одно, а в деньгах другое.
 *
 * Требует project_sheets.js (кроме floorLoops — она чистая геометрия и
 * работает и в калькуляторе, где листов нет). Глобал: window.projectPlans
 */
(function () {
  'use strict';

  var AVAIL = { x0: 100, y0: 24, x1: 405, y1: 266 };  // поле под подложку, мм листа
  // room — контур помещения без тёплого пола (модуль раскладки ТП): на листах
  // это просто подписанная комната
  var COLT = { tp: '#ff8000', rad: '#d22222', boiler: '#5577aa', wc: '#0b7285', cold: '#7a7a7a', room: '#8a94a6' };
  var NAMES = { tp: 'Тёплый пол', rad: 'Радиаторы', boiler: 'Котельная', wc: 'Санузел', cold: 'Без обогрева', room: 'Помещение' };

  function n(v) { return Math.round(v * 100) / 100; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function txt(x, y, s, o) {
    o = o || {};
    var a = ' x="' + n(x) + '" y="' + n(y) + '" font-size="' + (o.size || 3.68) + '"';
    if (o.anchor) a += ' text-anchor="' + o.anchor + '"';
    // Латиница вне покрытия чертёжного шрифта (сабсеты из PDF-образца) —
    // запасным семейством целиком, иначе слово выйдет разнобоем букв.
    var PS = window.projectSheets;
    if (PS && PS.fontFor && PS.fontFor(s, null) === PS.FONT_LAT)
      a += ' font-family="' + PS.FONT_LAT + '"';
    if (o.fill) a += ' style="fill:' + o.fill + '"';
    return '<text' + a + '>' + esc(s) + '</text>';
  }
  function polyPts(pts, X, Y) {
    return pts.map(function (p) { return n(X(p[0])) + ',' + n(Y(p[1])); }).join(' ');
  }
  function centroid(pts) {
    var x = 0, y = 0;
    pts.forEach(function (p) { x += p[0]; y += p[1]; });
    return [x / pts.length, y / pts.length];
  }
  function areaM2(z, f) {
    var s = 0, m = f.pxPerM || 1;
    for (var i = 0; i < z.pts.length; i++) {
      var a = z.pts[i], b = z.pts[(i + 1) % z.pts.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s / 2) / (m * m);
  }
  // Периметр зоны в метрах — по нему смета считает демпферную ленту, так же
  // как длину трубы по укладке: контур нарисован, гадать по площади незачем.
  function perimM(z, f) {
    var s = 0, m = f.pxPerM || 1;
    for (var i = 0; i < z.pts.length; i++) {
      var a = z.pts[i], b = z.pts[(i + 1) % z.pts.length];
      s += Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
    }
    return s / m;
  }
  function bbox(pts) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    pts.forEach(function (p) {
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    });
    return [x0, y0, x1, y1];
  }

  /** Трансформация подложки этажа в поле листа: масштаб и origin.
   *  box — своё поле (у сводного плана справа таблица, снизу составы). */
  function fit(f, box) {
    var B = box || AVAIL;
    var s = Math.min((B.x1 - B.x0) / f.w, (B.y1 - B.y0) / f.h);
    var ox = B.x0 + ((B.x1 - B.x0) - f.w * s) / 2;
    var oy = B.y0 + ((B.y1 - B.y0) - f.h * s) / 2;
    return {
      s: s, ox: ox, oy: oy,
      X: function (px) { return ox + px * s; },
      Y: function (px) { return oy + px * s; }
    };
  }

  function imageTag(f, t, op) {
    // Подложка приходит либо картинкой (data:...), либо адресом на сервере
    // подложек. В адресе есть «&» между параметрами, а это разметка внутри
    // SVG-атрибута — экранируем, иначе ссылка обрывается на первом же «&».
    var href = String(f.img || '').replace(/&/g, '&amp;');
    return '<image x="' + n(t.ox) + '" y="' + n(t.oy) + '" width="' + n(f.w * t.s) +
      '" height="' + n(f.h * t.s) + '" preserveAspectRatio="none"' +
      (op ? ' opacity="' + op + '"' : '') + ' href="' + href + '"/>';
  }

  function legend(rows, Lx, Ty) {
    var o = [];
    rows.forEach(function (r, i) {
      var y = Ty + i * 6.4;
      o.push('<rect x="' + n(Lx) + '" y="' + n(y) + '" width="5" height="4" style="fill:' +
        r[1] + ';fill-opacity:0.5;stroke:' + r[1] + ';stroke-width:0.3"/>');
      o.push(txt(Lx + 7, y + 3.2, r[0], { size: 3.3 }));
    });
    return o.join('');
  }

  function title(s) {
    return txt(217.5, 14.8, s, { size: 7.36, anchor: 'middle' });
  }

  /**
   * Расстановка подписей без наложений. Занятые места — прямоугольники
   * [x0, y0, x1, y1] в мм листа (значки, уже поставленные подписи).
   * place(cands) берёт первый вариант, который ни с чем не пересекается, а если
   * таких нет — тот, где перекрытие меньше всего, и сам его занимает.
   * У варианта может быть штраф b.pen (например, «вне своей комнаты»): он
   * складывается с площадью перекрытия, и штрафной вариант берётся последним.
   */
  function labelPlacer() {
    var boxes = [];
    var over = function (b) {
      var s = 0;
      boxes.forEach(function (c) {
        var w = Math.min(b[2], c[2]) - Math.max(b[0], c[0]), h = Math.min(b[3], c[3]) - Math.max(b[1], c[1]);
        if (w > 0 && h > 0) s += w * h;
      });
      return s;
    };
    return {
      add: function (b) { boxes.push(b); },
      place: function (cands) {
        var best = null, bs = Infinity;
        for (var i = 0; i < cands.length; i++) {
          var s = over(cands[i]) + (cands[i].pen || 0);
          if (s === 0) { best = cands[i]; break; }
          if (s < bs) { bs = s; best = cands[i]; }
        }
        if (best) boxes.push(best);
        return best;
      }
    };
  }
  /** Габарит строки текста в мм листа: ширина по числу знаков, как в вёрстке */
  function textW(s, size) { return String(s).length * size * 0.5; }

  /** Прямоугольник значка прибора на листе [x0,y0,x1,y1] — по его настоящим
   *  размерам и повороту вдоль стены. Раньше под прибор занимался квадрат по
   *  длинной стороне: вокруг ванны 1,7 × 0,7 м — квадрат 1,7 × 1,7, и подписи
   *  рядом с трубами уходили далеко. minHalf — не меньше буквы значка. */
  function fixtureBox(q, t, ppmS, minHalf) {
    var W = (q.w || (FIXT[q.t] || [])[2] || 500) / 2000 * ppmS;
    var D = (q.d || (FIXT[q.t] || [])[3] || 500) / 2000 * ppmS;
    var a = ((q.ang || 0) % 180 + 180) % 180, c = Math.abs(Math.cos(a * Math.PI / 180)), s = Math.abs(Math.sin(a * Math.PI / 180));
    var hx = Math.max(W * c + D * s, minHalf || 0), hy = Math.max(W * s + D * c, minHalf || 0);
    var X = t.X(q.x), Y = t.Y(q.y);
    return [X - hx, Y - hy, X + hx, Y + hy];
  }

  /** Лист «План N этажа» */
  function floorBody(f, num) {
    var t = fit(f), o = [];
    o.push(imageTag(f, t));
    o.push('<defs><pattern id="tpH' + num + '" width="2.4" height="2.4" patternUnits="userSpaceOnUse"' +
      ' patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="2.4"' +
      ' style="stroke:' + COLT.tp + ';stroke-width:0.45"/></pattern></defs>');
    var used = {};
    // Подписи зон. У помещения бывает две зоны по одному контуру (котельная и
    // радиаторы, санузел и радиаторы, тёплый пол и радиаторы), и две подписи
    // в одной точке ложились друг на друга. Зоны с общим центром сводим в
    // одну подпись со всеми типами; разные подписи разводим placer'ом.
    var groups = [];
    (f.zones || []).forEach(function (z) {
      var col = COLT[z.type]; used[z.type] = 1;
      var fill = z.type === 'tp' ? 'url(#tpH' + num + ')'
        : z.type === 'boiler' ? 'rgba(85,119,170,0.18)'
        : z.type === 'cold' ? '#ffffff' : 'none';     // без обогрева — штриховку ТП перекрываем
      o.push('<polygon points="' + polyPts(z.pts, t.X, t.Y) + '" style="fill:' + fill +
        ';stroke:' + col + ';stroke-width:0.5' +
        (z.type === 'rad' ? ';stroke-dasharray:2.2,1.2' : '') + '"/>');
      var c = centroid(z.pts), X = t.X(c[0]), Y = t.Y(c[1]), a = areaM2(z, f);
      var g = null;
      groups.forEach(function (q) {
        if (!g && Math.hypot(q.X - X, q.Y - Y) < 3 && Math.abs(q.a - a) <= Math.max(0.3, 0.05 * a)) g = q;
      });
      if (!g) { g = { X: X, Y: Y, a: a, types: [], name: '' }; groups.push(g); }
      if (g.types.indexOf(z.type) < 0) g.types.push(z.type);
      if (z.name && z.name !== NAMES[z.type] && !g.name) g.name = z.name;
    });
    var PRI = { boiler: 0, wc: 1, tp: 2, rad: 3 };
    var lp = labelPlacer();
    groups.forEach(function (g) {
      g.types.sort(function (p, q) { return (p in PRI ? PRI[p] : 9) - (q in PRI ? PRI[q] : 9); });
      // имя совпадает с названием одного из типов («Котельная») — не повторяем
      if (g.types.some(function (k) { return NAMES[k] === g.name; })) g.name = '';
      var label = (g.name ? g.name + ' — ' : '') + g.types.map(function (k) { return NAMES[k]; }).join(', ') +
        ', ' + g.a.toFixed(1) + ' м²';
      var w = label.length * 1.72, col = COLT[g.types[0]];
      var cands = [0, 5.4, -5.4, 10.8, -10.8].map(function (dy) {
        var b = [g.X - w / 2, g.Y + dy - 2.6, g.X + w / 2, g.Y + dy + 2]; b.dy = dy; return b;
      });
      var b = lp.place(cands);
      o.push('<rect x="' + n(b[0]) + '" y="' + n(b[1]) + '" width="' + n(w) + '" height="4.6" rx="0.8" style="fill:#ffffff;fill-opacity:0.82"/>');
      o.push(txt(g.X, g.Y + b.dy + 0.9, label, { size: 3.1, anchor: 'middle', fill: col }));
    });
    // радиаторы — значки вдоль стен (точечные приборы, не зоны)
    (f.rads || []).forEach(function (r) {
      used.rad = 1;
      var wl = r.w * t.s, hl = Math.max(1.1, 0.14 * (f.pxPerM || 100) * t.s);
      var g = '<g transform="translate(' + n(t.X(r.x)) + ',' + n(t.Y(r.y)) + ') rotate(' + (r.ang || 0) + ')">';
      g += '<rect x="' + n(-wl / 2) + '" y="' + n(-hl / 2) + '" width="' + n(wl) + '" height="' + n(hl) +
        '" style="fill:rgba(210,34,34,0.3);stroke:#d22222;stroke-width:0.35"/>';
      for (var s2 = -2; s2 <= 2; s2++) {
        var xs = s2 * wl / 5.6;
        g += '<line x1="' + n(xs) + '" y1="' + n(-hl / 2) + '" x2="' + n(xs) + '" y2="' + n(hl / 2) +
          '" style="stroke:#d22222;stroke-width:0.25"/>';
      }
      o.push(g + '</g>');
    });
    if (f.coll) collectorMark(f.coll, t, f, o);
    var rows = Object.keys(used).map(function (k) { return [NAMES[k], COLT[k]]; });
    if (rows.length) {
      o.push(txt(30, 226, 'Условные обозначения', { size: 4.2 }));
      o.push(legend(rows, 30, 230));
    }
    var scale = f.pxPerM ? Math.round(1000 / (f.pxPerM * t.s)) : 0;
    if (scale) o.push(txt(30, 260, 'Масштаб печати ~1:' + scale + ' (лист А3)', { size: 3.3 }));
    o.push(txt(228, 273.8, 'Зоны нанесены в редакторе планов heatcalc.ru по подложке заказчика.', { size: 3.0 }));
    return o.join('');
  }

  function pip(p, pts) {  // точка внутри полигона (ray casting)
    var inn = false;
    for (var a = 0, b = pts.length - 1; a < pts.length; b = a++) {
      if ((pts[a][1] > p[1]) !== (pts[b][1] > p[1]) &&
          p[0] < (pts[b][0] - pts[a][0]) * (p[1] - pts[a][1]) / (pts[b][1] - pts[a][1]) + pts[a][0])
        inn = !inn;
    }
    return inn;
  }

  function lenPoly(pts) {
    var s = 0;
    for (var i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return s;
  }

  // ═══ Укладка тёплого пола ═══════════════════════════════════════════════
  // Правила сняты с листов «План напольного отопления» корпуса Galf
  // (154 проекта, 02.10.2026):
  //  • в комнате — улитка: встречная спираль, подача и обратка идут через
  //    кольцо; в узком месте (коридор, проход уже SNAKE_BELOW_M) — змейка
  //    парой труб. Зона может задать своё: z.lay = 'spiral' | 'snake';
  //  • большая комната делится на прямоугольные участки, у каждого своя
  //    петля, между петлями — зазор;
  //  • подводки от коллектора идут общим пучком в изоляции по проходам и
  //    зазорам; петли пучок обходят, поэтому ничего не пересекается.
  // Труба петли — две параллельные нитки одной направляющей (сдвиг ±шаг/2):
  // подача и обратка не пересекаются по построению.

  var CELL_M = 0.1;           // клетка сетки этажа
  var SNAKE_BELOW_M = 1.2;    // участок уже — змейка, шире — улитка
  var LEAD_PIPE_M = 0.035;    // шаг труб в пучке: 16 мм в изоляции 6 мм, с зазором
  var MIN_RECT_M2 = 0.5;      // участок меньше — не греем (обрезки у стен и колонн)
  // Второй участок комнаты — своя петля, только если не меньше 1 м² и 0,5 м в
  // ширину. Подбор по корпусу Galf (13 домов, 03.10.2026): покрытие площади
  // от порога почти не зависит (70–71 %), а петель 181 → 137 (у проектировщиков
  // 124) и подводки 46 → 35 % трубы (у них 29 %). Жёстче (1,5 м², 8 %) — петель
  // меньше, чем у проектировщиков, и трубы 0,63 от их длины.
  var SIDE_RECT_M2 = 1.0, SIDE_RECT_MIN_W = 0.5;
  // И только если в него ляжет петля не короче 12 м (порог в метрах, а не в м²:
  // при шаге 100 в тот же кусок входит вдвое больше трубы, чем при 200). Полоса у
  // дверного проёма, прихваченная контуром комнаты, давала петлю на 14 м с
  // подводками. Корпус Galf (03.10.2026): коротких петель (< 25 м) на боковых
  // участках 49 → 24, всего петель 96 → 92 (у проектировщиков 99), покрытие
  // обычных комнат 75 → 73 % (у проектировщиков 45 %); 15 м — 16 коротких, 72 %.
  var SIDE_LOOP_MIN_M = 12;
  // Улитка по контуру (комната буквой Г): включена, для зон не крупнее POLY_MAX_M2
  var POLY_ON = true, POLY_MAX_M2 = 45;
  // Пустота — клетка куска дальше 0,25 м от любой трубы (дальше тепло пола не
  // достаёт; тем же радиусом меряет стенд bench/ufh_room.js); допустимо до 5 % куска —
  // столько пустого в комнатах и у прямоугольной раскладки (2–5 %)
  var POLY_VOID_M = 0.25, POLY_VOID_MAX = 0.05;
  // Зазор между участками соседних петель, клеток. Без зазора (пробовали
  // 03.10.2026) покрытие комнаты растёт лишь на 1–2 %, а пучку подводок
  // становится негде пройти между петлями — появляются наложения. Клетка.
  var SLAB_GAP = 1;
  var MAX_LOOP_M = 100;       // предел длины одной петли 16×2,0 мм — запасное значение
  // цена прохода пучка по клетке: свободный проход, край петли, середина петли
  /**
   * Подсказки трассы, сохранённые редактором в разметке (f.leads). Редактор строил их по карте стен, а если
   * картинки этажа в сессии не было — прямой линией «коллектор → вход в комнату» (две точки, часто по диагонали
   * сквозь стены). Такая линия делала клетки вдоль себя дешёвыми, и трасса шла за ней ступеньками, а петли
   * раскладывались иначе (проверено на реальной разметке КП 393974). Берём только ломаные из трёх и более точек,
   * все звенья которых идут вдоль осей: это настоящий маршрут по стенам и дверям.
   */
  function usableLeads(f) {
    return (f.leads || []).filter(function (L) {
      var P = L && L.pts;
      if (!P || P.length < 3) return false;
      for (var j = 1; j < P.length; j++)
        if (Math.abs(P[j][0] - P[j - 1][0]) > 2 && Math.abs(P[j][1] - P[j - 1][1]) > 2) return false;
      return true;
    });
  }
  var COST_FREE = 1, COST_OUT = 2, COST_EDGE = 8, COST_IN = 60, COST_TURN = 3, COST_DRAWN = 0.3;
  // Подводки — вдоль стен: клетка зоны дальше LEAD_WALL_CELLS от стены дороже
  // на COST_MID (проектировщики Galf ведут пучок у стен и по коридорам).
  var LEAD_WALL_CELLS = 3, COST_MID = 2;

  /**
   * Предел длины петли, м. Считает его смета (app.ufhLoopMax) — там известны и
   * труба, и шаг, и допустимые потери. Лист и смета обязаны показывать одну и
   * ту же укладку, поэтому предел у них общий, а не свой у каждого.
   */
  // Страница листов калькулятора не грузит — предел ей передаёт смета готовыми
  // числами по шагу укладки (setLoopLimits). Без него лист делил петли по
  // запасным 100 м, а смета по расчётному пределу: на листе 5 петель, в
  // гидравлике и коллекторе 6.
  var loopLimits = null;
  function setLoopLimits(map) { loopLimits = map || null; }

  function loopLimit(stepMm) {
    var st = parseInt(stepMm, 10) || 150;
    if (loopLimits && loopLimits[st] > 0) return loopLimits[st];
    try {
      // app объявлен через const — в window его нет, обращаемся по имени
      if (typeof app !== 'undefined' && app && typeof app.ufhLoopMax === 'function') return app.ufhLoopMax(st);
    } catch (e) { /* расчёт ещё не поднялся — работаем по запасному значению */ }
    return MAX_LOOP_M;
  }

  /** Ломаную маршрута приводим к прямым углам — трубу ведут вдоль стен */
  function orthoPath(pts) {
    var out = [pts[0].slice()], i;
    for (i = 1; i < pts.length; i++) {
      var a = out[out.length - 1], b = pts[i];
      if (Math.abs(b[0] - a[0]) > 1e-6 && Math.abs(b[1] - a[1]) > 1e-6) out.push([b[0], a[1]]);
      out.push(b.slice());
    }
    return out;
  }

  /** Параллельная линия орто-полилинии: сдвиг на h влево по ходу (h<0 —
   *  вправо). Стыки — пересечением сдвинутых прямых, линии остаются орто. */
  function offsetOrtho(pts, h) {
    var p = [], i;
    for (i = 0; i < pts.length; i++)
      if (!p.length || Math.abs(p[p.length - 1][0] - pts[i][0]) > 1e-6 ||
                       Math.abs(p[p.length - 1][1] - pts[i][1]) > 1e-6) p.push(pts[i]);
    if (p.length < 2) return null;
    var segs = [];
    for (i = 0; i + 1 < p.length; i++) {
      var dx = p[i + 1][0] - p[i][0], dy = p[i + 1][1] - p[i][1];
      var L = Math.hypot(dx, dy) || 1, nx = dy / L, ny = -dx / L;
      segs.push({ a: [p[i][0] + nx * h, p[i][1] + ny * h],
                  b: [p[i + 1][0] + nx * h, p[i + 1][1] + ny * h],
                  hz: Math.abs(dy) < 1e-6 });
    }
    var out = [segs[0].a];
    for (i = 1; i < segs.length; i++) {
      var pr = segs[i - 1], cu = segs[i];
      if (pr.hz === cu.hz) {
        // разворот на месте: сдвинутые линии по разные стороны — поперечина
        out.push(pr.b); out.push(cu.a);
        continue;
      }
      out.push(pr.hz ? [cu.a[0], pr.a[1]] : [pr.a[0], cu.a[1]]);
    }
    out.push(segs[segs.length - 1].b);
    return out;
  }

  // ─── сетка этажа ───────────────────────────────────────────────────────
  // Клетка CELL_M: по ней размечаются участки петель и ищется трасса пучка.
  function floorGrid(f, zs) {
    var ppm = f.pxPerM, c = CELL_M * ppm, xs = [], ys = [];
    zs.forEach(function (z) { z.pts.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); }); });
    if (f.coll) { xs.push(f.coll.x); ys.push(f.coll.y); }
    var mg = 0.4 * ppm;
    var x0 = Math.min.apply(null, xs) - mg, y0 = Math.min.apply(null, ys) - mg;
    var W = Math.ceil((Math.max.apply(null, xs) + mg - x0) / c);
    var H = Math.ceil((Math.max.apply(null, ys) + mg - y0) / c);
    if (W < 3 || H < 3 || W * H > 300000) return null;
    return { W: W, H: H, ox: x0, oy: y0, c: c, ppm: ppm };
  }
  function cellAt(g, p) {
    var x = Math.max(0, Math.min(g.W - 1, Math.floor((p[0] - g.ox) / g.c)));
    var y = Math.max(0, Math.min(g.H - 1, Math.floor((p[1] - g.oy) / g.c)));
    return y * g.W + x;
  }
  function cellXY(g, k) {
    return [g.ox + (k % g.W + 0.5) * g.c, g.oy + (Math.floor(k / g.W) + 0.5) * g.c];
  }

  /**
   * Клетки, чей центр внутри многоугольника, — построчно: пересечения строки с
   * рёбрами считаются той же формулой и с тем же правилом, что в pip(), так
   * что набор клеток совпадает с проверкой каждой клетки по отдельности, а
   * работы в разы меньше. cb(k) — на каждую клетку; возвращает рамку
   * [X0, Y0, X1, Y1] (клетки габарита многоугольника).
   */
  function polyCells(g, pts, cb) {
    var bb = bbox(pts), c0 = cellAt(g, [bb[0], bb[1]]), c1 = cellAt(g, [bb[2], bb[3]]);
    var X0 = c0 % g.W, Y0 = Math.floor(c0 / g.W), X1 = c1 % g.W, Y1 = Math.floor(c1 / g.W);
    var xs = [], x, y, a, b, i;
    for (y = Y0; y <= Y1; y++) {
      var py = g.oy + (y + 0.5) * g.c;
      xs.length = 0;
      for (a = 0, b = pts.length - 1; a < pts.length; b = a++)
        if ((pts[a][1] > py) !== (pts[b][1] > py))
          xs.push((pts[b][0] - pts[a][0]) * (py - pts[a][1]) / (pts[b][1] - pts[a][1]) + pts[a][0]);
      if (!xs.length) continue;
      for (x = X0; x <= X1; x++) {
        var px = g.ox + (x + 0.5) * g.c, cnt = 0;
        for (i = 0; i < xs.length; i++) if (px < xs[i]) cnt++;
        if (cnt & 1) cb(y * g.W + x);
      }
    }
    return [X0, Y0, X1, Y1];
  }

  /** Самый большой прямоугольник из клеток ok[] в рамке bb (клетки, включительно) */
  function maxRect(g, ok, bb) {
    var w = bb[2] - bb[0] + 1, hgt = new Int32Array(w), best = null, x, y;
    for (y = bb[1]; y <= bb[3]; y++) {
      for (x = 0; x < w; x++) hgt[x] = ok[y * g.W + bb[0] + x] ? hgt[x] + 1 : 0;
      // наибольший прямоугольник гистограммы стеком
      var st = [];
      for (x = 0; x <= w; x++) {
        var hx = x < w ? hgt[x] : 0;
        while (st.length && hgt[st[st.length - 1]] >= hx) {
          var top = st.pop(), hh = hgt[top];
          var left = st.length ? st[st.length - 1] + 1 : 0, ww = x - left;
          if (hh && (!best || hh * ww > best.area))
            best = { x0: bb[0] + left, x1: bb[0] + x - 1, y0: y - hh + 1, y1: y, area: hh * ww };
        }
        st.push(x);
      }
    }
    return best;
  }

  /**
   * Участки петель зоны: прямоугольники из клеток зоны (комната буквой Г — два),
   * между участками — клетка зазора, по ней и пойдёт пучок к дальним петлям.
   * Каждый прямоугольник делится вдоль длинной стороны на k петель.
   */
  /**
   * Комната буквой Г режется на прямоугольники двумя способами: жадно — сперва
   * самый большой, — или поперёк, по краю выступа. Жадный в комнате с узким
   * выступом брал всю основную часть, а выступ оставался узкой полосой без
   * своей петли и без трубы («до стен не доходит», 03.10.2026). Поэтому: если
   * после жадного остался кусок без петли, пробуем первым взять полосу во всю
   * ширину комнаты по рядам (или столбцам) этого куска — и берём разрез, при
   * котором петли лягут на большую площадь.
   */
  var BAND_GAIN_M2 = 0.4;
  function zoneRects(g, own, zi, bb, cellsTotal, stepM) {
    var A = zoneRectsGreedy(g, own, zi, bb, cellsTotal, stepM, null);
    var kept = function (R) { return R.reduce(function (s, r) { return s + r.area; }, 0); };
    var left = leftoverBox(g, own, zi, bb, A);
    if (!left) return A;
    var best = A, bk = kept(A), bs = Infinity, tol = 0.3 / (CELL_M * CELL_M);
    // Полосу можно взять шире выступа — вглубь комнаты: тогда площадь между
    // двумя участками делится так, чтобы на петлю приходилось поровну (у
    // кухни-гостиной иначе выходили петли 46 и 75 м). Из вариантов с той же
    // покрытой площадью — самый ровный.
    var lim = stepM ? (loopLimit(stepM * 1000) || 100) : 100;
    var spread = function (R) {
      var per = R.map(function (r) {
        var len = r.area * CELL_M * CELL_M / (stepM || 0.15) * 1.05;
        return len / Math.max(1, Math.ceil(len / lim));
      });
      return per.length > 1 ? Math.max.apply(null, per) / Math.min.apply(null, per) : 1;
    };
    [['rows', left.y0, left.y1, bb[1], bb[3]], ['cols', left.x0, left.x1, bb[0], bb[2]]].forEach(function (b) {
      var atLo = b[1] <= b[3] + SLAB_GAP + 1, atHi = b[2] >= b[4] - SLAB_GAP - 1;
      if (!atLo && !atHi) return;                     // выступ не у края комнаты — полосой его не взять
      var room = b[4] - b[3] + 1;
      for (var e = 0; e <= room; e += 2) {
        var lo = atLo ? b[1] : Math.max(b[3], b[1] - e), hi = atLo ? Math.min(b[4], b[2] + e) : b[2];
        if (hi - lo + 1 > room * 0.75) break;           // полоса — не больше трёх четвертей комнаты
        var R = zoneRectsGreedy(g, own, zi, bb, cellsTotal, stepM, [b[0], lo, hi]);
        // полоса — такой же участок, как остальные: короткой петли в узком
        // кусочке не даём и здесь (иначе выступ шёл отдельной петлёй на метр)
        if (R.length > 1 && R.some(function (r) { return sideRectTooSmall(r, cellsTotal, stepM); })) continue;
        var k = kept(R), s = spread(R);
        // против жадного — только с заметным выигрышем площади; между
        // полосами — ровнее, если площадь не меньше лучшей больше чем на 0,3 м²
        if (best === A ? k < bk + BAND_GAIN_M2 / (CELL_M * CELL_M) : k < bk - tol) continue;
        if (best === A || k > bk + tol || s < bs) { best = R; bk = Math.max(bk, k); bs = s; }
      }
    });
    return best;
  }

  /**
   * Самый большой кусок зоны, не попавший ни в один участок (и не зазор между
   * ними), — его габарит в клетках; null, если такого куска нет или он меньше
   * MIN_RECT_M2 (обрезки у колонн и стен, их не греем и так).
   */
  function leftoverBox(g, own, zi, bb, rects) {
    var W = g.W, mark = new Uint8Array(W * g.H), x, y, k;
    for (y = bb[1]; y <= bb[3]; y++) for (x = bb[0]; x <= bb[2]; x++)
      if (own[y * W + x] === zi + 1) mark[y * W + x] = 1;
    rects.forEach(function (r) {
      for (y = r.y0 - SLAB_GAP; y <= r.y1 + SLAB_GAP; y++) for (x = r.x0 - SLAB_GAP; x <= r.x1 + SLAB_GAP; x++)
        if (x >= 0 && y >= 0 && x < W && y < g.H) mark[y * W + x] = 0;
    });
    var best = null, q = new Int32Array(W * g.H);
    for (y = bb[1]; y <= bb[3]; y++) for (x = bb[0]; x <= bb[2]; x++) {
      k = y * W + x;
      if (mark[k] !== 1) continue;
      var h = 0, t = 0, n = 0, B = { x0: x, x1: x, y0: y, y1: y };
      mark[k] = 2; q[t++] = k;
      while (h < t) {
        var c = q[h++], cx = c % W, cy = (c - cx) / W;
        n++;
        if (cx < B.x0) B.x0 = cx; if (cx > B.x1) B.x1 = cx; if (cy < B.y0) B.y0 = cy; if (cy > B.y1) B.y1 = cy;
        [cx > 0 ? c - 1 : -1, cx < W - 1 ? c + 1 : -1, c - W, c + W].forEach(function (m) {
          if (m >= 0 && m < mark.length && mark[m] === 1) { mark[m] = 2; q[t++] = m; }
        });
      }
      if (!best || n > best.n) { B.n = n; best = B; }
    }
    return best && best.n * CELL_M * CELL_M >= MIN_RECT_M2 ? best : null;
  }

  /** Участок слишком мал для своей петли (те же пороги, что у жадного разреза). */
  function sideRectTooSmall(r, cellsTotal, stepM) {
    var sideCells = Math.max(SIDE_RECT_M2, stepM ? SIDE_LOOP_MIN_M * stepM / 1.05 : 0) / (CELL_M * CELL_M);
    return r.area < cellsTotal * 0.04 || r.area < sideCells ||
      Math.min(r.x1 - r.x0, r.y1 - r.y0) + 1 < SIDE_RECT_MIN_W / CELL_M;
  }

  /** Жадный разрез; band — первым взять самый большой прямоугольник в этой полосе рядов/столбцов. */
  function zoneRectsGreedy(g, own, zi, bb, cellsTotal, stepM, band) {
    var ok = new Uint8Array(g.W * g.H), x, y, rects = [];
    for (y = bb[1]; y <= bb[3]; y++) for (x = bb[0]; x <= bb[2]; x++)
      if (own[y * g.W + x] === zi + 1) ok[y * g.W + x] = 1;
    var minCells = MIN_RECT_M2 / (CELL_M * CELL_M);
    // боковой участок, в который ляжет петля короче SIDE_LOOP_MIN_M, — без своей петли
    var sideCells = Math.max(SIDE_RECT_M2, stepM ? SIDE_LOOP_MIN_M * stepM / 1.05 : 0) / (CELL_M * CELL_M);
    for (var it = 0; it < 8; it++) {
      var r = (it === 0 && band) ? maxRect(g, ok, band[0] === 'rows'
        ? [bb[0], band[1], bb[2], band[2]] : [band[1], bb[1], band[2], bb[3]]) : maxRect(g, ok, bb);
      if (!r || r.area < minCells) break;
      // Второй и дальше участок — своя петля со своей парой подводок через
      // полдома. Обрезку неправильного контура (выступ, ниша) её не даём:
      // на корпусе Galf такие петли по 15–18 м грели по метру с небольшим,
      // а подводки к ним шли длиннее самих петель. Плечо Г-образной комнаты
      // (несколько м²) — по-прежнему своя петля.
      if (rects.length && (r.area < cellsTotal * 0.04 || r.area < sideCells ||
          Math.min(r.x1 - r.x0, r.y1 - r.y0) + 1 < SIDE_RECT_MIN_W / CELL_M)) break;
      rects.push(r);
      for (y = r.y0 - SLAB_GAP; y <= r.y1 + SLAB_GAP; y++) for (x = r.x0 - SLAB_GAP; x <= r.x1 + SLAB_GAP; x++)
        if (x >= 0 && y >= 0 && x < g.W && y < g.H) ok[y * g.W + x] = 0;
    }
    return rects;
  }

  /**
   * Участок на k петель: сетка nx × ny почти квадратных плиток — так большие
   * залы делят проектировщики (улитка в каждой плитке); в узком коридоре
   * сетка вырождается в полосы. Лишняя плитка сверх k — штраф: каждая петля
   * тянет к коллектору свою пару подводок. Между плитками — клетка зазора,
   * по ней идёт пучок, и петли вокруг него ужимаются (вырезка в layRound).
   *
   * Первая проба сетки (03.10.2026) дала наложения пучка на петли — их
   * давали концы улиток, выступавшие за участок; после того исправления
   * корпус Galf с сеткой — 0 наложений на 74 этажах (bench/ufh_corpus.js).
   */
  var TILE_ROWS = 99;           // рядов плиток поперёк короткой стороны
  // w — доли полос (сумма 1), когда участок делится полосами: ближняя к
  // коллектору петля берёт больше площади, дальняя меньше — так петли выходят
  // одной длины вместе с подводками (layFloor, проход выравнивания). Сетке
  // плиток доли не задаются. У результата .grid — делилось ли сеткой.
  function splitRect(r, k, w) {
    var W = r.x1 - r.x0 + 1, H = r.y1 - r.y0 + 1, MIN = 4;   // плитка не меньше 0,4 м
    var wide = W >= H, Lg = wide ? W : H, Sh = wide ? H : W;
    var capS = Math.min(TILE_ROWS, Math.floor((Sh + 1) / (MIN + 1)) || 1);
    var cap = (Math.floor((Lg + 1) / (MIN + 1)) || 1) * capS;
    k = Math.max(1, Math.min(k, cap));
    var best = null;
    for (var nS = 1; nS <= capS; nS++) {
      var nL = Math.ceil(k / nS);
      if (nL * (MIN + 1) - 1 > Lg) continue;
      var tL = (Lg - (nL - 1)) / nL, tS = (Sh - (nS - 1)) / nS;
      var s = Math.max(tL / tS, tS / tL) + 1.0 * (nL * nS - k);
      if (!best || s < best.s) best = { s: s, nx: wide ? nL : nS, ny: wide ? nS : nL };
    }
    if (best && (best.nx > 1 && best.ny > 1)) {
      var cut = function (from, len, n) {
        var use = len - (n - 1) * SLAB_GAP, o = [], pos = from;
        for (var i = 0; i < n; i++) { var l = Math.floor(use / n) + (i < use % n ? 1 : 0); o.push([pos, pos + l - 1]); pos += l + SLAB_GAP; }
        return o;
      };
      var xs = cut(r.x0, W, best.nx), ys = cut(r.y0, H, best.ny), res = [];
      ys.forEach(function (yy) { xs.forEach(function (xx) { res.push({ x0: xx[0], x1: xx[1], y0: yy[0], y1: yy[1] }); }); });
      res.grid = true;
      return res;
    }
    return splitStrips(r, k, w);
  }
  function splitStrips(r, k, w) {
    var horiz = (r.x1 - r.x0) >= (r.y1 - r.y0);
    var L = horiz ? r.x1 - r.x0 + 1 : r.y1 - r.y0 + 1;
    k = Math.max(1, Math.min(k, Math.floor((L + 1) / 4)));      // петля не уже 0,3 м
    var use = L - (k - 1) * SLAB_GAP, out = [], pos = horiz ? r.x0 : r.y0;
    // длины полос по долям; каждая не уже 4 клеток, остаток — последней
    var lens = null;
    if (w && w.length === k) {
      lens = [];
      var left = use;
      for (var j = 0; j < k; j++) {
        var lj = j === k - 1 ? left : Math.max(4, Math.min(left - 4 * (k - 1 - j), Math.round(use * w[j])));
        lens.push(lj); left -= lj;
      }
      if (lens.some(function (v) { return v < 4; })) lens = null;
    }
    for (var i = 0; i < k; i++) {
      var len = lens ? lens[i] : Math.floor(use / k) + (i < use % k ? 1 : 0);
      out.push(horiz ? { x0: pos, x1: pos + len - 1, y0: r.y0, y1: r.y1 }
                     : { x0: r.x0, x1: r.x1, y0: pos, y1: pos + len - 1 });
      pos += len + SLAB_GAP;
    }
    return out;
  }

  /** Двоичная куча для поиска трассы */
  function Heap() { this.k = new Float64Array(1024); this.v = new Int32Array(1024); this.n = 0; }
  Heap.prototype.push = function (key, val) {
    // типизированные массивы с ростом вдвое: на больших этажах в куче сотни
    // тысяч состояний, обычные массивы с push/pop там были главным тормозом
    if (this.n === this.k.length) {
      var nk = new Float64Array(this.k.length * 2), nv = new Int32Array(this.v.length * 2);
      nk.set(this.k); nv.set(this.v); this.k = nk; this.v = nv;
    }
    var k = this.k, v = this.v, i = this.n++;
    k[i] = key; v[i] = val;
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      var t = k[p]; k[p] = k[i]; k[i] = t; t = v[p]; v[p] = v[i]; v[i] = t; i = p;
    }
  };
  Heap.prototype.pop = function () {
    var k = this.k, v = this.v, top = v[0], tk = k[0], n = --this.n;
    if (n) {
      k[0] = k[n]; v[0] = v[n];
      for (var i = 0; ;) {
        var l = 2 * i + 1, r = l + 1, m = i;
        if (l < n && k[l] < k[m]) m = l;
        if (r < n && k[r] < k[m]) m = r;
        if (m === i) break;
        var t = k[m]; k[m] = k[i]; k[i] = t; t = v[m]; v[m] = v[i]; v[i] = t; i = m;
      }
    }
    this.lastKey = tk;
    return top;
  };

  /**
   * Трассы от коллектора: Дейкстра по (клетка, направление) с ценой поворота —
   * трубу ведут прямо и вдоль стен. Источник один, поэтому трассы к разным
   * петлям сходятся в общий ствол — это и есть пучок.
   */
  // goal[k] — номер участка, если клетка k на его краю (иначе −1), nGoal —
  // сколько участков. Поиск останавливается, когда у каждого участка уже
  // разобрано состояние на краю и очередь ушла дальше самого дальнего из них:
  // всё, что разбирается позже, длиннее — на выбор ввода это не влияет, и
  // результат тот же, что у полного прохода, только без обхода всего этажа.
  function routeAll(g, cost, src, goal, nGoal) {
    var N = g.W * g.H, dist = new Float64Array(N * 4), prev = new Int32Array(N * 4), d;
    dist.fill(Infinity); prev.fill(-1);
    var DX = [1, 0, -1, 0], DY = [0, 1, 0, -1], h = new Heap();
    var reached = goal ? new Uint8Array(nGoal) : null, left = nGoal || 0, far = -Infinity;
    for (d = 0; d < 4; d++) { dist[src * 4 + d] = 0; h.push(0, src * 4 + d); }
    while (h.n) {
      var s = h.pop(), ds = h.lastKey;
      if (ds > dist[s]) continue;
      if (goal && !left && ds > far) break;
      var k = s >> 2, dir = s & 3, x = k % g.W, y = (k - x) / g.W;
      if (goal && goal[k] >= 0 && !reached[goal[k]]) { reached[goal[k]] = 1; left--; far = Math.max(far, ds); }
      for (d = 0; d < 4; d++) {
        if (d === ((dir + 2) & 3)) continue;
        var nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= g.W || ny >= g.H) continue;
        var nk = ny * g.W + nx, ns = nk * 4 + d;
        var nd = ds + cost[nk] + (d !== dir ? COST_TURN : 0);
        if (nd < dist[ns]) { dist[ns] = nd; prev[ns] = s; h.push(nd, ns); }
      }
    }
    return { dist: dist, prev: prev };
  }

  /** Направляющая улитки в своих координатах: первая сторона вдоль u */
  function spiralUV(Lu, Lv, p) {
    var x0 = 0, y0 = 0, x1 = Lu, y1 = Lv, pts = [[0, 0]], e = 1e-6;
    for (var it = 0; it < 400; it++) {
      pts.push([x1, y0]);
      if (y1 - y0 < p - e) break;
      pts.push([x1, y1]);
      if (x1 - x0 < p - e) break;
      pts.push([x0, y1]);
      if (y1 - (y0 + p) < p - e) break;
      pts.push([x0, y0 + p]);
      if ((x1 - p) - x0 < p - e) break;
      x0 += p; y0 += p; x1 -= p; y1 -= p;
    }
    return pts;
  }
  /** Направляющая змейки: ряды вдоль u через p */
  function snakeUV(Lu, Lv, p) {
    var pts = [], v = 0, fwd = true;
    for (var it = 0; it < 400 && v <= Lv + 1e-6; it++, v += p) {
      if (fwd) { pts.push([0, v]); pts.push([Lu, v]); } else { pts.push([Lu, v]); pts.push([0, v]); }
      fwd = !fwd;
    }
    return pts;
  }

  /**
   * Петля на прямоугольнике R (пиксели подложки): улитка или змейка, начало —
   * у угла, ближнего к вводу пучка. Наружная труба — в полшага от края
   * участка, соседние петли — через шаг, как на листах проектов.
   */
  function loopInRect(R, s, kind, entry) {
    if (kind === 'spiral') {
      var S = spiralS(R, s, entry);
      if (S) return S;                 // мала для S — встречной парой с разворотом
    }
    var gx0 = R[0] + s, gy0 = R[1] + s, gx1 = R[2] - s, gy1 = R[3] - s;
    var W = gx1 - gx0, H = gy1 - gy0;
    if (W < -1e-6 && H < -1e-6) return null;
    if (W < 0) { gx0 = gx1 = (R[0] + R[2]) / 2; W = 0; }
    if (H < 0) { gy0 = gy1 = (R[1] + R[3]) / 2; H = 0; }
    if (Math.max(W, H) < s) return null;
    var tr = H > W;                                   // первая сторона — вдоль длинной
    var Lu = tr ? H : W, Lv = tr ? W : H, p = 2 * s;
    var uv = kind === 'snake' ? snakeUV(Lu, Lv, p) : spiralUV(Lu, Lv, p);
    // угол старта — ближний к вводу
    var fx = entry ? Math.abs(entry[0] - gx1) < Math.abs(entry[0] - gx0) : false;
    var fy = entry ? Math.abs(entry[1] - gy1) < Math.abs(entry[1] - gy0) : false;
    var P = uv.map(function (q) {
      var dx = tr ? q[1] : q[0], dy = tr ? q[0] : q[1];
      return [fx ? gx1 - dx : gx0 + dx, fy ? gy1 - dy : gy0 + dy];
    });
    var sup = offsetOrtho(P, s / 2), ret = offsetOrtho(P, -s / 2);
    if (!sup || !ret) return null;
    return { guide: P, sup: sup, ret: ret.reverse(), kind: kind };
  }

  /**
   * Улитка с S-разворотом в центре — как на листах проектов.
   *
   * Подача (S1) закручивается внутрь, обратка — та же спираль, повёрнутая на
   * 180° вокруг центра (S2), идёт наружу между её витками. В центре они
   * сходятся двумя встречными разворотами — буквой S. Чтобы оба конца вышли
   * рядом, у ввода, спираль строится в рамке, расширенной на шаг с двух
   * сторон, а два крайних отрезка обратки (они как раз в этом расширении)
   * отрезаются. Витки одной трубы — через 2 шага, соседние трубы — через шаг,
   * крайние — в полшага от края участка.
   *
   * Ядро — три линии (S, поперёк 4k+2 трубы) или пять (двойное S, 4k+4):
   * так поперёк ложится любое чётное число труб, и пустого края остаётся не
   * больше одной трубы. Узко (меньше 6 труб) — null.
   */
  function spiralS(R, s, entry) {
    var tr = (R[3] - R[1]) > (R[2] - R[0]);
    var Wr = tr ? R[3] - R[1] : R[2] - R[0], Hr = tr ? R[2] - R[0] : R[3] - R[1];
    var c = Math.floor(Hr / s + 1e-6), use = c - (c % 2);
    var core5 = use % 4 === 0, k = core5 ? (use - 4) / 4 : (use - 2) / 4;
    if (k < 1) return null;
    // Рамка построения шире участка на полшага со стороны ввода: концы труб
    // встают ровно на край участка, а не в зазор к соседней петле (на корпусе
    // Galf ввод, выступавший на полшага, касался трубы соседа — 03.10.2026).
    // Крайняя труба с этой стороны — в шаге от края, с остальных — в полшага.
    var Wc = Wr + s / 2, Hc = (4 * k + (core5 ? 5 : 3)) * s;
    var v0 = (Hr - (use - 1) * s) / 2;                       // остаток — поровну к краям
    var fx = entry ? Math.abs(entry[0] - R[2]) < Math.abs(entry[0] - R[0]) : false;
    var fy = entry ? Math.abs(entry[1] - R[3]) < Math.abs(entry[1] - R[1]) : false;
    var map = function (q) {
      var u = q[0] - s / 2, v = v0 + (q[1] - s / 2);
      var dx = tr ? v : u, dy = tr ? u : v;
      return [fx ? R[2] - dx : R[0] + dx, fy ? R[3] - dy : R[1] + dy];
    };
    var h = s / 2, S1 = [[h, h]], i;
    for (i = 0; i <= k; i++) {
      S1.push([Wc - (h + 2 * s * i), h + 2 * s * i]);
      if (i === k) break;
      S1.push([Wc - (h + 2 * s * i), Hc - (3 * h + 2 * s * i)]);
      S1.push([3 * h + 2 * s * i, Hc - (3 * h + 2 * s * i)]);
      S1.push([3 * h + 2 * s * i, h + 2 * s * (i + 1)]);
    }
    var E1 = S1[S1.length - 1], xl = h + 2 * s * k, xr = E1[0], y = E1[1];
    if (xr - xl < s) return null;                      // центру не хватает длины
    // ядро: разворот вниз, назад, (ещё два разворота у пятилинейного) — к E2
    var core = core5
      ? [[xr, y + s], [xl, y + s], [xl, y + 2 * s], [xr, y + 2 * s], [xr, y + 3 * s], [xl, y + 3 * s]]
      : [[xr, y + s], [xl, y + s]];
    var mi = core5 ? 3 : 1;                             // середина ядра — граница подачи и обратки
    var M = [(core[mi - 1][0] + core[mi][0]) / 2, core[mi][1]];
    var S2 = S1.map(function (q) { return [Wc - q[0], Hc - q[1]]; }).slice(2);
    var sup = S1.concat(core.slice(0, mi), [M]).map(map);
    var ret = [M].concat(core.slice(mi), S2.reverse()).map(map);
    return { guide: [map([h, s])], sup: sup, ret: ret, kind: 'spiral' };
  }

  // ─── Улитка по контуру ─────────────────────────────────────────────────
  // Комната буквой Г режется на прямоугольники, и у каждого своя петля со
  // своей парой подводок; петли выходят разной длины (кухня-гостиная 46 и
  // 75 м, 03.10.2026). Здесь петля идёт по контуру самой комнаты: витки —
  // вложенные кольца контура через 2 шага, как у прямоугольной улитки, только
  // кольца Г-образные. Маска — растр с клеткой в треть шага; кольцо — граница
  // области «дальше k клеток от стены» (расстояние по Чебышёву — оно даёт
  // ортогональные кольца).

  /** Расстояние до края маски в клетках (по Чебышёву): 0 вне маски, 1 — у самого края. */
  function chebDepth(M, W, H) {
    var D = new Uint16Array(W * H), INF = 60000, x, y, i;
    for (i = 0; i < W * H; i++) D[i] = M[i] ? INF : 0;
    var at = function (xx, yy) { return xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : D[yy * W + xx]; };
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      i = y * W + x; if (!D[i]) continue;
      var m = Math.min(at(x - 1, y), at(x - 1, y - 1), at(x, y - 1), at(x + 1, y - 1)) + 1;
      if (m < D[i]) D[i] = m;
    }
    for (y = H - 1; y >= 0; y--) for (x = W - 1; x >= 0; x--) {
      i = y * W + x; if (!D[i]) continue;
      var m2 = Math.min(at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1)) + 1;
      if (m2 < D[i]) D[i] = m2;
    }
    return D;
  }

  /**
   * Границы области R (маска W×H): замкнутые контуры по часовой стрелке
   * (экранные координаты), область справа по ходу. Вершины — углы клеток.
   * Диагонально касающиеся клетки не склеиваются: на стыке берётся правый
   * поворот. Внешние контуры — с положительной площадью, дыры — с отрицательной.
   */
  function regionLoops(R, W, H) {
    var DX = [1, 0, -1, 0], DY = [0, 1, 0, -1], edges = [], from = {}, x, y, i;
    var vk = function (px, py) { return py * (W + 1) + px; };
    var add = function (ax, ay, d) {
      var e = { ax: ax, ay: ay, bx: ax + DX[d], by: ay + DY[d], d: d, used: false };
      var k = vk(ax, ay);
      (from[k] = from[k] || []).push(edges.length); edges.push(e);
    };
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (!R[y * W + x]) continue;
      if (y === 0 || !R[(y - 1) * W + x]) add(x, y, 0);
      if (x === W - 1 || !R[y * W + x + 1]) add(x + 1, y, 1);
      if (y === H - 1 || !R[(y + 1) * W + x]) add(x + 1, y + 1, 2);
      if (x === 0 || !R[y * W + x - 1]) add(x, y + 1, 3);
    }
    var loops = [];
    for (i = 0; i < edges.length; i++) {
      if (edges[i].used) continue;
      var pts = [], e = edges[i], guard = 0;
      while (e && !e.used && guard++ < 200000) {
        e.used = true; pts.push([e.ax, e.ay]);
        var cand = from[vk(e.bx, e.by)] || [], nx = null, pref = [1, 0, 3, 2];
        for (var q = 0; q < pref.length && !nx; q++) {
          var want = (e.d + pref[q]) & 3;
          for (var c = 0; c < cand.length; c++) if (!edges[cand[c]].used && edges[cand[c]].d === want) { nx = edges[cand[c]]; break; }
        }
        e = nx;
      }
      if (pts.length < 4) continue;
      var a = 0;
      for (var j = 0, n = pts.length; j < n; j++) { var p1 = pts[j], p2 = pts[(j + 1) % n]; a += p1[0] * p2[1] - p2[0] * p1[1]; }
      loops.push({ pts: pts, area: a / 2 });
    }
    return loops;
  }

  /** Убрать вершины на прямых и нулевые звенья. */
  function collapseLoop(P) {
    var out = P.slice(), ch = true;
    while (ch && out.length > 3) {
      ch = false;
      for (var i = 0; i < out.length; i++) {
        var a = out[(i + out.length - 1) % out.length], b = out[i], c = out[(i + 1) % out.length];
        var cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if ((a[0] === b[0] && a[1] === b[1]) || cross === 0) { out.splice(i, 1); ch = true; break; }
      }
    }
    return out;
  }

  /**
   * Направляющая улитки по контуру маски M (W×H клеток размером r пикселей,
   * угол клетки (0,0) — org). s — шаг трубы, пиксели; entry — точка ввода или
   * null. Возвращает { guide, rings, covered } или null (форма не годится:
   * дыры, несколько кусков, узко, кольцам не за что зацепиться).
   */
  function contourGuide(M, W, H, r, org, s, entry, pick) {
    var n0 = Math.round(s / r), pc = 2 * n0, p = pc * r;           // p — расстояние между витками
    if (n0 < 2) return null;
    // кольца от начала витка не зависят — при переборе начал (pick) берём готовые
    var memo = contourGuide.memo, rings, i;
    if (memo && memo.M === M && memo.W === W && memo.H === H && memo.n0 === n0) {
      if (memo.fail) return null;
      rings = memo.rings;
    } else {
    var D = chebDepth(M, W, H), maxD = 0;
    for (i = 0; i < D.length; i++) if (D[i] > maxD) maxD = D[i];
    var thr = function (k) { var R = new Uint8Array(W * H); for (var q = 0; q < R.length; q++) R[q] = D[q] >= k ? 1 : 0; return R; };
    rings = [];
    var k = n0 + 1;
    for (var j = 0; j < 40; j++, k += pc) {
      // кольцо годится, пока стороны шире p (две трубы витка не должны сойтись);
      // уже, но не пусто — остаётся тонкое ядро: по нему пройдёт одна прямая
      // (как у прямоугольной улитки: последний виток вырождается в линию)
      var thin = maxD < k + n0 - 1;
      if (maxD < k) break;
      var loops = regionLoops(thr(k), W, H), outer = null, rest = 0, holes = 0;
      loops.forEach(function (L) { if (L.area > 0) { if (!outer || L.area > outer.area) { if (outer) rest += outer.area; outer = L; } else rest += L.area; } else holes++; });
      if (!outer) break;
      if (holes && j === 0) { contourGuide.memo = { M: M, W: W, H: H, n0: n0, fail: true }; return null; }   // место без обогрева внутри — улитка по контуру не годится
      if (rest > 0.12 * outer.area) { if (j === 0) { contourGuide.memo = { M: M, W: W, H: H, n0: n0, fail: true }; return null; } break; }   // форма распалась на куски
      var ring = collapseLoop(outer.pts);
      if (ring.length < 4) break;
      if (thin && j === 0) { contourGuide.memo = { M: M, W: W, H: H, n0: n0, fail: true }; return null; }   // сама зона уже витка — улитка не нужна
      rings.push({ V: ring, area: outer.area, thin: thin });
      if (thin) break;
    }
    contourGuide.memo = { M: M, W: W, H: H, n0: n0, rings: rings, fail: !rings.length };
    }
    if (!rings.length) return null;

    var cell = function (v) { return [org[0] + v[0] * r, org[1] + v[1] * r]; };
    var len = function (a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); };
    var cross3 = function (a, b, c) { return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]); };
    // Начало: выпуклый угол внешнего кольца, ближний к вводу, и направление
    // обхода такое, чтобы последнее звено (в начало) было не короче p: по нему
    // виток замыкается, а следующий начинается в p внутрь от его конца.
    var R0 = rings[0].V, n = R0.length, best = null, cands = [];
    for (var ci = 0; ci < n; ci++) {
      if (cross3(R0[(ci + n - 1) % n], R0[ci], R0[(ci + 1) % n]) <= 0) continue;   // у кольца по часовой выпуклый — поворот направо (>0)
      for (var dir = 1; dir >= -1; dir -= 2) {
        var prev = R0[(ci - dir + n) % n], nxt = R0[(ci + dir + n) % n];
        var lastL = len(prev, R0[ci]) * r, firstL = len(R0[ci], nxt) * r;
        // Обе стороны угла не короче витка: начало в ступеньке контура (след
        // подводки, колонна) давало на каждом витке излом у самого перехода
        if (lastL < p - 1e-6 || firstL < p - 1e-6) continue;
        // Продолжение витка должно существовать: точка на p внутрь от конца витка
        // обязана быть вершиной следующего кольца. У комнаты с узким плечом
        // следующее кольцо плеча уже не содержит — начало в плече обрывало улитку.
        if (rings.length > 1) {
          var Sp = cell(R0[ci]), Pp = cell(prev), uxl = Sp[0] - Pp[0], uyl = Sp[1] - Pp[1], ull = Math.hypot(uxl, uyl) || 1;
          uxl /= ull; uyl /= ull;
          var nrx = -uyl * dir, nry = uxl * dir;
          var Tt = [Sp[0] - uxl * p + nrx * p, Sp[1] - uyl * p + nry * p], okT = false;
          rings[1].V.forEach(function (v1) { if (len(cell(v1), Tt) <= 1.5 * r) okT = true; });
          if (!okT) continue;
        }
        // при обходе против часовой выпуклость меняет знак — угол всё равно выпуклый
        var d = entry ? len(cell(R0[ci]), entry) : 0;
        var score = d - (firstL > lastL ? 0.01 * p : 0);
        cands.push({ ci: ci, dir: dir, score: score });
      }
    }
    // pick — какое по порядку начало брать: первое по близости к вводу не всегда
    // даёт чистый виток, вызывающий пробует следующие
    cands.sort(function (a, b) { return a.score - b.score; });
    best = cands[pick || 0];
    if (!best) return null;
    var guide = [], dirSign = best.dir, start = best.ci, S = null;
    for (var rj = 0; rj < rings.length; rj++) {
      var V = rings[rj].V, m = V.length, si;
      if (rj === 0) si = start;
      else {
        // следующее кольцо начинается там, где предыдущий виток закончился (T)
        var T = S.target, bd = Infinity; si = -1;
        for (var vi = 0; vi < m; vi++) { var dd = len(cell(V[vi]), T); if (dd < bd) { bd = dd; si = vi; } }
        if (si < 0 || bd > 0.6 * p) break;
        // у нового кольца последнее звено должно быть не короче p (тонкое ядро идёт одной прямой — ему не нужно)
        var pv = V[(si - dirSign + m) % m];
        if (!rings[rj].thin && len(pv, V[si]) * r < p - 1e-6) break;
      }
      var pts = [cell(V[si])];
      if (rings[rj].thin) {
        // ядро: одна прямая по первой стороне (по длинной, если начало выбрано верно)
        pts.push(cell(V[((si + dirSign) % m + m) % m]));
        if (len(pts[0], pts[1]) < 0.5 * s) { if (rj > 0) { /* крошечное ядро — без него */ } break; }
        if (guide.length) guide.push(pts[0]);
        for (var tp = 0; tp < pts.length; tp++) guide.push(pts[tp]);
        break;
      }
      // обход кольца от si до точки E за p до возврата в si
      for (var step = 1; step <= m; step++) pts.push(cell(V[((si + dirSign * step) % m + m) % m]));
      // pts заканчивается снова в V[si]; обрезаем последние p по длине
      var cut = p, L2 = pts.length - 1;
      while (L2 > 0 && cut > 0) {
        var sl = len(pts[L2 - 1], pts[L2]);
        if (sl > cut + 1e-6) {
          var t = (sl - cut) / sl;
          pts[L2] = [pts[L2 - 1][0] + (pts[L2][0] - pts[L2 - 1][0]) * t, pts[L2 - 1][1] + (pts[L2][1] - pts[L2 - 1][1]) * t];
          cut = 0; break;
        }
        cut -= sl; pts.length = L2; L2--;
      }
      if (guide.length && pts.length) guide.push(pts[0]);               // перескок на следующий виток
      for (var pi = 0; pi < pts.length; pi++) guide.push(pts[pi]);
      // цель для следующего кольца: конец витка + p внутрь
      var E = pts[pts.length - 1], Pm = pts[pts.length - 2] || E, ux = E[0] - Pm[0], uy = E[1] - Pm[1], ul = Math.hypot(ux, uy) || 1;
      ux /= ul; uy /= ul;
      var nxr = -uy, nyr = ux;                                         // справа по ходу (экран: y вниз)
      if (dirSign < 0) { nxr = -nxr; nyr = -nyr; }                      // против часовой — внутрь слева
      S = { target: [E[0] + nxr * p, E[1] + nyr * p] };
    }
    // убрать повторные точки; перескок между витками — ортогональный
    var G = [guide[0]];
    for (i = 1; i < guide.length; i++) {
      var a = G[G.length - 1], b = guide[i];
      if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) continue;
      G.push(b);
    }
    return { guide: orthoPath(G), rings: rings.length, cands: cands.length };
  }

  /** Отрезки пучка: клетки трасс → прямые участки с числом петель в них */
  function bundleSegs(g, paths) {
    var cnt = {}, last = {}, i, j;
    paths.forEach(function (P) {
      for (j = 1; j < P.cells.length; j++) {
        var a = P.cells[j - 1], b = P.cells[j], key = Math.min(a, b) + ':' + Math.max(a, b);
        cnt[key] = (cnt[key] || 0) + 1;
        if (j === P.cells.length - 1) last[key] = P.loop;   // ввод в свою петлю
      }
    });
    var runs = {};
    Object.keys(cnt).forEach(function (key) {
      var ab = key.split(':'), a = +ab[0], b = +ab[1], n = cnt[key];
      var hz = b - a === 1, line = hz ? Math.floor(a / g.W) : a % g.W, pos = hz ? a % g.W : Math.floor(a / g.W);
      var rk = (hz ? 'h' : 'v') + line + ':' + n;
      (runs[rk] = runs[rk] || []).push(pos);
    });
    var segs = [];
    Object.keys(runs).forEach(function (rk) {
      var hz = rk[0] === 'h', parts = rk.slice(1).split(':'), line = +parts[0], n = +parts[1];
      var ps = runs[rk].sort(function (x, y) { return x - y; });
      for (i = 0; i < ps.length; i = j) {
        for (j = i + 1; j < ps.length && ps[j] === ps[j - 1] + 1; j++) { /* сплошной отрезок */ }
        var a0 = hz ? line * g.W + ps[i] : ps[i] * g.W + line;
        var a1 = hz ? line * g.W + ps[j - 1] + 1 : (ps[j - 1] + 1) * g.W + line;
        var sg = { a: cellXY(g, a0), b: cellXY(g, a1), n: n };
        if (n === 1) {                                    // одна труба и кончается вводом — своя подводка петли
          for (var t = i; t < j; t++) {
            var k0 = hz ? line * g.W + ps[t] : ps[t] * g.W + line, key0 = k0 + ':' + (hz ? k0 + 1 : k0 + g.W);
            if (last[key0]) { sg.own = last[key0]; break; }
          }
        }
        segs.push(sg);
      }
    });
    // вводы: от коллектора к первой клетке и от последней клетки к началу петли
    paths.forEach(function (P) {
      if (P.head) segs.push({ a: P.head[0], b: P.head[1], n: P.headN || 1 });
      for (j = 1; j < P.tail.length; j++) segs.push({ a: P.tail[j - 1], b: P.tail[j], n: 1, own: P.loop });
    });
    return segs;
  }

  /**
   * Петли тёплого пола этажа — общий расчёт листа, сметы и редактора.
   * [{ i, name, area, perim, est, loops: [{sup, ret, lenM, m, kind, lead}] }],
   * у массива — .bundle: отрезки пучка подводок [{a, b, n}] для рисования.
   * est=true — геометрия не построилась (узкая зона), длины оценены по
   * площади; лист рисует такую зону встречной змейкой по габариту.
   */
  var loopsCache = [];
  function floorLoops(f, stepMm, maxLenM) {
    var out = [];
    out.bundle = [];
    if (!f || !f.pxPerM) return out;
    var lim = maxLenM || loopLimit(stepMm);
    var zs = (f.zones || []).map(function (z, i) { return { z: z, i: i }; })
      .filter(function (Z) { return Z.z.type === 'tp' && Z.z.pts && Z.z.pts.length >= 3; });
    if (!zs.length) return out;
    var key = JSON.stringify([f.pxPerM, f.coll || null, usableLeads(f), stepMm, lim,
      zs.map(function (Z) { return [Z.i, Z.z.pts, Z.z.lay || '', Z.z.name || '']; }),
      (f.zones || []).filter(function (z) { return z.type === 'cold'; }).map(function (z) { return z.pts; })]);
    for (var ci = 0; ci < loopsCache.length; ci++) if (loopsCache[ci].key === key) return loopsCache[ci].val;
    var val = layFloor(f, zs, stepMm, lim);
    loopsCache.unshift({ key: key, val: val });
    if (loopsCache.length > 6) loopsCache.pop();
    return val;
  }

  function layFloor(f, zs, stepMm, lim) {
    var out = [];
    out.bundle = [];
    var ppm = f.pxPerM, s = stepMm / 1000 * ppm;
    var g = floorGrid(f, zs.map(function (Z) { return Z.z; }));
    var N = g ? g.W * g.H : 0;
    // Места без обогрева (лестница, колонна, ванна, встроенный шкаф) —
    // зоны типа 'cold' поверх тёплого пола: петли их обходят, пучок тоже.
    if (g) {
      g.cold = new Uint8Array(N);
      (f.zones || []).forEach(function (z) {
        if (z.type !== 'cold' || !z.pts || z.pts.length < 3) return;
        polyCells(g, z.pts, function (k) { g.cold[k] = 1; });
      });
    }
    // клетки зон: чей центр внутри полигона (последняя зона главнее)
    var own = g ? new Int32Array(N) : null, info = {};
    if (g) zs.forEach(function (Z) {
      var n = 0, all = 0;
      var B = polyCells(g, Z.z.pts, function (k) {
        all++;
        if (g.cold[k]) return;
        own[k] = Z.i + 1; n++;
      });
      info[Z.i] = { bb: B, cells: n, all: all };
    });
    if (g) g.wallD = wallDist(g, own);
    // прямоугольники зон и сколько петель на каждый
    var decompose = function (mask) {
      zs.forEach(function (Z) {
        var n = 0;
        if (mask !== own) for (var k = 0; k < N; k++) if (mask[k] === Z.i + 1) n++;
        info[Z.i].rects = zoneRects(g, mask, Z.i, info[Z.i].bb, mask === own ? info[Z.i].cells : n, stepMm / 1000);
        info[Z.i].k = info[Z.i].rects.map(function (r) {
          var a = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) * CELL_M * CELL_M;
          var cx = (r.x0 + r.x1) / 2 * g.c + g.ox, cy = (r.y0 + r.y1) / 2 * g.c + g.oy;
          var lead = f.coll ? (Math.abs(cx - f.coll.x) + Math.abs(cy - f.coll.y)) / ppm : 0;
          return Math.max(1, Math.ceil((a / (stepMm / 1000) * 1.05 + 2 * lead) / lim));
        });
      });
    };
    // Пробовали (03.10.2026) разбивать комнаты заново в обход прохода пучка,
    // найденного первой прикидкой, — покрытие упало с 81 до 75 %: проход
    // вырезался дважды. Разбиение — одно, проход вырезается при раскладке.
    if (g) { g.lay = layable(f, g, zs, own, s); decompose(g.lay); }
    // Комната буквой Г и подобные: если по контуру хватит не больше петель,
    // чем по прямоугольникам, петли идут по контуру комнаты (polyLoop)
    var revertPoly = function (zi) {
      var I = info[zi];
      if (!I || !I.poly) return;
      I.rects = I.polyBackup.rects; I.k = I.polyBackup.k; I.poly = null; I.w = null;
    };
    if (g && POLY_ON) zs.forEach(function (Z) {
      var I = info[Z.i];
      if (I.rects.length < 2 || I.rects.length > 3 || I.cells * CELL_M * CELL_M > POLY_MAX_M2) return;
      var cells = [], X0 = 1e9, X1 = -1, Y0 = 1e9, Y1 = -1, x, y, c;
      for (y = I.bb[1]; y <= I.bb[3]; y++) for (x = I.bb[0]; x <= I.bb[2]; x++) {
        c = y * g.W + x;
        if (g.lay[c] !== Z.i + 1) continue;
        cells.push(c);
        if (x < X0) X0 = x; if (x > X1) X1 = x; if (y < Y0) Y0 = y; if (y > Y1) Y1 = y;
      }
      var kp = Math.max(1, Math.ceil(cells.length * CELL_M * CELL_M / (stepMm / 1000) * 1.05 / lim));
      var kr = I.k.reduce(function (a, v) { return a + v; }, 0);
      if (kp > kr) return;
      I.polyBackup = { rects: I.rects, k: I.k };
      I.polyTried = true;
      I.poly = { cells: cells };
      I.rects = [{ x0: X0, x1: X1, y0: Y0, y1: Y1, area: (X1 - X0 + 1) * (Y1 - Y0 + 1) }];
      I.k = [kp];
    });
    var res = null;
    for (var round = 0; round < 8 && g; round++) {
      res = layRound(f, g, own, zs, info, s, lim);
      var failed = Object.keys(res.polyFail || {});
      if (failed.length) { failed.forEach(function (zi) { revertPoly(+zi); }); round--; continue; }
      // Петля длиннее предела — у её участка больше петель: сразу во столько
      // раз, во сколько перебор (огромный зал за один проход, а не по одной).
      var grow = false;
      zs.forEach(function (Z) {
        var worst = {};
        (res.byZone[Z.i] || []).forEach(function (lp) { worst[lp.ri] = Math.max(worst[lp.ri] || 0, lp.lenM); });
        Object.keys(worst).forEach(function (ri) {
          if (worst[ri] <= lim) return;
          var k0 = info[Z.i].k[ri];
          info[Z.i].k[ri] = Math.max(k0 + 1, Math.ceil(k0 * worst[ri] / lim));
          grow = true;
        });
      });
      if (!grow) break;
    }
    if (res) res = balanceLoops(f, g, own, zs, info, s, lim, res);
    // выравнивание могло привести к отказу контура в куске — тогда зона на прямоугольники
    if (res && Object.keys(res.polyFail || {}).length) {
      Object.keys(res.polyFail).forEach(function (zi) { revertPoly(+zi); });
      res = layRound(f, g, own, zs, info, s, lim);
    }
    zs.forEach(function (Z) {
      // площадь обогрева — без мест «без обогрева» внутри зоны
      var I = info[Z.i], S = areaM2(Z.z, f) * (I && I.all ? I.cells / I.all : 1);
      var lp = res && res.byZone[Z.i] && res.byZone[Z.i].length ? res.byZone[Z.i] : null;
      if (!lp) {
        // Оценка по площади: та же формула, что в смете без планов.
        var est = S / (stepMm / 1000) * 1.05, k = Math.max(1, Math.ceil(est / lim));
        lp = [];
        for (var j = 0; j < k; j++) lp.push({ lenM: est / k, m: Math.max(5, Math.round(est / k)) });
      }
      out.push({ i: Z.i, name: Z.z.name || '', area: S, perim: perimM(Z.z, f), est: !lp[0].sup, loops: lp });
    });
    if (res) out.bundle = res.bundle;
    // сколько зон пробовали вести по контуру и сколько осталось (стенды)
    out.polyTried = zs.filter(function (Z) { return info[Z.i].polyTried; }).length;
    out.polyUsed = zs.filter(function (Z) { return info[Z.i].poly; }).length;
    return out;
  }

  /**
   * Клетки зоны, куда можно класть петли: не ближе WALL_OFFSET_M трубы к стене
   * (контуру зоны) и к месту без обогрева. Крайняя труба участка — в полшага
   * от его края, край участка — до полклетки от центра клетки, поэтому центр
   * клетки должен отстоять от стены на WALL_OFFSET − шаг/2 + полклетки.
   * Так на листе напечатано «отступ контуров от стен 100 мм» — так и кладём.
   * Сама зона (площадь, проход пучка) остаётся целой.
   */
  var WALL_OFFSET_M = 0.1;
  function layable(f, g, zs, own, s) {
    var N = g.W * g.H, lay = new Int32Array(own);
    var need = (WALL_OFFSET_M - s / g.ppm / 2 + CELL_M / 2) * g.ppm;   // px
    if (need <= 0) return lay;
    var colds = (f.zones || []).filter(function (z) { return z.type === 'cold' && z.pts && z.pts.length > 2; });
    var segDist = function (p, a, b) {
      var dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
      var t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    };
    var near = function (p, P) {
      for (var i = 0, j = P.length - 1; i < P.length; j = i++) if (segDist(p, P[j], P[i]) < need) return true;
      return false;
    };
    zs.forEach(function (Z) {
      var bb = bbox(Z.z.pts), c0 = cellAt(g, [bb[0], bb[1]]), c1 = cellAt(g, [bb[2], bb[3]]), x, y;
      for (y = Math.floor(c0 / g.W); y <= Math.floor(c1 / g.W); y++)
        for (x = c0 % g.W; x <= c1 % g.W; x++) {
          var k = y * g.W + x;
          if (own[k] !== Z.i + 1) continue;
          var p = cellXY(g, k);
          if (near(p, Z.z.pts) || colds.some(function (c) { return near(p, c.pts); })) lay[k] = 0;
        }
    });
    return lay;
  }

  /**
   * Сторона участка — вплотную к тому, что за ней: крайняя труба в 100 мм от
   * стены или в BUNDLE_CLEAR_M от края пучка подводок. Сетка в 10 см ставила
   * её где-то между 100 и 200 мм от стены и на клетку дальше нужного от пучка:
   * в маленькой комнате это до четверти площади. Стена — ребро контура зоны
   * (или места без обогрева) по оси, параллельное стороне, напротив неё; пучок —
   * полоса шириной как на листе. Ближайшее из них не дальше 0,3 м задаёт
   * сторону; наружу — только по клеткам этой же зоны.
   */
  var BUNDLE_CLEAR_M = 0.03;
  function snapToWalls(Rp, r, sl, id, g, own, boxes, s, f, entry) {
    var e = 1e-6, reach = 0.3 * g.ppm, h = s / 2;
    // сторона ввода — короткая, ближняя к подводке (как в loopInRect): концы
    // труб там доходят до самой стороны, отступ от стены считаем от неё
    var tall = Rp[3] - Rp[1] > Rp[2] - Rp[0], entrySide = -1;
    if (entry) entrySide = tall ? (Math.abs(entry[1] - Rp[3]) < Math.abs(entry[1] - Rp[1]) ? 3 : 1)
      : (Math.abs(entry[0] - Rp[2]) < Math.abs(entry[0] - Rp[0]) ? 2 : 0);
    var wallOff = WALL_OFFSET_M * g.ppm, clr = BUNDLE_CLEAR_M * g.ppm;
    var walls = [sl.z.pts].concat((f.zones || []).filter(function (z) { return z.type === 'cold' && z.pts && z.pts.length > 2; })
      .map(function (z) { return z.pts; }));
    var inZone = function (x0, x1, y0, y1) {
      for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
        if (x < 0 || y < 0 || x >= g.W || y >= g.H || own[y * g.W + x] !== sl.zi + 1) return false;
      }
      return true;
    };
    // сторона: 0 лево, 1 верх, 2 право, 3 низ; труба — в полшага внутрь от стороны
    for (var side = 0; side < 4; side++) {
      var vert = side === 0 || side === 2, cur = Rp[side], lo = vert ? Rp[1] : Rp[0], hi = vert ? Rp[3] : Rp[2];
      var dir = side < 2 ? -1 : 1, pipe = cur - dir * h, target = null;
      // edge — край препятствия, need — сколько до трубы, inset — труба от стороны
      var take = function (edge, need, inset) {
        var gap = (edge - cur) * dir;
        if (gap > reach || (edge - pipe) * dir < -h) return;   // далеко или уже внутри участка
        var t = edge - dir * (need - inset);
        if (target === null || (t - target) * dir < 0) target = t;
      };
      // Стена — лучами наружу через каждые 5 см вдоль стороны: контур с растра
      // ступенчатый и чуть косой, параллельного ребра у него может не быть.
      // Стена должна стоять вдоль всей стороны: хоть один луч ушёл дальше 0,3 м —
      // там продолжается комната (соседний участок), сторону не трогаем.
      var nS = Math.max(2, Math.ceil((hi - lo) / (0.05 * g.ppm))), wall = Infinity, open = false;
      for (var si = 0; si <= nS && !open; si++) {
        var u = lo + (hi - lo) * (0.02 + 0.96 * si / nS), hit = Infinity;
        walls.forEach(function (P) {
          for (var i = 0, j = P.length - 1; i < P.length; j = i++) {
            var a = P[j], b = P[i];
            var au = vert ? a[1] : a[0], bu = vert ? b[1] : b[0];
            if ((au > u) === (bu > u)) continue;
            var av = vert ? a[0] : a[1], bv = vert ? b[0] : b[1];
            var v = av + (bv - av) * (u - au) / (bu - au), t = (v - cur) * dir;
            if (t > -h && t < hit) hit = t;
          }
        });
        if (hit > reach) open = true; else if (hit < wall) wall = hit;
      }
      if (open || wall === Infinity) continue;        // стены вдоль стороны нет — не трогаем
      take(cur + dir * wall, wallOff, side === entrySide ? 0 : h);
      if (target === null) continue;
      boxes.forEach(function (B) {
        if (B.own === id) return;                     // свой ввод участку не мешает
        var s0 = vert ? B.b[1] : B.b[0], s1 = vert ? B.b[3] : B.b[2];
        if (Math.min(s1, hi) - Math.max(s0, lo) <= e) return;
        // концы улитки со стороны ввода доходят до самой стороны участка
        take(dir < 0 ? (vert ? B.b[2] : B.b[3]) : (vert ? B.b[0] : B.b[1]), clr, 0);
      });
      if ((target - cur) * dir > e) {
        // наружу: полоса между стороной и новой границей — клетки этой же зоны
        var c0, c1, ok;
        if (vert) {
          c0 = Math.floor((Math.min(target, cur) - g.ox) / g.c + e); c1 = Math.ceil((Math.max(target, cur) - g.ox) / g.c - e) - 1;
          ok = inZone(c0, c1, r.y0, r.y1);
        } else {
          c0 = Math.floor((Math.min(target, cur) - g.oy) / g.c + e); c1 = Math.ceil((Math.max(target, cur) - g.oy) / g.c - e) - 1;
          ok = inZone(r.x0, r.x1, c0, c1);
        }
        if (!ok) continue;
      }
      Rp[side] = target;                              // внутрь — если труба ближе положенного
    }
  }

  /** Полосы пучка по клеткам трасс — как их нарисует лист (BUNDLE_DRAW_M на трубу) */
  function bundleBoxes(g, paths) {
    var cnt = {}, last = {}, out = [];
    paths.forEach(function (P) {
      if (!P) return;
      for (var j = 1; j < P.cells.length; j++) {
        var key = Math.min(P.cells[j - 1], P.cells[j]) + ':' + Math.max(P.cells[j - 1], P.cells[j]);
        cnt[key] = (cnt[key] || 0) + 1;
        if (j === P.cells.length - 1) last[key] = P.id;   // ввод в участок
      }
    });
    Object.keys(cnt).forEach(function (key) {
      var ab = key.split(':'), a = cellXY(g, +ab[0]), b = cellXY(g, +ab[1]);
      var hw = cnt[key] * BUNDLE_DRAW_M * g.ppm;
      out.push({ own: cnt[key] === 1 && last[key] !== undefined ? last[key] : -1,
        b: [Math.min(a[0], b[0]) - hw, Math.min(a[1], b[1]) - hw, Math.max(a[0], b[0]) + hw, Math.max(a[1], b[1]) + hw] });
    });
    return out;
  }

  /**
   * Расстояние клетки зоны до её стены, клеток (0 — клетка у самой стены): волна
   * от клеток, у которых сосед — чужая зона, место без обогрева или улица.
   * Нужно трассе: проектировщики ведут подводки вдоль стен и по коридорам, а
   * середину комнаты оставляют петлям.
   */
  function wallDist(g, own) {
    var N = g.W * g.H, D = new Uint8Array(N).fill(255), q = new Int32Array(N), h = 0, t = 0, k;
    for (k = 0; k < N; k++) {
      if (!own[k]) continue;
      var x = k % g.W, y = (k - x) / g.W, o = own[k];
      if (x === 0 || y === 0 || x === g.W - 1 || y === g.H - 1 ||
        own[k - 1] !== o || own[k + 1] !== o || own[k - g.W] !== o || own[k + g.W] !== o) { D[k] = 0; q[t++] = k; }
    }
    while (h < t) {
      k = q[h++];
      var nb = [k - 1, k + 1, k - g.W, k + g.W];
      for (var i = 0; i < 4; i++) {
        var m = nb[i];
        if (m < 0 || m >= N || own[m] !== own[k] || D[m] !== 255 || D[k] >= 254) continue;
        if ((i < 2) && Math.floor(m / g.W) !== Math.floor(k / g.W)) continue;   // перенос строки
        D[m] = D[k] + 1; q[t++] = m;
      }
    }
    return D;
  }

  /**
   * Петли одного участка — одной длины. Участок режется на полосы поровну по
   * площади, а подводки у полос разной длины: дальняя петля выходила длиннее
   * ближней (кабинет — 73 и 81 м), а если пучок резал полосу — и вдвое короче
   * («Гостиная 1/2» 21,8 м против 56,3 м, 03.10.2026). Проектировщики делают
   * петли комнаты равными — так их проще уравновесить на коллекторе.
   *
   * Доли полос меняем так, чтобы длина «петля + две подводки» сравнялась, и
   * раскладываем заново. Новый вариант берём, только если разброс по
   * участкам уменьшился и ни одна петля не стала длиннее предела.
   */
  var BALANCE_FROM = 1.08;       // разброс длин в участке, с которого ровняем

  /**
   * Сколько раз пучок подводок ложится на чужие петли — та же проверка, что
   * у стендов (bench/ufh_sheet.js): полоса вокруг оси шириной по числу труб
   * против отрезков петель. Свой ввод петли — не наложение.
   */
  function bundleOnLoops(R, ppm) {
    var loops = [];
    Object.keys(R.byZone || {}).forEach(function (zi) {
      (R.byZone[zi] || []).forEach(function (l) {
        if (!l.sup) return;
        var xs = [], ys = [];
        l.sup.concat(l.ret).forEach(function (p) { xs.push(p[0]); ys.push(p[1]); });
        loops.push({ l: l, bb: [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)] });
      });
    });
    var hits = 0;
    (R.bundle || []).forEach(function (sg) {
      var hw = (sg.n || 1) * 0.02 * ppm;
      var bx = [Math.min(sg.a[0], sg.b[0]) - hw, Math.min(sg.a[1], sg.b[1]) - hw, Math.max(sg.a[0], sg.b[0]) + hw, Math.max(sg.a[1], sg.b[1]) + hw];
      loops.forEach(function (L) {
        if (sg.own === L.l || L.bb[0] > bx[2] || L.bb[2] < bx[0] || L.bb[1] > bx[3] || L.bb[3] < bx[1]) return;
        [L.l.sup, L.l.ret].forEach(function (P) {
          for (var i = 1; i < P.length; i++) {
            var a = P[i - 1], b = P[i];
            if (Math.max(a[0], b[0]) > bx[0] && Math.min(a[0], b[0]) < bx[2] && Math.max(a[1], b[1]) > bx[1] && Math.min(a[1], b[1]) < bx[3]) hits++;
          }
        });
      });
    });
    return hits;
  }
  function balanceLoops(f, g, own, zs, info, s, lim, res) {
    var worstSpread = function (R) {
      var w = 1, over = false;
      zs.forEach(function (Z) {
        var byR = {};
        (R.byZone[Z.i] || []).forEach(function (lp) {
          (byR[lp.ri] = byR[lp.ri] || []).push(lp.lenM);
          if (lp.lenM > lim + 0.5) over = true;
        });
        Object.keys(byR).forEach(function (ri) {
          var L = byR[ri];
          if (L.length > 1) w = Math.max(w, Math.max.apply(null, L) / Math.min.apply(null, L));
        });
      });
      return over ? Infinity : w;
    };
    var sumSpread = function (R) {
      var t = 0;
      zs.forEach(function (Z) {
        var byR = {};
        (R.byZone[Z.i] || []).forEach(function (lp) { (byR[lp.ri] = byR[lp.ri] || []).push(lp.lenM); });
        Object.keys(byR).forEach(function (ri) {
          var L = byR[ri];
          if (L.length > 1) t += Math.max.apply(null, L) / Math.min.apply(null, L) - 1;
        });
      });
      return t;
    };
    for (var pass = 0; pass < 3; pass++) {
      var saved = [], changed = false;
      zs.forEach(function (Z) {
        var I = info[Z.i];
        saved.push(I.w ? I.w.slice() : null);
        var byR = {};
        (res.byZone[Z.i] || []).forEach(function (lp) { (byR[lp.ri] = byR[lp.ri] || []).push(lp); });
        Object.keys(byR).forEach(function (ri) {
          var L = byR[ri], k = I.k[ri];
          if (L.length < 2 || L.length !== k) return;
          if (!I.poly && splitRect(I.rects[ri], k).grid) return;       // сетку плиток не ровняем
          var lens = L.map(function (l) { return l.lenM; });
          if (Math.max.apply(null, lens) / Math.min.apply(null, lens) < BALANCE_FROM) return;
          L.sort(function (a, b) { return a.ti - b.ti; });
          if (L.some(function (l, j) { return l.ti !== j; })) return;
          var T = lens.reduce(function (a, v) { return a + v; }, 0) / k;
          var cur = (I.w && I.w[ri]) || L.map(function () { return 1 / k; });
          var nw = L.map(function (l, j) {
            var lead = (l.lenM - l.loopM) / 2, want = Math.max(0.3 * l.loopM, T - 2 * lead);
            return cur[j] * want / Math.max(1e-6, l.loopM);
          });
          var sum = nw.reduce(function (a, v) { return a + v; }, 0);
          nw = nw.map(function (v) { return Math.max(0.5 / k, Math.min(1.6 / k, v / sum)); });
          sum = nw.reduce(function (a, v) { return a + v; }, 0);
          I.w = I.w || [];
          I.w[ri] = nw.map(function (v) { return v / sum; });
          changed = true;
        });
      });
      if (!changed) break;
      var res2 = layRound(f, g, own, zs, info, s, lim);
      // у зоны-многоугольника новые доли могли сломать контур в куске — ей вернуть
      // прежние доли, остальным оставить новые
      var pfz = Object.keys(res2.polyFail || {});
      if (pfz.length) {
        pfz.forEach(function (zi) { zs.forEach(function (Z, j) { if (Z.i === +zi) info[Z.i].w = saved[j]; }); });
        res2 = layRound(f, g, own, zs, info, s, lim);
      }
      if (!Object.keys(res2.polyFail || {}).length &&
          worstSpread(res2) <= worstSpread(res) && sumSpread(res2) < sumSpread(res) - 0.02 &&
          bundleOnLoops(res2, g.ppm) <= bundleOnLoops(res, g.ppm)) { res = res2; continue; }
      zs.forEach(function (Z, j) { info[Z.i].w = saved[j]; });   // не стало ровнее — как было
      break;
    }
    return res;
  }

  /**
   * Зона-многоугольник (комната буквой Г и т. п.) режется на k кусков из
   * клеток поровну по площади — прямыми разрезами поперёк одной оси, между
   * кусками клетка зазора (SLAB_GAP). w — доли площади по кускам (сумма 1),
   * нужны для выравнивания длин петель. Ось выбирается по тому, у какого
   * разреза куски ближе к прямоугольникам; кусок обязан быть связным.
   * Возвращает массив массивов индексов клеток или null.
   */
  function splitPoly(g, cells, k, w) {
    if (k <= 1) return [cells.slice()];
    var best = null;
    ['x', 'y'].forEach(function (ax) {
      var key = function (c) { return ax === 'x' ? c % g.W : Math.floor(c / g.W); };
      var cnt = {}, keys = [];
      cells.forEach(function (c) { var q = key(c); if (!cnt[q]) { cnt[q] = 0; keys.push(q); } cnt[q]++; });
      keys.sort(function (a, b) { return a - b; });
      var total = cells.length, acc = 0, cut = [], fr = 0, wi = 0, i;
      for (i = 0; i < keys.length && cut.length < k - 1; i++) {
        acc += cnt[keys[i]];
        var want = (w && w.length === k) ? (fr + w[wi]) : (wi + 1) / k;
        if (acc >= want * total) { cut.push(keys[i]); fr = want; wi++; }
      }
      if (cut.length < k - 1) return;
      var parts = [];
      for (i = 0; i < k; i++) parts.push([]);
      cells.forEach(function (c) {
        var q = key(c), pi = 0;
        for (var j = 0; j < cut.length; j++) { if (q === cut[j]) return; if (q > cut[j]) pi = j + 1; }
        parts[pi].push(c);
      });
      var sc = 0;
      for (i = 0; i < k; i++) {
        if (parts[i].length < 20) return;
        // связность и непрямоугольность
        var set = {}, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
        parts[i].forEach(function (c) { set[c] = 1; var cx = c % g.W, cy = (c - cx) / g.W; if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy; });
        var seen = {}, st = [parts[i][0]], n = 0; seen[parts[i][0]] = 1;
        while (st.length) {
          var c0 = st.pop(); n++;
          [c0 - 1, c0 + 1, c0 - g.W, c0 + g.W].forEach(function (m) { if (set[m] && !seen[m]) { seen[m] = 1; st.push(m); } });
        }
        if (n !== parts[i].length) return;
        sc += 1 - parts[i].length / ((x1 - x0 + 1) * (y1 - y0 + 1));
      }
      if (!best || sc < best.sc - 1e-9) best = { sc: sc, parts: parts };
    });
    return best ? best.parts : null;
  }

  /**
   * Клетки у стены, не вошедшие в раскладку (layable их отрезал), — какому куску
   * достаётся: ближайшему по клеткам (до двух клеток), и только своей зоны.
   * Без этого петля в многоугольнике останавливалась бы в 0,1–0,2 м от стены
   * — ровно то, на что жаловался владелец («до стен не доходит»).
   */
  function stripOwners(g, own, lay, slabOf, slabs) {
    var N = g.W * g.H, W = g.W, res = new Int32Array(N).fill(-1), k, pass, i;
    var DX = [-1, 0, 1, -1, 1, -1, 0, 1], DY = [-1, -1, -1, 0, 0, 1, 1, 1];
    for (pass = 0; pass < 3; pass++) {
      var upd = [];
      for (k = 0; k < N; k++) {
        if (!own[k] || lay[k] || slabOf[k] >= 0 || res[k] >= 0) continue;
        var x = k % W, y = (k - x) / W, best = -1;
        for (i = 0; i < 8; i++) {
          var xx = x + DX[i], yy = y + DY[i];
          if (xx < 0 || yy < 0 || xx >= W || yy >= g.H) continue;
          var q = yy * W + xx, id = slabOf[q] >= 0 ? slabOf[q] : res[q];
          if (id >= 0 && slabs[id].cells && own[k] === slabs[id].zi + 1 && (best < 0 || id < best)) best = id;
        }
        if (best >= 0) upd.push(k, best);
      }
      for (i = 0; i < upd.length; i += 2) res[upd[i]] = upd[i + 1];
    }
    return res;
  }

  /** Расстояние между двумя отрезками (для проверки, что трубы не сошлись). */
  function segSegDist2(a, b, c, d) {
    var sd = function (p, u, v) {
      var dx = v[0] - u[0], dy = v[1] - u[1], L2 = dx * dx + dy * dy || 1;
      var t = Math.max(0, Math.min(1, ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / L2));
      return Math.hypot(p[0] - u[0] - t * dx, p[1] - u[1] - t * dy);
    };
    var o = function (p, q, r2) { return (q[0] - p[0]) * (r2[1] - p[1]) - (q[1] - p[1]) * (r2[0] - p[0]); };
    var d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
    if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
    return Math.min(sd(a, c, d), sd(b, c, d), sd(c, a, b), sd(d, a, b));
  }
  /** Есть ли в одной трубе (ломаной) звенья ближе minD друг к другу; смежные звенья не в счёт. */
  function pipeClash(P, minD) {
    for (var i = 0; i + 1 < P.length; i++)
      for (var j = i + 3; j + 1 < P.length; j++) {
        var dd = segSegDist2(P[i], P[i + 1], P[j], P[j + 1]);
        if (dd < minD) {
          return true;
        }
      }
    return false;
  }

  /**
   * Петля в куске-многоугольнике: растр в треть шага, маска = клетки куска и
   * полосы у стены, не ближе положенного к стене (отступ квадратом — углы
   * остаются прямыми) и к месту без обогрева; дальше contourGuide. null — не
   * вышло (узко, дыры, распался на куски, трубы сошлись): зона вернётся к
   * прямоугольникам.
   */
  function polyLoop(f, g, sl, id, slabOf, who, strip, s, entry) {
    var ppm = g.ppm, r = s / 3;
    if (!(r >= 1)) return null;
    var colds = (f.zones || []).filter(function (q) { return q.type === 'cold' && q.pts && q.pts.length > 2; });
    var bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    sl.cells.forEach(function (c) {
      var x = g.ox + (c % g.W) * g.c, y = g.oy + Math.floor(c / g.W) * g.c;
      if (x < bx0) bx0 = x; if (y < by0) by0 = y; if (x + g.c > bx1) bx1 = x + g.c; if (y + g.c > by1) by1 = y + g.c;
    });
    var mg = 3 * g.c;                                   // полоса у стены лежит за краем куска
    bx0 -= mg; by0 -= mg; bx1 += mg; by1 += mg;
    var W = Math.ceil((bx1 - bx0) / r) + 2, H = Math.ceil((by1 - by0) / r) + 2;
    if (W * H > 300000) return null;
    var org = [bx0 - r, by0 - r], hh = Math.max(0, WALL_OFFSET_M * ppm - s / 2) + r / 2;
    var zp = sl.z.pts, M = new Uint8Array(W * H), cnt = 0, x, y;
    var probes = [[0, 0], [hh, 0], [-hh, 0], [0, hh], [0, -hh], [hh, hh], [hh, -hh], [-hh, hh], [-hh, -hh]];
    var nearCells = Math.ceil(hh / g.c) + 1;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      var px = org[0] + (x + 0.5) * r, py = org[1] + (y + 0.5) * r;
      var cx = Math.floor((px - g.ox) / g.c), cy = Math.floor((py - g.oy) / g.c);
      if (cx < 0 || cy < 0 || cx >= g.W || cy >= g.H) continue;
      var k = cy * g.W + cx;
      var inSlab = slabOf[k] === id;
      if (!inSlab && strip[k] !== id) continue;
      if (who[k] !== -1 && who[k] !== id) continue;     // пучок подводок
      // у стены — точная проверка отступа; в глубине куска клетка заведомо внутри
      if (!(inSlab && g.wallD && g.wallD[k] > nearCells)) {
        var okp = true;
        for (var pi = 0; pi < probes.length && okp; pi++) {
          var q = [px + probes[pi][0], py + probes[pi][1]];
          if (!pip(q, zp)) okp = false;
          else for (var ci = 0; ci < colds.length; ci++) if (pip(q, colds[ci].pts)) { okp = false; break; }
        }
        if (!okp) continue;
      }
      M[y * W + x] = 1; cnt++;
    }
    if (cnt * r * r / (ppm * ppm) < 1.2) return null;       // меньше 1,2 м² — не улитка
    // Начало витка: пробуем несколько по близости ко вводу и берём первое, у
    // которого трубы не сходятся (ступеньки контура у следа подводки)
    var G = null, sup, ret;
    for (var pick = 0; pick < 8; pick++) {
      var G1 = contourGuide(M, W, H, r, org, s, entry, pick);
      if (!G1) break;
      var su = offsetOrtho(G1.guide, s / 2), re = offsetOrtho(G1.guide, -s / 2);
      if (su && re) {
        re = re.reverse();
        if (!pipeClash(su.concat(re), 0.7 * s)) { G = G1; sup = su; ret = re; break; }
      }
      if (pick + 1 >= G1.cands) break;
    }
    if (!G) return null;
    // Пустоты: клетки куска дальше POLY_VOID_S шагов от любой трубы. У фигур с
    // «плечами» внутренний виток в плечо не заходит, и середина плеча остаётся
    // пустой — прямоугольная раскладка заполнила бы её своей улиткой. Больше
    // POLY_VOID_MAX пустого — контур не берём (корпус Galf, 03.10.2026: без
    // этой проверки покрытие падало с 73 до 67 %).
    var segs = [], si, lim2 = POLY_VOID_M * ppm;
    [sup, ret].forEach(function (Pq) { for (si = 1; si < Pq.length; si++) segs.push([Pq[si - 1], Pq[si]]); });
    var void_ = 0, tot = 0;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (!M[y * W + x]) continue;
      tot++;
      var cxp = org[0] + (x + 0.5) * r, cyp = org[1] + (y + 0.5) * r, near = false;
      for (si = 0; si < segs.length; si++) {
        var a2 = segs[si][0], b2 = segs[si][1];
        if (cxp < Math.min(a2[0], b2[0]) - lim2 || cxp > Math.max(a2[0], b2[0]) + lim2 ||
            cyp < Math.min(a2[1], b2[1]) - lim2 || cyp > Math.max(a2[1], b2[1]) + lim2) continue;
        var ddx = b2[0] - a2[0], ddy = b2[1] - a2[1], L2 = ddx * ddx + ddy * ddy || 1;
        var tt = Math.max(0, Math.min(1, ((cxp - a2[0]) * ddx + (cyp - a2[1]) * ddy) / L2));
        if (Math.hypot(cxp - a2[0] - tt * ddx, cyp - a2[1] - tt * ddy) <= lim2) { near = true; break; }
      }
      if (!near) void_++;
    }
    if (tot && void_ / tot > POLY_VOID_MAX) {
      return null;
    }
    var gx0 = 1e9, gy0 = 1e9, gx1 = -1e9, gy1 = -1e9;
    G.guide.forEach(function (p) { if (p[0] < gx0) gx0 = p[0]; if (p[0] > gx1) gx1 = p[0]; if (p[1] < gy0) gy0 = p[1]; if (p[1] > gy1) gy1 = p[1]; });
    return { guide: G.guide, sup: sup, ret: ret, kind: 'spiral', box: [gx0 - s, gy0 - s, gx1 + s, gy1 + s] };
  }

  /** Один проход раскладки при заданном числе петель на участок */
  function layRound(f, g, own, zs, info, s, lim) {
    var N = g.W * g.H, ppm = g.ppm, slabs = [], polyFail = {};
    var slabOf = new Int32Array(N).fill(-1), edge = new Uint8Array(N);
    zs.forEach(function (Z) {
      var I0 = info[Z.i];
      if (I0.poly) {
        // комната режется на куски из клеток (а не на прямоугольники): петля
        // в куске идёт по его контуру (contourGuide)
        var parts = splitPoly(g, I0.poly.cells, I0.k[0], I0.w && I0.w[0]);
        if (!parts) { polyFail[Z.i] = 1; return; }
        parts.forEach(function (cells, ti) {
          var id = slabs.length, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
          cells.forEach(function (c) {
            var cx = c % g.W, cy = (c - cx) / g.W;
            if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
            slabOf[c] = id;
          });
          slabs.push({ zi: Z.i, ri: 0, ti: ti, z: Z.z, cells: cells, r: { x0: x0, x1: x1, y0: y0, y1: y1 } });
        });
        return;
      }
      info[Z.i].rects.forEach(function (r, ri) {
        splitRect(r, info[Z.i].k[ri], info[Z.i].w && info[Z.i].w[ri]).forEach(function (b, ti) {
          var id = slabs.length, x, y;
          slabs.push({ zi: Z.i, ri: ri, ti: ti, z: Z.z, r: b });
          for (y = b.y0; y <= b.y1; y++) for (x = b.x0; x <= b.x1; x++) {
            slabOf[y * g.W + x] = id;
            if (x === b.x0 || x === b.x1 || y === b.y0 || y === b.y1) edge[y * g.W + x] = 1;
          }
        });
      });
    });
    // края кусков-многоугольников: клетки, у которых сосед по стороне — не этот кусок
    slabs.forEach(function (sl, id) {
      if (!sl.cells) return;
      sl.edgeCells = [];
      sl.cells.forEach(function (c) {
        var x = c % g.W, y = (c - x) / g.W;
        var inner = x > 0 && y > 0 && x < g.W - 1 && y < g.H - 1 &&
          slabOf[c - 1] === id && slabOf[c + 1] === id && slabOf[c - g.W] === id && slabOf[c + g.W] === id;
        if (!inner) { edge[c] = 1; sl.edgeCells.push(c); }
      });
    });
    // цена клетки для трассы; за габаритом зон — улица, туда трубу не ведём
    var cost = new Float32Array(N), k, zb = g.zb;
    if (!zb) {                                  // габарит зон от круга к кругу не меняется
      zb = [g.W, g.H, -1, -1];
      for (k = 0; k < N; k++) if (own[k]) {
        var cx = k % g.W, cy = Math.floor(k / g.W);
        zb = [Math.min(zb[0], cx), Math.min(zb[1], cy), Math.max(zb[2], cx), Math.max(zb[3], cy)];
      }
      g.zb = zb;
    }
    for (k = 0; k < N; k++) {
      var kx = k % g.W, ky = Math.floor(k / g.W);
      var outside = kx < zb[0] || ky < zb[1] || kx > zb[2] || ky > zb[3];
      cost[k] = slabOf[k] >= 0 ? (edge[k] ? COST_EDGE : COST_IN) :
        (g.cold[k] || outside ? COST_IN : (own[k] ? COST_FREE : COST_OUT));
      // середина комнаты дороже: подводки идут вдоль стен, как в проектах
      if (own[k] && g.wallD && g.wallD[k] > LEAD_WALL_CELLS) cost[k] += COST_MID;
    }
    // нарисованные монтажником подводки — желательная трасса
    usableLeads(f).forEach(function (L) {
      var P = L.pts || [];
      for (var j = 1; j < P.length; j++) {
        var a = P[j - 1], b = P[j], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (g.c / 2)));
        for (var t = 0; t <= n; t++) {
          var q = cellAt(g, [a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n]);
          cost[q] = Math.min(cost[q], COST_DRAWN);
        }
      }
    });
    var src = f.coll ? cellAt(g, [f.coll.x, f.coll.y]) : -1;
    // края участков — цели поиска: дойдя до всех, поиск останавливается
    var goal = new Int32Array(N).fill(-1);
    for (k = 0; k < N; k++) if (edge[k] && slabOf[k] >= 0) goal[k] = slabOf[k];
    var R = src >= 0 ? routeAll(g, cost, src, goal, slabs.length) : null;
    // трасса к каждой петле — до ближайшей клетки её края
    var paths = slabs.map(function (sl, id) {
      if (!R) return null;
      var b = sl.r, best = -1, bd = Infinity, x, y, d;
      if (sl.edgeCells) {
        sl.edgeCells.forEach(function (c) {
          for (var d2 = 0; d2 < 4; d2++) {
            var st2 = c * 4 + d2;
            if (R.dist[st2] < bd) { bd = R.dist[st2]; best = st2; }
          }
        });
      } else for (y = b.y0; y <= b.y1; y++) for (x = b.x0; x <= b.x1; x++) {
        if (!(x === b.x0 || x === b.x1 || y === b.y0 || y === b.y1)) continue;
        for (d = 0; d < 4; d++) {
          var st = (y * g.W + x) * 4 + d;
          if (R.dist[st] < bd) { bd = R.dist[st]; best = st; }
        }
      }
      if (best < 0) return null;
      var cells = [];
      for (var q = best; q >= 0; q = R.prev[q]) cells.push(q >> 2);
      cells.reverse();
      return { id: id, cells: cells };
    });
    // пучок вырезаем из петель: сколько труб идёт по клетке — такой ширины полоса
    // Вырезка: who[k] = −1 — свободно, −2 — занято пучком, id — занято только
    // вводом подводки в участок id. Свой ввод участку не мешает: подводка в него
    // и входит, а вырезка у конца стоила маленькой комнате целого ряда трубы.
    var through = new Int32Array(N), entryOf = new Int32Array(N).fill(-1);
    paths.forEach(function (P) {
      if (!P) return;
      P.cells.forEach(function (c, i) {
        through[c]++;
        if (i >= P.cells.length - 2) entryOf[c] = entryOf[c] === -1 ? P.id : -2;
        else entryOf[c] = -2;
      });
    });
    var who = new Int32Array(N).fill(-1), blocked = new Uint8Array(N);
    for (k = 0; k < N; k++) {
      if (!through[k]) continue;
      var rr = Math.max(1, Math.ceil((through[k] * LEAD_PIPE_M + 0.05) / CELL_M - 0.5));
      var own1 = through[k] === 1 ? entryOf[k] : -2;      // только ввод одной петли
      var x0 = k % g.W, y0 = Math.floor(k / g.W);
      for (var yy = y0 - rr; yy <= y0 + rr; yy++) for (var xx = x0 - rr; xx <= x0 + rr; xx++) {
        if (xx < 0 || yy < 0 || xx >= g.W || yy >= g.H) continue;
        var q = yy * g.W + xx;
        who[q] = (own1 >= 0 && (who[q] === -1 || who[q] === own1)) ? own1 : -2;
        blocked[q] = 1;
      }
    }
    var byZone = {}, used = [], okBuf = new Uint8Array(N), boxes = bundleBoxes(g, paths);
    var strip = null;
    if (slabs.some(function (s0) { return s0.cells; })) strip = stripOwners(g, own, g.lay, slabOf, slabs);
    slabs.forEach(function (sl, id) {
      var Rp, L, P = paths[id], entry;
      if (sl.cells) {
        // участок-многоугольник: петля по контуру
        entry = P ? cellXY(g, P.cells[P.cells.length - 1]) : (f.coll ? [f.coll.x, f.coll.y] : null);
        L = polyLoop(f, g, sl, id, slabOf, who, strip, s, entry);
        if (!L) { polyFail[sl.zi] = 1; return; }
        Rp = L.box;
      } else {
      // один буфер на все участки: размечаем свой прямоугольник и после стираем
      var b = sl.r, ok = okBuf, x, y;
      for (y = b.y0; y <= b.y1; y++) for (x = b.x0; x <= b.x1; x++) {
        var wq = who[y * g.W + x];
        ok[y * g.W + x] = (wq === -1 || wq === id) ? 1 : 0;
      }
      var r = maxRect(g, ok, [b.x0, b.y0, b.x1, b.y1]);
      for (y = b.y0; y <= b.y1; y++) for (x = b.x0; x <= b.x1; x++) ok[y * g.W + x] = 0;
      if (!r || r.area * CELL_M * CELL_M < 0.2) return;
      Rp = [g.ox + r.x0 * g.c, g.oy + r.y0 * g.c, g.ox + (r.x1 + 1) * g.c, g.oy + (r.y1 + 1) * g.c];
      entry = P ? cellXY(g, P.cells[P.cells.length - 1]) : (f.coll ? [f.coll.x, f.coll.y] : null);
      snapToWalls(Rp, r, sl, id, g, own, boxes, s, f, entry);
      var shortM = Math.min(Rp[2] - Rp[0], Rp[3] - Rp[1]) / ppm;
      var kind = sl.z.lay === 'snake' || sl.z.lay === 'spiral' ? sl.z.lay : (shortM < SNAKE_BELOW_M ? 'snake' : 'spiral');
      L = loopInRect(Rp, s, kind, entry);
      if (!L) return;
      }
      // подводка: коллектор → трасса → начало петли
      var lead = [];
      if (P) {
        lead = [[f.coll.x, f.coll.y]].concat(P.cells.map(function (c) { return cellXY(g, c); }));
        lead = orthoPath(lead.concat([L.guide[0]]));
        P.head = [[f.coll.x, f.coll.y], cellXY(g, P.cells[0])];
        P.tail = orthoPath([cellXY(g, P.cells[P.cells.length - 1]), L.guide[0]]);
      }
      var loopM = (lenPoly(L.sup) + lenPoly(L.ret) +
        Math.hypot(L.sup[L.sup.length - 1][0] - L.ret[0][0], L.sup[L.sup.length - 1][1] - L.ret[0][1])) / ppm;
      var leadM = lead.length ? lenPoly(lead) / ppm : 0;
      var lenM = loopM + 2 * leadM;
      var loop = { sup: L.sup, ret: L.ret, kind: L.kind, lead: lead,
        lenM: lenM, m: Math.round(lenM), loopM: loopM, ri: sl.ri, ti: sl.ti, rect: Rp };
      (byZone[sl.zi] = byZone[sl.zi] || []).push(loop);
      if (P) { P.loop = loop; used.push(P); }
    });
    var headN = used.length;
    used.forEach(function (P) { P.headN = headN; });
    if (used.length) used.slice(1).forEach(function (P) { P.head = null; });
    return { byZone: byZone, bundle: g && used.length ? bundleSegs(g, used) : [], blocked: blocked, polyFail: polyFail };
  }

  /** Полилиния, сдвинутая на o px перпендикулярно ходу (для пары подводок) */
  function offsetPoly(pts, o) {
    return pts.map(function (p, i) {
      var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var L = Math.hypot(dx, dy) || 1;
      return [p[0] - dy / L * o, p[1] + dx / L * o];
    });
  }

  function pathD(pts, t) {
    return pts.map(function (p, i) {
      return (i ? 'L' : 'M') + n(t.X(p[0])) + ',' + n(t.Y(p[1]));
    }).join('');
  }

  /**
   * Тот же путь, но с закруглёнными поворотами: труба гнётся по радиусу, а
   * не ломается под угол. Радиус — не больше половины короткой из соседних
   * сторон, поэтому на частых коленах скругление само уменьшается.
   */
  function pathR(pts, t, r) {
    if (!pts || pts.length < 3) return pathD(pts, t);
    var P = pts.map(function (p) { return [t.X(p[0]), t.Y(p[1])]; });
    var d = ['M' + n(P[0][0]) + ',' + n(P[0][1])];
    for (var i = 1; i < P.length - 1; i++) {
      var a = P[i - 1], b = P[i], c = P[i + 1];
      var l1 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      var l2 = Math.hypot(c[0] - b[0], c[1] - b[1]) || 1;
      var rr = Math.min(r, l1 / 2, l2 / 2);
      if (rr < 0.05) { d.push('L' + n(b[0]) + ',' + n(b[1])); continue; }
      var p1 = [b[0] + (a[0] - b[0]) / l1 * rr, b[1] + (a[1] - b[1]) / l1 * rr];
      var p2 = [b[0] + (c[0] - b[0]) / l2 * rr, b[1] + (c[1] - b[1]) / l2 * rr];
      d.push('L' + n(p1[0]) + ',' + n(p1[1]));
      d.push('Q' + n(b[0]) + ',' + n(b[1]) + ' ' + n(p2[0]) + ',' + n(p2[1]));
    }
    var L = P[P.length - 1];
    d.push('L' + n(L[0]) + ',' + n(L[1]));
    return d.join('');
  }

  /**
   * Стены и окна этажа — вектором, из геометрии редактора планов (f.geom).
   *
   * Подложка у монтажников любая: фото, скан, экспорт CAD, — а лист должен
   * выглядеть одинаково, как в проектах-образцах. Поэтому план рисуется по
   * контурам стен, а подложка остаётся запасным вариантом для планов,
   * размеченных до появления геометрии.
   */
  function wallsBody(f, t) {
    var g = f.geom;
    if (!g || !(g.walls || []).length) return '';
    var o = [];
    o.push('<g style="fill:#8b98ab;stroke:#5b6675;stroke-width:0.12;fill-rule:evenodd">');
    g.walls.forEach(function (pl) { o.push('<path d="' + pathD(pl, t) + 'Z"/>'); });
    o.push('</g>');
    // Окно: проём выбирается из стены белым, по краям — переплёт двумя
    // тонкими линиями вдоль стены (в оригинале так же).
    (g.wins || []).forEach(function (w) {
      var L = w.w * t.s, th = Math.max(0.7, 0.32 * (f.pxPerM || 100) * t.s);
      o.push('<g transform="translate(' + n(t.X(w.x)) + ',' + n(t.Y(w.y)) +
        ') rotate(' + (w.ang || 0) + ')">' +
        '<rect x="' + n(-L / 2) + '" y="' + n(-th / 2) + '" width="' + n(L) +
        '" height="' + n(th) + '" style="fill:#ffffff;stroke:#5b6675;stroke-width:0.12"/>' +
        '<line x1="' + n(-L / 2) + '" y1="' + n(-th / 6) + '" x2="' + n(L / 2) +
        '" y2="' + n(-th / 6) + '" style="stroke:#5b6675;stroke-width:0.1"/>' +
        '<line x1="' + n(-L / 2) + '" y1="' + n(th / 6) + '" x2="' + n(L / 2) +
        '" y2="' + n(th / 6) + '" style="stroke:#5b6675;stroke-width:0.1"/></g>');
      // Размер окна — как в проектах-образцах, над проёмом: ширина берётся
      // стандартная (редактор округляет замер), поэтому размер не «плавает».
      if (w.mm) {
        var lx = t.X(w.x), ly = t.Y(w.y);
        var vert = Math.abs((w.ang || 0) % 180) > 45;
        if (vert) o.push('<text x="' + n(lx - 2.2) + '" y="' + n(ly) + '" font-size="2.6"' +
          ' text-anchor="middle" transform="rotate(-90 ' + n(lx - 2.2) + ' ' + n(ly) + ')">Ш:' +
          w.mm + '</text>');
        else o.push(txt(lx, ly - 2.2, 'Ш:' + w.mm, { size: 2.6, anchor: 'middle' }));
      }
    });
    // Дверь: проём выбирается из стены, от навески идёт полотно и дуга
    // открывания — как на планах проектов-образцов. Сторона навески и
    // сторона открывания приходят из редактора (ближняя поперечная стена
    // и то, где больше свободного места).
    (g.doors || []).forEach(function (d) {
      var L = d.w * t.s, th = Math.max(0.7, 0.32 * (f.pxPerM || 100) * t.s);
      var hx = (d.hinge < 0 ? -1 : 1) * L / 2;          // навеска у края проёма
      var sy = (d.side < 0 ? -1 : 1);                   // куда открывается
      var tipX = hx, tipY = sy * L;                     // конец полотна
      var arc = 'M' + n(hx - (d.hinge < 0 ? -L : L)) + ',0' +
        ' A' + n(L) + ',' + n(L) + ' 0 0 ' + ((d.hinge < 0) === (sy > 0) ? 1 : 0) + ' ' +
        n(tipX) + ',' + n(tipY);
      o.push('<g transform="translate(' + n(t.X(d.x)) + ',' + n(t.Y(d.y)) +
        ') rotate(' + (d.ang || 0) + ')">' +
        '<rect x="' + n(-L / 2) + '" y="' + n(-th / 2) + '" width="' + n(L) +
        '" height="' + n(th) + '" style="fill:#ffffff;stroke:none"/>' +
        '<path d="' + arc + '" style="fill:none;stroke:#5b6675;stroke-width:0.12"/>' +
        '<line x1="' + n(hx) + '" y1="0" x2="' + n(tipX) + '" y2="' + n(tipY) +
        '" style="stroke:#5b6675;stroke-width:0.25"/></g>');
    });
    return o.join('');
  }

  /** Значок коллектора ТП: короткая гребёнка с отводами */
  function collectorMark(c, t, f, o, noLabel) {
    var w = Math.max(3.5, 0.55 * (f.pxPerM || 100) * t.s), h = w * 0.36;
    var X = t.X(c.x), Y = t.Y(c.y), ang = f.coll === c ? collAngle(f, 'tp') : 0, vert = ang % 180 === 90;
    // монтажник мог развернуть коллектор на 90° (стена распознана неверно) —
    // значок поворачивается целиком, отводы идут в ту же сторону
    o.push('<g' + (ang ? ' transform="rotate(' + ang + ' ' + n(X) + ' ' + n(Y) + ')"' : '') + '>');
    o.push('<rect x="' + n(X - w / 2) + '" y="' + n(Y - h / 2) + '" width="' + n(w) + '" height="' + n(h) +
      '" rx="0.5" style="fill:#ffffff;stroke:#b35900;stroke-width:0.5"/>');
    for (var s2 = -1; s2 <= 1; s2++) {
      var xs = X + s2 * w / 3.4;
      o.push('<line x1="' + n(xs) + '" y1="' + n(Y - h / 2 - 1.1) + '" x2="' + n(xs) + '" y2="' + n(Y - h / 2) +
        '" style="stroke:#b35900;stroke-width:0.45"/>');
    }
    o.push('</g>');
    // подпись могут поставить снаружи, в обход других подписей (сводный план)
    if (!noLabel) o.push(txt(X, Y + (vert ? w : h) / 2 + 3.1, 'Коллектор ТП', { size: 2.8, anchor: 'middle', fill: '#b35900' }));
  }

  // Цвета петель — замер по эталону (растр листа «Сводный план сетей»):
  // подача #ff8080, обратка #8080ff — полутона чистых красного и синего.
  var COL_SUP = '#ff8080', COL_RET = '#8080ff';

  // ═══ Расход теплоносителя по петлям ═════════════════════════════════════
  // По расходу балансируют коллектор (расходомеры на подающей гребёнке),
  // поэтому в таблице петель он стоит рядом с шагом и длиной.
  //   G = Q / (c × ΔT),  c = 1,163 Вт·ч/(кг·°C).
  // Перепад ΔT берём у сметы: обычно это 5 К, но если насосу узла на таком
  // расходе не хватает напора, расчёт принимает 7 или 10 К (app.ufhBalance).
  // Числа на листе и в смете обязаны быть одни и те же.
  var UFH_DT = 5, UFH_C = 1.163;
  function ufhDt() {
    try {
      if (window.app && app._ufhBal && app._ufhBal.dT > 0) return app._ufhBal.dT;
    } catch (e) { /* расчёт ещё не поднялся — работаем по обычным 5 К */ }
    return UFH_DT;
  }

  /** Предельная теплоотдача пола при шаге укладки, Вт/м² (СП 60.13330.2020) */
  function qUdeFor(stepMm) {
    return stepMm === 100 ? 90 : (stepMm === 200 ? 50 : 70);
  }

  /** Расход петли, л/мин: Q в ваттах → кг/ч → литры в минуту */
  function flowLmin(qW) {
    return qW / (UFH_C * ufhDt()) / 60;
  }

  /** Число с одним знаком и запятой — как принято на чертежах */
  function num1(v) { return v.toFixed(1).replace('.', ','); }

  /** Помещение расчёта, одноимённое зоне плана (по нему сверяются и площади) */
  function roomOf(zName, rooms) {
    var key = String(zName || '').trim().toLowerCase();
    if (!key) return null;
    for (var i = 0; i < (rooms || []).length; i++)
      if (String(rooms[i].name || '').trim().toLowerCase() === key) return rooms[i];
    return null;
  }

  /**
   * Тепловая мощность зоны, Вт. Основа — теплопотери одноимённой комнаты
   * расчёта, но не больше того, что пол отдаёт при этом шаге: в комнате с
   * радиаторами остаток покрывают они (так же делит нагрузку и смета).
   * Комнаты нет (планы без режима помещений) — считаем по площади и шагу.
   */
  function zoneHeat(room, area, stepMm) {
    var cap = area * qudOf(room, stepMm);
    return (room && room.q > 0) ? Math.min(room.q, cap) : cap;
  }

  /**
   * Отдача пола с м² для комнаты: из расчёта (room.qud — при температуре этой
   * комнаты, как в смете: в тёплой отдаёт меньше), иначе — по шагу.
   */
  function qudOf(room, stepMm) {
    return (room && room.qud > 0) ? room.qud : qUdeFor(stepMm);
  }

  /** Запасная укладка совсем узких зон (меньше двух витков): встречная змейка —
   *  подача и обратка идут рядом, как и в спирали; обрезка контуром зоны */
  function serpentine(z, t, f, stepMm, cid) {
    var o = [];
    o.push('<clipPath id="' + cid + '"><polygon points="' + polyPts(z.pts, t.X, t.Y) + '"/></clipPath>');
    var bb = bbox(z.pts);
    var stepPx = stepMm / 1000 * f.pxPerM;          // шаг укладки в пикселях подложки
    var x0 = t.X(bb[0]) + 1, x1 = t.X(bb[2]) - 1;
    var snake = function (yFrom, col) {
      var d = [], dir = 0;
      for (var y = yFrom; y <= bb[3]; y += 2 * stepPx) {
        var Y = t.Y(y);
        if (!d.length) d.push('M' + n(dir ? x1 : x0) + ',' + n(Y));
        d.push('L' + n(dir ? x0 : x1) + ',' + n(Y));
        var yn = y + 2 * stepPx;
        if (yn <= bb[3]) d.push('L' + n(dir ? x0 : x1) + ',' + n(t.Y(yn)));
        dir = 1 - dir;
      }
      if (d.length)
        o.push('<path d="' + d.join('') + '" clip-path="url(#' + cid + ')"' +
          ' style="fill:none;stroke:' + col + ';stroke-width:0.5"/>');
    };
    snake(bb[1] + stepPx / 2, COL_SUP);
    snake(bb[1] + stepPx * 1.5, COL_RET);
    return o.join('');
  }

  /**
   * Петли этажа строкой на петлю — общий источник для таблиц.
   * [{ no, name, area, step, m, flow, byLoss, est, zi, k, li, loop }]
   * Нумерация сквозная по этажу: № в таблице коллектора и № на укладке —
   * одно и то же число. rooms — помещения расчёта уже этого этажа.
   */
  function loopRows(f, stepMm, rooms) {
    var out = [], no = 0, zno = 0;
    floorLoops(f, stepMm, loopLimit(stepMm)).forEach(function (Z) {
      var k = Z.loops.length;
      var zName = Z.name || 'зона ' + (++zno);
      // Пол греет под трубой: у разложенной петли предел мощности — с площади
      // под её трубой (длина без подводок × шаг), нагрузка комнаты делится между
      // петлями по этой площади. Зона-оценка — по площади, поровну, как прежде.
      // Так же считает смета (app.ufhCalc).
      var rm = roomOf(Z.name, rooms), s = stepMm / 1000;
      var laidSum = Z.est ? 0 : Z.loops.reduce(function (a, lp) { return a + (lp.loopM || 0); }, 0);
      Z.loops.forEach(function (lp, li) {
        var q;
        if (laidSum > 0 && lp.loopM > 0) {
          var cap = lp.loopM * s * qudOf(rm, stepMm);
          q = (rm && rm.q > 0) ? Math.min(rm.q * lp.loopM / laidSum, cap) : cap;
        } else q = zoneHeat(rm, Z.area, stepMm) / k;
        out.push({ no: ++no, name: zName + (k > 1 ? ' ' + (li + 1) + '/' + k : ''),
          area: Z.area / k, step: stepMm, m: lp.m, flow: flowLmin(q),
          byLoss: !!rm, est: !!Z.est, zi: Z.i, k: k, li: li, loop: lp });
      });
    });
    return out;
  }

  // ═══ Листы «Этаж N. 3D вид системы» ════════════════════════════════════
  // В проектах-образцах системы показаны не только планом, но и объёмным
  // видом: плита перекрытия, на ней подложка плана, поверх — трубопроводы
  // своей геометрией, вокруг — таблички контуров с шагом, длиной и расходом.
  // Проекция изометрическая: X = (x − y)·cos30°, Y = (x + y)·sin30° − z.

  var ISO_C = Math.cos(Math.PI / 6), ISO_S = Math.sin(Math.PI / 6);
  var ISO_BOX = { x0: 120, y0: 30, x1: 400, y1: 244 };   // поле под вид

  /**
   * Изометрия этажа: перевод координат подложки (пиксели плана) в лист.
   * z — высота в пикселях подложки, вверх положительная.
   */
  function isoFit(f, box) {
    var B = box || ISO_BOX;
    var raw = function (px, py, z) {
      return [(px - py) * ISO_C, (px + py) * ISO_S - (z || 0)];
    };
    var cor = [raw(0, 0, 0), raw(f.w, 0, 0), raw(f.w, f.h, 0), raw(0, f.h, 0)];
    var bb = bbox(cor);
    var s = Math.min((B.x1 - B.x0) / (bb[2] - bb[0]), (B.y1 - B.y0) / (bb[3] - bb[1]));
    var ox = B.x0 + ((B.x1 - B.x0) - (bb[2] - bb[0]) * s) / 2 - bb[0] * s;
    var oy = B.y0 + ((B.y1 - B.y0) - (bb[3] - bb[1]) * s) / 2 - bb[1] * s;
    var P = function (px, py, z) {
      var r = raw(px, py, z);
      return [ox + r[0] * s, oy + r[1] * s];
    };
    return {
      s: s, P: P,
      X: function (px, py, z) { return P(px, py, z)[0]; },
      Y: function (px, py, z) { return P(px, py, z)[1]; },
      // высота в пикселях подложки из миллиметров натуры
      mm: function (v) { return (v / 1000) * (f.pxPerM || 100); }
    };
  }

  /** Ломаная плана в изометрии на высоте z */
  function isoPath(pts, t, z) {
    return pts.map(function (p, i) {
      var q = t.P(p[0], p[1], z || 0);
      return (i ? 'L' : 'M') + n(q[0]) + ',' + n(q[1]);
    }).join('');
  }

  function isoPoly(pts, t, z) {
    return pts.map(function (p) {
      var q = t.P(p[0], p[1], z || 0);
      return n(q[0]) + ',' + n(q[1]);
    }).join(' ');
  }

  /**
   * Плита перекрытия с подложкой плана на верхней грани.
   * Подложка — обычная картинка, вписанная в параллелограмм аффинным
   * преобразованием: прямоугольник в изометрии остаётся параллелограммом,
   * поэтому matrix() отрисует её без искажений.
   */
  /**
   * Стены по периметру этажа: только две дальние грани.
   *
   * Геометрии стен в редакторе планов нет — есть подложка и контуры зон,
   * поэтому поднимаем контур плиты на высоту этажа. Ближние стены не рисуем
   * вовсе: иначе они закроют трубы, ради которых лист и делается. Оконных
   * проёмов нет по той же причине — данных о них в плане не заведено.
   */
  function isoWalls(f, t, o, hMm) {
    if (f.geom && (f.geom.walls || []).length) return isoWallsGeom(f, t, o, hMm);
    var h = t.mm(hMm || 2700);
    [[[0, 0], [f.w, 0]], [[0, 0], [0, f.h]]].forEach(function (e) {
      var a = t.P(e[0][0], e[0][1], 0), b = t.P(e[1][0], e[1][1], 0);
      var b2 = t.P(e[1][0], e[1][1], h), a2 = t.P(e[0][0], e[0][1], h);
      o.push('<polygon points="' + [a, b, b2, a2].map(function (p) {
        return n(p[0]) + ',' + n(p[1]);
      }).join(' ') + '" style="fill:#eef1f4;fill-opacity:0.5;stroke:#8a9099;stroke-width:0.25"/>');
    });
  }

  /**
   * Стены по геометрии плана (f.geom — те же контуры, что на листе плана).
   * Дальние стены, с которых смотрит зритель, идут во всю высоту, с окнами;
   * остальные — низким «срезом» (250 мм), чтобы план читался, а трубы не
   * закрывались. Как на 3D-видах проектов-образцов: стены и окна, а не
   * прозрачная коробка.
   */
  function isoWallsGeom(f, t, o, hMm) {
    var g = f.geom, ppm = f.pxPerM || 100, T = 0.5 * ppm, AL = 0.15 * ppm;
    var hz = t.mm(hMm || 2700), low = t.mm(250);
    var mnX = 1e9, mnY = 1e9;
    g.walls.forEach(function (ring) {
      ring.forEach(function (p) { mnX = Math.min(mnX, p[0]); mnY = Math.min(mnY, p[1]); });
    });
    var far = [], near = [], innerVX = null, innerHY = null;
    g.walls.forEach(function (ring) {
      for (var i = 0; i < ring.length; i++) {
        var a = ring[i], b = ring[(i + 1) % ring.length];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1) continue;
        var vx = Math.abs(a[0] - b[0]) < AL && Math.max(a[0], b[0]) <= mnX + T;
        var hy = Math.abs(a[1] - b[1]) < AL && Math.max(a[1], b[1]) <= mnY + T;
        if (vx) innerVX = innerVX == null ? a[0] : Math.max(innerVX, a[0]);
        if (hy) innerHY = innerHY == null ? a[1] : Math.max(innerHY, a[1]);
        (vx || hy ? far : near).push({ a: a, b: b, vx: vx });
      }
    });
    var P2 = function (p, z) { var q = t.P(p[0], p[1], z); return n(q[0]) + ',' + n(q[1]); };
    var face = function (e, h, style) {
      return '<polygon points="' + [P2(e.a, 0), P2(e.b, 0), P2(e.b, h), P2(e.a, h)].join(' ') +
        '" style="' + style + '"/>';
    };
    var dep = function (e) { return e.a[0] + e.a[1] + e.b[0] + e.b[1]; };
    // низкий срез остальных стен: боковые грани от дальних к ближним, затем верх
    near.sort(function (p, q) { return dep(p) - dep(q); }).forEach(function (e) {
      o.push(face(e, low, 'fill:#a9b2bf;stroke:#7d8795;stroke-width:0.12'));
    });
    g.walls.forEach(function (ring) {      // отдельным контуром, как на плане: наложение стен не даёт «дыр»
      o.push('<path d="' + isoPath(ring, t, low) + 'Z" style="fill:#8b98ab;stroke:#5b6675;stroke-width:0.12"/>');
    });
    // дальние стены во всю высоту: внутренняя грань светлее наружной
    far.sort(function (p, q) { return dep(p) - dep(q); }).forEach(function (e) {
      var pos = e.vx ? e.a[0] : e.a[1], inner = e.vx ? innerVX : innerHY;
      o.push(face(e, hz, 'fill:' + (inner != null && pos >= inner - AL ? '#eceff3' : '#d3d8de') +
        ';stroke:#8a9099;stroke-width:0.2'));
    });
    // окна дальних стен: стекло с переплётом на внутренней грани
    var sill = t.mm(900), head = t.mm(2100);
    (g.wins || []).forEach(function (w) {
      var vert = Math.abs((w.ang || 0) % 180) > 45, half = (w.w || 0) / 2, A, B;
      if (vert && innerVX != null && w.x <= mnX + T) { A = [innerVX, w.y - half]; B = [innerVX, w.y + half]; }
      else if (!vert && innerHY != null && w.y <= mnY + T) { A = [w.x - half, innerHY]; B = [w.x + half, innerHY]; }
      else return;
      var q = [P2(A, sill), P2(B, sill), P2(B, head), P2(A, head)];
      var M1 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      o.push('<polygon points="' + q.join(' ') + '" style="fill:#cfe4f5;stroke:#5b6675;stroke-width:0.25"/>');
      o.push('<line x1="' + P2(M1, sill).split(',')[0] + '" y1="' + P2(M1, sill).split(',')[1] + '" x2="' +
        P2(M1, head).split(',')[0] + '" y2="' + P2(M1, head).split(',')[1] +
        '" style="stroke:#5b6675;stroke-width:0.2"/>');
    });
  }

  /** Плита и стены вместе: с геометрией плиту рисуем первой — низкие стены лежат на ней */
  function isoShell(f, t, o) {
    var geom = f.geom && (f.geom.walls || []).length;
    if (geom) { isoSlab(f, t, o); isoWalls(f, t, o); }
    else { isoWalls(f, t, o); isoSlab(f, t, o); }
  }

  function isoSlab(f, t, o, thick) {
    var th = t.mm(thick == null ? 250 : thick);
    var top = [[0, 0], [f.w, 0], [f.w, f.h], [0, f.h]];
    // боковые грани — те, что обращены к зрителю
    [[[f.w, 0], [f.w, f.h]], [[f.w, f.h], [0, f.h]]].forEach(function (e) {
      var a = t.P(e[0][0], e[0][1], 0), b = t.P(e[1][0], e[1][1], 0);
      var a2 = t.P(e[0][0], e[0][1], -th), b2 = t.P(e[1][0], e[1][1], -th);
      o.push('<polygon points="' + [a, b, b2, a2].map(function (p) {
        return n(p[0]) + ',' + n(p[1]);
      }).join(' ') + '" style="fill:#d9dde2;stroke:#8a9099;stroke-width:0.25"/>');
    });
    o.push('<polygon points="' + isoPoly(top, t, 0) +
      '" style="fill:#f2f4f6;stroke:#8a9099;stroke-width:0.3"/>');
    // с контурами стен подложка не нужна: вид чистый, как в проектах-образцах
    if (f.img && !(f.geom && (f.geom.walls || []).length)) {
      var O = t.P(0, 0, 0), U = t.P(1, 0, 0), V = t.P(0, 1, 0);
      var m = [U[0] - O[0], U[1] - O[1], V[0] - O[0], V[1] - O[1], O[0], O[1]];
      o.push('<image x="0" y="0" width="' + n(f.w) + '" height="' + n(f.h) +
        '" preserveAspectRatio="none" opacity="0.5" transform="matrix(' +
        m.map(function (v) { return n(v); }).join(',') + ')" href="' +
        String(f.img).replace(/&/g, '&amp;') + '"/>');
    }
  }

  /** Табличка контура: номер, шаг, длина, расход — как в образце */
  function isoCard(o, x, y, lines, w) {
    w = w || 30;
    var h = 5.4 * lines.length;
    o.push('<rect x="' + n(x) + '" y="' + n(y) + '" width="' + n(w) + '" height="' + n(h) +
      '" style="fill:#ffffff;stroke:#000;stroke-width:0.25"/>');
    lines.forEach(function (s, i) {
      if (i) o.push('<line x1="' + n(x) + '" y1="' + n(y + 5.4 * i) + '" x2="' + n(x + w) +
        '" y2="' + n(y + 5.4 * i) + '" style="stroke:#000;stroke-width:0.2"/>');
      o.push(txt(x + w / 2, y + 5.4 * i + 3.6, s, { size: 3.1, anchor: 'middle' }));
    });
    return h;
  }

  /** Лист «Этаж N. 3D вид напольного отопления» */
  function isoTpBody(f, num, stepMm, rooms) {
    var t = isoFit(f), o = [];
    isoShell(f, t, o);
    rooms = (rooms || []).filter(function (r) { return (r.floor || 1) === num; });

    var cards = [];
    // пучок подводок — той же полосой, что на плане
    (floorLoops(f, stepMm, loopLimit(stepMm)).bundle || []).forEach(function (sg) {
      o.push('<path d="' + isoPath([sg.a, sg.b], t) + '" style="fill:none;stroke:' + COL_BUNDLE +
        ';stroke-opacity:0.85;stroke-width:' + n(Math.max(0.4, sg.n * 2 * BUNDLE_DRAW_M * (f.pxPerM || 100) * t.s)) +
        ';stroke-linecap:square"/>');
    });
    loopRows(f, stepMm, rooms).forEach(function (R) {
      var lp = R.loop;
      if (!lp.sup) return;
      var sE = lp.sup[lp.sup.length - 1], rS = lp.ret[0];
      o.push('<path d="' + isoPath(lp.sup, t) + '" style="fill:none;stroke:' + COL_SUP +
        ';stroke-width:0.4"/>');
      o.push('<path d="' + isoPath([sE, rS], t) + '" style="fill:none;stroke:' + COL_RET +
        ';stroke-width:0.4"/>');
      o.push('<path d="' + isoPath(lp.ret, t) + '" style="fill:none;stroke:' + COL_RET +
        ';stroke-width:0.4"/>');
      var mid = lp.sup[Math.floor(lp.sup.length / 2)];
      cards.push({ p: t.P(mid[0], mid[1], 0), lines: ['Контур ' + R.no,
        'Шаг ' + R.step + ' мм', 'L = ' + R.m + ' м', num1(R.flow) + ' л/мин'] });
    });

    // Таблички раскладываем по краям листа и тянем выноску к своей петле:
    // в середине вида им места нет, они закрыли бы укладку.
    var left = [], right = [];
    cards.forEach(function (c) {
      (c.p[0] < (ISO_BOX.x0 + ISO_BOX.x1) / 2 ? left : right).push(c);
    });
    [[left, 24, 1], [right, 380, -1]].forEach(function (g) {
      var arr = g[0], x = g[1], dir = g[2], y = 34;
      arr.sort(function (a, b) { return a.p[1] - b.p[1]; });
      arr.forEach(function (c) {
        var h = isoCard(o, x, y, c.lines, 30);
        var ax = dir > 0 ? x + 30 : x;
        o.push('<line x1="' + n(ax) + '" y1="' + n(y + h / 2) + '" x2="' + n(c.p[0]) +
          '" y2="' + n(c.p[1]) + '" style="stroke:#000;stroke-width:0.2"/>');
        o.push('<circle cx="' + n(c.p[0]) + '" cy="' + n(c.p[1]) +
          '" r="0.6" style="fill:#000"/>');
        y += h + 3.2;
      });
    });

    if (f.coll) {
      var c = t.P(f.coll.x, f.coll.y, 0);
      o.push('<circle cx="' + n(c[0]) + '" cy="' + n(c[1]) +
        '" r="2.4" style="fill:#fff;stroke:' + COLT.tp + ';stroke-width:0.5"/>');
      o.push(txt(c[0] + 4, c[1] - 2, 'Коллектор ТП', { size: 3.1 }));
    }

    o.push(txt(24, 258, 'Условные обозначения систем трубопроводов:', { size: 3.4 }));
    o.push('<line x1="24" y1="262" x2="44" y2="262" style="stroke:' + COL_SUP +
      ';stroke-width:0.8"/>');
    o.push(txt(46, 263.2, '— Т11, подающий трубопровод напольного отопления', { size: 3.2 }));
    o.push('<line x1="24" y1="267" x2="44" y2="267" style="stroke:' + COL_RET +
      ';stroke-width:0.8"/>');
    o.push(txt(46, 268.2, '— Т21, обратный трубопровод напольного отопления', { size: 3.2 }));
    return o.join('');
  }

  // ─── 3D вид радиаторного отопления ─────────────────────────────────────
  // В редакторе планов у радиатора есть только место под окном (x, y), длина
  // и угол стены. Трасс радиаторных труб и места коллектора там нет — ни
  // смета, ни гидравлика их из плана не берут. Поэтому вид строится так же,
  // как в проектах-образцах читается глазом: коллектор в котельной, от него
  // лучи вдоль осей плана к каждому прибору, у прибора подъём из пола.
  // Трасса схематичная, о чём сказано на листе; длины лучей — по этой трассе.

  var RAD_CONN_MM = 120;       // низ радиатора от чистого пола (образец: «не ниже 120 мм»)
  var RAD_COLL_MM = [900, 750]; // гребёнки коллектора на стене: подача выше обратки
  var RAD_OUTLET_MM = 50;      // шаг выходов коллектора
  var RAD_PAIR_MM = 25;        // полразноса подачи и обратки одного луча

  /**
   * Котельная этажа: зона типа «Котельная» или любая комната с таким
   * названием. В мастере раскладки котельная — обычная комната с именем
   * «Котельная», и коллекторы её не видели: встали в гостиную (03.10.2026).
   */
  var BOILER_NAME = /котельн|топочн|бойлерн/i;
  function boilerZone(f) {
    var zs = (f.zones || []).filter(function (z) { return z && z.pts && z.pts.length > 2 && z.type !== 'cold'; });
    return zs.filter(function (z) { return z.type === 'boiler'; })[0] ||
      zs.filter(function (z) { return BOILER_NAME.test(z.name || ''); })[0] || null;
  }

  /**
   * Место у стены комнаты z, ближайшей к точке to (обычно — к тому, что
   * коллектор питает), на 0,3 м внутрь: коллектор висит на стене, а не
   * стоит посреди комнаты. Возвращает [x, y] и направление стены [ux, uy].
   */
  function wallSpot(f, z, to, inM) {
    var P = z.pts, zc = centroid(P), best = null, bd = Infinity, ppm = f.pxPerM || 100;
    for (var i = 0; i < P.length; i++) {
      var a = P[i], b = P[(i + 1) % P.length];
      var dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      if (L2 < (0.5 * ppm) * (0.5 * ppm)) continue;             // огрызок контура — не стена
      var t = Math.max(0.15, Math.min(0.85, ((to[0] - a[0]) * dx + (to[1] - a[1]) * dy) / L2));
      var q = [a[0] + dx * t, a[1] + dy * t], d = Math.hypot(to[0] - q[0], to[1] - q[1]);
      if (d < bd) { bd = d; best = { q: q, u: [dx / Math.sqrt(L2), dy / Math.sqrt(L2)] }; }
    }
    if (!best) return { p: zc, u: [1, 0] };
    var vx = zc[0] - best.q[0], vy = zc[1] - best.q[1], vl = Math.hypot(vx, vy) || 1, in3 = Math.min((inM || 0.3) * ppm, vl / 2);
    // внутрь комнаты — перпендикулярно стене (а не к центру: у длинной комнаты центр далеко вбок)
    var nx0 = -best.u[1], ny0 = best.u[0];
    if (nx0 * vx + ny0 * vy < 0) { nx0 = -nx0; ny0 = -ny0; }
    return { p: [best.q[0] + nx0 * in3, best.q[1] + ny0 * in3], u: best.u, n: [nx0, ny0], q: best.q };
  }

  /** Угол коллектора (0/90/180/270) по внутренней нормали стены: отводы смотрят в комнату.
   *  0 — отводы вверх (стена снизу), 90 — вправо, 180 — вниз, 270 — влево. */
  function angFromNormal(n) {
    if (!n) return 0;
    var a = Math.round(Math.atan2(n[0], -n[1]) * 180 / Math.PI / 90) * 90;
    return ((a % 360) + 360) % 360;
  }

  /** Зона, в которой лежит точка, а если не лежит — ближайшая по стенам (не «без обогрева») */
  function roomAround(f, pt) {
    var zs = (f.zones || []).filter(function (z) { return z && z.pts && z.pts.length > 2 && z.type !== 'cold'; });
    for (var i = 0; i < zs.length; i++) if (pip(pt, zs[i].pts)) return zs[i];
    var best = null, bd = Infinity;
    zs.forEach(function (z) {
      for (var k = 0; k < z.pts.length; k++) {
        var a = z.pts[k], b = z.pts[(k + 1) % z.pts.length], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
        var t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / L2));
        var d = Math.hypot(pt[0] - a[0] - dx * t, pt[1] - a[1] - dy * t);
        if (d < bd) { bd = d; best = z; }
      }
    });
    return best;
  }

  /**
   * Коллектор — только у стены и вдоль неё. Точку (клик, перенос, середина комнаты) прижимаем
   * к ближайшей стене комнаты, в которой она лежит, на 0,16 м внутрь (корпус примыкает к стене).
   * Возвращает { x, y, ang } или null, если комнат нет.
   */
  function snapCollector(f, pt) {
    var z = roomAround(f, pt);
    if (!z) return null;
    var ppm = f.pxPerM || 100, P = z.pts, best = null, bd = Infinity;
    for (var i = 0; i < P.length; i++) {
      var a = P[i], b = P[(i + 1) % P.length], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      if (L2 < (0.45 * ppm) * (0.45 * ppm)) continue;                    // огрызок контура — не стена
      var t = Math.max(0.1, Math.min(0.9, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / L2));
      var q = [a[0] + dx * t, a[1] + dy * t], d = Math.hypot(pt[0] - q[0], pt[1] - q[1]), L = Math.sqrt(L2);
      if (d < bd) { bd = d; best = { q: q, u: [dx / L, dy / L] }; }
    }
    if (!best) return null;
    var zc = centroid(P), nx = -best.u[1], ny = best.u[0];
    if (nx * (zc[0] - best.q[0]) + ny * (zc[1] - best.q[1]) < 0) { nx = -nx; ny = -ny; }
    var inn = 0.16 * ppm;
    return { x: Math.round(best.q[0] + nx * inn), y: Math.round(best.q[1] + ny * inn), ang: angFromNormal([nx, ny]) };
  }

  /** Угол значка коллектора: заданный рукой, иначе по стене, у которой он стоит */
  function collAngle(f, kind) {
    var c = kind === 'rad' ? radCollector(f) : (f.coll || null);
    if (kind === 'rad') return typeof f.radCollAng === 'number' ? f.radCollAng : (c ? c.ang || 0 : 0);
    if (!c) return 0;
    if (typeof f.collAng === 'number') return f.collAng;
    var sp = snapCollector(f, [c.x, c.y]);
    return sp ? sp.ang : 0;
  }

  /** Средняя точка радиаторов этажа (или центр комнат, если их нет). */
  function radsCenter(f) {
    var sx = 0, sy = 0, rs = f.rads || [];
    rs.forEach(function (r) { sx += r.x; sy += r.y; });
    return rs.length ? [sx / rs.length, sy / rs.length] : null;
  }

  /**
   * Где стоит коллектор радиаторов этажа: поставлен вручную (f.radColl) →
   * у стены котельной, ближней к радиаторам → у коллектора ТП → центр
   * приборов. В котельной рядом с коллектором ТП — со сдвигом вдоль стены,
   * чтобы значки не легли друг на друга.
   */
  function radCollector(f) {
    var rAng = typeof f.radCollAng === 'number' ? f.radCollAng : null;
    if (f.radColl && isFinite(f.radColl.x)) {
      var sm = rAng == null ? snapCollector(f, [f.radColl.x, f.radColl.y]) : null;
      return { x: f.radColl.x, y: f.radColl.y, src: 'manual', ang: rAng != null ? rAng : (sm ? sm.ang : 0) };
    }
    var rc = radsCenter(f), bz = boilerZone(f), ppm0 = f.pxPerM || 100;
    // Котельной нет — комната, где стоит коллектор тёплого пола, а без него — ближайшая к приборам.
    // Коллектор в середину комнаты не ставим никогда: у стены и вдоль неё.
    var z = bz || (f.coll ? roomAround(f, [f.coll.x, f.coll.y]) : (rc ? roomAround(f, rc) : null));
    if (z) {
      var s = wallSpot(f, z, rc || centroid(z.pts), 0.16), p = s.p, ppm = ppm0;
      if (f.coll && Math.hypot(p[0] - f.coll.x, p[1] - f.coll.y) < 1.1 * ppm) {
        // корпуса длиннее при многих петлях/приборах: сдвиг с запасом, чтобы не лечь на коллектор пола
        var tries = [[p[0] + s.u[0] * 1.3 * ppm, p[1] + s.u[1] * 1.3 * ppm], [p[0] - s.u[0] * 1.3 * ppm, p[1] - s.u[1] * 1.3 * ppm]];
        p = tries.filter(function (q) { return pip(q, z.pts); })[0] || tries[0];
      }
      return { x: p[0], y: p[1], src: bz ? 'boiler' : (f.coll ? 'tp' : 'rads'), ang: rAng != null ? rAng : angFromNormal(s.n) };
    }
    if (f.coll) return { x: f.coll.x, y: f.coll.y, src: 'tp', ang: rAng || 0 };
    return rc ? { x: rc[0], y: rc[1], src: 'rads', ang: rAng || 0 } : { x: 0, y: 0, src: 'rads', ang: rAng || 0 };
  }

  /**
   * Трассы радиаторов этажа по плану — для плана дома в смете и КП.
   * Лучевая (tee=false): от коллектора радиаторов к каждому прибору своя пара
   * труб; общие участки складываются в пучок. Тройниковая: одна магистраль
   * обходит приборы по очереди (ближайший следующий). Трасса — по сетке этажа
   * тем же поиском, что подводки тёплого пола: вдоль стен, середину комнаты и
   * петли тёплого пола обходит, стену переходит, только если так заметно
   * короче (дверей план не знает). Подключение — у конца прибора, ближнего к
   * коллектору, в 12 см от стены.
   * Возвращает { C, tee, items: [{ i, p, pts, L }], segs: [{ a, b, n }], totalM }
   * или null. L — метров трубы к прибору (подача + обратка, с подъёмами).
   */
  var RAD_IN_M = 0.12;
  // Цена клетки для трассы радиаторов: стена дорогая — переходить её трасса
  // будет там, где комнаты смыкаются (в проёме), а не где придётся.
  var RCOST_WALL = 20, RCOST_MID = 2, RCOST_TP = 25, RCOST_COLD = 40, RCOST_OUT = 400;
  function radRoutes(f, stepMm, tee, connMap) {
    var rads = (f.rads || []).filter(function (r) { return r && isFinite(r.x) && isFinite(r.y); });
    if (!rads.length || !f.pxPerM) return null;
    var rooms = (f.zones || []).filter(function (z) { return z && z.pts && z.pts.length > 2 && z.type !== 'cold'; });
    if (!rooms.length) return null;
    var ppm = f.pxPerM, C = radCollector(f);
    var g = floorGrid({ pxPerM: ppm, coll: { x: C.x, y: C.y } },
      rooms.concat([{ pts: rads.map(function (r) { return [r.x, r.y]; }) }]));
    if (!g) return null;
    var N = g.W * g.H, own = new Int32Array(N), k;
    rooms.forEach(function (z, i) { polyCells(g, z.pts, function (q) { own[q] = i + 1; }); });
    var cold = new Uint8Array(N), tpM = new Uint8Array(N);
    (f.zones || []).forEach(function (z) {
      if (z && z.type === 'cold' && z.pts && z.pts.length > 2) polyCells(g, z.pts, function (q) { cold[q] = 1; });
    });
    // участки петель тёплого пола — трасса радиаторов их обходит
    try {
      floorLoops(f, stepMm || 150, loopLimit(stepMm || 150)).forEach(function (Z) {
        (Z.loops || []).forEach(function (l) {
          if (!l.rect) return;
          var a = cellAt(g, [l.rect[0], l.rect[1]]), b = cellAt(g, [l.rect[2], l.rect[3]]);
          for (var y = Math.floor(a / g.W); y <= Math.floor(b / g.W); y++)
            for (var x = a % g.W; x <= b % g.W; x++) tpM[y * g.W + x] = 1;
        });
      });
    } catch (e) { /* без тёплого пола — и обходить нечего */ }
    // Улица: клетка вне комнат дальше 0,4 м от ближайшей комнаты (дальше любой
    // стены). Трасса снаружи дома недопустима — первая версия обходила по полю
    // за стеной гостиную с тёплым полом.
    var near = new Uint8Array(N).fill(255), qq = new Int32Array(N), qh = 0, qt = 0;
    for (k = 0; k < N; k++) if (own[k]) { near[k] = 0; qq[qt++] = k; }
    while (qh < qt) {
      var c0 = qq[qh++], cx0 = c0 % g.W;
      if (near[c0] >= 4) continue;
      [cx0 > 0 ? c0 - 1 : -1, cx0 < g.W - 1 ? c0 + 1 : -1, c0 - g.W, c0 + g.W].forEach(function (m2) {
        if (m2 < 0 || m2 >= N || near[m2] !== 255) return;
        near[m2] = near[c0] + 1; qq[qt++] = m2;
      });
    }
    var wd = wallDist(g, own), cost = new Float32Array(N);
    for (k = 0; k < N; k++) {
      cost[k] = cold[k] ? RCOST_COLD : own[k]
        ? 1 + (wd[k] > 2 ? RCOST_MID : 0) + (tpM[k] ? RCOST_TP : 0)
        : (near[k] > 3 ? RCOST_OUT : RCOST_WALL);
    }
    // Точка подключения прибора — по его модели (radConnSide): по умолчанию
    // правое нижнее, как у радиаторов сметы; «правое» — если стоять в комнате
    // лицом к прибору. Раньше трасса шла к краю, ближнему к коллектору, и на
    // плане половина приборов выходила подключённой слева (03.10.2026).
    var sides = [];
    var conn = rads.map(function (r, ri) {
      var a = (r.ang || 0) * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
      var hw = (r.w || 0.8 * ppm) / 2 - 0.08 * ppm;
      // внутрь комнаты — та сторона прибора, где на 0,3 м лежит клетка комнаты
      var nx = -uy, ny = ux, s = 1, t1 = cellAt(g, [r.x + nx * 0.3 * ppm, r.y + ny * 0.3 * ppm]);
      if (!own[t1]) s = -1;
      var inx = nx * s, iny = ny * s;
      var room = own[cellAt(g, [r.x + inx * 0.3 * ppm, r.y + iny * 0.3 * ppm])];
      var side = radConnSide(r, room ? rooms[room - 1].name : '', connMap);
      // лицом к прибору смотрят против нормали внутрь; правая рука — (iny, −inx)
      var rx = iny, ry = -inx, e;
      if (side === 'C') e = [r.x, r.y];
      else if (side === 'R' || side === 'L') {
        var k = side === 'R' ? 1 : -1;
        e = [r.x + rx * hw * k, r.y + ry * hw * k];
      } else {                                         // боковое — к краю, ближнему к коллектору
        var e1 = [r.x + ux * hw, r.y + uy * hw], e2 = [r.x - ux * hw, r.y - uy * hw];
        e = (Math.abs(e1[0] - C.x) + Math.abs(e1[1] - C.y) <= Math.abs(e2[0] - C.x) + Math.abs(e2[1] - C.y)) ? e1 : e2;
      }
      sides[ri] = { side: side, end: e };
      return [e[0] + inx * RAD_IN_M * ppm, e[1] + iny * RAD_IN_M * ppm];
    });
    var src = cellAt(g, [C.x, C.y]);
    var trace = function (from, goalCell) {
      var goal = new Int32Array(N).fill(-1);
      goal[goalCell] = 0;
      var R = routeAll(g, cost, from, goal, 1), best = -1, bd = Infinity;
      for (var d = 0; d < 4; d++) if (R.dist[goalCell * 4 + d] < bd) { bd = R.dist[goalCell * 4 + d]; best = goalCell * 4 + d; }
      if (best < 0) return null;
      var cells = [];
      for (var q = best; q >= 0; q = R.prev[q]) cells.push(q >> 2);
      return cells.reverse();
    };
    var cnt = {}, items = [];
    var addCells = function (cells, w) {
      for (var j = 1; j < cells.length; j++) {
        var a = cells[j - 1], b = cells[j];
        if (a === b) continue;
        var key = Math.min(a, b) + ':' + Math.max(a, b);
        cnt[key] = (cnt[key] || 0) + w;
      }
    };
    var clean = function (P) {
      var out = [];
      P.forEach(function (p) {
        var L = out.length;
        if (L && Math.abs(out[L - 1][0] - p[0]) < 1e-6 && Math.abs(out[L - 1][1] - p[1]) < 1e-6) return;
        if (L >= 2) {
          var a = out[L - 2], b = out[L - 1];
          if ((Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(b[0] - p[0]) < 1e-6) ||
              (Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(b[1] - p[1]) < 1e-6)) { out[L - 1] = p; return; }
        }
        out.push(p);
      });
      return out;
    };
    var rise = (RAD_COLL_MM[0] + RAD_CONN_MM) / 1000;
    // комната прибора — та, где точка подключения (она с комнатной стороны)
    var roomOfConn = function (p) {
      for (var j = rooms.length - 1; j >= 0; j--) if (pip(p, rooms[j].pts)) return rooms[j].name || '';
      var z = zoneOfPoint(f, p);
      return z ? z.name || '' : '';
    };
    if (!tee) {
      rads.forEach(function (r, i) {
        var cells = trace(src, cellAt(g, conn[i]));
        if (!cells) return;
        addCells(cells, 1);
        var full = orthoPath([[C.x, C.y]].concat(cells.map(function (q) { return cellXY(g, q); }), [conn[i]]));
        var pts = clean(full);
        items.push({ i: i, p: conn[i], pts: pts, full: full, L: 2 * (lenPoly(pts) / ppm + rise), room: roomOfConn(conn[i]) });
      });
    } else {
      var left = rads.map(function (r, i) { return i; }), at = src, prevP = [C.x, C.y], trunk = [[C.x, C.y]];
      while (left.length) {
        var bi = 0, bd = Infinity, ac = cellXY(g, at);
        left.forEach(function (i, j) {
          var d = Math.abs(conn[i][0] - ac[0]) + Math.abs(conn[i][1] - ac[1]);
          if (d < bd) { bd = d; bi = j; }
        });
        var i = left.splice(bi, 1)[0], gc = cellAt(g, conn[i]);
        var cells = trace(at, gc);
        if (cells) {
          addCells(cells, 2);
          var leg = clean(orthoPath([prevP].concat(cells.map(function (q) { return cellXY(g, q); }), [conn[i]])));
          trunk = trunk.concat(leg.slice(1));
          items.push({ i: i, p: conn[i], pts: leg, L: 2 * (lenPoly(leg) / ppm) + 2 * RAD_CONN_MM / 1000, room: roomOfConn(conn[i]) });
          at = gc; prevP = conn[i];
        }
      }
      if (items.length) items[0].L += 2 * RAD_COLL_MM[0] / 1000;
    }
    // отрезки для рисования: подряд идущие клетки одной линии с одним числом труб
    var segs = [], runs = {};
    Object.keys(cnt).forEach(function (key) {
      var ab = key.split(':'), a = +ab[0], b = +ab[1], hz = b - a === 1;
      var line = hz ? Math.floor(a / g.W) : a % g.W, pos = hz ? a % g.W : Math.floor(a / g.W);
      var rk = (hz ? 'h' : 'v') + line + ':' + cnt[key];
      (runs[rk] = runs[rk] || []).push(pos);
    });
    Object.keys(runs).forEach(function (rk) {
      var hz = rk[0] === 'h', parts = rk.slice(1).split(':'), line = +parts[0], n = +parts[1];
      var ps = runs[rk].sort(function (x, y) { return x - y; }), i0, j0;
      for (i0 = 0; i0 < ps.length; i0 = j0) {
        for (j0 = i0 + 1; j0 < ps.length && ps[j0] === ps[j0 - 1] + 1; j0++) { /* сплошной участок */ }
        var a0 = hz ? line * g.W + ps[i0] : ps[i0] * g.W + line;
        var a1 = hz ? line * g.W + ps[j0 - 1] + 1 : (ps[j0 - 1] + 1) * g.W + line;
        segs.push({ a: cellXY(g, a0), b: cellXY(g, a1), n: n });
      }
    });
    items.forEach(function (it) {                  // хвост от клетки к самой точке подключения
      var P = it.pts, q = P[P.length - 1], pr = P[P.length - 2];
      if (pr) segs.push({ a: pr, b: q, n: tee ? 2 : 1 });
    });
    var total = items.reduce(function (s, it) { return s + it.L; }, 0);
    items.forEach(function (it) { if (sides[it.i]) { it.side = sides[it.i].side; it.end = sides[it.i].end; } });
    return { C: C, tee: !!tee, items: items, segs: segs, totalM: total, sides: sides };
  }

  /**
   * Сторона подключения прибора на плане: 'R' — нижнее правое, 'L' — нижнее
   * левое, 'C' — нижнее центральное, 'S' — боковое (к краю, ближнему к
   * коллектору). Развернул монтажник на плане (r.conn) — его выбор; иначе — по
   * модели прибора этой комнаты в смете (connMap: имя комнаты → сторона, его
   * собирает калькулятор, app.radConnMap); иначе — правое нижнее, как у
   * радиаторов по умолчанию.
   */
  function radConnSide(r, roomName, connMap) {
    if (r && (r.conn === 'R' || r.conn === 'L')) return r.conn;
    var key = String(roomName || '').trim().toLowerCase();
    var s = connMap && key ? connMap[key] : null;
    return (s === 'L' || s === 'C' || s === 'S') ? s : 'R';
  }

  /** Сторона подключения по названию и типу прибора сметы (bottom — нижнее). */
  function radSideOfModel(name, bottom) {
    if (!bottom) return 'S';
    var n = String(name || '').toLowerCase();
    if (/левосторон|нижн[а-я]*\s+лев|лев[а-я]*\s+нижн/.test(n)) return 'L';
    if (/центральн/.test(n)) return 'C';
    return 'R';
  }

  /** Зона, к которой относится прибор: та, внутри которой он стоит, иначе ближайшая */
  function zoneOfPoint(f, p) {
    var zs = (f.zones || []).filter(function (z) { return z.pts && z.pts.length > 2; });
    for (var i = 0; i < zs.length; i++) if (pip(p, zs[i].pts)) return zs[i];
    // Радиатор ставят на стену, то есть на границу зоны — ray casting его
    // часто не находит. Берём зону с ближайшей вершиной или серединой ребра.
    var best = null, bd = 1e18;
    zs.forEach(function (z) {
      z.pts.forEach(function (a, k) {
        var b = z.pts[(k + 1) % z.pts.length];
        [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]].forEach(function (q) {
          var d = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (d < bd) { bd = d; best = z; }
        });
      });
    });
    return best;
  }

  /** Вертикальный отрезок в изометрии: подъём трубы или спуск с коллектора */
  function isoRise(o, t, p, z1, z2, col, w) {
    var a = t.P(p[0], p[1], z1), b = t.P(p[0], p[1], z2);
    o.push('<line x1="' + n(a[0]) + '" y1="' + n(a[1]) + '" x2="' + n(b[0]) + '" y2="' + n(b[1]) +
      '" style="stroke:' + col + ';stroke-width:' + (w || 0.45) + '"/>');
  }

  /** Радиатор в изометрии: лицевая плоскость вдоль стены с рёбрами секций */
  function isoRadiator(o, t, f, r, hMm) {
    var ppm = f.pxPerM || 100, ang = (r.ang || 0) * Math.PI / 180;
    var ux = Math.cos(ang), uy = Math.sin(ang), hw = (r.w || 0.8 * ppm) / 2;
    var a = [r.x - ux * hw, r.y - uy * hw], b = [r.x + ux * hw, r.y + uy * hw];
    var z1 = t.mm(RAD_CONN_MM), z2 = t.mm(RAD_CONN_MM + hMm);
    var q = [t.P(a[0], a[1], z1), t.P(b[0], b[1], z1), t.P(b[0], b[1], z2), t.P(a[0], a[1], z2)];
    o.push('<polygon points="' + q.map(function (p) { return n(p[0]) + ',' + n(p[1]); }).join(' ') +
      // Цвет и прозрачность раздельно: rgba() в fill понимают не все
      // растеризаторы PDF, и прибор уходил в сплошной чёрный.
      '" style="fill:#d22222;fill-opacity:0.2;stroke:#d22222;stroke-width:0.35"/>');
    var ribs = Math.max(3, Math.min(10, Math.round((2 * hw / ppm) / 0.12)));
    for (var k = 1; k < ribs; k++) {
      var s = k / ribs, px = a[0] + (b[0] - a[0]) * s, py = a[1] + (b[1] - a[1]) * s;
      var p1 = t.P(px, py, z1), p2 = t.P(px, py, z2);
      o.push('<line x1="' + n(p1[0]) + '" y1="' + n(p1[1]) + '" x2="' + n(p2[0]) + '" y2="' +
        n(p2[1]) + '" style="stroke:#d22222;stroke-width:0.15"/>');
    }
    return { a: a, b: b };
  }

  /**
   * Лист «Этаж N. 3D вид отопления».
   * opts: { rooms, tee, radH } — tee: тройниковая схема (одна магистраль через
   * приборы вместо лучей), radH — высота радиатора, мм.
   */
  function isoRadBody(f, num, opts) {
    opts = opts || {};
    var t = isoFit(f), o = [];
    isoShell(f, t, o);
    var ppm = f.pxPerM || 100, px = function (mm) { return mm / 1000 * ppm; };
    var rooms = (opts.rooms || []).filter(function (r) { return (r.floor || 1) === num; });
    var hMm = opts.radH || 500;
    var C = radCollector(f);
    var rads = (f.rads || []).slice();
    var zC = [t.mm(RAD_COLL_MM[0]), t.mm(RAD_COLL_MM[1])];
    var e = px(RAD_PAIR_MM);

    // Порядок приборов: по часовой вокруг коллектора. Выходы гребёнки идут в
    // том же порядке, и соседние лучи не перекрещиваются у коллектора.
    rads.forEach(function (r) { r._a = Math.atan2(r.y - C.y, r.x - C.x); });
    rads.sort(function (a, b) { return a._a - b._a; });

    var cards = [], outlets = [];
    if (!opts.tee) {
      var N = rads.length, step = px(RAD_OUTLET_MM);
      rads.forEach(function (r, i) {
        var xi = C.x + (i - (N - 1) / 2) * step;
        var sup = [[xi - e, C.y], [xi - e, r.y - e], [r.x, r.y - e]];
        var ret = [[xi + e, C.y], [xi + e, r.y + e], [r.x, r.y + e]];
        o.push('<path d="' + isoPath(sup, t) + '" style="fill:none;stroke:' + COL_SUP + ';stroke-width:0.45"/>');
        o.push('<path d="' + isoPath(ret, t) + '" style="fill:none;stroke:' + COL_RET + ';stroke-width:0.45"/>');
        // спуск от гребёнки к полу и подъём к прибору
        isoRise(o, t, sup[0], 0, zC[0], COL_SUP);
        isoRise(o, t, ret[0], 0, zC[1], COL_RET);
        isoRise(o, t, sup[2], 0, t.mm(RAD_CONN_MM), COL_SUP);
        isoRise(o, t, ret[2], 0, t.mm(RAD_CONN_MM), COL_RET);
        outlets.push(xi);
        // Длина луча в одну сторону: трасса по полу, спуск с гребёнки, подъём к прибору
        var L = (lenPoly(sup) / ppm) + RAD_COLL_MM[0] / 1000 + RAD_CONN_MM / 1000;
        r._L = Math.round(L * 10) / 10;
      });
    } else {
      // Тройниковая: подача и обратка одной магистралью от коллектора через
      // приборы по кратчайшему обходу, от магистрали — короткий подъём.
      var left = rads.slice(), cur = [C.x, C.y], order = [];
      while (left.length) {
        var bi = 0, bd = 1e18;
        left.forEach(function (r, k) {
          var d = Math.abs(r.x - cur[0]) + Math.abs(r.y - cur[1]);
          if (d < bd) { bd = d; bi = k; }
        });
        var nx = left.splice(bi, 1)[0];
        order.push(nx); cur = [nx.x, nx.y];
      }
      rads = order;
      var trunk = orthoPath([[C.x, C.y]].concat(rads.map(function (r) { return [r.x, r.y]; })));
      var tSup = offsetOrtho(trunk, e) || trunk, tRet = offsetOrtho(trunk, -e) || trunk;
      o.push('<path d="' + isoPath(tSup, t) + '" style="fill:none;stroke:' + COL_SUP + ';stroke-width:0.55"/>');
      o.push('<path d="' + isoPath(tRet, t) + '" style="fill:none;stroke:' + COL_RET + ';stroke-width:0.55"/>');
      isoRise(o, t, tSup[0], 0, zC[0], COL_SUP);
      isoRise(o, t, tRet[0], 0, zC[1], COL_RET);
      rads.forEach(function (r) {
        isoRise(o, t, [r.x, r.y], 0, t.mm(RAD_CONN_MM), '#6b7280', 0.35);
      });
    }

    // Коллектор: две гребёнки на стене котельной
    var span = Math.max(px(200), (outlets.length ? outlets[outlets.length - 1] - outlets[0] : 0) + px(120));
    [[zC[0], COL_SUP], [zC[1], COL_RET]].forEach(function (g) {
      var a = t.P(C.x - span / 2, C.y, g[0]), b = t.P(C.x + span / 2, C.y, g[0]);
      o.push('<line x1="' + n(a[0]) + '" y1="' + n(a[1]) + '" x2="' + n(b[0]) + '" y2="' + n(b[1]) +
        '" style="stroke:' + g[1] + ';stroke-width:1.3;stroke-linecap:round"/>');
    });
    var cP = t.P(C.x + span / 2, C.y, zC[0]);
    // Подложка прямоугольником, а не обводкой букв: paint-order при печати в
    // PDF поддержан не везде, и белая обводка закрывала саму подпись.
    var cLbl = opts.tee ? 'Подключение магистрали' : 'Коллектор радиаторов';
    o.push('<rect x="' + n(cP[0] + 2.2) + '" y="' + n(cP[1] - 5.6) + '" width="' + n(cLbl.length * 1.62 + 1.6) +
      '" height="4.6" rx="0.6" style="fill:#ffffff;fill-opacity:0.9;stroke:none"/>');
    o.push(txt(cP[0] + 3, cP[1] - 2.2, cLbl, { size: 3.1 }));

    // приборы и таблички
    rads.forEach(function (r, i) {
      isoRadiator(o, t, f, r, hMm);
      var z = zoneOfPoint(f, [r.x, r.y]);
      var room = z ? roomOf(z.name, rooms) : null;
      var nm = room ? room.name : (z && z.name ? z.name : '');
      var lines = ['Прибор ' + (i + 1)];
      if (nm) lines.push(nm.length > 18 ? nm.slice(0, 17) + '…' : nm);
      if (!opts.tee && r._L) lines.push('Луч ' + num1(r._L) + ' м');
      else if (room && room.q > 0) lines.push('Пом. ' + Math.round(room.q) + ' Вт');
      var top = t.P(r.x, r.y, t.mm(RAD_CONN_MM + hMm));
      cards.push({ p: top, lines: lines, no: i + 1 });
    });

    // Таблички по краям листа, как на 3D виде тёплого пола. Не влезли по
    // высоте — остаётся номер у самого прибора: он совпадает с табличкой,
    // если её потом допишут руками.
    var L2 = [], R2 = [];
    cards.forEach(function (c) { (c.p[0] < (ISO_BOX.x0 + ISO_BOX.x1) / 2 ? L2 : R2).push(c); });
    [[L2, 24, 1], [R2, 372, -1]].forEach(function (g) {
      var arr = g[0], x = g[1], dir = g[2], y = 34;
      arr.sort(function (a, b) { return a.p[1] - b.p[1]; });
      arr.forEach(function (c) {
        var h = 5.4 * c.lines.length;
        if (y + h > 246) {
          o.push('<rect x="' + n(c.p[0] - 2.4) + '" y="' + n(c.p[1] - 5) + '" width="4.8" height="4.4" rx="0.6"' +
            ' style="fill:#ffffff;stroke:#000;stroke-width:0.2"/>');
          o.push(txt(c.p[0], c.p[1] - 1.7, String(c.no), { size: 3.1, anchor: 'middle' }));
          return;
        }
        isoCard(o, x, y, c.lines, 38);
        var ax = dir > 0 ? x + 38 : x;
        o.push('<line x1="' + n(ax) + '" y1="' + n(y + h / 2) + '" x2="' + n(c.p[0]) +
          '" y2="' + n(c.p[1]) + '" style="stroke:#000;stroke-width:0.2"/>');
        o.push('<circle cx="' + n(c.p[0]) + '" cy="' + n(c.p[1]) + '" r="0.6" style="fill:#000"/>');
        y += h + 3.2;
      });
    });

    o.push(txt(24, 252, 'Условные обозначения систем трубопроводов:', { size: 3.4 }));
    o.push('<line x1="24" y1="256" x2="44" y2="256" style="stroke:' + COL_SUP + ';stroke-width:0.8"/>');
    o.push(txt(46, 257.2, '— Т1, подающий трубопровод радиаторного отопления', { size: 3.2 }));
    o.push('<line x1="24" y1="261" x2="44" y2="261" style="stroke:' + COL_RET + ';stroke-width:0.8"/>');
    o.push(txt(46, 262.2, '— Т2, обратный трубопровод радиаторного отопления', { size: 3.2 }));
    var notes = [
      (opts.tee ? 'Схема тройниковая. ' : 'Схема коллекторная (лучевая). ') +
        'Трассы показаны схематично, вдоль осей плана; фактическая прокладка — по месту.',
      'Низ радиаторов — ' + RAD_CONN_MM + ' мм от чистого пола; трубы в теплоизоляции, соединения в стяжке не допускаются.'
    ];
    if (C.src === 'tp') notes.push('Котельной на этом этаже нет — коллектор радиаторов показан у коллектора тёплого пола.');
    else if (C.src === 'rads') notes.push('Котельной на этом этаже нет — положение коллектора принято условно.');
    notes.forEach(function (s, i) { o.push(txt(24, 268 + i * 4.4, s, { size: 3.0 })); });
    return o.join('');
  }

  /** Лист «Этаж N. 3D вид водоснабжения» либо «…канализации» */
  function isoPipeBody(f, num, kind) {
    var t = isoFit(f), o = [];
    isoShell(f, t, o);
    var lines = kind === 'sewer' ? (f.slines || []) : (f.wlines || []);
    lines.forEach(function (L) {
      if (!L.pts || L.pts.length < 2) return;
      o.push('<path d="' + isoPath(L.pts, t) + '" style="fill:none;stroke:' +
        (kind === 'sewer' ? '#7a5c2e' : '#0b8a8f') + ';stroke-width:' +
        (kind === 'sewer' ? 0.7 : 0.5) + '"/>');
    });
    (f.fixtures || []).forEach(function (fx) {
      var p = t.P(fx.x, fx.y, 0);
      o.push('<circle cx="' + n(p[0]) + '" cy="' + n(p[1]) +
        '" r="1.6" style="fill:#fff;stroke:' + COLT.wc + ';stroke-width:0.4"/>');
    });
    o.push(txt(24, 258, 'Условные обозначения систем трубопроводов:', { size: 3.4 }));
    if (kind === 'sewer') {
      o.push('<line x1="24" y1="262" x2="44" y2="262" style="stroke:#7a5c2e;stroke-width:0.8"/>');
      o.push(txt(46, 263.2, '— К1, трубопровод бытовой канализации', { size: 3.2 }));
    } else {
      o.push('<line x1="24" y1="262" x2="44" y2="262" style="stroke:#0b8a8f;stroke-width:0.8"/>');
      o.push(txt(46, 263.2, '— В1, Т3, трубопроводы водоснабжения', { size: 3.2 }));
    }
    return o.join('');
  }

  /**
   * Листы объёмных видов систем по этажам.
   * opts.kind: 'tp' | 'rad' | 'water' | 'sewer'
   */
  function iso3dSheets(plans, opts) {
    opts = opts || {};
    var out = [], num = opts.sheetStart || 1;
    var fmt = opts.num || function (v) { return String(v); };
    var kind = opts.kind || 'tp';
    if (!plans || !plans.floors) return out;
    plans.floors.forEach(function (f, i) {
      if (!f.img || !f.pxPerM) return;
      if (opts.floor && opts.floor !== i + 1) return;
      var body, ttl;
      if (kind === 'tp') {
        if (!(f.zones || []).some(function (z) { return (z.type || 'tp') === 'tp'; })) return;
        ttl = 'Этаж 0' + (i + 1) + '. 3D вид напольного отопления';
        body = isoTpBody(f, i + 1, opts.stepMm || 150, opts.rooms);
      } else if (kind === 'rad') {
        if (!(f.rads || []).length) return;
        ttl = 'Этаж 0' + (i + 1) + '. 3D вид отопления';
        body = isoRadBody(f, i + 1, { rooms: opts.rooms, tee: !!opts.tee, radH: opts.radH });
      } else if (kind === 'sewer') {
        if (!(f.slines || []).length) return;
        ttl = 'Этаж 0' + (i + 1) + '. 3D вид канализации';
        body = isoPipeBody(f, i + 1, 'sewer');
      } else {
        if (!(f.fixtures || []).length) return;
        ttl = 'Этаж 0' + (i + 1) + '. 3D вид водоснабжения';
        body = isoPipeBody(f, i + 1, 'water');
      }
      out.push({ title: ttl, svg: window.projectSheets.sheet({
        code: opts.code, sheet: fmt(num++), body: title(ttl) + body }) });
    });
    return out;
  }

  /** Лист «Тёплый пол N этажа». rooms — помещения расчёта (теплопотери) */
  /**
   * Пучок подводок — как на листах проектов: тёмная полоса труб в изоляции,
   * шириной по числу труб в ней. k — толщина относительно листа ТП
   * (на сводном плане тоньше).
   */
  // Рисуем уже, чем вырезаем из петель: на листах проектов пучок — плотная
  // полоса, а запас до петель остаётся белым.
  var COL_BUNDLE = '#4d3f66', BUNDLE_DRAW_M = 0.02;
  function drawBundle(o, segs, t, f, k) {
    (segs || []).forEach(function (sg) {
      var w = Math.max(0.45, sg.n * 2 * BUNDLE_DRAW_M * (f.pxPerM || 100) * t.s) * (k || 1);
      o.push('<line x1="' + n(t.X(sg.a[0])) + '" y1="' + n(t.Y(sg.a[1])) + '" x2="' + n(t.X(sg.b[0])) +
        '" y2="' + n(t.Y(sg.b[1])) + '" style="stroke:' + COL_BUNDLE + ';stroke-opacity:0.85;stroke-width:' +
        n(w) + ';stroke-linecap:square"/>');
    });
  }

  // ═══ Лист «Этаж N. План напольного отопления» ════════════════════════════
  // Оформление — по листам проектов корпуса Galf: план в середине, у каждой
  // петли табличка на полях («Контур N / Шаг / L / расход») с выноской к
  // точке на петле, размеры петель синим, экспликация помещений справа
  // вверху, «Общие условия» списком внизу, обозначения Т11/Т21 над штампом.

  var TP_PLAN = { x0: 64, y0: 24, x1: 292, y1: 248 };   // поле плана, мм листа
  var TP_CARD = { w: 34, gap: 1.8 };
  var COL_DIM = '#1f4fe0';

  /** Точка на ломаной на доле frac её длины */
  function pointAt(P, frac) {
    var L = lenPoly(P) * frac, i;
    for (i = 1; i < P.length; i++) {
      var d = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      if (L <= d && d > 0) return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * L / d, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * L / d];
      L -= d;
    }
    return P[P.length - 1];
  }

  /** Размерная линия чертежа: засечки 45°, число над линией (мм) */
  function dimLine(o, a, b, label, vert) {
    var sz = 2.2;
    o.push('<line x1="' + n(a[0]) + '" y1="' + n(a[1]) + '" x2="' + n(b[0]) + '" y2="' + n(b[1]) +
      '" style="stroke:' + COL_DIM + ';stroke-width:0.18"/>');
    [a, b].forEach(function (p) {
      o.push('<line x1="' + n(p[0] - 0.9) + '" y1="' + n(p[1] + 0.9) + '" x2="' + n(p[0] + 0.9) + '" y2="' +
        n(p[1] - 0.9) + '" style="stroke:' + COL_DIM + ';stroke-width:0.3"/>');
    });
    var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if (vert) o.push('<text x="' + n(mx - 0.7) + '" y="' + n(my) + '" font-size="' + sz + '" text-anchor="middle"' +
      ' transform="rotate(-90 ' + n(mx - 0.7) + ' ' + n(my) + ')" style="fill:' + COL_DIM + '">' + esc(label) + '</text>');
    else o.push(txt(mx, my - 0.7, label, { size: sz, anchor: 'middle', fill: COL_DIM }));
  }

  /**
   * Таблички контуров по двум колонкам: петли левой половины плана — слева,
   * правой — справа; в колонке — по высоте своей точки, без наложений.
   */
  function placeCards(cards, cx, rowH, cols, fr) {
    var TP_COL = cols || { left: 24, right: 298 };
    var W = TP_CARD.w, H = rowH * 4, step = H + TP_CARD.gap, top = TP_PLAN.y0, bot = TP_PLAN.y1;
    var cap = Math.max(1, Math.floor((bot - top + TP_CARD.gap) / step));
    var L = cards.filter(function (c) { return c.p[0] < cx; }), R = cards.filter(function (c) { return c.p[0] >= cx; });
    // переполненная колонка отдаёт ближние к середине таблички соседней
    var move = function (from, to) {
      from.sort(function (a, b) { return Math.abs(a.p[0] - cx) - Math.abs(b.p[0] - cx); });
      while (from.length > cap && to.length < cap) to.push(from.shift());
    };
    move(L, R); move(R, L);
    // Колонка длиннее самого плана — выноски пошли бы вкось. Лишние таблички
    // (нижних петель — под план, верхних — над ним) ставим строкой с
    // вертикальными выносками, как на листах проектов с большим числом петель.
    var rows = { B: [], T: [] };
    if (fr) {
      fr.rx0 = TP_COL.left + W + 3; fr.rx1 = TP_COL.right - 3;
      fr.rowCap = Math.max(0, Math.floor((fr.rx1 - fr.rx0 + TP_CARD.gap) / (W + TP_CARD.gap)));
      fr.yB = Math.min(bot - H, fr.pB + 6); fr.yT = Math.max(top, fr.pT - 6 - H);
      fr.okB = fr.yB >= fr.pB + 3; fr.okT = fr.yT + H <= fr.pT - 3;
    }
    // Выноска горизонтальна, если линия под первой строкой таблички проходит
    // через свою петлю. Петля — отрезок по высоте [верх, низ]; раздаём места
    // «по раннему концу»: так в свою петлю попадает больше всего выносок.
    var lo = function (c) { return c.bb ? c.bb[1] + 1.2 : c.p[1]; };
    var hi = function (c) { return c.bb ? c.bb[3] - 1.2 : c.p[1]; };
    var layCol = function (A, X) {
      A.sort(function (a, b) { return hi(a) - hi(b) || lo(a) - lo(b); });
      A.forEach(function (c, i) {
        c.x = X; c.side = X === TP_COL.left ? 'L' : 'R';
        var want = Math.min(Math.max(lo(c), c.p[1] - 0.25 * (hi(c) - lo(c))), hi(c)) - rowH;
        c.y = Math.max(i ? A[i - 1].y + step : TP_PLAN.y0, Math.min(want, TP_PLAN.y1 - H));
      });
      for (var i = A.length - 1; i >= 0; i--) {       // упёрлись в низ — поджимаем вверх
        var lim = i === A.length - 1 ? TP_PLAN.y1 - H : A[i + 1].y - step;
        if (A[i].y > lim) A[i].y = Math.max(TP_PLAN.y0, lim);
      }
    };
    var layRow = function (A, Y, side) {
      A.sort(function (a, b) { return a.p[0] - b.p[0]; });
      A.forEach(function (c, k) {
        c.side = side; c.y = Y;
        c.x = Math.max(k ? A[k - 1].x + W + TP_CARD.gap : fr.rx0, Math.min(c.p[0] - W / 2, fr.rx1 - W));
      });
      for (var i = A.length - 1; i >= 0; i--) {
        var lim = i === A.length - 1 ? fr.rx1 - W : A[i + 1].x - W - TP_CARD.gap;
        if (A[i].x > lim) A[i].x = Math.max(fr.rx0, lim);
      }
    };
    // Табличка не дотянулась до своей петли — переезжает в строку над или под
    // планом (пока там есть место), и колонки раскладываются заново.
    for (var it = 0; it < 12; it++) {
      layCol(L, TP_COL.left); layCol(R, TP_COL.right);
      if (!fr || !fr.rowCap) break;
      var moved = false;
      [L, R].forEach(function (A) {
        for (var k = A.length - 1; k >= 0; k--) {
          var c = A[k], ay = c.y + rowH;
          if (ay >= lo(c) - 0.3 && ay <= hi(c) + 0.3) continue;
          var up = c.p[1] < (fr.pT + fr.pB) / 2;
          var to = up && fr.okT && rows.T.length < fr.rowCap ? rows.T
            : (fr.okB && rows.B.length < fr.rowCap ? rows.B : (fr.okT && rows.T.length < fr.rowCap ? rows.T : null));
          if (!to) continue;
          to.push(A.splice(k, 1)[0]); moved = true;
          break;                                     // по одной: остальные могут встать после перекладки
        }
      });
      if (!moved) break;
    }
    if (fr && fr.rowCap) { layRow(rows.B, fr.yB, 'B'); layRow(rows.T, fr.yT, 'T'); }
    return L.length <= cap && R.length <= cap;
  }

  function outWord(k) {
    var m = k % 10, h = k % 100;
    return m === 1 && h !== 11 ? 'выход' : (m >= 2 && m <= 4 && (h < 12 || h > 14) ? 'выхода' : 'выходов');
  }
  /** Номер помещения в экспликации: из расчёта, а без него — этаж.порядок */
  function roomNo(r, num, i) {
    return (r && r.id != null && String(r.id) !== '') ? String(r.id) : num + '.' + (i + 1);
  }

  /**
   * Подписи комнат на плане ТП, как у проектировщиков: (номер) имя, Вт, м².
   * Мелкая рамка — труба под ней всё равно читается; ставится внутри своей
   * комнаты, без наложения на другие подписи.
   */
  function tpRoomTags(o, f, t, rooms, num) {
    if (!rooms || !rooms.length) return;
    var byName = {}, idx = {};
    rooms.forEach(function (r, i) { var k = String(r.name || '').trim().toLowerCase(); if (!(k in byName)) { byName[k] = r; idx[k] = i; } });
    var used = {}, lp = labelPlacer();
    var toImg = function (X, Y) { return [(X - t.ox) / t.s, (Y - t.oy) / t.s]; };
    (f.zones || []).forEach(function (z) {
      var key = String(z.name || '').trim().toLowerCase(), r = byName[key];
      if (!r || used[key] || !z.pts || z.pts.length < 3) return;
      used[key] = 1;
      var c = centroid(z.pts), X0 = t.X(c[0]), Y0 = t.Y(c[1]);
      var lines = ['(' + roomNo(r, num, idx[key]) + ')', r.name];
      if (r.q > 0) lines.push(Math.round(r.q) + ' Вт');
      lines.push((+r.area || 0).toFixed(1) + ' м²');
      var w = Math.max(11, textW(r.name, 1.9) + 1.6), step = 2.4, h = step * lines.length + 1.4;
      var cands = [];
      for (var dx = -16; dx <= 16; dx += 2) for (var dy = -12; dy <= 12; dy += 1.5) {
        var X = X0 + dx, Y = Y0 + dy;
        var b = [X - w / 2, Y - h / 2, X + w / 2, Y + h / 2]; b.p = [X, Y];
        var out = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]]
          .filter(function (p) { return !pip(toImg(p[0], p[1]), z.pts); }).length;
        b.pen = out * 400 + Math.hypot(dx, dy) * 0.05;
        cands.push(b);
      }
      cands.sort(function (a, b) { return a.pen - b.pen; });
      var b2 = lp.place(cands), X = b2.p[0], Y = b2.p[1];
      o.push('<rect x="' + n(X - w / 2) + '" y="' + n(Y - h / 2) + '" width="' + n(w) + '" height="' + n(h) +
        '" rx="0.5" style="fill:#ffffff;fill-opacity:0.82;stroke:#000;stroke-width:0.15"/>');
      lines.forEach(function (s2, i) {
        o.push(txt(X, Y - h / 2 + 2.3 + i * step, s2, { size: i ? 1.9 : 2.2, anchor: 'middle' }));
      });
    });
  }

  function tpBody(f, num, stepMm, rooms, opts) {
    opts = opts || {};
    var t = fit(f, TP_PLAN), o = [];
    var vecWalls = wallsBody(f, t);                 // стены и окна — вектором, как на сводном плане
    o.push(vecWalls || imageTag(f, t, 0.32));
    var bundle = floorLoops(f, stepMm, loopLimit(stepMm)).bundle || [];
    var anyAuto = bundle.length > 0, anyCold = false;
    var flowSum = 0, cards = [], ppm = f.pxPerM || 100, Ex0 = 340;   // Ex0 — левый край экспликации
    rooms = (rooms || []).filter(function (r) { return (r.floor || 1) === num; });
    // места без обогрева (лестница, колонна) — серым контуром с перекрестьем
    (f.zones || []).forEach(function (z) {
      if (z.type !== 'cold' || !z.pts || z.pts.length < 3) return;
      anyCold = true;
      o.push('<polygon points="' + polyPts(z.pts, t.X, t.Y) + '" style="fill:rgba(120,120,120,0.10);stroke:' +
        COLT.cold + ';stroke-width:0.35"/>');
      var b = bbox(z.pts);
      o.push('<path d="' + pathD([[b[0], b[1]], [b[2], b[3]]], t) + pathD([[b[2], b[1]], [b[0], b[3]]], t) +
        '" style="fill:none;stroke:' + COLT.cold + ';stroke-width:0.2"/>');
    });
    drawBundle(o, bundle, t, f, 1);
    // Петли считает общий расчёт: ровно те же числа уходят в смету и в
    // таблицу контуров на листе узла коллектора.
    var dims = [];
    loopRows(f, stepMm, rooms).forEach(function (R) {
      var z = (f.zones || [])[R.zi], lp = R.loop;
      if (R.li === 0) {
        o.push('<polygon points="' + polyPts(z.pts, t.X, t.Y) + '" style="fill:none;stroke:' +
          COLT.tp + ';stroke-width:0.45;stroke-dasharray:1.6,1.2"/>');
        // зона узкая — геометрия не строится, кладём встречной змейкой по габариту
        if (R.est) o.push(serpentine(z, t, f, stepMm, 'tpz' + num + '_' + R.zi));
      }
      var dot;
      if (lp.sup) {
        var sE = lp.sup[lp.sup.length - 1], rS = lp.ret[0];
        var rr1 = stepMm / 1000 * ppm * t.s * 0.5;   // радиус гиба — полшага
        o.push('<path d="' + pathR(lp.sup, t, rr1) + '" style="fill:none;stroke:' + COL_SUP +
          ';stroke-width:0.5;stroke-linejoin:round;stroke-linecap:round"/>');
        o.push('<path d="' + pathD([sE, rS], t) + '" style="fill:none;stroke:' + COL_RET + ';stroke-width:0.5"/>');
        o.push('<path d="' + pathR(lp.ret, t, rr1) + '" style="fill:none;stroke:' + COL_RET +
          ';stroke-width:0.5;stroke-linejoin:round;stroke-linecap:round"/>');
        dot = pointAt(lp.sup, 0.72);                  // точка выноски — на внутренних витках
        // размеры петли по крайним трубам — синим, «уточнить при монтаже»
        var bb = bbox(lp.sup.concat(lp.ret));
        var X0 = t.X(bb[0]), X1 = t.X(bb[2]), Y0 = t.Y(bb[1]), Y1 = t.Y(bb[3]);
        var mm = function (px) { return String(Math.round(px / ppm * 100) * 10); };
        if (X1 - X0 > 9) dims.push([[X0, Y0 + (Y1 - Y0) * 0.16], [X1, Y0 + (Y1 - Y0) * 0.16], mm(bb[2] - bb[0]), false]);
        if (Y1 - Y0 > 9) dims.push([[X0 + (X1 - X0) * 0.16, Y0], [X0 + (X1 - X0) * 0.16, Y1], mm(bb[3] - bb[1]), true]);
      } else {
        var c0 = centroid(z.pts);
        dot = [c0[0], c0[1] + (R.li - (R.k - 1) / 2) * 0.4 * ppm];
      }
      flowSum += R.flow;
      // для табличек: середина петли (по ней колонка и порядок) и сама труба —
      // точку выноски потом ставим на ней на высоте таблички
      var lpS = lp.sup ? lp.sup.map(function (q) { return [t.X(q[0]), t.Y(q[1])]; }) : null;
      var lb = lpS ? bbox(lpS) : null;
      cards.push({ p: lb ? [(lb[0] + lb[2]) / 2, (lb[1] + lb[3]) / 2] : [t.X(dot[0]), t.Y(dot[1])],
        dot: [t.X(dot[0]), t.Y(dot[1])], poly: lpS, bb: lb,
        lines: ['Контур ' + R.no, 'Шаг ' + R.step + ' мм',
        'L = ' + num1(lp.lenM || R.m) + ' м', num1(R.flow) + ' л/мин'] });
    });
    dims.forEach(function (D) { dimLine(o, D[0], D[1], D[2], D[3]); });
    if (f.coll) collectorMark(f.coll, t, f, o, true);   // подпись — выноской ниже
    tpRoomTags(o, f, t, rooms, num);

    // таблички контуров с выносками: колонки — у края самого плана, а не поля
    var zx = [];
    (f.zones || []).forEach(function (z) { (z.pts || []).forEach(function (p) { zx.push(t.X(p[0])); }); });
    var pL = zx.length ? Math.min.apply(null, zx) : TP_PLAN.x0, pR = zx.length ? Math.max.apply(null, zx) : TP_PLAN.x1;
    var cols = { left: Math.max(24, pL - 6 - TP_CARD.w), right: Math.min(Ex0 - 4 - TP_CARD.w, pR + 6) };
    var zy = [];
    (f.zones || []).forEach(function (z) { (z.pts || []).forEach(function (p) { zy.push(t.Y(p[1])); }); });
    var span = zy.length ? Math.max.apply(null, zy) - Math.min.apply(null, zy) : 200;
    var rowH = 4.4, mid = (pL + pR) / 2;
    // табличек в колонке больше, чем помещается по высоте плана, — сразу
    // плотные: так они остаются рядом со своими петлями, выноски короче
    var perCol = Math.ceil(cards.length / 2);
    if (perCol * (4 * rowH + TP_CARD.gap) > span + 30) rowH = 3.3;
    var fr = { pT: zy.length ? Math.min.apply(null, zy) : TP_PLAN.y0, pB: zy.length ? Math.max.apply(null, zy) : TP_PLAN.y1 };
    if (!placeCards(cards, mid, rowH, cols, fr)) {
      rowH = 3.3;                                     // много петель — таблички плотнее
      placeCards(cards, mid, rowH, cols, fr);
    }
    cards.forEach(function (c) {
      var W = TP_CARD.w, ay = c.y + rowH;
      var ex = c.side === 'L' ? c.x + W : c.x, edge = c.side === 'L' ? Math.min(pL - 2, c.x + W + 3) : Math.max(pR + 2, c.x - 3);
      // Выноска горизонтальная, как в проектах: точка — на трубе петли на высоте
      // таблички (ближайшая к середине петли). Горизонтальные выноски друг друга
      // не пересекают. Петля не дотягивается по высоте — выноска с изломом.
      c.p = c.dot;
      if (c.side === 'B' || c.side === 'T') {
        // строка под/над планом: выноска вертикальная, точка — на трубе петли
        var ax = Math.max(c.x + 2, Math.min(c.x + W - 2, c.dot[0]));
        var ey = c.side === 'B' ? c.y : c.y + rowH * 4, hit = null;
        if (c.poly && ax > c.bb[0] + 0.3 && ax < c.bb[2] - 0.3) {
          var cym = (c.bb[1] + c.bb[3]) / 2;
          for (var j = 1; j < c.poly.length; j++) {
            var a2 = c.poly[j - 1], b2 = c.poly[j];
            if ((a2[0] - ax) * (b2[0] - ax) > 0 || Math.abs(b2[0] - a2[0]) < 1e-6) continue;
            var yv = a2[1] + (b2[1] - a2[1]) * (ax - a2[0]) / (b2[0] - a2[0]);
            if (!hit || Math.abs(yv - cym) < Math.abs(hit[1] - cym)) hit = [ax, yv];
          }
        }
        if (hit) c.p = hit;
        var vpath = hit ? [[ax, ey], hit] : [[ax, ey], [ax, (ey + c.p[1]) / 2], c.p];
        o.push('<polyline points="' + vpath.map(function (p) { return n(p[0]) + ',' + n(p[1]); }).join(' ') +
          '" style="fill:none;stroke:#000;stroke-width:0.2"/>');
      } else if (c.poly) {
        // высота точки — у таблички, а если петля ниже/выше — ближайшая в петле
        var yy0 = Math.max(c.bb[1] + 1.2, Math.min(c.bb[3] - 1.2, ay));
        var cxm = (c.bb[0] + c.bb[2]) / 2, best = null;
        for (var i = 1; i < c.poly.length; i++) {
          var a = c.poly[i - 1], b = c.poly[i];
          if ((a[1] - yy0) * (b[1] - yy0) > 0 || Math.abs(b[1] - a[1]) < 1e-6) continue;
          var x = a[0] + (b[0] - a[0]) * (yy0 - a[1]) / (b[1] - a[1]);
          if (!best || Math.abs(x - cxm) < Math.abs(best[0] - cxm)) best = [x, yy0];
        }
        if (best) c.p = best;
      }
      if (c.side === 'L' || c.side === 'R') {
        var path = Math.abs(ay - c.p[1]) < 0.4 ? [[ex, ay], c.p] : [[ex, ay], [edge, ay], c.p];
        o.push('<polyline points="' + path.map(function (p) { return n(p[0]) + ',' + n(p[1]); }).join(' ') +
          '" style="fill:none;stroke:#000;stroke-width:0.2"/>');
      }
      o.push('<circle cx="' + n(c.p[0]) + '" cy="' + n(c.p[1]) + '" r="0.75" style="fill:#000"/>');
      o.push('<rect x="' + n(c.x) + '" y="' + n(c.y) + '" width="' + W + '" height="' + n(rowH * 4) +
        '" style="fill:#ffffff;stroke:#000;stroke-width:0.22"/>');
      c.lines.forEach(function (s, i) {
        if (i) o.push('<line x1="' + n(c.x) + '" y1="' + n(c.y + rowH * i) + '" x2="' + n(c.x + W) + '" y2="' +
          n(c.y + rowH * i) + '" style="stroke:#000;stroke-width:0.15"/>');
        o.push(txt(c.x + 1.6, c.y + rowH * i + rowH * 0.72, s, { size: rowH > 4 ? 3.0 : 2.4 }));
      });
    });

    // выноски коллектора, как в проектах: «Коллектор ТП на N выходов», «Подъём на
    // контуры ТП 2-го этажа», «Опуск к коллектору ТП 1-го этажа»
    var anchor = null, calls = [];
    if (f.coll) {
      anchor = f.coll;
      var nOut = opts.collOutputs || cards.length;
      calls.push('Коллектор ТП на ' + nOut + ' ' + outWord(nOut));
      (opts.tpAbove || []).forEach(function (k) { calls.push('Подъём на контуры ТП ' + k + '-го этажа'); });
    } else if (opts.tpBelow) {
      anchor = opts.tpBelow;
      calls.push('Опуск к коллектору ТП ' + opts.tpBelow.floor + '-го этажа');
      o.push('<circle cx="' + n(t.X(anchor.x)) + '" cy="' + n(t.Y(anchor.y)) +
        '" r="1.4" style="fill:#fff;stroke:#b35900;stroke-width:0.5"/>');
    }
    if (anchor && calls.length) {
      var aX = t.X(anchor.x), aY = t.Y(anchor.y), sideR = aX >= mid, W2 = TP_CARD.w;
      var busy = cards.filter(function (c) { return c.side === (sideR ? 'R' : 'L'); })
        .map(function (c) { return [c.y - 1, c.y + rowH * 4 + 1]; });
      var colX = sideR ? cols.right : cols.left + W2, placed = [], ok = true;
      calls.forEach(function (txtC) {
        var spot = null;
        for (var dy = 0; dy <= 140 && spot == null; dy += 4.6) {
          [dy, -dy].forEach(function (d) {
            var y = aY + d;
            if (spot != null || y < TP_PLAN.y0 || y > TP_PLAN.y1 + 8) return;
            var hit = busy.concat(placed).some(function (r) { return y + 2.6 > r[0] && y - 2.6 < r[1]; });
            if (!hit) spot = y;
          });
        }
        if (spot == null) { ok = false; return; }
        placed.push([spot - 2.6, spot + 2.6]);
        var bx = sideR ? pR + 3 : pL - 3, tx = sideR ? colX : colX;
        var path = Math.abs(spot - aY) < 0.3 ? [[aX, aY], [tx, spot]] : [[aX, aY], [bx, aY], [bx, spot], [tx, spot]];
        o.push('<polyline points="' + path.map(function (q) { return n(q[0]) + ',' + n(q[1]); }).join(' ') +
          '" style="fill:none;stroke:#000;stroke-width:0.2"/>');
        o.push('<circle cx="' + n(aX) + '" cy="' + n(aY) + '" r="0.75" style="fill:#000"/>');
        o.push(txt(tx + (sideR ? 1 : -1), spot + 1, txtC, { size: 3.0, anchor: sideR ? 'start' : 'end' }));
      });
      if (!ok && f.coll) o.push(txt(aX, aY + 6, 'Коллектор ТП', { size: 2.8, anchor: 'middle', fill: '#b35900' }));
    } else if (f.coll) {
      o.push(txt(t.X(f.coll.x), t.Y(f.coll.y) + 6, 'Коллектор ТП', { size: 2.8, anchor: 'middle', fill: '#b35900' }));
    }

    // экспликация помещений этажа — справа вверху, как в проектах
    var Ex = Ex0, Ey = 30, EW = [8, 32, 15, 19], erh = 5;
    var EWs = EW.reduce(function (a, b) { return a + b; }, 0);
    var eRows = rooms.length
      ? rooms.map(function (r, i) {
          return [roomNo(r, num, i), r.name || '', num1(+r.area || 0) + ' м²', r.q > 0 ? Math.round(r.q) + ' Вт' : '—'];
        })
      : floorLoops(f, stepMm, loopLimit(stepMm)).map(function (Z, i) {
          return [num + '.' + (i + 1), Z.name || 'зона ' + (i + 1), num1(Z.area) + ' м²', '—'];
        });
    var sumA = 0, sumQ = 0;
    rooms.forEach(function (r) { sumA += +r.area || 0; sumQ += +r.q || 0; });
    o.push(txt(Ex + EWs / 2, Ey - 2.4, 'Экспликация помещений ' + num + ' этажа', { size: 3.4, anchor: 'middle' }));
    var eAll = [['№', 'Наименование', 'Площадь', 'Теплопотери']].concat(eRows);
    if (rooms.length) eAll.push(['', 'Итого', num1(sumA) + ' м²', Math.round(sumQ) + ' Вт']);
    var eLines = rooms.length ? eAll.length - 1 : eAll.length;      // строка «Итого» — без колонок
    eAll.forEach(function (r, ri) {
      var y = Ey + ri * erh, x = Ex;
      o.push('<rect x="' + n(Ex) + '" y="' + n(y) + '" width="' + n(EWs) + '" height="' + erh +
        '" style="fill:none;stroke:#000;stroke-width:0.2"/>');
      r.forEach(function (cell, ci) {
        var s = String(cell);
        if (ci === 1 && s.length > 20) s = s.slice(0, 19) + '…';
        o.push(txt(x + EW[ci] / 2, y + erh * 0.7, s, { size: 2.6, anchor: 'middle' }));
        if (ri === 0 && ci) o.push('<line x1="' + n(x) + '" y1="' + n(Ey) + '" x2="' + n(x) + '" y2="' +
          n(Ey + eLines * erh) + '" style="stroke:#000;stroke-width:0.15"/>');
        x += EW[ci];
      });
    });

    // общие условия — внизу слева, как в проектах
    var pipe = opts.ufhPipe ? opts.ufhPipe : 'по спецификации';
    var notes = [
      'Трубопроводы напольного отопления — ' + pipe + ';',
      'Подводящие участки трубопроводов проложить в теплоизоляции толщиной 6 мм в слое ЭППС;',
      'Шаг укладки тёплого пола ' + stepMm + ' мм, кроме случаев, указанных отдельно;',
      'Стыки теплоизоляции проклеить армированной лентой;',
      'Размеры, нанесённые синим цветом, уточнить при монтаже;',
      'Отступ контуров тёплого пола от стен 100 мм, кроме случаев, указанных отдельно;',
      'Расход G = Q / (c × ΔT), ΔT = ' + ufhDt() + ' °C; по коллектору ' + num1(flowSum) + ' л/мин (' +
        (flowSum * 0.06).toFixed(2).replace('.', ',') + ' м³/ч); длины контуров — с подводками, как в смете.'
    ];
    if (anyAuto) notes.push('Укладка и трасса подводок построены автоматически — уточнить при монтаже.');
    var Ny = 254;
    o.push(txt(24, Ny, 'Общие условия по системе напольного отопления:', { size: 3.2 }));
    notes.forEach(function (s, i) { o.push(txt(24, Ny + 3.9 * (i + 1), (i + 1) + '. ' + s, { size: 2.7 })); });

    // условные обозначения систем трубопроводов — над штампом справа
    var leg = [['Т11 — подающий трубопровод напольного отопления', COL_SUP, 'line'],
      ['Т21 — обратный трубопровод напольного отопления', COL_RET, 'line']];
    if (anyAuto) leg.push(['Подводки к контурам в теплоизоляции', COL_BUNDLE, 'band']);
    if (anyCold) leg.push(['Место без обогрева', COLT.cold, 'box']);
    var Lx2 = 300, Ly2 = 274 - 4.2 * leg.length;
    o.push(txt(Lx2, Ly2 - 2, 'Условные обозначения систем трубопроводов:', { size: 3.0 }));
    leg.forEach(function (r, i) {
      var yy = Ly2 + 2 + i * 4.2;
      if (r[2] === 'box') o.push('<rect x="' + Lx2 + '" y="' + n(yy - 1.4) + '" width="9" height="2.8" style="fill:rgba(120,120,120,0.1);stroke:' + r[1] + ';stroke-width:0.3"/>');
      else o.push('<line x1="' + Lx2 + '" y1="' + n(yy) + '" x2="' + (Lx2 + 9) + '" y2="' + n(yy) +
        '" style="stroke:' + r[1] + ';stroke-width:' + (r[2] === 'band' ? 1.4 : 0.6) + '"/>');
      o.push(txt(Lx2 + 11, yy + 1, r[0], { size: 2.6 }));
    });
    return o.join('');
  }


  // ═══ Листы водоснабжения и канализации ══════════════════════════════════
  // Приборы и стояк расставлены в редакторе планов, трассы посчитаны там же
  // при сохранении (f.wlines — вода от котельной, f.slines — выпуски к стояку).

  // подпись, буква на значке и габарит в мм (вдоль стены × от стены)
  var FIXT = {
    basin: ['Раковина', 'Р', 600, 450], toilet: ['Унитаз', 'У', 360, 700],
    bath: ['Ванна', 'В', 1700, 700], shower: ['Душ', 'Д', 900, 900],
    wash: ['Стиральная машина', 'СМ', 600, 600],
    dish: ['Посудомоечная машина', 'ПМ', 600, 600],
    riser: ['Стояк канализации', 'Ст', 110, 110]
  };
  var COL_CW = '#0b7285', COL_HW = '#c92a2a', COL_SEW = '#5f3dc4';

  /** Значок прибора: габарит в масштабе листа, развёрнутый вдоль стены.
   *  Стояк — кружок. Буква подписи не поворачивается, чтобы читалась. */
  function fixtureMark(q, t, f, o, col) {
    var ppm = (f.pxPerM || 100) * t.s;
    var W = (q.w || (FIXT[q.t] || [])[2] || 500) / 1000 * ppm;
    var D = (q.d || (FIXT[q.t] || [])[3] || 500) / 1000 * ppm;
    var X = t.X(q.x), Y = t.Y(q.y);
    if (q.t === 'riser') {
      o.push('<circle cx="' + n(X) + '" cy="' + n(Y) + '" r="' + n(Math.max(1.6, W / 2)) +
        '" style="fill:#ffffff;stroke:' + col + ';stroke-width:0.5"/>');
    } else {
      o.push('<g transform="translate(' + n(X) + ',' + n(Y) + ') rotate(' + (q.ang || 0) + ')">' +
        '<rect x="' + n(-W / 2) + '" y="' + n(-D / 2) + '" width="' + n(W) + '" height="' + n(D) +
        '" rx="0.4" style="fill:#ffffff;fill-opacity:0.9;stroke:' + col + ';stroke-width:0.4"/></g>');
    }
    o.push(txt(X, Y + 1.1, (FIXT[q.t] || ['', '?'])[1], { size: 2.9, anchor: 'middle', fill: col }));
  }

  /** Лист «Водоснабжение N этажа»: В1 и Т3 парой от котельной к приборам */
  /** Контуры санузлов — общий фон листов ВК */
  function wcOutlines(f, t, o) {
    (f.zones || []).forEach(function (z) {
      if (z.type !== 'wc') return;
      o.push('<polygon points="' + polyPts(z.pts, t.X, t.Y) + '" style="fill:none;stroke:' +
        COLT.wc + ';stroke-width:0.4;stroke-dasharray:1.6,1.2"/>');
      var c = centroid(z.pts);
      if (z.name) o.push(txt(t.X(c[0]), t.Y(c[1]) - 4, z.name,
        { size: 3.0, anchor: 'middle', fill: COLT.wc }));
    });
  }

  function waterBody(f, num) {
    var t = fit(f), o = [], rows = [];
    o.push(imageTag(f, t, 0.32));
    wcOutlines(f, t, o);
    var fx = f.fixtures || [], step = Math.max(1.2, 0.09 * (f.pxPerM || 100) * t.s);
    // Горячая вода — только тем приборам, которым она нужна (WET_H: у
    // унитаза, стиральной и посудомоечной машин hw нет). Раньше Т3 рисовалась
    // и вписывалась в таблицу всем подряд.
    var hasHw = function (q) { return !!(q && (WET_H[q.t] || { hw: 1 }).hw); };
    (f.wlines || []).forEach(function (w) {
      if (!w.pts || w.pts.length < 2) return;
      var hot = hasHw(fx[w.i]);
      o.push('<path d="' + pathD(offsetPoly(w.pts, hot ? -step / 2 : 0), t) +
        '" style="fill:none;stroke:' + COL_CW + ';stroke-width:0.45"/>');
      if (hot) o.push('<path d="' + pathD(offsetPoly(w.pts, step / 2), t) +
        '" style="fill:none;stroke:' + COL_HW + ';stroke-width:0.45"/>');
    });
    fx.forEach(function (q, qi) {
      if (q.t === 'riser') return;
      fixtureMark(q, t, f, o, COL_CW);
      rows.push([rows.length + 1, (FIXT[q.t] || ['прибор'])[0], hasHw(q) ? 'В1 + Т3' : 'В1']);
    });
    // Этаж без котельной: вода приходит стояками с этажа, где коллекторы
    if (f.wsrc && f.wsrc.kind === 'riser' && (f.wlines || []).length) {
      var rx = t.X(f.wsrc.x) + 3.2, ry = t.Y(f.wsrc.y) - 3.2;
      o.push('<circle cx="' + n(rx) + '" cy="' + n(ry) + '" r="2.2"' +
        ' style="fill:#ffffff;stroke:' + COL_CW + ';stroke-width:0.5"/>');
      o.push(txt(rx + 3.4, ry + 1, 'Ст. В1, Т3', { size: 2.8, fill: COL_CW }));
    }
    (f.zones || []).forEach(function (z) {
      if (z.type !== 'boiler') return;
      var c = centroid(z.pts);
      o.push('<circle cx="' + n(t.X(c[0])) + '" cy="' + n(t.Y(c[1])) + '" r="3.2"' +
        ' style="fill:#ffffff;stroke:' + COL_CW + ';stroke-width:0.5"/>');
      o.push(txt(t.X(c[0]), t.Y(c[1]) + 1.1, 'К', { size: 3, anchor: 'middle', fill: COL_CW }));
      o.push(txt(t.X(c[0]), t.Y(c[1]) + 6, 'Коллектор ВС', { size: 2.8, anchor: 'middle', fill: COL_CW }));
    });
    vkTable(o, 'Сантехнические приборы', ['№', 'Прибор', 'Подводка'], rows, [8, 46, 22]);
    var ly = 40 + (rows.length + 1) * 6.4 + 12;
    o.push(txt(22, ly, 'Условные обозначения', { size: 3.6 }));
    [['В1 — холодное водоснабжение', COL_CW], ['Т3 — горячее водоснабжение', COL_HW]].forEach(function (r, i) {
      var yy = ly + 4.6 + i * 5;
      o.push('<line x1="22" y1="' + n(yy) + '" x2="31" y2="' + n(yy) +
        '" style="stroke:' + r[1] + ';stroke-width:0.6"/>');
      o.push(txt(33.5, yy + 1.1, r[0], { size: 3.0 }));
    });
    o.push(txt(228, 273.8, 'Трассы показаны условно: разводку уточнить по месту при монтаже.', { size: 3.0 }));
    return o.join('');
  }

  /** Лист «Канализация N этажа»: выпуски приборов к стояку с диаметрами */
  function sewerBody(f, num) {
    var t = fit(f), o = [], rows = [];
    o.push(imageTag(f, t, 0.32));
    wcOutlines(f, t, o);
    var fx = f.fixtures || [];
    var dl = [];
    (f.slines || []).forEach(function (s) {
      if (!s.pts || s.pts.length < 2) return;
      o.push('<path d="' + pathD(s.pts, t) + '" style="fill:none;stroke:' + COL_SEW +
        ';stroke-width:' + (s.d >= 110 ? 0.8 : 0.5) + '"/>');
      dl.push(s);
      var q = fx[s.i];
      if (q) rows.push([rows.length + 1, (FIXT[q.t] || ['прибор'])[0], 'd' + s.d,
        s.d >= 110 ? '0,02' : '0,03']);
    });
    fx.forEach(function (q) { fixtureMark(q, t, f, o, q.t === 'riser' ? '#7a5c00' : COL_SEW); });
    // Подписи диаметров — после значков приборов и в обход их и друг друга.
    // Раньше «d110» и «d50» ставились в середину трассы: у стояка короткие
    // выпуски сходятся в одну точку, и подписи ложились одна на другую.
    var lp = labelPlacer(), ppmS = (f.pxPerM || 100) * t.s;
    fx.forEach(function (q) {
      lp.add(fixtureBox(q, t, ppmS, 2.2));         // буква значка крупнее самого стояка
    });
    (f.zones || []).forEach(function (z) {         // имена санузлов (wcOutlines)
      if (z.type !== 'wc' || !z.name) return;
      var c = centroid(z.pts), X = t.X(c[0]), Y = t.Y(c[1]) - 4, hw = textW(z.name, 3.0) / 2;
      lp.add([X - hw, Y - 2.6, X + hw, Y + 0.6]);
    });
    dl.forEach(function (s) {
      var lab = 'd' + s.d, w = textW(lab, 2.8), cands = [];
      // точки вдоль трассы: сначала середины длинных участков
      var segs = [];
      for (var j = 1; j < s.pts.length; j++)
        segs.push({ j: j, l: Math.hypot(s.pts[j][0] - s.pts[j - 1][0], s.pts[j][1] - s.pts[j - 1][1]) });
      segs.sort(function (a, b) { return b.l - a.l; });
      segs.forEach(function (sg) {
        [0.5, 0.25, 0.75].forEach(function (u) {
          var p = s.pts[sg.j - 1], q2 = s.pts[sg.j];
          var X = t.X(p[0] + (q2[0] - p[0]) * u), Y = t.Y(p[1] + (q2[1] - p[1]) * u);
          // рядом с линией, а если там значки — отступя (короткий выпуск у стояка)
          [[0, -1.4], [0, 3.6], [1.2, 1], [-w - 1.2, 1],
           [0, -5], [0, 7.2], [3, -5], [-w - 3, -5], [3, 7.2], [-w - 3, 7.2]].forEach(function (d) {
            var b = [X + d[0], Y + d[1] - 2.4, X + d[0] + w, Y + d[1] + 0.4];
            b.p = [X + d[0], Y + d[1]];
            cands.push(b);
          });
        });
      });
      var b = lp.place(cands);
      if (b) o.push(txt(b.p[0], b.p[1], lab, { size: 2.8, fill: COL_SEW }));
    });
    vkTable(o, 'Выпуски канализации', ['№', 'Прибор', 'Ø, мм', 'Уклон'], rows, [8, 40, 16, 16]);
    var ly = 40 + (rows.length + 1) * 6.4 + 12;
    o.push(txt(22, ly, 'Условные обозначения', { size: 3.6 }));
    o.push('<line x1="22" y1="' + n(ly + 4.6) + '" x2="31" y2="' + n(ly + 4.6) +
      '" style="stroke:' + COL_SEW + ';stroke-width:0.7"/>');
    o.push(txt(33.5, ly + 5.7, 'К1 — бытовая канализация', { size: 3.0 }));
    o.push(txt(22, ly + 12, 'Уклон выпусков: d50 — 0,03; d110 — 0,02 в сторону стояка.', { size: 3.0 }));
    o.push(txt(228, 273.8, 'Трассы показаны условно: разводку уточнить по месту при монтаже.', { size: 3.0 }));
    return o.join('');
  }

  /** Таблица приборов слева — та же сетка, что у таблицы петель ТП */
  function vkTable(o, title, hdr, rows, W) {
    var Lx = 22, Ty = 40, rh = 6.4;
    var Wsum = W.reduce(function (a, b) { return a + b; }, 0);
    o.push(txt(Lx + Wsum / 2, Ty - 2.4, title, { size: 4.2, anchor: 'middle' }));
    var all = [hdr].concat(rows.length ? rows : [['—', 'приборы не расставлены', '', '']]);
    all.forEach(function (r, ri) {
      var y = Ty + ri * rh, x = Lx;
      o.push('<rect x="' + n(Lx) + '" y="' + n(y) + '" width="' + n(Wsum) + '" height="' + rh +
        '" style="fill:none;stroke:#000;stroke-width:0.2"/>');
      W.forEach(function (w, ci) {
        o.push(txt(x + w / 2, y + rh / 2 + 1.2, r[ci] == null ? '' : r[ci],
          { size: ri ? 3.2 : 3.4, anchor: 'middle' }));
        if (ri === 0 && ci) o.push('<line x1="' + n(x) + '" y1="' + n(Ty) + '" x2="' + n(x) +
          '" y2="' + n(Ty + all.length * rh) + '" style="stroke:#000;stroke-width:0.15"/>');
        x += w;
      });
    });
  }

  // ═══ Листы мокрых зон: подводки и выпуски крупно ════════════════════════
  // На плане этажа санузел занимает пару сантиметров, и монтажнику на объекте
  // оттуда нечего взять. В проектах-образцах на каждую мокрую зону — кухню,
  // санузлы, котельную — свой лист: зона крупно, привязки приборов от стен и
  // высоты водорозеток и выпусков. Так и здесь: приборы, трассы воды (В1/Т3)
  // и выпуски канализации (К1) — те же, что на планах этажа, только в зуме.

  // Высоты от чистого пола, мм: водорозетки ХВС/ГВС и низ выпуска канализации.
  // Взяты из общих указаний проекта-образца — это практика монтажа, а не
  // требование норм; на листе сказано, что уточняются по паспорту прибора.
  // hw: null — горячей воды к прибору нет (унитаз, машины).
  var WET_H = {
    basin:  { cw: 600,  hw: 600,  sew: 400, d: 50 },
    toilet: { cw: 400,  hw: null, sew: 0,   d: 110 },
    bath:   { cw: 800,  hw: 800,  sew: 0,   d: 50 },
    shower: { cw: 1100, hw: 1100, sew: 0,   d: 50 },
    wash:   { cw: 200,  hw: null, sew: 400, d: 50 },
    dish:   { cw: 400,  hw: null, sew: 400, d: 50 }
  };

  // ─── Обрезка по рамке зума, в координатах листа ───
  // Геометрически, а не clip-path: трассы и контур зоны должны кончаться у
  // рамки в любом просмотрщике и в любой печати в PDF.

  /** Отрезок в прямоугольнике R (Лианг — Барски): [x1,y1,x2,y2] или null */
  function clipSeg(a, b, R) {
    var t0 = 0, t1 = 1, dx = b[0] - a[0], dy = b[1] - a[1];
    var p = [-dx, dx, -dy, dy], q = [a[0] - R.x0, R.x1 - a[0], a[1] - R.y0, R.y1 - a[1]];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return null; continue; }
      var r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
  }

  /** Ломаная (точки листа) → d для path, обрезанная рамкой; разрывы — новым M */
  function clipPathD(P, R) {
    var d = [], last = null;
    for (var i = 1; i < P.length; i++) {
      var s = clipSeg(P[i - 1], P[i], R);
      if (!s) { last = null; continue; }
      if (!last || Math.abs(last[0] - s[0][0]) > 0.01 || Math.abs(last[1] - s[0][1]) > 0.01)
        d.push('M' + n(s[0][0]) + ',' + n(s[0][1]));
      d.push('L' + n(s[1][0]) + ',' + n(s[1][1]));
      last = s[1];
    }
    return d.join('');
  }

  /** Многоугольник (точки листа), обрезанный рамкой (Сазерленд — Ходжмен) */
  function clipPoly(P, R) {
    var edges = [
      function (p) { return p[0] >= R.x0; }, function (p) { return p[0] <= R.x1; },
      function (p) { return p[1] >= R.y0; }, function (p) { return p[1] <= R.y1; }
    ];
    var cut = [
      function (a, b) { var k = (R.x0 - a[0]) / (b[0] - a[0]); return [R.x0, a[1] + k * (b[1] - a[1])]; },
      function (a, b) { var k = (R.x1 - a[0]) / (b[0] - a[0]); return [R.x1, a[1] + k * (b[1] - a[1])]; },
      function (a, b) { var k = (R.y0 - a[1]) / (b[1] - a[1]); return [a[0] + k * (b[0] - a[0]), R.y0]; },
      function (a, b) { var k = (R.y1 - a[1]) / (b[1] - a[1]); return [a[0] + k * (b[0] - a[0]), R.y1]; }
    ];
    var out = P;
    for (var e = 0; e < 4 && out.length; e++) {
      var inp = out; out = [];
      for (var i = 0; i < inp.length; i++) {
        var cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
        var ci = edges[e](cur), pi = edges[e](prev);
        if (ci) { if (!pi) out.push(cut[e](prev, cur)); out.push(cur); }
        else if (pi) out.push(cut[e](prev, cur));
      }
    }
    return out;
  }

  /** Зона прибора: по имени из редактора, иначе та, внутри которой он стоит */
  function wetZoneOf(f, q) {
    var zs = (f.zones || []).filter(function (z) { return z.pts && z.pts.length > 2; });
    var key = String(q.z || '').trim().toLowerCase();
    if (key) {
      for (var i = 0; i < zs.length; i++)
        if (String(zs[i].name || '').trim().toLowerCase() === key) return zs[i];
    }
    for (var k = 0; k < zs.length; k++) if (pip([q.x, q.y], zs[k].pts)) return zs[k];
    return null;
  }

  function wetZoneBody(f, zone, group, opts) {
    var o = [], ppm = f.pxPerM || 100;
    var BOX = { x0: 30, y0: 34, x1: 262, y1: 236 };
    // Рамка зума. Санузел целиком влезает крупно, а кухня-гостиная на 40 м² —
    // нет: мойка на ней терялась. Поэтому рамка строится от приборов (с запасом
    // метр), а стены зоны подтягиваются в неё по одной, ближние первыми, пока
    // масштаб не мельче 1:25. От попавших в рамку стен и считаются привязки.
    var pts = [];
    group.forEach(function (g) {
      var q = g.q, r = Math.max(q.w || 600, q.d || 600) / 1000 * ppm / 2;
      pts.push([q.x - r, q.y - r]); pts.push([q.x + r, q.y + r]);
    });
    var fb = bbox(pts), pad = 0.5 * ppm, air = 1.0 * ppm;
    var bb = [fb[0] - air, fb[1] - air, fb[2] + air, fb[3] + air];
    var zWalls = {};                              // стороны зоны, попавшие в рамку
    if (zone) {
      var zb0 = bbox(zone.pts);
      var maxW = (BOX.x1 - BOX.x0) * 25 * ppm / 1000, maxH = (BOX.y1 - BOX.y0) * 25 * ppm / 1000;
      [['l', fb[0] - zb0[0]], ['t', fb[1] - zb0[1]], ['r', zb0[2] - fb[2]], ['b', zb0[3] - fb[3]]]
        .sort(function (a, b) { return a[1] - b[1]; })
        .forEach(function (e) {
          var c = bb.slice();
          if (e[0] === 'l') c[0] = Math.min(c[0], zb0[0] - pad);
          if (e[0] === 't') c[1] = Math.min(c[1], zb0[1] - pad);
          if (e[0] === 'r') c[2] = Math.max(c[2], zb0[2] + pad);
          if (e[0] === 'b') c[3] = Math.max(c[3], zb0[3] + pad);
          if (c[2] - c[0] <= maxW && c[3] - c[1] <= maxH) { bb = c; zWalls[e[0]] = true; }
        });
      // за стенами зоны больше полуметра не показываем — там уже чужое помещение
      bb = [Math.max(bb[0], zb0[0] - pad), Math.max(bb[1], zb0[1] - pad),
            Math.min(bb[2], zb0[2] + pad), Math.min(bb[3], zb0[3] + pad)];
    }
    // не крупнее 1:10 — иначе у маленького санузла значки приборов на пол-листа
    var s = Math.min((BOX.x1 - BOX.x0) / (bb[2] - bb[0]), (BOX.y1 - BOX.y0) / (bb[3] - bb[1]), 100 / ppm);
    var ox = BOX.x0 + ((BOX.x1 - BOX.x0) - (bb[2] - bb[0]) * s) / 2 - bb[0] * s;
    var oy = BOX.y0 + ((BOX.y1 - BOX.y0) - (bb[3] - bb[1]) * s) / 2 - bb[1] * s;
    var t = { s: s, ox: ox, oy: oy,
      X: function (px) { return ox + px * s; }, Y: function (px) { return oy + px * s; } };
    var cid = 'wz' + (opts.uid || 0);
    var vx0 = t.X(bb[0]), vy0 = t.Y(bb[1]), vw = (bb[2] - bb[0]) * s, vh = (bb[3] - bb[1]) * s;

    var R = { x0: vx0, y0: vy0, x1: vx0 + vw, y1: vy0 + vh };
    var toSheet = function (pts) { return pts.map(function (p) { return [t.X(p[0]), t.Y(p[1])]; }); };
    // Подложка и контуры стен — растр и заливки, их геометрически не обрезать:
    // режет clip-path (браузер и печать из браузера).
    var under = (f.img ? imageTag(f, t, 0.3) : '') + (wallsBody(f, t) || '');
    if (under) {
      o.push('<defs><clipPath id="' + cid + '"><rect x="' + n(vx0) + '" y="' + n(vy0) + '" width="' + n(vw) +
        '" height="' + n(vh) + '"/></clipPath></defs>');
      o.push('<g clip-path="url(#' + cid + ')">' + under + '</g>');
    }
    if (zone) {
      var zp = clipPoly(toSheet(zone.pts), R);
      if (zp.length > 2) o.push('<polygon points="' + zp.map(function (p) { return n(p[0]) + ',' + n(p[1]); }).join(' ') +
        '" style="fill:none;stroke:' + COLT.wc + ';stroke-width:0.4;stroke-dasharray:1.6,1.2"/>');
    }

    var idx = {};
    group.forEach(function (g) { idx[g.i] = g; });
    var step = Math.max(1.0, 0.07 * ppm * s);
    var seg = function (pts, style) {
      var d = clipPathD(toSheet(pts), R);
      if (d) o.push('<path d="' + d + '" style="fill:none;' + style + '"/>');
    };
    (f.wlines || []).forEach(function (w) {
      var g = idx[w.i];
      if (!g || !w.pts || w.pts.length < 2) return;
      seg(offsetPoly(w.pts, -step / 2 / s), 'stroke:' + COL_CW + ';stroke-width:0.5');
      if ((WET_H[g.q.t] || {}).hw) seg(offsetPoly(w.pts, step / 2 / s), 'stroke:' + COL_HW + ';stroke-width:0.5');
    });
    var risers = {};
    (f.slines || []).forEach(function (sl) {
      var g = idx[sl.i];
      if (!g || !sl.pts || sl.pts.length < 2) return;
      seg(sl.pts, 'stroke:' + COL_SEW + ';stroke-width:' + (sl.d >= 110 ? 0.9 : 0.6) + ';stroke-dasharray:2.4,0.8');
      var end = sl.pts[sl.pts.length - 1];
      risers[Math.round(end[0]) + ',' + Math.round(end[1])] = end;
    });
    o.push('<rect x="' + n(vx0) + '" y="' + n(vy0) + '" width="' + n(vw) + '" height="' + n(vh) +
      '" style="fill:none;stroke:#000;stroke-width:0.25"/>');

    // приборы с номерами
    group.forEach(function (g, gi) {
      fixtureMark(g.q, t, f, o, COL_CW);
      var X = t.X(g.q.x), Y = t.Y(g.q.y) - Math.max(4, (g.q.d || 600) / 1000 * ppm * s / 2 + 2.6);
      o.push('<circle cx="' + n(X) + '" cy="' + n(Y) + '" r="2.3" style="fill:#ffffff;stroke:#000;stroke-width:0.2"/>');
      o.push(txt(X, Y + 1.0, String(gi + 1), { size: 2.7, anchor: 'middle' }));
    });
    // Стояки, к которым уходят выпуски зоны, — поверх приборов: стояк обычно
    // стоит в углу у унитаза, и значок унитаза закрывал его подпись.
    var rk = Object.keys(risers);
    rk.forEach(function (k, ri) {
      var p = risers[k], cx = t.X(p[0]), cy = t.Y(p[1]);
      // стояк за рамкой — выпуск уходит к нему за обрез, значок не рисуем
      if (cx < vx0 || cx > vx0 + vw || cy < vy0 || cy > vy0 + vh) return;
      var lbl = 'Ст. К1' + (rk.length > 1 ? '-' + (ri + 1) : '');
      o.push('<circle cx="' + n(cx) + '" cy="' + n(cy) + '" r="' + n(Math.max(1.6, 0.055 * ppm * s)) +
        '" style="fill:#ffffff;stroke:#7a5c00;stroke-width:0.5"/>');
      o.push('<rect x="' + n(cx - lbl.length * 0.8 - 0.8) + '" y="' + n(cy + 2.4) + '" width="' + n(lbl.length * 1.6 + 1.6) +
        '" height="4" rx="0.5" style="fill:#ffffff;fill-opacity:0.9;stroke:none"/>');
      o.push(txt(cx, cy + 5.4, lbl, { size: 2.9, anchor: 'middle', fill: '#7a5c00' }));
    });

    // Привязки приборов от стен зоны: цепочки по осям приборов сверху и слева
    if (zone) {
      var zb = bbox(zone.pts), mm = function (px) { return Math.round(px / ppm * 100) * 10; };
      // концы цепочки — только стены, попавшие в рамку: размер до стены за
      // обрезом листа читать не от чего
      var chain = function (a0, a1, vals) {
        var arr = [];
        if (a0 != null) arr.push(a0);
        arr = arr.concat(vals);
        if (a1 != null) arr.push(a1);
        arr.sort(function (a, b) { return a - b; });
        return arr.filter(function (v, i) { return i === 0 || v - arr[i - 1] > 0.02 * ppm; });
      };
      var xs = chain(zWalls.l ? zb[0] : null, zWalls.r ? zb[2] : null, group.map(function (g) { return g.q.x; }));
      var ys = chain(zWalls.t ? zb[1] : null, zWalls.b ? zb[3] : null, group.map(function (g) { return g.q.y; }));
      var dimLine = function (a, b, y, v, vertical) {
        if (vertical) {
          o.push('<line x1="' + n(y) + '" y1="' + n(a) + '" x2="' + n(y) + '" y2="' + n(b) + '" style="stroke:#000;stroke-width:0.15"/>');
          o.push(txt(y - 1, (a + b) / 2, String(v), { size: 2.5, anchor: 'middle' }).replace('<text',
            '<text transform="rotate(-90 ' + n(y - 1) + ' ' + n((a + b) / 2) + ')"'));
        } else {
          o.push('<line x1="' + n(a) + '" y1="' + n(y) + '" x2="' + n(b) + '" y2="' + n(y) + '" style="stroke:#000;stroke-width:0.15"/>');
          o.push(txt((a + b) / 2, y - 1, String(v), { size: 2.5, anchor: 'middle' }));
        }
      };
      var yTop = vy0 - 4, xLeft = vx0 - 4;
      xs.forEach(function (v, i) {
        o.push('<line x1="' + n(t.X(v)) + '" y1="' + n(yTop - 1.6) + '" x2="' + n(t.X(v)) + '" y2="' + n(yTop + 1.6) +
          '" style="stroke:#000;stroke-width:0.3"/>');
        if (i) dimLine(t.X(xs[i - 1]), t.X(v), yTop, mm(v - xs[i - 1]), false);
      });
      ys.forEach(function (v, i) {
        o.push('<line x1="' + n(xLeft - 1.6) + '" y1="' + n(t.Y(v)) + '" x2="' + n(xLeft + 1.6) + '" y2="' + n(t.Y(v)) +
          '" style="stroke:#000;stroke-width:0.3"/>');
        if (i) dimLine(t.Y(ys[i - 1]), t.Y(v), xLeft, mm(v - ys[i - 1]), true);
      });
    }

    // Таблица высот
    var TX = 274, TY = 40, W = [8, 42, 16, 16, 12, 16], rh = 6.4;
    var Wsum = W.reduce(function (a, b) { return a + b; }, 0);
    o.push(txt(TX + Wsum / 2, TY - 7.2, 'Подводки и выпуски приборов', { size: 4.2, anchor: 'middle' }));
    o.push(txt(TX + Wsum / 2, TY - 2.4, 'высота от чистого пола, мм', { size: 3.0, anchor: 'middle' }));
    var rows = [['№', 'Прибор', 'В1', 'Т3', 'К1 Ø', 'К1 h']];
    group.forEach(function (g, gi) {
      var h = WET_H[g.q.t] || {};
      rows.push([gi + 1, (FIXT[g.q.t] || ['Прибор'])[0], h.cw != null ? h.cw : '—',
        h.hw != null ? h.hw : '—', h.d ? 'd' + h.d : '—',
        h.sew == null ? '—' : (h.sew === 0 ? 'пол' : h.sew)]);
    });
    rows.forEach(function (r, ri) {
      var y = TY + ri * rh, x = TX;
      o.push('<rect x="' + n(TX) + '" y="' + n(y) + '" width="' + n(Wsum) + '" height="' + rh +
        '" style="fill:none;stroke:#000;stroke-width:0.2"/>');
      W.forEach(function (w, ci) {
        o.push(txt(ci === 1 ? x + 1.4 : x + w / 2, y + rh / 2 + 1.2, r[ci],
          { size: ri ? 3.0 : 3.2, anchor: ci === 1 ? 'start' : 'middle' }));
        if (ci) o.push('<line x1="' + n(x) + '" y1="' + n(y) + '" x2="' + n(x) + '" y2="' + n(y + rh) +
          '" style="stroke:#000;stroke-width:0.15"/>');
        x += w;
      });
    });

    var ly = TY + rows.length * rh + 9;
    o.push(txt(TX, ly, 'Условные обозначения', { size: 3.6 }));
    [['В1 — холодное водоснабжение', COL_CW, ''], ['Т3 — горячее водоснабжение', COL_HW, ''],
     ['К1 — выпуск бытовой канализации', COL_SEW, '2.4,0.8']].forEach(function (r, i) {
      var yy = ly + 5 + i * 5;
      o.push('<line x1="' + n(TX) + '" y1="' + n(yy) + '" x2="' + n(TX + 9) + '" y2="' + n(yy) +
        '" style="stroke:' + r[1] + ';stroke-width:0.7' + (r[2] ? ';stroke-dasharray:' + r[2] : '') + '"/>');
      o.push(txt(TX + 11.5, yy + 1.1, r[0], { size: 3.0 }));
    });
    var notes = [
      'Высоты — практика монтажа из проектов-образцов;',
      'уточняются по паспорту конкретного прибора.',
      'Водорозетки — до оси, выпуски — до низа трубы.',
      'Уклон выпусков: d50 — 0,03; d110 — 0,02 к стояку.',
      'Повороты выпусков — отводами 45°, не 90°.',
      'Трассы показаны условно; разводку уточнить по месту.'
    ];
    if (opts.recirc) notes.push('Рециркуляция ГВС (Т4) — по плану водоснабжения этажа.');
    notes.forEach(function (s2, i) { o.push(txt(TX, ly + 24 + i * 4.4, s2, { size: 3.0 })); });
    var scale = Math.round(1000 / (ppm * s) / 5) * 5;
    o.push(txt(BOX.x0, BOX.y1 + 10, 'Масштаб ~1:' + scale, { size: 3.0 }));
    return o.join('');
  }

  /**
   * Листы мокрых зон по этажам: [{ title, svg }].
   * opts: { code, sheetStart, num, floor, recirc }
   * Зона — одна из зон плана, к которой отнесены приборы (санузел, кухня,
   * котельная). Приборы без зоны идут общим листом «Приборы этажа».
   */
  function wetZoneSheets(plans, opts) {
    opts = opts || {};
    var out = [], num = opts.sheetStart || 1;
    var fmt = opts.num || function (v) { return String(v); };
    if (!plans || !plans.floors) return out;
    plans.floors.forEach(function (f, fi) {
      if (!f || !f.pxPerM || !(f.fixtures || []).length) return;
      if (opts.floor && opts.floor !== fi + 1) return;
      var groups = [], byZone = {};
      f.fixtures.forEach(function (q, i) {
        if (q.t === 'riser' || !WET_H[q.t]) return;
        var z = wetZoneOf(f, q);
        var key = z ? 'z' + f.zones.indexOf(z) : '_';
        if (!byZone[key]) { byZone[key] = { zone: z, items: [] }; groups.push(byZone[key]); }
        byZone[key].items.push({ q: q, i: i });
      });
      groups.forEach(function (G) {
        var nm = G.zone ? (G.zone.name || (G.zone.type === 'boiler' ? 'Котельная' : 'Зона')) : 'Приборы этажа';
        var ttl = 'Этаж 0' + (fi + 1) + '. ' + nm + ': подводки и выпуски';
        out.push({ title: ttl, svg: window.projectSheets.sheet({
          code: opts.code, sheet: fmt(num),
          body: title(ttl) + wetZoneBody(f, G.zone, G.items, { uid: fi + '_' + num, recirc: opts.recirc })
        }) });
        num++;
      });
    });
    return out;
  }

  // ═══ Аксонометрические схемы В1/Т3 и К1 ═════════════════════════════════
  // ГОСТ 21.601-2011 требует в составе ВК схем систем, а 3D-вид с плитой и
  // подложкой — это не схема: на ней нет диаметров, отметок и марок стояков.
  // Схема строится из тех же трасс, что планы этажа (wlines, slines), во
  // фронтальной изометрии: ось Y плана уходит вверх-вправо под 45°, без
  // сокращения. Одна линия на трубу, у прибора — подъём к водорозетке или
  // выпуск с отметкой, у стояка — марка и отметки пола и потолка.

  var AXO_BOX = { x0: 26, y0: 28, x1: 300, y1: 246 };
  var AXO_COLL_MM = 1000;          // гребёнки коллектора водоснабжения на стене

  function axoFit(f, pts3) {
    var c = Math.SQRT1_2;
    var raw = function (px, py, z) { var d = f.h - py; return [px + d * c, -z - d * c]; };
    var bb = bbox(pts3.map(function (p) { return raw(p[0], p[1], p[2]); }));
    var B = AXO_BOX;
    var s = Math.min((B.x1 - B.x0) / Math.max(1, bb[2] - bb[0]), (B.y1 - B.y0) / Math.max(1, bb[3] - bb[1]));
    var ox = B.x0 + ((B.x1 - B.x0) - (bb[2] - bb[0]) * s) / 2 - bb[0] * s;
    var oy = B.y0 + ((B.y1 - B.y0) - (bb[3] - bb[1]) * s) / 2 - bb[1] * s;
    return { s: s, P: function (px, py, z) { var r = raw(px, py, z || 0); return [ox + r[0] * s, oy + r[1] * s]; } };
  }

  function axoPath(pts3, t) {
    return pts3.map(function (p, i) {
      var q = t.P(p[0], p[1], p[2]);
      return (i ? 'L' : 'M') + n(q[0]) + ',' + n(q[1]);
    }).join('');
  }

  /** Отметка «▽ +0,600» у точки листа */
  function axoLevel(o, x, y, mm, col) {
    var v = (mm >= 0 ? '+' : '−') + (Math.abs(mm) / 1000).toFixed(3).replace('.', ',');
    o.push('<path d="M' + n(x - 1.3) + ',' + n(y - 2.2) + 'L' + n(x + 1.3) + ',' + n(y - 2.2) + 'L' + n(x) + ',' + n(y) + 'Z"' +
      ' style="fill:none;stroke:' + (col || '#000') + ';stroke-width:0.2"/>');
    o.push('<line x1="' + n(x) + '" y1="' + n(y - 2.2) + '" x2="' + n(x + 12) + '" y2="' + n(y - 2.2) +
      '" style="stroke:' + (col || '#000') + ';stroke-width:0.15"/>');
    o.push(txt(x + 2, y - 3, v, { size: 2.6, fill: col }));
  }

  function axoBody(f, num, opts) {
    var kind = opts.kind, o = [], ppm = f.pxPerM || 100;
    var mm = function (v) { return v / 1000 * ppm; };
    var fx = f.fixtures || [];
    var H = (opts.floorH || 2.7) * 1000;
    var lines = kind === 'sewer' ? (f.slines || []) : (f.wlines || []);
    lines = lines.filter(function (L) { return L.pts && L.pts.length > 1 && fx[L.i] && WET_H[fx[L.i].t]; });

    // точки для вписывания: трассы, подъёмы и стояки
    var pts3 = [];
    lines.forEach(function (L) {
      L.pts.forEach(function (p) { pts3.push([p[0], p[1], 0]); pts3.push([p[0], p[1], mm(1200)]); });
    });
    var risers = fx.filter(function (q) { return q.t === 'riser'; });
    if (kind === 'sewer') risers.forEach(function (r) { pts3.push([r.x, r.y, mm(H)]); pts3.push([r.x, r.y, -mm(600)]); });
    // Этаж без котельной: подводки начинаются не от гребёнок на стене, а от
    // стояков, пришедших снизу через перекрытие
    var fromRiser = kind !== 'sewer' && !!(f.wsrc && f.wsrc.kind === 'riser');
    if (fromRiser && lines.length) pts3.push([f.wsrc.x, f.wsrc.y, -mm(600)]);
    if (kind !== 'sewer' && !fromRiser && lines.length)
      pts3.push([lines[0].pts[0][0], lines[0].pts[0][1], mm(AXO_COLL_MM + 400)]);   // верхняя гребёнка и отметка
    if (!pts3.length) return null;
    var t = axoFit(f, pts3);
    var step = mm(60);
    var marks = [];                                  // буквы приборов у концов трасс

    if (kind !== 'sewer') {
      var collAt = null;
      // Подводки лучевые: у каждого прибора своя пара труб от коллектора. На
      // плане они идут одним коридором и сливаются в линию, поэтому на схеме
      // каждый луч сдвинут на свою полосу — иначе не видно, сколько их.
      // От стояка полос нет: лучи начинаются в одной точке — у пары стояков,
      // а не разбросаны по ширине гребёнки, которой на этом этаже нет.
      var lane = fromRiser ? 0 : mm(110), lanes = lines.length;
      // Гребёнки В1 и Т3 — одна над другой на стене котельной, поперёк первого
      // участка трассы. Раньше вместо них стояла одна толстая чёрная черта, а
      // спуски приходили каждый со своего сдвига и пересекали её посередине:
      // сдвиг луча считался по его собственному первому участку, а они у
      // лучей разные. Теперь верх каждого спуска стоит ровно на гребёнке.
      var cA = lines.length ? lines[0].pts[0] : [0, 0], cB = lines.length ? lines[0].pts[1] : [1, 0];
      var cdl = Math.hypot(cB[0] - cA[0], cB[1] - cA[1]) || 1;
      var cnx = -(cB[1] - cA[1]) / cdl, cny = (cB[0] - cA[0]) / cdl;
      var combZ = { cw: mm(AXO_COLL_MM), hw: mm(AXO_COLL_MM + 250) };
      var combOff = { cw: [], hw: [] };
      lines.forEach(function (L, li) {
        var q = fx[L.i], h = WET_H[q.t];
        var off = (li - (lanes - 1) / 2) * lane;
        var sets = [['cw', off - step / 2, COL_CW]];
        if (h.hw) sets.push(['hw', off + step / 2, COL_HW]);
        sets.forEach(function (S) {
          var pl = offsetPoly(L.pts, S[1]);
          var end = pl[pl.length - 1], z = mm(h[S[0]]);
          // от стояка подводка идёт сразу по полу; сам стояк рисуется ниже один
          var top = [];
          if (!fromRiser) {
            var cx0 = cA[0] + cnx * S[1], cy0 = cA[1] + cny * S[1];
            combOff[S[0]].push(S[1]);
            top = [[cx0, cy0, combZ[S[0]]], [cx0, cy0, 0]];
          }
          var p3 = top
            .concat(pl.map(function (p) { return [p[0], p[1], 0]; }))
            .concat([[end[0], end[1], z]]);
          o.push('<path d="' + axoPath(p3, t) + '" style="fill:none;stroke:' + S[2] + ';stroke-width:0.45"/>');
          // водорозетка — кружок на конце подъёма
          var e = t.P(end[0], end[1], z);
          o.push('<circle cx="' + n(e[0]) + '" cy="' + n(e[1]) + '" r="0.8" style="fill:#fff;stroke:' + S[2] + ';stroke-width:0.35"/>');
          if (S[0] === 'cw') {
            axoLevel(o, e[0] + 1.2, e[1] - 0.6, h.cw, COL_CW);
            marks.push({ p: e, t: q.t });
          }
        });
        if (!collAt) collAt = L.pts;
      });
      if (collAt && fromRiser) {
        // Пара стояков из перекрытия в точке, откуда расходятся подводки
        var sx0 = f.wsrc.x, sy0 = f.wsrc.y;
        [[-step / 2, COL_CW], [step / 2, COL_HW]].forEach(function (S) {
          var a = t.P(sx0 + S[0], sy0, -mm(600)), b = t.P(sx0 + S[0], sy0, 0);
          o.push('<line x1="' + n(a[0]) + '" y1="' + n(a[1]) + '" x2="' + n(b[0]) + '" y2="' + n(b[1]) +
            '" style="stroke:' + S[1] + ';stroke-width:0.8"/>');
        });
        var r0 = t.P(sx0, sy0, -mm(600));
        o.push(txt(r0[0] + 2.5, r0[1] + 3.5, 'Ст. В1, Т3 — с нижнего этажа', { size: 3.0 }));
        var r1 = t.P(sx0, sy0, 0);
        axoLevel(o, r1[0] - 14, r1[1], 0);
      } else if (collAt) {
        // Две гребёнки тонкими линиями своего цвета: от крайнего выхода до
        // крайнего с запасом на заглушку и кран с каждой стороны
        var ends = null;
        [['cw', COL_CW, AXO_COLL_MM], ['hw', COL_HW, AXO_COLL_MM + 250]].forEach(function (G) {
          var offs = combOff[G[0]];
          if (!offs.length) return;
          var lo = Math.min.apply(null, offs) - mm(120), hi = Math.max.apply(null, offs) + mm(120);
          var c0 = t.P(cA[0] + cnx * lo, cA[1] + cny * lo, combZ[G[0]]);
          var c1 = t.P(cA[0] + cnx * hi, cA[1] + cny * hi, combZ[G[0]]);
          o.push('<line x1="' + n(c0[0]) + '" y1="' + n(c0[1]) + '" x2="' + n(c1[0]) + '" y2="' + n(c1[1]) +
            '" style="stroke:' + G[1] + ';stroke-width:1.0;stroke-linecap:round"/>');
          // отметка слева у холодной гребёнки, справа у горячей — не слипаются
          if (G[0] === 'cw') axoLevel(o, Math.min(c0[0], c1[0]) - 15, (c0[0] < c1[0] ? c0 : c1)[1], G[2], COL_CW);
          else axoLevel(o, Math.max(c0[0], c1[0]) + 1.5, (c0[0] > c1[0] ? c0 : c1)[1], G[2], COL_HW);
          var mid = [(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2];
          if (!ends || mid[1] < ends[1]) ends = mid;     // выноска — от верхней гребёнки
        });
        if (ends) {
          // подпись на выноске, а не впритык к линии
          var lx = ends[0] + 8, ly = ends[1] - 12;
          o.push('<polyline points="' + n(ends[0]) + ',' + n(ends[1]) + ' ' + n(lx) + ',' + n(ly) + ' ' + n(lx + 27) + ',' + n(ly) +
            '" style="fill:none;stroke:#000;stroke-width:0.2"/>');
          o.push(txt(lx + 1, ly - 1, 'Коллекторы В1, Т3', { size: 3.0 }));
        }
      }
    } else {
      // Подписи на схеме К1 сходятся у основания стояка: там кончаются все
      // выпуски, стоит отметка пола стояка, а у унитаза рядом свой выпуск с
      // отметкой ±0,000 и подписью «d110, i=0,02». Раньше всё это ложилось
      // одно на другое. Теперь каждая подпись занимает прямоугольник, и
      // следующая ищет себе свободное место среди нескольких положений.
      var boxes = [];
      var hit = function (b) {
        return boxes.some(function (c) { return b[0] < c[2] && b[2] > c[0] && b[1] < c[3] && b[3] > c[1]; });
      };
      var overlap = function (b) {
        var s = 0;
        boxes.forEach(function (c) {
          var w = Math.min(b[2], c[2]) - Math.max(b[0], c[0]), h = Math.min(b[3], c[3]) - Math.max(b[1], c[1]);
          if (w > 0 && h > 0) s += w * h;
        });
        return s;
      };
      var take = function (cands) {              // cands: [[x0,y0,x1,y1, payload]]
        for (var ci = 0; ci < cands.length; ci++) if (!hit(cands[ci])) { boxes.push(cands[ci]); return cands[ci]; }
        // свободного места нет — берём, где перекрытие меньше всего
        var best = cands[0], bs = overlap(best);
        cands.forEach(function (c) { var s = overlap(c); if (s < bs) { bs = s; best = c; } });
        boxes.push(best);
        return best;
      };
      // уровень «▽ +0,000»: значок в точке, текст до x + 14
      var levelBox = function (x, y) { return [x - 1.4, y - 5.4, x + 14, y + 0.2]; };
      var putLevel = function (px, py, val, col, pref) {
        // pref: 'r' — сначала справа от точки, 'l' — слева
        var R = [px + 1.2, py - 0.6], Lf = [px - 15, py - 0.6];
        var pos = pref === 'l' ? [Lf, R, [Lf[0], Lf[1] - 5.5], [R[0], R[1] + 5.5]]
                               : [R, Lf, [R[0], R[1] - 5.5], [Lf[0], Lf[1] + 5.5]];
        var b = take(pos.map(function (p) { var bb = levelBox(p[0], p[1]); bb.p = p; return bb; }));
        axoLevel(o, b.p[0], b.p[1], val, col);
      };

      // сначала стояки: их положение и подписи не двигаются
      var riserDraw = risers.map(function (r, ri) {
        var a = t.P(r.x, r.y, -mm(600)), b = t.P(r.x, r.y, mm(H));
        o.push('<line x1="' + n(a[0]) + '" y1="' + n(a[1]) + '" x2="' + n(b[0]) + '" y2="' + n(b[1]) +
          '" style="stroke:' + COL_SEW + ';stroke-width:1.0"/>');
        var lbl = 'Ст. К1' + (risers.length > 1 ? '-' + (ri + 1) : '') + ' d110';
        o.push(txt(b[0] + 2, b[1] + 3, lbl, { size: 3.0, fill: COL_SEW }));
        boxes.push([b[0] + 2, b[1], b[0] + 2 + lbl.length * 1.55, b[1] + 3.6]);
        boxes.push([Math.min(a[0], b[0]) - 0.6, Math.min(a[1], b[1]), Math.max(a[0], b[0]) + 0.6, Math.max(a[1], b[1])]);
        axoLevel(o, b[0] - 14, b[1] + 2.2, H);
        boxes.push(levelBox(b[0] - 14, b[1] + 2.2));
        return r;
      });

      var dLabels = [];
      lines.forEach(function (L) {
        var q = fx[L.i], h = WET_H[q.t], d = L.d || h.d;
        var slope = d >= 110 ? 0.02 : 0.03;
        var len = 0, zs = [0];
        for (var k = 1; k < L.pts.length; k++) {
          len += Math.hypot(L.pts[k][0] - L.pts[k - 1][0], L.pts[k][1] - L.pts[k - 1][1]);
          zs.push(-len * slope);                     // уклон к стояку
        }
        var start = L.pts[0];
        var p3 = [[start[0], start[1], mm(h.sew)]].concat(L.pts.map(function (p, i) { return [p[0], p[1], zs[i]]; }));
        o.push('<path d="' + axoPath(p3, t) + '" style="fill:none;stroke:' + COL_SEW +
          ';stroke-width:' + (d >= 110 ? 0.8 : 0.5) + '"/>');
        var e = t.P(start[0], start[1], mm(h.sew));
        marks.push({ p: e, t: q.t });
        boxes.push([e[0] - 5.2, e[1] - 4.6, e[0] - 0.8, e[1] - 0.2]);   // кружок с буквой прибора
        dLabels.push({ L: L, zs: zs, d: d, slope: slope, e: e, sew: h.sew });
      });
      // отметка пола у стояка — слева, выпуски приборов — справа от своего конца
      riserDraw.forEach(function (r) {
        var fl = t.P(r.x, r.y, 0);
        putLevel(fl[0] - 14 - 1.2, fl[1] + 0.6, 0, null, 'r');
      });
      dLabels.forEach(function (D) { putLevel(D.e[0], D.e[1], D.sew, COL_SEW, 'r'); });
      // подпись диаметра и уклона — на самом длинном участке, а если там
      // занято — на соседних участках или над/под линией
      dLabels.forEach(function (D) {
        var L = D.L, s2 = 'd' + D.d + ', i=' + String(D.slope).replace('.', ',');
        var w = s2.length * 1.3, segs = [];
        for (var j = 1; j < L.pts.length; j++)
          segs.push({ j: j, l: Math.hypot(L.pts[j][0] - L.pts[j - 1][0], L.pts[j][1] - L.pts[j - 1][1]) });
        segs.sort(function (a, b) { return b.l - a.l; });
        var cands = [];
        segs.forEach(function (sg) {
          var j = sg.j;
          [0.5, 0.3, 0.7].forEach(function (u) {
            var mA = t.P(L.pts[j - 1][0] + (L.pts[j][0] - L.pts[j - 1][0]) * u,
              L.pts[j - 1][1] + (L.pts[j][1] - L.pts[j - 1][1]) * u,
              D.zs[j - 1] + (D.zs[j] - D.zs[j - 1]) * u);
            // над и под линией, дальше — со сдвигом вбок: короткий выпуск
            // у стояка уже подписи, и по центру ей места нет
            [[0, -1.4], [0, 4.2], [0, -5.6], [0, 8.4], [w / 2 + 2, -1.4], [-w / 2 - 2, -1.4],
             [w / 2 + 2, 4.2], [-w / 2 - 2, 4.2]].forEach(function (dd) {
              var cx = mA[0] + dd[0], cyy = mA[1] + dd[1];
              var bb = [cx - w / 2, cyy - 2.6, cx + w / 2, cyy + 0.4];
              bb.p = [cx, cyy];
              cands.push(bb);
            });
          });
        });
        if (!cands.length) return;
        var b = take(cands);
        o.push(txt(b.p[0], b.p[1], s2, { size: 2.5, anchor: 'middle', fill: COL_SEW }));
      });
    }

    // буквы приборов у концов трасс — как на планах этажа
    marks.forEach(function (m) {
      o.push('<circle cx="' + n(m.p[0] - 3) + '" cy="' + n(m.p[1] - 2.4) + '" r="2.1" style="fill:#fff;stroke:#000;stroke-width:0.2"/>');
      o.push(txt(m.p[0] - 3, m.p[1] - 1.5, (FIXT[m.t] || ['', '?'])[1], { size: 2.4, anchor: 'middle' }));
    });

    // Легенда и указания
    var LX = 312, ly = 34;
    o.push(txt(LX, ly, 'Условные обозначения', { size: 3.6 }));
    var leg = kind === 'sewer'
      ? [['К1 — бытовая канализация', COL_SEW]]
      : [['В1 — холодное водоснабжение', COL_CW], ['Т3 — горячее водоснабжение', COL_HW]];
    leg.forEach(function (r, i) {
      var yy = ly + 5 + i * 5;
      o.push('<line x1="' + LX + '" y1="' + n(yy) + '" x2="' + (LX + 9) + '" y2="' + n(yy) +
        '" style="stroke:' + r[1] + ';stroke-width:0.7"/>');
      o.push(txt(LX + 11.5, yy + 1.1, r[0], { size: 3.0 }));
    });
    var used = {};
    marks.forEach(function (m) { used[m.t] = true; });
    var ly2 = ly + 8 + leg.length * 5;
    Object.keys(used).forEach(function (k, i) {
      var yy = ly2 + i * 4.6;
      o.push('<circle cx="' + (LX + 2.1) + '" cy="' + n(yy - 1) + '" r="2.1" style="fill:#fff;stroke:#000;stroke-width:0.2"/>');
      o.push(txt(LX + 2.1, yy - 0.1, FIXT[k][1], { size: 2.4, anchor: 'middle' }));
      o.push(txt(LX + 6, yy, FIXT[k][0], { size: 3.0 }));
    });
    var notes = [
      'Фронтальная изометрия, ось Y под 45° без сокращения.',
      'Отметки — от чистого пола этажа (±0,000), м.'
    ];
    if (kind === 'sewer') {
      notes.push('Выпуски d50 — уклон 0,03, d110 — 0,02 к стояку.');
      notes.push('Повороты — отводами 45°; стояки на всю высоту этажа.');
    } else {
      notes.push('Подводки к приборам: ' + (opts.pipeLabel || 'PEX 16×2,2') + ', в теплоизоляции.');
      notes.push('Отметки водорозеток — до оси; уточнять по паспорту прибора.');
      if (opts.recirc) notes.push('Т4 (рециркуляция ГВС) — по плану водоснабжения этажа.');
    }
    notes.push('Трассы — по плану этажа, условно; уточняются по месту.');
    var ny = ly2 + Object.keys(used).length * 4.6 + 8;
    notes.forEach(function (s2, i) { o.push(txt(LX, ny + i * 4.4, s2, { size: 2.9 })); });
    return o.join('');
  }

  /**
   * Аксонометрические схемы по этажам: [{ title, svg }].
   * opts: { kind: 'water' | 'sewer', code, sheetStart, num, floor,
   *         floorH: [м, м], pipeLabel, recirc }
   */
  function axonoSheets(plans, opts) {
    opts = opts || {};
    var out = [], num = opts.sheetStart || 1;
    var fmt = opts.num || function (v) { return String(v); };
    var kind = opts.kind === 'sewer' ? 'sewer' : 'water';
    if (!plans || !plans.floors) return out;
    plans.floors.forEach(function (f, fi) {
      if (!f || !f.pxPerM || !(f.fixtures || []).length) return;
      if (opts.floor && opts.floor !== fi + 1) return;
      var body = axoBody(f, fi + 1, { kind: kind, floorH: (opts.floorH || [])[fi],
        pipeLabel: opts.pipeLabel, recirc: opts.recirc });
      if (!body) return;
      var ttl = 'Этаж 0' + (fi + 1) + '. Схема ' + (kind === 'sewer' ? 'системы К1' : 'систем В1, Т3');
      out.push({ title: ttl, svg: window.projectSheets.sheet({
        code: opts.code, sheet: fmt(num++), body: title(ttl) + body }) });
    });
    return out;
  }

  /** Листы ВК: [{title, svg}] — только по этажам, где расставлены приборы */
  /**
   * Планы водоснабжения и канализации.
   * opts.only: 'water' | 'sewer' — в проектах-образцах это разные разделы
   * со своими шифрами (В и К), поэтому листы выдаются порознь.
   */
  function waterSheets(plans, opts) {
    opts = opts || {};
    var out = [], num = opts.sheetStart || 1;
    var fmt = opts.num || function (v) { return String(v); };
    var only = opts.only || null;
    if (!plans || !plans.floors) return out;
    plans.floors.forEach(function (f, i) {
      if (!f.img || !f.pxPerM || !(f.fixtures || []).length) return;
      if (opts.floor && opts.floor !== i + 1) return;
      if (only !== 'sewer') {
        var t1 = 'Водоснабжение ' + (i + 1) + ' этажа';
        out.push({ title: t1, svg: window.projectSheets.sheet({
          code: opts.code, sheet: fmt(num++), body: title(t1) + waterBody(f, i + 1) }) });
      }
      if (only !== 'water' && (f.slines || []).length) {
        var t2 = 'Канализация ' + (i + 1) + ' этажа';
        out.push({ title: t2, svg: window.projectSheets.sheet({
          code: opts.code, sheet: fmt(num++), body: title(t2) + sewerBody(f, i + 1) }) });
      }
    });
    return out;
  }

  // ═══ Лист «Этаж N. Сводный план сетей» ══════════════════════════════════
  // Всё в одном виде: укладка тёплого пола, радиаторы, вода и канализация,
  // номера помещений с теплопотерями, экспликация и составы конструкций.
  // Данные помещений приходят из расчёта (opts.rooms), составы — из настроек.

  var SUM_PLAN = { x0: 100, y0: 24, x1: 296, y1: 202 };   // поле подложки
  var SUM_TBL = 300;                                       // левый край экспликации

  /**
   * Оси плана: длинные стены дают линии сетки, как в проектах-образцах —
   * цифры по горизонтали, буквы по вертикали. Готовой сетки у нас нет
   * (подложка — чертёж монтажника), поэтому оси берём из контуров стен:
   * длинная прямая стена и есть ось. Близкие линии сливаются в одну.
   */
  var AX_LET = 'АБВГДЕЖИКЛМНПРСТУФ'.split('');
  function axisGrid(f) {
    var g = f.geom;
    if (!g || !(g.walls || []).length || !f.pxPerM) return null;
    var ppm = f.pxPerM, vs = {}, hs = {};
    g.walls.forEach(function (pl) {
      for (var i = 0; i < pl.length; i++) {
        var a = pl[i], b = pl[(i + 1) % pl.length];
        var dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]);
        var L = Math.hypot(dx, dy);
        if (L < 1.5 * ppm) continue;                 // короткие куски осью не считаем
        var cell = 0.15 * ppm;
        if (dx < 0.3 * ppm) {
          var kx = Math.round((a[0] + b[0]) / 2 / cell);
          vs[kx] = (vs[kx] || 0) + L;
        } else if (dy < 0.3 * ppm) {
          var ky = Math.round((a[1] + b[1]) / 2 / cell);
          hs[ky] = (hs[ky] || 0) + L;
        }
      }
    });
    var pick = function (map) {
      var arr = Object.keys(map).map(function (k) { return { c: +k * 0.15 * ppm, w: map[k] }; });
      arr.sort(function (a, b) { return b.w - a.w; });
      arr = arr.slice(0, 10).sort(function (a, b) { return a.c - b.c; });
      var out = [];
      arr.forEach(function (r) {                     // ближе 0.8 м — та же ось
        var last = out[out.length - 1];
        if (last && r.c - last.c < 0.8 * ppm) { if (r.w > last.w) last.c = r.c; return; }
        out.push({ c: r.c, w: r.w });
      });
      return out.map(function (r) { return r.c; });
    };
    var xs = pick(vs), ys = pick(hs);
    if (xs.length < 2 || ys.length < 2) return null;
    return { xs: xs, ys: ys };
  }

  /** Оси и размерные цепочки: цифры снизу, буквы слева — как в образцах */
  function axesBody(f, t, box) {
    var G = axisGrid(f);
    if (!G) return '';
    var mm = function (px) { return Math.round(px / f.pxPerM * 1000); };
    var o = [];
    var X0 = t.X(G.xs[0]), X1 = t.X(G.xs[G.xs.length - 1]);
    var Y0 = t.Y(G.ys[0]), Y1 = t.Y(G.ys[G.ys.length - 1]);
    var LB = box.y1 + 10, LL = box.x0 - 10;          // где стоят кружки осей
    var DIM1 = box.y1 + 18, DIM2 = box.y1 + 25;      // цепочки: по осям и общая
    var DML1 = box.x0 - 18, DML2 = box.x0 - 25;
    var dash = 'stroke:#8a8a8a;stroke-width:0.18;stroke-dasharray:6 1.6 1 1.6';
    var mark = function (x, y, s) {
      o.push('<circle cx="' + n(x) + '" cy="' + n(y) + '" r="3.2" style="fill:#fff;stroke:#333;stroke-width:0.25"/>');
      o.push(txt(x, y + 1.3, s, { size: 3.2, anchor: 'middle' }));
    };
    // размерная цепочка: линия с засечками и подписью каждого пролёта
    var chain = function (pts, along, horiz, lab) {
      if (pts.length < 2) return;
      var A = horiz ? [pts[0], along] : [along, pts[0]];
      var B = horiz ? [pts[pts.length - 1], along] : [along, pts[pts.length - 1]];
      o.push('<line x1="' + n(A[0]) + '" y1="' + n(A[1]) + '" x2="' + n(B[0]) + '" y2="' + n(B[1]) +
        '" style="stroke:#333;stroke-width:0.2"/>');
      pts.forEach(function (c) {
        var x = horiz ? c : along, y = horiz ? along : c;
        o.push('<line x1="' + n(x - 1) + '" y1="' + n(y - 1) + '" x2="' + n(x + 1) + '" y2="' + n(y + 1) +
          '" style="stroke:#333;stroke-width:0.25"/>');
      });
      for (var i = 0; i + 1 < pts.length; i++) {
        var mid = (pts[i] + pts[i + 1]) / 2, v = lab[i];
        if (horiz) o.push(txt(mid, along - 1.4, String(v), { size: 3.0, anchor: 'middle' }));
        else o.push('<text x="' + n(along - 1.4) + '" y="' + n(mid) + '" font-size="3" text-anchor="middle"' +
          ' transform="rotate(-90 ' + n(along - 1.4) + ' ' + n(mid) + ')">' + esc(String(v)) + '</text>');
      }
    };
    G.xs.forEach(function (c, i) {
      var x = t.X(c);
      o.push('<line x1="' + n(x) + '" y1="' + n(box.y0) + '" x2="' + n(x) + '" y2="' + n(LB - 3.4) +
        '" style="' + dash + '"/>');
      mark(x, LB, String(i + 1));
    });
    G.ys.forEach(function (c, i) {
      var y = t.Y(c);
      o.push('<line x1="' + n(LL + 3.4) + '" y1="' + n(y) + '" x2="' + n(box.x1) + '" y2="' + n(y) +
        '" style="' + dash + '"/>');
      mark(LL, y, AX_LET[G.ys.length - 1 - i] || String(i + 1));
    });
    var xsMM = [], ysMM = [];
    for (var i2 = 0; i2 + 1 < G.xs.length; i2++) xsMM.push(mm(G.xs[i2 + 1] - G.xs[i2]));
    for (var j2 = 0; j2 + 1 < G.ys.length; j2++) ysMM.push(mm(G.ys[j2 + 1] - G.ys[j2]));
    chain(G.xs.map(t.X), DIM1, true, xsMM);
    chain([X0, X1], DIM2, true, [mm(G.xs[G.xs.length - 1] - G.xs[0])]);
    chain(G.ys.map(t.Y), DML1, false, ysMM);
    chain([Y0, Y1], DML2, false, [mm(G.ys[G.ys.length - 1] - G.ys[0])]);
    return o.join('');
  }

  /** Компактный «пирог» конструкции с подписями слоёв */
  function pieBlock(o, x, y, w, title2, layers) {
    o.push(txt(x + w / 2, y - 1.6, title2, { size: 3.3, anchor: 'middle' }));
    var yy = y, i, labY = -1e9;
    for (i = 0; i < layers.length; i++) {
      var h = Math.max(1.8, Math.min(5, (layers[i].thick || 60) / 40));
      o.push('<rect x="' + n(x) + '" y="' + n(yy) + '" width="' + n(w) + '" height="' + n(h) +
        '" style="fill:none;stroke:#000;stroke-width:0.2"/>');
      if (layers[i].hatch)
        for (var hx = x + 1.2; hx < x + w - 0.6; hx += 2.6)
          o.push(line(hx, yy + h, Math.min(hx + h, x + w), yy));
      // Тонкие слои (стяжка, плёнка) тоньше строки подписи: подписи шли одна
      // по другой. Держим шаг подписей не меньше 3,2 мм, выноска — ломаная.
      var mid = yy + h / 2, ly2 = Math.max(mid, labY + 3.2);
      o.push('<polyline points="' + n(x + w) + ',' + n(mid) + ' ' + n(x + w + 3) + ',' + n(mid) +
        ' ' + n(x + w + 5) + ',' + n(ly2) + ' ' + n(x + w + 6) + ',' + n(ly2) +
        '" style="fill:none;stroke:#000;stroke-width:0.2"/>');
      o.push(txt(x + w + 7, ly2 + 1, layers[i].name, { size: 2.7 }));
      labY = ly2;
      yy += h;
    }
    return yy;
  }

  function line(x1, y1, x2, y2) {
    return '<line x1="' + n(x1) + '" y1="' + n(y1) + '" x2="' + n(x2) + '" y2="' + n(y2) +
      '" style="stroke:#000;stroke-width:0.2"/>';
  }

  /** Лист «Этаж N. Сводный план сетей» */
  function summaryBody(f, num, opts, stepMm) {
    var t = fit(f, SUM_PLAN), o = [];
    stepMm = stepMm || opts.stepMm || 150;
    var vec = wallsBody(f, t);
    o.push(vec || imageTag(f, t, 0.5));
    var axes = vec ? axesBody(f, t, SUM_PLAN) : '';  // оси и размеры — по контурам стен
    o.push(axes);

    // 1) тёплый пол — та же укладка, что на профильном листе, но тоньше
    var FL = floorLoops(f, stepMm, loopLimit(stepMm));
    drawBundle(o, FL.bundle, t, f, 0.7);
    FL.forEach(function (Z) {
      Z.loops.forEach(function (lp) {
        if (!lp.sup) return;
        var rr2 = stepMm / 1000 * (f.pxPerM || 100) * t.s * 0.5;
        o.push('<path d="' + pathR(lp.sup, t, rr2) + '" style="fill:none;stroke:' + COL_SUP +
          ';stroke-width:0.28;stroke-linejoin:round;stroke-linecap:round"/>');
        o.push('<path d="' + pathD([lp.sup[lp.sup.length - 1], lp.ret[0]], t) + '" style="fill:none;stroke:' + COL_RET +
          ';stroke-width:0.28;stroke-linecap:round"/>');
        o.push('<path d="' + pathR(lp.ret, t, rr2) + '" style="fill:none;stroke:' + COL_RET +
          ';stroke-width:0.28;stroke-linejoin:round;stroke-linecap:round"/>');
      });
    });
    if (f.coll) collectorMark(f.coll, t, f, o, true);   // подпись — ниже, в обход рамок помещений

    // 2) радиаторы
    (f.rads || []).forEach(function (r) {
      var wl = r.w * t.s, hl = Math.max(0.9, 0.14 * (f.pxPerM || 100) * t.s);
      o.push('<g transform="translate(' + n(t.X(r.x)) + ',' + n(t.Y(r.y)) + ') rotate(' + (r.ang || 0) + ')">' +
        '<rect x="' + n(-wl / 2) + '" y="' + n(-hl / 2) + '" width="' + n(wl) + '" height="' + n(hl) +
        '" style="fill:rgba(210,34,34,0.35);stroke:#d22222;stroke-width:0.3"/></g>');
    });

    // 3) вода и канализация — тонко, чтобы не спорили с отоплением
    (f.wlines || []).forEach(function (w) {
      if (w.pts && w.pts.length > 1)
        o.push('<path d="' + pathD(w.pts, t) + '" style="fill:none;stroke:' + COL_CW +
          ';stroke-width:0.28;stroke-dasharray:2,1"/>');
    });
    (f.slines || []).forEach(function (s) {
      if (s.pts && s.pts.length > 1)
        o.push('<path d="' + pathD(s.pts, t) + '" style="fill:none;stroke:' + COL_SEW +
          ';stroke-width:0.35"/>');
    });
    (f.fixtures || []).forEach(function (q) {
      fixtureMark(q, t, f, o, q.t === 'riser' ? '#7a5c00' : COL_CW);
    });

    // 4) номера помещений на плане: выноска с номером, площадью и теплопотерями
    var rooms = (opts.rooms || []).filter(function (r) { return (r.floor || 1) === num; });
    var byName = {};
    rooms.forEach(function (r) { byName[String(r.name || '').trim().toLowerCase()] = r; });
    var used = {};
    // Рамка с данными помещения закрывала то, что стоит в его середине:
    // значок коллектора ТП в котельной, букву прибора в санузле. Значки
    // занимают место первыми, рамка ищет свободное — но только внутри своего
    // помещения: иначе в тесной котельной её выносило на стену. Подпись
    // «Коллектор ТП» ставится последней, в обход рамок.
    var lp = labelPlacer(), ppmS = (f.pxPerM || 100) * t.s;
    var cw = 0, cX = 0, cY = 0;
    if (f.coll) {
      cw = Math.max(3.5, 0.55 * ppmS); cX = t.X(f.coll.x); cY = t.Y(f.coll.y);
      if (collAngle(f, 'tp') % 180 === 90) lp.add([cX - cw * 0.18 - 1.2, cY - cw / 2, cX + cw * 0.18 + 1.2, cY + cw / 2]);
      else lp.add([cX - cw / 2, cY - cw * 0.18 - 1.2, cX + cw / 2, cY + cw * 0.18]);
    }
    (f.fixtures || []).forEach(function (q) { lp.add(fixtureBox(q, t, ppmS, 2)); });
    // точка листа → точка подложки (обратное к t.X / t.Y)
    var toImg = function (X, Y) { return [(X - t.ox) / t.s, (Y - t.oy) / t.s]; };
    (f.zones || []).forEach(function (z) {
      var key = String(z.name || '').trim().toLowerCase();
      var r = byName[key];
      if (!r || used[key]) return;
      used[key] = 1;
      var c = centroid(z.pts), X0 = t.X(c[0]), Y0 = t.Y(c[1]);
      var lines2 = ['[' + r.id + ']', r.name, Math.round(r.q) + ' Вт', r.area.toFixed(1) + ' м²'];
      // Два размера рамки: обычная и компактная (мельче шрифт, уже и ниже).
      // Компактная берётся, только когда обычной нет места внутри помещения
      // без касания значков: в тесном санузле обычная рамка задевала ванну.
      var SIZES = [
        { w: 20, top: 7, bot: 6.6, h: 13.6, y0: 4, step: 3.2, f1: 2.8, f2: 2.5, pen: 0 },
        { w: Math.max(15, textW(r.name, 1.9) + 1.6), top: 5.2, bot: 5.0, h: 10.2, y0: 2.9, step: 2.4, f1: 2.2, f2: 1.9, pen: 0.5 }
      ];
      var offs = [];
      for (var ddx = -16; ddx <= 16; ddx += 2) for (var ddy = -12; ddy <= 12; ddy += 1.5) offs.push([ddx, ddy]);
      offs.sort(function (a, b) { return Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]); });
      var cands = [];
      SIZES.forEach(function (S) {
        offs.forEach(function (d) {
          var X = X0 + d[0], Y = Y0 + d[1];
          var b = [X - S.w / 2, Y - S.top, X + S.w / 2, Y + S.bot]; b.p = [X, Y]; b.S = S;
          // углы рамки вне помещения — штраф: рамка на стене хуже, чем задетая буква
          var out = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]]
            .filter(function (p) { return !pip(toImg(p[0], p[1]), z.pts); }).length;
          b.pen = out * 400 + S.pen;
          cands.push(b);
        });
      });
      var b = lp.place(cands), X = b.p[0], Y = b.p[1], S = b.S;
      o.push('<rect x="' + n(X - S.w / 2) + '" y="' + n(Y - S.top) + '" width="' + n(S.w) +
        '" height="' + S.h + '" rx="0.6" style="fill:#ffffff;fill-opacity:0.86;stroke:#000;stroke-width:0.2"/>');
      lines2.forEach(function (s2, i) {
        o.push(txt(X, Y - S.y0 + i * S.step, s2, { size: i ? S.f2 : S.f1, anchor: 'middle' }));
      });
    });
    if (f.coll) {
      var cLab = 'Коллектор ТП', cLw = textW(cLab, 2.8), ch = cw * 0.36;
      // повёрнутый на 90° значок: высота и ширина меняются местами
      var vertC = collAngle(f, 'tp') % 180 === 90, eh = vertC ? cw : ch, ew = vertC ? ch : cw;
      var cb = lp.place([[0, eh / 2 + 3.1], [0, -eh / 2 - 2.6], [ew / 2 + 1.5 + cLw / 2, 1], [-ew / 2 - 1.5 - cLw / 2, 1],
        [0, eh / 2 + 6.6], [0, -eh / 2 - 6]].map(function (d) {
        var bx = [cX + d[0] - cLw / 2, cY + d[1] - 2.4, cX + d[0] + cLw / 2, cY + d[1] + 0.4]; bx.p = [cX + d[0], cY + d[1]];
        return bx;
      }));
      o.push(txt(cb.p[0], cb.p[1], cLab, { size: 2.8, anchor: 'middle', fill: '#b35900' }));
    }

    // 5) экспликация помещений справа
    var EX = SUM_TBL, EY = 26, W = [12, 46, 22, 24], rh = 5.6;
    var Wsum = W.reduce(function (a, b) { return a + b; }, 0);
    o.push(txt(EX + Wsum / 2, EY - 2.2, 'Экспликация помещений ' + num + ' этажа',
      { size: 3.6, anchor: 'middle' }));
    var totA = 0, totQ = 0;
    var body = rooms.map(function (r) {
      totA += r.area; totQ += r.q;
      return [r.id, r.name, r.area.toFixed(2) + ' м²', Math.round(r.q) + ' Вт'];
    });
    if (body.length) body.push(['', '', totA.toFixed(2) + ' м²', Math.round(totQ) + ' Вт']);
    var all = [['№', 'Наименование', 'Площадь', 'Теплопотери']].concat(body);
    all.forEach(function (r, ri) {
      var y = EY + ri * rh, x = EX;
      o.push('<rect x="' + n(EX) + '" y="' + n(y) + '" width="' + n(Wsum) + '" height="' + rh +
        '" style="fill:none;stroke:#000;stroke-width:0.2"/>');
      W.forEach(function (w, ci) {
        o.push(txt(ci === 1 ? x + 1.2 : x + w / 2, y + rh / 2 + 1, r[ci] == null ? '' : r[ci],
          { size: ri ? 2.9 : 3.1, anchor: ci === 1 ? 'start' : 'middle' }));
        if (ri === 0 && ci) o.push('<line x1="' + n(x) + '" y1="' + n(EY) + '" x2="' + n(x) +
          '" y2="' + n(EY + all.length * rh) + '" style="stroke:#000;stroke-width:0.15"/>');
        x += w;
      });
    });

    // 6) составы конструкций внизу. Под планом с осями стоят кружки осей
    // (y1 + 10) и две размерные цепочки (y1 + 18, y1 + 25) — составы и
    // масштаб опускаются ниже них, иначе «Состав пола» и подпись масштаба
    // ложились прямо на цепочку и марку оси.
    var cy = axes ? SUM_PLAN.y1 + 36 : 216;
    if (opts.floorLayers && opts.floorLayers.length)
      pieBlock(o, 108, cy, 44, 'Состав пола ' + num + ' этажа', opts.floorLayers);
    if (opts.wallLayers && opts.wallLayers.length)
      pieBlock(o, 196, cy, 44, 'Состав наружной стены', opts.wallLayers.map(function (L) {
        return { name: L.name, thick: L.thick, hatch: /утепл|вата|пенопл|эппс|xps/i.test(L.name) };
      }));

    // 7) условные обозначения
    var ly = 216;
    o.push(txt(SUM_TBL, ly - 1.6, 'Условные обозначения', { size: 3.3 }));
    [['Тёплый пол — подача', COL_SUP], ['Тёплый пол — обратка', COL_RET],
     ['Радиаторы', '#d22222'], ['Водоснабжение В1/Т3', COL_CW], ['Канализация К1', COL_SEW]]
      .forEach(function (r, i) {
        var yy = ly + 3.4 + i * 4.4;
        o.push('<line x1="' + n(SUM_TBL) + '" y1="' + n(yy) + '" x2="' + n(SUM_TBL + 8) + '" y2="' + n(yy) +
          '" style="stroke:' + r[1] + ';stroke-width:0.6"/>');
        o.push(txt(SUM_TBL + 10, yy + 1, r[0], { size: 2.9 }));
      });
    var scale = f.pxPerM ? Math.round(1000 / (f.pxPerM * t.s)) : 0;
    if (scale) o.push(txt(108, axes ? 271 : 208, 'Масштаб печати ~1:' + scale + ' (лист А3)', { size: 3.0 }));
    o.push(txt(228, 273.8, 'Сети нанесены автоматически по смете и разметке планов heatcalc.ru.', { size: 3.0 }));
    return o.join('');
  }

  /** Габариты зоны «котельная» (мм) — для листа компоновки */
  function boilerRoom(plans) {
    if (!plans || !plans.floors) return null;
    for (var i = 0; i < plans.floors.length; i++) {
      var f = plans.floors[i];
      if (!f.pxPerM) continue;
      for (var j = 0; j < (f.zones || []).length; j++) {
        var z = f.zones[j];
        if (z.type !== 'boiler') continue;
        var bb = bbox(z.pts);
        return {
          w: Math.round((bb[2] - bb[0]) / f.pxPerM * 1000),
          d: Math.round((bb[3] - bb[1]) / f.pxPerM * 1000)
        };
      }
    }
    return null;
  }

  /**
   * Листы из планов: [{kind, title, svg}].
   * kind: 'summary' — сводный план сетей (идёт в общую часть комплекта, MEP),
   * 'floor' и 'tp' — планы отопления (раздел «О»). opts.only ограничивает
   * набор: у разделов свои шифры и своя нумерация, поэтому листы одного
   * этажа приходится собирать в два захода.
   * opts.num — как печатать номер листа (в разделе это «О-3», а не «3»).
   */
  function sheets(plans, opts) {
    opts = opts || {};
    var out = [], num = opts.sheetStart || 1;
    var fmt = opts.num || function (n) { return String(n); };
    var want = function (k) { return !opts.only || opts.only.indexOf(k) >= 0; };
    if (!plans || !plans.floors) return out;
    // Коллектор ТП принимает и контуры верхних этажей без своего коллектора:
    // «Коллектор ТП на 11 выходов», «Подъём на контуры ТП 2-го этажа»
    var tpFl = plans.floors.map(function (fl) { return (fl.zones || []).some(function (z) { return z.type === 'tp'; }); });
    var tpOut = plans.floors.map(function (fl, k) {
      try { return tpFl[k] && fl.pxPerM ? loopRows(fl, (opts.steps && opts.steps[k]) || opts.stepMm || 150, opts.rooms).length : 0; }
      catch (e) { return 0; }
    });
    var tpExtra = function (i) {
      var f = plans.floors[i], ex = {}, j;
      if (!tpFl[i]) return ex;
      if (f.coll) {
        var tot = tpOut[i], ups = [];
        for (j = i + 1; j < plans.floors.length && tpFl[j] && !plans.floors[j].coll; j++) { tot += tpOut[j]; ups.push(j + 1); }
        ex.collOutputs = tot; ex.tpAbove = ups;
      } else {
        for (j = i - 1; j >= 0; j--) if (plans.floors[j].coll) {
          if (plans.floors[j].w === f.w && plans.floors[j].h === f.h)
            ex.tpBelow = { floor: j + 1, x: plans.floors[j].coll.x, y: plans.floors[j].coll.y };
          break;
        }
      }
      return ex;
    };
    plans.floors.forEach(function (f, i) {
      if (!f.img || !f.pxPerM) return;
      // opts.floor — собрать только этот этаж: в эталоне листы идут этажами
      // (план системы, объёмный вид, следующая система), а не пачками.
      if (opts.floor && opts.floor !== i + 1) return;
      // Шаг укладки у каждого этажа свой (в смете это ufhStep1 / ufhStep2).
      var st = (opts.steps && opts.steps[i]) || opts.stepMm || 150;
      // Сводный план сетей — первым: на нём сразу всё, остальные листы этажа
      // раскрывают отдельные системы. Нужны помещения расчёта (экспликация).
      if (want('summary') && (opts.rooms || []).some(function (r) { return (r.floor || 1) === i + 1; })) {
        var t0 = 'Этаж ' + String(i + 1).padStart(2, '0') + '. Сводный план сетей';
        out.push({
          kind: 'summary', title: t0,
          svg: window.projectSheets.sheet({
            code: opts.code, sheet: fmt(num++),
            body: title(t0) + summaryBody(f, i + 1, opts, st)
          })
        });
      }
      if (want('floor')) {
        var tt = 'План ' + (i + 1) + ' этажа';
        out.push({
          kind: 'floor', title: tt,
          svg: window.projectSheets.sheet({
            code: opts.code, sheet: fmt(num++),
            body: title(tt) + floorBody(f, i + 1)
          })
        });
      }
      if (want('tp') && (f.zones || []).some(function (z) { return z.type === 'tp'; })) {
        // название — как в проектах: «Этаж 01. План напольного отопления»
        var t2 = 'Этаж ' + String(i + 1).padStart(2, '0') + '. План напольного отопления';
        out.push({
          kind: 'tp', title: t2,
          svg: window.projectSheets.sheet({
            code: opts.code, sheet: fmt(num++),
            body: title(t2) + tpBody(f, i + 1, st, opts.rooms, (function () {
              var o2 = {}, k, ex = tpExtra(i);
              for (k in opts) o2[k] = opts[k];
              for (k in ex) o2[k] = ex[k];
              return o2;
            })())
          })
        });
      }
    });
    return out;
  }

  /**
   * Раскладка тёплого пола этажа для сметы и КП — без рамки листа: план
   * (подложка бледно), комнаты, петли, пучок подводок, коллектор и номера
   * контуров. Числа — те же loopRows, что на листе и в смете.
   * Возвращает { svg, rows } или null, если петель на этаже нет.
   * Рисуется в пикселях подложки (viewBox по комнатам с полем), поэтому
   * толщины — в метрах через pxPerM.
   */
  // Радиаторы на плане дома: прибор, трассы и пучок — свои цвета, чтобы не
  // путаться с петлями тёплого пола (те — светлые красный и синий).
  var COL_RAD = '#c62828', COL_RAD_BUNDLE = '#9b2c2c';

  /**
   * Подводки пучком, как на листах проектировщиков: каждая труба идёт своей линией, пучок
   * ровный, на развилке линии расходятся без пересечений.
   *
   * Маршруты — ветви ОДНОГО дерева от общего начала (кратчайшие пути от коллектора), поэтому
   * порядок линий в пучке можно задать раз и навсегда: обходим дерево в глубину, ветви на
   * каждом узле — справа налево по повороту. Лист (конец маршрута) получает номер в этом
   * обходе; на любом участке под ним лежит подряд идущий набор листьев — их номера и есть
   * места линий. Пара (подача и обратка) — две линии с шагом gap, между парами промежуток.
   *
   * routes — [{ pts }] (ломаные из клеточных точек от общего начала). Возвращает для каждого
   * маршрута [левая, правая] ломаные по ходу от начала (левая — слева по ходу).
   */
  var LANE_PITCH = 2.0;
  function laneLines(routes, gap) {
    var pitch = LANE_PITCH * gap;                              // пара + зазор между парами
    var key = function (p) { return Math.round(p[0] * 2) / 2 + ',' + Math.round(p[1] * 2) / 2; };
    var R = routes.map(function (r) {
      var out = [];
      orthoPath(r.pts).forEach(function (p) { if (!out.length || key(out[out.length - 1]) !== key(p)) out.push(p); });
      return out;
    });
    var root = { p: R[0] && R[0][0], map: {}, kids: [], ends: [] }, nodesOf = [];
    R.forEach(function (pts, ri) {
      var node = root, list = [root];
      for (var i = 1; i < pts.length; i++) {
        var k = key(pts[i]), ch = node.map[k];
        if (!ch) { ch = { p: pts[i], map: {}, kids: [], ends: [], parent: node }; node.map[k] = ch; node.kids.push(ch); }
        node = ch; list.push(node);
      }
      node.ends.push(ri); nodesOf.push(list);
    });
    var rank = 0, leafRank = [];
    var dirOf = function (a, b) { var dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1], L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L]; };
    var dfs = function (node, din) {
      node.lo = rank;
      node.ends.forEach(function (ri) { leafRank[ri] = rank++; });
      var kids = node.kids.map(function (c) { var d = dirOf(node, c); return { c: c, d: d, k: din ? -(din[0] * d[1] - din[1] * d[0]) + (din[0] * d[0] + din[1] * d[1] < -0.5 ? 2 : 0) : Math.atan2(d[1], d[0]) }; });
      kids.sort(function (a, b) { return a.k - b.k; });
      kids.forEach(function (o) { dfs(o.c, o.d); });
      node.hi = rank - 1;
    };
    dfs(root, null);
    var mm = function (v) { return Math.round(v * 10) / 10; };
    var assemble = function (P, offs) {
      var out = [], prev = null;
      for (var e = 1; e < P.length; e++) {
        var a = P[e - 1], b = P[e], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
        if (L < 1e-6) continue;
        var ux = dx / L, uy = dy / L, nx = uy, ny = -ux, o = offs[e];
        var A = [a[0] + nx * o, a[1] + ny * o], B = [b[0] + nx * o, b[1] + ny * o];
        if (!prev) out.push(A);
        else {
          var dot = prev.ux * ux + prev.uy * uy;
          if (Math.abs(dot) < 0.5) {                          // поворот: пересечение сдвинутых прямых
            out.pop();
            out.push(Math.abs(prev.ux) > 0.5 ? [A[0], prev.A[1]] : [prev.A[0], A[1]]);
          } else if (dot < 0 || Math.abs(prev.o - o) > 1e-6) out.push(A);   // уступ между полосами
          else out.pop();                                      // та же линия — склеить
        }
        out.push(B);
        prev = { ux: ux, uy: uy, o: o, A: A };
      }
      // лишние точки на прямых
      var res = [];
      out.forEach(function (p, i) {
        var q = res[res.length - 1], q2 = res[res.length - 2];
        if (q && q2 && Math.abs((q[0] - q2[0]) * (p[1] - q[1]) - (q[1] - q2[1]) * (p[0] - q[0])) < 1e-6) res.pop();
        if (!res.length || Math.abs(res[res.length - 1][0] - p[0]) > 1e-6 || Math.abs(res[res.length - 1][1] - p[1]) > 1e-6) res.push([mm(p[0]), mm(p[1])]);
      });
      return res;
    };
    return R.map(function (P, ri) {
      var nodes = nodesOf[ri], offL = [0], offR = [0];
      for (var e = 1; e < P.length; e++) {
        var nd = nodes[e], idx = leafRank[ri] - nd.lo, cnt = nd.hi - nd.lo + 1;
        var o = (idx - (cnt - 1) / 2) * pitch;
        offL.push(o + gap / 2); offR.push(o - gap / 2);
      }
      var pair = [assemble(P, offL), assemble(P, offR)];
      pair.off0 = offL.length > 1 ? offL[1] - gap / 2 : 0;       // место пары вдоль корпуса коллектора
      return pair;
    });
  }

  /**
   * Выход труб из корпуса коллектора: все подводки сначала идут прямо от корпуса (по линии
   * отводов, на stub), рядом, в порядке будущих веток, и только потом расходятся. Без этого
   * все линии росли из одной точки в центре коллектора, а не из его гребёнки.
   * pts — маршрут от центра коллектора; возвращает маршрут [центр, точка выхода, … прежний путь].
   */
  function collectorFan(pts, C, ang, stub) {
    var a = ang * Math.PI / 180, d = [Math.sin(a), -Math.cos(a)];
    var T = [C.x + d[0] * stub, C.y + d[1] * stub], j = -1, i;
    for (i = 1; i < pts.length; i++) {
      if ((pts[i][0] - C.x) * d[0] + (pts[i][1] - C.y) * d[1] >= stub - 0.01) { j = i; break; }
    }
    if (j < 0) return pts;                                    // маршрут уходит вбок — оставляем как есть
    var out = [[C.x, C.y], T];
    orthoPath([T, pts[j]]).slice(1).forEach(function (q) { out.push(q); });
    for (i = j + 1; i < pts.length; i++) out.push(pts[i]);
    return out;
  }

  // Оформление плана дома в смете и КП — как на листах проектировщиков (корпус
  // Galf, 03.10.2026): тонкие линии, подача красная, обратка сине-фиолетовая, у
  // поворотов дуги, подложка плана видна, комнаты не залиты. Раньше линии были
  // в полтора раза толще шага, пастельные, с острыми углами.
  var V_SUP = '#e0484a', V_RET = '#5560d8';
  // радиаторы — те же красный/синий, но темнее: трассы радиаторов и подводки пола идут одними коридорами
  var V_RSUP = '#a61b1b', V_RRET = '#26359f';
  /** Ломаная со скруглёнными углами: дуга радиусом r (число или функция (a, b, c) → радиус;
   *  не больше половины соседних звеньев) */
  /**
   * Возвраты назад по той же линии: подводка проскочила точку входа в петлю и вернулась (A→B→C на одной
   * прямой, C с той же стороны от B, что и A). Остаётся двойной хвостик в несколько пикселей, на плане он
   * читается как огрызок трубы. Точку B убираем — A→C идёт напрямую.
   */
  function despur(P) {
    var out = P.slice(), i = 1;
    while (i < out.length - 1) {
      var a = out[i - 1], b = out[i], c = out[i + 1];
      var d1x = b[0] - a[0], d1y = b[1] - a[1], d2x = c[0] - b[0], d2y = c[1] - b[1];
      var cr = d1x * d2y - d1y * d2x, dot = d1x * d2x + d1y * d2y;
      if (Math.abs(cr) < 1e-6 * (Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y) + 1e-9) * 1e3 && dot < 0) {
        out.splice(i, 1); i = Math.max(1, i - 1);
      } else i++;
    }
    return out;
  }
  function roundedD(pts, r) {
    var mm = function (v) { return Math.round(v * 10) / 10; };
    if (!pts || pts.length < 2) return '';
    var d = 'M' + mm(pts[0][0]) + ' ' + mm(pts[0][1]);
    for (var i = 1; i < pts.length - 1; i++) {
      var a = pts[i - 1], b = pts[i], c = pts[i + 1];
      var la = Math.hypot(a[0] - b[0], a[1] - b[1]), lc = Math.hypot(c[0] - b[0], c[1] - b[1]);
      if (la < 1e-6 || lc < 1e-6) continue;
      var cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      var rr = Math.min(typeof r === 'function' ? r(a, b, c) : r, la / 2, lc / 2);
      if (Math.abs(cross) < 1e-6 * la * lc || rr < 0.5) { d += 'L' + mm(b[0]) + ' ' + mm(b[1]); continue; }
      d += 'L' + mm(b[0] + (a[0] - b[0]) / la * rr) + ' ' + mm(b[1] + (a[1] - b[1]) / la * rr) +
        'Q' + mm(b[0]) + ' ' + mm(b[1]) + ' ' + mm(b[0] + (c[0] - b[0]) / lc * rr) + ' ' + mm(b[1] + (c[1] - b[1]) / lc * rr);
    }
    var z = pts[pts.length - 1];
    return d + 'L' + mm(z[0]) + ' ' + mm(z[1]);
  }
  function ufhView(f, stepMm, rooms, opts) {
    opts = opts || {};
    if (!f || !f.pxPerM) return null;
    var hasTp = (f.zones || []).some(function (z) { return z.type === 'tp'; });
    var rows = hasTp ? loopRows(f, stepMm, rooms || []) : [];
    var RR = null;
    if (opts.rads && (f.rads || []).length) {
      try { RR = radRoutes(f, stepMm, !!opts.tee, opts.connMap || null); } catch (e) { RR = null; }
    }
    if (!rows.length && !RR) return null;
    var ppm = f.pxPerM, bundle = hasTp ? (floorLoops(f, stepMm, loopLimit(stepMm)).bundle || []) : [];
    var all = [];
    (f.zones || []).forEach(function (z) { (z.pts || []).forEach(function (p) { all.push(p); }); });
    if (f.coll) all.push([f.coll.x, f.coll.y]);
    if (RR) (f.rads || []).forEach(function (r) { all.push([r.x, r.y]); });
    var b = bbox(all), pad = 0.6 * ppm;
    var X0 = b[0] - pad, Y0 = b[1] - pad, W = b[2] - b[0] + 2 * pad, H = b[3] - b[1] + 2 * pad;
    var m = function (v) { return Math.round(v * 10) / 10; };
    var P = function (pts) { return pts.map(function (p) { return m(p[0]) + ',' + m(p[1]); }).join(' '); };
    var lw = 0.035 * ppm, o = [];
    o.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + m(X0) + ' ' + m(Y0) + ' ' + m(W) + ' ' + m(H) +
      '" style="display:block;background:#fff" font-family="system-ui,sans-serif">');
    if (f.img) o.push('<image x="0" y="0" width="' + f.w + '" height="' + f.h + '" preserveAspectRatio="none" opacity="' +
      (opts.imgOpacity != null ? opts.imgOpacity : 0.42) + '" href="' + String(f.img).replace(/&/g, '&amp;') + '"/>');
    // комнаты: тёплый пол — тёплой заливкой, прочие — контуром
    (f.zones || []).forEach(function (z) {
      if (!z.pts || z.pts.length < 3) return;
      var st = z.type === 'tp' ? 'fill:#fff4e6;fill-opacity:0.45;stroke:#e8a45c;stroke-width:' + m(lw * 0.45)
        : z.type === 'cold' ? 'fill:#e9e9e9;stroke:#9a9a9a;stroke-width:' + m(lw * 0.6)
          : 'fill:none;stroke:#8a94a6;stroke-width:' + m(lw * 0.6) + ';stroke-dasharray:' + m(lw * 3) + ',' + m(lw * 2);
      o.push('<polygon points="' + P(z.pts) + '" style="' + st + '"/>');
    });
    // Пучок труб на участке: n пар — 2n тонких линий рядом, красная/синяя по очереди
    // (как подводки на листах проектировщиков), а не одна толстая полоса
    var pipeBundle = function (sg, w0) {
      var n2 = Math.max(2, Math.round(sg.n * 2)), gap = Math.max(lw * 1.6, BUNDLE_DRAW_M * ppm * 1.05);
      var dx = sg.b[0] - sg.a[0], dy = sg.b[1] - sg.a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
      if (n2 > 16) {                                   // очень толстый пучок — полоса, линии слились бы
        o.push('<line x1="' + m(sg.a[0]) + '" y1="' + m(sg.a[1]) + '" x2="' + m(sg.b[0]) + '" y2="' + m(sg.b[1]) +
          '" style="stroke:' + COL_BUNDLE + ';stroke-opacity:0.85;stroke-linecap:butt;stroke-width:' + m(n2 * gap) + '"/>');
        return;
      }
      for (var k = 0; k < n2; k++) {
        var off = (k - (n2 - 1) / 2) * gap;
        o.push('<line x1="' + m(sg.a[0] + nx * off) + '" y1="' + m(sg.a[1] + ny * off) + '" x2="' + m(sg.b[0] + nx * off) +
          '" y2="' + m(sg.b[1] + ny * off) + '" style="stroke:' + (k % 2 ? V_RET : V_SUP) + ';stroke-width:' + m(w0) +
          ';stroke-linecap:butt"/>');
      }
    };
    // Подводки петель тёплого пола — каждая труба своей линией (дерево от коллектора), без
    // обрывов и ступенек между участками. Нет путей подводок (старые данные) — пучок отрезками.
    var leadRows = rows.filter(function (R) { return R.loop && R.loop.sup && R.loop.lead && R.loop.lead.length >= 2; });
    var leadGap = Math.max(lw * 1.0, 0.028 * ppm);
    var tpBodyW = 0.6 * ppm;
    if (leadRows.length) {
      var tpAng0 = f.coll ? collAngle(f, 'tp') : 0;
      var ll = laneLines(leadRows.map(function (R) {
        return { pts: f.coll ? collectorFan(R.loop.lead, f.coll, tpAng0, 0.28 * ppm) : R.loop.lead };
      }), leadGap);
      tpBodyW = Math.max(0.6 * ppm, leadRows.length * LANE_PITCH * leadGap + 0.16 * ppm);
      leadRows.forEach(function (R, i) {
        var pair = ll[i], lp0 = R.loop, sup0 = lp0.sup[0], ret1 = lp0.ret[lp0.ret.length - 1];
        // подача — линия, конец которой ближе к началу петли
        var dA = Math.hypot(pair[0][pair[0].length - 1][0] - sup0[0], pair[0][pair[0].length - 1][1] - sup0[1]) +
          Math.hypot(pair[1][pair[1].length - 1][0] - ret1[0], pair[1][pair[1].length - 1][1] - ret1[1]);
        var dB = Math.hypot(pair[1][pair[1].length - 1][0] - sup0[0], pair[1][pair[1].length - 1][1] - sup0[1]) +
          Math.hypot(pair[0][pair[0].length - 1][0] - ret1[0], pair[0][pair[0].length - 1][1] - ret1[1]);
        var supL = dA <= dB ? pair[0] : pair[1], retL = dA <= dB ? pair[1] : pair[0];
        var tie = function (L, T, horizLast) {            // конец подводки → начало трубы петли
          var e = L[L.length - 1];
          if (Math.abs(e[0] - T[0]) < 0.5 && Math.abs(e[1] - T[1]) < 0.5) return L;
          return L.concat([horizLast ? [T[0], e[1]] : [e[0], T[1]], [T[0], T[1]]]);
        };
        var lastH = Math.abs(supL[supL.length - 1][1] - supL[supL.length - 2][1]) < 0.5;
        supL = despur(tie(supL, sup0, lastH)); retL = despur(tie(retL, ret1, lastH));
        if (opts.dbg) (opts.dbg.tp = opts.dbg.tp || []).push({ no: R.no, lines: [supL, retL] });
        o.push('<g data-pl="L' + R.no + '">');
        [[supL, V_SUP], [retL, V_RET]].forEach(function (pr) {
          o.push('<path d="' + roundedD(pr[0], leadGap * 0.9) + '" style="fill:none;stroke:' + pr[1] + ';stroke-width:' + m(lw * 0.5) +
            ';stroke-linejoin:round;stroke-linecap:round"/>');
        });
        o.push('</g>');
      });
    } else bundle.forEach(function (sg) { pipeBundle(sg, lw * 0.5); });
    var badges = [];
    // Дуги подачи и обратки концентрические, как у настоящей трубы: у внутренней трубы
    // поворота радиус меньше, у наружной больше на шаг. Какая из двух внутренняя —
    // по тому, с какой стороны от угла лежит парная труба.
    var s0 = Math.max(lw * 2, stepMm / 1000 * ppm);
    var pairR = function (other) {
      return function (a, b, c) {
        var la = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, lc = Math.hypot(c[0] - b[0], c[1] - b[1]) || 1;
        var iw = [(a[0] - b[0]) / la + (c[0] - b[0]) / lc, (a[1] - b[1]) / la + (c[1] - b[1]) / lc];
        var bd = Infinity, q = null;
        for (var i = 1; i < other.length; i++) {
          var p0 = other[i - 1], p1 = other[i], dx = p1[0] - p0[0], dy = p1[1] - p0[1], L2 = dx * dx + dy * dy || 1;
          var t = Math.max(0, Math.min(1, ((b[0] - p0[0]) * dx + (b[1] - p0[1]) * dy) / L2));
          var qx = p0[0] + dx * t, qy = p0[1] + dy * t, dd = Math.hypot(qx - b[0], qy - b[1]);
          if (dd < bd) { bd = dd; q = [qx, qy]; }
        }
        if (!q) return s0;
        var inner = ((q[0] - b[0]) * iw[0] + (q[1] - b[1]) * iw[1]) < 0;   // парная труба снаружи поворота — эта внутренняя
        return inner ? 0.55 * s0 : 1.65 * s0;
      };
    };
    rows.forEach(function (R) {
      var lp = R.loop;
      if (!lp || !lp.sup) return;
      // группа контура: невидимая область для наведения (привязка к строке таблицы) и две трубы
      var bb = bbox(lp.sup.concat(lp.ret || []));
      o.push('<g data-pl="L' + R.no + '"><rect x="' + m(bb[0]) + '" y="' + m(bb[1]) + '" width="' + m(bb[2] - bb[0]) +
        '" height="' + m(bb[3] - bb[1]) + '" style="fill:#000;fill-opacity:0;stroke:none;pointer-events:all"/>');
      [[lp.sup, V_SUP, lp.ret], [lp.ret, V_RET, lp.sup]].forEach(function (pr) {
        o.push('<path d="' + roundedD(pr[0], pairR(pr[2] || [])) + '" style="fill:none;stroke:' + pr[1] + ';stroke-width:' + m(lw * 0.5) +
          ';stroke-linejoin:round;stroke-linecap:round"/>');
      });
      // Перемычка подача → обратка на дальнем конце петли. У спирали концы совпадают, у змейки между ними
      // шаг укладки — без неё две трубы обрываются посреди комнаты (как на листе проекта, где она есть)
      var sEnd = lp.sup[lp.sup.length - 1], rBeg = (lp.ret || [])[0];
      if (rBeg && Math.hypot(sEnd[0] - rBeg[0], sEnd[1] - rBeg[1]) > 0.5)
        o.push('<path d="M' + m(sEnd[0]) + ' ' + m(sEnd[1]) + 'L' + m(rBeg[0]) + ' ' + m(rBeg[1]) + '" style="fill:none;stroke:' + V_RET +
          ';stroke-width:' + m(lw * 0.5) + ';stroke-linecap:round"/>');
      o.push('</g>');
      badges.push([pointAt(lp.sup, 0.72), R.no]);
    });
    // Радиаторы: трассы полосой (ширина — по числу труб), сами приборы
    // прямоугольником вдоль стены, номер «Р1…» с комнатной стороны
    var radRows = [], radBadges = [], radBodyW = 0.6 * ppm;
    if (RR) {
      if (!RR.tee && RR.items.length && RR.items.every(function (it) { return it.full; })) {
        var rg = Math.max(lw * 1.0, 0.028 * ppm);
        var rl = laneLines(RR.items.map(function (it) { return { pts: collectorFan(it.full, RR.C, RR.C.ang || 0, 0.28 * ppm) }; }), rg);
        radBodyW = Math.max(0.6 * ppm, RR.items.length * LANE_PITCH * rg + 0.16 * ppm);
        RR.items.forEach(function (it, ii) {
          if (opts.dbg) (opts.dbg.rad = opts.dbg.rad || []).push({ no: it.i + 1, lines: [rl[ii][0], rl[ii][1]] });
          o.push('<g data-pl="R' + (it.i + 1) + '">');
          [[rl[ii][0], V_RSUP], [rl[ii][1], V_RRET]].forEach(function (pr) {
            o.push('<path d="' + roundedD(pr[0], rg * 0.9) + '" style="fill:none;stroke:' + pr[1] + ';stroke-width:' + m(lw * 0.5) +
              ';stroke-linejoin:round;stroke-linecap:round"/>');
          });
          o.push('</g>');
        });
      } else RR.segs.forEach(function (sg) { pipeBundle(sg, lw * 0.5); });
      var byI = {}, kc = {};
      RR.items.forEach(function (it) { byI[it.i] = it; });
      (f.rads || []).forEach(function (rd, i) {
        var a = (rd.ang || 0) * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
        var it = byI[i], z = zoneOfPoint(f, [rd.x, rd.y]);
        // Тип прибора — по смете: окно в пол даёт внутрипольный конвектор вместо радиатора.
        // Приборы комнаты в смете идут в том же порядке, что окна, а окна заводились по приборам плана
        var rkey = z ? String(z.name || '').trim().toLowerCase() : '';
        var kinds = (opts.kinds && opts.kinds[rkey]) || [];
        // Радиатор, к которому привязано окно расчёта (rid ↔ window.radId), берёт тип именно
        // своего окна; окно без прибора — обычный значок. Непривязанные идут по порядку
        // в комнате среди непривязанных приборов
        var kindOf = rd.rid && opts.kindById ? opts.kindById[rd.rid] : null;
        var isConv;
        if (kindOf) isConv = kindOf === 'conv';
        else if (rd.rid && opts.linkedRids && opts.linkedRids[rd.rid]) isConv = false;
        else { kc[rkey] = kc[rkey] == null ? 0 : kc[rkey] + 1; isConv = kinds[kc[rkey]] === 'conv'; }
        var hw = (rd.w || 0.8 * ppm) / 2, nx = -uy, ny = ux;
        var hd = (isConv ? 0.09 : 0.05) * ppm;
        var quad = function (h, e) {
          return [[rd.x - ux * (hw + e) - nx * h, rd.y - uy * (hw + e) - ny * h], [rd.x + ux * (hw + e) - nx * h, rd.y + uy * (hw + e) - ny * h],
            [rd.x + ux * (hw + e) + nx * h, rd.y + uy * (hw + e) + ny * h], [rd.x - ux * (hw + e) + nx * h, rd.y - uy * (hw + e) + ny * h]];
        };
        var q = quad(hd, 0);
        o.push('<g data-pl="R' + (i + 1) + '"><polygon points="' + P(quad(0.22 * ppm, 0.08 * ppm)) +
          '" style="fill:#000;fill-opacity:0;stroke:none;pointer-events:all"/>');
        if (isConv) {
          // внутрипольный конвектор: пунктирный короб с решёткой — вдоль прибора частые поперечные чёрточки
          o.push('<polygon points="' + P(q) + '" style="fill:#fff;fill-opacity:0.85;stroke:' + COL_RAD + ';stroke-width:' + m(lw * 0.55) +
            ';stroke-dasharray:' + m(lw * 2.4) + ',' + m(lw * 1.2) + '"/>');
          var nb = Math.max(3, Math.round(2 * hw / (0.06 * ppm)));
          for (var bI = 1; bI < nb; bI++) {
            var tt = -hw + 2 * hw * bI / nb;
            o.push('<line x1="' + m(rd.x + ux * tt - nx * hd * 0.7) + '" y1="' + m(rd.y + uy * tt - ny * hd * 0.7) +
              '" x2="' + m(rd.x + ux * tt + nx * hd * 0.7) + '" y2="' + m(rd.y + uy * tt + ny * hd * 0.7) +
              '" style="stroke:' + COL_RAD + ';stroke-width:' + m(lw * 0.3) + '"/>');
          }
        } else {
          // радиатор: контур с секциями, как на листах проектировщиков
          o.push('<polygon points="' + P(q) + '" style="fill:#fff;fill-opacity:0.9;stroke:' + COL_RAD + ';stroke-width:' + m(lw * 0.6) + '"/>');
          var ns = Math.max(3, Math.round(2 * hw / (0.08 * ppm)));
          for (var sI = 1; sI < ns; sI++) {
            var ts = -hw + 2 * hw * sI / ns;
            o.push('<line x1="' + m(rd.x + ux * ts - nx * hd) + '" y1="' + m(rd.y + uy * ts - ny * hd) +
              '" x2="' + m(rd.x + ux * ts + nx * hd) + '" y2="' + m(rd.y + uy * ts + ny * hd) +
              '" style="stroke:' + COL_RAD + ';stroke-width:' + m(lw * 0.25) + '"/>');
          }
        }
        o.push('</g>');
        // номер — с той стороны прибора, где точка подключения (комната)
        var side = it ? Math.sign((it.p[0] - rd.x) * nx + (it.p[1] - rd.y) * ny) || 1 : 1;
        radBadges.push([[rd.x + nx * side * 0.42 * ppm, rd.y + ny * side * 0.42 * ppm], (isConv ? 'К' : 'Р') + (i + 1), i + 1]);
        var rm = z ? roomOf(z.name, rooms || []) : null;
        radRows.push({ no: i + 1, name: rm ? rm.name : (z && z.name) || '', w: Math.round((rd.w || 0) / ppm * 10) / 10,
          L: it ? Math.round(it.L * 10) / 10 : null, kind: isConv ? 'conv' : 'rad' });
      });
    }
    // подписи комнат — у верхнего края контура, чтобы не спорить с номерами петель
    var fs = 0.24 * ppm;
    (f.zones || []).forEach(function (z) {
      if (z.type === 'cold' || !z.name || !z.pts) return;
      var bb = bbox(z.pts);
      if (bb[2] - bb[0] < 1.2 * ppm) return;
      o.push('<text x="' + m((bb[0] + bb[2]) / 2) + '" y="' + m(bb[1] + fs * 1.25) + '" font-size="' + m(fs) +
        '" text-anchor="middle" style="fill:#333;paint-order:stroke;stroke:#fff;stroke-width:' + m(fs * 0.25) + '">' +
        esc(z.name) + '</text>');
    });
    var r = 0.24 * ppm;
    badges.forEach(function (bd) {
      o.push('<g data-pl="L' + bd[1] + '"><circle cx="' + m(bd[0][0]) + '" cy="' + m(bd[0][1]) + '" r="' + m(r) + '" style="fill:#fff;stroke:#333;stroke-width:' + m(lw * 0.5) + '"/>');
      o.push('<text x="' + m(bd[0][0]) + '" y="' + m(bd[0][1] + r * 0.42) + '" font-size="' + m(r * 1.15) +
        '" text-anchor="middle" style="fill:#111;font-weight:700">' + bd[1] + '</text></g>');
    });
    radBadges.forEach(function (bd) {
      var w2 = r * 1.6, h2 = r * 1.3;
      o.push('<g data-pl="R' + bd[2] + '"><rect x="' + m(bd[0][0] - w2 / 2) + '" y="' + m(bd[0][1] - h2 / 2) + '" width="' + m(w2) + '" height="' + m(h2) +
        '" style="fill:#fff;stroke:' + COL_RAD + ';stroke-width:' + m(lw * 0.5) + '"/>');
      o.push('<text x="' + m(bd[0][0]) + '" y="' + m(bd[0][1] + r * 0.38) + '" font-size="' + m(r * 1.0) +
        '" text-anchor="middle" style="fill:' + COL_RAD + ';font-weight:700">' + bd[1] + '</text></g>');
    });
    // Коллектор радиаторов — когда он не там же, где коллектор тёплого пола
    if (RR && !(f.coll && Math.hypot(RR.C.x - f.coll.x, RR.C.y - f.coll.y) < 0.3 * ppm)) {
      var cw2 = radBodyW, ch2 = 0.22 * ppm, ra = RR.C.ang || 0, raV = ra % 180 === 90;
      o.push('<rect x="' + m(RR.C.x - cw2 / 2) + '" y="' + m(RR.C.y - ch2 / 2) + '" width="' + m(cw2) + '" height="' + m(ch2) +
        '" style="fill:#f8d0d0;stroke:' + COL_RAD + ';stroke-width:' + m(lw * 0.7) + '"' +
        (ra ? ' transform="rotate(' + ra + ' ' + m(RR.C.x) + ' ' + m(RR.C.y) + ')"' : '') + '/>');
      o.push('<text x="' + m(RR.C.x) + '" y="' + m(RR.C.y + (raV ? cw2 : ch2) / 2 + fs * 0.95) + '" font-size="' + m(fs * 0.85) +
        '" text-anchor="middle" style="fill:' + COL_RAD + ';font-weight:700;paint-order:stroke;stroke:#fff;stroke-width:' + m(fs * 0.2) + '">' +
        (RR.tee ? 'Магистраль радиаторов' : 'Коллектор радиаторов') + '</text>');
    }
    if (f.coll) {
      var cw = tpBodyW, ch = 0.22 * ppm, ca = collAngle(f, 'tp'), caV = ca % 180 === 90;
      o.push('<rect x="' + m(f.coll.x - cw / 2) + '" y="' + m(f.coll.y - ch / 2) + '" width="' + m(cw) + '" height="' + m(ch) +
        '" style="fill:#ffd9a8;stroke:#c25e00;stroke-width:' + m(lw * 0.7) + '"' +
        (ca ? ' transform="rotate(' + ca + ' ' + m(f.coll.x) + ' ' + m(f.coll.y) + ')"' : '') + '/>');
      o.push('<text x="' + m(f.coll.x) + '" y="' + m(f.coll.y - (caV ? cw : ch) / 2 - fs * 0.35) + '" font-size="' + m(fs * 0.85) +
        '" text-anchor="middle" style="fill:#c25e00;font-weight:700;paint-order:stroke;stroke:#fff;stroke-width:' + m(fs * 0.2) + '">' +
        (RR && Math.hypot(RR.C.x - f.coll.x, RR.C.y - f.coll.y) < 0.3 * ppm ? 'Коллекторы' : 'Коллектор') + '</text>');
    }
    o.push('</svg>');
    return { svg: o.join(''), rows: rows.map(function (R) {
      return { no: R.no, name: R.name, area: R.area, m: (R.loop && R.loop.lenM) || R.m, step: R.step, flow: R.flow, est: R.est };
    }), radRows: radRows, radTee: RR ? RR.tee : null, radM: RR ? Math.round(RR.totalM * 10) / 10 : 0 };
  }

  // floorLoops — для сметы и редактора: длина трубы и число выходов коллектора
  // берутся из той же укладки, что нарисована на листе (стенд — bench/ufh_sheet.js).
  // loopRows — для листа узла коллектора (project_ufh_manifold.js): номера,
  // длины и расходы петель там должны совпадать с листом укладки.
  window.projectPlans = { sheets: sheets, waterSheets: waterSheets, wetZoneSheets: wetZoneSheets, axonoSheets: axonoSheets, iso3dSheets: iso3dSheets,
    boilerRoom: boilerRoom,
    floorLoops: floorLoops, loopRows: loopRows, num1: num1, ufhView: ufhView, radRoutes: radRoutes,
    radCollector: radCollector, boilerZone: boilerZone, wallSpot: wallSpot,
    snapCollector: snapCollector, collAngle: collAngle, angFromNormal: angFromNormal, roomAround: roomAround,
    radConnSide: radConnSide, radSideOfModel: radSideOfModel,
    contourGuide: contourGuide, offsetOrtho: offsetOrtho,
    // включить/выключить улитку по контуру — для стендов (сравнение «с контуром и без»)
    setPoly: function (on) { POLY_ON = !!on; loopsCache.length = 0; },
    UFH_DT: UFH_DT, ufhDt: ufhDt, UFH_C: UFH_C,
    MAX_LOOP_M: MAX_LOOP_M, loopLimit: loopLimit, setLoopLimits: setLoopLimits };
})();
