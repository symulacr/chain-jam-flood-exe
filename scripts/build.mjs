#!/usr/bin/env node
/**
 * FLOOD.EXE — build.
 *
 * Assembles `dist/` by copying the exact source layout the page expects:
 *
 *   index.html        -> dist/index.html
 *   game/             -> dist/game/            (game/model.mjs + game/README.md)
 *   src/              -> dist/src/             (app.js, styles.css, sdk/guest.mjs)
 *   public/*          -> dist/*                (game.manifest.json, og-image.png)
 *
 * No bundler, no transpiler, no runtime dependency. `dist/` is a plain static tree:
 * `index.html` references `./src/styles.css`, `./src/app.js`, `./game/model.mjs` and
 * `og-image.png`, and `src/app.js` imports `../game/model.mjs` and `./sdk/guest.mjs` —
 * all of which resolve inside `dist/`.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

function die(msg) { console.error(`build: ${msg}`); process.exit(1); }
function mustExist(p) { if (!fs.existsSync(p)) die(`required input missing: ${path.relative(ROOT, p)}`); return p; }

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ------------------------------------------------------------------ assemble
mustExist(path.join(ROOT, 'index.html'));
mustExist(path.join(ROOT, 'game', 'model.mjs'));
mustExist(path.join(ROOT, 'src', 'app.js'));
mustExist(path.join(ROOT, 'src', 'sdk', 'guest.mjs'));
mustExist(path.join(ROOT, 'public', 'game.manifest.json'));

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

copyFile(path.join(ROOT, 'index.html'), path.join(DIST, 'index.html'));
copyTree(path.join(ROOT, 'game'), path.join(DIST, 'game'));
copyTree(path.join(ROOT, 'src'), path.join(DIST, 'src'));
for (const e of fs.readdirSync(path.join(ROOT, 'public'), { withFileTypes: true })) {
  const s = path.join(ROOT, 'public', e.name);
  const d = path.join(DIST, e.name);
  if (e.isDirectory()) copyTree(s, d); else copyFile(s, d);
}

// ------------------------------------------------------------------ report
const files = walk(DIST).sort();
const rows = files.map((f) => {
  const buf = fs.readFileSync(f);
  return { f: path.relative(DIST, f), raw: buf.length, gz: zlib.gzipSync(buf, { level: 9 }).length };
});
let rawPage = 0;
let gzPage = 0;
console.log(`\ndist/ (${rows.length} files)`);
for (const r of rows) {
  const page = /\.(html|css|mjs)$/.test(r.f);
  if (page) { rawPage += r.raw; gzPage += r.gz; }
  console.log(`  ${String(r.gz).padStart(7)} gz  ${String(r.raw).padStart(7)} raw  ${r.f}${page ? '' : '  (asset)'}`);
}
const gzipped = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log(`\n  page payload (html+css+mjs): ${rawPage} B raw / ${gzPage} B gzip (${gzipped(rawPage)} raw / ${gzipped(gzPage)} gz)`);
console.log('  build OK\n');
