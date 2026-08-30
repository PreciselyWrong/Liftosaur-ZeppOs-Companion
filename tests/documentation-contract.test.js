import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('documents the shared pointer and the isolated legacy recovery limit', () => {
  const readme = read('README.md');
  const apiContract = read('docs/liftosaur-api.md');
  const architecture = read('docs/architecture.md');

  assert.match(readme, /Running a Workout API.*phone pointer advances automatically/is);
  assert.match(apiContract, /legacy raw REST API.*program\.nextDay.*not exposed/is);
  assert.match(architecture, /legacy v1 REST flow.*independent.*phone app day pointer.*Running a Workout API.*advances/is);
});

test('published capability evidence contains no personal Zepp account identifier', () => {
  const capabilities = read('docs/zepp-capabilities.md');

  assert.match(capabilities, /\| `zeus login` \| logged in \| TESTED \|/);
  assert.doesNotMatch(capabilities, /userID\s+\d+/i);
});
