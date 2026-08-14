import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDayPlan,
  buildProbeCommands,
  exerciseCountFromProbeError,
  buildWorkoutCommands,
  applyProgramMetadata,
} from '../shared/day-plan.js';

// Shape of `data.workout` returned by POST /api/v1/playground after a probe run.
const PROBE_RESPONSE = `2026-08-14 12:11:51 +00:00 / program: "Busy Caveman" / dayName: "Semaine 2 - Jeudi: PULL A" / week: 2 / dayInWeek: 3 / exercises: {
  Lat Pulldown / 1x10 60kg / target: 3x10 60kg @8 120s, 1x10+ 60kg @9 120s
  Incline Curl / 1x8 17.5kg / target: 2x8 17.5kg @8 60s
}`;

test('builds the plan from target sections only', () => {
  const plan = buildDayPlan(PROBE_RESPONSE);

  assert.equal(plan.week, 2);
  assert.equal(plan.dayInWeek, 3);
  assert.equal(plan.dayName, 'Semaine 2 - Jeudi: PULL A');
  assert.equal(plan.programName, 'Busy Caveman');
  assert.equal(plan.unit, 'kg');
  assert.equal(plan.exercises.length, 2);

  const [latPulldown, curl] = plan.exercises;
  assert.equal(latPulldown.name, 'Lat Pulldown');
  assert.equal(latPulldown.sets.length, 4);
  assert.equal(curl.sets.length, 2);
});

test('carries weight, RPE, rest and AMRAP through to each set', () => {
  const [latPulldown] = buildDayPlan(PROBE_RESPONSE).exercises;

  assert.deepEqual(latPulldown.sets[0], {
    index: 1,
    targetReps: 10,
    targetRepsMax: null,
    targetWeight: 60,
    targetRpe: 8,
    unit: 'kg',
    restSeconds: 120,
    isAmrap: false,
    askWeight: false,
  });

  assert.equal(latPulldown.sets[3].isAmrap, true);
  assert.equal(latPulldown.sets[3].targetRpe, 9);
});

test('numbers exercises from one to match the playground command grammar', () => {
  const plan = buildDayPlan(PROBE_RESPONSE);
  assert.deepEqual(plan.exercises.map((e) => e.index), [1, 2]);
  assert.deepEqual(plan.exercises[0].sets.map((s) => s.index), [1, 2, 3, 4]);
});

test('drops nothing else and returns null on unreadable input', () => {
  assert.equal(buildDayPlan(''), null);
  assert.equal(buildDayPlan('nonsense'), null);
});

test('a day the API reports as empty produces no exercises', () => {
  const plan = buildDayPlan(
    '2026-08-14 12:11:27 +00:00 / program: "P" / dayName: "W2 - D2" / week: 2 / dayInWeek: 2 / exercises: {\n}'
  );

  assert.deepEqual(plan.exercises, []);
  assert.equal(plan.week, 2);
});

test('probe commands complete the first set of each candidate exercise', () => {
  assert.deepEqual(buildProbeCommands(3), [
    'complete_set(1, 1)',
    'complete_set(2, 1)',
    'complete_set(3, 1)',
  ]);
  assert.deepEqual(buildProbeCommands(0), []);
});

test('the exercise count comes from the playground out-of-range error', () => {
  assert.equal(exerciseCountFromProbeError('Exercise 7 not found'), 6);
  assert.equal(exerciseCountFromProbeError('Exercise 1 not found'), 0);
  assert.equal(exerciseCountFromProbeError('Set 3 not found for exercise 1'), null);
  assert.equal(exerciseCountFromProbeError(''), null);
});

test('replays completed sets as playground commands in order', () => {
  const commands = buildWorkoutCommands(
    [
      { exerciseIndex: 1, setIndex: 1, weight: 60, reps: 10, rpe: 8, unit: 'kg' },
      { exerciseIndex: 1, setIndex: 2, weight: 62.5, reps: 9, rpe: null, unit: 'kg' },
    ],
    { finish: true }
  );

  assert.deepEqual(commands, [
    'change_weight(1, 1, 60kg)',
    'change_reps(1, 1, 10)',
    'complete_set(1, 1)',
    'change_rpe(1, 1, 8)',
    'change_weight(1, 2, 62.5kg)',
    'change_reps(1, 2, 9)',
    'complete_set(1, 2)',
    'finish_workout()',
  ]);
});

test('omits an adjustment the user never made', () => {
  const commands = buildWorkoutCommands([
    { exerciseIndex: 2, setIndex: 1, weight: null, reps: 12, rpe: null, unit: 'lb' },
  ]);

  assert.deepEqual(commands, ['change_reps(2, 1, 12)', 'complete_set(2, 1)']);
});

test('writes the unit the plan used', () => {
  const commands = buildWorkoutCommands([
    { exerciseIndex: 1, setIndex: 1, weight: 185, reps: 5, rpe: null, unit: 'lb' },
  ]);

  assert.ok(commands.includes('change_weight(1, 1, 185lb)'));
});

test('buildWorkoutCommands skips warmup sets', () => {
  const commands = buildWorkoutCommands([
    { exerciseIndex: 1, setIndex: 1, weight: 35, reps: 10, unit: 'kg', isWarmup: true },
    { exerciseIndex: 1, setIndex: 1, weight: 80, reps: 8, rpe: 8, unit: 'kg', isWarmup: false },
  ]);

  assert.deepEqual(commands, [
    'change_weight(1, 1, 80kg)',
    'change_reps(1, 1, 8)',
    'complete_set(1, 1)',
    'change_rpe(1, 1, 8)',
  ]);
});

test('applyProgramMetadata attaches superset and resolved warmups when aligned', () => {
  const plan = buildDayPlan(PROBE_RESPONSE);
  const declared = [
    { name: 'Lat Pulldown', equipment: null, warmupText: '1x8 50%', supersetTag: 'A' },
    { name: 'Incline Curl', equipment: null, warmupText: '1x5 10kg', supersetTag: 'A' },
  ];

  const fakeReference = {
    resolveWeight: (name, eq, target, unit) => ({ value: 30, resolved: true }),
  };

  applyProgramMetadata(plan, declared, { referenceData: fakeReference });

  assert.equal(plan.exercises[0].supersetGroup, 'A');
  assert.equal(plan.exercises[0].warmupSets.length, 1);
  assert.equal(plan.exercises[0].warmupSets[0].targetWeight, 30);
  assert.equal(plan.exercises[0].warmupSets[0].targetWeightPercent, 50);

  assert.equal(plan.exercises[1].supersetGroup, 'A');
  assert.equal(plan.exercises[1].warmupSets.length, 1);
  assert.equal(plan.exercises[1].warmupSets[0].targetWeight, 10);
  assert.equal(plan.exercises[1].warmupSets[0].targetWeightPercent, null);
});

test('applyProgramMetadata leaves plan untouched when alignment fails', () => {
  const plan = buildDayPlan(PROBE_RESPONSE);
  const declared = [
    { name: 'Bench Press', equipment: null, warmupText: '1x8 50%', supersetTag: 'A' },
    { name: 'Incline Curl', equipment: null, warmupText: '1x5 10kg', supersetTag: 'A' },
  ];

  applyProgramMetadata(plan, declared);

  assert.equal(plan.exercises[0].supersetGroup, null);
  assert.deepEqual(plan.exercises[0].warmupSets, []);
});

test('applyProgramMetadata falls back to step rounding when referenceData fails and defaults rest to 60s', () => {
  const plan = buildDayPlan(PROBE_RESPONSE);
  // Lat Pulldown first work set is 60kg. Warmup 50% -> 30kg.
  const declared = [
    { name: 'Lat Pulldown', equipment: null, warmupText: '1x8 50%', supersetTag: null },
    { name: 'Incline Curl', equipment: null, warmupText: '1x5 10kg', supersetTag: null },
  ];

  // referenceData returns resolved: false
  const unresolvingRef = {
    resolveWeight: () => ({ value: null, resolved: false }),
  };

  applyProgramMetadata(plan, declared, { referenceData: unresolvingRef });

  assert.equal(plan.exercises[0].warmupSets[0].targetWeight, 30);
  assert.equal(plan.exercises[0].warmupSets[0].restSeconds, 60);
  assert.equal(plan.exercises[1].warmupSets[0].restSeconds, 60);
});

