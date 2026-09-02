import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'setting', 'index.js'), 'utf8');
const appSideSource = fs.readFileSync(path.join(process.cwd(), 'app-side', 'index.js'), 'utf8');
let settingsPage;
new Function('AppSettingsPage', source)((definition) => {
  settingsPage = definition;
});

function loadSettings(initial = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  const context = { state: {} };
  const props = {
    settingsStorage: {
      getItem: (key) => values.get(key),
      setItem: (key, value) => {
        values.set(key, value);
        writes.push([key, value]);
      },
    },
  };

  settingsPage.getStorage.call(context, props);
  return { state: context.state, writes };
}

test('loads Liftosaur API key and screen-on duration default 120 without writing to storage', () => {
  const { state, writes } = loadSettings();

  assert.deepEqual(state, { apiKey: '', screenOnDuration: 120 });
  assert.deepEqual(writes, []);
});

test('the settings page explains that Liftosaur owns rest defaults', () => {
  assert.match(source, /Rest timers follow your Liftosaur settings/);
  assert.doesNotMatch(source, /defaultStandardRest|defaultWarmupRest|defaultSupersetRest/);
});

test('keeps a stored API key without writing it during load', () => {
  const { state, writes } = loadSettings({ apiKey: 'lftsk_example' });
  assert.equal(state.apiKey, 'lftsk_example');
  assert.deepEqual(writes, []);
});

test('loads and preserves allowed screen-on duration settings without writing during load', () => {
  for (const allowed of [60, 120, 240, 'always']) {
    const { state, writes } = loadSettings({ screenOnDuration: allowed });
    assert.equal(state.screenOnDuration, allowed);
    assert.deepEqual(writes, []);
  }
});

test('the settings page configures screen-on duration options 60, 120, 240 and always', () => {
  assert.match(source, /screenOnDuration/);
  assert.match(source, /60/);
  assert.match(source, /120/);
  assert.match(source, /240/);
  assert.match(source, /always/i);
});

test('the Side Service keeps screen-on local but never reads local timer settings', () => {
  assert.match(appSideSource, /screenOnDuration/);
  assert.doesNotMatch(appSideSource, /defaultStandardRest|defaultWarmupRest|defaultSupersetRest/);
});
