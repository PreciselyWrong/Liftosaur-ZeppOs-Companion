import test from 'node:test';
import assert from 'node:assert/strict';

import { createSideRouter } from '../app-side/router.js';
import { MESSAGE_TYPES, ERROR_CODES, createMessage } from '../shared/protocol.js';

const T = MESSAGE_TYPES;
const entries = [{ entryId: 'e1', sets: [] }];

// Each service answer has the wrong shape for the reply the router builds from it.
const wrongShapes = [
  [T.GET_WORKOUT_CURRENT, {}, { getCurrentWorkout: async () => ({ workout: { startTime: 5 } }) }],
  [T.GET_WORKOUT_CURRENT, {}, { getCurrentWorkout: async () => ({ workout: { entries } }) }],
  [T.GET_WORKOUT_NEXT, {}, { getNextWorkout: async () => ({ workout: { entries: {} } }) }],
  [T.START_WORKOUT, { startTime: 5 }, { startWorkout: async () => ({ workout: { startTime: 5 } }) }],
  [T.LIST_PROGRAMS, {}, { listPrograms: async () => ({ programs: [] }) }],
  [T.GET_PROGRAM_OUTLINE, { programId: 'p' }, { getProgramOutline: async () => ({ programId: 'p' }) }],
  [T.FINISH_WORKOUT, { startTime: 5 }, { finishWorkout: async () => null }],
  [T.DISCARD_WORKOUT, { startTime: 5 }, { discardWorkout: async () => 'deleted' }],
];

for (const [type, payload, service] of wrongShapes) {
  test(`a ${type} reply of the wrong shape leaves the phone as a logged retryable error`, async () => {
    const logs = [];
    const router = createSideRouter({ workoutService: service, log: (...args) => logs.push(args) });
    const reply = await router.handle(createMessage({ type, payload }));

    assert.equal(reply.type, T.ERROR);
    assert.equal(reply.payload.code, ERROR_CODES.API_FAILED);
    assert.equal(logs.length, 1);
  });
}

test('valid replies leave the router unchanged', async () => {
  const router = createSideRouter({
    workoutService: {
      getCurrentWorkout: async () => ({ workout: { startTime: 5, entries } }),
      syncWorkoutSets: async () => ({ workout: { startTime: 5, entries } }),
    },
    log: () => assert.fail('nothing to log'),
  });
  const current = await router.handle(createMessage({ type: T.GET_WORKOUT_CURRENT }));
  assert.deepEqual(current.payload, { workout: { startTime: 5, entries } });
  const synced = await router.handle(createMessage({ type: T.SYNC_WORKOUT_SETS, payload: { sets: [{ setId: 's' }] } }));
  assert.deepEqual(synced.payload, { workout: { startTime: 5 } });
});
