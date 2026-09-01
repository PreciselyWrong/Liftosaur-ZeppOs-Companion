import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createWorkoutController,
  defaultDirectSync,
  normalizeDirectSync,
} from '../shared/workout-controller.js';
import { createMemoryStorageAdapter, createSessionStore } from '../shared/session-storage.js';
import { SESSION_STATES } from '../shared/workout-session.js';

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
