/**
 * FLOOD.EXE — game model (standalone candidate).
 *
 * This file is the single source of truth for the outcome function and the paytable.
 * It is imported verbatim by both `index.html` (browser) and the verification harness
 * (Node), so the page can never disagree with the money.
 *
 * CONTRACT IS THE AUTHORITY. `outcome()` reproduces `FloodGame._paint` / `_floodArea`
 * byte-for-byte from a 32-byte VRF word:
 *   field = uint256(keccak256(word || 0x00)) >> 112          (top 144 bits = 12x12 canvas)
 *   start = first byte < 144 scanning the LEAST-significant byte of
 *           uint256(keccak256(word || 0x01)); fallback keccak256(word || 0x02), then 0.
 *   area  = size of the 4-connected same-colour region containing `start`.
 *
 * Keccak-256 is implemented here in pure JS (no node:crypto, no wasm, no files) so the
 * model is a pure function of the word on every platform. It is cross-checked against
 * two independent references (pycryptodome and foundry `cast keccak`) in tests/.
 *
 * No crypto randomness, no I/O, no other inputs: `outcome(word)` is a pure function of
 * the 32-byte word. That is the whole VRF claim.
 */

export const SLUG = 'flood-exe';

export const COLS = 12;
export const ROWS = 12;
export const CELLS = COLS * ROWS; // 144
export const MIN_WIN_AREA = 30;

/** Paytable: [minArea, maxArea, totalReturnMultiple]. Losing band first. Tiles 0..144. */
export const BANDS = [
  { min: 0, max: 29, mult: 0 },
  { min: 30, max: 39, mult: 1.5 },
  { min: 40, max: 49, mult: 2 },
  { min: 50, max: 59, mult: 3 },
  { min: 60, max: 79, mult: 6 },
  { min: 80, max: CELLS, mult: 250 },
];

/**
 * E[return multiple] in basis points. Derived by the corrected counter-based sampler in
 * prototype/game/math/tune.mjs (10,000,000 rounds) and corroborated by an independent
 * 200,000,000-round re-derivation (94.746%) and the live chain (76.34% losing rounds). The
 * paytable is exact integer code; the probabilities are Monte Carlo. See rtp-proof.md.
 */
export const EXPECTED_RTP_BPS = 9472; // 94.717%

// ------------------------------------------------------------------ keccak-256
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const RC_LO = new Int32Array(RC.map(v => Number(v & 0xffffffffn) | 0));
const RC_HI = new Int32Array(RC.map(v => Number((v >> 32n) & 0xffffffffn) | 0));
const ROT = new Uint8Array(25);
{
  const table = [
    [0, 36, 3, 41, 18],
    [1, 44, 10, 45, 2],
    [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56],
    [27, 20, 39, 8, 14],
  ];
  for (let x = 0; x < 5; x += 1) for (let y = 0; y < 5; y += 1) ROT[x + 5 * y] = table[x][y];
}
const RATE = 136; // keccak-256 rate in bytes

// Module-level scratch: `outcome()` runs millions of times in the harness, so the
// permutation reuses its working lanes instead of allocating 3 typed arrays per call.
// Single-threaded, non-reentrant: the returned hash still depends only on its input.
const _C = new Int32Array(10);
const _D = new Int32Array(10);
const _B = new Int32Array(50);

function permute(s) {
  const C = _C;
  const D = _D;
  const B = _B;
  for (let round = 0; round < 24; round += 1) {
    for (let x = 0; x < 5; x += 1) {
      C[2 * x] = (s[2 * x] ^ s[2 * (x + 5)] ^ s[2 * (x + 10)] ^ s[2 * (x + 15)] ^ s[2 * (x + 20)]) | 0;
      C[2 * x + 1] = (s[2 * x + 1] ^ s[2 * (x + 5) + 1] ^ s[2 * (x + 10) + 1] ^ s[2 * (x + 15) + 1] ^ s[2 * (x + 20) + 1]) | 0;
    }
    for (let x = 0; x < 5; x += 1) {
      const xm = (x + 4) % 5;
      const xp = (x + 1) % 5;
      const rlo = C[2 * xp];
      const rhi = C[2 * xp + 1];
      const rotlo = ((rlo << 1) | (rhi >>> 31)) | 0;
      const rothi = ((rhi << 1) | (rlo >>> 31)) | 0;
      D[2 * x] = (C[2 * xm] ^ rotlo) | 0;
      D[2 * x + 1] = (C[2 * xm + 1] ^ rothi) | 0;
    }
    for (let i = 0; i < 25; i += 1) {
      s[2 * i] = (s[2 * i] ^ D[2 * (i % 5)]) | 0;
      s[2 * i + 1] = (s[2 * i + 1] ^ D[2 * (i % 5) + 1]) | 0;
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const i = x + 5 * y;
        const j = y + 5 * ((2 * x + 3 * y) % 5);
        const r = ROT[i];
        const lo = s[2 * i];
        const hi = s[2 * i + 1];
        let nlo;
        let nhi;
        if (r === 0) { nlo = lo; nhi = hi; }
        else if (r === 32) { nlo = hi; nhi = lo; }
        else if (r < 32) { nlo = ((lo << r) | (hi >>> (32 - r))) | 0; nhi = ((hi << r) | (lo >>> (32 - r))) | 0; }
        else { const rr = r - 32; nlo = ((hi << rr) | (lo >>> (32 - rr))) | 0; nhi = ((lo << rr) | (hi >>> (32 - rr))) | 0; }
        B[2 * j] = nlo;
        B[2 * j + 1] = nhi;
      }
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const i = x + 5 * y;
        const i1 = ((x + 1) % 5) + 5 * y;
        const i2 = ((x + 2) % 5) + 5 * y;
        s[2 * i] = (B[2 * i] ^ ((~B[2 * i1]) & B[2 * i2])) | 0;
        s[2 * i + 1] = (B[2 * i + 1] ^ ((~B[2 * i1 + 1]) & B[2 * i2 + 1])) | 0;
      }
    }
    s[0] = (s[0] ^ RC_LO[round]) | 0;
    s[1] = (s[1] ^ RC_HI[round]) | 0;
  }
}

/** Keccak-256 (Ethereum padding 0x01 .. 0x80). Exported for the test vectors. */
export function keccak256(bytes) {
  const s = new Int32Array(50);
  const len = bytes.length;
  const full = Math.floor(len / RATE) * RATE;
  for (let off = 0; off < full; off += RATE) {
    for (let i = 0; i < RATE; i += 1) {
      const lane = i >> 3;
      const sub = i & 7;
      s[2 * lane + (sub >= 4 ? 1 : 0)] ^= (bytes[off + i] << (8 * (sub & 3)));
    }
    permute(s);
  }
  for (let i = full; i < len; i += 1) {
    const lane = (i - full) >> 3;
    const sub = (i - full) & 7;
    s[2 * lane + (sub >= 4 ? 1 : 0)] ^= (bytes[i] << (8 * (sub & 3)));
  }
  const padAt = len - full;
  s[2 * (padAt >> 3) + ((padAt & 7) >= 4 ? 1 : 0)] ^= (0x01 << (8 * (padAt & 3)));
  const lastAt = RATE - 1;
  s[2 * (lastAt >> 3) + ((lastAt & 7) >= 4 ? 1 : 0)] ^= (0x80 << (8 * (lastAt & 3)));
  permute(s);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    const lane = i >> 3;
    const sub = i & 7;
    const word = ((sub >= 4 ? s[2 * lane + 1] : s[2 * lane]) >>> 0);
    out[i] = (word >>> (8 * (sub & 3))) & 0xff;
  }
  return out;
}

// ------------------------------------------------------------------ hex helpers
export function hexToBytes(hex) {
  const clean = String(hex).replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) throw new Error(`bad hex: ${hex}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes) {
  let s = '0x';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function bytesToBigInt(bytes) {
  let x = 0n;
  for (const b of bytes) x = (x << 8n) | BigInt(b);
  return x;
}

// ------------------------------------------------------------------ canvas + flood
export const colourOf = (field, index) => Number((BigInt(field) >> BigInt(index)) & 1n);

/** BigInt field -> 144-cell colour array. Cell i is bit i of the field (LSB first). */
export function cellsFromField(field) {
  const f = BigInt(field);
  const cells = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i += 1) cells[i] = Number((f >> BigInt(i)) & 1n);
  return cells;
}

/**
 * Fast path: the contract's canvas is the top 144 bits of keccak256(word||0x00).
 * A 256-bit big-endian hash H has field = H >> 112, so cell i is
 *   H byte (17 - (i>>3)), bit (i & 7).
 * This is byte-index arithmetic, not BigInt, because `outcome()` runs millions of times.
 */
function cellsFromCanvasHash(H) {
  const cells = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i += 1) {
    cells[i] = (H[17 - (i >> 3)] >>> (i & 7)) & 1;
  }
  return cells;
}

/** 4-connected flood fill from `start` over a cell-colour array. */
export function floodArea(cells, start) {
  const colour = cells[start];
  const seen = new Uint8Array(CELLS);
  const stack = new Int32Array(CELLS);
  let sp = 0;
  stack[sp] = start;
  sp += 1;
  seen[start] = 1;
  let area = 0;
  while (sp > 0) {
    sp -= 1;
    const i = stack[sp];
    area += 1;
    const x = i % COLS;
    const y = (i - x) / COLS;
    if (x > 0 && !seen[i - 1] && cells[i - 1] === colour) { seen[i - 1] = 1; stack[sp] = i - 1; sp += 1; }
    if (x + 1 < COLS && !seen[i + 1] && cells[i + 1] === colour) { seen[i + 1] = 1; stack[sp] = i + 1; sp += 1; }
    if (y > 0 && !seen[i - COLS] && cells[i - COLS] === colour) { seen[i - COLS] = 1; stack[sp] = i - COLS; sp += 1; }
    if (y + 1 < ROWS && !seen[i + COLS] && cells[i + COLS] === colour) { seen[i + COLS] = 1; stack[sp] = i + COLS; sp += 1; }
  }
  return area;
}

const _INPUT33 = new Uint8Array(33);

function canvasHash(wordBytes, tag) {
  _INPUT33.set(wordBytes, 0);
  _INPUT33[32] = tag & 0xff;
  return keccak256(_INPUT33);
}

/**
 * Reproduce the contract's on-chain start-cell selection: scan the LEAST-significant byte
 * of uint256(keccak256(word||0x01)) first (byte H[31]), then H[30] … H[0], then the same
 * over keccak256(word||0x02). The first byte < 144 wins. Contract:
 *   for i in 0..31: b = (stream >> (8*i)) & 0xff; if (b < CELLS) return b;
 */
function pickStart(wordBytes) {
  for (const tag of [1, 2]) {
    const S = canvasHash(wordBytes, tag);
    for (let i = 0; i < 32; i += 1) {
      const b = S[31 - i];
      if (b < CELLS) return b;
    }
  }
  return 0; // P(all 64 bytes rejected) ≈ 1e-25, unreachable in practice
}

/**
 * Reproduce the contract's on-chain derivation from a 32-byte VRF word.
 * Returns the canvas as a BigInt field (for decoding/rendering) plus start and area.
 */
export function deriveCanvas(word) {
  const wordBytes = hexToBytes(word);
  if (wordBytes.length !== 32) throw new Error('word must be 32 bytes');
  const H = canvasHash(wordBytes, 0);
  const field = bytesToBigInt(H) >> BigInt(256 - CELLS);
  const start = pickStart(wordBytes);
  const area = floodArea(cellsFromCanvasHash(H), start);
  return { field, start, area };
}

/** Decode a settled `gameState` (abi.encode(uint256,uint16,uint16,uint256)). */
export function decodeGameState(hex) {
  const h = String(hex);
  const body = h.slice(2);
  if (body.length !== 256) throw new Error(`gameState must be 4 ABI words (got ${body.length} hex chars)`);
  return {
    field: BigInt('0x' + body.slice(0, 64)),
    start: Number.parseInt(body.slice(64, 128), 16),
    area: Number.parseInt(body.slice(128, 192), 16),
    payout: BigInt('0x' + body.slice(192, 256)),
  };
}

/**
 * Breadth-first flood from `start` through 4-connected same-colour cells.
 * Presentation only (the reveal animation) — it changes no money; `area` comes from the
 * contract. Kept identical to the proven frontend model.ts floodOrder.
 */
export function floodOrder(field, start) {
  const colour = colourOf(field, start);
  const seen = new Set([start]);
  const queue = [start];
  const order = [];
  while (queue.length > 0) {
    const i = queue.shift();
    order.push(i);
    const x = i % COLS;
    const y = Math.floor(i / COLS);
    const neighbours = [];
    if (x > 0) neighbours.push(i - 1);
    if (x + 1 < COLS) neighbours.push(i + 1);
    if (y > 0) neighbours.push(i - COLS);
    if (y + 1 < ROWS) neighbours.push(i + COLS);
    for (const j of neighbours) {
      if (!seen.has(j) && colourOf(field, j) === colour) {
        seen.add(j);
        queue.push(j);
      }
    }
  }
  return order;
}

// ------------------------------------------------------------------ paytable
export function bandOf(stat) {
  for (const b of BANDS) if (stat >= b.min && stat <= b.max) return b.mult;
  return 0;
}

/** Pure function of the 32-byte word. */
export function outcome(word) {
  const { area } = deriveCanvas(word);
  return { stat: area, mult: bandOf(area) };
}

// ------------------------------------------------------------------ round seeder
/**
 * Counter-based 32-byte word, one per (seed0, round).
 *
 * The C1 defect (research/wave5-contradictions.md): `seed0 + round * 2654435761` is a
 * float that passes 2^53 at round ~3,393,263, after which IEEE-754 spacing destroys the
 * low bits and `>>> 0` sees a collapsed seed. Nothing here accumulates across rounds:
 * every operation is a 32-bit integer op (Math.imul / >>> / ^ / +), so the stream is exact
 * for every integer round. The round enters through the single 32-bit key
 * `((round >>> 0) + 1) XOR floor(round / 2^32)`, a bijection of the round index WITHIN each
 * 2^32 window — so no two rounds in one window collide, and every recorded run (< 2^32
 * rounds) is inside one window. Across windows the key CAN alias: makeRng(seed, 2^32-1) ===
 * makeRng(seed, 2^32) is a proven collision (docs/adversarial.md, finding F1). This seeder is
 * tooling-only — the contract and the page never call it — and it does NOT feed the RTP
 * enumeration, which draws words directly.
 */
function mix32(x) {
  let h = x >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h >>> 0;
}

export function makeRng(seed0, round) {
  const seed = hexToBytes(seed0);
  if (seed.length !== 32) throw new Error('seed0 must be 32 bytes');
  const rlo = round >>> 0; // low 32 bits of the round index (round <= 2^52 is exact)
  const rhi = Math.floor(round / 4294967296) >>> 0; // remaining high bits
  const out = new Uint8Array(32);
  for (let lane = 0; lane < 8; lane += 1) {
    const base = lane * 4;
    const s = (seed[base] | (seed[base + 1] << 8) | (seed[base + 2] << 16) | (seed[base + 3] << 24)) >>> 0;
    const domain = Math.imul(lane + 1, 0x9e3779b1) >>> 0;
    let x = (s ^ ((rlo + 1) >>> 0) ^ domain) >>> 0;
    x = mix32((x ^ rhi) >>> 0);
    x = mix32((x ^ Math.imul(lane + 1, 0xc2b2ae35)) >>> 0);
    out[base] = x & 0xff;
    out[base + 1] = (x >>> 8) & 0xff;
    out[base + 2] = (x >>> 16) & 0xff;
    out[base + 3] = (x >>> 24) & 0xff;
  }
  return bytesToHex(out);
}
