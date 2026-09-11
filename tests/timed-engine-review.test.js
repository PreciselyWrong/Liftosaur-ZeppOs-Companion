import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkoutSession } from '../shared/workout-session.js';
import { createWorkoutController } from '../shared/workout-controller.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';

const plan = { source: 'WORKOUT_API', programId: 'p', unit: 'kg', exercises: [{
  id: 'e', entryId: 'e', name: 'Side Plank', sets: [{ index: 1, setId: 's1', setTimer: 30, restSeconds: 60, isUnilateral: true }],
}] };
function start(ready = 5) {
  const session = createWorkoutSession({ plan });
  session.startWorkout({ timestamp: 1000 });
  session.startTimedSet({ timestamp: 1000, getReadySeconds: ready });
  return session;
}

test('late preparation resume starts effort now without inventing elapsed exercise', () => {
  const session = start();
  const restored = createWorkoutSession({ plan, initialJournal: session.getJournal() });
  assert.equal(restored.advanceTimedSet({ timestamp: 91000 }), true);
  assert.equal(restored.view(91000).timedSet.elapsedSeconds, 0);
  assert.equal(restored.view(94000).timedSet.elapsedSeconds, 3);
});

test('native pause during preparation survives replay and prevents automatic effort', () => {
  const session = start();
  session.pauseWorkout({ timestamp: 3000 });
  const restored = createWorkoutSession({ plan, initialJournal: session.getJournal() });
  assert.equal(restored.advanceTimedSet({ timestamp: 31000 }), false);
  assert.equal(restored.view(31000).timedSet.remaining, 3);
  restored.resumeWorkout({ timestamp: 31000 });
  assert.equal(restored.advanceTimedSet({ timestamp: 33000 }), false);
  assert.equal(restored.advanceTimedSet({ timestamp: 34000 }), true);
});

test('native resume cannot release a manually paused side', () => {
  const session = start(0);
  session.pauseWorkout({ timestamp: 6000 });
  session.pauseTimedSet({ timestamp: 8000 });
  session.resumeWorkout({ timestamp: 11000 });
  assert.equal(session.view(21000).timedSet.elapsedSeconds, 5);
  session.resumeTimedSet({ timestamp: 21000 });
  assert.equal(session.view(26000).timedSet.elapsedSeconds, 10);
});

test('duplicate stop with countdown disabled cannot complete the untouched right side', () => {
  const session = start(0);
  session.stopTimedSide({ timestamp: 11000, getReadySeconds: 0 });
  session.stopTimedSide({ timestamp: 11000, getReadySeconds: 0 });
  assert.equal(session.getWorkoutSetWrites().length, 0);
  assert.equal(session.view(11000).timedSet.side, 'RIGHT');
  assert.equal(session.view(11000).timedSet.completedLeftSeconds, 10);
});

test('late set synchronization preserves the next active side and its partial duration', async () => {
  const remote = { programId: 'p', startTime: 1000, dayData: { week: 1, dayInWeek: 1 }, entries: [{
    entryId: 'e', name: 'Side Plank', sets: [1, 2].map(index => ({
      setId: `s${index}`, reps: 1, setTimer: 30, isUnilateral: true, timer: 60, completed: null,
    })),
  }] };
  let clock = 1000;
  let resolveSync;
  const controller = createWorkoutController({ now: () => clock, request: async (type, payload) => {
    assert.equal(type, 'SYNC_WORKOUT_SETS');
    remote.entries[0].sets[0].completed = payload.sets[0].completed;
    return new Promise(resolve => { resolveSync = resolve; });
  } });
  controller.loadPlan(workoutToDayPlan(remote, { isCurrent: true }), { sync: { mode: 'DIRECT', startConfirmed: true } });
  controller.configureTimedSets({ getReadySeconds: 0 });
  controller.startTimedSet();
  clock = 11000; controller.stopTimedSide();
  clock = 21000; controller.stopTimedSide();
  await Promise.resolve();
  controller.nextSet();
  controller.startTimedSet();
  clock = 31000; controller.stopTimedSide();
  resolveSync({ payload: { workout: remote } });
  await controller.syncSets();
  assert.equal(controller.view().currentSet.setId, 's2');
  assert.equal(controller.view().timedSet.side, 'RIGHT');
  assert.equal(controller.view().timedSet.completedLeftSeconds, 10);
  assert.equal(controller.sync().acknowledgedSetCount, 1);
});
