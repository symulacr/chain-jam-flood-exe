# flood-exe — testnet / production-chain status

## THE FINDING: no public testnet path exists for an entrant

Real-chain execution cannot be demonstrated against a public Chain.wtf testnet, because an
entrant-addressable one does not exist. This is established with citations in
`research/wave-final-real-chain-plan.md` and `TOP3-FINAL-CANDIDATES.md` §"The testnet finding":

| claim | evidence |
|---|---|
| A Base Sepolia router address appears in a simulator **test file** (chain id 84532) | `simulator/src/randomness-verification.test.ts:30-31` |
| …but it is **not** the SDK's vendored router build, and exposes no `requestRandomness`/`fulfillRandomness` | same file; SDK vendored router ABI comparison |
| No public `CasinoGameFacet` diamond exists on any chain | SDK docs + live chain inspection (see the plan) |
| No Chain.wtf account, backend access, or testnet funds are needed | `GETTING_STARTED.md:4` |
| The whitelist, indexer and catalog are "wired by the Chain.wtf maintainers" | `GETTING_STARTED.md:178-179` |

Consequently the **local simulator on chain id 31337 is the only entrant-accessible environment**,
and the jam's own gate is *"Runs correctly in the local simulator"*.

## STATUS: local-simulator execution = PASS

Real-chain execution of `FloodGame` **was run** in this phase, on the prescribed local simulator
(chain id **31337**) — the environment the jam's gate names ("Runs correctly in the local
simulator"). It was not faked and it was not skipped:

| evidence | value (verbatim) | source |
|---|---|---|
| chain id | `31337` | `research/chain-evidence.json` |
| deploy tx | `0xfeb6ba29f514802ba3cd29cb17b2838100713484553b41371578753c19342709` | `research/chain-evidence.json` |
| deploy block / gas | `23` / `525181` | `research/chain-evidence.json` |
| `sessionsSettled` | `21` | `research/chain-evidence.json` |
| `uniqueFulfilmentTxs` | `21` | `research/chain-evidence.json` |
| replayed settled rounds | 20, `stuck=0`, `parityFails=0` | `docs/chain-proof.json` |
| 250× max-payout eth-call | `topPath.mult=250`, `withinCap=true` | `docs/chain-proof.json` |

The earlier claim that "this phase did not run chain transactions" is superseded: the coordinator
ran them. The verbatim command output and the full evidence table are in `docs/verification.txt`
section W3.5.

## STATUS: production-chain deployment = EXTERNAL BLOCKED

**Production-chain deployment is `EXTERNAL BLOCKED`, not faked.** There is no public testnet to
deploy to and no entrant-accessible path to the production Chain.wtf host; the project does not
pretend otherwise and ships no fabricated deployment URL or transaction.

The same holds for the **production Chain.wtf host**: it is `EXTERNAL BLOCKED` for the reasons in
`EXTERNAL-CHAINWTF-LIMITATION.md` (whitelist, randomness provider, indexer/catalog and host wallet
plumbing are platform-side). The **local host harness**, by contrast, did mount the guest and
render a settled round — see `docs/verification.txt` §8.

## The strongest permitted substitute (what WAS proven)

Real-chain execution of `FloodGame` was proven on the **prescribed local environment** (chain id
31337) with the **real vendored VRF router** and **real ECVRV proofs** — not a mock:

- the contract was deployed and settled on the local simulator;
- **20 real settled rounds** replay, 0 stuck, 0 parity failures (evidence: `chain-proof.json`;
  the 20 payloads also replay in `tests/fixtures/settled-sessions.json`);
- a maximum-payout path was probed by eth-call (exact top payout, `payout ≤ escrowedStake +
  reservedProfit`) — `chain-proof.json.topPath`;
- real VRF fulfilment transactions and request ids are recorded in `chain-proof.json`.

That is the strongest evidence available to an entrant under this jam's rules, and it is exactly
the environment the jam's gate names.

## How to re-run locally (for a reviewer)

The local simulator is reproduced from the SDK's own tooling; the game contract is independent of
it (it uses only the documented `ICasinoGameV2` calls). The chain transactions **were** run in this
phase on chain id 31337 (see the PASS table above and `verification.txt` W3.5); this file records
that result plus the production-chain finding, and cites the evidence rather than re-deriving it.
