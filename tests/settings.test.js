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

test('prefills missing rest timer settings with persisted defaults', () => {
  const { state, writes } = loadSettings();

  assert.equal(state.defaultStandardRest, '120');
  assert.equal(state.defaultWarmupRest, '60');
  assert.equal(state.defaultSupersetRest, '90');
  assert.deepEqual(writes, [
    ['defaultStandardRest', '120'],
    ['defaultWarmupRest', '60'],
    ['defaultSupersetRest', '90'],
  ]);
});

test('keeps saved rest timer settings including Off', () => {
  const { state, writes } = loadSettings({
    defaultStandardRest: '180',
    defaultWarmupRest: '0',
    defaultSupersetRest: '30',
  });

  assert.equal(state.defaultStandardRest, '180');
  assert.equal(state.defaultWarmupRest, '0');
  assert.equal(state.defaultSupersetRest, '30');
  assert.deepEqual(writes, []);
});
