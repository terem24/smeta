/* house3d_edit.js — редактор стен для режима «Дом 3D» (тест, видит только владелец).
 *
 * Рисование плана прямо в окне 3D (вид сверху): стены цепочкой по кликам с привязкой к сетке 0,1 м, концам и телу других
 * стен (Т-примыкание), окна и двери кликом по стене, выбор пирога стены из списка, правка толщины, размеров проёмов,
 * названия и температуры комнаты. Модель — house_core.js: после каждой правки помещения находятся заново, теплопотери
 * и 3D пересчитываются. Отмена (Ctrl+Z), сохранение в браузере (localStorage), Delete удаляет выбранное.
 *
 * Подключается лениво по кнопке «Редактор стен» из house3d.js; к калькулятору не обращается.
 * Глобал: window.House3DEdit — { toggle }
 */
(function () {
  'use strict';

  var KEY = 'house3d_model_v1';
  // Пироги: слои задают λ из house_core.js (DEFAULTS.LAMBDA), R считает ядро
  var EXT = [
    { n: 'Газобетон D400 300 + мин. вата 100 + штукатурка', t: 0.42, l: [{ mat: 'gas_d400', thick: 300 }, { mat: 'minwool', thick: 100 }, { mat: 'plaster_cement', thick: 20 }] },
    { n: 'Газобетон D400 400 + штукатурка', t: 0.42, l: [{ mat: 'gas_d400', thick: 400 }, { mat: 'plaster_cement', thick: 20 }] },
    { n: 'Кирпич полнотелый 510 + штукатурка', t: 0.53, l: [{ mat: 'brick_clay', thick: 510 }, { mat: 'plaster_cement', thick: 20 }] },
    { n: 'Брус сосна 200', t: 0.20, l: [{ mat: 'wood_pine', thick: 200 }] },
    { n: 'Керамический блок 380 + штукатурка', t: 0.40, l: [{ mat: 'ceramic_block', thick: 380 }, { mat: 'plaster_cement', thick: 20 }] }
  ];
  var INT = [
    { n: 'Газобетон D500 150', t: 0.15, l: [{ mat: 'gas_d500', thick: 150 }] },
    { n: 'Кирпич 120', t: 0.12, l: [{ mat: 'brick_clay', thick: 120 }] },
    { n: 'Гипсокартон 100 (каркас)', t: 0.10, l: [{ mat: 'gkl', thick: 25 }, { mat: 'minwool', thick: 50 }, { mat: 'gkl', thick: 25 }] }
  ];

  var E = null;           // состояние редактора
  var A = null;           // API house3d.js

  function $(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }

  // ── вход и выход ────────────────────────────────────────────────────────
  function toggle(api) {
    A = api;
    var S = A.S();
    if (E && E.on) { stop(); return; }
    A.ensureCore().then(function (HC) {
      var T = S.T;
      if (!E) {
        E = { on: false, HC: HC, tool: 'wall', ortho: true, grid: 0.1, undo: [], ext: 0, int: 0, wtype: 'ext', labels: [], dims: { window: [1.5, 1.5, 0.9], door: [0.9, 2.1, 0] } };
        E.plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
        E.preview = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), new T.LineBasicMaterial({ color: 0xff4d4d, depthTest: false }));
        E.preview.renderOrder = 20; E.preview.visible = false;
        E.cursor = new T.Mesh(new T.SphereGeometry(0.08, 12, 8), new T.MeshBasicMaterial({ color: 0xffd23f, depthTest: false }));
        E.cursor.renderOrder = 21; E.cursor.visible = false;
        E.model = load() || fresh();
      }
      E.on = true;
      S.scene.add(E.preview); S.scene.add(E.cursor);
      buildPanel();
      var cv = S.renderer.domElement;
      E.h = { move: onMove, down: onDown, dbl: function () { endChain(); }, ctx: function (e) { e.preventDefault(); endChain(); }, key: onKey };
      cv.addEventListener('pointermove', E.h.move);
      cv.addEventListener('pointerdown', E.h.down, true);
      cv.addEventListener('dblclick', E.h.dbl);
      cv.addEventListener('contextmenu', E.h.ctx);
      document.addEventListener('keydown', E.h.key, true);
      E.saved = { rot: S.oc.enableRotate };
      S.oc.enableRotate = false;
      rebuild();
      topView();
      loop();
    }).catch(function (e) { S.info.textContent = 'Не удалось запустить редактор: ' + (e && e.message ? e.message : e); });
  }

  function stop() {
    var S = A.S();
    E.on = false;
    var cv = S.renderer.domElement;
    cv.removeEventListener('pointermove', E.h.move);
    cv.removeEventListener('pointerdown', E.h.down, true);
    cv.removeEventListener('dblclick', E.h.dbl);
    cv.removeEventListener('contextmenu', E.h.ctx);
    document.removeEventListener('keydown', E.h.key, true);
    S.scene.remove(E.preview); S.scene.remove(E.cursor);
    if (E.under) { S.scene.remove(E.under.mesh); E.under = null; }
    S.oc.enableRotate = E.saved.rot;
    if (E.panel) { E.panel.remove(); E.panel = null; }
    E.labels.forEach(function (l) { l.el.remove(); }); E.labels = [];
    E.chain = null;
    S.info.textContent = 'Редактор закрыт. Дом остался в сцене; открыть снова — кнопка «Редактор стен».';
  }

  function fresh() {
    var HC = E.HC, m = HC.create({ Tn: -25 });
    HC.addFloor(m, { level: 0 });
    return m;
  }

  function load() {
    try {
      var j = localStorage.getItem(KEY);
      if (j) { var m = JSON.parse(j); if (m && m.floors && m.floors.length) return m; }
    } catch (e) { /* закрытый режим браузера — работаем без сохранения */ }
    return null;
  }

  function save() { try { localStorage.setItem(KEY, JSON.stringify(E.model)); } catch (e) { /* без сохранения */ } }

  function snapshot() { E.undo.push(JSON.stringify(E.model)); if (E.undo.length > 60) E.undo.shift(); }

  function undo() {
    if (!E.undo.length) return;
    E.model = JSON.parse(E.undo.pop());
    E.sel = null; E.chain = null;
    rebuild();
  }

  function topView() {
    var S = A.S(), T = S.T, b = new T.Box3();
    if (E.model.walls.length) {
      E.model.walls.forEach(function (w) { b.expandByPoint(new T.Vector3(w.a[0], 0, -w.a[1])); b.expandByPoint(new T.Vector3(w.b[0], 0, -w.b[1])); });
    } else { b.set(new T.Vector3(0, 0, -8), new T.Vector3(12, 0, 0)); }
    var c = b.getCenter(new T.Vector3()), sz = b.getSize(new T.Vector3());
    var d = Math.max(sz.x, sz.z, 6) * 1.5;
    S.oc.target.copy(c); S.cam.position.set(c.x, d + 4, c.z + 0.01); S.oc.update();
  }

  // ── панель ──────────────────────────────────────────────────────────────
  function buildPanel() {
    var S = A.S();
    var p = $('div', 'h3d-ed');
    p.style.cssText = 'position:absolute;right:10px;top:170px;width:270px;max-height:calc(100% - 190px);overflow:auto;background:#1f2124ee;border-radius:4px;padding:8px;font-size:12px;line-height:1.45';
    S.view.appendChild(p);
    E.panel = p;
    refreshPanel();
  }

  function btn(label, on, fn, title) {
    var b = $('button', on ? 'on' : '', label);
    b.style.cssText = 'margin:2px 3px 2px 0';
    if (title) b.title = title;
    b.onclick = fn;
    return b;
  }

  function row(label, input) {
    var d = $('div'); d.style.cssText = 'display:flex;align-items:center;gap:6px;margin:3px 0';
    var l = $('span', '', label); l.style.cssText = 'flex:0 0 96px;color:#9aa';
    d.appendChild(l); d.appendChild(input); return d;
  }

  function num(v, step, fn) {
    var i = $('input'); i.type = 'number'; i.step = step; i.value = v;
    i.style.cssText = 'width:80px;background:#333;color:#eee;border:1px solid #555;padding:3px';
    i.onchange = function () { var x = parseFloat(i.value); if (isFinite(x)) fn(x); };
    return i;
  }

  function refreshPanel() {
    var S = A.S(), HC = E.HC, m = E.model, p = E.panel;
    if (!p) return;
    p.innerHTML = '';
    var h = $('div', '', 'Редактор стен'); h.style.cssText = 'font-weight:700;color:#7cc4ee;margin-bottom:4px'; p.appendChild(h);
    var tools = $('div');
    [['wall', 'Стена'], ['window', 'Окно'], ['door', 'Дверь'], ['select', 'Выбрать']].forEach(function (t) {
      tools.appendChild(btn(t[1], E.tool === t[0], function () { E.tool = t[0]; E.chain = null; refreshPanel(); }));
    });
    p.appendChild(tools);
    var acts = $('div');
    acts.appendChild(btn('Отмена', false, undo, 'Ctrl+Z'));
    acts.appendChild(btn('Вписать', false, topView, 'Показать весь план'));
    acts.appendChild(btn('Очистить', false, function () { snapshot(); E.model = fresh(); E.sel = null; rebuild(); }));
    acts.appendChild(btn(E.ortho ? 'Ортогонально: да' : 'Ортогонально: нет', E.ortho, function () { E.ortho = !E.ortho; refreshPanel(); }));
    p.appendChild(acts);
    var imp = $('div'); imp.style.cssText = 'margin:4px 0;padding:4px 0;border-top:1px solid #555;border-bottom:1px solid #555';
    imp.appendChild($('div', '', 'Импорт плана'));
    imp.appendChild(btn('Из планов калькулятора', false, importPlans, 'Контуры комнат, окна и двери из редактора планов этажей'));
    var fi = $('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.style.cssText = 'display:none';
    fi.onchange = function () { if (fi.files && fi.files[0]) loadUnderlay(fi.files[0]); };
    imp.appendChild(fi);
    imp.appendChild(btn('Подложка из файла', false, function () { fi.click(); }, 'Картинка плана под стены: обведите её стенами'));
    if (E.under) {
      imp.appendChild(btn('Масштаб по двум точкам', E.tool === 'scale', function () { E.tool = 'scale'; E.scalePts = []; E.chain = null; refreshPanel(); }, 'Кликните два конца известного размера, потом введите его длину'));
      imp.appendChild(row('Прозрачность', num(E.under.op, 0.1, function (x) { E.under.op = Math.max(0.1, Math.min(1, x)); E.under.mesh.material.opacity = E.under.op; })));
      imp.appendChild(btn('Убрать подложку', false, function () { A.S().scene.remove(E.under.mesh); E.under = null; refreshPanel(); }));
    }
    if (E.msg) { var mm = $('div', '', E.msg); mm.style.cssText = 'color:#ffd23f;margin-top:4px'; imp.appendChild(mm); }
    p.appendChild(imp);

    if (E.tool === 'scale') {
      p.appendChild(hint(E.scalePts && E.scalePts.length === 2 ? 'Введите расстояние между двумя точками и нажмите «Применить».' : 'Кликните две точки на подложке (' + (E.scalePts ? E.scalePts.length : 0) + ' из 2).'));
      if (E.scalePts && E.scalePts.length === 2) {
        var dI = num(1, 0.01, function () { }); dI.title = 'Расстояние, м';
        p.appendChild(row('Расстояние, м', dI));
        p.appendChild(btn('Применить', false, function () { applyScale(parseFloat(dI.value)); }));
      }
    } else if (E.tool === 'wall') {
      var ty = $('div');
      ty.appendChild(btn('Наружная', E.wtype === 'ext', function () { E.wtype = 'ext'; refreshPanel(); }));
      ty.appendChild(btn('Внутренняя', E.wtype === 'int', function () { E.wtype = 'int'; refreshPanel(); }));
      p.appendChild(ty);
      p.appendChild(row('Пирог', presetSelect(E.wtype === 'ext' ? EXT : INT, E.wtype === 'ext' ? E.ext : E.int, function (i) { if (E.wtype === 'ext') E.ext = i; else E.int = i; refreshPanel(); })));
      p.appendChild(hint('Клик — начало, следующие клики — стены цепочкой. Правая кнопка, двойной клик или замыкание на первую точку завершают.'));
    } else if (E.tool === 'window' || E.tool === 'door') {
      var d = E.dims[E.tool];
      p.appendChild(row('Ширина, м', num(d[0], 0.1, function (x) { d[0] = x; })));
      p.appendChild(row('Высота, м', num(d[1], 0.1, function (x) { d[1] = x; })));
      if (E.tool === 'window') p.appendChild(row('Подоконник, м', num(d[2], 0.1, function (x) { d[2] = x; })));
      p.appendChild(hint('Клик по стене ставит ' + (E.tool === 'window' ? 'окно' : 'дверь') + ' в этом месте.'));
    } else {
      p.appendChild(hint('Клик по стене, проёму или комнате — показать и изменить. Delete — удалить.'));
      selectedPanel(p);
    }

    // итог
    var res = HC.heatLoss(m), A0 = 0, nl = String.fromCharCode(10);
    var t = $('div'); t.style.cssText = 'margin-top:8px;border-top:1px solid #555;padding-top:6px';
    var tt = $('div', '', 'Tн ' + m.Tn + ' °C'); tt.style.cssText = 'color:#9aa';
    var tn = num(m.Tn, 1, function (x) { snapshot(); m.Tn = x; rebuild(); }); tn.style.width = '60px';
    t.appendChild(row('Tн, °C', tn));
    res.rooms.forEach(function (r) {
      A0 += r.area;
      var l = $('div', '', r.name + ': ' + r.area.toFixed(1) + ' м², ' + Math.round(r.Q) + ' Вт (' + Math.round(r.Q / r.area) + ' Вт/м²)');
      l.style.cursor = 'pointer';
      l.onclick = function () { E.sel = { kind: 'room', id: r.id }; E.tool = 'select'; refreshPanel(); };
      t.appendChild(l);
    });
    var tot = $('div', '', res.rooms.length ? 'Итого: ' + Math.round(res.total) + ' Вт, ' + Math.round(res.total / A0) + ' Вт/м²' : 'Помещений пока нет: замкните контур стенами.');
    tot.style.cssText = 'font-weight:700;margin-top:4px';
    t.appendChild(tot);
    p.appendChild(t);
  }

  function hint(t) { var d = $('div', '', t); d.style.cssText = 'color:#9aa;margin:4px 0'; return d; }

  function presetSelect(list, cur, fn) {
    var s = $('select'); s.style.cssText = 'width:150px;background:#333;color:#eee;border:1px solid #555;padding:3px';
    list.forEach(function (x, i) {
      var o = $('option', '', x.n.slice(0, 34)); o.value = i; o.title = x.n; if (i === cur) o.selected = true; s.appendChild(o);
    });
    s.onchange = function () { fn(parseInt(s.value, 10)); };
    return s;
  }

  function wallInfo(w, ext) {
    var R = E.HC.wallR(E.model, w, ext), L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    return 'длина ' + L.toFixed(2) + ' м, R = ' + R.toFixed(2) + ' м²·°C/Вт';
  }

  function selectedPanel(p) {
    var m = E.model, HC = E.HC, sel = E.sel;
    if (!sel) return;
    var box = $('div'); box.style.cssText = 'border:1px solid #555;border-radius:3px;padding:6px;margin:6px 0';
    if (sel.kind === 'wall') {
      var w = m.walls.find(function (x) { return x.id === sel.id; });
      if (!w) return;
      box.appendChild($('div', '', 'Стена'));
      var isExt = !!sel.ext;
      var list = isExt ? EXT : INT;
      var cur = Math.max(0, list.findIndex(function (x) { return w.layers && w.layers.length === x.l.length && x.l.every(function (l, i) { return l.mat === w.layers[i].mat && l.thick === w.layers[i].thick; }); }));
      box.appendChild(row('Пирог', presetSelect(list, cur, function (i) { snapshot(); w.layers = list[i].l.map(function (l) { return Object.assign({}, l); }); w.thick = list[i].t; w.R = null; rebuild(); })));
      box.appendChild(row('Толщина, м', num(w.thick, 0.01, function (x) { snapshot(); w.thick = x; rebuild(); })));
      box.appendChild(hint(wallInfo(w, isExt) + (isExt ? ' (наружная)' : ' (внутренняя)')));
      box.appendChild(btn('Удалить стену', false, function () { snapshot(); HC.removeWall(m, w.id); E.sel = null; rebuild(); }));
    } else if (sel.kind === 'opening') {
      var o = m.openings.find(function (x) { return x.id === sel.id; });
      if (!o) return;
      box.appendChild($('div', '', o.kind === 'door' ? 'Дверь' : 'Окно'));
      box.appendChild(row('Ширина, м', num(o.width, 0.1, function (x) { snapshot(); o.width = x; rebuild(); })));
      box.appendChild(row('Высота, м', num(o.height, 0.1, function (x) { snapshot(); o.height = x; rebuild(); })));
      if (o.kind !== 'door') box.appendChild(row('Подоконник, м', num(o.sill, 0.1, function (x) { snapshot(); o.sill = x; rebuild(); })));
      box.appendChild(row('R, м²·°C/Вт', num(o.R || (o.kind === 'door' ? m.settings.R_door : m.settings.R_glz), 0.01, function (x) { snapshot(); o.R = x; rebuild(); })));
      box.appendChild(btn('Удалить', false, function () { snapshot(); HC.removeOpening(m, o.id); E.sel = null; rebuild(); }));
    } else if (sel.kind === 'room') {
      var r = HC.detectRooms(m, m.floors[0].id).find(function (x) { return x.id === sel.id; });
      if (!r) return;
      var ov = m.roomOv[r.id] = m.roomOv[r.id] || {};
      box.appendChild($('div', '', 'Помещение'));
      var ni = $('input'); ni.value = ov.name || r.name; ni.style.cssText = 'width:130px;background:#333;color:#eee;border:1px solid #555;padding:3px';
      ni.onchange = function () { snapshot(); ov.name = ni.value; rebuild(); };
      box.appendChild(row('Название', ni));
      box.appendChild(row('Температура, °C', num(ov.tv !== undefined ? ov.tv : m.settings.tv, 1, function (x) { snapshot(); ov.tv = x; rebuild(); })));
      var ks = [['', 'обычная'], ['bath', 'санузел 25 °C'], ['hall', 'коридор 18 °C']];
      box.appendChild(hint('Площадь ' + r.area.toFixed(1) + ' м², периметр ' + r.perimeter.toFixed(1) + ' м'));
    }
    p.appendChild(box);
  }

  // ── импорт плана ────────────────────────────────────────────────────────
  function note(t) { E.msg = t; refreshPanel(); }

  function importPlans() {
    var HC = E.HC, m = E.model;
    var P = window.app && app.currentPlans && app.currentPlans();
    if (!P || !P.floors || !P.floors.length) { note('В калькуляторе нет планов этажей: сначала загрузите план в редакторе планов.'); return; }
    var f = P.floors[0];
    if (!f.pxPerM) { note('На плане не задан масштаб: задайте его в редакторе планов.'); return; }
    var zs = (f.zones || []).filter(function (z) { return z.pts && z.pts.length >= 3; });
    if (!zs.length) { note('На плане нет контуров комнат.'); return; }
    var k = 1 / f.pxPerM, xy = function (p) { return Array.isArray(p) ? [p[0] * k, -p[1] * k] : [p.x * k, -p.y * k]; };
    var polys = zs.map(function (z) { return { pts: z.pts.map(xy), name: z.name || '', tv: z.type === 'wc' ? 25 : (z.type === 'cold' ? 12 : undefined) }; });
    snapshot();
    var fl = m.floors[0];
    m.walls = m.walls.filter(function (w) { return w.floor !== fl.id; }); m.openings = []; m.roomOv = {};
    var ep = EXT[E.ext], ip = INT[E.int];
    var r = HC.fromPolygons(m, fl.id, polys, { ext: { layers: ep.l, thick: ep.t }, int: { layers: ip.l, thick: ip.t } });
    var g = f.geom || {}, wl = [];
    (g.wins || []).forEach(function (w) { wl.push({ x: w.x * k, y: -w.y * k, w: Math.max(0.6, (w.mm || 1500) / 1000), kind: 'window' }); });
    (g.doors || []).forEach(function (d) { wl.push({ x: d.x * k, y: -d.y * k, w: Math.max(0.6, (d.mm || 900) / 1000), kind: 'door' }); });
    var no = HC.addOpeningsAt(m, fl.id, wl);
    E.msg = 'Импорт: комнат ' + r.rooms + ', стен ' + r.walls + ', проёмов ' + no + ' из ' + wl.length + '. Пирог наружных стен — выбранный в списке (' + ep.n.slice(0, 22) + '...): проверьте стены.' +
      (P.floors.length > 1 ? ' Редактор правит один этаж: импортирован первый.' : '');
    E.sel = null;
    if (f.img && /^(data:|https?:)/.test(f.img)) setUnderlay(f.img, f.w || 0, f.h || 0, k, [0, 0]);
    rebuild(); topView();
  }

  // подложка: картинка плана под стенами, плоскость в y = -0,02
  function loadUnderlay(file) {
    var rd = new FileReader();
    rd.onload = function () { setUnderlay(rd.result, 0, 0, 0.01, [0, 0]); };
    rd.readAsDataURL(file);
  }

  function setUnderlay(url, w, h, mpp, origin) {
    var S = A.S(), T = S.T;
    new T.TextureLoader().load(url, function (tex) {
      tex.colorSpace = T.SRGBColorSpace;
      var iw = w || tex.image.width, ih = h || tex.image.height;
      if (E.under) S.scene.remove(E.under.mesh);
      var mat = new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.6, depthWrite: false });
      E.under = { mesh: new T.Mesh(new T.PlaneGeometry(1, 1), mat), iw: iw, ih: ih, mpp: mpp, origin: origin.slice(), op: 0.6 };
      E.under.mesh.rotation.x = -Math.PI / 2; E.under.mesh.renderOrder = -1;
      S.scene.add(E.under.mesh);
      placeUnderlay();
      E.msg = 'Подложка загружена. Если это не из калькулятора, задайте масштаб кнопкой «Масштаб по двум точкам».';
      refreshPanel();
    });
  }

  function placeUnderlay() {
    var u = E.under, wm = u.iw * u.mpp, hm = u.ih * u.mpp;
    u.mesh.scale.set(wm, hm, 1);
    u.mesh.position.set(u.origin[0] + wm / 2, -0.02, hm / 2 - u.origin[1]);
  }

  function applyScale(D) {
    var u = E.under, pts = E.scalePts;
    if (!u || !pts || pts.length < 2 || !(D > 0)) { note('Введите расстояние больше нуля.'); return; }
    var meas = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
    if (meas < 1e-6) { note('Точки совпадают.'); return; }
    var f = D / meas, A0 = pts[0];
    u.mpp *= f;
    u.origin = [A0[0] + (u.origin[0] - A0[0]) * f, A0[1] + (u.origin[1] - A0[1]) * f];     // первая точка остаётся на месте
    placeUnderlay();
    E.scalePts = []; E.tool = 'wall';
    E.msg = 'Масштаб задан: ' + (1 / u.mpp).toFixed(1) + ' пикселей на метр.';
    refreshPanel(); topView();
  }

  // ── перестроение ────────────────────────────────────────────────────────
  function rebuild() {
    var S = A.S(), HC = E.HC, m = E.model;
    if (S.house) { S.scene.remove(S.house); S.house = null; }
    var res = HC.heatLoss(m);
    S.model = m;
    S.house = A.houseMeshes(m, HC, res);
    S.scene.add(S.house);
    addHighlight(S);
    refreshLabels(res);
    refreshPanel();
    save();
  }

  function addHighlight(S) {
    var sel = E.sel, T = S.T, m = E.model;
    if (!sel || sel.kind === 'room') return;
    var f = m.floors[0], mesh = null;
    if (sel.kind === 'wall') {
      var w = m.walls.find(function (x) { return x.id === sel.id; });
      if (!w) return;
      var L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), ang = Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]);
      mesh = new T.Mesh(new T.BoxGeometry(L, f.h + 0.1, (w.thick || 0.3) + 0.08), new T.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.35, depthTest: false }));
      mesh.position.set((w.a[0] + w.b[0]) / 2, f.h / 2, -(w.a[1] + w.b[1]) / 2); mesh.rotation.y = ang;
    } else if (sel.kind === 'opening') {
      var o = m.openings.find(function (x) { return x.id === sel.id; });
      var w2 = o && m.walls.find(function (x) { return x.id === o.wall; });
      if (!w2) return;
      var L2 = Math.hypot(w2.b[0] - w2.a[0], w2.b[1] - w2.a[1]), ux = (w2.b[0] - w2.a[0]) / L2, uy = (w2.b[1] - w2.a[1]) / L2;
      var c = o.offset + o.width / 2;
      mesh = new T.Mesh(new T.BoxGeometry(o.width, o.height + 0.1, (w2.thick || 0.3) + 0.12), new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.5, depthTest: false }));
      mesh.position.set(w2.a[0] + ux * c, o.sill + o.height / 2, -(w2.a[1] + uy * c)); mesh.rotation.y = Math.atan2(uy, ux);
    }
    if (mesh) { mesh.renderOrder = 15; S.house.add(mesh); }
  }

  // подписи комнат поверх сцены
  function refreshLabels(res) {
    var S = A.S();
    E.labels.forEach(function (l) { l.el.remove(); }); E.labels = [];
    res.rooms.forEach(function (r) {
      var c = r.poly.reduce(function (a, p) { return [a[0] + p[0] / r.poly.length, a[1] + p[1] / r.poly.length]; }, [0, 0]);
      var el = $('div', '', r.name + ' ' + r.area.toFixed(1) + ' м²' + String.fromCharCode(10) + Math.round(r.Q) + ' Вт');
      el.style.cssText = 'position:absolute;pointer-events:none;color:#111;background:#ffffffcc;padding:1px 5px;border-radius:3px;font-size:11px;white-space:pre;transform:translate(-50%,-50%)';
      S.view.appendChild(el);
      E.labels.push({ el: el, pos: new S.T.Vector3(c[0], 0.2, -c[1]) });
    });
  }

  function loop() {
    if (!E || !E.on) return;
    requestAnimationFrame(loop);
    var S = A.S(), cv = S.renderer.domElement, w = cv.clientWidth, h = cv.clientHeight;
    E.labels.forEach(function (l) {
      var v = l.pos.clone().project(S.cam);
      l.el.style.display = v.z < 1 ? '' : 'none';
      l.el.style.left = ((v.x + 1) / 2 * w) + 'px'; l.el.style.top = ((1 - v.y) / 2 * h) + 'px';
    });
    if (E.dimEl && E.chain) {
      var v2 = E.dimPos.clone().project(S.cam);
      E.dimEl.style.left = ((v2.x + 1) / 2 * w) + 'px'; E.dimEl.style.top = ((1 - v2.y) / 2 * h) + 'px';
    }
  }

  // ── мышь ────────────────────────────────────────────────────────────────
  function planPoint(e) {
    var S = A.S(), r = S.renderer.domElement.getBoundingClientRect();
    S.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    S.ray.setFromCamera(S.mouse, S.cam);
    var v = new S.T.Vector3();
    if (!S.ray.ray.intersectPlane(E.plane, v)) return null;
    return [v.x, -v.z];
  }

  function segInfo(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy, t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    var q = [a[0] + dx * t, a[1] + dy * t];
    return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), q: q, t: t * Math.sqrt(L2) };
  }

  function snap(p) {
    var m = E.model, g = E.grid, best = null;
    if (E.chain && E.ortho) {
      var s = E.chain[E.chain.length - 1];
      if (Math.abs(p[0] - s[0]) > Math.abs(p[1] - s[1])) p = [p[0], s[1]]; else p = [s[0], p[1]];
    }
    var gp = [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g];
    m.walls.forEach(function (w) {
      [w.a, w.b].forEach(function (e) { var d = Math.hypot(p[0] - e[0], p[1] - e[1]); if (d < 0.25 && (!best || d < best.d)) best = { d: d, q: e.slice(), kind: 'end' }; });
    });
    if (best) return { p: best.q, kind: 'end' };
    m.walls.forEach(function (w) {
      var si = segInfo(p, w.a, w.b);
      if (si.d < 0.12 && (!best || si.d < best.d)) best = { d: si.d, q: si.q, kind: 'wall' };
    });
    if (best && !(E.chain && E.ortho)) return { p: [Math.round(best.q[0] * 100) / 100, Math.round(best.q[1] * 100) / 100], kind: 'wall' };
    return { p: gp, kind: 'grid' };
  }

  function onMove(e) {
    var S = A.S(), q = planPoint(e);
    if (!q) return;
    if (E.tool !== 'wall') { E.cursor.visible = false; E.preview.visible = false; return; }
    var s = snap(q);
    E.cursor.position.set(s.p[0], 0.1, -s.p[1]); E.cursor.visible = true;
    if (E.chain) {
      var a = E.chain[E.chain.length - 1];
      E.preview.geometry.setFromPoints([new S.T.Vector3(a[0], 0.1, -a[1]), new S.T.Vector3(s.p[0], 0.1, -s.p[1])]);
      E.preview.visible = true;
      var L = Math.hypot(s.p[0] - a[0], s.p[1] - a[1]);
      if (!E.dimEl) { E.dimEl = $('div'); E.dimEl.style.cssText = 'position:absolute;pointer-events:none;color:#fff;background:#d33;padding:1px 6px;border-radius:3px;font-size:12px;transform:translate(-50%,-140%)'; S.view.appendChild(E.dimEl); }
      E.dimEl.textContent = L.toFixed(2) + ' м'; E.dimEl.style.display = '';
      E.dimPos = new S.T.Vector3((a[0] + s.p[0]) / 2, 0.1, -(a[1] + s.p[1]) / 2);
    } else { E.preview.visible = false; if (E.dimEl) E.dimEl.style.display = 'none'; }
  }

  function endChain() {
    E.chain = null; if (E.preview) E.preview.visible = false; if (E.dimEl) E.dimEl.style.display = 'none';
  }

  function nearestWall(p, maxD) {
    var best = null;
    E.model.walls.forEach(function (w) {
      var si = segInfo(p, w.a, w.b), lim = maxD !== undefined ? maxD : (w.thick || 0.3) / 2 + 0.15;
      if (si.d < lim && (!best || si.d < best.si.d)) best = { w: w, si: si };
    });
    return best;
  }

  function isExtWall(w) {
    // наружная — если хотя бы с одной стороны нет помещения: берём из разбиения комнат
    var rs = E.HC.detectRooms(E.model, w.floor), hit = 0;
    rs.forEach(function (r) { r.edges.forEach(function (ed) { if (ed.wall === w) { hit++; if (!ed.neighbor) hit += 100; } }); });
    return hit >= 100 || hit === 0;
  }

  function onDown(e) {
    if (e.button !== 0) return;
    var S = A.S(), q = planPoint(e), m = E.model, HC = E.HC;
    if (!q) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (E.tool === 'scale') {
      E.scalePts = E.scalePts || [];
      if (E.scalePts.length >= 2) E.scalePts = [];
      E.scalePts.push(q.slice());
      refreshPanel();
      return;
    }
    if (E.tool === 'wall') {
      var s = snap(q).p;
      if (!E.chain) { E.chain = [s]; return; }
      var a = E.chain[E.chain.length - 1];
      if (Math.hypot(s[0] - a[0], s[1] - a[1]) < 0.1) return;
      snapshot();
      var pr = (E.wtype === 'ext' ? EXT[E.ext] : INT[E.int]);
      HC.addWall(m, { floor: m.floors[0].id, a: a.slice(), b: s.slice(), thick: pr.t, layers: pr.l.map(function (l) { return Object.assign({}, l); }) });
      var closed = E.chain.length >= 2 && Math.hypot(s[0] - E.chain[0][0], s[1] - E.chain[0][1]) < 0.05;
      E.chain.push(s);
      if (closed) endChain();
      rebuild();
    } else if (E.tool === 'window' || E.tool === 'door') {
      var nw = nearestWall(q);
      if (!nw) { S.info.textContent = 'Кликните по стене, чтобы поставить ' + (E.tool === 'window' ? 'окно' : 'дверь') + '.'; return; }
      var d = E.dims[E.tool], L = Math.hypot(nw.w.b[0] - nw.w.a[0], nw.w.b[1] - nw.w.a[1]);
      if (d[0] > L - 0.1) { S.info.textContent = 'Стена короче проёма: ' + L.toFixed(2) + ' м.'; return; }
      var off = Math.max(0.05, Math.min(L - d[0] - 0.05, nw.si.t - d[0] / 2));
      snapshot();
      var op = HC.addOpening(m, { wall: nw.w.id, offset: Math.round(off * 100) / 100, width: d[0], height: d[1], sill: E.tool === 'door' ? 0 : d[2], kind: E.tool });
      E.sel = { kind: 'opening', id: op.id };
      rebuild();
    } else {
      // выбор: проём, потом стена, потом комната
      var found = null;
      var nw2 = nearestWall(q);
      if (nw2) {
        var w = nw2.w, t = nw2.si.t;
        var op2 = m.openings.find(function (o) { return o.wall === w.id && t >= o.offset && t <= o.offset + o.width; });
        found = op2 ? { kind: 'opening', id: op2.id } : { kind: 'wall', id: w.id, ext: isExtWall(w) };
      } else {
        var rs = HC.detectRooms(m, m.floors[0].id), pt = q;
        var r = rs.find(function (rm) {
          var inside = false, P = rm.poly;
          for (var i = 0, j = P.length - 1; i < P.length; j = i++) {
            if ((P[i][1] > pt[1]) !== (P[j][1] > pt[1]) && pt[0] < (P[j][0] - P[i][0]) * (pt[1] - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) inside = !inside;
          }
          return inside;
        });
        if (r) found = { kind: 'room', id: r.id };
      }
      E.sel = found; rebuild();
    }
  }

  function onKey(e) {
    if (!E.on) return;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT') return;
    if (e.key === 'Escape') { if (E.chain) { endChain(); e.stopPropagation(); } return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'я')) { undo(); e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === 'Delete' && E.sel) {
      snapshot();
      if (E.sel.kind === 'wall') E.HC.removeWall(E.model, E.sel.id);
      else if (E.sel.kind === 'opening') E.HC.removeOpening(E.model, E.sel.id);
      E.sel = null; rebuild(); e.stopPropagation();
    }
  }

  window.House3DEdit = { toggle: toggle, _state: function () { return E; } };
})();
