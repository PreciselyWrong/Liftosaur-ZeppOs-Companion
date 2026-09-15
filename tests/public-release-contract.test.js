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

test('the README reports live CI status instead of a hard-coded test count', () => {
  const readme = read('README.md');

  assert.match(readme, /actions\/workflows\/ci\.yml\/badge\.svg/);
  assert.doesNotMatch(readme, /badge\/tests-[0-9]+/);
});

test('public documentation sends testers to GitHub releases for fresh QR codes', () => {
  const readme = read('README.md');
  const testerGuide = read('docs/tester-guide.md');

  for (const document of [readme, testerGuide]) {
    assert.match(document, /github\.com\/PreciselyWrong\/Liftosaur-ZeppOs-Companion\/releases/);
    assert.doesNotMatch(document, /docs\/test-build-qr\.png|test-build-qr\.png/);
    assert.doesNotMatch(document, /2026-09-18/);
  }
});

test('expiring preview QR assets are not committed to the repository', () => {
  const readme = read('README.md');

  for (const asset of ['docs/test-build-qr.png', 'docs/workout-extension-preview-qr.png']) {
    assert.equal(fs.existsSync(path.join(root, asset)), false, `${asset} belongs in a GitHub release`);
    assert.doesNotMatch(readme, new RegExp(asset.replace(/[./-]/g, '\\$&')));
  }
  assert.match(readme, /Lifto Companion/);
  assert.match(readme, /Lifto Workout/);
});

test('published icon assets stay below the repository audit threshold', () => {
  for (const relativePath of ['assets/common.r/icon.png', 'assets/square.s/icon.png']) {
    assert.ok(fs.statSync(path.join(root, relativePath)).size <= 500 * 1024, `${relativePath} exceeds 500 KB`);
  }
});

test('the production tree contains no abandoned phase-zero prototype', () => {
  assert.equal(fs.existsSync(path.join(root, 'page', 'common', 'state.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'tests', 'widget-state.test.js')), false);
});

test('the production tree contains only the maintained preview QR builder', () => {
  assert.equal(fs.existsSync(path.join(root, 'tools', 'qr-ascii-to-png.mjs')), false);
});
