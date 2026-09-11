import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkoutController } from '../shared/workout-controller.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { createSessionStore } from '../shared/session-storage.js';
import { createLiftosaurApiClient } from '../app-side/liftosaur-api-client.js';

const workout = () => ({
  programId: 'timer-program', startTime: 1000, dayData: { week: 1, dayInWeek: 1 },
  entries: [{ entryId: 'side-plank', exerciseId: 'side-plank', name: 'Side Plank',
    sets: [1, 2].map(index => ({ setId: `hold-${index}`, index: index - 1,
      reps: 1, weight: '10kg', timer: 60, setTimer: 30, isUnilateral: true, completed: null })) }],
});

function fixture() {
  let clock = 1000;
  let saved = null;
  let writes = 0;
  const store = createSessionStore({ read: () => saved,
    write: value => { saved = value; writes++; }, remove: () => { saved = null; } });
  const makeController = () => createWorkoutController({ store, now: () => clock });
  const controller = makeController();
  controller.loadPlan(workoutToDayPlan(workout(), { isCurrent: true }), {
    sync: { mode: 'DIRECT', startConfirmed: true }, persist: true,
  });
  controller.configureTimedSets({ getReadySeconds: 0 });
  return { controller, makeController, at: value => { clock = value; }, writes: () => writes };
}

test('review: asymmetric sides survive full store recovery and the HTTP wire contract', async () => {
  const f = fixture();
  f.controller.startTimedSet();
  f.at(18500);
  f.controller.stopTimedSide();
  assert.equal(f.controller.getWorkoutSetWrites().length, 0);
  const recovered = f.makeController();
  assert.equal(recovered.restore().success, true);
  assert.equal(recovered.view().timedSet.side, 'RIGHT');
  assert.equal(recovered.view().timedSet.completedLeftSeconds, 17);
  f.at(41500);
  recovered.stopTimedSide();
  const completed = recovered.getWorkoutSetWrites()[0].completed;
  assert.equal(completed.setTimerLeft, 17);
  assert.equal(completed.setTimer, 23);
  assert.equal(completed.weight, '10kg');
  assert.equal(recovered.view().state, 'REST');
  let body;
  const client = createLiftosaurApiClient({
    apiKey: 'test-key', deviceId: 'test-watch', clientName: 'test-client',
    fetcher: async (url, options) => {
      assert.equal(url, 'https://www.liftosaur.com/api/v1/workout/sets');
      body = JSON.parse(options.body);
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { workout: workout() } }) };
    },
  });
  await client.logWorkoutSets(recovered.getWorkoutSetWrites());
  assert.deepEqual(body.sets[0].completed, completed);
  assert.equal(body.sets[0].entryId, 'side-plank');
  assert.equal(body.sets[0].setId, 'hold-1');
});

test('review: repaint ticks do not write storage or complete an overdue effort', () => {
  const f = fixture();
  f.controller.startTimedSet();
  const writes = f.writes();
  for (let i = 0; i < 500; i++) {
    f.at(1000 + i * 250);
    f.controller.advanceTimedSet();
    f.controller.view();
  }
  assert.equal(f.writes(), writes);
  assert.equal(f.controller.getWorkoutSetWrites().length, 0);
  assert.equal(f.controller.view().timedSet.side, 'LEFT');
});

test('review: stale same-workout snapshot cannot erase a completed left side', () => {
  const f = fixture();
  f.controller.startTimedSet();
  f.at(31000);
  f.controller.stopTimedSide();
  f.controller.applyAdoptedSnapshot(workout());
  assert.equal(f.controller.view().timedSet.side, 'RIGHT');
  assert.equal(f.controller.view().timedSet.completedLeftSeconds, 30);
  f.at(51000);
  f.controller.stopTimedSide();
  assert.equal(f.controller.getWorkoutSetWrites()[0].completed.setTimer, 20);
});

test('review: phone-completed asymmetric durations survive API mapping and session recovery', () => {
  const remote = workout();
  remote.entries[0].sets[0].completed = {
    reps: 1, repsLeft: 1, weight: '10kg', setTimerLeft: 18, setTimer: 26,
  };
  const controller = createWorkoutController();
  controller.loadPlan(workoutToDayPlan(remote, { isCurrent: true }));
  const value = controller.getWorkoutSetWrites()[0].completed;
  assert.equal(value.setTimerLeft, 18);
  assert.equal(value.setTimer, 26);
  assert.equal(controller.view().currentSet.setId, 'hold-2');
});
