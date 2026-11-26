/**
 * Seeded abuse runs of the real watch controller against the real phone
 * router: random lifter taps interleaved with lost, unanswered and late
 * Bluetooth messages, app kills with restore, and phone-side edits. Every
 * seed is fixed so a failure replays exactly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkoutController } from '../shared/workout-controller.js';
import { createMemoryStorageAdapter, createSessionStore } from '../shared/session-storage.js';
import { SESSION_STATES } from '../shared/workout-session.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';
import { buildApiWorkout, createFakeCloud, createPhoneLink, createRandom, flush } from './helpers/phone-harness.js';

const ACTIVE = new Set([SESSION_STATES.ACTIVE_SET, SESSION_STATES.REST]);

function randomShape(rnd, { timed, zeroSets }) {
  return Array.from({ length: 1 + rnd.int(4) }, () => [
    rnd.int(3),
    (zeroSets ? 0 : 1) + rnd.int(4),
    timed && rnd.chance(0.5) ? { setTimer: 20 + rnd.int(20), isUnilateral: rnd.chance(0.5) } : {},
  ]);
}

async function runAbuse(seed, { steps = 300, timed = false, zeroSets = false, phoneEdits = false, hostilePhone = false, strictStart = false } = {}) {
  const rnd = createRandom(seed);
  const cloud = createFakeCloud(buildApiWorkout(randomShape(rnd, { timed, zeroSets })), { strictStart });
  const store = createSessionStore(createMemoryStorageAdapter());
  let time = 1_000_000;
  let link = createPhoneLink(cloud);
  const late = [];
  const trace = [];
  const fail = (message) => assert.fail(`seed ${seed}: ${message}\n${trace.slice(-30).join('\n')}`);
  const makeController = () => createWorkoutController({ store, request: link.request, now: () => time });

  let controller = makeController();
  const next = await link.phoneHandle(MESSAGE_TYPES.GET_WORKOUT_NEXT, {});
  controller.loadPlan(workoutToDayPlan(next.payload.workout), { clearStore: true });
  controller.startWorkout();

  let finished = false;
  let discarded = false;
  let replaced = false;
  let loggedSets = 0;

  const distinctWrites = () => new Set(controller.getWorkoutSetWrites().map((write) => write.setId)).size;
  const countLogged = (action) => {
    const before = distinctWrites();
    action();
    if (distinctWrites() > before) loggedSets += 1;
  };

  function checkInvariants(label) {
    const writes = controller.getWorkoutSetWrites();
    const { acknowledgedSetCount } = controller.sync();
    if (acknowledgedSetCount > writes.length) fail(`${label}: acknowledged ${acknowledgedSetCount} of ${writes.length} writes`);
    if (!finished && !discarded) {
      if (controller.view().state === SESSION_STATES.NO_PLAN) fail(`${label}: NO_PLAN during the workout`);
      if (!controller.plan()?.exercises?.length) fail(`${label}: empty plan during the workout`);
      if (!replaced && distinctWrites() < loggedSets) fail(`${label}: ${loggedSets} sets logged, ${distinctWrites()} written`);
    }
    if (!store.load() && !discarded && cloud.history.length === 0) fail(`${label}: session deleted before any save`);
  }

  function phoneAction() {
    const current = cloud.current();
    if (!current) return 'phone idle';
    if (hostilePhone && rnd.chance(0.05)) {
      if (rnd.chance(0.5)) {
        cloud.setCurrent(null);
        return 'phone discards';
      }
      cloud.setCurrent({ ...current, startTime: current.startTime + 5 });
      return 'phone restarts';
    }
    const known = new Set(controller.getWorkoutSetWrites().map((write) => write.setId));
    const open = current.entries
      .flatMap((entry) => [...entry.warmupSets, ...entry.sets])
      .filter((set) => !set.completed && !known.has(set.setId));
    if (!open.length) return 'phone idle';
    const target = rnd.pick(open);
    if (rnd.chance(0.5)) target.completed = { reps: 3, weight: '61kg' };
    else target.weight = `${40 + rnd.int(40)}kg`;
    return `phone edits ${target.setId}`;
  }

  async function kill() {
    const writes = JSON.stringify(controller.getWorkoutSetWrites());
    const acknowledged = controller.sync().acknowledgedSetCount;
    controller.dispose();
    // Requests already on the phone may still run after the watch app died.
    for (const item of link.queue) if (rnd.chance(0.5)) late.push(item);
    link.failAll();
    link = createPhoneLink(cloud);
    controller = makeController();
    const restored = controller.restore();
    if (finished || discarded) return;
    if (!restored.success) fail(`restore failed: ${restored.reason}`);
    if (JSON.stringify(controller.getWorkoutSetWrites()) !== writes) fail('restore changed the writes');
    if (controller.sync().acknowledgedSetCount !== acknowledged) fail('restore changed the acknowledged count');
  }

  for (let step = 0; step < steps && !finished && !(discarded && !store.load()); step++) {
    time += rnd.int(30_000);
    const state = controller.view().state;
    const roll = rnd.next();
    let action = 'wait';
    if (roll < 0.25 && ACTIVE.has(state)) {
      action = 'complete';
      countLogged(() => controller.completeSet());
    } else if (timed && roll < 0.32 && controller.view().timedSet) {
      const op = rnd.pick(['startTimedSet', 'startTimedSet', 'stopTimedSide', 'stopTimedSide', 'advanceTimedSet', 'pauseTimedSet', 'resumeTimedSet']);
      action = op;
      countLogged(() => controller[op]());
    } else if (roll < 0.35 && state === SESSION_STATES.REST) {
      action = 'next';
      controller.nextSet();
    } else if (roll < 0.38) {
      action = 'skip warmup';
      controller.skipWarmup();
    } else if (roll < 0.42) {
      action = 'adjust';
      controller.adjustWeight(rnd.int(5) - 2);
      controller.adjustReps(rnd.int(3) - 1);
    } else if (roll < 0.46) {
      action = 'correct';
      const draft = controller.createLastSetDraft();
      if (draft.success) {
        controller.saveLastSetCorrection({
          ...draft.draft,
          reps: Math.max(0, draft.draft.reps + rnd.int(3) - 1),
          weight: draft.draft.weight + 2.5,
        });
      }
    } else if (roll < 0.49) {
      const source = rnd.pick(['manual', 'native']);
      action = `pause toggle ${source}`;
      if (rnd.chance(0.5)) controller.pauseWorkout({ source });
      else controller.resumeWorkout({ source });
    } else if (roll < 0.52) {
      action = 'force resume';
      controller.forceResumeWorkout();
    } else if (roll < 0.55 && ACTIVE.has(state)) {
      action = 'select';
      controller.selectExercise(rnd.int(controller.plan().exercises.length));
    } else if (roll < 0.60) {
      action = 'retry';
      controller.retryPendingWrites().catch(() => {});
    } else if (roll < 0.63) {
      action = 'refresh';
      controller.requestRefresh();
    } else if (roll < 0.65) {
      action = 'poll';
      controller.pollCurrent();
    } else if (roll < 0.75 && link.queue.length) {
      const fate = rnd.pick(['ok', 'ok', 'ok', 'lost', 'noReply', 'late']);
      const index = rnd.chance(0.8) ? 0 : rnd.int(link.queue.length);
      action = `deliver ${link.queue[index].type} ${fate}`;
      // The phone handles messages in arrival order, so a late one lands before newer ones.
      while (late.length) {
        const item = late.shift();
        await link.phoneHandle(item.type, item.payload);
      }
      await link.deliver(index, fate, late);
    } else if (roll < 0.77 && late.length) {
      const item = late.shift();
      action = `late ${item.type}`;
      await link.phoneHandle(item.type, item.payload);
    } else if (roll < 0.785 && (phoneEdits || hostilePhone)) {
      action = phoneAction();
      if (action === 'phone discards' || action === 'phone restarts') replaced = true;
    } else if (roll < 0.80) {
      action = 'kill';
      await kill();
    } else if (roll < 0.82 && controller.sync().conflict) {
      action = 'use phone workout';
      replaced = true;
      controller.adoptCurrent({ preserveNavigation: false }).catch(() => {});
    } else if (roll < 0.84) {
      action = 'finish';
      controller.finishWorkout();
      controller.finishWorkoutRemote().then((result) => { if (result.success) finished = true; }).catch(() => {});
    } else if (roll < 0.8405) {
      action = 'discard';
      discarded = true;
      controller.discardWorkoutRemote().catch(() => {});
    }
    await flush();
    trace.push(`${step} ${action} -> ${controller.view().state} writes=${controller.getWorkoutSetWrites().length} ack=${controller.sync().acknowledgedSetCount} conflict=${controller.sync().conflict} queued=${link.queue.length}`);
    checkInvariants(`step ${step} ${action}`);
  }

  if (finished || discarded) return { finished, saved: cloud.history.length };

  // A healthy link and a lifter who finishes must leave the account with every set.
  link.setAuto(true);
  while (link.queue.length) await link.deliver(0, 'ok');
  await flush();
  // A finish whose reply was lost already saved; the watch then reports the missing workout.
  const savedEarlier = () => controller.sync().remoteMissing && cloud.history.length === 1;
  if (controller.sync().conflict && !savedEarlier()) return { finished: false, conflict: controller.status().detail };
  if (!savedEarlier()) {
    for (let i = 0; i < 20 && controller.view().timedSet && controller.view().timedSet.phase !== 'READY'; i++) {
      time += 100_000;
      countLogged(() => {
        controller.resumeTimedSet();
        controller.forceResumeWorkout();
        controller.advanceTimedSet();
        controller.startTimedSet();
        time += 50_000;
        controller.stopTimedSide();
      });
      await flush();
    }
    while (controller.view().state === SESSION_STATES.REST) {
      controller.nextSet();
      await flush();
    }
    controller.finishWorkout();
    let result = null;
    for (let i = 0; i < 3 && !result?.success; i++) {
      result = await controller.finishWorkoutRemote().catch((err) => ({ success: false, reason: err.code || err.message }));
      await flush();
    }
    if (!result.success && !savedEarlier()) {
      // The phone replaced or dropped the workout: the watch keeps it and asks the lifter.
      if (replaced && controller.sync().conflict && store.load()) return { finished: false };
      fail(`final finish failed: ${result.reason}`);
    }
  }
  assert.equal(cloud.history.length, 1, `seed ${seed}: one saved workout`);
  if (replaced) return { finished: true };

  const saved = cloud.completedSets(cloud.history[0].workout);
  if (saved.length < loggedSets || (!phoneEdits && saved.length !== loggedSets)) {
    fail(`saved ${saved.length} sets, the lifter logged ${loggedSets}`);
  }
  const lastWrites = new Map(controller.getWorkoutSetWrites().map((write) => [write.setId, write.completed]));
  for (const [setId, completed] of lastWrites) {
    const remote = saved.find((set) => set.setId === setId);
    if (!remote) fail(`${setId} is missing from the saved workout`);
    assert.deepEqual(remote.completed, completed, `seed ${seed}: ${setId} saved with the watch values`);
  }
  return { finished: true };
}

const CONFIGS = [
  ['plain sets', {}],
  ['timed and unilateral sets', { timed: true }],
  ['phone edits and empty exercises', { phoneEdits: true, zeroSets: true }],
  ['a phone that refuses repeated starts', { strictStart: true, timed: true }],
  ['a phone that discards or restarts', { hostilePhone: true }],
];

for (const [label, options] of CONFIGS) {
  test(`seeded abuse with ${label} keeps every logged set`, async () => {
    let finishedRuns = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const outcome = await runAbuse(seed, options);
      if (outcome.finished) finishedRuns += 1;
    }
    // Guards the harness itself: most runs must reach a saved workout to mean anything.
    assert.ok(finishedRuns >= 15, `${finishedRuns} of 25 runs finished`);
  });
}

test('a 50 exercise by 20 set workout syncs and saves every set over a flaky link', async () => {
  const seed = 7;
  const rnd = createRandom(seed);
  const cloud = createFakeCloud(buildApiWorkout(Array.from({ length: 50 }, () => [0, 20])));
  const link = createPhoneLink(cloud);
  const store = createSessionStore(createMemoryStorageAdapter());
  let time = 1_000_000;
  const controller = createWorkoutController({ store, request: link.request, now: () => time });
  const next = await link.phoneHandle(MESSAGE_TYPES.GET_WORKOUT_NEXT, {});
  controller.loadPlan(workoutToDayPlan(next.payload.workout), { clearStore: true });
  controller.startWorkout();
  await flush();

  let logged = 0;
  while (controller.view().state !== SESSION_STATES.FINISHED) {
    time += 1_000;
    if (controller.view().state === SESSION_STATES.REST) controller.nextSet();
    else {
      controller.completeSet();
      logged += 1;
    }
    await new Promise((resolve) => setImmediate(resolve));
    if (link.queue.length && rnd.chance(0.3)) {
      await link.deliver(0, rnd.pick(['ok', 'ok', 'lost', 'noReply']));
      await flush();
    }
  }
  assert.equal(logged, 1000);

  link.setAuto(true);
  while (link.queue.length) await link.deliver(0, 'ok');
  await controller.retryPendingWrites().catch(() => {});
  const result = await controller.finishWorkoutRemote();

  assert.equal(result.success, true);
  assert.equal(cloud.completedSets(cloud.history[0].workout).length, 1000);
  assert.equal(store.load(), null);
});
