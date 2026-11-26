/**
 * Storage cost of a whole workout on the watch, where one LocalStorage snapshot save took
 * about 0.4 s: the real controller against the real phone router, with a lifter who taps
 * the weight three times before every set. Every file write and append counts as a save.
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
  const stats = { saves: 0, bytes: 0, planWrites: 0 };
  const counted = (write) => (name, data) => {
    stats.saves += 1;
    stats.bytes += data.length;
    if (data.includes('"exercises":')) stats.planWrites += 1;
    write(name, data);
  };
  return {
    stats,
    read: memory.read,
    remove: memory.remove,
    write: counted(memory.write),
    append: counted(memory.append),
  };
}

/** `online`: every request is answered at once; otherwise the phone never answers. */
async function runWorkout({ online }) {
  const cloud = createFakeCloud(buildApiWorkout(Array.from({ length: EXERCISES }, () => [0, SETS])));
  const link = createPhoneLink(cloud);
  link.setAuto(online);
  const adapter = createCountingAdapter();
  const store = createSessionStore(adapter);
  const tapBytes = [];
  let time = 1_000_000;
  const controller = createWorkoutController({ store, request: link.request, now: () => time });

  const next = await link.phoneHandle(MESSAGE_TYPES.GET_WORKOUT_NEXT, {});
  controller.loadPlan(workoutToDayPlan(next.payload.workout), { clearStore: true });
  controller.startWorkout();
  await flush();

  for (let set = 0; set < EXERCISES * SETS; set++) {
    for (let tap = 0; tap < TAPS_PER_SET; tap++) {
      time += 1_000;
      const before = adapter.stats.bytes;
      controller.adjustWeight(1);
      tapBytes.push(adapter.stats.bytes - before);
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

  return { cloud, stats: adapter.stats, journalLength: store.load().journal.length, tapBytes };
}

// Measured with the plan stored once per change and each other save appended as one line,
// plus a little headroom: offline 215 writes, 89.6 KB, one plan write; online 348 writes,
// 865 KB, 43 plan writes (the start and each adopted phone snapshot); a tap 125 bytes.
// Before, as one LocalStorage value per save: offline 210 saves, 4.96 MB (23.6 KB each);
// online 335 saves, 6.37 MB (19 KB each). Before coalesced taps: 5.57 MB and 6.41 MB.
const BUDGETS = {
  offline: { saves: 225, journalLength: 130, bytes: 100_000, planWrites: 1 },
  online: { saves: 360, journalLength: 10, bytes: 900_000, planWrites: 43 },
};
// A tap appends one line; only folding the log into a new copy writes more, never the plan.
const TAP_AVERAGE_BYTES = 150;
const TAP_MAX_BYTES = 16_000;

for (const [name, budget] of Object.entries(BUDGETS)) {
  test(`a 7 x 6 workout with three weight taps per set stays within its ${name} storage budget`, async () => {
    const { cloud, stats, journalLength, tapBytes } = await runWorkout({ online: name === 'online' });
    if (name === 'online') assert.equal(cloud.completedSets().length, EXERCISES * SETS);
    const tapTotal = tapBytes.reduce((sum, bytes) => sum + bytes, 0);
    const measured = `${stats.saves} saves, ${journalLength} journal events, ${stats.bytes} bytes, `
      + `taps ${Math.round(tapTotal / tapBytes.length)} bytes on average, ${Math.max(...tapBytes)} at most`;
    assert.ok(stats.saves <= budget.saves, measured);
    assert.ok(journalLength <= budget.journalLength, measured);
    assert.ok(stats.bytes <= budget.bytes, measured);
    assert.ok(stats.planWrites <= budget.planWrites, `${stats.planWrites} plan writes`);
    assert.ok(tapTotal / tapBytes.length <= TAP_AVERAGE_BYTES, measured);
    assert.ok(Math.max(...tapBytes) <= TAP_MAX_BYTES, measured);
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
  const full = (write) => (name, data) => {
    if (failing) throw new Error('storage full');
    write(name, data);
  };
  const store = createSessionStore({
    read: memory.read,
    remove: memory.remove,
    write: full(memory.write),
    append: full(memory.append),
  });
  const controller = await startedController(store);
  failing = true;
  controller.adjustWeight(1);
  failing = false;
  controller.nextSet();
  assert.equal(store.load().journal.length, controller.getJournal().length);
  assert.deepEqual(store.load().journal, controller.getJournal());
  assert.deepEqual(createSessionStore(memory).load().journal, controller.getJournal(), 'after a restart');
});
