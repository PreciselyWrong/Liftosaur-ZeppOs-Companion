import test from 'node:test';
import assert from 'node:assert/strict';

import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { createWorkoutSession, SESSION_STATES } from '../shared/workout-session.js';
import { formatLoadoutLabel } from '../shared/weight-rounding.js';

// Synthetic sets with the shape of real WORKOUT_CURRENT_DATA payloads: each set
// carries the server's breakdown twice, as `plates` (strings) and as
// `loading.instruction` (numbers, with the number of sides). The stack has no
// bar weight field; it is what `loading.total` holds beyond the plates.
function plateSet(setId, index, isWarmup, total, platesPerSide, { sides = 1, timer = 90 } = {}) {
  return {
    setId,
    index,
    isWarmup,
    reps: 10,
    minReps: null,
    isAmrap: false,
    weight: `${total}kg`,
    originalWeight: `${total}kg`,
    plates: platesPerSide.map(([weight, num]) => ({ weight: `${weight}kg`, num })),
    loading: {
      total: `${total}kg`,
      unit: 'kg',
      exact: true,
      instruction: {
        type: 'plates',
        sides,
        horns: [{ plates: platesPerSide.map(([weight, num]) => ({ weight, num })) }],
      },
    },
    rpe: null,
    logRpe: false,
    askWeight: false,
    isUnilateral: false,
    timer,
    setTimer: null,
    completed: null,
  };
}

function fixedSet(setId, index, total) {
  return {
    setId,
    index,
    isWarmup: false,
    reps: 10,
    minReps: null,
    isAmrap: false,
    weight: `${total}kg`,
    originalWeight: `${total}kg`,
    plates: [],
    loading: { total: `${total}kg`, unit: 'kg', exact: true, instruction: { type: 'fixed', value: total, addOn: [] } },
    rpe: null,
    logRpe: false,
    askWeight: false,
    isUnilateral: false,
    timer: 90,
    setTimer: null,
    completed: null,
  };
}

function entry(entryId, equipment, warmupSets, sets) {
  return {
    entryId,
    exerciseId: entryId,
    name: entryId,
    equipment,
    superset: null,
    notes: null,
    description: null,
    imageUrl: null,
    hasUpdateScript: false,
    promptedVars: [],
    warmupSets,
    sets,
  };
}

function workSetLabel(session) {
  const view = session.view(1000);
  const set = view.currentSet;
  return formatLoadoutLabel(set.weight, view.loadingEquipment, view.unit, set.plates, set.targetWeight);
}

function sessionOnFirstWorkSet(workout) {
  const session = createWorkoutSession({ plan: workoutToDayPlan(workout, { isCurrent: true }) });
  session.startWorkout({ timestamp: 0 });
  const warmups = workout.entries[0].warmupSets.length;
  for (let i = 0; i < warmups; i++) {
    session.completeSet({ timestamp: 1 + i });
    if (session.view(1 + i).state === SESSION_STATES.REST) session.nextSet({ timestamp: 1 + i });
  }
  return session;
}

const CABLE_ROW = {
  startTime: 1,
  entries: [
    entry('cable_row', 'cable', [
      plateSet('w1', 0, true, 10, [[5, 1]], { timer: 60 }),
      plateSet('w2', 1, true, 12.5, [[5, 1], [2.5, 1]], { timer: 60 }),
    ], [
      plateSet('s1', 0, false, 20, [[10, 1], [5, 1]]),
    ]),
  ],
};

test('an edited weight shows the plates for the new weight at once', () => {
  const session = sessionOnFirstWorkSet(CABLE_ROW);
  assert.equal(workSetLabel(session), '1×10 + 1×5 KG');

  session.adjustWeight(1, { timestamp: 2000 });

  assert.equal(session.view(2000).currentSet.weight, 22.5);
  assert.equal(workSetLabel(session), '1×10 + 1×5 + 1×2.5 KG');
});

test('lowering the weight to the empty stack says so', () => {
  const session = sessionOnFirstWorkSet(CABLE_ROW);
  session.adjustWeight(-6, { timestamp: 2000 });

  assert.equal(session.view(2000).currentSet.weight, 5);
  assert.equal(workSetLabel(session), 'EMPTY BAR · 5 KG');
});

test('a weight the known plates cannot make shows no breakdown', () => {
  // Only one 10, one 5 and one 2.5 were ever proposed, so 25 kg is not proven loadable.
  const session = sessionOnFirstWorkSet(CABLE_ROW);
  session.adjustWeight(2, { timestamp: 2000 });

  assert.equal(session.view(2000).currentSet.weight, 25);
  assert.equal(workSetLabel(session), null);
});

test('an unedited set keeps the breakdown the server chose', () => {
  // The server loads 15 as 10 + 5 although a single 15 is on hand.
  const workout = {
    startTime: 1,
    entries: [
      entry('cable_row', 'cable', [
        plateSet('w1', 0, true, 20, [[15, 1]], { timer: 60 }),
      ], [
        plateSet('s1', 0, false, 20, [[10, 1], [5, 1]]),
      ]),
    ],
  };
  const session = sessionOnFirstWorkSet(workout);
  assert.equal(workSetLabel(session), '1×10 + 1×5 KG');
});

test('two-sided loading needs two loadings that agree before it is trusted', () => {
  const single = {
    startTime: 1,
    entries: [entry('squat', 'barbell', [], [plateSet('s1', 0, false, 60, [[20, 1]], { sides: 2 })])],
  };
  const lone = sessionOnFirstWorkSet(single);
  lone.adjustWeight(1, { timestamp: 2000 });
  assert.equal(workSetLabel(lone), null);

  const confirmed = {
    startTime: 1,
    entries: [entry('squat', 'barbell', [
      plateSet('w1', 0, true, 40, [[10, 1]], { sides: 2, timer: 60 }),
    ], [
      plateSet('s1', 0, false, 60, [[20, 1]], { sides: 2 }),
    ])],
  };
  const session = sessionOnFirstWorkSet(confirmed);
  session.adjustWeight(8, { timestamp: 2000 });
  assert.equal(session.view(2000).currentSet.weight, 80);
  assert.equal(workSetLabel(session), '1×20 + 1×10 KG');
});

test('loadings that disagree on the bar are not used', () => {
  const workout = {
    startTime: 1,
    entries: [entry('machine', 'leverageMachine', [
      plateSet('w1', 0, true, 10, [[5, 1]], { timer: 60 }),
    ], [
      plateSet('s1', 0, false, 20, [[5, 1]]),
    ])],
  };
  const session = sessionOnFirstWorkSet(workout);
  session.adjustWeight(1, { timestamp: 2000 });
  assert.equal(workSetLabel(session), null);
});

test('fixed weights and sets without loading data show no breakdown after an edit', () => {
  const dumbbell = {
    startTime: 1,
    entries: [entry('curl', 'dumbbell', [], [fixedSet('s1', 0, 12.5)])],
  };
  const fixed = sessionOnFirstWorkSet(dumbbell);
  fixed.adjustWeight(1, { timestamp: 2000 });
  assert.equal(workSetLabel(fixed), null);

  const bare = plateSet('s1', 0, false, 20, [[10, 1], [5, 1]]);
  delete bare.loading;
  const legacy = sessionOnFirstWorkSet({ startTime: 1, entries: [entry('cable_row', 'cable', [], [bare])] });
  legacy.adjustWeight(1, { timestamp: 2000 });
  assert.equal(workSetLabel(legacy), null);
});
