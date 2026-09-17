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
  }), '1970-01-01T00:00:01.000Z SET_TAP');
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
  assert.match(formatWorkoutDiagnostics(storage.values.get(WORKOUT_DIAGNOSTICS_KEY)), /app 2\.0 MiB \(peak 3\.0\) \| system free 16\.0\/64\.0 MiB/);
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
