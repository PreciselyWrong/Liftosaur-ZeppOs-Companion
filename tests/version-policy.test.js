import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const packageJson = readJson('package.json');
const appJson = readJson('app.json');
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const storeListing = fs.readFileSync(path.join(root, 'docs', 'store-listing.md'), 'utf8');

test('package and watch manifest share one numeric semantic version', () => {
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.equal(appJson.app.version.name, packageJson.version);
  assert.ok(Number.isInteger(appJson.app.version.code) && appJson.app.version.code > 0);
});

test('beta builds stay below 1.0.0', () => {
  assert.equal(packageJson.releaseStage, 'beta');
  assert.equal(Number(packageJson.version.split('.')[0]), 0);
});

test('every released changelog entry stays below 1.0.0 during beta', () => {
  const versions = [...changelog.matchAll(/^## \[(\d+)\.(\d+)\.(\d+)\]/gm)];
  assert.ok(versions.length > 0);
  for (const [, major, minor, patch] of versions) {
    assert.equal(Number(major), 0, `release ${major}.${minor}.${patch} is not a beta version`);
  }
});

test('public version labels match the package version', () => {
  assert.match(readme, new RegExp(`\\*\\*Version:\\*\\* Lifto Companion ${packageJson.version.replaceAll('.', '\\.')}\\b`));
  assert.match(storeListing, new RegExp(`\\| Version \\| ${packageJson.version.replaceAll('.', '\\.')}[,|]`));
});
