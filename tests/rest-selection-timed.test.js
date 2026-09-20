import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkoutSession, SESSION_STATES } from '../shared/workout-session.js';

const plan = {
  programId: 'selected-timer', unit: 'kg',
  exercises: [
    { index: 1, name: 'Squat', sets: [{ setId: 'squat', targetReps: 5, targetWeight: 80, restSeconds: 60 }] },
    { index: 2, name: 'Automatic next', sets: [{ setId: 'automatic', targetReps: 8, targetWeight: 20, restSeconds: 60 }] },
    { index: 3, name: 'Chosen plank', sets: [{ setId: 'plank', targetReps: 1, targetWeight: 0, setTimer: 30, restSeconds: 60 }] },
  ],
};

test('arming a manually selected timed exercise preserves its identity through rest and replay', () => {
  const session = createWorkoutSession({ plan });
  session.startWorkout({ timestamp: 0 });
  session.completeSet({ timestamp: 1000 });
  session.selectExercise(2, { timestamp: 2000 });
  session.startTimedSet({ timestamp: 3000, getReadySeconds: 5 });
  const journal = session.getJournal();
  for (const candidate of [session, createWorkoutSession({ plan, initialJournal: journal })]) {
    const armed = candidate.view(4000);
    assert.equal(armed.pending.set.setId, 'plank');
    assert.equal(armed.timedSet.phase, 'REST');
    assert.equal(armed.rest.endsAt, 61000);
    candidate.selectExercise(1, { timestamp: 5000 });
    assert.equal(candidate.view(5000).pending.set.setId, 'plank', 'armed timer blocks new navigation');
    candidate.advanceTimedSet({ timestamp: 56000 });
    assert.equal(candidate.view(56000).state, SESSION_STATES.ACTIVE_SET);
    assert.equal(candidate.view(56000).currentSet.setId, 'plank');
    assert.equal(candidate.view(56000).timedSet.phase, 'GET_READY');
    candidate.advanceTimedSet({ timestamp: 61000 });
    assert.equal(candidate.view(61000).currentSet.setId, 'plank');
    assert.equal(candidate.view(61000).timedSet.phase, 'WORK');
  }
});

test('journals saved before rest-preserving selection retain their completed exercise writes', () => {
  const legacyJournal = [
    { type: 'START_WORKOUT', timestamp: 0 },
    { type: 'COMPLETE_SET', timestamp: 1000, payload: { exerciseIndex: 1, setIndex: 1, setId: 'squat', weight: 80, reps: 5 } },
    { type: 'SELECT_EXERCISE', timestamp: 2000, payload: { exerciseIndex: 1 } },
    { type: 'COMPLETE_SET', timestamp: 3000, payload: { exerciseIndex: 2, setIndex: 1, setId: 'automatic', weight: 20, reps: 8 } },
  ];
  const restored = createWorkoutSession({ plan, initialJournal: legacyJournal });
  assert.equal(restored.view(4000).totalCompletedSetsCount, 2);
  assert.deepEqual(restored.getWorkoutSetWrites().map(write => write.setId), ['squat', 'automatic']);
  assert.equal(restored.view(4000).rest.startedAt, 3000);
});
