/**
 * Регрессия распознавания комнат по плану: берём настоящие функции из plan_editor.html
 * (без копий), прогоняем на листах с эталоном — площадями из экспликации — и
 * печатаем, сколько площадей совпало, выбранный масштаб и утечки.
 *
 * Запуск (нужен Playwright с Chromium, как в песочнице):
 *   node bench/room_regress.js bench/room_cases.json
 * Формат кейса: { "name": "...", "img": "путь к PNG листа", "areas": [15.9, 37.0, ...] }
 * Листы клиентов в репозиторий не кладём: пути указываются в room_cases.json локально.
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium';

// Функции распознавания из plan_editor.html — построчно, по имени
function extractCode() {
  const src = fs.readFileSync(path.join(root, 'plan_editor.html'), 'utf8').split('\n');
  const NAMES = ['getMask', 'openThin', 'chamferDist', 'cleanBar', 'furnitureClear', 'growToWalls', 'labelRooms',
    'traceLabel', 'dpSimp', 'enumerateRooms', 'roomShapeOk', 'roomAtPoint', 'pip', 'fitAreaRatio', 'agreeCount',
    'matchScore', 'median', 'resetScaleCaches', 'roomAreasAt', 'scaleByMatch', 'scaleTargets', 'guessScale'];
  let code = '';
  for (const n of NAMES) {
    const i = src.findIndex(l => l.startsWith('function ' + n + '('));
    if (i < 0) throw new Error('нет функции ' + n + ' в plan_editor.html');
    let j = i; while (src[j] !== '}') j++;
    code += src.slice(i, j + 1).join('\n') + '\n';
  }
  return 'var calcRooms = [], PDF_AREAS = {}, GROW_ROOMS = true, maskCache = {}, wallMaskCache = {}, winCache = {}, DOORS = [];\n' + code;
}

async function main() {
  const { chromium } = require('playwright');
  const cases = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname, 'room_cases.json'), 'utf8'));
  const html = `<!doctype html><meta charset=utf-8><body><script>
    var DATA = { floors: [{ img: 'x', w: 0, h: 0, pxPerM: 0 }] }, cur = 0, imgCache = {};
    function F() { return DATA.floors[cur]; }
    ${extractCode()}
    </script></body>`;
  const file = path.join(require('os').tmpdir(), 'room_regress.html');
  fs.writeFileSync(file, html);
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  let failed = 0;
  for (const c of cases) {
    const p = await b.newPage();
    await p.goto('file://' + file);
    const data = 'data:image/png;base64,' + fs.readFileSync(c.img).toString('base64');
    const r = await p.evaluate(async ({ data, areas }) => {
      const img = new Image(); img.src = data; await img.decode();
      DATA.floors[0].w = img.naturalWidth; DATA.floors[0].h = img.naturalHeight; imgCache[0] = img;
      DATA.floors[0].pxPerM = 0; DATA.floors[0].roomMask = undefined;
      calcRooms = areas.map((a, i) => ({ name: 'r' + i, area: a, floor: 1 }));
      const g = guessScale();
      const ppm = g ? g.ppm : 0;
      const out = { ppm: Math.round(ppm), ok: g ? g.ok : 0, total: areas.length, mode: g ? g.mode : null, leaks: 0, avgPts: 0 };
      if (ppm) {
        DATA.floors[0].pxPerM = ppm; DATA.floors[0].roomMask = g.mode === 'clean' ? 'clean' : undefined;
        maskCache = {}; winCache = {};
        const rooms = enumerateRooms();
        out.rooms = rooms.length;
        out.leaks = rooms.filter(x => x.m2 > 70).length;
        out.avgPts = rooms.length ? Math.round(rooms.reduce((s, x) => s + x.pts.length, 0) / rooms.length) : 0;
      }
      return out;
    }, { data, areas: c.areas });
    const ok = r.ok >= (c.minMatched || Math.ceil(c.areas.length * 0.7));
    if (!ok) failed++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${c.name}: масштаб ${r.ppm} px/м, совпало ${r.ok} из ${r.total}, комнат ${r.rooms ?? '—'}, утечек ${r.leaks}, углов ${r.avgPts}`);
    await p.close();
  }
  await b.close();
  if (failed) { console.error(failed + ' кейс(ов) не прошли'); process.exitCode = 1; }
}
main().catch(e => { console.error(e); process.exit(1); });
