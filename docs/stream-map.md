# Stream/flow map — FLOOD.EXE outcome path

Baseline `663f4b0` on branch `opt/roi-1`. File:line references are against that commit.

## The chain

```
UPSTREAM SOURCE      Chain VRF -> bytes32 randomness          (external, off-chain input)
   |
   v
CONTRACT PAINT      contracts/FloodGame.sol:117 _paint
   |                  field = keccak256(word||0x00) >> 112     :118
   |                  start = scan uint256(keccak256(word||t)) :119-133
   v
CONTRACT FLOOD      contracts/FloodGame.sol:154 _floodArea     (visited bitmask + stack[CELLS])
   |
   v
BAND / PAYOUT       contracts/FloodGame.sol:93 _multiplier -> :104 _payout
   |
   v
SETTLE + ENCODE     contracts/FloodGame.sol:211 onRandomness -> abi.encode(field,start,area,payout) :215
   |
   v
TRANSPORT           host snapshot -> sessions.items[].raw.gameState (hex string)
   |
   v
JS DECODE           game/model.mjs:302 decodeGameState  (4 x 64 hex chars -> BigInt/Number)
   |                                    src/app.js:293 revealFromRow
   v
JS PRESENTATION      game/model.mjs:319 floodOrder (BFS, presentation only, changes no money)
   |                  src/app.js:157 drawBoard, src/app.js:161 setPainted, src/app.js:124 renderResult
   v
OUTPUT              #result-slot innerHTML

--- parallel path used by the harness and by the standalone demo ---

DEMO / HARNESS      game/model.mjs:291 deriveCanvas(word) -> game/model.mjs:351 outcome(word)
   |                src/app.js:186 demoRound calls BOTH, for the SAME word
   v
BAND                game/model.mjs:347 bandOf
```

## Copy points

| # | Site | What is copied | Bytes per round |
|---|------|----------------|-----------------|
| C1 | `game/model.mjs:264 canvasHash` | `wordBytes` into the module scratch `_INPUT33` | 32 |
| C2 | `game/model.mjs:160 keccak256` | `s = new Int32Array(50)` per call; called 2-3x per round | 200 x2..3 |
| C3 | `game/model.mjs:189` | `out = new Uint8Array(32)` per call (returned; ownership leaves) | 32 x2..3 |
| C4 | `game/model.mjs:230 cellsFromCanvasHash` | `new Uint8Array(144)` per round | 144 |
| C5 | `game/model.mjs:240 floodArea` | `new Uint8Array(144)` seen + `new Int32Array(144)` stack per round | 720 |
| C6 | `game/model.mjs:294` | `bytesToBigInt(H)` walks all 32 bytes, then a 112-bit shift, to keep 18 | 32 BigInt ops |
| C7 | `src/app.js:188-191 demoRound` | the whole keccak+flood pipeline runs twice for one word | 100% of demo CPU |
| C8 | `game/model.mjs:319 floodOrder` | `queue.shift()` re-copies the array head on every pop | O(n^2) element moves |
| C9 | `game/model.mjs:330` | `const neighbours = []` per visited cell | 144 array allocs |
| C10 | `src/app.js:96` | `new Set(order.slice(0, painted))` per animation frame | up to 70 sets |
| C11 | `src/app.js:101` | `ctx.strokeStyle = GRID` assigned 144x per frame | 144 state sets |

## Allocation sites (round trip)

`keccak256` 2-3x {Int32Array(50), Uint8Array(32)}, `cellsFromCanvasHash` {Uint8Array(144)},
`floodArea` {Uint8Array(144), Int32Array(144)}, `floodOrder` {Set, Array, neighbours[] per cell}.
`pickStart` :277 allocates `[1, 2]` per call.

## Ownership changes

- `keccak256` :160 owns `s` (internal) and hands `out` to the caller. Only `out` escapes.
- `cellsFromCanvasHash` :230 hands its `Uint8Array(144)` to `floodArea` :239, which reads it
  and never retains it.
- `floodOrder` :319 owns `seen`/`queue`/`order` and returns `order` to `src/app.js:157`.

## Error-context losses

- `src/app.js:299` swallows a malformed `gameState` with an empty catch: a decode failure is
  indistinguishable from "no result". Left alone (user-visible behaviour).
- `src/app.js:285` swallows the same class of failure inside the demo path.
- `game/model.mjs:284 pickStart` returns `0` on total rejection. The comment states the
  probability; no error surfaces. Matches the contract, so it stays.

## Candidate inventory

| ID | Surface | Hypothesis |
|----|---------|------------|
| L1 | `src/app.js:188 demoRound` | `deriveCanvas` already returns `area`; the second `outcome(word)` call re-runs keccak x2 + flood for a value already in hand. Removing it halves demo CPU. |
| L2 | `game/model.mjs:161` | `keccak256`'s `s` never escapes; module scratch (the pattern `_C/_D/_B` already use) removes an Int32Array(50) per call. |
| L3 | `game/model.mjs:231,241` | canvas/seen/stack buffers never escape the module; module scratch removes 3 allocations and 864 bytes per round. |
| L4 | `game/model.mjs:294` | only the top 144 bits survive `>> 112`; reading 18 bytes instead of 32 cuts the BigInt loop by 44%. |
| L5 | `game/model.mjs:277 pickStart` | `[1, 2]` is a 2-element array allocated per round for a two-iteration loop. |
| L6 | `game/model.mjs:321 floodOrder` | index pointer replaces `shift()`; the per-cell `neighbours` array is pure overhead. Traversal order unchanged, so the reveal animation is unchanged. |
| L7 | `src/app.js:256,311` | the smartVaultBalance parse+try/catch is written twice, identically. One helper removes the second site. |
| L8 | `src/app.js:130` | `mult >= 250` restates `MAX_MULTIPLIER_X`, which the file already declares at :9. |
| L9 | `src/app.js:101` | `ctx.strokeStyle = GRID` is loop-invariant. |
| L10 | `src/app.js:96` | `new Set(order.slice(...))` per frame vs one set built incrementally across the animation. |
| L11 | `contracts/FloodGame.sol:119-132` | the two 9-line rejection-scan loops are the same loop over two hashes. |