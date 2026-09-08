import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkoutDetailsLoader } from '../app-side/workout-details.js';

const entry = { exerciseId: 'squat_barbell', entryId: 'entry', name: 'Squat', equipment: 'Barbell', notes: 'Today', description: 'Program', sets: [{ reps: 5 }] };
const input = () => ({ workout: { entries: [structuredClone(entry)] } });
const record = (date, note, label = 'Squat, Barbell') => ({ text: `${date}T10:00:00Z / program: "P" / exercises: {\n// ${note}\n${label} / 1x5 20kg\n}` });
const client = (overrides = {}) => ({ listExerciseData: async () => [], listHistory: async () => ({ records: [] }), ...overrides });

test('keeps every detail layer and input immutable, with newest distinct history comments', async () => {
  const original = input();
  const before = structuredClone(original);
  const enrich = createWorkoutDetailsLoader({ client: client({
    listExerciseData: async () => [{ key: entry.exerciseId, notes: 'Exercise instructions' }],
    listHistory: async (options) => {
      assert.deepEqual(options, { limit: 20 });
      return { records: [record('2026-09-01', 'Old'), record('2026-09-04', 'New'), record('2026-09-03', 'New'), record('2026-09-02', 'Middle'), record('2026-08-31', 'Too old')] };
    },
  }) });
  const result = await enrich(original);
  assert.deepEqual(original, before);
  assert.deepEqual(result.workout.entries[0], { ...entry, exerciseNotes: 'Exercise instructions', historyNotes: 'Past sessions\n- 2026-09-04: New\n- 2026-09-02: Middle\n- 2026-09-01: Old' });
});

test('matches exact exercise keys and normalized name plus equipment only', async () => {
  const enrich = createWorkoutDetailsLoader({ client: client({
    listExerciseData: async () => [{ key: entry.entryId, notes: 'Wrong entry' }, { key: 'other', exerciseName: 'Squat', notes: 'Wrong name' }],
    listHistory: async () => ({ records: [record('2026-09-04', 'Wrong equipment', 'Squat, Dumbbell'), record('2026-09-03', 'Missing equipment', 'Squat'), record('2026-09-02', 'Wrong name', 'Front Squat, Barbell'), record('2026-09-01', 'Correct', 'squat, barbell')] }),
  }) });
  const result = await enrich(input());
  assert.equal(result.workout.entries[0].exerciseNotes, '');
  assert.equal(result.workout.entries[0].historyNotes, 'Past sessions\n- 2026-09-01: Correct');
});

test('duplicate exercise keys are unsafe even when notes agree', async () => {
  const enrich = createWorkoutDetailsLoader({ client: client({ listExerciseData: async () => [{ key: entry.exerciseId, notes: 'A' }, { key: entry.exerciseId, notes: 'A' }] }) });
  assert.equal((await enrich(input())).workout.entries[0].exerciseNotes, '');
});

test('ignores malformed optional rows without losing valid details', async () => {
  const enrich = createWorkoutDetailsLoader({ client: client({
    listExerciseData: async () => [null, {}, { key: entry.exerciseId, notes: 'Valid' }],
    listHistory: async () => ({ records: [null, {}, { text: 'invalid' }, record('2026-09-01', 'Valid')] }),
  }) });
  const details = (await enrich(input())).workout.entries[0];
  assert.equal(details.exerciseNotes, 'Valid');
  assert.equal(details.historyNotes, 'Past sessions\n- 2026-09-01: Valid');
});

test('missing or empty workouts skip metadata entirely; empty successful reads produce blanks', async () => {
  let calls = 0;
  const enrich = createWorkoutDetailsLoader({ client: client({ listExerciseData: async () => { calls++; return []; } }) });
  for (const value of [null, {}, { workout: null }, { workout: { entries: [] } }]) assert.equal(await enrich(value), value);
  assert.equal(calls, 0);
  const result = await enrich(input());
  assert.equal(result.workout.entries[0].exerciseNotes, '');
  assert.equal(result.workout.entries[0].historyNotes, '');
});

test('isolates synchronous and asynchronous failures and retries only the failed source', async () => {
  for (const failedSource of ['listExerciseData', 'listHistory']) {
    const calls = { listExerciseData: 0, listHistory: 0 };
    const stub = {};
    for (const source of Object.keys(calls)) stub[source] = () => {
      calls[source]++;
      if (source === failedSource && calls[source] === 1) {
        if (source === 'listExerciseData') throw new Error('Offline');
        return Promise.reject(new Error('Offline'));
      }
      return Promise.resolve(source === 'listExerciseData' ? [] : { records: [] });
    };
    const enrich = createWorkoutDetailsLoader({ client: stub });
    const first = (await enrich(input())).workout.entries[0];
    assert.equal(first.exerciseNotes, failedSource === 'listExerciseData' ? null : '');
    assert.equal(first.historyNotes, failedSource === 'listHistory' ? null : '');
    const second = (await enrich(input())).workout.entries[0];
    assert.equal(second.exerciseNotes, '');
    assert.equal(second.historyNotes, '');
    assert.equal(calls[failedSource], 2);
    assert.equal(calls[failedSource === 'listHistory' ? 'listExerciseData' : 'listHistory'], 1);
  }
});

test('shares concurrent loads and expires each successful source after two minutes', async () => {
  let now = 0;
  let calls = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const enrich = createWorkoutDetailsLoader({ now: () => now, client: client({ listExerciseData: () => { calls++; return pending; } }) });
  const first = enrich(input());
  const second = enrich(input());
  await Promise.resolve();
  assert.equal(calls, 1);
  release([]);
  await Promise.all([first, second]);
  now = 119999;
  await enrich(input());
  assert.equal(calls, 1);
  now = 120000;
  await enrich(input());
  assert.equal(calls, 2);
});

test('a hanging optional source times out and can be retried without hiding the workout', async () => {
  const timers = new Map();
  let timerId = 0;
  let calls = 0;
  const enrich = createWorkoutDetailsLoader({
    client: client({ listExerciseData: () => { calls++; return calls === 1 ? new Promise(() => {}) : Promise.resolve([]); } }),
    setTimer: (callback, ms) => { assert.equal(ms, 3000); timers.set(++timerId, callback); return timerId; },
    clearTimer: (id) => timers.delete(id),
  });
  const pending = enrich(input());
  for (let i = 0; i < 12; i++) await Promise.resolve();
  for (const callback of [...timers.values()]) callback();
  const result = await pending;
  assert.equal(result.workout.entries[0].exerciseNotes, null);
  assert.equal(result.workout.entries[0].historyNotes, '');
  assert.equal((await enrich(input())).workout.entries[0].exerciseNotes, '');
  assert.equal(calls, 2);
  assert.equal(timers.size, 0);
});
