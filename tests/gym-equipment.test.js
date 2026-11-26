import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkoutService } from '../app-side/workout-service.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { formatLoadoutLabel } from '../shared/weight-rounding.js';

// Synthetic account data in the shapes of GET /gyms, GET /gyms/:id/equipment
// and GET /exercise-data. `num` is the total count on hand.
const GYMS = { currentGymId: 'gym-a', gyms: [{ id: 'gym-a', name: 'Home', isCurrent: true, equipmentCount: 3 }] };
const EQUIPMENT = [
  {
    id: 'barbell',
    name: 'Barbell',
    isDeleted: false,
    bar: { lb: '45lb', kg: '20kg' },
    multiplier: 2,
    isFixed: false,
    plates: [
      { weight: '20kg', num: 4 },
      { weight: '10kg', num: 2 },
      { weight: '5kg', num: 2 },
      { weight: '2.5kg', num: 2 },
      { weight: '1.25kg', num: 2 },
      { weight: '45lb', num: 4 },
    ],
    fixed: [],
  },
  {
    id: 'dumbbell',
    name: 'Dumbbell',
    isDeleted: false,
    bar: { lb: '0lb', kg: '0kg' },
    multiplier: 1,
    isFixed: true,
    plates: [],
    fixed: ['6kg', '8kg', '10kg', '12kg', '20lb'],
  },
  {
    id: 'equipment-custom1',
    name: 'Curl bar',
    isDeleted: false,
    bar: { lb: '15lb', kg: '7kg' },
    multiplier: 1,
    isFixed: true,
    plates: [],
    fixed: [],
    setup: { type: 'fixed', unit: 'kg', values: [15, 20, 25], ranges: [] },
  },
];
const EXERCISE_DATA = [{ key: 'curl', exerciseName: 'Curl', equipment: { 'gym-a': 'equipment-custom1' } }];

function loadingSet(setId, total, loading) {
  return { setId, index: 0, isWarmup: false, reps: 8, weight: `${total}kg`, plates: [], loading, completed: null };
}

function platesLoading(total, perSide) {
  return {
    unit: 'kg',
    total: `${total}kg`,
    exact: true,
    instruction: { type: 'plates', sides: 2, horns: [{ plates: perSide.map(([weight, num]) => ({ weight, num })) }] },
  };
}

function fixedLoading(total) {
  return { unit: 'kg', total: `${total}kg`, exact: true, instruction: { type: 'fixed', value: total, addOn: [] } };
}

function workout(startTime = 100) {
  return {
    programId: 'p',
    startTime,
    entries: [
      { entryId: 'row_barbell', exerciseId: 'row_barbell', name: 'Row', equipment: 'barbell',
        warmupSets: [loadingSet('w', 40, platesLoading(40, [[10, 1]]))], sets: [loadingSet('a', 60, platesLoading(60, [[20, 1]]))] },
      { entryId: 'squat_barbell', exerciseId: 'squat_barbell', name: 'Squat', equipment: 'barbell',
        warmupSets: [], sets: [loadingSet('b', 100, platesLoading(100, [[20, 2]]))] },
      { entryId: 'raise_dumbbell', exerciseId: 'raise_dumbbell', name: 'Raise', equipment: 'dumbbell',
        warmupSets: [], sets: [loadingSet('c', 8, fixedLoading(8))] },
      // No equipment on the entry: the account maps the exercise to custom equipment.
      { entryId: 'curl', exerciseId: 'curl', name: 'Curl', equipment: null,
        warmupSets: [], sets: [loadingSet('d', 20, fixedLoading(20))] },
      { entryId: 'pullup_bodyweight', exerciseId: 'pullup_bodyweight', name: 'Pull Up', equipment: 'bodyweight',
        warmupSets: [], sets: [{ setId: 'e', index: 0, isWarmup: false, reps: 8, weight: '0kg', plates: [], loading: null, completed: null }] },
    ],
  };
}

function fakeClient({ failGyms = false } = {}) {
  const calls = [];
  const client = {
    async getNextWorkout() { calls.push('next'); return { workout: workout(null) }; },
    async getCurrentWorkout() { calls.push('current'); return { workout: workout(100) }; },
    async startRunningWorkout({ startTime }) { calls.push('start'); return { workout: workout(startTime) }; },
    async listGyms() {
      calls.push('gyms');
      if (failGyms) throw new Error('offline');
      return GYMS;
    },
    async listEquipment(gymId) { calls.push(`equipment:${gymId}`); return EQUIPMENT; },
    async listExerciseData() { calls.push('exercise-data'); return EXERCISE_DATA; },
    async listHistory() { return { records: [] }; },
  };
  return { client, calls };
}

function labelAfterEdit(result, entryIndex, weight) {
  const plan = workoutToDayPlan(JSON.parse(JSON.stringify(result.workout)), { isCurrent: true });
  const exercise = plan.exercises[entryIndex];
  const set = exercise.sets[0];
  return formatLoadoutLabel(weight, exercise.loadingEquipment, plan.unit, set.plates, set.targetWeight);
}

test('a started workout carries each loaded exercise\'s real equipment once', async () => {
  const { client } = fakeClient();
  const service = createWorkoutService({ client, catalogService: null });
  const result = await service.startWorkout({ startTime: 100 });

  const { gymEquipment, entries } = result.workout;
  assert.equal(gymEquipment.length, 3, 'the two barbell exercises share one entry');
  assert.equal(entries[0].gymEquipment, entries[1].gymEquipment);
  assert.equal(entries[4].gymEquipment, undefined, 'nothing for an exercise without loading');
  // Only the workout's unit travels.
  assert.ok(!JSON.stringify(gymEquipment).includes('lb'));
});

test('the watch breaks an edited weight down from the real equipment', async () => {
  const { client } = fakeClient();
  const result = await createWorkoutService({ client, catalogService: null }).startWorkout({ startTime: 100 });

  // 62.5 needs the 1.25 pair, which no set of the workout ever proposed.
  assert.equal(labelAfterEdit(result, 0, 62.5), '1×20 + 1×1.25 KG');
  assert.equal(labelAfterEdit(result, 0, 61), 'NEAR 60/62.5 KG');
  assert.equal(labelAfterEdit(result, 2, 10), 'USE 10 KG');
  assert.equal(labelAfterEdit(result, 2, 9), 'NEAR 8/10 KG');
  assert.equal(labelAfterEdit(result, 3, 22.5), 'NEAR 20/25 KG', 'custom fixed equipment from its setup values');
});

test('the equipment is fetched once per workout start, not per reply', async () => {
  const { client, calls } = fakeClient();
  const service = createWorkoutService({ client, catalogService: null });
  await service.startWorkout({ startTime: 100 });
  await service.getCurrentWorkout();
  await service.getCurrentWorkout();
  assert.equal(calls.filter((call) => call === 'gyms').length, 1);
  assert.deepEqual(calls.filter((call) => call.startsWith('equipment')), ['equipment:gym-a']);

  await service.startWorkout({ startTime: 200 });
  assert.equal(calls.filter((call) => call === 'gyms').length, 2, 'a new workout reads the gym again');
});

test('without the equipment the watch falls back to the plates the workout proposed', async () => {
  const { client } = fakeClient({ failGyms: true });
  const result = await createWorkoutService({ client, catalogService: null }).startWorkout({ startTime: 100 });

  assert.equal(result.workout.gymEquipment, undefined);
  assert.equal(labelAfterEdit(result, 0, 60), '1×20 KG');
  assert.equal(labelAfterEdit(result, 0, 61), null, 'an inferred subset never names nearest weights');
});

test('equipment that disagrees with the server loading is not attached', async () => {
  const { client } = fakeClient();
  // The account now maps the dumbbell exercise to plate-loaded equipment.
  client.listExerciseData = async () => [{ key: 'raise_dumbbell', exerciseName: 'Raise', equipment: { 'gym-a': 'barbell' } }];
  const result = await createWorkoutService({ client, catalogService: null }).startWorkout({ startTime: 100 });
  assert.equal(result.workout.entries[2].gymEquipment, undefined);
});
