import test from 'node:test';
import assert from 'node:assert/strict';

import { createMessage, MESSAGE_TYPES } from '../shared/protocol.js';
import { createSideRouter } from '../app-side/router.js';

test('router handles PING and responds with PONG', async () => {
  const router = createSideRouter();
  const ping = createMessage({
    type: MESSAGE_TYPES.PING,
    messageId: 'msg-1',
    payload: { timestamp: 1000 },
  });

  const response = await router.handle(ping);

  assert.equal(response.type, MESSAGE_TYPES.PONG);
  assert.equal(response.replyToId, 'msg-1');
  assert.equal(typeof response.payload.serverTime, 'number');
});

test('router handles invalid envelope with structured ERROR', async () => {
  const router = createSideRouter();
  const invalid = { protocolVersion: 999 };

  const response = await router.handle(invalid);

  assert.equal(response.type, MESSAGE_TYPES.ERROR);
  assert.equal(response.payload.code, 'INVALID_ENVELOPE');
});

test('router handles unknown message type with structured ERROR', async () => {
  const router = createSideRouter();
  const msg = {
    protocolVersion: 1,
    messageId: 'msg-2',
    type: 'SOME_UNSUPPORTED_TYPE',
  };

  const response = await router.handle(msg);

  assert.equal(response.type, MESSAGE_TYPES.ERROR);
  assert.equal(response.payload.code, 'INVALID_ENVELOPE');
});
