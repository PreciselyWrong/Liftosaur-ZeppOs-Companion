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

test('router handles GET_CURRENT_WORKOUT when unconfigured and returns configured false', async () => {
  const router = createSideRouter({
    programProvider: async () => null,
  });

  const request = createMessage({
    type: MESSAGE_TYPES.GET_CURRENT_WORKOUT,
    messageId: 'req-workout-unconf',
  });

  const response = await router.handle(request);
  assert.equal(response.type, MESSAGE_TYPES.WORKOUT_DATA);
  assert.equal(response.payload.configured, false);
  assert.equal(response.payload.workout, null);
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

test('router uses history to query playground with correct next week and day', async () => {
  let playgroundParamsReceived = null;

  const mockProgram = {
    data: {
      name: 'PPL Program',
      text: `
        # Week 1
        ## Push
        Bench Press / 3x5 / 185lb
        ## Pull
        Deadlift / 3x5 / 225lb
        ## Legs
        Squat / 3x5 / 205lb

        # Week 2
        ## Push
        Bench Press / 3x5 / 190lb
        ## Pull
        Deadlift / 3x5 / 230lb
        ## Legs
        Squat / 3x5 / 210lb
      `,
    },
  };

  const mockHistory = {
    data: {
      records: [
        {
          id: 101,
          text: '2026-08-14T10:00:00Z / program: "PPL Program" / dayName: "Push" / week: 1 / dayInWeek: 1 / duration: 3600s / exercises: { Bench Press / 3x5 185lb }',
        },
      ],
    },
  };

  const router = createSideRouter({
    programProvider: async () => mockProgram,
    historyProvider: async () => mockHistory,
    playgroundSimulator: async (params) => {
      playgroundParamsReceived = params;
      return {
        data: {
          workout: '2026-08-14T10:00:00Z / program: "PPL Program" / dayName: "Pull" / week: 1 / dayInWeek: 2 / exercises: {\n  Deadlift / 3x5 225lb / target: 3x5 225lb 180s\n}',
        },
      };
    },
  });

  const request = createMessage({
    type: MESSAGE_TYPES.GET_CURRENT_WORKOUT,
    messageId: 'req-next-workout',
  });

  const response = await router.handle(request);

  assert.equal(response.type, MESSAGE_TYPES.WORKOUT_DATA);
  assert.equal(response.payload.configured, true);
  assert.equal(response.payload.workout.name, 'Pull');
  assert.equal(response.payload.workout.exercises[0].name, 'Deadlift');
  assert.equal(response.payload.workout.exercises[0].sets[0].targetWeight, 225);

  // Verify playground was queried with Week 1, Day 2
  assert.equal(playgroundParamsReceived.week, 1);
  assert.equal(playgroundParamsReceived.day, 2);
});



