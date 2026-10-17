/**
 * Сквозной прогон «Найти комнаты» на НАСТОЯЩЕМ plan_editor.html (не на выдернутых функциях):
 * страница открывается как есть, в неё кладётся лист и подписи (как их вернула бы модель),
 * зовётся autoRooms(), читаются зоны и подсказка. Нужен для сравнения «до/после» двух
 * версий редактора на одних и тех же листах.
 *
 * Как запустить (без Playwright): python -m http.server 8124 в корне, положить рядом копию
 * старой версии (git show origin/main:plan_editor.html > _base.html), открыть
 *   http://localhost:8124/_base.html?m=ufh   (и plan_editor.html?m=ufh)
 * один раз выставить localStorage.heatcalc_design_access='1', перезагрузить, затем в консоли:
 *   var s=document.createElement('script');s.src='/bench/room_drive.js';document.head.appendChild(s)
 *   await RoomDrive.run({ src: '/_t/5.png', labs: [...], ppm0: 86 })
 * Кейс: { src | synth:true, labs:[{m2,x,y,name?}] в пикселях исходной картинки, ppm0 — масштаб
 * до «Найти комнат» (как дали размеры/двери), dims:[{mm,px,horiz}] — общие размеры, table:{rows,total} }.
 * Возвращает { zones:[{type,name,m2}], sum, ppm, src, hint }.
 */
(function () {
  function load(src) {
    return new Promise(function (ok, err) {
      var im = new Image(); im.onload = function () { ok(im); }; im.onerror = err; im.src = src;
    });
  }
  async function run(c) {
    var cv, k = 1;
    if (c.synth) {
      var S = window.drawSynth ? window.drawSynth() : null;
      if (!S) throw new Error('нет drawSynth');
      cv = S.canvas; c = Object.assign({}, c, { labs: S.labs, dims: S.dims, ppm0: S.ppm * 0.91 });
    } else {
      var im = await load(c.src);
      k = Math.min(1, 1600 / Math.max(im.width, im.height));
      cv = document.createElement('canvas'); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
    }
    cur = 0;
    if (DATA.floors.length > 1) DATA.floors.length = 1;
    applyPlanCanvas(cv, true);
    var labs = (c.labs || []).map(function (l) {
      return { m2: l.m2, x: l.x * (c.synth ? 1 : k), y: l.y * (c.synth ? 1 : k), name: l.name || '', scan: true, fromTable: !!c.table };
    });
    if (c.table) labs.table = c.table;
    PDF_AREAS[0] = labs; PDF_DIMS[0] = null;
    SCAN_DIMS[0] = (c.dims || []).map(function (d) { return { mm: d.mm, px: d.px * (c.synth ? 1 : k), horiz: d.horiz }; });
    SCAN_READ[0] = false; SCAN_BUSY[0] = false;
    calcRooms = [];
    F().pxPerM = c.ppm0 || 0; F().scaleSrc = c.ppm0 ? 'dims' : undefined;
    if (!F().pxPerM) autoScale(true);
    resetScaleCaches();
    autoRooms();
    var zs = F().zones.filter(function (z) { return z.type !== 'cold'; }).map(function (z) {
      return { type: z.type, name: z.name || '', m2: +(+zoneM2(z)).toFixed(1) };
    });
    var h = document.getElementById('hint');
    return { zones: zs, sum: +zs.reduce(function (s, z) { return s + z.m2; }, 0).toFixed(1), ppm: +(F().pxPerM || 0).toFixed(1),
      src: F().scaleSrc, hint: h ? h.innerText.slice(0, 700) : '' };
  }
  window.RoomDrive = { run: run };
})();
