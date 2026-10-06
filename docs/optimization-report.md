# Optimization report — FLOOD.EXE, `opt/roi-1` vs `663f4b0`

Target: `top3/03-flood-exe`, the outcome path from the VRF word to the painted band. The flow map
with every copy point, allocation site, ownership change and error-context loss is
`docs/stream-map.md`. The per-candidate evidence is `docs/roi-ledger.md`.

## What was measured, and how

`outcome()` is the shipped pure function of the 32-byte VRF word. Two harnesses drive it directly:
an allocation counter that swaps the global typed-array constructors and `BigInt` before the module is
imported, and a benchmark that prints a checksum of every `stat` so a behaviour change cannot hide
behind a faster number. The contract side is measured on anvil with `eth_estimateGas` over 120 seeded
words. The page side is measured in a real browser: the built `dist/` served over http, the DEMO
control clicked 15 times, every band's result text and meter position read back, zero page errors.

## Final ROI table

| Area | Baseline `663f4b0` | Optimized `e82d210` | Delta | ROI |
|---|---:|---:|---:|---|
| authored production LOC | 1063 | 1086 | +23 | worse, see below |
| authored production LOC, code only | 918 | 937 | +19 | worse |
| duplicated lines (>=28 chars) | 17 | 13 | -4 (-23.5%) | better |
| allocations per `outcome()` round | 41 | 4 | -37 (-90.2%) | better |
| BigInt operations per round | 33 | 1 | -32 | better |
| `outcome()` 200k rounds, min of 7 | 2859.9 ms | 1783.6 ms | -37.6% | better |
| `outcome()` 200k rounds, median of 7 | 2979.8 ms | 1824.4 ms | -38.8% | better |
| `hexToBytes` 1M calls, min of 7 | 1596.0 ms | 204.3 ms | -87.2% | better |
| `floodOrder` 20k boards, min of 7 | 115.6 ms | 108.4 ms | -6.2% | better |
| RTP gate wall time, identical 1M-round run | 15.7 s | 9.7 s | -38.2% | better |
| `onRandomness` gas, mean of 120 words | 57,631 | 57,631 | 0 | unchanged |
| `FloodGame` creation bytecode | 2619 B | 2537 B | -82 B | better |
| model test assertions | 219 | 1628 | +1409 | better |
| stream stages, VRF word to painted band | 9 | 9 | 0 | unchanged |
| attribute copies per round (`_INPUT33` absorb, field build) | 2 | 2 | 0 | unchanged |
| fragment copies per round (hex parse) | 32 substrings | 0 | -32 | better |
| API clarity (exported surface) | 21 exports | 21 exports | 0, byte-identical list | unchanged |
| error clarity (malformed hex / malformed `gameState`) | 1 silent catch in the decode path | unchanged; the balance parse and the demo re-derive now have one site each | better |
| observability | unchanged | unchanged | 0 | unchanged |
| maintainability | 2 identical balance-parse sites, 2 identical scan loops, 1 magic 250 x3 | 1 site, 1 loop, 1 declared constant | better |

Contract preservation, checked mechanically rather than asserted:

- `game/model.mjs` exports the same 21 symbols with the same names and kinds, diffed symbol by symbol
  against `663f4b0`.
- `index.html`, `src/styles.css`, `public/`, `scripts/` and `package.json` have an empty diff.
- No line containing `BANDS`, `EXPECTED_RTP_BPS`, `MIN_WIN_AREA`, `mult:` or the jackpot probability
  was touched.
- The 20 real settled `gameState` payloads replay to the same fields, starts, areas and payouts.
- The deployed `FloodGame` settles the jackpot word to the same area, band and payout the model does.
- The 1,000,000-round RTP run returns a bit-identical result on both trees:
  9464.39 bps, 95% CI [9275.93, 9652.86], win rate 23.599%, 1463 jackpot hits.

## Expected ROI vs measured ROI

| Dimension | Expected | Measured | Match |
|---|---|---|---|
| LOC | -600 (campaign target) | **+23** | **no** |
| allocations per round | large drop | 41 -> 4 (-90.2%) | yes |
| CPU on the hot path | large drop | -37.6% min, -38.8% median on `outcome()` | yes |
| duplicate code | down | 17 -> 13 lines, 3 duplicated blocks -> 1 | yes |
| gas on the money path | neutral or better | unchanged, and one candidate that would have cost +0.8% was rejected | yes |
| contract drift | none | export list byte-identical, 0 diff on layout/CSS/constants, 20 real rounds and 1M RTP rounds bit-identical | yes |
| browser behaviour | unchanged | 15 DEMO rounds, all bands rendered correctly, 0 page errors | yes |

The campaign was expected to be a LOC-reduction exercise and it was not. On a 1063-line authored
tree the removable fat was per-round allocation and per-byte re-parsing, not line count. Reaching
-600 LOC would have meant deleting the comments that explain why the constants are what they are,
hand-editing the vendored `src/sdk/guest.mjs`, or restructuring the interface contract shared with
the other two games. Each of those is a worse engineering trade than the 23 lines that were spent.

## Classification

**ADOPT.**

The evidence is one-sided on every dimension the campaign was allowed to move, and the one dimension
it was not (contract behaviour) is held fixed by a symbol-level export diff, an empty layout diff, a
bit-identical million-round RTP run, twenty replayed on-chain rounds and a deployed-contract parity
check. The change set is 13 self-contained commits, each passing the full suite on its own, so any
single loop can be reverted without touching the others.

Two caveats stated rather than buried:

1. LOC went up by 23 lines. If the goal is line count rather than engineering cost, this campaign is
   the wrong instrument and the branch should be judged on the allocation and CPU columns instead.
2. Three dimensions are UNPROVEN rather than better: the canvas-loop candidates (R3, R4) were
   rejected because nothing in the repository can measure them, and `onRandomness` gas was held
   constant deliberately rather than improved.

## What was not done

The documented pre-existing defects listed in the workspace `AGENTS.md` section 5 were out of scope
and none of this campaign's evidence showed one of them to be the highest-ROI upstream fix. The
`02-handicap` defects in particular are in a different game and a different repo, and fixing them
would have changed user-visible behaviour, which this campaign forbids.