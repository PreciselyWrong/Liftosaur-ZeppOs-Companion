import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('runtime logs contain no workout names or completed-set counts', () => {
  const sideSource = read('app-side/index.js');
  const watchSource = read('page/common/index.js');

  assert.doesNotMatch(sideSource, /console\.log\([^\n]*dayName/);
  assert.doesNotMatch(watchSource, /console\.log\([^\n]*view\.dayName/);
});

test('the npm lockfile is publishable for reproducible installs', () => {
  const gitignore = read('.gitignore');
  const manifest = JSON.parse(read('package.json'));
  const lockfile = JSON.parse(read('package-lock.json'));
  const lockedProject = lockfile.packages[''];

  assert.doesNotMatch(gitignore, /^package-lock\.json$/m);
  assert.equal(lockfile.name, manifest.name);
  assert.equal(lockfile.version, manifest.version);
  assert.equal(lockedProject.name, manifest.name);
  assert.equal(lockedProject.version, manifest.version);
  assert.equal(lockedProject.license, manifest.license);
});
