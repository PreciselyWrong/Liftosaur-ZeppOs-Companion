import { describe, test } from 'node:test';
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

test('finishing the last set freezes elapsed time across persistence replay', () => {
  const plan = makePlan({
    exercises: [
      {
        index: 1,
        id: 'ex-1',
        name: 'Decline Bench Press',
        sets: [{ index: 1, targetWeight: 80, targetReps: 8, restSeconds: null }],
      },
    ],
  });
  const session = createWorkoutSession({ plan });

  session.startWorkout({ timestamp: 1_000 });
  session.completeSet({ timestamp: 6_000 });

  assert.equal(session.view(60_000).elapsedSeconds, 5);

  const restored = createWorkoutSession({ plan, initialJournal: session.getJournal() });
  assert.equal(restored.view(120_000).elapsedSeconds, 5);
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

test('rest timer pause, resume, toggle, and adjustment (+/- 10s)', () => {
  const session = createWorkoutSession({ plan: makePlan() });
  session.startWorkout({ timestamp: 0 });
  session.completeSet({ timestamp: 1000 }); // Rest for 120s, ends at 121,000

  // 10s elapsed
  assert.equal(session.view(11_000).rest.remaining, 110);
  assert.equal(session.view(11_000).rest.isPaused, false);

  // Pause at t=11_000 (110s remaining)
  session.pauseRest({ timestamp: 11_000 });
  assert.equal(session.view(11_000).rest.isPaused, true);
  assert.equal(session.view(11_000).rest.remaining, 110);

  // 50s pass in wall time, still remaining 110s because paused
  assert.equal(session.view(61_000).rest.remaining, 110);
  assert.equal(session.view(61_000).rest.isPaused, true);

  // Adjust rest while paused: +10s -> 120s
  session.adjustRest(10, { timestamp: 61_000 });
  assert.equal(session.view(61_000).rest.remaining, 120);

  // Adjust rest while paused: -20s -> 100s
  session.adjustRest(-20, { timestamp: 61_000 });
  assert.equal(session.view(61_000).rest.remaining, 100);

  // Resume at t=70_000 with 100s remaining -> ends at 170_000
  session.resumeRest({ timestamp: 70_000 });
  assert.equal(session.view(70_000).rest.isPaused, false);
  assert.equal(session.view(70_000).rest.remaining, 100);

  // 10s later (t=80_000) -> 90s remaining
  assert.equal(session.view(80_000).rest.remaining, 90);

  // Adjust while running: +10s -> 100s remaining (ends at 180_000)
  session.adjustRest(10, { timestamp: 80_000 });
  assert.equal(session.view(80_000).rest.remaining, 100);

  // Toggle pause/resume
  session.toggleRestPause({ timestamp: 80_000 });
  assert.equal(session.view(80_000).rest.isPaused, true);
  session.toggleRestPause({ timestamp: 90_000 });
  assert.equal(session.view(90_000).rest.isPaused, false);
  assert.equal(session.view(90_000).rest.remaining, 100);
});

test('pausing an overtime rest preserves the displayed overtime', () => {
  const session = createWorkoutSession({ plan: makePlan() });
  session.startWorkout({ timestamp: 0 });
  session.completeSet({ timestamp: 1000 });

  assert.equal(session.view(131_000).rest.remaining, -10);

  session.pauseRest({ timestamp: 131_000 });

  assert.equal(session.view(141_000).rest.remaining, -10);

  const restored = createWorkoutSession({
    plan: makePlan(),
    initialJournal: session.getJournal(),
  });
  assert.equal(restored.view(141_000).rest.remaining, -10);

  restored.resumeRest({ timestamp: 141_000 });
  assert.equal(restored.view(146_000).rest.remaining, -15);
});

test('rest view includes next target weight, reps, unit and warmups', () => {
  const plan = {
    programId: 'p1',
    unit: 'kg',
    exercises: [
      {
        index: 1,
        name: 'Squat',
        warmupSets: [
          { index: 1, targetReps: 5, targetWeight: 40, targetWeightPercent: 40, restSeconds: 60 },
        ],
        sets: [
          { index: 1, targetReps: 5, targetWeight: 100, restSeconds: 180 },
        ],
      },
    ],
  };

  const session = createWorkoutSession({ plan });
  session.startWorkout({ timestamp: 0 });

  // Currently on Warmup 1
  const v1 = session.view(0);
  assert.equal(v1.currentSet.isWarmup, true);
  assert.equal(v1.currentSet.weight, 40);

  // Complete Warmup 1 -> resting before Work Set 1
  session.completeSet({ timestamp: 1000 });
  const vRest = session.view(1000);
  assert.equal(vRest.state, SESSION_STATES.REST);
  assert.equal(vRest.rest.nextExerciseName, 'Squat');
  assert.equal(vRest.rest.nextIsWarmup, false);
  assert.equal(vRest.rest.nextWorkSetIndex, 1);
  assert.equal(vRest.rest.nextTargetWeight, 100);
  assert.equal(vRest.rest.nextTargetReps, 5);
  assert.equal(vRest.rest.nextUnit, 'kg');
});

test('exercise notes are exposed in active set and rest views', () => {
  const plan = {
    programId: 'p1',
    unit: 'kg',
    exercises: [
      {
        index: 1,
        name: 'Bench Press',
        notes: 'Pause 2s au bas',
        sets: [
          { index: 1, targetReps: 5, targetWeight: 80, restSeconds: 90 },
        ],
      },
      {
        index: 2,
        name: 'Incline Dumbbell Press',
        notes: 'Banc a 30 degres',
        sets: [
          { index: 1, targetReps: 8, targetWeight: 24, restSeconds: 60 },
        ],
      },
    ],
  };

  const session = createWorkoutSession({ plan });
  session.startWorkout({ timestamp: 0 });

  const activeView = session.view(0);
  assert.equal(activeView.exerciseNotes, 'Pause 2s au bas');

  // Complete set 1 -> rest before exercise 2
  session.completeSet({ timestamp: 1000 });
  const restView = session.view(1000);
  assert.equal(restView.state, SESSION_STATES.REST);
  assert.equal(restView.rest.nextExerciseName, 'Incline Dumbbell Press');
  assert.equal(restView.rest.nextExerciseNotes, 'Banc a 30 degres');
});

test('pausing rest pauses the global workout elapsed time', () => {
  const plan = {
    programId: 'p1',
    unit: 'kg',
    exercises: [
      {
        index: 1,
        name: 'Bench Press',
        sets: [
          { index: 1, targetReps: 5, targetWeight: 80, restSeconds: 60 },
          { index: 2, targetReps: 5, targetWeight: 80, restSeconds: 60 },
        ],
      },
    ],
  };

  const session = createWorkoutSession({ plan });
  session.startWorkout({ timestamp: 10_000 });

  // 10s elapsed
  assert.equal(session.view(20_000).elapsedSeconds, 10);

  // Complete set 1 at 20_000
  session.completeSet({ timestamp: 20_000 });
  assert.equal(session.view(20_000).elapsedSeconds, 10);

  // 5s of active rest: total elapsed = 15s
  assert.equal(session.view(25_000).elapsedSeconds, 15);

  // Pause rest at 25_000
  session.pauseRest({ timestamp: 25_000 });

  // While paused, 20s pass in wall clock time -> elapsed stays 15s
  assert.equal(session.view(35_000).elapsedSeconds, 15);
  assert.equal(session.view(45_000).elapsedSeconds, 15);

  // Resume rest at 45_000
  session.resumeRest({ timestamp: 45_000 });

  // 5s after resume -> elapsed = 20s
  assert.equal(session.view(50_000).elapsedSeconds, 20);
});


test('the Prepare screen edits the upcoming set, not the one just logged', () => {
  const session = createWorkoutSession({ plan: makePlan() });
  session.startWorkout({ timestamp: 0 });
  session.completeSet({ timestamp: 1000 });

  const resting = session.view(1000);
  assert.equal(resting.state, SESSION_STATES.REST);
  assert.equal(resting.pending.exerciseName, 'Decline Bench Press');
  assert.equal(resting.pending.setIndex, 1, 'set 2 of the same exercise');
  assert.equal(resting.pending.set.weight, 80);

  // Adjust while resting: the set already recorded must not move.
  session.adjustWeight(-1, { timestamp: 2000 });
  session.adjustReps(-2, { timestamp: 2000 });

  const adjusted = session.view(2000);
  assert.equal(adjusted.pending.set.weight, 77.5);
  assert.equal(adjusted.pending.set.reps, 6);
  assert.equal(adjusted.rest.nextTargetWeight, 77.5);
  assert.equal(adjusted.rest.nextTargetReps, 6);
  assert.equal(adjusted.completedSets[0].weight, 80, 'the logged set is untouched');
  assert.equal(adjusted.completedSets[0].reps, 8);

  // Starting the set keeps what was prepared.
  session.nextSet({ timestamp: 3000 });
  const active = session.view(3000);
  assert.equal(active.state, SESSION_STATES.ACTIVE_SET);
  assert.equal(active.currentSet.weight, 77.5);
  assert.equal(active.currentSet.reps, 6);
});

test('keeps loading equipment available for the current and pending set', () => {
  const loadingEquipment = {
    id: 'barbell',
    bar: { kg: '20kg' },
    multiplier: 2,
    isFixed: false,
    plates: [{ weight: '20kg', num: 2 }],
    fixed: [],
  };
  const plan = makePlan({
    exercises: makePlan().exercises.map((exercise) => ({ ...exercise, loadingEquipment })),
  });
  const session = createWorkoutSession({ plan });

  session.startWorkout({ timestamp: 0 });
  assert.equal(session.view(0).loadingEquipment.id, 'barbell');

  session.completeSet({ timestamp: 1000 });
  assert.equal(session.view(1000).pending.loadingEquipment.id, 'barbell');
});

test('preparing during rest edits the superset partner that comes next', () => {
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
    ],
  };

  const session = createWorkoutSession({ plan });
  session.startWorkout({ timestamp: 0 });
  session.completeSet({ timestamp: 10 });

  const resting = session.view(10);
  assert.equal(resting.pending.exerciseName, 'Triceps Pushdown');
  assert.equal(resting.pending.set.weight, 35);

  session.adjustWeight(2, { timestamp: 20 });
  assert.equal(session.view(20).pending.set.weight, 40);

  session.nextSet({ timestamp: 30 });
  const active = session.view(30);
  assert.equal(active.exerciseName, 'Triceps Pushdown');
  assert.equal(active.currentSet.weight, 40);
});

test('an untouched Prepare screen still loads the plan targets', () => {
  const session = createWorkoutSession({ plan: makePlan() });
  session.startWorkout({ timestamp: 0 });
  session.adjustWeight(4, { timestamp: 10 }); // 90kg on set 1
  session.completeSet({ timestamp: 1000 });

  // Set 2 starts from the prescription again, not from what set 1 was pushed to.
  assert.equal(session.view(1000).pending.set.weight, 80);
  session.nextSet({ timestamp: 2000 });
  assert.equal(session.view(2000).currentSet.weight, 80);
});

describe('Workout API set-write journal support', () => {
  test('session retains server identifiers, metadata and exposes them in views and describeSet', () => {
    const plan = {
      programId: 'p1',
      unit: 'kg',
      exercises: [
        {
          index: 1,
          id: 'bench_press_barbell',
          entryId: 'bench_press_barbell',
          exerciseId: 'bench_press',
          name: 'Bench Press',
          hasUpdateScript: true,
          promptedVars: ['rpe'],
          warmupSets: [
            {
              setId: 'w1',
              serverIndex: 0,
              targetReps: 10,
              targetWeight: 40,
              originalWeight: '40kg',
              plates: { '20kg': 1 },
              logRpe: false,
              askWeight: false,
              isUnilateral: false,
              restSeconds: 60,
              setTimer: null,
              completed: null,
            },
          ],
          sets: [
            {
              setId: 's1',
              serverIndex: 1,
              targetReps: 8,
              targetWeight: 80,
              originalWeight: '80kg',
              plates: { '20kg': 2 },
              logRpe: true,
              askWeight: true,
              isUnilateral: true,
              restSeconds: 120,
              setTimer: 45,
              completed: null,
            },
          ],
        },
      ],
    };

    const session = createWorkoutSession({ plan });
    session.startWorkout({ timestamp: 0 });

    const view = session.view(0);
    assert.equal(view.exerciseId, 'bench_press');
    assert.equal(view.entryId, 'bench_press_barbell');
    assert.equal(view.currentSet.setId, 'w1');
    assert.equal(view.currentSet.serverIndex, 0);
    assert.equal(view.currentSet.originalWeight, '40kg');
    assert.deepEqual(view.currentSet.plates, { '20kg': 1 });
    assert.equal(view.currentSet.logRpe, false);
    assert.equal(view.currentSet.askWeight, false);
    assert.equal(view.currentSet.isUnilateral, false);

    session.completeSet({ timestamp: 1000 });
    const pendingSet = session.view(1000).pending.set;
    assert.equal(pendingSet.setId, 's1');
    assert.equal(pendingSet.serverIndex, 1);
    assert.equal(pendingSet.originalWeight, '80kg');
    assert.deepEqual(pendingSet.plates, { '20kg': 2 });
    assert.equal(pendingSet.logRpe, true);
    assert.equal(pendingSet.askWeight, true);
    assert.equal(pendingSet.isUnilateral, true);
    assert.equal(pendingSet.setTimer, 45);
  });

  test('completeSet emits stable payload in journal and completed records expose all server fields', () => {
    const plan = {
      programId: 'p1',
      unit: 'kg',
      exercises: [
        {
          index: 1,
          id: 'bench_press_barbell',
          entryId: 'bench_press_barbell',
          exerciseId: 'bench_press',
          name: 'Bench Press',
          warmupSets: [
            { setId: 'w1', targetReps: 10, targetWeight: 40, restSeconds: 60 },
          ],
          sets: [
            { setId: 's1', targetReps: 8, targetWeight: 80, targetRpe: 8, restSeconds: 120, setTimer: 45 },
          ],
        },
      ],
    };

    const session = createWorkoutSession({ plan });
    session.startWorkout({ timestamp: 0 });

    // Complete warmup
    session.completeSet({ timestamp: 1000 });
    session.nextSet({ timestamp: 2000 });

    // Adjust and complete work set
    session.adjustWeight(1, { timestamp: 2500 }); // 82.5kg
    session.adjustReps(-1, { timestamp: 2500 }); // 7 reps
    session.adjustRpe(0.5, { timestamp: 2500 }); // 8.5 RPE
    session.completeSet({
      timestamp: 3000,
      repsLeft: 6,
      setTimer: 42,
      userVars: { effort: 9 },
    });

    const journal = session.getJournal();
    const completeEvents = journal.filter((e) => e.type === 'COMPLETE_SET');
    assert.equal(completeEvents.length, 2);

    assert.deepEqual(completeEvents[0].payload, {
      exerciseIndex: 1,
      setIndex: 1,
      entryId: 'bench_press_barbell',
      setId: 'w1',
      weight: 40,
      reps: 10,
      rpe: null,
      repsLeft: null,
      setTimer: null,
      userVars: null,
      unit: 'kg',
    });

    assert.deepEqual(completeEvents[1].payload, {
      exerciseIndex: 1,
      setIndex: 2,
      entryId: 'bench_press_barbell',
      setId: 's1',
      weight: 82.5,
      reps: 7,
      rpe: 8.5,
      repsLeft: 6,
      setTimer: 42,
      userVars: { effort: 9 },
      unit: 'kg',
    });

    // Verify completed records in view
    const completed = session.view().allCompletedSets;
    assert.equal(completed.length, 2);
    assert.equal(completed[1].entryId, 'bench_press_barbell');
    assert.equal(completed[1].setId, 's1');
    assert.equal(completed[1].weight, 82.5);
    assert.equal(completed[1].reps, 7);
    assert.equal(completed[1].rpe, 8.5);
    assert.equal(completed[1].repsLeft, 6);
    assert.equal(completed[1].setTimer, 42);
    assert.deepEqual(completed[1].userVars, { effort: 9 });
  });

  test('getWorkoutSetWrites and getLastWorkoutSetWrite return exact API payloads in completion order', () => {
    const plan = {
      programId: 'p1',
      unit: 'kg',
      exercises: [
        {
          index: 1,
          id: 'bench_press_barbell',
          entryId: 'bench_press_barbell',
          name: 'Bench Press',
          warmupSets: [
            { setId: 'w1', targetReps: 10, targetWeight: 40, restSeconds: 60 },
          ],
          sets: [
            { setId: 's1', targetReps: 8, targetWeight: 80, targetRpe: 8, restSeconds: 120, setTimer: 45 },
            { setId: null, targetReps: 8, targetWeight: 80, restSeconds: 120 }, // legacy set with no setId
          ],
        },
        {
          index: 2,
          id: 'pullup',
          entryId: 'pullup',
          name: 'Pull Up',
          warmupSets: [],
          sets: [
            { setId: 'p1', targetReps: 5, targetWeight: 0, restSeconds: 60 },
          ],
        },
      ],
    };

    const session = createWorkoutSession({ plan });
    assert.equal(session.getLastWorkoutSetWrite(), null);
    assert.deepEqual(session.getWorkoutSetWrites(), []);

    session.startWorkout({ timestamp: 0 });

    // 1. Complete warmup with setId 'w1'
    session.completeSet({ timestamp: 1000 });
    const write1 = session.getLastWorkoutSetWrite();
    assert.deepEqual(write1, {
      entryId: 'bench_press_barbell',
      setId: 'w1',
      completed: {
        reps: 10,
        weight: '40kg',
      },
    });

    // 2. Next set -> work set with setId 's1'
    session.nextSet({ timestamp: 1060 });
    session.adjustWeight(1, { timestamp: 1100 }); // 82.5kg
    session.completeSet({ timestamp: 2000, setTimer: 43 });

    const write2 = session.getLastWorkoutSetWrite();
    assert.deepEqual(write2, {
      entryId: 'bench_press_barbell',
      setId: 's1',
      completed: {
        reps: 8,
        weight: '82.5kg',
        rpe: 8,
        setTimer: 43,
      },
    });

    // 3. Next set -> legacy set without setId (must be omitted from writes)
    session.nextSet({ timestamp: 2120 });
    session.completeSet({ timestamp: 3000 });
    // getLastWorkoutSetWrite still returns the last valid write with setId ('s1')
    assert.equal(session.getLastWorkoutSetWrite().setId, 's1');

    // 4. Next set -> Pull Up with 0kg weight (0 must be preserved)
    session.nextSet({ timestamp: 3120 });
    session.completeSet({ timestamp: 4000 });

    const write4 = session.getLastWorkoutSetWrite();
    assert.deepEqual(write4, {
      entryId: 'pullup',
      setId: 'p1',
      completed: {
        reps: 5,
        weight: '0kg',
      },
    });

    // Check full list in completion order
    const allWrites = session.getWorkoutSetWrites();
    assert.equal(allWrites.length, 3);
    assert.deepEqual(allWrites, [
      {
        entryId: 'bench_press_barbell',
        setId: 'w1',
        completed: { reps: 10, weight: '40kg' },
      },
      {
        entryId: 'bench_press_barbell',
        setId: 's1',
        completed: { reps: 8, weight: '82.5kg', rpe: 8, setTimer: 43 },
      },
      {
        entryId: 'pullup',
        setId: 'p1',
        completed: { reps: 5, weight: '0kg' },
      },
    ]);
  });

  test('replaying new and legacy journals reconstructs identical state and set writes', () => {
    const plan = {
      programId: 'p1',
      unit: 'kg',
      exercises: [
        {
          index: 1,
          id: 'bench_press_barbell',
          entryId: 'bench_press_barbell',
          name: 'Bench Press',
          sets: [
            { setId: 's1', targetReps: 8, targetWeight: 80, targetRpe: 8, restSeconds: null },
            { setId: 's2', targetReps: 8, targetWeight: 80, targetRpe: 8, restSeconds: null },
          ],
        },
      ],
    };

    // Replay new journal with payload
    const session = createWorkoutSession({ plan });
    session.startWorkout({ timestamp: 0 });
    session.adjustWeight(1, { timestamp: 10 });
    session.completeSet({ timestamp: 100 });
    session.completeSet({ timestamp: 200 });

    const newJournal = session.getJournal();
    const restoredNew = createWorkoutSession({ plan, initialJournal: newJournal });
    assert.deepEqual(restoredNew.getWorkoutSetWrites(), session.getWorkoutSetWrites());
    assert.equal(restoredNew.view(200).state, SESSION_STATES.FINISHED);

    // Replay legacy journal without payload on COMPLETE_SET
    const legacyJournal = [
      { type: 'START_WORKOUT', timestamp: 0 },
      { type: 'ADJUST_WEIGHT', payload: { delta: 2.5 }, timestamp: 10 },
      { type: 'COMPLETE_SET', timestamp: 100 },
      { type: 'COMPLETE_SET', timestamp: 200 },
    ];
    const restoredLegacy = createWorkoutSession({ plan, initialJournal: legacyJournal });
    assert.deepEqual(restoredLegacy.getWorkoutSetWrites(), session.getWorkoutSetWrites());
    assert.equal(restoredLegacy.view(200).state, SESSION_STATES.FINISHED);
  });

  test('does not report a timed-set target as an actual held duration', () => {
    const session = createWorkoutSession({
      plan: {
        unit: 'kg',
        exercises: [{
          entryId: 'plank',
          name: 'Plank',
          sets: [{ setId: 'timed1', targetReps: 1, targetWeight: 0, setTimer: 60 }],
        }],
      },
    });

    session.startWorkout({ timestamp: 0 });
    session.completeSet({ timestamp: 30000 });

    assert.deepEqual(session.getLastWorkoutSetWrite(), {
      entryId: 'plank',
      setId: 'timed1',
      completed: { reps: 1, weight: '0kg' },
    });
  });

  test('continues an active server workout on the first unfinished set', () => {
    const session = createWorkoutSession({
      plan: {
        source: 'WORKOUT_API',
        isCurrent: true,
        startTime: 1000,
        unit: 'kg',
        exercises: [{
          entryId: 'squat',
          name: 'Squat',
          sets: [
            {
              setId: 'setone',
              targetReps: 5,
              targetWeight: 100,
              completed: { reps: 4, weight: 95, unit: 'kg', rpe: 9 },
            },
            { setId: 'settwo', targetReps: 5, targetWeight: 100, completed: null },
          ],
        }],
      },
    });

    const view = session.view(5000);
    assert.equal(view.state, SESSION_STATES.ACTIVE_SET);
    assert.equal(view.startedAt, 1000);
    assert.equal(view.currentSet.setId, 'settwo');
    assert.equal(view.totalCompletedSetsCount, 1);
    assert.deepEqual(session.getWorkoutSetWrites()[0], {
      entryId: 'squat',
      setId: 'setone',
      completed: { reps: 4, weight: '95kg', rpe: 9 },
    });
    assert.deepEqual(session.getJournal(), []);
  });

  test('keeps an unfinished exercise selected across a server snapshot', () => {
    const session = createWorkoutSession({
      plan: {
        source: 'WORKOUT_API',
        isCurrent: true,
        startTime: 1000,
        unit: 'kg',
        exercises: [
          {
            entryId: 'squat',
            name: 'Squat',
            sets: [{ setId: 'squat-1', targetReps: 5, targetWeight: 100 }],
          },
          {
            entryId: 'bench',
            name: 'Bench Press',
            sets: [{ setId: 'bench-1', targetReps: 5, targetWeight: 80 }],
          },
        ],
      },
      resumeFromEntryId: 'bench',
    });

    assert.equal(session.view().entryId, 'bench');
  });

  test('continues after a completed snapshot anchor before wrapping to the beginning', () => {
    const session = createWorkoutSession({
      plan: {
        source: 'WORKOUT_API',
        isCurrent: true,
        startTime: 1000,
        unit: 'kg',
        exercises: [
          {
            entryId: 'squat',
            name: 'Squat',
            sets: [{ setId: 'squat-1', targetReps: 5, targetWeight: 100 }],
          },
          {
            entryId: 'bench',
            name: 'Bench Press',
            sets: [{
              setId: 'bench-1',
              targetReps: 5,
              targetWeight: 80,
              completed: { reps: 5, weight: 80 },
            }],
          },
          {
            entryId: 'row',
            name: 'Cable Row',
            sets: [{ setId: 'row-1', targetReps: 8, targetWeight: 60 }],
          },
        ],
      },
      resumeFromEntryId: 'bench',
    });

    assert.equal(session.view().entryId, 'row');
  });

  test('builds finish intervals from durable pause and resume events', () => {
    const session = createWorkoutSession({
      plan: {
        unit: 'kg',
        exercises: [{
          entryId: 'squat',
          name: 'Squat',
          sets: [
            { setId: 'setone', targetReps: 5, targetWeight: 100, restSeconds: 60 },
            { setId: 'settwo', targetReps: 5, targetWeight: 100 },
          ],
        }],
      },
    });

    session.startWorkout({ timestamp: 1000 });
    session.completeSet({ timestamp: 2000 });
    session.pauseRest({ timestamp: 3000 });
    session.resumeRest({ timestamp: 5000 });
    session.nextSet({ timestamp: 6000 });
    session.completeSet({ timestamp: 8000 });

    assert.equal(session.view(9000).endedAt, 8000);
    assert.deepEqual(session.getWorkoutIntervals(), [[1000, 3000], [5000, 8000]]);
  });

  test('current server workout intervals always begin at the server startTime', () => {
    const session = createWorkoutSession({
      plan: {
        source: 'WORKOUT_API',
        isCurrent: true,
        startTime: 1000,
        unit: 'kg',
        exercises: [{
          entryId: 'squat',
          name: 'Squat',
          sets: [{ setId: 'one', targetReps: 5, targetWeight: 100 }],
        }],
      },
    });

    assert.deepEqual(session.getWorkoutIntervals(5000), [[1000, 5000]]);
  });

  test('current superset resumes at the partner with fewer completed sets', () => {
    const session = createWorkoutSession({
      plan: {
        source: 'WORKOUT_API',
        isCurrent: true,
        startTime: 1000,
        unit: 'kg',
        exercises: [
          {
            entryId: 'a',
            name: 'A',
            supersetGroup: '1',
            sets: [
              { setId: 'a1', targetReps: 5, targetWeight: 100, completed: { reps: 5, weight: 100 } },
              { setId: 'a2', targetReps: 5, targetWeight: 100 },
            ],
          },
          {
            entryId: 'b',
            name: 'B',
            supersetGroup: '1',
            sets: [
              { setId: 'b1', targetReps: 8, targetWeight: 50 },
              { setId: 'b2', targetReps: 8, targetWeight: 50 },
            ],
          },
        ],
      },
    });

    assert.equal(session.view().entryId, 'b');
    assert.equal(session.view().currentSet.setId, 'b1');
  });

  test('native workout pause and resume during active set stops and resumes elapsed time', () => {
    const plan = {
      programId: 'p1',
      unit: 'kg',
      exercises: [
        {
          index: 1,
          name: 'Bench Press',
          sets: [{ index: 1, targetReps: 5, targetWeight: 80, restSeconds: 60 }],
        },
      ],
    };

    const session = createWorkoutSession({ plan });
    session.startWorkout({ timestamp: 10_000 });

    assert.equal(session.view(20_000).elapsedSeconds, 10);

    session.pauseWorkout({ timestamp: 20_000 });

    assert.equal(session.view(25_000).elapsedSeconds, 10);
    assert.equal(session.view(35_000).elapsedSeconds, 10);

    session.resumeWorkout({ timestamp: 35_000 });

    assert.equal(session.view(40_000).elapsedSeconds, 15);

    const journal = session.getJournal();
    assert.ok(journal.some((e) => e.type === 'PAUSE_WORKOUT' && e.timestamp === 20_000));
    assert.ok(journal.some((e) => e.type === 'RESUME_WORKOUT' && e.timestamp === 35_000));
  });

  test('native workout pause during rest freezes rest countdown and global elapsed time', () => {
    const plan = {
      programId: 'p1',
      unit: 'kg',
      exercises: [
        {
          index: 1,
          name: 'Squat',
          sets: [
            { index: 1, targetReps: 5, targetWeight: 100, restSeconds: 60 },
            { index: 2, targetReps: 5, targetWeight: 100, restSeconds: 60 },
          ],
        },
      ],
    };

    const session = createWorkoutSession({ plan });
    session.startWorkout({ timestamp: 0 });
    session.completeSet({ timestamp: 10_000 });

    assert.equal(session.view(20_000).rest.remaining, 50);
    assert.equal(session.view(20_000).elapsedSeconds, 20);

    session.pauseWorkout({ timestamp: 20_000 });

    assert.equal(session.view(30_000).rest.remaining, 50);
    assert.equal(session.view(40_000).rest.remaining, 50);
    assert.equal(session.view(40_000).elapsedSeconds, 20);

    session.resumeWorkout({ timestamp: 40_000 });

    assert.equal(session.view(50_000).rest.remaining, 40);
    assert.equal(session.view(50_000).elapsedSeconds, 30);
  });

  test('native workout resume does not undo a manual rest pause', () => {
    const plan = {
      programId: 'p1',
      unit: 'kg',
      exercises: [
        {
          index: 1,
          name: 'Deadlift',
          sets: [
            { index: 1, targetReps: 5, targetWeight: 140, restSeconds: 120 },
            { index: 2, targetReps: 5, targetWeight: 140, restSeconds: 120 },
          ],
        },
      ],
    };

    const session = createWorkoutSession({ plan });
    session.startWorkout({ timestamp: 0 });
    session.completeSet({ timestamp: 10_000 });

    session.pauseRest({ timestamp: 20_000 });
    assert.equal(session.view(20_000).rest.isPaused, true);
    assert.equal(session.view(20_000).rest.remaining, 110);

    session.pauseWorkout({ timestamp: 30_000 });
    session.resumeWorkout({ timestamp: 40_000 });

    assert.equal(session.view(50_000).rest.isPaused, true);
    assert.equal(session.view(50_000).rest.remaining, 110);

    session.resumeRest({ timestamp: 50_000 });
    assert.equal(session.view(50_000).rest.isPaused, false);
    assert.equal(session.view(60_000).rest.remaining, 100);
  });

  test('native workout pause survives journal replay and produces accurate intervals', () => {
    const plan = {
      programId: 'p1',
      unit: 'kg',
      exercises: [
        {
          index: 1,
          name: 'Bench Press',
          sets: [
            { index: 1, targetReps: 5, targetWeight: 80, restSeconds: 60 },
            { index: 2, targetReps: 5, targetWeight: 80, restSeconds: 60 },
          ],
        },
      ],
    };

    const session = createWorkoutSession({ plan });
    session.startWorkout({ timestamp: 1000 });
    session.pauseWorkout({ timestamp: 3000 });
    session.resumeWorkout({ timestamp: 6000 });
    session.completeSet({ timestamp: 8000 });
    session.pauseWorkout({ timestamp: 10_000 });
    session.resumeWorkout({ timestamp: 15_000 });
    session.nextSet({ timestamp: 18_000 });
    session.completeSet({ timestamp: 20_000 });

    const journal = session.getJournal();
    const replayed = createWorkoutSession({ plan, initialJournal: journal });

    assert.equal(replayed.view(25_000).state, SESSION_STATES.FINISHED);
    assert.equal(replayed.view(25_000).elapsedSeconds, session.view(25_000).elapsedSeconds);
    assert.deepEqual(replayed.getWorkoutIntervals(), session.getWorkoutIntervals());
    assert.deepEqual(session.getWorkoutIntervals(), [
      [1000, 3000],
      [6000, 10_000],
      [15_000, 20_000],
    ]);
  });

  test('overlapping native and manual rest pauses count as one paused interval', () => {
    const session = createWorkoutSession({ plan: makePlan() });
    session.startWorkout({ timestamp: 0 });
    session.completeSet({ timestamp: 10_000 });

    session.pauseWorkout({ timestamp: 20_000 });
    session.pauseRest({ timestamp: 25_000 });
    session.resumeWorkout({ timestamp: 30_000 });

    assert.equal(session.view(40_000).rest.isPaused, true);
    assert.equal(session.view(40_000).rest.remaining, 110);

    session.resumeRest({ timestamp: 40_000 });
    assert.deepEqual(session.getWorkoutIntervals(50_000), [[0, 20_000], [40_000, 50_000]]);
  });

  test('a rest created while the native workout is paused starts frozen', () => {
    const session = createWorkoutSession({ plan: makePlan() });
    session.startWorkout({ timestamp: 0 });
    session.pauseWorkout({ timestamp: 5_000 });
    session.completeSet({ timestamp: 10_000 });

    assert.equal(session.view(40_000).rest.remaining, 120);
    session.resumeWorkout({ timestamp: 40_000 });
    assert.equal(session.view(50_000).rest.remaining, 110);
  });
});
// Server resume scenarios stay here because they exercise state reconstruction.
