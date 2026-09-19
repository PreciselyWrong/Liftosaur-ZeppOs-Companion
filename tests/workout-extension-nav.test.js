import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXTENSION_SCREENS,
  EXTENSION_TOP_BAR_LAYOUT,
  MENU_LABEL,
  checkRequiredPhoneInput,
  formatActiveSetProgress,
  formatDots,
  formatOverviewExerciseLines,
  formatSeconds,
  formatSupersetProgress,
  formatEditableSetValue,
  formatNextTargetSummary,
  formatTargetRpeSummary,
  formatWeightValue,
  formatTargetRepsSummary,
  shouldAutoStartPreparedSet,
  supersetColor,
} from '../shared/workout-extension-nav.js';

test('superset progress uses one short row and does not label warmups as rounds', () => {
  const context = { group: 'A', position: 1, size: 2, round: 2, totalRounds: 3 };
  assert.equal(formatSupersetProgress(context), 'A 1/2 - Round 2/3');
  assert.equal(formatSupersetProgress({ ...context, round: null }), '');
  assert.equal(formatSupersetProgress(null), '');
  assert.equal(formatSupersetProgress({ ...context, group: 'An unusually long group' }), 'An un... 1/2 - Round 2/3');
});

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

test('checkRequiredPhoneInput allows timed sets but detects required phone inputs', () => {
  assert.equal(checkRequiredPhoneInput(null), null);
  assert.equal(checkRequiredPhoneInput({ reps: 8, weight: 60 }), null);

  // Prompted variables require phone
  assert.match(
    checkRequiredPhoneInput({ promptedVars: ['someVar'], reps: 8, weight: 60 }),
    /phone/i
  );

  assert.equal(checkRequiredPhoneInput({ setTimer: 60, reps: 8, weight: 60 }), null);

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

  assert.match(
    checkRequiredPhoneInput({ logRpe: true, rpe: null, reps: 8, weight: 60 }),
    /phone|rpe/i
  );

  assert.equal(checkRequiredPhoneInput({ askWeight: true, weight: 0, reps: 8 }), null);
});

test('shared workout navigation uses the Companion menu and progress markers', () => {
  assert.equal(MENU_LABEL, '\u2261');
  assert.equal(formatDots(['completed', 'active', 'pending']), '\u25cf \u25cf \u25cb');
});

test('overview preserves the whole exercise name, every dot, and the prescription', () => {
  const dots = ['completed', ...Array(8).fill('pending')];
  const lines = formatOverviewExerciseLines({
    name: 'Overhead Press With Dumbbells',
    setsDots: dots,
    prescriptionSummary: '2W + 5 x 5 - 45kg',
    supersetGroup: 'A',
  });
  assert.equal(lines.title, `[SS A] Overhead Press With Dumbbells  ${formatDots(dots)}`);
  assert.equal(lines.prescription, '2W + 5 x 5 - 45kg');
});

test('active set progress is a stable label without overview dots or superset text', () => {
  assert.equal(formatActiveSetProgress({ isWarmup: true, warmupIndex: 1, totalWarmups: 2 }), 'WARMUP 1/2');
  assert.equal(formatActiveSetProgress({ workSetIndex: 2, totalWorkSets: 4 }, 3, 6), 'SET 2/4');
  assert.equal(formatActiveSetProgress({}, 1, 3), 'SET 2/3');
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

  assert.equal(formatEditableSetValue(8, false), '8');
  assert.equal(formatEditableSetValue(8, true), '8+');
  assert.equal(formatEditableSetValue(null, true), '-');

  assert.equal(formatTargetRepsSummary({ targetReps: 8, targetRepsMax: null }), '8');
  assert.equal(formatTargetRepsSummary({ targetReps: 8, targetRepsMax: 12 }), '8-12');
  assert.equal(formatTargetRepsSummary({ targetReps: 12, targetRepsMax: null, isAmrap: true }), '12+');
  assert.equal(formatTargetRepsSummary({ targetReps: 8, targetRepsMax: 12, isAmrap: true }), '8-12+');
  assert.equal(formatTargetRepsSummary({ targetReps: null, targetRepsMax: null }), '-');

  assert.equal(formatTargetRpeSummary({ targetRpe: 9, logRpe: true }), ' @9+');
  assert.equal(formatTargetRpeSummary({ targetRpe: 8, logRpe: false }), ' @8');
  assert.equal(formatTargetRpeSummary({ targetRpe: null, logRpe: true }), '');

  assert.equal(formatNextTargetSummary({
    nextTargetReps: 12,
    nextTargetRepsMax: null,
    nextIsAmrap: true,
    nextTargetWeight: 80,
    nextUnit: 'kg',
    nextTargetRpe: 9,
    nextLogRpe: true,
  }), '12+ x 80kg @9+');
});

test('Prepare auto-starts only once rest has expired while running', () => {
  assert.equal(shouldAutoStartPreparedSet(true, { remaining: 0, isPaused: false }), true);
  assert.equal(shouldAutoStartPreparedSet(true, { remaining: -1, isPaused: false }), true);
  assert.equal(shouldAutoStartPreparedSet(true, { remaining: 1, isPaused: false }), false);
  assert.equal(shouldAutoStartPreparedSet(true, { remaining: 0, isPaused: true }), false);
  assert.equal(shouldAutoStartPreparedSet(false, { remaining: 0, isPaused: false }), false);
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
