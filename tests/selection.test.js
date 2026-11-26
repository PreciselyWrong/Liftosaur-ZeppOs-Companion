import test from 'node:test';
import assert from 'node:assert/strict';

import {
  suggestedProgramIndex,
  suggestedWeekIndex,
  suggestedDayIndex,
  suggestedStart,
  withoutIndex,
  programForSavedPlan,
  launchPlanFor,
} from '../shared/selection.js';

test('the next workout fetched at launch serves a pick of that same day while it is fresh', () => {
  const plan = { programId: 'p1', week: 2, dayInWeek: 3, unit: 'kg', exercises: [{ name: 'Squat' }] };
  const pick = { programId: 'p1', week: 2, dayInWeek: 3 };
  assert.equal(launchPlanFor(plan, 1000, { ...pick, now: 1000 + 60000 }), plan);
  for (const other of [{ programId: 'p2' }, { week: 1 }, { dayInWeek: 4 }]) {
    assert.equal(launchPlanFor(plan, 1000, { ...pick, ...other, now: 1000 }), null, JSON.stringify(other));
  }
  // Older than a passive refresh, the phone is asked again, as a poll would.
  assert.equal(launchPlanFor(plan, 1000, { ...pick, now: 1000 + 120000 }), null);
  assert.equal(launchPlanFor(plan, null, { ...pick, now: 1000 }), null);
  assert.equal(launchPlanFor(null, 1000, { ...pick, now: 1000 }), null);
  assert.equal(launchPlanFor({ ...plan, exercises: [] }, 1000, { ...pick, now: 1000 }), null);
  assert.equal(launchPlanFor({ ...plan, unit: null }, 1000, { ...pick, now: 1000 }), null);
});

const WEEKS = [
  { number: 1, name: 'Semaine 1', days: [{ number: 1, name: 'Mardi' }, { number: 2, name: 'Jeudi' }] },
  { number: 2, name: 'Semaine 2', days: [{ number: 1, name: 'Mardi' }, { number: 2, name: 'Jeudi' }] },
  { number: 3, name: 'Semaine 3', days: [{ number: 1, name: 'Mardi' }, { number: 2, name: 'Jeudi' }] },
];

test('features the program Liftosaur marks active', () => {
  assert.equal(
    suggestedProgramIndex([{ isCurrent: false }, { isCurrent: true }, { isCurrent: false }]),
    1
  );
  assert.equal(suggestedProgramIndex([{ isCurrent: false }]), -1);
  assert.equal(suggestedProgramIndex([]), -1);
});

test('features the week the last workout was in', () => {
  assert.equal(suggestedWeekIndex(WEEKS, { week: 2, dayInWeek: 1 }), 1);
});

test('rolls over to the next week when the last day of a week is done', () => {
  assert.equal(suggestedWeekIndex(WEEKS, { week: 2, dayInWeek: 2 }), 2);
});

test('stays on the last week rather than rolling off the end', () => {
  assert.equal(suggestedWeekIndex(WEEKS, { week: 3, dayInWeek: 2 }), 2);
});

test('features nothing when there is no history to point at', () => {
  assert.equal(suggestedWeekIndex(WEEKS, null), -1);
  assert.equal(suggestedWeekIndex(WEEKS, { week: null }), -1);
  assert.equal(suggestedWeekIndex(WEEKS, { week: 9, dayInWeek: 1 }), -1);
  assert.equal(suggestedWeekIndex([], { week: 1, dayInWeek: 1 }), -1);
});

test('features the day after the one last logged', () => {
  assert.equal(suggestedDayIndex(WEEKS[1], { week: 2, dayInWeek: 1 }), 1);
});

test('features the first day of a week the user has not touched', () => {
  assert.equal(suggestedDayIndex(WEEKS[2], { week: 2, dayInWeek: 2 }), 0);
});

test('features nothing when the week is already finished', () => {
  assert.equal(suggestedDayIndex(WEEKS[1], { week: 2, dayInWeek: 2 }), -1);
});

test('features nothing without a usable last workout', () => {
  assert.equal(suggestedDayIndex(WEEKS[0], null), -1);
  assert.equal(suggestedDayIndex(null, { week: 1, dayInWeek: 1 }), -1);
  assert.equal(suggestedDayIndex({ number: 1, days: [] }, { week: 1, dayInWeek: 1 }), -1);
});

test('the start button offers the day after the last one logged', () => {
  const start = suggestedStart(WEEKS, { week: 2, dayInWeek: 1 });
  assert.equal(start.week.number, 2);
  assert.equal(start.day.number, 2);
});

test('the start button rolls into the next week when one is finished', () => {
  const start = suggestedStart(WEEKS, { week: 2, dayInWeek: 2 });
  assert.equal(start.week.number, 3);
  assert.equal(start.day.number, 1);
});

test('the start button offers the first day when there is no history', () => {
  const start = suggestedStart(WEEKS, null);
  assert.equal(start.week.number, 1);
  assert.equal(start.day.number, 1);
});

test('the start button stays on the final week at the end of a program', () => {
  const start = suggestedStart(WEEKS, { week: 3, dayInWeek: 2 });
  assert.equal(start.week.number, 3);
  assert.equal(start.day.number, 1);
});

test('there is nothing to start in an empty program', () => {
  assert.equal(suggestedStart([], null), null);
  assert.equal(suggestedStart([{ number: 1, name: 'W', days: [] }], null), null);
});

test('removes the featured entry and keeps the order of the rest', () => {
  assert.deepEqual(withoutIndex(['a', 'b', 'c'], 1), ['a', 'c']);
  assert.deepEqual(withoutIndex(['a', 'b', 'c'], 0), ['b', 'c']);
});

test('keeps the whole list when nothing is featured', () => {
  assert.deepEqual(withoutIndex(['a', 'b'], -1), ['a', 'b']);
});

test('recovers the program from a saved completed session after an app restart', () => {
  const plan = { programId: 'p1', programName: 'Strength' };
  assert.deepEqual(programForSavedPlan(null, [], plan), {
    id: 'p1',
    name: 'Strength',
    isCurrent: true,
  });
});
