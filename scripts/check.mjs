#!/usr/bin/env node
/**
 * FLOOD.EXE — syntax check.
 *
 * `node --check` every `.js` / `.mjs` in the project (source tree only: `node_modules/`,
 * `dist/` and `.git/` are skipped). `package.json` sets `"type": "module"`, so the
 * top-level-`import` files parse as ES modules.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'dist', '.git']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(ROOT).sort();
let failed = 0;
for (const f of files) {
  const rel = path.relative(ROOT, f);
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    console.log(`  ok    ${rel}`);
  } catch (err) {
    failed += 1;
    const first = String(err.stderr ?? err.message).split('\n').find((l) => l.trim()) ?? 'syntax error';
    console.error(`  FAIL  ${rel}: ${first}`);
  }
}
console.log(`\ncheck — ${files.length} JS file(s), ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
