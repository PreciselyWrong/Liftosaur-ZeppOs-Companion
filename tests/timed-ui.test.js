import test from 'node:test';
import assert from 'node:assert/strict';
import { TIMED_SET_LAYOUT, EXTENSION_CLOCK_LAYOUT } from '../shared/watch-layout.js';
import { timedSetPresentation } from '../shared/timed-set-ui.js';
import { captureTimedScreen } from './helpers/timed-renderer.js';

test('preparation announces the upcoming side and effort, not rest', () => {
  const ui = timedSetPresentation({ phase: 'GET_READY', side: 'RIGHT', remaining: 4, targetSeconds: 30 });
  assert.equal(ui.value, '4');
  assert.equal(ui.label, 'Get Ready');
  assert.equal(ui.detail, 'then 0:30');
  assert.equal(ui.action, 'Start now');
});

test('effort passes its target without inventing automatic completion', () => {
  const ui = timedSetPresentation({ phase: 'WORK', remaining: -7, elapsedSeconds: 37, targetSeconds: 30 });
  assert.equal(ui.value, '+0:07');
  assert.equal(ui.action, 'Stop');
  assert.equal(ui.progress, 0);
});

test('native or local pause is visible', () => {
  for (const paused of [{ isPaused: true }, { isWorkoutPaused: true }]) {
    const timer = { phase: 'WORK', remaining: 12, targetSeconds: 30, ...paused };
    const ui = timedSetPresentation(timer);
    assert.equal(ui.label, paused.isWorkoutPaused ? 'Workout paused' : 'Paused');
    assert.equal(ui.pauseAction, paused.isWorkoutPaused ? 'Paused' : 'Resume');
    for (const product of ['page', 'data-widget']) {
      const capture = captureTimedScreen(product, timer);
      const action = capture.widgets.find((w) => w.text === ui.pauseAction && w.click_func);
      assert.ok(action);
      assert.ok(action.text.length <= 6);
      assert.equal(capture.widgets.find((w) => w.key === 'timedLabel').text, ui.label);
    }
  }
});


function verifyTimedControls(product) {
    const capture = captureTimedScreen(product, { phase: 'WORK', side: 'LEFT', remaining: 24, elapsedSeconds: 6, targetSeconds: 30 });
    capture.widgets.find((w) => w.text === 'Pause').click_func();
    assert.deepEqual(capture.actions, ['pause']);
    assert.equal(capture.context.controllerUiDirty, true);
    const count = capture.widgets.length;
    capture.view.timedSet.remaining = -1;
    capture.context.updateTimedSetScreen(capture.view);
    capture.context.updateTimedSetScreen(capture.view);
    assert.equal(capture.widgets.length, count);
    assert.equal(capture.widgets.find((w) => w.key === 'timedValue').text, '+0:01');
    assert.deepEqual(capture.actions, ['pause', 'buzz']);
    const stop = capture.widgets.find((w) => w.text === 'Stop');
    assert.ok(stop.y + stop.h <= EXTENSION_CLOCK_LAYOUT.y - EXTENSION_CLOCK_LAYOUT.minimumActionGap);
}
function verifyPreparationControls(product) {
    for (const isWorkoutPaused of [false, true]) {
      const capture = captureTimedScreen(product, { phase: 'GET_READY', side: 'RIGHT', remaining: 4, targetSeconds: 30, isWorkoutPaused });
      capture.widgets.find((w) => w.text === 'Start now').click_func();
      assert.deepEqual(capture.actions, isWorkoutPaused ? [] : ['start']);
      assert.equal(capture.widgets.find((w) => w.key === 'timedSide').text, 'SET 1/2 - RIGHT');
    }
}

test('Companion timer callbacks persist and tick patches widgets', () => verifyTimedControls('page'));
test('Workout timer callbacks persist and tick patches widgets', () => verifyTimedControls('data-widget'));
test('Companion preparation respects native pause', () => verifyPreparationControls('page'));
test('Workout preparation respects native pause', () => verifyPreparationControls('data-widget'));

test('timer ring clears labels and long overtime uses readable smaller digits', () => {
  const layout = TIMED_SET_LAYOUT;
  assert.ok(layout.centerY + layout.radius + layout.dotSize / 2 <= layout.labelY);
  assert.ok(layout.valueX > layout.centerX - layout.radius + layout.dotSize / 2);
  assert.ok(layout.valueX + layout.valueWidth < layout.centerX + layout.radius - layout.dotSize / 2);
  const timer = timedSetPresentation({ phase: 'WORK', remaining: -600, targetSeconds: 30 });
  assert.equal(timer.value, '+10:00');
  assert.equal(timer.valueFont, 'value');
  for (const product of ['page', 'data-widget']) {
    const capture = captureTimedScreen(product, { phase: 'GET_READY', remaining: 4, targetSeconds: 30 });
    const value = capture.widgets.find((w) => w.key === 'timedValue');
    for (const dot of capture.widgets.filter((w) => w.key?.startsWith('timedSegment'))) {
      const overlaps = dot.x < value.x + value.w && dot.x + dot.w > value.x
        && dot.y < value.y + value.h && dot.y + dot.h > value.y;
      assert.equal(overlaps, false, `${product} ${dot.key} must clear timer background`);
    }
  }
});
