# FLOOD.EXE — RTP proof

**Declared theoretical RTP: 94.717% (`EXPECTED_RTP_BPS = 9472`). House edge 5.283%.
Hit rate (flooded area >= 30): 23.657%. Top multiplier 250x at 1-in-683 rounds.**

This candidate is a **port** of the proven `prototype/game` build, not a redesign. The paytable,
the derivation and the defect history below are copied from `prototype/game/math/rtp-proof.md`;
the standalone `model.mjs` reproduces the on-chain contract's derivation from the VRF word.

## The model (contract is the authority)

`contracts/FloodGame.sol` computes, from a `bytes32 randomness`:

```
field = uint256(keccak256(abi.encodePacked(randomness, uint8(0)))) >> (256 - 144)   // 144-bit canvas
start = first byte < 144 scanning (stream >> 8i) & 0xff over uint256(keccak256(randomness, 0x01)),
        fallback keccak256(randomness, 0x02), then 0
area  = size of the 4-connected same-colour region containing `start`
payout = wager * _multiplier(area) / 1e18
```

`model.mjs` implements exactly that: a pure-JS Keccak-256 (verified against two independent
references), the same rejection-sampled start cell, and the same 4-connected flood. `outcome(word)`
is a pure function of the 32-byte word — no crypto, no I/O, no other inputs.

- **Canvas:** uniform over `2^144` fields (top 144 bits of a Keccak-256 hash).
- **Start cell:** rejection-sampled uniform over 144 (never `byte % 144`).
- **Paytable:** exact integer code, shared by the contract and `model.mjs`.

## Paytable

| band (flooded cells) | probability | total return | contribution to RTP |
|---|---|---|---|
| 0–29 | 76.3430% | 0 | 0.000000 |
| 30–39 | 9.6520% | 1.5x | 0.144779 |
| 40–49 | 6.7129% | 2x | 0.134258 |
| 50–59 | 4.2132% | 3x | 0.126395 |
| 60–79 | 2.9327% | 6x | 0.175961 |
| 80–144 | 0.1463% | **250x** | 0.365775 |
| | | **RTP** | **0.947169** |

## Derivation and independent cross-check

The probabilities are Monte Carlo, because the exact probability of each cluster-size is a rational
with an astronomical denominator. The **paytable is exact**; the **probabilities are not** — this is
stated rather than glossed.

- Primary: `prototype/game/math/tune.mjs --fit` (corrected counter-based sampler), 10,000,000 rounds
  → RTP **94.7169%**.
- Independent: an adversarial re-derivation, own Keccak-seeded stream and own union-find flood,
  200,000,000 rounds → **94.746%** with this table's multipliers. The two agree to 0.029pp.
- On-chain: 2,670 real settled rounds give 76.34% losing rounds, matching the 76.343% prediction.
- Standalone re-check (this candidate): 1,500,000 rounds through `model.mjs`'s actual `outcome()` on
  `crypto.randomBytes` words gave **9551 bps** (delta 79 bps, inside the 95% CI of ±152 bps), with
  band frequencies 76.3498 / 9.6283 / 6.7132 / 4.2112 / 2.9483 / 0.1493 %.
- Harness: `jam-candidates/tools/verify-candidate.mjs` re-derives RTP from `crypto.randomBytes`
  words the model does not control and compares to 9472 — see `reports/verification.txt`.

`EXPECTED_RTP_BPS = 9472` sits 1.7pp above the 93% floor and 3.3pp below the 98% ceiling. The
250x band is the least precise contribution (≈ ±0.003 in RTP); total uncertainty ≈ ±0.03pp.

## Defect history (why the number is 94.717%, not 96.816%)

An earlier `tune.mjs` seeded each round with `seed0 + r * 2654435761`. That float passes 2^53 at
`r = 3,393,263`; beyond it IEEE-754 spacing destroys the low bits and `>>> 0` sees a collapsed set of
even seeds, so roughly a third of a 5,000,000-round run reused duplicate seeds. The declared
**96.816%** was never true; an adversarial re-derivation returned 91.817% for the *old* multipliers.

Fixes, all present here:
1. `makeRng(seed0, round)` uses only `Math.imul` / `>>> 0` / `^` / `+` — no float accumulation,
   exact for every integer round, and a bijection of the round index within each 2^32-round window
   (so no run we performed, all < 2^32 rounds, saw a repeated seed). Across window boundaries the
   32-bit key can alias — `makeRng(seed, 2^32-1) === makeRng(seed, 2^32)` — see `docs/adversarial.md`.
2. The paytable moved from `1.5 / 2 / 3 / 5 / 250` to `1.5 / 2 / 3 / 6 / 250`, restoring RTP from
   the true 91.78% to 94.72%.

The `settled-sessions.json` fixture is the replayed evidence: 20 real payloads, all decoding to the
same area and band the chain paid. Worth noting honestly: **that fixture's largest area is 61 (6x);
it contains no 250x payload.** The 250x band is reachable (three live jackpots are recorded in
`prototype` wave-3 material, sessions 2440/3653/3779) but is **not** exercised by this fixture; the
top tier is covered by the pure full-canvas boundary test, not by a real settled payload.

## Contract / model parity

`FloodGame._multiplier` and `model.mjs BANDS` are checked band-for-band by `tests/model.test.mjs`
(textual assertion on the shipped Solidity thresholds and multipliers) and compile standalone with
`solcjs` (see `reports/standalone.md`). The page imports `model.mjs` directly, so the frontend and
the contract cannot drift — the drift that broke parity in Wave 3 (`App.tsx` 6x vs deployed 5x).
