import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeGetReadySeconds } from '../shared/timed-settings.js';
import { normalizeExerciseImages } from '../shared/exercise-images.js';
import { normalizeAutoPrepare } from '../shared/auto-prepare.js';
import { WORKOUT_DIAGNOSTICS_KEY, WORKOUT_DIAGNOSTICS_ENABLED_KEY, WORKOUT_DIAGNOSTIC_CODES, formatWorkoutDiagnostics, normalizeWorkoutDiagnosticsEnabled } from '../shared/workout-diagnostics.js';

const source = fs.readFileSync(path.join(process.cwd(), 'setting', 'index.js'), 'utf8');
const appSideSource = fs.readFileSync(path.join(process.cwd(), 'app-side', 'index.js'), 'utf8');
let settingsPage;
const component = (type) => (props, ...children) => ({ type, props, children });
new Function(
  'AppSettingsPage',
  'normalizeGetReadySeconds',
  'normalizeExerciseImages',
  'normalizeAutoPrepare',
  'WORKOUT_DIAGNOSTICS_KEY',
  'WORKOUT_DIAGNOSTICS_ENABLED_KEY',
  'formatWorkoutDiagnostics',
  'normalizeWorkoutDiagnosticsEnabled',
  'View',
  'Text',
  'TextInput',
  'Button',
  'Select',
  'Toggle',
  source.replace(/^import .*;\r?\n/gm, ''),
)(
  (definition) => { settingsPage = definition; },
  normalizeGetReadySeconds,
  normalizeExerciseImages,
  normalizeAutoPrepare,
  WORKOUT_DIAGNOSTICS_KEY,
  WORKOUT_DIAGNOSTICS_ENABLED_KEY,
  formatWorkoutDiagnostics,
  normalizeWorkoutDiagnosticsEnabled,
  component('View'),
  component('Text'),
  component('TextInput'),
  component('Button'),
  component('Select'),
  component('Toggle'),
);

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

function renderSettings(initial = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  const props = {
    settingsStorage: {
      getItem: (key) => values.get(key),
      setItem: (key, value) => {
        values.set(key, value);
        writes.push([key, value]);
      },
      removeItem: (key) => values.delete(key),
    },
  };
  const context = { state: {}, getStorage: settingsPage.getStorage };
  const tree = settingsPage.build.call(context, props);
  const selects = [];
  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.type === 'Select') selects.push(node);
    visit(node.children);
  };
  visit(tree);
  return { tree, selects, writes, values };
}

test('loads Liftosaur API key and screen-on duration default 120 without writing to storage', () => {
  const { state, writes } = loadSettings();

  assert.deepEqual(state, { apiKey: '', screenOnDuration: 120, getReadySeconds: 5, exerciseImages: false, autoPrepare: false, workoutDiagnosticsEnabled: false });
  assert.deepEqual(writes, []);
});

test('exercise images are opt-in and preserve the saved preference', () => {
  assert.equal(loadSettings({ exerciseImages: 'true' }).state.exerciseImages, true);
  assert.equal(loadSettings({ exerciseImages: 'false' }).state.exerciseImages, false);
});

test('Auto prepare is opt-in, persists On and Off, and explains its behavior', () => {
  assert.equal(loadSettings().state.autoPrepare, false);
  assert.equal(loadSettings({ autoPrepare: 'true' }).state.autoPrepare, true);

  const rendered = renderSettings();
  const toggles = [];
  const text = [];
  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.type === 'Toggle') toggles.push(node);
    if (node.type === 'Text') text.push(...node.children.filter((value) => typeof value === 'string'));
    visit(node.children);
  };
  visit(rendered.tree);

  const autoPrepare = toggles.find(({ props }) => props.label === 'Auto prepare');
  assert.ok(autoPrepare);
  assert.equal(autoPrepare.props.value, false);
  assert.ok(text.includes('Open the next set while rest runs.'));

  autoPrepare.props.onChange(true);
  autoPrepare.props.onChange(false);
  assert.deepEqual(rendered.writes.slice(-2), [['autoPrepare', 'true'], ['autoPrepare', 'false']]);
});

test('every dropdown shows its current choice and persists a string value', () => {
  const { selects, writes } = renderSettings();

  assert.deepEqual(selects.map(({ props }) => props.value), ['5', 'false', '120']);
  assert.deepEqual(selects.map(({ props }) => props.options.length), [4, 2, 4]);
  assert.deepEqual(selects.map(({ props }) => props.label), [
    'Ready countdown: 5 sec',
    'Exercise images: Off',
    'Screen timeout: 120 sec',
  ]);
  assert.deepEqual(selects.map(({ props }) => props.title), [undefined, undefined, undefined]);

  selects[0].props.onChange('10');
  selects[1].props.onChange('true');
  selects[2].props.onChange('always');
  assert.deepEqual(writes, [
    ['getReadySeconds', '10'],
    ['exerciseImages', 'true'],
    ['screenOnDuration', 'always'],
  ]);
});

test('the settings page is three coherent cards with centered headings and compact controls', () => {
  const { tree } = renderSettings();
  const cardStyle = source.slice(source.indexOf('const CARD_STYLE'), source.indexOf('function settingsHeading'));

  assert.equal(tree.children[0].length, 3);
  assert.match(cardStyle, /display:\s*'flex'/);
  assert.match(cardStyle, /flexDirection:\s*'column'/);
  assert.match(source, /'Lifto Companion'/);
  assert.match(source, /'Workout settings'/);
  assert.match(source, /'Account help'/);
  assert.match(source, /alignItems:\s*'center'[\s\S]*?textAlign:\s*'center'/);
  assert.doesNotMatch(source, /title:\s*'Get ready countdown'/);
  assert.doesNotMatch(source, /Exercise images \(List \+ Info \+ Prepare\)/);
  assert.doesNotMatch(source, /'REST TIMERS'|'WORKOUT DISPLAY'|'API KEY'/);
});

test('phone settings show watch diagnostic steps only after a sanitized report arrives', () => {
  const report = JSON.stringify({
    version: 1,
    events: [{ at: 1_000, code: WORKOUT_DIAGNOSTIC_CODES.SET_TAP }],
  });
  const { tree } = renderSettings({ [WORKOUT_DIAGNOSTICS_ENABLED_KEY]: 'true', [WORKOUT_DIAGNOSTICS_KEY]: report });
  const text = [];
  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.type === 'Text') text.push(...node.children.filter((value) => typeof value === 'string'));
    visit(node.children);
  };
  visit(tree);
  assert.equal(tree.children[0].length, 4);
  assert.ok(text.includes('Watch diagnostics'));
  assert.ok(text.includes('1970-01-01T00:00:01.000Z SET_TAP'));
});

test('watch diagnostics require an explicit phone toggle and clear the report when disabled', () => {
  assert.equal(loadSettings().state.workoutDiagnosticsEnabled, false);
  const initial = renderSettings();
  const toggles = [];
  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.type === 'Toggle') toggles.push(node);
    visit(node.children);
  };
  visit(initial.tree);
  const diagnosticsToggle = toggles.find(({ props }) => props.label === 'Record watch diagnostics');
  assert.ok(diagnosticsToggle);
  assert.equal(diagnosticsToggle.props.value, false);
  diagnosticsToggle.props.onChange(true);
  assert.deepEqual(initial.writes, [[WORKOUT_DIAGNOSTICS_ENABLED_KEY, 'true']]);
  const enabled = renderSettings({ [WORKOUT_DIAGNOSTICS_ENABLED_KEY]: 'true', [WORKOUT_DIAGNOSTICS_KEY]: 'saved' });
  const enabledToggles = [];
  const collect = (node) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(collect);
    if (node.type === 'Toggle') enabledToggles.push(node);
    collect(node.children);
  };
  collect(enabled.tree);
  const enabledDiagnostics = enabledToggles.find(({ props }) => props.label === 'Record watch diagnostics');
  assert.equal(enabledDiagnostics.props.value, true);
  enabledDiagnostics.props.onChange(false);
  assert.deepEqual(enabled.writes, [[WORKOUT_DIAGNOSTICS_ENABLED_KEY, 'false']]);
  assert.equal(enabled.values.has(WORKOUT_DIAGNOSTICS_KEY), false);
});

test('account status uses separate centered lines instead of ignored newline characters', () => {
  const statusStyle = source.slice(source.indexOf('const STATUS_STYLE'), source.indexOf('function settingsHeading'));

  assert.match(statusStyle, /flexDirection:\s*'column'/);
  assert.match(source, /hasKey \? 'Connected to Liftosaur' : 'Demo mode'/);
  assert.match(source, /hasKey \? maskedKey : 'Add an API key to sync your workouts\.'/);
  assert.doesNotMatch(source, /Demo mode\\n|Liftosaur\\n/);
});

test('the Side Service defaults exercise images off even in demo mode', () => {
  assert.match(appSideSource, /let exerciseImages = false/);
  assert.match(appSideSource, /normalizeExerciseImages\(storage\.getItem\('exerciseImages'\)\)/);
});

test('the Side Service defaults Auto prepare off and reads the phone preference', () => {
  assert.match(appSideSource, /let autoPrepare = false/);
  assert.match(appSideSource, /normalizeAutoPrepare\(storage\.getItem\('autoPrepare'\)\)/);
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
