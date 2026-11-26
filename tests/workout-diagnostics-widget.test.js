import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../data-widget/common/index.js', import.meta.url), 'utf8');

test('Workout records bounded steps around set completion and terminal save', () => {
  assert.match(source, /createWorkoutDiagnostics\(diagnosticsStorage, undefined, \(\) => readWorkoutMemory/);
  assert.match(source, /readWorkoutMemory\(appApi\.getPackageInfo, appApi\.getPerformance\)/);
  assert.match(source, /workoutDiagnostics\.record\(WORKOUT_DIAGNOSTIC_CODES\.SET_TAP\)[\s\S]*workoutController\.completeSet\([\s\S]*workoutDiagnostics\.record\(WORKOUT_DIAGNOSTIC_CODES\.SET_SAVED\)/);
  assert.match(source, /workoutDiagnostics\.record\(WORKOUT_DIAGNOSTIC_CODES\.SET_TAP\);\s*workoutController\.stopTimedSide\(\)/);
  assert.match(source, /workoutDiagnostics\.record\(WORKOUT_DIAGNOSTIC_CODES\.FINISH_TAP\)[\s\S]*finishWorkoutRemote\(\)/);
  assert.match(source, /workoutDiagnostics\.record\(WORKOUT_DIAGNOSTIC_CODES\.BOOT\)/);
  assert.match(source, /workoutDiagnostics\.record\(WORKOUT_DIAGNOSTIC_CODES\.BUILD\)/);
});

test('Workout sends only the sanitized diagnostic report during settings refresh', () => {
  // The upload is decided by the recorder, which sends nothing while the phone setting is off.
  assert.match(source, /send\(MESSAGE_TYPES\.GET_SETTINGS, diagnosticsUpload\.payload\)/);
  assert.match(source, /if \(workoutDiagnostics\.isEnabled\(\)\) diagnosticsUpload\.commit\(\)/);
  assert.match(source, /workoutDiagnostics\.setEnabled\(normalizeWorkoutDiagnosticsEnabled\(settingsRes\.payload\?\.workoutDiagnosticsEnabled\)\)/);
  assert.match(source, /onResume\(\)[\s\S]*loadDisplaySettings\(\)/);
  assert.doesNotMatch(source, /workoutDiagnostics\.record\([^)]*(?:dayName|exerciseName|apiKey|weight|reps)/);
});

test('only Workout persists the health summary, because only its page has an onPause', () => {
  const companion = readFileSync(new URL('../page/common/index.js', import.meta.url), 'utf8');
  assert.match(source, /persistHealth: true/);
  assert.match(source, /onPause\(\) \{[\s\S]*workoutDiagnostics\.record\(WORKOUT_DIAGNOSTIC_CODES\.PAUSE\)/);
  assert.doesNotMatch(companion, /persistHealth/);
  assert.doesNotMatch(companion, /onPause\(\)/);
});
