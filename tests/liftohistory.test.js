import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseLiftohistoryRecord,
  parseSetGroups,
  expandSetGroups,
  rewriteRecordHeader,
} from '../shared/liftohistory.js';

// Structure taken from the published Liftohistory format reference.
const RECORD = `2026-02-28T10:45:30Z / program: "5/3/1 For Beginners" / dayName: "Push Day" / week: 1 / dayInWeek: 5 / duration: 1235s / exercises: {
  // felt strong today
  Bench Press, Barbell / 3x8 185lb @7, 1x6 185lb @9 / warmup: 1x10 95lb, 1x5 135lb / target: 3x8-12 185lb @8 90s
  OHP / 3x10 95lb / target: 3x10 95lb 60s
  Pull Ups / 3x8|7 0lb / target: 3x10 0lb 60s
}`;

test('parses the record header', () => {
  const record = parseLiftohistoryRecord(RECORD);

  assert.equal(record.date, '2026-02-28T10:45:30Z');
  assert.equal(record.programName, '5/3/1 For Beginners');
  assert.equal(record.dayName, 'Push Day');
  assert.equal(record.week, 1);
  assert.equal(record.dayInWeek, 5);
  assert.equal(record.durationSeconds, 1235);
  assert.equal(record.exercises.length, 3);
});

test('keeps a slash inside the program name out of the field split', () => {
  const record = parseLiftohistoryRecord(RECORD);
  assert.equal(record.programName, '5/3/1 For Beginners');
});

test('splits exercise name from equipment', () => {
  const [bench, ohp] = parseLiftohistoryRecord(RECORD).exercises;

  assert.equal(bench.name, 'Bench Press');
  assert.equal(bench.equipment, 'Barbell');
  assert.equal(ohp.name, 'OHP');
  assert.equal(ohp.equipment, null);
});

test('reads completed, warmup and target sections separately', () => {
  const [bench] = parseLiftohistoryRecord(RECORD).exercises;

  assert.equal(bench.completedGroups.length, 2);
  assert.equal(bench.warmupGroups.length, 2);
  assert.equal(bench.targetGroups.length, 1);

  assert.deepEqual(
    bench.completedGroups.map((g) => [g.count, g.reps, g.weight, g.unit, g.rpe]),
    [
      [3, 8, 185, 'lb', 7],
      [1, 6, 185, 'lb', 9],
    ]
  );
});

test('reads rep range, rest timer and RPE from a target', () => {
  const [bench] = parseLiftohistoryRecord(RECORD).exercises;
  const [target] = bench.targetGroups;

  assert.equal(target.count, 3);
  assert.equal(target.reps, 8);
  assert.equal(target.maxReps, 12);
  assert.equal(target.weight, 185);
  assert.equal(target.rpe, 8);
  assert.equal(target.restSeconds, 90);
});

test('reads unilateral reps', () => {
  const pullUps = parseLiftohistoryRecord(RECORD).exercises[2];
  const [completed] = pullUps.completedGroups;

  assert.equal(completed.reps, 8);
  assert.equal(completed.repsLeft, 7);
  assert.equal(completed.weight, 0);
});

test('reads AMRAP and logged-RPE markers', () => {
  const [group] = parseSetGroups('1x9+ 60kg @9+');

  assert.equal(group.reps, 9);
  assert.equal(group.isAmrap, true);
  assert.equal(group.rpe, 9);
  assert.equal(group.isRpeLogged, true);
});

test('collects workout notes and ignores the closing brace', () => {
  const record = parseLiftohistoryRecord(RECORD);
  assert.deepEqual(record.notes, ['felt strong today']);
});

test('returns null when there is no exercises block', () => {
  assert.equal(parseLiftohistoryRecord('just some text'), null);
  assert.equal(parseLiftohistoryRecord(''), null);
});

test('expands a group into individual sets', () => {
  const sets = expandSetGroups(parseSetGroups('3x8 100kg @8 120s'));

  assert.equal(sets.length, 3);
  assert.deepEqual(sets[0], {
    reps: 8,
    maxReps: null,
    repsLeft: null,
    isAmrap: false,
    percent: null,
    weight: 100,
    unit: 'kg',
    askWeight: false,
    rpe: 8,
    isRpeLogged: false,
    restSeconds: 120,
    label: null,
  });
});

test('rewrites the header without touching the exercises block', () => {
  const original = `2026-08-14T12:00:00Z / program: "P" / dayName: "D" / week: 2 / dayInWeek: 3 / exercises: {
  Squat / 3x5 100kg / target: 3x5 100kg 120s
}`;

  const rewritten = rewriteRecordHeader(original, {
    date: new Date('2026-08-14T09:30:00.000Z'),
    durationSeconds: 3600,
  });

  const record = parseLiftohistoryRecord(rewritten);
  assert.equal(record.date, '2026-08-14T09:30:00.000Z');
  assert.equal(record.durationSeconds, 3600);
  assert.equal(record.week, 2);
  assert.equal(record.dayInWeek, 3);
  assert.ok(rewritten.includes('  Squat / 3x5 100kg / target: 3x5 100kg 120s'));
});

test('parses and expands percentage-based set groups', () => {
  const groups = parseSetGroups('1x8 40%, 1x5 70%, 1x3 85%');
  assert.equal(groups.length, 3);
  assert.equal(groups[0].percent, 40);
  assert.equal(groups[0].weight, null);
  assert.equal(groups[0].unit, null);
  assert.equal(groups[1].percent, 70);
  assert.equal(groups[2].percent, 85);

  const expanded = expandSetGroups(groups);
  assert.equal(expanded.length, 3);
  assert.equal(expanded[0].percent, 40);
  assert.equal(expanded[0].reps, 8);
  assert.equal(expanded[1].percent, 70);
  assert.equal(expanded[2].percent, 85);
});
