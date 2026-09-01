import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconPaths = ['assets/common.r/icon.png', 'assets/square.s/icon.png'];

function readRgbaPng(relativePath) {
  const png = fs.readFileSync(path.join(root, relativePath));
  let offset = 8;
  let width;
  let height;
  const compressed = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, `${relativePath} must use 8-bit channels`);
      assert.equal(data[9], 6, `${relativePath} must use RGBA pixels`);
    } else if (type === 'IDAT') {
      compressed.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const stride = width * 4;
  const filtered = inflateSync(Buffer.concat(compressed));
  const pixels = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const sourceOffset = y * (stride + 1);
    const filter = filtered[sourceOffset];
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[sourceOffset + x + 1];
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const above = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
      let value;

      if (filter === 0) value = raw;
      else if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + above;
      else if (filter === 3) value = raw + Math.floor((left + above) / 2);
      else if (filter === 4) {
        const prediction = left + above - upperLeft;
        const leftDistance = Math.abs(prediction - left);
        const aboveDistance = Math.abs(prediction - above);
        const upperLeftDistance = Math.abs(prediction - upperLeft);
        const predictor = leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
          ? left
          : aboveDistance <= upperLeftDistance ? above : upperLeft;
        value = raw + predictor;
      } else {
        throw new Error(`${relativePath} uses unsupported PNG filter ${filter}`);
      }

      pixels[y * stride + x] = value & 0xff;
    }
  }

  return { width, height, alphaAt: (x, y) => pixels[y * stride + x * 4 + 3] };
}

test('application icons use the Zepp circular silhouette and safety border', () => {
  for (const relativePath of iconPaths) {
    const icon = readRgbaPng(relativePath);
    assert.deepEqual([icon.width, icon.height], [248, 248]);
    assert.equal(icon.alphaAt(0, 0), 0);
    assert.equal(icon.alphaAt(124, 0), 0);
    assert.ok(icon.alphaAt(124, 4) > 0);
    assert.ok(icon.alphaAt(124, 124) > 0);
  }
});
