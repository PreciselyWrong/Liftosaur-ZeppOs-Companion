import test from 'node:test';
import assert from 'node:assert/strict';
import { captureTimedScreen } from './helpers/timed-renderer.js';

function verifyFreshPause(product) {
    const capture = captureTimedScreen(product, { phase: 'WORK', side: 'LEFT', remaining: 20, targetSeconds: 30 });
    capture.context.workoutController.view = () => capture.view;
    const pause = capture.widgets.find(widget => widget.text === 'Pause');
    pause.click_func();
    capture.view.timedSet = { ...capture.view.timedSet, isPaused: true };
    pause.click_func();
    assert.deepEqual(capture.actions, ['pause', 'resume']);
}

function verifyStaleStop(product) {
    const capture = captureTimedScreen(product, { phase: 'WORK', side: 'LEFT', remaining: 20, targetSeconds: 30 });
    capture.context.workoutController.view = () => capture.view;
    const stop = capture.widgets.find(widget => widget.text === 'Stop');
    capture.view.timedSet = { ...capture.view.timedSet, side: 'RIGHT' };
    stop.click_func();
    assert.deepEqual(capture.actions, []);
}

function verifySideAlerts(product) {
    const capture = captureTimedScreen(product, { phase: 'WORK', side: 'LEFT', remaining: 0, targetSeconds: 30 });
    capture.context.updateTimedSetScreen(capture.view);
    capture.view.timedSet = { ...capture.view.timedSet, side: 'RIGHT', remaining: -5 };
    capture.context.updateTimedSetScreen(capture.view);
    capture.context.updateTimedSetScreen(capture.view);
    assert.equal(capture.actions.filter(action => action === 'buzz').length, 2);
}

test('Companion persistent pause callback follows latest pause state', () => verifyFreshPause('page'));
test('Workout persistent pause callback follows latest pause state', () => verifyFreshPause('data-widget'));
test('Companion stale left stop cannot finish the right side', () => verifyStaleStop('page'));
test('Workout stale left stop cannot finish the right side', () => verifyStaleStop('data-widget'));
test('Companion each side alerts after sleep past target', () => verifySideAlerts('page'));
test('Workout each side alerts after sleep past target', () => verifySideAlerts('data-widget'));
