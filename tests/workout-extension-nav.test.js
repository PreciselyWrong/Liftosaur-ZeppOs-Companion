import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXTENSION_SCREENS,
  EXTENSION_TOP_BAR_LAYOUT,
  checkRequiredPhoneInput,
  formatSeconds,
  formatWeightValue,
  formatTargetRepsSummary,
  supersetColor,
} from '../shared/workout-extension-nav.js';

test('extension top bar stays inside the visible chord of a 480px round screen', () => {
  const { y, height, menu, elapsed, metric, restBanner } = EXTENSION_TOP_BAR_LAYOUT;
  const radius = 240;
  const topInset = radius - Math.sqrt(radius ** 2 - (radius - y) ** 2);
  const visibleRight = 480 - topInset;

  assert.ok(menu.x >= topInset);
  assert.ok(menu.x + menu.width <= elapsed.x);
  assert.ok(elapsed.x + elapsed.width <= metric.x);
  assert.ok(metric.x + metric.width <= visibleRight);
  assert.ok(restBanner.x >= menu.x + menu.width);
  assert.ok(restBanner.x + restBanner.width <= visibleRight);
  assert.ok(menu.width >= 80, 'Menu needs enough width to render its full label');
  assert.ok(y + height <= 90, 'Top bar must not overlap the rest title');
});

test('EXTENSION_SCREENS defines all required top-level screens', () => {
  assert.equal(EXTENSION_SCREENS.LOADING, 'LOADING');
  assert.equal(EXTENSION_SCREENS.CONNECTION, 'CONNECTION');
  assert.equal(EXTENSION_SCREENS.SETUP, 'SETUP');
  assert.equal(EXTENSION_SCREENS.EMPTY, 'EMPTY');
  assert.equal(EXTENSION_SCREENS.HOME, 'HOME');
  assert.equal(EXTENSION_SCREENS.PROGRAMS, 'PROGRAMS');
  assert.equal(EXTENSION_SCREENS.WEEKS, 'WEEKS');
  assert.equal(EXTENSION_SCREENS.DAYS, 'DAYS');
  assert.equal(EXTENSION_SCREENS.SESSION, 'SESSION');
});

test('checkRequiredPhoneInput detects prompted variables, timed sets, and incomplete AMRAP', () => {
  assert.equal(checkRequiredPhoneInput(null), null);
  assert.equal(checkRequiredPhoneInput({ reps: 8, weight: 60 }), null);

  // Prompted variables require phone
  assert.match(
    checkRequiredPhoneInput({ promptedVars: ['someVar'], reps: 8, weight: 60 }),
    /phone/i
  );

  // Timed set requires phone
  assert.match(
    checkRequiredPhoneInput({ setTimer: 60, reps: 8, weight: 60 }),
    /phone|timed/i
  );

  // AMRAP with missing reps
  assert.match(
    checkRequiredPhoneInput({ isAmrap: true, reps: null, targetReps: null, weight: 60 }),
    /phone|amrap/i
  );

  // askWeight with missing weight
  assert.match(
    checkRequiredPhoneInput({ askWeight: true, weight: null, targetWeight: null, reps: 8 }),
    /phone|weight/i
  );
});

test('formatting helpers format seconds and weight cleanly', () => {
  assert.equal(formatSeconds(0), '0:00');
  assert.equal(formatSeconds(45), '0:45');
  assert.equal(formatSeconds(90), '1:30');
  assert.equal(formatSeconds(-15), '-0:15');
  assert.equal(formatSeconds(-75), '-1:15');

  assert.equal(formatWeightValue(null, 'kg'), '-');
  assert.equal(formatWeightValue(60, 'kg'), '60kg');
  assert.equal(formatWeightValue(135.5, 'lb'), '135.5lb');

  assert.equal(formatTargetRepsSummary({ targetReps: 8, targetRepsMax: null }), '8');
  assert.equal(formatTargetRepsSummary({ targetReps: 8, targetRepsMax: 12 }), '8-12');
  assert.equal(formatTargetRepsSummary({ targetReps: null, targetRepsMax: null }), '-');
});

test('supersetColor maps group identifiers to distinct high-contrast colors', () => {
  const c1 = supersetColor('A');
  const c2 = supersetColor('B');
  const c3 = supersetColor('C');
  assert.ok(typeof c1 === 'number');
  assert.ok(typeof c2 === 'number');
  assert.notEqual(c1, c2);
  assert.notEqual(c2, c3);
});
