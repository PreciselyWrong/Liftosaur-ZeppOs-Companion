import test from 'node:test';
import assert from 'node:assert/strict';

import { createReferenceData } from '../app-side/reference-data.js';

const EQUIPMENT = [
  {
    id: 'barbell',
    bar: { lb: '45lb', kg: '20kg' },
    multiplier: 2,
    isFixed: false,
    plates: [
      { weight: '20kg', num: 2 },
      { weight: '15kg', num: 2 },
      { weight: '10kg', num: 4 },
      { weight: '5kg', num: 2 },
      { weight: '2.5kg', num: 2 },
      { weight: '1.25kg', num: 2 },
    ],
    fixed: [],
  },
  {
    id: 'dumbbell',
    bar: { lb: '10lb', kg: '5kg' },
    multiplier: 2,
    isFixed: true,
    plates: [],
    fixed: ['5kg', '10kg', '15kg', '20kg'],
  },
];

const EXERCISE_DATA = [
  {
    key: 'declineBenchPress_barbell',
    exerciseName: 'Decline Bench Press',
    rm1: '117.5kg',
    equipment: { default: 'barbell' },
  },
  { key: 'benchPress_barbell', exerciseName: 'Bench Press', equipment: { default: 'barbell' } },
  { key: 'benchPress_dumbbell', exerciseName: 'Bench Press', equipment: { default: 'dumbbell' } },
  { key: 'lateralRaise_cable', exerciseName: 'Lateral Raise', rounding: 2.5 },
  // A custom exercise whose own name contains a comma, mapped only for a gym
  // that is not the current one.
  {
    key: 'vpslulox',
    exerciseName: 'Romanian Deadlift, Barebell',
    rm1: '47.5kg',
    equipment: { fmmayomc: 'barbell' },
  },
];

function createFakeClient(overrides = {}) {
  const calls = { gyms: 0, equipment: 0, exerciseData: 0 };
  return {
    calls,
    async listGyms() {
      calls.gyms += 1;
      return { currentGymId: 'default', gyms: [{ id: 'default', isCurrent: true }] };
    },
    async listEquipment() {
      calls.equipment += 1;
      return EQUIPMENT;
    },
    async listExerciseData() {
      calls.exerciseData += 1;
      return EXERCISE_DATA;
    },
    ...overrides,
  };
}

test('fetches gyms, equipment and exercise data once', async () => {
  const client = createFakeClient();
  const reference = createReferenceData({ client });

  await reference.load();
  await reference.load();
  await reference.load();

  assert.deepEqual(client.calls, { gyms: 1, equipment: 1, exerciseData: 1 });
  assert.equal(reference.isLoaded(), true);
});

test('concurrent callers share one round of requests', async () => {
  const client = createFakeClient();
  const reference = createReferenceData({ client });

  await Promise.all([reference.load(), reference.load(), reference.load()]);

  assert.equal(client.calls.gyms, 1);
});

test('a failure is not cached', async () => {
  let attempts = 0;
  const client = createFakeClient({
    async listGyms() {
      attempts += 1;
      if (attempts === 1) throw new Error('network');
      return { currentGymId: 'default', gyms: [] };
    },
  });
  const reference = createReferenceData({ client });

  await assert.rejects(() => reference.load(), /network/);
  assert.equal(reference.isLoaded(), false);

  await reference.load();
  assert.equal(reference.isLoaded(), true);
  assert.equal(attempts, 2);
});

test('finds an exercise with a unique name', async () => {
  const reference = createReferenceData({ client: createFakeClient() });
  await reference.load();

  const lookup = reference.lookupExercise('Decline Bench Press');
  assert.equal(lookup.found, true);
  assert.equal(lookup.ambiguous, false);
  assert.equal(lookup.equipmentId, 'barbell');
  assert.equal(lookup.equipment.id, 'barbell');
});

test('uses the equipment on the history line to break a name tie', async () => {
  const reference = createReferenceData({ client: createFakeClient() });
  await reference.load();

  assert.equal(reference.lookupExercise('Bench Press', 'Barbell').equipmentId, 'barbell');
  assert.equal(reference.lookupExercise('Bench Press', 'Dumbbell').equipmentId, 'dumbbell');
});

test('reports an unbreakable tie instead of picking one', async () => {
  const reference = createReferenceData({ client: createFakeClient() });
  await reference.load();

  const lookup = reference.lookupExercise('Bench Press');
  assert.equal(lookup.ambiguous, true);
  assert.equal(lookup.found, false);
});

test('resolves a warmup percentage to a loadable weight', async () => {
  const reference = createReferenceData({ client: createFakeClient() });
  await reference.load();

  // 85% of 117.5 = 99.875 -> the bar plus the best fill at or below it.
  const resolved = reference.resolveWeight('Decline Bench Press', null, 0.85 * 87.5, 'kg');
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.value, 72.5);
});

test('refuses to resolve when the exercise is ambiguous', async () => {
  const reference = createReferenceData({ client: createFakeClient() });
  await reference.load();

  const resolved = reference.resolveWeight('Bench Press', null, 74.375, 'kg');
  assert.equal(resolved.resolved, false);
  assert.equal(resolved.value, 74.375);
});

test('refuses to resolve an exercise it has never heard of', async () => {
  const reference = createReferenceData({ client: createFakeClient() });
  await reference.load();

  assert.equal(reference.resolveWeight('Unknown Movement', null, 50, 'kg').resolved, false);
});

test('finds a custom exercise whose own name contains a comma', async () => {
  const reference = createReferenceData({ client: createFakeClient() });
  await reference.load();

  // The Liftohistory parser reads "Romanian Deadlift, Barebell" as name plus
  // equipment "Barebell", which matches nothing. The raw label does.
  const lookup = reference.lookupExercise(
    'Romanian Deadlift',
    'Barebell',
    'Romanian Deadlift, Barebell'
  );
  assert.equal(lookup.found, true);
  assert.equal(lookup.equipmentId, 'barbell');
});

test('never proposes a warmup lighter than the bar', async () => {
  const reference = createReferenceData({ client: createFakeClient() });
  await reference.load();

  // 50% of a 30kg work set is 15kg, which a 20kg bar cannot make.
  const resolved = reference.resolveWeight(
    'Romanian Deadlift',
    'Barebell',
    15,
    'kg',
    'Romanian Deadlift, Barebell'
  );
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.value, 20);
});

test("falls back to the exercise's own rounding when the equipment is unknown", async () => {
  const reference = createReferenceData({ client: createFakeClient() });
  await reference.load();

  // lateralRaise_cable points at cable equipment this gym does not have.
  const resolved = reference.resolveWeight('Lateral Raise', null, 13.7, 'kg');
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.value, 12.5);
});

test('answers safely before anything is loaded', () => {
  const reference = createReferenceData({ client: createFakeClient() });

  assert.equal(reference.isLoaded(), false);
  assert.equal(reference.lookupExercise('Bench Press').found, false);
  assert.equal(reference.resolveWeight('Bench Press', null, 50, 'kg').resolved, false);
});
