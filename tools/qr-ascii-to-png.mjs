#!/usr/bin/env node
/**
 * Turn the QR code that `zeus preview` prints in the terminal into a PNG.
 *
 * Zeus never writes an image: it renders the symbol with Unicode half blocks,
 * one character per two vertical modules, and prints it. Capturing the terminal
 * as a screenshot loses the module grid to antialiasing, so instead this reads
 * the characters back into a module matrix and rasterises it exactly.
 *
 * Polarity: a drawn half block is a LIGHT module, an undrawn one is DARK. That
 * is the opposite of the intuition, and it is what the finder patterns prove.
 *
 *   node tools/qr-ascii-to-png.mjs <capture.txt> <out.png> [scale]
 *
 * The symbol is validated before anything is written: three finder patterns,
 * both timing patterns, the dark module, and a legal version size. A capture
 * that lost characters, got wrapped by the terminal, or was parsed with the
 * wrong polarity fails these checks, so a wrong QR code cannot reach the docs.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const QUIET = 4; // modules of white margin added around the symbol

function parseMatrix(text) {
  const lines = text
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .split(/\r?\n/)
    .filter((l) => l.length > 10 && /^[▀▄█ ]+$/u.test(l.replace(/\s+$/, '')));
  if (!lines.length) throw new Error('no QR block found in the capture');

  const width = Math.max(...lines.map((l) => l.replace(/\s+$/, '').length));
  const rows = [];
  for (const line of lines) {
    const top = [];
    const bottom = [];
    for (let x = 0; x < width; x++) {
      const c = line[x] || ' ';
      top.push(c === '█' || c === '▀');
      bottom.push(c === '█' || c === '▄');
    }
    rows.push(top, bottom);
  }
  // The terminal leaves an unpainted half row above and below the symbol.
  while (rows.length && rows[0].every((v) => !v)) rows.shift();
  while (rows.length && rows[rows.length - 1].every((v) => !v)) rows.pop();
  return { rows, width };
}

/** Strips the one module quiet border zeus prints, then checks the symbol. */
function validate(rows, width) {
  const sym = rows.slice(1, -1).map((r) => r.slice(1, width - 1));
  const n = sym.length;
  if (!n || sym[0].length !== n) {
    throw new Error(`symbol is not square: ${sym[0]?.length}x${n}`);
  }
  const version = (n - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 40) {
    throw new Error(`${n}x${n} is not a legal QR size`);
  }

  const dark = (y, x) => !sym[y][x];
  const FINDER = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ];
  const finderAt = (oy, ox) => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        if (dark(oy + y, ox + x) !== !!FINDER[y][x]) return false;
      }
    }
    return true;
  };
  const checks = {
    'finder top left': finderAt(0, 0),
    'finder top right': finderAt(0, n - 7),
    'finder bottom left': finderAt(n - 7, 0),
    'horizontal timing': Array.from({ length: n - 16 }, (_, i) => i + 8).every(
      (x) => dark(6, x) === (x % 2 === 0)
    ),
    'vertical timing': Array.from({ length: n - 16 }, (_, i) => i + 8).every(
      (y) => dark(y, 6) === (y % 2 === 0)
    ),
    'dark module': dark(n - 8, 8),
  };
  const failed = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  if (failed.length) {
    throw new Error(`invalid symbol, failed: ${failed.join(', ')}`);
  }
  return { size: n, version };
}

function writePng(rows, width, scale, outPath) {
  const modH = rows.length;
  const pxW = (width + QUIET * 2) * scale;
  const pxH = (modH + QUIET * 2) * scale;
  const stride = pxW + 1;
  const raw = Buffer.alloc(stride * pxH, 0xff);
  for (let y = 0; y < pxH; y++) raw[y * stride] = 0; // filter: none
  for (let my = 0; my < modH; my++) {
    for (let mx = 0; mx < width; mx++) {
      if (rows[my][mx]) continue; // light module stays white
      for (let dy = 0; dy < scale; dy++) {
        const y = (my + QUIET) * scale + dy;
        const start = y * stride + 1 + (mx + QUIET) * scale;
        raw.fill(0x00, start, start + scale);
      }
    }
  }

  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(pxW, 0);
  ihdr.writeUInt32BE(pxH, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  fs.writeFileSync(
    outPath,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ])
  );
  return { pxW, pxH };
}

const [, , inPath, outPath, scaleArg] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node tools/qr-ascii-to-png.mjs <capture.txt> <out.png> [scale]');
  process.exit(2);
}
const { rows, width } = parseMatrix(fs.readFileSync(inPath, 'utf8'));
const { size, version } = validate(rows, width);
const { pxW, pxH } = writePng(rows, width, Number(scaleArg || 10), outPath);
console.log(`${outPath}: QR version ${version} (${size}x${size} modules) -> ${pxW}x${pxH}px`);
