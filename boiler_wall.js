/* boiler_wall.js — раскладка оборудования котельной по стене, в миллиметрах.
 *
 * Зачем отдельным файлом. По этой раскладке живут ДВА потребителя, и они на
 * разных страницах: лист «Компоновка котельной» рисует её вектором
 * (project_layout.js на sheet_demo.html), а смета берёт из неё длину котлового
 * контура для расчёта потерь и вердикта по напору (app.js на index.html).
 * app.js на страницу листов не грузится, поэтому «позвать функцию соседа»
 * нельзя ни в одну сторону — а держать две копии одних и тех же чисел уже
 * оборачивалось тихими расхождениями (порог диаметра врезки баков считался в
 * трёх местах и в двух отстал). Поэтому раскладка вынесена сюда, и оба
 * подключают этот файл.
 *
 * Помещение условное: реальных размеров котельной калькулятор не знает. Стена
 * набирается по составу оборудования с зазорами, глубина принята 2000 мм —
 * на листе про это есть примечание.
 *
 * Глобал: window.boilerWall = { C, plan, spans, boilerSpan }
 */
(function () {
  'use strict';

  // Габариты и зазоры. Сняты с листа ТМ-4 проекта-образца 2025-191.
  var C = {
    gap: 150,        // зазор между блоками оборудования
    boilerW: 440,    // газовый котёл: ширина и высота корпуса
    boilerH: 750,
    boilerD: 350,
    elW: 420,        // электрический котёл
    elH: 640,
    elD: 300,
    boilerGap: 60,   // между котлами каскада
    hydroW: 120,     // узел гидроразделения
    hydroPad: 30,
    loopStep: 90,    // шаг отводов гребёнки
    loopPad: 140,
    depth: 2000      // условная глубина помещения
  };

  /**
   * Раскладка стены слева направо: расширительный бак отопления, зона котлов с
   * гребёнкой, узел гидроразделения, бак ГВС, бойлер. Возвращает координаты
   * блоков и общую ширину стены W — всё в миллиметрах от левого края.
   *
   * ctx: { gasCount, elCount, boilerW?, boilerH?, elW?, elH?, hydro,
   *        tankH?: {d}, tankD?: {d}, indirect?: {d}, loops: [] }
   */
  function plan(ctx) {
    ctx = ctx || {};
    var bW = ctx.boilerW || C.boilerW, bH = ctx.boilerH || C.boilerH;
    var eW = ctx.elW || C.elW, eH = ctx.elH || C.elH;
    var gasCount = ctx.gasCount || 0, elCount = ctx.elCount || 0;
    var nLoops = (ctx.loops || []).length;

    var x = C.gap, blocks = {};
    if (ctx.tankH) {
      blocks.tankH = { x: x, w: ctx.tankH.d };
      x += ctx.tankH.d + C.gap;
    }
    // Зона отводов лежит под котлами; её ширина — большее из двух: сколько
    // нужно гребёнке под контуры и сколько занимают сами котлы.
    var bw = gasCount * bW + elCount * eW + (gasCount + elCount - 1) * C.boilerGap;
    var zoneW = Math.max((nLoops - 1) * C.loopStep + C.loopPad, bw);
    blocks.zone = { x: x, w: zoneW };
    // Котлы стоят по центру зоны.
    var bx = x + (zoneW - bw) / 2;
    blocks.boilers = [];
    for (var g = 0; g < gasCount; g++) {
      blocks.boilers.push({ x: bx, w: bW, h: bH, gas: true });
      bx += bW + C.boilerGap;
    }
    for (var e = 0; e < elCount; e++) {
      blocks.boilers.push({ x: bx, w: eW, h: eH, gas: false });
      bx += eW + C.boilerGap;
    }
    x += zoneW;
    if (ctx.hydro) { blocks.hydro = { x: x + C.hydroPad, w: C.hydroW }; x += C.hydroPad + C.hydroW + C.hydroPad; }
    if (ctx.tankD) {
      blocks.tankD = { x: x + C.gap / 2, w: ctx.tankD.d };
      x += ctx.tankD.d + C.gap;
    }
    if (ctx.indirect) {
      blocks.indirect = { x: x + C.gap / 2, w: ctx.indirect.d };
      x += ctx.indirect.d + C.gap;
    }
    blocks.W = x + C.gap;
    return blocks;
  }

  /**
   * Горизонтальные пролёты от КАЖДОГО котла до узла гидроразделения, мм, в том
   * же порядке, что и blocks.boilers. Смета набирает трубу по каждому котлу
   * отдельно: в каскаде ближний к узлу короче дальнего. Если узла нет, пролётов
   * тоже нет — котёл работает на систему напрямую.
   */
  function spans(ctx) {
    var B = plan(ctx);
    if (!B.hydro || !B.boilers || !B.boilers.length) return [];
    var hx = B.hydro.x + B.hydro.w / 2;
    return B.boilers.map(function (b) { return Math.abs(hx - (b.x + b.w / 2)); });
  }

  /** Худший пролёт каскада: вердикт по напору считается по дальнему котлу. */
  function boilerSpan(ctx) {
    var a = spans(ctx);
    return a.length ? Math.max.apply(null, a) : 0;
  }

  window.boilerWall = { C: C, plan: plan, spans: spans, boilerSpan: boilerSpan };
})();
