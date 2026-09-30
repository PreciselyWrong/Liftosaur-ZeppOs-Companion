import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeGetReadySeconds } from '../shared/timed-settings.js';
import { normalizeExerciseImages } from '../shared/exercise-images.js';
import { normalizeAutoPrepare } from '../shared/auto-prepare.js';
import { normalizeWorkoutDisplaySettings } from '../shared/workout-display-settings.js';
import { WORKOUT_DIAGNOSTICS_KEY, WORKOUT_DIAGNOSTICS_ENABLED_KEY, WORKOUT_DIAGNOSTICS_EMPTY, WORKOUT_DIAGNOSTIC_CODES, formatWorkoutDiagnostics, normalizeWorkoutDiagnosticsEnabled } from '../shared/workout-diagnostics.js';

const source = fs.readFileSync(path.join(process.cwd(), 'setting', 'index.js'), 'utf8');
const appSideSource = fs.readFileSync(path.join(process.cwd(), 'app-side', 'index.js'), 'utf8');
let settingsPage;
const component = (type) => (props, ...children) => ({ type, props, children });
new Function(
  'AppSettingsPage',
  'normalizeGetReadySeconds',
  'normalizeExerciseImages',
  'normalizeAutoPrepare',
  'normalizeWorkoutDisplaySettings',
  'WORKOUT_DIAGNOSTICS_KEY',
  'WORKOUT_DIAGNOSTICS_ENABLED_KEY',
  'WORKOUT_DIAGNOSTICS_EMPTY',
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
  normalizeWorkoutDisplaySettings,
  WORKOUT_DIAGNOSTICS_KEY,
  WORKOUT_DIAGNOSTICS_ENABLED_KEY,
  WORKOUT_DIAGNOSTICS_EMPTY,
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
  return { tree, selects: collect(tree, 'Select'), writes, values };
}

function collect(tree, type) {
  const found = [];
  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.type === type) found.push(node);
    visit(node.children);
  };
  visit(tree);
  return found;
}

const texts = (tree) => collect(tree, 'Text').flatMap(({ children }) => children.filter((value) => typeof value === 'string'));
const toggle = (tree, label) => collect(tree, 'Toggle').find(({ props }) => props.label === label);
const sections = (tree) => tree.children[0].map((card) => card.children[0]);
const CONTROL_TYPES = ['Toggle', 'Select', 'TextInput', 'Button'];
const YES_NO_SETTINGS = [
  ['Auto prepare', 'autoPrepare', 'autoPrepare'],
  ['Exercise images', 'exerciseImages', 'exerciseImages'],
  ['Workout progress', 'showWorkoutProgress', 'showWorkoutProgress'],
  ['Plate breakdown', 'showPlateBreakdown', 'showPlateBreakdown'],
  ['Rest Info button', 'showRestInfo', 'showRestInfo'],
  ['Record watch diagnostics', 'workoutDiagnosticsEnabled', WORKOUT_DIAGNOSTICS_ENABLED_KEY],
];

test('loads Liftosaur API key and screen-on duration default 120 without writing to storage', () => {
  const { state, writes } = loadSettings();

  assert.deepEqual(state, { apiKey: '', screenOnDuration: 120, getReadySeconds: 5, exerciseImages: false, autoPrepare: false, workoutDiagnosticsEnabled: false,
    showWorkoutProgress: false, showPlateBreakdown: true, showRestInfo: true });
  assert.deepEqual(writes, []);
});

test('exercise images are opt-in and preserve the saved preference', () => {
  assert.equal(loadSettings({ exerciseImages: 'true' }).state.exerciseImages, true);
  assert.equal(loadSettings({ exerciseImages: 'false' }).state.exerciseImages, false);
});

test('every yes/no setting is a Toggle and only multi-value settings are dropdowns', () => {
  const { tree, selects } = renderSettings();

  assert.deepEqual(collect(tree, 'Toggle').map(({ props }) => props.label), YES_NO_SETTINGS.map(([label]) => label));
  for (const { props } of selects) assert.ok(props.options.length > 2, props.label);
  for (const [label, stateKey] of YES_NO_SETTINGS) {
    assert.equal(typeof toggle(tree, label).props.value, 'boolean', label);
    assert.equal(toggle(tree, label).props.value, loadSettings().state[stateKey], label);
  }
});

test('every Toggle saves the same true or false string its readers already understand', () => {
  for (const [label, stateKey, storageKey] of YES_NO_SETTINGS) {
    for (const enabled of [true, false]) {
      const { tree, writes } = renderSettings({ [storageKey]: String(!enabled) });
      toggle(tree, label).props.onChange(enabled);
      assert.deepEqual(writes, [[storageKey, String(enabled)]], label);
      assert.equal(loadSettings({ [storageKey]: String(enabled) }).state[stateKey], enabled, label);
    }
  }
});

test('Exercise images keeps the value saved by the former On/Off dropdown', () => {
  // The dropdown saved 'true' or 'false'; its first release saved the raw boolean.
  for (const [stored, enabled] of [[undefined, false], ['false', false], ['true', true], [false, false], [true, true]]) {
    const { tree } = renderSettings(stored === undefined ? {} : { exerciseImages: stored });
    assert.equal(toggle(tree, 'Exercise images').props.value, enabled, String(stored));
  }

  const { tree, writes } = renderSettings({ exerciseImages: 'false' });
  toggle(tree, 'Exercise images').props.onChange(true);
  toggle(tree, 'Exercise images').props.onChange(false);
  assert.deepEqual(writes, [['exerciseImages', 'true'], ['exerciseImages', 'false']]);
  assert.deepEqual(writes.map(([, value]) => normalizeExerciseImages(value)), [true, false]);
});

test('Workout display switches preserve defaults and save each independent choice', () => {
  const initial = renderSettings();
  for (const [label, key, initialValue, nextValue] of [
    ['Workout progress', 'showWorkoutProgress', false, true],
    ['Plate breakdown', 'showPlateBreakdown', true, false],
    ['Rest Info button', 'showRestInfo', true, false],
  ]) {
    const control = toggle(initial.tree, label);
    assert.ok(control, label);
    assert.equal(control.props.value, initialValue);
    control.props.onChange(nextValue);
    assert.deepEqual(initial.writes.at(-1), [key, String(nextValue)]);
    assert.equal(loadSettings({ [key]: String(nextValue) }).state[key], nextValue);
  }
});

test('Auto prepare is opt-in, persists On and Off, and explains its behavior', () => {
  assert.equal(loadSettings().state.autoPrepare, false);
  assert.equal(loadSettings({ autoPrepare: 'true' }).state.autoPrepare, true);

  const rendered = renderSettings();
  const autoPrepare = toggle(rendered.tree, 'Auto prepare');
  assert.ok(autoPrepare);
  assert.equal(autoPrepare.props.value, false);
  assert.ok(texts(rendered.tree).includes('Open the next set while rest runs.'));

  autoPrepare.props.onChange(true);
  autoPrepare.props.onChange(false);
  assert.deepEqual(rendered.writes.slice(-2), [['autoPrepare', 'true'], ['autoPrepare', 'false']]);
});

test('every dropdown shows its current choice and persists a string value', () => {
  const { selects, writes } = renderSettings();

  assert.deepEqual(selects.map(({ props }) => props.value), ['5', '120']);
  assert.deepEqual(selects.map(({ props }) => props.options.length), [4, 4]);
  assert.deepEqual(selects.map(({ props }) => props.label), [
    'Ready countdown: 5 sec',
    'Screen timeout: 120 sec',
  ]);
  assert.deepEqual(selects.map(({ props }) => props.title), [undefined, undefined]);

  selects[0].props.onChange('10');
  selects[1].props.onChange('always');
  assert.deepEqual(writes, [
    ['getReadySeconds', '10'],
    ['screenOnDuration', 'always'],
  ]);
});

test('settings are grouped in topic sections, most used first', () => {
  const layout = (tree) => sections(tree).map(([title, ...children]) => [
    title.children[0],
    children.filter(({ type }) => CONTROL_TYPES.includes(type)).map(({ props }) => props.label).join(', '),
  ]);

  assert.deepEqual(layout(renderSettings().tree), [
    ['Connection', 'Liftosaur API key, Save key'],
    ['Sets and rest', 'Auto prepare, Ready countdown: 5 sec'],
    ['Workout display', 'Screen timeout: 120 sec, Exercise images, Workout progress, Plate breakdown, Rest Info button'],
    ['Diagnostics', 'Record watch diagnostics'],
    ['Help', ''],
  ]);
  assert.deepEqual(layout(renderSettings({
    apiKey: 'lftsk_example_key',
    [WORKOUT_DIAGNOSTICS_ENABLED_KEY]: 'true',
    [WORKOUT_DIAGNOSTICS_KEY]: JSON.stringify({ version: 1, events: [{ at: 1_000, code: WORKOUT_DIAGNOSTIC_CODES.SET_TAP }] }),
  }).tree), [
    ['Connection', 'Liftosaur API key, Save key, Disconnect'],
    ['Sets and rest', 'Auto prepare, Ready countdown: 5 sec'],
    ['Workout display', 'Screen timeout: 120 sec, Exercise images, Workout progress, Plate breakdown, Rest Info button'],
    ['Diagnostics', 'Record watch diagnostics, Select and copy logs'],
    ['Help', ''],
  ]);
});

test('each explained control has one identically styled helper right below it', () => {
  const { tree } = renderSettings({
    [WORKOUT_DIAGNOSTICS_ENABLED_KEY]: 'true',
    [WORKOUT_DIAGNOSTICS_KEY]: JSON.stringify({ version: 1, events: [{ at: 1_000, code: WORKOUT_DIAGNOSTIC_CODES.SET_TAP }] }),
  });
  const helpers = new Map([
    ['Liftosaur API key', null],
    ['Save key', null],
    ['Auto prepare', 'Open the next set while rest runs.'],
    ['Ready countdown: 5 sec', 'Counts down before a timed set starts.'],
    ['Screen timeout: 120 sec', null],
    ['Exercise images', 'Show pictures in the list, Info and Prepare.'],
    ['Workout progress', 'Show completed sets at the top of the watch.'],
    ['Plate breakdown', 'Show plates during rest and while editing a set.'],
    ['Rest Info button', 'Keep exercise details available from the rest preview.'],
    ['Record watch diagnostics', 'Open this Lifto app on the watch to apply the change.'],
    ['Select and copy logs', 'Open the field, then long-press, Select all and Copy.'],
  ]);
  const helperStyles = [];
  for (const children of sections(tree)) {
    children.forEach((node, index) => {
      if (!CONTROL_TYPES.includes(node.type)) return;
      assert.ok(helpers.has(node.props.label), node.props.label);
      const next = children[index + 1];
      const helper = helpers.get(node.props.label);
      if (!helper) {
        assert.ok(!next || CONTROL_TYPES.includes(next.type), `${node.props.label} needs no helper`);
        return;
      }
      assert.equal(next.type, 'Text', node.props.label);
      assert.deepEqual(next.children, [helper]);
      helperStyles.push(next.props);
    });
  }

  assert.equal(helperStyles.length, [...helpers.values()].filter(Boolean).length);
  for (const style of helperStyles) assert.deepEqual(style, helperStyles[0]);
  const [apiKey, copyLogs] = collect(tree, 'TextInput');
  assert.deepEqual(copyLogs.props.labelStyle, apiKey.props.labelStyle);
});

test('the rest timer note explains its section instead of floating between controls', () => {
  const [, setsAndRest] = sections(renderSettings().tree);

  assert.equal(setsAndRest[0].children[0], 'Sets and rest');
  assert.deepEqual(setsAndRest[1].children, ['Rest timers follow your Liftosaur settings.']);
  assert.equal(CONTROL_TYPES.includes(setsAndRest[2].type), true);
});

test('the settings page uses flex column cards with centered section titles', () => {
  const cardStyle = source.slice(source.indexOf('const CARD_STYLE'), source.indexOf('};', source.indexOf('const CARD_STYLE')));

  assert.match(cardStyle, /display:\s*'flex'/);
  assert.match(cardStyle, /flexDirection:\s*'column'/);
  for (const [title] of sections(renderSettings().tree)) {
    assert.equal(title.type, 'Text');
    assert.equal(title.props.style.textAlign, 'center');
  }
  assert.doesNotMatch(source, /'Lifto Companion'|'Workout settings'|'Account help'/);
  assert.doesNotMatch(source, /title:\s*'Get ready countdown'/);
  assert.doesNotMatch(source, /Exercise images \(List \+ Info \+ Prepare\)/);
  assert.doesNotMatch(source, /'REST TIMERS'|'WORKOUT DISPLAY'|'API KEY'/);
  assert.doesNotMatch(source, /pre-line|\. \\n|\\n\d/, 'separate Text elements, not newlines, lay out the page');
});

test('phone settings show watch diagnostic steps only after a sanitized report arrives', () => {
  const report = JSON.stringify({
    version: 1,
    events: [{ at: 1_000, code: WORKOUT_DIAGNOSTIC_CODES.SET_TAP }],
  });
  const { tree } = renderSettings({ [WORKOUT_DIAGNOSTICS_ENABLED_KEY]: 'true', [WORKOUT_DIAGNOSTICS_KEY]: report });
  const diagnostics = sections(tree).find(([title]) => title.children[0] === 'Diagnostics');

  assert.equal(tree.children[0].length, 5);
  assert.deepEqual(texts(diagnostics).slice(0, 4), [
    'Diagnostics',
    'Open this Lifto app on the watch to apply the change.',
    'Recent watch steps',
    'Sent when Lifto connects or resumes.',
  ]);
  assert.ok(texts(diagnostics).includes('1970-01-01T00:00:01.000Z UTC SET_TAP'));
});

test('watch diagnostics require an explicit phone toggle and clear the report when disabled', () => {
  assert.equal(loadSettings().state.workoutDiagnosticsEnabled, false);
  const initial = renderSettings();
  const diagnosticsToggle = toggle(initial.tree, 'Record watch diagnostics');
  assert.ok(diagnosticsToggle);
  assert.equal(diagnosticsToggle.props.value, false);
  diagnosticsToggle.props.onChange(true);
  assert.deepEqual(initial.writes, [[WORKOUT_DIAGNOSTICS_ENABLED_KEY, 'true']]);
  const enabled = renderSettings({ [WORKOUT_DIAGNOSTICS_ENABLED_KEY]: 'true', [WORKOUT_DIAGNOSTICS_KEY]: 'saved' });
  const enabledDiagnostics = toggle(enabled.tree, 'Record watch diagnostics');
  assert.equal(enabledDiagnostics.props.value, true);
  enabledDiagnostics.props.onChange(false);
  assert.deepEqual(enabled.writes, [[WORKOUT_DIAGNOSTICS_ENABLED_KEY, 'false']]);
  assert.equal(enabled.values.has(WORKOUT_DIAGNOSTICS_KEY), false);
});

test('diagnostics card provides multiline enabled TextInput for copying logs with full report value and copy instructions', () => {
  const report = JSON.stringify({
    version: 1,
    previousEvents: [{ at: 100, code: WORKOUT_DIAGNOSTIC_CODES.RENDER_END, secret: "private detail" }],
    events: [{ at: 1_000, code: WORKOUT_DIAGNOSTIC_CODES.SET_TAP }],
  });
  const { tree } = renderSettings({
    apiKey: 'test-api-key-placeholder',
    [WORKOUT_DIAGNOSTICS_ENABLED_KEY]: 'true',
    [WORKOUT_DIAGNOSTICS_KEY]: report,
  });
  const text = texts(tree);

  const copyInput = collect(tree, 'TextInput').find(({ props }) => props.label === 'Select and copy logs');
  assert.ok(copyInput, 'export TextInput should be rendered');
  assert.equal(copyInput.props.multiline, true);
  assert.equal(copyInput.props.rows, 12);
  assert.equal(copyInput.props.settingsKey, undefined);
  assert.notEqual(copyInput.props.disabled, true);
  assert.equal(copyInput.props.value, formatWorkoutDiagnostics(report));
  assert.doesNotMatch(copyInput.props.value, /secret_12345|private detail/);
  for (const line of copyInput.props.value.split('\n')) assert.ok(text.includes(line));
  assert.ok(text.includes('Open the field, then long-press, Select all and Copy.'));
});

test('diagnostics export TextInput onChange cannot modify storage or overwrite canonical report', () => {
  const report = JSON.stringify({
    version: 1,
    events: [{ at: 1_000, code: WORKOUT_DIAGNOSTIC_CODES.SET_TAP }],
  });
  const { tree, writes, values } = renderSettings({
    [WORKOUT_DIAGNOSTICS_ENABLED_KEY]: 'true',
    [WORKOUT_DIAGNOSTICS_KEY]: report,
  });

  const copyInput = collect(tree, 'TextInput').find(({ props }) => props.label === 'Select and copy logs');
  assert.ok(copyInput);
  const writeCountBefore = writes.length;
  copyInput.props.onChange('malicious edit');
  assert.equal(writes.length, writeCountBefore);
  assert.equal(values.get(WORKOUT_DIAGNOSTICS_KEY), report);
});

test('diagnostics export control is hidden when there are no valid diagnostics or when disabled', () => {
  const empty = renderSettings({ [WORKOUT_DIAGNOSTICS_ENABLED_KEY]: 'true' });
  assert.equal(collect(empty.tree, 'TextInput').some(({ props }) => props.label === 'Select and copy logs'), false);
  assert.ok(texts(empty.tree).includes('No watch diagnostics yet'));
  assert.equal(texts(empty.tree).includes('Open the field, then long-press, Select all and Copy.'), false);

  const disabled = renderSettings({
    [WORKOUT_DIAGNOSTICS_ENABLED_KEY]: 'false',
    [WORKOUT_DIAGNOSTICS_KEY]: JSON.stringify({ version: 1, events: [{ at: 1_000, code: WORKOUT_DIAGNOSTIC_CODES.BOOT }] }),
  });
  assert.equal(collect(disabled.tree, 'TextInput').some(({ props }) => props.label === 'Select and copy logs'), false);
  assert.equal(texts(disabled.tree).includes('No watch diagnostics yet'), false);
});

test('Help lists the API key steps as separate lines', () => {
  const help = sections(renderSettings().tree).at(-1);

  assert.deepEqual(texts(help), [
    'Help',
    'Find your API key in Liftosaur.',
    '1. Open Liftosaur.',
    '2. Go to Settings > API Keys.',
    '3. Copy your personal key.',
    '4. Paste it above and tap Save key.',
  ]);
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
  assert.ok(texts(renderSettings().tree).includes('Rest timers follow your Liftosaur settings.'));
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
