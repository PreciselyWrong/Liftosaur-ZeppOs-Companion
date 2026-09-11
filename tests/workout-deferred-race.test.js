import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkoutController } from '../shared/workout-controller.js';
import { createMemoryStorageAdapter, createSessionStore } from '../shared/session-storage.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';

function workout() {
  return {
    programId: 'program', dayName: 'Day', dayData: { week: 1, dayInWeek: 1 }, startTime: 1000,
    entries: ['Squat', 'Bench'].map((name, exercise) => ({
      entryId: `entry-${exercise}`, exerciseId: name, name,
      sets: [0, 1].map(index => ({
        index, setId: `set-${exercise}-${index}`, weight: '20kg', reps: 5, timer: 60,
      })),
    })),
  };
}

test('deferred snapshots preserve newer writes, navigation and recovery across sync races', async () => {
  for (const timing of ['pending', 'acknowledged', 'latest snapshot', 'replacement']) {
    for (const action of ['nextSet', 'applyDeferredServerWorkout']) {
      const initial = workout();
      const oldSnapshot = workout();
      oldSnapshot.entries[0].sets[0].completed = { reps: 5, weight: '20kg' };
      let release;
      let batches = 0;
      const store = createSessionStore(createMemoryStorageAdapter());
      const controller = createWorkoutController({
        now: () => 1000, store,
        request: async type => {
          if (type === MESSAGE_TYPES.START_WORKOUT) return { payload: { workout: initial } };
          if (type === MESSAGE_TYPES.SYNC_WORKOUT_SETS) {
            if (++batches === 1) return { payload: { workout: oldSnapshot } };
            return new Promise(resolve => { release = resolve; });
          }
          return { payload: {} };
        },
      });
      controller.loadPlan(workoutToDayPlan(initial));
      controller.startWorkout();
      await controller.ensureStarted();
      controller.completeSet();
      await controller.syncSets();
      assert.equal(controller.hasDeferredServerWorkout(), true);
      if (timing === 'replacement') {
        controller.replaceFromServer(workoutToDayPlan(oldSnapshot, { isCurrent: true }));
        assert.equal(controller.hasDeferredServerWorkout(), false);
        continue;
      }
      controller.selectExercise(1);
      controller.completeSet();
      const sync = controller.syncSets();
      await Promise.resolve();
      if (timing !== 'pending') {
        const latest = structuredClone(oldSnapshot);
        latest.entries[1].sets[0].completed = { reps: 5, weight: '20kg' };
        latest.entries[1].sets[1].reps = 8;
        release({ payload: timing === 'latest snapshot' ? { workout: latest } : {} });
        await sync;
      }
      const writes = controller.getWorkoutSetWrites();
      controller[action]();
      assert.deepEqual(controller.getWorkoutSetWrites(), writes);
      assert.equal(controller.view().entryId, 'entry-1');
      if (timing === 'latest snapshot') assert.equal(controller.view().currentSet.targetReps, 8);
      const restored = createWorkoutController({ store, now: () => 1000 });
      assert.equal(restored.restore().success, true);
      assert.deepEqual(restored.getWorkoutSetWrites(), writes);
      if (timing === 'pending') {
        release({ payload: {} });
        await sync;
      }
      assert.equal(controller.sync().acknowledgedSetCount, 2);
      assert.equal(controller.sync().conflict, false);
    }
  }
});
