import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { createWorkoutSession, SESSION_STATES } from '../shared/workout-session.js';

describe('Workout API plan model adapter', () => {
  test('workoutToDayPlan maps full workout with entries, warmups, work sets, supersets and preserves server identifiers', () => {
    const workout = {
      programId: 'prog-123',
      programName: 'Upper Lower Hypertrophy',
      dayName: 'Upper Power',
      dayData: {
        day: 1,
        week: 2,
        dayInWeek: 1,
      },
      startTime: 1738274512000,
      entries: [
        {
          entryId: 'bench_press_barbell',
          exerciseId: 'bench_press',
          name: 'Bench Press',
          equipment: 'barbell',
          superset: 'A',
          notes: 'Pause 1s on chest',
          description: 'Barbell bench press on flat bench',
          hasUpdateScript: true,
          promptedVars: ['rpe', 'fatigue'],
          warmupSets: [
            {
              setId: 'w1',
              index: 0,
              isWarmup: true,
              reps: 10,
              minReps: null,
              isAmrap: false,
              weight: '40kg',
              plates: { '20kg': 1 },
              rpe: null,
              logRpe: false,
              askWeight: false,
              isUnilateral: false,
              timer: 60,
              setTimer: null,
              completed: null,
            },
          ],
          sets: [
            {
              setId: 's1',
              index: 1,
              isWarmup: false,
              reps: 8,
              minReps: 6,
              isAmrap: false,
              weight: '80kg',
              plates: { '20kg': 2, '10kg': 1 },
              rpe: 8,
              logRpe: true,
              askWeight: true,
              isUnilateral: false,
              timer: 120,
              setTimer: 45,
              completed: null,
            },
          ],
        },
      ],
    };

    const plan = workoutToDayPlan(workout);

    assert.equal(plan.programId, 'prog-123');
    assert.equal(plan.programName, 'Upper Lower Hypertrophy');
    assert.equal(plan.dayName, 'Upper Power');
    assert.equal(plan.week, 2);
    assert.equal(plan.dayInWeek, 1);
    assert.equal(plan.startTime, 1738274512000);
    assert.equal(plan.unit, 'kg');
    assert.equal(plan.source, 'WORKOUT_API');

    assert.equal(plan.exercises.length, 1);
    const ex = plan.exercises[0];
    assert.equal(ex.index, 1);
    assert.equal(ex.id, 'bench_press_barbell');
    assert.equal(ex.entryId, 'bench_press_barbell');
    assert.equal(ex.exerciseId, 'bench_press');
    assert.equal(ex.name, 'Bench Press');
    assert.equal(ex.equipment, 'barbell');
    assert.equal(ex.supersetGroup, 'A');
    assert.equal(ex.notes, 'Pause 1s on chest');
    assert.equal(ex.description, 'Barbell bench press on flat bench');
    assert.equal(ex.hasUpdateScript, true);
    assert.deepEqual(ex.promptedVars, ['rpe', 'fatigue']);

    assert.equal(ex.warmupSets.length, 1);
    const w = ex.warmupSets[0];
    assert.equal(w.setId, 'w1');
    assert.equal(w.serverIndex, 0);
    assert.equal(w.index, 1);
    assert.equal(w.isWarmup, true);
    assert.equal(w.targetReps, 10);
    assert.equal(w.targetRepsMax, null);
    assert.equal(w.isAmrap, false);
    assert.equal(w.targetWeight, 40);
    assert.equal(w.originalWeight, '40kg');
    assert.equal(w.unit, 'kg');
    assert.deepEqual(w.plates, { '20kg': 1 });
    assert.equal(w.rpe, null);
    assert.equal(w.logRpe, false);
    assert.equal(w.askWeight, false);
    assert.equal(w.isUnilateral, false);
    assert.equal(w.restSeconds, 60);
    assert.equal(w.setTimer, null);
    assert.equal(w.completed, null);

    assert.equal(ex.sets.length, 1);
    const s = ex.sets[0];
    assert.equal(s.setId, 's1');
    assert.equal(s.serverIndex, 1);
    assert.equal(s.index, 1);
    assert.equal(s.isWarmup, false);
    assert.equal(s.targetReps, 6);
    assert.equal(s.targetRepsMax, 8);
    assert.equal(s.isAmrap, false);
    assert.equal(s.targetWeight, 80);
    assert.equal(s.originalWeight, '80kg');
    assert.equal(s.unit, 'kg');
    assert.deepEqual(s.plates, { '20kg': 2, '10kg': 1 });
    assert.equal(s.rpe, 8);
    assert.equal(s.logRpe, true);
    assert.equal(s.askWeight, true);
    assert.equal(s.isUnilateral, false);
    assert.equal(s.restSeconds, 120);
    assert.equal(s.setTimer, 45);
    assert.equal(s.completed, null);
  });

  test('handles rep ranges (minReps != reps) vs fixed reps (minReps == reps or null)', () => {
    const workout = {
      entries: [
        {
          entryId: 'ex1',
          name: 'Exercise 1',
          sets: [
            { setId: 's1', reps: 8, minReps: 6 },
            { setId: 's2', reps: 8, minReps: 8 },
            { setId: 's3', reps: 10, minReps: null },
            { setId: 's4', reps: 12, minReps: undefined },
            { setId: 's5', reps: 5, minReps: 0 },
            { setId: 's6', reps: null, minReps: null },
          ],
        },
      ],
    };

    const plan = workoutToDayPlan(workout);
    const sets = plan.exercises[0].sets;

    assert.equal(sets[0].targetReps, 6);
    assert.equal(sets[0].targetRepsMax, 8);

    assert.equal(sets[1].targetReps, 8);
    assert.equal(sets[1].targetRepsMax, null);

    assert.equal(sets[2].targetReps, 10);
    assert.equal(sets[2].targetRepsMax, null);

    assert.equal(sets[3].targetReps, 12);
    assert.equal(sets[3].targetRepsMax, null);

    assert.equal(sets[4].targetReps, 0);
    assert.equal(sets[4].targetRepsMax, 5);

    assert.equal(sets[5].targetReps, null);
    assert.equal(sets[5].targetRepsMax, null);
  });

  test('unit resolution priority: explicit units, first parseable set weight, or null (never defaults to kg)', () => {
    const workoutExplicit = {
      entries: [
        {
          entryId: 'ex1',
          sets: [{ setId: 's1', weight: '100kg' }],
        },
      ],
    };
    const planExplicit = workoutToDayPlan(workoutExplicit, { units: 'lb' });
    assert.equal(planExplicit.unit, 'lb');

    const workoutInferred = {
      entries: [
        {
          entryId: 'ex1',
          warmupSets: [{ setId: 'w1', weight: '45lb' }],
          sets: [{ setId: 's1', weight: '135lb' }],
        },
      ],
    };
    const planInferred = workoutToDayPlan(workoutInferred);
    assert.equal(planInferred.unit, 'lb');

    const workoutNoUnit = {
      entries: [
        {
          entryId: 'ex1',
          sets: [{ setId: 's1', weight: 100 }, { setId: 's2', weight: null }],
        },
      ],
    };
    const planNoUnit = workoutToDayPlan(workoutNoUnit);
    assert.equal(planNoUnit.unit, null);
  });

  test('preserves zero weight and zero reps numerically', () => {
    const workout = {
      entries: [
        {
          entryId: 'bodyweight_pullup',
          name: 'Pull Up',
          sets: [
            { setId: 's1', reps: 0, weight: '0kg' },
            { setId: 's2', reps: 5, weight: 0 },
          ],
        },
      ],
    };

    const plan = workoutToDayPlan(workout);
    const sets = plan.exercises[0].sets;

    assert.equal(sets[0].targetReps, 0);
    assert.equal(sets[0].targetWeight, 0);
    assert.equal(sets[0].originalWeight, '0kg');

    assert.equal(sets[1].targetReps, 5);
    assert.equal(sets[1].targetWeight, 0);
    assert.equal(sets[1].originalWeight, 0);
  });

  test('handles missing or empty arrays gracefully', () => {
    assert.equal(workoutToDayPlan(null), null);
    assert.equal(workoutToDayPlan(undefined), null);

    const planEmpty = workoutToDayPlan({});
    assert.deepEqual(planEmpty.exercises, []);
    assert.equal(planEmpty.source, 'WORKOUT_API');
    assert.equal(planEmpty.unit, null);

    const planMissingSets = workoutToDayPlan({
      entries: [{ entryId: 'e1', name: 'Ex' }],
    });
    assert.deepEqual(planMissingSets.exercises[0].warmupSets, []);
    assert.deepEqual(planMissingSets.exercises[0].sets, []);
  });

  test('workoutToDayPlan output is directly consumable by createWorkoutSession', () => {
    const workout = {
      programId: 'prog-1',
      programName: 'Test Program',
      dayName: 'Day 1',
      dayData: { week: 1, dayInWeek: 1 },
      entries: [
        {
          entryId: 'squat_barbell',
          exerciseId: 'squat',
          name: 'Squat',
          warmupSets: [
            { setId: 'w1', reps: 5, weight: '50kg', timer: 60 },
          ],
          sets: [
            { setId: 's1', reps: 5, weight: '100kg', rpe: 8, timer: 120 },
          ],
        },
      ],
    };

    const plan = workoutToDayPlan(workout);
    const session = createWorkoutSession({ plan });

    assert.equal(session.view().state, SESSION_STATES.READY);
    session.startWorkout({ timestamp: 1000 });
    const activeView = session.view(1000);
    assert.equal(activeView.state, SESSION_STATES.ACTIVE_SET);
    assert.equal(activeView.exerciseName, 'Squat');
    assert.equal(activeView.currentSet.isWarmup, true);
    assert.equal(activeView.currentSet.weight, 50);
    assert.equal(activeView.currentSet.setId, 'w1');
  });

  test('marks only current and started responses as active session baselines', () => {
    const workout = {
      startTime: 1000,
      entries: [{
        entryId: 'squat',
        name: 'Squat',
        sets: [{
          setId: 'setone',
          reps: 5,
          weight: '100kg',
          completed: { reps: 4, weight: '95kg', rpe: 9 },
        }],
      }],
    };

    const preview = workoutToDayPlan(workout);
    const current = workoutToDayPlan(workout, { isCurrent: true });

    assert.equal(preview.isCurrent, false);
    assert.equal(current.isCurrent, true);
    assert.deepEqual(current.exercises[0].sets[0].completed, {
      reps: 4,
      weight: 95,
      unit: 'kg',
      rpe: 9,
    });
  });
});
