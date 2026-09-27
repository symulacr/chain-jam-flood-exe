# flood-exe — VRF decidability

**Claim:** the entire outcome is a pure function of one 32-byte Chain VRF word. `outcome(word)`
takes no other input, performs no I/O, and calls no crypto/randomness function.

## The derivation (contract-authoritative)

`FloodGame.sol` `_paint` / `_floodArea`:

```
field  = uint256(keccak256(abi.encodePacked(randomness, uint8(0)))) >> (256 - 144)
start  = first byte < 144 scanning (stream >> (8*i)) & 0xff over
         uint256(keccak256(abi.encodePacked(randomness, uint8(1))));
         fallback keccak256(..., uint8(2)); fallback 0
area   = | 4-connected same-colour component containing start |
payout = wager * _multiplier(area) / 1e18
```

`game/model.mjs` reproduces this byte-for-byte with a self-contained pure-JS Keccak-256 (no
`node:crypto`, no wasm, no files), so the browser and Node run the identical function.

## How many bits are consumed

- **Canvas:** the top **144 bits** of `keccak256(word ‖ 0x00)` — exactly one bit per cell. No
  bits are wasted and none are reused for the start cell.
- **Start cell:** rejection-sampled from `keccak256(word ‖ 0x01)`: bytes are scanned from the
  least-significant end and the first byte `< 144` is taken (accept probability `144/256 = 0.5625`;
  expected ≈ 1.78 bytes consumed; a fresh word is drawn only in the ≈ `(112/256)^32 ≈ 1e-12`
  event that all 32 bytes are rejected).
- Because the word is **hashed** (twice, with different domain tags) rather than read bit-for-bit,
  the **whole 256-bit word** influences the outcome — the canvas and the start cell both depend on
  it non-linearly.

## What makes it decidable

- The canvas is 144 bits of the word — nothing is drawn client-side.
- The start cell is **rejection-sampled**, never `byte % 144` (no modulo bias).
- `floodOrder` is used **only** for the reveal animation; it changes no money. `area` and
  `payout` in a settled round are decoded straight from the contract's `gameState`.

## Verification

| check | evidence |
|---|---|
| keccak-256 is correct | `keccak256("")` / `keccak256("abc")` vectors + a 33-byte `abi.encodePacked(word,0x00)` vector, all independently reproduced by pycryptodome and foundry `cast keccak` |
| JS derivation == contract | byte-scan start equals the BigInt `(stream >> 8i) & 0xff` scan over 20,000 random words (0 mismatches); the fast canvas hash equals the BigInt-field canvas on every test round |
| real chain rounds | 20 settled `gameState` payloads decode to the same field/start/area and band the chain paid (`tests/model.test.mjs`) |
| no other input | `outcome` signature is `(word)`; it is asserted deterministic twice in the tests |

## Honest gap

The vendored `tests/fixtures/settled-sessions.json` contains **no 250× jackpot payload** (max
area 61 = 6×). The top band is reachable (three live jackpots on record in the prototype wave-3
material: sessions 2440 / 3653 / 3779) and is exercised by a pure full-canvas boundary test, but
not by a settled fixture.
