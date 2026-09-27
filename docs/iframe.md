# flood-exe — iframe safety

Every requirement below is asserted by `jam-candidates/tools/verify-candidate.mjs` (hygiene /
framing checks) against the shipped tree, not by inspection alone. "Shipped tree" excludes
`docs/`, `tests/`, `dist/` and `tools/`.

## Forbidden APIs — none used

`rg` over `index.html`, `src/app.js`, `src/styles.css` and `game/model.mjs` finds no use of:
service worker, `localStorage`, `sessionStorage`, IndexedDB, `document.cookie`, `window.open`,
`alert`/`confirm`/`prompt`, `top.location`, downloads, `fetch`, `XMLHttpRequest`, `WebSocket`, or
pointer lock. Results render in-page via DOM writes. (The vendored penpal bridge in
`src/sdk/guest.mjs` uses `window.postMessage` internally — that is the SDK contract, not a
forbidden page API.)

## Units

No `vh` / `vw` units anywhere in `src/styles.css` (fixed pixel layout, `max-width: 560px`).

## Framing

No `X-Frame-Options`, no `frame-ancestors`, no CSP that excludes `*.chain.wtf`. The harness framing
check passes ("no framing blocker in any shipped host config").

**Hosting config (updated, Wave 3).** This project originally shipped NEITHER `public/vercel.json`
NOR `public/_headers`; the coordinator added both in the Wave-3 phase, and the build copies them
into `dist/` (the dist listing grew from 8 to 10 files). Both grant exactly two headers on
`/game.manifest.json` only — `Access-Control-Allow-Origin: *` and
`Cache-Control: public, max-age=300` — so the host page can fetch and validate the manifest
cross-origin:

- `public/vercel.json` (232 B) — headers only, **no `$comment` key** (Vercel validates it with
  `additionalProperties:false` and rejects unknown keys, which had blocked the sibling deployments).
- `public/_headers` (882 B, Netlify / Cloudflare Pages) — the same two headers plus the explanatory
  comment.

Crucially, **neither file adds an `X-Frame-Options` / `frame-ancestors` header**, and `_headers`
explicitly documents that none may be added (it would make the entry unembeddable) and that no
catch-all `/* /index.html 200` rewrite may be added (it would swallow `/game.manifest.json` and
break the sibling `.mjs` loads). The framing check still passes. Full record: `docs/verification.txt`
W3.4.

## Query params

The page does not read `location.search` at all, so the gallery's `?ref=chainjam` card-click
parameter is inherently tolerated. (Harness check 7 reports this as INFO.)

## Assets

- Forbidden binaries (font/audio/`.ico`/`.bmp`/`.exe`/`.wasm`): **0**.
- Images: **1** — the self-generated `public/og-image.png` (1200×630), which is the only image
  kind the harness allows outside a report.
- Third-party strings/brands: **0** (harness hygiene check).

## Survey timing

The toolbox, menu, meter and sound are all in-page. Sound uses WebAudio oscillators created on
user interaction (no autoplay), and is mutable via the menu button.
