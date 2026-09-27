# flood-exe — standalone proof

## The failure this guards against

`connectGameToHost` returns a penpal `connection` whose `.promise` **never settles when no host
answers** — it does not reject. `await connection.promise` before wiring the UI therefore leaves
the page dead: empty board, no result. (The same trap killed two candidates in Wave 6B.)

## The pattern kept here (never-await + grace timer + watchdog)

`src/app.js` **does not await** the connection. It:

1. calls `connectGameToHost({ setState })` at module top level;
2. attaches `.then(api => …)` / `.catch(() => …)` so a real host can *upgrade* the page, but never
   blocks on it;
3. arms a **1.6 s grace timer** (`window.setTimeout(…, 1600)`) that lights the explicit
   "press DEMO" standalone message if no host has answered;
4. arms a **90 s watchdog** around a hosted wager: if no settlement row arrives, it clears
   `pendingKey`/`busy` and tells the player the host will settle or cancel the round (the stake is
   refunded on cancel). This was ~line 553 of the original inline script and is preserved verbatim.

This is the same shape as the known-good pattern in `jam-candidates/lifeboat/index.html` `boot()`
(which arms a 400 ms boot timer and never awaits `.promise`). flood-exe uses a 1.6 s timer; the
mechanism is identical. **NOTE:** flood-exe has **no** `?debug=1` postMessage state mirror — that
was a lifeboat-side diagnostic. flood-exe's equivalent safeguard is the grace timer + watchdog
above, and it is the one kept (the restructure does not add new behaviour).

## What I ran (this build)

```sh
cd top3/03-flood-exe
npm run build                  # assemble dist/
npm run serve                  # http://127.0.0.1:8941  (serves dist/)
# then, headless Chrome via the DevTools Protocol (scripts/browser-check.mjs)
node scripts/browser-check.mjs
```

`chrome --dump-dom` is **not** usable here: the page runs timers, so the process never reaches
idle and the dump hangs until killed. `scripts/browser-check.mjs` drives CDP directly over Node's
global `WebSocket` (copied from `jam-candidates/tools/verify-standalone.mjs`).

Transport checks (any static server; `npm run serve` does this):

| URL | status | content-type |
|---|---|---|
| `http://127.0.0.1:8941/` | 200 | `text/html` |
| `http://127.0.0.1:8941/src/app.js` | 200 | **`text/javascript`** (strict module MIME) |
| `http://127.0.0.1:8941/game/model.mjs` | 200 | **`text/javascript`** |
| `http://127.0.0.1:8941/src/sdk/guest.mjs` | 200 | **`text/javascript`** |

## What I saw

The exact, literal browser evidence (title, DOM state and result text) is in
[`verification.txt`](./verification.txt): the page loads, the UI renders, DEMO runs, the flood
animation completes, the result panel shows the painted cell count and the win/lose band, and a
second DEMO press deals a new round (the canvas hash changes).

No host was present; the page fell through to the demo path silently (no hang, no error).

## Public HTTPS URL and a real-network standalone run (Wave 3)

The project is hosted publicly over HTTPS at:

**https://chain-jam-flood-exe.vercel.app**  (Vercel deployment id `dpl_9cpF8xzWwNnYr5iPuGXKdKmGpyBw`, state `READY`)

That is the entrant's one hosting obligation — a static build on a public URL that must also run
standalone, outside the Chain.wtf iframe. The URL was probed from this machine (not localhost) and
driven in a real headless Chrome, both recorded in `research/public-deploy-top3.md`:

| probe (public URL) | result |
|---|---|
| `GET /` | `200 text/html; charset=utf-8` |
| `GET /game/model.mjs` | `200 application/javascript; charset=utf-8` |
| `GET /src/app.js` | `200 application/javascript; charset=utf-8` |
| `GET /game.manifest.json` | `200 application/json; charset=utf-8` |
| manifest headers | `access-control-allow-origin: *`, `cache-control: public, max-age=300` |
| `X-Frame-Options` / CSP `frame-ancestors` | **absent** — stays iframe-embeddable |
| widget tag in the body | `jam.chain.wtf/widget.js` present |

Observed standalone browser run on the public URL: the page loads; **DEMO** ran a canvas flood; the
result `Only 11 cells — the paint ran out` rendered; the widget badge `CHAIN JAM VOL.1` rendered;
**no hang** — the never-settling `connection.promise` guard held on the real network. This closes
the Wave-2 "cold-load TTI on a real network" gap.

## `file://` caveat

`index.html` uses `<script type="module">` and imports `../game/model.mjs` and `./sdk/guest.mjs`.
Browsers refuse ES-module imports from `file://` (opaque origin), so the page **must** be served
over `http(s)`. This is expected and is why the command above is a static server, not a
double-click.

## UNPROVEN

- Production-chain deployment and the production Chain.wtf host (EXTERNAL BLOCKED — see
  `EXTERNAL-CHAINWTF-LIMITATION.md`).

The two Wave-2 gaps are now closed:

- Cold-load TTI on a real network (contradiction C8): **PASS** — the build is served at
  https://chain-jam-flood-exe.vercel.app and was driven standalone there (`research/public-deploy-top3.md`).
- The host-attached (embedded) round: **PASS** for this build — the host harness mounted the guest,
  wagered through the bridge and rendered a settled row (`docs/host-embed.json`).
