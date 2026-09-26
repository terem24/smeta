/* assembly_check.js — сходится ли котельная по концам.
 *
 * Идея взята у навыка lego-build: модель собирается из описанных деталей, а
 * отдельная проверка ищет то, что не стыкуется. Здесь деталь — строка сметы,
 * а «шип» — присоединительный конец: наружная резьба, внутренняя, накидная
 * гайка, пресс-гнездо под трубу.
 *
 * Что проверяется. Резьбовое соединение — всегда пара: наружная резьба (НР)
 * входит во внутреннюю (ВР) или в накидную гайку того же размера. Значит, на
 * всю котельную число НР каждого размера должно совпасть с числом ВР и гаек
 * этого размера. Разошлось — какой-то конец остался без пары: забыт ниппель,
 * кран не того исполнения, переходник не на тот размер, аналог другого бренда
 * поменял НР на ВР. Концы, которые по замыслу уходят из котельной в дом (выходы
 * насосных групп, ХВС, ГВС, газ), в баланс не входят — они перечислены отдельно.
 *
 * Пресс-концы нержавейки и металлопластика так не сводятся: труба режется на
 * куски по месту, и сколько у неё концов, смета не знает. По ним только счёт.
 *
 * Чего проверка НЕ знает: где именно какой конец стоит. Она говорит «на 3/4"
 * одна наружная резьба лишняя» и показывает, кто их дал, а не «между краном и
 * фильтром». Для этого нужна раскладка по месту — следующий этап.
 *
 * Глобал: window.assemblyCheck = { portsOf, check }; в Node — module.exports.
 */
(function (root) {
  'use strict';

  // Типы концов. M — наружная резьба, F — внутренняя, N — накидная гайка
  // (садится на M), S — пресс-гнездо под трубу, P — пресс-конец/труба (в S).
  // U — размер известен, а НР это или ВР, паспорт не говорит. Такой конец
  // не записываем ни в одну сторону: он только расширяет допуск баланса.
  var MATE = { M: ['F', 'N'], F: ['M'], N: ['M'], S: ['P'], P: ['S'] };
  var KIND_RU = { M: 'НР', F: 'ВР', N: 'накидная гайка', S: 'пресс-гнездо', P: 'пресс-конец', U: 'НР или ВР?' };

  function P(kind, size, qty, extra) {
    var p = { kind: kind, size: size, qty: qty || 1 };
    for (var k in extra || {}) p[k] = extra[k];
    return p;
  }
  var EXT = function (role) { return { ext: true, role: role }; };

  /* Приборы: концы по паспортам. Ключ — артикул без суффикса сметы (_coil,
   * _cold...). ext — конец уходит из котельной (в дом, на газ, в канализацию)
   * и в баланс не входит. src — откуда взято; без src строку не добавлять:
   * выдуманный размер хуже пропуска, проверка тогда врёт уверенно.
   * Паспорта STOUT/ROMMER — папка «Аудит паспортов STOUT-ROMMER/02_текст». */
  var HAIER_1X = {
    // Руководство NeoSlim 1.18/2.18/1.24/2.24 Ti, стр. 29–30, 37. НР/ВР не указано.
    // Трёхходовой клапан у 1.x встроен (стр. 30, поз. A), выход B — подача
    // в змеевик бойлера; датчик бойлера в комплекте (стр. 37).
    src: 'Haier NeoSlim Ti, руководство по монтажу, стр. 29–30, 37',
    dhwValve: true,
    ports: [
      P('U', '3/4', 1, { role: 'подача отопления' }),
      P('U', '3/4', 1, { role: 'обратка отопления' }),
      P('U', '3/4', 1, { role: 'подача в змеевик бойлера' }),
      P('U', '3/4', 1, EXT('газ')),
      P('U', '1/2', 1, EXT('вход ХВС (подпитка)'))
    ]
  };
  var OPTIBASE_150_200 = {
    src: 'STOUT SWH-2110, паспорт (stout_4bce0e01b963)',
    ports: [
      P('M', '1', 1, { role: 'вход ХВС' }),
      P('M', '1', 2, { role: 'змеевик' }),
      P('M', '1', 1, EXT('рециркуляция (в дом или заглушка)')),
      P('M', '3/4', 1, { role: 'выход ГВС' })
    ]
  };
  var DEVICES = {
    'GE0Q6QE0CRU': HAIER_1X,
    'GE0Q6RE0CRU': HAIER_1X,
    'SWH-2110-000150': OPTIBASE_150_200,
    'SWH-2110-000200': OPTIBASE_150_200,
    // Баки: размер и НР — по каталогу и косвенно по SVS-0008 (его гайка 3/4
    // наворачивается на патрубок бака до 25 л); в паспорте баков не указано.
    'STH-0004-000018': { src: 'каталог + паспорт SVS-0008', ports: [P('M', '3/4')] },
    'STW-0015-000018': { src: 'каталог + паспорт SVS-0008', ports: [P('M', '3/4')] },
    'STW-0015-000024': { src: 'каталог + паспорт SVS-0008', ports: [P('M', '3/4')] },
    'SVS-0008-012020': { src: 'паспорт SVS-0008 (stout_2a2bedb466aa)',
      ports: [P('F', '3/4', 1, { role: 'к трубе' }), P('N', '3/4', 1, { role: 'к баку' })] },
    // Сепаратор: «ВР» только в названии каталога, паспорт исполнение не пишет.
    'RFW-0070-259520': { src: 'паспорт RFW-0070 (rommer_92bc260c9fa7)', ports: [P('U', '3/4', 2)] },
    'RFW-0070-259525': { src: 'паспорт RFW-0070 (rommer_92bc260c9fa7)', ports: [P('U', '1', 2)] },
    'RFW-0080-256620': { src: 'паспорт RFW-0080 (rommer_d2dea43718a8)', ports: [P('U', '3/4', 2)] },
    'SVM-0125-186520': { src: 'паспорт SVM-0110/0120/0125 (stout_d05db7aaeb51)', ports: [P('M', '3/4', 3)] },
    'RVS-0003-006015': { src: 'паспорт RVS-0003 (rommer_a2635d526ee4)',
      ports: [P('F', '1/2', 1, { role: 'вход' }), P('F', '3/4', 1, EXT('сброс в канализацию'))] },
    'SVC-0012-000020': { src: 'паспорт SVC-0012 (stout_884e9edd3a44)', ports: [P('F', '3/4', 2)] },
    // В каталоге SVC-1003, паспорта с таким артикулом нет; по названию это
    // отсечной клапан воздухоотводчика SVS-1003-000015: 1/2 НР в трубу, 1/2 ВР под него.
    'SVC-1003-000015': { src: 'паспорт воздухоотводчиков STOUT (stout_bfa5dcc53fb4), как SVS-1003', ports: [P('M', '1/2'), P('F', '1/2')] },
    'SDG-0001-002501': { src: 'паспорт SDG-0001 (stout_6d2ac6648531)',
      ports: [
        P('F', '1', 2, EXT('выход в систему отопления')),
        P('M', '1 1/2', 2, { role: 'к коллектору' }),
        P('N', '1 1/2', 2, { role: 'под насос' })
      ] },
    'SPC-0011-2560180': { src: 'паспорт SPC-0011 (stout_dbc0cd427cb8)', ports: [P('M', '1 1/2', 2)] },
    // Гнёзда 1/2 ВР под КИП, воздухоотводчик и слив идут с заглушками, их
    // число паспорт не называет — в баланс не вносим (см. slots в отчёте).
    'SDG-0018-004002': { src: 'паспорт SDG коллекторы, ред. 30.03.2023 (stout_49e828f28dc3)',
      slots: '1/2" ВР под КИП/воздухоотводчик/слив, число не указано',
      ports: [P('M', '1 1/2', 2, { role: 'к котлу' }), P('N', '1 1/2', 4, { role: 'к насосным группам' })] },
    'SIM-1001-635015': { src: 'паспорт термометров STOUT (stout_fbc3a558125d)', ports: [P('M', '1/2')] }
    // ASKON-MU-25M: паспорта с резьбами нет — не вносим.
  };

  // Позиции без присоединений к воде: крепёж, изоляция, электрика, дымоход.
  var NO_PORTS = /анкер|профиль монтажн|консоль монтажн|хомут|шпильк|трубка протект|теплоизоляц|k-flex|стабилизатор|дымоход|дюбел/i;

  // Резьба в названии: 1/2", 3/4", 1", 1 1/4", 1 1/2", 2". Возвращает '3/4' и т.п.
  var THREAD_RE = /(\d\s\d\/\d|\d\/\d|\d)\s*(?:"|″|'')/g;
  function threads(name) {
    var out = [], m;
    THREAD_RE.lastIndex = 0;
    while ((m = THREAD_RE.exec(name))) out.push(m[1].replace(/\s+/, ' '));
    return out;
  }
  // «22х3/4», «18х1» — пресс-размер и резьба переходника (резьба без кавычек).
  function pressXThread(name) {
    var m = /(\d{2})\s*[хx]\s*(\d\s\d\/\d|\d\/\d|\d)(?![\d.])/.exec(name);
    return m ? { press: m[1], thread: m[2] } : null;
  }
  function pressSize(name) {
    var m = /(?:ВПр|НПр|штанга|труба)[^\d]*(\d{2})\b/i.exec(name) || /\b(\d{2})(?:х\d|\b)/.exec(name);
    return m ? m[1] : null;
  }

  function port(kind, size, qty) { return { kind: kind, size: String(size), qty: qty || 1 }; }

  /* Концы одной позиции по названию. Не узнали — null: такая позиция идёт в
   * список «нет данных», а не молча в ноль. */
  function portsFromName(name) {
    var n = String(name || '');
    if (NO_PORTS.test(n)) return [];

    // \b в JS не видит кириллицу — границу слова задаём сами.
    var word = function (w) { return new RegExp('(^|[^А-Яа-яЁё])' + w + '([^А-Яа-яЁё]|$)').test(n); };

    if (/^труба/i.test(n)) return [{ kind: 'P', size: pressSize(n) || '?', qty: 0, pipe: true }];

    // Фитинги трубы котельной: нержавейка (ВПр/НПр), металлопластик
    // («Угольник 90° 26х26», «Переходник с наружной резьбой 1"х26»),
    // полипропилен («Муфта комбинированная с НР PP-RCT 32х1"»). Трубные
    // концы сводятся только счётом, важен резьбовой конец переходника.
    var th = threads(n);
    var isPipeFit = /ВПр|НПр|PP-R/.test(n) || /\d{2}\s*[хx]\s*\d{2}/.test(n) ||
      (/^(угольник|переходник|тройник|муфта)/i.test(n) && /["″']\s*[хx]\s*\d{2}/.test(n));
    if (isPipeFit) {
      var px = pressXThread(n);
      var ps = px ? px.press : (/(\d{2})(?!.*\d{2})/.exec(n.replace(/[хx]?\s*\d+°/g, ' ').replace(/["″'](\s*[хx])?/g, ' ')) || [])[1] || pressSize(n);
      var thr = px ? px.thread : (/["″']\s*[хx]\s*\d{2}/.test(n) || /резьб|с НР|с ВР|-НР|-ВР/.test(n) ? th[0] : null);
      var male = /наружн\S* резьб|с НР|-НР/.test(n), female = /внутренн\S* резьб|с ВР|-ВР/.test(n);
      var pk = /НПр/.test(n) && !/ВПр/.test(n) ? 'P' : 'S';
      var nEnds = /тройник/i.test(n) ? 3 : /крестовин/i.test(n) ? 4 : 2;
      var out = [];
      if (/ВПр|НПр/.test(n) && (n.match(/ВПр|НПр/g) || []).length > 1)
        out = n.match(/ВПр|НПр/g).map(function (t) { return port(t === 'ВПр' ? 'S' : 'P', ps); });
      else for (var e = 0; e < nEnds - (thr && (male || female) ? 1 : 0); e++) out.push(port(pk, ps));
      if (thr && male) out.push(port('M', thr));
      else if (thr && female) out.push(port('F', thr));
      return out;
    }
    if (/кронштейн/i.test(n)) return [];

    if (!th.length) return null;
    var t = th[0];

    // Муфта переходная ВР 1 1/2"х1" — две разные резьбы.
    if (/муфта переходн/i.test(n) && th.length >= 2) {
      var g = /НР/.test(n) && !/ВР/.test(n) ? 'M' : 'F';
      return [port(g, th[0]), port(g, th[1])];
    }
    if (/заглушк/i.test(n)) return [port(/ВР/.test(n) ? 'F' : 'M', t)];
    if (/ниппел/i.test(n)) return [port('M', t, 2)];
    if (/крестовин/i.test(n)) return [port(/НР/.test(n) ? 'M' : 'F', t, 4)];
    if (/^тройник/i.test(n)) return [port(/НР/.test(n) && !/ВР/.test(n) ? 'M' : 'F', t, 3)];

    // Двухконцевые: кран, американка, переход. Исполнение — пара «ВР/НР»,
    // «НР/накидная гайка», «ВН» (= ВР/НР), «НН», «ВВ».
    var pair = /(ВР|НР)\s*[\/-]\s*(ВР|НР|накидная гайка)/i.exec(n);
    if (pair) {
      var k = function (s) { return /накид/i.test(s) ? 'N' : (s.toUpperCase() === 'НР' ? 'M' : 'F'); };
      return [port(k(pair[1]), t), port(k(pair[2]), t)];
    }
    if (word('ВН')) return [port('F', t), port('M', t)];
    if (word('НН')) return [port('M', t, 2)];
    if (word('ВВ')) return [port('F', t, 2)];
    // Один конец, исполнение в названии: воздухоотводчик 1/2" НР, гильза.
    if (/воздухоотводчик/i.test(n) && /НР/.test(n)) return [port('M', t)];
    if (/термометр|манометр/i.test(n) && /гильз/i.test(n)) return [port('M', t)];
    return null;
  }

  function baseId(it) {
    var id = String(it.originalId || it.id || '');
    return id.replace(/_.*$/, '');
  }

  /* Концы позиции: сперва таблица приборов (по артикулу), затем название. */
  function portsOf(it) {
    var ids = [baseId(it), String(it.id || '')];
    for (var i = 0; i < ids.length; i++) {
      var d = DEVICES[ids[i]];
      if (d) return { ports: d.ports, src: d.src, from: 'passport', dhwValve: !!d.dhwValve, slots: d.slots };
    }
    var p = portsFromName(it.name);
    return p ? { ports: p, from: 'name' } : null;
  }

  /* Баланс по котельной. list — currentEquipmentList, filter — какие строки
   * брать (по умолчанию разделы 1 и 2 — котёл и обвязка). */
  function check(list, filter) {
    filter = filter || function (it) { return /^[12]\./.test(String(it.sectionTitle || it.group || '')); };
    var bal = {};      // размер → { M, F, N, S, P, who: [] }
    var unknown = [];  // позиции, про концы которых ничего не знаем
    var ext = [];      // концы, уходящие из котельной
    var pipe = {};     // пресс-размер → метров трубы (для справки)
    (list || []).filter(filter).forEach(function (it) {
      var q = Number(it.q) || 1;
      var r = portsOf(it);
      if (!r) { unknown.push(it); return; }
      r.ports.forEach(function (p) {
        if (p.pipe) { pipe[p.size] = (pipe[p.size] || 0) + q; return; }
        var n = (p.qty || 1) * q;
        if (p.ext) { ext.push({ it: it, p: p, n: n }); return; }
        var key = (p.kind === 'S' || p.kind === 'P' ? 'пресс ' + p.size : p.size + '"');
        var b = bal[key] || (bal[key] = { M: 0, F: 0, N: 0, S: 0, P: 0, U: 0, who: [] });
        b[p.kind] += n;
        b.who.push({ id: baseId(it), name: it.name, kind: p.kind, n: n, from: r.from });
      });
    });

    var problems = [];
    Object.keys(bal).forEach(function (key) {
      var b = bal[key];
      if (/^пресс/.test(key)) return; // см. шапку: концы трубы неизвестны
      // Концы «НР или ВР?» могут встать на любую сторону: расхождение
      // считается ошибкой, только если его ими не закрыть (и по чётности).
      var male = b.M, female = b.F + b.N, d = male - female;
      if (Math.abs(d) > b.U || (b.U - Math.abs(d)) % 2) problems.push({
        size: key, male: male, female: female, unsure: b.U,
        text: (d > 0
          ? key + ': наружных резьб ' + male + ', ответных (ВР и гаек) ' + female + ' — ' + d + ' НР без пары'
          : key + ': ответных (ВР и гаек) ' + female + ', наружных резьб ' + male + ' — ' + (-d) + ' ВР без пары') +
          (b.U ? ' (концов с неизвестным исполнением ' + b.U + ')' : '')
      });
    });
    // Лишний узел: котёл со встроенным клапаном бойлера и внешний комплект
    // загрузки в одной смете — клапану некуда встать, котёл переключает сам.
    var rows = (list || []).filter(filter);
    var builtIn = rows.filter(function (it) { var r = portsOf(it); return r && r.dhwValve; });
    var kit = rows.filter(function (it) { return /^SFB-0001-000001_tankload/.test(String(it.originalId || '')); });
    if (builtIn.length && kit.length) problems.unshift({
      size: 'узел', text: 'внешний «' + kit[0].name + '» при котле со встроенным трёхходовым клапаном (' +
        builtIn[0].name + ', ' + (builtIn[0].id || '') + ') — комплект лишний'
    });
    var slots = rows.map(function (it) { var r = portsOf(it); return r && r.slots ? it.name + ': ' + r.slots : null; }).filter(Boolean);
    return { balance: bal, problems: problems, unknown: unknown, ext: ext, pipe: pipe, slots: slots };
  }

  var api = { portsOf: portsOf, portsFromName: portsFromName, check: check, DEVICES: DEVICES, KIND_RU: KIND_RU, MATE: MATE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.assemblyCheck = api;
})(typeof window !== 'undefined' ? window : this);
