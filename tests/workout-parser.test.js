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

test('parseLiftoscriptWorkout parses markdown headings and skips calibration day', () => {
  const markdownText = `
    # Week 1
    ## Calibration
    Calib Bench / 1x10 @ 40kg

    ## Day 1 - Bench & Squat
    Bench Press, Barbell / 3x5 @ 80kg / rest 120s
    Squat, Barbell / 3x5 @ 100kg / rest 180s

    ## Day 2 - Deadlift & Press
    Deadlift / 1x5 @ 140kg / rest 180s
    Overhead Press / 3x8 @ 50kg / rest 90s
  `;

  // Default day should skip "Calibration" and pick "Day 1 - Bench & Squat"
  const workout = parseLiftoscriptWorkout({ text: markdownText });
  assert.equal(workout.name, 'Week 1 - Day 1 - Bench & Squat');
  assert.equal(workout.exercises.length, 2);
  assert.equal(workout.exercises[0].name, 'Bench Press, Barbell');
  assert.equal(workout.exercises[1].name, 'Squat, Barbell');
});

test('parseLiftoscriptWorkout parses playground exercise blocks', () => {
  const playgroundText = `2026-08-14T13:30:00Z / program: "GZCLP 4-Day" / dayName: "Day 1 - Squat" / exercises: {
    Squat, Barbell / 3x5 100kg / target: 3x5 100kg 180s
    Bench Press / 3x10 60kg / target: 3x10 60kg 90s
  }`;

  const workout = parseLiftoscriptWorkout({ text: playgroundText });
  assert.equal(workout.routineName, 'GZCLP 4-Day');
  assert.equal(workout.name, 'Day 1 - Squat');
  assert.equal(workout.exercises.length, 2);
  assert.equal(workout.exercises[0].name, 'Squat, Barbell');
  assert.equal(workout.exercises[0].sets.length, 3);
  assert.equal(workout.exercises[0].sets[0].targetWeight, 100);
  assert.equal(workout.exercises[1].name, 'Bench Press');
});


