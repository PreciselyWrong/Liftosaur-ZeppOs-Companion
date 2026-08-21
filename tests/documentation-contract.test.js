import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('documents that REST writes do not advance the Liftosaur phone day pointer', () => {
  const readme = read('README.md');
  const apiContract = read('docs/liftosaur-api.md');
  const architecture = read('docs/architecture.md');

  assert.match(readme, /phone app.*day pointer.*does not advance/is);
  assert.match(apiContract, /program\.nextDay.*not exposed.*REST API/is);
  assert.match(architecture, /history-based suggestion.*independent.*phone app.*day pointer/is);
});
