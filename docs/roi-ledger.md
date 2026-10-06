# ROI ledger — FLOOD.EXE optimization campaign (`opt/roi-1`)

Baseline `663f4b0`. Every row records BEFORE -> AFTER with the artefact that measured it.
`alloc` is a count of typed-array / Set / Array / BigInt allocations observed per
`outcome()` round by the counting harness in `{SCRATCH}/alloc-count.mjs`, which replaces the
global typed-array constructors before the module is imported. `ms` is the median of five runs of
200,000 `outcome()` calls from `{SCRATCH}/bench.mjs`.

## Baseline

| Metric | Value | Source |
|---|---:|---|
| production LOC (src/app.js + game/model.mjs + contracts/*.sol + src/sdk/guest.mjs) | 1958 | `wc -l`, `{SCRATCH}/loc-baseline.txt` |
| of which authored (excludes the vendored `src/sdk/guest.mjs`) | 1063 | `wc -l src/app.js game/model.mjs contracts/*.sol` |
| allocations per `outcome()` round | 9 | `{SCRATCH}/alloc-baseline.log` |
| `outcome()` 200k rounds | see bench logs | `{SCRATCH}/bench-before.log` |

## Applied candidates

| ID | Change | LOC delta | alloc/round | ms/200k | Verdict |
|----|--------|---:|---:|---:|---|
| L1 | `src/app.js` demo path derives the band from the canvas it already has | pending | pending | pending | pending |

## Rejected candidates

| ID | Change | Verdict | Reason |
|----|--------|---------|--------|
| pending | | | |