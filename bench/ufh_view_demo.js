/**
 * Рисует план дома для сметы (projectPlans.ufhView) на готовых данных плана и
 * кладёт страницу tmp_view.html рядом — открыть в браузере и посмотреть глазами.
 *
 *   node bench/ufh_view_demo.js <plan.json> [--conv 0] [--img план.png] [--crop x,y,w,h]
 * plan.json — один этаж: { pxPerM, w, h, zones, rads, coll }.
 * --conv N — N-й радиатор комнаты считать внутрипольным конвектором (проверка значка).
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const ctx = { console, Math, JSON, String, Number, Array, Object, parseInt, parseFloat, isNaN, isFinite, setTimeout, clearTimeout,
  Float64Array, Float32Array, Int32Array, Int16Array, Uint8Array, Uint16Array, Map, Set };
ctx.window = ctx; ctx.globalThis = ctx; ctx.document = { createElement: () => ({ getContext: () => null, style: {} }) };
vm.createContext(ctx);
for (const f of ['project_sheets.js', 'project_plans.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const PP = ctx.projectPlans;
const f = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^﻿/, ''));
const ci = process.argv.indexOf('--conv'), conv = ci > 0 ? +process.argv[ci + 1] : -1;
const ii = process.argv.indexOf('--img');
if (ii > 0) f.img = 'data:image/png;base64,' + fs.readFileSync(process.argv[ii + 1]).toString('base64');
const rooms = (f.zones || []).filter(z => z.name).map(z => ({ name: z.name, area: 10, q: 1000, floor: 1 }));
const kinds = {};
if (conv >= 0) (f.zones || []).forEach(z => { if (z.name) kinds[z.name.trim().toLowerCase()] = ['rad', 'rad', 'rad'].map((k, i) => (i === conv ? 'conv' : k)); });
const v = PP.ufhView(f, 150, rooms, { rads: true, tee: false, kinds });
if (!v) { console.error('вид не построился'); process.exit(1); }
const ci2 = process.argv.indexOf('--crop');
if (ci2 > 0) { const c = process.argv[ci2 + 1].split(',').map(Number); v.svg = v.svg.replace(/viewBox="[^"]*"/, 'viewBox="' + c.join(' ') + '"'); }
const html = '<!doctype html><meta charset="utf-8"><body style="margin:10px;background:#eee"><div style="width:1000px;background:#fff">' + v.svg +
  '</div><pre>' + JSON.stringify(v.radRows, null, 1) + '</pre>';
fs.writeFileSync(path.join(root, 'tmp_view.html'), html);
console.log('строк петель', v.rows.length, 'приборов', v.radRows.length, 'svg', v.svg.length, 'байт');
