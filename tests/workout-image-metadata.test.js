import test from 'node:test';
import assert from 'node:assert/strict';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { createWorkoutSession } from '../shared/workout-session.js';
import { createWorkoutController } from '../shared/workout-controller.js';

const imageUrl = '/externalimages/exercises/single/small/squat_barbell_single_small.png';
const workout = (image = { imageUrl }) => ({
  programId: 'program', startTime: 1000,
  entries: [0, 1].map(index => ({
    entryId: `entry-${index}`, exerciseId: `exercise-${index}`, name: `Exercise ${index}`,
    ...(index === 0 ? image : { imageUrl: '/externalimages/second.png' }),
    sets: [{ setId: `set-${index}`, reps: 5, weight: '20kg', timer: 60 }],
  })),
});

test('API image metadata distinguishes omitted values from explicit null without parsing descriptions', () => {
  assert.equal(workoutToDayPlan(workout()).exercises[0].imageUrl, imageUrl);
  assert.equal(workoutToDayPlan(workout({ imageUrl: null })).exercises[0].imageUrl, null);
  assert.equal(workoutToDayPlan(workout({ description: '![](https://example.com/image.png)' })).exercises[0].imageUrl, undefined);
});

test('session exposes current and upcoming images across rest and journal recovery', () => {
  const plan = workoutToDayPlan(workout());
  const session = createWorkoutSession({ plan });
  assert.deepEqual(session.view(1000).overviewExercises.map(exercise => exercise.imageUrl), [
    imageUrl,
    '/externalimages/second.png',
  ]);
  session.startWorkout({ timestamp: 1000 });
  assert.equal(session.view(1000).exerciseImageUrl, imageUrl);
  session.completeSet({ timestamp: 2000 });
  assert.equal(session.view(2000).rest.nextExerciseImageUrl, '/externalimages/second.png');
  const restored = createWorkoutSession({ plan, initialJournal: session.getJournal() });
  assert.equal(restored.view(2000).rest.nextExerciseImageUrl, '/externalimages/second.png');
  restored.nextSet({ timestamp: 3000 });
  assert.equal(restored.view(3000).exerciseImageUrl, '/externalimages/second.png');
});

test('same-workout adoption retains omitted image metadata but accepts updates and explicit null', () => {
  const controller = createWorkoutController({ now: () => 1000 });
  controller.loadPlan(workoutToDayPlan(workout()));
  controller.startWorkout();
  controller.applyAdoptedSnapshot(workout({}));
  assert.equal(controller.view().exerciseImageUrl, imageUrl);
  controller.applyAdoptedSnapshot(workout({ imageUrl: '/externalimages/updated.png' }));
  assert.equal(controller.view().exerciseImageUrl, '/externalimages/updated.png');
  controller.applyAdoptedSnapshot(workout({ imageUrl: null }));
  assert.equal(controller.view().exerciseImageUrl, null);
  assert.equal(controller.plan().exercises[0].imageUrl, null);
});

test('startup binding uses the live image value while preserving an omitted value', async () => {
  for (const metadata of [{}, { imageUrl: null }, { imageUrl: '/externalimages/new.png' }]) {
    const controller = createWorkoutController({
      now: () => 1000,
      request: async () => ({ payload: { workout: workout(metadata) } }),
    });
    controller.loadPlan(workoutToDayPlan(workout()));
    controller.startWorkout();
    await controller.ensureStarted();
    assert.equal(controller.view().exerciseImageUrl,
      metadata.imageUrl === undefined ? imageUrl : metadata.imageUrl);
  }
});
