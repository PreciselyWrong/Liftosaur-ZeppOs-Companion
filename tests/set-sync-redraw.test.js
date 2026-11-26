import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkoutController } from '../shared/workout-controller.js';
import { createMemoryStorageAdapter, createSessionStore } from '../shared/session-storage.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';
import { buildApiWorkout, createFakeCloud, createPhoneLink, flush } from './helpers/phone-harness.js';

// On an Active 2 each controller notification costs a full Workout redraw of about half a second,
// so a reply that changes nothing on screen must not ask for one while the lifter keeps tapping.
async function startedWorkout() {
  const cloud = createFakeCloud(buildApiWorkout([[0, 3], [0, 3]]));
  const link = createPhoneLink(cloud);
  link.setAuto(true);
  const store = createSessionStore(createMemoryStorageAdapter());
  const notices = [];
  const controller = createWorkoutController({
    store,
    request: link.request,
    onChange: () => notices.push('change'),
    onStatus: (status) => notices.push(status.code),
  });
  const next = await link.phoneHandle(MESSAGE_TYPES.GET_WORKOUT_NEXT, {});
  controller.loadPlan(workoutToDayPlan(next.payload.workout), { clearStore: true });
  controller.startWorkout();
  await flush();
  link.setAuto(false);
  return { cloud, link, store, controller, notices };
}

test('An acknowledged set sync that changes nothing on screen asks for no redraw', async () => {
  const { link, store, controller, notices } = await startedWorkout();
  controller.completeSet();
  controller.syncSets();
  await flush();
  notices.length = 0;
  await link.deliver(0, 'ok');
  await flush();
  assert.deepEqual(notices, []);
  assert.equal(controller.getPendingSetCount(), 0);
  assert.equal(store.load().sync.acknowledgedSetCount, 1, 'the acknowledgement is still saved on the watch');
});

test('A set sync that recovers from a failure still reports the cleared status', async () => {
  const { link, controller, notices } = await startedWorkout();
  controller.completeSet();
  controller.syncSets().catch(() => {});
  await flush();
  await link.deliver(0, 'lost');
  await flush();
  notices.length = 0;
  controller.syncSets();
  await flush();
  await link.deliver(0, 'ok');
  await flush();
  assert.deepEqual(notices, ['idle']);
});
