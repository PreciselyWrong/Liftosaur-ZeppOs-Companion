import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkoutSession } from '../shared/workout-session.js';
import { createWorkoutController } from '../shared/workout-controller.js';
import { createMemoryStorageAdapter, createSessionStore } from '../shared/session-storage.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';

const plan = (unilateral = false, restSeconds = 60) => ({
  source: 'WORKOUT_API', programId: 'p', unit: 'kg', exercises: [{
    id: 'e', entryId: 'e', name: 'Side plank', sets: [1, 2].map(index => ({
      index, setId: `s${index}`, setTimer: 30, restSeconds, isUnilateral: unilateral,
    })),
  }],
});
function start(unilateral = false, rest = 60) {
  const session = createWorkoutSession({ plan: plan(unilateral, rest) });
  session.startWorkout({ timestamp: 1000 });
  session.startTimedSet({ timestamp: 1000, getReadySeconds: 5 });
  return session;
}
test('timed effort starts after preparation and continues overtime without completing', () => {
  const s = start();
  assert.equal(s.view(1000).timedSet.phase, 'GET_READY');
  s.advanceTimedSet({ timestamp: 6000 });
  assert.equal(s.view(8000).timedSet.elapsedSeconds, 2);
  s.advanceTimedSet({ timestamp: 46000 });
  assert.equal(s.view(46000).timedSet.remaining, -10);
  assert.equal(s.getWorkoutSetWrites().length, 0);
  s.stopTimedSide({ timestamp: 46000 });
  assert.equal(s.getWorkoutSetWrites()[0].completed.setTimer, 40);
});
test('unilateral partial effort survives replay and sends both sides together', () => {
  const s = start(true);
  s.advanceTimedSet({ timestamp: 6000 });
  s.stopTimedSide({ timestamp: 36000 });
  assert.equal(s.getWorkoutSetWrites().length, 0);
  assert.equal(s.view(36000).timedSet.side, 'RIGHT');
  const replay = createWorkoutSession({ plan: plan(true), initialJournal: s.getJournal() });
  replay.finishWorkout({ timestamp: 36000 });
  assert.equal(replay.view(36000).state, 'ACTIVE_SET');
  replay.advanceTimedSet({ timestamp: 41000 });
  replay.stopTimedSide({ timestamp: 61000 });
  assert.deepEqual(replay.getWorkoutSetWrites()[0].completed, { setTimer: 20, setTimerLeft: 30 });
});
test('manual and native pause compose without counting paused time', () => {
  const s = start(false, 0);
  s.pauseTimedSet({ timestamp: 11000 });
  s.pauseWorkout({ timestamp: 12000 });
  s.resumeTimedSet({ timestamp: 13000 });
  assert.equal(s.view(20000).timedSet.elapsedSeconds, 10);
  s.resumeWorkout({ timestamp: 21000 });
  assert.equal(s.view(26000).timedSet.elapsedSeconds, 15);
});
test('controller exposes timers and refuses remote finish during partial side', async () => {
  let clock = 1000;
  const c = createWorkoutController({ now: () => clock });
  c.loadPlan(plan(true));
  c.configureTimedSets({ getReadySeconds: 0 });
  c.startWorkout(); c.startTimedSet();
  clock = 31000; c.stopTimedSide();
  assert.equal(c.view().timedSet.completedLeftSeconds, 30);
  assert.deepEqual(await c.finishWorkoutRemote(), { success: false, reason: 'TIMED_SET_ACTIVE' });
});

test('late preparation resume begins effort now without phantom elapsed seconds', () => {
  const s = start();
  s.advanceTimedSet({ timestamp: 3600000 });
  assert.equal(s.view(3600000).timedSet.elapsedSeconds, 0);
  assert.equal(s.getWorkoutSetWrites().length, 0);
});

test('rest is consumed once and zero rest suppresses side preparation', () => {
  const s = start();
  s.startTimedSet({ timestamp: 2000 });
  s.stopTimedSide({ timestamp: 32000 });
  s.startTimedSet({ timestamp: 90000, getReadySeconds: 5 });
  assert.equal(s.view(90000).timedSet.remaining, 2);
  s.advanceTimedSet({ timestamp: 92000 });
  assert.equal(s.view(92000).timedSet.remaining, 30);
  const zero = start(true, 0);
  zero.stopTimedSide({ timestamp: 31000 });
  assert.equal(zero.view(31000).timedSet.phase, 'WORK');
});

test('arming during rest preserves its full duration and only the final seconds prepare', () => {
  const s = start();
  s.startTimedSet({ timestamp: 2000 }); s.stopTimedSide({ timestamp: 32000 });
  s.startTimedSet({ timestamp: 32000, getReadySeconds: 5 });
  assert.equal(s.view(32000).state, 'REST');
  assert.equal(s.view(32000).timedSet.phase, 'REST');
  assert.equal(s.view(32000).rest.remaining, 60);
  assert.equal(s.advanceTimedSet({ timestamp: 86000 }), false);
  assert.equal(s.advanceTimedSet({ timestamp: 87000 }), true);
  assert.equal(s.view(87000).timedSet.phase, 'GET_READY');
  assert.equal(s.view(87000).timedSet.preparationSeconds, 5);
  s.advanceTimedSet({ timestamp: 92000 });
  assert.equal(s.view(92000).timedSet.phase, 'WORK');
  assert.equal(s.view(92000).timedSet.elapsedSeconds, 0);
});

test('armed rest follows adjustments and overlapping pauses through durable replay', () => {
  const s = start();
  s.startTimedSet({ timestamp: 2000 }); s.stopTimedSide({ timestamp: 32000 });
  s.startTimedSet({ timestamp: 32000, getReadySeconds: 5 });
  s.pauseRest({ timestamp: 42000 }); s.pauseWorkout({ timestamp: 43000 });
  s.adjustRest(10, { timestamp: 44000 });
  const restored = createWorkoutSession({ plan: plan(), initialJournal: s.getJournal() });
  assert.equal(restored.view(100000).timedSet.remaining, 60);
  restored.resumeRest({ timestamp: 100000 });
  assert.equal(restored.advanceTimedSet({ timestamp: 200000 }), false);
  restored.resumeWorkout({ timestamp: 200000 });
  restored.advanceTimedSet({ timestamp: 255000 });
  assert.equal(restored.view(255000).timedSet.phase, 'GET_READY');
  assert.equal(restored.view(255000).timedSet.remaining, 5);
});

test('preparation uses the existing rest even when the upcoming set has zero rest', () => {
  const p = plan(); p.exercises[0].sets[1].restSeconds = 0;
  const s = createWorkoutSession({ plan: p });
  s.startWorkout({ timestamp: 1000 }); s.startTimedSet({ timestamp: 1000, getReadySeconds: 0 });
  s.stopTimedSide({ timestamp: 31000 });
  s.startTimedSet({ timestamp: 89000, getReadySeconds: 5 });
  assert.equal(s.view(89000).timedSet.phase, 'GET_READY');
  assert.equal(s.view(89000).timedSet.remaining, 2);
});

test('active timer cannot be navigated away or overwritten by direct completion', () => {
  const s = start(true, 0);
  s.selectExercise(0, { timestamp: 2000 });
  s.completeSet({ timestamp: 2000 });
  assert.equal(s.view(2000).timedSet.elapsedSeconds, 1);
  assert.equal(s.getWorkoutSetWrites().length, 0);
});

test('timer ticks do not save or notify unless a phase changes', () => {
  let saves = 0; let changes = 0; let clock = 1000;
  const c = createWorkoutController({ now: () => clock,
    store: { save: () => ++saves }, onChange: () => ++changes });
  c.loadPlan(plan()); c.startWorkout(); c.startTimedSet();
  const initial = [saves, changes];
  clock = 2000; c.advanceTimedSet();
  assert.deepEqual([saves, changes], initial);
  clock = 6000; c.advanceTimedSet();
  assert.deepEqual([saves, changes], initial.map(n => n + 1));
  clock = 40000; c.advanceTimedSet();
  assert.deepEqual([saves, changes], initial.map(n => n + 1));
});

test('controller durable restore preserves the left result and overlapping pauses', () => {
  let clock = 1000;
  const store = createSessionStore(createMemoryStorageAdapter());
  const c = createWorkoutController({ store, now: () => clock });
  c.loadPlan(plan(true)); c.startWorkout(); c.configureTimedSets({ getReadySeconds: 0 }); c.startTimedSet();
  clock = 31000; c.stopTimedSide();
  clock = 41000; c.pauseTimedSet();
  clock = 42000; c.pauseWorkout();
  const restored = createWorkoutController({ store, now: () => clock });
  assert.equal(restored.restore().success, true);
  clock = 100000; restored.resumeWorkout();
  assert.equal(restored.view().timedSet.elapsedSeconds, 10);
  assert.equal(restored.view().timedSet.completedLeftSeconds, 30);
  restored.resumeTimedSet(); clock = 105000; restored.stopTimedSide();
  assert.equal(restored.getWorkoutSetWrites()[0].completed.setTimer, 15);
});

test('active timer snapshot deferral never loses partial side or overwrites a completed set', () => {
  let clock = 1000;
  const c = createWorkoutController({ now: () => clock });
  c.loadPlan(plan(true)); c.startWorkout(); c.configureTimedSets({ getReadySeconds: 0 }); c.startTimedSet();
  clock = 31000; c.stopTimedSide();
  c.applyAdoptedSnapshot({ invalid: 'must not be adopted' });
  assert.equal(c.hasDeferredServerWorkout(), true);
  assert.equal(c.view().timedSet.completedLeftSeconds, 30);
  clock = 61000; c.stopTimedSide();
  assert.equal(c.hasDeferredServerWorkout(), false);
  assert.equal(c.getWorkoutSetWrites()[0].completed.setTimerLeft, 30);
});

test('API mapping and restored writes preserve independently completed side durations', () => {
  const mapped = workoutToDayPlan({ programId: 'p', startTime: 1000, entries: [{
    entryId: 'e', name: 'Side plank', sets: [{ id: 's', setTimer: 30,
      isUnilateral: true, completed: { setTimer: 24, setTimerLeft: 28 } }],
  }] }, { units: 'kg', isCurrent: true });
  const s = createWorkoutSession({ plan: mapped });
  assert.equal(s.view().allCompletedSets[0].setTimerLeft, 28);
});
