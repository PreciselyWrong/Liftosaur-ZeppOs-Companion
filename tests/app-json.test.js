/**
 * Guards the app.json invariants for the standalone Liftosaur mini program.
 * These are cheap to break by hand and expensive to notice on a watch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

const root = process.cwd();
const appJson = JSON.parse(
  fs.readFileSync(path.join(root, 'app.json'), 'utf8'),
);

const pages = appJson.targets.common.module.page.pages;

test('declares a standalone mini program', () => {
  assert.equal(appJson.app.appType, 'app');
  assert.equal(appJson.app.extType, undefined, 'extType must be absent - this is not a Workout Extension');
  assert.equal(appJson.configVersion, 'v3');
});

test('ships an English-only interface during beta', () => {
  assert.deepEqual(Object.keys(appJson.i18n), ['en-US']);
  assert.equal(appJson.defaultLanguage, 'en-US');
  assert.ok(!fs.existsSync(path.join(root, 'page', 'i18n', 'fr-FR.po')));
  assert.ok(!fs.existsSync(path.join(root, 'setting', 'i18n', 'fr-FR.po')));
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
    const entry = path.join(root, `${page}.js`);
    assert.ok(fs.existsSync(entry), `missing page entry ${entry}`);
  }
});

test('app-side entry point exists on disk', () => {
  const appSide = appJson.targets.common.module['app-side'];
  assert.ok(appSide && typeof appSide.path === 'string', 'missing app-side declaration');
  const entry = path.join(root, `${appSide.path}.js`);
  assert.ok(fs.existsSync(entry), `missing app-side entry ${entry}`);
});

test('setting entry point exists on disk', () => {
  const setting = appJson.targets.common.module['setting'];
  assert.ok(setting && typeof setting.path === 'string', 'missing setting declaration');
  const entry = path.join(root, `${setting.path}.js`);
  assert.ok(fs.existsSync(entry), `missing setting entry ${entry}`);
});

test('declares the device info permission the layout depends on', () => {
  // Without it `getDeviceInfo()` fails, the screen size is unknown, and every
  // square watch silently falls back to the round layout.
  assert.ok(
    appJson.permissions.includes('data:os.device.info'),
    'missing data:os.device.info - square screens will render as round',
  );
});

test('declares a round and a square target sharing the same modules', () => {
  const targets = appJson.targets;
  assert.deepEqual(
    Object.values(targets).flatMap((t) => t.platforms.map((p) => p.st)).sort(),
    ['r', 's'],
    'exactly one round and one square platform must be declared',
  );

  const common = JSON.stringify(targets.common.module);
  for (const [name, target] of Object.entries(targets)) {
    assert.equal(JSON.stringify(target.module), common, `target ${name} diverges from common`);
    assert.equal(target.designWidth, 480, `target ${name} must keep the 480 design canvas`);
  }
});

test('every target has its icon asset on disk', () => {
  for (const [name, target] of Object.entries(appJson.targets)) {
    for (const platform of target.platforms) {
      const dir = path.join(root, 'assets', `${name}.${platform.st}`);
      assert.ok(
        fs.existsSync(path.join(dir, appJson.app.icon)),
        `missing ${appJson.app.icon} in assets/${name}.${platform.st}`,
      );
    }
  }
});

test('no secret-looking value is committed in app.json', () => {

  const raw = JSON.stringify(appJson);
  assert.ok(!/lftsk_/.test(raw), 'app.json contains a Liftosaur API key');
  assert.ok(!/Bearer\s/i.test(raw), 'app.json contains an Authorization value');
});
