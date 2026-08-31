import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProgramOutline, parseProgramDayExercises } from '../shared/liftoscript-outline.js';

const SYNTHETIC_PROGRAM = `# Week 1
// Base progression template
template / used: none / 1x5 / progress: custom() {~
  var.load = 100kg
~}

## Day 1: Upper Body
pref1: Overhead Press, Dumbbell / ...template / 3x5 / warmup: 1x5 40%, 1x3 70% / superset: A
pref2: Lat Pulldown, Cable / ...template / 3x8 / warmup: none / superset: A
pref3: Front Squat, Barbell / ...template / 3x5 / warmup: 1x5 50%
pref4: Plank / ...template / 3x60s

## Day 2: Lower Body
pref5: Deadlift, Barbell / ...template / 3x5 / warmup: 1x5 50%, 1x3 75%
pref6: Leg Press, Machine / ...template / 3x10

# Week 2
## Day 1: Upper Body
Overhead Press, Dumbbell[1,2-3] / 3x5 / warmup: 1x5 40%, 1x3 70% / superset: A
Lat Pulldown, Cable[2,2-3] / 3x8 / warmup: none / superset: A
Front Squat, Barbell[3,2-3] / 3x5 / warmup: 1x5 50%
Plank[4,2-3] / 3x60s

## Day 2: Lower Body
Deadlift, Barbell[1,2-3] / 3x5 / warmup: 1x5 50%, 1x3 75%
Leg Press, Machine[2,2-3] / 3x10

# Week 3
## Day 1: Upper Body
## Day 2: Lower Body

# Week 4
## Day 1: Upper Body
Bicep Curl, Cable / 3x12 / superset: B
Triceps Extension, Cable / 3x12 / superset: B

## Day 2: Lower Body
`;

test('parses multi-week outline structure and day names', () => {
  const outline = parseProgramOutline(SYNTHETIC_PROGRAM);
  assert.equal(outline.totalWeeks, 4);
  assert.equal(outline.weeks.length, 4);
  assert.equal(outline.totalDays, 8);
  assert.equal(outline.weeks[0].name, 'Week 1');
  assert.equal(outline.weeks[0].days.length, 2);
  assert.equal(outline.weeks[0].days[0].name, 'Day 1: Upper Body');
  assert.equal(outline.weeks[0].days[0].fullName, 'Week 1 - Day 1: Upper Body');
  assert.equal(outline.weeks[0].days[1].name, 'Day 2: Lower Body');
  assert.equal(outline.weeks[2].days.length, 2);
});

test('extracts week 1 exercises with cleaned names, equipment, warmups and supersets', () => {
  const day1 = parseProgramDayExercises(SYNTHETIC_PROGRAM, 1, 1);
  assert.equal(day1.length, 4);
  assert.deepEqual(
    day1.map((e) => e.name),
    ['Overhead Press', 'Lat Pulldown', 'Front Squat', 'Plank']
  );
  assert.deepEqual(
    day1.map((e) => e.equipment),
    ['Dumbbell', 'Cable', 'Barbell', null]
  );
  assert.equal(day1[0].warmupText, '1x5 40%, 1x3 70%');
  assert.equal(day1[0].supersetTag, 'A');
  assert.equal(day1[1].warmupText, 'none');
  assert.equal(day1[1].supersetTag, 'A');
  assert.equal(day1[2].warmupText, '1x5 50%');
  assert.equal(day1[2].supersetTag, null);
  assert.equal(day1[3].warmupText, null);
});

test('inherits exercises in week 3 from week 2 template range', () => {
  const day1 = parseProgramDayExercises(SYNTHETIC_PROGRAM, 3, 1);
  assert.equal(day1.length, 4);
  assert.deepEqual(
    day1.map((e) => e.name),
    ['Overhead Press', 'Lat Pulldown', 'Front Squat', 'Plank']
  );
  assert.equal(day1[0].equipment, 'Dumbbell');
  assert.equal(day1[0].supersetTag, 'A');
  assert.equal(day1[1].equipment, 'Cable');
  assert.equal(day1[1].supersetTag, 'A');

  const day2 = parseProgramDayExercises(SYNTHETIC_PROGRAM, 3, 2);
  assert.equal(day2.length, 2);
  assert.deepEqual(
    day2.map((e) => e.name),
    ['Deadlift', 'Leg Press']
  );
  assert.equal(day2[0].warmupText, '1x5 50%, 1x3 75%');
});

test('parses direct week 4 overrides and handles unmapped empty days', () => {
  const day1 = parseProgramDayExercises(SYNTHETIC_PROGRAM, 4, 1);
  assert.equal(day1.length, 2);
  assert.deepEqual(
    day1.map((e) => e.name),
    ['Bicep Curl', 'Triceps Extension']
  );
  assert.equal(day1[0].supersetTag, 'B');
  assert.equal(day1[1].supersetTag, 'B');

  const day2 = parseProgramDayExercises(SYNTHETIC_PROGRAM, 4, 2);
  assert.deepEqual(day2, []);
});
