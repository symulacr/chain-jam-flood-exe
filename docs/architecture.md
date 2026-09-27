# flood-exe — architecture

**What it is:** a standalone, framework-free project wrapping the proven FLOOD.EXE build. One
Chain VRF word paints a 12×12 two-colour canvas and picks a start cell; the payout is a banded
function of the 4-connected monochrome region containing that cell.

## WHERE THE MONEY IS DECIDED

**In the contract, on-chain — `contracts/FloodGame.sol`.** The browser cannot change a payout.

```
TX: host.openSession(wager)
      │  onSessionStart(ctx)      -> commits reserve (249·wager), requestRandomnessNow = true
      ▼
   Chain VRF emits bytes32 `randomness`
      │  onRandomness(ctx, randomness)      <-- THE ONLY THING THAT DECIDES A PAYOUT
      │      _paint(randomness)   -> field (144-bit canvas), start cell
      │      _floodArea(field,start) -> area
      │      _payout(ctx.wagerBase, area) = wagerBase * _multiplier(area) / 1e18
      │      newGameState = abi.encode(field, start, area, payout)
      │      nextPhase = SETTLED ; escrowDelta = 0 ; reservedProfitDelta = 0
      ▼
   gameState is public. The browser only DECODES it and DRAWS it.
```

The page holds no wager, no balance and no randomness. Everything it renders comes either from
`crypto.getRandomValues` (the explicit **DEMO**, clearly labelled "no money") or from
`decodeGameState(row.raw.gameState)` — the exact `(field, start, area, payout)` the contract
committed. `floodOrder` is presentation-only: it changes no money.

## Data flow (one round)

```
VRF word (bytes32)
      │
      ├─ keccak256(word ‖ 0x00) >> 112 ─────────────► 144-bit canvas (field)   [pure JS keccak]
      └─ keccak256(word ‖ 0x01), LS byte first,
         reject >= 144 ────────────────────────────► start cell
                     │
                     ▼
        _floodArea(field, start) ─► area (1..144) ─► _multiplier(area) ─► payout
```

The same derivation exists in exactly **two** places, and they are checked against each other:

| artefact | role |
|---|---|
| `contracts/FloodGame.sol` | **the authority** (on-chain money) |
| `game/model.mjs` | the page's + harness's copy; a pure function of the word |

`tests/model.test.mjs` also replays 20 real settled `gameState` payloads, so the JS model is
pinned to the exact areas the deployed contract paid.

## Module map (new layout)

| file | LOC | role |
|---|---|---|
| `index.html` | 84 | the servable page: head + markup. Loads `./src/styles.css`, `./src/app.js`; preloads `./game/model.mjs`; carries the `jam.chain.wtf/widget.js` tag. |
| `src/app.js` | 345 | the app (extracted verbatim from the old inline script). Imports `../game/model.mjs` and `./sdk/guest.mjs`. Owns DOM, canvas render, the DEMO path and the host embed path. |
| `src/styles.css` | 139 | the chrome (extracted verbatim from the old inline `<style>`). |
| `src/sdk/guest.mjs` | 895 | vendored SDK bridge; **byte-identical** to `jam-candidates/shared/guest.mjs` (sha256 `46263af1…a75fe`). Provides `connectGameToHost`, `observeGameContentSize`, `computeMaxWager`, `SessionPhase`. |
| `game/model.mjs` | 370 | pure-JS keccak-256, `deriveCanvas`, `floodArea`, `floodOrder`, `BANDS`, `outcome`, `makeRng`. **Single source of truth.** |
| `contracts/FloodGame.sol` (+`ICasinoGameV2.sol`, 76) | 195 | copied verbatim from `prototype/game/contracts`; the money. |
| `tests/model.test.mjs` | 195 | 197 assertions incl. 20 real settled rounds. |
| `tests/contract.test.mjs` | 141 | 76 assertions: interface, paytable parity, cap arithmetic, heavy-tail class, optional solc compile. |
| `scripts/{build,check,serve,browser-check}.mjs` | 86/41/82/215 | dependency-free dev toolchain. |

The model file is **byte-identical** to the verified candidate (`sha256
a3fbcbb18962030af4ca58661a2f14a8dbb90cd06a89b19f688d6e1663787c7c`); only its directory changed
(and, post-Wave-4, the `makeRng` doc comment was corrected identically in both copies — see
`docs/adversarial.md` F1).
The vendor bridge is byte-identical to the shared SDK bridge.

## Page structure / render

- One ES module, no bundler, no runtime dependency. `index.html` is static markup; `src/app.js`
  runs after the DOM exists (script tag at end of body).
- `connectGameToHost` is attempted on load. **The promise is not awaited**: with no host on the
  other side penpal's `connection.promise` never settles (it does not reject). The `.then`
  upgrades the page once a host answers; a **1.6 s grace timer** makes the standalone DEMO path
  obvious if none does, and a **90 s watchdog** clears a pending wager if the host goes quiet.
  See `docs/standalone.md`.
- The DEMO path seeds `crypto.getRandomValues(new Uint8Array(32))`, calls `deriveCanvas(word)` +
  `outcome(word)` from `game/model.mjs`, and reveals through the **same** `reveal()` render path
  the embedded game uses.
- Render: `<canvas>` flood reveal (cells turn red in BFS radial order), a territory meter with the
  band boundaries, a status bar, and an in-page result panel. No popups, no navigation.

## Deliberate non-goals

- **No decision after the wager** (see `README.md`, `rtp.md`): the verified game is preserved
  as-is. The suggested future improvement (pre-wager canvas-scale choice + bank-or-continue) is
  documented, not implemented.
- The host embed path is implemented and was exercised in Wave 3: the host harness mounted the
  guest, wagered through the bridge and rendered a settled row (`docs/host-embed.json`); see
  `chain-integration.md`.
- Production-chain deployment is **EXTERNAL BLOCKED** (see `testnet.md`).
