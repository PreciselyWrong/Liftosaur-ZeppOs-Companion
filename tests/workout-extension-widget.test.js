import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

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

  // 11. Screen controls from @zos/display and safe reset in onPause / onDestroy
  assert.match(source, /from\s+['"]@zos\/display['"]/, 'Must import display controls from @zos/display');
  assert.match(source, /setPageBrightTime/, 'Must set the focused page bright time');
  assert.match(source, /pauseDropWristScreenOff/, 'Must prevent wrist-drop screen off while focused');
  assert.match(source, /pausePalmScreenOff/, 'Must prevent palm screen off while focused');

  const onPause = source.slice(source.indexOf('onPause()'), source.indexOf('onDestroy()'));
  const onDestroy = source.slice(source.indexOf('onDestroy()'));
  assert.match(onPause, /resetDisplayHold/, 'onPause must safely reset screen controls');
  assert.match(onDestroy, /resetDisplayHold/, 'onDestroy must safely reset screen controls');

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
  assert.match(source, /text: syncWarning \? 'Sync!' : 'Menu'/, 'Keep a visible sync warning outside BPM');

  // 15. Rest completion must use Zepp's dedicated strong reminder pattern.
  assert.match(
    source,
    /VIBRATOR_SCENE_STRONG_REMINDER/,
    'Rest completion must use the four-pulse strong reminder vibration',
  );
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
  assert.match(source, /shouldAutoStartPreparedSet/, 'Prepare must auto-start when rest expires');

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

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  return source.slice(start, source.indexOf('\nfunction ', start + 1));
}

test('top bar renders native BPM without a live text ticker even during sync warnings', () => {
  const source = readWidgetSource();
  for (const syncWarning of [null, 'Sync pending']) {
    const widgets = [];
    const render = new Function('addWidget', 'addLiveLabel', 'widget', 'sport_data',
      'edit_widget_group_type', 'EXTENSION_TOP_BAR_LAYOUT', 'px', 'font', 'THEME',
      'align', 'text_style', 'formatSeconds', 'syncWarning',
      `${extractFunction(source, 'renderTopBar')}; return renderTopBar;`)(
      (type, props) => widgets.push({ type, ...props }),
      (key, props) => widgets.push({ key, ...props }),
      { BUTTON: 'button', SPORT_DATA: 'sport' }, { HR: 123 }, { SPORTS: 456 },
      { y: 48, height: 40, menu: { x: 100, width: 82 }, elapsed: { x: 186, width: 96 }, metric: { x: 286, width: 96 } },
      x => x, () => 20, {}, {}, {}, String, syncWarning);
    render({ elapsedSeconds: 12 }, () => {});
    const hr = widgets.find(w => w.type === 'sport');
    assert.ok(hr, 'BPM must be a native sport widget');
    assert.equal(hr.default_type, 123);
    assert.equal(hr.category, 456);
    assert.equal(hr.sub_text_visible, false);
    assert.equal(hr.x, 286);
    assert.equal(hr.w, 96);
    assert.ok(!widgets.some(w => w.key === 'sport-metric'));
  }
});
