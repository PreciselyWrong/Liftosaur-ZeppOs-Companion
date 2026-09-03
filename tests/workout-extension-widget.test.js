import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

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

  // 6. Sport data (duration and calories)
  assert.match(source, /getSportData\(\s*\{\s*type:\s*['"]duration['"]\s*\}/, 'Must query sport duration');
  assert.match(source, /getSportData\(\s*\{\s*type:\s*['"]calories['"]\s*\}/, 'Must query sport calories');

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
  assert.match(source, /syncWarning\s*\?\s*truncate\(syncWarning/, 'Metric refresh must preserve sync warnings');

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
