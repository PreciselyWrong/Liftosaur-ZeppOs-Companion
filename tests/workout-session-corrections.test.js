import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkoutSession, SESSION_STATES, EVENT_TYPES } from '../shared/workout-session.js';

function makeSimplePlan() {
  return {
    programId: 'p1',
    week: 1,
    dayInWeek: 1,
    unit: 'kg',
    exercises: [
      {
        id: 'e1',
        entryId: 'entry-1',
        name: 'Bench Press',
        index: 0,
        warmupSetsCount: 0,
        workSetsCount: 2,
        sets: [
          { index: 1, setId: 's1', targetWeight: 60, targetReps: 8, restSeconds: 90 },
          { index: 2, setId: 's2', targetWeight: 60, targetReps: 8, restSeconds: 90 },
        ],
      },
    ],
  };
}

test('session: completes a set and can identify the latest completed set', () => {
  const plan = makeSimplePlan();
  const session = createWorkoutSession({ plan });
  session.startWorkout({ timestamp: 1000 });

  assert.equal(session.canCorrectLastSet().allowed, false);
  assert.equal(session.canCorrectLastSet().reason, 'No completed sets');

  session.completeSet({ timestamp: 2000, weight: 60, reps: 8 });
  const check = session.canCorrectLastSet();
  assert.equal(check.allowed, true);
  assert.equal(check.set.setId, 's1');
  assert.equal(check.set.weight, 60);
  assert.equal(check.set.reps, 8);
  assert.equal(check.set.completedAt, 2000);
});

test('session: correctSet updates weight and reps while preserving completedAt, rest, pause, and units', () => {
  const plan = makeSimplePlan();
  const session = createWorkoutSession({ plan });
  session.startWorkout({ timestamp: 1000 });
  session.completeSet({ timestamp: 2000, weight: 60, reps: 8 });

  // Currently in REST state with rest countdown
  assert.equal(session.view(2000).state, SESSION_STATES.REST);
  const restBefore = session.view(2500).rest;
  assert.ok(restBefore);
  assert.equal(restBefore.remaining, 90);

  // Correct the completed set
  session.correctSet({ setId: 's1', weight: 65, reps: 10, timestamp: 2500 });

  // Check that rest is intact
  const restAfter = session.view(2500).rest;
  assert.equal(restAfter.remaining, restBefore.remaining);
  assert.equal(restAfter.endsAt, restBefore.endsAt);

  // Check set values
  const check = session.canCorrectLastSet();
  assert.equal(check.set.weight, 65);
  assert.equal(check.set.reps, 10);
  assert.equal(check.set.completedAt, 2000, 'Local time of completing set must NOT change');
  assert.equal(check.set.unit, 'kg');

  // Completed sets payload for playground
  const completedSets = session.getCompletedSets();
  assert.equal(completedSets.length, 1);
  assert.equal(completedSets[0].weight, 65);
  assert.equal(completedSets[0].reps, 10);

  // Writes list contains original and correction
  const writes = session.getWorkoutSetWrites();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].completed, { reps: 8, weight: '60kg' });
  assert.deepEqual(writes[1].completed, { reps: 10, weight: '65kg' });
});

test('session: replaying journal reconstructs identical state, writes and completed sets', () => {
  const plan = makeSimplePlan();
  const session1 = createWorkoutSession({ plan });
  session1.startWorkout({ timestamp: 1000 });
  session1.completeSet({ timestamp: 2000, weight: 60, reps: 8 });
  session1.correctSet({ setId: 's1', weight: 62.5, reps: 7, timestamp: 3000 });

  const journal = session1.getJournal();
  const session2 = createWorkoutSession({ plan, initialJournal: journal });

  assert.deepEqual(session2.getWorkoutSetWrites(), session1.getWorkoutSetWrites());
  assert.deepEqual(session2.getCompletedSets(), session1.getCompletedSets());
  assert.equal(session2.canCorrectLastSet().set.weight, 62.5);
  assert.equal(session2.canCorrectLastSet().set.reps, 7);
  assert.equal(session2.canCorrectLastSet().set.completedAt, 2000);
});

test('session: rejects unsupported/ambiguous sets (finished, unilateral, missing values, imported order unknown)', () => {
  const plan = makeSimplePlan();
  const session = createWorkoutSession({ plan });
  session.startWorkout({ timestamp: 1000 });
  session.completeSet({ timestamp: 2000, weight: 60, reps: 8 });
  session.nextSet({ timestamp: 2500 });
  session.completeSet({ timestamp: 3000, weight: 60, reps: 8 });

  // All sets done -> finished
  assert.equal(session.view(3000).state, SESSION_STATES.FINISHED);
  assert.equal(session.canCorrectLastSet().allowed, false);
  assert.equal(session.canCorrectLastSet().reason, 'Session finished');

  // Unilateral exercise
  const unilateralPlan = {
    programId: 'p2',
    week: 1,
    dayInWeek: 1,
    unit: 'kg',
    exercises: [
      {
        id: 'u1',
        entryId: 'u-1',
        name: 'Single Arm Curl',
        index: 0,
        sets: [
          { index: 1, setId: 'u_s1', targetWeight: 10, targetReps: 10, isUnilateral: true, restSeconds: 60 },
          { index: 2, setId: 'u_s2', targetWeight: 10, targetReps: 10, isUnilateral: true, restSeconds: 60 },
        ],
      },
    ],
  };
  const uSession = createWorkoutSession({ plan: unilateralPlan });
  uSession.startWorkout({ timestamp: 1000 });
  uSession.completeSet({ timestamp: 2000, weight: 10, reps: 10, repsLeft: 10 });
  assert.equal(uSession.canCorrectLastSet().allowed, false);
  assert.equal(uSession.canCorrectLastSet().reason, 'Unilateral repetitions unsupported');

  // Imported workout with multiple exercises completed on server
  const importedPlan = {
    programId: 'p3',
    week: 1,
    dayInWeek: 1,
    unit: 'kg',
    isCurrent: true,
    exercises: [
      {
        id: 'i1',
        entryId: 'i-1',
        name: 'Squat',
        index: 0,
        sets: [
          { index: 1, setId: 'i_s1', completed: { weight: '100kg', reps: 5 } },
          { index: 2, setId: 'i_s2', targetWeight: 100, targetReps: 5 },
        ],
      },
      {
        id: 'i2',
        entryId: 'i-2',
        name: 'Leg Press',
        index: 1,
        sets: [
          { index: 1, setId: 'i_s3', completed: { weight: '150kg', reps: 10 } },
          { index: 2, setId: 'i_s4', targetWeight: 150, targetReps: 10 },
        ],
      },
    ],
  };
  const importedSession = createWorkoutSession({ plan: importedPlan });
  // No local sets were completed; order between imported exercises is unknown
  assert.equal(importedSession.canCorrectLastSet().allowed, false);
  assert.equal(importedSession.canCorrectLastSet().reason, 'Imported order unknown');
});


test('session rejects an older target and unilateral sets even without left-side results', () => {
  const plan = makeSimplePlan();
  plan.exercises[0].sets.push({ index: 3, setId: 's3', targetWeight: 60, targetReps: 8 });
  const session = createWorkoutSession({ plan });
  session.startWorkout({ timestamp: 1000 });
  session.completeSet({ timestamp: 2000 });
  session.nextSet({ timestamp: 2100 });
  session.completeSet({ timestamp: 3000 });
  const before = session.getWorkoutSetWrites();
  assert.equal(session.correctSet({ setId: 's1', weight: 70, reps: 9 }), false);
  assert.deepEqual(session.getWorkoutSetWrites(), before);
  plan.exercises[0].sets[0].isUnilateral = true;
  const unilateral = createWorkoutSession({ plan });
  unilateral.startWorkout({ timestamp: 1000 });
  unilateral.completeSet({ timestamp: 2000 });
  assert.equal(unilateral.canCorrectLastSet().allowed, false);
});
