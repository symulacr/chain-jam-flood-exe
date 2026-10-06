import {
  SLUG, COLS, ROWS, CELLS, MIN_WIN_AREA,
  bandOf, decodeGameState, floodOrder, colourOf, deriveCanvas, bytesToHex,
} from '../game/model.mjs';
import { SessionPhase, computeMaxWager, connectGameToHost, observeGameContentSize } from './sdk/guest.mjs';

const CELL_PX = 26;
const MAX_MULTIPLIER_X = 250;
const INK = '#d94f3d';
const PAPER_A = '#f5d76e';
const PAPER_B = '#3b6ea5';
const GRID = 'rgba(0,0,0,0.10)';

const $ = (id) => document.getElementById(id);
const board = $('board');
const placeholder = $('placeholder');

// ---------------------------------------------------------------- chrome bits
const TOOLS = ['bucket', 'pencil', 'brush', 'eraser', 'line', 'spray'];
function toolIcon(kind) {
  const svg = (inner) => `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">${inner}</svg>`;
  switch (kind) {
    case 'bucket': return svg('<path d="M3 6 L8 1 L13 6 L8 11 Z" fill="#d94f3d" stroke="#000"/><path d="M8 11 L8 13" stroke="#000"/><circle cx="11.5" cy="10.5" r="1.6" fill="#3b6ea5" stroke="#000" stroke-width="0.6"/>');
    case 'pencil': return svg('<path d="M2 12 L4 11 L12 3 L10 1 L2 9 Z" fill="#f5d76e" stroke="#000"/>');
    case 'brush': return svg('<path d="M3 11 C6 11 8 9 8 6 L11 3 L12 4 L9 7 C9 10 6 12 3 12 Z" fill="#c0c0c0" stroke="#000"/>');
    case 'eraser': return svg('<rect x="2" y="5" width="10" height="6" fill="#ff9ecb" stroke="#000"/>');
    case 'line': return svg('<path d="M2 12 L12 2" stroke="#000"/>');
    default: return svg('<circle cx="7" cy="7" r="4" fill="none" stroke="#000"/><circle cx="10.4" cy="4" r="0.9" fill="#000"/><circle cx="11.6" cy="7.4" r="0.9" fill="#000"/>');
  }
}
// Decorative tool palette only: it has no handlers and is not focusable, so it carries no
// pressed/selected state and no tooltip affordance.
$('toolbox').innerHTML = TOOLS.map((t) => `<div class="tool">${toolIcon(t)}</div>`).join('');

// territory meter: bands tile the painted axis 0..CELLS (144 unit widths == 144 cells)
{
  const widths = [30, 10, 10, 10, 20, CELLS - 80];
  const total = widths.reduce((a, b) => a + b, 0);
  const labels = ['no win', '1.5x', '2x', '3x', '6x', '250x'];
  $('meter-bands').innerHTML = widths.map((w, i) =>
    `<div class="meter-band ${i === 0 ? 'lose' : 'b' + i}" style="width:${(w / total) * 100}%">${labels[i]}</div>`).join('');
  $('min-win').textContent = String(MIN_WIN_AREA);
  $('cells-total').textContent = String(total);
}

// ---------------------------------------------------------------- sound (oscillators, no files)
let muted = false;
let audioCtx = null;
function ensureAudio() {
  if (muted) return null;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch { return null; }
}
function blip(freq, ms, type = 'square', gain = 0.035, delay = 0) {
  const play = () => {
    const ctx = ensureAudio();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type; osc.frequency.value = freq; amp.gain.value = gain;
    const t0 = ctx.currentTime;
    amp.gain.setValueAtTime(gain, t0);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + ms / 1000);
  };
  if (delay > 0) window.setTimeout(play, delay); else play();
}
const sound = {
  tick: () => blip(680, 28, 'square', 0.016),
  win: () => [523, 659, 784].forEach((f, i) => blip(f, 150, 'triangle', 0.05, i * 80)),
  big: () => [523, 659, 784, 1046, 1318].forEach((f, i) => blip(f, 190, 'triangle', 0.055, i * 75)),
  lose: () => { blip(180, 200, 'sawtooth', 0.045); blip(110, 240, 'sawtooth', 0.04, 130); },
};
$('mute').addEventListener('click', () => {
  muted = !muted;
  $('mute').textContent = muted ? '\u{1F507}' : '\u{1F50A}';
});

// ---------------------------------------------------------------- canvas
const ctx = board.getContext('2d');
function drawBoard(field, order, painted, start) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = COLS * CELL_PX;
  if (board.width !== Math.round(size * dpr)) {
    board.width = Math.round(size * dpr);
    board.height = Math.round(size * dpr);
    board.style.width = size + 'px';
    board.style.height = size + 'px';
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const filled = new Set(order.slice(0, painted));
  for (let i = 0; i < CELLS; i += 1) {
    const x = (i % COLS) * CELL_PX;
    const y = Math.floor(i / COLS) * CELL_PX;
    ctx.fillStyle = filled.has(i) ? INK : (colourOf(field, i) === 1 ? PAPER_B : PAPER_A);
    ctx.fillRect(x, y, CELL_PX, CELL_PX);
    ctx.strokeStyle = GRID;
    ctx.strokeRect(x + 0.5, y + 0.5, CELL_PX - 1, CELL_PX - 1);
  }
  const sx = (start % COLS) * CELL_PX + CELL_PX / 2;
  const sy = Math.floor(start / COLS) * CELL_PX + CELL_PX / 2;
  ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(sx, sy, CELL_PX * 0.3, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1; ctx.strokeStyle = '#000000';
  ctx.beginPath(); ctx.arc(sx, sy, CELL_PX * 0.3, 0, Math.PI * 2); ctx.stroke();
}

function setPainted(n) {
  const total = CELLS;
  $('painted').textContent = String(n);
  $('status-painted').textContent = String(n);
  $('meter-marker').style.left = `calc(${Math.min(100, (n / total) * 100)}% - 1px)`;
}

// ---------------------------------------------------------------- reveal (the ONE render path)
let round = null;
let animTimer = 0;

function renderResult(area, payoutText, source) {
  const mult = bandOf(area);
  const kind = mult >= 250 ? 'jackpot' : mult > 0 ? 'win' : 'lose';
  const icon = mult > 0 ? '!' : '\u00D7';
  const headline = mult >= 250
    ? 'JACKPOT — the flood ate the picture!'
    : mult > 0
      ? `Paid ${mult}x on ${area} cells`
      : `Only ${area} cells — the paint ran out`;
  const detail = payoutText
    ? `Payout <span class="amount">${payoutText}</span> on a ${mult}x hit.`
    : `You needed ${MIN_WIN_AREA} cells to win. Try a bigger splash.`;
  $('result-slot').innerHTML =
    `<div class="result ${kind}"><div class="icon" aria-hidden="true">${icon}</div>` +
    `<div class="body"><div class="headline">${headline}</div><div class="detail">${detail}</div></div></div>`;
  if (mult >= 250) sound.big(); else if (mult > 0) sound.win(); else sound.lose();
  void source;
}

/**
 * The single reveal path used by BOTH the demo and the embedded game.
 * `field`, `start`, `area` come from model.mjs (demo: deriveCanvas/outcome; embed:
 * decodeGameState of the contract's settled gameState).
 */
function reveal({ field, start, area, order, payoutText }) {
  window.clearInterval(animTimer);
  round = { field, start, area };
  board.classList.remove('hidden');
  placeholder.classList.add('hidden');
  $('result-slot').innerHTML = '';
  const ord = order || floodOrder(field, start);
  let painted = 0;
  setPainted(0);
  drawBoard(field, ord, 0, start);
  const stepMs = Math.max(9, Math.min(70, Math.round(900 / Math.max(ord.length, 1))));
  animTimer = window.setInterval(() => {
    painted += 1;
    if (painted % 5 === 0) sound.tick();
    if (painted >= ord.length) {
      window.clearInterval(animTimer);
      setPainted(ord.length);
      drawBoard(field, ord, ord.length, start);
      renderResult(area, payoutText, 'reveal');
      return;
    }
    setPainted(painted);
    drawBoard(field, ord, painted, start);
  }, stepMs);
}

function resetBoard() {
  window.clearInterval(animTimer);
  round = null;
  board.classList.add('hidden');
  placeholder.classList.remove('hidden');
  $('result-slot').innerHTML = '';
  setPainted(0);
}

// ---------------------------------------------------------------- demo path
function demoRound() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const word = bytesToHex(bytes);
  // The demo runs the SAME model the harness verifies: deriveCanvas.
  const canvas = deriveCanvas(word);
  const mult = bandOf(canvas.area);
  const payoutText = mult > 0 ? `demo ${mult}x (no money)` : null;
  reveal({ field: canvas.field, start: canvas.start, area: canvas.area, payoutText });
}
$('demo').addEventListener('click', demoRound);

// ---------------------------------------------------------------- embed path
let hostApi = null;
let snapshot = null;
let busy = false;
let pendingKey = null;
let handled = new Set();
let connected = false;
let decimals = 18;

// The host bridge is best-effort: if it cannot even initialise, the standalone demo must still run.
let connection = null;
try {
  connection = connectGameToHost({
    async setState(next) { onSnapshot(next); },
  });
  connection.promise.then((api) => {
    connected = true;
    hostApi = api;
    observeGameContentSize(api);
    setHint('Connected to the host. Set a wager and hit BET — the canvas comes from Chain\u2019s VRF.');
    $('ph-title').textContent = 'Pick a wager, then hit BET.';
    updateBetState();
    if (snapshot) onSnapshot(snapshot);
  }).catch(() => {
    // No host answered: keep working as a standalone demo.
    setHint('Standalone demo — nothing is wagered here. The real game runs inside the Chain.wtf host, where every canvas comes from Chain\u2019s VRF.');
  });
} catch {
  // The host handshake threw before it could register: stay a working standalone demo.
  setHint('Standalone demo — press DEMO to watch a canvas flood. The real game runs inside the Chain.wtf host.');
}
// If no host handshake lands shortly, make sure the demo path is obvious (never hang).
window.setTimeout(() => { if (!connected) setHint('Standalone demo — press DEMO to watch a canvas flood. The real game runs inside the Chain.wtf host.'); }, 1600);
window.addEventListener('beforeunload', () => { try { if (connection) connection.destroy(); } catch { /* host may be gone */ } });

function setHint(text) { $('conn-hint').textContent = text; }

function formatUnits(value, d) {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const base = 10n ** BigInt(d);
  const whole = v / base;
  const frac = (v % base).toString().padStart(d, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

function parseUnits(text, d) {
  const clean = String(text).trim();
  if (!/^\d*(\.\d*)?$/.test(clean) || clean === '' || clean === '.') return 0n;
  const [w, f = ''] = clean.split('.');
  return BigInt(w || '0') * 10n ** BigInt(d) + BigInt((f + '0'.repeat(d)).slice(0, d) || '0');
}

function onSnapshot(next) {
  snapshot = next;
  if (!next) return;
  decimals = next.token?.decimals ?? 18;
  const items = (next.sessions && next.sessions.items) || [];

  // balance / pot
  const rawBal = next.balances?.smartVaultBalance;
  let bal = null;
  try { bal = rawBal != null ? BigInt(rawBal) : null; } catch { bal = null; }
  $('status-pot').textContent = bal != null ? formatUnits(bal, decimals) : '—';
  $('max').disabled = bal == null;
  $('max').setAttribute('aria-disabled', String(bal == null));
  // Re-evaluate the BET gate on EVERY snapshot.
  // It was previously evaluated once, when the bridge resolved — at which point `snapshot` is still
  // null, so `walletReady()` was false and the gate latched shut. The result, measured against a
  // real host in a browser: BET stayed disabled forever and a hosted player could never wager,
  // even though the pot was updating from live host data. Found by driving the host, not by reading.
  updateBetState();

  // pending bet settlement
  if (pendingKey) {
    const row = items.find((it) => it.sessionKey === pendingKey);
    if (row && (row.isSettled || row.phase === SessionPhase.SETTLED)) {
      pendingKey = null; busy = false; updateBetState(); revealFromRow(row); return;
    }
    if (row && row.phaseName === 'CANCELLED') {
      pendingKey = null; busy = false; updateBetState();
      noteResult('The host cancelled the round and refunded your stake.');
      return;
    }
    return;
  }
  if (!round && items.length > 0) {
    const settled = items.filter((it) => it.isSettled && it.raw && it.raw.gameState).slice(-1)[0];
    if (settled && !handled.has(settled.sessionId)) {
      handled.add(settled.sessionId);
      revealFromRow(settled);
    }
  }
}

function revealFromRow(row) {
  if (!row.raw || !row.raw.gameState) return;
  try {
    const st = decodeGameState(row.raw.gameState);
    const payoutText = st.payout > 0n ? `${formatUnits(st.payout, decimals)} chUSD` : null;
    reveal({ field: st.field, start: st.start, area: st.area, payoutText });
  } catch { /* a malformed row is ignored rather than hanging the UI */ }
}

function noteResult(message) {
  $('result-slot').innerHTML =
    '<div class="result lose"><div class="icon" aria-hidden="true">i</div>' +
    `<div class="body"><div class="headline">FLOOD.EXE</div><div class="detail">${message}</div></div></div>`;
}

function currentMaxWager() {
  if (!snapshot) return null;
  const res = computeMaxWager(snapshot, { maxMultiplierX: MAX_MULTIPLIER_X });
  const rawBal = snapshot.balances?.smartVaultBalance;
  let bal = null;
  try { bal = rawBal != null ? BigInt(rawBal) : null; } catch { bal = null; }
  if (res.kind === 'limit') return bal != null && bal < res.maxWager ? bal : res.maxWager;
  return bal;
}

function walletReady() { return snapshot && snapshot.wallet && snapshot.wallet.status === 'ready'; }

function updateBetState() {
  const off = !(hostApi && walletReady() && !busy);
  $('bet').disabled = off;
  $('bet').setAttribute('aria-disabled', String(off));
}

$('wager').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/[^0-9.]/g, ''); });
$('plus5').addEventListener('click', () => { $('wager').value = String((Number($('wager').value) || 0) + 5); });
$('max').addEventListener('click', () => {
  const m = currentMaxWager();
  if (m != null) $('wager').value = formatUnits(m, decimals);
});

$('bet').addEventListener('click', async () => {
  if (!hostApi || !snapshot) return;
  const amount = parseUnits($('wager').value || '0', decimals);
  if (amount <= 0n) { noteResult('Enter a wager first — the bucket needs something to spill.'); return; }
  const m = currentMaxWager();
  if (m != null && amount > m) { noteResult(`That wager is over the house limit right now (${formatUnits(m, decimals)}).`); return; }
  busy = true; updateBetState();
  $('result-slot').innerHTML = '';
  setHint('Dealing a canvas\u2026 waiting for Chain\u2019s VRF to paint the picture.');
  try {
    const { sessionKey } = await hostApi.openSession({ wager: amount.toString(), gameData: '0x' });
    pendingKey = sessionKey;
    sound.tick();
    window.setTimeout(() => {
      if (pendingKey === sessionKey) {
        pendingKey = null; busy = false; updateBetState();
        noteResult('No settlement came back in time. The host will settle or cancel that round and refund the stake.');
      }
    }, 90000);
  } catch (err) {
    busy = false; pendingKey = null; updateBetState();
    noteResult(`The house refused the wager: ${String(err && err.message ? err.message : err).slice(0, 160)}`);
  }
});

// Initial idle state.
setPainted(0);
