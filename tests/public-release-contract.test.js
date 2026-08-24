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

test('gitleaks exemptions cover only the two reviewed historical test fixtures', () => {
  const entries = read('.gitleaksignore')
    .split(/\r?\n/)
    .filter(Boolean);

  assert.deepEqual(entries, [
    'fd22091c9cdccb45f5b26f511d05dfeff7346bbe:tests/liftosaur-api-client.test.js:generic-api-key:36',
    'fd22091c9cdccb45f5b26f511d05dfeff7346bbe:tests/liftosaur-api-client.test.js:generic-api-key:54',
  ]);
});

test('the README test badge matches the published test suite', () => {
  const testCount = fs
    .readdirSync(path.join(root, 'tests'))
    .filter((name) => name.endsWith('.test.js'))
    .reduce((total, name) => total + (read(path.join('tests', name)).match(/^test\(/gm) || []).length, 0);
  const readme = read('README.md');

  assert.match(readme, new RegExp(`tests-${testCount}%20passing-brightgreen`));
});

test('published icon assets stay below the repository audit threshold', () => {
  for (const relativePath of ['assets/common.r/icon.png', 'assets/square.s/icon.png']) {
    assert.ok(fs.statSync(path.join(root, relativePath)).size <= 500 * 1024, `${relativePath} exceeds 500 KB`);
  }
});
