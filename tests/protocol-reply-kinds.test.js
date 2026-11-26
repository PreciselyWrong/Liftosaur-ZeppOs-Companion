import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkoutController } from '../shared/workout-controller.js';
import { createMemoryStorageAdapter, createSessionStore } from '../shared/session-storage.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';

const T = MESSAGE_TYPES;
const START = 1000;

function workout() {
  return {
    programId: 'program', dayName: 'Day', dayData: { week: 1, dayInWeek: 1 }, startTime: START,
    entries: ['Squat', 'Bench'].map((name, exercise) => ({
      entryId: `entry-${exercise}`, exerciseId: name, name,
      sets: [0, 1].map((index) => ({ index, setId: `set-${exercise}-${index}`, weight: '20kg', reps: 5, timer: 60 })),
    })),
  };
}

// A snapshot that, if adopted, visibly changes the plan.
function changedSnapshot() {
  const changed = workout();
  for (const entry of changed.entries) for (const set of entry.sets) set.reps = 9;
  return changed;
}

const ackOnly = () => ({ workout: { startTime: START } });

function setup(overrides = {}) {
  let clock = START;
  const replies = {
    [T.START_WORKOUT]: () => ({ payload: { workout: workout() } }),
    [T.SYNC_WORKOUT_SETS]: () => ({ payload: ackOnly() }),
    [T.GET_WORKOUT_CURRENT]: () => ({ payload: { workout: workout() } }),
    ...overrides,
  };
  const controller = createWorkoutController({
    now: () => clock,
    store: createSessionStore(createMemoryStorageAdapter()),
    request: async (type) => replies[type](),
  });
  controller.loadPlan(workoutToDayPlan(workout()));
  controller.startWorkout();
  const snapshot = () => JSON.stringify({
    plan: controller.plan(),
    writes: controller.getWorkoutSetWrites(),
    acknowledged: controller.sync().acknowledgedSetCount,
  });
  return { controller, replies, snapshot, advance: () => { clock += 200_000; } };
}

const wrongForSync = [
  ['a workout without its start time', () => ({ workout: {} })],
  ['entries that are not an array', () => ({ workout: { startTime: START, entries: {} } })],
];

// An older phone during an app update still answers with the full workout: an acknowledgement, never adopted.
test('a set sync answered with a full snapshot acknowledges the sets and adopts nothing', async () => {
  const { controller, replies, snapshot } = setup();
  await controller.ensureStarted();
  controller.completeSet();
  const before = JSON.parse(snapshot());
  replies[T.SYNC_WORKOUT_SETS] = () => ({ payload: { workout: changedSnapshot() } });

  assert.equal(await controller.syncSets(), true);
  controller.nextSet();
  controller.selectExercise(0);

  assert.equal(controller.sync().conflict, false);
  assert.equal(controller.sync().acknowledgedSetCount, 1);
  assert.equal(controller.hasDeferredServerWorkout(), false);
  assert.deepEqual(JSON.parse(snapshot()).plan, before.plan);
  assert.deepEqual(JSON.parse(snapshot()).writes, before.writes);
});

for (const [label, payload] of wrongForSync) {
  test(`a set sync answered with ${label} acknowledges nothing and adopts nothing`, async () => {
    const { controller, replies, snapshot } = setup();
    await controller.ensureStarted();
    controller.completeSet();
    const before = snapshot();
    replies[T.SYNC_WORKOUT_SETS] = () => ({ payload: payload() });

    await assert.rejects(controller.syncSets(), { code: 'API_FAILED' });
    controller.nextSet();
    controller.selectExercise(0);

    assert.equal(controller.sync().conflict, false);
    assert.equal(controller.getPendingSetCount(), 1);
    assert.deepEqual(JSON.parse(snapshot()).plan, JSON.parse(before).plan);
    assert.deepEqual(JSON.parse(snapshot()).writes, JSON.parse(before).writes);
    assert.equal(controller.sync().acknowledgedSetCount, 0);
  });
}

const wrongForSnapshot = [
  ['an acknowledgement only', ackOnly],
  ['a snapshot without its start time', () => {
    const changed = changedSnapshot();
    delete changed.startTime;
    return { workout: changed };
  }],
  ['entries that are not an array', () => ({ workout: { ...changedSnapshot(), entries: {} } })],
];

for (const [label, payload] of wrongForSnapshot) {
  test(`a running workout read answered with ${label} leaves the plan, sets and acknowledgements untouched`, async () => {
    const { controller, replies, snapshot, advance } = setup();
    await controller.ensureStarted();
    controller.completeSet();
    await controller.syncSets();
    controller.nextSet();
    const before = snapshot();
    replies[T.GET_WORKOUT_CURRENT] = () => ({ payload: payload() });

    advance();
    await controller.requestRefresh();
    assert.equal(snapshot(), before);
    await controller.adoptCurrent({ preserveNavigation: false }).catch(() => {});
    assert.equal(snapshot(), before);
    assert.equal(controller.sync().conflict, false);
  });

  test(`a start answered with ${label} stays retryable and leaves the plan untouched`, async () => {
    const { controller, snapshot } = setup({ [T.START_WORKOUT]: () => ({ payload: payload() }) });
    const before = snapshot();

    await assert.rejects(controller.ensureStarted(), { code: 'API_FAILED' });
    assert.equal(snapshot(), before);
    assert.equal(controller.sync().conflict, false);
    assert.equal(controller.sync().startConfirmed, false);
  });
}
