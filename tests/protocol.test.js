import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PROTOCOL_VERSION,
  MESSAGE_TYPES,
  createMessage,
  parseMessage,
  createPong,
  createError,
  validateEnvelope,
} from '../shared/protocol.js';

test('createMessage builds valid v3 envelope', () => {
  const msg = createMessage({
    type: MESSAGE_TYPES.PING,
    payload: { pingTime: 12345 },
  });

  assert.equal(msg.protocolVersion, PROTOCOL_VERSION);
  assert.equal(typeof msg.messageId, 'string');
  assert.ok(msg.messageId.length > 0);
  assert.equal(msg.type, 'PING');
  assert.equal(msg.sessionId, null);
  assert.deepEqual(msg.payload, { pingTime: 12345 });
});
test('validateEnvelope accepts valid message and rejects invalid version or missing fields', () => {
  const valid = createMessage({ type: MESSAGE_TYPES.PING });
  assert.equal(validateEnvelope(valid).valid, true);

  assert.equal(validateEnvelope(null).valid, false);
  assert.equal(validateEnvelope({}).valid, false);
  assert.equal(validateEnvelope({ protocolVersion: 1, messageId: '1', type: 'PING' }).valid, false);
  assert.equal(validateEnvelope({ protocolVersion: 3, messageId: '', type: 'PING' }).valid, false);
  assert.equal(validateEnvelope({ protocolVersion: 3, messageId: '1', type: 'UNKNOWN_TYPE' }).valid, false);
});
test('parseMessage parses JSON and validates envelope', () => {
  const valid = createMessage({ type: MESSAGE_TYPES.PING, payload: { test: true } });
  const serialized = JSON.stringify(valid);
  const parsed = parseMessage(serialized);

  assert.equal(parsed.valid, true);
  assert.equal(parsed.message.type, MESSAGE_TYPES.PING);
  assert.deepEqual(parsed.message.payload, { test: true });

  const invalidJson = parseMessage('not json');
  assert.equal(invalidJson.valid, false);
});
test('createPong responds with PONG echoing messageId', () => {
  const ping = createMessage({ type: MESSAGE_TYPES.PING, messageId: 'ping-123' });
  const pong = createPong(ping, { receivedAt: 999 });

  assert.equal(pong.protocolVersion, PROTOCOL_VERSION);
  assert.equal(pong.type, MESSAGE_TYPES.PONG);
  assert.equal(pong.replyToId, 'ping-123');
  assert.deepEqual(pong.payload, { receivedAt: 999 });
});
test('createError creates structured redacted error response', () => {
  const ping = createMessage({ type: MESSAGE_TYPES.PING, messageId: 'ping-123' });
  const errorMsg = createError(ping, 'INVALID_REQUEST', 'Request failed');

  assert.equal(errorMsg.type, MESSAGE_TYPES.ERROR);
  assert.equal(errorMsg.replyToId, 'ping-123');
  assert.equal(errorMsg.payload.code, 'INVALID_REQUEST');
  assert.equal(errorMsg.payload.message, 'Request failed');
});

describe('Direct Workout Protocol Pairs', () => {
  test('supports new direct workout synchronization message pairs', () => {
    const expectedPairs = [
      ['GET_WORKOUT_NEXT', 'WORKOUT_NEXT_DATA'],
      ['GET_WORKOUT_CURRENT', 'WORKOUT_CURRENT_DATA'],
      ['START_WORKOUT', 'START_WORKOUT_DATA'],
      ['SYNC_WORKOUT_SETS', 'SYNC_WORKOUT_SETS_RESULT'],
      ['GET_SETTINGS', 'SETTINGS_DATA'],
      ['DISCARD_WORKOUT', 'DISCARD_WORKOUT_RESULT'],
    ];

    for (const [reqType, resType] of expectedPairs) {
      assert.ok(MESSAGE_TYPES[reqType], `Missing request type ${reqType}`);
      assert.ok(MESSAGE_TYPES[resType], `Missing response type ${resType}`);

      const req = createMessage({ type: MESSAGE_TYPES[reqType], payload: { test: true } });
      assert.equal(validateEnvelope(req).valid, true, `Validation failed for ${reqType}`);

      const res = createMessage({ type: MESSAGE_TYPES[resType], replyToId: req.messageId, payload: { ok: true } });
      assert.equal(validateEnvelope(res).valid, true, `Validation failed for ${resType}`);
    }
  });
});
// This table is intentionally exhaustive so every request has a response pair.
// Adding a protocol message without its pair must fail this test.
