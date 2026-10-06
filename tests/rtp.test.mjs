#!/usr/bin/env node
/**
 * FLOOD.EXE — RTP regression test.
 *
 *   node tests/rtp.test.mjs        (~20s: 1,000,000 rounds through the shipped model)
 *
 * WHY THIS FILE EXISTS
 *   `EXPECTED_RTP_BPS` was a hard-coded literal whose only assertion was
 *   `EXPECTED_RTP_BPS === 9472`. Retune any band multiplier in game/model.mjs and every
 *   test in the repo still passed — nothing in the tree computed the number. The
 *   derivation that produced 9472 (and a 200M-round "cross-check" that reportedly agreed
 *   to 0.03pp) lived in an untracked `prototype/**` tree that also predates, or never
 *   matched, the shipped keccak model: its `tune.mjs` paints the canvas from its own PRNG
 *   and draws the start cell with a different rejection scheme, so it cannot re-derive
 *   this game's number even in principle. This file runs the real thing.
 *
 * WHAT THIS TEST GUARANTEES
 *   Two separate assertions, deliberately of different strength:
 *
 *   (A) STATISTICAL BAND. The Monte Carlo mean of the shipped `outcome()` over 1,000,000
 *       counter-sampled words lies inside [declared -/+ the 95% confidence half-width that
 *       this very sample produces]. The half-width is computed, never hard-coded, so the
 *       test cannot be made to pass by loosening a number.
 *
 *   (B) DETERMINISTIC REGRESSION. Because the sampler is a fixed counter stream
 *       (`makeRng(seed, round)`) and the seed is committed, the measured value is
 *       bit-reproducible. The test therefore pins the exact mean, the exact per-band hit
 *       counts and the exact 250x hit count. This is not a fake-tight statistical band:
 *       it is a reproducibility assertion on a deterministic computation. Any edit to
 *       BANDS, to `outcome()`, to the flood, to the canvas extraction or to the start-cell
 *       scan shifts these integers and fails the test. Regenerate them with
 *       `node tests/rtp-derive.mjs 1000000 --json` when an intended model change lands.
 *
 * WHAT THIS TEST DOES NOT GUARANTEE — READ BEFORE RELYING ON IT
 *   The sample size is a trade-off, and the trade-off is lopsided in one direction only:
 *
 *     * Assertion (A) is WIDE. The 250x band contributes ~98% of E[X^2], so sd(X) ~= 9.57
 *       return multiples and the standard error of the mean is ~188 bps at n = 1e6. The
 *       smallest top-band multiplier change (A) can see is
 *           188 bps / (0.001463 * 10000 bps per unit multiplier) ~= 12.9x,
 *       i.e. 250x -> 263x. A retune of 250x -> 255x is INVISIBLE to (A). No Monte Carlo
 *       at any sample size this suite can afford makes (A) tight enough to catch small
 *       perturbations, because tightening the band means either running for hours or
 *       pretending the tail is not there. This test does not pretend.
 *
 *     * Assertion (B) IS TIGHT, because it is not statistical. It is a fixed-input
 *       regression fingerprint. Its cost is brittleness in the ordinary sense: a
 *       legitimate refactor of `keccak256` or of `floodArea` that does not change a single
 *       payout will still fail (B) if it changes the sampled areas. That is the intended
 *       behaviour — a reviewer re-runs the derivation and re-commits — but it means a
 *       failing (B) is a prompt to re-derive, not automatically a bug.
 *
 *   What neither assertion can do: prove the true E[RTP]. Flood-exe's input is keccak-256
 *   output, so the outcome distribution has no enumerable support. Unlike the two sibling
 *   games (2^20 and 2^18 enumerable board spaces, exact arithmetic), the best this game can
 *   offer is a measured mean plus an interval, and the interval is wide because one band
 *   out of six carries essentially all of the variance.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BANDS, EXPECTED_RTP_BPS, bandOf } from '../game/model.mjs';
import { DEFAULT_SEED, runDerivation } from './rtp-derive.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TEST_ROUNDS = 1_000_000;

/**
 * Fingerprint captured from `node tests/rtp-derive.mjs 1000000 --json` at DEFAULT_SEED.
 * Regenerate with that command after any intentional change to the model or paytable.
 */
const COMMITTED = {
  meanBps: 9464.395,
  bandCounts: [764012, 96091, 66661, 42469, 29304, 1463],
  tailHits: 1463,
};

/**
 * The contract's other money-affecting constant, `JACKPOT_PROBABILITY_WAD`, is the same
 * quantity this test measures as `tailRate`. Asserting the measured rate against it is a
 * second, independent Monte Carlo guard on a value `quoteRiskParams` feeds to the risk
 * quoter. It is parsed out of contracts/FloodGame.sol rather than re-typed here, so
 * retuning the Solidity constant cannot leave this assertion silently checking a stale
 * copy of the number.
 */
function declaredJackpotRate() {
  const sol = fs.readFileSync(path.resolve(HERE, '../contracts/FloodGame.sol'), 'utf8');
  const m = sol.match(/\bJACKPOT_PROBABILITY_WAD\s*=\s*([0-9_]+)/);
  assert(m, 'contract declares JACKPOT_PROBABILITY_WAD');
  return Number(BigInt(m[1].replace(/_/g, ''))) / 1e18;
}

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; return; }
  failed += 1;
  console.error('  FAIL:', msg);
}
function eq(a, b, msg) { assert(a === b, `${msg} (got ${a}, want ${b})`); }

// ------------------------------------------------------------------ 1. declared constant
eq(EXPECTED_RTP_BPS, 9472, 'EXPECTED_RTP_BPS is the reserved declared figure');
assert(EXPECTED_RTP_BPS > 0 && EXPECTED_RTP_BPS < 10000, 'declared RTP leaves the house an edge');
eq(BANDS.length, 6, 'six payout bands');
eq(bandOf(BANDS[BANDS.length - 1].min), BANDS[BANDS.length - 1].mult, 'top band multiplier is the tail');

// ------------------------------------------------------------------ 2. the Monte Carlo
const t0 = Date.now();
const d = runDerivation({ rounds: TEST_ROUNDS, seed: DEFAULT_SEED });
console.log(`  [info] ${d.rounds.toLocaleString('en-US')} rounds in ${((Date.now() - t0) / 1000).toFixed(1)}s: `
  + `mean ${d.meanBps.toFixed(2)} bps, 95% CI [${d.ciLowBps.toFixed(2)}, ${d.ciHighBps.toFixed(2)}] `
  + `(+/- ${d.halfWidthBps.toFixed(1)} bps), win rate ${(d.winRate * 100).toFixed(3)}%, `
  + `${d.tailMult}x tier: ${d.tailHits} hits = 1 in ${d.tailOneIn.toFixed(0)}`);

// (A) The band IS the confidence interval, not a hand-picked tolerance.
assert(
  d.meanBps >= d.ciLowBps && d.meanBps <= d.ciHighBps,
  'measured mean lies inside its own 95% interval',
);
assert(
  d.declaredBps >= d.ciLowBps && d.declaredBps <= d.ciHighBps,
  `declared ${d.declaredBps} bps lies inside the measured 95% interval [${d.ciLowBps.toFixed(2)}, ${d.ciHighBps.toFixed(2)}]`,
);
assert(Number.isFinite(d.halfWidthBps) && d.halfWidthBps > 0, 'the interval half-width is a real positive number');

// Aggregation consistency: the mean the assertion above trusts must be the mean the band
// table implies. A bug that mis-bucketed rounds would otherwise show up as a plausible RTP.
eq(
  d.bandCounts.reduce((a, b) => a + b, 0),
  TEST_ROUNDS,
  'every simulated round landed in exactly one band',
);
{
  const fromBands = d.bandCounts.reduce((acc, hits, b) => acc + (hits * BANDS[b].mult) / TEST_ROUNDS, 0) * 10000;
  assert(
    Math.abs(fromBands - d.meanBps) < 1e-6,
    `mean RTP equals the band table's weighted sum (${fromBands.toFixed(4)} vs ${d.meanBps.toFixed(4)})`,
  );
  eq(d.winRounds, TEST_ROUNDS - d.bandCounts[0], 'win rate is the complement of the losing band');
}

// ------------------------------------------------------------------ 3. the band may not be faked narrow
// Guards the one failure mode that would make this whole file theatre: swapping in a
// tighter-looking interval method (or a method that ignores the 250x tail) to turn a
// marginal run green. At n = 1e6 the honest half-width for this tail is ~188 bps; if the
// reported half-width drops below 150 bps the tail is no longer being carried.
assert(
  d.halfWidthBps >= 150,
  `95% half-width ${d.halfWidthBps.toFixed(1)} bps is at least 1.5pp — a narrower one would not be carrying the 250x tail`,
);
assert(
  d.tailShareOfSecondMoment > 0.9,
  `the ${d.tailMult}x band carries ${(d.tailShareOfSecondMoment * 100).toFixed(1)}% of E[X^2] (this is why the interval is wide)`,
);
const detectThresholdX = d.halfWidthBps / (d.tailRate * 10000);
console.log(`  [info] assertion (A) can only see a ${d.tailMult}x retune larger than ${detectThresholdX.toFixed(1)}x `
  + `(${d.tailMult}x -> ${(d.tailMult + detectThresholdX).toFixed(0)}x). Smaller retunes are caught only by (B).`);

// ------------------------------------------------------------------ 4. deterministic regression
// Fixed seed + counter sampler => fixed integers. Not a statistical band; a fingerprint.
assert(
  Math.abs(d.meanBps - COMMITTED.meanBps) < 0.01,
  `Monte Carlo mean reproduces the committed measurement ${COMMITTED.meanBps} bps (got ${d.meanBps})`,
);
for (let b = 0; b < BANDS.length; b += 1) {
  eq(d.bandCounts[b], COMMITTED.bandCounts[b], `band ${BANDS[b].min}-${BANDS[b].max} hit count reproduces`);
}
eq(d.tailHits, COMMITTED.tailHits, '250x hit count reproduces');
eq(d.seed, DEFAULT_SEED, 'the regression fingerprint is only valid for the committed seed');

// ------------------------------------------------------------------ 5. the contract's other quoted probability
const DECLARED_JACKPOT_RATE = declaredJackpotRate();
assert(
  DECLARED_JACKPOT_RATE >= d.tailRateLow && DECLARED_JACKPOT_RATE <= d.tailRateHigh,
  `contract JACKPOT_PROBABILITY_WAD ${(DECLARED_JACKPOT_RATE * 100).toFixed(4)}% lies inside the measured `
  + `${d.tailMult}x-rate interval [${(d.tailRateLow * 100).toFixed(4)}%, ${(d.tailRateHigh * 100).toFixed(4)}%]`,
);

console.log(`\nrtp.test.mjs — ${passed} assertions passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('OK');
