import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkoutController } from '../shared/workout-controller.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { createMemoryStorageAdapter, createSessionStore } from '../shared/session-storage.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  let clock = 1000;
  let offline = false;
  let beforeWrite = async () => {};
  let beforeRead = async () => {};
  const batches = [];
  const requests = [];
  const store = createSessionStore(createMemoryStorageAdapter());
  const remote = {
    programId: 'program', startTime: 1000, dayData: { week: 1, dayInWeek: 1 },
    entries: [{ entryId: 'bench', name: 'Bench', sets: [0, 1, 2].map(index => ({
      setId: 'set-' + index, weight: '60kg', reps: 8, rpe: 7, timer: 90,
    })) }],
  };
  const request = async (type, payload) => {
    requests.push(type);
    if (type === MESSAGE_TYPES.SYNC_WORKOUT_SETS) {
      batches.push(payload.sets);
      await beforeWrite();
      if (offline) throw Object.assign(new Error('Offline'), { code: 'NETWORK' });
      for (const write of payload.sets) {
        remote.entries[0].sets.find(set => set.setId === write.setId).completed = structuredClone(write.completed);
      }
      remote.entries[0].sets[1].weight = '65kg';
    } else {
      const snapshot = structuredClone(remote);
      await beforeRead();
      return { payload: { workout: snapshot } };
    }
    return { payload: { workout: structuredClone(remote) } };
  };
  const makeController = () => createWorkoutController({ now: () => clock, store, request });
  const controller = makeController();
  controller.loadPlan(workoutToDayPlan(remote), { sync: { mode: 'DIRECT', startConfirmed: true } });
  controller.startWorkout();
  const correct = (weight, reps = 8) => {
    const { draft } = controller.createLastSetDraft();
    return controller.saveLastSetCorrection({ ...draft, weight, reps });
  };
  return { controller, remote, batches, requests, store, correct, makeController,
    setOffline: value => { offline = value; },
    onWrite: callback => { beforeWrite = callback; },
    onRead: callback => { beforeRead = callback; },
    advance: () => { clock += 120000; },
  };
}

test('corrections append behind an in-flight completion without mutating it', async () => {
  const f = fixture();
  const started = deferred();
  const release = deferred();
  f.onWrite(async () => { started.resolve(); await release.promise; });
  f.controller.completeSet();
  const sync = f.controller.syncSets();
  await started.promise;
  assert.equal(f.correct(65, 9).success, true);
  assert.equal(f.correct(70, 10).success, true);
  assert.equal(f.controller.getPendingSetCount(), 1);
  assert.deepEqual(f.batches[0][0].completed, { reps: 8, weight: '60kg', rpe: 7 });
  release.resolve();
  await sync;
  assert.equal(f.batches.length, 2);
  assert.deepEqual(f.batches[1].map(write => write.completed.weight), ['65kg', '70kg']);
  assert.equal(f.controller.getPendingSetCount(), 0);
  f.controller.nextSet();
  assert.equal(f.controller.canCorrectLastSet().set.weight, 70);
  assert.equal(f.controller.view().pending.set.weight, 65);
});

test('offline correction survives restart and retries the same stable set', async () => {
  const f = fixture();
  f.controller.completeSet();
  await f.controller.syncSets();
  f.setOffline(true);
  assert.equal(f.correct(75, 6).success, true);
  await assert.rejects(f.controller.syncSets(), /Offline/);
  assert.equal(f.controller.getPendingSetCount(), 1);
  const restored = f.makeController();
  assert.equal(restored.restore().success, true);
  assert.equal(restored.getPendingSetCount(), 1);
  assert.equal(restored.canCorrectLastSet().set.weight, 75);
  f.setOffline(false);
  await restored.retryPendingWrites();
  assert.equal(restored.getPendingSetCount(), 0);
  assert.deepEqual(f.remote.entries[0].sets[0].completed, { reps: 6, weight: '75kg', rpe: 7 });
});

test('an old poll response cannot overwrite a correction made while it was in flight', async () => {
  const f = fixture();
  f.controller.completeSet();
  await f.controller.syncSets();
  f.advance();
  const started = deferred();
  const release = deferred();
  f.onRead(async () => { started.resolve(); await release.promise; });
  const poll = f.controller.requestRefresh();
  await started.promise;
  f.setOffline(true);
  assert.equal(f.correct(80).success, true);
  await assert.rejects(f.controller.syncSets());
  release.resolve();
  assert.equal(await poll, false);
  assert.equal(f.controller.canCorrectLastSet().set.weight, 80);
  assert.equal(f.controller.getPendingSetCount(), 1);
});

test('a known deferred Cloud edit refuses the draft without losing local work', async () => {
  const f = fixture();
  f.controller.completeSet();
  await f.controller.syncSets();
  const draft = f.controller.createLastSetDraft().draft;
  f.remote.entries[0].sets[0].completed.rpe = 9;
  f.advance();
  assert.equal(await f.controller.requestRefresh(), true);
  const before = f.controller.getWorkoutSetWrites();
  assert.equal(f.controller.saveLastSetCorrection({ ...draft, weight: 65 }).success, false);
  assert.deepEqual(f.controller.getWorkoutSetWrites(), before);
});

test('correction leaves rest, pause, prepared selection and all other completion values intact', () => {
  const f = fixture();
  f.controller.completeSet({ setTimer: 30, userVars: { effort: 4 } });
  f.controller.pauseWorkout({ timestamp: 1500, source: 'manual' });
  f.controller.adjustWeight(1);
  const before = f.controller.view(1600);
  const original = f.controller.getWorkoutSetWrites()[0].completed;
  assert.equal(original.rpe, 7);
  assert.equal(original.setTimer, 30);
  assert.deepEqual(original.userVars, { effort: 4 });
  assert.equal(f.correct(62.5, 9).success, true);
  const after = f.controller.view(1600);
  assert.deepEqual(after.rest, before.rest);
  assert.deepEqual(after.pending.set, before.pending.set);
  assert.equal(after.pending.exerciseIndex, before.pending.exerciseIndex);
  assert.deepEqual(after.pending.setsDots, before.pending.setsDots);
  assert.equal(after.isManualWorkoutPaused, true);
  assert.equal(after.state, before.state);
  assert.deepEqual(f.controller.getWorkoutSetWrites()[1].completed, { ...original, weight: '62.5kg', reps: 9 });
});


test('ambiguous acknowledgement retries the correction without another completed set', async () => {
  const f = fixture();
  f.controller.completeSet();
  await f.controller.syncSets();
  const draft = { ...f.controller.createLastSetDraft().draft, weight: 67.5, reps: 7 };
  f.setOffline(true);
  // The server applied the edit, but its acknowledgement never reached the watch.
  f.remote.entries[0].sets[0].completed = { weight: '67.5kg', reps: 7, rpe: 7 };
  assert.equal(f.controller.saveLastSetCorrection(draft).success, true);
  await assert.rejects(f.controller.syncSets());
  f.setOffline(false);
  await f.controller.retryPendingWrites();
  assert.equal(f.remote.entries[0].sets.filter(set => set.completed).length, 1);
  assert.equal(f.controller.getPendingSetCount(), 0);
  assert.equal(f.remote.entries[0].sets[0].completed.weight, '67.5kg');
});


test('finish cannot erase a correction that has not been acknowledged', async () => {
  const f = fixture();
  f.controller.completeSet();
  await f.controller.syncSets();
  f.setOffline(true);
  assert.equal(f.correct(65).success, true);
  await assert.rejects(f.controller.syncSets());
  await assert.rejects(f.controller.finishWorkoutRemote());
  assert.equal(f.requests.includes(MESSAGE_TYPES.FINISH_WORKOUT), false);
  assert.equal(f.controller.getPendingSetCount(), 1);
  const restored = f.makeController();
  assert.equal(restored.restore().success, true);
  assert.equal(restored.getPendingSetCount(), 1);
});


test('a newer deferred phone completion prevents editing the older last set', async () => {
  const f = fixture();
  f.controller.completeSet();
  await f.controller.syncSets();
  const draft = { ...f.controller.createLastSetDraft().draft, weight: 65 };
  f.remote.entries[0].sets[1].completed = { weight: '65kg', reps: 8 };
  f.advance();
  await f.controller.requestRefresh();
  assert.equal(f.controller.saveLastSetCorrection(draft).success, false);
});
