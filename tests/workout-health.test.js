import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFileDiagnosticsStorage,
  createWorkoutDiagnostics,
  formatWorkoutDiagnostics,
  WORKOUT_DIAGNOSTIC_CODES as CODES,
  WORKOUT_DIAGNOSTICS_ENABLED_KEY,
} from '../shared/workout-diagnostics.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';

// The @zos/fs calls the watch storage uses, over an in-memory flash that counts every write.
function watchFiles() {
  const files = new Map();
  const writes = [];
  const handles = new Map();
  let nextHandle = 1;
  return {
    files,
    writes,
    O_WRONLY: 1,
    O_CREAT: 64,
    O_APPEND: 1024,
    readFileSync: ({ path }) => files.get(path),
    writeFileSync: ({ path, data }) => { files.set(path, data); writes.push(path); },
    openSync: ({ path }) => { handles.set(nextHandle, path); return nextHandle++; },
    writeSync: ({ fd, buffer }) => {
      const path = handles.get(fd);
      files.set(path, `${files.get(path) || ''}${Buffer.from(buffer).toString('utf8')}`);
      writes.push(path);
    },
    closeSync: ({ fd }) => handles.delete(fd),
  };
}

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms) => { now += ms; } };
}

function timers() {
  const pending = new Map();
  let next = 0;
  return {
    setTimeout: (callback) => { pending.set(++next, callback); return next; },
    clearTimeout: (id) => pending.delete(id),
    runAll: () => { for (const [id, callback] of [...pending]) { pending.delete(id); callback(); } },
    get size() { return pending.size; },
  };
}

const memory = { appUsed: 1_200_000, appPeak: 1_460_000, systemUsed: 2_900_000, systemTotal: 3_145_728 };

// One Workout launch as the data page wires it: persisted health, deferred lifecycle writes.
function launch(fs, time, { journal = 42, sample = () => memory, timer = timers() } = {}) {
  const diagnostics = createWorkoutDiagnostics(createFileDiagnosticsStorage(fs), time.now, sample, {
    flushDelayMs: 250,
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout,
    persistHealth: true,
    journalLength: () => journal,
  });
  return { diagnostics, timer };
}

const healthWrites = (fs) => fs.writes.filter((path) => path.startsWith('lifto-health')).length;

function useWorkout(diagnostics, time, sets = 1) {
  for (let set = 0; set < sets; set++) {
    diagnostics.record(CODES.ACTION_TAP, { action: 'COMPLETE_SET' });
    diagnostics.record(CODES.SET_TAP);
    time.advance(420);
    diagnostics.notePersist(380, 9_800);
    diagnostics.record(CODES.SET_SAVED);
    diagnostics.record(CODES.RENDER_START);
    time.advance(510);
    diagnostics.record(CODES.RENDER_END);
    diagnostics.record(CODES.PHONE_REQUEST, { request: MESSAGE_TYPES.SYNC_WORKOUT_SETS });
    diagnostics.record(CODES.PHONE_REPLY, { request: MESSAGE_TYPES.SYNC_WORKOUT_SETS }, {
      type: MESSAGE_TYPES.SYNC_WORKOUT_SETS_RESULT,
      payload: { workout: { startTime: 1 } },
    });
    time.advance(60_000);
  }
}

test('a tapped workout writes no health file until the watch leaves the page', () => {
  const fs = watchFiles();
  const time = clock();
  const { diagnostics, timer } = launch(fs, time);
  diagnostics.record(CODES.BOOT);
  diagnostics.record(CODES.BUILD);
  timer.runAll();
  const afterLaunch = healthWrites(fs);
  assert.equal(afterLaunch, 1, 'the launch marks the run as started once, after the first frame');

  useWorkout(diagnostics, time, 30);
  assert.equal(healthWrites(fs), afterLaunch, 'taps, saves, redraws and syncs never write the health file');
  assert.equal(fs.writes.filter((path) => path.startsWith('lifto-diagnostics')).length, 0, 'opt-in diagnostics stay off');

  diagnostics.record(CODES.PAUSE);
  assert.equal(healthWrites(fs), afterLaunch + 1);
  const stored = [...fs.files].filter(([path]) => path.startsWith('lifto-health'));
  const bytes = stored.reduce((sum, [, text]) => sum + text.length, 0);
  assert.ok(bytes < 2_048, `both health copies fit in 2 KB of flash, got ${bytes}`);
});

test('the next launch tells a silent kill from a normal pause', () => {
  const fs = watchFiles();
  const time = clock();
  const first = launch(fs, time);
  first.diagnostics.record(CODES.BOOT);
  first.diagnostics.record(CODES.BUILD);
  first.timer.runAll();
  useWorkout(first.diagnostics, time, 2);
  first.diagnostics.record(CODES.PAUSE);

  const second = launch(fs, time);
  second.diagnostics.setEnabled(true);
  let health = second.diagnostics.prepareUpload().payload.diagnostics.health;
  assert.equal(health.previous.clean, true);
  assert.equal(health.unclean, 0);

  second.diagnostics.record(CODES.BOOT);
  second.diagnostics.record(CODES.BUILD);
  second.timer.runAll();
  second.diagnostics.record(CODES.PHONE_REQUEST, { request: MESSAGE_TYPES.GET_EXERCISE_IMAGE });
  second.diagnostics.noteMemory({ ...memory, systemUsed: 3_100_000 });
  second.diagnostics.record(CODES.RESUME);
  second.timer.runAll();
  // The watch closes the app without onPause or onDestroy.

  const third = launch(fs, time);
  third.diagnostics.setEnabled(true);
  health = third.diagnostics.prepareUpload().payload.diagnostics.health;
  assert.equal(health.previous.clean, false);
  assert.equal(health.unclean, 1);
  assert.equal(health.previous.step, CODES.RESUME);
  assert.equal(health.previous.minFree, 3_145_728 - 3_100_000);
  assert.equal(health.previous.appPeak, memory.appPeak);
  assert.match(formatWorkoutDiagnostics(third.diagnostics.prepareUpload().payload.diagnostics), /previous run ended without a clean exit/i);
});

test('the summary keeps the slowest render, save and persist with the last reply shape', () => {
  const fs = watchFiles();
  const time = clock();
  const { diagnostics } = launch(fs, time);
  diagnostics.record(CODES.RENDER_START);
  time.advance(900);
  diagnostics.record(CODES.RENDER_END);
  useWorkout(diagnostics, time, 1);
  diagnostics.record(CODES.PHONE_REQUEST, { request: MESSAGE_TYPES.GET_EXERCISE_IMAGE });
  diagnostics.record(CODES.PHONE_REQUEST, { request: MESSAGE_TYPES.SYNC_WORKOUT_SETS });
  diagnostics.record(CODES.IMAGE_UNAVAILABLE, { image: 'LOW_MEMORY' });
  diagnostics.record(CODES.IMAGE_UNAVAILABLE, { image: 'TRANSFER_ERROR' });
  diagnostics.record(CODES.PAUSE);
  diagnostics.setEnabled(true);

  const { run } = diagnostics.prepareUpload().payload.diagnostics.health;
  assert.equal(run.renderMs, 510);
  assert.equal(run.renderWorstMs, 900);
  assert.equal(run.saveMs, 420);
  assert.equal(run.persistMs, 380);
  assert.equal(run.persistBytes, 9_800);
  assert.equal(run.journal, 42);
  assert.equal(run.replyRequest, MESSAGE_TYPES.SYNC_WORKOUT_SETS);
  assert.equal(run.replyType, MESSAGE_TYPES.SYNC_WORKOUT_SETS_RESULT);
  assert.equal(run.replyKind, 'WORKOUT_REF');
  assert.ok(run.replyBytes > 0);
  assert.equal(run.imageRequests, 1);
  assert.equal(run.imageRefusals, 1);
  assert.equal(run.imageFailures, 1);
  assert.equal(run.imageOverlaps, 1, 'a set sync started while an image request was in flight');
});

test('health leaves the watch only after the lifter enables diagnostics', () => {
  const fs = watchFiles();
  const time = clock();
  const { diagnostics } = launch(fs, time);
  useWorkout(diagnostics, time, 3);
  assert.deepEqual(diagnostics.prepareUpload().payload, {});
});

test('each report is uploaded once, then only a small health patch when it changes', () => {
  const fs = watchFiles();
  const time = clock();
  const { diagnostics } = launch(fs, time);
  diagnostics.setEnabled(true);
  diagnostics.record(CODES.BOOT);
  useWorkout(diagnostics, time, 30);

  const first = diagnostics.prepareUpload();
  assert.ok(Array.isArray(first.payload.diagnostics.events), 'the first upload carries the full report');
  first.commit();
  assert.deepEqual(diagnostics.prepareUpload().payload, {}, 'nothing changed since the upload');

  useWorkout(diagnostics, time, 1);
  const patch = diagnostics.prepareUpload();
  assert.equal(patch.payload.diagnostics.events, undefined, 'the same report is not sent again');
  const bytes = JSON.stringify(patch.payload).length;
  assert.ok(bytes < 1_024, `the health patch stays under 1 KB, got ${bytes}`);
  assert.ok(bytes * 4 < JSON.stringify(first.payload).length);
  patch.commit();
  assert.deepEqual(diagnostics.prepareUpload().payload, {});
  diagnostics.record(CODES.PAUSE);

  // The upload marker survives a relaunch; only a restart that archives a run makes a new report.
  const restarted = launch(fs, time).diagnostics;
  assert.equal(restarted.prepareUpload().payload.diagnostics.events, undefined);
  restarted.record(CODES.BOOT);
  assert.ok(Array.isArray(restarted.prepareUpload().payload.diagnostics.events));
});

test('the phone merges a health patch into the stored report', () => {
  const values = new Map([[WORKOUT_DIAGNOSTICS_ENABLED_KEY, 'true']]);
  const phoneStorage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  const fs = watchFiles();
  const time = clock();
  const { diagnostics } = launch(fs, time);
  diagnostics.setEnabled(true);
  diagnostics.record(CODES.BOOT);
  useWorkout(diagnostics, time, 2);
  const full = diagnostics.prepareUpload();
  createWorkoutDiagnostics(phoneStorage).replace(full.payload.diagnostics);
  full.commit();
  useWorkout(diagnostics, time, 1);
  createWorkoutDiagnostics(phoneStorage).replace(diagnostics.prepareUpload().payload.diagnostics);

  const stored = createWorkoutDiagnostics(phoneStorage).read();
  assert.ok(stored.events.length > 0, 'the patch keeps the uploaded steps');
  assert.equal(stored.health.run.saveMs, 420);
  assert.match(formatWorkoutDiagnostics(stored), /save last 420 ms/);
});

test('health holds counters and codes only', () => {
  const fs = watchFiles();
  const time = clock();
  const { diagnostics } = launch(fs, time);
  diagnostics.record(CODES.PHONE_REQUEST, { request: 'Bench Press https://example.com/lftsk_x' });
  diagnostics.record(CODES.PHONE_REPLY, { request: MESSAGE_TYPES.GET_WORKOUT_CURRENT }, {
    type: MESSAGE_TYPES.WORKOUT_CURRENT_DATA,
    payload: { workout: { dayName: 'Private Day', exercises: [{ name: 'Bench Press', weight: 100 }] } },
  });
  diagnostics.notePersist('Private Day', 'lftsk_x');
  diagnostics.noteMemory({ appUsed: 'Private Day' });
  diagnostics.record(CODES.PAUSE);
  diagnostics.setEnabled(true);
  const upload = JSON.stringify(diagnostics.prepareUpload().payload);
  const flash = [...fs.files.values()].join('');
  for (const text of [upload, flash, formatWorkoutDiagnostics(JSON.parse(upload).diagnostics)]) {
    assert.doesNotMatch(text, /Private|Bench|https|lftsk|example/);
  }
  assert.match(upload, /"replyKind":"WORKOUT"/);
});

test('closing the page writes nothing and drops the pending launch marker', () => {
  const fs = watchFiles();
  const time = clock();
  const { diagnostics, timer } = launch(fs, time);
  diagnostics.record(CODES.BUILD);
  diagnostics.record(CODES.EXIT);
  diagnostics.cancel();
  timer.runAll();
  assert.equal(healthWrites(fs), 0);
});
