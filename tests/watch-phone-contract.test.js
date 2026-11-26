import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkoutController } from '../shared/workout-controller.js';
import { createMemoryStorageAdapter, createSessionStore } from '../shared/session-storage.js';
import { SESSION_STATES } from '../shared/workout-session.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';
import { buildApiWorkout, createFakeCloud, createPhoneLink, flush } from './helpers/phone-harness.js';

async function startDirectWorkout(shape, { time = () => 1_000_000, auto = true, cloudOptions = {} } = {}) {
  const cloud = createFakeCloud(buildApiWorkout(shape), cloudOptions);
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

for (const [label, strip] of [
  ['without entries', (workout) => { delete workout.entries; }],
  ['with no entries', (workout) => { workout.entries = []; }],
]) {
  test(`a current workout reply ${label} keeps the running plan and its sets`, async () => {
    let time = 1_000_000;
    const { cloud, controller } = await startDirectWorkout([[0, 2], [0, 1]], { time: () => time });
    controller.completeSet();
    await flush();
    time += 200_000;
    controller.nextSet();
    await flush();
    const exerciseCount = controller.plan().exercises.length;

    const reduced = structuredClone(cloud.current());
    strip(reduced);
    cloud.setCurrent(reduced);
    time += 200_000;
    controller.requestRefresh();
    await flush();

    assert.equal(controller.view().state, SESSION_STATES.ACTIVE_SET);
    assert.equal(controller.plan().exercises.length, exerciseCount);
    assert.equal(controller.getWorkoutSetWrites().length, 1);

    const adopted = await controller.adoptCurrent({ preserveNavigation: false });
    assert.equal(adopted.success, false);
    assert.equal(controller.view().state, SESSION_STATES.ACTIVE_SET);
    assert.equal(controller.plan().exercises.length, exerciseCount);
  });
}

for (const code of ['workout_start_time_taken', 'workout_already_active']) {
  test(`a start retry refused with ${code} after a lost reply binds the phone workout it created`, async () => {
    let time = 1_000_000;
    const { cloud, link, controller } = await startDirectWorkout([[0, 3]], {
      time: () => time,
      auto: false,
      cloudOptions: { strictStart: true },
    });
    if (code === 'workout_already_active') {
      const create = cloud.client.startRunningWorkout;
      cloud.client.startRunningWorkout = async (payload) => {
        if (cloud.current()) throw Object.assign(new Error(code), { code });
        return create(payload);
      };
    }
    await link.deliver(0, 'noReply');
    await flush();
    controller.completeSet();
    time += 100_000;
    controller.nextSet();
    controller.completeSet();
    await flush();

    link.setAuto(true);
    while (link.queue.length) await link.deliver(0, 'ok');
    await controller.retryPendingWrites().catch(() => {});
    await flush();

    assert.equal(controller.sync().conflict, false);
    assert.equal(controller.sync().startConfirmed, true);
    assert.equal(controller.sync().acknowledgedSetCount, 2);
    assert.deepEqual(cloud.completedSets().map((set) => set.setId), ['live1-entry-1-work-1', 'live1-entry-1-work-2']);
  });
}

test('a lost reply while checking the running workout after a refused start stays retryable', async () => {
  const { cloud, link, controller } = await startDirectWorkout([[0, 2]], {
    auto: false,
    cloudOptions: { strictStart: true },
  });
  await link.deliver(0, 'noReply');
  await flush();
  controller.completeSet();
  await flush();
  await link.deliver(0, 'ok');
  await flush();
  assert.equal(link.queue[0].type, MESSAGE_TYPES.GET_WORKOUT_CURRENT);
  await link.deliver(0, 'lost');
  await flush();

  assert.equal(controller.sync().conflict, false);
  assert.equal(controller.status().code, 'pending');

  link.setAuto(true);
  await controller.retryPendingWrites().catch(() => {});
  await flush();
  assert.equal(controller.sync().startConfirmed, true);
  assert.deepEqual(cloud.completedSets().map((set) => set.setId), ['live1-entry-1-work-1']);
});

test('a start refused for a different running phone workout still raises the conflict', async () => {
  const { cloud, link, controller } = await startDirectWorkout([[0, 2]], { auto: false });
  cloud.setCurrent({ ...buildApiWorkout([[0, 2]]), startTime: 5 });
  link.setAuto(true);
  await link.deliver(0, 'ok');
  await flush();

  assert.equal(controller.sync().conflict, true);
  assert.equal(controller.status().detail, 'workout_already_active');
});

test('a native pause after the workout is saved does not bring it back on the next launch', async () => {
  const { link, store, controller } = await startDirectWorkout([[0, 1]]);
  controller.completeSet();
  await flush();
  assert.equal((await controller.finishWorkoutRemote()).success, true);
  assert.equal(store.load(), null);

  controller.pauseWorkout({ source: 'native' });
  controller.resumeWorkout({ source: 'native' });
  controller.adjustWeight(1);

  assert.equal(store.load(), null);
  const relaunched = createWorkoutController({ store, request: link.request, now: () => 2_000_000 });
  assert.equal(relaunched.restore().success, false);
});
