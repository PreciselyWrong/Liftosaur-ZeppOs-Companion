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

test('parseLiftoscriptWorkout parses official Liftoscript syntax with weight in separate slash part', () => {
  const text = `
    # Week 1
    ## Day 1
    Squat / 3x5 / 135lb / progress: lp(5lb)
    Bench Press / 3x5 / 95lb / progress: lp(5lb)
  `;

  const workout = parseLiftoscriptWorkout({ text });
  assert.equal(workout.exercises.length, 2);
  assert.equal(workout.exercises[0].name, 'Squat');
  assert.equal(workout.exercises[0].sets.length, 3);
  assert.equal(workout.exercises[0].sets[0].targetReps, 5);
  assert.equal(workout.exercises[0].sets[0].targetWeight, 135);
  assert.equal(workout.exercises[1].name, 'Bench Press');
  assert.equal(workout.exercises[1].sets[0].targetWeight, 95);
});

test('parseLiftoscriptWorkout parses custom Markdown day headings like Push, Pull, Legs', () => {
  const text = `
    # Week 1
    ## Push
    Bench Press / 3x5 / 185lb
    Overhead Press / 3x8 / 95lb

    ## Pull
    Deadlift / 1x5+ / 225lb
    Barbell Row / 3x8 / 135lb

    ## Legs
    Squat / 3x5 / 225lb
    Leg Press / 3x10 / 300lb
  `;

  const day1 = parseLiftoscriptWorkout({ text }, 0);
  assert.equal(day1.name, 'Week 1 - Push');
  assert.equal(day1.exercises.length, 2);
  assert.equal(day1.exercises[0].name, 'Bench Press');
  assert.equal(day1.exercises[0].sets[0].targetWeight, 185);
  assert.equal(day1.totalDays, 3);

  const day2 = parseLiftoscriptWorkout({ text }, 1);
  assert.equal(day2.name, 'Week 1 - Pull');
  assert.equal(day2.exercises[0].name, 'Deadlift');

  const day3 = parseLiftoscriptWorkout({ text }, 2);
  assert.equal(day3.name, 'Week 1 - Legs');
  assert.equal(day3.exercises[0].name, 'Squat');
});

test('parseLiftoscriptWorkout handles multi-week exercise ranges like Exercise[1-4]', () => {
  const text = `
    # Week 1
    ## Day 1
    Bench Press[1-2] / 3x8 / 100lb
    Incline Dumbbell[1] / 3x10 / 40lb

    # Week 2
    ## Day 1
    Incline Barbell[2] / 3x8 / 85lb
  `;

  const w1d1 = parseLiftoscriptWorkout({ text }, 0);
  assert.equal(w1d1.name, 'Week 1 - Day 1');
  assert.equal(w1d1.exercises.length, 2);
  assert.equal(w1d1.exercises[0].name, 'Bench Press');
  assert.equal(w1d1.exercises[1].name, 'Incline Dumbbell');

  const w2d1 = parseLiftoscriptWorkout({ text }, 1);
  assert.equal(w2d1.name, 'Week 2 - Day 1');
  assert.equal(w2d1.exercises.length, 2);
  assert.equal(w2d1.exercises[0].name, 'Bench Press');
  assert.equal(w2d1.exercises[1].name, 'Incline Barbell');
});

test('resolveNextProgramSession wraps multi-week programs upon completion of last day', () => {
  const text = `
    # Week 1
    ## Day A
    Squat / 3x5 / 100kg
    ## Day B
    Bench / 3x5 / 80kg

    # Week 2
    ## Day A
    Squat / 3x5 / 105kg
    ## Day B
    Bench / 3x5 / 82.5kg
  `;

  // History showing final day of Week 2 was completed
  const history = [
    { text: '2026-08-14T10:00:00Z / program: "Workout" / dayName: "Day B" / week: 2 / dayInWeek: 2 / exercises: { Bench / 3x5 82.5kg }' },
  ];

  const next = parseLiftoscriptWorkout({ text }, null, history);
  assert.equal(next.name, 'Week 1 - Day A');
  assert.equal(next.week, 1);
  assert.equal(next.dayInWeek, 1);
  assert.equal(next.currentDayIndex, 0);
  assert.equal(next.totalDays, 4);
});

test('parseLiftoscriptWorkout handles arbitrary slash ordering with rest, RPE, and progress', () => {
  const line = 'Deadlift / 1x5+ / 140kg / rest 3.5m / rpe 9 / progress: custom() { state.weight += 5; }';
  const workout = parseLiftoscriptWorkout({ text: line });

  assert.equal(workout.exercises.length, 1);
  const ex = workout.exercises[0];
  assert.equal(ex.name, 'Deadlift');
  assert.equal(ex.sets.length, 1);
  assert.equal(ex.sets[0].targetReps, 5);
  assert.equal(ex.sets[0].isAmrap, true);
  assert.equal(ex.sets[0].targetWeight, 140);
  assert.equal(ex.sets[0].restSeconds, 210);
  assert.equal(ex.sets[0].targetRpe, 9);
});

test('parseLiftoscriptWorkout cleans markdown bullets, tier tags, and bold formatting', () => {
  const text = `
    # Push Day
    - **Barbell Bench Press** / 3x5 / 80kg
    * T1: Overhead Press / 3x8 / 45kg
    1. Incline Dumbbell Press 3x10 24kg
  `;
  const workout = parseLiftoscriptWorkout({ text });
  assert.equal(workout.exercises.length, 3);
  assert.equal(workout.exercises[0].name, 'Barbell Bench Press');
  assert.equal(workout.exercises[0].sets[0].targetWeight, 80);
  assert.equal(workout.exercises[1].name, 'Overhead Press');
  assert.equal(workout.exercises[1].sets[0].targetWeight, 45);
  assert.equal(workout.exercises[2].name, 'Incline Dumbbell Press');
  assert.equal(workout.exercises[2].sets[0].targetWeight, 24);
});

test('parseLiftoscriptWorkout parses DSL with inner custom progress braces without truncation', () => {
  const text = `
    day("Squat Day") {
      Squat / 3x5 140kg / progress: custom() {
        if (completedReps >= 5) {
          state.weight += 2.5;
        }
      }
      Leg Press / 3x10 200kg
    }
    day("Bench Day") {
      Bench Press / 3x5 100kg
    }
  `;
  const workout = parseLiftoscriptWorkout({ text });
  assert.equal(workout.exercises.length, 2);
  assert.equal(workout.exercises[0].name, 'Squat');
  assert.equal(workout.exercises[0].sets[0].targetWeight, 140);
  assert.equal(workout.exercises[1].name, 'Leg Press');
  assert.equal(workout.exercises[1].sets[0].targetWeight, 200);

  // Day 2 check
  const day2 = parseLiftoscriptWorkout({ text }, 1);
  assert.equal(day2.name, 'Bench Day');
  assert.equal(day2.exercises.length, 1);
  assert.equal(day2.exercises[0].name, 'Bench Press');
});

test('parseLiftoscriptWorkout parses plain exercise names without slashes or sets', () => {
  const text = `
    # Push
    Bench Press
    Overhead Press
    Incline Dumbbell Press
  `;
  const workout = parseLiftoscriptWorkout({ text });
  assert.equal(workout.name, 'Push');
  assert.equal(workout.exercises.length, 3);
  assert.equal(workout.exercises[0].name, 'Bench Press');
  assert.equal(workout.exercises[1].name, 'Overhead Press');
  assert.equal(workout.exercises[2].name, 'Incline Dumbbell Press');
});

test('parseLiftoscriptWorkout parses DSL with day "Name" syntax without parens', () => {
  const text = `
    day "Legs" {
      Barbell Squat / 3x5 100kg
      Romanian Deadlift / 3x8 80kg
    }
  `;
  const workout = parseLiftoscriptWorkout({ text });
  assert.equal(workout.name, 'Legs');
  assert.equal(workout.exercises.length, 2);
  assert.equal(workout.exercises[0].name, 'Barbell Squat');
  assert.equal(workout.exercises[1].name, 'Romanian Deadlift');
});

test('parseLiftoscriptWorkout parses multi-set continuation lines like logic.txt', () => {
  const text = `
    Day 1
    Squat 1x5 100kg
    1x5 110kg
    1x5 120kg
    Amrap 1x5 100kg
    Bench Press 3x5 80kg
  `;
  const workout = parseLiftoscriptWorkout({ text });
  assert.equal(workout.name, 'Day 1');
  assert.equal(workout.exercises.length, 2);
  assert.equal(workout.exercises[0].name, 'Squat');
  assert.equal(workout.exercises[0].sets.length, 4);
  assert.equal(workout.exercises[0].sets[0].targetWeight, 100);
  assert.equal(workout.exercises[0].sets[1].targetWeight, 110);
  assert.equal(workout.exercises[0].sets[2].targetWeight, 120);
  assert.equal(workout.exercises[0].sets[3].isAmrap, true);
  assert.equal(workout.exercises[1].name, 'Bench Press');
  assert.equal(workout.exercises[1].sets.length, 3);
});

test('parseLiftoscriptWorkout parses French Semaine and Jour without hashes', () => {
  const text = `
    Semaine 1
    Jour 1 - Poussée
    Développé Couché / 3x5 / 80kg
    Développé Militaire / 3x8 / 45kg
    Jour 2 - Tirage
    Soulevé de Terre / 1x5 / 140kg
    Tractions / 3x8 / 0kg
  `;
  const workout = parseLiftoscriptWorkout({ text });
  assert.equal(workout.name, 'Semaine 1 - Jour 1 - Poussée');
  assert.equal(workout.dayName, 'Jour 1 - Poussée');
  assert.equal(workout.exercises.length, 2);
  assert.equal(workout.exercises[0].name, 'Développé Couché');
  assert.equal(workout.exercises[1].name, 'Développé Militaire');

  const day2 = parseLiftoscriptWorkout({ text }, 1);
  assert.equal(day2.name, 'Semaine 1 - Jour 2 - Tirage');
  assert.equal(day2.dayName, 'Jour 2 - Tirage');
  assert.equal(day2.exercises.length, 2);
  assert.equal(day2.exercises[0].name, 'Soulevé de Terre');
});







