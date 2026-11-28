/**
 * Failures the watch file API allows and a lifter must never pay for with a set: a file that
 * exists but cannot be read at launch, writes that return without landing, an append flag the
 * firmware ignores, a removal that is not one, and a downgrade to 0.5.15 and back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryStorageAdapter, createSessionStore, createWatchFileAdapter, SESSION_UNREADABLE,
} from '../shared/session-storage.js';
import { createWorkoutController } from '../shared/workout-controller.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { createFakeZosFs } from './helpers/fake-zos-fs.js';

const plan = (id) => ({ id, source: 'WORKOUT_API', pad: 'p'.repeat(19_000) });
const set = (n) => ({ type: 'COMPLETE_SET', timestamp: 1000 + n, payload: { setId: `s${n}`, reps: 5 } });
const sets = (count, from = 0) => Array.from({ length: count }, (_, index) => set(from + index));
const seqOf = (text) => Number(/"seq":(\d+)/.exec(text)?.[1] ?? -1);
const quiet = (t) => t.mock.method(console, 'log', () => {});

function newestStateCopy(files) {
  return [...files.keys()]
    .filter((name) => /-[ab]\.dat$/.test(name) && !name.includes('-plan-'))
    .sort((a, b) => seqOf(files.get(b)) - seqOf(files.get(a)))[0];
}

function assertUnreadable(store) {
  assert.throws(() => store.load(), (err) => err.code === SESSION_UNREADABLE);
}

test('a session file that exists but cannot be read at launch is reported, kept, and restored once it reads', (t) => {
  quiet(t);
  const memory = createMemoryStorageAdapter();
  let unreadable = null;
  // The platform returns undefined for "file failed to be read", and may throw (out of memory).
  const files = { ...memory, read: (name) => (name === unreadable ? undefined : memory.read(name)) };
  const p = plan(1);
  let store = createSessionStore(files);
  let journal = [];
  for (let index = 0; index < 200; index++) {
    journal = [...journal, set(index)];
    assert.equal(store.save({ plan: p, journal }), true);
  }
  unreadable = newestStateCopy(memory.files);
  const before = new Map(memory.files);

  store = createSessionStore(files);
  assertUnreadable(store);
  // The app carries on with a new workout: nothing on the watch may be written over or removed.
  store.clear();
  let other = [];
  for (let index = 0; index < 80; index++) {
    other = [...other, set(1000 + index)];
    assert.equal(store.save({ plan: plan(2), journal: other }), false, 'a save that cannot reach the files says so');
  }
  store.clear();
  assert.deepEqual(memory.files, before);

  unreadable = null;
  assert.deepEqual(createSessionStore(files).load().journal, journal);
});

test('an unreadable plan copy is a failure, not "no session", and a new workout cannot clear it', (t) => {
  quiet(t);
  const memory = createMemoryStorageAdapter();
  let unreadable = null;
  const files = {
    ...memory,
    read: (name) => {
      if (name === unreadable) throw new Error('out of memory');
      return memory.read(name);
    },
  };
  const store = createSessionStore(files);
  store.save({ plan: plan(1), journal: sets(3) });
  unreadable = 'lifto-session-plan-a.dat';
  const before = new Map(memory.files);

  const controller = createWorkoutController({ store: createSessionStore(files), now: () => 5000 });
  const restored = controller.restore();
  assert.equal(restored.success, false);
  assert.equal(restored.reason, 'UNREADABLE');
  assert.equal(controller.isSaveFailing(), true, 'the lifter is told the watch is not saving');

  controller.loadPlan(workoutToDayPlan({
    programId: 'p', dayName: 'Other', dayData: { week: 1, dayInWeek: 1 }, startTime: 5000,
    entries: [{ entryId: 'e', exerciseId: 'Squat', name: 'Squat', sets: [{ index: 0, setId: 'x', weight: '20kg', reps: 5 }] }],
  }), { clearStore: true });
  controller.startWorkout();
  controller.completeSet();
  assert.equal(controller.isSaveFailing(), true);
  assert.deepEqual(memory.files, before);

  unreadable = null;
  assert.deepEqual(createSessionStore(files).load().journal, sets(3));
});

test('through the watch adapter, a present file that reads as undefined blocks writes until it reads', (t) => {
  quiet(t);
  const fs = createFakeZosFs();
  const store = createSessionStore(createWatchFileAdapter(fs));
  const p = plan(1);
  let journal = [];
  for (let index = 0; index < 120; index++) {
    journal = [...journal, set(index)];
    assert.equal(store.save({ plan: p, journal }), true);
  }
  fs.unreadable.add(newestStateCopy(fs.files));
  const before = new Map(fs.files);
  const blocked = createSessionStore(createWatchFileAdapter(fs));
  assertUnreadable(blocked);
  assert.equal(blocked.save({ plan: plan(2), journal: sets(2, 500) }), false);
  blocked.clear();
  assert.deepEqual(fs.files, before);

  fs.unreadable.clear();
  assert.deepEqual(createSessionStore(createWatchFileAdapter(fs)).load().journal, journal);
  // A file that is missing is just missing.
  assert.equal(createSessionStore(createWatchFileAdapter(createFakeZosFs())).load(), null);
});

// --- 0.5.15 and back ---

function legacySlot(value) {
  const slot = { value, removed: 0 };
  return Object.assign(slot, {
    read: () => slot.value,
    remove: () => { slot.value = null; slot.removed += 1; },
  });
}
const legacyValue = (p, journal) => JSON.stringify({ version: 2, plan: p, journal, startedAt: 1, sync: { mode: 'DIRECT' } });

test('a session 0.5.15 logged after this build stored one in files wins, and neither is removed unverified', (t) => {
  quiet(t);
  const files = createMemoryStorageAdapter();
  createSessionStore(files).save({ plan: plan(1), journal: sets(3) });
  // Downgrade: 0.5.15 sees no LocalStorage session and logs a new one there.
  const legacy = legacySlot(legacyValue(plan(2), sets(12, 100)));
  const value = legacy.value;

  const store = createSessionStore(files, { legacy });
  const loaded = store.load();
  assert.equal(loaded.plan.id, 2);
  assert.deepEqual(loaded.journal, sets(12, 100));
  assert.equal(store.save({ ...loaded, journal: [...loaded.journal, set(200)] }), true);
  assert.deepEqual(createSessionStore(files).load().journal, [...sets(12, 100), set(200)]);
  assert.equal(legacy.value, null, 'removed once the files gave it back');

  // A value that changed after this run read it is not the one it migrated.
  const files2 = createMemoryStorageAdapter();
  const legacy2 = legacySlot(value);
  const store2 = createSessionStore(files2, { legacy: legacy2 });
  store2.load();
  legacy2.value = legacyValue(plan(3), sets(4, 300));
  store2.save({ plan: plan(2), journal: sets(13, 100) });
  store2.clear();
  assert.notEqual(legacy2.value, null, 'a value this run never read stays');
});

test('a 0.5.15 value whose journal the files extend is the older one', (t) => {
  quiet(t);
  const files = createMemoryStorageAdapter();
  const p = plan(1);
  const legacy = legacySlot(legacyValue(p, sets(2)));
  const failing = { ...legacy, remove: () => { throw new Error('busy'); } };
  const store = createSessionStore(files, { legacy: failing });
  const loaded = store.load();
  store.save({ ...loaded, journal: [...loaded.journal, set(2)] });
  store.save({ ...loaded, journal: [...loaded.journal, set(2), set(3)] });
  assert.notEqual(legacy.value, null, 'the removal failed');
  assert.deepEqual(createSessionStore(files, { legacy }).load().journal, sets(4));
});

// --- Writes the API reports nothing about ---

test('a plan copy write that silently stores nothing is a failed save, and the next save repairs it', (t) => {
  quiet(t);
  const fs = createFakeZosFs();
  const store = createSessionStore(createWatchFileAdapter(fs));
  assert.equal(store.save({ plan: plan(1), journal: [] }), true);
  fs.fault = ({ kind, path }) => (kind === 'write' && path.includes('-plan-') ? 'noop' : null);
  const p2 = plan(2);
  assert.equal(store.save({ plan: p2, journal: [] }), false);
  fs.fault = () => null;
  let journal = [];
  for (let index = 0; index < 60; index++) {
    journal = [...journal, set(index)];
    assert.equal(store.save({ plan: p2, journal }), true);
  }
  const restored = createSessionStore(createWatchFileAdapter(fs)).load();
  assert.equal(restored.plan.id, 2);
  assert.deepEqual(restored.journal, journal);
});

test('a firmware that ignores O_APPEND still keeps every confirmed set', (t) => {
  quiet(t);
  const fs = createFakeZosFs({ ignoreAppendFlag: true });
  const store = createSessionStore(createWatchFileAdapter(fs));
  const p = plan(1);
  let journal = [];
  store.save({ plan: p, journal });
  for (let index = 0; index < 30; index++) {
    journal = [...journal, set(index)];
    assert.equal(store.save({ plan: p, journal }), true);
  }
  assert.deepEqual(createSessionStore(createWatchFileAdapter(fs)).load().journal, journal);
});

test('an append that lands short, twice or nowhere without an error is never reported saved', (t) => {
  quiet(t);
  for (const fault of ['short', 'twice', 'noop']) {
    const fs = createFakeZosFs({ rnd: () => 0.5 });
    const store = createSessionStore(createWatchFileAdapter(fs));
    const p = plan(1);
    store.save({ plan: p, journal: sets(1) });
    fs.fault = ({ kind }) => (kind === 'append' ? fault : null);
    assert.equal(store.save({ plan: p, journal: sets(2) }), false, fault);
    fs.fault = () => null;
    assert.equal(store.save({ plan: p, journal: sets(3) }), true, fault);
    assert.deepEqual(createSessionStore(createWatchFileAdapter(fs)).load().journal, sets(3), fault);
  }
});

test('a firmware that honours neither O_APPEND nor the write position is detected, not trusted', (t) => {
  quiet(t);
  const fs = createFakeZosFs({ ignoreAppendFlag: true, ignorePosition: true });
  const store = createSessionStore(createWatchFileAdapter(fs));
  const p = plan(1);
  store.save({ plan: p, journal: sets(1) });
  assert.equal(store.save({ plan: p, journal: sets(2) }), true, 'the first line lands at offset 0 of an empty log');
  assert.equal(store.save({ plan: p, journal: sets(3) }), false);
  assert.equal(store.save({ plan: p, journal: sets(4) }), true, 'a whole copy instead');
  assert.deepEqual(createSessionStore(createWatchFileAdapter(fs)).load().journal, sets(4));
});

// --- Removals and truncations that fail half way ---

test('a removal that leaves the file while stat says it is gone never revives a finished workout', (t) => {
  quiet(t);
  const fs = createFakeZosFs();
  const store = createSessionStore(createWatchFileAdapter(fs));
  store.save({ plan: plan(1), journal: sets(3) });
  fs.fault = ({ kind, path }) => (kind === 'remove' && path.includes('-plan-') ? 'rmLies' : null);
  store.clear();
  fs.fault = () => null;
  assert.equal(createSessionStore(createWatchFileAdapter(fs)).load(), null);
});

test('a whole copy is never written twice under one sequence number', (t) => {
  quiet(t);
  const fs = createFakeZosFs();
  const written = [];
  const store = createSessionStore(createWatchFileAdapter(fs));
  const p = plan(1);
  let journal = [];
  store.save({ plan: p, journal });
  fs.fault = ({ kind, path }) => {
    if (kind === 'write' && path.endsWith('-log.dat')) return 'throw';
    return null;
  };
  const spy = fs.writeFileSync;
  fs.writeFileSync = (option) => {
    if (!option.path.endsWith('-log.dat')) written.push(seqOf(option.data));
    return spy(option);
  };
  for (let index = 0; index < 400; index++) {
    journal = [...journal, set(index)];
    store.save({ plan: p, journal });
  }
  assert.ok(written.length > 1, `${written.length} copies`);
  assert.equal(new Set(written).size, written.length, `sequence numbers ${written.join(',')}`);
});
