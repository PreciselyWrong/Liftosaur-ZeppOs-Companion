import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkoutSession, SESSION_STATES, weightStepFor } from '../shared/workout-session.js';

function makePlan(overrides = {}) {
  return {
    programId: 'prog-1',
    programName: 'Test',
    programVersion: 'abc123',
    dayName: 'Semaine 1 - Mardi: PUSH A',
    week: 1,
    dayInWeek: 1,
    unit: 'kg',
    exercises: [
      {
        index: 1,
        id: 'ex-1',
        name: 'Decline Bench Press',
        sets: [
          { index: 1, targetReps: 8, targetWeight: 80, targetRpe: 8, restSeconds: 120, isAmrap: false },
          { index: 2, targetReps: 8, targetWeight: 80, targetRpe: 8, restSeconds: 120, isAmrap: false },
        ],
      },
      {
        index: 2,
        id: 'ex-2',
        name: 'Triceps Pushdown',
        sets: [
          { index: 1, targetReps: 11, targetWeight: 35, targetRpe: 8, restSeconds: 75, isAmrap: true },
        ],
      },
    ],
    ...overrides,
  };
}

test('a session with no plan needs one', () => {
  const view = createWorkoutSession({ plan: null }).view();
  assert.equal(view.state, SESSION_STATES.NO_PLAN);
  assert.equal(view.totalExercises, 0);
});

test('starts on the first set with the API targets loaded', () => {
  const session = createWorkoutSession({ plan: makePlan() });
  assert.equal(session.view().state, SESSION_STATES.READY);

  session.startWorkout({ timestamp: 1000 });
  const view = session.view(1000);

  assert.equal(view.state, SESSION_STATES.ACTIVE_SET);
  assert.equal(view.exerciseName, 'Decline Bench Press');
  assert.equal(view.currentSet.weight, 80);
  assert.equal(view.currentSet.reps, 8);
  assert.equal(view.currentSet.rpe, 8);
  assert.equal(view.currentSet.restSeconds, 120);
});

test('rests for the duration the API prescribed', () => {
  const session = createWorkoutSession({ plan: makePlan() });
  session.startWorkout({ timestamp: 0 });
  session.completeSet({ timestamp: 1000 });

  const view = session.view(1000);
  assert.equal(view.state, SESSION_STATES.REST);
  assert.equal(view.rest.duration, 120);
  assert.equal(view.rest.remaining, 120);
  assert.equal(view.rest.nextSetIndex, 1);
  assert.equal(view.rest.isTransitionToNextExercise, false);
});

test('rest is absolute, so a late render still counts down correctly', () => {
  const session = createWorkoutSession({ plan: makePlan() });
  session.startWorkout({ timestamp: 0 });
  session.completeSet({ timestamp: 10_000 });

  assert.equal(session.view(70_000).rest.remaining, 60);
  assert.equal(session.view(140_000).rest.isOvertime, true);
  assert.equal(session.view(140_000).rest.remaining, -10);
});

test('moves to the next exercise once the current one is done', () => {
  const session = createWorkoutSession({ plan: makePlan() });
  session.startWorkout({ timestamp: 0 });
  session.completeSet({ timestamp: 1 });
  session.nextSet({ timestamp: 2 });
  session.completeSet({ timestamp: 3 });

  assert.equal(session.view(3).rest.isTransitionToNextExercise, true);
  assert.equal(session.view(3).rest.nextExerciseName, 'Triceps Pushdown');

  session.nextSet({ timestamp: 4 });
  const view = session.view(4);
  assert.equal(view.exerciseName, 'Triceps Pushdown');
  assert.equal(view.currentSet.isAmrap, true);
});

test('finishes when the last set is completed', () => {
  const session = createWorkoutSession({ plan: makePlan() });
  session.startWorkout({ timestamp: 0 });
  session.completeSet({ timestamp: 1 });
  session.nextSet({ timestamp: 2 });
  session.completeSet({ timestamp: 3 });
  session.nextSet({ timestamp: 4 });
  session.completeSet({ timestamp: 5 });

  assert.equal(session.view(5).state, SESSION_STATES.FINISHED);
  assert.equal(session.isAllCompleted(), true);
});

test('skips the rest screen when the API prescribed no timer', () => {
  const plan = makePlan();
  plan.exercises[0].sets[0].restSeconds = null;

  const session = createWorkoutSession({ plan });
  session.startWorkout({ timestamp: 0 });
  session.completeSet({ timestamp: 1 });

  const view = session.view(1);
  assert.equal(view.state, SESSION_STATES.ACTIVE_SET);
  assert.equal(view.currentSetIndex, 1);
});

test('adjusts weight by the step of the plan unit', () => {
  assert.equal(weightStepFor('kg'), 2.5);
  assert.equal(weightStepFor('lb'), 5);

  const session = createWorkoutSession({ plan: makePlan() });
  session.startWorkout({ timestamp: 0 });
  session.adjustWeight(1);
  assert.equal(session.view().currentSet.weight, 82.5);

  session.adjustWeight(-2);
  assert.equal(session.view().currentSet.weight, 77.5);
});

test('adjusts reps and RPE within sane bounds', () => {
  const session = createWorkoutSession({ plan: makePlan() });
  session.startWorkout({ timestamp: 0 });

  session.adjustReps(2);
  assert.equal(session.view().currentSet.reps, 10);

  session.adjustRpe(0.5);
  assert.equal(session.view().currentSet.rpe, 8.5);

  session.adjustRpe(5);
  assert.equal(session.view().currentSet.rpe, 10);
});

test('records what the user actually did, as playground indices', () => {
  const session = createWorkoutSession({ plan: makePlan() });
  session.startWorkout({ timestamp: 0 });
  session.adjustWeight(1);
  session.adjustReps(-1);
  session.completeSet({ timestamp: 1 });
  session.nextSet({ timestamp: 2 });
  session.completeSet({ timestamp: 3 });

  assert.deepEqual(session.getCompletedSets(), [
    { exerciseIndex: 1, setIndex: 1, weight: 82.5, reps: 7, rpe: 8, unit: 'kg' },
    { exerciseIndex: 1, setIndex: 2, weight: 80, reps: 8, rpe: 8, unit: 'kg' },
  ]);
});

test('an adjustment applies to the current set only', () => {
  const session = createWorkoutSession({ plan: makePlan() });
  session.startWorkout({ timestamp: 0 });
  session.adjustWeight(2);
  session.completeSet({ timestamp: 1 });
  session.nextSet({ timestamp: 2 });

  assert.equal(session.view().currentSet.weight, 80, 'set 2 keeps its prescribed weight');
});

test('jumping to another exercise resumes it where it stopped', () => {
  const session = createWorkoutSession({ plan: makePlan() });
  session.startWorkout({ timestamp: 0 });
  session.selectExercise(1);

  const view = session.view();
  assert.equal(view.exerciseName, 'Triceps Pushdown');
  assert.equal(view.currentSet.weight, 35);
  assert.equal(view.state, SESSION_STATES.ACTIVE_SET);
});

test('replaying the journal rebuilds the same state', () => {
  const session = createWorkoutSession({ plan: makePlan() });
  session.startWorkout({ timestamp: 0 });
  session.adjustWeight(1);
  session.completeSet({ timestamp: 1 });

  const restored = createWorkoutSession({ plan: makePlan(), initialJournal: session.getJournal() });

  assert.deepEqual(restored.getCompletedSets(), session.getCompletedSets());
  assert.equal(restored.view(1).state, session.view(1).state);
});

test('cancelling clears the journal and returns to ready', () => {
  const session = createWorkoutSession({ plan: makePlan() });
  session.startWorkout({ timestamp: 0 });
  session.completeSet({ timestamp: 1 });
  session.cancelWorkout({ timestamp: 2 });

  assert.equal(session.view().state, SESSION_STATES.READY);
  assert.deepEqual(session.getCompletedSets(), []);
  assert.deepEqual(session.getJournal(), []);
});

test('reports volume and elapsed time for the summary', () => {
  const session = createWorkoutSession({ plan: makePlan() });
  session.startWorkout({ timestamp: 0 });
  session.completeSet({ timestamp: 1000 });

  const view = session.view(61_000);
  assert.equal(view.totalVolume, 640);
  assert.equal(view.elapsedSeconds, 61);
  assert.equal(view.totalCompletedSetsCount, 1);
});

test('carries the plan identity needed to write back', () => {
  const view = createWorkoutSession({ plan: makePlan() }).view();

  assert.equal(view.programId, 'prog-1');
  assert.equal(view.programVersion, 'abc123');
  assert.equal(view.week, 1);
  assert.equal(view.dayInWeek, 1);
  assert.equal(view.dayName, 'Semaine 1 - Mardi: PUSH A');
});

test('warmup sets run before work sets and are omitted from playground replay', () => {
  const plan = {
    programId: 'p1',
    unit: 'kg',
    exercises: [
      {
        index: 1,
        name: 'Bench Press',
        warmupSets: [
          { index: 1, targetReps: 10, targetWeight: 35, targetWeightPercent: 40, restSeconds: 60 },
          { index: 2, targetReps: 5, targetWeight: 60, targetWeightPercent: 70, restSeconds: 60 },
        ],
        sets: [
          { index: 1, targetReps: 8, targetWeight: 80, targetRpe: 8, restSeconds: 120 },
        ],
      },
    ],
  };

  const session = createWorkoutSession({ plan });
  session.startWorkout({ timestamp: 0 });

  let view = session.view();
  assert.equal(view.totalSets, 3);
  assert.equal(view.currentSet.isWarmup, true);
  assert.equal(view.currentSet.warmupIndex, 1);
  assert.equal(view.currentSet.totalWarmups, 2);
  assert.equal(view.currentSet.targetWeight, 35);
  assert.equal(view.currentSet.targetWeightPercent, 40);

  // Complete warmup 1
  session.completeSet({ timestamp: 10 });
  view = session.view();
  assert.equal(view.state, SESSION_STATES.REST);
  assert.equal(view.rest.nextIsWarmup, true);

  // Advance to warmup 2
  session.nextSet({ timestamp: 70 });
  view = session.view();
  assert.equal(view.currentSet.isWarmup, true);
  assert.equal(view.currentSet.warmupIndex, 2);
  assert.equal(view.currentSet.targetWeight, 60);

  // Complete warmup 2
  session.completeSet({ timestamp: 80 });
  session.nextSet({ timestamp: 140 });

  // Now in work set 1
  view = session.view();
  assert.equal(view.currentSet.isWarmup, false);
  assert.equal(view.currentSet.workSetIndex, 1);
  assert.equal(view.currentSet.targetWeight, 80);

  // Complete work set 1
  session.completeSet({ timestamp: 150 });
  assert.equal(session.view().state, SESSION_STATES.FINISHED);

  // Only the working set is returned for playground replay
  const replay = session.getCompletedSets();
  assert.deepEqual(replay, [
    { exerciseIndex: 1, setIndex: 1, weight: 80, reps: 8, rpe: 8, unit: 'kg' },
  ]);
});

test('exercises in a superset group alternate working sets', () => {
  const plan = {
    programId: 'p1',
    unit: 'kg',
    exercises: [
      {
        index: 1,
        name: 'Bench Press',
        supersetGroup: 'A',
        warmupSets: [],
        sets: [
          { index: 1, targetReps: 8, targetWeight: 80, restSeconds: 60 },
          { index: 2, targetReps: 8, targetWeight: 80, restSeconds: 60 },
        ],
      },
      {
        index: 2,
        name: 'Triceps Pushdown',
        supersetGroup: 'A',
        warmupSets: [],
        sets: [
          { index: 1, targetReps: 12, targetWeight: 35, restSeconds: 60 },
          { index: 2, targetReps: 12, targetWeight: 35, restSeconds: 60 },
        ],
      },
      {
        index: 3,
        name: 'Lateral Raise',
        supersetGroup: null,
        warmupSets: [],
        sets: [
          { index: 1, targetReps: 15, targetWeight: 10, restSeconds: 60 },
        ],
      },
    ],
  };

  const session = createWorkoutSession({ plan });
  session.startWorkout({ timestamp: 0 });

  // 1. Bench Press - Set 1
  assert.equal(session.view().exerciseName, 'Bench Press');
  assert.equal(session.view().currentSet.workSetIndex, 1);
  session.completeSet({ timestamp: 10 });

  // Rest screen announces Triceps Pushdown Set 1
  assert.equal(session.view().rest.nextExerciseName, 'Triceps Pushdown');
  assert.equal(session.view().rest.nextSetIndex, 0); // 0 completed -> set 1
  session.nextSet({ timestamp: 70 });

  // 2. Triceps Pushdown - Set 1
  assert.equal(session.view().exerciseName, 'Triceps Pushdown');
  assert.equal(session.view().currentSet.workSetIndex, 1);
  session.completeSet({ timestamp: 80 });

  // Rest screen announces Bench Press Set 2
  assert.equal(session.view().rest.nextExerciseName, 'Bench Press');
  assert.equal(session.view().rest.nextSetIndex, 1); // 1 completed -> set 2
  session.nextSet({ timestamp: 140 });

  // 3. Bench Press - Set 2
  assert.equal(session.view().exerciseName, 'Bench Press');
  assert.equal(session.view().currentSet.workSetIndex, 2);
  session.completeSet({ timestamp: 150 });

  // Rest screen announces Triceps Pushdown Set 2
  assert.equal(session.view().rest.nextExerciseName, 'Triceps Pushdown');
  session.nextSet({ timestamp: 210 });

  // 4. Triceps Pushdown - Set 2 (Superset A complete!)
  assert.equal(session.view().exerciseName, 'Triceps Pushdown');
  assert.equal(session.view().currentSet.workSetIndex, 2);
  session.completeSet({ timestamp: 220 });

  // Rest screen announces Lateral Raise (outside superset)
  assert.equal(session.view().rest.nextExerciseName, 'Lateral Raise');
  session.nextSet({ timestamp: 280 });

  // 5. Lateral Raise - Set 1
  assert.equal(session.view().exerciseName, 'Lateral Raise');
  session.completeSet({ timestamp: 290 });

  // All finished
  assert.equal(session.view().state, SESSION_STATES.FINISHED);

  const replay = session.getCompletedSets();
  assert.equal(replay.length, 5);
  assert.deepEqual(replay.map((s) => [s.exerciseIndex, s.setIndex]), [
    [1, 1],
    [2, 1],
    [1, 2],
    [2, 2],
    [3, 1],
  ]);
});

test('superset with warmups finishes warmups then proceeds to work set 1 before partner', () => {
  const plan = {
    programId: 'p1',
    unit: 'kg',
    exercises: [
      {
        index: 1,
        name: 'Incline Bench',
        supersetGroup: 'A',
        warmupSets: [
          { index: 1, targetReps: 10, targetWeight: 40, restSeconds: 60 },
          { index: 2, targetReps: 5, targetWeight: 60, restSeconds: 60 },
        ],
        sets: [
          { index: 1, targetReps: 8, targetWeight: 80, restSeconds: 90 },
          { index: 2, targetReps: 8, targetWeight: 80, restSeconds: 90 },
        ],
      },
      {
        index: 2,
        name: 'Cable Row',
        supersetGroup: 'A',
        warmupSets: [],
        sets: [
          { index: 1, targetReps: 10, targetWeight: 50, restSeconds: 90 },
          { index: 2, targetReps: 10, targetWeight: 50, restSeconds: 90 },
        ],
      },
    ],
  };

  const session = createWorkoutSession({ plan });
  session.startWorkout({ timestamp: 0 });

  // Incline Bench Warmup 1
  assert.equal(session.view().exerciseName, 'Incline Bench');
  assert.equal(session.view().currentSet.isWarmup, true);
  session.completeSet({ timestamp: 10 });
  session.nextSet({ timestamp: 70 });

  // Incline Bench Warmup 2
  assert.equal(session.view().exerciseName, 'Incline Bench');
  assert.equal(session.view().currentSet.isWarmup, true);
  session.completeSet({ timestamp: 80 });
  session.nextSet({ timestamp: 140 });

  // Incline Bench Work Set 1 (must NOT jump to Cable Row before doing own work set 1!)
  assert.equal(session.view().exerciseName, 'Incline Bench');
  assert.equal(session.view().currentSet.isWarmup, false);
  assert.equal(session.view().currentSet.workSetIndex, 1);
  session.completeSet({ timestamp: 150 });

  // Now transitions to Cable Row Work Set 1
  assert.equal(session.view().rest.nextExerciseName, 'Cable Row');
  session.nextSet({ timestamp: 240 });

  // Cable Row Work Set 1
  assert.equal(session.view().exerciseName, 'Cable Row');
  assert.equal(session.view().currentSet.workSetIndex, 1);
  session.completeSet({ timestamp: 250 });

  // Transitions back to Incline Bench Work Set 2
  assert.equal(session.view().rest.nextExerciseName, 'Incline Bench');
  session.nextSet({ timestamp: 340 });

  // Incline Bench Work Set 2
  assert.equal(session.view().exerciseName, 'Incline Bench');
  assert.equal(session.view().currentSet.workSetIndex, 2);
  session.completeSet({ timestamp: 350 });

  // Transitions to Cable Row Work Set 2
  assert.equal(session.view().rest.nextExerciseName, 'Cable Row');
  session.nextSet({ timestamp: 440 });

  // Cable Row Work Set 2
  assert.equal(session.view().exerciseName, 'Cable Row');
  assert.equal(session.view().currentSet.workSetIndex, 2);
  session.completeSet({ timestamp: 450 });

  assert.equal(session.view().state, SESSION_STATES.FINISHED);
});

test('tri-set (3-exercise superset) cycles A1 -> B1 -> C1 -> A2 -> B2 -> C2', () => {
  const plan = {
    programId: 'p1',
    unit: 'kg',
    exercises: [
      {
        index: 1,
        name: 'Ex A',
        supersetGroup: 'TRI',
        warmupSets: [],
        sets: [
          { index: 1, targetReps: 10, targetWeight: 50, restSeconds: 30 },
          { index: 2, targetReps: 10, targetWeight: 50, restSeconds: 30 },
        ],
      },
      {
        index: 2,
        name: 'Ex B',
        supersetGroup: 'TRI',
        warmupSets: [],
        sets: [
          { index: 1, targetReps: 10, targetWeight: 30, restSeconds: 30 },
          { index: 2, targetReps: 10, targetWeight: 30, restSeconds: 30 },
        ],
      },
      {
        index: 3,
        name: 'Ex C',
        supersetGroup: 'TRI',
        warmupSets: [],
        sets: [
          { index: 1, targetReps: 10, targetWeight: 20, restSeconds: 30 },
          { index: 2, targetReps: 10, targetWeight: 20, restSeconds: 30 },
        ],
      },
    ],
  };

  const session = createWorkoutSession({ plan });
  session.startWorkout({ timestamp: 0 });

  // Round 1
  assert.equal(session.view().exerciseName, 'Ex A');
  session.completeSet({ timestamp: 1 });
  session.nextSet({ timestamp: 2 });

  assert.equal(session.view().exerciseName, 'Ex B');
  session.completeSet({ timestamp: 3 });
  session.nextSet({ timestamp: 4 });

  assert.equal(session.view().exerciseName, 'Ex C');
  session.completeSet({ timestamp: 5 });
  session.nextSet({ timestamp: 6 });

  // Round 2
  assert.equal(session.view().exerciseName, 'Ex A');
  session.completeSet({ timestamp: 7 });
  session.nextSet({ timestamp: 8 });

  assert.equal(session.view().exerciseName, 'Ex B');
  session.completeSet({ timestamp: 9 });
  session.nextSet({ timestamp: 10 });

  assert.equal(session.view().exerciseName, 'Ex C');
  session.completeSet({ timestamp: 11 });

  assert.equal(session.view().state, SESSION_STATES.FINISHED);
});
