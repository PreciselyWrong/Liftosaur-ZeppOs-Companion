import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readProductSource(product) {
  return fs.readFileSync(path.join(process.cwd(), product, 'common', 'index.js'), 'utf8');
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  return source.slice(start, source.indexOf('\nfunction ', start + 1));
}

for (const product of ['page', 'data-widget']) {
  test(`${product} opens global pause controls from the purple elapsed timer`, () => {
    const source = readProductSource(product);
    const topBar = extractFunction(source, 'renderTopBar');
    const preparedTopBar = extractFunction(source, 'renderPreparedTopBar');
    const open = extractFunction(source, 'openWorkoutTimerControls');
    const root = extractFunction(source, 'renderScreen');

    assert.match(source, /let isWorkoutTimerControlsOpen = false/);
    assert.match(topBar, /addLiveButton\('elapsed'/);
    assert.match(topBar, /click_func: openWorkoutTimerControls/);
    assert.match(preparedTopBar, /addLiveButton\('elapsed'/);
    assert.match(preparedTopBar, /click_func: openWorkoutTimerControls/);
    assert.match(open, /isWorkoutTimerControlsOpen = true/);
    assert.match(open, /controllerUiDirty = true/);
    assert.doesNotMatch(open, /renderUI\(\)/);
    assert.match(root, /isWorkoutTimerControlsOpen[\s\S]*renderWorkoutTimerControlsModal/);
  });

  test(`${product} timer modal pauses the whole Lifto workout and closes safely`, () => {
    const source = readProductSource(product);
    const modal = extractFunction(source, 'renderWorkoutTimerControlsModal');
    const close = extractFunction(source, 'closeWorkoutTimerControls');

    assert.match(modal, /addLiveLabel\('workoutTimerModalValue'/);
    assert.match(modal, /addLiveButton\('workoutTimerModalPause'/);
    assert.match(modal, /isWorkoutPaused \? 'Resume' : 'Pause'/);
    assert.match(modal, /workoutController\.pauseWorkout\(\)/);
    // A native pause must stay force-resumable when Zepp data never shows the resume.
    assert.match(modal, /workoutController\.forceResumeWorkout\(\)/);
    assert.doesNotMatch(modal, /isNativeWorkoutPaused && !current\.isManualWorkoutPaused\) return/);
    assert.match(modal, /click_func: closeWorkoutTimerControls/);
    assert.match(close, /isWorkoutTimerControlsOpen = false/);
    assert.match(close, /controllerUiDirty = true/);
    assert.doesNotMatch(close, /renderUI\(\)/);
  });
}

test('data-widget tells the native pause reconciler about a restored native pause', () => {
  const refresh = extractFunction(readProductSource('data-widget'), 'refreshSportMetrics');
  assert.match(refresh, /isNativePaused: Boolean\(view\?\.isNativeWorkoutPaused\)/);
});
