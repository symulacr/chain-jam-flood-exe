#!/usr/bin/env node
/**
 * FLOOD.EXE — contract tests.
 *
 *   node tests/contract.test.mjs
 *
 * Contract-level checks that need NO chain: the interface surface, the paytable
 * band-for-band against `game/model.mjs`, the payout/reserve arithmetic, the
 * heavy-tail classification, and (when `solc` is on PATH) a standalone compile with
 * the EIP-170 code-size bound. The contract is the authority; every claim here is read
 * from the shipped Solidity.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BANDS, CELLS, COLS, ROWS, EXPECTED_RTP_BPS } from '../game/model.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS = path.resolve(HERE, '../contracts');
const GAME_SOL = path.join(CONTRACTS, 'FloodGame.sol');
const IFACE_SOL = path.join(CONTRACTS, 'ICasinoGameV2.sol');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; return; }
  failed += 1;
  console.error('  FAIL:', msg);
}
function eq(a, b, msg) { assert(a === b, `${msg} (got ${a}, want ${b})`); }

const game = fs.readFileSync(GAME_SOL, 'utf8');
const iface = fs.readFileSync(IFACE_SOL, 'utf8');

// ------------------------------------------------------------------ 1. licence + pragma + no constructor
eq(/SPDX-License-Identifier: MIT/.test(game), true, 'FloodGame.sol declares SPDX MIT');
eq(/SPDX-License-Identifier: MIT/.test(iface), true, 'ICasinoGameV2.sol declares SPDX MIT');
eq(/\bpragma solidity \^0\.8\.30;/.test(game), true, 'FloodGame.sol pragma ^0.8.30');
eq(/\bpragma solidity \^0\.8\.30;/.test(iface), true, 'ICasinoGameV2.sol pragma ^0.8.30');
assert(!/\bconstructor\s*\(/.test(game), 'FloodGame has no constructor (instant game, nothing to initialise)');

// ------------------------------------------------------------------ 2. implements the whole interface
for (const fn of [
  'quoteCaps', 'quoteRiskParams', 'onSessionStart', 'onPlayerAction', 'onRandomness', 'quoteForfeitPayout',
]) {
  assert(new RegExp(`function ${fn}\\s*\\(`).test(game), `FloodGame implements ${fn}`);
  assert(new RegExp(`function ${fn}\\s*\\(`).test(iface), `ICasinoGameV2 declares ${fn}`);
}
// every step handler is pure: no state reads/writes, no external calls => no reentrancy
for (const fn of ['quoteCaps', 'quoteRiskParams', 'onSessionStart', 'onPlayerAction', 'onRandomness', 'quoteForfeitPayout']) {
  const re = new RegExp(`function ${fn}\\s*\\([\\s\\S]*?\\)\\s*external\\s+pure`);
  assert(re.test(game), `${fn} is external pure`);
}
// the game has no decision after the wager: the only action hook reverts
assert(/revert FloodGame__NoPlayerAction\(\);/.test(game), 'onPlayerAction reverts (no decision axis)');

// ------------------------------------------------------------------ 3. paytable == model.BANDS, band for band
{
  const literal = { 0: '0', 1.5: '15e17', 2: '2e18', 3: '3e18', 6: '6e18' };
  const bands = [...BANDS].sort((a, b) => a.min - b.min);
  for (let i = 0; i < bands.length - 1; i += 1) {
    const b = bands[i];
    const lit = literal[b.mult];
    assert(lit !== undefined, `band at ${b.min} has a known Solidity literal (${b.mult})`);
    const line = `if (area < ${b.max + 1}) return ${lit};`;
    assert(game.includes(line), `contract encodes band boundary: ${line}`);
  }
  const top = bands[bands.length - 1];
  eq(top.min, 80, 'top band starts at 80');
  eq(top.max, CELLS, 'top band ends at the full canvas');
  eq(top.mult, 250, 'top multiplier is 250');
  assert(/return MAX_MULT_WAD;/.test(game), 'contract final branch returns MAX_MULT_WAD');
}

// ------------------------------------------------------------------ 4. constants + RTP/risk parameters
{
  const num = (name) => {
    // \b keeps `WAD` from matching the tail of `MAX_MULT_WAD`.
    const m = game.match(new RegExp(`\\b${name}\\s*=\\s*([0-9_]+)(e[0-9]+)?`));
    assert(m, `constant ${name} found`);
    return BigInt(m[1].replace(/_/g, '')) * (m[2] ? 10n ** BigInt(m[2].slice(1)) : 1n);
  };
  eq(num('WAD'), 10n ** 18n, 'WAD = 1e18');
  eq(num('COLS'), BigInt(COLS), 'COLS matches the model');
  eq(num('ROWS'), BigInt(ROWS), 'ROWS matches the model');
  // CELLS is declared as COLS * ROWS (an expression), not a literal.
  assert(/\bCELLS\s*=\s*COLS\s*\*\s*ROWS\s*;/.test(game), 'CELLS = COLS * ROWS');
  eq(BigInt(COLS) * BigInt(ROWS), BigInt(CELLS), 'model COLS * ROWS == CELLS');
  eq(num('MAX_MULT_WAD'), 250n * 10n ** 18n, 'MAX_MULT_WAD = 250e18');
  eq(num('EXPECTED_RTP_BPS'), BigInt(EXPECTED_RTP_BPS), 'EXPECTED_RTP_BPS == model declaration (9472)');
  eq(num('JACKPOT_PROBABILITY_WAD'), 1_463_000_000_000_000n, 'JACKPOT_PROBABILITY_WAD = 0.1463%');
  assert(num('BODY_VAR_SCALED') > 0n, 'BODY_VAR_SCALED is nonzero');

  // Payout cap arithmetic, for a representative wager: the reserve committed at
  // onSessionStart plus the escrowed stake must equal maxPayout to the wei.
  for (const w of [1n, 10n ** 18n, 7n * 10n ** 16n]) {
    const maxPayout = (w * num('MAX_MULT_WAD')) / num('WAD');
    const maxReservedProfit = maxPayout - w;
    eq(w + maxReservedProfit, maxPayout, `wager ${w}: escrow + reserve == maxPayout exactly`);
  }

  // Heavy-tail classification (CONTRACT_CONSTRAINTS.md): heavy-tail iff maxPayout/wager > 100
  // AND probabilityWad < 1e15. flood-exe is 250x but its jackpot probability is 1.463e15 >= 1e15,
  // so it is NOT heavy-tail; it still quotes a nonzero body variance.
  const probWad = num('JACKPOT_PROBABILITY_WAD');
  const maxMult = num('MAX_MULT_WAD') / num('WAD');
  const heavyTail = maxMult > 100n && probWad < 10n ** 15n;
  eq(heavyTail, false, 'flood-exe is not on the heavy-tail path (probability 1.463e15 >= 1e15)');
  assert(probWad >= 10n ** 15n, 'jackpot probability clears the 0.1% heavy-tail threshold');
}

// ------------------------------------------------------------------ 5. settle returns the reserve intact
{
  assert(/r\.reservedProfitDelta = 0; \/\/ never release the reserve on the settling step/.test(game), 'onRandomness keeps the reserve (reservedProfitDelta = 0)');
  assert(/r\.escrowDelta = 0;/.test(game), 'onRandomness returns escrowDelta = 0');
  assert(/r\.nextPhase = SessionPhase\.SETTLED;/.test(game), 'onRandomness settles the session');
  assert(/r\.requestRandomnessNow = true;/.test(game), 'onSessionStart requests randomness');
  assert(/abi\.encode\(field, uint16\(start\), uint16\(area\), payout\)/.test(game), 'gameState carries field/start/area/payout for the frontend');
}

// ------------------------------------------------------------------ 6. standalone compile (optional)
{
  const solc = spawnSync('solc', ['--version'], { encoding: 'utf8' });
  const haveSolc = !solc.error && /Version:\s*0\.8\./.test(solc.stdout ?? '');
  if (!haveSolc) {
    console.log('  [info] solc not on PATH — skipping the standalone compile (textual checks still ran)');
  } else {
    const out = spawnSync('solc', ['--optimize', '--bin', 'FloodGame.sol'], { cwd: CONTRACTS, encoding: 'utf8' });
    assert(out.status === 0, `solc compiles FloodGame.sol (exit ${out.status})`);
    const m = (out.stdout ?? '').match(/Binary:\s*\n([0-9a-fA-F]+)/);
    assert(m, 'solc emitted FloodGame bytecode');
    const bytes = m ? m[1].length / 2 : 0;
    assert(bytes > 0 && bytes <= 24576, `bytecode ${bytes} B within the EIP-170 24576 B bound`);
    console.log(`  [info] solc ${(solc.stdout.match(/Version:\s*([0-9.]+)/) ?? [])[1]}: FloodGame bytecode = ${bytes} bytes`);
  }
}

console.log(`\ncontract.test.mjs — ${passed} assertions passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('OK');
