import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryStorageAdapter, createSessionStore } from '../shared/session-storage.js';
import { EVENT_TYPES } from '../shared/workout-session.js';

test('store saves and loads journal entries', () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);

  assert.equal(store.hasActiveSession(), false);

  const event1 = { type: EVENT_TYPES.START_WORKOUT, timestamp: 1000 };
  const event2 = { type: EVENT_TYPES.COMPLETE_SET, timestamp: 2000 };

  store.appendEvent(event1);
  store.appendEvent(event2);

  assert.equal(store.hasActiveSession(), true);
  const loaded = store.loadJournal();
  assert.deepEqual(loaded, [event1, event2]);
});

test('store clears active session', () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);

  store.appendEvent({ type: EVENT_TYPES.START_WORKOUT, timestamp: 1000 });
  assert.equal(store.hasActiveSession(), true);

  store.clearSession();
  assert.equal(store.hasActiveSession(), false);
  assert.deepEqual(store.loadJournal(), []);
});

test('store recovers gracefully from corrupted raw data', () => {
  const adapter = createMemoryStorageAdapter();
  adapter.write('corrupted json data {');
  const store = createSessionStore(adapter);

  assert.deepEqual(store.loadJournal(), []);
});
