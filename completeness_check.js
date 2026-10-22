/**
 * Проверка комплектности сметы: не потерялся ли в ней обязательный узел.
 *
 * Стыковка (assembly_check.js) отвечает «сходится ли резьба у того, что есть». Эта проверка отвечает на
 * соседний вопрос: «есть ли то, без чего котельная не работает или не принимается». Она читает готовый
 * список позиций (app.currentEquipmentList) и состояние расчёта и ничего не считает заново.
 *
 * Правила — таблица RULES ниже. У каждого правила есть:
 *   when — когда оно действует (бойлер, тёплый пол, электрокотёл...);
 *   need — что обязано быть: регулярка по названию позиции и минимальное число штук;
 *   why  — на чём правило основано. Три источника, и их нельзя смешивать (CLAUDE.md, «Нормативная база»,
 *          правило 2): ПАСПОРТ — написано в паспорте изделия; ПРАКТИКА — так собирают котельные, нормы
 *          на это нет; СМЕТА — внутренняя согласованность списка (бак без комплекта подключения).
 *          Ссылку на СП, в котором этого нет, не ставим.
 * Правило добавляют только вместе с объектом стенда, на котором оно срабатывает или, наоборот, обязано
 * промолчать: bench/completeness.js. Ложное срабатывание хуже пропуска — монтажник перестанет читать.
 *
 * Глобал: window.completenessCheck = { check, RULES }; в Node — module.exports.
 */
(function (root) {
  'use strict';

  // Сколько штук позиций, подходящих под регулярку (по названию). Количество q — как в смете.
  function count(items, re) {
    var n = 0;
    items.forEach(function (it) { if (re.test(String(it.name || ''))) n += +it.q || 0; });
    return n;
  }
  var has = function (ctx, re) { return count(ctx.items, re) > 0; };

  var isEl = function (b) { return b && b.type !== 'gas'; };

  var RULES = [
    {
      id: 'gas-chimney', title: 'Дымоход газового котла',
      when: function (c) { return c.boilers.some(function (b) { return b && b.type === 'gas'; }); },
      need: [{ re: /дымоход|дымоудален|коакс/i, min: 1, label: 'комплект дымохода' }],
      why: 'ПРАКТИКА: газовый котёл без отвода продуктов сгорания не вводят; сечение и высоту считает СП 7.13130.'
    },
    {
      id: 'air-separator', title: 'Воздухоотводчик контура',
      when: function (c) { return c.boilers.length > 0; },
      need: [{ re: /сепаратор воздуха|воздухоотводчик/i, min: 1, label: 'сепаратор воздуха или воздухоотводчик' }],
      why: 'ПРАКТИКА: воздух из контура удаляют на подаче у котла.'
    },
    {
      id: 'mag-filter', title: 'Фильтр на обратке',
      when: function (c) { return c.boilers.length > 0; },
      need: [{ re: /шламоотделитель|фильтр/i, min: 1, label: 'фильтр-шламоотделитель' }],
      why: 'ПАСПОРТ: Navien NGB210 System, руководство, стр. 37 — на обратке перед котлом рекомендуется косой сетчатый фильтр. У других котлов то же — по практике.'
    },
    {
      id: 'isolating-valves', title: 'Запорная арматура и разъёмные соединения котла',
      when: function (c) { return c.boilers.length > 0; },
      need: [
        { re: /кран шаровой/i, min: 2, label: 'краны на подаче и обратке' },
        { re: /американка|разъ[её]мное соед/i, min: 2, label: 'американки котла' }
      ],
      why: 'ПРАКТИКА: котёл снимается без резки трубы (разъёмное соединение, правило «Обвязка» в app.js).'
    },
    {
      id: 'heating-expansion', title: 'Расширительный бак отопления',
      // Исключение — электрокотлы STOUT STATUS мощностью до 21 кВт включительно: встроенный бак 10 л
      // (паспорт stout_bf87195c29c2, табл. 1, п. 9). У моделей 24 и 27 кВт в таблице прочерк — бака нет.
      when: function (c) {
        return c.boilers.length > 0 && !c.boilers.every(function (b) {
          if (!(isEl(b) && /STATUS/i.test(String(b.name || '')))) return false;
          // Мощность — число после скобки в названии позиции: «Котёл электрический STATUS (12 кВт)».
          var kw = parseFloat(String(b.name || '').split('(')[1]);
          return kw > 0 && kw <= 21;
        });
      },
      need: [{ re: /расширительный бак для отопления/i, min: 1, label: 'расширительный бак отопления' }],
      why: 'ПРАКТИКА: замкнутый контур отопления без компенсатора расширения не работает; у STATUS до 21 кВт бак встроен, у 24 и 27 кВт нет (паспорт).'
    },
    {
      id: 'dhw-expansion', title: 'Расширительный бак ГВС',
      when: function (c) { return c.dhwTank; },
      need: [{ re: /расширительный бак для гвс/i, min: 1, label: 'расширительный бак ГВС' }],
      why: 'ПРАКТИКА: закрытый бойлер при нагреве расширяется, обратный клапан на ХВС выключает водопровод как компенсатор.'
    },
    {
      id: 'dhw-safety-valve', title: 'Предохранительный клапан на бойлере',
      when: function (c) { return c.dhwTank; },
      need: [{ re: /клапан предохранительный/i, min: 1, label: 'предохранительный клапан' }],
      why: 'ПРАКТИКА: закрытый накопительный бойлер защищают предохранительным клапаном на входе ХВС (паспорта бойлеров не сверяли).'
    },
    {
      id: 'dhw-check-valve', title: 'Обратный клапан на входе ХВС бойлера',
      when: function (c) { return c.dhwTank; },
      need: [{ re: /клапан обратный/i, min: 1, label: 'обратный клапан' }],
      why: 'ПРАКТИКА: без него расширение воды при нагреве уходит обратно в водопровод.'
    },
    {
      id: 'dhw-mixing', title: 'Термосмеситель ГВС',
      when: function (c) { return c.dhwTank; },
      need: [{ re: /термостатический смесительный/i, min: 1, label: 'термостатический смесительный клапан' }],
      why: 'ПРАКТИКА: ограничение температуры у кранов (ожог при накопительном нагреве до 60–70 °C).'
    },
    {
      id: 'ufh-mixing', title: 'Узел смешения тёплого пола',
      when: function (c) { return c.ufh; },
      need: [
        { re: /группа насосная.*(тёплый пол|теплый пол|под сервопривод)|узел.*(смешени|подмес)/i, min: 1, label: 'смесительный узел' },
        { re: /сервопривод/i, min: 1, label: 'сервопривод смесителя' }
      ],
      why: 'ПРАКТИКА: температура теплоносителя в тёплом полу ниже, чем в радиаторах (СП 60.13330.2020, п. 6.4.8 — ограничение поверхности), '
        + 'поэтому без узла смешения контур не работает.'
    },
    {
      id: 'ufh-manifold', title: 'Коллектор тёплого пола',
      when: function (c) { return c.ufh; },
      need: [{ re: /коллектор/i, min: 1, label: 'коллектор' }],
      why: 'ПРАКТИКА: петли тёплого пола собираются на коллекторе.'
    },
    {
      id: 'recirc-pump', title: 'Насос рециркуляции ГВС',
      when: function (c) { return c.recirc; },
      need: [{ re: /насос гвс|насос рециркуляц/i, min: 1, label: 'насос рециркуляции' }],
      why: 'СМЕТА: включена рециркуляция — значит, насос должен быть.'
    },
    {
      id: 'electric-3way', title: 'Трёхходовой клапан электрокотла с бойлером',
      when: function (c) { return c.dhwTank && c.boilers.some(function (b) { return isEl(b); }) && !c.boilers.some(function (b) { return b && b.type === 'gas'; }); },
      need: [{ re: /трех?ход|3-х ход/i, min: 1, label: 'трёхходовой клапан' }],
      why: 'ПАСПОРТ: у электрокотла STOUT нет встроенного трёхходового клапана (клапан — отдельная принадлежность, stout_202111).'
    },
    {
      id: 'tank-kits', title: 'Мембранные баки с комплектами подключения',
      when: function (c) { return count(c.items, /расширительный бак/i) > 0; },
      need: [],
      custom: function (c) {
        var tanks = count(c.items, /^расширительный бак/i), kits = count(c.items, /комплект подключения мембранного бака/i);
        return tanks === kits ? [] : ['баков ' + tanks + ', комплектов подключения ' + kits];
      },
      why: 'СМЕТА: в этой смете каждый мембранный бак идёт с комплектом подключения; расхождение — потерянная позиция.'
    },
    {
      id: 'priced', title: 'Каждая позиция имеет цену и количество',
      when: function () { return true; },
      need: [],
      custom: function (c) {
        return c.items.filter(function (it) { return !(+it.price > 0) || !(+it.q > 0) || !String(it.name || '').trim(); })
          .map(function (it) { return (it.name || '(без названия)') + ': цена ' + it.price + ', кол-во ' + it.q; });
      },
      why: 'СМЕТА: позиция без цены или количества — дыра в каталоге (addToBill «промолчал»).'
    }
  ];

  /**
   * ctx: { items: app.currentEquipmentList, state: app.state, boilers: [позиции котлов], dhwTank: bool }.
   * Возвращает { findings: [{rule, title, missing: [...], why}], applied: [id...] }.
   */
  function check(ctx) {
    var out = { findings: [], applied: [] };
    RULES.forEach(function (r) {
      if (!r.when(ctx)) return;
      out.applied.push(r.id);
      var missing = [];
      (r.need || []).forEach(function (n) {
        var got = count(ctx.items, n.re);
        if (got < n.min) missing.push(n.label + (n.min > 1 ? ': нужно не меньше ' + n.min + ', в смете ' + got : ''));
      });
      if (r.custom) missing = missing.concat(r.custom(ctx));
      if (missing.length) out.findings.push({ rule: r.id, title: r.title, missing: missing, why: r.why });
    });
    return out;
  }

  var api = { check: check, RULES: RULES, count: count };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.completenessCheck = api;
})(typeof window !== 'undefined' ? window : this);
