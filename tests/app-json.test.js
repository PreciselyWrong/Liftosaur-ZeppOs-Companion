/**
 * Guards the app.json invariants for the standalone Liftosaur mini program.
 * These are cheap to break by hand and expensive to notice on a watch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

const appJson = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '..', 'app.json'), 'utf8'),
);

const pages = appJson.targets.common.module.page.pages;

test('declares a standalone mini program', () => {
  assert.equal(appJson.app.appType, 'app');
  assert.equal(appJson.app.extType, undefined, 'extType must be absent - this is not a Workout Extension');
  assert.equal(appJson.configVersion, 'v3');
});

test('carries the registered appId, not the template placeholder', () => {
  assert.equal(typeof appJson.app.appId, 'number');
  assert.notEqual(appJson.app.appId, 26440);
});

test('targets API_LEVEL 3.6 or above', () => {
  const { minVersion } = appJson.runtime.apiVersion;
  assert.ok(
    parseFloat(minVersion) >= 3.6,
    `minVersion ${minVersion} is below 3.6`,
  );
});

test('declares at least one page', () => {
  assert.ok(Array.isArray(pages) && pages.length >= 1);
});

test('every page entry point exists on disk', () => {
  for (const page of pages) {
    const entry = path.join(import.meta.dirname, '..', `${page}.js`);
    assert.ok(fs.existsSync(entry), `missing page entry ${entry}`);
  }
});

test('app-side entry point exists on disk', () => {
  const appSide = appJson.targets.common.module['app-side'];
  assert.ok(appSide && typeof appSide.path === 'string', 'missing app-side declaration');
  const entry = path.join(import.meta.dirname, '..', `${appSide.path}.js`);
  assert.ok(fs.existsSync(entry), `missing app-side entry ${entry}`);
});

test('setting entry point exists on disk', () => {
  const setting = appJson.targets.common.module['setting'];
  assert.ok(setting && typeof setting.path === 'string', 'missing setting declaration');
  const entry = path.join(import.meta.dirname, '..', `${setting.path}.js`);
  assert.ok(fs.existsSync(entry), `missing setting entry ${entry}`);
});

test('no secret-looking value is committed in app.json', () => {

  const raw = JSON.stringify(appJson);
  assert.ok(!/lftsk_/.test(raw), 'app.json contains a Liftosaur API key');
  assert.ok(!/Bearer\s/i.test(raw), 'app.json contains an Authorization value');
});
