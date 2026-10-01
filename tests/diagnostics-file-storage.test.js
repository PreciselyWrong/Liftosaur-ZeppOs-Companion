import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createFileDiagnosticsStorage,
  createWorkoutDiagnostics,
  WORKOUT_DIAGNOSTIC_CODES as CODES,
} from '../shared/workout-diagnostics.js';

const LOG = 'lifto-diagnostics.log';

// The @zos/fs calls the report uses, over an in-memory flash.
function watchFiles() {
  const files = new Map();
  const handles = new Map();
  const writes = [];
  let nextHandle = 1;
  let failure = null;
  // A native restart can interrupt a write after the file was emptied or half appended.
  const fail = (path, text) => {
    if (failure === 'interrupted') files.set(path, `${files.get(path) || ''}${text.slice(0, Math.floor(text.length / 2))}`);
    if (failure) throw new Error('write failed');
  };
  return {
    files,
    writes,
    failWrites: (mode) => { failure = mode; },
    O_WRONLY: 1,
    O_CREAT: 64,
    O_APPEND: 1024,
    readFileSync: ({ path }) => files.get(path),
    writeFileSync: ({ path, data }) => {
      if (failure === 'interrupted') files.set(path, '');
      if (failure) throw new Error('write failed');
      files.set(path, data);
      writes.push({ path, bytes: data.length, append: false });
    },
    openSync: ({ path }) => {
      const handle = nextHandle++;
      handles.set(handle, path);
      return handle;
    },
    writeSync: ({ fd, buffer }) => {
      const path = handles.get(fd);
      const text = Buffer.from(buffer).toString('utf8');
      fail(path, text);
      files.set(path, `${files.get(path) || ''}${text}`);
      writes.push({ path, bytes: text.length, append: true });
      return text.length;
    },
    closeSync: ({ fd }) => { handles.delete(fd); },
  };
}

function open(fs, at = 1_000) {
  return createWorkoutDiagnostics(createFileDiagnosticsStorage(fs), () => at);
}

test('the report lives in its own files and survives a restart', () => {
  const fs = watchFiles();
  const first = open(fs);
  first.setEnabled(true);
  first.record(CODES.BOOT);
  first.record(CODES.ACTION_TAP, { action: 'START_SET' });
  assert.ok([...fs.files.keys()].every((path) => path.startsWith('lifto-diagnostics')));
  const restarted = open(fs, 2_000);
  assert.equal(restarted.isEnabled(), true);
  assert.deepEqual(restarted.read(), first.read());
});

test('each step appends one short line instead of rewriting the report', () => {
  const fs = watchFiles();
  const diagnostics = open(fs);
  diagnostics.setEnabled(true);
  diagnostics.record(CODES.BOOT);
  const before = fs.writes.length;
  for (let set = 0; set < 20; set++) {
    diagnostics.record(CODES.ACTION_TAP, { action: 'COMPLETE_SET', screen: 'SESSION', state: 'REST', widgets: 23 });
    diagnostics.record(CODES.PHONE_REQUEST, { request: 'SYNC_WORKOUT_SETS' });
  }
  const steps = fs.writes.slice(before);
  assert.equal(steps.length, 40);
  assert.ok(steps.every((write) => write.append && write.path === LOG), 'no report rewrite while recording');
  assert.ok(steps.every((write) => write.bytes < 400), `largest step ${Math.max(...steps.map((write) => write.bytes))} bytes`);
});

test('a restart replays the appended steps and keeps the crashed run', () => {
  const fs = watchFiles();
  const crashed = open(fs);
  crashed.setEnabled(true);
  crashed.record(CODES.BOOT);
  crashed.record(CODES.ACTION_TAP, { action: 'COMPLETE_SET' });
  crashed.record(CODES.PHONE_REQUEST, { request: 'SYNC_WORKOUT_SETS' });
  const reopened = open(fs, 2_000);
  reopened.record(CODES.BOOT);
  const report = reopened.read();
  assert.deepEqual(report.previousRuns[0].events.map((event) => event.code), [CODES.BOOT, CODES.ACTION_TAP, CODES.PHONE_REQUEST]);
  assert.equal(report.previousRuns[0].details.lastAction.context.action, 'COMPLETE_SET');
});

test('a restart in the middle of a step keeps every complete step', () => {
  const fs = watchFiles();
  const crashed = open(fs);
  crashed.setEnabled(true);
  crashed.record(CODES.BOOT);
  crashed.record(CODES.ACTION_TAP, { action: 'START_WORKOUT' });
  fs.failWrites('interrupted');
  crashed.record(CODES.PHONE_REQUEST, { request: 'START_WORKOUT' });
  fs.failWrites(null);
  const reopened = open(fs, 2_000);
  assert.equal(reopened.isEnabled(), true);
  assert.deepEqual(reopened.read().events.map((event) => event.code), [CODES.BOOT, CODES.ACTION_TAP]);
  reopened.record(CODES.ACTION_TAP, { action: 'DISCARD_WORKOUT' });
  assert.deepEqual(open(fs, 3_000).read().events.map((event) => event.code), [CODES.BOOT, CODES.ACTION_TAP, CODES.ACTION_TAP]);
});

test('the log folds into the report from time to time and a restart never repeats a step', () => {
  const fs = watchFiles();
  const live = open(fs);
  live.setEnabled(true);
  live.record(CODES.BOOT);
  for (let step = 0; step < 500; step++) live.record(CODES.HEARTBEAT);
  const folds = fs.writes.filter((write) => !write.append && write.path !== LOG);
  assert.ok(folds.length >= 1 && folds.length <= 3, `${folds.length} report rewrites for 500 steps`);
  assert.ok((fs.files.get(LOG) || '').split('\n').filter(Boolean).length < 500);
  assert.deepEqual(open(fs, 2_000).read(), live.read());
});

test('a restart between folding the report and clearing the log repeats nothing', () => {
  const fs = watchFiles();
  const live = open(fs);
  live.setEnabled(true);
  live.record(CODES.BOOT);
  const clear = fs.writeFileSync;
  fs.writeFileSync = (options) => {
    if (options.path === LOG) throw new Error('restart');
    clear(options);
  };
  for (let step = 0; step < 500; step++) live.record(CODES.ACTION_TAP, { action: 'BUTTON' });
  fs.writeFileSync = clear;
  assert.deepEqual(open(fs, 2_000).read(), live.read());
});

test('unreadable report files start a fresh report', () => {
  const fs = watchFiles();
  const first = open(fs);
  first.setEnabled(true);
  first.record(CODES.BOOT);
  for (const path of fs.files.keys()) fs.files.set(path, '{"broken');
  const diagnostics = open(fs, 2_000);
  assert.equal(diagnostics.isEnabled(), false);
});

test('a restart during a report rewrite keeps the previous copy', () => {
  const fs = watchFiles();
  const diagnostics = open(fs);
  diagnostics.setEnabled(true);
  fs.failWrites('interrupted');
  diagnostics.setEnabled(false);
  fs.failWrites(null);
  assert.equal(open(fs, 2_000).isEnabled(), true);
});

test('switching diagnostics off clears the report and its log', () => {
  const fs = watchFiles();
  const diagnostics = open(fs);
  diagnostics.setEnabled(true);
  diagnostics.record(CODES.BOOT);
  diagnostics.record(CODES.ACTION_TAP, { action: 'START_SET' });
  diagnostics.setEnabled(false);
  assert.ok([...fs.files.values()].every((data) => !data.includes('START_SET')));
});

test('a failing write never interrupts recording', () => {
  const fs = watchFiles();
  const diagnostics = open(fs);
  diagnostics.setEnabled(true);
  fs.failWrites('busy');
  assert.equal(diagnostics.record(CODES.ACTION_TAP, { action: 'COMPLETE_SET' }), true);
  assert.equal(diagnostics.read().events.at(-1).code, CODES.ACTION_TAP);
});

for (const [name, file] of [['Companion', '../page/common/index.js'], ['Workout', '../data-widget/common/index.js']]) {
  test(`${name} keeps the report out of the session storage`, () => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /import \* as watchFiles from '@zos\/fs';/);
    assert.match(source, /createFileDiagnosticsStorage\(watchFiles\)/);
    assert.match(source, /createWorkoutDiagnostics\(diagnosticsStorage,/);
    assert.doesNotMatch(source, /createWorkoutDiagnostics\(deviceStorage/);
    assert.match(source, /deviceStorage\.removeItem\(WORKOUT_DIAGNOSTICS_KEY\)/);
  });
}
