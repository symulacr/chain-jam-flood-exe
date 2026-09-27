# flood-exe — RTP

**Declared: `EXPECTED_RTP_BPS = 9472` (94.717%). House edge 5.283%. Hit rate ≈ 23.657%.**
Full derivation, cross-checks and defect history: [`rtp-proof.md`](./rtp-proof.md). This file is
the contract-parity argument and the honest statement of the RTP *class*.

## Exact vs Monte Carlo — this candidate is MONTE CARLO, and that must be said plainly

- The **paytable is exact integer code** (`FloodGame._multiplier` and `game/model.mjs BANDS`).
- The **probabilities are Monte Carlo** and are **not enumerable**. The outcome hashes the whole
  256-bit VRF word; a 12×12 site-percolation cluster-size law over ≈ `2^144` canvases has no
  practical closed form, and the state space (canvases × start cells × words) cannot be
  brute-forced.
- Therefore `9472` is **empirically validated, not closed-form proven**. This is inherited from
  `prototype/game/math/rtp-proof.md` and is **not smoothed over**.

**This is the one candidate in the Top-3 whose RTP is Monte Carlo.** `01-lifeboat` and
`02-handicap` are **exact** (their full state spaces are enumerable — `2^20` and `2^18`). Do not
describe flood-exe as exact.

## The known weakness — NO DECISION AFTER THE WAGER

The VRF paints the canvas and the flood decides everything: `onPlayerAction` exists only to
**revert** (`FloodGame__NoPlayerAction`), so the game has no agency surface. This is the
structural novelty weakness of the candidate (recorded in `TOP3-FINAL-CANDIDATES.md`), and it is
**preserved deliberately** in this restructure — the contract and derivation are verified and must
not change here.

### The cheap fix (NOT implemented in this phase — documented for the next)

The highest-value future improvement is to add a decision axis **without moving the money**:

1. **A pre-wager canvas-scale choice.** Before opening the session, the player picks one of a few
   fixed scales (e.g. a density/size pair) that maps to the same 144-bit canvas but changes how
   the margins are graded. The choice is committed in `gameData`/`gameState` at
   `onSessionStart`, so the word still decides the canvas and the contract still decides the
   payout — but the player now commits a rule against an unknown word. (This is the same
   pre-wager-commitment shape `01-lifeboat` uses.)
2. **A bank-or-continue after a 30-cell flood.** When a round reaches the win floor, let the
   player bank the current band or continue the flood into the remaining cells at a lower
   multiplier. This adds a genuine mid-round decision.

**Why it is not done now:** both change the verified contract and its RTP, and the phase mandate
is *restructure, not rewrite*. Implementing either would invalidate the paytable parity, the
brute/Monte-Carlo RTP evidence and the settled-round replay that this project's correctness rests
on. It is the documented next step, not a phase deliverable.

## Contract ⇄ model parity, band for band

The contract is the authority; `game/model.mjs` must pay identically. The bands and thresholds are
asserted equal in `tests/model.test.mjs` and `tests/contract.test.mjs`, and restated here:

| band (area) | `BANDS` mult | `FloodGame._multiplier` |
|---|---|---|
| 0–29 | 0 | `if (area < 30) return 0;` |
| 30–39 | 1.5 | `if (area < 40) return 15e17;` |
| 40–49 | 2 | `if (area < 50) return 2e18;` |
| 50–59 | 3 | `if (area < 60) return 3e18;` |
| 60–79 | 6 | `if (area < 80) return 6e18;` |
| 80–144 | 250 | `return MAX_MULT_WAD;` (250e18) |

The page imports `game/model.mjs` directly, so the frontend cannot drift from the model — the
drift that broke frontend/contract parity in Wave 3 (contradiction C3: `App.tsx` 6x vs deployed 5x).

## Independent re-derivations

| method | rounds | RTP |
|---|---|---|
| `prototype/game/math/tune.mjs --fit` (corrected sampler) | 10,000,000 | 94.7169% |
| adversarial re-derivation (own keccak stream, own union-find flood) | 200,000,000 | 94.746% |
| on-chain settled rounds | 2,670 | 76.34% losing rounds (matches 76.343%) |
| candidate's `model.mjs` on `crypto.randomBytes` | 1,500,000 | 9551 bps (Δ79, inside ±152 CI) |
| `tools/verify-candidate.mjs` (CSPRNG the model does not control) | 2,000,000 | see `verification.txt` |

The harness check 11 is a **coarse consistency check**: its tolerance scales with this game's own
high variance (a 250× jackpot widens the confidence interval to ≈ ±272 bps, 4σ). The authoritative
evidence for this candidate's RTP is its historical one (10M + independent 200M + 2,670 live
settled rounds), not a single 2M-round sample.

## Risk parameters quoted to the chain

| field | value |
|---|---|
| `maxPayout` | `wager * 250` |
| `probabilityWad` | `1.463e15` (= 0.1463%, the 250× probability) |
| `expectedPayout` | `wager * 9472 / 10000` |
| `bodyVarianceScaled` | `wager² * 1582620149321559800` |

Heavy-tail: max multiplier 250× is above the 100× threshold, but the jackpot probability
(0.1463%) is **above** the 0.1% threshold (`1.463e15 ≥ 1e15`), so the game does **not** trip
`CasinoRiskLib.isHeavyTail`. A non-zero body variance is quoted regardless, so it is safe to
whitelist on any council threshold. (The margin above 1e15 is only ~46%, which is worth stating —
but it is above, and the Monte-Carlo top-band frequency ≈ 1.473e15 agrees.)

## Cap = payout, to the wei

`onSessionStart` commits the full reserve (`249·wager`) and `onRandomness` returns
`reservedProfitDelta = 0` / `escrowDelta = 0`; `quoteCaps.maxReservedProfit + escrowedStake`
equals `quoteRiskParams.maxPayout` exactly. Integer floor-division in `_payout` rounds **down**,
never above the cap. `tests/contract.test.mjs` asserts this arithmetic for representative wagers.
