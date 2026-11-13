/* house3d.js — режим «Дом 3D» (тест, видит только владелец).
 *
 * Отдельная вкладка рядом с «Оборудование / Монтаж»: открывает окно на весь экран с 3D-сценой, где детали
 * (котёл, бойлер, насосные группы, коллекторы, узлы) ставятся как в Revit: вращение, панорама, зум, куб видов,
 * контурные линии, порты деталей, перемещение мышью. Старый калькулятор не трогает: ни state, ни render().
 *
 * Показывается только если app.wmPreviewOn() (учётка суперадмина). Остальным файл ничего не делает.
 * three.js грузится только при первом открытии окна (динамический import, версия закреплена).
 * Модели — models/parts3d/*.glb и models/nodes3d/*.glb (tools/export_parts_glb.py, export_nodes_glb.py);
 * описание и порты — parts.json и nodes.json рядом с ними. Координаты портов в файлах — как в Blender
 * (X вправо, Y в стену, Z вверх, мм); в сцене three.js — (x, z, -y), метры, как переводит экспортёр glTF.
 *
 * Глобал: window.House3D — { open, close }
 */
(function () {
  'use strict';

  var THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
  var DIRS = { parts: 'models/parts3d/', nodes: 'models/nodes3d/' };
  var S = null;           // состояние окна: три-объекты, список деталей, выбранное
  var tabTimer = null;

  // ── вкладка: ждём, пока приложение поймёт, кто пользователь ──────────────
  function mountTab() {
    if (document.getElementById('tab_house3d')) return true;
    if (!window.app || typeof app.wmPreviewOn !== 'function' || !app.wmPreviewOn()) return false;
    var bar = document.querySelector('.main-view-tabs');
    if (!bar) return false;
    var t = document.createElement('div');
    t.id = 'tab_house3d';
    t.className = 'tab';
    t.style.cssText = 'font-size:14px;font-weight:700;';
    t.title = 'Тест: 3D-модель дома и котельной (видите только вы)';
    t.textContent = 'Дом 3D';
    t.onclick = open;
    bar.appendChild(t);
    return true;
  }

  function watch() {
    var n = 0;
    tabTimer = setInterval(function () {
      if (mountTab() || ++n > 40) clearInterval(tabTimer);   // 40 попыток по 1,5 с: вход в учётку бывает не сразу
    }, 1500);
  }

  // ── окно ────────────────────────────────────────────────────────────────
  var CSS = [
    '#h3d{position:fixed;inset:0;z-index:9000;background:#2c2c2c;color:#e6e6e6;font:13px system-ui,sans-serif;display:flex}',
    '#h3d *{box-sizing:border-box}',
    '#h3d .side{width:290px;background:#3c3c3c;overflow:auto;padding:8px;flex:none}',
    '#h3d h4{margin:12px 0 4px;color:#7cc4ee;cursor:pointer;font-size:13px}',
    '#h3d .it{padding:4px 8px;border-radius:3px;cursor:pointer;font-size:12px;line-height:1.3}',
    '#h3d .it:hover{background:#4f4f4f}',
    '#h3d .view{position:relative;flex:1;min-width:0}',
    '#h3d canvas{display:block;width:100%;height:100%}',
    '#h3d .bar{position:absolute;left:10px;top:10px;display:flex;gap:6px;flex-wrap:wrap}',
    '#h3d button{background:#555;color:#eee;border:0;padding:6px 10px;cursor:pointer;border-radius:2px;font:inherit}',
    '#h3d button.on{background:#0696D7}',
    '#h3d .x{position:absolute;right:10px;top:10px}',
    '#h3d .info{position:absolute;left:10px;bottom:10px;background:#000a;padding:8px 10px;border-radius:4px;max-width:420px;line-height:1.5;white-space:pre-wrap}',
    '#h3d .cube{position:absolute;right:20px;top:60px;width:96px;height:96px;perspective:420px}',
    '#h3d .cube .c3{position:absolute;inset:0;transform-style:preserve-3d}',
    '#h3d .cube .f{position:absolute;width:56px;height:56px;left:20px;top:20px;background:#d7dbe0;color:#222;border:1px solid #6a6f76;',
    'display:flex;align-items:center;justify-content:center;font-size:10px;cursor:pointer;backface-visibility:hidden;user-select:none}',
    '#h3d .cube .f:hover{background:#0696D7;color:#fff}',
    '#h3d .hint{position:absolute;right:10px;bottom:10px;color:#9aa;font-size:11px;text-align:right;line-height:1.5}'
  ].join('');

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function open() {
    if (S) { S.root.style.display = 'flex'; resize(); return; }
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    var root = el('div'); root.id = 'h3d';
    var side = el('div', 'side');
    var view = el('div', 'view');
    root.appendChild(side); root.appendChild(view);
    document.body.appendChild(root);
    S = { root: root, side: side, view: view, items: [], sel: null, edges: true, ports: false, grid: true, n: 0, cache: {} };

    var bar = el('div', 'bar');
    bar.appendChild(btn('Контур', 'edges', true));
    bar.appendChild(btn('Порты', 'ports', false));
    bar.appendChild(btn('Сетка', 'grid', true));
    var del = el('button', '', 'Удалить'); del.onclick = removeSel; bar.appendChild(del);
    var clr = el('button', '', 'Очистить'); clr.onclick = clearAll; bar.appendChild(clr);
    var asm = el('button', '', 'Собрать из сметы'); asm.onclick = assembleFromEstimate; asm.title = 'Расставить котельную из текущей сметы'; bar.appendChild(asm);
    view.appendChild(bar);
    var x = el('button', 'x', 'Закрыть'); x.onclick = close; view.appendChild(x);
    S.info = el('div', 'info', 'Загрузка 3D…'); view.appendChild(S.info);
    view.appendChild(el('div', 'hint', 'Левая кнопка — вращать, правая — панорама, колесо — зум\nклик по детали — выбрать, W — двигать, E — вращать, Del — удалить'));
    document.addEventListener('keydown', onKey);

    // дополнения three.js импортируют «three» по имени — подсказываем адрес через import map (один раз)
    if (!document.querySelector('script[data-h3d-map]')) {
      var im = document.createElement('script');
      im.type = 'importmap';
      im.setAttribute('data-h3d-map', '1');
      im.textContent = JSON.stringify({ imports: { 'three': THREE_URL + 'build/three.module.js', 'three/addons/': THREE_URL + 'examples/jsm/' } });
      document.head.appendChild(im);
    }
    Promise.all([
      import(THREE_URL + 'build/three.module.js'),
      import(THREE_URL + 'examples/jsm/controls/OrbitControls.js'),
      import(THREE_URL + 'examples/jsm/controls/TransformControls.js'),
      import(THREE_URL + 'examples/jsm/loaders/GLTFLoader.js'),
      import(THREE_URL + 'examples/jsm/environments/RoomEnvironment.js'),
      loadJson(DIRS.parts + 'parts.json'), loadJson(DIRS.nodes + 'nodes.json')
    ]).then(function (m) {
      S.T = m[0]; S.OC = m[1].OrbitControls; S.TC = m[2].TransformControls; S.GL = m[3].GLTFLoader; S.RE = m[4].RoomEnvironment;
      S.meta = { parts: m[5], nodes: m[6] };
      initScene();
      fillList();
      S.info.textContent = Object.keys(m[5]).length + ' деталей и ' + Object.keys(m[6]).length + ' узлов. Выберите слева, что поставить.';
    }).catch(function (e) {
      S.info.textContent = 'Не удалось запустить 3D: ' + (e && e.message ? e.message : e);
    });
  }

  function loadJson(u) {
    return fetch(u).then(function (r) { if (!r.ok) throw new Error(u + ': ' + r.status + ' (модели не выложены на сайт, работает только локально)'); return r.json(); });
  }

  function btn(label, key, on) {
    var b = el('button', on ? 'on' : '', label);
    b.onclick = function () {
      S[key] = !S[key];
      b.className = S[key] ? 'on' : '';
      if (key === 'grid' && S.gridObj) S.gridObj.visible = S.grid;
      applyFlags();
    };
    return b;
  }

  function close() { if (S) S.root.style.display = 'none'; }

  function fillList() {
    S.side.innerHTML = '';
    [['parts', 'Детали котельной'], ['nodes', 'Узлы подключения']].forEach(function (g) {
      var h = el('h4', '', g[1] + ' (' + Object.keys(S.meta[g[0]]).length + ')');
      var box = el('div');
      h.onclick = function () { box.style.display = box.style.display === 'none' ? '' : 'none'; };
      S.side.appendChild(h); S.side.appendChild(box);
      Object.keys(S.meta[g[0]]).forEach(function (k) {
        var it = el('div', 'it', S.meta[g[0]][k].label);
        it.onclick = function () { addPart(g[0], k); };
        box.appendChild(it);
      });
    });
  }

  // ── сцена ───────────────────────────────────────────────────────────────
  function initScene() {
    var T = S.T;
    var R = S.renderer = new T.WebGLRenderer({ antialias: true });
    R.setPixelRatio(window.devicePixelRatio);
    var cv = R.domElement;
    S.view.insertBefore(cv, S.view.firstChild);
    var sc = S.scene = new T.Scene();
    sc.background = new T.Color(0x2c2c2c);
    sc.environment = new T.PMREMGenerator(R).fromScene(new S.RE(), 0.04).texture;
    sc.environmentIntensity = 0.55;
    sc.add(new T.HemisphereLight(0xffffff, 0x888a90, 0.55));
    var dl = new T.DirectionalLight(0xffffff, 1.1); dl.position.set(2, 3, 4); sc.add(dl);
    var cam = S.cam = new T.PerspectiveCamera(35, 1, 0.01, 200);
    cam.position.set(2.2, 1.6, 3.0);
    var oc = S.oc = new S.OC(cam, cv);
    oc.target.set(0, 0.6, 0); oc.update();
    S.gridObj = new T.GridHelper(10, 100, 0x888888, 0x444444); sc.add(S.gridObj);
    var tc = S.tc = new S.TC(cam, cv);
    tc.setSize(0.8);
    tc.addEventListener('dragging-changed', function (e) {
      oc.enabled = !e.value; S.drag = !!e.value;
      if (e.value) startDrag(); else endDrag();
      applyFlags();
    });
    tc.addEventListener('objectChange', previewSnap);
    S.snapMark = new T.Mesh(new T.SphereGeometry(0.02, 16, 12), new T.MeshBasicMaterial({ color: 0x35c46a, transparent: true, opacity: 0.55, depthTest: false }));
    S.snapMark.renderOrder = 11; S.snapMark.visible = false; sc.add(S.snapMark);
    S.links = [];
    sc.add(tc);
    S.ray = new T.Raycaster(); S.mouse = new T.Vector2();
    var down = null;
    cv.addEventListener('pointerdown', function (e) { down = [e.clientX, e.clientY]; });
    cv.addEventListener('pointerup', function (e) {
      if (down && Math.abs(e.clientX - down[0]) + Math.abs(e.clientY - down[1]) < 5 && !tc.dragging) pick(e);
    });
    buildCube();
    window.addEventListener('resize', resize);
    resize();
    (function loop() {
      if (!S) return;
      requestAnimationFrame(loop);
      if (S.root.style.display === 'none') return;
      oc.update(); syncCube();
      R.render(sc, cam);
    })();
  }

  function resize() {
    if (!S || !S.renderer) return;
    var w = S.view.clientWidth, h = S.view.clientHeight;
    S.renderer.setSize(w, h);
    S.cam.aspect = w / Math.max(h, 1);
    S.cam.updateProjectionMatrix();
  }

  // ── куб видов, как в Revit: поворот синхронен камере, клик по грани — вид с этой стороны ────
  var FACES = [
    ['Спереди', [0, 0, 1], 'rotateY(0deg)'], ['Сзади', [0, 0, -1], 'rotateY(180deg)'],
    ['Справа', [1, 0, 0], 'rotateY(90deg)'], ['Слева', [-1, 0, 0], 'rotateY(-90deg)'],
    ['Сверху', [0, 1, 0.0001], 'rotateX(90deg)'], ['Снизу', [0, -1, 0.0001], 'rotateX(-90deg)']
  ];

  function buildCube() {
    var c = el('div', 'cube'), c3 = el('div', 'c3');
    FACES.forEach(function (f) {
      var d = el('div', 'f', f[0]);
      d.style.transform = f[2] + ' translateZ(28px)';
      d.onclick = function () { snapView(f[1]); };
      c3.appendChild(d);
    });
    c.appendChild(c3);
    S.view.appendChild(c);
    S.c3 = c3;
  }

  function syncCube() {
    var m = S.cam.matrixWorldInverse.elements;       // вращение мира в системе камеры
    // three: x вправо, y вверх; CSS: y вниз — сопрягаем отражением по Y
    var r = [
      m[0], -m[1], m[2], 0,
      -m[4], m[5], -m[6], 0,
      m[8], -m[9], m[10], 0,
      0, 0, 0, 1
    ];
    S.c3.style.transform = 'matrix3d(' + r.join(',') + ')';
  }

  function snapView(dir) {
    var T = S.T, t = S.oc.target, d = S.cam.position.distanceTo(t);
    var v = new T.Vector3(dir[0], dir[1], dir[2]).normalize().multiplyScalar(d).add(t);
    S.cam.position.copy(v);
    S.oc.update();
  }

  // ── детали ──────────────────────────────────────────────────────────────
  // Деталь целиком: модель (загружается один раз, дальше копии), контурные линии, порты. В сцену не ставит.
  function makePart(group, key) {
    var T = S.T, meta = S.meta[group][key];
    var k = group + '/' + key;
    var p = S.cache[k] || (S.cache[k] = new Promise(function (res, rej) {
      new S.GL().load(DIRS[group] + key + '.glb', function (g) { res(g.scene); }, undefined, rej);
    }));
    return p.then(function (src) {
      var o = src.clone(true);
      o.userData = { key: key, group: group, label: meta.label, id: ++S.n };
      o.traverse(function (m) {
        if (!m.isMesh) return;
        var mt = [].concat(m.material)[0];
        var flat = mt && (mt.transparent || (mt.map && mt.alphaTest >= 0 && /логотип|табличка|панель управления|шкала/i.test(m.name || '')));
        if (!flat) {
          var l = new T.LineSegments(new T.EdgesGeometry(m.geometry, 28), new T.LineBasicMaterial({ color: 0x14161a }));
          l.userData.edge = true; m.add(l);
        }
      });
      addPortMarkers(o, meta);
      return o;
    });
  }

  function addPart(group, key) {
    var meta = S.meta[group][key];
    S.info.textContent = 'Загрузка «' + meta.label + '»…';
    makePart(group, key).then(function (o) {
      o.position.set((S.items.length % 4) * 0.8 - 1.2, 0, Math.floor(S.items.length / 4) * 0.8);
      S.scene.add(o); S.items.push(o);
      applyFlags();
      select(o);
      S.info.textContent = meta.label + '\nпортов: ' + ((meta.ports || []).length);
    }).catch(function (e) { S.info.textContent = 'Не удалось загрузить ' + key + ': ' + (e && e.message ? e.message : e); });
  }

  // ── сборка котельной из сметы ───────────────────────────────────────────
  // Позиция сметы -> модель. Ищем по артикулу (id/артикул ТЕРЕМ); у ROMMER те же детали с другим префиксом
  // в списке не заменяем: другой бренд выглядит иначе, честнее показать «нет модели».
  var MODEL_MAP = [
    [/^GE0Q6/, 'boiler_haier_neoslim', 'anchor'],
    [/^SWH-2110-000300/, 'boiler_swh2110_300', 'anchor'], [/^SWH-2110-000500/, 'boiler_swh2110_500', 'anchor'],
    [/^SDG-0001-0025/, 'pump_group_sdg0001_direct', 'group'], [/^SDG-0002-0025/, 'pump_group_sdg0002_25', 'group'],
    [/^SDG-0003-0025/, 'pump_group_sdg0003_servo', 'group'],
    [/^SDG-0018-004002/, 'hydro_collector_sdg0018_2', 'anchor'],
    [/^SST-0001-000250/, 'stabilizer_st250', 'anchor'],
    [/^SVB-0004/, 'ball_valve_svb0004', 'valve'], [/^SFT-0041/, 'union_sft0041', 'union'],
    [/^(RFW-0070|SFW-0070)/, 'separator_rfw0070', 'separator'], [/^(RFW-0080|SFW-0080)/, 'filter_rfw0080', 'filter'],
    [/^(SSS|RSS)-2021/, 'adapter_rss1021', 'adapter'], [/^(SSS|RSS)-2022/, 'adapter_rss1022', 'adapter']
  ];

  function modelFor(it) {
    var ids = [it.id, it.displaySku].map(function (x) { return String(x || ''); });
    for (var i = 0; i < MODEL_MAP.length; i++) {
      if (ids.some(function (x) { return MODEL_MAP[i][0].test(x); })) return { key: MODEL_MAP[i][1], role: MODEL_MAP[i][2] };
    }
    return null;
  }

  function freePorts(o) {
    return portsOf(o).filter(function (q) { return !q.m.userData.used; });
  }

  // Посадить деталь o своим портом a на свободный порт b другой детали (как при перетаскивании)
  function seat(o, a, b) {
    var T = S.T;
    var q = new T.Quaternion().setFromUnitVectors(a.dir, b.dir.clone().negate());
    o.quaternion.premultiply(q); o.updateMatrixWorld(true);
    var pa = a.m.getWorldPosition(new T.Vector3());
    o.position.add(b.pos.clone().sub(pa)); o.updateMatrixWorld(true);
    a.m.userData.used = b.m.userData.used = true;
    // заодно занимаем остальные порты, которые встали вплотную (группа на двух патрубках коллектора)
    var others = [];
    S.items.forEach(function (x) { if (x !== o) others = others.concat(portsOf(x)); });
    portsOf(o).forEach(function (mine) {
      if (mine.m.userData.used) return;
      others.forEach(function (t) { if (!t.m.userData.used && mine.pos.distanceTo(t.pos) < 0.004 && compat(mine.p, t.p).ok) mine.m.userData.used = t.m.userData.used = true; });
    });
    S.links.push({ a: { owner: o, port: a.p }, b: { owner: b.m.parent, port: b.p } });
  }

  // Подобрать пару портов: порт нового элемента × свободный порт уже стоящей детали
  function findSeat(o, targets, allowMaybe) {
    var mine = freePorts(o), best = null;
    targets.forEach(function (t) {
      mine.forEach(function (a) {
        var c = compat(a.p, t.p);
        if (!c.ok || (c.maybe && !allowMaybe)) return;
        var score = (c.maybe ? 10 : 0) + (a.p.name === 'in' ? 0 : 1);
        if (!best || score < best.score) best = { a: a, b: t, score: score };
      });
    });
    return best;
  }

  function assembleFromEstimate() {
    var L = (window.app && app.currentEquipmentList) || [];
    if (!L.length) { S.info.textContent = 'В смете пока нет позиций: задайте дом и вернитесь.'; return; }
    clearAll();
    var parts = [], missing = [];
    L.forEach(function (it) {
      var m = modelFor(it);
      if (!m) { if (/^[12]\./.test(it.sectionTitle || '') && !/Теплоизоляц|Крепёж|Общие материалы/.test(it.group || '')) missing.push(it.name); return; }
      for (var i = 0; i < Math.min(Math.round(it.q) || 1, 6); i++) parts.push({ key: m.key, role: m.role, name: it.name });
    });
    if (!parts.length) { S.info.textContent = 'В смете нет позиций, для которых есть 3D-модель.'; return; }
    S.info.textContent = 'Собираю котельную: ' + parts.length + ' деталей…';
    Promise.all(parts.map(function (p) { return makePart('parts', p.key).then(function (o) { p.o = o; return p; }); })).then(function () {
      var T = S.T, x = 0, unplaced = [];
      function put(p, px, pz) { p.o.position.set(px, 0, pz); S.scene.add(p.o); S.items.push(p.o); p.o.updateMatrixWorld(true); }
      function width(o) { var b = new T.Box3().setFromObject(o); return b.max.x - b.min.x; }
      // 1) крупное — в ряд у стены: котлы, коллектор, стабилизатор (группы — на коллектор, если он есть)
      var hasCollector = parts.some(function (p) { return p.key.indexOf('hydro_collector') === 0; });
      parts.forEach(function (p) {
        if (p.role === 'anchor' || (p.role === 'group' && !hasCollector)) { var w = width(p.o); put(p, x + w / 2, 0); x += w + 0.25; p.placed = true; }
      });
      var boilers = parts.filter(function (p) { return p.placed && /^boiler_/.test(p.key); });
      var coll = parts.filter(function (p) { return p.placed && /^hydro_collector/.test(p.key); });
      // 2) группы — на верхние патрубки коллектора
      parts.filter(function (p) { return p.role === 'group' && !p.placed; }).forEach(function (p) {
        put(p, 0, 0);
        var seatC = null;
        for (var i = 0; i < coll.length && !seatC; i++) seatC = findSeat(p.o, freePorts(coll[i].o), false);
        if (seatC) { seat(p.o, seatC.a, seatC.b); p.placed = true; } else { S.scene.remove(p.o); S.items.pop(); }
      });
      // 3) обвязка котла цепочками: американка → кран → сепаратор/фильтр → переходник. Подача и обратка — по гидравлическим
      //    патрубкам Haier (A, G); газ C и ХВС D в смету обвязки не входят
      var pool = { union: [], valve: [], separator: [], filter: [], adapter: [] };
      parts.forEach(function (p) { if (pool[p.role]) pool[p.role].push(p); });
      var boiler = boilers[0];
      var heads = boiler ? portsOf(boiler.o).filter(function (q) { return /^[AG]$/.test(q.p.name); }) : [];
      var chains = [['union', 'valve', 'separator', 'adapter'], ['union', 'valve', 'filter', 'adapter']];
      heads.forEach(function (h, ci) {
        var tail = [h], chain = chains[ci % chains.length];
        chain.forEach(function (role) {
          var p = pool[role].shift();
          if (!p) return;
          put(p, 0, 0);
          var s = findSeat(p.o, tail, true);
          if (!s) { unplaced.push(p); S.scene.remove(p.o); S.items.pop(); return; }
          seat(p.o, s.a, s.b); p.placed = true;
          tail = freePorts(p.o).filter(function (q) { return q.p.name !== 'in'; });
          if (!tail.length) tail = freePorts(p.o);
        });
      });
      // 4) остальное — рядом, «на складе»
      var sx = 0;
      parts.forEach(function (p) {
        if (p.placed) return;
        if (S.items.indexOf(p.o) < 0) { var w = width(p.o); put(p, sx + w / 2, 0.8); sx += w + 0.08; }
        unplaced.push(p);
      });
      applyFlags();
      var done = parts.filter(function (p) { return p.placed; }).length;
      var lines = ['Из сметы: ' + done + ' из ' + parts.length + ' деталей поставлено на места, ' + S.links.length + ' стыков.'];
      if (unplaced.length) lines.push('Не нашлось куда поставить (лежат на складе): ' + unplaced.map(function (p) { return p.name; }).slice(0, 5).join('; '));
      if (missing.length) lines.push('Нет 3D-модели: ' + missing.length + ' поз. (' + missing.slice(0, 4).join('; ') + (missing.length > 4 ? '…' : '') + ')');
      lines.push('Порядок цепочек предварительный: сверьте со схемой узла.');
      S.info.textContent = lines.join(String.fromCharCode(10));
      var b = new T.Box3(); S.items.forEach(function (o) { b.expandByObject(o); });
      var c = b.getCenter(new T.Vector3()), d = Math.max(b.getSize(new T.Vector3()).length(), 1);
      S.oc.target.copy(c); S.cam.position.set(c.x + d * 0.3, c.y + d * 0.3, c.z + d * 1.1); S.oc.update();
    }).catch(function (e) { S.info.textContent = 'Не удалось собрать: ' + (e && e.message ? e.message : e); });
  }

  // порты: из Blender (X, Y, Z) мм -> три (x, z, -y) м
  function addPortMarkers(o, meta) {
    var T = S.T, col = { M: 0xff9a2e, F: 0x2e8cff, P: 0x35c46a, U: 0x999999 };
    (meta.ports || []).forEach(function (p) {
      var s = new T.Mesh(new T.SphereGeometry(0.008, 12, 8), new T.MeshBasicMaterial({ color: col[p.type] || 0x999999, depthTest: false }));
      s.renderOrder = 10;
      s.position.set(p.pos_mm[0] / 1000, p.pos_mm[2] / 1000, -p.pos_mm[1] / 1000);
      s.userData.port = p; s.userData.isPort = true;
      s.userData.dir = new T.Vector3(p.axis[0], p.axis[2], -p.axis[1]).normalize();   // наружу из детали, три-оси
      o.add(s);
    });
  }

  function applyFlags() {
    S.items.forEach(function (o) {
      o.traverse(function (m) {
        if (m.userData.edge) m.visible = S.edges;
        if (m.userData.isPort) m.visible = S.ports || S.drag;
      });
    });
  }

  function pick(e) {
    var r = S.renderer.domElement.getBoundingClientRect();
    S.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    S.ray.setFromCamera(S.mouse, S.cam);
    var hits = S.ray.intersectObjects(S.items, true);
    for (var i = 0; i < hits.length; i++) {
      if (hits[i].object.userData.edge || hits[i].object.userData.isPort) { if (hits[i].object.userData.isPort) { showPort(hits[i].object.userData.port); return; } continue; }
      var o = hits[i].object;
      while (o && S.items.indexOf(o) < 0) o = o.parent;
      if (o) { select(o); return; }
    }
    select(null);
  }

  // ── стыковка по портам ───────────────────────────────────────────────────
  var SNAP_R = 0.04;                        // м: ближе этого порты считаются «подведёнными»
  var TN = { M: 'наружная резьба (НР)', F: 'внутренняя резьба или гайка (ВР)', P: 'труба', U: 'тип резьбы не известен' };

  function normSize(x) { return String(x || '').replace(/^D/, '').trim(); }

  // Что с чем стыкуется: НР–ВР одного размера; труба–труба одного диаметра; неизвестный тип — с оговоркой
  function compat(a, b) {
    var ta = a.type, tb = b.type;
    if (normSize(a.size) !== normSize(b.size)) return { ok: false, why: 'разные размеры: ' + a.size + ' и ' + b.size };
    if ((ta === 'M' && tb === 'F') || (ta === 'F' && tb === 'M')) return { ok: true };
    if (ta === 'P' && tb === 'P') return { ok: true };
    if (ta === 'U' || tb === 'U') return { ok: true, maybe: true, why: 'тип резьбы одного из концов не подтверждён паспортом' };
    if (ta === tb) return { ok: false, why: TN[ta] + ' не стыкуется с таким же концом: нужна пара НР–ВР' };
    return { ok: false, why: 'труба не вставляется в резьбу: нужен переходник' };
  }

  function portsOf(o) {
    o.updateMatrixWorld(true);
    var out = [];
    o.children.forEach(function (m) {
      if (!m.userData.isPort) return;
      out.push({ m: m, p: m.userData.port, pos: m.getWorldPosition(new S.T.Vector3()),
                 dir: m.userData.dir.clone().transformDirection(o.matrixWorld) });
    });
    return out;
  }

  function nearestPair(sel) {
    var mine = portsOf(sel), best = null;
    S.items.forEach(function (o) {
      if (o === sel) return;
      portsOf(o).forEach(function (b) {
        mine.forEach(function (a) {
          var d = a.pos.distanceTo(b.pos);
          if (d < SNAP_R && (!best || d < best.d)) best = { a: a, b: b, d: d, owner: o };
        });
      });
    });
    if (best) best.c = compat(best.a.p, best.b.p);
    return best;
  }

  function startDrag() {
    if (!S.sel) return;
    S.links = S.links.filter(function (l) { return l.a.owner !== S.sel && l.b.owner !== S.sel; });
    S.cand = null; S.snapMark.visible = false;
  }

  function previewSnap() {
    if (!S.sel) return;
    var c = S.cand = nearestPair(S.sel);
    if (!c) { S.snapMark.visible = false; return; }
    S.snapMark.position.copy(c.b.pos);
    S.snapMark.material.color.set(!c.c.ok ? 0xff4d4d : (c.c.maybe ? 0xffd23f : 0x35c46a));
    S.snapMark.visible = true;
    S.info.textContent = (c.c.ok ? 'Можно состыковать: ' : 'Не стыкуется: ') + c.a.p.name + ' (' + TN[c.a.p.type] + ', ' + c.a.p.size +
      ') и ' + c.b.p.name + ' (' + TN[c.b.p.type] + ', ' + c.b.p.size + ')' + (c.c.why ? '\n' + c.c.why : '');
  }

  // Отпустили деталь: подходящая пара — поворачиваем так, чтобы концы смотрели навстречу, и сажаем порт на порт
  function endDrag() {
    var c = S.cand, sel = S.sel, T = S.T;
    S.snapMark.visible = false;
    if (!c || !sel || !c.c.ok) { if (c && !c.c.ok) S.info.textContent = 'Не стыкуется: ' + c.c.why; return; }
    var q = new T.Quaternion().setFromUnitVectors(c.a.dir, c.b.dir.clone().negate());
    sel.quaternion.premultiply(q);
    sel.updateMatrixWorld(true);
    var pa = c.a.m.getWorldPosition(new T.Vector3());
    sel.position.add(c.b.pos.clone().sub(pa));
    sel.updateMatrixWorld(true);
    S.links.push({ a: { owner: sel, port: c.a.p }, b: { owner: c.owner, port: c.b.p } });
    S.info.textContent = 'Соединено: ' + sel.userData.label + ' [' + c.a.p.name + '] ↔ ' + c.owner.userData.label + ' [' + c.b.p.name + ']' +
      '\n' + (c.c.maybe ? 'внимание: ' + c.c.why : (c.a.p.type === 'P' ? 'труба ' + c.a.p.size : 'резьба ' + c.a.p.size + ', НР–ВР')) + '. Всего стыков: ' + S.links.length;
    S.cand = null;
  }

  function showPort(p) {
    var t = { M: 'наружная резьба (НР)', F: 'внутренняя резьба или накидная гайка (ВР)', P: 'труба', U: 'тип не известен' }[p.type] || p.type;
    S.info.textContent = 'Порт ' + p.name + ': ' + t + ', ' + p.size + '\nисточник: ' + p.src;
  }

  function select(o) {
    S.sel = o;
    if (o) { S.tc.attach(o); S.info.textContent = o.userData.label; } else S.tc.detach();
  }

  function removeSel() {
    if (!S || !S.sel) return;
    S.tc.detach(); S.scene.remove(S.sel);
    S.items.splice(S.items.indexOf(S.sel), 1); S.sel = null;
  }

  function clearAll() {
    if (!S) return;
    S.tc.detach();
    S.items.forEach(function (o) { S.scene.remove(o); });
    S.items = []; S.sel = null; S.links = [];
  }

  function onKey(e) {
    if (!S || S.root.style.display === 'none') return;
    if (e.key === 'w' || e.key === 'W' || e.key === 'ц' || e.key === 'Ц') S.tc.setMode('translate');
    else if (e.key === 'e' || e.key === 'E' || e.key === 'у' || e.key === 'У') S.tc.setMode('rotate');
    else if (e.key === 'Delete') removeSel();
    else if (e.key === 'Escape') close();
  }

  window.House3D = { open: open, close: close, _state: function () { return S; }, _nearest: function (o) { return nearestPair(o); }, _end: endDrag };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
})();
