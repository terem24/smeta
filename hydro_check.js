/* hydro_check.js — сводная проверка гидравлики котельной.
 *
 * Зачем. Расчёты напора в калькуляторе разбросаны по контурам: кольцо радиаторов
 * (radHydraulics), коллекторы тёплого пола (ufhBalance), котловой контур (вердикт в
 * подсказке к трубе), змеевик бойлера (dhwLoadHydraulics). У каждого свой вердикт и
 * свой вид, и ни одного места, где видно все контуры сразу и где слабое звено.
 * Этот файл собирает их в одну таблицу «контур — расход — требуется — даёт насос —
 * запас — вердикт» и говорит, что менять, если не хватает.
 *
 * Чего здесь НЕТ: своего гидравлического расчёта. Числа приходят готовыми из
 * app.buildHydroCheckData() — тех же функций, по которым собрана смета, поэтому
 * сводка разойтись со сметой не может. Здесь только вердикт и совет.
 * Смету этот файл не меняет: первый этап — показать, где слабо. Исправление схемы по
 * результату проверки (добавить ветку, группу, диаметр) — следующий этап.
 *
 * Строка контура:
 *   { id: 'boiler' | 'rad' | 'ufh' | 'dhw', title, flow, need, have, pump,
 *     confirmed (кривая насоса паспортная), hasGroup, branches, noisy, note }
 *   flow — м³/ч, need и have — м вод. ст.; have = null, если напор насоса неизвестен.
 *
 * Глобал: window.hydroCheck = { evaluate, RESERVE }; в Node — module.exports.
 */
(function (root) {
  'use strict';

  // Запас насоса, при котором вердикт «хватает» — тот же, что требуется от насоса
  // разводки (app.RAD_PUMP_RESERVE). Дублировать число не хочется, поэтому
  // evaluate берёт его из opts.reserve; это — запасное значение для Node.
  var RESERVE = 1.15;

  var VERDICT_RU = { ok: 'хватает', tight: 'впритык', fail: 'не хватает', unknown: 'нет данных' };

  function verdictOf(need, have, reserve) {
    if (!(need > 0) || have == null || !isFinite(have)) return 'unknown';
    var k = have / need;
    if (k < 1) return 'fail';
    if (k < reserve) return 'tight';
    return 'ok';
  }

  // Что менять. Совет зависит от контура и от того, есть ли у него своя насосная
  // группа: у кольца радиаторов без группы лекарство — поставить группу, с группой —
  // диаметр побольше или вторая ветка.
  function adviceFor(r, verdict) {
    if (verdict === 'ok' || verdict === 'unknown') return '';
    var low = verdict === 'fail' ? 'Не хватает напора. ' : 'Запас меньше нормы. ';
    switch (r.id) {
      case 'boiler':
        return low + 'Вести котловой контур через гидрострелку с отдельным насосом или взять трубу обвязки на размер больше.';
      case 'rad':
        return r.hasGroup === false
          ? low + 'Насос котла кольцо не тянет — нужна насосная группа радиаторов на коллекторе. Добавить её можно кнопкой «Что добавить».'
          : low + 'Взять подводку на размер больше или разделить радиаторы на две ветки (каждая — своя группа).';
      case 'ufh':
        return low + 'Разделить коллектор на два (меньше петель на гребёнку — меньше расход), укоротить петли или взять узел с большей пропускной способностью.';
      case 'dhw':
        return low + 'Взять трубу греющего контура на размер больше или насос с большим напором.';
      default:
        return low;
    }
  }

  /**
   * data: { rows: [строка контура], scheme: { hydro: bool, why: 'текст' } | null }
   * opts: { reserve }
   * Возвращает { rows: [..., k, verdict, verdictRu, advice, flags], counts, worst, scheme }.
   */
  function evaluate(data, opts) {
    var reserve = (opts && opts.reserve) || RESERVE;
    var rows = ((data && data.rows) || []).map(function (r) {
      // r.reserve — свой запас контура: у тёплого пола 15 % уже заложены в «нужно» (ufhBalance),
      // и второй раз их требовать нельзя — работающий контур показался бы «впритык».
      var verdict = verdictOf(r.need, r.have, r.reserve || reserve);
      var flags = [];
      if (r.confirmed === false && r.have != null) flags.push('кривая насоса не подтверждена паспортом');
      if (r.noisy) flags.push('скорость выше предела по шуму');
      var out = {};
      Object.keys(r).forEach(function (k) { out[k] = r[k]; });
      out.k = (r.need > 0 && r.have != null) ? r.have / r.need : null;
      out.verdict = verdict;
      out.verdictRu = VERDICT_RU[verdict];
      out.advice = adviceFor(r, verdict);
      out.flags = flags;
      return out;
    });
    var counts = { ok: 0, tight: 0, fail: 0, unknown: 0 };
    rows.forEach(function (r) { counts[r.verdict]++; });
    // Слабое звено — контур с наименьшим запасом среди тех, у кого он известен.
    var worst = null;
    rows.forEach(function (r) {
      if (r.k == null) return;
      if (!worst || r.k < worst.k) worst = r;
    });
    return { rows: rows, counts: counts, worst: worst, scheme: (data && data.scheme) || null, reserve: reserve };
  }

  var api = { evaluate: evaluate, verdictOf: verdictOf, RESERVE: RESERVE, VERDICT_RU: VERDICT_RU };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.hydroCheck = api;
})(typeof window !== 'undefined' ? window : this);
