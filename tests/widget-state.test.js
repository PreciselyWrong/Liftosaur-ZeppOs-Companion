/**
 * The widget state is pure and framework-free so it can be tested off-device.
 * The DataWidget only renders what this module reports.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createWidgetState, NO_HEART_RATE } from '../data-widget/common/state.js';

test('starts in READY with no heart rate', () => {
  const state = createWidgetState();
  const view = state.view();
  assert.equal(view.title, 'Liftosaur');
  assert.equal(view.status, 'READY');
  assert.equal(view.hr, NO_HEART_RATE);
});


test('one click produces exactly one transition', () => {
  const state = createWidgetState();
  state.click();
  assert.equal(state.view().status, 'TEST');
  assert.equal(state.transitionCount(), 1);
});

test('clicks alternate READY and TEST', () => {
  const state = createWidgetState();
  state.click();
  state.click();
  assert.equal(state.view().status, 'READY');
  assert.equal(state.transitionCount(), 2);
});

test('renders a heart rate once one is reported', () => {
  const state = createWidgetState();
  state.setHeartRate(128);
  assert.equal(state.view().hr, '128');
});

test('ignores a missing or invalid heart rate instead of rendering junk', () => {
  const state = createWidgetState();
  state.setHeartRate(140);
  for (const bad of [null, undefined, 0, -1, NaN, '12x']) {
    state.setHeartRate(bad);
    assert.equal(state.view().hr, '140', `value ${String(bad)} should be ignored`);
  }
});

test('a heart rate update is not a state transition', () => {
  const state = createWidgetState();
  state.setHeartRate(128);
  assert.equal(state.transitionCount(), 0);
  assert.equal(state.view().status, 'READY');
});
