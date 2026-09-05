/**
 * The board shows a QR code players scan to reach the scoring page on the hall's
 * wifi. A wrong code is not obviously wrong to look at, it just fails to scan in
 * front of a room full of people, so it is worth pinning down.
 *
 * Two kinds of check here. The golden hashes are payloads whose output was
 * verified module for module against an independent encoder, so a change in
 * behaviour shows up immediately. The round trip reads the symbol back out the
 * way a scanner does, which catches a mistake anywhere in the chain: the
 * codewords, the error correction, the layout, the mask, the format bits.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

interface QrApi {
  matrix(text: string): number[][];
  svg(text: string, options?: { quiet?: number; dark?: string; light?: string }): string;
}

/* qr.js is a plain browser script, so it is run in its own context and the
   global it defines is taken from there. */
const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, '..', 'public', 'assets', 'qr.js'), 'utf8');
const sandbox: { crokQR?: QrApi } = {};
runInNewContext(source, sandbox);
const qr = sandbox.crokQR;

function hash(matrix: number[][]): string {
  return createHash('sha256').update(matrix.map((row) => row.join('')).join('\n')).digest('hex').slice(0, 16);
}

test('the script defines the encoder', () => {
  assert.ok(qr, 'qr.js should define crokQR');
});

/* ---- output that was checked against an independent encoder ---- */

test('known payloads encode exactly as verified', () => {
  assert.ok(qr);
  const golden: ReadonlyArray<readonly [string, number, string]> = [
    ['z'.repeat(42), 29, 'e8956e08c1481242'],
    ['q'.repeat(62), 33, '25ad6f59d434bc44'],
    ['q'.repeat(106), 41, 'ff5d567e6119e1bc'],
    ['q'.repeat(213), 57, '86d0337bea63245b'],
    ['http://192.168.178.17:8085/', 29, '2b2b72e21904646e'],
  ];
  for (const [text, size, digest] of golden) {
    const matrix = qr.matrix(text);
    assert.equal(matrix.length, size, `size for a ${text.length} character payload`);
    assert.equal(hash(matrix), digest, `modules for a ${text.length} character payload`);
  }
});

/* ---- structure ---- */

test('the fixed patterns a scanner looks for are in place', () => {
  assert.ok(qr);
  const m = qr.matrix('http://192.168.1.42:8085/index.php');
  const size = m.length;

  for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    assert.ok(top !== undefined && left !== undefined);
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        assert.equal(m[top + r]?.[left + c], ring === 2 ? 0 : 1, `finder at ${top},${left} module ${r},${c}`);
      }
    }
  }

  for (let i = 8; i < size - 8; i++) {
    assert.equal(m[6]?.[i], i % 2 === 0 ? 1 : 0, `horizontal timing at ${i}`);
    assert.equal(m[i]?.[6], i % 2 === 0 ? 1 : 0, `vertical timing at ${i}`);
  }

  assert.equal(m[size - 8]?.[8], 1, 'the dark module is always set');
});

test('both copies of the format information agree and say level M', () => {
  assert.ok(qr);
  const m = qr.matrix('http://192.168.178.17:8085/');
  const size = m.length;

  const cells: ReadonlyArray<readonly [number, number]> = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  let first = 0, second = 0;
  for (let i = 0; i < 15; i++) {
    const cell = cells[i];
    assert.ok(cell);
    first = (first << 1) | (m[cell[0]]?.[cell[1]] ?? 0);
    const mirrored = i < 7 ? m[size - 1 - i]?.[8] : m[8]?.[size - 15 + i];
    second = (second << 1) | (mirrored ?? 0);
  }
  assert.equal(first, second, 'the two copies must carry the same bits');

  // Undo the mask, then check the BCH code and the error-correction level.
  const bits = first ^ 0x5412;
  let remainder = bits;
  for (let i = 0; i < 5; i++) {
    if (remainder & (1 << (14 - i))) remainder ^= 0x537 << (4 - i);
  }
  assert.equal(remainder, 0, 'the format bits must be a valid code word');
  assert.equal(bits >> 13, 0b00, 'error correction level M');
});

/* ---- reading the symbol back the way a scanner does ---- */

const MASKS: ReadonlyArray<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Rebuild the map of modules that carry no data, so they can be skipped. */
function functionModules(size: number, version: number): boolean[][] {
  const used: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (r: number, c: number): void => {
    const row = used[r];
    if (row && c >= 0 && c < size) row[c] = true;
  };
  for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    if (top === undefined || left === undefined) continue;
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) mark(top + r, left + c);
  }
  const centres: readonly number[][] = [
    [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
  ];
  const list = centres[version] ?? [];
  for (const row of list) {
    for (const col of list) {
      if ((row <= 8 && col <= 8) || (row <= 8 && col >= size - 9) || (row >= size - 9 && col <= 8)) continue;
      for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) mark(row + r, col + c);
    }
  }
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
  for (let i = 0; i <= 8; i++) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i++) { mark(8, size - 1 - i); mark(size - 1 - i, 8); }
  if (version >= 7) {
    for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) { mark(size - 11 + c, r); mark(r, size - 11 + c); }
  }
  return used;
}

/* How each version splits its data into blocks, as [blockCount, codewordsEach].
   From version 4 on there is more than one block and they are interleaved, so a
   reader has to put them back in order before the payload makes sense. */
const BLOCKS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [], [[1, 16]], [[1, 28]], [[1, 44]], [[2, 32]], [[2, 43]],
  [[4, 27]], [[4, 31]], [[2, 38], [2, 39]], [[3, 36], [2, 37]], [[4, 43], [1, 44]],
];

/** Undo the interleaving and return the data codewords in their original order. */
function deinterleave(stream: number[], version: number): number[] {
  const groups = BLOCKS[version] ?? [];
  const sizes: number[] = [];
  for (const [count, each] of groups) for (let i = 0; i < count; i++) sizes.push(each);

  const blocks: number[][] = sizes.map(() => []);
  const longest = Math.max(...sizes);
  let at = 0;
  for (let i = 0; i < longest; i++) {
    for (let b = 0; b < sizes.length; b++) {
      const size = sizes[b];
      const block = blocks[b];
      if (size === undefined || block === undefined || i >= size) continue;
      const value = stream[at];
      at += 1;
      if (value !== undefined) block.push(value);
    }
  }
  return blocks.flat();
}

/** Read the text back out of a finished symbol. */
function readBack(m: number[][]): string {
  const size = m.length;
  const version = (size - 17) / 4;

  const cells: ReadonlyArray<readonly [number, number]> = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  let format = 0;
  for (const cell of cells) format = (format << 1) | (m[cell[0]]?.[cell[1]] ?? 0);
  const mask = ((format ^ 0x5412) >> 10) & 0b111;
  const unmask = MASKS[mask];
  assert.ok(unmask, `mask ${mask} should exist`);

  const used = functionModules(size, version);
  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let c = 0; c < 2; c++) {
        const col = right - c;
        if (used[row]?.[col]) continue;
        bits.push((m[row]?.[col] ?? 0) ^ (unmask(row, col) ? 1 : 0));
      }
    }
    upward = !upward;
  }

  const stream: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] ?? 0);
    stream.push(byte);
  }
  const data = deinterleave(stream, version);

  const flat: number[] = [];
  for (const byte of data) for (let j = 7; j >= 0; j--) flat.push((byte >> j) & 1);
  let at = 0;
  const take = (count: number): number => {
    let value = 0;
    for (let i = 0; i < count; i++) { value = (value << 1) | (flat[at] ?? 0); at += 1; }
    return value;
  };
  assert.equal(take(4), 0b0100, 'byte mode');
  const length = take(version >= 10 ? 16 : 8);
  const bytes: number[] = [];
  for (let i = 0; i < length; i++) bytes.push(take(8));
  return Buffer.from(bytes).toString('utf8');
}

test('a finished code reads back as the text it was made from', () => {
  assert.ok(qr);
  const payloads = [
    'http://192.168.178.17:8085/',
    'http://192.168.1.42:8085/index.php',
    'http://10.0.0.7:8085/index.php?code=7QK4',
    'http://croki.local:8085/',
    'A',
    'z'.repeat(42),
    'q'.repeat(106),
    'q'.repeat(213),
    'accenten: éü',
  ];
  for (const text of payloads) {
    assert.equal(readBack(qr.matrix(text)), text, `round trip for ${text.length} characters`);
  }
});

test('a LAN address on any home network encodes and reads back', () => {
  assert.ok(qr);
  for (const octet of [0, 1, 2, 42, 100, 178, 254]) {
    for (const host of [2, 17, 42, 137, 254]) {
      const url = `http://192.168.${octet}.${host}:8085/index.php`;
      assert.equal(readBack(qr.matrix(url)), url);
    }
  }
});

/* ---- the drawing ---- */

test('the svg is self contained and sized to the code', () => {
  assert.ok(qr);
  const size = qr.matrix('http://192.168.178.17:8085/').length;
  const out = qr.svg('http://192.168.178.17:8085/');
  assert.match(out, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(out, new RegExp(`viewBox="0 0 ${size + 8} ${size + 8}"`), 'includes the quiet margin');

  // Whatever the text contains, it must not be able to close the tag it sits in.
  const hostile = qr.svg('<script>alert(1)</script>"');
  assert.ok(!/<script/i.test(hostile), 'markup in the text must not survive into the svg');
  assert.ok(!hostile.includes('"</svg>'), 'a quote in the text must not break out of the label');
});

test('text too long to encode is refused rather than drawn wrong', () => {
  assert.ok(qr);
  assert.throws(() => qr.matrix('x'.repeat(400)), /Too much text/);
});
