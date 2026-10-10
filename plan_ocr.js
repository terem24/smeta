/**
 * Масштаб плана-картинки без сервиса распознавания: цифры размеров читает Tesseract
 * прямо в браузере. Запасной путь для plan_editor.html — когда ИИ не ответил или не
 * нашёл размеры. Грузится лениво (около 8 МБ в папке ocr/, свои, не с чужого CDN:
 * у части пользователей внешние сети закрыты).
 *
 *   PlanOcr.scale(canvas, onStage) → Promise<{ ppm, n, total, via } | null>
 *
 * Как считает: числа вида «3 350» читаются с трёх поворотов листа (подписи
 * вертикальных размеров лежат боком), соседние числа одной цепочки дают px/мм по
 * тем же правилам, что и текстовый слой PDF (scaleFromDims из редактора). Цепочки
 * размеров «в свету» завышают масштаб на 5–8 % — толщина стен прибавляется к
 * расстоянию между подписями, — поэтому, если на листе есть общий размер (одна
 * длинная линия с засечками), масштаб уточняется по ней.
 */
(function () {
  var base = (document.currentScript && document.currentScript.src || '').replace(/[^\/]*$/, '');
  var LIB = base + 'ocr/';
  var workerP = null;

  function loadScript(src) {
    return new Promise(function (ok, err) {
      var s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = function () { err(new Error('не загрузился ' + src)); };
      document.head.appendChild(s);
    });
  }

  function getWorker(onStage) {
    if (workerP) return workerP;
    workerP = (window.Tesseract ? Promise.resolve() : loadScript(LIB + 'tesseract.min.js')).then(function () {
      if (onStage) onStage('Загружаю модуль чтения цифр');
      return window.Tesseract.createWorker('eng', 1, {
        workerPath: LIB + 'worker.min.js', corePath: LIB + 'core-simd.js', langPath: LIB.replace(/\/$/, ''),
        gzip: true, workerBlobURL: false, logger: function () {}
      });
    }).then(function (w) {
      return w.setParameters({ tessedit_char_whitelist: '0123456789 ', tessedit_pageseg_mode: '11' })
        .then(function () { return w; });
    });
    workerP['catch'](function () { workerP = null; });
    return workerP;
  }

  /** Лист, повёрнутый на rot° по часовой и увеличенный в k раз (мелкие цифры читаются хуже) */
  function rotated(c, rot, k) {
    if (!rot && k === 1) return c;
    var sw = rot === 90 || rot === 270, t = document.createElement('canvas');
    var w = Math.round(c.width * k), h = Math.round(c.height * k);
    t.width = sw ? h : w; t.height = sw ? w : h;
    var g = t.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, t.width, t.height);
    g.translate(t.width / 2, t.height / 2); g.rotate(rot * Math.PI / 180);
    g.drawImage(c, -w / 2, -h / 2, w, h);
    return t;
  }

  /** Слова одного прохода → числа «3 350» (цифра-тысячи отдельным словом склеивается),
   *  центры в системе исходной картинки. */
  function pass(worker, c, rot, k) {
    var W0 = c.width * k, H0 = c.height * k;
    return worker.recognize(rotated(c, rot, k), {}, { blocks: true }).then(function (r) {
      var ws = [];
      ((r.data && r.data.blocks) || []).forEach(function (b) {
        b.paragraphs.forEach(function (p) { p.lines.forEach(function (l) { l.words.forEach(function (x) {
          var s = String(x.text || '').replace(/\s+/g, '');
          if (/^\d+$/.test(s) && x.confidence >= 45) ws.push({ s: s, b: x.bbox });
        }); }); });
      });
      ws.sort(function (a, b) { return (a.b.y0 - b.b.y0) || (a.b.x0 - b.b.x0); });
      var used = {}, out = [];
      ws.forEach(function (a, i) {
        if (used[i]) return;
        var s = a.s, x1 = a.b.x1, y1 = a.b.y1, h = Math.max(a.b.y1 - a.b.y0, 8);
        if (s.length <= 2) {
          for (var j = 0; j < ws.length; j++) {
            var b = ws[j];
            if (j === i || used[j] || !/^\d{3}$/.test(b.s)) continue;
            if (Math.abs(b.b.y0 - a.b.y0) < h * 0.5 && b.b.x0 - a.b.x1 >= -2 && b.b.x0 - a.b.x1 < h * 1.1) {
              s += b.s; x1 = b.b.x1; y1 = Math.max(y1, b.b.y1); used[j] = true; break;
            }
          }
        }
        if (!/^\d{3,5}$/.test(s)) return;
        var cx = (a.b.x0 + x1) / 2, cy = (a.b.y0 + y1) / 2, x, y;
        if (rot === 0) { x = cx; y = cy; }
        else if (rot === 90) { x = cy; y = H0 - cx; }      // лист повёрнут по часовой
        else { x = W0 - cy; y = cx; }                       // против часовой
        out.push({ s: s, x: x / k, y: y / k, w: 0, h: h / k, rot: rot });
      });
      return out;
    });
  }

  /** Серая картинка для поиска линий */
  function grayOf(c) {
    var g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data;
    var a = new Uint8Array(c.width * c.height);
    for (var i = 0, p = 0; i < a.length; i++, p += 4) a[i] = (d[p] * 3 + d[p + 1] * 6 + d[p + 2]) / 10;
    return a;
  }

  /**
   * Длина размерной линии под (над) подписью: самая длинная тёмная полоса вдоль оси
   * через x подписи (для вертикальных — через y). Принимается, только если она сходится
   * с ожидаемой по приближённому масштабу: цепочка из нескольких размеров идёт одной
   * сплошной линией, и её длина — не длина одного размера.
   */
  function lineLength(gray, W, H, it, horizontal, expected) {
    var dark = function (x, y) { return x >= 0 && y >= 0 && x < W && y < H && gray[y * W + x] < 150; };
    var best = 0, span = Math.round(it.h * 2.2);
    var run = function (get, start, max) {                  // вдоль линии в обе стороны, щель до 3 px
      var gap = 0, last = start;
      for (var k = start; k >= 0 && k < max; k += this.dir) {
        if (get(k)) { last = k; gap = 0; } else if (++gap > 3) break;
      }
      return last;
    };
    for (var o = -span; o <= span; o++) {
      var fixed = Math.round(horizontal ? it.y : it.x) + o, pos = Math.round(horizontal ? it.x : it.y);
      var get = horizontal ? function (k) { return dark(k, fixed); } : function (k) { return dark(fixed, k); };
      if (!get(pos) && !get(pos - 1) && !get(pos + 1)) continue;
      var max = horizontal ? W : H;
      var lo = run.call({ dir: -1 }, get, pos, max), hi = run.call({ dir: 1 }, get, pos, max);
      var len = hi - lo;
      if (len > best && Math.abs(len / expected - 1) < 0.12) best = len;
    }
    return best;
  }

  /** Уточнение по общему размеру: линии длиннее 60 % самой большой подписи */
  function refine(c, items, ppm0) {
    var big = 0;
    items.forEach(function (i) { big = Math.max(big, +i.s); });
    var gray = grayOf(c), ks = [];
    items.forEach(function (i) {
      var mm = +i.s;
      if (mm < big * 0.6 || mm < 3000) return;
      var L = lineLength(gray, c.width, c.height, i, i.rot === 0, mm * ppm0 / 1000);
      if (L) ks.push(L / mm * 1000);
    });
    if (!ks.length) return null;
    ks.sort(function (a, b) { return a - b; });
    return ks[Math.floor(ks.length / 2)];
  }

  window.PlanOcr = {
    scale: function (c, onStage) {
      return getWorker(onStage).then(function (w) {
        if (onStage) onStage('Читаю цифры размеров');
        // Ступени: обычный размер листа → со всеми поворотами → увеличенный вдвое (мелкие
        // цифры на листах А3 и сканах). Строгий подбор — три согласованных пары, мягкий —
        // две, но сошедшиеся с точностью 4 %. Дальше ступень не идёт, как только масштаб есть.
        var found = function (items) {
          var sc = window.scaleFromDims(items);
          if (sc) return { items: items, sc: sc };
          // две пары, но подряд идущие в одной цепочке (проверка внутри scaleFromDims)
          sc = window.scaleFromDims(items, true);
          return sc ? { items: items, sc: sc } : null;
        };
        var stage = function (k, rots, label) {
          return rots.reduce(function (p, rot) {
            return p.then(function (acc) { return pass(w, c, rot, k).then(function (d) { return acc.concat(d); }); });
          }, Promise.resolve([])).then(function (items) {
            if (onStage) onStage(label);
            return items;
          });
        };
        return stage(1, [0, 90], 'Читаю цифры размеров').then(function (items) {
          var r = found(items);
          if (r) return r;
          return stage(1, [270], 'Читаю перевёрнутые размеры').then(function (d) {
            items = items.concat(d);
            r = found(items);
            if (r) return r;
            return stage(2, [0, 90, 270], 'Читаю мелкие цифры').then(function (big) {
              return found(big) || { items: big, sc: null };
            });
          });
        }).then(function (r) {
          window.PlanOcr.last = r.items;          // что прочитано — для разбора
          if (!r.sc) return null;
          var ppm = r.sc.ppm, via = 'chain', fine = null;
          try { fine = refine(c, r.items, ppm); } catch (e) { console.warn('[plan_ocr] refine:', e && e.message); }
          if (fine && Math.abs(fine / ppm - 1) < 0.15) { ppm = fine; via = 'line'; }
          return { ppm: ppm, n: r.sc.n, total: r.sc.total, via: via };
        });
      });
    }
  };
})();
