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

test('router handles SYNC_JOURNAL and reconciles workout', async () => {
  const router = createSideRouter({
    playgroundSimulator: async () => ({
      success: true,
      updatedPrescription: [{ targetWeight: 62.5, targetReps: 5 }],
    }),
  });

  const request = createMessage({
    type: MESSAGE_TYPES.SYNC_JOURNAL,
    messageId: 'sync-1',
    payload: {
      journal: [{ type: 'COMPLETE_SET', timestamp: 1000 }],
    },
  });

  const response = await router.handle(request);
  assert.equal(response.type, MESSAGE_TYPES.SYNC_JOURNAL_RESPONSE);
  assert.equal(response.replyToId, 'sync-1');
  assert.equal(response.payload.synced, true);
});

test('router handles SUBMIT_WORKOUT_HISTORY idempotently', async () => {
  let submittedCount = 0;
  const router = createSideRouter({
    historySubmitter: async (history) => {
      submittedCount++;
      return { id: 'hist-1', status: 'saved' };
    },
  });

  const request = createMessage({
    type: MESSAGE_TYPES.SUBMIT_WORKOUT_HISTORY,
    messageId: 'submit-1',
    payload: {
      startedAt: 10000,
      completedAt: 20000,
      totalVolume: 1500,
    },
  });

  const response = await router.handle(request);
  assert.equal(response.type, MESSAGE_TYPES.SUBMIT_WORKOUT_HISTORY_RESPONSE);
  assert.equal(response.payload.status, 'saved');
  assert.equal(submittedCount, 1);
});


