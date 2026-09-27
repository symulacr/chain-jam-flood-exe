# FLOOD.EXE — the model (`game/model.mjs`)

This directory holds the **single source of truth** for the game's outcome function and
paytable. `src/app.js` imports `game/model.mjs` directly and the verification harness imports
the same file — so the page can never disagree with the money. There is no transcribed copy.

The Solidity contract (`contracts/FloodGame.sol`) is the **authority**. `model.mjs` reproduces
`FloodGame._paint` / `_floodArea` / `_multiplier` exactly, so a settlement can be re-derived
in the browser and in Node from nothing but the VRF word.

## The mechanic

A **12×12 canvas** (144 cells) is painted with **two colours**, one bit per cell. A **start
cell** is chosen, and the paint **floods** out from it through every 4-connected cell of the
**same colour** (a flood/fill). The payout is a banded multiple of **how many cells the flood
reached**. The whole picture — which cells are which colour, and where the flood starts — is
decided by one 32-byte Chain VRF word. There is no player input after the wager.

## The paytable

Exact integer code, shared by the model and the contract. `area` is the flooded cell count.

| band (flooded cells) | `BANDS.mult` | total return |
|---|---|---|
| 0–29   | 0   | nothing (the paint never reached the minimum) |
| 30–39  | 1.5 | 1.5× |
| 40–49  | 2   | 2× |
| 50–59  | 3   | 3× |
| 60–79  | 6   | 6× |
| 80–144 | 250 | 250× (the whole picture) |

`MIN_WIN_AREA = 30`; the bands tile `0..144` with no gap and monotonic multipliers. This
matches `FloodGame._multiplier` band for band (`if (area < 30) return 0;` … `return
MAX_MULT_WAD;`), which `tests/model.test.mjs` and `tests/contract.test.mjs` assert.

## The VRF mapping

From a single `bytes32 word` (the Chain VRF output), the contract — and `model.mjs` — derive
**both** the canvas and the start cell by hashing the word:

```
canvas :  field = uint256(keccak256(word ‖ 0x00)) >> (256 - 144)      # top 144 bits
          cell i is bit i of `field` (LSB first); colour 0 or 1
start  :  stream = uint256(keccak256(word ‖ 0x01))
          scan the LEAST-significant byte first: b = (stream >> 8i) & 0xff
          the first b < 144 wins (rejection sampling — never `byte % 144`)
          fallback: keccak256(word ‖ 0x02), then 0
area   :  | the 4-connected same-colour component containing `start` |
```

The word is hashed (not read as bits directly), so the **whole 256-bit word** feeds the
outcome: the canvas is the top 144 bits of `keccak256(word ‖ 0x00)`, the start cell is
**rejection-sampled** from `keccak256(word ‖ 0x01)`. Uniform canvas over `2^144`; uniform start
over 144 with no modulo bias.

`keccak256` is implemented **in pure JavaScript** in this file (no `node:crypto`, no wasm, no
files) so the model is a pure function of the word on every platform. It is cross-checked
against two independent references — pycryptodome and foundry `cast keccak` — in
`tests/model.test.mjs`.

`outcome(word)` is a **pure function of the 32-byte word**: no crypto randomness, no I/O, no
other inputs. `floodOrder(field, start)` is used **only** for the reveal animation; it changes
no money.

## The RTP class — MONTE CARLO VALIDATED, **not exact**

**Declared: `EXPECTED_RTP_BPS = 9472` → 94.717%.** House edge 5.283%. Hit rate (area ≥ 30)
≈ 23.657%. Top multiplier 250×, ≈ 1-in-683 rounds.

This number is **Monte Carlo validated, not exact**, and that distinction is honest and
load-bearing:

- The **paytable is exact integer code** (the bands above).
- The **probabilities are not enumerable.** The outcome hashes the whole 256-bit word, and the
  cluster-size distribution of a 12×12 site-percolation canvas has no practical closed form.
  The state space (≈ `2^144` canvases × 144 start cells × 2^256 words) cannot be brute-forced.
- So `9472` is an **empirical** value, produced by simulation and corroborated three ways:
  - `prototype/game/math/tune.mjs` (corrected counter-based sampler), 10,000,000 rounds → 94.7169%;
  - an independent adversarial re-derivation (own keccak stream, own union-find flood), 200,000,000
    rounds → 94.746%;
  - 2,670 real on-chain settled rounds → 76.34% losing rounds, matching the 76.343% prediction.

It sits 1.7 pp above the jam's 93% floor and 3.3 pp below the 98% ceiling. Full derivation and
the defect history: `docs/rtp-proof.md`.

Do **not** describe this candidate's RTP as exact. It is the one candidate in the set whose RTP
is Monte Carlo (there is no finite state space to enumerate).

## Exports

`SLUG`, `COLS`, `ROWS`, `CELLS`, `MIN_WIN_AREA`, `BANDS`, `EXPECTED_RTP_BPS`, `bandOf`,
`outcome`, `makeRng` — plus the helpers the page and tests use: `deriveCanvas`,
`decodeGameState`, `floodOrder`, `colourOf`, `cellsFromField`, `floodArea`, `keccak256`,
`hexToBytes`, `bytesToHex`, `bytesToBigInt`.

`decodeGameState(hex)` decodes the contract's settled `gameState`
(`abi.encode(uint256 field, uint16 start, uint16 area, uint256 payout)`) so the reveal shows
the exact canvas and area the chain paid.

`makeRng(seed0, round)` is the counter-based round seeder (used by tooling, not by the page):
`Math.imul` / `>>> 0` / `^` / `+` only, exact for every integer round and a bijection of the round
index **within each 2^32-round window** — so no two rounds collide inside any run we performed
(all < 2^32). Across window boundaries the key can alias: `makeRng(seed, 2^32-1) === makeRng(seed,
2^32)` is a proven collision (`docs/adversarial.md`, F1). It is tooling-only and does not feed the
RTP enumeration, which draws words directly. See the C1 defect in `docs/rtp-proof.md`.

## Run the model tests

```sh
node tests/model.test.mjs     # 197 assertions incl. 20 real settled payloads
node tests/contract.test.mjs  # 76 assertions: interface, paytable parity, caps, heavy-tail
```
