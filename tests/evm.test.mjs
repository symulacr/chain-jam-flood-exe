#!/usr/bin/env node
/**
 * FLOOD.EXE — EVM-level test: the contract deployed on a real EVM.
 *
 *   node tests/evm.test.mjs      (wired into `npm test`)
 *
 * The other test files assert the SHIPPED source and the pure-JS model; this one compiles
 * FloodGame.sol, deploys it on a throwaway anvil and drives the real host lifecycle, so a
 * model↔bytecode divergence in the keccak canvas / flood fill / paytable cannot pass silently:
 *   - onRandomness derives the same field, start cell and flooded area as the model;
 *   - the settled payout is the contract's own multiplier for that area.
 *
 * Needs `solc`, `anvil`, `cast`. SKIPS cleanly (exit 0) when they are absent.
 * Scratch only: a private anvil on a non-harness port; no repo file is written; the deploy key is
 * read from anvil's own output (no key material in the repo).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deriveCanvas } from '../game/model.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const PORT = Number(process.env.FLOOD_EVM_PORT || 8998);
const RPC = `http://127.0.0.1:${PORT}`;
const CTX_SIG = '(uint256,address,address,uint256,uint256,uint256,uint32,bytes,bytes)';
const WAGER = 1000000000000000000n;
// A word whose flood reaches the 250x jackpot band (area 86) per docs/adversarial.md.
const WORD = '0xbde7bbbb82bf6a2059db18a5f6c199045a13a6d14db1d3458050dd811a3cbd70';

const have = (bin) => !spawnSync(bin, ['--version'], { encoding: 'utf8' }).error;
if (!have('solc') || !have('anvil') || !have('cast')) {
  console.log('flood-exe EVM test');
  console.log('  [info] solc/anvil/cast not all on PATH — SKIP');
  process.exit(0);
}

let pass = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (err) { console.log(`  FAIL ${name}: ${err.message}`); process.exitCode = 1; }
};
const sh = (bin, args) => { const r = spawnSync(bin, args, { encoding: 'utf8' }); if (r.error) throw r.error; return r; };
const w = (hex, i) => { const t = String(hex).replace(/^0x/, '').slice(i * 64, i * 64 + 64); return t.length === 64 ? BigInt('0x' + t) : 0n; };
const ethCall = async (to, data) => {
  const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) });
  const j = await res.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
};
const ctx = (gameData, gameState) =>
  `(1,0x0000000000000000000000000000000000000001,0x0000000000000000000000000000000000000002,` +
  `${WAGER},${WAGER},0,0,${gameData},${gameState})`;
// the contract's own paytable, mirrored
const multWad = (area) => area < 30 ? 0n : area < 40 ? 1500000000000000000n : area < 50 ? 2000000000000000000n
  : area < 60 ? 3000000000000000000n : area < 80 ? 6000000000000000000n : 250n * 10n ** 18n;

console.log('flood-exe EVM test (compile + deploy + host lifecycle)');

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-evm-'));
const c = sh('solc', ['--optimize', '--bin', '-o', out, path.join(ROOT, 'contracts', 'FloodGame.sol')]);
if (c.status !== 0) throw new Error(`solc: ${c.stderr}`);
const bin = fs.readFileSync(path.join(out, 'FloodGame.bin'), 'utf8').trim();

const anvil = spawn('anvil', ['--port', String(PORT), '--chain-id', '31345'], { stdio: ['ignore', 'pipe', 'ignore'] });
let bootLog = '';
anvil.stdout.on('data', (d) => { bootLog += d.toString(); });
const waitKey = async () => {
  for (let i = 0; i < 100; i++) { const m = bootLog.match(/\b0x[0-9a-fA-F]{64}\b/); if (m) return m[0]; await new Promise(r => setTimeout(r, 100)); }
  return null;
};

try {
  for (let i = 0; i < 100; i++) { try { await ethCall('0x0000000000000000000000000000000000000000', '0x'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  const key = await waitKey();
  if (!key) throw new Error('anvil printed no development key');
  const receipt = JSON.parse(sh('cast', ['send', '--json', '--rpc-url', RPC, '--private-key', key, '--create', bin]).stdout);
  const addr = receipt.contractAddress || (receipt.receipt && receipt.receipt.contractAddress);
  console.log(`  [info] FloodGame deployed at ${addr}`);

  const model = deriveCanvas(WORD);
  const settled = await ethCall(addr, sh('cast', ['calldata', `onRandomness(${CTX_SIG},bytes32)`, ctx('0x', '0x'), WORD]).stdout.trim());

  test('onRandomness derives the model field (keccak canvas)', () => {
    if (w(settled, 8) !== model.field) throw new Error(`field ${w(settled, 8)} != model ${model.field}`);
  });
  test('onRandomness picks the model start cell (rejection sampling)', () => {
    if (Number(w(settled, 9)) !== model.start) throw new Error(`start ${w(settled, 9)} != model ${model.start}`);
  });
  test('onRandomness floods the model area', () => {
    if (Number(w(settled, 10)) !== model.area) throw new Error(`area ${w(settled, 10)} != model ${model.area}`);
  });
  test('the settled payout is the contract multiplier for that area', () => {
    const expected = (WAGER * multWad(model.area)) / 10n ** 18n;
    if (w(settled, 11) !== expected) throw new Error(`payout ${w(settled, 11)} != ${expected}`);
  });
  test('the chosen word exercises a non-zero band (area > 0)', () => {
    if (!(model.area > 0)) throw new Error('word produced area 0 — pick a word that reaches a paying band');
  });
} finally {
  anvil.kill('SIGKILL');
  fs.rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed (EVM)`);
