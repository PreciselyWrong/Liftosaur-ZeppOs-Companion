import test from 'node:test';
import assert from 'node:assert/strict';

import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { createWorkoutSession, SESSION_STATES } from '../shared/workout-session.js';
import { formatLoadoutLabel } from '../shared/weight-rounding.js';
import { createWorkoutController } from '../shared/workout-controller.js';
import { createMemoryStorageAdapter, createSessionStore } from '../shared/session-storage.js';
import { weightStepperDisplay } from '../shared/workout-display-settings.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';
import { createFakeCloud, createPhoneLink, flush } from './helpers/phone-harness.js';

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

// Synthetic gym in the GET /gyms/:id/equipment shape: more plates than the
// workout ever proposes, and a rack of fixed dumbbells.
const ACCOUNT = {
  currentGymId: 'gym-1',
  exerciseData: [],
  equipment: [
    {
      id: 'barbell', isDeleted: false, bar: { kg: '20kg', lb: '45lb' }, multiplier: 2, isFixed: false, fixed: [],
      plates: [{ weight: '20kg', num: 4 }, { weight: '5kg', num: 2 }, { weight: '2.5kg', num: 2 }, { weight: '1.25kg', num: 2 }],
    },
    {
      id: 'dumbbell', isDeleted: false, bar: { kg: '0kg', lb: '0lb' }, multiplier: 1, isFixed: true, plates: [],
      fixed: ['10kg', '12.5kg', '17.5kg'],
    },
  ],
};

async function controllerThroughPhone(workout, account) {
  const cloud = createFakeCloud(workout, { account });
  const link = createPhoneLink(cloud);
  link.setAuto(true);
  const controller = createWorkoutController({
    store: createSessionStore(createMemoryStorageAdapter()),
    request: link.request,
    now: () => 1_000_000,
  });
  const next = await link.phoneHandle(MESSAGE_TYPES.GET_WORKOUT_NEXT, {});
  controller.loadPlan(workoutToDayPlan(next.payload.workout), { clearStore: true });
  controller.startWorkout();
  await flush();
  return controller;
}

// What the weight stepper shows: the label line under the value.
function stepperLabel(controller) {
  const view = controller.view();
  const set = view.currentSet;
  return weightStepperDisplay(set.weight, view.unit,
    formatLoadoutLabel(set.weight, view.loadingEquipment, view.unit, set.plates, set.targetWeight), true).label;
}

test('through the phone, an edited weight shows the plates from the gym equipment', async () => {
  const workout = {
    programId: 'p', programName: 'P', dayName: 'D', dayData: { week: 1, dayInWeek: 1 }, startTime: null,
    entries: [
      entry('row_barbell', 'barbell', [], [plateSet('s1', 0, false, 60, [[20, 1]], { sides: 2 })]),
      entry('curl_dumbbell', 'dumbbell', [], [fixedSet('s2', 0, 12.5)]),
    ],
  };
  const controller = await controllerThroughPhone(workout, ACCOUNT);
  assert.equal(controller.sync().startConfirmed, true);
  assert.equal(stepperLabel(controller), '1×20 KG');

  controller.adjustWeight(1);
  assert.equal(controller.view().currentSet.weight, 62.5);
  assert.equal(stepperLabel(controller), '1×20 + 1×1.25 KG');

  controller.adjustWeight(-3);
  assert.equal(controller.view().currentSet.weight, 55);
  // Only small plates sit between one 20 per side and two: 37.5 is the most below.
  assert.equal(stepperLabel(controller), 'NEAR 37.5/60 KG');

  controller.selectExercise(1);
  assert.equal(stepperLabel(controller), 'USE 12.5 KG');
  controller.adjustWeight(1);
  assert.equal(controller.view().currentSet.weight, 15);
  assert.equal(stepperLabel(controller), 'NEAR 12.5/17.5 KG');
});

test('through the phone without the equipment endpoints, inference still breaks down what it can', async () => {
  const workout = {
    programId: 'p', programName: 'P', dayName: 'D', dayData: { week: 1, dayInWeek: 1 }, startTime: null,
    entries: [entry('curl_dumbbell', 'dumbbell', [], [fixedSet('s2', 0, 12.5)])],
  };
  const controller = await controllerThroughPhone(workout, null);
  controller.adjustWeight(1);
  assert.equal(stepperLabel(controller), 'KG');
});
