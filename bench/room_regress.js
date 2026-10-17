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
const synth = require('./room_synth');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium';

// Функции распознавания из plan_editor.html — построчно, по имени
function extractCode() {
  const src = fs.readFileSync(path.join(root, 'plan_editor.html'), 'utf8').split('\n');
  const NAMES = ['getMask', 'openThin', 'chamferDist', 'cleanBar', 'furnitureClear', 'growToWalls', 'labelRooms',
    'traceLabel', 'dpSimp', 'enumerateRooms', 'roomShapeOk', 'roomAtPoint', 'pip', 'fitAreaRatio', 'agreeCount',
    'matchScore', 'median', 'resetScaleCaches', 'roomAreasAt', 'scaleByMatch', 'scaleTargets', 'guessScale',
    'area', 'centroid', 'wallFrame', 'overallDims', 'frameScaleCheck', 'frameInnerM2', 'isCell', 'roomAtLabel', 'rescueLabelRooms', 'fillShortRuns', 'eraseLabelText'];
  let code = '';
  for (const n of NAMES) {
    const i = src.findIndex(l => l.startsWith('function ' + n + '('));
    if (i < 0) throw new Error('нет функции ' + n + ' в plan_editor.html');
    let j = i; while (src[j] !== '}') j++;
    code += src.slice(i, j + 1).join('\n') + '\n';
  }
  return 'var calcRooms = [], PDF_AREAS = {}, GROW_ROOMS = true, maskCache = {}, wallMaskCache = {}, winCache = {}, DOORS = [], SCAN_DIMS = {};\n' + code;
}

async function main() {
  const { chromium } = require('playwright');
  const cases = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname, 'room_cases.json'), 'utf8'));
  const html = `<!doctype html><meta charset=utf-8><body><script>
    var DATA = { floors: [{ img: 'x', w: 0, h: 0, pxPerM: 0 }] }, cur = 0, imgCache = {};
    function F() { return DATA.floors[cur]; }
    ${extractCode()}
    ${synth.pageScript()}
    </script></body>`;
  const file = path.join(require('os').tmpdir(), 'room_regress.html');
  fs.writeFileSync(file, html);
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  let failed = 0;
  // Синтетический кейс по присланному плану: габарит, клетушки, подписи
  {
    const p = await b.newPage();
    await p.goto('file://' + file);
    const r = await p.evaluate(() => {
      const S = drawSynth();
      DATA.floors[0].w = S.canvas.width; DATA.floors[0].h = S.canvas.height; imgCache[0] = S.canvas;
      DATA.floors[0].pxPerM = S.ppm * 0.91;           // масштаб, ушедший на 9 %
      SCAN_DIMS[0] = S.dims;
      const fc = frameScaleCheck();
      const out = { fc: fc && { ppm: +fc.ppm.toFixed(1), axesOk: fc.axesOk, scaleOk: fc.scaleOk }, frame: wallFrame() };
      if (fc && fc.axesOk) { DATA.floors[0].pxPerM = fc.ppm; resetScaleCaches(); }
      const rooms = rescueLabelRooms(enumerateRooms(), S.labs);
      const kept = rooms.filter(x => !isCell(x, S.labs));
      out.rooms = rooms.length; out.kept = kept.length;
      out.areas = kept.map(x => +x.m2.toFixed(1)).sort((a, b) => b - a);
      out.inner = +frameInnerM2().toFixed(1);
      out.sum = +kept.reduce((s, x) => s + x.m2, 0).toFixed(1);
      return out;
    });
    const exp = synth.expect;
    const good = r.areas.length === exp.length && exp.every((e, i) => Math.abs(r.areas[i] - e) / e <= 0.10);
    if (!good || !r.fc || !r.fc.scaleOk && !r.fc.axesOk) failed++;
    console.log(`${good ? 'OK  ' : 'FAIL'} синтетика (дом 12480×6600, 5 подписей): габарит ${JSON.stringify(r.fc)}, контуров ${r.rooms}, после отсева клетушек ${r.kept}, площади ${r.areas.join('; ')} (эталон ${exp.join('; ')}), сумма ${r.sum} из внутренних ${r.inner} м²`);
    await p.close();
  }
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
