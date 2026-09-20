import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkoutController } from '../shared/workout-controller.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { createMemoryStorageAdapter, createSessionStore } from '../shared/session-storage.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';

function fixture({ store = createSessionStore(createMemoryStorageAdapter()) } = {}) {
  let clock = 1000;
  const remote = {
    programId: 'program', dayName: 'Day', dayData: { week: 1, dayInWeek: 1 }, startTime: 1000,
    entries: [{ entryId: 'bench', exerciseId: 'bench', name: 'Bench', sets:
      [0, 1, 2].map(index => ({ index, setId: 'set-' + index, weight: '60kg', reps: 8, rpe: 7, timer: 90 })) }],
  };
  const requests = [];
  const controller = createWorkoutController({
    now: () => clock, store,
    request: async (type, payload) => {
      requests.push(type);
      if (type === MESSAGE_TYPES.SYNC_WORKOUT_SETS) {
        for (const write of payload.sets) {
          remote.entries[0].sets.find(set => set.setId === write.setId).completed = structuredClone(write.completed);
        }
      }
      return { payload: { workout: structuredClone(remote) } };
    },
  });
  controller.loadPlan(workoutToDayPlan(remote), { sync: { mode: 'DIRECT', startConfirmed: true } });
  controller.startWorkout();
  return { controller, remote, store, requests, advance: () => { clock += 1000; } };
}

test('last local completion remains editable after two acknowledged snapshots and restart', async () => {
  const f = fixture();
  f.advance();
  f.controller.completeSet();
  await f.controller.syncSets();
  f.controller.nextSet();
  f.advance();
  f.controller.completeSet();
  await f.controller.syncSets();
  f.controller.nextSet();
  assert.equal(f.controller.canCorrectLastSet().allowed, true);
  const draft = f.controller.createLastSetDraft().draft;
  assert.equal(draft.setId, 'set-1');
  const restored = createWorkoutController({ store: f.store, now: () => 3000 });
  assert.equal(restored.restore().success, true);
  assert.equal(restored.createLastSetDraft().draft?.setId, 'set-1');
});

test('saving an unchanged correction does not enqueue another Cloud write', async () => {
  const f = fixture();
  f.controller.completeSet();
  await f.controller.syncSets();
  const before = f.controller.getWorkoutSetWrites();
  const result = f.controller.saveLastSetCorrection(f.controller.createLastSetDraft().draft);
  assert.equal(result.success, true);
  assert.deepEqual(f.controller.getWorkoutSetWrites(), before);
});

test('invalid correction values cannot enter the journal or Cloud queue', () => {
  for (const patch of [{ weight: -1 }, { weight: NaN }, { weight: Infinity }, { reps: -1 }, { reps: 1.5 }, { reps: '8' }]) {
    const f = fixture();
    f.controller.completeSet();
    const before = f.controller.getWorkoutSetWrites();
    const draft = { ...f.controller.createLastSetDraft().draft, ...patch };
    assert.equal(f.controller.saveLastSetCorrection(draft).success, false, JSON.stringify(patch));
    assert.deepEqual(f.controller.getWorkoutSetWrites(), before);
  }
});

test('known remote changes to other completion fields invalidate an open edit draft', async () => {
  const f = fixture();
  f.controller.completeSet();
  await f.controller.syncSets();
  const draft = f.controller.createLastSetDraft().draft;
  f.remote.entries[0].sets[0].completed.rpe = 9;
  f.controller.replaceFromServer(workoutToDayPlan(f.remote, { isCurrent: true }));
  draft.weight = 65;
  assert.equal(f.controller.saveLastSetCorrection(draft).success, false);
});

test('a failed durable write cannot report a saved correction or send it', async () => {
  let fail = false;
  const store = createSessionStore(createMemoryStorageAdapter());
  const safeStore = { ...store, save: value => fail ? false : store.save(value) };
  const f = fixture({ store: safeStore });
  f.controller.completeSet();
  await f.controller.syncSets();
  const before = f.controller.getWorkoutSetWrites();
  const draft = f.controller.createLastSetDraft().draft;
  draft.weight = 65;
  fail = true;
  const sentBefore = f.requests.length;
  const result = f.controller.saveLastSetCorrection(draft);
  assert.equal(result.success, false);
  await Promise.resolve();
  assert.equal(f.requests.length, sentBefore);
  assert.deepEqual(f.controller.getWorkoutSetWrites(), before);
});


test('storage exceptions roll back the edit and leave the draft retryable', async () => {
  let fail = false;
  const store = createSessionStore(createMemoryStorageAdapter());
  const f = fixture({ store: { ...store, save: value => {
    if (fail) throw new Error('Disk unavailable');
    return store.save(value);
  } } });
  f.controller.completeSet();
  await f.controller.syncSets();
  const draft = { ...f.controller.createLastSetDraft().draft, weight: 65 };
  const before = f.controller.view();
  fail = true;
  assert.equal(f.controller.saveLastSetCorrection(draft).success, false);
  assert.deepEqual(f.controller.view(), before);
  fail = false;
  assert.equal(f.controller.saveLastSetCorrection(draft).success, true);
  await f.controller.syncSets();
  assert.equal(f.controller.canCorrectLastSet().set.weight, 65);
});

test('recovery and terminal intent block corrections without enqueueing writes', () => {
  for (const patch of [{ remoteMissing: true }, { finishRequestedAt: 0 }, { discardRequestedAt: 0 }, { conflict: true }]) {
    const f = fixture();
    f.controller.completeSet();
    const draft = { ...f.controller.createLastSetDraft().draft, weight: 65 };
    const before = f.controller.getWorkoutSetWrites();
    f.controller.updateSync(patch);
    assert.equal(f.controller.canCorrectLastSet().allowed, false);
    assert.equal(f.controller.saveLastSetCorrection(draft).success, false);
    assert.deepEqual(f.controller.getWorkoutSetWrites(), before);
  }
});

test('new remote completion invalidates trusted local completion order', async () => {
  const f = fixture();
  f.controller.completeSet();
  await f.controller.syncSets();
  f.remote.entries[0].sets[1].completed = { weight: '60kg', reps: 8 };
  f.controller.replaceFromServer(workoutToDayPlan(f.remote, { isCurrent: true }));
  assert.equal(f.controller.canCorrectLastSet().allowed, false);
});

test('workout identity checks do not bypass a zero or missing start time', () => {
  const f = fixture();
  f.controller.completeSet();
  for (const workoutStartedAt of [0, undefined]) {
    const draft = { ...f.controller.createLastSetDraft().draft, workoutStartedAt, weight: 65 };
    assert.equal(f.controller.saveLastSetCorrection(draft).success, false);
  }
});
