import test from 'node:test';
import assert from 'node:assert/strict';

import { parseLiftoscriptWorkout } from '../shared/workout-parser.js';

test('parseLiftoscriptWorkout parses simple single exercise lines', () => {
  const text = 'Bench Press, Barbell / 3x5 @ 60kg / rest 90s / rpe 8';
  const workout = parseLiftoscriptWorkout({
    name: 'Push Day A',
    text,
  });

  assert.equal(workout.name, 'Push Day A');
  assert.equal(workout.exercises.length, 1);

  const ex = workout.exercises[0];
  assert.equal(ex.name, 'Bench Press, Barbell');
  assert.equal(ex.sets.length, 3);
  assert.equal(ex.sets[0].targetReps, 5);
  assert.equal(ex.sets[0].targetWeight, 60);
  assert.equal(ex.sets[0].targetRpe, 8);
  assert.equal(ex.sets[0].restSeconds, 90);
});

test('parseLiftoscriptWorkout parses supersets and groups', () => {
  const text = `
    [SUPERSET A1] Incline DB Bench / 2x10 @ 30kg / rest 45s
    [SUPERSET A2] DB Chest Row / 2x12 @ 26kg / rest 60s / rpe 8.5
    Military Press / 3x8 @ 45kg / rest 90s
  `;

  const workout = parseLiftoscriptWorkout({
    name: 'Upper Body Focus',
    text,
  });

  assert.equal(workout.exercises.length, 3);

  // A1
  assert.equal(workout.exercises[0].name, 'Incline DB Bench');
  assert.equal(workout.exercises[0].supersetGroup, 'A');
  assert.equal(workout.exercises[0].supersetTag, 'SUPERSET A1');
  assert.equal(workout.exercises[0].sets.length, 2);

  // A2
  assert.equal(workout.exercises[1].name, 'DB Chest Row');
  assert.equal(workout.exercises[1].supersetGroup, 'A');
  assert.equal(workout.exercises[1].supersetTag, 'SUPERSET A2');
  assert.equal(workout.exercises[1].sets[0].targetRpe, 8.5);

  // Standalone
  assert.equal(workout.exercises[2].name, 'Military Press');
  assert.equal(workout.exercises[2].supersetGroup, null);
  assert.equal(workout.exercises[2].supersetTag, null);
});

test('parseLiftoscriptWorkout parses minute rests and AMRAP sets', () => {
  const text = 'Squat, Barbell / 2x5, 1x5+ @ 100kg / rest 3m';
  const workout = parseLiftoscriptWorkout({ text });

  assert.equal(workout.exercises.length, 1);
  const ex = workout.exercises[0];
  assert.equal(ex.sets.length, 3);
  assert.equal(ex.sets[0].restSeconds, 180);
  assert.equal(ex.sets[2].isAmrap, true);
  assert.equal(ex.sets[2].targetReps, 5);
  assert.equal(ex.sets[2].targetWeight, 100);
});
