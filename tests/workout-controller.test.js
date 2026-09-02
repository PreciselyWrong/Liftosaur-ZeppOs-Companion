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
    return Promise.resolve({ type: `${type}_DATA`, payload: {} });
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
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: {} })
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
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: {} })
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
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: {} })
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
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: {} })
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

  currentTime = 20000;
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
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: {} })
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

  controller.nextSet();
  assert.equal(controller.view().state, SESSION_STATES.ACTIVE_SET);
  assert.equal(controller.hasDeferredServerWorkout(), false);
  assert.equal(controller.view().currentSet.targetReps, 8);
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
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: {} })
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
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: {} })
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

  currentTime = 20000;
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

test('restored finish/discard intents can be resumed by a renderer', async () => {
  const adapter = createMemoryStorageAdapter();
  const store = createSessionStore(adapter);
  const transport = createFakeTransport();

  transport.on(MESSAGE_TYPES.START_WORKOUT, () =>
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: {} })
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
    Promise.resolve({ type: 'START_WORKOUT_DATA', payload: {} })
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
