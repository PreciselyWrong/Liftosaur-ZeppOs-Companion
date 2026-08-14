import test from 'node:test';
import assert from 'node:assert/strict';

import { reconcileWorkoutSets } from '../shared/reconciliation.js';

test('reconcileWorkoutSets preserves locally completed sets and updates future pending sets', () => {
  const localCompletedSets = [
    { exerciseIndex: 0, setIndex: 0, weight: 60, reps: 5, completedAt: 1000 },
    { exerciseIndex: 0, setIndex: 1, weight: 60, reps: 5, completedAt: 2000 },
  ];

  const currentPrescription = [
    { targetWeight: 60, targetReps: 5 },
    { targetWeight: 60, targetReps: 5 },
    { targetWeight: 60, targetReps: 5 },
  ];

  // Playground simulation results with auto-adjusted future set (e.g. increase weight to 62.5 on set 3)
  const playgroundPrescription = [
    { targetWeight: 60, targetReps: 5 },
    { targetWeight: 60, targetReps: 5 },
    { targetWeight: 62.5, targetReps: 5 },
  ];

  const reconciled = reconcileWorkoutSets({
    localCompletedCount: localCompletedSets.length,
    currentPrescription,
    playgroundPrescription,
  });

  assert.equal(reconciled.length, 3);
  // Sets 0 and 1 keep their completed local values
  assert.equal(reconciled[0].targetWeight, 60);
  assert.equal(reconciled[1].targetWeight, 60);
  // Set 2 is updated from Playground calculation
  assert.equal(reconciled[2].targetWeight, 62.5);
});

test('reconcileWorkoutSets handles offline fallback safely if playground is unreachable', () => {
  const currentPrescription = [
    { targetWeight: 60, targetReps: 5 },
    { targetWeight: 60, targetReps: 5 },
    { targetWeight: 60, targetReps: 5 },
  ];

  const reconciled = reconcileWorkoutSets({
    localCompletedCount: 1,
    currentPrescription,
    playgroundPrescription: null, // Network failure / offline
  });

  assert.deepEqual(reconciled, currentPrescription);
});
