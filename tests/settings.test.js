import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'setting', 'index.js'), 'utf8');
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

test('loads only the Liftosaur API key without creating duplicate timer settings', () => {
  const { state, writes } = loadSettings();

  assert.deepEqual(state, { apiKey: '' });
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
