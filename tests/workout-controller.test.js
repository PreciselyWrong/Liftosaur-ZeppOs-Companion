import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createWorkoutController,
  defaultDirectSync,
  normalizeDirectSync,
} from '../shared/workout-controller.js';
import { createMemoryStorageAdapter, createSessionStore } from '../shared/session-storage.js';
import { SESSION_STATES } from '../shared/workout-session.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { createWorkoutRefreshPolicy } from '../shared/workout-refresh-policy.js';
import { formatLoadoutLabel } from '../shared/weight-rounding.js';

const SAMPLE_PLAN = {
  programId: 'prog-1',
  dayName: 'Day 1',
  week: 1,
  dayInWeek: 1,
  unit: 'kg',
  exercises: [
    {
      index: 1,
      id: 'ex-1',
      entryId: 'entry-1',
      name: 'Squat',
      warmupSets: [],
      sets: [
        {
          index: 1,
          setId: 'set-1',
          targetReps: 5,
          targetWeight: 100,
          restSeconds: 90,
        },
        {
          index: 2,
          setId: 'set-2',
          targetReps: 5,
          targetWeight: 100,
          restSeconds: 90,
        },
      ],
    },
    {
      index: 2,
      id: 'ex-2',
      entryId: 'entry-2',
      name: 'Bench Press',
      warmupSets: [],
      sets: [
        {
          index: 1,
          setId: 'set-3',
          targetReps: 5,
          targetWeight: 80,
          restSeconds: 60,
        },
      ],
    },
  ],
};

const SAMPLE_DIRECT_PLAN = {
  ...SAMPLE_PLAN,
  source: 'WORKOUT_API',
};

const BARBELL = {
  bar: { kg: '20kg' },
  multiplier: 2,
  isFixed: false,
  plates: [
    { weight: '20kg', num: 2 },
    { weight: '10kg', num: 2 },
    { weight: '1.25kg', num: 2 },
  ],
};

test('initializes with default empty state when no plan is provided', () => {
  const controller = createWorkoutController();

  assert.equal(controller.plan(), null);
  assert.equal(controller.view().state, SESSION_STATES.NO_PLAN);
  assert.deepEqual(controller.sync(), defaultDirectSync('LEGACY'));
  assert.equal(controller.getCompletedSets().length, 0);
  assert.equal(controller.getWorkoutSetWrites().length, 0);
});
test('normalizes direct sync metadata defaults and patches safely', () => {
  const legacyDefault = defaultDirectSync('LEGACY');
  assert.equal(legacyDefault.mode, 'LEGACY');
  assert.equal(legacyDefault.startConfirmed, false);
  assert.equal(legacyDefault.acknowledgedSetCount, 0);
  assert.equal(legacyDefault.finishRequestedAt, null);
  assert.equal(legacyDefault.discardRequestedAt, null);
  assert.equal(legacyDefault.conflict, false);
  assert.equal(legacyDefault.remoteMissing, false);
  assert.deepEqual(legacyDefault.preservedIntervals, []);
  assert.equal(legacyDefault.intervalsPreservedThrough, null);

  const directDefault = defaultDirectSync('DIRECT');
  assert.equal(directDefault.mode, 'DIRECT');
  assert.equal(normalizeDirectSync({}, 'DIRECT').mode, 'DIRECT');

  const normalized = normalizeDirectSync({
    mode: 'DIRECT',
    startConfirmed: 1,
    acknowledgedSetCount: '3',
    finishRequestedAt: 12345,
    conflict: true,
    preservedIntervals: [[100, 200], 'invalid'],
  });

  assert.equal(normalized.mode, 'DIRECT');
  assert.equal(normalized.startConfirmed, true);
  assert.equal(normalized.acknowledgedSetCount, 3);
  assert.equal(normalized.finishRequestedAt, 12345);
  assert.equal(normalized.discardRequestedAt, null);
  assert.equal(normalized.conflict, true);
  assert.equal(normalized.remoteMissing, false);
  assert.deepEqual(normalized.preservedIntervals, [[100, 200]]);
  assert.equal(normalized.intervalsPreservedThrough, null);
});

test('loadPlan configures session, default sync mode, and optionally clears or persists store', () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  let changeNotified = false;

  const controller = createWorkoutController({
    store,
    onChange: () => {
      changeNotified = true;
    },
  });

  controller.loadPlan(SAMPLE_PLAN, { clearStore: true });
  assert.equal(controller.plan(), SAMPLE_PLAN);
  assert.equal(controller.view().state, SESSION_STATES.READY);
  assert.equal(controller.sync().mode, 'LEGACY');
  assert.equal(store.hasSession(), false);

  controller.loadPlan(SAMPLE_DIRECT_PLAN, { persist: true });
  assert.equal(controller.plan(), SAMPLE_DIRECT_PLAN);
  assert.equal(controller.sync().mode, 'DIRECT');
  assert.equal(store.hasSession(), true);
  assert.equal(store.load().sync.mode, 'DIRECT');
  assert.equal(changeNotified, true);
});

test('guarantees critical local mutations persist to store before calling onChange', () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  const order = [];

  const originalSave = store.save.bind(store);
  store.save = (snapshot) => {
    order.push({ event: 'store_save', journalLength: snapshot.journal.length });
    return originalSave(snapshot);
  };

  let controller;
  controller = createWorkoutController({
    store,
    now: () => 1000,
    onChange: (view) => {
      order.push({ event: 'on_change', state: view.state, journalLength: controller.getJournal().length });
    },
  });

  controller.loadPlan(SAMPLE_PLAN);
  order.length = 0;

  controller.startWorkout();
  assert.deepEqual(order, [
    { event: 'store_save', journalLength: 1 },
    { event: 'on_change', state: SESSION_STATES.ACTIVE_SET, journalLength: 1 },
  ]);

  order.length = 0;
  controller.adjustWeight(1);
  assert.deepEqual(order, [
    { event: 'store_save', journalLength: 2 },
    { event: 'on_change', state: SESSION_STATES.ACTIVE_SET, journalLength: 2 },
  ]);

  order.length = 0;
  controller.completeSet();
  assert.deepEqual(order, [
    { event: 'store_save', journalLength: 3 },
    { event: 'on_change', state: SESSION_STATES.REST, journalLength: 3 },
  ]);

  order.length = 0;
  controller.adjustRest(10);
  assert.deepEqual(order, [
    { event: 'store_save', journalLength: 4 },
    { event: 'on_change', state: SESSION_STATES.REST, journalLength: 4 },
  ]);

  order.length = 0;
  controller.toggleRestPause();
  assert.deepEqual(order, [
    { event: 'store_save', journalLength: 5 },
    { event: 'on_change', state: SESSION_STATES.REST, journalLength: 5 },
  ]);

  order.length = 0;
  controller.nextSet();
  assert.deepEqual(order, [
    { event: 'store_save', journalLength: 6 },
    { event: 'on_change', state: SESSION_STATES.ACTIVE_SET, journalLength: 6 },
  ]);
});

test('local action methods modify session state, update journal, and expose helper getters', () => {
  let currentTime = 1000;
  const controller = createWorkoutController({
    now: () => currentTime,
  });

  controller.loadPlan(SAMPLE_PLAN);
  assert.equal(controller.view().state, SESSION_STATES.READY);

  controller.startWorkout();
  assert.equal(controller.view().state, SESSION_STATES.ACTIVE_SET);
  assert.equal(controller.view().startedAt, 1000);

  controller.adjustWeight(2);
  assert.equal(controller.view().currentSet.weight, 105);

  controller.adjustReps(3);
  assert.equal(controller.view().currentSet.reps, 8);

  controller.adjustRpe(1);
  assert.equal(controller.view().currentSet.rpe, 9);

  controller.selectExercise(1);
  assert.equal(controller.view().currentExerciseIndex, 1);
  assert.equal(controller.view().exerciseName, 'Bench Press');

  controller.selectExercise(0);
  assert.equal(controller.view().currentExerciseIndex, 0);

  currentTime = 2000;
  controller.completeSet();
  assert.equal(controller.view().state, SESSION_STATES.REST);
  assert.equal(controller.getCompletedSets().length, 1);
  assert.equal(controller.getWorkoutSetWrites().length, 1);
  assert.equal(controller.getLastWorkoutSetWrite().setId, 'set-1');

  currentTime = 3000;
  controller.pauseRest();
  assert.equal(controller.view().rest.isPaused, true);

  currentTime = 4000;
  controller.resumeRest();
  assert.equal(controller.view().rest.isPaused, false);

  controller.adjustRest(-10);
  assert.equal(controller.view().rest.duration, 80);

  controller.nextSet();
  assert.equal(controller.view().state, SESSION_STATES.ACTIVE_SET);
  assert.equal(controller.view().currentSetIndex, 1);

  controller.finishWorkout();
  assert.equal(controller.view().state, SESSION_STATES.FINISHED);
});

test('updateSync patches and normalizes metadata then persists to store', () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  let notifyCount = 0;

  const controller = createWorkoutController({
    store,
    onChange: () => {
      notifyCount += 1;
    },
  });

  controller.loadPlan(SAMPLE_DIRECT_PLAN, { persist: true });
  notifyCount = 0;

  controller.updateSync({
    startConfirmed: true,
    acknowledgedSetCount: 2,
    finishRequestedAt: 5500,
  });

  assert.equal(controller.sync().startConfirmed, true);
  assert.equal(controller.sync().acknowledgedSetCount, 2);
  assert.equal(controller.sync().finishRequestedAt, 5500);
  assert.equal(notifyCount, 1);

  const persisted = store.load();
  assert.equal(persisted.sync.startConfirmed, true);
  assert.equal(persisted.sync.acknowledgedSetCount, 2);
  assert.equal(persisted.sync.finishRequestedAt, 5500);
});

test('replaceFromServer preserves intervals, anchors navigation, and updates session', () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  let currentTime = 1000;

  const controller = createWorkoutController({
    store,
    now: () => currentTime,
  });

  controller.loadPlan(SAMPLE_DIRECT_PLAN, { persist: true });
  controller.startWorkout();

  currentTime = 2000;
  controller.completeSet();

  const serverPlan = {
    ...SAMPLE_DIRECT_PLAN,
    isCurrent: true,
    exercises: [
      {
        ...SAMPLE_DIRECT_PLAN.exercises[0],
        sets: [
          {
            ...SAMPLE_DIRECT_PLAN.exercises[0].sets[0],
            completed: { reps: 5, weight: '100kg' },
          },
          {
            ...SAMPLE_DIRECT_PLAN.exercises[0].sets[1],
            targetReps: 6,
          },
        ],
      },
      SAMPLE_DIRECT_PLAN.exercises[1],
    ],
  };

  currentTime = 3000;
  controller.replaceFromServer(serverPlan, {
    preserveNavigation: true,
    acknowledgedSetCount: 1,
  });

  assert.equal(controller.plan(), serverPlan);
  assert.equal(controller.sync().acknowledgedSetCount, 1);
  assert.equal(controller.view().entryId, 'entry-1');
  assert.equal(controller.sync().intervalsPreservedThrough, 3000);

  const persisted = store.load();
  assert.equal(persisted.sync.acknowledgedSetCount, 1);
  assert.equal(persisted.sync.intervalsPreservedThrough, 3000);
});

test('tracks preserved and active workout intervals accurately', () => {
  const controller = createWorkoutController({
    now: () => 5000,
  });

  controller.loadPlan(SAMPLE_DIRECT_PLAN);
  controller.startWorkout();

  controller.preserveIntervals(3000);
  assert.equal(controller.sync().intervalsPreservedThrough, 3000);

  const intervals = controller.getIntervals(6000);
  assert.ok(Array.isArray(intervals));
  assert.ok(intervals.length > 0);
});

test('clear resets store, session, plan, and directSync metadata', () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  let changed = false;

  const controller = createWorkoutController({
    store,
    onChange: () => {
      changed = true;
    },
  });

  controller.loadPlan(SAMPLE_DIRECT_PLAN, { persist: true });
  assert.equal(store.hasSession(), true);

  changed = false;
  controller.clear();

  assert.equal(store.hasSession(), false);
  assert.equal(controller.plan(), null);
  assert.equal(controller.view().state, SESSION_STATES.NO_PLAN);
  assert.equal(controller.sync().mode, 'LEGACY');
  assert.equal(changed, true);
});

test('restore recovers version 1 legacy snapshot', () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);

  adapter.write(
    JSON.stringify({
      version: 1,
      plan: SAMPLE_PLAN,
      journal: [
        { type: 'START_WORKOUT', timestamp: 1000 },
        {
          type: 'COMPLETE_SET',
          timestamp: 2000,
          payload: {
            exerciseIndex: 1,
            setIndex: 1,
            weight: 100,
            reps: 5,
            unit: 'kg',
          },
        },
      ],
      startedAt: 1000,
    })
  );

  const controller = createWorkoutController({ store });
  const result = controller.restore();

  assert.equal(result.success, true);
  assert.equal(result.state, SESSION_STATES.REST);
  assert.equal(controller.plan().programId, 'prog-1');
  assert.equal(controller.sync().mode, 'LEGACY');
  assert.equal(controller.getCompletedSets().length, 1);
});

test('restore recovers version 2 direct snapshot with intent fields intact', () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);

  const syncState = {
    mode: 'DIRECT',
    startConfirmed: true,
    acknowledgedSetCount: 1,
    finishRequestedAt: 9999,
    discardRequestedAt: null,
    conflict: true,
    remoteMissing: false,
    preservedIntervals: [[1000, 2000]],
    intervalsPreservedThrough: 2000,
  };

  store.save({
    plan: SAMPLE_DIRECT_PLAN,
    journal: [{ type: 'START_WORKOUT', timestamp: 1000 }],
    startedAt: 1000,
    sync: syncState,
  });

  const controller = createWorkoutController({ store });
  const result = controller.restore();

  assert.equal(result.success, true);
  assert.equal(result.state, SESSION_STATES.ACTIVE_SET);
  assert.deepEqual(controller.sync(), syncState);
  assert.equal(controller.sync().finishRequestedAt, 9999);
  assert.equal(controller.sync().conflict, true);
});

test('restore fails safely without clearing raw store when snapshot is missing or invalid', () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  let loggedMessage = null;

  const controller = createWorkoutController({
    store,
    logger: {
      log: (msg) => {
        loggedMessage = msg;
      },
      error: (msg) => {
        loggedMessage = msg;
      },
    },
  });

  const emptyResult = controller.restore();
  assert.equal(emptyResult.success, false);
  assert.equal(emptyResult.reason, 'NO_SNAPSHOT');
  assert.equal(store.hasSession(), false);

  const invalidPlan = { programId: 'empty-prog', exercises: [] };
  store.save({ plan: invalidPlan, journal: [] });
  assert.equal(store.hasSession(), true);

  const noPlanResult = controller.restore();
  assert.equal(noPlanResult.success, false);
  assert.equal(noPlanResult.reason, 'NO_PLAN');
  assert.equal(store.hasSession(), true);

  adapter.write(JSON.stringify({ version: 2, plan: { exercises: null }, journal: [] }));
  const corruptResult = controller.restore();
  assert.equal(corruptResult.success, false);
  assert.notEqual(adapter.read(), null);
});

function createFakeTransport() {
  const calls = [];
  const handlers = new Map();

  function request(type, payload = {}) {
    calls.push({ type, payload });
    const handler = handlers.get(type);
    if (handler) {
      return handler(payload);
    }
    return Promise.resolve({ type: `${type}_DATA`, payload: type === MESSAGE_TYPES.START_WORKOUT ? { workout: { ...SAMPLE_SERVER_WORKOUT, startTime: payload.startTime } } : {} });
  }

  return {
    request,
    calls,
    on(type, fn) {
      handlers.set(type, fn);
    },
    resetCalls() {
      calls.length = 0;
    },
  };
}

const SAMPLE_SERVER_WORKOUT = {
  programId: 'prog-1',
  dayName: 'Day 1',
  dayData: { week: 1, dayInWeek: 1 },
  startTime: 1000,
  entries: [
    {
      entryId: 'entry-1',
      exerciseId: 'squat',
      name: 'Squat',
      sets: [
        {
          index: 0,
          setId: 'set-1',
          weight: '100kg',
          reps: 5,
          timer: 90,
        },
        {
          index: 1,
          setId: 'set-2',
          weight: '100kg',
          reps: 5,
          timer: 90,
        },
      ],
    },
    {
      entryId: 'entry-2',
      exerciseId: 'bench',
      name: 'Bench Press',
      sets: [
        {
          index: 0,
          setId: 'set-3',
          weight: '80kg',
          reps: 5,
          timer: 60,
        },
      ],
    },
  ],
};

test('adopting a matching snapshot preserves local details and equipment for adjusted plates', () => {
  const controller = createWorkoutController({ now: () => 1000 });
  const plan = {
    ...SAMPLE_DIRECT_PLAN,
    exercises: SAMPLE_DIRECT_PLAN.exercises.map((exercise, index) => index === 1
      ? {
          ...exercise,
          description: 'Keep shoulders pinned',
          notes: 'Bench at notch 2',
          loadingEquipment: BARBELL,
        }
      : exercise),
  };
  const serverWorkout = {
    ...SAMPLE_SERVER_WORKOUT,
    entries: SAMPLE_SERVER_WORKOUT.entries.map((entry, index) => index === 1
      ? {
          ...entry,
          description: null,
          notes: null,
          sets: entry.sets.map((set) => ({
            ...set,
            plates: [
              { weight: '20kg', num: 1 },
              { weight: '10kg', num: 1 },
            ],
          })),
        }
      : entry),
  };

  controller.loadPlan(plan);
  controller.startWorkout();
  controller.applyAdoptedSnapshot(serverWorkout);
  controller.selectExercise(1);

  assert.equal(controller.view().exerciseDetails, 'Bench at notch 2\n\nKeep shoulders pinned');
  assert.equal(controller.view().loadingEquipment, BARBELL);
  assert.equal(
    formatLoadoutLabel(
      controller.view().currentSet.weight,
      controller.view().loadingEquipment,
      controller.view().unit,
      controller.view().currentSet.plates,
      controller.view().currentSet.targetWeight
    ),
    'PER SIDE · 1×20 + 1×10 KG'
  );

  controller.adjustWeight(1);

  assert.equal(
    formatLoadoutLabel(
      controller.view().currentSet.weight,
      controller.view().loadingEquipment,
      controller.view().unit,
      controller.view().currentSet.plates,
      controller.view().currentSet.targetWeight
    ),
    'PER SIDE · 1×20 + 1×10 + 1×1.25 KG'
  );
});

test('local set persists before the first transport call', async () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  const transport = createFakeTransport();
  let completedSetCountInStoreAtTransportCall = null;

  transport.on(MESSAGE_TYPES.START_WORKOUT, () => {
    return Promise.resolve({ type: 'START_WORKOUT_DATA', payload: { workout: SAMPLE_SERVER_WORKOUT } });
  });

  transport.on(MESSAGE_TYPES.SYNC_WORKOUT_SETS, () => {
    const persisted = store.load();
    completedSetCountInStoreAtTransportCall = (persisted?.journal || []).filter(
      (j) => j.type === 'COMPLETE_SET'
    ).length;
    return Promise.resolve({ type: 'SYNC_WORKOUT_SETS_RESULT', payload: { workout: SAMPLE_SERVER_WORKOUT } });
  });

  const controller = createWorkoutController({
    store,
    request: transport.request,
    now: () => 1000,
  });

  controller.loadPlan(SAMPLE_DIRECT_PLAN, { persist: true });
  controller.startWorkout();
  await controller.ensureStarted();

  controller.completeSet();
  await controller.syncSets();

  assert.equal(completedSetCountInStoreAtTransportCall, 1);
});

test('concurrent drains share one promise and acknowledge only confirmed batch length', async () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  const transport = createFakeTransport();
  let resolveSync;

  transport.on(MESSAGE_TYPES.START_WORKOUT, () =>
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: { workout: SAMPLE_SERVER_WORKOUT } })
  );
  transport.on(MESSAGE_TYPES.SYNC_WORKOUT_SETS, () =>
    new Promise((resolve) => {
      resolveSync = resolve;
    })
  );

  const controller = createWorkoutController({
    store,
    request: transport.request,
    now: () => 1000,
  });

  controller.loadPlan(SAMPLE_DIRECT_PLAN);
  controller.startWorkout();
  await controller.ensureStarted();

  controller.completeSet();
  controller.nextSet();
  controller.completeSet();

  assert.equal(controller.getWorkoutSetWrites().length, 2);
  assert.equal(controller.sync().acknowledgedSetCount, 0);

  const p1 = controller.syncSets();
  const p2 = controller.syncSets();
  assert.equal(p1, p2);

  await Promise.resolve();

  resolveSync({
    type: 'SYNC_WORKOUT_SETS_RESULT',
    payload: { workout: SAMPLE_SERVER_WORKOUT },
  });

  await p1;
  assert.equal(controller.sync().acknowledgedSetCount, 2);
});

test('retryable transport failure preserves queue and returns pending status', async () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  const transport = createFakeTransport();

  transport.on(MESSAGE_TYPES.START_WORKOUT, () =>
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: { workout: SAMPLE_SERVER_WORKOUT } })
  );
  transport.on(MESSAGE_TYPES.SYNC_WORKOUT_SETS, () => {
    const err = new Error('Network timeout');
    err.code = 'NETWORK';
    return Promise.reject(err);
  });

  const controller = createWorkoutController({
    store,
    request: transport.request,
    now: () => 1000,
  });

  controller.loadPlan(SAMPLE_DIRECT_PLAN);
  controller.startWorkout();
  await controller.ensureStarted();
  controller.completeSet();

  await assert.rejects(async () => {
    await controller.syncSets();
  });

  assert.equal(controller.sync().acknowledgedSetCount, 0);
  assert.equal(controller.sync().conflict, false);
  assert.equal(controller.getStatus().code, 'pending');
});

test('non-retryable failure creates explicit conflict', async () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  const transport = createFakeTransport();

  transport.on(MESSAGE_TYPES.START_WORKOUT, () =>
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: { workout: SAMPLE_SERVER_WORKOUT } })
  );
  transport.on(MESSAGE_TYPES.SYNC_WORKOUT_SETS, () => {
    const err = new Error('Invalid set index');
    err.code = 'INVALID_SET';
    return Promise.reject(err);
  });

  const controller = createWorkoutController({
    store,
    request: transport.request,
    now: () => 1000,
  });

  controller.loadPlan(SAMPLE_DIRECT_PLAN);
  controller.startWorkout();
  await controller.ensureStarted();
  controller.completeSet();

  await assert.rejects(async () => {
    await controller.syncSets();
  });

  assert.equal(controller.sync().conflict, true);
  assert.equal(controller.getStatus().code, 'conflict');
});

test('poll cannot adopt after a local write started later', async () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  const transport = createFakeTransport();
  let resolvePoll;

  transport.on(MESSAGE_TYPES.START_WORKOUT, () =>
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: { workout: SAMPLE_SERVER_WORKOUT } })
  );
  transport.on(MESSAGE_TYPES.GET_WORKOUT_CURRENT, () =>
    new Promise((resolve) => {
      resolvePoll = resolve;
    })
  );

  let currentTime = 1000;
  const controller = createWorkoutController({
    store,
    request: transport.request,
    now: () => currentTime,
  });

  controller.loadPlan(SAMPLE_DIRECT_PLAN);
  controller.startWorkout();
  await controller.ensureStarted();

  currentTime = 121000;
  const pollPromise = controller.pollCurrent();

  controller.completeSet();
  assert.equal(controller.getWorkoutSetWrites().length, 1);

  resolvePoll({
    type: 'WORKOUT_CURRENT_DATA',
    payload: { workout: SAMPLE_SERVER_WORKOUT },
  });

  await pollPromise;

  assert.equal(controller.getWorkoutSetWrites().length, 1);
  assert.equal(controller.view().state, SESSION_STATES.REST);
});

test('poll/adoption never replaces pending writes', async () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  const transport = createFakeTransport();

  const controller = createWorkoutController({
    store,
    request: transport.request,
    now: () => 1000,
  });

  controller.loadPlan(SAMPLE_DIRECT_PLAN);
  controller.startWorkout();
  await controller.ensureStarted();
  controller.completeSet();

  assert.equal(controller.getWorkoutSetWrites().length, 1);
  assert.equal(controller.sync().acknowledgedSetCount, 0);

  const result = await controller.pollCurrent();
  assert.equal(result, false);
  assert.equal(transport.calls.filter((c) => c.type === MESSAGE_TYPES.GET_WORKOUT_CURRENT).length, 0);
});

test('REST snapshot defers and applies only on next set', async () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  const transport = createFakeTransport();

  const modifiedWorkout = {
    ...SAMPLE_SERVER_WORKOUT,
    entries: [
      {
        ...SAMPLE_SERVER_WORKOUT.entries[0],
        sets: [
          { ...SAMPLE_SERVER_WORKOUT.entries[0].sets[0], completed: { reps: 5, weight: '100kg' } },
          { ...SAMPLE_SERVER_WORKOUT.entries[0].sets[1], reps: 8 },
        ],
      },
      SAMPLE_SERVER_WORKOUT.entries[1],
    ],
  };

  transport.on(MESSAGE_TYPES.START_WORKOUT, () =>
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: { workout: SAMPLE_SERVER_WORKOUT } })
  );
  transport.on(MESSAGE_TYPES.SYNC_WORKOUT_SETS, () =>
    Promise.resolve({
      type: 'SYNC_WORKOUT_SETS_RESULT',
      payload: { workout: modifiedWorkout },
    })
  );

  const controller = createWorkoutController({
    store,
    request: transport.request,
    now: () => 1000,
  });

  controller.loadPlan(SAMPLE_DIRECT_PLAN);
  controller.startWorkout();
  await controller.ensureStarted();
  controller.completeSet();

  assert.equal(controller.view().state, SESSION_STATES.REST);
  await controller.syncSets();

  assert.equal(controller.view().state, SESSION_STATES.REST);
  assert.equal(controller.hasDeferredServerWorkout(), true);

  controller.adjustWeight(1);
  controller.adjustReps(1);

  controller.nextSet();
  assert.equal(controller.view().state, SESSION_STATES.ACTIVE_SET);
  assert.equal(controller.hasDeferredServerWorkout(), false);
  assert.equal(controller.view().currentSet.targetReps, 8);
  assert.equal(controller.view().currentSet.weight, 102.5);
  assert.equal(controller.view().currentSet.reps, 6);
});

test('start-time mismatch is conflict', async () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  const transport = createFakeTransport();

  transport.on(MESSAGE_TYPES.START_WORKOUT, () =>
    Promise.resolve({
      type: 'START_WORKOUT_DATA',
      payload: { workout: { ...SAMPLE_SERVER_WORKOUT, startTime: 9999 } },
    })
  );

  const controller = createWorkoutController({
    store,
    request: transport.request,
    now: () => 1000,
  });

  controller.loadPlan(SAMPLE_DIRECT_PLAN);
  controller.startWorkout();

  await controller.ensureStarted();

  assert.equal(controller.sync().conflict, true);
  assert.equal(controller.getStatus().code, 'conflict');
});

test('finish drains then sends exact times/intervals then clears persistence only on success', async () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  const transport = createFakeTransport();

  transport.on(MESSAGE_TYPES.START_WORKOUT, () =>
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: { workout: SAMPLE_SERVER_WORKOUT } })
  );
  transport.on(MESSAGE_TYPES.SYNC_WORKOUT_SETS, () =>
    Promise.resolve({ type: 'SYNC_WORKOUT_SETS_RESULT', payload: {} })
  );
  transport.on(MESSAGE_TYPES.FINISH_WORKOUT, () =>
    Promise.resolve({ type: 'FINISH_WORKOUT_RESULT', payload: { status: 'SAVED' } })
  );

  let currentTime = 1000;
  const controller = createWorkoutController({
    store,
    request: transport.request,
    now: () => currentTime,
  });

  controller.loadPlan(SAMPLE_DIRECT_PLAN, { persist: true });
  controller.startWorkout();
  currentTime = 2000;
  controller.completeSet();
  controller.nextSet();
  currentTime = 3000;
  controller.completeSet();
  currentTime = 4000;
  controller.finishWorkout();

  assert.equal(store.hasSession(), true);

  const finishRes = await controller.finishWorkoutRemote();
  assert.equal(finishRes.success, true);
  assert.equal(store.hasSession(), false);

  const finishCall = transport.calls.find((c) => c.type === MESSAGE_TYPES.FINISH_WORKOUT);
  assert.ok(finishCall);
  assert.equal(finishCall.payload.startTime, 1000);
  assert.ok(finishCall.payload.endTime >= 4000);
  assert.ok(Array.isArray(finishCall.payload.intervals));
  assert.equal(controller.getStatus().code, 'saved');
});

test('failed finish keeps snapshot and finish intent', async () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  const transport = createFakeTransport();

  transport.on(MESSAGE_TYPES.START_WORKOUT, () =>
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: { workout: SAMPLE_SERVER_WORKOUT } })
  );
  transport.on(MESSAGE_TYPES.SYNC_WORKOUT_SETS, () =>
    Promise.resolve({ type: 'SYNC_WORKOUT_SETS_RESULT', payload: {} })
  );
  transport.on(MESSAGE_TYPES.FINISH_WORKOUT, () => {
    const err = new Error('Gateway error');
    err.code = 'API_FAILED';
    return Promise.reject(err);
  });

  const controller = createWorkoutController({
    store,
    request: transport.request,
    now: () => 1000,
  });

  controller.loadPlan(SAMPLE_DIRECT_PLAN, { persist: true });
  controller.startWorkout();
  controller.completeSet();

  await assert.rejects(async () => {
    await controller.finishWorkoutRemote();
  });

  assert.equal(store.hasSession(), true);
  assert.ok(store.load().sync.finishRequestedAt);
  assert.equal(controller.getStatus().code, 'error');
});

test('missing remote workout sets remote-missing without clearing', async () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  const transport = createFakeTransport();

  transport.on(MESSAGE_TYPES.GET_WORKOUT_CURRENT, () =>
    Promise.resolve({ type: 'WORKOUT_CURRENT_DATA', payload: { workout: null } })
  );

  let currentTime = 1000;
  const controller = createWorkoutController({
    store,
    request: transport.request,
    now: () => currentTime,
  });

  controller.loadPlan(SAMPLE_DIRECT_PLAN, { persist: true });
  controller.startWorkout();
  await controller.ensureStarted();

  currentTime = 121000;
  await controller.pollCurrent();

  assert.equal(controller.sync().remoteMissing, true);
  assert.equal(controller.sync().conflict, true);
  assert.equal(store.hasSession(), true);
  assert.equal(controller.getStatus().code, 'remote-missing');
});

test('discard persists intent before request and clears only on confirmed or no_active_workout', async () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  const transport = createFakeTransport();
  let intentRecordedInStore = false;

  transport.on(MESSAGE_TYPES.DISCARD_WORKOUT, () => {
    const persisted = store.load();
    if (persisted && persisted.sync && persisted.sync.discardRequestedAt) {
      intentRecordedInStore = true;
    }
    return Promise.resolve({ type: 'DISCARD_WORKOUT_RESULT', payload: {} });
  });

  const controller = createWorkoutController({
    store,
    request: transport.request,
    now: () => 1000,
  });

  controller.loadPlan(SAMPLE_DIRECT_PLAN, { persist: true });
  controller.startWorkout();

  await controller.discardWorkoutRemote();

  assert.equal(intentRecordedInStore, true);
  assert.equal(store.hasSession(), false);
  assert.equal(controller.plan(), null);

  const controller2 = createWorkoutController({
    store,
    request: () => {
      const err = new Error('No active workout');
      err.code = 'no_active_workout';
      return Promise.reject(err);
    },
    now: () => 1000,
  });

  controller2.loadPlan(SAMPLE_DIRECT_PLAN, { persist: true });
  controller2.startWorkout();
  await controller2.discardWorkoutRemote();
  assert.equal(store.hasSession(), false);
  assert.equal(controller2.plan(), null);
});

test('discard without transport preserves the local session and intent', async () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  const controller = createWorkoutController({ store, now: () => 1000 });

  controller.loadPlan(SAMPLE_DIRECT_PLAN, { persist: true });
  controller.startWorkout();

  const result = await controller.discardWorkoutRemote();

  assert.deepEqual(result, { success: false, reason: 'NO_TRANSPORT' });
  assert.equal(store.hasSession(), true);
  assert.equal(controller.plan(), SAMPLE_DIRECT_PLAN);
  assert.equal(controller.sync().discardRequestedAt, 1000);
  assert.equal(controller.getStatus().code, 'pending');
});

test('concurrent discard requests share one remote write', async () => {
  const store = createSessionStore(createMemoryStorageAdapter());
  let resolveDiscard;
  let discardCalls = 0;
  const transport = createFakeTransport();
  transport.on(MESSAGE_TYPES.START_WORKOUT, () =>
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: { workout: SAMPLE_SERVER_WORKOUT } })
  );
  transport.on(MESSAGE_TYPES.DISCARD_WORKOUT, () => {
    discardCalls += 1;
    return new Promise((resolve) => {
      resolveDiscard = resolve;
    });
  });
  const controller = createWorkoutController({
    store,
    request: transport.request,
    now: () => 1000,
  });

  controller.loadPlan(SAMPLE_DIRECT_PLAN, { persist: true });
  controller.startWorkout();
  controller.updateSync({ conflict: true });

  const first = controller.discardWorkoutRemote();
  const second = controller.discardWorkoutRemote();
  assert.equal(discardCalls, 1);

  resolveDiscard({ type: 'DISCARD_WORKOUT_RESULT', payload: { deleted: true } });
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.success, true);
  assert.equal(secondResult.success, true);
  assert.equal(store.hasSession(), false);
});

test('restored finish/discard intents can be resumed by a renderer', async () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  const transport = createFakeTransport();

  transport.on(MESSAGE_TYPES.START_WORKOUT, () =>
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: { workout: SAMPLE_SERVER_WORKOUT } })
  );
  transport.on(MESSAGE_TYPES.SYNC_WORKOUT_SETS, () =>
    Promise.resolve({ type: 'SYNC_WORKOUT_SETS_RESULT', payload: {} })
  );
  transport.on(MESSAGE_TYPES.FINISH_WORKOUT, () =>
    Promise.resolve({ type: 'FINISH_WORKOUT_RESULT', payload: { status: 'SAVED' } })
  );

  store.save({
    plan: SAMPLE_DIRECT_PLAN,
    journal: [{ type: 'START_WORKOUT', timestamp: 1000 }],
    startedAt: 1000,
    sync: {
      mode: 'DIRECT',
      startConfirmed: true,
      acknowledgedSetCount: 0,
      finishRequestedAt: 5000,
      discardRequestedAt: null,
      conflict: false,
      remoteMissing: false,
      preservedIntervals: [],
      intervalsPreservedThrough: null,
    },
  });

  const controller = createWorkoutController({
    store,
    request: transport.request,
    now: () => 6000,
  });

  const restored = controller.restore();
  assert.equal(restored.success, true);
  assert.equal(controller.sync().finishRequestedAt, 5000);

  const res = await controller.finishWorkoutRemote();
  assert.equal(res.success, true);
  assert.equal(store.hasSession(), false);
});

test('retryPendingWrites drains durable unacknowledged direct set writes after network recovery', async () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  const transport = createFakeTransport();

  let networkAvailable = false;
  transport.on(MESSAGE_TYPES.START_WORKOUT, () =>
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: { workout: SAMPLE_SERVER_WORKOUT } })
  );
  transport.on(MESSAGE_TYPES.SYNC_WORKOUT_SETS, () => {
    if (!networkAvailable) {
      const err = new Error('Network unavailable');
      err.code = 'NETWORK';
      return Promise.reject(err);
    }
    return Promise.resolve({
      type: 'SYNC_WORKOUT_SETS_RESULT',
      payload: { workout: SAMPLE_SERVER_WORKOUT },
    });
  });

  const controller = createWorkoutController({
    store,
    request: transport.request,
    now: () => 1000,
  });

  controller.loadPlan(SAMPLE_DIRECT_PLAN, { persist: true });
  controller.startWorkout();
  await controller.ensureStarted();

  controller.completeSet();
  assert.equal(controller.getWorkoutSetWrites().length, 1);
  assert.equal(controller.sync().acknowledgedSetCount, 0);

  // Sync failed due to network
  await assert.rejects(async () => {
    await controller.syncSets();
  });
  assert.equal(controller.sync().acknowledgedSetCount, 0);
  assert.equal(controller.getStatus().code, 'pending');

  // Network recovers
  networkAvailable = true;

  // retryPendingWrites drains unacknowledged direct set writes
  const success = await controller.retryPendingWrites();
  assert.equal(success, true);
  assert.equal(controller.sync().acknowledgedSetCount, 1);
  assert.equal(controller.getStatus().code, 'idle');

  const persisted = store.load();
  assert.equal(persisted.sync.acknowledgedSetCount, 1);
});

test('REST issues one passive GET after 120 seconds without increasing the cadence', async () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  const transport = createFakeTransport();

  transport.on(MESSAGE_TYPES.START_WORKOUT, () =>
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: { workout: SAMPLE_SERVER_WORKOUT } })
  );
  transport.on(MESSAGE_TYPES.SYNC_WORKOUT_SETS, () =>
    Promise.resolve({
      type: 'SYNC_WORKOUT_SETS_RESULT',
      payload: { workout: SAMPLE_SERVER_WORKOUT },
    })
  );
  let getCalls = 0;
  transport.on(MESSAGE_TYPES.GET_WORKOUT_CURRENT, () => {
    getCalls += 1;
    return Promise.resolve({
      type: 'WORKOUT_CURRENT_DATA',
      payload: { workout: SAMPLE_SERVER_WORKOUT },
    });
  });

  let currentTime = 1000;
  const controller = createWorkoutController({
    store,
    request: transport.request,
    now: () => currentTime,
  });

  controller.loadPlan(SAMPLE_DIRECT_PLAN);
  controller.startWorkout();
  await controller.ensureStarted();

  controller.completeSet();
  await controller.syncSets();
  assert.equal(controller.view().state, SESSION_STATES.REST);

  currentTime += 119000;
  let pollResult = await controller.pollCurrent();
  assert.equal(pollResult, false);
  assert.equal(getCalls, 0);

  currentTime += 1000;
  pollResult = await controller.pollCurrent();
  assert.equal(pollResult, false);
  assert.equal(getCalls, 1);

  currentTime += 60000;
  pollResult = await controller.pollCurrent();
  assert.equal(pollResult, false);
  assert.equal(getCalls, 1);
});

test('nextSet from REST schedules/executes one checkpoint GET when eligible without blocking the local ACTIVE_SET transition', async () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  const transport = createFakeTransport();

  transport.on(MESSAGE_TYPES.START_WORKOUT, () =>
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: { workout: SAMPLE_SERVER_WORKOUT } })
  );
  transport.on(MESSAGE_TYPES.SYNC_WORKOUT_SETS, () =>
    Promise.resolve({
      type: 'SYNC_WORKOUT_SETS_RESULT',
      payload: { workout: SAMPLE_SERVER_WORKOUT },
    })
  );
  let getCalls = 0;
  transport.on(MESSAGE_TYPES.GET_WORKOUT_CURRENT, () => {
    getCalls += 1;
    return Promise.resolve({
      type: 'WORKOUT_CURRENT_DATA',
      payload: { workout: SAMPLE_SERVER_WORKOUT },
    });
  });

  let currentTime = 1000;
  const controller = createWorkoutController({
    store,
    request: transport.request,
    now: () => currentTime,
  });

  controller.loadPlan(SAMPLE_DIRECT_PLAN);
  controller.startWorkout();
  await controller.ensureStarted();

  controller.completeSet();
  await controller.syncSets();
  assert.equal(controller.view().state, SESSION_STATES.REST);

  // Eligible for checkpoint GET: >= 10s floor since last sync response
  currentTime += 15000;

  // nextSet transitions immediately to ACTIVE_SET synchronously
  controller.nextSet();
  assert.equal(controller.view().state, SESSION_STATES.ACTIVE_SET);

  // Allow microtasks for background refresh promise to complete
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(getCalls, 1);
});

test('ACTIVE_SET issues safety GET at 120 seconds', async () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  const transport = createFakeTransport();

  transport.on(MESSAGE_TYPES.START_WORKOUT, () =>
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: { workout: SAMPLE_SERVER_WORKOUT } })
  );
  let getCalls = 0;
  transport.on(MESSAGE_TYPES.GET_WORKOUT_CURRENT, () => {
    getCalls += 1;
    return Promise.resolve({
      type: 'WORKOUT_CURRENT_DATA',
      payload: { workout: SAMPLE_SERVER_WORKOUT },
    });
  });

  let currentTime = 1000;
  const controller = createWorkoutController({
    store,
    request: transport.request,
    now: () => currentTime,
  });

  controller.loadPlan(SAMPLE_DIRECT_PLAN);
  controller.startWorkout();
  await controller.ensureStarted();
  assert.equal(controller.view().state, SESSION_STATES.ACTIVE_SET);

  // At 119 seconds: not yet due
  currentTime = 1000 + 119000;
  const earlyPoll = await controller.pollCurrent();
  assert.equal(earlyPoll, false);
  assert.equal(getCalls, 0);

  // At 120 seconds: safety GET triggers
  currentTime = 1000 + 120000;
  const duePoll = await controller.pollCurrent();
  assert.equal(duePoll, true);
  assert.equal(getCalls, 1);
});

function startedWorkoutWithNewIds() {
  const workout = structuredClone(SAMPLE_SERVER_WORKOUT);
  for (const entry of workout.entries) {
    for (const set of [...(entry.warmupSets || []), ...entry.sets]) {
      set.setId = `live-${set.setId}`;
    }
  }
  return workout;
}

test('startup binds live set IDs before the first set without needing Retry sync', async () => {
  const transport = createFakeTransport();
  const store = createSessionStore(createMemoryStorageAdapter());
  const live = startedWorkoutWithNewIds();
  transport.on(MESSAGE_TYPES.START_WORKOUT, () => Promise.resolve({ payload: { workout: live } }));
  transport.on(MESSAGE_TYPES.SYNC_WORKOUT_SETS, ({ sets }) => {
    assert.equal(store.load().plan.exercises[0].sets[0].setId, 'live-set-1');
    assert.equal(sets[0].setId, 'live-set-1');
    return Promise.resolve({ payload: {} });
  });
  const controller = createWorkoutController({ store, request: transport.request, now: () => 1000 });
  controller.loadPlan(workoutToDayPlan(SAMPLE_SERVER_WORKOUT));
  controller.startWorkout();
  assert.equal(transport.calls[0].type, MESSAGE_TYPES.START_WORKOUT);
  await controller.ensureStarted();
  assert.equal(controller.view().currentSet.setId, 'live-set-1');
  controller.completeSet();
  await controller.syncSets();
  assert.equal(controller.sync().acknowledgedSetCount, 1);
  assert.equal(controller.sync().conflict, false);
  assert.equal(transport.calls.filter(({ type }) => type === MESSAGE_TYPES.START_WORKOUT).length, 1);
});

test('delayed startup rebinds queued sets durably without changing rest, edits or navigation', async () => {
  const transport = createFakeTransport();
  const store = createSessionStore(createMemoryStorageAdapter());
  let resolveStart;
  let resolveSets;
  transport.on(MESSAGE_TYPES.START_WORKOUT, () => new Promise((resolve) => { resolveStart = resolve; }));
  transport.on(MESSAGE_TYPES.SYNC_WORKOUT_SETS, () => new Promise((resolve) => { resolveSets = resolve; }));
  let time = 1000;
  const controller = createWorkoutController({ store, request: transport.request, now: () => time });
  controller.loadPlan(workoutToDayPlan(SAMPLE_SERVER_WORKOUT));
  controller.startWorkout();
  controller.adjustWeight(2);
  time = 2000;
  controller.completeSet({ repsLeft: 2, setTimer: 30, userVars: { effort: 7 } });
  controller.selectExercise(1);
  controller.adjustReps(2);
  time = 3000;
  controller.completeSet();
  controller.pauseRest();
  controller.adjustWeight(1);
  const before = controller.view();
  const journal = controller.getJournal();
  const intervals = controller.getIntervals();
  resolveStart({ payload: { workout: startedWorkoutWithNewIds() } });
  await controller.ensureStarted();
  const expectedJournal = journal.map((event) => event.type !== 'COMPLETE_SET' ? event : {
    ...event, payload: { ...event.payload, setId: `live-${event.payload.setId}` },
  });
  assert.deepEqual(controller.getJournal(), expectedJournal);
  assert.deepEqual(store.load().journal, expectedJournal);
  assert.equal(controller.view().state, before.state);
  assert.deepEqual(controller.view().rest, before.rest);
  assert.equal(controller.view().entryId, before.entryId);
  assert.deepEqual(controller.view().pending.set.weight, before.pending.set.weight);
  assert.deepEqual(controller.getIntervals(), intervals);
  assert.equal(controller.sync().acknowledgedSetCount, 0);
  assert.deepEqual(controller.getWorkoutSetWrites().map(({ setId }) => setId), ['live-set-1', 'live-set-3']);
  const restored = createWorkoutController({ store, now: () => time });
  assert.equal(restored.restore().success, true);
  assert.deepEqual(restored.getWorkoutSetWrites(), controller.getWorkoutSetWrites());
  assert.deepEqual(restored.view(), controller.view());
  resolveSets({ payload: {} });
  await controller.syncSets();
  assert.equal(controller.sync().acknowledgedSetCount, 2);
});

test('startup refuses a different day without losing queued sets or sending them', async () => {
  const transport = createFakeTransport();
  let resolveStart;
  transport.on(MESSAGE_TYPES.START_WORKOUT, () => new Promise((resolve) => { resolveStart = resolve; }));
  const controller = createWorkoutController({ request: transport.request, now: () => 1000 });
  controller.loadPlan(workoutToDayPlan(SAMPLE_SERVER_WORKOUT));
  controller.startWorkout();
  controller.completeSet();
  const journal = controller.getJournal();
  const live = startedWorkoutWithNewIds();
  live.dayData.dayInWeek = 2;
  resolveStart({ payload: { workout: live } });
  await assert.rejects(controller.ensureStarted(), { code: 'DAY_MISMATCH' });
  assert.equal(await controller.syncSets(), false);
  assert.deepEqual(controller.getJournal(), journal);
  assert.equal(controller.sync().startConfirmed, false);
  assert.equal(transport.calls.some(({ type }) => type === MESSAGE_TYPES.SYNC_WORKOUT_SETS), false);
});

test('startup preserves the local journal when the live structure is unsafe to match', async () => {
  for (const [label, change] of [
    ['different program', (workout) => { workout.programId = 'other-program'; }],
    ['reordered exercises', (workout) => { workout.entries.reverse(); }],
    ['changed set count', (workout) => { workout.entries[0].sets.pop(); }],
    ['changed set index', (workout) => { workout.entries[0].sets[0].index = 9; }],
    ['missing set ID', (workout) => { workout.entries[0].sets[0].setId = null; }],
    ['duplicate set ID', (workout) => { workout.entries[0].sets[1].setId = workout.entries[0].sets[0].setId; }],
  ]) {
    const store = createSessionStore(createMemoryStorageAdapter());
    const transport = createFakeTransport();
    let resolveStart;
    transport.on(MESSAGE_TYPES.START_WORKOUT, () => new Promise((resolve) => { resolveStart = resolve; }));
    const controller = createWorkoutController({ store, request: transport.request, now: () => 1000 });
    controller.loadPlan(workoutToDayPlan(SAMPLE_SERVER_WORKOUT));
    controller.startWorkout();
    controller.completeSet();
    const plan = controller.plan();
    const journal = controller.getJournal();
    const live = startedWorkoutWithNewIds();
    change(live);
    resolveStart({ payload: { workout: live } });
    await assert.rejects(controller.ensureStarted(), { code: 'START_PLAN_MISMATCH' }, label);
    assert.equal(controller.sync().startConfirmed, false);
    assert.equal(controller.sync().conflict, true);
    assert.equal(controller.plan(), plan);
    assert.deepEqual(store.load().journal, journal);
    assert.equal(transport.calls.some(({ type }) => type === MESSAGE_TYPES.SYNC_WORKOUT_SETS), false);
  }
});

test('startup rebinds warmups and repeated entry IDs by their validated positions after restart', async () => {
  const preview = structuredClone(SAMPLE_SERVER_WORKOUT);
  preview.entries.push(structuredClone(preview.entries[0]));
  preview.entries[2].sets.forEach((set) => { set.setId = `repeat-${set.setId}`; });
  preview.entries[0].warmupSets = [{ index: 0, setId: 'warmup', weight: '20kg', reps: 10, timer: 30, isWarmup: true }];
  const store = createSessionStore(createMemoryStorageAdapter());
  const offline = createWorkoutController({ store, now: () => 1000 });
  offline.loadPlan(workoutToDayPlan(preview));
  offline.startWorkout();
  offline.completeSet();
  offline.selectExercise(2);
  offline.completeSet();
  const transport = createFakeTransport();
  const live = structuredClone(preview);
  for (const entry of live.entries) {
    for (const set of [...(entry.warmupSets || []), ...entry.sets]) set.setId = `live-${set.setId}`;
  }
  transport.on(MESSAGE_TYPES.START_WORKOUT, () => Promise.resolve({ payload: { workout: live } }));
  const restored = createWorkoutController({ store, request: transport.request, now: () => 2000 });
  assert.equal(restored.restore().success, true);
  await restored.retryPendingWrites();
  const sets = transport.calls.find(({ type }) => type === MESSAGE_TYPES.SYNC_WORKOUT_SETS).payload.sets;
  assert.deepEqual(sets.map(({ setId }) => setId), ['live-warmup', 'live-repeat-set-1']);
  assert.equal(restored.sync().acknowledgedSetCount, 2);
});

test('startup cannot confirm without a live workout response', async () => {
  const transport = createFakeTransport();
  transport.on(MESSAGE_TYPES.START_WORKOUT, () => Promise.resolve({ payload: {} }));
  const controller = createWorkoutController({ request: transport.request, now: () => 1000 });
  controller.loadPlan(workoutToDayPlan(SAMPLE_SERVER_WORKOUT));
  controller.startWorkout();
  await assert.rejects(controller.ensureStarted(), { code: 'INVALID_START_WORKOUT' });
  assert.equal(controller.sync().startConfirmed, false);
});

test('a delayed startup response cannot rebind a replacement local session', async () => {
  const transport = createFakeTransport();
  const store = createSessionStore(createMemoryStorageAdapter());
  let resolveStart;
  transport.on(MESSAGE_TYPES.START_WORKOUT, () => new Promise((resolve) => { resolveStart = resolve; }));
  const controller = createWorkoutController({ store, request: transport.request, now: () => 1000 });
  controller.loadPlan(workoutToDayPlan(SAMPLE_SERVER_WORKOUT));
  controller.startWorkout();
  const pending = controller.ensureStarted();
  controller.clear();
  controller.loadPlan(workoutToDayPlan(SAMPLE_SERVER_WORKOUT), { persist: true });
  const before = store.load();
  resolveStart({ payload: { workout: startedWorkoutWithNewIds() } });
  assert.equal(await pending, false);
  assert.deepEqual(store.load(), before);
  assert.equal(controller.sync().startConfirmed, false);
});

function createAlwaysDueRefreshPolicy() {
  return {
    beginPoll: () => true,
    markSuccess: () => {},
    markFailure: () => {},
    markAuthoritativeResponse: () => {},
    request: () => {},
  };
}

function directControllerOptions(overrides = {}) {
  return {
    refreshPolicy: createAlwaysDueRefreshPolicy(),
    ...overrides,
  };
}

test('late poll response cannot replace a finished session', async () => {
  let resolvePoll;
  const controller = createWorkoutController(directControllerOptions({
    now: () => 2000,
    request: () => new Promise((resolve) => { resolvePoll = resolve; }),
  }));
  controller.loadPlan(workoutToDayPlan(SAMPLE_SERVER_WORKOUT, { isCurrent: true }), {
    sync: { mode: 'DIRECT', startConfirmed: true },
  });

  const pending = controller.pollCurrent();
  controller.finishWorkout();
  resolvePoll({ payload: { workout: SAMPLE_SERVER_WORKOUT } });

  assert.equal(await pending, false);
  assert.equal(controller.view().state, SESSION_STATES.FINISHED);
});

test('late poll response cannot replace a cleared session', async () => {
  let resolvePoll;
  const controller = createWorkoutController(directControllerOptions({
    now: () => 2000,
    request: () => new Promise((resolve) => { resolvePoll = resolve; }),
  }));
  controller.loadPlan(workoutToDayPlan(SAMPLE_SERVER_WORKOUT, { isCurrent: true }), {
    sync: { mode: 'DIRECT', startConfirmed: true },
  });

  const pending = controller.pollCurrent();
  controller.clear();
  resolvePoll({ payload: { workout: SAMPLE_SERVER_WORKOUT } });

  assert.equal(await pending, false);
  assert.equal(controller.view().state, SESSION_STATES.NO_PLAN);
});

test('late poll response cannot replace a reloaded session', async () => {
  let resolvePoll;
  const controller = createWorkoutController(directControllerOptions({
    now: () => 2000,
    request: () => new Promise((resolve) => { resolvePoll = resolve; }),
  }));
  controller.loadPlan(workoutToDayPlan(SAMPLE_SERVER_WORKOUT, { isCurrent: true }), {
    sync: { mode: 'DIRECT', startConfirmed: true },
  });

  const pending = controller.pollCurrent();
  const replacementWorkout = structuredClone(SAMPLE_SERVER_WORKOUT);
  replacementWorkout.programId = 'replacement';
  replacementWorkout.entries[0].sets[0].weight = '60kg';
  controller.loadPlan(workoutToDayPlan(replacementWorkout, { isCurrent: true }), {
    sync: { mode: 'DIRECT', startConfirmed: true },
  });
  resolvePoll({ payload: { workout: SAMPLE_SERVER_WORKOUT } });

  assert.equal(await pending, false);
  assert.equal(controller.view().programId, 'replacement');
  assert.equal(controller.view().currentSet.weight, 60);
});

test('snapshot adoption preserves edited current fields and refreshes untouched targets', async () => {
  const store = createSessionStore(createMemoryStorageAdapter());
  let resolvePoll;
  const controller = createWorkoutController(directControllerOptions({
    store,
    now: () => 2000,
    request: () => new Promise((resolve) => { resolvePoll = resolve; }),
  }));
  controller.loadPlan(workoutToDayPlan(SAMPLE_SERVER_WORKOUT, { isCurrent: true }), {
    sync: { mode: 'DIRECT', startConfirmed: true },
    persist: true,
  });
  controller.adjustWeight(2);
  controller.adjustRpe(1);

  const pending = controller.pollCurrent();
  controller.adjustReps(1);
  const refreshed = structuredClone(SAMPLE_SERVER_WORKOUT);
  refreshed.entries[0].sets[0].weight = '110kg';
  refreshed.entries[0].sets[0].reps = 8;
  refreshed.entries[0].sets[0].rpe = 6;
  refreshed.entries[0].sets[1].weight = '107.5kg';
  resolvePoll({ payload: { workout: refreshed } });

  assert.equal(await pending, true);
  assert.equal(controller.view().currentSet.weight, 105);
  assert.equal(controller.view().currentSet.reps, 6);
  assert.equal(controller.view().currentSet.rpe, 9);
  assert.equal(controller.plan().exercises[0].sets[1].targetWeight, 107.5);

  const restored = createWorkoutController({ store, now: () => 2000 });
  assert.equal(restored.restore().success, true);
  assert.equal(restored.view().currentSet.weight, 105);
  assert.equal(restored.view().currentSet.reps, 6);
  assert.equal(restored.view().currentSet.rpe, 9);
});

test('snapshot adoption uses server values for untouched fields and a different set identity', async () => {
  const refreshed = structuredClone(SAMPLE_SERVER_WORKOUT);
  refreshed.entries[0].sets[0].weight = '110kg';
  refreshed.entries[0].sets[0].reps = 8;
  refreshed.entries[0].sets[0].rpe = 7;
  const controller = createWorkoutController({ now: () => 2000 });
  controller.loadPlan(workoutToDayPlan(SAMPLE_SERVER_WORKOUT, { isCurrent: true }), {
    sync: { mode: 'DIRECT', startConfirmed: true },
  });
  controller.applyAdoptedSnapshot(refreshed);
  assert.equal(controller.view().currentSet.weight, 110);
  assert.equal(controller.view().currentSet.reps, 8);
  assert.equal(controller.view().currentSet.rpe, 7);

  controller.adjustWeight(2);
  const replacedSet = structuredClone(refreshed);
  replacedSet.entries[0].sets[0].setId = 'replacement-set';
  replacedSet.entries[0].sets[0].weight = '80kg';
  controller.applyAdoptedSnapshot(replacedSet);
  assert.equal(controller.view().currentSet.setId, 'replacement-set');
  assert.equal(controller.view().currentSet.weight, 80);
});

test('successful set sync preserves edits made to the next active set', async () => {
  const workout = structuredClone(SAMPLE_SERVER_WORKOUT);
  workout.entries[0].sets[0].timer = 0;
  let resolveSync;
  const controller = createWorkoutController({
    now: () => 2000,
    request: (type) => {
      assert.equal(type, MESSAGE_TYPES.SYNC_WORKOUT_SETS);
      return new Promise((resolve) => { resolveSync = resolve; });
    },
  });
  controller.loadPlan(workoutToDayPlan(workout, { isCurrent: true }), {
    sync: { mode: 'DIRECT', startConfirmed: true },
  });

  controller.completeSet();
  controller.adjustWeight(2);
  controller.adjustReps(1);
  controller.adjustRpe(1);
  const syncPromise = controller.syncSets();
  await Promise.resolve();
  const refreshed = structuredClone(workout);
  refreshed.entries[0].sets[0].completed = { weight: '100kg', reps: 5 };
  refreshed.entries[0].sets[1].weight = '120kg';
  refreshed.entries[0].sets[1].reps = 8;
  resolveSync({ payload: { workout: refreshed } });
  await syncPromise;

  assert.equal(controller.view().currentSet.setId, 'set-2');
  assert.equal(controller.view().currentSet.weight, 105);
  assert.equal(controller.view().currentSet.reps, 6);
  assert.equal(controller.view().currentSet.rpe, 9);
});

test('snapshot adoption preserves an open native pause across resume and restore', () => {
  const store = createSessionStore(createMemoryStorageAdapter());
  let time = 11000;
  const controller = createWorkoutController({ store, now: () => time });
  controller.loadPlan(workoutToDayPlan(SAMPLE_SERVER_WORKOUT, { isCurrent: true }), {
    sync: { mode: 'DIRECT', startConfirmed: true },
    persist: true,
  });
  controller.pauseWorkout();
  time = 21000;
  controller.applyAdoptedSnapshot(SAMPLE_SERVER_WORKOUT);

  assert.equal(controller.view().elapsedSeconds, 10);
  assert.deepEqual(controller.getIntervals(), [[1000, 11000]]);

  const pausedRestore = createWorkoutController({ store, now: () => time });
  assert.equal(pausedRestore.restore().success, true);
  assert.equal(pausedRestore.view().elapsedSeconds, 10);
  assert.deepEqual(pausedRestore.getIntervals(), [[1000, 11000]]);

  time = 31000;
  pausedRestore.resumeWorkout();
  time = 36000;
  assert.equal(pausedRestore.view().elapsedSeconds, 15);
  assert.deepEqual(pausedRestore.getIntervals(), [[1000, 11000], [31000, 36000]]);
});

test('snapshot adoption preserves a closed native pause across restore', () => {
  const store = createSessionStore(createMemoryStorageAdapter());
  let time = 11000;
  const controller = createWorkoutController({ store, now: () => time });
  controller.loadPlan(workoutToDayPlan(SAMPLE_SERVER_WORKOUT, { isCurrent: true }), {
    sync: { mode: 'DIRECT', startConfirmed: true },
    persist: true,
  });
  controller.pauseWorkout();
  time = 21000;
  controller.resumeWorkout();
  time = 31000;
  controller.applyAdoptedSnapshot(SAMPLE_SERVER_WORKOUT);

  assert.equal(controller.view().elapsedSeconds, 20);
  assert.deepEqual(controller.getIntervals(), [[1000, 11000], [21000, 31000]]);

  const restored = createWorkoutController({ store, now: () => time });
  assert.equal(restored.restore().success, true);
  assert.equal(restored.view().elapsedSeconds, 20);
  assert.deepEqual(restored.getIntervals(), [[1000, 11000], [21000, 31000]]);
});

test('snapshot adoption preserves overlapping manual rest and native pauses', () => {
  const workout = structuredClone(SAMPLE_SERVER_WORKOUT);
  let time = 2000;
  const controller = createWorkoutController({ now: () => time });
  controller.loadPlan(workoutToDayPlan(workout, { isCurrent: true }), {
    sync: { mode: 'DIRECT', startConfirmed: true },
  });
  controller.completeSet();
  time = 11000;
  controller.pauseRest();
  time = 16000;
  controller.pauseWorkout();
  time = 21000;
  controller.resumeRest();
  time = 26000;
  controller.applyAdoptedSnapshot(workout);

  assert.equal(controller.view().elapsedSeconds, 10);
  assert.deepEqual(controller.getIntervals(), [[1000, 11000]]);

  time = 31000;
  controller.resumeWorkout();
  time = 36000;
  assert.equal(controller.view().elapsedSeconds, 15);
  assert.deepEqual(controller.getIntervals(), [[1000, 11000], [31000, 36000]]);
});

test('adopting a different workout does not carry edits, pauses, or intervals', () => {
  let time = 11000;
  const controller = createWorkoutController({ now: () => time });
  controller.loadPlan(workoutToDayPlan(SAMPLE_SERVER_WORKOUT, { isCurrent: true }), {
    sync: { mode: 'DIRECT', startConfirmed: true },
  });
  controller.adjustWeight(2);
  controller.pauseWorkout();
  const replacement = structuredClone(SAMPLE_SERVER_WORKOUT);
  replacement.startTime = 5000;
  replacement.entries[0].sets[0].weight = '80kg';
  time = 15000;
  controller.applyAdoptedSnapshot(replacement);

  assert.equal(controller.view().startedAt, 5000);
  assert.equal(controller.view().currentSet.weight, 80);
  assert.equal(controller.view().elapsedSeconds, 10);
  assert.deepEqual(controller.getIntervals(), [[5000, 15000]]);

  controller.adjustWeight(2);
  controller.pauseWorkout();
  const otherProgram = structuredClone(replacement);
  otherProgram.programId = 'other-program';
  otherProgram.entries[0].sets[0].weight = '70kg';
  time = 20000;
  controller.applyAdoptedSnapshot(otherProgram);

  assert.equal(controller.view().programId, 'other-program');
  assert.equal(controller.view().currentSet.weight, 70);
  assert.equal(controller.view().elapsedSeconds, 15);
  assert.deepEqual(controller.getIntervals(), [[5000, 20000]]);
});
