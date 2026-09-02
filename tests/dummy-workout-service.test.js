import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { createDummyProgramService } from '../app-side/dummy-program-service.js';
import { createDummyWorkoutService } from '../app-side/dummy-workout-service.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';

test('dummy workout service exposes the direct Workout contract from shared demo plans', async () => {
  const service = createDummyWorkoutService({
    catalogService: createDummyProgramService(),
    now: () => 1_725_000_000_000,
  });

  assert.equal(service.mode, 'DEMO');
  assert.equal((await service.listPrograms()).length, 3);
  assert.equal((await service.getProgramOutline('dummy-gzclp')).programId, 'dummy-gzclp');
  assert.deepEqual(await service.getSettings(), { units: 'kg' });
  assert.deepEqual(await service.getCurrentWorkout(), { workout: null });

  const response = await service.getNextWorkout();
  const plan = workoutToDayPlan(response.workout, { units: 'kg' });

  assert.equal(plan.week, 1);
  assert.equal(plan.dayInWeek, 2);
  assert.ok(plan.exercises.length >= 3);
  assert.ok(plan.exercises[0].entryId);
  assert.ok(plan.exercises[0].sets[0].setId);
  assert.equal(plan.exercises[0].warmupSets[0].isWarmup, true);
});

test('dummy workout service keeps direct start, set sync, finish and discard local', async () => {
  const service = createDummyWorkoutService({
    catalogService: createDummyProgramService(),
    now: () => 1_725_000_000_000,
  });
  const startTime = 1_725_000_123_000;
  const started = await service.startWorkout({
    programId: 'dummy-gzclp',
    week: 1,
    dayInWeek: 1,
    startTime,
  });
  const entry = started.workout.entries[0];
  const set = entry.sets[0];

  assert.equal(started.workout.startTime, startTime);
  assert.equal((await service.getCurrentWorkout()).workout.startTime, startTime);

  const synced = await service.syncWorkoutSets([
    {
      entryId: entry.entryId,
      setId: set.setId,
      completed: { reps: 5, weight: '80kg', rpe: 8 },
    },
  ]);
  assert.deepEqual(synced.workout.entries[0].sets[0].completed, {
    reps: 5,
    weight: '80kg',
    rpe: 8,
  });

  const finished = await service.finishWorkout({ startTime, endTime: startTime + 60_000 });
  assert.equal(finished.status, 'SAVED');
  assert.equal(finished.mode, 'DEMO');
  assert.deepEqual(await service.getCurrentWorkout(), { workout: null });

  await service.startWorkout({ programId: 'dummy-gzclp', week: 1, dayInWeek: 1, startTime });
  assert.deepEqual(await service.discardWorkout(startTime), { deleted: true, mode: 'DEMO' });
  assert.deepEqual(await service.getCurrentWorkout(), { workout: null });
});

test('Side Service wires the dummy Workout service when no API key exists', () => {
  const source = fs.readFileSync(new URL('../app-side/index.js', import.meta.url), 'utf8');

  assert.match(source, /createDummyWorkoutService/);
  assert.match(source, /cachedWorkoutService\s*=\s*createDummyWorkoutService/);
});
