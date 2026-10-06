# flood-exe — security review

Sources: the adversarial Wave-7 audit (`research/wave7-audit-novelty-licensing-security.md` §3),
the SDK's `CONTRACT_CONSTRAINTS.md`, and a direct read of the shipped contract and page. Claims
carry a citation; anything not re-executed here is marked **UNPROVEN** and attributed.

## Headline

**No reentrancy, payout caps exact to the wei, no realistic overflow, no double-pay at the game
level.** The game is stateless and `pure`. The one substantive structural note is that the game
has **no decision after the wager** (`onPlayerAction` reverts) — a novelty weakness, not a security
hole. The one honesty flag is that the period *get-up* evokes a known late-90s raster accessory
(trade-dress PARTIAL below).

## 1. Reentrancy — all handlers `pure` (no surface)

Every `ICasinoGameV2` handler in `FloodGame.sol` is stricter than the interface's `external view`:
it is **`external pure`** — no state read/write, no external call, therefore **no reentrancy
path**. `tests/contract.test.mjs` asserts `external pure` on all six functions.

| function | kind | note |
|---|---|---|
| `quoteCaps` | pure | cap arithmetic only |
| `quoteRiskParams` | pure | risk arithmetic only |
| `onSessionStart` | pure | commits reserve, requests randomness |
| `onPlayerAction` | pure | **reverts** `FloodGame__NoPlayerAction` |
| `onRandomness` | pure | the only payout decision |
| `quoteForfeitPayout` | pure | returns 0 (instant game) |

The host's value-moving entrypoints are `nonReentrant` with checks-effects-interactions; the game
cannot call back into them.

## 2. Payout cap — exact, at the top band, no slack

| quantity | expression | value |
|---|---|---|
| reserve committed in `onSessionStart` | `wager·250 − wager` | `249·wager` |
| cap at settle = `escrowedStake + reservedProfit` | `wager + 249·wager` | `250·wager` |
| max `payout` | `wager·250e18/1e18` | `250·wager` |

`payout ≤ cap` holds with **equality**, and `onRandomness` returns `escrowDelta = 0` /
`reservedProfitDelta = 0` (never releases the reserve on the settling step). Integer floor-division
in `_payout` can only round **down**. `tests/contract.test.mjs` asserts `escrow + reserve ==
maxPayout` for representative wagers.

## 3. Heavy-tail — NOT triggered, variance quoted anyway

Rule: heavy-tail ⇔ `maxPayout/wager > 100` **AND** `probabilityWad < 1e15`.
flood-exe is `250×` (> 100) but its jackpot probability is `1.463e15 ≥ 1e15`, so it is **not**
heavy-tail and does **not** trip
`CasinoConfigFacet__HeavyTailGameWithoutVarianceSource`. It quotes a non-zero
`bodyVarianceScaled = wager²·1582620149321559800` regardless, so it is whitelist-safe on any
council threshold. The Monte-Carlo top-band frequency (≈ `1.473e15`) agrees with the declaration;
the margin above `1e15` is only ~46%, which is stated rather than glossed.

## 4. Overflow / rounding

- `wager * MAX_MULT_WAD` overflows only above `wager ≈ 4.6e56` wei.
- `wager² * BODY_VAR_SCALED` overflows only above `wager ≈ 2.7e29` wei (≈ `2.7e11` ether), far
  above any realistic wager (the contract notes this).
- The `int256(...)` reserve cast cannot overflow until `wager ≈ 2.3e74`.
- All payout math is floor-divided, so any fractional wei favours the **house**, never the player.

## 5. Double settlement / replay

The contract is **stateless** and `pure`: the payout is a deterministic function of
`(randomness, ctx)`, and `onRandomness` is idempotent for a given word — there is nothing to
increment twice. Host-side finality (`nonReentrant` + finalize-before-transfer) is the documented
guarantee — **UNPROVEN live on the production host** (the local host harness did settle one round,
`docs/verification.txt` §8, but did not adversarially test double delivery). The UI adds a second
guard: `onSnapshot` keeps a `handled` Set
keyed on `sessionId`, so a re-delivered snapshot row cannot re-reveal/re-pay (`src/app.js`).

## 6. Stale session / stuck randomness

- A hosted wager arms a **90 s watchdog**: if no settlement row arrives, `pendingKey`/`busy` are
  cleared and the player is told the host will settle or cancel (stake refunded on cancel). No
  permanent hang.
- On randomness timeout the host calls `cancelStuckRandomness`, which refunds only the stake
  (`CONTRACT_CONSTRAINTS.md`). The contract itself has no timeout logic — correct per the facet
  model. Only `FloodGame` has ever executed on an EVM (wave 6), so its on-chain timeout path is the
  one with evidence; this build's Wave 3 did re-run chain transactions on the local simulator
  (chain id 31337; see `verification.txt` W3.5), though the stuck-randomness timeout path itself
  was not re-triggered.

## 7. UI / iframe / hosting robustness

| check | result |
|---|---|
| `connection.promise` never settles ⇒ grace timer | **PASS** — 1.6 s (see `standalone.md`); the promise is never awaited |
| root-relative asset paths | **none** (all `./…` or bare) |
| `X-Frame-Options` / CSP `frame-ancestors` on the page | **none** |
| host-forbidden APIs (`window.open`, `localStorage`, `serviceWorker`, `document.cookie`, `alert/confirm`, clipboard, `window.top`, `vh`, `fetch`, `XMLHttpRequest`, `WebSocket`) | **none** in the shipped page |
| external third-party runtime deps | **none** (only a code-comment GitHub URL inside the byte-identical SDK bridge) |
| widget tag `jam.chain.wtf/widget.js` | **present** |
| `og:image` self-generated, relative | `content="og-image.png"` (`public/og-image.png`) |
| invalid / below-min wager handled | yes — `amount <= 0n` and over-limit are rejected with a message |
| malformed/absent settlement row not fatal | yes — `revealFromRow` try/catch |

## 8. Findings (ranked)

| # | sev | finding | status |
|---|---|---|---|
| S1 | **MEDIUM (novelty, not security)** | No decision after the wager: `onPlayerAction` reverts. The outcome is 100% VRF. | Accepted, documented; the cheap fix (pre-wager scale choice + bank-or-continue) is described in `rtp.md`, **not implemented** (would change the verified contract). |
| S2 | **LOW** | The game does not clamp the wager itself; min/max is the host's job (`maxBetRiskBps`/min-bet). The page pre-clamps to `computeMaxWager` where it can. | UNPROVEN for adversarial extremes without a host. |
| S3 | **INFO** | RTP is Monte-Carlo, not exact (`rtp.md`). | Stated everywhere; not a defect. |
| S4 | **INFO / judgement** | **Trade-dress PARTIAL:** the page/contract deliberately evoke a late-90s raster paint accessory. No Microsoft string, font or asset ships (harness hygiene: 0 banned strings, 0 third-party binaries). | Design-judgement risk, disclosed; artefacts clean. |
| S5 | **INFO** | In-host embed path: **cleared in Wave 3** — the host harness mounted the guest, wagered through the bridge (on-chain sessions 20 → 21) and rendered the settled row. | PASS — `docs/verification.txt` §8; see `chain-integration.md`. |

## 9. Licensing / hygiene (shipped surface)

- No `.exe/.wasm/.wast/.ttf/.woff/.woff2/.otf/.eot/.mp3/.wav/.ogg/.m4a` anywhere.
- Only media: the self-generated `public/og-image.png` (1200×630).
- No Microsoft string / trade name; no commercial game title string (harness hygiene check).
- No other third-party asset or dependency; the model is pure JS and the SDK bridge is vendored
  byte-identically.
