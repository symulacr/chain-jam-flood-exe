#!/usr/bin/env node
/**
 * FLOOD.EXE — Chain Jam badge overlap regression sweep (real headless Chrome, CDP).
 *
 *   node tests/badge-sweep.mjs                      # defaults to the deployed entry URL
 *   URL=http://127.0.0.1:8941/ node tests/badge-sweep.mjs
 *
 * WHY: the jam REQUIRES the fixed Chain Jam badge (`jam.chain.wtf/widget.js`, z-index
 * 2147483000, bottom-right). On small viewports it floated over the game's own controls
 * (`#plus5`, `#max`, `#demo` at 320x568), so a real click landed on the badge and opened the
 * jam page instead of the control (Wave-1 finding D6). This sweep is the regression guard:
 * for every viewport x scroll position it asserts
 *   (a) document.elementFromPoint(control centre) returns that control, never the badge, and
 *   (b) the badge never covers the visible canvas.
 *
 * It uses `mobile:false` device metrics so innerWidth/innerHeight equal the requested viewport
 * exactly; Chrome's `mobile:true` emulation mis-sizes the fixed badge against the visual
 * viewport (measured — see docs/verification.txt, WAVE 3).
 *
 * Not part of `npm test` (needs Chrome + network for the widget). Exit 0 = pass, 1 = overlap
 * found, 2 = environment/IO error.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const URL_UNDER = process.env.URL || process.argv.find((a) => a.startsWith('http')) || 'https://chain-jam-flood-exe.vercel.app/';
const CHROME = process.env.CHROME || [
  '/home/eya/.agent-browser/browsers/chrome-154.0.8037.57/chrome',
  '/home/eya/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  '/usr/bin/google-chrome',
].find((p) => fs.existsSync(p));
const VIEWPORTS = [
  { name: '320x568', w: 320, h: 568 },
  { name: '360x640', w: 360, h: 640 },
  { name: '390x700', w: 390, h: 700 },
  { name: '390x844', w: 390, h: 844 },
  { name: '768x1024', w: 768, h: 1024 },
];
const CONTROLS = ['#mute', '#wager', '#plus5', '#max', '#bet', '#demo'];

if (!CHROME) { console.error('badge-sweep: no chrome binary found (set CHROME=...)'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } });
    ws.addEventListener('error', (e) => reject(new Error('ws: ' + e.message)));
    ws.addEventListener('open', () => resolve({ send(method, params = {}) { id += 1; const my = id; return new Promise((res, rej) => { pending.set(my, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: my, method, params })); }); }, close: () => ws.close() }));
  });
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'floodexe-badge-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let port = null;
chrome.stderr.on('data', (d) => { const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(String(d)); if (m && !port) port = Number(m[1]); });

let failures = 0;
let canvasCovered = 0;
let badgeDead = 0;
let skipped = false;
try {
  for (let i = 0; i < 150 && !port; i += 1) await sleep(200);
  if (!port) throw new Error('devtools never came up');
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const cdp = await connect(list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl).webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const ev = async (e) => { const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result?.value; };

  console.log(`\nFLOOD.EXE badge-overlap sweep  (${URL_UNDER})`);
  for (const vp of VIEWPORTS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: URL_UNDER });
    await sleep(2500);
    let haveBadge = false;
    for (let i = 0; i < 30; i += 1) { if (await ev("!!document.getElementById('chain-jam-badge')")) { haveBadge = true; break; } await sleep(250); }
    if (!haveBadge) { console.log(`  ${vp.name}: SKIP (jam badge did not load — no network?)`); skipped = true; continue; }
    await ev("document.getElementById('demo').click(), 'x'"); // reveal the canvas for the overlap check
    await sleep(2600);
    const dims = await ev('({ sh: document.documentElement.scrollHeight, ih: innerHeight })');
    const maxScroll = Math.max(0, dims.sh - dims.ih);
    const scrolls = [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * maxScroll)))];
    for (const block of ['end', 'center', 'nearest']) {
      for (const sel of CONTROLS) {
        const y = await ev(`(() => { const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return null; el.scrollIntoView({block:${JSON.stringify(block)}}); return Math.round(scrollY); })()`);
        if (y != null && !scrolls.includes(y)) scrolls.push(y);
      }
    }
    scrolls.sort((a, b) => a - b);
    let vpFails = 0;
    for (const sy of scrolls) {
      await ev(`window.scrollTo(0, ${sy})`); await sleep(180);
      const r = await ev(`(() => {
        const vv = { w: (visualViewport && visualViewport.width) || innerWidth, h: (visualViewport && visualViewport.height) || innerHeight };
        const out = { controls: [], canvas: null, scrollY: Math.round(scrollY) };
        for (const sel of ${JSON.stringify(CONTROLS)}) {
          const el = document.querySelector(sel); if (!el) continue;
          const b = el.getBoundingClientRect();
          const onScreen = (b.x + b.width / 2) >= 0 && (b.x + b.width / 2) <= vv.w && (b.y + b.height / 2) >= 0 && (b.y + b.height / 2) <= vv.h && b.width > 0 && b.height > 0;
          if (!onScreen) continue;
          const t = document.elementFromPoint(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2));
          out.controls.push({ sel, ok: t === el || (t && el.contains(t)), topId: t && t.id, badge: !!(t && t.closest && t.closest('#chain-jam-badge')) });
        }
        const board = document.getElementById('board');
        if (board && !board.className.includes('hidden')) {
          const b = board.getBoundingClientRect();
          if (b.bottom > 0 && b.top < vv.h && b.right > 0 && b.left < vv.w && b.width > 0) {
            const pts = [[b.left + 4, b.top + 4], [b.right - 4, b.top + 4], [b.left + 4, b.bottom - 4], [b.right - 4, b.bottom - 4], [b.left + b.width / 2, b.top + b.height / 2]].filter(([x, y]) => x >= 0 && x <= vv.w && y >= 0 && y <= vv.h);
            const hits = pts.map(([x, y]) => { const t = document.elementFromPoint(Math.round(x), Math.round(y)); return { badge: !!(t && t.closest && t.closest('#chain-jam-badge')) }; });
            out.canvas = { badgeCoversCanvas: hits.some((h) => h.badge) };
          }
        }
        // The badge itself must stay clickable: the raised .betbar row/label must not swallow
        // the whole badge (that would leave the required Chain Jam link dead). Fraction 0 == dead.
        {
          const b = document.getElementById('chain-jam-badge');
          if (b) {
            const br = b.getBoundingClientRect();
            let tot = 0, hit = 0;
            for (let y = Math.round(br.top) + 2; y < Math.round(br.bottom) - 1; y += 3) for (let x = Math.round(br.left) + 2; x < Math.round(br.right) - 1; x += 8) { tot += 1; const t = document.elementFromPoint(x, y); if (t && (t === b || b.contains(t))) hit += 1; }
            out.badge = { total: tot, hit, fraction: tot ? +(hit / tot).toFixed(3) : null };
          }
        }
        return out;
      })()`);
      for (const c of r.controls) if (!c.ok) { failures += 1; vpFails += 1; console.log(`  FAIL ${vp.name}@scrollY=${sy}: ${c.sel} centre hits ${c.topId || '(badge descendant)'} (badge=${c.badge})`); }
      if (r.canvas && r.canvas.badgeCoversCanvas) { canvasCovered += 1; vpFails += 1; console.log(`  FAIL ${vp.name}@scrollY=${sy}: badge covers the canvas`); }
      if (r.badge && r.badge.fraction === 0) { badgeDead += 1; vpFails += 1; console.log(`  FAIL ${vp.name}@scrollY=${sy}: Chain Jam badge is 0% clickable (fully covered by the bet bar)`); }
    }
    console.log(`  ${vp.name}: ${scrolls.length} scroll positions, ${vpFails} overlap(s)`);
  }
  cdp.close();
} catch (err) {
  console.error('badge-sweep error:', err.message);
  process.exitCode = 2;
} finally {
  chrome.kill('SIGKILL');
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* scratch */ }
}

if (process.exitCode !== 2) {
  console.log(`\nbadge-sweep — control-under-badge ${failures}, badge-covers-canvas ${canvasCovered}, badge-dead ${badgeDead}${skipped ? ' (some viewports skipped)' : ''}`);
  console.log(failures === 0 && canvasCovered === 0 && badgeDead === 0 ? 'OK' : 'FAIL');
  process.exitCode = failures === 0 && canvasCovered === 0 && badgeDead === 0 ? 0 : 1;
}
