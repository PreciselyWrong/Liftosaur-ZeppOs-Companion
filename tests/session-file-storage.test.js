/**
 * The session kept in watch files: the plan once per workout, each tap as one short line.
 * A watch can die at any character of any write, and the next launch must find every
 * session state whose save had finished and never one half written.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryStorageAdapter, createSessionStore } from '../shared/session-storage.js';
import { createWorkoutController } from '../shared/workout-controller.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { createRecordingFiles, filesOver, forEachCrash } from './helpers/torn-files.js';

const planNamed = (dayName, sets = 2) => ({
  programId: 'p1',
  source: 'WORKOUT_API',
  dayName,
  unit: 'kg',
  startTime: 1000,
  exercises: [{
    entryId: 'e1', name: 'Développé couché', description: 'Barre à la poitrine',
    sets: Array.from({ length: sets }, (_, index) => ({ setId: `s${index}`, targetReps: 5, targetWeight: 60 })),
  }],
});

const tap = (index) => ({ type: 'ADJUST_WEIGHT', timestamp: 2000 + index, payload: { delta: 1 + (index % 3) } });
const done = (index) => ({ type: 'COMPLETE_SET', timestamp: 3000 + index, payload: { setId: `s${index}`, weight: 62.5, reps: 5, unit: 'kg' } });
const direct = (acknowledgedSetCount) => ({ mode: 'DIRECT', startConfirmed: true, acknowledgedSetCount });

/** One workout's worth of saves: taps, folded taps, a rollback, a long log, an adoption, a clear. */
function script() {
  const planA = planNamed('Mardi');
  const planB = planNamed('Mardi', 3);
  const steps = [];
  let journal = [{ type: 'START_WORKOUT', timestamp: 1000 }];
  const save = (plan, sync, startedAt = 1000) => steps.push({ plan, journal: [...journal], startedAt, sync });
  save(planA, direct(0));
  journal.push(tap(0));
  save(planA, direct(0));
  journal[journal.length - 1] = { ...tap(0), payload: { delta: 3 } };
  save(planA, direct(0));
  journal.push(done(0));
  save(planA, direct(0));
  save(planA, direct(1));
  journal.push({ type: 'CORRECT_SET', timestamp: 4000, payload: { setId: 's0', weight: 65 } });
  save(planA, direct(1));
  journal.pop();
  save(planA, direct(1));
  for (let index = 1; index < 60; index++) {
    journal.push(tap(index));
    save(planA, direct(1));
  }
  save(planB, direct(1));
  journal.push(done(1));
  save(planB, direct(1));
  save(planB, direct(2), 1500);
  steps.push('clear');
  journal = [{ type: 'START_WORKOUT', timestamp: 9000 }];
  save(planA, direct(0), 9000);
  journal.push(tap(99));
  save(planA, direct(0), 9000);
  return steps;
}

const expected = (step) => (step === 'clear' || step === null ? null : {
  plan: step.plan, journal: step.journal, startedAt: step.startedAt, sync: step.sync,
});

function recordScript() {
  const files = createRecordingFiles();
  const store = createSessionStore(files);
  const groups = [];
  let previous = null;
  for (const step of script()) {
    const first = files.ops.length;
    if (step === 'clear') store.clear();
    else assert.equal(store.save(step), true);
    groups.push({ first, last: files.ops.length, before: expected(previous), after: expected(step) });
    previous = step;
  }
  return { files, groups };
}

const same = (actual, wanted) => JSON.stringify(actual) === JSON.stringify(wanted);

test('a dead watch at any character of any write leaves the last finished save or the one in progress', () => {
  const { files, groups } = recordScript();
  let crashes = 0;
  for (const group of groups) {
    for (let index = group.first; index < group.last; index++) {
      forEachCrash(files.ops, index, (disk) => {
        crashes += 1;
        const loaded = createSessionStore(filesOver(disk)).load();
        if (!same(loaded, group.before) && !same(loaded, group.after)) {
          assert.fail(`op ${index} (${files.ops[index].kind}): restored ${JSON.stringify(loaded)?.slice(0, 200)}`);
        }
        // The next launch keeps saving on top of whatever the crash left.
        const next = createSessionStore(filesOver(disk));
        next.load();
        const resumed = { plan: planNamed('Jeudi'), journal: [tap(7)], startedAt: 7, sync: direct(0) };
        assert.equal(next.save(resumed), true);
        resumed.journal = [tap(7), tap(8)];
        assert.equal(next.save(resumed), true);
        assert.ok(same(createSessionStore(filesOver(disk)).load(), resumed), `after a crash in op ${index}`);
      });
    }
  }
  assert.ok(crashes > 10_000, `${crashes} crash points`);
});

test('a corrupted byte in any stored file never yields a state that was not saved', () => {
  const { files, groups } = recordScript();
  const saved = groups.map((group) => group.after).filter(Boolean);
  for (const group of [groups[3], groups[40], groups[groups.length - 4], groups[groups.length - 1]]) {
    // The disk as it stood after this save.
    const disk = new Map();
    for (const op of files.ops.slice(0, group.last)) {
      if (op.kind === 'remove') disk.delete(op.name);
      else disk.set(op.name, op.kind === 'append' ? (disk.get(op.name) ?? '') + op.data : op.data);
    }
    for (const [name, content] of disk) {
      for (let at = 0; at < content.length; at++) {
        const copy = new Map(disk);
        copy.set(name, content.slice(0, at) + (content[at] === '7' ? '8' : '7') + content.slice(at + 1));
        const loaded = createSessionStore(filesOver(copy)).load();
        if (loaded !== null && !saved.some((state) => same(loaded, state))) {
          assert.fail(`byte ${at} of ${name}: restored a state never saved`);
        }
      }
    }
  }
});

test('a tap appends one short line and never writes the plan again', () => {
  const files = createRecordingFiles();
  const store = createSessionStore(files);
  const plan = planNamed('Mardi', 6);
  const journal = [{ type: 'START_WORKOUT', timestamp: 1000 }];
  store.save({ plan, journal, startedAt: 1000, sync: direct(0) });
  const planWrites = () => files.ops.filter((op) => op.data.includes('Mardi')).length;
  assert.equal(planWrites(), 1);

  for (let index = 0; index < 200; index++) {
    const first = files.ops.length;
    journal.push(tap(index));
    store.save({ plan, journal, startedAt: 1000, sync: direct(0) });
    const bytes = files.ops.slice(first).reduce((sum, op) => sum + op.data.length, 0);
    // A tap that folds the log into a new base writes the journal once, never the plan.
    assert.ok(bytes < 200 || bytes < JSON.stringify(journal).length + 200, `tap ${index} wrote ${bytes} bytes`);
  }
  assert.equal(planWrites(), 1);
  const appended = files.ops.filter((op) => op.kind === 'append');
  assert.ok(appended.length >= 150, `${appended.length} of 200 taps appended`);
  assert.ok(appended.every((op) => op.data.length < 200), 'each tap line stays short');
  assert.deepEqual(createSessionStore(filesOver(files.disk)).load().journal, journal);
});

test('the stored text is ASCII so a cut at any byte is a cut at a character', () => {
  const files = createRecordingFiles();
  const store = createSessionStore(files);
  const plan = planNamed('Mercredi soir: épaules');
  store.save({ plan, journal: [{ type: 'NOTE', timestamp: 1, payload: { text: 'Léger 💪' } }], startedAt: 1, sync: direct(0) });
  store.save({ plan, journal: [{ type: 'NOTE', timestamp: 1, payload: { text: 'Léger 💪' } }, tap(1)], startedAt: 1, sync: direct(0) });
  for (const op of files.ops) assert.match(op.data, /^[\x00-\x7f]*$/);
  assert.equal(createSessionStore(filesOver(files.disk)).load().journal[0].payload.text, 'Léger 💪');
  assert.equal(createSessionStore(filesOver(files.disk)).load().plan.dayName, 'Mercredi soir: épaules');
});

test('discarding removes every session file, and a watch dying mid-clear never revives an older state', () => {
  const { files, groups } = recordScript();
  const clear = groups.find((group) => group.after === null);
  assert.ok(clear.last > clear.first);
  for (let index = clear.first; index < clear.last; index++) {
    forEachCrash(files.ops, index, (disk) => {
      const loaded = createSessionStore(filesOver(disk)).load();
      if (loaded !== null && !same(loaded, clear.before)) assert.fail(`op ${index}: a cleared session came back older`);
    });
  }
  const store = createSessionStore(files);
  store.clear();
  assert.equal(files.disk.size, 0, [...files.disk.keys()].join(', '));
  assert.equal(createSessionStore(files).load(), null);
});

test('a log that cannot be removed on clear never leaks into the next session', () => {
  const files = createMemoryStorageAdapter();
  const stuck = { ...files, remove: (name) => { if (name.endsWith('-log.dat')) throw new Error('busy'); files.remove(name); } };
  const store = createSessionStore(stuck);
  const first = { plan: planNamed('Mardi'), journal: [tap(1)], startedAt: 1, sync: direct(0) };
  store.save(first);
  for (let index = 2; index < 6; index++) store.save({ ...first, journal: [...first.journal, tap(index)] });
  store.clear();
  assert.equal(createSessionStore(stuck).load(), null);

  const relaunch = createSessionStore(stuck);
  const second = { plan: planNamed('Mardi'), journal: [tap(1)], startedAt: 1, sync: direct(0) };
  relaunch.save(second);
  assert.deepEqual(createSessionStore(stuck).load(), second);
});

test('the companion and the workout extension keep separate files', () => {
  const files = createMemoryStorageAdapter();
  const companion = createSessionStore(files, { prefix: 'lifto-session' });
  const extension = createSessionStore(files, { prefix: 'lifto-ext-session' });
  companion.save({ plan: planNamed('A'), journal: [tap(1)], startedAt: 1, sync: direct(0) });
  extension.save({ plan: planNamed('B'), journal: [tap(2)], startedAt: 2, sync: direct(0) });
  assert.equal(createSessionStore(files, { prefix: 'lifto-session' }).load().plan.dayName, 'A');
  extension.clear();
  assert.equal(createSessionStore(files, { prefix: 'lifto-ext-session' }).load(), null);
  assert.equal(createSessionStore(files, { prefix: 'lifto-session' }).load().plan.dayName, 'A');
});

test('while the watch files refuse writes, the newest session stays in memory and the next save retries', () => {
  const files = createMemoryStorageAdapter();
  let failing = false;
  const flaky = {
    read: files.read,
    remove: files.remove,
    write: (name, data) => { if (failing) throw new Error('storage full'); files.write(name, data); },
    append: (name, data) => { if (failing) throw new Error('storage full'); files.append(name, data); },
  };
  const store = createSessionStore(flaky);
  const plan = planNamed('Mardi');
  assert.equal(store.save({ plan, journal: [tap(1)], startedAt: 1, sync: direct(0) }), true);
  failing = true;
  assert.equal(store.save({ plan, journal: [tap(1), tap(2)], startedAt: 1, sync: direct(0) }), false);
  assert.equal(store.load().journal.length, 2, 'read from memory');
  assert.equal(createSessionStore(files).load().journal.length, 1, 'the watch still holds the last stored save');
  failing = false;
  assert.equal(store.save({ plan, journal: [tap(1), tap(2), tap(3)], startedAt: 1, sync: direct(0) }), true);
  assert.equal(createSessionStore(files).load().journal.length, 3);
  store.clear();
  assert.equal(store.load(), null);
  assert.equal(files.files.size, 0);
});

// --- Migration from the single LocalStorage value used up to 0.5.15 ---

function legacySlot(value) {
  const slot = { value, removed: 0 };
  return Object.assign(slot, {
    read: () => slot.value,
    remove: () => { slot.value = null; slot.removed += 1; },
  });
}

function apiWorkout() {
  return {
    programId: 'program', dayName: 'Day', dayData: { week: 1, dayInWeek: 1 }, startTime: 1000,
    entries: [{
      entryId: 'entry-0', exerciseId: 'Squat', name: 'Squat',
      sets: [0, 1, 2].map((index) => ({ index, setId: `set-${index}`, weight: '20kg', reps: 5 })),
    }],
  };
}

/** A session as 0.5.15 stored it: one LocalStorage value with the plan, journal and sync state. */
function sessionFrom0515() {
  const legacy = legacySlot(null);
  const files = { read: () => null, write() {}, append() {}, remove() {} };
  const store = createSessionStore(files, { legacy });
  const controller = createWorkoutController({ store, now: () => 2000 });
  controller.loadPlan(workoutToDayPlan(apiWorkout()));
  controller.startWorkout();
  controller.completeSet();
  const snapshot = {
    version: 2,
    plan: controller.plan(),
    journal: controller.getJournal(),
    startedAt: controller.view().startedAt,
    sync: controller.sync(),
  };
  return { value: JSON.stringify(snapshot), writes: controller.getWorkoutSetWrites() };
}

test('a session stored by 0.5.15 restores, moves to the files once, and the old value goes only after', () => {
  const { value, writes } = sessionFrom0515();
  const files = createRecordingFiles();
  const legacy = legacySlot(value);

  const controller = createWorkoutController({ store: createSessionStore(files, { legacy }), now: () => 3000 });
  assert.equal(controller.restore().success, true);
  assert.deepEqual(controller.getWorkoutSetWrites(), writes);
  assert.equal(legacy.value, null, 'converted on the first launch');
  assert.equal(legacy.removed, 1);
  assert.ok(files.ops.length > 0);

  const relaunch = createWorkoutController({ store: createSessionStore(filesOver(files.disk), { legacy }), now: () => 4000 });
  assert.equal(relaunch.restore().success, true);
  assert.deepEqual(relaunch.getWorkoutSetWrites(), writes);
  assert.equal(legacy.removed, 1, 'converted once');
});

test('a dead watch at any point of the conversion still restores the 0.5.15 session', () => {
  const { value, writes } = sessionFrom0515();
  const files = createRecordingFiles();
  const legacy = legacySlot(value);
  createWorkoutController({ store: createSessionStore(files, { legacy }), now: () => 3000 }).restore();
  for (let index = 0; index < files.ops.length; index++) {
    forEachCrash(files.ops, index, (disk) => {
      // The old value is removed after every file write, so it is still there.
      const relaunch = createWorkoutController({
        store: createSessionStore(filesOver(disk), { legacy: legacySlot(value) }), now: () => 4000,
      });
      assert.equal(relaunch.restore().success, true, `op ${index}`);
      assert.deepEqual(relaunch.getWorkoutSetWrites(), writes);
    });
  }
});

test('the 0.5.15 value stays when the new files cannot be read back', () => {
  const { value, writes } = sessionFrom0515();
  const legacy = legacySlot(value);
  // Writes that report success but store nothing.
  const lossy = { read: () => null, write() {}, append() {}, remove() {} };
  const controller = createWorkoutController({ store: createSessionStore(lossy, { legacy }), now: () => 3000 });
  assert.equal(controller.restore().success, true);
  assert.equal(legacy.value, value);
  const relaunch = createWorkoutController({ store: createSessionStore(lossy, { legacy }), now: () => 4000 });
  assert.equal(relaunch.restore().success, true);
  assert.deepEqual(relaunch.getWorkoutSetWrites(), writes);
});

test('clearing a session also removes a 0.5.15 value still on the watch', () => {
  const { value } = sessionFrom0515();
  const files = createMemoryStorageAdapter();
  const legacy = legacySlot(value);
  const store = createSessionStore(files, { legacy });
  assert.notEqual(store.load(), null);
  store.clear();
  assert.equal(legacy.value, null);
  assert.equal(createSessionStore(files, { legacy }).load(), null);
});
