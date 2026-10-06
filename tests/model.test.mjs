#!/usr/bin/env node
/**
 * FLOOD.EXE — model tests.
 *
 *   node tests/model.test.mjs
 *
 * The load-bearing test is the real-settled-round replay: every payload in
 * tests/fixtures/settled-sessions.json is the exact `gameState` a deployed FloodGame
 * committed, so decoding it and re-running the flood proves the JS model pays the same
 * area (and therefore the same band) the chain paid.
 *
 * The fixture is a byte-identical copy of
 * prototype/game/frontend/tests/fixtures/settled-sessions.json, vendored here so `npm test`
 * is self-contained (no dependency on the prototype tree).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SLUG, BANDS, EXPECTED_RTP_BPS, COLS, ROWS, CELLS, MIN_WIN_AREA,
  bandOf, outcome, makeRng, decodeGameState, floodOrder, colourOf, deriveCanvas,
  cellsFromField, floodArea, keccak256, bytesToHex, hexToBytes, bytesToBigInt,
} from '../game/model.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, 'fixtures/settled-sessions.json');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; return; }
  failed += 1;
  console.error('  FAIL:', msg);
}
function eq(a, b, msg) { assert(a === b, `${msg} (got ${a}, want ${b})`); }

// ------------------------------------------------------------------ 1. exports + paytable
eq(SLUG, 'flood-exe', 'SLUG');
eq(EXPECTED_RTP_BPS, 9472, 'EXPECTED_RTP_BPS');
eq(typeof bandOf, 'function', 'bandOf exported');
eq(typeof outcome, 'function', 'outcome exported');
eq(typeof makeRng, 'function', 'makeRng exported');
eq(COLS, 12, 'COLS'); eq(ROWS, 12, 'ROWS'); eq(CELLS, 144, 'CELLS');
eq(MIN_WIN_AREA, 30, 'MIN_WIN_AREA');

{
  let cursor = BANDS[0].min;
  for (const b of BANDS) {
    eq(b.min, cursor, `band tiles at ${cursor}`);
    assert(b.max >= b.min, `band ${b.min}-${b.max} ordered`);
    cursor = b.max + 1;
  }
  eq(cursor, CELLS + 1, 'bands tile 0..144 with no gap');
  for (let i = 1; i < BANDS.length; i += 1) assert(BANDS[i].mult >= BANDS[i - 1].mult, 'mults monotonic');
  for (const b of BANDS) {
    eq(bandOf(b.min), b.mult, `bandOf(${b.min})`);
    eq(bandOf(b.max), b.mult, `bandOf(${b.max})`);
  }
  eq(bandOf(29), 0, 'losing band at 29');
  eq(bandOf(30), 1.5, 'win floor at 30');
  eq(bandOf(144), 250, 'jackpot at the full canvas');
}

// ------------------------------------------------------------------ 2. keccak-256 vectors
{
  const enc = new TextEncoder();
  eq(bytesToHex(keccak256(new Uint8Array(0))), '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470', 'keccak256("")');
  eq(bytesToHex(keccak256(enc.encode('abc'))), '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45', 'keccak256("abc")');
  // 33-byte abi.encodePacked(word, 0x00) vector (independently produced by foundry `cast keccak`)
  const word = Uint8Array.from({ length: 32 }, (_, i) => i);
  const inp = new Uint8Array(33); inp.set(word, 0); inp[32] = 0;
  eq(bytesToHex(keccak256(inp)), '0x04caf61a4aed665edd973555dc456b431c1912f49df055330a58658b6b055c4f', 'keccak256(word||0x00)');

  // The permutation reuses one module-scratch state block across calls, so every call must
  // clear it. A missing reset shows up as a long (multi-block) call poisoning the next one.
  const long = new Uint8Array(136).fill(0xab);
  const longDigest = bytesToHex(keccak256(long));
  keccak256(long);
  eq(bytesToHex(keccak256(enc.encode('abc'))), '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45', 'a multi-block call does not poison the next digest');
  keccak256(new Uint8Array(0));
  eq(bytesToHex(keccak256(enc.encode('abc'))), '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45', 'an empty call does not poison the next digest');
  keccak256(long);
  eq(bytesToHex(keccak256(new Uint8Array(0))), '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470', 'a multi-block call does not poison the empty-input digest');
  eq(bytesToHex(keccak256(long)), longDigest, 'a repeated multi-block digest is call-history independent');
}

// ------------------------------------------------------------------ 3. contract derivation consistency
{
  // The fast byte-index canvas must equal the BigInt-field canvas, and the byte-scan start
  // must equal the contract's (stream >> 8i) & 0xff scan.
  const words = [
    '0x' + '00'.repeat(32),
    '0x' + 'ff'.repeat(32),
    '0x' + '0123456789abcdef'.repeat(4),
    '0xdeadbeefcafebabe00112233445566778899aabbccddeeff1020304050607080',
  ];
  for (const w of words) {
    const d = deriveCanvas(w);
    const cells = cellsFromField(d.field);
    eq(floodArea(cells, d.start), d.area, `deriveCanvas area agrees with cellsFromField for ${w.slice(0, 10)}`);
    // contract start scan
    const wb = hexToBytes(w);
    const in1 = new Uint8Array(33); in1.set(wb, 0); in1[32] = 1;
    const stream = bytesToBigInt(keccak256(in1));
    let bigStart = null;
    for (let i = 0; i < 32; i += 1) { const b = Number((stream >> BigInt(8 * i)) & 0xffn); if (b < CELLS) { bigStart = b; break; } }
    if (bigStart === null) {
      const in2 = new Uint8Array(33); in2.set(wb, 0); in2[32] = 2;
      const s2 = bytesToBigInt(keccak256(in2));
      for (let i = 0; i < 32; i += 1) { const b = Number((s2 >> BigInt(8 * i)) & 0xffn); if (b < CELLS) { bigStart = b; break; } }
    }
    if (bigStart === null) bigStart = 0;
    eq(d.start, bigStart, 'start-cell scan matches the contract');
  }
}

// ------------------------------------------------------------------ 4. purity + range
{
  const w = '0x' + 'a5'.repeat(32);
  const a = outcome(w);
  const b = outcome(w);
  eq(a.stat, b.stat, 'outcome is deterministic (stat)');
  eq(a.mult, b.mult, 'outcome is deterministic (mult)');
  eq(a.mult, bandOf(a.stat), 'outcome mult is bandOf(stat)');
  assert(a.stat >= 1 && a.stat <= CELLS, 'area within 1..144');
}

// ------------------------------------------------------------------ 5. real settled rounds
{
  assert(fs.existsSync(FIXTURE), `fixture exists: ${FIXTURE}`);
  const fj = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  assert(fj.sessions.length >= 3, 'fixture has at least 3 settled rounds');
  let replayed = 0;
  let maxArea = 0;
  let jackpotSeen = false;
  for (const s of fj.sessions) {
    const st = decodeGameState(s.gameState);
    eq(st.field, BigInt(s.expected.field), `session ${s.sessionId} field decodes`);
    eq(st.start, s.expected.start, `session ${s.sessionId} start decodes`);
    eq(st.area, s.expected.area, `session ${s.sessionId} area decodes`);
    const area = floodArea(cellsFromField(st.field), st.start);
    eq(area, s.expected.area, `session ${s.sessionId} flood replays to chain area`);
    const mult = bandOf(area);
    // The wager in every fixture round is 1e18: payout must equal mult * 1e18 exactly.
    eq(st.payout, BigInt(Math.round(mult * 1e18)), `session ${s.sessionId} payout matches the band`);
    assert(floodOrder(st.field, st.start).length === area, `session ${s.sessionId} floodOrder length == area`);
    replayed += 1;
    if (area > maxArea) maxArea = area;
    if (mult >= 250) jackpotSeen = true;
  }
  eq(replayed, fj.sessions.length, 'every fixture round replayed');
  console.log(`  [info] replayed ${replayed} real settled rounds; max area ${maxArea}; 250x jackpot present: ${jackpotSeen}`);
  // The shipped fixture contains no jackpot payload (max area 61). Recorded, not hidden.
  assert(!jackpotSeen, 'settled-sessions.json contains no 250x payload (max area 61) — the top tier is exercised by the pure boundary test below');
}

// ------------------------------------------------------------------ 6. jackpot boundary (pure, not a chain claim)
{
  // A full-canvas monochrome field floods 144 cells from any start => the 250x band.
  const allZero = 0n;
  const area = floodArea(cellsFromField(allZero), 0);
  eq(area, CELLS, 'all-zero canvas floods the full canvas');
  eq(bandOf(area), 250, 'full flood pays 250x');
}

// ------------------------------------------------------------------ 7. makeRng
{
  const seed = '0x' + '5a'.repeat(32);
  const w0 = makeRng(seed, 0);
  assert(/^0x[0-9a-f]{64}$/.test(w0), 'makeRng returns 32-byte hex');
  eq(makeRng(seed, 0), w0, 'makeRng deterministic');
  assert(makeRng(seed, 1) !== w0, 'adjacent rounds differ');
  // collision scan over the magnitudes the harness sweeps, incl. 2^52
  const starts = [1, 1_000_000, 1_000_000_000_000, 4_503_599_627_370_496];
  let collisions = 0;
  for (const start of starts) {
    const seen = new Set();
    for (let r = start; r < start + 50000; r += 1) {
      const w = makeRng(seed, r);
      if (seen.has(w)) collisions += 1;
      seen.add(w);
    }
  }
  eq(collisions, 0, 'makeRng has no collisions across 4 magnitude windows');
  // round indices > 2^32 must not wrap onto each other
  assert(makeRng(seed, 4294967296) !== makeRng(seed, 0), 'round 2^32 differs from round 0');
  // sampler output feeds outcome cleanly
  const st = outcome(makeRng(seed, 12345));
  assert(st.stat >= 1 && st.stat <= CELLS, 'sampled word yields a valid area');
}

// ------------------------------------------------------------------ 7b. deriveCanvas and outcome agree
// src/app.js derives its band from the canvas it already holds instead of calling
// outcome() a second time for the same word. That substitution is only sound if the
// two paths return the same area and the same band, which is what this asserts.
{
  const fj = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const seed = '0x' + '5a'.repeat(32);
  const probes = fj.sessions.map((s) => s.gameState.slice(0, 66));
  for (let r = 0; r < 200; r += 1) probes.push(makeRng(seed, r));
  for (const w of probes) {
    const c = deriveCanvas(w);
    const o = outcome(w);
    assert(o.stat === c.area, `deriveCanvas(w).area === outcome(w).stat for ${w.slice(0, 10)}`);
    assert(bandOf(c.area) === o.mult, `bandOf(deriveCanvas(w).area) === outcome(w).mult for ${w.slice(0, 10)}`);
  }
  eq(probes.length, fj.sessions.length + 200, 'agreement probed over every fixture round plus 200 sampler words');
}

// ------------------------------------------------------------------ 8. contract/model paytable parity (textual)
{
  const sol = fs.readFileSync(path.resolve(HERE, '../contracts/FloodGame.sol'), 'utf8');
  assert(/if \(area < 30\) return 0;/.test(sol), 'contract losing threshold is 30');
  assert(/if \(area < 40\) return 15e17;/.test(sol), 'contract 1.5x threshold is 40');
  assert(/if \(area < 50\) return 2e18;/.test(sol), 'contract 2x threshold is 50');
  assert(/if \(area < 60\) return 3e18;/.test(sol), 'contract 3x threshold is 60');
  assert(/if \(area < 80\) return 6e18;/.test(sol), 'contract 6x threshold is 80');
  assert(/return MAX_MULT_WAD;/.test(sol), 'contract 250x default');
  assert(/MAX_MULT_WAD = 250e18/.test(sol), 'contract max multiplier is 250x');
  assert(/EXPECTED_RTP_BPS = 9472/.test(sol), 'contract declares 9472 bps');
}

// ------------------------------------------------------------------ 9. UI copy + affordance (source-level regression guard)
// Catches the Wave-1 defects without a browser: an instruction that names a handler that does
// not exist, a host-gated control with no disabled affordance, and the meter off-by-one.
{
  const html = fs.readFileSync(path.resolve(HERE, '../index.html'), 'utf8');
  const css = fs.readFileSync(path.resolve(HERE, '../src/styles.css'), 'utf8');
  const appjs = fs.readFileSync(path.resolve(HERE, '../src/app.js'), 'utf8');

  // D1: no on-screen instruction may tell the user to click the canvas — it has no handler.
  assert(!/click\s+(?:a\s+)?cell/i.test(html), 'no "click a cell" instruction (the canvas is VRF-driven and has no handler)');
  assert(/class="statusbar"/.test(html), 'the status bar that carries the instruction is present');
  assert(/press DEMO/i.test(html), 'the instruction points at the DEMO control that actually works standalone');
  assert(!/board\.addEventListener\s*\(/.test(appjs), 'app.js attaches no input listener to #board');
  assert(!/\bboard\.on(?:click|pointerdown|mousedown|pointerup)\b/.test(appjs), 'app.js sets no inline board pointer handler');

  // D2: the host-gated #bet / #max must be visibly inert AND explained.
  assert(/\.retro-btn:disabled\s*\{[^}]*opacity\s*:\s*0?\.\d+/s.test(css), 'disabled buttons set a reduced opacity');
  assert(/\.retro-btn:disabled\s*\{[^}]*cursor\s*:\s*not-allowed/s.test(css), 'disabled buttons use cursor:not-allowed');
  assert(/\.retro-btn:disabled\s*\{[^}]*filter\s*:/s.test(css), 'disabled buttons desaturate (filter)');
  assert(/id="bet"[^>]*\bdisabled\b[^>]*aria-disabled="true"/.test(html), '#bet is aria-disabled while host-gated');
  assert(/id="max"[^>]*\bdisabled\b[^>]*aria-disabled="true"/.test(html), '#max is aria-disabled while host-gated');
  assert(/id="bet"[^>]*\btitle="[^"]+"/.test(html), '#bet carries a title explaining the host gate');
  assert(/id="max"[^>]*\btitle="[^"]+"/.test(html), '#max carries a title explaining the host gate');

  // F3: the inert tool palette / menu bar must carry no interactive affordance.
  assert(!/\.menubar\s+span:hover/.test(css), 'the decorative menu bar has no :hover highlight');
  assert(!/\.tool\.active/.test(css), 'the decorative toolbox has no pressed/selected state');
  assert(!/class="tool\s+\$\{/.test(appjs), 'the toolbox is generated without a state-dependent class');

  // F1: the meter total must equal the 144-cell board (no off-by-one).
  assert(/CELLS\s*-\s*80\b(?!\s*\+)/.test(appjs), 'the last meter band width is CELLS - 80 so the widths sum to CELLS');
  assert(!/CELLS\s*-\s*80\s*\+\s*1/.test(appjs), 'the old CELLS - 80 + 1 off-by-one is gone');
  assert(/id="cells-total">144</.test(html), 'index.html initialises the meter total to 144');

  // D6 (cont'd): the .betbar row must keep the fixed Chain Jam badge clickable. Raising the
  // whole .betbar container above the badge made its transparent box (and the hint text) eat the
  // clicks meant for the badge, leaving the badge dead at 320x568 bottom-scroll and 360x640.
  // The row must be pointer-transparent with ONLY its interactive children raised.
  assert(/\.betbar\s*\{[^}]*pointer-events\s*:\s*none/s.test(css), '.betbar is pointer-transparent (does not swallow badge clicks)');
  assert(/\.betbar\s*>\s*\*\s*\{[^}]*z-index\s*:\s*2147483001/s.test(css), '.betbar interactive children are raised above the badge');
  assert(/\.betbar\s*>\s*\*\s*\{[^}]*pointer-events\s*:\s*auto/s.test(css), '.betbar interactive children re-enable pointer events');
  assert(/\.betbar\s+\.hint\s*\{[^}]*pointer-events\s*:\s*none/s.test(css), 'the hint text does not intercept badge clicks');

  // The demo path must not run the outcome pipeline twice for one word: deriveCanvas
  // already carries the area, and outcome() would re-run keccak over the same bytes.
  assert(!/const\s*\{\s*stat\s*\}\s*=\s*outcome\(/.test(appjs), 'app.js does not re-derive the demo outcome');
  assert(!/\boutcome\b(?=[^'"]*from '\.\.\/game\/model\.mjs')/.test(appjs), 'app.js no longer imports outcome');
  assert(/const mult = bandOf\(canvas\.area\);/.test(appjs), 'app.js bands the canvas it already derived');
}

console.log(`\nmodel.test.mjs — ${passed} assertions passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('OK');
