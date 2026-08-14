import test from 'node:test';
import assert from 'node:assert/strict';

import { createSideRouter } from '../app-side/router.js';
import { MESSAGE_TYPES, ERROR_CODES, createMessage } from '../shared/protocol.js';

function fakeService(overrides = {}) {
  return {
    listPrograms: async () => [{ id: 'p1', name: 'Test', isCurrent: true }],
    getProgramOutline: async (programId) => ({ programId, weeks: [], totalWeeks: 0 }),
    getDayPlan: async (programId, week, day) => ({ programId, week, dayInWeek: day, exercises: [] }),
    finishWorkout: async () => ({ status: 'SAVED', historyId: 1, programUpdated: true }),
    syncProgress: async () => ({ synced: true, historyId: 7, created: true }),
    discardWorkout: async () => ({ discarded: true, historyId: 7 }),
    ...overrides,
  };
}

test('rejects an envelope from an older protocol', async () => {
  const router = createSideRouter({ programService: fakeService() });
  const res = await router.handle({ protocolVersion: 1, messageId: 'x', type: 'PING' });

  assert.equal(res.type, MESSAGE_TYPES.ERROR);
  assert.equal(res.payload.code, ERROR_CODES.INVALID_ENVELOPE);
});

test('answers a ping without needing an API key', async () => {
  const router = createSideRouter({ programService: null });
  const res = await router.handle(createMessage({ type: MESSAGE_TYPES.PING }));

  assert.equal(res.type, MESSAGE_TYPES.PONG);
});

test('says so plainly when no API key is configured', async () => {
  const router = createSideRouter({ programService: null });
  const res = await router.handle(createMessage({ type: MESSAGE_TYPES.LIST_PROGRAMS }));

  assert.equal(res.type, MESSAGE_TYPES.ERROR);
  assert.equal(res.payload.code, ERROR_CODES.NOT_CONFIGURED);
});

test('returns the program list', async () => {
  const router = createSideRouter({ programService: fakeService() });
  const res = await router.handle(createMessage({ type: MESSAGE_TYPES.LIST_PROGRAMS }));

  assert.equal(res.type, MESSAGE_TYPES.PROGRAMS_DATA);
  assert.equal(res.payload.programs.length, 1);
});

test('requires a programId for an outline', async () => {
  const router = createSideRouter({ programService: fakeService() });
  const res = await router.handle(createMessage({ type: MESSAGE_TYPES.GET_PROGRAM_OUTLINE }));

  assert.equal(res.type, MESSAGE_TYPES.ERROR);
  assert.match(res.payload.message, /programId/);
});

test('requires a program, a week and a day for a plan', async () => {
  const router = createSideRouter({ programService: fakeService() });

  const missing = await router.handle(
    createMessage({ type: MESSAGE_TYPES.GET_DAY_PLAN, payload: { programId: 'p1', week: 1 } })
  );
  assert.equal(missing.type, MESSAGE_TYPES.ERROR);

  const ok = await router.handle(
    createMessage({ type: MESSAGE_TYPES.GET_DAY_PLAN, payload: { programId: 'p1', week: 2, day: 3 } })
  );
  assert.equal(ok.type, MESSAGE_TYPES.DAY_PLAN_DATA);
  assert.equal(ok.payload.week, 2);
  assert.equal(ok.payload.dayInWeek, 3);
});

test('surfaces the API error code to the watch', async () => {
  const router = createSideRouter({
    programService: fakeService({
      getDayPlan: async () => {
        const err = new Error('Asked for week 1 day 1, playground answered week 1 day 2');
        err.code = 'DAY_MISMATCH';
        throw err;
      },
    }),
  });

  const res = await router.handle(
    createMessage({ type: MESSAGE_TYPES.GET_DAY_PLAN, payload: { programId: 'p1', week: 1, day: 1 } })
  );

  assert.equal(res.type, MESSAGE_TYPES.ERROR);
  assert.equal(res.payload.code, 'DAY_MISMATCH');
});

test('a retried finish returns the first result instead of committing twice', async () => {
  let calls = 0;
  const router = createSideRouter({
    programService: fakeService({
      finishWorkout: async () => {
        calls += 1;
        return { status: 'SAVED', historyId: calls };
      },
    }),
  });

  const payload = { programId: 'p1', week: 1, day: 1, startedAt: 1755000000000, completedSets: [] };

  const first = await router.handle(createMessage({ type: MESSAGE_TYPES.FINISH_WORKOUT, payload }));
  const second = await router.handle(createMessage({ type: MESSAGE_TYPES.FINISH_WORKOUT, payload }));

  assert.equal(calls, 1);
  assert.equal(first.payload.historyId, 1);
  assert.deepEqual(second.payload, first.payload);
});

test('forwards a progress sync', async () => {
  let received = null;
  const router = createSideRouter({
    programService: fakeService({
      syncProgress: async (payload) => {
        received = payload;
        return { synced: true, historyId: 7, created: true };
      },
    }),
  });

  const res = await router.handle(
    createMessage({
      type: MESSAGE_TYPES.SYNC_PROGRESS,
      payload: { programId: 'p1', week: 1, day: 1, startedAt: 1000, completedSets: [] },
    })
  );

  assert.equal(res.type, MESSAGE_TYPES.SYNC_PROGRESS_RESULT);
  assert.equal(res.payload.historyId, 7);
  assert.equal(received.startedAt, 1000);
});

test('abandoning also deletes the live record', async () => {
  let abandoned = null;
  let discarded = null;
  const router = createSideRouter({
    programService: fakeService({
      discardWorkout: async (payload) => {
        discarded = payload;
        return { discarded: true, historyId: 7 };
      },
    }),
    workoutAbandoner: async (payload) => {
      abandoned = payload;
    },
  });

  const res = await router.handle(
    createMessage({
      type: MESSAGE_TYPES.ABANDON_WORKOUT,
      payload: { dayName: 'Day 1', startedAt: 1000 },
    })
  );

  assert.equal(res.type, MESSAGE_TYPES.ABANDON_WORKOUT_RESPONSE);
  assert.equal(res.payload.discarded, true);
  assert.equal(abandoned.dayName, 'Day 1');
  assert.equal(discarded.startedAt, 1000);
});

test('abandoning still answers when no API key is configured', async () => {
  const router = createSideRouter({ programService: null });
  const res = await router.handle(
    createMessage({ type: MESSAGE_TYPES.ABANDON_WORKOUT, payload: { startedAt: 1000 } })
  );

  assert.equal(res.type, MESSAGE_TYPES.ABANDON_WORKOUT_RESPONSE);
  assert.equal(res.payload.discarded, false);
});
