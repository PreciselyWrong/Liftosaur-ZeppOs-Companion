#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const DEVICES = [
  'Amazfit Falcon',
  'Amazfit T-Rex Ultra',
  'Amazfit Cheetah Pro',
  'Cheetah Pro Kelvin Kiptum',
  'Amazfit Cheetah (Round)',
  'Amazfit Cheetah (Square)',
  'Amazfit Active',
  'Amazfit Active Edge',
  'Amazfit Balance',
  'Amazfit T-Rex 3',
  'Amazfit Active 2 NFC (Round)',
  'Amazfit Active 2 (Round)',
  'Amazfit Balance 2',
  'Amazfit Bip 6',
  'Amazfit Active 2 NFC (Square)',
  'Amazfit Cheetah 2 Ultra',
  'Amazfit Active 2 (Square)',
  'Amazfit Balance 2 XT',
  'Amazfit T-Rex 3 Pro (48mm)',
  'Amazfit T-Rex 3 Pro (44mm)',
  'Amazfit Active Max',
  'Amazfit T-Rex Ultra 2',
  'Amazfit Active 3 Premium',
  'Amazfit Cheetah 2 Pro',
  'Amazfit Balance Ultra',
  'Amazfit Balance 3',
  'Amazfit Balance 3 Ti',
  'Amazfit Bip Max',
];

const DEFAULT_OUT_PATH = 'docs/test-build-qr.png';
const DEFAULT_SCALE = 10;
const QUIET = 4;

export function parseCliArgs(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) return { showHelp: true };
  return {
    showHelp: false,
    outPath: args[0] || DEFAULT_OUT_PATH,
    scale: Number(args[1] || DEFAULT_SCALE),
  };
}

export function combineProcessOutput({ stdout = '', stderr = '' }) {
  return `${stdout}${stderr}`;
}

export function parsePreviewExpiry(text) {
  return text.match(/expire on (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/i)?.[1] || null;
}

export function previewCommand(devices = DEVICES) {
  return `zeus preview -s -t "${devices.join(',')}"`;
}

export function parseMatrix(text) {
  const lines = text
    .replace(/\r/g, '\n')
    .replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
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
  return rows;
}

const FINDER = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
];

function trimLightBorder(matrix) {
  let top = 0;
  let bottom = matrix.length;
  while (top < bottom && matrix[top].every((value) => !value)) top += 1;
  while (bottom > top && matrix[bottom - 1].every((value) => !value)) bottom -= 1;

  let left = 0;
  let right = matrix[0]?.length || 0;
  while (left < right && matrix.slice(top, bottom).every((row) => !row[left])) left += 1;
  while (right > left && matrix.slice(top, bottom).every((row) => !row[right - 1])) right -= 1;

  return matrix.slice(top, bottom).map((row) => row.slice(left, right));
}

function validateQrMatrix(matrix) {
  const n = matrix.length;
  if (!n || matrix.some((row) => row.length !== n)) {
    throw new Error(`symbol is not square: ${matrix[0]?.length || 0}x${n}`);
  }
  const version = (n - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 40) {
    throw new Error(`${n}x${n} is not a legal QR size`);
  }

  const finderAt = (oy, ox) => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        if (matrix[oy + y][ox + x] !== Boolean(FINDER[y][x])) return false;
      }
    }
    return true;
  };
  const checks = {
    'finder top left': finderAt(0, 0),
    'finder top right': finderAt(0, n - 7),
    'finder bottom left': finderAt(n - 7, 0),
    'horizontal timing': Array.from({ length: n - 16 }, (_, i) => i + 8).every(
      (x) => matrix[6][x] === (x % 2 === 0)
    ),
    'vertical timing': Array.from({ length: n - 16 }, (_, i) => i + 8).every(
      (y) => matrix[y][6] === (y % 2 === 0)
    ),
    'dark module': matrix[n - 8][8],
  };
  const failed = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  if (failed.length) {
    throw new Error(`invalid symbol, failed: ${failed.join(', ')}`);
  }
}

export function normalizeQrMatrix(rows) {
  const attempts = [
    rows.map((row) => row.slice()),
    rows.map((row) => row.map((value) => !value)),
  ];
  const failures = new Set();

  for (const attempt of attempts) {
    const trimmed = trimLightBorder(attempt);
    const height = trimmed.length;
    const width = trimmed[0]?.length || 0;
    for (let size = Math.min(height, width); size >= 21; size--) {
      if ((size - 17) % 4 !== 0) continue;
      for (let top = 0; top <= height - size; top++) {
        for (let left = 0; left <= width - size; left++) {
          const matrix = trimmed
            .slice(top, top + size)
            .map((row) => row.slice(left, left + size));
          try {
            validateQrMatrix(matrix);
            return matrix;
          } catch (error) {
            failures.add(error.message);
          }
        }
      }
    }
  }

  throw new Error(`invalid QR matrix: ${[...failures].join('; ')}`);
}

function writePng(matrix, scale, outPath) {
  const modH = matrix.length;
  const width = matrix[0].length;
  const pxW = (width + QUIET * 2) * scale;
  const pxH = (modH + QUIET * 2) * scale;
  const stride = pxW + 1;
  const raw = Buffer.alloc(stride * pxH, 0xff);
  for (let y = 0; y < pxH; y++) raw[y * stride] = 0;
  for (let my = 0; my < modH; my++) {
    for (let mx = 0; mx < width; mx++) {
      if (!matrix[my][mx]) continue;
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
  ihdr[8] = 8;
  ihdr[9] = 0;
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

function main() {
  const { showHelp, outPath, scale } = parseCliArgs();
  if (showHelp) {
    console.log(`Usage: node tools/build-preview.mjs [out-path] [scale]

Build and rasterise one Zepp preview QR code for all ${DEVICES.length} supported watches.`);
    return;
  }
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('scale must be a positive number');

  console.log(`Building preview for ${DEVICES.length} devices...`);
  const result = spawnSync(previewCommand(), {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    shell: true,
  });
  if (result.error) throw result.error;
  const rawOutput = combineProcessOutput(result);
  if (result.status !== 0) {
    throw new Error(`zeus preview failed with exit code ${result.status}\n${rawOutput}`);
  }

  for (const line of rawOutput.split('\n')) {
    if (line.includes('device sources') || line.includes('expire')) {
      console.log(line.trim());
    }
  }

  const matrix = normalizeQrMatrix(parseMatrix(rawOutput));
  const expiry = parsePreviewExpiry(rawOutput);
  const size = matrix.length;
  const version = (size - 17) / 4;
  const { pxW, pxH } = writePng(matrix, scale, outPath);
  console.log(`${outPath}: QR version ${version} (${size}x${size} modules) -> ${pxW}x${pxH}px`);
  if (expiry) console.log(`Preview expires at ${expiry} local time.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
