import test from 'node:test';
import assert from 'node:assert/strict';

import {
  roundToLoadable,
  parseWeightString,
  resolveEquipmentId,
} from '../shared/weight-rounding.js';

// Shapes taken from GET /gyms/:gymId/equipment. `num` is the total count on
// hand, and `multiplier: 2` means plates are loaded in pairs.
const BARBELL = {
  id: 'barbell',
  bar: { lb: '45lb', kg: '20kg' },
  multiplier: 2,
  isFixed: false,
  plates: [
    { weight: '20kg', num: 2 },
    { weight: '15kg', num: 2 },
    { weight: '10kg', num: 4 },
    { weight: '5kg', num: 2 },
    { weight: '2.5kg', num: 2 },
    { weight: '1.25kg', num: 2 },
    { weight: '45lb', num: 8 },
  ],
  fixed: [],
};

const CABLE = {
  id: 'cable',
  bar: { lb: '0lb', kg: '5kg' },
  multiplier: 1,
  isFixed: false,
  plates: [
    { weight: '5kg', num: 22 },
    { weight: '2.5kg', num: 2 },
    { weight: '10lb', num: 20 },
  ],
  fixed: [],
};

const DUMBBELL = {
  id: 'dumbbell',
  bar: { lb: '10lb', kg: '5kg' },
  multiplier: 2,
  isFixed: true,
  plates: [{ weight: '5kg', num: 2 }],
  fixed: ['5kg', '7.5kg', '10kg', '12.5kg', '15kg', '17.5kg', '20kg', '25kg', '20lb'],
};

// ── The oracle: values Liftosaur itself produced, read back from history ──────
//
// A program declaring `warmup: 1x8 40%, 1x5 70%, 1x3 85%` on a 87.5kg working
// set was logged by Liftosaur as `warmup: 1x8 35kg, 1x5 60kg, 1x3 72.5kg`.
// Two of those three round DOWN past a nearer achievable load, which is how the
// floor behaviour was established.

test('reproduces the warmup ladder Liftosaur logged for a barbell press', () => {
  assert.equal(roundToLoadable(0.4 * 87.5, BARBELL, 'kg').value, 35);
  assert.equal(roundToLoadable(0.7 * 87.5, BARBELL, 'kg').value, 60);
  assert.equal(roundToLoadable(0.85 * 87.5, BARBELL, 'kg').value, 72.5);
});

test('reproduces the cable warmup Liftosaur logged at 60% of 90kg', () => {
  assert.equal(roundToLoadable(0.6 * 90, CABLE, 'kg').value, 52.5);
});

test('rounds down, never up, past the target', () => {
  // 74.375 is 0.625 from 75 and 1.875 from 72.5; nearest would pick 75.
  assert.equal(roundToLoadable(74.375, BARBELL, 'kg').value, 72.5);
  // 54 is 1 from 55 and 1.5 from 52.5; nearest would pick 55.
  assert.equal(roundToLoadable(54, CABLE, 'kg').value, 52.5);
});

test('reports an exact hit as exact', () => {
  const exact = roundToLoadable(35, BARBELL, 'kg');
  assert.equal(exact.value, 35);
  assert.equal(exact.exact, true);

  const rounded = roundToLoadable(74.375, BARBELL, 'kg');
  assert.equal(rounded.exact, false);
  assert.equal(rounded.resolved, true);
});

test('never returns less than the empty bar', () => {
  assert.equal(roundToLoadable(10, BARBELL, 'kg').value, 20);
  assert.equal(roundToLoadable(0, BARBELL, 'kg').value, 20);
});

test('respects how many plates are actually on hand', () => {
  // One pair of 20kg, one pair of 15kg, two pairs of 10kg, then 5/2.5/1.25.
  // Everything loaded: 20 + 2*(20+15+10+10+5+2.5+1.25) = 147.5kg.
  assert.equal(roundToLoadable(500, BARBELL, 'kg').value, 147.5);
});

test('ignores plates in the other unit', () => {
  // The 45lb plates must not contribute to a kg workout.
  assert.equal(roundToLoadable(1000, BARBELL, 'kg').value, 147.5);
});

test('finds a combination a greedy fill would miss', () => {
  // Greedy from the top takes 20 then cannot reach 26.25; the answer needs
  // 20 + 5 + 1.25 per side.
  assert.equal(roundToLoadable(72.5, BARBELL, 'kg').value, 72.5);
});

test('picks from the list for fixed equipment', () => {
  assert.equal(roundToLoadable(16, DUMBBELL, 'kg').value, 15);
  assert.equal(roundToLoadable(17.5, DUMBBELL, 'kg').value, 17.5);
  assert.equal(roundToLoadable(2, DUMBBELL, 'kg').value, 5, 'falls back to the lightest');
  assert.equal(roundToLoadable(999, DUMBBELL, 'kg').value, 25, 'caps at the heaviest');
});

test('says so rather than guessing when the equipment is unknown', () => {
  const unknown = roundToLoadable(74.375, null, 'kg');
  assert.equal(unknown.resolved, false);
  assert.equal(unknown.value, 74.375, 'the target is returned untouched');

  const noFixed = roundToLoadable(50, { isFixed: true, fixed: [] }, 'kg');
  assert.equal(noFixed.resolved, false);
});

test('parses the weight strings the API returns', () => {
  assert.deepEqual(parseWeightString('45lb'), { value: 45, unit: 'lb' });
  assert.deepEqual(parseWeightString('2.5kg'), { value: 2.5, unit: 'kg' });
  assert.deepEqual(parseWeightString('20lbs'), { value: 20, unit: 'lb' });
  assert.deepEqual(parseWeightString('30', 'kg'), { value: 30, unit: 'kg' });
  assert.equal(parseWeightString('heavy'), null);
  assert.equal(parseWeightString(null), null);
});

test('resolves equipment from the current gym first', () => {
  const exerciseData = { equipment: { fmmayomc: 'dumbbell', default: 'barbell' } };

  assert.equal(resolveEquipmentId({ exerciseData, currentGymId: 'default' }), 'barbell');
  assert.equal(resolveEquipmentId({ exerciseData, currentGymId: 'fmmayomc' }), 'dumbbell');
  assert.equal(resolveEquipmentId({ exerciseData, currentGymId: 'other' }), 'barbell');
});

test('falls back to the exercise key, then to the name after the comma', () => {
  assert.equal(resolveEquipmentId({ exerciseKey: 'latPulldown_cable' }), 'cable');
  assert.equal(resolveEquipmentId({ exerciseKey: 'declineBenchPress_barbell' }), 'barbell');
  assert.equal(resolveEquipmentId({ equipmentName: 'Cable' }), 'cable');
  assert.equal(resolveEquipmentId({ equipmentName: 'Leverage Machine' }), 'leverageMachine');
  assert.equal(resolveEquipmentId({}), null);
});
