import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkoutController } from '../shared/workout-controller.js';
import { createMemoryStorageAdapter, createSessionStore } from '../shared/session-storage.js';
import { SESSION_STATES } from '../shared/workout-session.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';
import { buildApiWorkout, createFakeCloud, createPhoneLink, flush } from './helpers/phone-harness.js';

async function startDirectWorkout(shape, { time = () => 1_000_000, auto = true } = {}) {
  const cloud = createFakeCloud(buildApiWorkout(shape));
  const link = createPhoneLink(cloud);
  link.setAuto(auto);
  const store = createSessionStore(createMemoryStorageAdapter());
  const controller = createWorkoutController({ store, request: link.request, now: time });
  const next = await link.phoneHandle(MESSAGE_TYPES.GET_WORKOUT_NEXT, {});
  controller.loadPlan(workoutToDayPlan(next.payload.workout), { clearStore: true });
  controller.startWorkout();
  await flush();
  return { cloud, link, store, controller };
}

function writtenSetIds(controller) {
  return [...new Set(controller.getWorkoutSetWrites().map((write) => write.setId))];
}

test('a refresh after skipping a warmup keeps the work set logged after it', async () => {
  let time = 1_000_000;
  const { cloud, controller } = await startDirectWorkout([[1, 2], [0, 1]], { time: () => time });

  assert.equal(controller.skipWarmup(), true);
  controller.completeSet();
  await flush();
  assert.deepEqual(cloud.completedSets().map((set) => set.setId), ['live1-entry-1-work-1']);

  time += 30_000;
  controller.nextSet();
  await flush();

  assert.deepEqual(writtenSetIds(controller), ['live1-entry-1-work-1']);
  assert.equal(controller.sync().acknowledgedSetCount, 1);
  assert.equal(controller.view().currentSet.setId, 'live1-entry-1-work-2');
});

test('a finish retry after a lost reply reports the missing phone workout and keeps the session', async () => {
  const { cloud, link, store, controller } = await startDirectWorkout([[0, 1]], { auto: false });
  await link.deliver(0, 'ok');
  await flush();
  controller.completeSet();
  await flush();
  await link.deliver(0, 'ok');
  await flush();

  const first = controller.finishWorkoutRemote().catch((err) => err);
  await flush();
  await link.deliver(0, 'noReply');
  assert.equal((await first).code, 'NETWORK');
  assert.equal(cloud.history.length, 1);

  const retry = controller.finishWorkoutRemote().catch((err) => err);
  await flush();
  await link.deliver(0, 'ok');
  assert.equal((await retry).code, 'no_active_workout');

  assert.equal(controller.sync().remoteMissing, true);
  assert.equal(controller.status().code, 'remote-missing');
  assert.notEqual(store.load(), null);
});
