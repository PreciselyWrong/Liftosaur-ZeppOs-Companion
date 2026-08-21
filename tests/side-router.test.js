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
  assert.equal(res.payload.serviceMode, 'CLOUD');
});

test('identifies the demo program source explicitly', async () => {
  const router = createSideRouter({ programService: fakeService({ mode: 'DEMO' }) });
  const res = await router.handle(createMessage({ type: MESSAGE_TYPES.LIST_PROGRAMS }));

  assert.equal(res.payload.serviceMode, 'DEMO');
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

test('abandoning is local and needs no API key', async () => {
  let abandoned = null;
  const router = createSideRouter({
    programService: null,
    workoutAbandoner: async (payload) => {
      abandoned = payload;
    },
  });

  const res = await router.handle(
    createMessage({ type: MESSAGE_TYPES.ABANDON_WORKOUT, payload: { dayName: 'Day 1' } })
  );

  assert.equal(res.type, MESSAGE_TYPES.ABANDON_WORKOUT_RESPONSE);
  assert.equal(res.payload.abandoned, true);
  assert.equal(abandoned.dayName, 'Day 1');
});
