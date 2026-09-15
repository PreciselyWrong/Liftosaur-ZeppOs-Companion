import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const packageJson = readJson('package.json');
const appJson = readJson('app.json');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const storeListing = fs.readFileSync(path.join(root, 'docs', 'store-listing.md'), 'utf8');

test('package and watch manifest share one numeric semantic version', () => {
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.equal(appJson.app.version.name, packageJson.version);
  assert.ok(Number.isInteger(appJson.app.version.code) && appJson.app.version.code > 0);
});

test('versions below 1.0.0 are beta builds', () => {
  assert.equal(Number(packageJson.version.split('.')[0]), 0);
  assert.equal(Object.hasOwn(packageJson, 'releaseStage'), false);
});

test('public version labels match the package version', () => {
  assert.match(readme, new RegExp(`\\*\\*Version:\\*\\* Lifto Companion ${packageJson.version.replaceAll('.', '\\.')}\\b`));
  assert.match(storeListing, new RegExp(`\\| Version \\| ${packageJson.version.replaceAll('.', '\\.')}[,|]`));
});

test('GitHub Releases are the only public release history', () => {
  assert.equal(fs.existsSync(path.join(root, 'CHANGELOG.md')), false);
  assert.match(readme, /Liftosaur-ZeppOs-Companion\/releases/);
});
