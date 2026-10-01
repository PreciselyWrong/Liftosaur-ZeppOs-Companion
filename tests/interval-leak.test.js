import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkoutController } from '../shared/workout-controller.js';
import { createMemoryStorageAdapter, createSessionStore } from '../shared/session-storage.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';

const openPolicy = { beginPoll: () => true, markSuccess() {}, markFailure() {}, markAuthoritativeResponse() {}, request() {} };

// A phone that logs each set and answers with the whole workout, so every synced set is adopted.
function session({ sets = 30 } = {}) {
  const server = {
    programId: 'p', programName: 'P', dayName: 'D', dayData: { week: 1, dayInWeek: 1 }, startTime: 1000,
    entries: [{
      entryId: 'e0', exerciseId: 'Squat', name: 'Squat', warmupSets: [],
      sets: Array.from({ length: sets }, (_, index) => ({ index, setId: `s${index}`, weight: '60kg', reps: 5, timer: 60, completed: null })),
    }],
  };
  let clock = 1000;
  const finished = [];
  const request = async (type, payload) => {
    if (type === MESSAGE_TYPES.FINISH_WORKOUT) {
      finished.push(payload);
      return { payload: { status: 'SAVED' } };
    }
    for (const write of payload?.sets || []) {
      server.entries[0].sets.find((set) => set.setId === write.setId).completed = write.completed;
    }
    return { payload: { workout: structuredClone(server) } };
  };
  const controller = createWorkoutController({
    now: () => clock, store: createSessionStore(createMemoryStorageAdapter()), request, refreshPolicy: openPolicy,
  });
  controller.loadPlan(workoutToDayPlan(server), { sync: { mode: 'DIRECT' } });
  controller.startWorkout();
  return {
    controller,
    finished,
    advance: (ms) => { clock += ms; },
    async logSet() {
      clock += 60_000;
      controller.completeSet();
      await controller.syncSets();
      clock += 90_000;
      controller.nextSet();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test('synced sets do not grow the preserved workout time', async () => {
  const workout = session();
  for (let set = 0; set < 30; set++) await workout.logSet();
  assert.ok(workout.controller.sync().preservedIntervals.length <= 1,
    `${workout.controller.sync().preservedIntervals.length} intervals after 30 sets without a pause`);
});

test('a pause stays one gap however many sets are synced around it', async () => {
  const workout = session();
  for (let set = 0; set < 10; set++) await workout.logSet();
  workout.controller.pauseWorkout();
  workout.advance(300_000);
  workout.controller.resumeWorkout();
  for (let set = 0; set < 10; set++) await workout.logSet();
  const intervals = workout.controller.sync().preservedIntervals;
  assert.ok(intervals.length <= 2, `${intervals.length} intervals around one pause`);
  for (let index = 1; index < intervals.length; index++) {
    assert.ok(intervals[index][0] > intervals[index - 1][1], 'intervals stay separated by the pause');
  }
});
