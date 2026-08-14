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

test('rest timer remaining calculates from absolute timestamp and tracks overtime', () => {
  const session = createWorkoutSession({ exercise: BENCH_PRESS_MOCK });
  session.startWorkout({ timestamp: 1000 });
  session.completeSet({ timestamp: 2000 }); // ends at 2000 + 90*1000 = 92000

  // 30 seconds later (timestamp 32000)
  const view30s = session.view(32000);
  assert.equal(view30s.rest.remaining, 60);
  assert.equal(view30s.rest.isOvertime, false);

  // 95 seconds later (timestamp 97000): 5 seconds overtime (-5s)
  const viewOvertime = session.view(97000);
  assert.equal(viewOvertime.rest.remaining, -5);
  assert.equal(viewOvertime.rest.isOvertime, true);
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

test('multi-exercise workout allows exercise navigation and automatic progression', () => {
  const MULTI_WORKOUT = {
    id: 'workout-1',
    name: 'Push Day',
    exercises: [
      {
        id: 'bench',
        name: 'Bench Press',
        sets: [{ targetReps: 10, targetWeight: 60, restSeconds: 60 }],
      },
      {
        id: 'overhead',
        name: 'Overhead Press',
        sets: [{ targetReps: 8, targetWeight: 40, restSeconds: 90 }],
      },
    ],
  };

  const session = createWorkoutSession({ workout: MULTI_WORKOUT });
  session.startWorkout();

  assert.equal(session.view().exerciseName, 'Bench Press');
  assert.equal(session.view().totalExercises, 2);
  assert.equal(session.view().currentExerciseIndex, 0);

  session.selectExercise(1);
  assert.equal(session.view().exerciseName, 'Overhead Press');
  assert.equal(session.view().currentExerciseIndex, 1);

  session.completeSet();
  session.nextSet();

  session.selectExercise(0);
  assert.equal(session.view().exerciseName, 'Bench Press');
  session.completeSet();

  assert.equal(session.isAllCompleted(), true);
});

test('session automatically jumps alternately between exercises in a superset', () => {
  const SUPERSET_WORKOUT = {
    id: 'superset-day',
    name: 'Upper Body Superset (Heavy Intensity Focus)',
    exercises: [
      {
        id: 'bench-incline',
        name: 'Incline DB Bench',
        supersetGroup: 'A',
        supersetTag: 'SUPERSET A1',
        sets: [
          { targetReps: 10, targetWeight: 30, restSeconds: 30 },
          { targetReps: 10, targetWeight: 30, restSeconds: 30 },
        ],
      },
      {
        id: 'chest-row',
        name: 'DB Chest Row',
        supersetGroup: 'A',
        supersetTag: 'SUPERSET A2',
        sets: [
          { targetReps: 12, targetWeight: 26, restSeconds: 60 },
          { targetReps: 12, targetWeight: 26, restSeconds: 60 },
        ],
      },
    ],
  };

  const session = createWorkoutSession({ workout: SUPERSET_WORKOUT });
  session.startWorkout();

  // 1. Starts on A1 Set 1
  assert.equal(session.view().exerciseName, 'Incline DB Bench');
  assert.equal(session.view().currentSetIndex, 0);

  // 2. Complete A1 Set 1 -> Rest -> Next Set jumps to A2 Set 1!
  session.completeSet();
  assert.equal(session.view().rest.isTransitionToNextExercise, true);
  session.nextSet();

  assert.equal(session.view().exerciseName, 'DB Chest Row');
  assert.equal(session.view().currentSetIndex, 0);

  // 3. Complete A2 Set 1 -> Rest -> Next Set jumps back to A1 Set 2!
  session.completeSet();
  session.nextSet();

  assert.equal(session.view().exerciseName, 'Incline DB Bench');
  assert.equal(session.view().currentSetIndex, 1);

  // 4. Complete A1 Set 2 -> Rest -> Next Set jumps to A2 Set 2!
  session.completeSet();
  session.nextSet();

  assert.equal(session.view().exerciseName, 'DB Chest Row');
  assert.equal(session.view().currentSetIndex, 1);

  // 5. Complete A2 Set 2 -> All done -> FINISHED
  session.completeSet();
  assert.equal(session.isAllCompleted(), true);
  assert.equal(session.view().state, SESSION_STATES.FINISHED);
});




