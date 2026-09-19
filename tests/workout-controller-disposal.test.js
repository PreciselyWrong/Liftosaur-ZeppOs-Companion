import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkoutController } from '../shared/workout-controller.js';
import { createMemoryStorageAdapter, createSessionStore } from '../shared/session-storage.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';

const plan = {
  source: 'WORKOUT_API', programId: 'program', dayName: 'Day', week: 1, dayInWeek: 1, unit: 'kg',
  exercises: [{ index: 1, id: 'exercise', entryId: 'entry', name: 'Squat', warmupSets: [],
    sets: [{ index: 1, setId: 'set', targetReps: 5, targetWeight: 20, restSeconds: 60 }] }],
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(delayedType, { startConfirmed = true } = {}) {
  const pending = deferred();
  const requested = deferred();
  const calls = [];
  const store = createSessionStore(createMemoryStorageAdapter());
  let saves = 0;
  let clears = 0;
  let changes = 0;
  let statuses = 0;
  const save = store.save.bind(store);
  const clear = store.clear.bind(store);
  store.save = (snapshot) => { saves += 1; return save(snapshot); };
  store.clear = () => { clears += 1; return clear(); };
  const controller = createWorkoutController({
    store, now: () => 1000, mapWorkout: () => plan,
    refreshPolicy: {
      beginPoll: () => true, request() {}, markSuccess() {}, markFailure() {},
      markAuthoritativeResponse() {},
    },
    onChange: () => { changes += 1; },
    onStatus: () => { statuses += 1; },
    request: (type, payload) => {
      calls.push({ type, payload });
      if (type === delayedType) { requested.resolve(); return pending.promise; }
      return Promise.resolve({ payload: { workout: { startTime: 1000 } } });
    },
  });
  controller.loadPlan(plan, { sync: { startConfirmed }, persist: true });
  controller.startWorkout();
  return { controller, store, pending, requested, calls, effects: () => ({ saves, clears, changes, statuses }) };
}

async function assertDisposed(operation, delayedType, outcome, setup = {}) {
  const { controller, store, pending, requested, calls, effects } = fixture(delayedType, setup);
  const action = operation(controller);
  await requested.promise;
  const persisted = store.load();
  const before = effects();
  controller.dispose();
  controller.dispose();
  assert.deepEqual(effects(), before, 'disposal itself has no persistence or callback effects');
  if (outcome === 'success') pending.resolve({ payload: { workout: { startTime: 1000 } } });
  else pending.reject(Object.assign(new Error('network'), { code: 'NETWORK' }));
  await action;
  assert.deepEqual(effects(), before);
  assert.deepEqual(store.load(), persisted);
  assert.equal(calls.length, 1);
  assert.equal(createWorkoutController({ store, now: () => 1000 }).restore().success, true);
}

test('dispose makes delayed startup results inert and preserves the journal', async () => {
  for (const outcome of ['success', 'error']) {
    await assertDisposed((controller) => controller.ensureStarted(), MESSAGE_TYPES.START_WORKOUT, outcome, { startConfirmed: false });
  }
});

test('dispose makes delayed set sync, poll, and adoption results inert', async () => {
  for (const outcome of ['success', 'error']) {
    await assertDisposed((controller) => { controller.completeSet(); return controller.syncSets(); }, MESSAGE_TYPES.SYNC_WORKOUT_SETS, outcome);
    await assertDisposed((controller) => controller.pollCurrent(), MESSAGE_TYPES.GET_WORKOUT_CURRENT, outcome);
    await assertDisposed((controller) => controller.adoptCurrent(), MESSAGE_TYPES.GET_WORKOUT_CURRENT, outcome);
  }
});

test('dispose makes delayed finish and discard results inert', async () => {
  for (const outcome of ['success', 'error']) {
    await assertDisposed((controller) => controller.finishWorkoutRemote(), MESSAGE_TYPES.FINISH_WORKOUT, outcome);
    await assertDisposed((controller) => controller.discardWorkoutRemote(), MESSAGE_TYPES.DISCARD_WORKOUT, outcome);
  }
});

test('disposal while awaiting startup or set sync cannot send the next write', async () => {
  for (const outcome of ['success', 'error']) {
    await assertDisposed(controller => controller.finishWorkoutRemote(),
      MESSAGE_TYPES.START_WORKOUT, outcome, { startConfirmed: false });
    await assertDisposed(controller => {
      controller.completeSet();
      return controller.finishWorkoutRemote();
    }, MESSAGE_TYPES.SYNC_WORKOUT_SETS, outcome);
  }
});

test('disposed public actions cannot overwrite, clear or restart the retained session', async () => {
  const { controller, store, calls, effects } = fixture(null);
  const persisted = store.load();
  const before = effects();
  controller.dispose();
  controller.loadPlan(plan, { clearStore: true });
  controller.clear();
  controller.clearPersisted();
  controller.adjustWeight(1);
  controller.completeSet();
  controller.nextSet();
  controller.startWorkout();
  controller.persist();
  await controller.syncSets();
  await controller.requestRefresh();
  await controller.adoptCurrent();
  await controller.finishWorkoutRemote();
  await controller.discardWorkoutRemote();
  assert.deepEqual(effects(), before);
  assert.deepEqual(store.load(), persisted);
  assert.deepEqual(calls, []);
});
