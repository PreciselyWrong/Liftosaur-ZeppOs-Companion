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

  assert.equal(workout.exercises[0].sets.length, 3);
  assert.equal(workout.exercises[0].sets[0].isAmrap, false);
  assert.equal(workout.exercises[0].sets[2].isAmrap, true);
  assert.equal(workout.exercises[0].sets[0].restSeconds, 180);
});

test('parseLiftoscriptWorkout parses multi-day programs and ignores script code', () => {
  const fullProgramText = `
    # Routine: GZCLP 4-Day
    state.timer = 180;
    
    day("Day 1 - Squat T1") {
      state.reps = 3;
      Squat / 5x3+ @ 100kg / rest 180s
      Bench Press / 3x10 @ 60kg / rest 90s
      Lat Pulldown / 3x15+ @ 45kg / rest 90s
    }

    day("Day 2 - Overhead Press T1") {
      Overhead Press / 5x3+ @ 45kg / rest 180s
      Deadlift / 3x10 @ 90kg / rest 90s
      Dumbbell Row / 3x15+ @ 24kg / rest 90s
    }
  `;

  // Parse first day by default
  const day1 = parseLiftoscriptWorkout({
    name: 'GZCLP',
    text: fullProgramText,
  }, 0);

  assert.equal(day1.name, 'Day 1 - Squat T1');
  assert.equal(day1.exercises.length, 3);
  assert.equal(day1.exercises[0].name, 'Squat');
  assert.equal(day1.exercises[1].name, 'Bench Press');
  assert.equal(day1.exercises[2].name, 'Lat Pulldown');
  assert.equal(day1.availableDays.length, 2);

  // Parse second day
  const day2 = parseLiftoscriptWorkout({
    name: 'GZCLP',
    text: fullProgramText,
  }, 1);

  assert.equal(day2.name, 'Day 2 - Overhead Press T1');
  assert.equal(day2.exercises.length, 3);
  assert.equal(day2.exercises[0].name, 'Overhead Press');
  assert.equal(day2.exercises[1].name, 'Deadlift');
});
