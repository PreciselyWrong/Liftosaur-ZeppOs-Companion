import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../data-widget/common/index.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

function extractLifecycle(name) {
  const start = source.indexOf(`    ${name}() {`);
  assert.ok(start >= 0, `${name} exists`);
  return source.slice(start, source.indexOf('\n    },', start) + 6);
}

function createClockHarness(initialState = 'ACTIVE_SET') {
  let timerId = 0;
  const timers = new Map();
  const view = { state: initialState, rest: null, elapsedSeconds: 1 };
  const env = {
    isTearingDown: false, isPaused: false, hasBuilt: false, isDispatchingClick: false,
    isEditLastSetOpen: false, isSyncDetailsOpen: false, isWorkoutTimerControlsOpen: false,
    discardConfirmationRequested: false, phoneRequiredReason: null, isNotesModalOpen: false,
    isOverviewOpen: false, isRestMinimized: false, liveWidgets: {}, renderTimer: null,
    screen: 'SESSION', EXTENSION_SCREENS: { SESSION: 'SESSION', HOME: 'HOME' },
    SESSION_STATES: { ACTIVE_SET: 'ACTIVE_SET', REST: 'REST', READY: 'READY', NO_PLAN: 'NO_PLAN', FINISHED: 'FINISHED' },
    controllerUiDirty: false, lastRenderedState: null, lastRenderedSecond: null,
    syncWarning: null, dayPlan: null, preparationImageUrl: null, isBusy: false,
    restoredDisplaySettingsPending: false, terminalActionPending: null, initialLoadPending: false,
    lifecycleGeneration: 0, lastPendingSyncRetryAt: 0,
    W: 480, H: 480, THEME: { bg: 0 }, widget: { FILL_RECT: 1 },
    workoutDiagnostics: { record() {} }, WORKOUT_DIAGNOSTIC_CODES: {},
    nativePauseReconciler: { loseFocus() {} }, console: { log() {} },
    workoutController: {
      pollCurrent: () => Promise.resolve(false), requestRefresh: () => Promise.resolve(false),
      advanceTimedSet() {}, view: () => view, sync: () => ({}), plan: () => ({}), persist() {},
    },
    setInterval(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearInterval(id) { timers.delete(id); }, clearTimeout() {},
    updateClock() {}, refreshSportMetrics() {}, retryPendingWrites() {}, updateTimedSetScreen() {},
    updateSyncWarning() {}, updatePreparedRestVisuals() {}, handlePollFailure() {},
    clearWidgets() {}, addRawWidget() {}, renderClock() {}, redraw() {}, syncRestPresentation() {},
    renderRestScreen() {}, renderActiveSetScreen() {}, renderHomeScreen() {}, applyDisplayHold() {},
    stopRestBezelAnimation() {}, resetConnectionRetry() {}, resetDisplayHold() {}, stopVibration() {},
    loadDisplaySettings: () => Promise.resolve(),
    restAlertTracker: { checkTick: () => ({ shouldAlert: false }), checkResume: () => ({ shouldAlert: false }) },
  };
  const constants = source.match(/const TICK_FAST_MS = \d+;\s*const TICK_SLOW_MS = \d+;/)[0];
  const functions = ['markControllerUiDirty', 'cancelScheduledRender', 'consumeControllerUiChange', 'renderUI', 'renderScreen', 'tick'].map(extractFunction).join('\n');
  const clockFunctions = source.slice(source.indexOf('function startClock('), source.indexOf('\nDataWidget('));
  const lifecycle = ['build', 'onResume', 'onPause'].map(extractLifecycle).join(',\n');
  const api = new Function('env', `with (env) {
    ${constants}
    let clockTimer = null;
    let clockInterval = null;
    ${functions}
    ${clockFunctions}
    return { ${lifecycle}, markControllerUiDirty, tick, renderUI };
  }`)(env);
  function setState(state) {
    view.state = state;
    view.rest = state === 'REST' ? { remaining: 60 } : null;
  }
  setState(initialState);
  return { api, env, setState, timers, intervals: () => [...timers.values()].map(timer => timer.ms) };
}

test('controller redraw changes the rest cadence and returns to normal after rest', () => {
  const h = createClockHarness();
  h.api.build();
  assert.deepEqual(h.intervals(), [1000]);
  h.setState('REST');
  h.api.markControllerUiDirty();
  h.api.tick();
  assert.deepEqual(h.intervals(), [250]);
  const runningTimer = [...h.timers.keys()];
  h.api.renderUI();
  h.api.tick();
  assert.deepEqual([...h.timers.keys()], runningTimer, 'unchanged state keeps the existing timer');
  h.setState('ACTIVE_SET');
  h.api.markControllerUiDirty();
  h.api.tick();
  assert.deepEqual(h.intervals(), [1000]);
});

test('restored rest starts at the fast cadence on build', () => {
  const h = createClockHarness('REST');
  h.api.build();
  assert.deepEqual(h.intervals(), [250]);
  h.api.tick();
  assert.deepEqual(h.intervals(), [250]);
});

test('pause stops the clock and resume chooses the current rest cadence', () => {
  const h = createClockHarness('REST');
  h.api.build();
  h.api.onPause();
  h.api.renderUI();
  h.api.tick();
  assert.deepEqual(h.intervals(), [], 'late redraws and ticks cannot restart a paused clock');
  h.api.onResume();
  assert.deepEqual(h.intervals(), [250]);
  h.api.tick();
  assert.deepEqual(h.intervals(), [250]);
});

test('a state change first observed by tick also updates the cadence', () => {
  const h = createClockHarness();
  h.api.build();
  h.setState('REST');
  h.api.tick();
  assert.deepEqual(h.intervals(), [250]);
});

test('leaving the session screen restores the normal cadence', () => {
  const h = createClockHarness('REST');
  h.api.build();
  h.env.screen = 'HOME';
  h.api.renderUI();
  assert.deepEqual(h.intervals(), [1000]);
  h.env.screen = 'SESSION';
  h.api.renderUI();
  assert.deepEqual(h.intervals(), [250]);
});
