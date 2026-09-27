#!/usr/bin/env node
/**
 * FLOOD.EXE — browser acceptance check (DevTools Protocol, NOT `chrome --dump-dom`).
 *
 *   node scripts/serve.mjs &            # dist/ on :8941
 *   node scripts/browser-check.mjs      # drives the served page in real headless Chrome
 *
 * WHY NOT `--dump-dom`: these pages run timers, so the process never reaches idle and the
 * dump hangs until killed. This drives the CDP directly over Node's global WebSocket.
 *
 * WHY THIS EXISTS: `connectGameToHost`'s `connection.promise` NEVER SETTLES when no host
 * answers. A page that awaited it before starting the demo renders dead. This asserts the
 * page still plays a full round with NO HOST attached.
 *
 * It checks: page loads + UI renders, DEMO runs, the round resolves, the flood animation
 * completes, the result text (cells painted + win/lose) is present and readable, and a
 * second DEMO press deals a NEW round (different canvas).
 *
 * A fresh, unauthenticated browser profile is used; nothing external is touched.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.CDP_PORT ?? 9334);
const URL_UNDER_TEST = process.env.URL ?? 'http://127.0.0.1:8941/';
const CHROME = process.env.CHROME || [
  '/home/eya/.agent-browser/browsers/chrome-154.0.8037.57/chrome',
  '/home/eya/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  '/usr/bin/google-chrome',
].find((p) => fs.existsSync(p));

if (!CHROME) {
  console.error('browser-check: no chrome binary found (set CHROME=/path/to/chrome)');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'floodexe-cdp-'));

function startChrome() {
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  return proc;
}

async function waitForDevtools(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('devtools did not come up');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      }
    });
    ws.addEventListener('error', (e) => reject(new Error('ws error: ' + (e.message ?? ''))));
    ws.addEventListener('open', () => resolve({
      send(method, params = {}) {
        id += 1;
        const myId = id;
        return new Promise((res, rej) => {
          pending.set(myId, { resolve: res, reject: rej });
          ws.send(JSON.stringify({ id: myId, method, params }));
        });
      },
      close() { ws.close(); },
    }));
  });
}

const evaluate = async (cdp, expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`page eval threw: ${r.exceptionDetails.text}`);
  return r.result?.value;
};

const CANVAS_HASH = `(() => {
  const b = document.getElementById('board');
  if (!b || b.classList.contains('hidden') || !b.width) return null;
  const c = b.getContext('2d');
  const d = c.getImageData(0, 0, b.width, b.height).data;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < d.length; i += 4) {
    h = Math.imul(h ^ d[i], 16777619) >>> 0;
    h = Math.imul(h ^ d[i + 1], 16777619) >>> 0;
    h = Math.imul(h ^ d[i + 2], 16777619) >>> 0;
  }
  return { hash: h, w: b.width, h: b.height };
})()`;

const RESULT = `(() => {
  const r = document.querySelector('#result-slot .result');
  if (!r) return null;
  return { cls: r.className, text: r.innerText.replace(/\\s+/g, ' ').trim() };
})()`;

const STATE = `(() => ({
  painted: document.getElementById('painted') ? document.getElementById('painted').textContent : null,
  cellsTotal: document.getElementById('cells-total') ? document.getElementById('cells-total').textContent : null,
  markerLeft: document.getElementById('meter-marker') ? document.getElementById('meter-marker').style.left : null,
  boardHidden: document.getElementById('board') ? document.getElementById('board').classList.contains('hidden') : true,
  demoLabel: document.getElementById('demo') ? document.getElementById('demo').textContent.trim() : null,
  hint: document.getElementById('conn-hint') ? document.getElementById('conn-hint').textContent.trim() : null,
}))()`;

async function waitFor(cdp, expr, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(cdp, expr);
    if (predicate(last)) return last;
    await sleep(120);
  }
  throw new Error(`timed out waiting for ${label}; last value = ${JSON.stringify(last)}`);
}

const results = [];
const pass = (msg) => { results.push(true); console.log(`  [PASS] ${msg}`); };
const fail = (msg) => { results.push(false); console.log(`  [FAIL] ${msg}`); };
const info = (msg) => console.log(`  [INFO] ${msg}`);

const chrome = startChrome();
let cdp = null;
try {
  const wsUrl = await waitForDevtools();
  cdp = await connect(wsUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  console.log(`\nFLOOD.EXE browser acceptance  (${URL_UNDER_TEST})`);
  console.log(`  chrome: ${CHROME}`);

  const served = await (await fetch(URL_UNDER_TEST)).text();
  served.includes('FLOOD.EXE') ? pass(`page served (${served.length} B html)`) : fail('served html does not contain FLOOD.EXE');

  await cdp.send('Page.navigate', { url: URL_UNDER_TEST });
  await waitFor(cdp, `document.title`, (t) => t && t.includes('FLOOD.EXE'), 10000, 'page title');
  const title = await evaluate(cdp, 'document.title');
  pass(`page loaded, title = ${JSON.stringify(title)}`);

  // Wait for src/app.js (deferred ES module) to initialise before interacting: it populates the
  // toolbox and the 6 meter bands synchronously at module top-level, before wiring the DEMO
  // listener. Reading/clicking before this races the module load.
  await waitFor(
    cdp,
    `(() => ({ tools: document.querySelectorAll('#toolbox .tool').length, bands: document.querySelectorAll('#meter-bands .meter-band').length }))()`,
    (v) => v && v.tools >= 6 && v.bands === 6,
    15000,
    'app module to initialise',
  );

  // UI renders: the shell, the DEMO control and the placeholder all exist.
  const ui = await evaluate(cdp, STATE);
  info(`UI: demo=${JSON.stringify(ui.demoLabel)} cellsTotal=${ui.cellsTotal} boardHidden=${ui.boardHidden}`);
  // The meter labels the inclusive cell range 0..144 (145 positions); the model's CELLS is 144.
  ui.demoLabel === 'DEMO' && Number(ui.cellsTotal) >= 144 ? pass('UI rendered (DEMO control + cell meter present)') : fail(`UI not rendered as expected: ${JSON.stringify(ui)}`);

  // Press DEMO.
  await evaluate(cdp, `document.getElementById('demo').click(), 'clicked'`);
  await waitFor(cdp, RESULT, (r) => r !== null, 15000, 'first round to resolve');
  const r1 = await evaluate(cdp, RESULT);
  const c1 = await waitFor(cdp, CANVAS_HASH, (c) => c !== null, 5000, 'first canvas');
  const s1 = await evaluate(cdp, STATE);
  info(`round 1 result: ${JSON.stringify(r1)}`);
  info(`round 1 canvas: hash=${c1.hash} ${c1.w}x${c1.h}; painted=${s1.painted}; marker=${s1.markerLeft}`);
  info(`round 1 hint: ${s1.hint}`);
  (r1.text && /(Paid|Only|JACKPOT)/.test(r1.text) && /cells/.test(r1.text))
    ? pass(`round 1 RESOLVED with readable result text: "${r1.text}"`)
    : fail(`round 1 result text not readable: ${JSON.stringify(r1)}`);
  (/^win|^lose|^jackpot/.test((r1.cls || '').replace('result ', '').trim()) )
    ? pass(`round 1 win/lose state rendered (class "${r1.cls}")`)
    : fail(`round 1 result class missing win/lose: ${r1.cls}`);
  (!s1.boardHidden && Number(s1.painted) > 0)
    ? pass(`flood animation completed over the canvas (painted=${s1.painted}, board visible)`)
    : fail(`canvas not painted: ${JSON.stringify(s1)}`);

  // Press DEMO again -> a NEW round (new canvas + new resolved result).
  await evaluate(cdp, `document.getElementById('demo').click(), 'clicked'`);
  await waitFor(cdp, `(() => { const r=document.querySelector('#result-slot .result'); return r ? true : false; })()`, (v) => v === false, 3000, 'result slot to clear')
    .catch(() => { /* the previous result may not clear before the animation finishes; the hash check below still proves a new deal */ });
  const c2 = await waitFor(cdp, CANVAS_HASH, (c) => c !== null && c.hash !== c1.hash, 15000, 'second (different) canvas');
  const r2 = await waitFor(cdp, RESULT, (r) => r !== null, 15000, 'second round to resolve');
  const s2 = await evaluate(cdp, STATE);
  info(`round 2 result: ${JSON.stringify(r2)}`);
  info(`round 2 canvas: hash=${c2.hash} (round 1 ${c1.hash}); painted=${s2.painted}`);
  (c2.hash !== c1.hash)
    ? pass(`pressing DEMO again dealt a NEW round (canvas hash changed ${c1.hash} -> ${c2.hash})`)
    : fail('second DEMO press did not change the canvas');
  (r2.text && /(Paid|Only|JACKPOT)/.test(r2.text) && /cells/.test(r2.text))
    ? pass(`round 2 RESOLVED with readable result text: "${r2.text}"`)
    : fail(`round 2 result text not readable: ${JSON.stringify(r2)}`);

  cdp.close();
} catch (err) {
  fail(`browser run error: ${err.message}`);
} finally {
  chrome.kill('SIGKILL');
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* profile is scratch */ }
}

const passed = results.filter(Boolean).length;
console.log(`\nbrowser-check — ${passed}/${results.length} checks passed`);
process.exit(results.length > 0 && passed === results.length ? 0 : 1);
