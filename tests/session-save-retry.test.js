import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createFallbackStorageAdapter, createSessionStore } from '../shared/session-storage.js';
import { createWorkoutController } from '../shared/workout-controller.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';

function flakyWatchStorage() {
  const disk = { value: null, failures: 0 };
  return {
    disk,
    read: () => disk.value,
    write: (data) => {
      if (disk.failures > 0) {
        disk.failures -= 1;
        throw new Error('storage busy');
      }
      disk.value = data;
    },
    remove: () => { disk.value = null; },
  };
}

const snapshot = (sets) => ({
  plan: { exercises: [] },
  journal: Array.from({ length: sets }, (_, timestamp) => ({ type: 'COMPLETE_SET', timestamp })),
});

test('one failed save does not stop later saves from reaching the watch', () => {
  const primary = flakyWatchStorage();
  const store = createSessionStore(createFallbackStorageAdapter(primary));
  assert.equal(store.save(snapshot(1)), true);
  primary.disk.failures = 1;
  assert.equal(store.save(snapshot(2)), false);
  assert.equal(store.save(snapshot(3)), true);
  const afterRestart = createSessionStore(createFallbackStorageAdapter(primary));
  assert.equal(afterRestart.load().journal.length, 3);
});

test('while saving fails, the newest session is still read from memory', () => {
  const primary = flakyWatchStorage();
  const store = createSessionStore(createFallbackStorageAdapter(primary));
  store.save(snapshot(1));
  primary.disk.failures = 1;
  store.save(snapshot(2));
  assert.equal(store.load().journal.length, 2);
  store.clear();
  assert.equal(store.load(), null);
  assert.equal(primary.disk.value, null);
});

function workout() {
  return {
    programId: 'program', dayName: 'Day', dayData: { week: 1, dayInWeek: 1 }, startTime: 1000,
    entries: [{
      entryId: 'entry-0', exerciseId: 'Squat', name: 'Squat',
      sets: [0, 1].map((index) => ({ index, setId: `set-${index}`, weight: '20kg', reps: 5, timer: 60 })),
    }],
  };
}

test('the controller reports when the session is not saved on the watch', () => {
  const primary = flakyWatchStorage();
  const controller = createWorkoutController({ now: () => 1000, store: createSessionStore(createFallbackStorageAdapter(primary)) });
  controller.loadPlan(workoutToDayPlan(workout()));
  controller.startWorkout();
  assert.equal(controller.isSaveFailing(), false);
  primary.disk.failures = 1;
  controller.completeSet();
  assert.equal(controller.isSaveFailing(), true);
  controller.nextSet();
  assert.equal(controller.isSaveFailing(), false);
  assert.equal(JSON.parse(primary.disk.value).journal.length, controller.getJournal().length);
});

function warningAfterStatusUpdate(file, functionName) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const start = source.indexOf(`function ${functionName}()`);
  const env = {
    syncWarning: null,
    directSync: null,
    workoutController: {
      isSaveFailing: () => true,
      sync: () => ({}),
      status: () => ({ code: 'pending' }),
    },
  };
  vm.createContext(env);
  vm.runInContext(`${source.slice(start, source.indexOf('\n}', start) + 2)}\n${functionName}();`, env);
  return env.syncWarning;
}

test('both watch apps warn before any sync warning when the session is not saved', () => {
  assert.equal(warningAfterStatusUpdate('../page/common/index.js', 'updateControllerStatus'), 'Unsaved on watch');
  assert.equal(warningAfterStatusUpdate('../data-widget/common/index.js', 'updateSyncWarning'), 'Unsaved on watch');
});
