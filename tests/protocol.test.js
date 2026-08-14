import test from 'node:test';
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

test('createMessage builds valid v2 envelope', () => {
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
  assert.equal(validateEnvelope({ protocolVersion: 2, messageId: '', type: 'PING' }).valid, false);
  assert.equal(validateEnvelope({ protocolVersion: 2, messageId: '1', type: 'UNKNOWN_TYPE' }).valid, false);
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
