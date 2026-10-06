# FLOOD.EXE — RTP proof

**Declared RTP: 94.72% (`EXPECTED_RTP_BPS = 9472`). House edge 5.28% declared, 5.68% measured.
Hit rate (flooded area >= 30): 23.64% measured. Top multiplier 250x at ~1-in-690 rounds.**

**9472 is a declared constant, not a measurement and not an exact value.** The game's input is
keccak-256 output, so the outcome distribution has no finite support to enumerate and no closed
form; the honest deliverable is a measured mean with an interval. The reproducible source for every
number below is `tests/rtp-derive.mjs`, committed to this tree and run by
`tests/rtp.test.mjs`.

This candidate is a **port** of the proven `prototype/game` build, not a redesign. The paytable and
the defect history below are inherited from `prototype/game/math/rtp-proof.md`; the standalone
`model.mjs` reproduces the on-chain contract's derivation from the VRF word.

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

## Paytable — measured hit rates at n = 10,000,000

`node tests/rtp-derive.mjs 10000000`, seed `0x5a…5a`, scoring the SHIPPED `outcome()` in
`game/model.mjs`. The multipliers are exact integer code; the frequencies and the RTP column are
Monte Carlo output.

| band (flooded cells) | measured frequency | total return | contribution to RTP |
|---|---|---|---|
| 0–29 | 76.3606% | 0 | 0.000000 |
| 30–39 | 9.6467% | 1.5x | 0.144701 |
| 40–49 | 6.6975% | 2x | 0.133950 |
| 50–59 | 4.2238% | 3x | 0.126714 |
| 60–79 | 2.9265% | 6x | 0.175590 |
| 80–144 | 0.1449% | **250x** | 0.362200 |
| | | **RTP** | **0.943155** |

Measured RTP 9431.55 bps (94.3155%), win rate 23.6394%, 250x at 14488 hits = 1 in 690.

## Derivation — committed, re-runnable, and stated as an interval

`tests/rtp-derive.mjs` draws words from the shipped counter sampler `makeRng(seed, round)` and
scores them with the shipped `outcome()`, so the derivation certifies the money rather than a copy
of it. Because the sampler is a fixed counter stream and the seed is committed, every run
reproduces the published number bit-for-bit.

```
node tests/rtp-derive.mjs 10000000
```

```
expected return        9431.55 bps  (94.3155%)
sd(X)                  9.5697 return-multiples = 95,697 bps per round
se(mean)               0.003026 = 30.26 bps
95% CI                 [9372.24, 9490.86] bps   (+/- 59.31 bps = 0.593 pp)
250x hit rate          0.1449%   Wilson 95% [0.1425%, 0.1473%]
share of E[X^2] from the 250x band   97.93%
EXPECTED_RTP_BPS = 9472 bps          inside the 95% interval: YES
```

**Total uncertainty is ±0.593pp, not ±0.03pp.** The 250x band carries 97.93% of `E[X^2]`, so
`sd(X) ≈ 9.57` and the interval is a question about one rare event; the old "0.03pp agreement"
between a 10M and a 200M run was roughly a 2-sigma claim presented as a fact, and three runs of
this same code at 200,000 rounds land up to 3.86pp apart. The interval is Student-t on the Welford
sample variance (valid because the payout multiple is bounded by 250, so its variance is finite),
with the Wilson interval on the 250x count as an independent cross-check of the same width.

`EXPECTED_RTP_BPS = 9472` sits 0.68 of a half-width above the measured mean and inside the interval.
It is a **declared** figure, and the interval also contains 9400 and 9480. Two earlier derivations
(`prototype/game/math/tune.mjs --fit` at 10M → 94.7169%, and an adversarial 200M run → 94.746%)
produced numbers close enough to be mistaken for agreement; `tune.mjs` never modelled this contract
(it paints from its own xorshift PRNG and picks the start cell with a different scheme), both ran
outside version control, and neither is reproducible from this tree. They are history, not
corroboration.

The old `2,670 live settled rounds` claim is not reproducible from inside this repository and is
not used as evidence here; `docs/adversarial.md` already marks it UNTESTED.

## Defect history (why the number is 94.72%, not 96.816%)

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
