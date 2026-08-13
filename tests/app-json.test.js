/**
 * Guards the app.json invariants that the Workout Extension depends on.
 * These are cheap to break by hand and expensive to notice on a watch.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const appJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'),
);

const widgets = appJson.targets.common.module['data-widget'].widgets;

test('declares a workout extension', () => {
  assert.equal(appJson.app.appType, 'app');
  assert.equal(appJson.app.extType, 'workout');
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
    `minVersion ${minVersion} is below the 3.6 required by Workout Extensions`,
  );
});

test('declares exactly one widget, as the platform requires', () => {
  assert.equal(widgets.length, 1);
});

test('the widget is a workout extension ability', () => {
  const abilities = widgets[0].runtime.ability;
  assert.equal(abilities.length, 1);
  assert.equal(abilities[0].type, 1);
  assert.ok(Array.isArray(abilities[0].subType));
});

test('the widget entry point exists on disk', () => {
  const entry = path.join(__dirname, '..', `${widgets[0].path}.js`);
  assert.ok(fs.existsSync(entry), `missing widget entry ${entry}`);
});

test('every locale names the widget', () => {
  for (const [locale, block] of Object.entries(appJson.i18n)) {
    const name = block['data-widget'].widgets[0].name;
    assert.ok(name && name.length > 0, `locale ${locale} has no widget name`);
  }
});

test('no secret-looking value is committed in app.json', () => {
  const raw = JSON.stringify(appJson);
  assert.ok(!/lftsk_/.test(raw), 'app.json contains a Liftosaur API key');
  assert.ok(!/Bearer\s/i.test(raw), 'app.json contains an Authorization value');
});
