import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SESSION_STATES,
  EVENT_TYPES,
  createWorkoutSession,
} from '../shared/workout-session.js';

const BENCH_PRESS_MOCK = {
  id: 'bench-press-1',
  name: 'Bench Press',
  sets: [
    { targetReps: 10, targetWeight: 60, restSeconds: 90 },
    { targetReps: 10, targetWeight: 60, restSeconds: 90 },
    { targetReps: 10, targetWeight: 60, restSeconds: 90 },
  ],
};

test('new session starts in READY state with prescription', () => {
  const session = createWorkoutSession({ exercise: BENCH_PRESS_MOCK });
  const view = session.view();

  assert.equal(view.state, SESSION_STATES.READY);
  assert.equal(view.exerciseName, 'Bench Press');
  assert.equal(view.totalSets, 3);
  assert.equal(view.currentSetIndex, 0);
  assert.equal(view.currentSet.weight, 60);
  assert.equal(view.currentSet.reps, 10);
});

test('startWorkout transitions from READY to ACTIVE_SET', () => {
  const session = createWorkoutSession({ exercise: BENCH_PRESS_MOCK });
  session.startWorkout({ timestamp: 1000 });

  const view = session.view();
  assert.equal(view.state, SESSION_STATES.ACTIVE_SET);
  assert.equal(view.currentSetIndex, 0);
  assert.equal(session.getJournal().length, 1);
  assert.equal(session.getJournal()[0].type, EVENT_TYPES.START_WORKOUT);
});

test('adjustWeight and adjustReps modify current set values', () => {
  const session = createWorkoutSession({ exercise: BENCH_PRESS_MOCK });
  session.startWorkout({ timestamp: 1000 });

  session.adjustWeight(2.5, { timestamp: 1010 });
  assert.equal(session.view().currentSet.weight, 62.5);

  session.adjustReps(-1, { timestamp: 1020 });
  assert.equal(session.view().currentSet.reps, 9);
});

test('completeSet transitions to REST and starts rest timer', () => {
  const session = createWorkoutSession({ exercise: BENCH_PRESS_MOCK });
  session.startWorkout({ timestamp: 1000 });
  session.completeSet({ timestamp: 2000 });

  const view = session.view(2000);
  assert.equal(view.state, SESSION_STATES.REST);
  assert.equal(view.currentSetIndex, 0); // set 0 just completed
  assert.equal(view.rest.duration, 90);
  assert.equal(view.rest.remaining, 90);
  assert.equal(view.completedSets.length, 1);
  assert.equal(view.completedSets[0].reps, 10);
  assert.equal(view.completedSets[0].weight, 60);
});

test('rest timer remaining calculates from absolute timestamp', () => {
  const session = createWorkoutSession({ exercise: BENCH_PRESS_MOCK });
  session.startWorkout({ timestamp: 1000 });
  session.completeSet({ timestamp: 2000 }); // ends at 2000 + 90*1000 = 92000

  // 30 seconds later (timestamp 32000)
  const view30s = session.view(32000);
  assert.equal(view30s.rest.remaining, 60);

  // 95 seconds later (timestamp 97000)
  const viewDone = session.view(97000);
  assert.equal(viewDone.rest.remaining, 0);
});

test('skipRest / nextSet transitions from REST to ACTIVE_SET on next set', () => {
  const session = createWorkoutSession({ exercise: BENCH_PRESS_MOCK });
  session.startWorkout({ timestamp: 1000 });
  session.completeSet({ timestamp: 2000 });

  session.nextSet({ timestamp: 5000 });
  const view = session.view();
  assert.equal(view.state, SESSION_STATES.ACTIVE_SET);
  assert.equal(view.currentSetIndex, 1);
});

test('completing final set transitions to FINISHED', () => {
  const session = createWorkoutSession({ exercise: BENCH_PRESS_MOCK });
  session.startWorkout({ timestamp: 1000 });

  // Set 1
  session.completeSet({ timestamp: 2000 });
  session.nextSet({ timestamp: 3000 });

  // Set 2
  session.completeSet({ timestamp: 4000 });
  session.nextSet({ timestamp: 5000 });

  // Set 3 (final)
  session.completeSet({ timestamp: 6000 });

  const view = session.view();
  assert.equal(view.state, SESSION_STATES.FINISHED);
  assert.equal(view.completedSets.length, 3);
});

test('replaying journal restores identical state', () => {
  const session = createWorkoutSession({ exercise: BENCH_PRESS_MOCK });
  session.startWorkout({ timestamp: 1000 });
  session.adjustWeight(5, { timestamp: 1010 });
  session.completeSet({ timestamp: 2000 });
  session.nextSet({ timestamp: 3000 });

  const journal = session.getJournal();

  // Replay into fresh session
  const replayed = createWorkoutSession({ exercise: BENCH_PRESS_MOCK, initialJournal: journal });
  assert.deepEqual(replayed.view(), session.view());
});
