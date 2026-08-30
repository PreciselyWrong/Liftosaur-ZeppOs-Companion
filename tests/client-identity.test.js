import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { getOrCreateClientIdentity } from '../app-side/client-identity.js';

function createMockStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const calls = { getItem: [], setItem: [] };
  return {
    getItem(key) {
      calls.getItem.push(key);
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      calls.setItem.push({ key, value });
      data.set(key, value);
    },
    calls,
  };
}

describe('Client Identity', () => {
  test('validates that storage has getItem and setItem functions', () => {
    assert.throws(() => getOrCreateClientIdentity(null), /storage/i);
    assert.throws(() => getOrCreateClientIdentity({}), /storage/i);
    assert.throws(() => getOrCreateClientIdentity({ getItem: () => null }), /storage/i);
    assert.throws(() => getOrCreateClientIdentity({ setItem: () => null }), /storage/i);
  });

  test('returns existing liftosaurDeviceId from storage without generating new ID', () => {
    const storage = createMockStorage({ liftosaurDeviceId: 'existing-device-uuid-123' });
    const id = getOrCreateClientIdentity(storage);

    assert.equal(id, 'existing-device-uuid-123');
    assert.equal(storage.calls.setItem.length, 0);
    assert.equal(storage.calls.getItem.length, 1);
  });

  test('handles JSON-encoded existing liftosaurDeviceId in storage', () => {
    const storage1 = createMockStorage({ liftosaurDeviceId: JSON.stringify('json-device-id-456') });
    assert.equal(getOrCreateClientIdentity(storage1), 'json-device-id-456');

    const storage2 = createMockStorage({ liftosaurDeviceId: JSON.stringify({ value: 'obj-device-id-789' }) });
    assert.equal(getOrCreateClientIdentity(storage2), 'obj-device-id-789');
  });

  test('generates, persists and returns low-cardinality ID when absent', () => {
    const storage = createMockStorage();
    const fakeNow = () => 1738274512000;
    const fakeRandom = () => 0.123456789;

    const id = getOrCreateClientIdentity(storage, { now: fakeNow, random: fakeRandom });

    assert.ok(typeof id === 'string' && id.length > 0);
    assert.equal(storage.calls.setItem.length, 1);
    assert.equal(storage.calls.setItem[0].key, 'liftosaurDeviceId');
    assert.equal(storage.calls.setItem[0].value, id);
    assert.equal(storage.getItem('liftosaurDeviceId'), id);
  });

  test('still generates a complete identity when the random source returns zero', () => {
    const storage = createMockStorage();
    const id = getOrCreateClientIdentity(storage, { now: 1, random: 0 });

    assert.match(id, /^1-[a-z0-9]{8}$/);
  });

  test('subsequent calls with recreated service and same storage return the exact same stable ID', () => {
    const storage = createMockStorage();
    let time = 1000000;
    let rand = 0.5;

    const firstId = getOrCreateClientIdentity(storage, {
      now: () => (time += 100),
      random: () => (rand += 0.1),
    });

    // Second invocation simulating service recreation
    const secondId = getOrCreateClientIdentity(storage, {
      now: () => (time += 1000),
      random: () => (rand += 0.2),
    });

    assert.equal(firstId, secondId);
    assert.equal(storage.calls.setItem.length, 1);
  });

  test('never logs the device ID to console', () => {
    const storage = createMockStorage();
    const logs = [];
    const origLog = console.log;
    const origInfo = console.info;
    const origWarn = console.warn;
    const origError = console.error;

    const capture = (...args) => {
      logs.push(args.map(String).join(' '));
    };

    console.log = capture;
    console.info = capture;
    console.warn = capture;
    console.error = capture;

    try {
      const id = getOrCreateClientIdentity(storage, {
        now: () => 1738274512000,
        random: () => 0.987654321,
      });
      for (const logLine of logs) {
        assert.doesNotMatch(logLine, new RegExp(id));
      }
    } finally {
      console.log = origLog;
      console.info = origInfo;
      console.warn = origWarn;
      console.error = origError;
    }
  });
});
