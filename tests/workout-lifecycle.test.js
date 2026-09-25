import { stopRestPulseAnimation } from '../shared/rest-visual.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createWorkoutDiagnostics, WORKOUT_DIAGNOSTIC_CODES } from '../shared/workout-diagnostics.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';
import { SESSION_STATES } from '../shared/workout-session.js';
import { EXTENSION_SCREENS } from '../shared/workout-extension-nav.js';

const source = readFileSync(new URL('../data-widget/common/index.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const calls = [];
  const timers = new Map();
  const values = new Map();
  let nextTimer = 0;
  const diagnostics = createWorkoutDiagnostics({
    getItem: key => values.get(key),
    setItem: (key, value) => { calls.push('storage'); values.set(key, value); },
    removeItem: key => values.delete(key),
  });
  diagnostics.setEnabled(true);
  const controller = {
    persist: () => calls.push('persist'),
    dispose: () => calls.push('dispose'),
    configureTimedSets: () => calls.push('configure'),
    retryPendingWrites: async () => false,
    requestRefresh: async () => false,
    view: () => ({ state: SESSION_STATES.ACTIVE_SET }),
    status: () => ({ code: 'idle' }),
    plan: () => ({}),
  };
  const env = {
    stopRestPulseAnimation, restHaloWidgets: [], restPulseAnimHandles: [], restPulseAttempted: false,
    prop: { ANIM_STATUS: 1, ALPHA: 2 }, anim_status: { STOP: 3 },
    hasBuilt: true, isTearingDown: false, isPaused: false, lifecycleGeneration: 0,
    controllerUiDirty: false, renderScheduled: false, renderTimer: null,
    connectionRetryTimer: null, connectionRetryAttempt: 0,
    clockTimer: null, vibrationTimer: null, vibrator: null,
    isDispatchingClick: false, workoutDiagnostics: diagnostics, WORKOUT_DIAGNOSTIC_CODES,
    workoutController: controller, accountSettings: null, isNotesModalOpen: false,
    exerciseImages: null, widgetInstance: {}, nativePauseReconciler: { loseFocus() {} },
    screen: EXTENSION_SCREENS.SESSION, EXTENSION_SCREENS, SESSION_STATES, MESSAGE_TYPES,
    preparationImageUrl: null, activeWidgets: [{}], liveWidgets: {},
    W: 480, H: 480, THEME: { bg: 0 }, widget: { FILL_RECT: 1, BUTTON: 2 },
    DEFAULT_SCREEN_ON_SECONDS: 120, ALWAYS_SCREEN_ON_MS: 1800000,
    PHONE_REQUEST_TIMEOUT_MS: 1000,
    normalizeWorkoutDiagnosticsEnabled: value => value === true,
    normalizeExerciseImages: value => value === true,
    normalizeGetReadySeconds: value => value,
    send: async () => ({ payload: { workoutDiagnosticsEnabled: true } }),
    consumeControllerUiChange: () => { env.controllerUiDirty = false; },
    updateSyncWarning() {}, renderClock() {}, renderScreen() {},
    deleteWidget: () => calls.push('deleteWidget'),
    createWidget: () => { calls.push('createWidget'); return {}; },
    redraw: () => calls.push('redraw'),
    setPageBrightTime: () => calls.push('display'),
    pauseDropWristScreenOff: () => calls.push('display'),
    pausePalmScreenOff: () => calls.push('display'),
    resetPageBrightTime() {}, resetDropWristScreenOff() {}, resetPalmScreenOff() {},
    refreshSportMetrics() {}, startClock() {}, retryPendingWrites() {},
    stopClock() {}, stopVibration() {}, logRecoverableError() {}, handlePollFailure() {},
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    console: { log() {} }, Date,
  };
  vm.createContext(env);
  const functions = ['loadDisplaySettings', 'selectedScreenOnDuration', 'applyDisplayHold',
    'stopRestBezelAnimation', 'resetDisplayHold', 'scheduleRenderUI', 'renderUI', 'clearWidgets', 'addRawWidget',
    'addActionWidget', 'resetConnectionRetry', 'syncCompletedSets'];
  if (source.includes('function cancelScheduledRender(')) functions.push('cancelScheduledRender');
  vm.runInContext(functions.map(extract).join('\n'), env);
  const lifecycle = source.slice(source.lastIndexOf('    onResume() {'), source.lastIndexOf('\n  })'));
  vm.runInContext(`globalThis.lifecycle = ({${lifecycle}});`, env);
  calls.length = 0;
  return { env, calls, timers, diagnostics, values };
}

test('a settings reply after destruction cannot touch native APIs or diagnostics storage', async () => {
  const { env, calls } = fixture();
  const reply = deferred();
  env.send = () => reply.promise;
  const request = env.loadDisplaySettings();
  env.lifecycle.onDestroy();
  calls.length = 0;
  reply.resolve({ payload: { workoutDiagnosticsEnabled: true } });
  await request;
  assert.deepEqual(calls, []);
});

test('pause cancels queued drawing and rejects its stale callback after resume', async () => {
  const { env, calls, timers } = fixture();
  env.scheduleRenderUI();
  const stale = [...timers.values()][0];
  env.lifecycle.onPause();
  assert.equal(timers.size, 0);
  calls.length = 0;
  stale();
  env.renderUI();
  assert.deepEqual(calls, []);
  env.lifecycle.onResume();
  await Promise.resolve();
  calls.length = 0;
  stale();
  assert.deepEqual(calls, []);
  env.scheduleRenderUI();
  [...timers.values()].at(-1)();
  assert.equal(calls.filter(call => call === 'redraw').length, 1);
});

test('settings received during pause cannot reapply the display hold', async () => {
  const { env, calls } = fixture();
  const reply = deferred();
  env.send = () => reply.promise;
  const request = env.loadDisplaySettings();
  env.lifecycle.onPause();
  calls.length = 0;
  reply.resolve({ payload: { workoutDiagnosticsEnabled: true } });
  await request;
  assert.equal(calls.includes('display'), false);
});

test('navigation records action and render boundaries without deleting the clicked control', () => {
  const { env, calls, timers, diagnostics } = fixture();
  let props;
  env.createWidget = (_, value) => { props = value; return {}; };
  env.addActionWidget({ click_func: () => env.renderUI() });
  props.click_func();
  assert.equal(calls.includes('deleteWidget'), false);
  [...timers.values()][0]();
  assert.deepEqual(diagnostics.read().events.map(event => event.code),
    ['ACTION_TAP', 'ACTION_DONE', 'RENDER_START', 'CLEAR_START', 'CLEAR_END', 'SCREEN_START', 'SCREEN_END', 'REDRAW_START', 'REDRAW_END', 'RENDER_END']);
});

test('Workout action metadata is semantic, persisted, and removed before native widget creation', () => {
  const { env, diagnostics } = fixture();
  let nativeProps;
  env.createWidget = (_type, props) => { nativeProps = props; return {}; };
  env.addActionWidget({ diagnosticAction: 'START_SET', click_func() {} });
  assert.equal(Object.hasOwn(nativeProps, 'diagnosticAction'), false);
  nativeProps.click_func();
  assert.equal(diagnostics.read().details.lastAction.context.action, 'START_SET');
});

test('destroy abandons controller work without saving or clearing the local journal', () => {
  const { env, calls } = fixture();
  env.scheduleRenderUI();
  env.lifecycle.onDestroy();
  assert.deepEqual(calls, ['dispose']);
});

test('late set sync success and failure cannot write diagnostics after destruction', async () => {
  for (const success of [true, false]) {
    const { env, calls } = fixture();
    const reply = deferred();
    env.workoutController.syncSets = () => reply.promise;
    const request = env.syncCompletedSets();
    env.lifecycle.onDestroy();
    calls.length = 0;
    if (success) reply.resolve(true);
    else reply.reject(new Error('Phone unreachable'));
    await request;
    assert.deepEqual(calls, []);
  }
});

test('an already queued vibration timeout cannot call the sensor after pause or destroy', () => {
  for (const mode of ['Rest', 'Light']) {
    for (const lifecycle of ['onPause', 'onDestroy']) {
      const { env, calls, timers } = fixture();
      env.Vibrator = class {
        start() { calls.push('vibrator.start'); }
        stop() { calls.push('vibrator.stop'); }
      };
      env.setRestVibrationMode = () => {};
      env.setLightVibrationMode = () => {};
      vm.runInContext([extract('stopVibration'), extract(`trigger${mode}Vibration`)].join('\n'), env);
      env[`trigger${mode}Vibration`]();
      const stale = [...timers.values()][0];
      env.lifecycle[lifecycle]();
      calls.length = 0;
      stale();
      assert.deepEqual(calls, []);
    }
  }
});

test('late phone success or error cannot escape the destroyed settings page', async () => {
  for (const success of [true, false]) {
    const { env, calls } = fixture();
    const reply = deferred();
    env.widgetInstance = { request: () => reply.promise };
    env.createMessage = value => value;
    env.withRequestTimeout = value => value;
    vm.runInContext([extract('send'), extract('failRequest')].join('\n'), env);
    const request = env.loadDisplaySettings().catch(env.failRequest);
    env.lifecycle.onDestroy();
    calls.length = 0;
    if (success) reply.resolve({ payload: { workoutDiagnosticsEnabled: true } });
    else reply.reject(new Error('Phone disconnected'));
    await request;
    await assert.rejects(env.send(MESSAGE_TYPES.GET_SETTINGS), /closed/);
    assert.deepEqual(calls, []);
  }
});

test('a duration sample from the previous focus cannot pause the resumed session', async () => {
  const { env, calls } = fixture();
  let sample;
  env.SPORT_METRICS_INTERVAL_MS = 3000;
  env.lastSportMetricsSampleAt = 0;
  env.getSportData = (_, callback) => { sample = callback; };
  env.parseSportDataResult = () => { calls.push('parse'); return { ok: true, value: 1 }; };
  env.parseDurationToSeconds = value => value;
  env.nativePauseReconciler.sample = () => [];
  env.applyNativePauseActions = () => calls.push('native pause');
  vm.runInContext(extract('refreshSportMetrics'), env);
  env.refreshSportMetrics();
  const stale = sample;
  env.lifecycle.onPause();
  env.lifecycle.onResume();
  await Promise.resolve();
  calls.length = 0;
  stale({});
  assert.deepEqual(calls, []);
});

test('late finish and discard results cannot draw, record or clear after destruction', async () => {
  for (const [action, method] of [
    ['submitWorkout', 'finishWorkoutRemote'], ['handleDiscardWorkout', 'discardWorkoutRemote'],
  ]) {
    for (const success of [true, false]) {
      const { env, calls } = fixture();
      const reply = deferred();
      env.finishState = null;
      env.workoutController[method] = () => reply.promise;
      env.returnAfterDiscard = () => calls.push('clear');
      vm.runInContext([extract(action), extract('beginRequest'), extract('failRequest')].join('\n'), env);
      env[action]();
      env.lifecycle.onDestroy();
      calls.length = 0;
      if (success) reply.resolve({ success: true });
      else reply.reject(new Error('Phone disconnected'));
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(calls, []);
    }
  }
});

test('pause stops native rest breathing before deletion; destroy does not call widgets', () => {
  const { env, calls } = fixture();
  env.restPulseAnimHandles = [{ id: 0, widget: { setProperty: (key) => calls.push(`pulse:${key}`) } }];
  env.lifecycle.onPause();
  assert.deepEqual(calls.filter(call => call.startsWith('pulse:')), ['pulse:1', 'pulse:2']);
  assert.equal(env.restPulseAnimHandles.length, 0);
  env.restPulseAnimHandles = [{ id: 1, widget: { setProperty: () => calls.push('unexpected-native') } }];
  calls.length = 0;
  env.lifecycle.onDestroy();
  assert.ok(!calls.includes('unexpected-native'));
  assert.equal(env.restPulseAnimHandles.length, 0);
});
