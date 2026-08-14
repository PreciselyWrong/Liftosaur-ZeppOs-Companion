import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDayPlan,
  buildProbeCommands,
  exerciseCountFromProbeError,
  buildWorkoutCommands,
  buildProgressRecord,
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

test('groups a live record by exercise even when the user jumped around', () => {
  const plan = buildDayPlan(PROBE_RESPONSE);

  // Superset order: exercise 1 set 1, exercise 2 set 1, exercise 1 set 2.
  const text = buildProgressRecord({
    plan,
    startedAt: Date.parse('2026-08-14T09:00:00.000Z'),
    durationSeconds: 600,
    completedSets: [
      { exerciseIndex: 1, setIndex: 1, weight: 60, reps: 10, rpe: 8, unit: 'kg' },
      { exerciseIndex: 2, setIndex: 1, weight: 17.5, reps: 8, rpe: 8, unit: 'kg' },
      { exerciseIndex: 1, setIndex: 2, weight: 60, reps: 10, rpe: 8, unit: 'kg' },
    ],
  });

  assert.ok(text.includes('Lat Pulldown / 2x10 60kg @8'), 'both Lat Pulldown sets on one line');
  assert.ok(text.includes('Incline Curl / 1x8 17.5kg @8'));
  assert.ok(text.includes('duration: 600s'));
  assert.ok(text.startsWith('2026-08-14T09:00:00.000Z /'));
});

test('a live record states no target, because progression is the server\'s to compute', () => {
  const plan = buildDayPlan(PROBE_RESPONSE);
  const text = buildProgressRecord({
    plan,
    completedSets: [{ exerciseIndex: 1, setIndex: 1, weight: 60, reps: 10, rpe: 8, unit: 'kg' }],
  });

  assert.ok(!text.includes('target:'));
  assert.ok(!text.includes('warmup:'));
});

test('there is no live record before the first set', () => {
  const plan = buildDayPlan(PROBE_RESPONSE);
  assert.equal(buildProgressRecord({ plan, completedSets: [] }), null);
  assert.equal(buildProgressRecord({ plan: null, completedSets: [] }), null);
});

test('writes the unit the plan used', () => {
  const commands = buildWorkoutCommands([
    { exerciseIndex: 1, setIndex: 1, weight: 185, reps: 5, rpe: null, unit: 'lb' },
  ]);

  assert.ok(commands.includes('change_weight(1, 1, 185lb)'));
});
