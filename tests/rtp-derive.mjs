#!/usr/bin/env node
/**
 * FLOOD.EXE — RTP derivation: the committed, re-runnable Monte Carlo behind
 * `EXPECTED_RTP_BPS`.
 *
 *   node tests/rtp-derive.mjs [rounds]        # default 200,000 rounds (~4s)
 *   ROUNDS=1000000 node tests/rtp-derive.mjs
 *   node tests/rtp-derive.mjs 200000 --seed 0x5a5a... --json
 *
 * WHY THIS FILE EXISTS
 *   The 94.717% figure was originally produced by a 10,000,000-round run and a
 *   200,000,000-round re-derivation, both of which lived in an untracked
 *   `prototype/**` tree outside version control. Nothing in the repository could
 *   re-derive the number, re-check it after a paytable edit, or tell a reviewer how
 *   much precision it actually had. `EXPECTED_RTP_BPS` was therefore an
 *   unreproducible literal: any paytable could be committed and every test still
 *   passed, because the only assertion on it was `EXPECTED_RTP_BPS === 9472`.
 *
 * WHAT THIS FILE IS NOT
 *   An exact computation. The game's input is keccak-256 output, so the outcome
 *   distribution has no finite support to enumerate (contrast the two sibling
 *   games, whose 2^20 / 2^18 board spaces are enumerable and whose RTP is exact
 *   arithmetic). The honest deliverable is a measured mean plus an interval, and
 *   this script reports both. Anything that claims more precision than the
 *   interval is overstating what a keccak sampler can support.
 *
 * SAMPLING
 *   Words are drawn from `makeRng(seed, round)` — the counter-based sampler in
 *   game/model.mjs that fixed the C1 defect (`seed0 + round * 2654435761` loses
 *   precision in IEEE-754 past round ~3,393,263). Every operation inside it is a
 *   32-bit integer op, so the stream is exact for any integer round.
 *   Each word is then run through the SHIPPED `outcome()`, not through a local
 *   re-implementation of the flood: importing the model is what makes this a proof
 *   about the money rather than about a copy of it.
 *
 *   IID CAVEAT. The interval below treats the rounds as independent draws. That is
 *   an assumption about the sampler, not a theorem: `makeRng`'s per-lane key
 *   `seed ^ (round + 1) ^ domain(lane)` is a bijection of the round index within
 *   each 2^32 window (so no two rounds repeat, and every recorded run lives inside
 *   one window), but equidistribution across the keccak input is a PRNG-quality
 *   property that is not proven here. On-chain randomness comes from Chain's VRF
 *   instead, which is uniform by construction — the sampler only stands in for it
 *   so the derivation is reproducible.
 *
 * WHY A SINGLE INTERVAL IS NOT ENOUGH TO TRUST A HEAVY TAIL
 *   The payout multiple X is 0 with probability ~76% and 250 with probability
 *   ~0.146%. That single band contributes ~p*250^2 = 91.4 of the ~91.5 total
 *   E[X^2]; the other five bands together contribute under 0.2%. So essentially all
 *   of Var(X) lives in one rare event. Two consequences the script reports
 *   explicitly rather than hiding inside a single number:
 *     1. the standard error of the mean is sd(X)/sqrt(n) with sd(X) ~= 9.5 (in units
 *        of the return multiple, i.e. ~95,100 bps per round), not a small number;
 *     2. a normal-theory interval is used for the MEAN because X has finite support
 *        (max 250) so the CLT does apply asymptotically, and the 250x band is
 *        handled separately with an exact-count (Wilson score) interval on its hit
 *        rate. Both widths are printed so a reader can see the tail's share.
 */
import { pathToFileURL } from 'node:url';
import { BANDS, EXPECTED_RTP_BPS, makeRng, outcome } from '../game/model.mjs';

export const DEFAULT_ROUNDS = 200_000;
/** Fixed so the reported number is reproducible bit-for-bit; override with --seed / SEED. */
export const DEFAULT_SEED = '0x' + '5a'.repeat(32);

/** Two-sided 95% normal quantile. Hard-coded rather than computed so no numeric dependency. */
const Z975 = 1.959963984540054;

/**
 * Cornish-Fisher expansion of the Student-t quantile from the normal quantile.
 * Accurate to a few 1e-4 for df >= 10, which is every sample size this script runs;
 * at df = 100k it is indistinguishable from the exact t value. Used so the interval
 * is the honest Student-t interval rather than a normal one that is very slightly
 * too narrow at small n.
 */
function studentT(z, df) {
  const z2 = z * z;
  return z
    + (z2 * z + z) / (4 * df)
    + ((5 * z2 * z2 * z) + (16 * z2 * z) + (3 * z)) / (96 * df * df)
    + ((3 * z2 * z2 * z2 * z) + (19 * z2 * z2 * z) + (17 * z2 * z) - (15 * z)) / (384 * df * df * df);
}

/** Wilson score interval for a binomial proportion. Closed form, no dependency. */
function wilson(k, n, z = Z975) {
  if (n === 0) return { lo: 0, hi: 1 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

const round = (x, d) => Number(x.toFixed(d));

/**
 * Run the derivation. Exported so tests/rtp.test.mjs reuses this exact code path
 * instead of copying a second Monte Carlo that could drift from it.
 *
 * @param {object} opts
 * @param {number} opts.rounds      rounds to simulate
 * @param {string} opts.seed        32-byte hex seed for makeRng
 * @param {(msg: string) => void} opts.progress stderr progress sink (default: silent)
 */
export function runDerivation({ rounds, seed = DEFAULT_SEED, progress = () => {} } = {}) {
  if (!Number.isInteger(rounds) || rounds <= 0) throw new Error(`rounds must be a positive integer (got ${rounds})`);

  const bandCounts = new Array(BANDS.length).fill(0);
  const tailIndex = BANDS.length - 1;
  const tailMult = BANDS[tailIndex].mult;

  // Welford's online mean/variance. Accumulating sum and sum-of-squares instead would
  // cancel catastrophically here: sum^2/n ~ 6e16 against sumsq/n ~ 91, losing ~15
  // significant digits to the subtraction. Welford never forms that difference.
  //
  // The mean is kept as a plain float and never quantised. An earlier revision of this
  // file scaled payouts by 2 and rounded (`mult * 2` -> integer) on the assumption that
  // every band multiplier is a half-integer, which is true of today's paytable and false
  // in general: a retune of 1.5x to 1.6x collapsed straight back to 1.5x and the
  // derivation reported an unchanged RTP. tests/rtp.test.mjs is what exposed it.
  let mean = 0;
  let m2 = 0;
  let bodySum = 0;
  let bodyRounds = 0;
  let secondMomentSum = 0; // sum of mult^2, used for the tail's share of E[X^2]

  const step = Math.max(1, Math.floor(rounds / 20));
  const t0 = Date.now();

  // Classify by FLOODED AREA, not by multiple: two bands could legitimately carry the
  // same multiplier, and bucketing by `mult` would silently merge them and misreport the
  // band table. The area is the thing the paytable bands are actually defined on.
  const bandIndexOf = (stat) => {
    for (let b = 0; b < BANDS.length; b += 1) if (stat >= BANDS[b].min && stat <= BANDS[b].max) return b;
    return -1;
  };

  for (let r = 0; r < rounds; r += 1) {
    const { stat, mult } = outcome(makeRng(seed, r));
    const delta = mult - mean;
    mean += delta / (r + 1);
    m2 += delta * (mult - mean);
    secondMomentSum += mult * mult;

    const bi = bandIndexOf(stat);
    bandCounts[bi === -1 ? 0 : bi] += 1;
    if (bi !== 0 && bi !== tailIndex) { bodySum += mult; bodyRounds += 1; }

    if ((r + 1) % step === 0 || r + 1 === rounds) {
      const done = r + 1;
      const rate = done / ((Date.now() - t0) / 1000);
      progress(`  ${String(done).padStart(9)} / ${rounds} rounds  ${rate.toFixed(0)}/s  eta ${(((rounds - done) / rate) || 0).toFixed(0)}s`);
    }
  }

  const elapsed = (Date.now() - t0) / 1000;
  const n = rounds;
  const tailHits = bandCounts[tailIndex];
  const winRounds = n - bandCounts[0];
  const variance = n > 1 ? m2 / (n - 1) : 0;
  const sd = Math.sqrt(variance);
  const se = Math.sqrt(variance / n);
  const tCrit = studentT(Z975, n - 1);
  const meanMult = mean;
  const halfWidth = tCrit * se;

  const tail = wilson(tailHits, n);
  const tailShareOfSecondMoment = (tailMult * tailMult * (tailHits / n)) / (secondMomentSum / n);

  return {
    seed,
    rounds: n,
    elapsed,
    roundsPerSecond: n / elapsed,
    declaredBps: EXPECTED_RTP_BPS,
    meanMult,
    meanBps: meanMult * 10000,
    sdMult: sd,
    seMult: se,
    tCrit,
    ciLowMult: meanMult - halfWidth,
    ciHighMult: meanMult + halfWidth,
    ciLowBps: (meanMult - halfWidth) * 10000,
    ciHighBps: (meanMult + halfWidth) * 10000,
    halfWidthBps: halfWidth * 10000,
    declaredInside: EXPECTED_RTP_BPS >= (meanMult - halfWidth) * 10000
      && EXPECTED_RTP_BPS <= (meanMult + halfWidth) * 10000,
    winRounds,
    winRate: winRounds / n,
    bandCounts,
    bands: BANDS,
    tailMult,
    tailHits,
    tailRate: tailHits / n,
    tailRateLow: tail.lo,
    tailRateHigh: tail.hi,
    tailOneIn: tailHits > 0 ? n / tailHits : Infinity,
    tailContributionBps: (tailMult * tailHits) / n * 10000,
    tailShareOfSecondMoment,
    bodyRounds,
    bodyMeanMult: bodyRounds > 0 ? bodySum / bodyRounds : 0,
    secondMoment: secondMomentSum / n,
  };
}

/** Human-readable report. Kept next to the math so the two cannot drift apart. */
export function formatReport(d) {
  const pct = (x) => `${(x * 100).toFixed(4)}%`;
  const lines = [];
  lines.push('FLOOD.EXE — RTP derivation (Monte Carlo over keccak-256 words, NOT enumerable)');
  lines.push(`  seed              ${d.seed}`);
  lines.push(`  rounds            ${d.rounds.toLocaleString('en-US')}   (${d.elapsed.toFixed(1)}s, ${d.roundsPerSecond.toFixed(0)} rounds/s)`);
  lines.push(`  sampler           makeRng(seed, round) -> outcome() from game/model.mjs`);
  lines.push('');
  lines.push('  PAYOUT BANDS (measured hit counts)');
  for (let b = 0; b < d.bands.length; b += 1) {
    const band = d.bands[b];
    const hits = d.bandCounts[b];
    lines.push(`    ${String(band.min).padStart(3)}-${String(band.max).padEnd(3)}  ${String(band.mult).padStart(6)}x  ${String(hits).padStart(9)} hits  ${pct(hits / d.rounds).padStart(11)}  ${(hits * band.mult / d.rounds * 100).toFixed(4).padStart(9)}% of RTP`);
  }
  lines.push('');
  lines.push('  AGGREGATES');
  lines.push(`    expected return        ${d.meanBps.toFixed(2)} bps  (${(d.meanBps / 100).toFixed(4)}%)`);
  lines.push(`    win rate (area >= 30)   ${pct(d.winRate)}`);
  lines.push(`    ${d.tailMult}x tier         ${d.tailHits} hits = ${pct(d.tailRate)} = 1 in ${d.tailOneIn.toFixed(0)}`);
  lines.push(`    body mean mult (no ${d.tailMult}x)  ${d.bodyMeanMult.toFixed(4)}x over ${d.bodyRounds.toLocaleString('en-US')} winning rounds`);
  lines.push('');
  lines.push('  UNCERTAINTY');
  lines.push(`    sd(X)          ${d.sdMult.toFixed(4)} (return-multiple units) = ${(d.sdMult * 10000).toFixed(0)} bps per round`);
  lines.push(`    se(mean)       ${d.seMult.toFixed(6)} = ${(d.seMult * 10000).toFixed(2)} bps`);
  lines.push(`    t(0.975, n-1)  ${d.tCrit.toFixed(5)}`);
  lines.push(`    95% CI         [${d.ciLowBps.toFixed(2)}, ${d.ciHighBps.toFixed(2)}] bps   (+/- ${d.halfWidthBps.toFixed(2)} bps = ${(d.halfWidthBps / 100).toFixed(3)} pp)`);
  lines.push(`    method         Student-t on the Welford sample variance of the per-round payout multiple.`);
  lines.push(`                   X is bounded by ${d.tailMult}, so its variance is finite and the CLT applies to the`);
  lines.push(`                   mean asymptotically; at n >= 1e4 the t-vs-normal gap is <0.5% of the half-width.`);
  lines.push('');
  lines.push(`  TAIL-ONLY CROSS-CHECK (the ${d.tailMult}x band carries the variance)`);
  lines.push(`    ${d.tailMult}x hit rate      ${pct(d.tailRate)}   Wilson 95% [${pct(d.tailRateLow)}, ${pct(d.tailRateHigh)}]`);
  lines.push(`    ${d.tailMult}x alone moves the mean by   [${(d.tailRateLow * d.tailMult * 10000).toFixed(2)}, ${(d.tailRateHigh * d.tailMult * 10000).toFixed(2)}] bps`);
  lines.push(`    share of E[X^2] from the ${d.tailMult}x band  ${(d.tailShareOfSecondMoment * 100).toFixed(2)}%  <- the other five bands together are a rounding error`);
  lines.push('');
  lines.push('  DECLARED CONSTANT');
  lines.push(`    EXPECTED_RTP_BPS = ${d.declaredBps} bps`);
  lines.push(`    inside the 95% interval: ${d.declaredInside ? 'YES' : 'NO'}  <- a Monte Carlo estimate with a stated interval, not an exact value`);
  lines.push('');
  lines.push('  WHAT THIS PROVES: the shipped model, paytable and sampler are the ones behind the number above,');
  lines.push('  and any given run reproduces it bit-for-bit from the committed seed.');
  lines.push('  WHAT IT DOES NOT PROVE: the true E[RTP]. No finite sample can, and the 250x tail makes the');
  lines.push('  interval wide; a paytable change smaller than the half-width is invisible to this method.');
  return lines.join('\n');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const positional = argv.find((a) => /^[0-9]+$/.test(a));
  const rounds = Number(flag('rounds') ?? process.env.ROUNDS ?? positional ?? DEFAULT_ROUNDS);
  const seed = flag('seed') ?? process.env.SEED ?? DEFAULT_SEED;
  const asJson = argv.includes('--json');

  const d = runDerivation({
    rounds,
    seed,
    progress: (msg) => process.stderr.write(`${msg}\n`),
  });

  if (asJson) {
    process.stdout.write(`${JSON.stringify(d, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReport(d)}\n`);
  }
}

export { wilson, studentT };
