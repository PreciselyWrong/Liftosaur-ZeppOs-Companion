import { describe, test } from 'node:test';
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

test('forwards finish retries to the authoritative program service', async () => {
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

  assert.equal(calls, 2);
  assert.equal(first.payload.historyId, 1);
  assert.equal(second.payload.historyId, 2);
});

test('refuses a finish without the durable session identity', async () => {
  let calls = 0;
  const router = createSideRouter({
    programService: fakeService({
      finishWorkout: async () => {
        calls += 1;
        return { status: 'SAVED' };
      },
    }),
  });

  const response = await router.handle(createMessage({
    type: MESSAGE_TYPES.FINISH_WORKOUT,
    payload: { programId: 'p1', week: 1, day: 1, completedSets: [] },
  }));

  assert.equal(response.type, MESSAGE_TYPES.ERROR);
  assert.equal(calls, 0);
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

function fakeWorkoutService(overrides = {}) {
  return {
    listPrograms: async () => [{ id: 'p1', name: 'Workout Prog' }],
    getProgramOutline: async (id) => ({ programId: id, weeks: [] }),
    getNextWorkout: async (selection) => ({ workout: { id: 'next', selection } }),
    getCurrentWorkout: async () => ({ workout: { id: 'current' } }),
    startWorkout: async (payload) => ({ workout: { id: 'started', payload } }),
    syncWorkoutSets: async (sets) => ({ workout: { syncedCount: sets.length } }),
    finishWorkout: async (payload) => ({ workout: { id: payload.startTime, finished: true } }),
    discardWorkout: async (startTime) => ({ deleted: true, startTime }),
    getSettings: async () => ({ units: 'kg', timers: {} }),
    ...overrides,
  };
}

describe('Workout Service Routing', () => {
  test('returns NOT_CONFIGURED when workoutService is missing for new routes', async () => {
    const router = createSideRouter({ programService: null, workoutService: null });

    const routes = [
      createMessage({ type: MESSAGE_TYPES.GET_WORKOUT_NEXT }),
      createMessage({ type: MESSAGE_TYPES.GET_WORKOUT_CURRENT }),
      createMessage({ type: MESSAGE_TYPES.START_WORKOUT }),
      createMessage({ type: MESSAGE_TYPES.SYNC_WORKOUT_SETS, payload: { sets: [{ entryId: 'e', setId: 's' }] } }),
      createMessage({ type: MESSAGE_TYPES.GET_SETTINGS }),
      createMessage({ type: MESSAGE_TYPES.DISCARD_WORKOUT, payload: { startTime: 12345 } }),
    ];

    for (const msg of routes) {
      const res = await router.handle(msg);
      assert.equal(res.type, MESSAGE_TYPES.ERROR, `Expected error for ${msg.type}`);
      assert.equal(res.payload.code, ERROR_CODES.NOT_CONFIGURED, `Expected NOT_CONFIGURED for ${msg.type}`);
    }
  });

  test('routes GET_WORKOUT_NEXT with optional selection and enforces paired week/dayInWeek', async () => {
    const service = fakeWorkoutService();
    const router = createSideRouter({ workoutService: service });

    // Optional selection
    const emptyRes = await router.handle(createMessage({ type: MESSAGE_TYPES.GET_WORKOUT_NEXT }));
    assert.equal(emptyRes.type, MESSAGE_TYPES.WORKOUT_NEXT_DATA);

    const fullRes = await router.handle(
      createMessage({ type: MESSAGE_TYPES.GET_WORKOUT_NEXT, payload: { programId: 'p1', week: 2, dayInWeek: 1 } })
    );
    assert.equal(fullRes.type, MESSAGE_TYPES.WORKOUT_NEXT_DATA);
    assert.deepEqual(fullRes.payload.workout.selection, { programId: 'p1', week: 2, dayInWeek: 1 });

    // Missing dayInWeek when week is provided
    const invalidWeekOnly = await router.handle(
      createMessage({ type: MESSAGE_TYPES.GET_WORKOUT_NEXT, payload: { week: 2 } })
    );
    assert.equal(invalidWeekOnly.type, MESSAGE_TYPES.ERROR);
    assert.equal(invalidWeekOnly.payload.code, ERROR_CODES.INVALID_ENVELOPE);

    // Missing week when dayInWeek is provided
    const invalidDayOnly = await router.handle(
      createMessage({ type: MESSAGE_TYPES.GET_WORKOUT_NEXT, payload: { dayInWeek: 1 } })
    );
    assert.equal(invalidDayOnly.type, MESSAGE_TYPES.ERROR);
    assert.equal(invalidDayOnly.payload.code, ERROR_CODES.INVALID_ENVELOPE);

    // Non-finite week
    const nonFiniteWeek = await router.handle(
      createMessage({ type: MESSAGE_TYPES.GET_WORKOUT_NEXT, payload: { week: '2', dayInWeek: 1 } })
    );
    assert.equal(nonFiniteWeek.type, MESSAGE_TYPES.ERROR);
  });

  test('routes GET_WORKOUT_CURRENT needing no payload', async () => {
    const router = createSideRouter({ workoutService: fakeWorkoutService() });
    const res = await router.handle(createMessage({ type: MESSAGE_TYPES.GET_WORKOUT_CURRENT }));

    assert.equal(res.type, MESSAGE_TYPES.WORKOUT_CURRENT_DATA);
    assert.equal(res.payload.workout.id, 'current');
  });

  test('routes START_WORKOUT with optional selection, optional finite startTime, and paired week/day rule', async () => {
    const router = createSideRouter({ workoutService: fakeWorkoutService() });

    // Optional empty payload
    const emptyRes = await router.handle(createMessage({ type: MESSAGE_TYPES.START_WORKOUT }));
    assert.equal(emptyRes.type, MESSAGE_TYPES.START_WORKOUT_DATA);

    // Valid with selection and startTime
    const validRes = await router.handle(
      createMessage({
        type: MESSAGE_TYPES.START_WORKOUT,
        payload: { programId: 'p1', week: 1, dayInWeek: 2, startTime: 1738274512000 },
      })
    );
    assert.equal(validRes.type, MESSAGE_TYPES.START_WORKOUT_DATA);

    // Invalid: unpaired week
    const invalidWeek = await router.handle(
      createMessage({ type: MESSAGE_TYPES.START_WORKOUT, payload: { week: 1 } })
    );
    assert.equal(invalidWeek.type, MESSAGE_TYPES.ERROR);
    assert.equal(invalidWeek.payload.code, ERROR_CODES.INVALID_ENVELOPE);

    // Invalid: non-finite startTime
    const invalidStart = await router.handle(
      createMessage({ type: MESSAGE_TYPES.START_WORKOUT, payload: { startTime: 'now' } })
    );
    assert.equal(invalidStart.type, MESSAGE_TYPES.ERROR);
    assert.equal(invalidStart.payload.code, ERROR_CODES.INVALID_ENVELOPE);
  });

  test('routes SYNC_WORKOUT_SETS strictly requiring a non-empty sets array', async () => {
    const router = createSideRouter({ workoutService: fakeWorkoutService() });

    // Missing sets
    const missingSets = await router.handle(createMessage({ type: MESSAGE_TYPES.SYNC_WORKOUT_SETS }));
    assert.equal(missingSets.type, MESSAGE_TYPES.ERROR);
    assert.equal(missingSets.payload.code, ERROR_CODES.INVALID_ENVELOPE);

    // Empty sets array
    const emptySets = await router.handle(
      createMessage({ type: MESSAGE_TYPES.SYNC_WORKOUT_SETS, payload: { sets: [] } })
    );
    assert.equal(emptySets.type, MESSAGE_TYPES.ERROR);
    assert.equal(emptySets.payload.code, ERROR_CODES.INVALID_ENVELOPE);

    // Non-array sets
    const notArray = await router.handle(
      createMessage({ type: MESSAGE_TYPES.SYNC_WORKOUT_SETS, payload: { sets: 'not-an-array' } })
    );
    assert.equal(notArray.type, MESSAGE_TYPES.ERROR);

    // Valid sets
    const valid = await router.handle(
      createMessage({
        type: MESSAGE_TYPES.SYNC_WORKOUT_SETS,
        payload: { sets: [{ entryId: 'e1', setId: 's1', completed: { reps: 5 } }] },
      })
    );
    assert.equal(valid.type, MESSAGE_TYPES.SYNC_WORKOUT_SETS_RESULT);
    assert.equal(valid.payload.workout.syncedCount, 1);
  });

  test('routes GET_SETTINGS needing no payload', async () => {
    const router = createSideRouter({ workoutService: fakeWorkoutService() });
    const res = await router.handle(createMessage({ type: MESSAGE_TYPES.GET_SETTINGS }));

    assert.equal(res.type, MESSAGE_TYPES.SETTINGS_DATA);
    assert.equal(res.payload.units, 'kg');
  });

  test('routes DISCARD_WORKOUT strictly requiring finite startTime', async () => {
    const router = createSideRouter({ workoutService: fakeWorkoutService() });

    // Missing startTime
    const missing = await router.handle(createMessage({ type: MESSAGE_TYPES.DISCARD_WORKOUT }));
    assert.equal(missing.type, MESSAGE_TYPES.ERROR);
    assert.equal(missing.payload.code, ERROR_CODES.INVALID_ENVELOPE);

    // Non-finite startTime
    const nonFinite = await router.handle(
      createMessage({ type: MESSAGE_TYPES.DISCARD_WORKOUT, payload: { startTime: '123' } })
    );
    assert.equal(nonFinite.type, MESSAGE_TYPES.ERROR);

    // Valid finite startTime
    const valid = await router.handle(
      createMessage({ type: MESSAGE_TYPES.DISCARD_WORKOUT, payload: { startTime: 1738274512000 } })
    );
    assert.equal(valid.type, MESSAGE_TYPES.DISCARD_WORKOUT_RESULT);
    assert.equal(valid.payload.deleted, true);
  });

  test('FINISH_WORKOUT supports new payload format with startTime and forwards to workoutService', async () => {
    const router = createSideRouter({ workoutService: fakeWorkoutService() });

    const res = await router.handle(
      createMessage({
        type: MESSAGE_TYPES.FINISH_WORKOUT,
        payload: {
          startTime: 1738274512000,
          endTime: 1738278112000,
          notes: 'session notes',
        },
      })
    );

    assert.equal(res.type, MESSAGE_TYPES.FINISH_WORKOUT_RESULT);
    assert.equal(res.payload.workout.finished, true);
    assert.equal(res.payload.workout.id, 1738274512000);
  });

  test('FINISH_WORKOUT reports the direct contract when startTime is missing', async () => {
    const router = createSideRouter({ workoutService: fakeWorkoutService() });

    const res = await router.handle(
      createMessage({ type: MESSAGE_TYPES.FINISH_WORKOUT, payload: { endTime: 1738278112000 } })
    );

    assert.equal(res.type, MESSAGE_TYPES.ERROR);
    assert.equal(res.payload.code, ERROR_CODES.INVALID_ENVELOPE);
    assert.match(res.payload.message, /startTime must be a finite number/);
  });

  test('surfaces API error codes from workoutService calls to the watch', async () => {
    const router = createSideRouter({
      workoutService: fakeWorkoutService({
        getCurrentWorkout: async () => {
          const err = new Error('No active workout found');
          err.code = 'no_active_workout';
          throw err;
        },
      }),
    });

    const res = await router.handle(createMessage({ type: MESSAGE_TYPES.GET_WORKOUT_CURRENT }));

    assert.equal(res.type, MESSAGE_TYPES.ERROR);
    assert.equal(res.payload.code, 'no_active_workout');
    assert.match(res.payload.message, /No active workout/);
  });
});
