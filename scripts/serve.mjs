#!/usr/bin/env node
/**
 * FLOOD.EXE — static server.
 *
 *   npm run serve            # serves dist/ on http://127.0.0.1:8941
 *   npm run serve -- .       # serves the project root instead (dev)
 *
 * ES-module imports need `http(s)://` — `file://` has an opaque origin and browsers
 * refuse `<script type="module">` imports there. `.mjs` is served as
 * `text/javascript`, which the module loader requires.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 8941);
const HOST = process.env.HOST ?? '127.0.0.1';
const ROOTDIR = path.resolve(process.argv[2] ?? path.join(ROOT, 'dist'));

if (!fs.existsSync(ROOTDIR) || !fs.statSync(ROOTDIR).isDirectory()) {
  console.error(`serve: root not found: ${ROOTDIR}\n       run \`npm run build\` first.`);
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' });
      res.end('method not allowed');
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host ?? HOST}`);
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(ROOTDIR, '.' + rel);
    // path-traversal guard: the resolved file must stay inside ROOTDIR
    if (file !== ROOTDIR && !file.startsWith(ROOTDIR + path.sep)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      return;
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const body = fs.readFileSync(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`server error: ${err.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`FLOOD.EXE serving ${ROOTDIR}`);
  console.log(`  http://${HOST}:${PORT}/`);
});
