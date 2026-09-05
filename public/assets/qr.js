/**
 * A QR encoder, so the board can show a code players scan to reach the scoring
 * page on the hall's wifi.
 *
 * It is written out here rather than pulled from a CDN because a sports hall
 * often has no internet at all. The whole point of the join screen is that it
 * works on a laptop and a phone with nothing but a router between them, so it
 * cannot depend on fetching a library first.
 *
 * Byte mode, error correction level M, versions 1 to 10, which covers any LAN
 * URL comfortably. Enough of the specification to be correct, and no more.
 *
 * Use:  crokQR.svg('http://192.168.1.42:8085/')  ->  an <svg> string
 */
(function (global) {
  'use strict';

  let EC_LEVEL_M = 0;                 // the two format bits for level M
  let PAD_BYTES = [0xEC, 0x11];       // alternating filler after the terminator

  /* Per version: EC codewords per block, then the block groups as
     [blockCount, dataCodewordsPerBlock]. Straight out of the tables. */
  let VERSIONS = [
    null,
    { ec: 10, groups: [[1, 16]] },
    { ec: 16, groups: [[1, 28]] },
    { ec: 26, groups: [[1, 44]] },
    { ec: 18, groups: [[2, 32]] },
    { ec: 24, groups: [[2, 43]] },
    { ec: 16, groups: [[4, 27]] },
    { ec: 18, groups: [[4, 31]] },
    { ec: 22, groups: [[2, 38], [2, 39]] },
    { ec: 22, groups: [[3, 36], [2, 37]] },
    { ec: 26, groups: [[4, 43], [1, 44]] }
  ];

  /* Centres of the alignment patterns, by version. */
  let ALIGN = [
    null, [], [6, 18], [6, 22], [6, 26], [6, 30],
    [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
  ];

  /* ---- arithmetic over GF(256), for the Reed-Solomon codewords ---- */

  let EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function buildTables() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;      // the primitive polynomial QR uses
    }
    for (let j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  }());

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /** The generator polynomial for `count` error-correction codewords. */
  function generatorPoly(count) {
    let poly = [1];
    for (let i = 0; i < count; i++) {
      // Multiply by (x + a^i). Coefficients run highest power first, so the x
      // term keeps its index and the constant term moves one along.
      let next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function errorCodewords(data, count) {
    let gen = generatorPoly(count);
    let rest = data.slice().concat(new Array(count).fill(0));
    for (let i = 0; i < data.length; i++) {
      let lead = rest[i];
      if (lead === 0) continue;
      for (let j = 0; j < gen.length; j++) rest[i + j] ^= gfMul(gen[j], lead);
    }
    return rest.slice(data.length);
  }

  /* ---- turning text into codewords ---- */

  function utf8Bytes(text) {
    let out = [], encoded = unescape(encodeURIComponent(text));
    for (let i = 0; i < encoded.length; i++) out.push(encoded.charCodeAt(i));
    return out;
  }

  /** The smallest version the payload fits into. */
  function chooseVersion(byteCount) {
    for (let v = 1; v <= 10; v++) {
      let spec = VERSIONS[v];
      let dataCodewords = 0;
      spec.groups.forEach(function (g) { dataCodewords += g[0] * g[1]; });
      let headerBits = 4 + (v >= 10 ? 16 : 8);
      if (byteCount * 8 + headerBits <= dataCodewords * 8) return v;
    }
    return 0;                          // longer than this board will ever need
  }

  function buildCodewords(bytes, version) {
    let spec = VERSIONS[version];
    let dataCodewords = 0;
    spec.groups.forEach(function (g) { dataCodewords += g[0] * g[1]; });

    let bits = [];
    function push(value, width) {
      for (let i = width - 1; i >= 0; i--) bits.push((value >> i) & 1);
    }
    push(0b0100, 4);                               // byte mode
    push(bytes.length, version >= 10 ? 16 : 8);
    bytes.forEach(function (b) { push(b, 8); });

    let capacity = dataCodewords * 8;
    for (let t = 0; t < 4 && bits.length < capacity; t++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    let words = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
      words.push(byte);
    }
    for (let p = 0; words.length < dataCodewords; p++) words.push(PAD_BYTES[p % 2]);

    // Split into blocks, then interleave data and error codewords.
    let blocks = [], ecBlocks = [], at = 0;
    spec.groups.forEach(function (group) {
      for (let b = 0; b < group[0]; b++) {
        let block = words.slice(at, at + group[1]);
        at += group[1];
        blocks.push(block);
        ecBlocks.push(errorCodewords(block, spec.ec));
      }
    });

    let longest = Math.max.apply(null, blocks.map(function (b) { return b.length; }));
    let out = [];
    for (let i = 0; i < longest; i++) {
      blocks.forEach(function (b) { if (i < b.length) out.push(b[i]); });
    }
    for (let i = 0; i < spec.ec; i++) {
      ecBlocks.forEach(function (b) { out.push(b[i]); });
    }
    return out;
  }

  /* ---- laying out the grid ---- */

  function emptyGrid(size) {
    let g = [];
    for (let r = 0; r < size; r++) g.push(new Array(size).fill(null));
    return g;
  }

  function placeFinder(grid, reserved, row, col) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        let rr = row + r, cc = col + c;
        if (rr < 0 || cc < 0 || rr >= grid.length || cc >= grid.length) continue;
        let inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                     (c >= 0 && c <= 6 && (r === 0 || r === 6));
        let inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        grid[rr][cc] = (inRing || inCore) ? 1 : 0;
        reserved[rr][cc] = true;
      }
    }
  }

  function placeAlignment(grid, reserved, version) {
    let centres = ALIGN[version], size = grid.length;
    for (let a = 0; a < centres.length; a++) {
      for (let b = 0; b < centres.length; b++) {
        let row = centres[a], col = centres[b];
        // The three finder corners have no alignment pattern.
        if ((row <= 8 && col <= 8) || (row <= 8 && col >= size - 9) || (row >= size - 9 && col <= 8)) continue;
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            let ring = Math.max(Math.abs(r), Math.abs(c));
            grid[row + r][col + c] = (ring === 1) ? 0 : 1;
            reserved[row + r][col + c] = true;
          }
        }
      }
    }
  }

  function placeTimingAndReserved(grid, reserved, version) {
    let size = grid.length;
    for (let i = 8; i < size - 8; i++) {
      let bit = (i % 2 === 0) ? 1 : 0;
      if (grid[6][i] === null) { grid[6][i] = bit; reserved[6][i] = true; }
      if (grid[i][6] === null) { grid[i][6] = bit; reserved[i][6] = true; }
    }
    grid[size - 8][8] = 1;                       // the always-dark module
    reserved[size - 8][8] = true;

    for (let i = 0; i <= 8; i++) {               // format information areas
      if (grid[8][i] === null) { grid[8][i] = 0; reserved[8][i] = true; }
      if (grid[i][8] === null) { grid[i][8] = 0; reserved[i][8] = true; }
    }
    for (let i = 0; i < 8; i++) {
      if (grid[8][size - 1 - i] === null) { grid[8][size - 1 - i] = 0; reserved[8][size - 1 - i] = true; }
      if (grid[size - 1 - i][8] === null) { grid[size - 1 - i][8] = 0; reserved[size - 1 - i][8] = true; }
    }

    if (version >= 7) {                          // version information blocks
      let bits = versionBits(version);
      for (let i = 0; i < 18; i++) {
        let bit = (bits >> i) & 1;
        let r = Math.floor(i / 3), c = i % 3;
        grid[size - 11 + c][r] = bit; reserved[size - 11 + c][r] = true;
        grid[r][size - 11 + c] = bit; reserved[r][size - 11 + c] = true;
      }
    }
  }

  function versionBits(version) {
    let value = version << 12;
    for (let i = 0; i < 6; i++) {
      if (value & (1 << (17 - i))) value ^= 0x1F25 << (5 - i);
    }
    return (version << 12) | value;
  }

  function placeData(grid, reserved, codewords) {
    let size = grid.length, bitIndex = 0, upward = true;
    let total = codewords.length * 8;
    function nextBit() {
      if (bitIndex >= total) return 0;
      let bit = (codewords[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
      bitIndex++;
      return bit;
    }
    for (let right = size - 1; right > 0; right -= 2) {
      if (right === 6) right = 5;                // the vertical timing column
      for (let step = 0; step < size; step++) {
        let row = upward ? size - 1 - step : step;
        for (let c = 0; c < 2; c++) {
          let col = right - c;
          if (reserved[row][col]) continue;
          grid[row][col] = nextBit();
        }
      }
      upward = !upward;
    }
  }

  let MASKS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return ((r * c) % 2) + ((r * c) % 3) === 0; },
    function (r, c) { return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; },
    function (r, c) { return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; }
  ];

  function formatBits(mask) {
    let value = ((EC_LEVEL_M << 3) | mask) << 10;
    for (let i = 0; i < 5; i++) {
      if (value & (1 << (14 - i))) value ^= 0x537 << (4 - i);
    }
    return (((EC_LEVEL_M << 3) | mask) << 10 | value) ^ 0x5412;
  }

  /* The fifteen format modules, most significant bit first, in the order the
     specification lists them. Column 6 and row 6 are skipped because the timing
     patterns run there. */
  let FORMAT_CELLS = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
  ];

  function writeFormat(grid, mask) {
    let bits = formatBits(mask), size = grid.length;
    for (let i = 0; i < 15; i++) {
      let bit = (bits >> (14 - i)) & 1;
      grid[FORMAT_CELLS[i][0]][FORMAT_CELLS[i][1]] = bit;
      // The duplicate, split between the bottom-left and top-right corners.
      if (i < 7) grid[size - 1 - i][8] = bit;
      else grid[8][size - 15 + i] = bit;
    }
    grid[size - 8][8] = 1;      // the dark module sits inside that run, always set
  }

  /** Lower is better. The four rules from the specification. */
  function penalty(grid) {
    let size = grid.length, score = 0, dark = 0;

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c]) dark++;
        // 2x2 blocks of one colour
        if (r + 1 < size && c + 1 < size) {
          let v = grid[r][c];
          if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
        }
      }
    }

    // Runs of five or more, and the finder-like 1:1:3:1:1 sequence, both ways.
    function scanLine(get) {
      let runValue = get(0), runLength = 1, line = [runValue];
      for (let i = 1; i < size; i++) {
        let v = get(i);
        line.push(v);
        if (v === runValue) runLength++;
        else { if (runLength >= 5) score += 3 + (runLength - 5); runValue = v; runLength = 1; }
      }
      if (runLength >= 5) score += 3 + (runLength - 5);

      /* The finder-like sequence 1011101 with light modules on one side or the
         other, which a scanner can mistake for a real finder. The edge of the
         symbol counts as light, and after a match the scan resumes past it so
         one run of dark modules is not charged several times over. */
      let pattern = [1, 0, 1, 1, 1, 0, 1];
      let i = 0;
      while (i + 7 <= size) {
        let hit = true;
        for (let j = 0; j < 7; j++) if (line[i + j] !== pattern[j]) { hit = false; break; }
        if (!hit) { i += 1; continue; }

        let lightBefore = true;
        for (let j = Math.max(i - 4, 0); j < i; j++) if (line[j]) { lightBefore = false; break; }
        let lightAfter = true;
        for (let j = i + 7; j < Math.min(i + 11, size); j++) if (line[j]) { lightAfter = false; break; }

        if (i === 0 || i === size - 7 || lightBefore || lightAfter) { score += 40; i += 7; }
        else i += 4;
      }
    }
    for (let r = 0; r < size; r++) scanLine(function (i) { return grid[r][i]; });
    for (let c = 0; c < size; c++) scanLine(function (i) { return grid[i][c]; });

    let ratio = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
    return score;
  }

  /** The module grid for `text`, as rows of 0 and 1. */
  function matrix(text) {
    let bytes = utf8Bytes(text);
    let version = chooseVersion(bytes.length);
    if (version === 0) throw new Error('Too much text for a QR code this size.');

    let size = 17 + version * 4;
    let base = emptyGrid(size), reserved = emptyGrid(size);
    for (let r = 0; r < size; r++) reserved[r].fill(false);

    placeFinder(base, reserved, 0, 0);
    placeFinder(base, reserved, 0, size - 7);
    placeFinder(base, reserved, size - 7, 0);
    placeAlignment(base, reserved, version);
    placeTimingAndReserved(base, reserved, version);
    placeData(base, reserved, buildCodewords(bytes, version));

    /* Try every mask and keep the least ugly. The format information is written
       only onto the winner: the specification is explicit that it must not be
       in place while the masks are being judged. */
    let best = null, bestScore = Infinity, bestMask = 0;
    for (let m = 0; m < 8; m++) {
      let candidate = base.map(function (row) { return row.slice(); });
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (!reserved[r][c] && MASKS[m](r, c)) candidate[r][c] ^= 1;
        }
      }
      let score = penalty(candidate);
      if (score < bestScore) { bestScore = score; best = candidate; bestMask = m; }
    }
    writeFormat(best, bestMask);
    matrix.lastChoice = { version: version, mask: bestMask, base: base, reserved: reserved };
    return best;
  }

  /**
   * An <svg> for `text`. Drawn as one path so it scales to any size on the
   * board without a library and without a network round trip.
   */
  function svg(text, options) {
    let opts = options || {};
    let quiet = opts.quiet === undefined ? 4 : opts.quiet;   // the mandatory margin
    let grid = matrix(text);
    let size = grid.length, span = size + quiet * 2;

    let d = '';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c]) d += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z';
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + span + ' ' + span + '" ' +
      'shape-rendering="crispEdges" role="img" aria-label="' +
      String(text).replace(/[&<>"]/g, '') + '">' +
      '<rect width="' + span + '" height="' + span + '" fill="' + (opts.light || '#fff') + '"/>' +
      '<path d="' + d + '" fill="' + (opts.dark || '#000') + '"/></svg>';
  }

  global.crokQR = { matrix: matrix, svg: svg };
}(typeof window === 'undefined' ? globalThis : window));
