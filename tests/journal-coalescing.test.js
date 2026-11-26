/**
 * Repeated taps on the same value are stored as one journal event: every save
 * rewrites the journal, so it must grow with the workout, not with every tap.
 * Replaying the stored journal must still rebuild exactly the live state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkoutSession, EVENT_TYPES, SESSION_STATES } from '../shared/workout-session.js';
import { createRandom } from './helpers/phone-harness.js';

function makePlan({ targetWeight = 60, askWeight = false } = {}) {
  return {
    programId: 'coalesce',
    unit: 'kg',
    exercises: [1, 2].map((index) => ({
      index,
      entryId: `entry-${index}`,
      name: `Exercise ${index}`,
      sets: [1, 2, 3].map((setIndex) => ({
        index: setIndex,
        setId: `set-${index}-${setIndex}`,
        targetReps: 5,
        targetWeight: askWeight ? null : targetWeight,
        askWeight,
        targetRpe: 8,
        restSeconds: 60,
      })),
    })),
  };
}

function comparable(session, at) {
  const view = session.view(at);
  return JSON.stringify({ view, writes: session.getWorkoutSetWrites(), intervals: session.getWorkoutIntervals(at) });
}

test('repeated weight, reps and RPE taps on one set are journaled once each', () => {
  const plan = makePlan();
  const session = createWorkoutSession({ plan });
  session.startWorkout({ timestamp: 0 });
  for (let i = 0; i < 3; i++) session.adjustWeight(1, { timestamp: 1_000 + i });
  for (let i = 0; i < 2; i++) session.adjustReps(1, { timestamp: 2_000 + i });
  session.adjustRpe(0.5, { timestamp: 3_000 });
  session.adjustRpe(0.5, { timestamp: 3_001 });

  const journal = session.getJournal();
  assert.deepEqual(journal.map((event) => event.type), [
    EVENT_TYPES.START_WORKOUT, EVENT_TYPES.ADJUST_WEIGHT, EVENT_TYPES.ADJUST_REPS, EVENT_TYPES.ADJUST_RPE,
  ]);
  assert.equal(journal[1].payload.delta, 7.5);
  assert.equal(journal[2].payload.delta, 2);
  assert.equal(journal[3].payload.delta, 1);
  assert.equal(session.view(4_000).pending.set.weight, 67.5);

  const restored = createWorkoutSession({ plan, initialJournal: journal });
  assert.equal(comparable(restored, 4_000), comparable(session, 4_000));
});

test('repeated rest adjustments during one rest are journaled once', () => {
  const session = createWorkoutSession({ plan: makePlan() });
  session.startWorkout({ timestamp: 0 });
  session.completeSet({ timestamp: 10_000 });
  for (let i = 0; i < 4; i++) session.adjustRest(15, { timestamp: 11_000 + i });
  const rests = session.getJournal().filter((event) => event.type === EVENT_TYPES.ADJUST_REST);
  assert.equal(rests.length, 1);
  assert.equal(rests[0].payload.delta, 60);
});

test('taps on different sets or separated by another event stay separate', () => {
  const session = createWorkoutSession({ plan: makePlan() });
  session.startWorkout({ timestamp: 0 });
  session.adjustWeight(1, { timestamp: 1 });
  session.completeSet({ timestamp: 2 });
  session.adjustWeight(1, { timestamp: 3 });
  session.adjustReps(1, { timestamp: 4 });
  session.adjustWeight(1, { timestamp: 5 });
  assert.equal(session.getJournal().filter((event) => event.type === EVENT_TYPES.ADJUST_WEIGHT).length, 3);
});

test('a journal saved before coalescing restores unchanged', () => {
  const plan = makePlan();
  const legacy = [
    { type: EVENT_TYPES.START_WORKOUT, timestamp: 0 },
    { type: EVENT_TYPES.ADJUST_WEIGHT, payload: { delta: 2.5 }, timestamp: 1 },
    { type: EVENT_TYPES.ADJUST_WEIGHT, payload: { delta: 2.5 }, timestamp: 2 },
    { type: EVENT_TYPES.ADJUST_WEIGHT, payload: { delta: -2.5 }, timestamp: 3 },
    { type: EVENT_TYPES.COMPLETE_SET, timestamp: 4 },
  ];
  const restored = createWorkoutSession({ plan, initialJournal: legacy });
  assert.deepEqual(restored.getJournal(), legacy);
  assert.equal(restored.getWorkoutSetWrites()[0].completed.weight, '62.5kg');
});

test('random taps replay to the same state as the live session', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rnd = createRandom(seed);
    const plan = makePlan(rnd.chance(0.3) ? { askWeight: true } : { targetWeight: rnd.pick([0, 2.5, 5, 60]) });
    const session = createWorkoutSession({ plan });
    let time = 0;
    session.startWorkout({ timestamp: time });
    for (let step = 0; step < 80 && session.view(time).state !== SESSION_STATES.FINISHED; step++) {
      time += 1 + rnd.int(20_000);
      const roll = rnd.next();
      if (roll < 0.25) session.adjustWeight(rnd.int(7) - 3, { timestamp: time });
      else if (roll < 0.4) session.adjustReps(rnd.int(7) - 3, { timestamp: time });
      else if (roll < 0.5) session.adjustRpe((rnd.int(9) - 4) / 2, { timestamp: time });
      else if (roll < 0.62) session.adjustRest((rnd.int(9) - 4) * 15, { timestamp: time });
      else if (roll < 0.7) session.completeSet({ timestamp: time });
      else if (roll < 0.74) session.nextSet({ timestamp: time });
      else if (roll < 0.78) session.toggleRestPause({ timestamp: time });
      else if (roll < 0.82) session.pauseWorkout({ timestamp: time, source: rnd.pick(['manual', 'native']) });
      else if (roll < 0.86) session.resumeWorkout({ timestamp: time, source: rnd.pick(['manual', 'native']) });
      else if (roll < 0.9) session.selectExercise(rnd.int(2), { timestamp: time });
      else if (roll < 0.93) session.skipWarmup({ timestamp: time });
      const replayed = createWorkoutSession({ plan, initialJournal: session.getJournal() });
      assert.equal(comparable(replayed, time + 500), comparable(session, time + 500), `seed ${seed} step ${step}`);
    }
  }
});
