/**
 * Снимок страницы PDF так, как её рисует редактор (pdf.js в настоящем Chrome):
 *   node bench/chrome_pdf_png.js <http-адрес bench/pdf_render.html?pdf=...> <выход.png>
 * Встроенный браузер Claude кадры pdf.js не дорисовывает, headless Chrome — дорисовывает.
 * Нужен запущенный сервер на localhost:8080 и Chrome в обычном месте.
 */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const [url, out] = process.argv.slice(2);
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'chr-'));
const port = 9400 + Math.floor(Math.random() * 400);
const ch = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port, '--user-data-dir=' + prof, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let list = null;
  for (let i = 0; i < 50 && !list; i++) { try { list = await (await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })).json(); } catch (e) { await sleep(300); } }
  if (!list) throw new Error('Chrome не поднялся');
  const ws = new WebSocket(list.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const wait = {};
  ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.id && wait[d.id]) { wait[d.id](d); delete wait[d.id]; } });
  const call = (method, params) => new Promise(r => { const i = ++id; wait[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  let data = null;
  for (let i = 0; i < 100 && !data; i++) {
    await sleep(500);
    const r = await call('Runtime.evaluate', { expression: "(document.getElementById('out')||{}).textContent || (document.getElementById('err')||{}).textContent || ''", returnByValue: true });
    const v = r.result && r.result.result && r.result.result.value;
    if (v && v.startsWith('data:image/png;base64,')) data = v;
    else if (v) throw new Error('страница: ' + v);
  }
  if (!data) throw new Error('PDF не дорисовался за 50 с');
  fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
  console.log('готово', out, fs.statSync(out).size, 'байт');
  ws.close();
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => { ch.kill(); setTimeout(() => process.exit(), 300); });
