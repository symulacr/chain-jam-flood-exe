# flood-exe — chain integration

## Contract

Restructured from the proven build (files copied **verbatim**):

| file | size | note |
|---|---|---|
| `contracts/FloodGame.sol` | 8,058 B | `ICasinoGameV2` implementation; `_paint`/`_floodArea`/`_multiplier`/`_payout` |
| `contracts/ICasinoGameV2.sol` | 2,242 B | interface, copied unchanged |

Compiles standalone with `solc` 0.8.34, `--optimize`:

```
$ cd contracts && solc --optimize --bin FloodGame.sol
======= FloodGame.sol:FloodGame =======
Binary:
6080604052348015600e575f5ffd5b50610a1f8061001c5f395ff3fe...
# 5238 hex = 2619 bytes creation bytecode (runtime: 5182 hex = 2591 bytes)
```

## Manifest

`public/game.manifest.json` uses `presentation.mode: "full-iframe"`, all `hostPanels` false,
`capabilities.openSession: true`, and `submitAction: false` (the contract's `onPlayerAction`
reverts with `FloodGame__NoPlayerAction`, so there is no action surface). No `assets` map is
declared (no root-relative paths to 404 under a sub-path deploy).

## Session lifecycle (contract states)

| step | handler | result |
|---|---|---|
| open | `onSessionStart` | commits full reserve (`wager·250 − wager`), `nextPhase = WAITING_RANDOMNESS`, `requestRandomnessNow = true` |
| word | `onRandomness(ctx, word)` | `_paint` → `_floodArea` → `_payout`; writes `gameState = abi.encode(field, start, area, payout)`; `nextPhase = SETTLED`; returns `escrowDelta = 0`, `reservedProfitDelta = 0` |
| action | `onPlayerAction` | **reverts** `FloodGame__NoPlayerAction` (no decision after the wager) |
| forfeit | `quoteForfeitPayout` | returns `0` (instant game — nothing cashable mid-round) |
| caps | `quoteCaps` / `quoteRiskParams` | `maxEscrowStake = wager`; `maxReservedProfit = wager·250 − wager`; `maxPayout = wager·250`; jackpot probability `1.463e15`; `expectedPayout = wager·9472/10000` |

Every handler is `external pure` (verified by `tests/contract.test.mjs`), so there is no storage,
no external call and no reentrancy surface.

## Guest bridge (page ⇄ host)

`src/app.js` imports `connectGameToHost`, `observeGameContentSize`, `computeMaxWager` and
`SessionPhase` from `./sdk/guest.mjs` — a **byte-identical** copy of
`jam-candidates/shared/guest.mjs`:

```
sha256(shared/guest.mjs)             = 46263af16ea64b0e1f3e118764f82e463cd58ef1925a7b3a6af33baa121e75fe
sha256(03-flood-exe/src/sdk/guest.mjs) = 46263af16ea64b0e1f3e118764f82e463cd58ef1925a7b3a6af33baa121e75fe
```

Flow on load:

1. `const connection = connectGameToHost({ setState })`
2. `connection.promise.then(api => { hostApi = api; observeGameContentSize(api); … })` — **not
   awaited**; the promise never settles when no host answers, so the `.then`/`.catch` only upgrade
   the page.
3. BET is enabled only after `connection.promise` resolves **and** the wallet is `ready` — and it
   is re-evaluated on **every** snapshot (an earlier version latched it shut; fixed and recorded in
   `src/app.js` `onSnapshot`).
4. BET calls `hostApi.openSession({ wager, gameData: '0x' })`, tracks `sessionKey`, and reveals the
   settled row's `gameState` via `decodeGameState` (field/start straight from the contract). A
   90 s watchdog clears a stuck pending wager.
5. `window.addEventListener('beforeunload', () => connection.destroy())`.
6. If no host handshake lands within **1.6 s**, the page shows the DEMO path — it never hangs.

## Deployed and settled on the local simulator (chain id 31337)

`FloodGame` was deployed to, and settled on, the prescribed local Chain casino host (chain id
**31337**) — the environment the jam's gate names. Figures below are taken verbatim from the
read-only evidence files `research/chain-evidence.json` (per-game deployment/settlement) and
`docs/chain-proof.json` (this project's slice of `jam-candidates/tools/chain-proof-all.json`; the
two slices were compared byte-for-byte and are equal):

| item | value |
|---|---|
| contract address | `0xb7f8bc63bbcad18155201308c8f3540b07f84f5e` |
| chain id | `31337` (local simulator) |
| deploy tx | `0xfeb6ba29f514802ba3cd29cb17b2838100713484553b41371578753c19342709` |
| deploy block | `23` |
| deploy gasUsed | `525181` |
| `sessionsSettled` | `21` |
| `uniqueFulfilmentTxs` | `21` (one real VRF fulfilment tx per settled session) |
| replayed settled rounds | 20, `stuck=0`, `parityFails=0` |
| 250× max-payout eth-call | `topPath.mult = 250`, `stat = 80`, `payoutWei = 250000000000000000000`, `capWei = 250000000000000000000`, `withinCap = true`, `nextPhase = 3` (SETTLED) |

The 250× top-path probe is an eth-`call` of `onRandomness` with an offline-found top-band word: it
returns the exact top payout and confirms `payout <= escrowedStake + reservedProfit`. The 250× tier
does not occur among the 20 replayed rounds (their tiers are `0x:15, 1.5x:2, 2x:2, 3x:1`; max area
61), so the eth-call probe is the only 250× evidence — see `verification.txt` W3.5/W3.8.

Production-chain deployment and the production Chain.wtf host remain **EXTERNAL BLOCKED**
(`EXTERNAL-CHAINWTF-LIMITATION.md`); the local simulator is the strongest permitted substitute.

## Status

| item | status |
|---|---|
| contract compiles standalone | **PASS** (solc 0.8.34, 2619 B) |
| contract paytable == `game/model.mjs BANDS` | **PASS** (`tests/model.test.mjs`, `tests/contract.test.mjs`) |
| page runs `game/model.mjs`, not a copy | **PASS** (harness check 4) |
| real settled payload replay | **PASS** (20/20 rounds, `tests/model.test.mjs`) |
| deployed + settled on the local simulator | **PASS** (chain id 31337; deploy tx/block/gas, `sessionsSettled=21`, `uniqueFulfilmentTxs=21`, 250× top-path eth-call) |
| in-host live round (settled row rendered through the bridge) | **PASS** (`docs/verification.txt` §8: `mounted=true`, `sawSettle=true`, `wageredOnChain=true`, sessions 20 → 21, `ok=true`) |

The prototype's own history (contradiction C7) is that the harness's live session feed stalled
while the chain had the round settled. That risk was inherited into this build; the Wave-3 host
embed cleared the live case for `03-flood-exe` (a settled row rendered through the bridge, sessions
20 → 21 — see `docs/verification.txt` §8), and the standalone DEMO path is demonstrated on the public
URL as well (`docs/standalone.md`).

The chain evidence for the deployed `FloodGame` (deployment tx, 20 settled rounds, a 250× top-path
probe) is kept verbatim in `chain-proof.json`.
