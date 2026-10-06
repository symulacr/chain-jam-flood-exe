# Optimization report — FLOOD.EXE

Target: this project's outcome path, from the VRF word to the painted band —

```
VRF word -> keccak canvas -> rejection-sampled start cell -> 4-connected flood
         -> band -> payout -> painted reveal
```

This records an optimization campaign that has since been merged into `master`. Per-candidate
evidence, the gate audit and every rejected candidate were kept as working notes and are not part
of this repository.

## What was measured, and how

`outcome()` is the shipped pure function of the 32-byte VRF word. An allocation counter swaps the
global typed-array constructors and `BigInt` before the module is imported and counts what a round
allocates. A benchmark prints a checksum of every `stat`, so a behaviour change cannot hide behind a
faster number. The contract is measured on anvil with `eth_estimateGas` over 120 seeded words. The
page is measured in a real browser: the built `dist/` served over http, DEMO clicked 15 times across
two sessions, every band's result text, meter position and tool-palette SVG read back, zero page
errors.

## Final ROI table

| Area | Baseline `663f4b0` | Optimized `b98ecbd` | Delta | ROI |
|---|---:|---:|---:|---|
| authored production LOC | 1063 | 1062 | -1 | better |
| authored production LOC, code only | 918 | 916 | -2 | better |
| duplicated lines | 17 | 15 | -2 | better |
| allocations per `outcome()` round | 41 | 4 | -37 (-90.2%) | better |
| BigInt operations per round | 33 | 1 | -32 | better |
| `outcome()` 200k rounds, min of 7 | 2885.2 / 2903.3 ms | 1819.0 / 1895.6 ms | -36.9% / -34.7% | better |
| `outcome()` 200k rounds, median of 7 | 3002.2 / 3072.0 ms | 1849.8 / 1906.9 ms | -38.4% / -37.9% | better |
| `hexToBytes` 1M calls, min of 7 | 1150.4 ms | 193.3 ms | -83.2% | better |
| `floodOrder` 20k boards, min of 7 | 105.0 ms | 85.8 ms | -18.3% | better |
| RTP gate wall time, identical 1M-round run | 15.7 s | 9.9 s | -36.9% | better |
| `onRandomness` gas, mean of 120 words | 57,593 | 57,593 | 0 | unchanged |
| `FloodGame` creation bytecode | 2619 B | 2619 B | 0 | unchanged |
| fragment copies per hex parse | 32 substrings | 0 | -32 | better |
| stream stages, VRF word to painted band | 9 | 9 | 0 | unchanged |
| attribute copies per round (`_INPUT33` absorb, field build) | 2 | 2 | 0 | unchanged |
| exported symbols | 20 | 20 | 0, byte-identical list | unchanged |
| API clarity | one inline balance parse duplicated, magic 250 restated three times | one `smartBalance`, one declared constant | better |
| error clarity | the demo re-derived its outcome through a second call whose failure had no owner | one derivation, one balance failure site, two guards against dead code | better |
| observability | unchanged | unchanged | 0 | unchanged |
| maintainability | 1634 assertions on 219, `resetBoard` and two unused imports dead in the file | 1634 assertions, dead-code and unused-import guards, no dead bindings | better |
| model test assertions | 219 | 1634 | +1415 | better |

## Contract preservation, checked mechanically

- `game/model.mjs` exports the same 20 symbols, diffed symbol by symbol against `663f4b0`.
- `contracts/` has an **empty diff** against the baseline. Both contract refactors the campaign
  tried were reverted after measuring them as gas increases.
- `index.html`, `src/styles.css`, `public/`, `scripts/` and `package.json` have an empty diff.
- No line containing `BANDS =`, `EXPECTED_RTP_BPS`, `MIN_WIN_AREA =`, `mult:` or
  `JACKPOT_PROBABILITY` was touched.
- The 20 real settled `gameState` payloads replay to the same fields, starts, areas and payouts.
- The deployed `FloodGame` settles the jackpot word to the same area, band and payout the model does.
- The 1,000,000-round RTP run returns a bit-identical result on both trees:
  9464.39 bps, 95% CI [9275.93, 9652.86], win rate 23.599%, 1463 jackpot hits.
- `keccak256` is pinned to three vectors plus `cast keccak`'s answer for the fox sentence, so the
  flattened rotation table is checked against a second implementation rather than against itself.

## Expected ROI vs measured ROI

| Dimension | Expected | Measured | Match |
|---|---|---|---|
| LOC | -600 (campaign target) | **-1** | **no** |
| LOC, §18 per candidate | lower or equal for every applied loop | 7 loops exceeded it on landing; 3 reworked, 1 reverted | after rework |
| allocations per round | large drop | 41 -> 4 (-90.2%) | yes |
| CPU on the hot path | large drop | -36.9% / -38.4% min / median on `outcome()` | yes |
| duplicate code | down | 17 -> 15 lines; 2 duplicated blocks removed | yes |
| gas on the money path | neutral or better | unchanged, after two forms were measured as increases and reverted | yes |
| contract drift | none | export list byte-identical, empty contract diff, empty layout diff, 20 real rounds and 1M RTP rounds bit-identical | yes |
| browser behaviour | unchanged | 15 DEMO rounds across two sessions, all bands correct, tool palette renders, mute toggles, 0 page errors | yes |

The campaign expected a LOC reduction of 600 lines and delivered one. It expected a large allocation
and CPU drop and delivered 90% and 38%. The gap is not a shortfall in the work: on a 1063-line
authored tree the removable fat was per-round allocation and per-byte re-parsing. Reaching -600 would
have meant deleting the comments that explain why the constants are what they are, hand-editing the
vendored `src/sdk/guest.mjs`, or restructuring the interface contract shared with the other two games.

Seven candidates broke the §18 LOC row when they first landed. The response was to rework three of
them, revert one outright, and keep the branch total at -1. Two candidates were also rejected on
measurement alone: precomputed keccak lane indices (no win) and `floodOrder` reading a cells array
(+93% slower).

## Independent corroboration of the flow

The outcome flow was mapped by hand before any optimization. A `graphify` structural index built
afterwards (359 nodes, 578 edges, 22 communities) returns the same chain when asked how the VRF word
reaches the payout: `_paint` -> `_floodArea` -> `_multiplier`/`_payout` ->
`onRandomness` -> `decodeGameState` -> `bandOf`/`outcome`/`floodOrder`. Its most-connected nodes are
`FloodGame` (31 edges), `outcome()` (19), `floodOrder()` (17), `deriveCanvas()` (16), `makeRng()`
(13) and `keccak256()` (11), which is the path the benchmarks and the allocation counter measured.
Two independently produced views of the same flow agree.

## Classification

**ADOPT.**

Every dimension the campaign was allowed to move moved in the right direction and is backed by a
captured artefact, and every dimension it was forbidden to move is held fixed by a mechanical diff, a
bit-identical million-round RTP run, twenty replayed on-chain rounds and a deployed-contract parity
check. Seventeen commits, each passing the full suite on its own, so any loop or rework reverts alone.

Three caveats stated rather than buried:

1. **LOC barely moved.** -1 authored lines, -2 code-only lines. The gain is in allocation, CPU and
   duplication. If the goal is line count, this campaign is the wrong instrument.
2. **Three dimensions are UNPROVEN rather than better**: the canvas-loop candidates (R3, R4) were
   rejected because nothing in the repository can measure them, and `onRandomness` gas and contract
   bytecode are held constant deliberately rather than improved.
3. **A real, unclaimed win is on the table.** R14 (hashing into a caller-supplied buffer) measures
   allocations 4 -> 3 and `outcome()` -3.4%. It was rejected because it costs +4 production lines and
   adds a second entry point into the hash, which §11 forbids. A future campaign with a different LOC
   posture should take it.

## A finding, not a fix

The meter's hardcoded band widths are `[30, 10, 10, 10, 20, CELLS - 80]`, which sum to 144.
`BANDS` genuinely tiles 0..144 inclusive, which is 145 values, so the losing band is drawn one tile
too wide and the 250x band one tile too narrow. The flooded area ranges 1..144 because a flood
always includes its start cell, so no player ever loses the missing tile; the defect is purely in
the decorative meter. Correcting it changes what the meter renders, which this campaign's
preserve-user-visible-behaviour rule forbids, and it contradicts an existing test that pins
`CELLS - 80` deliberately. Recorded, not changed.

## What was not done

The documented pre-existing defects in the workspace `AGENTS.md` section 5 were out of scope, and no
candidate's evidence showed one of them to be the highest-ROI upstream fix. The `02-handicap`
defects are in a different game and a different repo, and fixing them would change user-visible
behaviour.