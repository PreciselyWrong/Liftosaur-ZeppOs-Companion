import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createWorkoutDiagnostics, formatWorkoutDiagnostics, phoneFailureReason, WORKOUT_DIAGNOSTIC_CODES as CODES } from '../shared/workout-diagnostics.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';

function fixture() {
  const values = new Map();
  let now = 1_000;
  let samples = 0;
  return {
    storage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    now: () => now,
    advance(ms) { now += ms; },
    sample: () => { samples++; return { appUsed: 800_000, appPeak: 1_000_000, systemUsed: 2_900_000, systemTotal: 3_145_728 }; },
    get samples() { return samples; },
  };
}

function launch(f, steps = []) {
  const log = createWorkoutDiagnostics(f.storage, f.now, f.sample);
  log.setEnabled(true);
  log.record(CODES.BOOT);
  for (const [code, context] of steps) {
    f.advance(1_000);
    log.record(code, context);
  }
  return log;
}

const actions = report => report.previousRuns.map(run => run.details?.lastAction?.context.action);

test('a crash run survives a reopening where the user taps before copying the report', () => {
  const f = fixture();
  launch(f, [[CODES.ACTION_TAP, { action: 'START_SET' }], [CODES.RENDER_END]]);
  launch(f, [[CODES.RESTORED], [CODES.ACTION_TAP, { action: 'DISCARD_WORKOUT' }]]);
  const report = launch(f).read();
  assert.deepEqual(actions(report), ['DISCARD_WORKOUT', 'START_SET']);
  assert.equal(report.previousRuns[1].events.at(-1).code, CODES.RENDER_END);
});

test('keeps the three most recent finished runs', () => {
  const f = fixture();
  for (const action of ['OPEN_INFO', 'START_SET', 'COMPLETE_SET', 'DISCARD_WORKOUT']) {
    launch(f, [[CODES.ACTION_TAP, { action }]]);
  }
  assert.deepEqual(actions(launch(f).read()), ['DISCARD_WORKOUT', 'COMPLETE_SET', 'START_SET']);
});

test('startup-only reopenings do not push earlier runs out', () => {
  const f = fixture();
  launch(f, [[CODES.ACTION_TAP, { action: 'START_SET' }]]);
  launch(f, [[CODES.BUILD], [CODES.RENDER_END]]);
  const report = launch(f).read();
  assert.deepEqual(actions(report), ['START_SET']);
});

test('samples memory at every tap, action end and phone reply without sampling every redraw', () => {
  const f = fixture();
  const log = launch(f);
  const before = f.samples;
  log.record(CODES.ACTION_TAP, { action: 'START_SET' });
  f.advance(300);
  log.record(CODES.ACTION_DONE);
  f.advance(300);
  log.record(CODES.PHONE_REPLY, { request: MESSAGE_TYPES.GET_WORKOUT_CURRENT });
  f.advance(300);
  log.record(CODES.RENDER_END);
  assert.equal(f.samples - before, 3);
  const codesWithMemory = log.read().events.filter(event => event.memory).map(event => event.code);
  assert.deepEqual(codesWithMemory.slice(-3), [CODES.ACTION_TAP, CODES.ACTION_DONE, CODES.PHONE_REPLY]);
});

test('bursts of taps sample memory at most every 250 ms', () => {
  const f = fixture();
  const log = launch(f);
  const before = f.samples;
  for (let index = 0; index < 20; index++) {
    log.record(CODES.ACTION_TAP, { action: 'INCREASE_WEIGHT' });
    f.advance(50);
  }
  assert.equal(f.samples - before, 4);
});

test('phone replies keep only protocol request names', () => {
  const f = fixture();
  const log = launch(f);
  log.record(CODES.PHONE_REPLY, { request: MESSAGE_TYPES.SYNC_WORKOUT_SETS });
  log.record(CODES.PHONE_REPLY, { request: 'lftsk_secret' });
  const [kept, dropped] = log.read().events.slice(-2);
  assert.equal(kept.context.request, 'SYNC_WORKOUT_SETS');
  assert.equal(dropped.context, undefined);
  assert.match(formatWorkoutDiagnostics(log.read()), /PHONE_REPLY \(\+0ms\) \| request SYNC_WORKOUT_SETS/);
});

test('the phone report lists finished runs oldest first, each with its own details', () => {
  const f = fixture();
  launch(f, [[CODES.ACTION_TAP, { action: 'START_SET' }]]);
  launch(f, [[CODES.ACTION_TAP, { action: 'DISCARD_WORKOUT' }]]);
  const text = formatWorkoutDiagnostics(launch(f).read());
  const order = ['Previous run 2 details:', 'START_SET', 'Previous run 1 details:', 'DISCARD_WORKOUT', 'Current run'];
  const positions = order.map(label => text.indexOf(label));
  assert.ok(positions.every(position => position >= 0), text);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test('a full report with three previous runs stays below 16 KiB and keeps every run', () => {
  const f = fixture();
  const log = launch(f);
  const huge = Number.MAX_SAFE_INTEGER;
  const context = { action: 'PREVIOUS_EXERCISE', screen: 'SESSION', state: 'ACTIVE_SET', phase: 'VIBRATION', widgets: 500, modal: true, overview: true, preparation: true, imagesEnabled: true, request: 'GET_WORKOUT_CURRENT' };
  const events = Array.from({ length: 12 }, (_, at) => ({ at, code: CODES.IMAGE_UNAVAILABLE, context, memory: { appUsed: huge, appPeak: huge, systemUsed: huge, systemTotal: huge } }));
  const details = { lastAction: { at: 1, context }, lastMemory: { at: 1, memory: { appUsed: huge } } };
  assert.equal(log.replace({ version: 1, events, details, previousRuns: [1, 2, 3].map(() => ({ events, details })) }), true);
  const report = log.read();
  assert.ok(JSON.stringify(report).length <= 16 * 1024);
  assert.equal(report.previousRuns.length, 3);
  assert.ok(report.previousRuns.every(run => run.details.lastAction && run.events.length > 0));
});

function sendHarness(file, instanceKey) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const start = source.indexOf('function send(');
  const f = fixture();
  const diagnostics = launch(f);
  diagnostics.storage = f.storage;
  const env = {
    isTearingDown: false,
    [instanceKey]: { request: () => Promise.resolve({ type: MESSAGE_TYPES.WORKOUT_CURRENT_DATA, payload: {} }) },
    MESSAGE_TYPES, workoutDiagnostics: diagnostics, WORKOUT_DIAGNOSTIC_CODES: CODES, phoneFailureReason,
    normalizeWorkoutDiagnosticsEnabled: value => value === true,
    createMessage: value => value,
    withRequestTimeout: value => value,
    PHONE_REQUEST_TIMEOUT_MS: 1_000,
    Promise, Error,
  };
  vm.createContext(env);
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), env);
  return { env, diagnostics };
}

for (const [name, file, instanceKey] of [
  ['Companion', '../page/common/index.js', 'pageInstance'],
  ['Workout', '../data-widget/common/index.js', 'widgetInstance'],
]) {
  test(`${name} records each phone reply with its request name`, async () => {
    const { env, diagnostics } = sendHarness(file, instanceKey);
    await env.send(MESSAGE_TYPES.GET_WORKOUT_CURRENT);
    const last = diagnostics.read().events.at(-1);
    assert.equal(last.code, CODES.PHONE_REPLY);
    assert.equal(last.context.request, MESSAGE_TYPES.GET_WORKOUT_CURRENT);
    assert.ok(last.memory);
  });
}

for (const [name, file, instanceKey] of [
  ['Companion', '../page/common/index.js', 'pageInstance'],
  ['Workout', '../data-widget/common/index.js', 'widgetInstance'],
]) {
  test(`${name} persists each phone request before its reply can arrive`, async () => {
    const { env, diagnostics } = sendHarness(file, instanceKey);
    let persistedAtRequest = null;
    env[instanceKey].request = () => {
      persistedAtRequest = createWorkoutDiagnostics(diagnostics.storage).read().events.at(-1);
      return Promise.resolve({ type: MESSAGE_TYPES.SYNC_WORKOUT_SETS_RESULT, payload: {} });
    };
    await env.send(MESSAGE_TYPES.SYNC_WORKOUT_SETS, { sets: [] });
    assert.equal(persistedAtRequest.code, CODES.PHONE_REQUEST);
    assert.equal(persistedAtRequest.context.request, MESSAGE_TYPES.SYNC_WORKOUT_SETS);
    assert.ok(persistedAtRequest.memory);
    assert.deepEqual(diagnostics.read().events.slice(-2).map(event => event.code), [CODES.PHONE_REQUEST, CODES.PHONE_REPLY]);
  });
}

test('a phone request is written at once even when other events are batched', () => {
  const f = fixture();
  let pending = 0;
  const log = createWorkoutDiagnostics(f.storage, f.now, f.sample, {
    flushDelayMs: 250,
    setTimeout: () => ++pending,
    clearTimeout: () => {},
  });
  log.setEnabled(true);
  log.record(CODES.BOOT);
  log.record(CODES.PHONE_REQUEST, { request: MESSAGE_TYPES.GET_WORKOUT_CURRENT });
  const persisted = createWorkoutDiagnostics(f.storage).read().events.at(-1);
  assert.equal(persisted.code, CODES.PHONE_REQUEST);
  assert.equal(persisted.context.request, MESSAGE_TYPES.GET_WORKOUT_CURRENT);
});

for (const [name, file, instanceKey] of [
  ['Companion', '../page/common/index.js', 'pageInstance'],
  ['Workout', '../data-widget/common/index.js', 'widgetInstance'],
]) {
  test(`${name} records why a phone request failed`, async () => {
    const { env, diagnostics } = sendHarness(file, instanceKey);
    const timeout = Object.assign(new Error('Phone request timeout'), { code: 'NETWORK' });
    env[instanceKey].request = () => Promise.reject(timeout);
    await assert.rejects(env.send(MESSAGE_TYPES.SYNC_WORKOUT_SETS, { sets: [] }), /timeout/);
    env[instanceKey].request = () => Promise.resolve({ type: MESSAGE_TYPES.ERROR, payload: { code: 'API_FAILED', message: 'private detail' } });
    await assert.rejects(env.send(MESSAGE_TYPES.START_WORKOUT, {}), /private detail/);
    const failures = diagnostics.read().events.filter((event) => event.code === CODES.PHONE_FAILED).map((event) => event.context);
    assert.deepEqual(failures.map(({ request, failure }) => [request, failure]), [
      ['SYNC_WORKOUT_SETS', 'TIMEOUT'],
      ['START_WORKOUT', 'API_FAILED'],
    ]);
    assert.doesNotMatch(JSON.stringify(diagnostics.read()), /private detail/);
    assert.match(formatWorkoutDiagnostics(diagnostics.read()), /PHONE_FAILED .*request SYNC_WORKOUT_SETS failure TIMEOUT/);
  });
}
