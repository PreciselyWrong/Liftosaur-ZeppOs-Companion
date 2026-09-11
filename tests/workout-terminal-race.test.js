import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkoutController } from '../shared/workout-controller.js';
import { createMemoryStorageAdapter, createSessionStore } from '../shared/session-storage.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';

const plan = {
  source: 'WORKOUT_API', programId: 'program', dayName: 'Day', week: 1,
  dayInWeek: 1, unit: 'kg', exercises: [{ index: 1, id: 'ex', entryId: 'entry',
    name: 'Squat', warmupSets: [], sets: [{ index: 1, setId: 'set',
      targetReps: 5, targetWeight: 20, restSeconds: 60 }] }],
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(delayedType) {
  const pending = deferred();
  const requested = deferred();
  const calls = [];
  const store = createSessionStore(createMemoryStorageAdapter());
  const controller = createWorkoutController({ store, now: () => 1000,
    request: (type, payload) => {
      calls.push({ type, payload });
      if (type === delayedType) { requested.resolve(); return pending.promise; }
      return Promise.resolve({ payload: {} });
    },
  });
  controller.loadPlan(plan, { sync: { startConfirmed: true }, persist: true });
  controller.startWorkout();
  return { controller, store, calls, pending, requested };
}

test('late terminal responses preserve replacement sessions and their status', async () => {
  for (const operation of ['discard', 'finish']) {
    for (const outcome of ['success', 'no_active_workout', 'network_error']) {
      for (const replacement of ['clear', 'load', 'replace', 'restore']) {
        const { controller, store, pending, requested } = fixture(
          operation === 'discard' ? MESSAGE_TYPES.DISCARD_WORKOUT : MESSAGE_TYPES.FINISH_WORKOUT,
        );
        const action = operation === 'discard'
          ? controller.discardWorkoutRemote() : controller.finishWorkoutRemote();
        await requested.promise;
        if (replacement === 'clear') controller.clear();
        if (replacement === 'load') controller.loadPlan(plan, { persist: true });
        if (replacement === 'replace') controller.replaceFromServer(plan);
        if (replacement === 'restore') controller.restore();
        const saved = store.load();
        const view = controller.view();
        const status = controller.status();
        if (outcome === 'success') pending.resolve({ payload: {} });
        else pending.reject(Object.assign(new Error(outcome), { code: outcome }));
        assert.deepEqual(await action, { success: false, reason: 'SESSION_REPLACED' });
        assert.deepEqual(store.load(), saved);
        assert.deepEqual(controller.view(), view);
        assert.deepEqual(controller.status(), status);
      }
    }
  }
});

test('finish does not send a replacement workout after awaiting queued sets', async () => {
  const { controller, pending, requested, calls } = fixture(MESSAGE_TYPES.SYNC_WORKOUT_SETS);
  controller.completeSet();
  await requested.promise;
  const finish = controller.finishWorkoutRemote();
  controller.loadPlan(plan, { persist: true });
  pending.resolve({ payload: {} });
  assert.deepEqual(await finish, { success: false, reason: 'SESSION_REPLACED' });
  assert.equal(calls.some(({ type }) => type === MESSAGE_TYPES.FINISH_WORKOUT), false);
});

test('finish refuses a conflict introduced while draining queued sets', async () => {
  const { controller, pending, requested, calls, store } = fixture(MESSAGE_TYPES.SYNC_WORKOUT_SETS);
  controller.completeSet();
  await requested.promise;
  const finish = controller.finishWorkoutRemote();
  await Promise.resolve();
  controller.updateSync({ conflict: true, acknowledgedSetCount: 1 });
  pending.resolve({ payload: {} });
  await assert.rejects(finish, /conflict|pending/i);
  assert.equal(calls.some(({ type }) => type === MESSAGE_TYPES.FINISH_WORKOUT), false);
  assert.equal(store.hasSession(), true);
});

test('finish does not send a replacement workout after awaiting startup', async () => {
  const { controller, pending, requested, calls, store } = fixture(MESSAGE_TYPES.START_WORKOUT);
  controller.updateSync({ startConfirmed: false });
  const finish = controller.finishWorkoutRemote();
  await requested.promise;
  controller.loadPlan(plan, { persist: true });
  const saved = store.load();
  pending.resolve({ payload: {} });
  assert.deepEqual(await finish, { success: false, reason: 'SESSION_REPLACED' });
  assert.equal(calls.some(({ type }) => type === MESSAGE_TYPES.FINISH_WORKOUT), false);
  assert.deepEqual(store.load(), saved);
});
