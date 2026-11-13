/* house_core.js — ядро модели дома: стены отрезками, проёмы, помещения, теплопотери по геометрии.
 *
 * Одна модель — источник всего: из стен выводятся помещения (замкнутые контуры), площади, периметры, соседство
 * комнат, а из них теплопотери, 3D-вид и длины труб. Пока ядро автономное (ни state, ни render() калькулятора не
 * трогает) и работает так же в браузере (window.HouseCore), как и в Node (bench/house_core.js).
 *
 * Системы координат. План: X вправо, Y вверх (Y — на север при north = 0), метры. Стена — отрезок a→b; слева по ходу
 * стены у контура помещения — внутренность комнаты (обход против часовой).
 *
 * Нормативная база (формат ссылок — как в norms.js):
 *   R ограждения и коэффициенты αв = 8,7 / αн = 23 (Rsi 0,115, Rse 0,043): СП 50.13330.2024;
 *   расчётная температура наружного воздуха: СП 131.13330.2020, табл. 3.1;
 *   пол по грунту по зонам I-IV, полосы по 2 м (R 2,1 / 4,3 / 8,6 / 14,2): СНиП 2.04.05-91*, прил. 9 (Сканави «Отопление»);
 *   надбавка на ориентацию: Староверов, СНиП 2.04.05-91*, прил. 9 — те же коэффициенты, что app.ORIENT_K;
 *   вентиляция Q = V·n·0,34·ΔT, n = 0,35 1/ч: СП 50.13330.2012, прил. Г, п. Г.3б (редакцию 2024 г. не сверяли);
 *   температуры помещений: ГОСТ 30494-2011, табл. 1.
 * Что «по практике проектирования» (не норма): R окна 0,51, R двери 0,7, R перекрытия над подвалом по умолчанию,
 * надбавка на ориентацию как таковая — это сделано как у калькулятора, чтобы результаты сравнивались.
 *
 * Публичный API: create, addFloor, addWall, addOpening, detectRooms, heatLoss, wallR, sampleHouse, DEFAULTS.
 */
(function (root) {
  'use strict';

  var DEFAULTS = {
    Rsi: 0.115, Rse: 0.043,           // 1/αв, 1/αн
    R_glz: 0.51, R_door: 0.7,         // окно и наружная дверь — практика проектирования
    R_roof: 3.95, R_floorConstr: 2.8, // кровля / конструкция пола по грунту — как в getRoomHeatLoss
    R_wallDefault: 3.0,               // стена без пирога
    n_vent: 0.35, c_air: 0.34,        // кратность и Вт·ч/(м³·К)
    tv: 20,                           // температура комнаты по умолчанию
    wallThick: 0.40, h: 2.7, tol: 0.02,
    ORIENT_K: { N: 1.10, NE: 1.10, E: 1.10, NW: 1.10, SE: 1.05, W: 1.05, S: 1.0, SW: 1.0 },
    R_ZONES: [2.1, 4.3, 8.6, 14.2],
    // λ материалов — как WALL_MATERIALS_DB каталога; ядро не зависит от catalog.js, поэтому копия для тестов и 3D
    LAMBDA: { gkl: 0.21, brick_clay: 0.70, brick_hollow: 0.44, gas_d400: 0.117, gas_d500: 0.141, gas_d600: 0.163, ceramic_block: 0.16,
              wood_pine: 0.15, concrete: 2.04, polystyrene: 0.041, minwool: 0.042, xps: 0.032, plaster_cement: 0.93 }
  };

  var ids = 0;
  function nid(p) { return (p || 'id') + (++ids); }
  function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }

  // ── модель ─────────────────────────────────────────────────────────────
  function create(opts) {
    opts = opts || {};
    return { floors: [], walls: [], openings: [], Tn: opts.Tn !== undefined ? opts.Tn : -25, north: opts.north || 0,
             settings: Object.assign({}, DEFAULTS, opts.settings || {}), roomOv: {} };
  }

  function addFloor(m, f) {
    f = Object.assign({ id: nid('f'), level: m.floors.length, elevation: null, h: m.settings.h }, f || {});
    if (f.elevation === null) f.elevation = m.floors.reduce(function (s, x) { return s + x.h + 0.3; }, 0);
    m.floors.push(f);
    return f;
  }

  // layers: [{ mat: 'gas_d400', thick: 400 }, ...] (мм) или R — готовое сопротивление
  function addWall(m, w) {
    w = Object.assign({ id: nid('w'), floor: m.floors.length ? m.floors[0].id : null, thick: m.settings.wallThick, layers: null, R: null }, w);
    m.walls.push(w);
    return w;
  }

  function addOpening(m, o) {
    o = Object.assign({ id: nid('o'), kind: 'window', sill: 0.9, height: 1.5, width: 1.5, offset: 0 }, o);
    if (o.kind === 'door') { o.sill = 0; if (o.height === 1.5) o.height = 2.1; }
    m.openings.push(o);
    return o;
  }

  function removeOpening(m, id) { m.openings = m.openings.filter(function (o) { return o.id !== id; }); }
  function removeWall(m, id) {
    m.walls = m.walls.filter(function (w) { return w.id !== id; });
    m.openings = m.openings.filter(function (o) { return o.wall !== id; });
  }

  // Сопротивление теплопередаче стены: Rsi + Σ d/λ + Rse (наружная) или + Rsi (внутренняя, обе стороны в воздухе)
  function wallR(m, w, external) {
    var s = m.settings;
    if (w.R) return w.R;
    var R = s.Rsi + (external ? s.Rse : s.Rsi);
    if (w.layers && w.layers.length) {
      w.layers.forEach(function (l) {
        var lam = l.lambda || s.LAMBDA[l.mat];
        if (lam) R += (l.thick / 1000) / lam;
      });
      return R;
    }
    return s.R_wallDefault;
  }

  // ── смещение контуров ───────────────────────────────────────────────────
  function polyArea(P) {
    var A = 0;
    for (var i = 0; i < P.length; i++) { var p = P[i], q = P[(i + 1) % P.length]; A += p[0] * q[1] - q[0] * p[1]; }
    return A / 2;
  }

  // Сдвиг каждого ребра контура против часовой на d[i] (вдоль правой нормали: наружу — плюс, внутрь — минус);
  // вершина — пересечение сдвинутых соседних рёбер. Острые углы ограничиваем, чтобы вершина не улетала.
  function shiftEdges(P, d) {
    var n = P.length, out = [];
    var N = P.map(function (p, i) {
      var q = P[(i + 1) % n], dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1e-9;
      return [dy / L, -dx / L];
    });
    for (var i = 0; i < n; i++) {
      var a = N[(i - 1 + n) % n], b = N[i], da = d[(i - 1 + n) % n], db = d[i], p = P[i];
      var det = a[0] * b[1] - a[1] * b[0];
      if (Math.abs(det) < 0.15) { out.push([p[0] + (a[0] * da + b[0] * db) / 2, p[1] + (a[1] * da + b[1] * db) / 2]); continue; }
      // решаем a·x = a·p + da, b·x = b·p + db
      var ca = a[0] * p[0] + a[1] * p[1] + da, cb = b[0] * p[0] + b[1] * p[1] + db;
      var x = (ca * b[1] - cb * a[1]) / det, y = (a[0] * cb - b[0] * ca) / det;
      var lim = 3 * Math.max(Math.abs(da), Math.abs(db), 1e-6);
      if (Math.hypot(x - p[0], y - p[1]) > lim) { var k = lim / Math.hypot(x - p[0], y - p[1]); x = p[0] + (x - p[0]) * k; y = p[1] + (y - p[1]) * k; }
      out.push([x, y]);
    }
    return out;
  }

  function offsetPoly(P, d) {
    var Q = polyArea(P) < 0 ? P.slice().reverse() : P;
    return shiftEdges(Q, Q.map(function () { return d; }));
  }

  // Толщина стен между комнатами по зазорам между параллельными рёбрами разных контуров, м (медиана) или null
  function estimateGap(polys) {
    var edges = [];
    polys.forEach(function (pl, pi) {
      var P = polyArea(pl.pts) < 0 ? pl.pts.slice().reverse() : pl.pts;
      for (var i = 0; i < P.length; i++) edges.push({ pi: pi, a: P[i], b: P[(i + 1) % P.length] });
    });
    var gaps = [];
    edges.forEach(function (e) {
      var dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], L = Math.hypot(dx, dy);
      if (L < 0.6) return;
      var mx = (e.a[0] + e.b[0]) / 2, my = (e.a[1] + e.b[1]) / 2, best = null;
      edges.forEach(function (o) {
        if (o.pi === e.pi) return;
        var ox = o.b[0] - o.a[0], oy = o.b[1] - o.a[1], OL = Math.hypot(ox, oy);
        if (OL < 0.4 || Math.abs((dx * ox + dy * oy) / (L * OL)) < 0.97) return;
        var t = ((mx - o.a[0]) * ox + (my - o.a[1]) * oy) / (OL * OL);
        if (t < 0 || t > 1) return;
        var d = Math.abs((mx - o.a[0]) * oy - (my - o.a[1]) * ox) / OL;
        if (d > 0.02 && d < 0.9 && (best === null || d < best)) best = d;
      });
      if (best !== null) gaps.push(best);
    });
    if (gaps.length < 2) return null;
    gaps.sort(function (x, y) { return x - y; });
    return gaps[Math.floor(gaps.length / 2)];
  }

  // ── планарный граф: разбиение стен в местах примыканий и обход граней ───────────────
  function splitWalls(m, floorId) {
    var tol = m.settings.tol;
    var ws = m.walls.filter(function (w) { return w.floor === floorId; });
    var pieces = [];
    ws.forEach(function (w) {
      var cuts = [0, dist(w.a, w.b)];
      var L = dist(w.a, w.b);
      if (L < 1e-6) return;
      var ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L;
      ws.forEach(function (o) {
        if (o === w) return;
        [o.a, o.b].forEach(function (p) {
          var t = (p[0] - w.a[0]) * ux + (p[1] - w.a[1]) * uy;
          var d = Math.abs((p[0] - w.a[0]) * uy - (p[1] - w.a[1]) * ux);
          if (d < tol * 2 && t > tol && t < L - tol) cuts.push(t);
        });
      });
      cuts.sort(function (a, b) { return a - b; });
      var uniq = [cuts[0]];
      cuts.forEach(function (c) { if (c - uniq[uniq.length - 1] > tol) uniq.push(c); });
      for (var i = 0; i + 1 < uniq.length; i++) {
        pieces.push({ wall: w, t0: uniq[i], t1: uniq[i + 1],
                      a: [w.a[0] + ux * uniq[i], w.a[1] + uy * uniq[i]], b: [w.a[0] + ux * uniq[i + 1], w.a[1] + uy * uniq[i + 1]] });
      }
    });
    return pieces;
  }

  function key(p, tol) { return Math.round(p[0] / tol) + ',' + Math.round(p[1] / tol); }

  // Помещения этажа: замкнутые контуры, обход против часовой. Возвращает [{ id, poly, area, perimeter, edges }]
  function detectRooms(m, floorId) {
    if (m.fixedRooms && m.fixedRooms[floorId] && m.fixedRooms[floorId].length) return hydrateFixed(m, floorId);
    var tol = m.settings.tol * 2;
    var pieces = splitWalls(m, floorId), nodes = {}, half = [];
    pieces.forEach(function (p) {
      var ka = key(p.a, tol), kb = key(p.b, tol);
      if (ka === kb) return;
      nodes[ka] = nodes[ka] || { p: p.a, out: [] };
      nodes[kb] = nodes[kb] || { p: p.b, out: [] };
      var h1 = { piece: p, from: ka, to: kb, ang: Math.atan2(p.b[1] - p.a[1], p.b[0] - p.a[0]), dir: 1 };
      var h2 = { piece: p, from: kb, to: ka, ang: Math.atan2(p.a[1] - p.b[1], p.a[0] - p.b[0]), dir: -1 };
      h1.twin = h2; h2.twin = h1;
      nodes[ka].out.push(h1); nodes[kb].out.push(h2);
      half.push(h1, h2);
    });
    Object.keys(nodes).forEach(function (k) { nodes[k].out.sort(function (a, b) { return a.ang - b.ang; }); });
    half.forEach(function (h) {
      var out = nodes[h.to].out, i = out.indexOf(h.twin);
      h.next = out[(i - 1 + out.length) % out.length];        // следующий по часовой от обратной стороны: внутренность слева
    });
    var faces = [], used = new Set();
    half.forEach(function (h0) {
      if (used.has(h0)) return;
      var loop = [], h = h0, guard = 0;
      do { used.add(h); loop.push(h); h = h.next; guard++; } while (h !== h0 && guard < 10000);
      if (h !== h0) return;
      var poly = loop.map(function (e) { return nodes[e.from].p; });
      var A = 0;
      for (var i = 0; i < poly.length; i++) { var p = poly[i], q = poly[(i + 1) % poly.length]; A += p[0] * q[1] - q[0] * p[1]; }
      A /= 2;
      faces.push({ loop: loop, poly: poly, area: A });
    });
    var rooms = faces.filter(function (f) { return f.area > 0.5; });          // отрицательный — внешняя грань
    var faceOf = new Map();
    rooms.forEach(function (f) {
      var cx = 0, cy = 0;
      f.poly.forEach(function (p) { cx += p[0] / f.poly.length; cy += p[1] / f.poly.length; });
      f.id = floorId + '_r' + Math.round(cx * 10) + '_' + Math.round(cy * 10);       // по центру: правка соседних стен имя не сбрасывает
      f.loop.forEach(function (h) { faceOf.set(h, f); });
    });
    rooms.forEach(function (f) {
      f.floor = floorId;
      f.edges = f.loop.map(function (h) {
        var n = faceOf.get(h.twin);
        return { wall: h.piece.wall, piece: h.piece, a: nodes[h.from].p, b: nodes[h.to].p, len: dist(nodes[h.from].p, nodes[h.to].p),
                 neighbor: n ? n.id : null, dirAlong: h.dir };
      });
      f.perimeter = f.edges.reduce(function (s, e) { return s + e.len; }, 0);
      f.areaGross = f.area;                                        // по осям стен
      var th = f.edges.map(function (e) { return -((e.wall.thick !== undefined ? e.wall.thick : m.settings.wallThick) / 2); });
      var inner = shiftEdges(f.poly, th);
      f.area = Math.max(polyArea(inner), 0);                      // чистая площадь: для пола, потолка и объёма воздуха
      var o = m.roomOv[f.id] || {};
      f.name = o.name; f.tv = o.tv; f.kind = o.kind || 'room';
    });
    // имена по умолчанию: «Комната N» сверху вниз, слева направо (имя, заданное пользователем, главнее)
    var cen = function (r) { var c = [0, 0]; r.poly.forEach(function (p) { c[0] += p[0] / r.poly.length; c[1] += p[1] / r.poly.length; }); return c; };
    rooms.slice().sort(function (a, b) { var ca = cen(a), cb = cen(b); return (cb[1] - ca[1]) || (ca[0] - cb[0]); })
      .forEach(function (r, i) { if (!r.name) r.name = 'Комната ' + (i + 1); });
    return rooms;
  }

  // Проёмы, лежащие на куске стены (по центру проёма)
  function openingsOn(m, piece) {
    var out = [];
    m.openings.forEach(function (o) {
      if (o.wall !== piece.wall.id) return;
      var c = o.offset + o.width / 2;
      if (c >= piece.t0 - 1e-6 && c <= piece.t1 + 1e-6) out.push(o);
    });
    return out;
  }

  function compass(m, nx, ny) {
    // азимут наружной нормали: 0 = север (+Y), по часовой; north — поворот плана
    var a = (Math.atan2(nx, ny) * 180 / Math.PI + m.north + 360) % 360;
    var names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return names[Math.round(a / 45) % 8];
  }

  // ── теплопотери ────────────────────────────────────────────────────────
  // Возвращает { total, rooms: [{ id, name, tv, area, Q, parts: [{ what, A, R, dT, k, Q, note }] }] }
  function heatLoss(m, opts) {
    opts = opts || {};
    var s = m.settings, Tn = m.Tn;
    var floors = m.floors.slice().sort(function (a, b) { return a.level - b.level; });
    var top = floors.length ? floors[floors.length - 1].level : 0;
    var all = [], byId = {};
    floors.forEach(function (f) { detectRooms(m, f.id).forEach(function (r) { r.fl = f; all.push(r); byId[r.id] = r; }); });
    var result = { total: 0, rooms: [], Tn: Tn };
    all.forEach(function (r) {
      var tv = r.tv !== undefined ? r.tv : s.tv, h = r.fl.h, parts = [];
      var add = function (what, A, R, dT, k, note) {
        if (A <= 1e-9 || R <= 0) return;
        parts.push({ what: what, A: A, R: R, dT: dT, k: k, Q: A * dT / R * k, note: note || '' });
      };
      var extLen = 0, corners = 0, prevExt = false, firstExt = false;
      r.edges.forEach(function (e, i) {
        var ext = !e.neighbor;
        var wl = e.len * h, opn = openingsOn(m, e.piece);
        var openA = 0;
        opn.forEach(function (o) { openA += o.width * o.height; });
        if (ext) {
          extLen += e.len;
          var nx = (e.b[1] - e.a[1]) / e.len, ny = -(e.b[0] - e.a[0]) / e.len;       // правая нормаль = наружу при обходе против часовой
          var side = compass(m, nx, ny), k = s.ORIENT_K[side] || 1.0, dT = tv - Tn;
          add('стена ' + side, Math.max(wl - openA, 0), wallR(m, e.piece.wall, true), dT, k, e.piece.wall.id);
          opn.forEach(function (o) {
            add(o.kind === 'door' ? 'дверь ' + side : 'окно ' + side, o.width * o.height,
                o.R || (o.kind === 'door' ? s.R_door : s.R_glz), dT, k, o.id);
          });
        } else {
          var nb = byId[e.neighbor], tvn = nb && nb.tv !== undefined ? nb.tv : s.tv, dTi = tv - tvn;
          // стена между комнатами считается один раз: со стороны более тёплой, у холодной dTi < 0 и потери нет
          if (dTi > 0) add('внутренняя стена к «' + (nb ? nb.name : '?') + '»', Math.max(wl - openA, 0), wallR(m, e.piece.wall, false), dTi, 1.0, e.piece.wall.id);
        }
      });
      // углы наружных стен — для зон пола
      var n = r.edges.length;
      for (var i = 0; i < n; i++) {
        var e0 = r.edges[i], e1 = r.edges[(i + 1) % n];
        if (!e0.neighbor && !e1.neighbor) corners++;
      }
      var dTe = tv - Tn;
      // пол: первый этаж — по грунту, зоны I-IV; выше — над отапливаемым (потерь нет)
      if (r.fl.level === 0) {
        var z = s.R_ZONES, A = r.area, rem = A;
        var z1 = Math.min(rem, extLen * 2 + corners * 4); rem -= z1;
        var z2 = Math.min(rem, extLen * 2); rem -= z2;
        var z3 = Math.min(rem, extLen * 2); rem -= z3;
        var z4 = rem;
        [z1, z2, z3, z4].forEach(function (a, i) { add('пол, зона ' + (i + 1), a, z[i] + s.R_floorConstr, dTe, 1.0, 'по грунту'); });
      }
      // потолок: последний этаж — кровля
      if (r.fl.level === top) add('кровля', r.area, s.R_roof, dTe, 1.0, 'последний этаж');
      // вентиляция
      var V = r.area * h;
      parts.push({ what: 'вентиляция', A: V, R: 0, dT: dTe, k: s.n_vent, Q: V * s.n_vent * s.c_air * dTe, note: 'V·n·0,34·ΔT, n=' + s.n_vent });
      var Q = parts.reduce(function (t, p) { return t + p.Q; }, 0);
      result.rooms.push({ id: r.id, name: r.name, tv: tv, area: r.area, perimeter: r.perimeter, Q: Q, parts: parts, floor: r.fl.level, poly: r.poly });
      result.total += Q;
    });
    return result;
  }

  // ── импорт: контуры комнат (метры) -> стены ────────────────────────────────────────
  // polys: [{ pts: [[x, y], ...], name, tv }]. Общие стены соседних комнат склеиваются в одну, концы стен, лежащие на
  // чужой стене, режут её (Т-примыкание). Стены, у которых хоть с одной стороны нет комнаты, получают пирог ext, остальные int.
  function simplifyPoly(poly, eps) {
    var P = poly.slice(), changed = true;
    while (changed && P.length > 3) {
      changed = false;
      for (var i = 0; i < P.length; i++) {
        var a = P[(i - 1 + P.length) % P.length], b = P[i], c = P[(i + 1) % P.length];
        var dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy) || 1e-9;
        var d = Math.abs((b[0] - a[0]) * dy - (b[1] - a[1]) * dx) / L;
        if (d < eps || dist(a, b) < eps) { P.splice(i, 1); changed = true; break; }
      }
    }
    return P;
  }

  function fromPolygons(m, floorId, polys, opts) {
    opts = opts || {};
    var fixed = opts.fixed !== false;             // комнаты = ваши контуры; false — искать комнаты по замкнутым стенам
    var snapTol = opts.snap || 0.12, eps = opts.simplify || 0.08;
    // Чистим контуры: лишние вершины, обход против часовой, исходная (чистая) площадь
    polys = polys.map(function (pl) {
      var P = simplifyPoly(pl.pts, eps);
      if (polyArea(P) < 0) P = P.slice().reverse();
      return Object.assign({}, pl, { pts: P, inner: Math.abs(polyArea(P)) });
    }).filter(function (pl) { return pl.pts.length >= 3 && pl.inner > 0.3; });
    // Контуры комнат на плане — по внутренним граням: между соседними остаётся зазор в толщину стены. Сдвигаем каждый
    // наружу на полтолщины — тогда соседи встают на общую ось и склеиваются. Толщина: opts.gap (м), 'auto' — по
    // зазорам между параллельными рёбрами, иначе по толщине наружной стены.
    var gapUsed = null;
    if (opts.gap) {
      var g = opts.gap === 'auto' ? estimateGap(polys) : opts.gap;
      var half = g ? Math.max(0.03, Math.min(0.4, g / 2)) : ((opts.ext && opts.ext.thick) || m.settings.wallThick) / 2;
      gapUsed = g || null;
      polys = polys.map(function (pl) { return Object.assign({}, pl, { pts: offsetPoly(pl.pts, half) }); });
    }
    var ext = opts.ext || { layers: null, thick: m.settings.wallThick }, itn = opts.int || { layers: null, thick: 0.15 };
    var V = [];                                           // уникальные вершины
    var vid = function (p) {
      for (var i = 0; i < V.length; i++) if (dist(V[i], p) < snapTol) return i;
      V.push(p.slice()); return V.length - 1;
    };
    var loops = polys.map(function (pl) {
      var ids = [];
      pl.pts.forEach(function (p) { var id = vid(p); if (!ids.length || ids[ids.length - 1] !== id) ids.push(id); });
      if (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop();
      return ids.length >= 3 ? ids : null;
    });
    var seen = {}, segs = [], edgesOf = [], ownersOf = {};
    loops.forEach(function (L, li) {
      edgesOf[li] = [];
      if (!L) return;
      for (var i = 0; i < L.length; i++) {
        var a = L[i], b = L[(i + 1) % L.length];
        if (a === b) continue;
        // вершины других комнат, лежащие на этом ребре, режут его
        var ux = V[b][0] - V[a][0], uy = V[b][1] - V[a][1], len = Math.hypot(ux, uy);
        var cuts = [{ t: 0, id: a }, { t: len, id: b }];
        for (var k = 0; k < V.length; k++) {
          if (k === a || k === b) continue;
          var t = ((V[k][0] - V[a][0]) * ux + (V[k][1] - V[a][1]) * uy) / len;
          var d = Math.abs((V[k][0] - V[a][0]) * uy - (V[k][1] - V[a][1]) * ux) / len;
          if (d < snapTol && t > snapTol && t < len - snapTol) cuts.push({ t: t, id: k });
        }
        cuts.sort(function (x, y) { return x.t - y.t; });
        for (var j = 0; j + 1 < cuts.length; j++) {
          var u = cuts[j].id, w = cuts[j + 1].id, key = Math.min(u, w) + '_' + Math.max(u, w);
          if (!seen[key]) { seen[key] = 1; segs.push([u, w, key]); }
          edgesOf[li].push({ u: u, w: w, key: key });
          (ownersOf[key] = ownersOf[key] || []);
          if (ownersOf[key].indexOf(li) < 0) ownersOf[key].push(li);
        }
      }
    });
    var wallByKey = {};
    var created = segs.map(function (sg) {
      var w = addWall(m, { floor: floorId, a: V[sg[0]].slice(), b: V[sg[1]].slice(), thick: gapUsed || itn.thick, layers: itn.layers ? itn.layers.map(function (l) { return Object.assign({}, l); }) : null });
      w.imported = true; wallByKey[sg[2]] = w;
      return w;
    });
    var setExt = function (w) { w.thick = gapUsed || ext.thick; w.layers = ext.layers ? ext.layers.map(function (l) { return Object.assign({}, l); }) : null; };

    if (fixed) {
      // комнаты — сами контуры; стены — по их рёбрам, соседство — по общим кускам рёбер
      var rooms = [];
      polys.forEach(function (pl, li) {
        if (!loops[li]) return;
        var id = floorId + '_z' + (rooms.length + 1);
        pl._id = id;
        rooms.push({ id: id, li: li, name: pl.name || '', tv: pl.tv, poly: loops[li].map(function (v) { return V[v].slice(); }), inner: pl.inner });
      });
      var idOf = {}; rooms.forEach(function (r) { idOf[r.li] = r.id; });
      rooms.forEach(function (r) {
        r.edges = edgesOf[r.li].map(function (e) {
          var others = (ownersOf[e.key] || []).filter(function (x) { return x !== r.li && idOf[x]; });
          return { w: wallByKey[e.key].id, a: V[e.u].slice(), b: V[e.w].slice(), nb: others.length ? idOf[others[0]] : null };
        });
        delete r.li;
      });
      Object.keys(ownersOf).forEach(function (k) { if (ownersOf[k].length === 1) setExt(wallByKey[k]); });
      m.fixedRooms = m.fixedRooms || {};
      m.fixedRooms[floorId] = rooms;
      return { walls: created.length, rooms: rooms.length, gap: gapUsed, fixed: true };
    }

    var found = detectRooms(m, floorId);
    found.forEach(function (r) {
      r.edges.forEach(function (e) { if (!e.neighbor && !e.wall._ext) { e.wall._ext = true; setExt(e.wall); } });
    });
    created.forEach(function (w) { delete w._ext; });
    // имена и температуры — по контуру, в который попал центр найденной комнаты
    var inside = function (pt, P) {
      var ins = false;
      for (var i = 0, j = P.length - 1; i < P.length; j = i++) {
        if ((P[i][1] > pt[1]) !== (P[j][1] > pt[1]) && pt[0] < (P[j][0] - P[i][0]) * (pt[1] - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) ins = !ins;
      }
      return ins;
    };
    found.forEach(function (r) {
      var c = r.poly.reduce(function (a, p) { return [a[0] + p[0] / r.poly.length, a[1] + p[1] / r.poly.length]; }, [0, 0]);
      var src = polys.find(function (pl) { return inside(c, pl.pts); });
      if (src && (src.name || src.tv !== undefined)) m.roomOv[r.id] = { name: src.name || undefined, tv: src.tv };
    });
    return { walls: created.length, rooms: found.length, gap: gapUsed, fixed: false };
  }

  // Комнаты заданы контурами (импорт) — пока стены не правили; после правки стен вернуться к поиску по замкнутым контурам
  function hasFixed(m) { return !!(m.fixedRooms && Object.keys(m.fixedRooms).some(function (k) { return m.fixedRooms[k] && m.fixedRooms[k].length; })); }
  function dropFixed(m) { m.fixedRooms = {}; }

  function hydrateFixed(m, floorId) {
    var byId = {};
    m.walls.forEach(function (w) { byId[w.id] = w; });
    var out = m.fixedRooms[floorId].map(function (r) {
      var ov = m.roomOv[r.id] || {};
      var edges = [];
      r.edges.forEach(function (e) {
        var w = byId[e.w];
        if (!w) return;
        edges.push({ wall: w, piece: { wall: w, t0: 0, t1: dist(w.a, w.b) }, a: e.a, b: e.b, len: dist(e.a, e.b), neighbor: e.nb, dirAlong: 1 });
      });
      return { id: r.id, floor: floorId, poly: r.poly, edges: edges, areaGross: Math.abs(polyArea(r.poly)), area: r.inner,
               perimeter: edges.reduce(function (t, e) { return t + e.len; }, 0),
               name: ov.name !== undefined ? ov.name : r.name, tv: ov.tv !== undefined ? ov.tv : r.tv, kind: 'room' };
    });
    var cen = function (r) { var c = [0, 0]; r.poly.forEach(function (p) { c[0] += p[0] / r.poly.length; c[1] += p[1] / r.poly.length; }); return c; };
    out.slice().sort(function (a, b) { var ca = cen(a), cb = cen(b); return (cb[1] - ca[1]) || (ca[0] - cb[0]); })
      .forEach(function (r, i) { if (!r.name) r.name = 'Комната ' + (i + 1); });
    return out;
  }

  // Проёмы по точкам плана: [{ x, y, w, kind, h?, sill? }] — ставятся на ближайшую стену этажа не дальше maxD
  function addOpeningsAt(m, floorId, list, maxD) {
    maxD = maxD || 0.5;
    var n = 0;
    list.forEach(function (o) {
      var best = null;
      m.walls.forEach(function (w) {
        if (w.floor !== floorId) return;
        var dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L = Math.hypot(dx, dy);
        if (L < 1e-6) return;
        var t = ((o.x - w.a[0]) * dx + (o.y - w.a[1]) * dy) / L;
        t = Math.max(0, Math.min(L, t));
        var qx = w.a[0] + dx / L * t, qy = w.a[1] + dy / L * t, d = Math.hypot(o.x - qx, o.y - qy);
        if (d < maxD && o.w < L - 0.1 && (!best || d < best.d)) best = { w: w, t: t, d: d, L: L };
      });
      if (!best) return;
      var off = Math.max(0.05, Math.min(best.L - o.w - 0.05, best.t - o.w / 2));
      addOpening(m, { wall: best.w.id, offset: Math.round(off * 100) / 100, width: o.w, height: o.h || (o.kind === 'door' ? 2.1 : 1.5), sill: o.kind === 'door' ? 0 : (o.sill !== undefined ? o.sill : 0.9), kind: o.kind || 'window' });
      n++;
    });
    return n;
  }

  // ── пример для проверки и 3D: одноэтажный дом 10 x 8 м, три комнаты, окна и дверь ──────
  function sampleHouse() {
    var m = create({ Tn: -25 });
    var f = addFloor(m, { level: 0 });
    var ext = { layers: [{ mat: 'gas_d400', thick: 300 }, { mat: 'minwool', thick: 100 }, { mat: 'plaster_cement', thick: 20 }], thick: 0.42 };
    var itn = { layers: [{ mat: 'gas_d500', thick: 150 }], thick: 0.15 };
    var P = [[0, 0], [10, 0], [10, 8], [0, 8]];
    var w = [];
    for (var i = 0; i < 4; i++) w.push(addWall(m, Object.assign({ floor: f.id, a: P[i], b: P[(i + 1) % 4] }, ext)));
    var w5 = addWall(m, Object.assign({ floor: f.id, a: [6, 0], b: [6, 8] }, itn));   // делит дом на гостиную и правую часть
    var w6 = addWall(m, Object.assign({ floor: f.id, a: [6, 4], b: [10, 4] }, itn));  // правую часть — на две комнаты
    addOpening(m, { wall: w[0].id, offset: 1.5, width: 1.8, height: 1.5, sill: 0.9 });
    addOpening(m, { wall: w[0].id, offset: 4.2, width: 0.9, height: 2.1, kind: 'door' });
    addOpening(m, { wall: w[1].id, offset: 1.0, width: 1.5, height: 1.5 });
    addOpening(m, { wall: w[2].id, offset: 1.0, width: 1.8, height: 1.5 });
    addOpening(m, { wall: w[2].id, offset: 6.5, width: 1.8, height: 1.5 });
    addOpening(m, { wall: w[3].id, offset: 2.0, width: 1.5, height: 1.5 });
    addOpening(m, { wall: w5.id, offset: 3.0, width: 0.9, height: 2.1, kind: 'door' });
    addOpening(m, { wall: w6.id, offset: 1.5, width: 0.9, height: 2.1, kind: 'door' });
    var rs = detectRooms(m, f.id);
    rs.forEach(function (r) {
      var c = r.poly.reduce(function (a, p) { return [a[0] + p[0] / r.poly.length, a[1] + p[1] / r.poly.length]; }, [0, 0]);
      m.roomOv[r.id] = c[0] < 6 ? { name: 'Гостиная', tv: 20 } : (c[1] < 4 ? { name: 'Спальня', tv: 20 } : { name: 'Санузел', tv: 25 });
    });
    return m;
  }

  var api = { DEFAULTS: DEFAULTS, create: create, addFloor: addFloor, addWall: addWall, addOpening: addOpening, removeWall: removeWall, removeOpening: removeOpening, fromPolygons: fromPolygons, hasFixed: hasFixed, dropFixed: dropFixed, addOpeningsAt: addOpeningsAt, estimateGap: estimateGap, offsetPoly: offsetPoly, wallR: wallR,
              detectRooms: detectRooms, heatLoss: heatLoss, sampleHouse: sampleHouse, openingsOn: openingsOn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HouseCore = api;
})(typeof window !== 'undefined' ? window : this);
