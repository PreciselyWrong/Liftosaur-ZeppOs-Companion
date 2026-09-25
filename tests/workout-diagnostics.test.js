import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WORKOUT_DIAGNOSTICS_KEY,
  WORKOUT_DIAGNOSTICS_ENABLED_KEY,
  WORKOUT_DIAGNOSTIC_CODES,
  createWorkoutDiagnostics,
  formatWorkoutDiagnostics,
  readWorkoutMemory,
} from '../shared/workout-diagnostics.js';

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('keeps the last 12 allowlisted steps across a watch restart', () => {
  const storage = memoryStorage();
  let time = 1_000;
  const diagnostics = createWorkoutDiagnostics(storage, () => time++);
  diagnostics.setEnabled(true);
  const codes = Object.values(WORKOUT_DIAGNOSTIC_CODES);
  for (let index = 0; index < 15; index++) {
    assert.equal(diagnostics.record(codes[index % codes.length]), true);
  }

  const restored = createWorkoutDiagnostics(storage);
  assert.equal(restored.read().events.length, 12);
  assert.equal(restored.read().events[0].at, 1_003);
  assert.equal(restored.read().events[11].at, 1_014);
  assert.equal(storage.values.size, 2);
  assert.ok(storage.values.has(WORKOUT_DIAGNOSTICS_KEY));
});

test('rejects arbitrary event data and sanitizes a phone-side copy', () => {
  const storage = memoryStorage();
  const diagnostics = createWorkoutDiagnostics(storage, () => 2_000);
  diagnostics.setEnabled(true);
  assert.equal(diagnostics.record('api-key-secret'), false);
  assert.equal(storage.values.size, 1);
  assert.equal(diagnostics.replace({ version: 2, events: [] }), false);
  assert.equal(diagnostics.replace({ version: 1, events: 'secret' }), false);
  assert.equal(diagnostics.replace({
    version: 1,
    events: [
      { at: 1_000, code: WORKOUT_DIAGNOSTIC_CODES.SET_TAP, apiKey: 'secret' },
      { at: 1_001, code: 'secret', workoutName: 'Private workout' },
    ],
  }), true);
  assert.deepEqual(diagnostics.read(), {
    version: 1,
    events: [{ at: 1_000, code: WORKOUT_DIAGNOSTIC_CODES.SET_TAP }],
  });
  assert.doesNotMatch(storage.values.get(WORKOUT_DIAGNOSTICS_KEY), /secret|Private/);
});

test('storage errors never interrupt watch actions and memory still records steps', () => {
  const storage = {
    getItem: () => { throw new Error('read failed'); },
    setItem: () => { throw new Error('write failed'); },
  };
  const diagnostics = createWorkoutDiagnostics(storage, () => 3_000);
  diagnostics.setEnabled(true);
  assert.doesNotThrow(() => diagnostics.record(WORKOUT_DIAGNOSTIC_CODES.SET_TAP));
  assert.deepEqual(diagnostics.read().events, [
    { at: 3_000, code: WORKOUT_DIAGNOSTIC_CODES.SET_TAP },
  ]);
  assert.equal(diagnostics.replace({ version: 1, events: [] }), false);
});

test('phone report contains only timestamps and known codes', () => {
  assert.equal(formatWorkoutDiagnostics(null), 'No watch diagnostics yet');
  assert.equal(formatWorkoutDiagnostics({
    version: 1,
    events: [{ at: 1_000, code: WORKOUT_DIAGNOSTIC_CODES.SET_TAP, secret: 'do not show' }],
  }), [
    'Latest snapshot received from the watch. The last event does not prove the crash cause.',
    'Current run (1 event, latest 12 retained):',
    '1970-01-01T00:00:01.000Z UTC SET_TAP',
  ].join('\n'));
  assert.doesNotMatch(formatWorkoutDiagnostics({
    version: 1,
    events: [{ at: 1_000, code: 'PRIVATE_WORKOUT' }],
  }), /PRIVATE_WORKOUT/);
  assert.doesNotThrow(() => formatWorkoutDiagnostics({
    version: 1,
    events: [{ at: Number.MAX_SAFE_INTEGER, code: WORKOUT_DIAGNOSTIC_CODES.SET_TAP }],
  }));
});

test('captures only this app and aggregate system memory at a watch checkpoint', () => {
  const sample = readWorkoutMemory(
    () => ({ appId: 1125789 }),
    () => ({ memory: {
      system: { used: 48 * 1024 * 1024, total: 64 * 1024 * 1024 },
      app: [
        { appid: 42, used: 30 * 1024 * 1024, peak: 31 * 1024 * 1024 },
        { appid: 1125789, used: 2 * 1024 * 1024, peak: 3 * 1024 * 1024 },
      ],
    } }),
  );
  assert.deepEqual(sample, {
    appUsed: 2 * 1024 * 1024,
    appPeak: 3 * 1024 * 1024,
    systemUsed: 48 * 1024 * 1024,
    systemTotal: 64 * 1024 * 1024,
  });
  const storage = memoryStorage();
  const diagnostics = createWorkoutDiagnostics(storage, () => 1_000, () => sample);
  diagnostics.setEnabled(true);
  diagnostics.record(WORKOUT_DIAGNOSTIC_CODES.SET_TAP);
  assert.match(formatWorkoutDiagnostics(storage.values.get(WORKOUT_DIAGNOSTICS_KEY)), /app 2\.0 MiB \(peak 3\.0 MiB\) \| system free 16\.0\/64\.0 MiB/);
  assert.doesNotMatch(storage.values.get(WORKOUT_DIAGNOSTICS_KEY), /"appid"|"modules"|42/);
});

test('unsupported memory API and malformed memory never break breadcrumbs', () => {
  assert.equal(readWorkoutMemory(() => ({ appId: 1 }), undefined), null);
  assert.equal(readWorkoutMemory(() => { throw new Error('unsupported'); }, () => ({})), null);
  const diagnostics = createWorkoutDiagnostics(memoryStorage(), () => 1_000, () => {
    throw new Error('unsupported');
  });
  diagnostics.setEnabled(true);
  assert.equal(diagnostics.record(WORKOUT_DIAGNOSTIC_CODES.BOOT), true);
  assert.equal(diagnostics.read().events[0].memory, undefined);
  assert.equal(diagnostics.replace({ version: 1, events: [{
    at: 1_000,
    code: WORKOUT_DIAGNOSTIC_CODES.SET_TAP,
    memory: { appUsed: -1, systemTotal: 'secret', secret: 'api-key' },
  }] }), true);
  assert.deepEqual(diagnostics.read().events, [{ at: 1_000, code: WORKOUT_DIAGNOSTIC_CODES.SET_TAP }]);
});

test('writes the action before an optional memory probe can fail', () => {
  const storage = memoryStorage();
  let sawSavedAction = false;
  const diagnostics = createWorkoutDiagnostics(storage, () => 1_000, () => {
    assert.deepEqual(JSON.parse(storage.values.get(WORKOUT_DIAGNOSTICS_KEY)).events, [
      { at: 1_000, code: WORKOUT_DIAGNOSTIC_CODES.SET_TAP },
    ]);
    sawSavedAction = true;
    throw new Error('native memory probe failed');
  });
  diagnostics.setEnabled(true);
  assert.equal(diagnostics.record(WORKOUT_DIAGNOSTIC_CODES.SET_TAP), true);
  assert.equal(sawSavedAction, true);
});

test('recording is opt-in and disabling clears the retained report', () => {
  const storage = memoryStorage();
  let sampled = false;
  const diagnostics = createWorkoutDiagnostics(storage, () => 1_000, () => { sampled = true; return null; });
  assert.equal(diagnostics.record(WORKOUT_DIAGNOSTIC_CODES.SET_TAP), false);
  assert.equal(sampled, false);
  assert.equal(storage.values.size, 0);
  diagnostics.setEnabled(true);
  diagnostics.record(WORKOUT_DIAGNOSTIC_CODES.SET_TAP);
  assert.equal(createWorkoutDiagnostics(storage).read().events.length, 1);
  diagnostics.setEnabled(false);
  assert.equal(storage.values.get(WORKOUT_DIAGNOSTICS_ENABLED_KEY), 'false');
  assert.deepEqual(createWorkoutDiagnostics(storage).read().events, []);
  assert.equal(storage.values.has(WORKOUT_DIAGNOSTICS_KEY), false);
});

test('keeps previous-run evidence when BOOT starts a new run', () => {
  const storage = memoryStorage();
  let time = 1_000;
  const diagnostics = createWorkoutDiagnostics(storage, () => time++);
  diagnostics.setEnabled(true);
  diagnostics.record(WORKOUT_DIAGNOSTIC_CODES.SET_TAP);
  diagnostics.record(WORKOUT_DIAGNOSTIC_CODES.PAUSE);
  diagnostics.record(WORKOUT_DIAGNOSTIC_CODES.BOOT);
  for (let index = 0; index < 20; index++) diagnostics.record(WORKOUT_DIAGNOSTIC_CODES.RENDER_START);
  assert.equal(diagnostics.read().events.length, 12);
  assert.deepEqual(diagnostics.read().previousEvents.map((event) => event.code), [
    WORKOUT_DIAGNOSTIC_CODES.SET_TAP,
    WORKOUT_DIAGNOSTIC_CODES.PAUSE,
  ]);
});

test('retains previous evidence through boot-only restarts', () => {
  const storage = memoryStorage();
  let time = 1_000;
  const first = createWorkoutDiagnostics(storage, () => time++);
  first.setEnabled(true);
  first.record(WORKOUT_DIAGNOSTIC_CODES.ACTION_TAP);
  first.record(WORKOUT_DIAGNOSTIC_CODES.BOOT);
  const restarted = createWorkoutDiagnostics(storage, () => time++);
  restarted.record(WORKOUT_DIAGNOSTIC_CODES.BOOT);
  assert.deepEqual(createWorkoutDiagnostics(storage).read().previousEvents.map((event) => event.code), [
    WORKOUT_DIAGNOSTIC_CODES.ACTION_TAP,
  ]);
});

test('sanitizes, copies, formats, and bounds both diagnostics runs', () => {
  const storage = memoryStorage();
  const diagnostics = createWorkoutDiagnostics(storage, () => 1_000);
  diagnostics.setEnabled(true);
  const events = Array.from({ length: 15 }, (_, index) => ({ at: index, code: WORKOUT_DIAGNOSTIC_CODES.RENDER_END, secret: 'secret' }));
  const previousEvents = Array.from({ length: 15 }, (_, index) => ({ at: index + 100, code: WORKOUT_DIAGNOSTIC_CODES.RESUME, token: 'secret' }));
  assert.equal(diagnostics.replace({ version: 1, events, previousEvents }), true);
  const report = diagnostics.read();
  assert.equal(report.events.length, 12);
  assert.equal(report.previousEvents.length, 12);
  assert.deepEqual(report.events[0], { at: 3, code: WORKOUT_DIAGNOSTIC_CODES.RENDER_END });
  assert.deepEqual(report.previousEvents[0], { at: 103, code: WORKOUT_DIAGNOSTIC_CODES.RESUME });
  report.previousEvents[0].code = WORKOUT_DIAGNOSTIC_CODES.BOOT;
  assert.equal(diagnostics.read().previousEvents[0].code, WORKOUT_DIAGNOSTIC_CODES.RESUME);
  const formattedReport = formatWorkoutDiagnostics(diagnostics.read());
  assert.match(formattedReport, /Previous run \(12 events, latest 12 retained\):/);
  assert.match(formattedReport, /1970-01-01T00:00:00\.103Z UTC RESUME/);
  assert.doesNotMatch(formattedReport, /Previous run: 1970/);
  assert.doesNotMatch(storage.values.get(WORKOUT_DIAGNOSTICS_KEY), /secret|token/);
});

test('disabling diagnostics clears both runs', () => {
  const storage = memoryStorage();
  const diagnostics = createWorkoutDiagnostics(storage, () => 1_000);
  diagnostics.setEnabled(true);
  diagnostics.replace({ version: 1, events: [{ at: 1, code: WORKOUT_DIAGNOSTIC_CODES.BOOT }], previousEvents: [{ at: 0, code: WORKOUT_DIAGNOSTIC_CODES.SET_TAP }] });
  diagnostics.setEnabled(false);
  assert.deepEqual(diagnostics.read(), { version: 1, events: [] });
  assert.equal(storage.values.has(WORKOUT_DIAGNOSTICS_KEY), false);
});

test('formats Previous run and Current run into readable sections with UTC, event counts, and explicit MiB units', () => {
  const report = {
    version: 1,
    previousEvents: [
      {
        at: 1_000,
        code: WORKOUT_DIAGNOSTIC_CODES.SET_TAP,
        memory: { appUsed: 2 * 1024 * 1024, appPeak: 4 * 1024 * 1024, systemUsed: 48 * 1024 * 1024, systemTotal: 64 * 1024 * 1024 },
      },
    ],
    events: [
      { at: 50_000, code: WORKOUT_DIAGNOSTIC_CODES.BOOT },
      { at: 50_250, code: WORKOUT_DIAGNOSTIC_CODES.RENDER_START },
    ],
  };

  const formatted = formatWorkoutDiagnostics(report);
  assert.ok(formatted.includes('Latest snapshot received from the watch. The last event does not prove the crash cause.'));
  assert.ok(formatted.includes('Previous run (1 event, latest 12 retained):'));
  assert.ok(formatted.includes('Current run (2 events, latest 12 retained):'));
  assert.ok(formatted.includes('1970-01-01T00:00:01.000Z UTC SET_TAP | app 2.0 MiB (peak 4.0 MiB) | system free 16.0/64.0 MiB'));
  assert.ok(formatted.includes('1970-01-01T00:00:50.000Z UTC BOOT'));
  assert.ok(formatted.includes('1970-01-01T00:00:50.250Z UTC RENDER_START (+250ms)'));
  assert.doesNotMatch(formatted, /Previous run: 1970/);
});

test('calculates per-run elapsed milliseconds without bridging runs and handles same timestamps or clock skew', () => {
  const report = {
    version: 1,
    previousEvents: [
      { at: 10_000, code: WORKOUT_DIAGNOSTIC_CODES.SET_TAP },
      { at: 10_000, code: WORKOUT_DIAGNOSTIC_CODES.SET_SAVED },
      { at: 9_500, code: WORKOUT_DIAGNOSTIC_CODES.PAUSE },
    ],
    events: [
      { at: 60_000, code: WORKOUT_DIAGNOSTIC_CODES.BOOT },
      { at: 61_200, code: WORKOUT_DIAGNOSTIC_CODES.RENDER_START },
    ],
  };

  const formatted = formatWorkoutDiagnostics(report);
  assert.ok(formatted.includes('1970-01-01T00:00:10.000Z UTC SET_TAP'));
  assert.ok(formatted.includes('1970-01-01T00:00:10.000Z UTC SET_SAVED (+0ms)'));
  assert.ok(formatted.includes('1970-01-01T00:00:09.500Z UTC PAUSE (clock moved backwards)'));
  // No elapsed interval can be inferred before the first retained event.
  assert.ok(formatted.includes('1970-01-01T00:01:00.000Z UTC BOOT'));
  assert.ok(formatted.includes('1970-01-01T00:01:01.200Z UTC RENDER_START (+1200ms)'));
  assert.doesNotMatch(formatted, /SET_TAP \(\+|BOOT \(\+/);
  assert.doesNotMatch(formatted, /\+50500ms/);
  assert.doesNotMatch(formatted, /-\d+ms/);
});
