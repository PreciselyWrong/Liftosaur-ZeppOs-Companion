import test from 'node:test';
import assert from 'node:assert/strict';

import { formatWorkoutHistoryToLiftoscript } from '../shared/history-formatter.js';

test('formatWorkoutHistoryToLiftoscript formats session into official Liftoscript text', () => {
  const history = {
    routineName: 'GZCLP 4-Day',
    workoutName: 'Day 1 - Squat',
    elapsedSeconds: 2700,
    completedAt: 1773489600000,
    completedSets: [
      { exerciseName: 'Squat', reps: 3, weight: 100 },
      { exerciseName: 'Squat', reps: 3, weight: 100 },
      { exerciseName: 'Squat', reps: 3, weight: 100 },
      { exerciseName: 'Bench Press', reps: 10, weight: 60 },
      { exerciseName: 'Bench Press', reps: 10, weight: 60 },
    ],
  };

  const formatted = formatWorkoutHistoryToLiftoscript(history);

  assert.ok(formatted.includes('program: "GZCLP 4-Day"'));
  assert.ok(formatted.includes('dayName: "Day 1 - Squat"'));
  assert.ok(formatted.includes('duration: 2700s'));
  assert.ok(formatted.includes('Squat / 3x3 100kg'));
  assert.ok(formatted.includes('Bench Press / 2x10 60kg'));
});
