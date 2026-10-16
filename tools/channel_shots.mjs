// Скриншоты калькулятора для постов канала: channel/img/<имя>.png, в двойном разрешении.
//
// Нужен локальный сервер сайта (python -m http.server 8097 в корне репозитория) и Chrome.
// Запуск:  node tools/channel_shots.mjs            — все сцены
//          node tools/channel_shots.mjs works      — одна сцена
//
// Chrome запускается без окна и с чистым профилем, управляется по DevTools Protocol
// (встроенный в Node WebSocket, без пакетов). На localhost калькулятор сам поднимает
// PRO-сессию разработчика (HC_LOCAL_DEV в app.js); окно входа, обучение, cookie-плашку
// и локальный переключатель тарифа прячем — на снимке их быть не должно.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'channel', 'img');
const SITE = process.env.SITE || 'http://localhost:8097/';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const W = 1440, H = 900;

const HIDE_CSS = `#auth_modal_overlay, #local_tariff_switch, #homeowner_hint, .contest-toast, #kp_fork_toast, .mobile-menu-backdrop,
    .tour-card, .tour-overlay, [id^=tour_], .hc-cookie-banner, #ai_parse_fab_btn, .toast, [class*=toast] { display: none !important; }`;
// Имя в шапке: на localhost это подставная учётка разработчика — в публичный пост её не несём
const NAME_JS = `document.querySelectorAll('span').forEach(e => { if (e.children.length === 0 && /Ibatullin/.test(e.textContent)) e.textContent = 'Мастер'; });`;

// Сцены: подготовка (JS в странице) и рамка снимка clip = [x, y, ширина, высота] в CSS-пикселях.
const AREA = `document.getElementById('inp_area').value = 150; app.setArea(150);
    if (app.state.fuels.indexOf('gas') < 0) { app.toggleFuel('gas'); app.toggleFuel('el'); }`;
const SCENES = {
    smeta:   { prep: AREA + `app.setViewMode('equipment');`, clip: [0, 0, 1440, 720] },
    works:   { prep: AREA + `app.setViewMode('works');`, clip: [380, 55, 1060, 790] },
    cheaper: { prep: AREA + `app.setViewMode('equipment'); if (!app.state.cheaper) document.getElementById('cheaper_wrapper').click();`, clip: [380, 55, 1060, 600] },
    rooms:   { prep: AREA + `app.setViewMode('equipment'); document.getElementById('mode_pro').click();`, clip: [0, 55, 1440, 420] },
    money:   { prep: AREA + `app.setViewMode('money');`, clip: [630, 210, 540, 530] }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cdp(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const wait = new Map();
    ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise((res, rej) => {
        const n = ++id;
        wait.set(n, m => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result));
        ws.send(JSON.stringify({ id: n, method, params }));
    });
    return { send, close: () => ws.close() };
}

async function main() {
    const only = process.argv[2];
    mkdirSync(OUT, { recursive: true });
    const profile = mkdtempSync(join(tmpdir(), 'hc-shots-'));
    const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
        '--no-first-run', '--hide-scrollbars', '--window-size=' + W + ',' + H, 'about:blank'], { stdio: 'ignore' });
    try {
        let target;
        for (let i = 0; i < 40 && !target; i++) {
            await sleep(250);
            try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page'); } catch (_) { }
        }
        if (!target) throw new Error('Chrome не отвечает на порту ' + PORT);
        const c = await cdp(target.webSocketDebuggerUrl);
        await c.send('Page.enable');
        await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
        await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
        const js = async expr => (await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

        // Первый заход — только чтобы записать настройки в localStorage этого источника
        await c.send('Page.navigate', { url: SITE });
        await sleep(2500);
        await js(`localStorage.setItem('cookieConsent','declined'); localStorage.setItem('tour_on','0');
            localStorage.setItem('tour_choice','1'); localStorage.setItem('tour_force_snooze', String(Date.now() + 864e5 * 30));
            localStorage.setItem('local_tariff','pro'); true`);

        for (const [name, sc] of Object.entries(SCENES)) {
            if (only && only !== name) continue;
            // каждая сцена — с чистой сметы: иначе «Бюджетнее» прошлой сцены остаётся включённым
            await js(`localStorage.removeItem('stout_save'); true`);
            await c.send('Page.navigate', { url: SITE });
            await sleep(3500);
            await js(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(HIDE_CSS)}; document.head.appendChild(s);
                document.body.classList.remove('auth-modal-open'); return true; })()`);
            await js(`(async () => { ${sc.prep} await new Promise(r => setTimeout(r, 1500)); window.scrollTo(0, 0); return true; })()`);
            await js(`(() => { ${NAME_JS} return true; })()`);
            await sleep(4000);   // всплывающие уведомления гаснут
            await js(`(() => { ${NAME_JS} return true; })()`);
            const clip = sc.clip ? { x: sc.clip[0], y: sc.clip[1], width: sc.clip[2], height: sc.clip[3], scale: 1 } : undefined;
            const shot = await c.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false });
            writeFileSync(join(OUT, name + '.png'), Buffer.from(shot.data, 'base64'));
            console.log('ok', name);
        }
        c.close();
    } finally {
        chrome.kill();
    }
}

main().catch(e => { console.error(e); process.exit(1); });
