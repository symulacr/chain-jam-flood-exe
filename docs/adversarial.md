# FLOOD.EXE — Wave 4C adversarial closeout

Hostile adversarial verification of this repository, run 2026-09-27 on
this tree. The author of this section did **not** build the project; the task was to try to
falsify its claims. A claim that could not be falsified after genuinely trying is recorded as
NOT FALSIFIED; an untested claim is marked UNTESTED (never silently promoted).

Environment used: `node v26.10.0`, `python3` + `pycryptodome 3.23.0` (`Crypto.Hash.keccak`),
`solc 0.8.34+commit.80d5c536.Linux.g++`, foundry `cast`. Per the mandate, the coordinator-owned
shared tooling (`chain-probe.mjs`, `verify-host-embed.mjs`, the local chain node, the Vite
harness) was **not** run. The only server started was the project's own `npm run serve`
(:8941), and it was stopped when the transport check finished.

## Verdict summary

| # | attack | verdict | headline |
|---|---|---|---|
| 1 | paytable / band boundaries | NOT FALSIFIED | bands identical over reachable 0..144; only divergence at the impossible area 145 |
| 2 | sampler bias | NOT FALSIFIED | keccak correct vs pycryptodome + cast; start-cell chi-square 162.0 (143 dof); all 144 cells reachable; no bias found |
| 3 | RTP (independent Monte Carlo) | NOT FALSIFIED | node 5M = 9491.6 bps CI [9407.2, 9576.1]; python 5M = 9435.2 bps CI [9351.2, 9519.2]; declared 9472 inside both |
| 4 | model↔contract parity | NOT FALSIFIED | model == independent python on 3000 words; flood parity 0/43920 pairs; no differing word constructed |
| 5 | cap ≤ escrow+reserve | NOT FALSIFIED | equality holds; 0 over-cap payouts in 1160 checks |
| 6 | dist framing/manifest/hygiene | PASS | no blocker, no root-relative path, no storage/`window.open`/SW, no `vh`/`vw`, exactly 1 third-party script |
| 7 | doc-truth hunt | **PARTLY FALSIFIED** | 3 proven-wrong claims: `makeRng` "collision-free"; "2619 B runtime bytecode"; `4.6e59` overflow threshold |
| 8 | clean-checkout readiness | PASS | `npm run build && npm test && npm run check` on a fresh copy: exit 0, no install step, 0 deps |
| 9 | secret scan | PASS | no keys/mnemonics/tokens; every 64-hex string classified as a hash/tx/vector, not a secret |

---

## Attack 1 — paytable / band boundaries

**Method.** Extract the bands from `game/model.mjs` (via its `bandOf`) and from
`contracts/FloodGame.sol` *independently* (parse the `_multiplier` body for
`if (area < N) return L;` and the final `MAX_MULT_WAD` default — not the test's hand-written
literal map), then walk every area `0..145` through both and compare as wei.

**Raw result.**
```
parsed contract branches: [ [30,'0'], [40,'15e17'], [50,'2e18'], [60,'3e18'], [80,'6e18'] ] MAX_MULT_WAD = 250e18
model BANDS: 0-29:0, 30-39:1.5, 40-49:2, 50-59:3, 60-79:6, 80-144:250
walk 0..145 mismatches: 1  first: [145, "250000000000000000000", "0"]
walk reachable 0..144 mismatches: 0
model monotonic over reachable 0..144: true
contract monotonic over reachable 0..144: true
bandOf(144)=250 | bandOf(80)=250 | bandOf(79)=6 | MIN_WIN_AREA=30 | CELLS=144
```

**Verdict: NOT FALSIFIED.** Over the reachable domain the two paytables are identical and
monotonic. The single "disagreement" is at **area = 145, which cannot occur**: the 4-connected
flood area is always in `1..144`. At 145 the contract's `else return MAX_MULT_WAD` yields 250
while the model's `bandOf` falls off the end of `BANDS` and returns 0 — a purely out-of-range
artefact, not a reachable divergence. (For 146+ the model returns 0 and the contract 250; also
unreachable.) `outcome()` always produces `1..144`, so no settled round can hit it.

**Top-multiplier reachability.** The shipped top-path word from `docs/chain-proof.json`
(`0xc91eb95e…a9044`) gives `outcome = {stat:80, mult:250}` under the model (start 141, area 80) —
matching the chain-proof. Independently, a random 2 M-word scan found a 250x word after 1018
tries: `0xbde7bbbb82bf6a2059db18a5f6c199045a13a6d14db1d3458050dd811a3cbd70` → area 86, mult 250
(consistent with the declared 0.1463% top-band rate).

---

## Attack 2 — sampler bias

**Method.** (a) Cross-check the pure-JS `keccak256` against pycryptodome `Crypto.Hash.keccak`
and foundry `cast keccak` over 18 input lengths including the rate/block boundaries
(0,1,31,32,33,135,136,137,271,272,273). (b) Verify the byte-index canvas equals the BigInt
`H>>112` field decode over 20 000 words (endianness). (c) Sample 1 440 000 CSPRNG words and
histogram the start cell (chi-square, 143 dof) plus reachability. (d) Sample 200 000 words for
per-cell bit uniformity. (e) Pairwise independence at N = 1 000 000 over 10 cell pairs.
(f) Count tag-1 rejections over 500 000 words (rejection-loop bound).

**Raw result.**
```
pycryptodome: 0 mismatches / 18 lengths
cast keccak(word||0x00): 0x04caf61a4aed665edd973555dc456b431c1912f49df055330a58658b6b055c4f  (== model)
field<->byte-index canvas mismatches over 20000 words: 0
start-cell sample N=1440000: expected/cell=10000.0  min=9733  max=10262  zeroCells=0
chi-square (143 dof) = 162.0   (mean 143; the 99.9% upper bound is ≈194.6)
canvas bit sample M=200000: per-cell ones min=99447 max=100678 (expect 100000); cells >5σ from 0.5: 0
pairwise P11 (expect 0.2500): (0,1) 0.2501 (0,2) 0.2499 (0,3) 0.2499 (0,7) 0.2503 (0,8) 0.2506
                             (0,72) 0.2501 (5,100) 0.2497 (17,130) 0.2504 (63,64) 0.2502 (71,72) 0.2500
                             (max |z| = 0.72, all within noise)
over 500000 words: tag-1 unused (fallback to tag2)=0, both rejected (fallback to 0)=0
```

**Verdict: NOT FALSIFIED.** No modulo bias (the start cell is rejection-sampled, not `byte%144`),
no truncated/incorrect keccak (exact match to two independent implementations across all lengths),
no endianness error, no start cell that is never selected, and the rejection loop is bounded
(never more than 64 bytes scanned; the observed fallback rate is 0 in 500 000, consistent with the
documented ≈1e-12 probability). An early 3σ-looking pairwise figure at N=200 000 washed out to
`|z| ≤ 0.72` at N=1 000 000 — noise.

---

## Attack 3 — RTP, independent sampler

**Method.** Do **not** call the project's `makeRng`. Draw words from `crypto.randomBytes(32)`
(node) and `os.urandom(32)` (python), then derive area with (node) the model's `deriveCanvas`
(already proven byte-identical to an independent python re-derivation, Attack 4) and (python) a
from-scratch pycryptodome-keccak + own flood-fill + own paytable. N = 5 000 000 each; report the
sample mean, sd, standard error and a 95% CI.

**Raw result.**
```
node   N=5,000,000: RTP = 0.949163 (9491.6 bps); sd=9.637; SE=0.004310
       95% CI: [9407.2, 9576.1] bps ; declared 9472 inside CI: true
       freqs %: 76.3245 / 9.6778 / 6.7076 / 4.2047 / 2.9384 / 0.1470 ; losing 76.3245 (declared 76.3430)
python N=5,000,000: RTP = 0.943518 (9435.2 bps); sd=9.580; SE=0.004284
       95% CI: [9351.2, 9519.2] bps ; declared 9472 inside CI: true
       freqs %: 76.3567 / 9.6584 / 6.7080 / 4.2141 / 2.9177 / 0.1452 ; losing 76.3567
```

**Verdict: NOT FALSIFIED.** The declared `EXPECTED_RTP_BPS = 9472` lies inside both independent
95% intervals, and every band frequency matches the declared table within sampling error. The
wide CI (≈±80 bps at 5M) is entirely explained by the 250x tier (sd≈9.6, dominated by the
jackpot), so this is consistent with the project's honest "Monte Carlo, not exact" framing.

---

## Attack 4 — model↔contract parity

**Method.** (a) Transcribe the contract's exact `_floodArea`/`_push` algorithm (visited set at
push time; neighbour order L,R,U,D; `colour=(field>>start)&1`) into JS and compare against
`model.floodArea(cellsFromField(field), start)` for structured fields (all-0, all-1, checkerboard,
stripes, half-plane), 200 random fields, and 100 dense/sparse fields — every start cell `0..143`,
43 920 `(field,start)` pairs. (b) Separately re-implement the full contract derivation
(`keccak256(word||0x00)>>112`, LS-byte-first rejection start cell over `keccak256(word||0x01)`
then `0x02`) in python/pycryptodome and compare field/start/area against `model.deriveCanvas` on
3000 random words.

**Raw result.**
```
flood parity: 0 mismatches over 43920 (field,start) pairs
model vs independent-python over 3000 random words: field mismatches=0 start=0 area=0
```

**Verdict: NOT FALSIFIED.** I could not construct a word (or even a raw 144-bit field) where the
model and the contract algorithm disagree on canvas, start cell or area. The only structural
divergence is the unreachable `area=145` case in Attack 1. The start-cell fallback path
(`0x01` exhausted → `0x02` → `0`) is identical in both. Parity holds.

---

## Attack 5 — cap `maxPayout ≤ escrowedStake + reservedProfit`

**Method.** Replicate the contract's exact integer arithmetic (`WAD=1e18`, `MAX_MULT_WAD=250e18`,
floor division) and check, for representative wagers (1, 7, 999, 1e18, 1e18+7, 7e16, …, 1e24+1):
`quoteCaps.maxEscrowStake + onSessionStart(reservedProfitDelta) == quoteRiskParams.maxPayout`,
and `_payout(wager, area) ≤ escrow+reserve` for every area `0..144`.

**Raw result.**
```
cap structural: checked=1160 violations=0
w=1e18: maxPayout=250000000000000000000 | payout(area>=80)=250000000000000000000 | escrow+reserve=250000000000000000000
2^256/MAX_MULT_WAD = 463168356949264781694283940034751631413079938662562256157
```

**Verdict: NOT FALSIFIED.** The reserve committed at `onSessionStart` is `249·wager`, the cap is
`wager + 249·wager = 250·wager`, and the top payout is `250·wager` exactly — equality, no slack.
Floor division can only round the payout **down**, so `payout > cap` is unreachable for any
wager below `≈4.6e56` wei (far above any realistic stake).

---

## Attack 6 — framing / manifest / hygiene on the shipped `dist/`

**Method.** Inspect only the built `dist/` tree (10 files) and the served transport via the
project's own `npm run serve` on :8941.

**Raw result.**
```
root-relative refs (src="/ or href="/) .... none
localhost / 127.0.0.1 ...................... none
localStorage/sessionStorage/cookie/........ none
window.open/serviceWorker/indexedDB
vh / vw units ............................. none
script tags in dist/index.html ............ <script async src="https://jam.chain.wtf/widget.js">
                                            <script type="module" src="./src/app.js">
absolute http(s) URLs in dist ............. https://jam.chain.wtf/widget.js  (the widget)
                                            https://github.com/Aaronius/penpal/issues/51  (a CODE COMMENT inside the vendored SDK bridge, not an asset/script)
filesystem absolute paths in dist ......... none
served: / -> 200 text/html; /src/app.js -> 200 text/javascript; /game/model.mjs -> 200 text/javascript;
        /game.manifest.json -> 200 application/json; /og-image.png -> 200 image/png
manifest headers (public/_headers, public/vercel.json): Access-Control-Allow-Origin: * , Cache-Control: public, max-age=300
        and NO X-Frame-Options / CSP frame-ancestors
```

**Verdict: PASS.** Exactly one third-party script ships (the mandated widget); every asset path is
relative; no storage/cookie/`window.open`/service worker; no `vh`/`vw`; no framing blocker; no
`localhost`; no filesystem absolute path. The single extra absolute URL is a source-code comment
in the vendored penpal bridge (`guest.mjs:612`), not a runtime dependency or asset path, so it is
not a hygiene blocker — but it is noted here for completeness.

---

## Attack 7 — doc-truth hunt

Six-plus numeric/factual claims were attacked. Results:

| claim (file) | test | verdict |
|---|---|---|
| "20 real settled rounds" / largest area **61** / no 250x in the fixture (`README.md`, `docs/rtp-proof.md`, `docs/vrf.md`) | decode `tests/fixtures/settled-sessions.json` | **TRUE** — `count=20`, areas max 61, 0 payouts ≥ 250e18; tiers actually `0x:15, 1.5x:4, 6x:1` |
| "197 assertions incl. 20 real settled rounds" and "76 assertions" (`README.md`, `game/README.md`) | `npm test` | **TRUE** — 197/197 and 76/76 |
| vendored bridge sha256 `46263af1…a75fe` (`docs/chain-integration.md`) | `sha256sum src/sdk/guest.mjs` | **TRUE** (source and dist both match) |
| public URL `https://chain-jam-flood-exe.vercel.app` live, manifest CORS + no framing header, widget present | live HTTP probes | **TRUE** |
| RTP `9472` / hit-rate 23.657% / 250x at 1-in-683 (`README.md`) | independent MC (Attack 3) + arithmetic | **TRUE within CI** (1/0.001463 = 683.5) |
| `EXPECTED_RTP_BPS = 9472` "→ 94.717%" (`game/model.mjs` comment, `README.md`) | arithmetic | rounding nuance: 9472 bps = **94.72%**; 94.717% is the estimate that *rounds to* 9472. Not fixed (needs no edit; recorded). |
| `makeRng` "collision-free for every round index up to 2^52" (`game/model.mjs` comment, `game/README.md:101`) | brute-force collision scan | **FALSIFIED → see below** |
| "**2619 B** runtime bytecode" (`README.md:20`, `README.md:110`, `docs/chain-integration.md:19`) | `solc --bin` vs `--bin-runtime` | **FALSIFIED → fixed** |
| `wager * MAX_MULT_WAD` overflows above `≈ 4.6e59` wei (`docs/security.md:58`) | `2^256 / 250e18` | **FALSIFIED → fixed** |
| "10,000,000-round `tune.mjs`" / "200,000,000-round adversarial re-derivation" / "2,670 live settled rounds" (`docs/rtp.md`, `docs/rtp-proof.md`) | no script shipped in this tree | **UNTESTED** (historical; my two independent 5M runs bracket the number) |
| "21 settled sessions, 21 unique VRF fulfilments", "0 stuck, 0 parity failures", deploy tx/block/gas (`README.md`, `docs/testnet.md`) | requires the forbidden chain tooling | **UNTESTED** (evidence files supplied; not re-run) |
| "Runs correctly in the local simulator" / harness PASS (`README.md` status row) | harness is coordinator-owned and forbidden here | **UNTESTED** |

### F1 — `makeRng` is NOT collision-free (claim FALSIFIED; not correctable within this task's edit scope)

The model, `game/model.mjs`, documents the round seeder as "collision-free for every round index up
to 2^52 (verified by the harness over 7 magnitude windows)", and `game/README.md:101` repeats
"exact and collision-free to `2^52`".

**Counterexample (any 32-byte seed; seed `0x5a…5a` shown):**
```
makeRng(2^32-1) = 0x4f690cbdd315adbd38b2cc79bbc04c9c63a46c136431159e651ed5f11194065e
makeRng(2^32)   = 0x4f690cbdd315adbd38b2cc79bbc04c9c63a46c136431159e651ed5f11194065e
COLLISION makeRng(2^32-1)===makeRng(2^32): true
more straddling pairs: (2^33-1, 2^33+2), (3·2^32-1, 3·2^32), (5·2^32-1, 5·2^32)
```

**Cause.** The only round-dependent input is the 32-bit key `((round mod 2^32) + 1) XOR floor(round/2^32)`.
For `round = 2^32-1`: `(0) XOR 0 = 0`. For `round = 2^32`: `(1) XOR 1 = 0`. The two keys are equal,
and **the entire 32-byte output is a function of that one 32-bit key** — so across the whole
`[0, 2^52)` range `makeRng` can emit at most `2^32` distinct words, and rounds with equal keys
collide by construction. The shipped `tests/model.test.mjs` collision scan uses windows at
`[1, 1e6, 1e12, 4.5e15]` (none straddle a `2^32` boundary), and harness check 13 uses "7 magnitude
windows", which is why both report 0 collisions and miss this.

**Impact.** `makeRng` is tooling-only — the page uses `crypto.getRandomValues` and the contract uses
the real VRF word, so **no money path is affected**. Runs that stay inside a single `rhi` window
(e.g. the 10M and 2M RTP runs, all `<2^32` long) see distinct keys and are unaffected; only runs
that cross a `2^32` boundary gain ~1 duplicate per crossing. The claim itself, however, is false.

**Correction.** Not made here: the claim lives in `game/model.mjs` (a **PROTECTED** file) and in
`game/README.md:101`, which is outside this task's editable set (`README.md` and `docs/**` only).
Reported for the owner to fix (either change the wording to "exact, not injective" or change the
seeder to mix the full 64-bit round index injectively).

**RESOLVED (coordinator, 2026-09-27).** The owner corrected the wording, comment-only, in
`game/model.mjs` and `game/README.md` (and identically in `jam-candidates/flood-exe/model.mjs`, so
byte-identity holds): the claim now states that the key is a bijection of the round index **within
each 2^32 window**, that across windows it can alias, and gives this counterexample. No code line
changed, so the seeder's behaviour is untouched and no verified RTP is affected. The pinned
`sha256` in `docs/verification.txt` and `docs/architecture.md` was updated to the new value.

### F2 — "2619 B runtime bytecode" mislabel (claim FALSIFIED; fixed)

`solc --optimize --bin` (creation bytecode) = 5238 hex = **2619 B**; `solc --optimize
--bin-runtime` (deployed/runtime bytecode) = 5182 hex = **2591 B**. Three doc lines called the
2619 B figure the *runtime* size. Corrected:
- `README.md:20` → "**2619 B** creation / **2591 B** runtime bytecode".
- `README.md:110` → "# FloodGame bytecode: 5238 hex = 2619 B creation; `--bin-runtime` 5182 hex = 2591 B runtime".
- `docs/chain-integration.md:19` → "# 5238 hex = 2619 bytes creation bytecode (runtime: 5182 hex = 2591 bytes)".

(The EIP-170 limit applies to the 2591 B runtime size, which is well under 24576 B either way.)

### F3 — overflow threshold `4.6e59` wrong (claim FALSIFIED; fixed)

`docs/security.md:58` said `wager * MAX_MULT_WAD` overflows above `wager ≈ 4.6e59` wei. The true
threshold is `floor((2^256-1) / 250e18) = 4.63168…e56` wei (57 digits). Corrected to `≈ 4.6e56`
wei. The adjacent claims in the same section are **correct**: `wager² * BODY_VAR_SCALED` overflows
above `≈ 2.7e29` wei (≈ 2.7e11 ether) and the `int256(249·wager)` reserve cast above `≈ 2.3e74` wei.

### Unresolved documentation inconsistency (not corrected — historical log)

`docs/verification.txt` W3.5 prints "replay fixture 20 real settled rounds … realised tiers (20)
0x:15 1.5x:2 2x:2 3x:1", but the vendored replay fixture's realised tiers are `0x:15, 1.5x:4,
6x:1`. The printed histogram matches `docs/chain-proof.json` (`tiers: {0x:15, 1.5x:2, 2x:2, 3x:1}`),
a *different* 20-round set from a different contract address (`0xb7f8bc63…` vs the fixture's
`0x45a755b0…`). This is a label mix-up between two distinct "20 rounds" sets, not a false number;
it is flagged here rather than rewritten, because it sits in a verbatim historical log.

---

## Attack 8 — clean-checkout repo readiness

**Method.** Copy the tree to `/tmp/clean-03-flood-exe` excluding `dist/`, `node_modules/`, `.git/`,
then run `npm run build && npm test && npm run check` there. Confirm no runtime deps / no install
step.

**Raw result.**
```
copied tree: no dist/, no node_modules/
package.json: "dependencies": null, "devDependencies": null

$ cd /tmp/clean-03-flood-exe
$ npm run build && npm test && npm run check
...
dist/ (10 files)
  ... page payload (html+css+mjs): 51340 B raw / 14478 B gzip (50.1 kB raw / 14.1 kB gz)
  build OK
> node tests/model.test.mjs && node tests/contract.test.mjs
  [info] replayed 20 real settled rounds; max area 61; 250x jackpot present: false
model.test.mjs — 197 assertions passed, 0 failed
OK
  [info] solc 0.8.34: FloodGame bytecode = 2619 bytes
contract.test.mjs — 76 assertions passed, 0 failed
OK
> node scripts/check.mjs
  ok    game/model.mjs
  ok    scripts/browser-check.mjs
  ok    scripts/build.mjs
  ok    scripts/check.mjs
  ok    scripts/serve.mjs
  ok    src/app.js
  ok    src/sdk/guest.mjs
  ok    tests/contract.test.mjs
  ok    tests/model.test.mjs
check — 9 JS file(s), 0 failed
EXIT=0
```

**Verdict: PASS.** A fresh copy with no `dist/` and no `node_modules/` builds, tests and
check-cleans with exit 0 and no install step. `package.json` declares no runtime or dev
dependencies, so "no runtime dependencies, no install step" is confirmed.

---

## Attack 9 — secret scan

**Method.** Grep every file (including `dist/`) for private-key / mnemonic / API-key / token /
`BEGIN … PRIVATE` patterns, and enumerate **every** 64-hex string and classify it.

**Raw result.** No `private key`, `mnemonic`, `seed phrase`, `secret`, `api key`, `access token`,
`bearer`, or PEM block anywhere. Every 64-hex string is one of:
- keccak test vectors (`c5d24601…`, `4e03657a…`, `04caf61a…`) — known digests;
- `gameState` field/payout words in the fixture (`000…0`, `…0014d1120d7b160000` = 1.5e18, `…53444835ec580000` = 6e18);
- deploy tx `0xfeb6ba29…`, VRF fulfilment tx hashes, `requestId`s, randomness words, the topPath word (`docs/chain-proof.json`, `docs/verification.txt`);
- the required asset digests `46263af1…a75fe` (guest.mjs) and `733eb27e…083a` (model.mjs);
- the deliberate non-secret test word `0xdeadbeef…7080`;
- the `solc --bin` creation-bytecode hex prefix quoted in `docs/verification.txt`.

**Verdict: PASS.** No secret material ships; every 64-hex string is a hash, transaction id,
game-state word, or test vector.

---

## Notes / residual uncertainty

- The coordinator-supplied chain facts (address, deploy tx, block 23, gasUsed 525181, 21 settled
  sessions, 21 unique fulfilments) were **not** independently re-executed — the chain tooling is
  forbidden here. They are listed **UNTESTED** above and taken from `docs/chain-proof.json`,
  `docs/testnet.md`, `docs/chain-integration.md`, `docs/verification.txt`.
- The historical RTP figures (10M / 200M / 2,670 rounds) are **UNTESTED** here; two independent
  5M-round Monte Carlo runs made in this task are consistent with `9472` (Attack 3).
- Everything in this file was verified against this repository only; no
  sibling project, `jam-candidates/**`, `research/**`, or root file was read or written.
