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

test('router handles GET_CURRENT_WORKOUT and returns parsed workout data', async () => {
  const router = createSideRouter({
    programProvider: async () => ({
      id: 'prog-1',
      name: 'Week 1 - Workout A',
      routineName: 'Basic Beginner Routine',
      text: 'Bench Press, Barbell / 3x5 @ 60kg / rest 90s',
    }),
  });

  const request = createMessage({
    type: MESSAGE_TYPES.GET_CURRENT_WORKOUT,
    messageId: 'req-workout-1',
  });

  const response = await router.handle(request);

  assert.equal(response.type, MESSAGE_TYPES.WORKOUT_DATA);
  assert.equal(response.replyToId, 'req-workout-1');
  assert.equal(response.payload.workout.name, 'Week 1 - Workout A');
  assert.equal(response.payload.workout.exercises.length, 1);
  assert.equal(response.payload.workout.exercises[0].name, 'Bench Press, Barbell');
});

