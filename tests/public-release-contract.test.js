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

test('gitleaks exemptions cover only reviewed historical test fixtures', () => {
  const entries = read('.gitleaksignore')
    .split(/\r?\n/)
    .filter(Boolean);

  assert.deepEqual(entries, [
    'd7fc2b35ac2cef7a8a0241e3d08e7d9792b61ed0:tests/liftosaur-api-client.test.js:generic-api-key:36',
    'd7fc2b35ac2cef7a8a0241e3d08e7d9792b61ed0:tests/liftosaur-api-client.test.js:generic-api-key:54',
    'c9aff143a955a418b8c294e24f28bc82d62c07f9:tests/liftosaur-workout-api-client.test.js:generic-api-key:30',
    'c9aff143a955a418b8c294e24f28bc82d62c07f9:tests/liftosaur-workout-api-client.test.js:generic-api-key:252',
    'c9aff143a955a418b8c294e24f28bc82d62c07f9:tests/liftosaur-workout-api-client.test.js:generic-api-key:258',
    'c9aff143a955a418b8c294e24f28bc82d62c07f9:tests/liftosaur-workout-api-client.test.js:generic-api-key:286',
  ]);
});

test('current API client tests use short non-secret sentinels', () => {
  const source = read('tests/liftosaur-workout-api-client.test.js');

  assert.doesNotMatch(source, /apiKey:\s*['"]lftsk_/);
});

test('program integration coverage uses an explicitly synthetic fixture', () => {
  assert.equal(fs.existsSync(path.join(root, 'tests', 'user-program.test.js')), false);

  const source = read('tests/synthetic-program.test.js');
  assert.match(source, /const SYNTHETIC_PROGRAM/);
  assert.doesNotMatch(source, /Semaine|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche/);
});

test('the README test badge matches the published test suite', () => {
  const testCount = fs
    .readdirSync(path.join(root, 'tests'))
    .filter((name) => name.endsWith('.test.js'))
    .reduce((total, name) => total + (read(path.join('tests', name)).match(/^\s*test\(/gm) || []).length, 0);
  const readme = read('README.md');

  assert.match(readme, new RegExp(`tests-${testCount}%20passing-brightgreen`));
});

test('published preview documentation carries the current Companion QR expiry', () => {
  const readme = read('README.md');
  const testerGuide = read('docs/tester-guide.md');

  for (const document of [readme, testerGuide]) {
    assert.match(document, /test-build-qr\.png/);
    assert.match(document, /2026-09-09 at 17:06:14 UTC/);
    assert.match(document, /19:06:14 (?:CEST|Central European Summer Time)/);
    assert.match(document, /Round/);
    assert.match(document, /Square/);
  }
});

test('the two public apps have tracked preview QR assets in the README', () => {
  const readme = read('README.md');

  for (const asset of ['docs/test-build-qr.png', 'docs/workout-extension-preview-qr.png']) {
    assert.equal(fs.existsSync(path.join(root, asset)), true, `${asset} must be tracked with the release`);
    assert.match(readme, new RegExp(asset.replace(/[./-]/g, '\\$&')));
  }
  assert.match(readme, /Lifto Companion/);
  assert.match(readme, /Lifto Workout/);
  assert.match(readme, /2026-09-09 at 17:06:37 UTC/);
  assert.match(readme, /19:06:37 CEST/);
});

test('published icon assets stay below the repository audit threshold', () => {
  for (const relativePath of ['assets/common.r/icon.png', 'assets/square.s/icon.png']) {
    assert.ok(fs.statSync(path.join(root, relativePath)).size <= 500 * 1024, `${relativePath} exceeds 500 KB`);
  }
});
