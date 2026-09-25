import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkoutDisplaySettings, workoutProgress, weightStepperDisplay } from '../shared/workout-display-settings.js';

test('display defaults preserve existing watch controls and plate labels', () => {
  assert.deepEqual(normalizeWorkoutDisplaySettings(), {
    showWorkoutProgress: false,
    showPlateBreakdown: true,
    showRestInfo: true,
  });
});

test('display preferences accept stored select values and reject malformed values', () => {
  assert.deepEqual(normalizeWorkoutDisplaySettings({
    showWorkoutProgress: '{"value":"true"}',
    showPlateBreakdown: 'false',
    showRestInfo: { value: false },
  }), {
    showWorkoutProgress: true,
    showPlateBreakdown: false,
    showRestInfo: false,
  });
  assert.deepEqual(normalizeWorkoutDisplaySettings({
    showWorkoutProgress: 'bad',
    showPlateBreakdown: 'bad',
    showRestInfo: null,
  }), normalizeWorkoutDisplaySettings());
});

test('workout progress counts completed sets across all exercises and clamps the fill', () => {
  assert.deepEqual(workoutProgress([
    { totalSets: 3, completedSetsCount: 2 },
    { totalSets: 2, completedSetsCount: 0 },
  ]), { completed: 2, total: 5, fraction: 0.4 });
  assert.deepEqual(workoutProgress([{ totalSets: 2, completedSetsCount: 5 }]),
    { completed: 2, total: 2, fraction: 1 });
  assert.deepEqual(workoutProgress([]), { completed: 0, total: 0, fraction: 0 });
});

test('hiding plates keeps the weight unit and expands the weight value', () => {
  assert.deepEqual(weightStepperDisplay(82.5, 'kg', '20 + 10 + 2.5 KG', true),
    { value: '82.5', label: '20 + 10 + 2.5 KG' });
  assert.deepEqual(weightStepperDisplay(82.5, 'kg', '20 + 10 + 2.5 KG', false),
    { value: '82.5 KG', label: '' });
  assert.deepEqual(weightStepperDisplay(null, 'lb', '', false), { value: '- LB', label: '' });
});
