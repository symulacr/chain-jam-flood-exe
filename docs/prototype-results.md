# flood-exe — prototype results (what is inherited, and what this restructure adds)

This candidate is a **restructure of a port**, so the honest framing is "what the
`prototype/game` build and the `jam-candidates/flood-exe` candidate already proved, and what this
packaged project adds or fails to prove".

## Inherited (from `prototype/game` and the verified candidate)

| result | evidence |
|---|---|
| contract deployed and settling on-chain | `0x45a755b0…`, wave-3 material; `chain-proof.json` |
| three live 250× jackpots paid in full | sessions 2440 (area 86), 3653 (86), 3779 (85); `payout = 250e18`, `stuck = 0` |
| retuned RTP 94.717%, three independent methods agree | `rtp-proof.md` (10M / 200M / CSPRNG) |
| 20 real settled payloads replay to the chain's area and band | `tests/model.test.mjs` |
| no third-party strings/assets in the shipped tree | harness hygiene check |
| sub-path asset paths are relative | proved at runtime under `/tmp/subpath/…` |

## Added by this restructure (the packaged project)

| result | evidence |
|---|---|
| conventional layout: `index.html` + `game/` + `src/` + `contracts/` + `public/` + `tests/` + `docs/` | this tree |
| the model is the **single source of truth**, imported by the page (`game/model.mjs`) | harness check 4; byte-identical to the candidate |
| SDK bridge vendored **byte-identically** | sha256 `46263af1…a75fe` (`chain-integration.md`) |
| dependency-free build/test/check/serve toolchain | `package.json`, `scripts/` |
| `dist/` assembled with no bundler, servable as a static tree | `npm run build` output |
| standalone DEMO plays a full round, resolves, and re-deals from a local server | browser evidence in `verification.txt` |
| contract compiles standalone | solc 0.8.34, **2619 B** bytecode |
| `og:image` self-generated and shipped | `public/og-image.png` |

## Not proved by this project

- The **250× band is not in the replayed fixture** (max area 61). Only the pure full-canvas
  boundary test covers it here.
- **Production-chain deployment is EXTERNAL BLOCKED** (no entrant-accessible public testnet); see
  `testnet.md`.

## Closed in Wave 3 (were "not proved" here)

- The **host-attached round** (contradiction C7): **PASS** — the host harness mounted the guest,
  wagered through the bridge (on-chain sessions 20 → 21) and rendered the settled row
  (`docs/host-embed.json`).
- **Public HTTPS URL / cold-load TTI** (contradiction C5/C8): **PASS** — served at
  https://chain-jam-flood-exe.vercel.app and driven standalone there
  (`research/public-deploy-top3.md`; `docs/standalone.md`).
