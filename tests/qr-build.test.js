import test from 'node:test';
import assert from 'node:assert/strict';

import {
  combineProcessOutput,
  normalizeQrMatrix,
  parseCliArgs,
  parseMatrix,
  parsePreviewExpiry,
  previewCommand,
} from '../tools/build-preview.mjs';

const FINDER = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
];

function structuralQr(size = 21) {
  const matrix = Array.from({ length: size }, () => Array(size).fill(false));
  const addFinder = (top, left) => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) matrix[top + y][left + x] = Boolean(FINDER[y][x]);
    }
  };

  addFinder(0, 0);
  addFinder(0, size - 7);
  addFinder(size - 7, 0);
  for (let offset = 8; offset < size - 8; offset++) {
    matrix[6][offset] = offset % 2 === 0;
    matrix[offset][6] = offset % 2 === 0;
  }
  matrix[size - 8][8] = true;
  return matrix;
}

function withQuietZone(matrix, size = 4) {
  const width = matrix.length + size * 2;
  const padded = Array.from({ length: width }, () => Array(width).fill(false));
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix.length; x++) padded[y + size][x + size] = matrix[y][x];
  }
  return padded;
}

function withFrame(matrix) {
  const size = matrix.length + 2;
  const framed = Array.from({ length: size }, () => Array(size).fill(true));
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix.length; x++) framed[y + 1][x + 1] = matrix[y][x];
  }
  return framed;
}

function withAsymmetricFrame(matrix) {
  const height = matrix.length + 2;
  const width = matrix.length + 3;
  const framed = Array.from({ length: height }, () => Array(width).fill(true));
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix.length; x++) framed[y + 2][x + 1] = matrix[y][x];
  }
  return framed;
}

function toTerminal(matrix) {
  const rows = matrix.length % 2 === 0
    ? matrix
    : [...matrix, Array(matrix[0].length).fill(false)];
  const lines = [];
  for (let y = 0; y < rows.length; y += 2) {
    lines.push(rows[y].map((top, x) => {
      const bottom = rows[y + 1][x];
      if (top && bottom) return '█';
      if (top) return '▀';
      if (bottom) return '▄';
      return ' ';
    }).join(''));
  }
  return lines.join('\n');
}

test('help arguments never trigger a preview build', () => {
  assert.deepEqual(parseCliArgs(['--help']), { showHelp: true });
  assert.deepEqual(parseCliArgs(['-h']), { showHelp: true });
});

test('combines both Zeus output streams before parsing', () => {
  assert.equal(combineProcessOutput({ stdout: 'build\n', stderr: 'qr\n' }), 'build\nqr\n');
});

test('quotes the complete device list as one Zeus argument', () => {
  assert.equal(
    previewCommand(['Amazfit Active', 'Amazfit Active 2 (Round)']),
    'zeus preview -s -t "Amazfit Active,Amazfit Active 2 (Round)"',
  );
});

test('parses a terminal QR wrapped in private ANSI cursor sequences', () => {
  const expected = structuralQr();
  const terminal = toTerminal(withQuietZone(expected))
    .split('\n')
    .map((line) => `\x1b[?25l${line}\x1b[?25h`)
    .join('\r\n');

  assert.deepEqual(normalizeQrMatrix(parseMatrix(terminal)), expected);
});

test('extracts the expiry reported by Zeus', () => {
  assert.equal(
    parsePreviewExpiry('[✔] This QR code will expire on 2026-09-08 19:30:00.'),
    '2026-09-08 19:30:00',
  );
});

test('normalizes terminal QR matrices with dark block modules', () => {
  const expected = structuralQr();
  assert.deepEqual(normalizeQrMatrix(withQuietZone(expected)), expected);
});

test('normalizes terminal QR matrices with inverted block modules', () => {
  const expected = structuralQr();
  const inverted = withQuietZone(expected).map((row) => row.map((value) => !value));
  assert.deepEqual(normalizeQrMatrix(inverted), expected);
});

test('removes the one-module framing layer emitted by Zeus', () => {
  const expected = structuralQr();
  assert.deepEqual(normalizeQrMatrix(withQuietZone(withFrame(expected))), expected);
});

test('finds a valid QR inside asymmetric terminal half-row padding', () => {
  const expected = structuralQr();
  assert.deepEqual(normalizeQrMatrix(withAsymmetricFrame(expected)), expected);
});
