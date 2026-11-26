/**
 * A poll adopts the phone's running workout only when it differs from the last one the
 * watch received, so an idle lifter does not pay a full rebuild and save every poll.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkoutController, workoutSignature } from '../shared/workout-controller.js';
import { createMemoryStorageAdapter, createSessionStore } from '../shared/session-storage.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';
import { buildApiWorkout, createFakeCloud, createPhoneLink, flush } from './helpers/phone-harness.js';

const POLL_GAP_MS = 10 * 60_000;

async function startedOnline() {
  const cloud = createFakeCloud(buildApiWorkout([[0, 3], [0, 3]]));
  const link = createPhoneLink(cloud);
  link.setAuto(true);
  let time = 1_000_000;
  const controller = createWorkoutController({
    store: createSessionStore(createMemoryStorageAdapter()),
    request: link.request,
    now: () => time,
  });
  const next = await link.phoneHandle(MESSAGE_TYPES.GET_WORKOUT_NEXT, {});
  controller.loadPlan(workoutToDayPlan(next.payload.workout), { clearStore: true });
  controller.startWorkout();
  await controller.ensureStarted();
  await flush();
  const poll = async () => {
    time += POLL_GAP_MS;
    const adopted = await controller.pollCurrent();
    await flush();
    return adopted;
  };
  return { cloud, controller, poll };
}

test('a poll adopts the running workout once and ignores it while unchanged', async () => {
  const { poll } = await startedOnline();
  assert.equal(await poll(), true);
  assert.equal(await poll(), false);
  assert.equal(await poll(), false);
});

test('a poll adopts a phone edit that keeps the serialised length', async () => {
  const { cloud, controller, poll } = await startedOnline();
  await poll();
  const edited = cloud.current();
  edited.entries[1].sets[2].weight = '71kg';
  cloud.setCurrent(edited);
  assert.equal(await poll(), true);
  assert.equal(controller.plan().exercises[1].sets[2].targetWeight, 71);
  assert.equal(await poll(), false);
});

test('workout signatures tell apart every single-set edit of a workout', () => {
  const workout = buildApiWorkout([[2, 6], [2, 6], [0, 6], [1, 6], [0, 6], [0, 6], [0, 6]]);
  assert.equal(workoutSignature(JSON.parse(JSON.stringify(workout))), workoutSignature(workout));
  const seen = new Set([workoutSignature(workout)]);
  let edits = 0;
  for (const entry of workout.entries) {
    for (const set of [...entry.warmupSets, ...entry.sets]) {
      for (const [field, value] of [['weight', '99kg'], ['reps', 6], ['completed', { reps: 5, weight: '60kg' }]]) {
        const previous = set[field];
        set[field] = value;
        seen.add(workoutSignature(workout));
        edits += 1;
        set[field] = previous;
      }
    }
  }
  assert.equal(seen.size, 1 + edits);
});
