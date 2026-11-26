/**
 * Storage cost of a whole workout on the watch, where one snapshot save takes
 * about 0.4 s: the real controller against the real phone router, with a
 * lifter who taps the weight three times before every set.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkoutController } from '../shared/workout-controller.js';
import { createMemoryStorageAdapter, createSessionStore } from '../shared/session-storage.js';
import { SESSION_STATES } from '../shared/workout-session.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';
import { buildApiWorkout, createFakeCloud, createPhoneLink, flush } from './helpers/phone-harness.js';

const EXERCISES = 7;
const SETS = 6;
const TAPS_PER_SET = 3;

function createCountingAdapter() {
  const memory = createMemoryStorageAdapter();
  const stats = { saves: 0, bytes: 0 };
  return {
    stats,
    read: memory.read,
    remove: memory.remove,
    write(data) {
      stats.saves += 1;
      stats.bytes += data.length;
      memory.write(data);
    },
  };
}

/** `online`: every request is answered at once; otherwise the phone never answers. */
async function runWorkout({ online }) {
  const cloud = createFakeCloud(buildApiWorkout(Array.from({ length: EXERCISES }, () => [0, SETS])));
  const link = createPhoneLink(cloud);
  link.setAuto(online);
  const adapter = createCountingAdapter();
  const store = createSessionStore(adapter);
  let time = 1_000_000;
  const controller = createWorkoutController({ store, request: link.request, now: () => time });

  const next = await link.phoneHandle(MESSAGE_TYPES.GET_WORKOUT_NEXT, {});
  controller.loadPlan(workoutToDayPlan(next.payload.workout), { clearStore: true });
  controller.startWorkout();
  await flush();

  for (let set = 0; set < EXERCISES * SETS; set++) {
    for (let tap = 0; tap < TAPS_PER_SET; tap++) {
      time += 1_000;
      controller.adjustWeight(1);
      await flush();
    }
    time += 30_000;
    controller.completeSet();
    await flush();
    if (controller.view().state === SESSION_STATES.REST) {
      time += 60_000;
      controller.nextSet();
      await flush();
    }
  }
  assert.equal(controller.view().state, SESSION_STATES.FINISHED);
  const chosenWeights = controller.getWorkoutSetWrites().map((write) => write.completed.weight);
  for (const [index, weight] of chosenWeights.entries()) {
    const target = 60 + Math.floor(index / SETS);
    assert.equal(weight, `${target + TAPS_PER_SET * 2.5}kg`);
  }

  // The stored journal still restores the exact workout.
  const restored = createWorkoutController({ store, now: () => time });
  assert.equal(restored.restore().success, true);
  assert.deepEqual(restored.getWorkoutSetWrites(), controller.getWorkoutSetWrites());

  return { cloud, stats: adapter.stats, journalLength: store.load().journal.length };
}

// Measured with coalesced taps and unchanged saves skipped, plus a little headroom. Before
// that change: offline 210 saves, 210 events, 5.57 MB; online 335 saves, 6.41 MB.
const BUDGETS = {
  offline: { saves: 215, journalLength: 130, bytes: 5_100_000 },
  online: { saves: 340, journalLength: 10, bytes: 6_400_000 },
};

for (const [name, budget] of Object.entries(BUDGETS)) {
  test(`a 7 x 6 workout with three weight taps per set stays within its ${name} storage budget`, async () => {
    const { cloud, stats, journalLength } = await runWorkout({ online: name === 'online' });
    if (name === 'online') assert.equal(cloud.completedSets().length, EXERCISES * SETS);
    const measured = `${stats.saves} saves, ${journalLength} journal events, ${stats.bytes} bytes`;
    assert.ok(stats.saves <= budget.saves, measured);
    assert.ok(journalLength <= budget.journalLength, measured);
    assert.ok(stats.bytes <= budget.bytes, measured);
  });
}

async function startedController(store) {
  const cloud = createFakeCloud(buildApiWorkout([[0, 2]]));
  const link = createPhoneLink(cloud);
  const controller = createWorkoutController({ store, request: link.request, now: () => 1_000_000 });
  const next = await link.phoneHandle(MESSAGE_TYPES.GET_WORKOUT_NEXT, {});
  controller.loadPlan(workoutToDayPlan(next.payload.workout), { clearStore: true });
  controller.startWorkout();
  return controller;
}

test('a gesture that changes nothing does not rewrite the snapshot', async () => {
  const adapter = createCountingAdapter();
  const store = createSessionStore(adapter);
  const controller = await startedController(store);
  controller.pauseWorkout();
  const saves = adapter.stats.saves;

  controller.pauseWorkout();
  controller.nextSet();
  controller.resumeRest();
  assert.equal(adapter.stats.saves, saves);

  controller.resumeWorkout();
  assert.equal(adapter.stats.saves, saves + 1);
  assert.equal(store.load().journal.length, controller.getJournal().length);
});

test('an unchanged session is saved again after a failed save', async () => {
  const memory = createMemoryStorageAdapter();
  let failing = false;
  const store = createSessionStore({
    read: memory.read,
    remove: memory.remove,
    write(data) {
      if (failing) throw new Error('storage full');
      memory.write(data);
    },
  });
  const controller = await startedController(store);
  failing = true;
  controller.adjustWeight(1);
  failing = false;
  controller.nextSet();
  assert.equal(store.load().journal.length, controller.getJournal().length);
  assert.deepEqual(store.load().journal, controller.getJournal());
});
