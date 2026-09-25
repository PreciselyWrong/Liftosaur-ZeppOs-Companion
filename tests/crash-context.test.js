import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as diagnostics from '../shared/workout-diagnostics.js';
const { createWorkoutDiagnostics, formatWorkoutDiagnostics, WORKOUT_DIAGNOSTICS_KEY } = diagnostics;

function fixture() {
  const values = new Map();
  let writes = 0;
  let now = 1000;
  const storage = { getItem: key => values.get(key), setItem: (key, value) => { writes++; values.set(key, value); }, removeItem: key => values.delete(key) };
  return { storage, values, get writes() { return writes; }, now: () => now, advance(ms) { now += ms; } };
}
const runtime = { product: 'workout', revision: 'crash-trace-1', appVersion: '0.5.11', firmware: '7.23.0.1', os: '4.0', api: '4.0', deviceSource: 123, width: 480, height: 480, screenShape: 1 };

test('abrupt restart retains last action and runtime outside the rolling phase events', () => {
  const f = fixture();
  const log = createWorkoutDiagnostics(f.storage, f.now, () => null, { runtime: () => runtime, context: () => ({ screen: 'SESSION', state: 'REST', widgets: 35 }) });
  log.setEnabled(true);
  log.record('BOOT');
  log.record('ACTION_TAP', { action: 'START_SET' });
  for (let i = 0; i < 20; i++) log.record('RENDER_END');
  log.record('CLEAR_START');
  const restart = createWorkoutDiagnostics(f.storage, f.now, () => null, { runtime: () => ({ ...runtime, firmware: '8.0' }) });
  restart.record('BOOT');
  const report = restart.read();
  assert.equal(report.previousEvents.at(-1).code, 'CLEAR_START');
  assert.equal(report.previousDetails.lastAction.context.action, 'START_SET');
  assert.equal(report.previousDetails.runtime.firmware, '7.23.0.1');
  assert.equal(report.details.runtime.firmware, '8.0');
  assert.equal(report.previousEvents.length, 12);
  const phone = createWorkoutDiagnostics(f.storage);
  assert.equal(phone.replace(report), true);
  assert.match(formatWorkoutDiagnostics(phone.read()), /START_SET/);
  assert.match(formatWorkoutDiagnostics(phone.read()), /7\.23\.0\.1/);
});

test('startup-only reopenings preserve earlier incident evidence; subsequent user action replaces it', () => {
  const f = fixture();
  const log = createWorkoutDiagnostics(f.storage, f.now);
  log.setEnabled(true);
  log.record('ACTION_TAP', { action: 'COMPLETE_SET' });
  log.record('BOOT');
  log.record('BUILD');
  log.record('RENDER_END');
  log.record('PAUSE');
  log.record('RESUME');
  log.record('BOOT');
  assert.equal(log.read().previousDetails.lastAction.context.action, 'COMPLETE_SET');
  log.record('ACTION_TAP', { action: 'OPEN_INFO' });
  log.record('BOOT');
  assert.equal(log.read().previousDetails.lastAction.context.action, 'OPEN_INFO');
});

test('heartbeat and periodic memory probes remain bounded across fast UI ticks', () => {
  const f = fixture();
  let samples = 0;
  const log = createWorkoutDiagnostics(f.storage, f.now, () => { samples++; return { appUsed: 1024 }; });
  log.setEnabled(true);
  for (let i = 0; i < 2400; i++) { log.heartbeat(); f.advance(250); }
  assert.equal(samples, 20);
  assert.equal(f.writes, 41);
  assert.equal(log.read().events.length, 12);
  assert.equal(log.read().details.lastMemory.memory.appUsed, 1024);
});

test('disabled diagnostics never call context, runtime or memory providers', () => {
  const f = fixture();
  const forbidden = () => { assert.fail('provider invoked'); };
  const log = createWorkoutDiagnostics(f.storage, f.now, forbidden, { runtime: forbidden, context: forbidden });
  log.record('BOOT');
  log.heartbeat();
  assert.equal(f.writes, 0);
});

test('private data is removed from context and run details during phone transfer', () => {
  const f = fixture();
  const log = createWorkoutDiagnostics(f.storage, f.now);
  log.setEnabled(true);
  log.replace({ version: 1, events: [{ at: 1000, code: 'JS_ERROR', context: { action: 'api-key-secret', screen: 'private workout', errorClass: 'TypeError', phase: 'SCREEN', imageUrl: 'https://private' } }], details: { runtime: { ...runtime, uuid: 'private-id', firmware: 'api-key-secret' }, lastError: { at: 1000, code: 'JS_ERROR', context: { errorClass: 'TypeError', phase: 'SCREEN', message: 'private-message' } } } });
  const exported = formatWorkoutDiagnostics(log.read());
  assert.match(exported, /TypeError/);
  assert.match(exported, /SCREEN/);
  assert.doesNotMatch(JSON.stringify(log.read()) + exported, /private|api-key-secret|https/);
});

test('provider failures cannot prevent durable action capture and disable clears details', () => {
  const f = fixture();
  const fail = () => { throw new Error('unavailable'); };
  const log = createWorkoutDiagnostics(f.storage, f.now, fail, { runtime: fail, context: fail });
  log.setEnabled(true);
  assert.doesNotThrow(() => log.record('ACTION_TAP', { action: 'COMPLETE_SET' }));
  assert.equal(log.read().details.lastAction.context.action, 'COMPLETE_SET');
  log.setEnabled(false);
  assert.deepEqual(log.read(), { version: 1, events: [] });
  assert.equal(f.values.has(WORKOUT_DIAGNOSTICS_KEY), false);
});

test('runtime reader isolates unavailable APIs and never copies native identifiers', () => {
  const info = diagnostics.readWorkoutRuntimeInfo('workout', () => ({ version: { name: '0.5.11', code: 47 } }), { deviceSource: 123, width: 480, height: 480, uuid: 'private-id' }, () => ({ firmwareVersion: '7.23.0.1', osVersion: '4.0', minAPI: '4.0' }));
  assert.equal(info.appVersion, '0.5.11');
  assert.equal(info.firmware, '7.23.0.1');
  assert.equal(info.uuid, undefined);
  assert.equal(diagnostics.readWorkoutRuntimeInfo('workout', () => { throw Error(); }, {}, () => { throw Error(); }).product, 'workout');
});

test('first startup failure evidence survives the next boot before any user action', () => {
  const f = fixture();
  const first = createWorkoutDiagnostics(f.storage, f.now, () => null, { runtime: () => runtime });
  first.setEnabled(true);
  first.record('BOOT');
  first.record('BUILD');
  first.record('RENDER_START');
  first.record('REDRAW_START');
  const restarted = createWorkoutDiagnostics(f.storage, f.now);
  restarted.record('BOOT');
  assert.deepEqual(restarted.read().previousEvents.map(event => event.code), ['BOOT', 'BUILD', 'RENDER_START', 'REDRAW_START']);
  assert.equal(restarted.read().previousDetails.runtime.firmware, runtime.firmware);
});

test('synchronous phase errors keep their marker and rethrow the original error object', () => {
  const f = fixture();
  const log = createWorkoutDiagnostics(f.storage, f.now);
  log.setEnabled(true);
  log.record('REDRAW_START');
  const original = new TypeError('private details must not be exported');
  assert.throws(() => log.trace('REDRAW', () => { throw original; }), error => error === original);
  const events = log.read().events;
  assert.deepEqual(events.map(event => event.code), ['REDRAW_START', 'JS_ERROR']);
  assert.equal(events[1].context.errorClass, 'TypeError');
  assert.equal(events[1].context.phase, 'REDRAW');
  assert.doesNotMatch(JSON.stringify(log.read()), /private details/);
});

test('disabled synchronous traces run unchanged without diagnostics providers', () => {
  const f = fixture();
  const forbidden = () => { assert.fail('provider invoked'); };
  const log = createWorkoutDiagnostics(f.storage, f.now, forbidden, { runtime: forbidden, context: forbidden });
  const original = new Error('native callback');
  assert.throws(() => log.trace('ACTION', () => { throw original; }), error => error === original);
  assert.equal(f.writes, 0);
});

test('reenabling diagnostics refreshes runtime metadata for the new recording interval', () => {
  const f = fixture();
  let runtimeReads = 0;
  const log = createWorkoutDiagnostics(f.storage, f.now, () => null, {
    runtime: () => { runtimeReads++; return { ...runtime, firmware: runtimeReads === 1 ? '7.0' : '8.0' }; },
  });
  log.setEnabled(true);
  log.record('BOOT');
  log.setEnabled(false);
  log.setEnabled(true);
  log.record('BOOT');
  assert.equal(runtimeReads, 2);
  assert.equal(log.read().details.runtime.firmware, '8.0');
});

test('bounded report stays below 16 KiB after phone sanitization', () => {
  const f = fixture();
  const log = createWorkoutDiagnostics(f.storage, f.now);
  log.setEnabled(true);
  const context = { action: 'COMPLETE_SET', screen: 'SESSION', state: 'ACTIVE_SET', phase: 'REDRAW', widgets: 500, modal: true };
  const report = {
    version: 1,
    events: Array.from({ length: 12 }, (_, at) => ({ at, code: 'RENDER_END', context, memory: { appUsed: Number.MAX_SAFE_INTEGER, appPeak: Number.MAX_SAFE_INTEGER, systemUsed: Number.MAX_SAFE_INTEGER, systemTotal: Number.MAX_SAFE_INTEGER } })),
    previousEvents: Array.from({ length: 12 }, (_, at) => ({ at, code: 'CLEAR_START', context })),
    details: { runtime, lastAction: { at: 1000, context }, lastError: { at: 1000, context: { errorClass: 'TypeError', phase: 'SCREEN' } }, lastMemory: { at: 1000, memory: { appUsed: 1024 } } },
    previousDetails: { runtime, lastAction: { at: 1000, context } },
  };
  assert.equal(log.replace(report), true);
  assert.ok(JSON.stringify(log.read()).length < 16 * 1024);
});

test('failed memory probes are throttled across repeated redraws', () => {
  const f = fixture();
  let samples = 0;
  const log = createWorkoutDiagnostics(f.storage, f.now, () => { samples++; throw new Error('unsupported'); });
  log.setEnabled(true);
  for (let index = 0; index < 500; index++) log.record('RENDER_END');
  assert.equal(samples, 1);
  f.advance(30_000);
  log.record('RENDER_END');
  assert.equal(samples, 2);
  assert.equal(log.read().events.at(-1).code, 'RENDER_END');
});


test('turning diagnostics off clears persisted content when removal is unavailable', () => {
  const f = fixture();
  f.storage.removeItem = () => { throw new Error('remove unavailable'); };
  const log = createWorkoutDiagnostics(f.storage, f.now);
  log.setEnabled(true);
  log.record('ACTION_TAP', { action: 'COMPLETE_SET' });
  log.setEnabled(false);
  assert.deepEqual(JSON.parse(f.storage.getItem(WORKOUT_DIAGNOSTICS_KEY)), { version: 1, events: [] });
  log.setEnabled(true);
  assert.deepEqual(createWorkoutDiagnostics(f.storage).read(), { version: 1, events: [] });
});


for (const product of ['companion', 'workout']) {
  test(`${product} renderer captures real UI context and native runtime only after consent`, () => {
    const source = fs.readFileSync(`${product === 'companion' ? 'page' : 'data-widget'}/common/index.js`, 'utf8');
    const start = source.indexOf('const workoutDiagnostics =');
    const end = source.indexOf(product === 'companion' ? 'let controllerUiDirty' : 'let timeSensor', start);
    assert.ok(start >= 0 && end > start);
    const f = fixture();
    const nativeCalls = [];
    const view = () => ({ state: 'REST' });
    const env = {
      createWorkoutDiagnostics, readWorkoutRuntimeInfo: diagnostics.readWorkoutRuntimeInfo,
      readWorkoutMemory: diagnostics.readWorkoutMemory, WORKOUT_DIAGNOSTIC_CODES: diagnostics.WORKOUT_DIAGNOSTIC_CODES,
      deviceStorage: f.storage, deviceInfo: { deviceSource: 123, width: 480, height: 480, screenShape: 1 },
      appApi: { getPackageInfo: () => { nativeCalls.push('package'); return { version: { name: '0.5.12', code: 48 } }; } },
      getSystemInfo: () => { nativeCalls.push('system'); return { firmwareVersion: '7.23.0.1', osVersion: '4.0', minAPI: '4.0' }; },
      screen: 'SESSION', session: { view }, workoutController: { view }, activeWidgets: Array(36).fill({}),
      isNotesModalOpen: true, isSyncDetailsOpen: false, isWorkoutTimerControlsOpen: false, isEditLastSetOpen: false,
      isOverviewOpen: false, restPresentation: { isPrepared: true }, accountSettings: { exerciseImages: true },
      normalizeExerciseImages: value => value === true,
    };
    vm.runInNewContext(`${source.slice(start, end)}; this.recorder = workoutDiagnostics;`, env);
    env.recorder.record('BOOT');
    assert.deepEqual(nativeCalls, []);
    env.recorder.setEnabled(true);
    env.recorder.record('BOOT');
    const report = JSON.parse(JSON.stringify(env.recorder.read()));
    assert.deepEqual(nativeCalls, ['package', 'system']);
    assert.equal(report.details.runtime.product, product);
    assert.equal(report.details.runtime.appVersion, '0.5.12');
    assert.deepEqual(report.events[0].context, {
      screen: 'SESSION', state: 'REST', widgets: 36, modal: true,
      overview: false, preparation: true, imagesEnabled: true,
    });
  });
}
