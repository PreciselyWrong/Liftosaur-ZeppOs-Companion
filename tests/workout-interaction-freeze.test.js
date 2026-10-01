import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createWorkoutDiagnostics, WORKOUT_DIAGNOSTIC_CODES as C, WORKOUT_DIAGNOSTICS_KEY } from '../shared/workout-diagnostics.js';
import { createWorkoutController } from '../shared/workout-controller.js';
import { SESSION_STATES } from '../shared/workout-session.js';
import { createSessionStore, createMemoryStorageAdapter } from '../shared/session-storage.js';

const sources = Object.fromEntries(['workout', 'companion'].map(product => [product,
  readFileSync(new URL(`../${product === 'workout' ? 'data-widget' : 'page'}/common/index.js`, import.meta.url), 'utf8'),
]));
function extract(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function fakeTimers() {
  let nextId = 0;
  const pending = new Map();
  return {
    pending,
    setTimeout(callback, delay) { const id = ++nextId; pending.set(id, { callback, delay }); return id; },
    clearTimeout(id) { pending.delete(id); },
    run(delay) {
      for (const [id, entry] of [...pending]) {
        if (entry.delay !== delay) continue;
        pending.delete(id);
        entry.callback();
      }
    },
  };
}
function diagnosticFixture() {
  const timers = fakeTimers();
  const values = new Map();
  const writes = [];
  const storage = {
    getItem: key => values.get(key),
    setItem: (key, value) => { writes.push(key); values.set(key, value); },
    removeItem: key => values.delete(key),
  };
  const diagnostics = createWorkoutDiagnostics(storage, () => 1000, () => null, { ...timers, flushDelayMs: 250 });
  diagnostics.setEnabled(true);
  writes.length = 0;
  return { diagnostics, timers, values, writes, storage };
}
function renderer(product, setsCount = 2) {
  const source = sources[product];
  const timers = fakeTimers();
  const values = new Map();
  const calls = [];
  const nativeButtons = [];
  let inClick = false;
  let contextReads = 0;
  let finishRequests = 0;
  const sessionStore = createSessionStore(createMemoryStorageAdapter());
  const store = { ...sessionStore, save(data) { calls.push('journal'); return sessionStore.save(data); } };
  const controller = createWorkoutController({
    store, now: () => 1000,
    onChange() { env.controllerUiDirty = true; },
  });
  const env = {
    isTearingDown: false, isPaused: false, hasBuilt: true, lifecycleGeneration: 0,
    isDispatchingClick: false, controllerUiDirty: false, renderTimer: null, clockTimer: null,
    activeWidgets: [], liveWidgets: {}, restHaloWidgets: [], preparationImageUrl: null,
    isNotesModalOpen: false, isSyncDetailsOpen: false, isWorkoutTimerControlsOpen: false,
    isEditLastSetOpen: false, isOverviewOpen: false, restPresentation: null, accountSettings: {},
    screen: 'SESSION', WORKOUT_DIAGNOSTIC_CODES: C, SESSION_STATES,
    widget: { BUTTON: 1, FILL_RECT: 2 }, W: 466, H: 466, THEME: {},
    px: n => n, font: () => 20, controls: {}, ACTIVE_SET_ACTION_LAYOUT: {},
    actionText: 'Done', restStatusColor: () => 0, darkenColor: () => 0,
    updateSyncWarning() {}, updateControllerStatus() {}, renderClock() {}, startClock() {},
    clearFlash() {}, stopRestBezelAnimation() {}, renderDemoBadge() {}, hideModalControls() {}, destroyModalControls() {},
    consumeControllerUiChange() { env.controllerUiDirty = false; },
    renderScreen() { calls.push(`screen:${controller.view().state}`); },
    redraw() { calls.push('redraw'); },
    createWidget(_type, props) { const handle = { props }; if (props.click_func) nativeButtons.push(handle); return handle; },
    deleteWidget() { calls.push(inClick ? 'delete-in-click' : 'delete'); },
    ...timers,
    diagnosticsStorage: {
      getItem: key => values.get(key),
      setItem(key, value) { calls.push('diagnostic-write'); values.set(key, value); },
      removeItem: key => values.delete(key),
    },
    appApi: {}, deviceInfo: {}, getSystemInfo() {}, readWorkoutMemory: () => null,
    readWorkoutRuntimeInfo: () => ({ product, revision: 'crash-trace-1' }),
    normalizeExerciseImages: () => false,
    createWorkoutDiagnostics(storage, now, sample, providers) {
      const context = providers.context;
      return createWorkoutDiagnostics(storage, () => 1000, sample, {
        ...providers, ...timers, context() { contextReads++; return context(); },
      });
    },
    workoutController: controller, session: controller, directSync: { mode: 'LEGACY' },
    checkRequiredPhoneInput: () => null, phoneRequiredReason: null, syncWarning: null,
    restAlertTracker: { reset() {} }, nativePauseReconciler: { reset() {} },
    setRestPrepared() {}, stopVibration() {},
    syncCompletedSets() { calls.push('sync'); },
    synchronizeDirectSets() { calls.push('sync'); return new Promise(() => {}); },
    submitWorkout() { finishRequests++; calls.push('finish'); },
    ensureDirectWorkoutStarted: () => new Promise(() => {}),
  };
  vm.createContext(env);
  const configStart = source.indexOf('const workoutDiagnostics = createWorkoutDiagnostics(');
  const configEnd = source.indexOf('\n});', configStart) + '\n});'.length;
  vm.runInContext(source.slice(configStart, configEnd).replace('const workoutDiagnostics', 'globalThis.workoutDiagnostics'), env);
  const functions = ['addRawWidget', 'addActionWidget', 'clearWidgets', 'scheduleRenderUI', 'cancelScheduledRender', 'renderUI'];
  if (product === 'companion') functions.push('wrapNativeAction', 'completeCurrentSet', 'persistAndRender', 'handleStartWorkout');
  vm.runInContext(functions.map(name => extract(source, name)).join('\n'), env);
  const active = extract(source, 'renderActiveSetScreen');
  const propsStart = active.indexOf("addLiveButton('actionButton', {") + "addLiveButton('actionButton', ".length;
  const propsEnd = active.indexOf('\n  });', propsStart) + '\n  }'.length;
  vm.runInContext(`globalThis.setProps = view => {
    const isResting = view.state === SESSION_STATES.REST;
    const set = (isResting && view.pending?.set) || view.currentSet;
    return (${active.slice(propsStart, propsEnd)});
  };`, env);
  const ready = extract(source, 'renderReadyScreen');
  const readyStart = ready.lastIndexOf('addWidget(widget.BUTTON, {') + 'addWidget(widget.BUTTON, '.length;
  const readyEnd = ready.indexOf('\n  });', readyStart) + '\n  }'.length;
  vm.runInContext(`globalThis.startProps = view => (${ready.slice(readyStart, readyEnd)});`, env);
  controller.loadPlan({
    source: 'WORKOUT_API', programId: 'program-1', startTime: 1000, unit: 'kg',
    exercises: [{ index: 0, entryId: 'entry-1', name: 'Bench Press', sets: Array.from({ length: setsCount }, (_, index) => ({
      index: index + 1, setId: `set-${index + 1}`, reps: 5, targetReps: 5, weight: 20, targetWeight: 20, restSeconds: 90,
    })) }],
  });
  env.workoutDiagnostics.setEnabled(true);
  calls.length = 0;
  return {
    env, controller, calls, timers, values, store,
    get contextReads() { return contextReads; }, get finishRequests() { return finishRequests; },
    button(props) { env.addActionWidget(props); return nativeButtons.at(-1); },
    tap(button) { inClick = true; try { button.props.click_func(button); } finally { inClick = false; } },
  };
}

for (const product of Object.keys(sources)) {
  test(`${product}: diagnostic bookkeeping for all button types avoids rebuilding exercise summaries`, () => {
    const f = renderer(product);
    f.env.controllerUiDirty = false;
    const originalView = f.controller.view;
    let overviewBuilds = 0;
    f.controller.view = (...args) => { overviewBuilds++; return originalView(...args); };
    const actions = ['BUTTON', 'OPEN_MENU', 'BACK', 'OPEN_INFO', 'NEXT_INFO', 'CLOSE_MODAL',
      'START_WORKOUT', 'START_SET', 'COMPLETE_SET', 'PAUSE', 'RESUME',
      'INCREASE_WEIGHT', 'DECREASE_WEIGHT', 'INCREASE_REPS', 'DECREASE_REPS',
      'INCREASE_RPE', 'DECREASE_RPE', 'SELECT_EXERCISE', 'SKIP_WARMUP', 'FINISH_WORKOUT'];
    for (const action of actions) {
      f.tap(f.button({ diagnosticAction: action, click_func() {} }));
      const recorded = f.env.workoutDiagnostics.read().details.lastAction.context;
      assert.equal(recorded.action, action);
      assert.equal(recorded.state, SESSION_STATES.READY);
    }
    assert.equal(overviewBuilds, 0, 'logging a tap must not calculate the full workout presentation');
    f.controller.startWorkout();
    f.env.workoutDiagnostics.record(C.ACTION_TAP, { action: 'COMPLETE_SET' });
    assert.equal(f.env.workoutDiagnostics.read().details.lastAction.context.state, SESSION_STATES.ACTIVE_SET);
    f.controller.completeSet();
    f.env.workoutDiagnostics.record(C.ACTION_TAP, { action: 'START_SET' });
    assert.equal(f.env.workoutDiagnostics.read().details.lastAction.context.state, SESSION_STATES.REST);
  });

  test(`${product}: real Start records its identity and persists before deferred drawing`, () => {
    const f = renderer(product);
    f.tap(f.button(f.env.startProps(f.controller.view())));
    assert.equal(f.controller.view().state, SESSION_STATES.ACTIVE_SET);
    assert.equal(f.env.workoutDiagnostics.read().details.lastAction.context.action, 'START_WORKOUT');
    assert.ok(f.calls.includes('journal'));
    assert.equal(f.calls.includes('redraw'), false);
    assert.equal(f.calls.includes('delete-in-click'), false);
    assert.equal(f.calls.filter(call => call === 'diagnostic-write').length, 1);
    f.timers.run(0);
    assert.ok(f.calls.includes('screen:ACTIVE_SET'));
  });

  for (const setsCount of [1, 2]) test(`${product}: real Done saves one set before UI and keeps recovery with ${setsCount} planned sets`, () => {
    const f = renderer(product, setsCount);
    f.controller.startWorkout();
    f.env.controllerUiDirty = false;
    f.calls.length = 0;
    const button = f.button(f.env.setProps(f.controller.view()));
    f.tap(button);
    const expected = setsCount === 1 ? SESSION_STATES.FINISHED : SESSION_STATES.REST;
    assert.equal(f.controller.view().state, expected);
    assert.equal(f.controller.getWorkoutSetWrites().length, 1);
    assert.ok(f.calls.includes('journal'));
    assert.equal(f.calls.includes('redraw'), false);
    assert.equal(f.calls.includes('delete-in-click'), false);
    assert.equal(f.calls.filter(call => call === 'diagnostic-write').length, 1);
    const before = f.contextReads;
    f.calls.length = 0;
    f.timers.run(0);
    assert.ok(f.calls.includes(`screen:${expected}`));
    assert.equal(f.calls.includes('diagnostic-write'), false);
    assert.ok(f.contextReads - before <= 2);
    f.tap(button);
    assert.equal(f.controller.getWorkoutSetWrites().length, 1);
    assert.equal(f.finishRequests, setsCount === 1 ? 1 : 0);
    const restored = createWorkoutController({ store: f.store, now: () => 1000 });
    assert.equal(restored.restore().success, true);
    assert.equal(restored.getWorkoutSetWrites().length, 1);
    assert.equal(restored.view().state, expected);
    if (setsCount === 2) {
      assert.equal(restored.view().rest.remaining, f.controller.view().rest.remaining);
      f.controller.nextSet();
      f.tap(button);
      assert.equal(f.controller.getWorkoutSetWrites().length, 1, 'deleted Done must not complete the next set');
    }
  });

  test(`${product}: nested native callbacks cannot clear the active click guard`, () => {
    const f = renderer(product);
    const nested = f.button({ click_func() { f.env.renderUI(); } });
    const outer = f.button({ click_func() { nested.props.click_func(nested); f.env.renderUI(); } });
    f.tap(outer);
    assert.equal(f.calls.includes('delete-in-click'), false);
    assert.equal(f.calls.includes('redraw'), false);
    f.timers.run(0);
    assert.equal(f.calls.filter(call => call === 'redraw').length, 1);
  });
}

test('one deferred write retains all drawing steps, action, errors, and previous-run evidence', () => {
  const f = diagnosticFixture();
  f.diagnostics.record(C.ACTION_TAP, { action: 'COMPLETE_SET' });
  for (const code of [C.RENDER_START, C.CLEAR_START, C.CLEAR_END, C.SCREEN_START, C.SCREEN_END, C.REDRAW_START, C.REDRAW_END, C.RENDER_END]) f.diagnostics.record(code);
  assert.equal(f.writes.length, 1);
  assert.equal(f.timers.pending.size, 1);
  f.timers.run(250);
  assert.equal(f.writes.length, 2);
  assert.equal(JSON.parse(f.values.get(WORKOUT_DIAGNOSTICS_KEY)).events.length, 9);
  assert.throws(() => f.diagnostics.trace('ACTION', () => { throw new TypeError('private text'); }), TypeError);
  const restarted = createWorkoutDiagnostics(f.storage, () => 2000);
  restarted.record(C.BOOT);
  const previous = restarted.read().previousRuns[0].details;
  assert.equal(previous.lastAction.context.action, 'COMPLETE_SET');
  assert.equal(previous.lastError.context.errorClass, 'TypeError');
  assert.doesNotMatch(f.values.get(WORKOUT_DIAGNOSTICS_KEY), /private text/);
});

test('cancelled timer cannot flush a later batch or write after disable and teardown', () => {
  const f = diagnosticFixture();
  f.diagnostics.record(C.RENDER_START);
  const stale = [...f.timers.pending.values()][0].callback;
  f.diagnostics.cancel();
  stale();
  assert.equal(f.writes.length, 0);
  f.diagnostics.record(C.RENDER_END);
  stale();
  assert.equal(f.writes.length, 0, 'an old callback must not consume a new flush');
  f.timers.run(250);
  assert.equal(f.writes.length, 1);
  f.diagnostics.record(C.RENDER_START);
  const disabled = [...f.timers.pending.values()][0].callback;
  f.diagnostics.setEnabled(false);
  const writes = f.writes.length;
  disabled();
  assert.equal(f.writes.length, writes);
  assert.equal(f.values.has(WORKOUT_DIAGNOSTICS_KEY), false);
});

test('pause persists the buffered tail and cancels scheduled persistence', () => {
  const f = diagnosticFixture();
  f.diagnostics.record(C.SET_SAVED);
  f.diagnostics.record(C.RENDER_END);
  f.diagnostics.record(C.PAUSE);
  assert.equal(f.writes.length, 1);
  assert.equal(f.timers.pending.size, 0);
  assert.deepEqual(JSON.parse(f.values.get(WORKOUT_DIAGNOSTICS_KEY)).events.map(event => event.code), ['SET_SAVED', 'RENDER_END', 'PAUSE']);
});
