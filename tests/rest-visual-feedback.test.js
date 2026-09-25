import { createWorkoutDiagnostics, WORKOUT_DIAGNOSTIC_CODES } from '../shared/workout-diagnostics.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  REST_HALO_CONFIG,
  darkenColor,
  createRestHaloLayers,
  getRestRingStartAngle,
  isPurpleRestRing,
  getChangedFieldTextColor,
  createRestPulseAnimationParams,
} from '../shared/rest-visual.js';
import * as restVisual from '../shared/rest-visual.js';
import * as watchLayout from '../shared/watch-layout.js';
import { normalizeWorkoutDisplaySettings, weightStepperDisplay } from '../shared/workout-display-settings.js';
import { EXTENSION_TOP_BAR_LAYOUT, MENU_LABEL } from '../shared/workout-extension-nav.js';
import { createScreenLayout } from '../shared/screen-layout.js';

const root = process.cwd();
const companionSource = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
const extensionSource = fs.readFileSync(path.join(root, 'data-widget', 'common', 'index.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Function ${name} not found`);
  const nextFn = source.indexOf('\nfunction ', start + 1);
  const nextConst = source.indexOf('\nconst ', start + 1);
  let end = source.length;
  if (nextFn !== -1 && nextConst !== -1) end = Math.min(nextFn, nextConst);
  else if (nextFn !== -1) end = nextFn;
  else if (nextConst !== -1) end = nextConst;
  return source.slice(start, end);
}

test('shared rest-visual helper: isPurpleRestRing and getChangedFieldTextColor', () => {
  assert.equal(isPurpleRestRing({ isResting: true, rest: { isPaused: false, isOvertime: false, remaining: 30 }, hasRing: true }), true);
  assert.equal(isPurpleRestRing({ isResting: true, rest: { isPaused: true, isOvertime: false, remaining: 30 }, hasRing: true }), false, 'Paused rest is yellow, not purple');
  assert.equal(isPurpleRestRing({ isResting: true, rest: { isPaused: false, isOvertime: true, remaining: -5 }, hasRing: true }), false, 'Overtime rest is red, not purple');
  assert.equal(isPurpleRestRing({ isResting: true, rest: { isPaused: false, isOvertime: false, remaining: 0 }, hasRing: true }), true, 'At zero the ring remains purple until overtime is reported');
  assert.equal(isPurpleRestRing({ isResting: false, rest: null, hasRing: false }), false, 'No rest ring');
  assert.equal(isPurpleRestRing({ isResting: true, rest: { isPaused: false, isOvertime: false, remaining: 30 }, hasRing: false }), false, 'Ring absent');

  const primary = 0xa48bfa;
  const normal = 0xffffff;
  assert.equal(getChangedFieldTextColor({ isChanged: true, isResting: true, rest: { isPaused: false, isOvertime: false, remaining: 30 }, hasRing: true, primaryColor: primary, normalColor: normal }), primary);
  assert.equal(getChangedFieldTextColor({ isChanged: true, isResting: true, rest: { isPaused: true, isOvertime: false, remaining: 30 }, hasRing: true, primaryColor: primary, normalColor: normal }), normal);
  assert.equal(getChangedFieldTextColor({ isChanged: true, isResting: true, rest: { isPaused: false, isOvertime: true, remaining: -5 }, hasRing: true, primaryColor: primary, normalColor: normal }), normal);
  assert.equal(getChangedFieldTextColor({ isChanged: false, isResting: true, rest: { isPaused: false, isOvertime: false, remaining: 30 }, hasRing: true, primaryColor: primary, normalColor: normal }), normal);
});

test('rest ring shrinks clockwise from the top as rest counts down', () => {
  assert.equal(getRestRingStartAngle({ duration: 60, remaining: 60 }), -90);
  assert.equal(getRestRingStartAngle({ duration: 60, remaining: 30 }), 90);
  assert.equal(getRestRingStartAngle({ duration: 60, remaining: 0 }), 270);
  assert.equal(getRestRingStartAngle({ duration: 60, remaining: -5 }), 270);
  assert.equal(getRestRingStartAngle({ duration: 60, remaining: 90 }), -90);
});

test('shared rest-visual helper: halo geometry is bounded and fade is nonincreasing', () => {
  for (const { width, height, isFitted } of [
    { width: 480, height: 480, isFitted: false },
    { width: 390, height: 390, isFitted: false },
    { width: 336, height: 480, isFitted: true },
  ]) {
    const { depth, layers } = createRestHaloLayers({ width, height, isFitted });
    assert.equal(layers.length, REST_HALO_CONFIG.LAYER_COUNT, 'Expected 5 halo layers');
    assert.ok(depth <= Math.round(width * (14 / 480)) + 1, 'Total depth bounded to ~12 design px proportional to W');

    assert.equal(layers[0].x, 2);
    assert.equal(layers[0].y, 2);
    assert.equal(layers[0].w, width - 4);
    assert.equal(layers[0].h, height - 4);

    for (let i = 1; i < layers.length; i++) {
      assert.ok(layers[i].factor <= layers[i - 1].factor, `Fade factor at layer ${i} must not exceed layer ${i - 1}`);
      assert.ok(layers[i].x >= layers[i - 1].x, 'Concentric inset increases inward');
      assert.ok(layers[i].w <= layers[i - 1].w, 'Concentric width decreases inward');
    }

    const purple = 0x8356f6;
    for (let i = 1; i < layers.length; i++) {
      const cPrev = darkenColor(purple, layers[i - 1].factor);
      const cCurr = darkenColor(purple, layers[i].factor);
      const rPrev = (cPrev >> 16) & 0xff;
      const rCurr = (cCurr >> 16) & 0xff;
      assert.ok(rCurr <= rPrev, 'Darkened color RGB channels must be nonincreasing');
    }
  }
});

test('shared rest-visual helper: pulse animation configuration matches Zepp spec', () => {
  const propMock = { ALPHA: 10, ANIM: 11, ANIM_STATUS: 12, MORE: 1 };
  const params = createRestPulseAnimationParams(propMock);
  assert.equal(params.anim_fps, 20, 'anim_fps must be <= 20fps');
  assert.equal(params.anim_repeat, -1, 'anim_repeat must be -1 for continuous breathing');
  assert.equal(params.anim_steps.length, 2, '2 steps for breathing cycle');
  assert.equal(params.anim_steps[0].anim_from, 255);
  assert.equal(params.anim_steps[0].anim_to, 210);
  assert.equal(params.anim_steps[1].anim_from, 210);
  assert.equal(params.anim_steps[1].anim_to, 255);
  assert.equal(params.anim_steps[0].anim_duration + params.anim_steps[1].anim_duration, 4000, '~4s breathing cycle');
});

function createMockEnv({ source, isCompanion = false, viewOverride = {} }) {
  const widgets = [];
  const liveWidgets = {};
  const setPropertyCalls = [];

  const view = {
    state: 'REST',
    rest: { duration: 60, remaining: 59, isPaused: false, isOvertime: false },
    pending: {
      setIndex: 0,
      totalSets: 3,
      exerciseName: 'Warmup Squat',
      exerciseDetails: 'Deep squat',
      exerciseImageUrl: null,
      loadingEquipment: 'barbell',
      changes: { exercise: true, weight: true, reps: true, rpe: true },
      set: { isWarmup: true, weight: 60, reps: 5, rpe: 8, targetRpe: 8 },
    },
    currentSet: { isWarmup: true, weight: 60, reps: 5, rpe: 8, targetRpe: 8 },
    exerciseName: 'Warmup Squat',
    exerciseDetails: 'Deep squat',
    currentSetIndex: 0,
    totalSets: 3,
    unit: 'kg',
    elapsedSeconds: 125,
    isWorkoutPaused: false,
    ...viewOverride,
  };

  const THEME = {
    primary: 0x8356f6,
    success: 0x23c88e,
    primaryLight: 0xa48bfa,
    primaryPale: 0xccc1f9,
    primaryDark: 0x393248,
    primaryDeep: 0x2c1065,
    yellow: 0xffd820,
    error: 0xff8066,
    textPrimary: 0xffffff,
    textSecondary: 0xa4b0bc,
    card: 0x332d42,
    cardActive: 0x453d58,
    bg: 0x000000,
  };

  const env = {
    workoutDiagnostics: createWorkoutDiagnostics(), WORKOUT_DIAGNOSTIC_CODES,
    ...watchLayout,
    ...restVisual,
    EXTENSION_TOP_BAR_LAYOUT,
    MENU_LABEL,
    restHaloWidgets: [],
    restPulseAnimHandles: [],
    restPulseAttempted: false,
    THEME,
    W: 480,
    H: 480,
    LAYOUT: { isFitted: false },
    px: (v) => v,
    font: (role) => watchLayout.TYPOGRAPHY[role] || 20,
    formatSeconds: (sec) => {
      const isNeg = sec < 0;
      const abs = Math.abs(sec);
      const m = Math.floor(abs / 60);
      const s = String(abs % 60).padStart(2, '0');
      return `${isNeg ? '-' : ''}${m}:${s}`;
    },
    formatActiveSetProgress: () => 'SET 1/3',
    formatLoadoutLabel: () => '60 KG',
    formatEditableSetValue: (val) => String(val),
    truncate: (t) => t,
    formatMarqueeText: (t) => t,
    elapsedLabel: () => '0:00',
    syncWarning: null,
    liveHr: 72,
    heartRateColor: () => 0xffffff,
    formatHeartRate: (hr) => `${hr} bpm`,
    edit_widget_group_type: { SPORT_DATA: 1 },
    sport_data: { HEART_RATE: 1 },
    supersetColor: () => 0xffffff,
    SESSION_STATES: { REST: 'REST', FINISHED: 'FINISHED' },
    widget: { BUTTON: 'button', TEXT: 'text', STROKE_RECT: 'stroke_rect', ARC: 'arc', FILL_RECT: 'fill_rect' },
    prop: { MORE: 1, ANIM: 2, ANIM_STATUS: 3, ALPHA: 4 },
    anim_status: { START: 1, STOP: 2, PAUSE: 3, RESUME: 4 },
    align: { CENTER_H: 1, CENTER_V: 2 },
    text_style: { NONE: 0 },
    activeWidgets: [],
    liveWidgets,
    setPropertyCalls,
    renderPreparationImage: () => false,
    exerciseImages: null,
    renderTopBar() {},
    renderWorkoutProgress() {},
    normalizeWorkoutDisplaySettings,
    weightStepperDisplay,
    accountSettings: {},
    openNotes: () => {},
    openExerciseInfo: () => {},
    renderExerciseInfo: () => {},
    openWorkoutTimerControls: () => {},
    openTextModal: () => {},
    stopVibration: () => {},
    setRestPrepared: () => {},
    submitWorkout: () => {},
    scheduleRenderUI: () => {},
    renderUI: () => {},
    consumeControllerUiChange: () => {},
    controllerUiDirty: false,
    workoutController: {
      view: () => env.currentView || view,
      adjustWeight: () => {},
      adjustReps: () => {},
      adjustRpe: () => {},
      skipWarmup: () => false,
      toggleRestPause: () => {},
      nextSet: () => {},
      pollCurrent: () => Promise.resolve(false),
      advanceTimedSet: () => {},
    },
    session: {
      view: () => env.currentView || view,
      adjustWeight: () => {},
      adjustReps: () => {},
      adjustRpe: () => {},
      skipWarmup: () => false,
      toggleRestPause: () => {},
    },
    persistAndRender: (fn) => fn(),
    addWidget: (type, props) => {
      const entry = {
        type,
        ...props,
        setEnable: enabled => { entry.enabled = enabled; },
        setProperty: (p, val) => {
          setPropertyCalls.push({ type, prop: p, val });
          if (p === 1 && typeof val === 'object') Object.assign(entry, val);
          return 999;
        },
      };
      widgets.push(entry);
      env.activeWidgets.push(entry);
      return entry;
    },
    addRawWidget: (type, props) => env.addWidget(type, props),
    addActionWidget: (props) => env.addWidget('button', props),
    deleteWidget: (entry) => { widgets.splice(widgets.indexOf(entry), 1); },
    addLiveLabel: (key, props) => {
      const entry = {
        key,
        ...props,
        setProperty: (p, val) => {
          setPropertyCalls.push({ key, prop: p, val });
          if (p === 1 && typeof val === 'object') Object.assign(entry, val);
          return 999;
        },
      };
      liveWidgets[key] = { widget: entry, props: { ...props } };
      widgets.push(entry);
      env.activeWidgets.push(entry);
      return entry;
    },
    addLiveButton: (key, props) => env.addLiveLabel(key, props),
    addTransparentLabel: (key, props) => {
      const entry = env.addWidget(env.widget.TEXT, props);
      entry.key = key;
      entry.setEnable = enabled => { entry.enabled = enabled; };
      liveWidgets[key] = { widget: entry, props: { ...props } };
      return entry;
    },
    updateTransparentLabel: (key, props) => env.updateLiveWidget(key, props),
    updateLiveWidget: (key, props) => {
      if (liveWidgets[key]) {
        Object.assign(liveWidgets[key].props, props);
        liveWidgets[key].widget.setProperty(env.prop.MORE, props);
        return true;
      }
      return true;
    },
    isResting: true,
    view,
    currentView: view,
  };

  return { env, widgets, liveWidgets, setPropertyCalls, view, THEME };
}

for (const [name, source, isCompanion] of [
  ['Companion', companionSource, true],
  ['Workout', extensionSource, false],
]) {
  test(`${name}: hiding plates gives the weight and unit the full stepper row`, () => {
    const { env, liveWidgets, view } = createMockEnv({
      source, isCompanion, viewOverride: { state: 'ACTIVE_SET', rest: null },
    });
    env.accountSettings = { showPlateBreakdown: false };
    const render = new Function('env', `with (env) {
      ${extractFunction(source, 'renderStepper')}
      ${extractFunction(source, 'renderActiveSetScreen')}
      return renderActiveSetScreen;
    }`)(env);
    render(view);
    assert.equal(liveWidgets['weight-value'].props.text, '60 KG');
    assert.equal(liveWidgets['weight-value'].props.h, watchLayout.ACTIVE_SET_LAYOUT.withRpe.rowHeight);
    assert.equal(liveWidgets['weight-label'], undefined);
  });

  test(`${name}: paused rest does NOT color changed fields purple (must be textPrimary)`, () => {
    const { env, widgets, liveWidgets, view, THEME } = createMockEnv({
      source,
      isCompanion,
      viewOverride: {
        rest: { remaining: 59, isPaused: true, isOvertime: false },
      },
    });

    const topBarFn = 'renderPreparedTopBar';
    const activeSetScreenFn = 'renderActiveSetScreen';

    const fn = new Function('env', `with (env) {
      ${source.includes('function stopRestBezelAnimation(') ? extractFunction(source, 'stopRestBezelAnimation') : ''}
      ${extractFunction(source, 'restStatusColor')}
      ${extractFunction(source, 'renderRestBezel')}
      ${extractFunction(source, topBarFn)}
      ${isCompanion ? '' : extractFunction(source, 'renderExerciseInfo')}
      ${extractFunction(source, 'renderStepper')}
      ${extractFunction(source, activeSetScreenFn)}
      return ${activeSetScreenFn};
    }`)(env);

    fn(view);

    const title = widgets.find((w) => w.key === 'exerciseTitle');
    assert.ok(title, 'Exercise title must exist');
    assert.equal(
      title.color,
      THEME.textPrimary,
      'When rest is paused, exerciseTitle must NOT be purple; must use textPrimary'
    );

    const weight = widgets.find((w) => w.key === 'weight-value' || (w.text === '60' && w.color));
    assert.ok(weight, 'Weight value must exist');
    assert.equal(
      weight.color,
      THEME.textPrimary,
      'When rest is paused, changed weight must NOT be purple; must use textPrimary'
    );
  });
}


for (const [name, source, isCompanion] of [
  ['Companion', companionSource, true], ['Workout', extensionSource, false],
]) {
  test(`${name}: live rest colors follow same-second pause, resume and overtime without changing values`, () => {
    const { env, widgets, liveWidgets, setPropertyCalls, view, THEME } = createMockEnv({ source, isCompanion });
    Object.assign(env, {
      isTearingDown: false, isPaused: false, hasBuilt: true,
      screen: 'SESSION', SCREEN: { SESSION: 'SESSION' }, EXTENSION_SCREENS: { SESSION: 'SESSION' },
      lastRenderedState: 'REST', lastRenderedSecond: view.rest.remaining,
      updateClock() {}, pollCurrentWorkout() {}, refreshSportMetrics() {}, retryPendingWrites() {},
      updateTimedSetScreen() {}, updateSyncWarning() {}, handlePollFailure() {},
      restAlertTracker: { checkTick: () => ({ shouldAlert: false }) },
    });
    const names = ['stopRestBezelAnimation', 'restStatusColor', 'updateRestBezelAndHalo',
      'renderRestBezel', 'updatePreparedRestVisuals', 'renderPreparedTopBar',
      'renderStepper', 'renderActiveSetScreen', 'tick'];
    if (!isCompanion) names.push('refreshActiveSetControls');
    const api = new Function('env', `with (env) {
      ${names.map(name => extractFunction(source, name)).join('\n')}
      return { render: renderActiveSetScreen, tick, stop: stopRestBezelAnimation,
        refresh: ${isCompanion ? '() => {}' : 'refreshActiveSetControls'} };
    }`)(env);
    api.render(view);
    const count = widgets.length;
    const actionCallback = liveWidgets.actionButton.props.click_func;
    const values = ['weight', 'reps', 'rpe'].map(key => liveWidgets[`${key}-value`].props.text);
    const colors = () => ['exerciseTitle', 'weight-value', 'reps-value', 'rpe-value'].map(key => liveWidgets[key].props.color);
    assert.deepEqual(colors(), Array(4).fill(THEME.primaryLight));
    assert.equal(liveWidgets.actionButton.props.normal_color, liveWidgets.restBezel.props.color);
    const animStarts = () => setPropertyCalls.filter(call => call.prop === env.prop.ANIM).length;
    const initialStarts = animStarts();
    assert.equal(initialStarts, REST_HALO_CONFIG.LAYER_COUNT);
    const nativeCalls = setPropertyCalls.length;
    api.tick();
    api.tick();
    assert.equal(animStarts(), initialStarts, 'Ticks must not restart animations');
    assert.equal(setPropertyCalls.length, nativeCalls, 'Stable ticks should not redraw the halo or colors');
    assert.equal(liveWidgets.restBezel.props.start_angle, -84);
    assert.equal(liveWidgets.restBezel.props.end_angle, 270);
    view.rest.remaining = 30;
    api.tick();
    assert.equal(liveWidgets.restBezel.props.start_angle, 90, 'Arc tracks remaining rest');
    assert.equal(widgets.length, count, 'Countdown updates the existing arc');
    view.rest.isPaused = true;
    api.tick();
    assert.equal(liveWidgets.restBezel.props.start_angle, 90, 'Pause freezes the arc');
    assert.equal(liveWidgets.restBezel.props.color, THEME.yellow);
    assert.equal(liveWidgets.actionButton.props.normal_color, THEME.yellow);
    assert.equal(liveWidgets.actionButton.widget.normal_color, THEME.yellow);
    assert.deepEqual(colors(), Array(4).fill(THEME.textPrimary));
    api.refresh();
    assert.deepEqual(colors(), Array(4).fill(THEME.textPrimary), 'Edits during pause remain white');
    view.rest.isPaused = false;
    api.tick();
    assert.equal(liveWidgets.restBezel.props.color, THEME.primary);
    assert.equal(liveWidgets.actionButton.props.normal_color, THEME.primary);
    assert.deepEqual(colors(), Array(4).fill(THEME.primaryLight));
    assert.equal(liveWidgets.actionButton.props.normal_color, liveWidgets.restBezel.props.color);
    assert.equal(animStarts(), initialStarts * 2, 'Resume starts one cycle per layer');
    view.rest.isOvertime = true;
    view.rest.remaining = -1;
    api.tick();
    assert.equal(liveWidgets.restBezel.props.start_angle, -90, 'Overtime restores the red perimeter');
    assert.equal(liveWidgets.restBezel.props.color, THEME.error);
    assert.equal(liveWidgets.actionButton.props.normal_color, THEME.error);
    assert.equal(liveWidgets.actionButton.widget.normal_color, THEME.error);
    assert.deepEqual(colors(), Array(4).fill(THEME.textPrimary));
    api.refresh();
    assert.deepEqual(colors(), Array(4).fill(THEME.textPrimary), 'Edits during overtime remain white');
    for (let i = 1; i < REST_HALO_CONFIG.LAYER_COUNT; i++) {
      assert.equal(liveWidgets[`restHalo_${i}`].props.color, darkenColor(THEME.error, REST_HALO_CONFIG.FADE_FACTORS[i]));
    }
    assert.equal(widgets.length, count);
    assert.equal(liveWidgets.actionButton.widget.click_func, actionCallback, 'Color transitions preserve the action');
    assert.equal(liveWidgets.actionButton.widget.text, '> Start set -0:01');
    assert.deepEqual(['weight', 'reps', 'rpe'].map(key => liveWidgets[`${key}-value`].props.text), values);
    view.rest = null;
    view.state = 'ACTIVE_SET';
    api.stop();
    api.render(view);
    assert.deepEqual(colors(), Array(4).fill(THEME.textPrimary), 'Without rest changed text is white');
  });
}

test('Companion sync-details clock remains clickable while its label updates', () => {
  const { env, liveWidgets } = createMockEnv({ source: companionSource });
  const click = () => {};
  Object.assign(env, {
    px: value => value,
    font: () => 12,
    currentClockLabel: () => '12:59 PM',
    recordingLabel: () => 'Pending sync',
    workoutController: {
      sync: () => ({}),
      getWorkoutSetWrites: () => [1],
      getPendingSetCount: () => 1,
    },
    lastRenderedClock: '',
    renderCount: 0,
    renderUI: () => { env.renderCount++; },
    THEME: env.THEME,
    EXTENSION_CLOCK_LAYOUT: watchLayout.EXTENSION_CLOCK_LAYOUT,
    align: { CENTER_H: 1, CENTER_V: 2 },
    text_style: { NONE: 0 },
    canOpenSyncDetails: () => true,
    openSyncDetailsModal: click,
    addLiveButton: (key, props) => env.addLiveLabel(key, props),
    updateLiveWidget: (key, changes) => {
      Object.assign(liveWidgets[key].props, changes);
      liveWidgets[key].widget.setProperty(env.prop.MORE, changes);
      return true;
    },
  });
  const api = new Function('env', `with (env) {
    ${extractFunction(companionSource, 'renderClock')}
    ${extractFunction(companionSource, 'updateClock')}
    return { render: renderClock, update: updateClock };
  }`)(env);
  api.render();
  assert.equal(liveWidgets.clock.widget.click_func, click);
  env.currentClockLabel = () => '13:00 PM';
  api.update();
  assert.equal(liveWidgets.clock.widget.click_func, click, 'Clock refresh keeps the sync-details action');
  assert.equal(liveWidgets.clock.props.text, '13:00 PM | Pending sync');
  env.canOpenSyncDetails = () => false;
  env.currentClockLabel = () => '13:01 PM';
  api.update();
  assert.equal(env.renderCount, 1, 'Sync-state changes rebuild the clock in its new interaction mode');
});
for (const [name, source, isCompanion] of [
  ['Companion', companionSource, true],
  ['Workout', extensionSource, false],
]) {
  test(`${name}: rest countdown sends start_angle to native perimeter widgets`, () => {
    const { env, view, setPropertyCalls, liveWidgets } = createMockEnv({ source });
    Object.assign(env, {
      isTearingDown: false,
      isPaused: false,
      hasBuilt: true,
      liveWidgets,
    });
    const names = [
      extractFunction(source, 'stopRestBezelAnimation'),
      extractFunction(source, 'restStatusColor'),
      extractFunction(source, 'updateRestBezelAndHalo'),
      extractFunction(source, 'renderRestBezel'),
      "const LIVE_WIDGET_MUTABLE_KEYS = ['x', 'y', 'w', 'h', 'text', 'color', 'text_size', 'radius', 'line_width', 'start_angle', 'end_angle'];",
      extractFunction(source, 'updateLiveWidget'),
    ];
    const api = new Function('env', `with (env) {
      ${names.join('\n')}
      return { render: renderRestBezel, update: updateRestBezelAndHalo };
    }`)(env);
    api.render(view.rest);
    view.rest.remaining = 30;
    api.update(view.rest);
    const perimeter = setPropertyCalls.filter(call =>
      call.prop === env.prop.MORE && Object.hasOwn(call.val, 'start_angle'));
    assert.equal(perimeter.length, 5, 'Each halo arc receives the changed start angle');
    assert.ok(perimeter.every(call => call.val.start_angle === 90));
    assert.equal(liveWidgets.restBezel.props.start_angle, 90);
  });
}
test('native pulse accepts animation ID zero and restores opacity on stop', () => {
  const calls = [];
  const widget = { setProperty: (key, value) => { calls.push({ key, value }); return 0; } };
  const prop = { ANIM: 0, ALPHA: 1, ANIM_STATUS: 2 };
  const handles = restVisual.startRestPulseAnimation([widget], prop);
  assert.equal(handles.length, 1);
  restVisual.stopRestPulseAnimation(handles, prop, { STOP: 0 });
  assert.deepEqual(calls.slice(1), [
    { key: 2, value: { anim_id: 0, anim_status: 0 } }, { key: 1, value: 255 },
  ]);
});


test('unavailable native animation leaves a static halo without retrying every tick', () => {
  const { env, view, setPropertyCalls, liveWidgets } = createMockEnv({ source: companionSource });
  const add = env.addRawWidget;
  let starts = 0;
  env.addRawWidget = (type, props) => {
    const entry = add(type, props);
    const set = entry.setProperty;
    entry.setProperty = (key, value) => {
      if (key === env.prop.ANIM) { starts++; return undefined; }
      return set(key, value);
    };
    return entry;
  };
  const names = ['stopRestBezelAnimation', 'restStatusColor', 'updateRestBezelAndHalo', 'renderRestBezel'];
  const api = new Function('env', `with (env) {
    ${names.map(name => extractFunction(companionSource, name)).join('\n')}
    return { render: renderRestBezel, update: updateRestBezelAndHalo };
  }`)(env);
  api.render(view.rest);
  api.update(view.rest);
  api.update(view.rest);
  assert.equal(starts, REST_HALO_CONFIG.LAYER_COUNT);
  assert.equal(env.restPulseAnimHandles.length, 0);
  assert.equal(liveWidgets.restBezel.props.color, env.THEME.primary);
  assert.equal(setPropertyCalls.length, 0);
});


for (const [name, source] of [['Companion', companionSource], ['Workout', extensionSource]]) {
  test(`${name}: a rejected native color update schedules a safe redraw`, () => {
    const { env, view } = createMockEnv({ source });
    const names = ['stopRestBezelAnimation', 'restStatusColor', 'updateRestBezelAndHalo',
      'renderRestBezel', 'updatePreparedRestVisuals'];
    const api = new Function('env', `with (env) {
      ${names.map(name => extractFunction(source, name)).join('\n')}
      return { render: renderRestBezel, update: updatePreparedRestVisuals };
    }`)(env);
    api.render(view.rest);
    env.updateLiveWidget = () => false;
    view.rest.isPaused = true;
    api.update(view);
    assert.equal(env.controllerUiDirty, true);
  });
}

for (const [name, source] of [['Companion', companionSource], ['Workout', extensionSource]]) {
  test(`${name}: transparent changing labels replace only their text widget`, () => {
    const { env, widgets, liveWidgets } = createMockEnv({ source });
    env.LAYOUT = { fit: props => props };
    const labels = new Function('env', `with (env) {
      ${extractFunction(source, 'addTransparentLabel')}
      ${extractFunction(source, 'updateTransparentLabel')}
      return { add: addTransparentLabel, update: updateTransparentLabel };
    }`)(env);
    const first = labels.add('clock', { x: 10, y: 20, w: 100, h: 30, text: '12:59 | Synced' });
    assert.equal(first.type, 'text');
    assert.equal(first.enabled, false);
    assert.equal(first.normal_color, undefined);
    assert.equal(labels.update('clock', { text: '13:00 | Synced' }), true);
    assert.equal(liveWidgets.clock.props.text, '13:00 | Synced');
    assert.equal(widgets.length, 1);
    assert.equal(env.activeWidgets.length, 1);
    assert.notEqual(liveWidgets.clock.widget, first);
    assert.equal(labels.update('clock', { text: '13:00 | Synced' }), true);
    assert.equal(widgets.length, 1, 'Unchanged text does not create a widget');
  });

  test(`${name}: transparent footer is above the halo and fits the panel`, () => {
    for (const device of [
      { width: 480, height: 480, isRound: true },
      { width: 390, height: 390, isRound: true },
      { width: 390, height: 450, isRound: false },
      { width: 480, height: 480, isRound: false },
      { width: 336, height: 480, isRound: false },
    ]) {
      const { env, view, widgets } = createMockEnv({ source });
      const scale = device.width / 480;
      Object.assign(env, {
        W: device.width, H: device.height, LAYOUT: createScreenLayout(device),
        px: value => value * scale, font: () => 20 * scale,
        clockTimer: null, lastRenderedClock: '', currentClockLabel: () => '12:59 PM',
        recordingLabel: () => 'Synced', isTearingDown: false, hasBuilt: true,
        isPaused: false, isDispatchingClick: false, isNotesModalOpen: false,
        preparationImageUrl: null, WORKOUT_DIAGNOSTIC_CODES: {},
        workoutDiagnostics: createWorkoutDiagnostics(), cancelScheduledRender() {},
        updateSyncWarning() {}, clearWidgets() {}, hideModalControls() {},
        renderDemoBadge() {}, redraw() {}, canOpenSyncDetails: () => false,
      });
      env.workoutController.sync = () => ({});
      env.workoutController.getWorkoutSetWrites = () => [1];
      const addFooter = (key, props) => {
        const entry = { type: 'text', key, enabled: false, ...env.LAYOUT.fit(props), setEnable: enabled => { entry.enabled = enabled; } };
        widgets.push(entry);
        return entry;
      };
      env.addLiveLabel = addFooter;
      env.addTransparentLabel = addFooter;
      const names = ['restStatusColor', 'stopRestBezelAnimation', 'renderRestBezel', 'renderClock', 'renderUI'];
      const render = new Function('env', `with (env) {
        ${names.map(name => extractFunction(source, name)).join('\n')}
        const renderScreen = () => renderRestBezel(view.rest);
        return renderUI;
      }`)(env);
      render();
      const footer = widgets.find(w => w.key === 'clock');
      const haloType = device.isRound ? 'arc' : 'stroke_rect';
      const haloLastIndex = widgets.findLastIndex(w => w.type === haloType);
      assert.ok(widgets.indexOf(footer) > haloLastIndex, 'Halo must stay behind the footer');
      const outline = widgets.find(w => w.type === haloType);
      assert.equal(outline.w, device.width - 4, 'Perimeter uses raw device width');
      assert.equal(outline.h, device.height - 4, 'Perimeter uses raw device height');
      assert.equal(outline.radius, device.isRound ? Math.round(outline.w / 2) : Math.round(device.width * 0.12),
        'Round devices get a circle; square devices get rounded corners');
      if (device.isRound) assert.equal(outline.end_angle, 270, 'Round rest ends at 12 oclock');
      assert.equal(footer.text, '12:59 PM | Synced', 'Time and status must both remain complete');
      assert.equal(footer.type, 'text');
      assert.equal(footer.normal_color, undefined);
      assert.equal(footer.press_color, undefined);
      assert.equal(footer.enabled, false, 'Footer must not intercept actions');
      for (const x of [footer.x, footer.x + footer.w]) {
        for (const y of [footer.y, footer.y + footer.h]) {
          if (device.isRound) {
            assert.ok(Math.hypot(x - device.width / 2, y - device.height / 2) <= device.width / 2,
              `Footer corner ${x},${y} must fit ${device.width}px circle`);
          } else {
            assert.ok(x >= 0 && x <= device.width && y >= 0 && y <= device.height);
          }
        }
      }
    }
  });
}

for (const [name, source] of [['Companion', companionSource], ['Workout', extensionSource]]) {
  test(`${name}: heart label has no button background in both session top bars`, () => {
    for (const functionName of ['renderTopBar', 'renderPreparedTopBar']) {
      const { env, view, widgets, liveWidgets } = createMockEnv({ source });
      const render = new Function('env', `with (env) {
        ${extractFunction(source, functionName)}
        return ${functionName};
      }`)(env);
      render(view, () => {});
      const heart = name === 'Companion'
        ? liveWidgets.hr?.widget
        : widgets.find(w => w.text === '\u2665');
      assert.ok(heart, `${functionName} has a heart label`);
      assert.equal(heart.type, 'text');
      assert.equal(heart.normal_color, undefined);
      assert.equal(heart.press_color, undefined);
    }
  });
}
