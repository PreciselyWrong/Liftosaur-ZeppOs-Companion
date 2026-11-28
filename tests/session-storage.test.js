import test from 'node:test';
import assert from 'node:assert/strict';

import { createSessionStore, createMemoryStorageAdapter, SESSION_UNREADABLE } from '../shared/session-storage.js';

const PLAN = {
  programId: 'p1',
  dayName: 'Semaine 1 - Mardi',
  week: 1,
  dayInWeek: 1,
  unit: 'kg',
  exercises: [{ index: 1, id: 'ex-1', name: 'Squat', sets: [{ index: 1, targetReps: 5 }] }],
};

const JOURNAL = [{ type: 'START_WORKOUT', timestamp: 1000 }];

/** The single LocalStorage value builds up to 0.5.15 stored the whole session in. */
function legacySlot(value = null) {
  const slot = { value };
  slot.read = () => slot.value;
  slot.remove = () => { slot.value = null; };
  return slot;
}

test('stores the plan alongside the journal so a session can be replayed', () => {
  const store = createSessionStore(createMemoryStorageAdapter());
  store.save({ plan: PLAN, journal: JOURNAL, startedAt: 1000 });

  const restored = store.load();
  assert.deepEqual(restored.plan, PLAN);
  assert.deepEqual(restored.journal, JOURNAL);
  assert.equal(restored.startedAt, 1000);
});

test('reports whether there is a session to resume', () => {
  const store = createSessionStore(createMemoryStorageAdapter());
  assert.equal(store.hasSession(), false);

  store.save({ plan: PLAN, journal: JOURNAL });
  assert.equal(store.hasSession(), true);

  store.clear();
  assert.equal(store.hasSession(), false);
  assert.equal(store.load(), null);
});

test('refuses to save a journal with no plan to replay it against', () => {
  const store = createSessionStore(createMemoryStorageAdapter());

  assert.equal(store.save({ plan: null, journal: JOURNAL }), false);
  assert.equal(store.save({ plan: PLAN, journal: null }), false);
  assert.equal(store.load(), null);
});

test('treats a corrupted or foreign snapshot as no session', () => {
  const legacy = legacySlot();
  const store = createSessionStore(createMemoryStorageAdapter(), { legacy });

  legacy.value = '{not json';
  assert.equal(store.load(), null);

  legacy.value = JSON.stringify({ version: 99, plan: PLAN, journal: JOURNAL });
  assert.equal(store.load(), null);

  legacy.value = JSON.stringify({ version: 1, journal: JOURNAL });
  assert.equal(store.load(), null);
});

test('survives an adapter that throws', () => {
  const fail = () => {
    throw new Error('storage unavailable');
  };
  const store = createSessionStore(
    { read: fail, write: fail, append: fail, remove: fail },
    { legacy: { read: fail, remove: fail } }
  );

  // Files that may exist but do not read are not "no session": a new workout must not clear them.
  assert.throws(() => store.load(), (err) => err.code === SESSION_UNREADABLE);
  assert.equal(store.save({ plan: PLAN, journal: JOURNAL }), false);
  store.clear();
});

test('persists direct synchronization progress with the session snapshot', () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  const sync = {
    mode: 'DIRECT',
    startConfirmed: true,
    acknowledgedSetCount: 2,
    finishRequestedAt: null,
    discardRequestedAt: null,
  };

  store.save({ plan: PLAN, journal: JOURNAL, startedAt: 1000, sync });

  assert.deepEqual(store.load().sync, sync);
  assert.deepEqual(createSessionStore(adapter).load().sync, sync, 'after a restart');
});

test('loads a version 1 snapshot only as an explicit legacy finalization session', () => {
  const legacy = legacySlot(JSON.stringify({ version: 1, plan: PLAN, journal: JOURNAL, startedAt: 1000 }));

  const restored = createSessionStore(createMemoryStorageAdapter(), { legacy }).load();

  assert.equal(restored.sync.mode, 'LEGACY');
  assert.equal(restored.startedAt, 1000);
});

test('keeps the current session in memory when device storage fails mid-workout', () => {
  let writes = 0;
  const full = () => {
    writes += 1;
    throw new Error('device storage full');
  };
  const store = createSessionStore({ read: () => null, write: full, append: full, remove: () => {} });

  assert.equal(store.save({ plan: PLAN, journal: JOURNAL, startedAt: 1000 }), false, 'a memory-only save is reported');
  assert.equal(store.load().startedAt, 1000);
  assert.equal(writes, 1);

  assert.equal(store.save({ plan: PLAN, journal: [...JOURNAL, { type: 'COMPLETE_SET', timestamp: 2000 }] }), false);
  assert.equal(writes, 2, 'every save tries the watch storage again');
  assert.equal(store.load().journal.length, 2);
});
