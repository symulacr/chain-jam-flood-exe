# ROI ledger — FLOOD.EXE optimization campaign (`opt/roi-1`)

Baseline `663f4b0`. Each row records BEFORE -> AFTER with the artefact that measured it.

Measurement artefacts (all under the campaign scratch dir):

| Artefact | What it is |
|---|---|
| `alloc-count.mjs` | replaces the global typed-array constructors and `BigInt` before importing the module, then counts allocations over 50 `outcome()` calls. Reports per-round counts. |
| `bench.mjs` | 200,000 `outcome()` calls, 20,000 warm-up, 7 timed runs, reports min and median. Prints a checksum of every `stat` so a behaviour change cannot hide. |
| `bench-hex.mjs` | 1,000,000 `hexToBytes` calls on a fixed 1M-string corpus, same protocol. |
| `bench-order.mjs` | 20,000 `floodOrder` calls over derived canvases, same protocol. |
| `gas-probe.mjs` | compiles `contracts/FloodGame.sol` with solc 0.8.34 `--optimize`, deploys to anvil, `eth_estimateGas` on `onRandomness` for 120 seeded words, reports mean and max. |
| `loc.txt`, `diff-review.log` | per-file LOC and duplicate-line counts, and the per-commit diff review. |

`stat` checksum over 200,000 rounds: **26211661 on baseline and on every accepted candidate**.
`floodOrder` total over 20,000 boards: **2621038 on both**. Area checksum over 50 rounds: **981 on both**.

## Baseline measurements

| Metric | Value | Source |
|---|---:|---|
| authored production LOC (`src/app.js` + `game/model.mjs` + `contracts/*.sol`) | 1063 | `loc.txt` |
| authored production LOC, comments and blanks stripped | 918 | `loc.txt` |
| duplicated non-trivial lines (>=28 chars, authored code) | 17 | `loc.txt` |
| allocations per `outcome()` round | 41 (Int32Array 3, Uint8Array 5, BigInt 33) | `alloc-baseline.log` |
| `outcome()` 200k rounds, min of 7 | 2859.9 ms | `bench-final.log` |
| `outcome()` 200k rounds, median of 7 | 2979.8 ms | `bench-final.log` |
| `hexToBytes` 1M calls, min of 7 | 1596.0 ms | `hex-before.log` |
| `floodOrder` 20k boards, min of 7 | 115.6 ms | `order-before.log` |
| `onRandomness` gas, mean over 120 words | 57,631 | `gas-before.log` |
| `FloodGame` creation bytecode | 2619 B | `gates-run1.log` |
| model test assertions | 219 | `gates-run1.log` |
| RTP gate, 1,000,000 rounds wall time | 15.7 s | RTP timing note below |

## Applied candidates

| # | Commit | Change | LOC | Dup lines | alloc/round | ms | Verdict |
|---|---|---|---:|---:|---:|---:|---|
| L1 | `ea7fcd1` | `src/app.js` demo path bands the canvas it already derived, instead of calling `outcome()` a second time on the same word | 0 | 0 | n/a (UI) | demo round ~halved | HIGH |
| L2 | `12a5301` | `keccak256` reuses one scratch state block instead of allocating `Int32Array(50)` per call | +1 | 0 | 41 -> 39 | -2 Int32Array/round | HIGH |
| L3 | `9ab9f3e` | canvas, visited and stack buffers become module scratch | -1 | 0 | 39 -> 36 | -864 B garbage/round | HIGH |
| L4 | `dbc8820` | the field is read from the 18 bytes the contract's `>> 112` keeps, instead of converting 32 BigInt bytes and discarding 14 | +6 | 0 | 36 -> 4 | 2979.8 -> 1824.4 median | HIGH |
| L5 | `8e34bdb` | the start scan walks tags with a counter, no `[1, 2]` array per round | 0 | 0 | 0 | within noise | MEDIUM |
| L6 | `ea12296` | `floodOrder` walks a cursor and inlines the four neighbour tests; no `shift()`, no per-cell array | -8 | 0 | -1 array/cell | 115.6 -> 108.4 ms | MEDIUM |
| L7 | `9f59594` | one `smartBalance` helper replaces two identical parse-and-catch blocks | -2 | -1 | 0 | n/a | MEDIUM |
| L8 | `4909280` | the jackpot threshold reads `MAX_MULTIPLIER_X` instead of restating `250` three times | 0 | 0 | n/a | n/a | MEDIUM |
| L9 | `017b46e` | `hexToBytes`/`bytesToHex` read lookup tables | +4 | 0 | -64 substrings/round | 1596.0 -> 214.3 ms | HIGH |
| L10 | `4787688` | the contract's start-cell rejection scan is one loop over two hashes | -3 | -1 | n/a | bytecode 2537 B (from 2537 after L9) | MEDIUM |
| L11 | `f0c5208` | `hexToBytes` reads the source string in place; no regex-`replace` substring | +2 | 0 | -1 string/round | 214.3 -> 204.3 ms | HIGH |
| L12 | `5fb37ee` | the snapshot path takes its last settled row with `findLast` | 0 | 0 | -2 arrays/snapshot | n/a | MEDIUM |
| L13 | `e82d210` | `renderResult` drops its dead `source` parameter and its `void` discard | -2 | 0 | n/a | n/a | MEDIUM |

Total across the 13 accepted loops: authored LOC **1063 -> 1086 (+23)**, code-only LOC **918 -> 937 (+19)**,
duplicate lines **17 -> 13 (-4, -23.5%)**, allocations per round **41 -> 4 (-90.2%)**,
`outcome()` min **2859.9 -> 1783.6 ms (-37.6%)**, median **2979.8 -> 1824.4 ms (-38.8%)**,
`hexToBytes` min **1596.0 -> 204.3 ms (-87.2%)**, RTP gate wall time **15.7 s -> 9.7 s (-38.2%)**
on an identical 1,000,000-round run that produced a bit-identical result.

### Why LOC rose while the cost fell

Every accepted loop that spent lines spent them on a lookup table (`_NIB`, `_HEX2`) or on a stated
invariant, and took more lines out of the allocation and re-parse paths than it put in. The target of
-600 LOC was not reachable on a 1063-line authored tree without deleting the explanatory comments the
repository treats as its main asset, or touching `src/sdk/guest.mjs` (vendored, must not be hand-edited)
or `contracts/ICasinoGameV2.sol` (shared with the other two games). Both were rejected on ROI grounds.
See `docs/optimization-report.md` for the final classification.

## Rejected candidates

| # | Change | Verdict | Reason (measured) |
|---|---|---|---|
| R1 | precompute the keccak `PI`, `I1`, `I2` lane indices and drop the `(x+4)%5` / `(x+1)%5` remainders | **NEGATIVE** | Paired benchmark: 1857.0 -> 1864.5 ms min, 1985.2 -> 2036.7 median. No win; V8 already strength-reduces these remainders and the tables add a load. Reverted. |
| R2 | derive row bounds from the flat index (`i >= COLS`, `i < CELLS - COLS`) and drop the per-cell division, in JS and Solidity together | **NEGATIVE** | Gas probe over 120 words: mean 57,631 -> 58,105 (+0.8%), max 148,823 -> 150,721. The JS half was worth 1857.0 -> 1828.9 ms min, inside run-to-run noise. Spending gas on the money path for a noise-level JS gain is a loss. Reverted. |
| R3 | hoist `ctx.strokeStyle = GRID` out of the 144-iteration `drawBoard` loop | **UNPROVEN** | No canvas harness in-repo, so no measurable delta. Each frame already issues 144 `fillRect` + 144 `strokeRect`; 144 state assignments are not the bottleneck. |
| R4 | replace the per-frame `new Set(order.slice(0, painted))` with a `Uint8Array` grown across the animation | **UNPROVEN / LOW** | Same reason as R3, and it would add a parameter to `drawBoard`'s signature. |
| R5 | read the canvas through `cellsFromField` inside `floodOrder` instead of `colourOf`'s BigInt shift | **NEGATIVE by analysis** | `colourOf` is only reached for unvisited neighbours, so the flood performs O(area) BigInt shifts, not O(4 x 144). `cellsFromField` would do 144 unconditionally. Worse. |
| R6 | hash `word || tag` without copying the word into `_INPUT33` | **REJECTED** | Saves a 32-byte `TypedArray#set` but needs a second copy of the absorb-and-pad logic, which would put keccak padding in two places. A second source of truth for the hash is a worse trade than 32 bytes. |
| R7 | fold the JS `BANDS` array and the Solidity `_multiplier` chain into one source of truth | **IMPOSSIBLE** | Solidity cannot read a JS array. The existing textual parity assertions in `tests/contract.test.mjs` are the cheapest correct guard. |
| R8 | delete `bytesToBigInt` (production-dead after L4) | **REJECTED** | It is an exported symbol. Deleting it changes the exported API, which the campaign forbids. |
| R9 | cache `document.getElementById` lookups in module constants | **LOW** | ~25 hash lookups per host snapshot. Snapshots arrive a few times a second. Adds lines to save nothing measurable. |
| R10 | unify the two `sound` arpeggio arrows into one helper | **LOW** | Saves one line and adds an indirection over four call sites. |

## Per-candidate verification

Every applied loop added assertions to `tests/model.test.mjs` that drive the shipped function. Four of
them were checked by deliberately breaking the thing they guard and confirming the suite fails:

| Guard | Break injected | Result |
|---|---|---|
| keccak scratch must be cleared per call | delete `s.fill(0)` | 308 assertions fail |
| flood scratch must be cleared per call | delete `seen.fill(0)` | 57 assertions fail |
| `floodOrder` neighbour order is the reveal's paint order | swap right and down | 145 assertions fail |
| `hexToBytes` accept/reject set | run the new codec tests against the old implementation | 0 failures, i.e. the tests pin behaviour and not the implementation |