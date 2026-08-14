import test from 'node:test';
import assert from 'node:assert/strict';

import { parseProgramOutline, findOutlineDay, parseProgramDayExercises } from '../shared/liftoscript-outline.js';

const PROGRAM = `# Semaine 1
// **Notation des séries** — \`2x10+ @7+\`
// - saisie honnête du RPE
## Mardi: PUSH A
calib / used: none / 2x10+ / @7+ / progress: custom() {~
  if (week == 1) {
    var.best = 0kg
    print(var.best)
  }
~}

/// Double progression synchronisée.
dpkg / used: none / 1x1 / 0kg / update: custom() {~
  if (setIndex == 0) {
    weights = weights[1]
  }
~}
calibration: Decline Bench Press / ...calib / 2x6+ / 20s / superset: A
Straight Arm Pulldown, Cable / 1x12 / 120s / superset: A

## Mercredi: QUADS + GLUTES
Belt Squat / 3x12 / 50kg 120s
Seated Row / 2x10 / 90kg 90s

# Semaine 2
## Mardi: PUSH A
Decline Bench Press[1,2-6] / 3x8 @8 / 20s / superset: A

## Mercredi: QUADS + GLUTES

## Jeudi: PULL A
Lat Pulldown[1,2-6] / 3x10 @8 / 60kg 120s
`;

test('reads weeks and days from headers only', () => {
  const outline = parseProgramOutline(PROGRAM);

  assert.equal(outline.totalWeeks, 2);
  assert.deepEqual(
    outline.weeks.map((w) => w.name),
    ['Semaine 1', 'Semaine 2']
  );
  assert.deepEqual(
    outline.weeks[0].days.map((d) => d.name),
    ['Mardi: PUSH A', 'Mercredi: QUADS + GLUTES']
  );
  assert.deepEqual(
    outline.weeks[1].days.map((d) => d.name),
    ['Mardi: PUSH A', 'Mercredi: QUADS + GLUTES', 'Jeudi: PULL A']
  );
});

test('keeps an empty day in the list', () => {
  // A day with no exercises is still a day of the program: the API decides
  // what it contains, not the reader.
  const outline = parseProgramOutline(PROGRAM);
  assert.equal(outline.weeks[1].days[1].name, 'Mercredi: QUADS + GLUTES');
  assert.equal(outline.totalDays, 5);
});

test('numbers weeks and days from one, per week', () => {
  const outline = parseProgramOutline(PROGRAM);

  assert.deepEqual(
    outline.weeks[1].days.map((d) => d.number),
    [1, 2, 3]
  );
  assert.equal(outline.weeks[1].number, 2);
});

test('builds the full day name the API echoes back', () => {
  const outline = parseProgramOutline(PROGRAM);
  assert.equal(outline.weeks[1].days[2].fullName, 'Semaine 2 - Jeudi: PULL A');
});

test('never treats an exercise line as a week or a day', () => {
  const outline = parseProgramOutline(`# Week 1
## Day 1
Squat / 3x5 / 100kg
Seated Row / 3x10 / 50kg
Shoulder Press / 3x8 / 30kg
Standing Calf Raise / 3x12 / 40kg
`);

  assert.equal(outline.totalWeeks, 1);
  assert.equal(outline.totalDays, 1);
});

test('ignores hashes inside comments and script blocks', () => {
  const outline = parseProgramOutline(`# Week 1
## Day 1
// # not a week
Squat / 3x5 / 100kg / progress: custom() {~
# still not a week
## and not a day
~}
## Day 2
Bench Press / 3x5 / 60kg
`);

  assert.equal(outline.totalWeeks, 1);
  assert.deepEqual(
    outline.weeks[0].days.map((d) => d.name),
    ['Day 1', 'Day 2']
  );
});

test('handles a program with days but no week header', () => {
  const outline = parseProgramOutline(`## Day 1
Squat / 3x5 / 100kg
`);

  assert.equal(outline.totalWeeks, 1);
  assert.equal(outline.weeks[0].name, null);
  assert.equal(outline.weeks[0].days[0].fullName, 'Day 1');
});

test('returns an empty outline for empty input', () => {
  assert.deepEqual(parseProgramOutline(''), { weeks: [], totalWeeks: 0, totalDays: 0 });
  assert.deepEqual(parseProgramOutline(null), { weeks: [], totalWeeks: 0, totalDays: 0 });
});

test('findOutlineDay looks up by week and day number', () => {
  const outline = parseProgramOutline(PROGRAM);
  const found = findOutlineDay(outline, 2, 3);

  assert.equal(found.day.name, 'Jeudi: PULL A');
  assert.equal(findOutlineDay(outline, 9, 1), null);
  assert.equal(findOutlineDay(outline, 1, 9), null);
});

test('parseProgramDayExercises extracts day exercises with warmup and superset tags', () => {
  const sample = `# Week 1
## Day 1: Upper
Decline Bench Press[1,2], Barbell / 3x8 @8 / 80kg 120s / warmup: 1x8 40%, 1x5 70%, 1x3 85% / superset: A
Triceps Pushdown, Cable / 2x11 @8 / 35kg 75s / warmup: 1x8 50% / superset: A
Lateral Raise / 3x15 @8 / 10kg 60s / warmup: none

## Day 2: Lower
Belt Squat / 3x12 @8 / 50kg 120s
`;

  const day1 = parseProgramDayExercises(sample, 1, 1);
  assert.equal(day1.length, 3);

  assert.equal(day1[0].name, 'Decline Bench Press');
  assert.equal(day1[0].equipment, 'Barbell');
  assert.equal(day1[0].warmupText, '1x8 40%, 1x5 70%, 1x3 85%');
  assert.equal(day1[0].supersetTag, 'A');

  assert.equal(day1[1].name, 'Triceps Pushdown');
  assert.equal(day1[1].equipment, 'Cable');
  assert.equal(day1[1].warmupText, '1x8 50%');
  assert.equal(day1[1].supersetTag, 'A');

  assert.equal(day1[2].name, 'Lateral Raise');
  assert.equal(day1[2].equipment, null);
  assert.equal(day1[2].warmupText, 'none');
  assert.equal(day1[2].supersetTag, null);

  const day2 = parseProgramDayExercises(sample, 1, 2);
  assert.equal(day2.length, 1);
  assert.equal(day2[0].name, 'Belt Squat');
  assert.equal(day2[0].equipment, null);
  assert.equal(day2[0].warmupText, null);
  assert.equal(day2[0].supersetTag, null);

  assert.deepEqual(parseProgramDayExercises(sample, 2, 1), []);
});

test('parseProgramDayExercises strips inline comments and handles slash spacing', () => {
  const sample = `## Day 1
Incline Bench Press/3x8/warmup: 1x5 50%/superset: B // important exercise
Biceps Curl, Dumbbell  /  3x10  /  superset: B  // curl note
// Whole line comment
`;

  const exercises = parseProgramDayExercises(sample, 1, 1);
  assert.equal(exercises.length, 2);
  assert.equal(exercises[0].name, 'Incline Bench Press');
  assert.equal(exercises[0].warmupText, '1x5 50%');
  assert.equal(exercises[0].supersetTag, 'B');

  assert.equal(exercises[1].name, 'Biceps Curl');
  assert.equal(exercises[1].equipment, 'Dumbbell');
  assert.equal(exercises[1].supersetTag, 'B');
});
