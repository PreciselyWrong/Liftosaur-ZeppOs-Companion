import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGetReadySeconds } from '../shared/timed-settings.js';
import { createWorkoutService } from '../app-side/workout-service.js';
import { createDummyWorkoutService } from '../app-side/dummy-workout-service.js';
import { createDummyProgramService } from '../app-side/dummy-program-service.js';

test('local countdown accepts supported Select storage shapes and rejects missing or invalid values', () => {
  for (const seconds of [0, 3, 5, 10]) {
    for (const value of [seconds, String(seconds), { value: String(seconds) }, JSON.stringify({ value: String(seconds) })]) {
      assert.equal(normalizeGetReadySeconds(value), seconds);
    }
  }
  for (const value of [undefined, null, '', false, true, -1, 2, 11, {}, 'null']) {
    assert.equal(normalizeGetReadySeconds(value), 5);
  }
});

test('cloud and demo transport the normalized local countdown independently of remote settings', async () => {
  for (const value of [undefined, 0, 3, 10, 'invalid']) {
    const getLocalSettings = () => ({ getReadySeconds: value });
    const cloud = createWorkoutService({ client: { getSettings: async () => ({ units: 'lb', getReadySeconds: 99 }) }, getLocalSettings });
    const demo = createDummyWorkoutService({ catalogService: createDummyProgramService(), getLocalSettings });
    assert.equal((await cloud.getSettings()).getReadySeconds, normalizeGetReadySeconds(value));
    assert.equal((await demo.getSettings()).getReadySeconds, normalizeGetReadySeconds(value));
  }
});

test('demo day two offers bilateral and unilateral timed sets with duration round trips', async () => {
  const demo = createDummyWorkoutService({ catalogService: createDummyProgramService() });
  const { workout } = await demo.startWorkout({ programId: 'dummy-gzclp', week: 1, dayInWeek: 2 });
  assert.equal(workout.entries[0].name, 'Overhead Press');
  const side = workout.entries.find((entry) => entry.name === 'Side Plank');
  const plank = workout.entries.find((entry) => entry.name === 'Plank');
  assert.equal(side.sets[0].isUnilateral, true);
  assert.equal(side.sets[0].setTimer, 30);
  assert.equal(plank.sets[0].isUnilateral, false);
  assert.equal(plank.sets[0].setTimer, 30);
  const completed = { reps: 1, repsLeft: 1, setTimerLeft: 24, setTimer: 32 };
  const synced = await demo.syncWorkoutSets([{ entryId: side.entryId, setId: side.sets[0].setId, completed }]);
  assert.deepEqual(synced.workout.entries.find((entry) => entry.entryId === side.entryId).sets[0].completed, completed);
});
