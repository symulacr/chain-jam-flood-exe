# FLOOD.EXE (`flood-exe`)

The retro flood-fill casino. One Chain VRF word paints a **12×12 two-colour canvas** and picks
a **start cell**; the paint floods out through the 4-connected region of its own colour, and the
payout is a **banded multiple of how far it spread**. **94.72% declared RTP, 250× top tier.**

This is a **restructure of the already-verified `jam-candidates/flood-exe` candidate** — not a
rewrite. The contract, the paytable and the derivation are the proven ones; the maths is
untouched. What changed is the packaging: the single-file page was split into `index.html` +
`src/app.js` + `src/styles.css`, the model moved under `game/`, assets under `public/`, and a
dependency-free build/test/check/serve toolchain was added.

| | |
|---|---|
| slug | `flood-exe` |
| mechanic | 144-bit canvas + rejection-sampled start cell → 4-connected monochrome flood → banded payout |
| paytable | `0 / 1.5 / 2 / 3 / 6 / 250` |
| declared RTP | `EXPECTED_RTP_BPS = 9472` (94.72%) — **a declared constant inside a measured interval, not exact** |
| decision after wager | **none** — accepted limitation, see below |
| contract | `contracts/FloodGame.sol` + `contracts/ICasinoGameV2.sol`, **2619 B** creation / **2591 B** runtime bytecode (solc 0.8.34, `--optimize`) |
| status | model + page + contract + tests + harness **PASS** |

## Layout

```
03-flood-exe/
  index.html                  the servable page; loads ./src/styles.css, ./src/app.js, ./game/model.mjs
  game/
    model.mjs                 THE deterministic model — outcome() + paytable. Single source of truth.
    README.md                 the mechanic, the paytable, the VRF mapping, the RTP class
  src/
    app.js                    the frontend app (framework-free; extracted from the inline script)
    styles.css                the chrome (extracted from the inline style block)
    sdk/guest.mjs             vendored SDK bridge, byte-identical to jam-candidates/shared/guest.mjs
  contracts/
    FloodGame.sol
    ICasinoGameV2.sol
  public/
    game.manifest.json        relative asset paths; served at the game base URL
    og-image.png              self-generated 1200x630
  tests/
    model.test.mjs            197 assertions incl. 20 real settled rounds
    contract.test.mjs         76 assertions: interface, paytable parity, caps, heavy-tail
    fixtures/settled-sessions.json   20 real on-chain gameState payloads (vendored)
  docs/                       architecture, rtp, rtp-proof, vrf, chain-integration, standalone,
                              iframe, testnet, security, prototype-results, verification.txt
  scripts/                    build.mjs, check.mjs, serve.mjs, browser-check.mjs (dev only)
  package.json                scripts only — NO runtime dependencies
  LICENSE                     MIT
  .gitignore                  dist/, node_modules/
  dist/                       BUILD OUTPUT (gitignored), produced by `npm run build`
```

## Build / run / test

Requires Node ≥ 18 (no install step — there are no dependencies).

```sh
npm run build     # assemble dist/ (copy index.html, game/, src/, public/* — no bundler)
npm test          # node tests/model.test.mjs && node tests/contract.test.mjs
npm run check     # node --check every .js/.mjs in the project
npm run serve     # static server on http://127.0.0.1:8941  (serves dist/)
```

Then open `http://127.0.0.1:8941/` and press **DEMO** to watch a canvas flood.

`file://` will not work: the page uses `<script type="module">` and imports ES modules, and
browsers refuse module imports from the opaque `file://` origin. Always serve over http(s).
See `docs/standalone.md`.

`npm run build` produces a self-contained static tree:

```
dist/
  index.html            -> loads ./src/styles.css, ./src/app.js, ./game/model.mjs, og-image.png
  src/app.js            -> imports ../game/model.mjs and ./sdk/guest.mjs
  src/styles.css
  src/sdk/guest.mjs
  game/model.mjs
  game.manifest.json
  og-image.png
```

## The RTP

`EXPECTED_RTP_BPS = 9472` → **94.72% declared**, house edge 5.28% declared and 5.68% measured,
hit rate 23.64% measured, top tier 250× at ≈ 1-in-690. The paytable (`0 / 1.5 / 2 / 3 / 6 / 250`)
is **exact integer code**, shared by the contract and `game/model.mjs`.

The **probabilities are Monte Carlo, not closed-form**, because the outcome hashes the whole
256-bit word and the state space is not enumerable. The reproducible source is
`tests/rtp-derive.mjs`, which scores the shipped model; at 10,000,000 rounds it measures
**9431.55 bps with a 95% interval of [9372.24, 9490.86] bps (±0.593pp)**, and 9472 sits inside
it. Two runs of the same code at 200,000 rounds land 3.86pp apart, which is why the 250× tail —
97.9% of E[X²] — sets the width and why this candidate must not be quoted to five significant
figures. `tests/rtp.test.mjs` gates both the interval and a bit-reproducible fingerprint.

The earlier 10M `tune.mjs` and 200M adversarial figures quoted as agreeing "to 0.03pp" are history,
not corroboration: neither is in version control, and `tune.mjs` never modelled this contract.
Full derivation: `docs/rtp-proof.md`. Contract ⇄ model parity and the honest
exact-vs-Monte-Carlo statement: `docs/rtp.md`.

## The contract

`contracts/FloodGame.sol` implements all six `ICasinoGameV2` functions and is **`pure`** (no
storage, no external calls — no reentrancy surface). It is the **authority: the money is decided
on-chain**, never in the browser. `_paint` derives the canvas and start cell from the VRF word;
`_floodArea` floods; `_multiplier`/`_payout` pay. `onSessionStart` commits the full reserve
(`249·wager`) and requests randomness; `onRandomness` reads the word, settles, and returns
`escrowDelta = 0` / `reservedProfitDelta = 0`, so cap and payout cannot disagree. There is **no**
`onPlayerAction` — it reverts with `FloodGame__NoPlayerAction`, i.e. no decision after the wager.

Compile standalone:

```sh
cd contracts && solc --optimize --bin FloodGame.sol   # with ICasinoGameV2.sol alongside
# FloodGame bytecode: 5238 hex = 2619 B creation; `--bin-runtime` 5182 hex = 2591 B runtime
```

## Public deployment notes

- The page carries the literal `<script async src="https://jam.chain.wtf/widget.js"></script>` and
  loads no other third-party script.
- All asset paths are **relative** (`./src/...`, `og-image.png`), so the tree deploys correctly at
  a domain root or under a sub-path.
- No frame-blocking headers and no restrictive content-security policy, no service worker, no
  storage, no cookie, no `window.open`, no `vh`/`vw` units — the page is iframe-safe and
  gallery-preview-safe (see `docs/iframe.md`).
- `public/game.manifest.json` uses `presentation.mode: "full-iframe"`, `capabilities.openSession:
  true`, `submitAction: false` (there is no action surface).
- Serve `.mjs` as a JavaScript MIME — `text/javascript` (the local `npm run serve`) or
  `application/javascript` (Vercel normalises to this; both satisfy the ES-module MIME check).

## Honest limitations

- **No decision after the wager.** The VRF paints the canvas and the flood decides everything.
  This is the one weakness a family-level novelty judge attacks, and it is **not fixed here** —
  the restructure preserves the verified contract. The highest-value future improvement is a
  **pre-wager canvas-scale choice** plus a **bank-or-continue after a 30-cell flood**, which would
  add a decision axis without changing the paytable. It is **not implemented** in this phase
  because it would change a verified contract. Recorded in `docs/rtp.md`.
- **RTP is Monte Carlo, not exact** (see above). `9472` is a declared constant that a measured
  9431.55 ±59.31 bps interval contains, not a proven value.
- **The 250× tier is not in the replayed fixture.** The vendored `settled-sessions.json` has 20
  real rounds whose largest area is 61 (6×). The top tier is covered by a pure full-canvas
  boundary test, and three live jackpots are on record in the prototype wave-3 material; it is
  **not** exercised by a settled fixture.
- **No public testnet path exists for an entrant.** Real-chain execution was proven on the
  prescribed local simulator (chain id 31337) with the real vendored VRF router and real ECVRV
  proofs: `FloodGame` deployed (tx
  `0xfeb6ba29f514802ba3cd29cb17b2838100713484553b41371578753c19342709`, block 23, gasUsed 525181) and
  settled **21 sessions with 21 unique VRF fulfilments**, 0 stuck, 0 parity failures, with the 250×
  max-payout path eth-called within cap. Production-chain deployment and the production Chain.wtf
  host are **EXTERNAL BLOCKED**, not faked. Evidence: `docs/testnet.md`, `docs/chain-integration.md`.
- **The public production URL is https://chain-jam-flood-exe.vercel.app** (Vercel, deployment
  `dpl_9cpF8xzWwNnYr5iPuGXKdKmGpyBw`), verified externally (`text/html`, the `.mjs` assets as a
  JavaScript MIME, `application/json` + CORS on the manifest, no framing header, widget tag present)
  and driven standalone in a real headless browser. See `research/public-deploy-top3.md`.
- **The host-attached embed path is proven against the SDK's production-faithful host harness**,
  not against the live production Chain host. In `vendor/casino-sdk/simulator` the guest mounted, a
  wager was placed **through the bridge**, and the settled reveal was read from the guest's own DOM
  (session 63; sessions 20 → 21). The live Chain host remains `EXTERNAL BLOCKED`.
  See `docs/host-embed.json`, `research/host-embed-report.json`.
- **Cold-load TTI on a real network is not measured.** The deployed public URL loads and resolves a
  standalone round in a real headless browser (no hang), but no timing figure was taken.

## Provenance / hygiene

No third-party string, brand, asset font or binary ships. The period look is hand-written CSS and
inline SVG; sound is WebAudio oscillators (no files). Only self-generated images are permitted,
and the single shipped image is the self-generated `public/og-image.png`.
