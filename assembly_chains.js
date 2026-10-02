/* assembly_chains.js — цепочки по узлам котельной: что с чем стыкуется.
 *
 * Баланс из assembly_check.js говорит «на 3/4" одна наружная резьба лишняя», но не
 * где. Здесь узел описан так, как он собирается по потоку: «патрубок котла → кран →
 * фильтр → переходник на трубу». Каждая деталь — строка сметы с её концами
 * (assemblyCheck.portsOf); у соседних деталей конец одной должен ложиться на конец
 * другой: наружная резьба — во внутреннюю или в накидную гайку того же размера.
 *
 * Что находит:
 *  - стык, который не сходится: «кран НР ↔ американка НР» (с названием обеих деталей);
 *  - детали, которых для узла нет в смете («нужен переходник ВПр-НР, в смете их 3 из 4»);
 *  - детали сметы, не попавшие ни в одну цепочку (лишние или узел ещё не описан);
 *  - цепочку, которая не доходит до нужного конца (в трубу, к патрубку бака).
 *
 * Цепочки описаны по комментариям app.js (узлы В1, Т3, змеевик) и по описаниям строк
 * раздела 2.1. Узел котла описан только для котлов с известными концами подачи и
 * обратки (Haier NeoSlim 1.x); для остальных — «не описан», а не ложный «сходится».
 *
 * Глобал: window.assemblyChains; в Node — module.exports.
 * Использование: const r = assemblyChains.run(list, assemblyCheck, filter);
 */
(function (root) {
  'use strict';

  var KIND_RU = { M: 'НР', F: 'ВР', N: 'накидная гайка', S: 'пресс-гнездо', P: 'пресс-конец', U: 'НР или ВР?' };

  function mates(a, b) {
    if (a === 'U' || b === 'U') return 'unknown';
    var T = { M: 'FN', F: 'M', N: 'M', S: 'P', P: 'S' };
    return (T[a] || '').indexOf(b) >= 0;
  }
  function endName(e) { return KIND_RU[e.kind] + (/^[SP]$/.test(e.kind) ? '' : ' ' + e.size + '"'); }

  /* Строки сметы → детали с концами. Строка с q штук — q одинаковых деталей. */
  function buildRows(list, ac, filter) {
    filter = filter || function (it) { return /^[12]\./.test(String(it.sectionTitle || it.group || '')); };
    var rows = [];
    (list || []).filter(filter).forEach(function (it) {
      var r = ac.portsOf(it);
      var proto = [];
      ((r && r.ports) || []).forEach(function (p) {
        if (p.pipe) return;
        for (var i = 0; i < (p.qty || 1); i++) proto.push({ kind: p.kind, size: String(p.size), role: p.role || '', ext: !!p.ext });
      });
      var q = Math.max(1, Math.round(Number(it.q) || 1)), units = [];
      for (var u = 0; u < q; u++) units.push({ ends: proto.map(function (e) { return { kind: e.kind, size: e.size, role: e.role, ext: e.ext, used: false }; }), claimed: false });
      rows.push({ it: it, id: String(it.originalId || it.id || ''), name: it.name, units: units, known: !!(r && r.ports), tag: it.portTag || '' });
    });
    return rows;
  }

  var RUN = function (list, ac, filter) {
    var rows = buildRows(list, ac, filter);
    var out = { chains: [], notDescribed: [], unclaimed: [], missing: [], dangling: [] };

    // ── поиск деталей ───────────────────────────────────────────────────
    var byId = function (re) { return function (row) { return re.test(row.id); }; };
    // Переходник на трубу: есть пресс-конец (или конец под трубу) и резьбовой конец нужного рода
    var pipeFit = function (kind) {
      return function (row) {
        var u = row.units[0]; if (!u) return false;
        var press = u.ends.some(function (e) { return e.kind === 'S' || e.kind === 'P'; });
        var thr = u.ends.filter(function (e) { return e.kind === kind; }).length;
        return press && thr === 1 && u.ends.length === 2 && /^(переходник|муфта)/i.test(row.name || '');
      };
    };
    function freeUnit(row, need) {
      for (var i = 0; i < row.units.length; i++) {
        var free = row.units[i].ends.filter(function (e) { return !e.used; }).length;
        if (free >= (need || 1)) return row.units[i];
      }
      return null;
    }
    function firstRow(pred, need) {
      for (var i = 0; i < rows.length; i++) if (pred(rows[i]) && freeUnit(rows[i], need || 1)) return rows[i];
      return null;
    }
    function countRows(pred) { var n = 0; rows.forEach(function (r) { if (pred(r)) n += r.units.length; }); return n; }

    var labels = {};   // label → { row, unit }

    /* Выполнить цепочку: start = { end: конец, desc } | { ref: метка } | { free: true };
       steps = [{ m: предикат, as: метка, nm: подпись }]; fin = { pipe: true } | { end } | { ref } | null */
    function runChain(name, start, steps, fin) {
      var res = { name: name, ok: true, links: [], problem: null };
      var cur = null;   // конец, от которого идём дальше: { kind, size, who }
      if (start.free) cur = null;
      else if (start.ref) {
        var L = labels[start.ref]; var e = L && L.unit.ends.filter(function (x) { return !x.used; })[0];
        if (!e) { res.ok = false; res.problem = 'у детали «' + start.ref + '» нет свободного отвода'; out.chains.push(res); return; }
        e.used = true; cur = { kind: e.kind, size: e.size, who: L.row.name + ' (отвод)' };
      } else { start.end.used = true; cur = { kind: start.end.kind, size: start.end.size, who: start.who }; }
      res.links.push(cur ? cur.who + ' [' + endName(cur) + ']' : 'вход из дома');

      for (var i = 0; i < steps.length; i++) {
        var st = steps[i], picked = null;
        var anyRow = false;
        // Берём деталь с наибольшим числом свободных концов: свежая раньше начатой,
        // иначе второй тройник ложится на первый, у которого остался один конец
        var bestFree = -1;
        for (var ri = 0; ri < rows.length; ri++) {
          var row = rows[ri]; if (!st.m(row)) continue;
          anyRow = true;
          for (var ui = 0; ui < row.units.length; ui++) {
            var un = row.units[ui];
            var cand = un.ends.filter(function (x) { return !x.used; });
            if (!cand.length || cand.length <= bestFree) continue;
            var inEnd = null, unk = false;
            for (var k = 0; k < cand.length; k++) {
              var c = cand[k];
              if (!cur) { inEnd = c; break; }
              var m = mates(cur.kind, c.kind);
              var sizeOk = /^[SP]$/.test(c.kind) || c.size === cur.size;
              if (m && sizeOk) { inEnd = c; unk = (m === 'unknown'); break; }
            }
            if (inEnd) { picked = { row: row, unit: un, inEnd: inEnd, unk: unk }; bestFree = cand.length; }
          }
        }
        if (!picked) {
          res.ok = false;
          if (!anyRow) {
            res.problem = 'нет детали «' + st.nm + '» — в смете её нет';
            out.missing.push({ chain: name, need: st.nm, reason: 'нет в смете' });
          } else {
            // Деталь есть, но свободных нужного исполнения не осталось или не стыкуется
            var any = null; for (var rj = 0; rj < rows.length && !any; rj++) if (st.m(rows[rj])) any = rows[rj];
            var haveFree = any && any.units.some(function (u) { return u.ends.some(function (e) { return !e.used; }); });
            var ends = any ? any.units[0].ends.map(function (e) { return KIND_RU[e.kind] + (/^[SP]$/.test(e.kind) ? '' : ' ' + e.size + '"'); }).join(' / ') : '';
            if (!haveFree) {
              res.problem = 'не хватает: «' + st.nm + '» — все ' + countRows(st.m) + ' шт. из сметы уже заняты другими цепочками';
              out.missing.push({ chain: name, need: st.nm, reason: 'не хватает количества (в смете ' + countRows(st.m) + ')' });
            } else {
              res.problem = 'не стыкуется: «' + cur.who + '» [' + endName(cur) + '] ↔ «' + st.nm + '» [концы: ' + ends + ']';
            }
          }
          out.chains.push(res); return;
        }
        picked.inEnd.used = true;
        var rest = picked.unit.ends.filter(function (x) { return !x.used; });
        var outEnd = rest.length ? rest[0] : null;
        // Последняя деталь ветки без продолжения (тройник, смеситель) второй конец не
        // занимает: он нужен другим цепочкам (отвод тройника, соседний вход смесителя)
        var lastOpen = (i === steps.length - 1) && !fin;
        if (outEnd && !lastOpen) outEnd.used = true;
        picked.unit.claimed = true;
        if (st.as) labels[st.as] = { row: picked.row, unit: picked.unit };
        res.links.push((picked.unk ? '? ' : '') + st.nm + ' [' + endName(picked.inEnd) + (outEnd ? ' … ' + endName(outEnd) : '') + ']');
        cur = outEnd ? { kind: outEnd.kind, size: outEnd.size, who: st.nm } : null;
        if (!outEnd && i < steps.length - 1) { res.ok = false; res.problem = '«' + st.nm + '»: свободного конца для следующей детали нет'; out.chains.push(res); return; }
      }

      // Концовка цепочки
      if (fin && fin.pipe) {
        if (!cur || !/^[SP]$/.test(cur.kind)) {
          res.ok = false; res.problem = 'цепочка не доходит до трубы: последний конец «' + (cur ? cur.who + ' [' + endName(cur) + ']' : '—') + '» — резьба, а не пресс-гнездо';
        } else res.links.push('труба');
      } else if (fin && (fin.ref || fin.end)) {
        var fe = null, fwho = '';
        if (fin.ref) { var FL = labels[fin.ref]; fe = FL && FL.unit.ends.filter(function (x) { return !x.used; })[0]; fwho = fin.ref; }
        else { fe = fin.end; fwho = fin.who; }
        if (!fe) { res.ok = false; res.problem = 'на конце цепочки нет свободного отвода «' + fwho + '»'; }
        else {
          fe.used = true;
          var mm = cur ? mates(cur.kind, fe.kind) : true;
          var sz = !cur || /^[SP]$/.test(fe.kind) || cur.size === fe.size;
          if (!mm || !sz) { res.ok = false; res.problem = 'не стыкуется на конце: «' + cur.who + '» [' + endName(cur) + '] ↔ «' + fwho + '» [' + endName(fe) + ']'; }
          else res.links.push(fwho + ' [' + endName(fe) + ']');
        }
      }
      out.chains.push(res);
    }

    // ── описание узлов ──────────────────────────────────────────────────
    var tank = null;
    rows.forEach(function (r) { if (!tank && !/^Котёл/i.test(r.name || '') && r.units[0] && r.units[0].ends.some(function (e) { return e.role === 'вход ХВС'; }) && r.units[0].ends.some(function (e) { return e.role === 'змеевик'; })) tank = r; });
    var endByRole = function (row, re, size) {
      var u = row && row.units[0]; if (!u) return null;
      return u.ends.filter(function (e) { return re.test(e.role) && !e.used && (!size || e.size === size); })[0] || null;
    };
    var hasId = function (re) { return rows.some(function (r) { return re.test(r.id); }); };

    // Котлы с известными концами патрубков: газовый Haier (подача, обратка, змеевик) и
    // электрокотёл STATUS (подача и обратка, оба НР). Обвязка каждого — пара «американка +
    // кран» на подаче и обратке, на обратке за краном фильтр (app.js, обвязка котла).
    // В каскаде (больше одного котла) на каждый котёл ещё обратный клапан SVC-0011 (ВР/ВР)
    // за краном и ниппель между ним и переходником трубы.
    var boilers = rows.filter(function (r) {
      var u = r.units[0]; if (!u) return false;
      return u.ends.some(function (e) { return /подача отопления/.test(e.role); }) ||
             u.ends.some(function (e) { return e.role === 'подача и обратка' && e.kind === 'M'; });
    });
    var cascade = rows.filter(function (r) { return /^Котёл/i.test(r.name || '') && r.units[0] && r.units[0].ends.length; }).length > 1 || countRows(byId(/^SVC-0011/)) > 1;
    var un34 = { m: byId(/^SFT-0041-000034/), nm: 'американка 3/4" ВР/НР' };
    var crane34 = { m: byId(/^SVB-0004-200020/), nm: 'кран шаровой ВР/НР 3/4"' };
    var chk34 = { m: byId(/^SVC-0011/), nm: 'обратный клапан каскада SVC-0011 (ВР/ВР)' };
    var chkNip = { m: byId(/^SFT-0004-003434/), nm: 'ниппель 3/4" НР (за обратным клапаном)' };
    var filt = { m: byId(/^RFW-0080-256620/), nm: 'фильтр-шламоотделитель RFW-0080' };
    var fitF = { m: pipeFit('F'), nm: 'переходник ВПр-ВР на трубу' };
    var fitM = { m: pipeFit('M'), nm: 'переходник ВПр-НР на трубу' };
    boilers.forEach(function (bo) {
      var bn = bo.name, copies = bo.units.length;
      for (var bi = 0; bi < copies; bi++) {
        var haier = bo.units[bi].ends.some(function (e) { return /подача отопления/.test(e.role); });
        function pick(re) { return bo.units[bi].ends.filter(function (e) { return re.test(e.role) && !e.used; })[0] || null; }
        var sup = haier ? pick(/подача отопления/) : pick(/^подача и обратка$/);
        var hasFilter = hasId(/^RFW-0080/);
        var supSteps = [un34, crane34];
        if (cascade && hasId(/^SVC-0011/)) { supSteps.push(chk34); supSteps.push(chkNip); }
        supSteps.push(fitF);
        if (sup) runChain(bn + ': подача отопления', { end: sup, who: bn + ' (подача)' }, supSteps, { pipe: true });
        // у электрокотла патрубки подачи и обратки одной роли: второй берём после первого
        var ret = haier ? pick(/обратка отопления/) : pick(/^подача и обратка$/);
        if (ret) runChain(bn + ': обратка отопления' + (hasFilter ? ' (с фильтром)' : ''), { end: ret, who: bn + ' (обратка)' }, hasFilter ? [un34, crane34, filt, fitF] : [un34, crane34, fitF], { pipe: true });
        if (haier) {
          var coilP = pick(/змеевик/);
          if (coilP) runChain(bn + ': подача в змеевик бойлера', { end: coilP, who: bn + ' (змеевик)' }, [un34, fitF], { pipe: true });
        }
      }
    });
    var boilerOther = null;
    rows.forEach(function (r) { if (!boilerOther && /^Котёл/i.test(r.name || '') && boilers.indexOf(r) < 0 && r.units[0] && r.units[0].ends.length) boilerOther = r; });
    if (boilerOther) out.notDescribed.push('узел котла «' + boilerOther.name + '»: концы подачи/обратки не заданы паспортом — цепочки не строятся');

    // Сепаратор воздуха и бак отопления: на трубу через ВПр-НР
    rows.forEach(function (r) {
      if (/^RFW-0070/.test(r.id)) {
        r.units.forEach(function () {
          runChain('Сепаратор воздуха на трубе', { free: true }, [{ m: pipeFit('M'), nm: 'переходник ВПр-НР на трубу' }, { m: byId(/^RFW-0070/), nm: 'сепаратор воздуха ' + r.name.replace(/.*(\d\/\d|\d)"$/, '$1"') }, { m: pipeFit('M'), nm: 'переходник ВПр-НР на трубу' }], { pipe: true });
        });
      }
    });
    var htank = firstRow(function (r) { return /^STH-/.test(r.id); });
    if (htank) {
      var he = htank.units[0].ends.filter(function (e) { return !e.used; })[0];
      runChain('Бак отопления: на трубу', { end: he, who: htank.name }, [{ m: byId(/^SVS-0008/), nm: 'узел подключения бака SVS-0008' }, { m: pipeFit('M'), nm: 'переходник ВПр-НР на трубу' }], { pipe: true });
    }

    // Бойлер косвенного нагрева: В1, Т3, змеевик
    if (tank) {
      var tcold = endByRole(tank, /^вход ХВС$/), tdhw = endByRole(tank, /^выход ГВС$/), tsafe = endByRole(tank, /предохранительный/);
      var coils = tank.units[0].ends.filter(function (e) { return /змеевик/.test(e.role) && !e.used; });
      // Змеевик: бойлер → американка → кран → [ниппель] → переходник на трубу
      var nip = { m: byId(/^SFT-0004-000134/), nm: 'ниппель 1"×3/4" НР' };
      var femNip = { m: byId(/^SFT-0004-003434/), nm: 'ниппель 3/4" НР (на ВР-патрубок бойлера)' };
      var hasCoilNip = hasId(/^SFT-0004-000134/);
      coils.forEach(function (ce, i) {
        var coilSteps = [];
        if (ce.kind === 'F') coilSteps.push(femNip);
        coilSteps.push({ m: byId(/^SFT-0041-0000(01|34)/), nm: 'американка ВР/НР на змеевике' });
        coilSteps.push({ m: byId(/^SVB-0002-2000/), nm: 'кран шаровой на змеевике' });
        if (ce.size === '1' && hasCoilNip) coilSteps.push(nip);
        // кран ВР/ВР отдаёт ВР: на трубу — переходник с НР (прямо на размер крана или после ниппеля)
        coilSteps.push({ m: pipeFit(ce.size === '1' && hasCoilNip ? 'F' : 'M'), nm: 'переходник на трубу' });
        runChain('Змеевик бойлера, патрубок ' + (i + 1), { end: ce, who: tank.name + ' (змеевик)' }, coilSteps, { pipe: true });
      });

      // В1: вход ХВС. От дома к бойлеру.
      // Тройники 3/4" ВР: один на подмес (если есть смеситель), второй — врезка бака ГВС
      // (если у бойлера нет своего патрубка под предохранительный клапан). Строки одного
      // артикула склеены под ключом первой, поэтому считаем штуки, а не ищем по метке.
      var teeCount = countRows(byId(/^SFT-0020-000034/));
      var needMixTee = teeCount > 0 && !!firstRow(function (r) { return /^SVM-0/.test(r.id); });
      var tankTee = !tsafe && teeCount - (needMixTee ? 1 : 0) > 0;
      var nipS = { m: byId(/^SFT-0004-003434/), nm: 'ниппель 3/4" НР' };
      var b1 = [{ m: byId(/^SVB-0006-200020/), nm: 'кран шаровой 3/4" НР/НР (вход ХВС)' }];
      if (needMixTee) { b1.push({ m: byId(/^SFT-0020-000034/), nm: 'тройник 3/4" ВР (подмес)', as: 'tee_mix' }); b1.push(nipS); }
      b1.push({ m: byId(/^SVC-0012-000020/), nm: 'обратный клапан 3/4" ВР/ВР' });
      b1.push(nipS);
      if (tankTee) { b1.push({ m: byId(/^SFT-0020-000034/), nm: 'тройник 3/4" ВР (бак ГВС)', as: 'tee_tank' }); b1.push(nipS); }
      b1.push({ m: byId(/^SFT-0031-000034/), nm: 'крестовина 3/4" ВР', as: 'cross' });
      b1.push({ m: byId(/^SFT-0041-000034/), nm: 'американка 3/4" ВР/НР' });
      if (tcold && tcold.size === '1') b1.push({ m: byId(/^SFT-0007-000134/), nm: 'муфта ВР 1"×НР 3/4"' });
      runChain('Вход ХВС (В1): от дома к бойлеру', { free: true }, b1, { end: tcold, who: tank.name + ' (ХВС)' });

      if (tsafe) runChain('В1: предохранительный клапан (патрубок бойлера)', { end: tsafe, who: tank.name + ' (предохранительный)' }, [{ m: byId(/^RVS-0003/), nm: 'клапан предохранительный 6 бар' }], null);
      if (labels.cross) {
        if (!tsafe) runChain('В1: предохранительный клапан', { ref: 'cross' }, [{ m: byId(/^SFT-0004-003412/), nm: 'ниппель 3/4"×1/2" НР' }, { m: byId(/^RVS-0003/), nm: 'клапан предохранительный 6 бар' }], null);
        runChain('В1: дренажный кран', { ref: 'cross' }, [{ m: byId(/^SVB-0006-200020/), nm: 'кран шаровой 3/4" НР/НР (дренаж)' }], null);
      }
      var gt = firstRow(function (r) { return /^STW-/.test(r.id); });
      if (gt && (labels.tee_tank || labels.cross)) {
        var ge = gt.units[0].ends.filter(function (e) { return !e.used; })[0];
        runChain('В1: бак ГВС', { end: ge, who: gt.name }, [{ m: byId(/^SVS-0008/), nm: 'узел подключения бака SVS-0008' }, nipS], { ref: labels.tee_tank ? 'tee_tank' : 'cross' });
      }

      // Т3: выход ГВС и термосмеситель
      var mixV = firstRow(function (r) { return /^SVM-0/.test(r.id); });
      if (mixV && tdhw) {
        var hot = [];
        if (tdhw.kind === 'F') hot.push({ m: byId(/^SFT-0004-003434/), nm: 'ниппель 3/4" НР (на ВР-патрубок бойлера)' });
        hot.push({ m: byId(/^SFT-0041-000034/), nm: 'американка 3/4" ВР/НР (выход ГВС)' });
        if (tdhw.size === '1') hot.push({ m: byId(/^SFT-0007-000134/), nm: 'муфта ВР 1"×НР 3/4"' });
        hot.push({ m: byId(/^SVB-0009-000020/), nm: 'кран 3/4" ВР/накидная гайка (горячий вход)' });
        hot.push({ m: byId(/^SVM-0/), nm: 'термостатический смесительный клапан', as: 'mixv' });
        runChain('Т3: выход ГВС → термосмеситель', { end: tdhw, who: tank.name + ' (выход ГВС)' }, hot, null);
        if (labels.tee_mix) runChain('Т3: холодный подмес', { ref: 'tee_mix' }, [nipS, { m: byId(/^SVC-0012-000020/), nm: 'обратный клапан 3/4" ВР/ВР (подмес)' }, { m: byId(/^SVB-1009-000020/), nm: 'кран НР/накидная гайка (холодный вход)' }], { ref: 'mixv' });
        if (labels.mixv) runChain('Т3: выход термосмесителя в разводку', { ref: 'mixv' }, [{ m: byId(/^SVB-1009-000020/), nm: 'кран НР/накидная гайка (выход)' }], null);
      }
    }

    // Т4: рециркуляция ГВС, от разводки дома к бойлеру (app.js, «Узел Т4 по потоку»)
    if (tank && firstRow(function (r) { return r.id === 'dhw_recirc_pump'; })) {
      var trec = tank.units[0].ends.filter(function (e) { return /^рециркуляция/.test(e.role) && !e.used; })[0];
      if (trec) {
        var t4 = [{ m: byId(/^SVB-0002-200020/), nm: 'кран 3/4" ВР/ВР (у разводки дома)' },
          { m: byId(/^SFT-0004-003434/), nm: 'ниппель 3/4" НР' },
          { m: byId(/^SVC-0012-000020/), nm: 'обратный клапан 3/4" ВР/ВР' },
          { m: byId(/^SFT-0004-003412/), nm: 'ниппель 3/4"×1/2" НР' },
          { m: byId(/^dhw_recirc_pump$/), nm: 'насос рециркуляции' },
          { m: byId(/^SFT-0004-003412/), nm: 'ниппель 3/4"×1/2" НР' },
          { m: byId(/^SVB-0002-200020/), nm: 'кран 3/4" ВР/ВР (у бойлера)' },
          { m: byId(/^SFT-0041-000034/), nm: 'американка 3/4" ВР/НР' }];
        if (trec.size === '1') t4.push({ m: byId(/^SFT-0007-000134/), nm: 'муфта ВР 1"×НР 3/4"' });
        if (trec.kind === 'F') t4.push({ m: byId(/^SFT-0004-003434/), nm: 'ниппель 3/4" НР (на ВР-патрубок бойлера)' });
        runChain('Т4: рециркуляция ГВС, от дома к бойлеру', { free: true }, t4, { end: trec, who: tank.name + ' (рециркуляция)' });
      }
    }

    // Детали, ни разу не попавшие в цепочку (только резьбовые, с известными концами)
    rows.forEach(function (r) {
      if (!r.known || !r.units[0].ends.length) return;
      var thread = r.units[0].ends.some(function (e) { return /^[MFN]$/.test(e.kind); });
      if (!thread) return;
      var n = r.units.filter(function (u) { return !u.claimed && !u.ends.some(function (e) { return e.used; }); }).length;
      if (n) out.unclaimed.push({ id: r.id, name: r.name, n: n, of: r.units.length });
    });
    // Резьбовые концы деталей, попавших в цепочки, но оставшиеся без пары. Уходящие из
    // котельной (ext) не считаем: у них пары и не должно быть.
    var dang = {};
    rows.forEach(function (r) {
      r.units.forEach(function (u) {
        if (!u.ends.some(function (e) { return e.used; })) return;
        u.ends.forEach(function (e) {
          if (e.used || e.ext || !/^[MFNU]$/.test(e.kind)) return;
          var key = r.name + ' — ' + KIND_RU[e.kind] + ' ' + e.size + '"' + (e.role ? ' (' + e.role + ')' : '');
          dang[key] = (dang[key] || 0) + 1;
        });
      });
    });
    Object.keys(dang).forEach(function (k) { out.dangling.push(dang[k] + '× ' + k); });
    return out;
  }

  var api = { run: RUN, KIND_RU: KIND_RU };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.assemblyChains = api;
})(typeof window !== 'undefined' ? window : this);
