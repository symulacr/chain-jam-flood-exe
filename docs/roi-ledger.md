# ROI ledger — FLOOD.EXE optimization campaign (`opt/roi-1`)

Baseline `663f4b0`. Every row is BEFORE -> AFTER with the artefact that measured it.

## Measurement harnesses

| Artefact | What it does |
|---|---|
| `alloc-count.mjs` | replaces the global typed-array constructors and `BigInt` before importing the module, then counts allocations over 50 `outcome()` calls |
| `bench.mjs` | 200,000 `outcome()` calls, 20,000 warm-up, 7 timed runs, reports min and median, prints a checksum of every `stat` |
| `bench-hex.mjs` | 1,000,000 `hexToBytes` calls over a fixed corpus, same protocol |
| `bench-order.mjs` | 20,000 `floodOrder` calls over derived canvases, same protocol |
| `bench-decode.mjs` | 1,000,000 `decodeGameState` calls over the 20 real settled payloads, same protocol |
| `gas-probe.mjs` | solc 0.8.34 `--optimize`, deploy to anvil, `eth_estimateGas` on `onRandomness` for 120 seeded words |
| `loc-final.txt`, `gates-final2.log`, `launch-final.log`, `rtp.log`, `final-measure.log` | the captured sweeps |

Checksums are the behaviour guard. `stat` over 200,000 rounds: **26211661** on the baseline and on
every accepted candidate. `floodOrder` total over 20,000 boards: **2621038** on both. Area over 50
rounds: **981** on both. Decode over the 20 real payloads: **128100366** on both.

## §18 gate audit, per commit

Production LOC = `src/app.js` + `game/model.mjs` + `contracts/*.sol`. The middle column is the
signed delta that commit contributed.

| Commit | Change | Production LOC |
|---|---|---:|
| `ea7fcd1` | demo path bands the canvas it already derived | -1 |
| `12a5301` | keccak256 reuses one scratch state block | +1 |
| `9ab9f3e` | flood scratch buffers become module level | +4 |
| `dbc8820` | field reads the 18 bytes the contract keeps | +9 |
| `8e34bdb` | start scan walks tags without a per-call array | +0 |
| `ea12296` | reveal flood walks a cursor instead of shifting | -9 |
| `9f59594` | balance parse has one failure site | +2 |
| `4909280` | jackpot threshold reads the declared constant | +0 |
| `017b46e` | hex codecs read lookup tables | +13 |
| `4787688` | start scan is one loop over two hashes | +3 |
| `f0c5208` | hex parse reads the source string in place | +2 |
| `5fb37ee` | last settled row uses findLast | +0 |
| `e82d210` | reveal drops its dead source label | -1 |
| `70c75e1` | campaign ledger and final report | +0 |
| `2964937` | **rework** of L2/L4/L9: flatten the keccak tables, inline the field read | -7 |
| `a137759` | **revert** of L10: both contract forms cost gas | -3 |
| `b98ecbd` | **rework** of L1/L7: tool icons as data, dead bindings gone | -14 |

Seven candidates exceeded the LOC row when they landed. Three of them were reworked and one was
reverted outright; the branch total is now **1063 -> 1062 (-1)**, and the code-only count is
**918 -> 916 (-2)**. The contract is byte-identical to the baseline.

## Final measurements

| Metric | Baseline `663f4b0` | Optimized `b98ecbd` | Delta |
|---|---:|---:|---:|
| authored production LOC | 1063 | 1062 | -1 |
| authored production LOC, code only | 918 | 916 | -2 |
| duplicated lines (>=28 chars) | 17 | 15 | -2 |
| allocations per `outcome()` round | 41 | 4 | -90.2% |
| BigInt operations per round | 33 | 1 | -32 |
| `outcome()` 200k rounds, min of 7 (run 1 / run 2) | 2885.2 / 2903.3 ms | 1819.0 / 1895.6 ms | -36.9% / -34.7% |
| `outcome()` 200k rounds, median of 7 (run 1 / run 2) | 3002.2 / 3072.0 ms | 1849.8 / 1906.9 ms | -38.4% / -37.9% |
| `hexToBytes` 1M calls, min of 7 | 1150.4 ms | 193.3 ms | -83.2% |
| `hexToBytes` 1M calls, median of 7 | 1165.4 ms | 202.5 ms | -82.6% |
| `floodOrder` 20k boards, min of 7 | 105.0 ms | 85.8 ms | -18.3% |
| RTP gate wall time, identical 1M-round run | 15.7 s | 9.9 s | -36.9% |
| `onRandomness` gas, mean of 120 words | 57,593 | 57,593 | 0 |
| `FloodGame` creation bytecode | 2619 B | 2619 B | 0 |
| exported symbols in `game/model.mjs` | 20 | 20 | 0, byte-identical list |
| model test assertions | 219 | 1634 | +1415 |
| stream stages, VRF word to painted band | 9 | 9 | 0 |
| hex fragments copied per parse | 32 substrings | 0 | -32 |

## Rejected candidates, with the number that rejected them

| # | Change | Verdict | Evidence |
|---|---|---|---|
| R1 | precompute the keccak `PI`, `I1`, `I2` lane indices | NEGATIVE | paired: 1857.0 -> 1864.5 ms min, 1985.2 -> 2036.7 median |
| R2 | row bounds from the flat index (`i >= COLS`, `i < CELLS - COLS`), JS + Solidity | NEGATIVE | gas 57,593 -> 58,105 mean (+0.8%), max 148,785 -> 150,721; JS gain inside noise |
| R3 | hoist `ctx.strokeStyle = GRID` out of the 144-iteration `drawBoard` loop | UNPROVEN | no canvas harness in-repo; each frame already issues 288 canvas calls |
| R4 | replace the per-frame `new Set(order.slice(0, painted))` with a grown `Uint8Array` | UNPROVEN / LOW | same, and it would add a parameter to `drawBoard` |
| R5 | read the canvas through `cellsFromField` inside `floodOrder` (L18) | **NEGATIVE, measured** | `floodOrder` 84.6 -> 163.5 ms min (+93%), orderSum identical at 2621038 |
| R6 | hash `word || tag` without copying into `_INPUT33` | REJECTED | needs a second copy of the absorb-and-pad logic, i.e. keccak padding in two places |
| R7 | fold JS `BANDS` and Solidity `_multiplier` into one source | IMPOSSIBLE | Solidity cannot read a JS array; the textual parity assertions are the cheapest correct guard |
| R8 | delete `bytesToBigInt` (production-dead since the field rework) | REJECTED | exported symbol; §18 forbids changing the export list |
| R9 | cache `document.getElementById` lookups | LOW | ~25 hash lookups per host snapshot, a few snapshots a second |
| R10 | unify the two `sound` arpeggios | REJECTED as a LOC play, **kept** as a dedup | `arp` landed in `b98ecbd`: one player for both, 0 LOC change |
| R11 | derive the meter's band widths from `BANDS` (L14) | REJECTED, and a finding | hardcoded widths `[30,10,10,10,20,64]` sum to 144; `BANDS` really tiles 0..144 = 145 values, so the losing band is drawn one tile too wide and the 250x band one too narrow. Deriving from `BANDS` would change what the meter renders and contradict an existing intentional guard. Out of scope: it changes user-visible output. |
| R12 | round constants as one interleaved `Int32Array` (L17) | NEUTRAL, measured | 1867.6 -> 1895.1 ms min, 1895.4 -> 1900.6 median; 2 lines -> 1 for no gain |
| R13 | `decodeGameState` parses its two BigInt words as 16-hex chunks (L19) | **NEGATIVE, measured** | 325.5 -> 780.9 ms min (+140%); one `BigInt('0x'+64)` parse beats four 16-char parses |
| R14 | hash into a caller-supplied buffer (L20) | **REJECTED on the gate** | measured real: allocations 4 -> 3, `outcome()` 1867.6 -> 1803.9 ms min. Needs +4 production lines and a second entry point into the hash, which §11 forbids and the LOC row forbids. Recorded because the trade is real and a later campaign may price it differently |
| R15 | the contract's start-cell scan as one `_scan` helper (L10, first form) | **NEGATIVE, measured** | gas 57,593 -> 57,631 mean (+0.07%), max 148,785 -> 148,823 |
| R16 | the contract's start-cell scan as a nested tag loop (L10, second form) | **NEGATIVE, measured** | gas 57,593 -> 57,784 mean (+0.33%), max 148,785 -> 148,976. Both forms were reverted in `a137759` |

## Per-candidate verification

Every applied loop added assertions to `tests/model.test.mjs` that drive the shipped function. Five
guards were checked by deliberately breaking what they protect:

| Guard | Break injected | Result |
|---|---|---|
| keccak scratch must be cleared per call | delete `s.fill(0)` | 308 assertions fail |
| flood scratch must be cleared per call | delete `seen.fill(0)` | 57 assertions fail |
| `floodOrder` neighbour order is the reveal's paint order | swap right and down | 145 assertions fail |
| `hexToBytes` accept/reject set | run the new codec tests against the old implementation | 0 failures, so the tests pin behaviour and not the implementation |
| app.js has no unreferenced top-level binding | append `function deadOne() { return 1; }` | guard fires, names `deadOne` |
| app.js has no unused model import | add `ROWS` back to the import list | guard fires, names `ROWS` |

The first rework also failed twice before passing, both times caught by the existing suite:
flattening the keccak rotation table row-major produced `5x+y` where the index is `x+5y`
(keccak vectors failed), and merging the nibble table into one 16-iteration loop mapped `a`..`f`
to 0..5 (the hex round-trip failed). Both were corrected before commit.