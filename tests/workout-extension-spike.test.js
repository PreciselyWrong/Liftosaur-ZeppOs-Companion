import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXTENSION_SPIKE_STORAGE_KEY,
  DEFAULT_SPIKE_STATE,
  deserializeSpikeState,
  serializeSpikeState,
  createSpikeSession,
  parseSportDataResult,
  parsePingResponse,
  formatPingStatus,
} from '../shared/workout-extension-spike.js';
import { MESSAGE_TYPES, createPong, createError } from '../shared/protocol.js';

test('provides a distinct non-secret storage key', () => {
  assert.equal(EXTENSION_SPIKE_STORAGE_KEY, 'liftosaur.extension.spike');
});

test('deserializes safely with fallback for null, undefined, corrupted, or migrated state', () => {
  assert.deepEqual(deserializeSpikeState(null), DEFAULT_SPIKE_STATE);
  assert.deepEqual(deserializeSpikeState(undefined), DEFAULT_SPIKE_STATE);
  assert.deepEqual(deserializeSpikeState(''), DEFAULT_SPIKE_STATE);
  assert.deepEqual(deserializeSpikeState('not valid json {'), DEFAULT_SPIKE_STATE);
  assert.deepEqual(deserializeSpikeState({}), DEFAULT_SPIKE_STATE);
  assert.deepEqual(deserializeSpikeState({ clickCount: 'invalid', startedAt: -5 }), DEFAULT_SPIKE_STATE);

  const validState = {
    clickCount: 7,
    startedAt: 1700000000000,
    pausedDuration: 12000,
    lastPausedAt: null,
  };
  const serialized = serializeSpikeState(validState);
  assert.deepEqual(deserializeSpikeState(serialized), validState);
  assert.deepEqual(deserializeSpikeState(validState), validState);
});

test('increments click counter and updates state', () => {
  const session = createSpikeSession({ clickCount: 3 });
  assert.equal(session.getState().clickCount, 3);

  const updated = session.incrementClicks();
  assert.equal(updated.clickCount, 4);
  assert.equal(session.getState().clickCount, 4);
});

test('computes absolute elapsed time and formats duration', () => {
  const session = createSpikeSession();
  assert.equal(session.getElapsedSeconds(1000), 0);
  assert.equal(session.formatElapsed(1000), '0:00');

  session.start(1000);
  assert.equal(session.getElapsedSeconds(1000), 0);
  assert.equal(session.getElapsedSeconds(15000), 14);
  assert.equal(session.formatElapsed(15000), '0:14');
  assert.equal(session.formatElapsed(75000), '1:14');
  assert.equal(session.formatElapsed(3675000), '1:01:14');
});

test('accurately accounts for pause and resume across absolute timestamps', () => {
  const session = createSpikeSession();
  session.start(1000);

  session.pause(20000);
  assert.equal(session.getElapsedSeconds(20000), 19);
  assert.equal(session.getElapsedSeconds(30000), 19);
  assert.equal(session.formatElapsed(30000), '0:19');

  session.resume(35000);
  assert.equal(session.getElapsedSeconds(35000), 19);

  assert.equal(session.getElapsedSeconds(45000), 29);
  assert.equal(session.formatElapsed(45000), '0:29');
});

test('parses sport data results defensively for duration and calories', () => {
  const durationResult = {
    code: 0,
    data: JSON.stringify([{ duration: '1:15:15', name: 'Duration' }]),
  };
  assert.deepEqual(parseSportDataResult(durationResult, 'duration'), {
    ok: true,
    value: '1:15:15',
    error: null,
  });

  const caloriesResult = {
    code: 0,
    data: JSON.stringify([{ calories: '342.5', name: 'Calories' }]),
  };
  assert.deepEqual(parseSportDataResult(caloriesResult, 'calories'), {
    ok: true,
    value: '342.5',
    error: null,
  });

  const singleObjResult = {
    code: 0,
    data: JSON.stringify({ duration: '0:45:30' }),
  };
  assert.deepEqual(parseSportDataResult(singleObjResult, 'duration'), {
    ok: true,
    value: '0:45:30',
    error: null,
  });

  assert.deepEqual(parseSportDataResult({ code: 1, data: '' }, 'duration'), {
    ok: false,
    value: null,
    error: 'Sport data unavailable',
  });

  assert.deepEqual(parseSportDataResult({ code: 0, data: '{broken' }, 'duration'), {
    ok: false,
    value: null,
    error: 'Malformed sport data',
  });

  assert.deepEqual(parseSportDataResult(null, 'duration'), {
    ok: false,
    value: null,
    error: 'Sport data unavailable',
  });

  const missingMetric = {
    code: 0,
    data: JSON.stringify([{ speed: '5.2' }]),
  };
  assert.deepEqual(parseSportDataResult(missingMetric, 'duration'), {
    ok: false,
    value: null,
    error: 'Metric not found',
  });
});

test('parses Side Service PING responses and formats status', () => {
  const pong = createPong({ messageId: 'msg-1' }, { serverTime: 1700000000000 });
  const pongParsed = parsePingResponse(pong);
  assert.deepEqual(pongParsed, {
    ok: true,
    status: 'PONG',
    serverTime: 1700000000000,
    error: null,
  });
  assert.equal(formatPingStatus(pongParsed), 'PING: OK');

  const errorMsg = createError({ messageId: 'msg-2' }, 'NOT_CONFIGURED', 'No key');
  const errorParsed = parsePingResponse(errorMsg);
  assert.deepEqual(errorParsed, {
    ok: false,
    status: 'ERROR',
    code: 'NOT_CONFIGURED',
    error: 'No key',
  });
  assert.equal(formatPingStatus(errorParsed), 'PING: ERROR');

  const failure = new Error('Transport failure');
  const failedParsed = parsePingResponse(failure);
  assert.deepEqual(failedParsed, {
    ok: false,
    status: 'FAILED',
    code: null,
    error: 'Transport failure',
  });
  assert.equal(formatPingStatus(failedParsed), 'PING: FAILED');

  assert.equal(formatPingStatus(null), 'PING: --');
});
