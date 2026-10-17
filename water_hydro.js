/* water_hydro.js — проверка гидравлики водоснабжения: от скважинного насоса до прибора.
 *
 * Зачем. Подбор скважинного насоса (раздел 7 сметы) считает ОДНУ точку: расход дома,
 * глубина, трасса и «30 м давления в доме». Что останется у душа на втором этаже
 * после ввода, счётчика, фильтра и 12 м трубы 16 мм, он не знает — 30 м это допущение,
 * а не расчёт. Здесь та же цепочка пройдена по ступеням: напор насоса на расчётном
 * расходе → подъём → труба в скважине и траншее → узел ввода → коллектор → линия
 * до каждого прибора. У прибора сравниваем давление с тем, что ему нужно.
 *
 * Чего здесь НЕТ: своих исходных чисел. Насос, диаметры, длины, приборы и состав узла
 * приходят готовыми из app.buildWaterHydroData() — оттуда же, откуда собрана смета, поэтому
 * проверка разойтись со сметой не может. Смету этот файл не меняет.
 *
 * Что здесь оценка, а не норма. Расходы приборов — те же веса, что у подбора насоса.
 * Коэффициенты местных сопротивлений и Kv узла ввода — инженерные ориентиры по практике,
 * они лежат в LOCAL и KV одним списком и правятся в одном месте. Минимальный напор у
 * прибора (FIXTURES.need) — тоже практика; паспорт конкретного смесителя или машины
 * может требовать больше. Ссылаться на СП здесь нельзя.
 *
 * Напор везде в метрах водяного столба, как в остальном калькуляторе (1 бар ≈ 10 м).
 * Расход — м³/ч, диаметры — внутренние, м.
 *
 * Глобал: window.waterHydro = { evaluate, pipeLoss, headAt, ... }; в Node — module.exports.
 */
(function (root) {
  'use strict';

  var G = 9.81;
  var HEAD_BAR = 10;            // м вод. ст. на бар — так считает весь калькулятор
  var RESERVE = 1.15;           // «впритык» — запас давления у прибора меньше 15 %
  var NU_COLD = 1.3e-6;         // вязкость воды 10 °C, м²/с
  var NU_HOT = 0.5e-6;          // 55–60 °C
  var K_MM = 0.007;             // эквивалентная шероховатость ПНД / PEX / металлопласта, мм

  // Давление, которое держит автоматика по давлению (инвертор, реле) и редуктор, когда
  // заводская уставка неизвестна. Настраивается при пуске; 3 бар — типовое для дома.
  var SET_BAR = 3.0;
  var STATIC_WARN_BAR = 5;      // выше — «впритык» (гибкие подводки, картриджи, бойлер на 6 бар)
  var STATIC_FAIL_BAR = 6;      // предохранительный клапан бойлера

  var V_LIMIT = { well: 1.5, node: 2.0, branch: 2.0 };   // м/с — ориентир практики

  // Приборы: расход м³/ч (те же веса, что у подбора насоса, app.waterNodeFlow), минимальный
  // напор у прибора, м, и доля горячей линии в смешанном расходе.
  var FIXTURES = {
    toilet: { title: 'Унитаз',              q: 0.10, need: 3 },
    basin:  { title: 'Умывальник',          q: 0.15, need: 3,  mixer: true },
    shower: { title: 'Душ',                 q: 0.30, need: 10, mixer: true },
    bath:   { title: 'Ванна',               q: 0.40, need: 5,  mixer: true },
    wash:   { title: 'Стиральная машина',   q: 0.20, need: 5 },
    dish:   { title: 'Посудомоечная машина', q: 0.20, need: 5 },
    bidet:  { title: 'Биде',                q: 0.15, need: 3,  mixer: true }
  };
  var MIX_LINE = 0.6;           // доля полного расхода прибора на каждой из двух линий смесителя

  // Местные сопротивления ζ (на скорость в своём сечении) — ориентиры практики.
  var LOCAL = {
    well:     4.0,   // оголовок, два угольника ПНД, тройник на гидроаккумулятор
    nodePipe: 6.0,   // фитинги самого узла ввода (3/4")
    ball:     0.5,   // шаровой кран
    leak:     0.5,   // кран защиты от протечки
    collector: 2.0,  // тройник/врезка гребёнки
    branch:   8.4,   // линия до прибора: резьбовой угольник + пресс/аксиальная посадка + 2 колена
    hotManifold: 2.0
  };
  // Kv, м³/ч при 1 бар: потеря H = 10·(Q/Kv)² м.
  var KV = {
    check32:  25,    // обратный клапан 1 1/4" с металлическим седлом
    mesh:     8,     // фильтр сетчатый косой 3/4"
    fine:     4.4,   // колба Big Blue с картриджем: 2,4 м³/ч — предел узла, там ~0,3 бар
    meter:    5,     // счётчик ВСКМ-20: потеря не более 1 бар на Qmax 5 м³/ч (класс по ГОСТ Р 50193)
    reducerOpen: 3.5,// редуктор, когда не успевает держать уставку (открыт полностью)
    boiler:   5      // водонагреватель / бойлер, подключение 3/4"
  };

  function verdictOf(need, have, reserve) {
    if (!(need > 0) || have == null || !isFinite(have)) return 'unknown';
    var k = have / need;
    if (k < 1) return 'fail';
    if (k < (reserve || RESERVE)) return 'tight';
    return 'ok';
  }
  var RANK = { ok: 0, unknown: 1, tight: 2, fail: 3 };
  function worse(a, b) { return RANK[b] > RANK[a] ? b : a; }

  function velocity(q, d) { return (q / 3600) / (Math.PI * d * d / 4); }

  // Трение в трубе по Дарси. Ламинарно — 64/Re; дальше гладкая труба по Блазиусу
  // (так же считает app.wellLineLoss), на Re > 1e5 — Свами–Джейн, где Блазиус занижает.
  function pipeLoss(q, d, len, nu, kMm) {
    if (!(d > 0) || !(len > 0) || !(q > 0)) return { v: q > 0 && d > 0 ? velocity(q, d) : 0, hf: 0, Re: 0, lam: 0 };
    var v = velocity(q, d);
    var Re = v * d / (nu || NU_COLD);
    var lam;
    if (Re < 2300) lam = 64 / Math.max(Re, 1);
    else if (Re < 1e5) lam = 0.3164 / Math.pow(Re, 0.25);
    else {
      var k = ((kMm == null ? K_MM : kMm) / 1000) / d;
      var t = Math.log10(k / 3.7 + 5.74 / Math.pow(Re, 0.9));
      lam = 0.25 / (t * t);
    }
    return { v: v, hf: lam * (len / d) * v * v / (2 * G), Re: Re, lam: lam };
  }
  function localLoss(q, d, zeta) {
    if (!(q > 0) || !(d > 0) || !(zeta > 0)) return 0;
    var v = velocity(q, d);
    return zeta * v * v / (2 * G);
  }
  var D34 = 0.02;   // внутренний диаметр узла 3/4" — к нему приведены KV
  // Kv позиции другого размера: пропускная способность растёт как сечение, d²
  function kvAt(kv, d) { return kv * Math.pow((d > 0 ? d : D34) / D34, 2); }
  // Внезапное изменение сечения между узлом и коллектором: расширение (1−β)², сужение 0,5·(1−β), на скорости в малом сечении
  function stepLoss(q, d1, d2) {
    if (!(q > 0) || !(d1 > 0) || !(d2 > 0) || d1 === d2) return 0;
    var ds = Math.min(d1, d2), dl = Math.max(d1, d2), beta = (ds * ds) / (dl * dl);
    var k = d2 > d1 ? Math.pow(1 - beta, 2) : 0.5 * (1 - beta);
    return k * Math.pow(velocity(q, ds), 2) / (2 * G);
  }
  function kvLoss(q, kv) { return (q > 0 && kv > 0) ? HEAD_BAR * Math.pow(q / kv, 2) : 0; }

  // Напор насоса по паспортной характеристике: линейно между точками; правее последней
  // точки насос не работает (0) — как в подборе насоса (app, раздел 7).
  function headAt(curve, flow) {
    if (!curve || !curve.length) return 0;
    if (flow <= curve[0][0]) return curve[0][1];
    for (var i = 1; i < curve.length; i++) {
      if (flow <= curve[i][0]) {
        var a = curve[i - 1], b = curve[i];
        return a[1] + (b[1] - a[1]) * (flow - a[0]) / (b[0] - a[0]);
      }
    }
    return 0;
  }

  function fmt(v, n) { return (v == null || !isFinite(v)) ? '—' : v.toFixed(n == null ? 1 : n).replace('.', ','); }

  /**
   * data = {
   *   pump:   { name, curve, qMax },
   *   depth, dist, inlet (м трубы от трассы до узла, по умолчанию 5), floorsH (м),
   *   wellPipe: { od, wall, dIn },        // труба в скважине и траншее
   *   flows:  { design, peak },            // м³/ч: расчётный (как в подборе насоса) и сумма приборов
   *   control: 'flow' | 'pressure',        // автоматика по протоку или по давлению
   *   node:   { dIn, len, absent, sizes: { mesh, fine, meter, reducer } (внутр. диаметр позиции, м; нет — 3/4"), devices: { reducer, meter, filter: 'coarse'|'fine', leak } },
   *   collector: { cold, hot } — внутренний диаметр входа коллектора, м (нет — как у узла),
   *   branch: { dIn, od, wall, label },
   *   zones:  [{ id, name, dist, points: [{ type, cold, hot }] }]
   * }
   * Городская вода: вместо pump — mains: { H } (давление в сети под расходом, м); скважинных ступеней нет.
   * Возвращает { scenarios: {design, peak}, fixtures, zones, static, pump, flags, verdict, counts, worst }.
   */
  function evaluate(data, opts) {
    opts = opts || {};
    var reserve = opts.reserve || RESERVE;
    var d = data;
    var pump = d.pump || {};
    var depth = +d.depth || 0, dist = +d.dist || 0, inletLen = d.inlet == null ? 5 : +d.inlet;
    var floorsH = +d.floorsH || 0;
    var wp = d.wellPipe || { dIn: 0.026, od: 32, wall: 3 };
    var node = d.node || { dIn: 0.02, len: 3, devices: {} };
    var dev = node.devices || {};
    var sz = node.sizes || {};
    var szTag = function (v) { return (v > 0 && Math.abs(v - D34) > 1e-6) ? ' ' + fmt(v * 1000, 0) + ' мм' : ''; };
    var pressureCtl = d.control === 'pressure';
    var setH = SET_BAR * HEAD_BAR;
    var hasZones = (d.zones || []).length > 0;
    var mains = d.mains || null;   // { H } — городская вода: давление в сети вместо насоса

    // Расход горячей линии: доля горячей воды в смешанном расходе приборов
    var sumQ = 0, sumHot = 0;
    (d.zones || []).forEach(function (z) {
      (z.points || []).forEach(function (p) {
        var f = FIXTURES[p.type]; if (!f) return;
        sumQ += f.q * ((p.cold || 0) + 0);
        if (f.mixer || p.hot) sumHot += f.q * MIX_LINE * (p.hot || 0);
      });
    });

    /* ---- общий путь до коллектора на расходе Q ---- */
    function trunk(Q) {
      var st = [];
      var H = headAt(pump.curve, Q);
      var out = { Q: Q, pumpHead: H, stages: st };
      function push(id, grp, title, dH, extra) {
        var before = H; H -= dH;
        var s = { id: id, group: grp, title: title, dH: dH, H: H, before: before };
        if (extra) for (var k in extra) s[k] = extra[k];
        st.push(s);
      }
      if (mains) { H = mains.H; out.pumpHead = H; }
      st.push({ id: 'pump', group: 'pump', title: mains ? 'Давление в сети ' + fmt(mains.H / HEAD_BAR, 1) + ' бар' : 'Насос ' + (pump.name || '') + ' на ' + fmt(Q, 2) + ' м³/ч', dH: 0, H: H, before: H, gain: H });
      var pl = { v: 0 };
      if (!mains) {
      push('lift', 'well', 'Подъём воды с глубины установки ' + depth + ' м', depth);
      pl = pipeLoss(Q, wp.dIn, depth, NU_COLD);
      push('well_pipe', 'well', 'Труба ' + wp.od + '×' + wp.wall + ' в скважине, ' + depth + ' м', pl.hf, { v: pl.v, len: depth, vLimit: V_LIMIT.well });
      push('well_valve', 'well', 'Обратный клапан и фитинги скважины', kvLoss(Q, KV.check32) + localLoss(Q, wp.dIn, LOCAL.well));
      var pt = pipeLoss(Q, wp.dIn, dist, NU_COLD);
      push('trench', 'well', 'Труба ' + wp.od + '×' + wp.wall + ' в траншее, ' + dist + ' м', pt.hf, { v: pt.v, len: dist, vLimit: V_LIMIT.well });
      var pi = pipeLoss(Q, wp.dIn, inletLen, NU_COLD);
      push('inlet', 'well', 'Ввод в дом до автоматики, ' + inletLen + ' м', pi.hf, { v: pi.v, len: inletLen, vLimit: V_LIMIT.well });
      }
      if (!mains && pressureCtl && H > setH) push('auto', 'node', 'Автоматика держит уставку ' + SET_BAR + ' бар', H - setH);

      var dn = node.dIn || 0.02;
      var pn = { v: velocity(Q, dn) };
      // Узла ввода в смете может не быть (waterInput выключен): тогда вода идёт сразу на коллектор
      if (!node.absent) {
        pn = pipeLoss(Q, dn, node.len || 3, NU_COLD);
        push('node_pipe', 'node', 'Узел ввода: труба и фитинги', pn.hf + localLoss(Q, dn, LOCAL.nodePipe), { v: pn.v, len: node.len || 3, vLimit: V_LIMIT.node });
        push('node_valves', 'node', 'Шаровые краны узла', localLoss(Q, dn, 2 * LOCAL.ball));
        if (dev.leak) push('node_leak', 'node', 'Кран защиты от протечки', localLoss(Q, dn, LOCAL.leak));
        push('node_mesh', 'node', 'Фильтр грубой очистки' + szTag(sz.mesh), kvLoss(Q, kvAt(KV.mesh, sz.mesh)));
        if (dev.filter === 'fine') push('node_filter', 'node', 'Колба тонкой очистки' + szTag(sz.fine), kvLoss(Q, kvAt(KV.fine, sz.fine)));
        if (dev.meter) push('node_meter', 'node', 'Счётчик воды' + szTag(sz.meter), kvLoss(Q, kvAt(KV.meter, sz.meter)));
      }
      if (!node.absent && dev.reducer) {
        // Редуктор держит уставку, пока на входе есть запас хотя бы 5 м; иначе открыт полностью
        if (H >= setH + 5) push('node_reducer', 'node', 'Редуктор давления держит ' + SET_BAR + ' бар', H - setH, { regulated: true });
        else push('node_reducer', 'node', 'Редуктор давления (открыт полностью, уставку не держит)', kvLoss(Q, kvAt(KV.reducerOpen, sz.reducer)), { regulated: false });
      }
      var dc = (d.collector && d.collector.cold) || dn;
      push('collector', 'node', 'Коллектор водоснабжения' + (dc !== dn ? ' (вход ' + fmt(dc * 1000, 0) + ' мм, узел ' + fmt(dn * 1000, 0) + ' мм)' : ''), localLoss(Q, dc, LOCAL.collector) + stepLoss(Q, dn, dc));
      out.Hcoll = H;
      out.v = { well: pl.v, node: pn.v };
      return out;
    }

    /* ---- линия до прибора от коллектора ---- */
    var br = d.branch || { dIn: 0.0116 };
    function branchLine(Hcoll, zone, p, line, Qtrunk, Qhot, Qline) {
      var nu = line === 'hot' ? NU_HOT : NU_COLD;
      var H = Hcoll, steps = [];
      var len = (zone.dist || 0) * 1.1;
      var bl = pipeLoss(Qline, br.dIn, len, nu);
      // Этаж зоны: 1 — на отметке ввода, 2 — выше на floorsH; не задан — считаем наверху (запас)
      var h = (zone.level === 1) ? 0 : floorsH;
      var parts = [];
      if (line === 'hot') {
        var dh = (d.collector && d.collector.hot) || node.dIn || 0.02;
        var bo = kvLoss(Qhot, KV.boiler) + localLoss(Qhot, dh, LOCAL.hotManifold) + stepLoss(Qhot, node.dIn || 0.02, dh);
        H -= bo; parts.push({ title: 'Водонагреватель и гребёнка ГВС', dH: bo });
      }
      H -= h; if (h > 0) parts.push({ title: 'Высота прибора над вводом ' + h + ' м', dH: h });
      H -= bl.hf; parts.push({ title: 'Труба ' + (br.label || '') + ' ' + fmt(len, 1) + ' м', dH: bl.hf, v: bl.v });
      var bz = localLoss(Qline, br.dIn, LOCAL.branch);
      H -= bz; parts.push({ title: 'Фитинги линии (водорозетка, колена)', dH: bz });
      return { H: H, v: bl.v, len: len, parts: parts };
    }

    function scenario(Q, label) {
      var t = trunk(Q);
      var hotShare = sumQ > 0 ? Math.min(1, sumHot / sumQ) : 0;
      var Qhot = Q * hotShare;
      var rows = [];
      (d.zones || []).forEach(function (z) {
        (z.points || []).forEach(function (p) {
          var f = FIXTURES[p.type]; if (!f) return;
          [['cold', p.cold || 0], ['hot', p.hot || 0]].forEach(function (ln) {
            if (!ln[1]) return;
            var mixed = f.mixer || (p.hot > 0 && p.cold > 0);
            var qLine = f.q * (mixed ? MIX_LINE : 1);
            var b = branchLine(t.Hcoll, z, p, ln[0], Q, Qhot, qLine);
            var vd = verdictOf(f.need, b.H, reserve);
            var flags = [];
            if (b.v > V_LIMIT.branch) flags.push('скорость в линии ' + fmt(b.v, 2) + ' м/с выше ориентира ' + fmt(V_LIMIT.branch, 1));
            rows.push({
              zone: z.name, zoneId: z.id, type: p.type, title: f.title, line: ln[0], count: ln[1],
              q: qLine, len: b.len, v: b.v, need: f.need, have: b.H, k: f.need > 0 ? b.H / f.need : null,
              verdict: vd, flags: flags, parts: b.parts
            });
          });
        });
      });
      return { label: label, Q: Q, trunk: t, hotQ: Qhot, rows: rows };
    }

    var design = scenario(d.flows.design, 'расчётный расход');
    var peak = (d.flows.peak > d.flows.design * 1.02) ? scenario(d.flows.peak, 'все приборы сразу') : null;

    /* ---- давление при закрытых кранах ---- */
    var H0 = mains ? mains.H : headAt(pump.curve, 0) - depth;
    var capNote = '';
    if (!mains && pressureCtl && H0 > setH) { H0 = setH; capNote = 'автоматика по давлению'; }
    if (!node.absent && dev.reducer && H0 > setH) { H0 = setH; capNote = 'редуктор'; }
    var hMaxFix = Math.max(0, H0 - 0);   // у самого нижнего прибора — на отметке ввода
    var stat = {
      H: hMaxFix, bar: hMaxFix / HEAD_BAR, capped: !!capNote, capNote: capNote,
      verdict: hMaxFix / HEAD_BAR > STATIC_FAIL_BAR ? 'fail' : (hMaxFix / HEAD_BAR > STATIC_WARN_BAR ? 'tight' : 'ok')
    };
    // Даже без расхода воды до приборов не доходит: насос не поднимает её на высоту
    if (hMaxFix < 5) stat.verdict = 'fail';

    /* ---- рабочая точка насоса ---- */
    var curve0 = mains ? mains.H : (pump.curve && pump.curve.length ? pump.curve[0][1] : 0);
    var Qd = d.flows.design;
    var pHead = design.trunk.pumpHead;
    var pumpInfo = {
      name: mains ? 'Городская сеть' : pump.name, Q: Qd, head: pHead, headMax: curve0, qMax: pump.qMax, mains: !!mains,
      outOfRange: !mains && pump.qMax != null && Qd > pump.qMax,
      tail: !mains && curve0 > 0 && (pHead < 0.35 * curve0 || (pump.qMax && Qd > 0.9 * pump.qMax))
    };

    /* ---- сводка ---- */
    var flags = [];
    // Скорость выше ориентира — справка (info); заметно выше (на четверть) — «впритык»: шум, потери, износ
    var velFlag = function (id, v, lim, text) {
      if (v > lim) flags.push({ id: id, level: v > lim * 1.25 ? 'tight' : 'info', text: text });
    };
    var vw = design.trunk.v.well;
    if (!mains) velFlag('well_v', vw, V_LIMIT.well, 'Скорость в трубе ' + wp.od + '×' + wp.wall + ' — ' + fmt(vw, 2) + ' м/с при расчётном расходе (ориентир ' + fmt(V_LIMIT.well, 1) + ').');
    if (!node.absent) velFlag('node_v', design.trunk.v.node, V_LIMIT.node, 'Скорость в узле ввода — ' + fmt(design.trunk.v.node, 2) + ' м/с (ориентир ' + fmt(V_LIMIT.node, 1) + '): шум и потери, ввод стоит делать на 1″.');
    if (pumpInfo.outOfRange) flags.push({ id: 'pump_q', level: 'fail', text: 'Расчётный расход ' + fmt(Qd, 2) + ' м³/ч больше предельного расхода насоса ' + fmt(pump.qMax, 1) + ' м³/ч.' });
    else if (pumpInfo.tail) flags.push({ id: 'pump_tail', level: 'tight', text: 'Рабочая точка насоса у края характеристики: ' + fmt(pHead, 0) + ' м из ' + fmt(curve0, 0) + ' м при нуле расхода. КПД и ресурс хуже.' });
    if (stat.verdict === 'fail' && hMaxFix < 5) flags.push({ id: 'static_low', level: 'fail', text: 'Насос не поднимает воду на высоту подъёма: без расхода у приборов ' + fmt(stat.bar, 1) + ' бар.' });
    else if (stat.verdict !== 'ok') flags.push({ id: 'static', level: stat.verdict, text: 'При закрытых кранах давление до ' + fmt(stat.bar, 1) + ' бар' + (stat.capped ? '' : (mains ? ' — редуктора в узле нет' : ' — автоматики по давлению и редуктора нет')) + '.' });

    var verdict = 'ok';
    var counts = { ok: 0, tight: 0, fail: 0, unknown: 0 };
    var worst = null;
    design.rows.forEach(function (r) {
      counts[r.verdict]++;
      verdict = worse(verdict, r.verdict);
      if (r.k != null && (!worst || r.k < worst.k)) worst = r;
    });
    if (!hasZones) verdict = 'unknown';
    // Все приборы сразу — справочно: красным не называем (одновременность 100 % в жизни не бывает)
    var peakWorst = null, peakVerdict = 'ok';
    if (peak) peak.rows.forEach(function (r) {
      peakVerdict = worse(peakVerdict, r.verdict === 'fail' ? 'tight' : r.verdict);
      if (r.k != null && (!peakWorst || r.k < peakWorst.k)) peakWorst = r;
    });
    verdict = worse(verdict, stat.verdict);
    if (pumpInfo.outOfRange) verdict = 'fail';
    flags.forEach(function (f) { if (f.level === 'fail') verdict = 'fail'; else if (f.level === 'tight' && verdict === 'ok') verdict = 'tight'; });

    var res = {
      scenarios: { design: design, peak: peak }, fixtures: design.rows, static: stat, pump: pumpInfo,
      flags: flags, verdict: verdict, counts: counts, worst: worst, peakWorst: peakWorst, peakVerdict: peakVerdict,
      reserve: reserve, setBar: SET_BAR
    };
    if (!opts.noAdvice) res.advice = advise(data, res, opts);
    return res;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Что менять. Каждый совет проверен пересчётом, а не сказан «на глаз»: подставили
  // вариант в те же данные и посмотрели, что станет.
  function advise(data, res, opts) {
    var out = [];
    var rv = opts && opts.reserve;
    var lossOf = function (r, grp) {
      return r.scenarios.design.trunk.stages.reduce(function (a, s) { return a + (s.group === grp && s.id !== 'lift' && s.id !== 'auto' && !s.regulated ? s.dH : 0); }, 0);
    };
    var flag = function (id) { return res.flags.some(function (f) { return f.id === id; }); };
    var needPump = !res.pump.mains && (res.counts.fail > 0 || res.counts.tight > 0 || res.pump.outOfRange);

    // Насос: самый дешёвый из каталога, при котором проходят все приборы
    if (needPump && opts && opts.pumps) {
      var cand = opts.pumps.filter(function (p) { return p.curve && p.curve.length && !(data.pump && p.id === data.pump.id); })
        .slice().sort(function (a, b) { return (a.price || 0) - (b.price || 0); });
      for (var i = 0; i < cand.length; i++) {
        var alt = clone(data); alt.pump = { id: cand[i].id, name: cand[i].name, curve: cand[i].curve, qMax: cand[i].q_max };
        if (evaluate(alt, { noAdvice: true, reserve: rv }).verdict === 'ok') {
          out.push({ id: 'pump', pumpId: cand[i].id, actions: [{ fix: 'pump', arg: cand[i].id, label: 'Поставить этот насос' }], text: 'Насос, при котором проходят все приборы: ' + cand[i].name + (cand[i].price ? ' (' + Math.round(cand[i].price).toLocaleString('ru-RU') + ' ₽)' : '') + ' — самый дешёвый из таких в каталоге.' });
          break;
        }
      }
    }
    // Труба 40 мм на трассе и вводе: в скважине остаётся 32 из-за оголовка
    if (!res.pump.mains && data.wellPipe && data.wellPipe.od < 40 && (flag('well_v') || needPump)) {
      var a40 = clone(data); a40.wellPipe = { od: 40, wall: 3.7, dIn: 0.0326 };
      var gain = lossOf(res, 'well') - lossOf(evaluate(a40, { noAdvice: true, reserve: rv }), 'well');
      if (gain >= 1.5) out.push({ id: 'pipe40', gain: gain, text: 'Труба 40×3,7 вместо 32×3: потери скважина — ввод ниже на ' + fmt(gain, 1) + ' м (сейчас ' + fmt(lossOf(res, 'well'), 1) + ' м). В самой скважине 32 мм остаётся из-за оголовка, 40 мм берут на горизонтальном участке.' });
    }
    // Ввод на 1″
    if (flag('node_v') && !(data.node && data.node.absent)) {
      var a1 = clone(data); a1.node.dIn = 0.025; a1.node.sizes = { mesh: 0.025, fine: 0.025, meter: 0.025, reducer: 0.025 }; a1.collector = { cold: 0.025, hot: 0.025 };
      var g1 = lossOf(res, 'node') - lossOf(evaluate(a1, { noAdvice: true, reserve: rv }), 'node');
      if (g1 >= 1) out.push({ id: 'node1', gain: g1, text: 'Ввод и коллектор на 1″: потери узла ниже на ' + fmt(g1, 1) + ' м (сейчас ' + fmt(lossOf(res, 'node'), 1) + ' м), скорость в узле падает до ' + fmt(velocity(res.scenarios.design.Q, 0.025), 2) + ' м/с. Замените краны, фильтр, счётчик и коллектор узла на 1″ в таблице замены.' });
    }
    if (res.static.verdict !== 'ok' && !res.static.capped) out.push({ id: 'reducer',
      actions: (data.node && !data.node.absent ? [{ fix: 'reducer', label: 'Включить редуктор' }] : []).concat(res.pump.mains ? [] : [{ fix: 'auto', arg: 'sirio', label: 'Автоматика SIRIO' }]),
      text: 'Редуктор давления в узле ввода' + (res.pump.mains ? '' : ' (или автоматика по давлению: SIRIO, BRIO-TOP, EPC-12)') + ': сейчас при закрытых кранах ' + fmt(res.static.bar, 1) + ' бар.' });
    var w = res.worst;
    if (w && w.verdict !== 'ok' && w.v > V_LIMIT.branch) out.push({ id: 'branch', text: 'Линия до «' + w.title + '» (' + w.zone + ') узкая: ' + fmt(w.v, 2) + ' м/с. Труба 20 мм на этой линии или короче трасса от коллектора.' });
    return out;
  }

  var api = {
    evaluate: evaluate, verdictOf: verdictOf, pipeLoss: pipeLoss, localLoss: localLoss, kvLoss: kvLoss, headAt: headAt,
    velocity: velocity, kvAt: kvAt, stepLoss: stepLoss, D34: D34, FIXTURES: FIXTURES, LOCAL: LOCAL, KV: KV, V_LIMIT: V_LIMIT, RESERVE: RESERVE, SET_BAR: SET_BAR,
    HEAD_BAR: HEAD_BAR, MIX_LINE: MIX_LINE
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.waterHydro = api;
})(typeof window !== 'undefined' ? window : this);
