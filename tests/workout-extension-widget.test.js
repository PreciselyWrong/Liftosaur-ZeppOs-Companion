import { isPurpleRestRing, darkenColor } from '../shared/rest-visual.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import * as watchLayout from '../shared/watch-layout.js';

function readWidgetSource() {
  return fs.readFileSync(
    path.join(process.cwd(), 'data-widget', 'common', 'index.js'),
    'utf8',
  );
}

test('data-widget/common/index.js fulfills all platform and product contracts', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'data-widget', 'common', 'index.js'),
    'utf8',
  );
  const returnAfterDiscard = source.match(/function returnAfterDiscard\(\) \{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(returnAfterDiscard, /isBusy = false/);
  assert.match(returnAfterDiscard, /statusMessage = ''/);
  assert.match(returnAfterDiscard, /screen = EXTENSION_SCREENS\.HOME/);

  // 1. DataWidget BasePage structure
  assert.match(source, /DataWidget\(\s*BasePage\(/, 'Must use DataWidget(BasePage({...}))');
  for (const lifecycle of ['onInit', 'build', 'onResume', 'onPause', 'onDestroy']) {
    assert.match(source, new RegExp(`${lifecycle}\\(\\)`), `Must implement ${lifecycle}() lifecycle`);
  }

  // 2. Storage key must be exactly liftosaur.extension.session.v2
  assert.match(source, /'liftosaur\.extension\.session\.v2'/, 'Must use exact extension session key');
  assert.match(source, /createSessionStore/, 'Must use createSessionStore');
  assert.match(source, /createFallbackStorageAdapter/, 'Must use createFallbackStorageAdapter');

  // 3. Controller integration
  assert.match(source, /createWorkoutController/, 'Must use createWorkoutController');
  assert.match(source, /function updateSyncWarning/, 'Must expose queue and conflict status');

  // 4. Click-only rule & No gestures or scroll widgets
  assert.match(source, /click_func/, 'Must use button click_func');
  assert.doesNotMatch(source, /onGesture|offGesture|GESTURE_|SCROLL_LIST|VIEW_CONTAINER/, 'No gesture or scrolling');

  // 5. No HeartRate sensor (native workout owns HR)
  assert.doesNotMatch(source, /HeartRate/, 'Must not import or instantiate HeartRate sensor');

  // Native duration drives pause reconciliation; the native HR widget owns BPM.
  assert.match(source, /getSportData\(\s*\{\s*type:\s*['"]duration['"]\s*\}/, 'Must query sport duration');
  assert.doesNotMatch(source, /sportCalories|CALORIE_REFRESH_MS|formatSportBarText/, 'No timer/calorie ticker');
  assert.match(source, /default_type: sport_data.HR/, 'Use native workout BPM');

  // 7. No native workout stop/finish manipulation
  assert.doesNotMatch(source, /stopWorkout|finishWorkoutNative|exitSport/, 'Must not finish or stop native workout');

  // 8. Finished screen exact instruction
  assert.match(
    source,
    /Liftosaur saved.*finish.*native|finish.*Zepp.*native/i,
    'Finished screen must instruct user to finish with native Zepp controls'
  );

  // 9. Required screen renderers
  const requiredRenders = [
    'renderLoadingScreen',
    'renderConnectionScreen',
    'renderSetupScreen',
    'renderHomeScreen',
    'renderProgramsScreen',
    'renderWeeksScreen',
    'renderDaysScreen',
    'renderReadyScreen',
    'renderActiveSetScreen',
    'renderRestScreen',
    'renderOverviewScreen',
    'renderNotesScreen',
    'renderFinishedScreen',
    'renderConflictScreen',
  ];
  for (const fn of requiredRenders) {
    assert.match(source, new RegExp(`function ${fn}`), `Must define ${fn}`);
  }

  const onInit = source.slice(source.indexOf('onInit()'), source.indexOf('build()'));
  assert.doesNotMatch(onInit, /renderUI\(|startInitialNetworkLoad\(|submitWorkout\(|handleDiscardWorkout\(/, 'onInit must not draw or start writes before build');
  const build = source.slice(source.indexOf('build()'), source.indexOf('onResume()'));
  assert.match(build, /startInitialNetworkLoad\(\)/, 'build starts deferred network loading');
  assert.match(source, /Discard local[\s\S]*discardConfirmationRequested/, 'remote-missing recovery requires explicit discard confirmation');

  // 10. Low-cardinality logging
  assert.doesNotMatch(
    source,
    /console\.log\([^)]*(res\.payload|workout\.entries|apiKey|JSON\.stringify\(res\))/i,
    'Must not dump payloads or secrets in logs'
  );

  // 11. Screen controls from @zos/display and safe reset before native teardown
  assert.match(source, /from\s+['"]@zos\/display['"]/, 'Must import display controls from @zos/display');
  assert.match(source, /setPageBrightTime/, 'Must set the focused page bright time');
  assert.match(source, /pauseDropWristScreenOff/, 'Must prevent wrist-drop screen off while focused');
  assert.match(source, /pausePalmScreenOff/, 'Must prevent palm screen off while focused');

  const onPause = source.slice(source.indexOf('onPause()'), source.indexOf('onDestroy()'));
  const onDestroy = source.slice(source.indexOf('onDestroy()'));
  assert.match(onPause, /resetDisplayHold/, 'onPause must safely reset screen controls');
  assert.doesNotMatch(onDestroy, /resetDisplayHold/, 'onDestroy must not call display APIs during native teardown');

  // 12. Periodic sport metrics refresh from tick
  const tickBody = source.slice(source.indexOf('function tick('), source.indexOf('function startClock('));
  assert.match(tickBody, /refreshSportMetrics\(\)/, 'tick must periodically refresh sport metrics');

  // 13. Pause reconciliation with workout session/controller
  assert.match(source, /pauseWorkout|resumeWorkout|reconcilePause/, 'Must perform pause reconciliation for native workout pause/resume');

  // 14. retryPendingWrites on onResume
  const onResume = source.slice(source.indexOf('onResume()'), source.indexOf('onPause()'));
  assert.match(onResume, /retryPendingWrites\(\)/, 'onResume must call retryPendingWrites to drain queued writes');
  assert.match(onResume, /requestRefresh\(\)/, 'onResume must prioritize a current workout refresh');

  assert.match(source, /function loadDisplaySettings/, 'Restored sessions must reload display settings');
  assert.match(source, /text: syncWarning \? 'Sync!' : MENU_LABEL/, 'Share the Companion menu glyph');

  // 15. Rest completion must use Zepp's dedicated strong reminder pattern.
  assert.match(
    source,
    /VIBRATOR_SCENE_STRONG_REMINDER/,
    'Rest completion must use the four-pulse strong reminder vibration',
  );
  assert.match(
    source,
    /VIBRATOR_SCENE_SHORT_LIGHT/,
    'Impending rest warning must use the light vibration pattern',
  );
  assert.match(source, /triggerLightVibration\(\)/, 'Impending rest warning must trigger light vibration');
  const vibrationMode = source.slice(
    source.indexOf('function setRestVibrationMode()'),
    source.indexOf('function triggerRestVibration()'),
  );
  assert.match(
    vibrationMode,
    /setMode\(VIBRATOR_SCENE_STRONG_REMINDER\)/,
    'Rest completion must configure the strong reminder mode',
  );

  assert.match(source, /withRequestTimeout/, 'Phone bridge requests must have a bounded timeout');
  assert.doesNotMatch(source, /shouldAutoStartPreparedSet/, 'Prepare must keep running into overtime');

  // Display hold duration must be safely bounded to prevent 32-bit tick arithmetic overflow
  const alwaysMsMatch = source.match(/ALWAYS_SCREEN_ON_MS\s*=\s*(\d+)/);
  assert.ok(alwaysMsMatch, 'ALWAYS_SCREEN_ON_MS must be defined');
  const alwaysMs = Number(alwaysMsMatch[1]);
  assert.ok(alwaysMs > 0 && alwaysMs <= 1800000, `ALWAYS_SCREEN_ON_MS must be <= 1800000 ms to avoid RTOS timer overflow (got ${alwaysMs})`);

  // Button click callbacks must never call renderUI synchronously to prevent deleting widgets inside native touch dispatchers
  const clickCallbacks = source.match(/click_func:\s*(?:\(\)\s*=>|function\s*\([^)]*\))\s*\{[^}]*\}/g) || [];
  for (const cb of clickCallbacks) {
    assert.doesNotMatch(cb, /\brenderUI\s*\(\s*\)/, `click_func must defer renderUI to avoid use-after-free in C++ touch dispatcher: ${cb}`);
  }

  const discardConfirmation = source.slice(
    source.indexOf('function renderDiscardConfirmation()'),
    source.indexOf('function renderFinishedScreen()'),
  );
  assert.match(discardConfirmation, /returnAfterDiscard/, 'Discard local must clear local state directly');
});

test('Workout consumes asynchronous controller changes on its existing UI tick', () => {
  const source = readWidgetSource();
  const controllerSetup = source.slice(
    source.indexOf('workoutController = createWorkoutController({'),
    source.indexOf('const restored = workoutController.restore()')
  );
  const tick = source.slice(source.indexOf('function tick()'), source.indexOf('function startClock()'));
  const render = source.slice(source.indexOf('function renderUI()'), source.indexOf('function renderScreen()'));

  assert.match(controllerSetup, /onChange:\s*markControllerUiDirty/);
  assert.match(controllerSetup, /onStatus:\s*markControllerUiDirty/);
  assert.match(tick, /if \(controllerUiDirty\)[\s\S]*?renderUI\(\)/);
  assert.match(render, /consumeControllerUiChange\(\)/);
});

test('active steppers do not destroy their native button during click callbacks', () => {
  const source = readWidgetSource();
  const stepper = source.slice(
    source.indexOf('function renderStepper('),
    source.indexOf('function refreshActiveSetControls('),
  );
  const activeSet = source.slice(
    source.indexOf('function renderActiveSetScreen('),
    source.indexOf('function renderRestScreen('),
  );

  assert.match(stepper, /addLiveLabel\(`\$\{key\}-value`/);
  assert.match(stepper, /addLiveLabel\(`\$\{key\}-label`/);

  for (const adjustment of ['adjustWeight', 'adjustReps', 'adjustRpe']) {
    assert.doesNotMatch(
      activeSet,
      new RegExp(`${adjustment}\\([^;]+;\\s*renderUI\\(\\)`),
      `${adjustment} must not synchronously redraw and delete the active native button`,
    );
  }
  assert.match(
    activeSet,
    /refreshActiveSetControls\(\)/,
    'stepper callbacks must update persistent controls in place',
  );
});

test('overview screen includes visible Sync action wired to requestRefresh and keeps onResume refresh', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'data-widget', 'common', 'index.js'),
    'utf8',
  );

  const overview = source.slice(
    source.indexOf('function renderOverviewScreen('),
    source.indexOf('function renderNotesScreen(')
  );

  assert.match(overview, /text:\s*['"]Sync['"]/, 'Overview must have a visible Sync button');
  assert.match(
    overview,
    /workoutController\s*\.\s*requestRefresh\(\)/,
    'Sync button must call workoutController.requestRefresh()'
  );
  assert.match(
    overview,
    /text:\s*['"]Sync['"][\s\S]*text:\s*['"]Finish['"][\s\S]*text:\s*['"]Discard['"]/,
    'Action row must lay out Sync, Finish, and Discard buttons in order'
  );

  const onResume = source.slice(source.indexOf('onResume()'), source.indexOf('onPause()'));
  assert.match(onResume, /requestRefresh\(\)/, 'onResume must maintain requestRefresh()');
});

test('Workout shares Companion connection wording and bounded automatic retry', () => {
  const source = readWidgetSource();
  const load = extractFunction(source, 'startInitialNetworkLoad');
  const retry = extractFunction(source, 'scheduleConnectionRetry');
  assert.match(source, /PHONE_CONNECTING_MESSAGE/);
  assert.match(source, /PHONE_CONNECTION_TITLE/);
  assert.match(source, /phoneConnectionMessage\(connectionRetryAttempt\)/);
  assert.match(load, /isTemporaryPhoneError\(err\)[\s\S]*scheduleConnectionRetry\(\)/);
  assert.match(retry, /nextPhoneRetryDelay\(connectionRetryAttempt\)/);
  assert.doesNotMatch(source, /Open Zepp on your phone/);
});

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  return source.slice(start, source.indexOf('\nfunction ', start + 1));
}

test('top bar renders native BPM with a fixed heart even during sync warnings', () => {
  const source = readWidgetSource();
  for (const syncWarning of [null, 'Sync pending']) {
    const widgets = [];
    const render = new Function('addWidget', 'addLiveLabel', 'addLiveButton', 'widget', 'sport_data',
      'edit_widget_group_type', 'EXTENSION_TOP_BAR_LAYOUT', 'px', 'font', 'THEME',
      'align', 'text_style', 'formatSeconds', 'MENU_LABEL', 'syncWarning', 'openWorkoutTimerControls',
      `${extractFunction(source, 'renderTopBar')}; return renderTopBar;`)(
      (type, props) => widgets.push({ type, ...props }),
      (key, props) => widgets.push({ key, ...props }),
      (key, props) => widgets.push({ key, ...props }),
      { BUTTON: 'button', SPORT_DATA: 'sport', TEXT: 'text' }, { HR: 123 }, { SPORTS: 456 },
      { y: 48, height: 40, menu: { x: 100, width: 82 }, elapsed: { x: 186, width: 96 }, metric: { x: 286, width: 96 } },
      x => x, () => 20, {}, {}, { NONE: 789 }, String, '\u2261', syncWarning, () => {});
    render({ elapsedSeconds: 12 }, () => {});
    const hr = widgets.find(w => w.type === 'sport');
    const heart = widgets.find(w => w.key === 'heart' && w.text === '\u2665');
    assert.ok(hr, 'BPM must be a native sport widget');
    assert.ok(heart, 'BPM must have a fixed heart icon');
    assert.equal(hr.default_type, 123);
    assert.equal(hr.category, 456);
    assert.equal(hr.sub_text_visible, false);
    assert.equal(heart.text_style, 789);
    assert.ok(heart.w >= 32, 'Heart glyph needs enough fixed width to avoid clipping');
    assert.ok(hr.x > heart.x);
    assert.ok(hr.x + hr.w <= 286 + 96);
    assert.ok(!widgets.some(w => w.key === 'sport-metric'));
  }
});

test('rest pause keeps its native button alive until the click callback returns', () => {
  const source = readWidgetSource();
  const restScreen = extractFunction(source, 'renderRestScreen');
  const pauseStart = restScreen.indexOf("addLiveButton('restPause'");
  const pauseEnd = restScreen.indexOf('addWidget(widget.BUTTON', pauseStart);
  const pauseControl = restScreen.slice(pauseStart, pauseEnd);

  assert.ok(pauseStart >= 0, 'Pause must use a persistent native button');
  assert.match(pauseControl, /workoutController\.toggleRestPause\(\)/);
  assert.doesNotMatch(
    pauseControl,
    /renderUI\(\)/,
    'Pause must not delete its active native button synchronously',
  );
});

test('native workout destruction performs no device work and blocks late redraws', () => {
  const source = readWidgetSource();
  const renderUI = extractFunction(source, 'renderUI');
  const onDestroy = source.slice(source.indexOf('onDestroy()'), source.indexOf('onReceivedFile', source.indexOf('onDestroy()')));

  assert.match(source, /let isTearingDown = false/);
  assert.match(renderUI, /if \(isTearingDown \|\| !hasBuilt\) return/);
  assert.match(onDestroy, /isTearingDown = true/);
  assert.match(onDestroy, /hasBuilt = false/);
  assert.match(onDestroy, /exerciseImages\?\.abandon\(\)/);
  assert.match(onDestroy, /workoutController\?\.dispose\(\)/);
  assert.doesNotMatch(
    onDestroy,
    /resetDisplayHold|stopVibration|clearWidgets|exerciseImages\??\.dispose\(|\.persist\(|renderUI\(|request\(/,
    'onDestroy must not call native device, persistence, transport, or UI work',
  );
});

test('exercise Info stays available with missing details and explains the empty state', () => {
  const source = readWidgetSource();
  assert.ok(source.includes('function renderExerciseInfo('), 'Exercise Info must have one renderer');
  for (const details of [null, '', 'Keep shoulders pinned']) {
    let button;
    let opened;
    let openedTitle;
    const render = new Function('addWidget', 'widget', 'px', 'font', 'THEME', 'openNotes',
      `${extractFunction(source, 'renderExerciseInfo')}; return renderExerciseInfo;`)(
      (type, props) => { button = props; }, { BUTTON: 'button' }, x => x,
      () => 20, {}, (title, content) => { opened = content; openedTitle = title; });
    render('Bench Press', details, 88, 36);
    assert.equal(button.text, 'Info');
    button.click_func();
    assert.equal(openedTitle, 'Bench Press');
    assert.doesNotMatch(opened, /Bench Press/);
    assert.ok(opened.includes(details || 'No exercise notes or description available.'));
  }
  for (const name of ['renderActiveSetScreen', 'renderRestScreen']) {
    const body = extractFunction(source, name);
    assert.match(body, /renderExerciseInfo\(/);
    assert.doesNotMatch(body, /if \(exerciseDetails\)|if \(rest.nextExerciseDetails\)/);
  }
});

test('expired rest replaces Prepare and Start set with one full-width Start set action', () => {
  const source = readWidgetSource();
  for (const remaining of [1, 0, -10]) {
    const buttons = [];
    let started = 0;
    const env = {
      ...watchLayout, renderTopBar() {}, addLiveLabel() {},
      addLiveButton: (key, props) => buttons.push({ key, ...props }),
      addWidget: (type, props) => buttons.push(props), widget: { BUTTON: 1 },
      px: x => x, font: () => 20, THEME: {}, align: {}, text_style: {}, formatSeconds: String,
      restAlertTracker: { reset() {} }, stopVibration() {}, isRestMinimized: false,
      setRestPrepared(value) { env.isRestMinimized = value; },
      workoutController: { nextSet: () => { started++; } }, renderUI() {}, scheduleRenderUI() {}, openWorkoutTimerControls() {},
    };
    const render = new Function('env', `with (env) { ${extractFunction(source, 'renderRestScreen')}; return renderRestScreen; }`)(env);
    render({ rest: { remaining, isPaused: false } });
    const prepare = buttons.find(button => button.text === 'Prepare');
    const start = buttons.find(button => button.text === 'Start set');
    if (remaining > 0) {
      assert.ok(prepare);
      assert.equal(start.x, 226);
      assert.equal(start.w, 190);
    } else {
      assert.equal(prepare, undefined);
      assert.equal(start.x, 64);
      assert.equal(start.w, 352);
    }
    assert.equal(start.y, 370);
    assert.equal(start.h, 58);
    start.click_func();
    assert.equal(started, 1);
    buttons.length = 0;
    render({ rest: { remaining, isPaused: false }, timedSet: { phase: 'REST' } });
    assert.ok(buttons.some(button => button.text === 'Armed'));
  }
});

test('timer expiry redraws the rest actions once without starting an unprepared set', () => {
  let renders = 0;
  let starts = 0;
  const view = { state: 'REST', rest: { remaining: 0, isPaused: false }, elapsedSeconds: 60 };
  const env = {
    updatePreparedRestVisuals() {},
    updateClock() {}, screen: 'SESSION', EXTENSION_SCREENS: { SESSION: 'SESSION' },
    isTearingDown: false, isPaused: false, hasBuilt: true,
    SESSION_STATES: { REST: 'REST' }, controllerUiDirty: false,
    refreshSportMetrics() {}, retryPendingWrites() {},
    workoutController: { view: () => view, advanceTimedSet() {}, pollCurrent: async () => false, nextSet: () => { starts++; } },
    updateTimedSetScreen() {},
    syncWarning: null, updateSyncWarning() {}, handlePollFailure() {},
    lastRenderedState: 'REST', lastRenderedSecond: 1, isRestMinimized: false, liveWidgets: { restValue: {} },
    restAlertTracker: { checkTick: () => ({ shouldAlert: false }) },
    restStatusColor: () => 0, THEME: {}, formatSeconds: String, updateLiveWidget() {},
    renderUI: () => { renders++; env.lastRenderedSecond = view.rest.remaining; },
  };
  const tick = new Function('env', `with (env) { ${extractFunction(readWidgetSource(), 'tick')}; return tick; }`)(env);
  tick();
  assert.equal(renders, 1);
  view.rest.remaining = -1;
  tick();
  assert.equal(renders, 1);
  assert.equal(starts, 0);
});

test('saved extension finish shows a rightward hint instead of a misleading Done action', () => {
  const source = readWidgetSource();
  const body = extractFunction(source, 'renderFinishedScreen');
  assert.match(body, /Swipe right/);
  assert.match(body, /renderFinishSwipeHint\(\)/);
  assert.doesNotMatch(body, /text: 'Done'/);
  const nativeUpdates = [];
  const nativeEnv = {
    isTearingDown: false, isPaused: false, hasBuilt: true,
    liveWidgets: {}, LAYOUT: { fit: props => props }, px: x => x,
    widget: { TEXT: 'TEXT' }, THEME: {}, font: () => 40, align: {}, text_style: {},
    prop: { MORE: 'MORE' }, LIVE_WIDGET_MUTABLE_KEYS: ['x', 'y', 'w', 'h', 'text'],
    addRawWidget: () => ({ setProperty: (_, props) => nativeUpdates.push(props) }),
  };
  const renderHint = new Function('env', `with (env) {
    ${extractFunction(source, 'updateLiveWidget')}
    ${extractFunction(source, 'updateFinishSwipeHint')}
    ${extractFunction(source, 'renderFinishSwipeHint')}
    return renderFinishSwipeHint;
  }`)(nativeEnv);
  renderHint();
  assert.equal(nativeUpdates.length, 1);
  assert.equal(nativeUpdates[0].text, '>>');
  const positions = [];
  const env = { liveWidgets: { finishSwipe: {} }, px: x => x, LAYOUT: { fit: props => ({ ...props, x: props.x + 12 }) },
    updateLiveWidget: (_, props) => positions.push(props.x) };
  const update = new Function('env', `with (env) { ${extractFunction(source, 'updateFinishSwipeHint')}; return updateFinishSwipeHint; }`)(env);
  for (const now of [0, 1000, 2000, 3000]) update(now);
  assert.deepEqual(positions, [142, 222, 302, 142]);
  env.liveWidgets = {};
  update(4000);
  assert.equal(positions.length, 4);
});

test('completing active set and initiating terminal submission do not synchronously call renderUI', () => {
  const source = readWidgetSource();
  const activeSet = extractFunction(source, 'renderActiveSetScreen');
  const actionButton = activeSet.slice(activeSet.lastIndexOf('addWidget(widget.BUTTON'));
  const submitWorkout = extractFunction(source, 'submitWorkout');

  assert.match(actionButton, /workoutController\.completeSet\(/);
  assert.doesNotMatch(
    actionButton,
    /renderUI\(\)/,
    'Active set action button must not synchronously redraw and delete itself during click callback',
  );

  const initialSubmit = submitWorkout.slice(0, submitWorkout.indexOf('finishWorkoutRemote'));
  assert.doesNotMatch(
    initialSubmit,
    /renderUI\(\)/,
    'Initiating terminal submission must not synchronously call renderUI',
  );
  assert.match(
    initialSubmit,
    /controllerUiDirty\s*=\s*true/,
    'Initiating terminal submission must defer redraw via controllerUiDirty',
  );
});

test('skipping a warmup defers the Workout redraw until after the native callback', () => {
  const source = readWidgetSource();
  const activeSet = extractFunction(source, 'renderActiveSetScreen');
  const skipStart = activeSet.indexOf("text: 'Skip'");
  const skipButton = activeSet.slice(activeSet.lastIndexOf('addWidget(widget.BUTTON', skipStart), activeSet.indexOf('});', skipStart) + 3);
  assert.match(skipButton, /workoutController\.skipWarmup\(/);
  assert.match(skipButton, /controllerUiDirty\s*=\s*true/);
  assert.doesNotMatch(skipButton, /renderUI\(\)/);
});

test('prepared active set UI matches contracts: no purple pill, > Start set countdown, purple changes, no overlap, skip left', () => {
  const source = readWidgetSource();
  assert.doesNotMatch(source, /restBannerText/);
  assert.doesNotMatch(source, /renderChangeUnderline/);

  const activeSet = extractFunction(source, 'renderActiveSetScreen');
  assert.match(activeSet, /> Start set/);
  assert.doesNotMatch(activeSet, /\\u25b6/);

  const widgets = [];
  const liveWidgets = {};
  const THEME = {
    bg: 0x000000,
    card: 0x1c1c1e,
    cardActive: 0x2c2c2e,
    primary: 0x6e56cf,
    primaryLight: 0x9e8cfc,
    primaryDark: 0x3e26af,
    textPrimary: 0xffffff,
    textSecondary: 0x8e8e93,
    success: 0x30d158,
    yellow: 0xffd60a,
    error: 0xff453a,
    orange: 0xff9f0a,
  };

  const env = {
    ...watchLayout,
    isPurpleRestRing,
    darkenColor,
    updatePreparedRestVisuals() {},
    THEME,
    widget: { BUTTON: 'button', TEXT: 'text', SPORT_DATA: 'sport_data', STROKE_RECT: 'stroke_rect' },
    sport_data: { HR: 1 },
    edit_widget_group_type: { SPORTS: 2 },
    align: { CENTER_H: 1, CENTER_V: 2, LEFT: 3 },
    text_style: { NONE: 0 },
    px: (x) => x,
    font: (role) => watchLayout.TYPOGRAPHY[role] || 20,
    formatSeconds: (sec) => {
      const isNeg = sec < 0;
      const abs = Math.abs(sec);
      const m = Math.floor(abs / 60);
      const s = String(abs % 60).padStart(2, '0');
      return `${isNeg ? '-' : ''}${m}:${s}`;
    },
    formatActiveSetProgress: () => 'SET 1/3',
    formatLoadoutLabel: () => '100 KG',
    formatEditableSetValue: (val) => String(val),
    truncate: (t) => t,
    supersetColor: () => 0xffffff,
    MENU_LABEL: '\u2261',
    syncWarning: null,
    liveHr: 72,
    heartRateColor: () => 0xffffff,
    formatHeartRate: (hr) => `${hr} bpm`,
    SESSION_STATES: { REST: 'REST', FINISHED: 'FINISHED' },
    renderRestBezel: () => {},
    renderPreparationImage: () => false,
    openNotes: () => {},
    openWorkoutTimerControls: () => {},
    checkRequiredPhoneInput: () => null,
    stopVibration: () => {},
    setRestPrepared: () => {},
    workoutController: {
      skipWarmup: () => false,
      adjustWeight: () => {},
      adjustReps: () => {},
      adjustRpe: () => {},
      completeSet: () => {},
      nextSet: () => {},
      startTimedSet: () => {},
      view: () => ({}),
    },
    submitWorkout: () => {},
    scheduleRenderUI: () => {},
    consumeControllerUiChange: () => {},
    controllerUiDirty: false,
    liveWidgets,
    addWidget: (type, props) => {
      const entry = { type, ...props };
      widgets.push(entry);
      return entry;
    },
    addLiveLabel: (key, props) => {
      const entry = { key, ...props };
      liveWidgets[key] = { widget: entry, props: { ...props } };
      widgets.push(entry);
      return entry;
    },
    addLiveButton: (key, props) => {
      const entry = { key, ...props };
      liveWidgets[key] = { widget: entry, props: { ...props } };
      widgets.push(entry);
      return entry;
    },
    updateLiveWidget: (key, props) => {
      if (liveWidgets[key]) {
        Object.assign(liveWidgets[key].props, props);
        return true;
      }
      return true;
    },
  };

  const view = {
    state: 'REST',
    rest: { remaining: 59, isPaused: false, isOvertime: false },
    pending: {
      setIndex: 0,
      totalSets: 3,
      exerciseName: 'Warmup Squat',
      exerciseDetails: 'Deep squat',
      exerciseImageUrl: null,
      loadingEquipment: 'barbell',
      changes: { exercise: true, weight: true, reps: false, rpe: false },
      set: { isWarmup: true, weight: 60, reps: 5, targetRpe: null },
    },
    currentSet: { isWarmup: true, weight: 60, reps: 5, targetRpe: null },
    exerciseName: 'Warmup Squat',
    exerciseDetails: 'Deep squat',
    currentSetIndex: 0,
    totalSets: 3,
    unit: 'kg',
    elapsedSeconds: 125,
    isWorkoutPaused: false,
  };

  const renderActiveSetScreen = new Function('env', `with (env) {
    ${extractFunction(source, 'restStatusColor')}
    ${extractFunction(source, 'renderPreparedTopBar')}
    ${extractFunction(source, 'renderExerciseInfo')}
    ${extractFunction(source, 'renderStepper')}
    ${extractFunction(source, 'renderActiveSetScreen')}
    return renderActiveSetScreen;
  }`)(env);

  renderActiveSetScreen(view);

  // 1. Top bar: no purple restBannerText
  assert.equal(widgets.some(w => w.key === 'restBannerText'), false, 'Top bar must not contain restBannerText');
  const elapsedWidget = widgets.find(w => w.key === 'elapsed');
  assert.ok(elapsedWidget, 'Elapsed button must be present in top bar');

  // 2. Skip on left, Info on right, distinct hitboxes
  const skipWidget = widgets.find(w => w.text === 'Skip');
  const infoWidget = widgets.find(w => w.text === 'Info');
  assert.ok(skipWidget, 'Skip button must be present for warmup');
  assert.ok(infoWidget, 'Info button must be present');
  assert.ok(skipWidget.x <= 100, `Skip must be on the left (got x=${skipWidget.x})`);
  assert.ok(infoWidget.x >= 340, `Info must be on the right (got x=${infoWidget.x})`);
  assert.ok(skipWidget.x + skipWidget.w < infoWidget.x, 'Skip and Info must have distinct hitboxes');

  // Title and progress fit between Skip and Info without overlap
  const titleWidget = widgets.find(w => w.key === 'exerciseTitle' || (w.text && w.text.includes('Warmup')));
  assert.ok(titleWidget, 'Exercise title must be present');
  assert.ok(titleWidget.x >= skipWidget.x + skipWidget.w, 'Title must not overlap Skip on the left');
  assert.ok(titleWidget.x + titleWidget.w <= infoWidget.x, 'Title must not overlap Info on the right');

  // 3. Changed colors: exercise title and weight value must be purple (THEME.primaryLight)
  assert.equal(titleWidget.color, THEME.primaryLight, 'Changed exercise title must use purple primaryLight');
  const weightValue = widgets.find(w => w.key === 'weight-value');
  const repsValue = widgets.find(w => w.key === 'reps-value');
  assert.equal(weightValue.color, THEME.primaryLight, 'Changed weight value must use purple primaryLight');
  assert.equal(repsValue.color, THEME.textPrimary, 'Unchanged reps value must use textPrimary');

  // 4. Stepper line-box breathing room and no value/label overlap
  const weightLabel = widgets.find(w => w.key === 'weight-label');
  assert.ok(weightValue.h > watchLayout.TYPOGRAPHY.value, `Value height ${weightValue.h} must be > font size for breathing room`);
  assert.ok(weightLabel.y >= weightValue.y + weightValue.h, `Label y ${weightLabel.y} must not overlap value bottom ${weightValue.y + weightValue.h}`);

  // 5. Action button: > Start set 0:59
  const actionButton = widgets.find(w => typeof w.text === 'string' && w.text.includes('Start set'));
  assert.ok(actionButton, 'Start set action button must be present');
  assert.equal(actionButton.text, '> Start set 0:59', 'Must use plain ASCII > and live rest countdown');
  assert.equal(actionButton.x, watchLayout.ACTIVE_SET_ACTION_LAYOUT.x);
  assert.equal(actionButton.w, watchLayout.ACTIVE_SET_ACTION_LAYOUT.width);
});

test('tick updates prepared Start set action in place across zero, overtime, and pause without auto-completing', () => {
  const source = readWidgetSource();
  let uiRedrawn = false;
  let nextSetCalled = false;

  const liveWidgets = {
    actionButton: { widget: {}, props: { text: '> Start set 1:00' } },
    elapsed: { widget: {}, props: { text: '0:00' } },
    restBezel: { widget: {}, props: { color: 0 } },
  };

  const env = {
    ...watchLayout,
    isPurpleRestRing,
    updatePreparedRestVisuals() {},
    THEME: { yellow: 0xffff00, error: 0xff0000, primaryPale: 0x9999ff, textSecondary: 0x888888, primaryLight: 0x9e8cfc },
    formatSeconds: (sec) => {
      const isNeg = sec < 0;
      const abs = Math.abs(sec);
      const m = Math.floor(abs / 60);
      const s = String(abs % 60).padStart(2, '0');
      return `${isNeg ? '-' : ''}${m}:${s}`;
    },
    restStatusColor: () => 0x6e56cf,
    workoutController: {
      view: () => env.currentView,
      nextSet: () => { nextSetCalled = true; },
      pollCurrent: () => Promise.resolve(false),
      advanceTimedSet: () => {},
    },
    renderUI: () => { uiRedrawn = true; },
    isTearingDown: false,
    isPaused: false,
    hasBuilt: true,
    screen: 'SESSION',
    EXTENSION_SCREENS: { SESSION: 'SESSION' },
    SESSION_STATES: { REST: 'REST', FINISHED: 'FINISHED' },
    controllerUiDirty: false,
    refreshSportMetrics: () => {},
    retryPendingWrites: () => {},
    updateTimedSetScreen: () => {},
    restAlertTracker: { checkTick: () => ({ shouldAlert: false }) },
    lastRenderedState: 'REST',
    updateClock: () => {},
    handlePollFailure: () => {},
    updateSyncWarning: () => {},
    syncWarning: null,
    liveWidgets,
    lastRenderedSecond: null,
    updateLiveWidget: (key, props) => {
      if (liveWidgets[key]) {
        Object.assign(liveWidgets[key].props, props);
        return true;
      }
      return true;
    },
  };

  const tick = new Function('env', `with (env) {
    ${extractFunction(source, 'tick')}
    return tick;
  }`)(env);

  // Normal countdown tick: 59s
  env.currentView = { state: 'REST', rest: { remaining: 59, isPaused: false, isOvertime: false }, elapsedSeconds: 10 };
  tick();
  assert.equal(liveWidgets.actionButton.props.text, '> Start set 0:59');
  assert.equal(uiRedrawn, false);
  assert.equal(nextSetCalled, false);

  // Countdown tick: 0s (zero must update in place without starting set)
  env.currentView = { state: 'REST', rest: { remaining: 0, isPaused: false, isOvertime: false }, elapsedSeconds: 69 };
  tick();
  assert.equal(liveWidgets.actionButton.props.text, '> Start set 0:00');
  assert.equal(uiRedrawn, false);
  assert.equal(nextSetCalled, false);

  // Countdown tick: -5s (overtime must update in place)
  env.currentView = { state: 'REST', rest: { remaining: -5, isPaused: false, isOvertime: true }, elapsedSeconds: 74 };
  tick();
  assert.equal(liveWidgets.actionButton.props.text, '> Start set -0:05');
  assert.equal(uiRedrawn, false);
  assert.equal(nextSetCalled, false);

  // Paused rest
  env.currentView = { state: 'REST', rest: { remaining: 45, isPaused: true, isOvertime: false }, elapsedSeconds: 75 };
  tick();
  assert.equal(liveWidgets.actionButton.props.text, '> Start set 0:45');
  assert.equal(uiRedrawn, false);
  assert.equal(nextSetCalled, false);

  // Timed set in REST phase
  env.currentView = { state: 'REST', rest: { remaining: 30, isPaused: false }, timedSet: { phase: 'REST' }, elapsedSeconds: 80 };
  tick();
  assert.equal(liveWidgets.actionButton.props.text, 'Armed');
  assert.equal(uiRedrawn, false);
  assert.equal(nextSetCalled, false);
});
