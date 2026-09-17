import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../data-widget/common/index.js', import.meta.url), 'utf8');

test('Workout records bounded steps around set completion and terminal save', () => {
  assert.match(source, /createWorkoutDiagnostics\(deviceStorage, undefined, \(code\) =>/);
  assert.match(source, /readWorkoutMemory\(appApi\.getPackageInfo, appApi\.getPerformance\)/);
  assert.match(source, /workoutDiagnostics\.record\(WORKOUT_DIAGNOSTIC_CODES\.SET_TAP\)[\s\S]*workoutController\.completeSet\([\s\S]*workoutDiagnostics\.record\(WORKOUT_DIAGNOSTIC_CODES\.SET_SAVED\)/);
  assert.match(source, /workoutDiagnostics\.record\(WORKOUT_DIAGNOSTIC_CODES\.SET_TAP\);\s*workoutController\.stopTimedSide\(\)/);
  assert.match(source, /workoutDiagnostics\.record\(WORKOUT_DIAGNOSTIC_CODES\.FINISH_TAP\)[\s\S]*finishWorkoutRemote\(\)/);
  assert.match(source, /workoutDiagnostics\.record\(WORKOUT_DIAGNOSTIC_CODES\.BOOT\)/);
  assert.match(source, /workoutDiagnostics\.record\(WORKOUT_DIAGNOSTIC_CODES\.BUILD\)/);
});

test('Workout sends only the sanitized diagnostic report during settings refresh', () => {
  assert.match(source, /workoutDiagnostics\.isEnabled\(\)\s*\? \{ diagnostics: workoutDiagnostics\.read\(\) \} : \{\}/);
  assert.match(source, /workoutDiagnostics\.setEnabled\(normalizeWorkoutDiagnosticsEnabled\(settingsRes\.payload\?\.workoutDiagnosticsEnabled\)\)/);
  assert.match(source, /onResume\(\)[\s\S]*loadDisplaySettings\(\)/);
  assert.doesNotMatch(source, /workoutDiagnostics\.record\([^)]*(?:dayName|exerciseName|apiKey|weight|reps)/);
});
