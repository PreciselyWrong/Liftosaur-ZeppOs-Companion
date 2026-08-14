import test from 'node:test';
import assert from 'node:assert/strict';

import { createSessionStore, createMemoryStorageAdapter } from '../shared/session-storage.js';

const PLAN = {
  programId: 'p1',
  dayName: 'Semaine 1 - Mardi',
  week: 1,
  dayInWeek: 1,
  unit: 'kg',
  exercises: [{ index: 1, id: 'ex-1', name: 'Squat', sets: [{ index: 1, targetReps: 5 }] }],
};

const JOURNAL = [{ type: 'START_WORKOUT', timestamp: 1000 }];

test('stores the plan alongside the journal so a session can be replayed', () => {
  const store = createSessionStore(createMemoryStorageAdapter());
  store.save({ plan: PLAN, journal: JOURNAL, startedAt: 1000 });

  const restored = store.load();
  assert.deepEqual(restored.plan, PLAN);
  assert.deepEqual(restored.journal, JOURNAL);
  assert.equal(restored.startedAt, 1000);
});

test('carries the live history id so a resumed session keeps updating one record', () => {
  const store = createSessionStore(createMemoryStorageAdapter());
  store.save({ plan: PLAN, journal: JOURNAL, startedAt: 1000, historyId: 42 });

  assert.equal(store.load().historyId, 42);
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
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);

  adapter.write('{not json');
  assert.equal(store.load(), null);

  adapter.write(JSON.stringify({ version: 99, plan: PLAN, journal: JOURNAL }));
  assert.equal(store.load(), null);

  adapter.write(JSON.stringify({ version: 1, journal: JOURNAL }));
  assert.equal(store.load(), null);
});

test('survives an adapter that throws', () => {
  const store = createSessionStore({
    read: () => {
      throw new Error('storage unavailable');
    },
    write: () => {
      throw new Error('storage unavailable');
    },
    remove: () => {
      throw new Error('storage unavailable');
    },
  });

  assert.equal(store.load(), null);
  assert.equal(store.save({ plan: PLAN, journal: JOURNAL }), false);
  store.clear();
});
