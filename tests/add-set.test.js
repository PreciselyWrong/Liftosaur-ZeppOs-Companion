import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorkoutSession, SESSION_STATES } from '../shared/workout-session.js';
import { createWorkoutController } from '../shared/workout-controller.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';
import { buildApiWorkout, createFakeCloud, createPhoneLink, flush } from './helpers/phone-harness.js';

const plan = () => ({
  programId: 'extra',
  unit: 'kg',
  exercises: [
    { index: 1, entryId: 'squat', name: 'Squat', sets: [
      { index: 1, setId: 'sq1', targetReps: 5, targetWeight: 100, restSeconds: 60 },
      { index: 2, setId: 'sq2', targetReps: 5, targetWeight: 100, restSeconds: 60 },
    ] },
    { index: 2, entryId: 'bench', name: 'Bench', sets: [
      { index: 1, setId: 'bp1', targetReps: 8, targetWeight: 60, restSeconds: 60 },
    ] },
  ],
});

function finishedDay() {
  const session = createWorkoutSession({ plan: plan() });
  session.startWorkout({ timestamp: 0 });
  let t = 1000;
  for (let i = 0; i < 3; i++) {
    session.completeSet({ timestamp: t += 1000 });
    if (session.state() === SESSION_STATES.REST) session.nextSet({ timestamp: t += 1000 });
  }
  assert.equal(session.state(), SESSION_STATES.FINISHED);
  return { session, t };
}

test('an extra set reopens a finished day on that exercise with the last work set as its target', () => {
  const { session, t } = finishedDay();
  const setId = session.addSet({ exerciseIndex: 0, setId: 'extra1', timestamp: t + 1000 });
  assert.equal(setId, 'extra1');
  assert.equal(session.state(), SESSION_STATES.ACTIVE_SET);
  const view = session.view(t + 2000);
  assert.equal(view.currentSet.setId, 'extra1');
  assert.equal(view.currentSet.totalWorkSets, 3);
  assert.equal(view.currentSet.workSetIndex, 3);
  assert.equal(view.currentSet.weight, 100);
  assert.equal(view.currentSet.reps, 5);

  session.completeSet({ timestamp: t + 5000 });
  assert.equal(session.state(), SESSION_STATES.FINISHED);
  assert.deepEqual(session.getLastWorkoutSetWrite(), {
    entryId: 'squat', setId: 'extra1', append: true, completed: { reps: 5, weight: '100kg' },
  });
  assert.equal(session.getWorkoutSetWrites().filter((write) => write.append).length, 1, 'only the new set is an append');
});

test('an extra set uses the weight and reps the lifter dialled in, like any other set', () => {
  const { session, t } = finishedDay();
  session.addSet({ exerciseIndex: 0, setId: 'extra1', timestamp: t + 1000 });
  session.adjustWeight(2, { timestamp: t + 2000 });
  session.adjustReps(-1, { timestamp: t + 2100 });
  session.completeSet({ timestamp: t + 5000 });
  assert.deepEqual(session.getLastWorkoutSetWrite().completed, { reps: 4, weight: '105kg' });
});

test('an extra set during the workout waits its turn behind the sets still to do', () => {
  const session = createWorkoutSession({ plan: plan() });
  session.startWorkout({ timestamp: 0 });
  session.addSet({ exerciseIndex: 1, setId: 'extra1', timestamp: 500 });
  assert.equal(session.view(600).currentSet.setId, 'sq1', 'the current set does not change');
  session.completeSet({ timestamp: 1000 });
  session.nextSet({ timestamp: 1100 });
  session.completeSet({ timestamp: 2000 });
  session.nextSet({ timestamp: 2100 });
  session.completeSet({ timestamp: 3000 });
  assert.equal(session.state(), SESSION_STATES.REST);
  session.nextSet({ timestamp: 3100 });
  assert.equal(session.view(3200).currentSet.setId, 'extra1');
  assert.equal(session.view(3200).currentSet.totalWorkSets, 2);
});

test('an extra set is refused before the start, after the finish and for an unknown exercise', () => {
  const idle = createWorkoutSession({ plan: plan() });
  assert.equal(idle.canAddSet(0), false);
  assert.equal(idle.addSet({ exerciseIndex: 0, setId: 'x' }), null);

  const { session, t } = finishedDay();
  assert.equal(session.canAddSet(5), false);
  assert.equal(session.addSet({ exerciseIndex: 5, setId: 'x', timestamp: t }), null);
  assert.equal(session.canAddSet(0), true);

  const closed = createWorkoutSession({ plan: plan() });
  closed.startWorkout({ timestamp: 0 });
  closed.finishWorkout({ timestamp: 10 });
  assert.equal(closed.canAddSet(0), false, 'a workout the lifter ended stays ended');
  assert.equal(session.addSet({ exerciseIndex: 0, setId: 'extra1', timestamp: t + 1 }), 'extra1');
  assert.equal(session.addSet({ exerciseIndex: 0, setId: 'extra1', timestamp: t + 2 }), null, 'a set id is used once');
});

test('replaying the journal rebuilds the extra set, its state and its write', () => {
  const { session, t } = finishedDay();
  session.addSet({ exerciseIndex: 0, setId: 'extra1', timestamp: t + 1000 });
  session.completeSet({ timestamp: t + 5000 });
  const replayed = createWorkoutSession({ plan: plan(), initialJournal: session.getJournal() });
  assert.deepEqual(replayed.getWorkoutSetWrites(), session.getWorkoutSetWrites());
  assert.equal(replayed.state(), session.state());
  assert.equal(replayed.view(t + 6000).totalSets, session.view(t + 6000).totalSets);
});

test('a generated set id looks like the ones Liftosaur makes and differs each time', () => {
  const { session, t } = finishedDay();
  const first = session.addSet({ exerciseIndex: 0, timestamp: t + 1 });
  const second = session.addSet({ exerciseIndex: 0, timestamp: t + 2 });
  assert.match(first, /^[a-z]{6}$/);
  assert.notEqual(first, second);
});

test('the controller sends an extra set as an append, saves it, and the account gains the set', async () => {
  const cloud = createFakeCloud(buildApiWorkout([[0, 1]]));
  const link = createPhoneLink(cloud);
  link.setAuto(true);
  let clock = 1_700_000_000_000;
  const controller = createWorkoutController({ now: () => clock, request: link.request });
  const { workout } = await cloud.client.startRunningWorkout({ startTime: clock });
  controller.loadPlan(workoutToDayPlan(workout), { sync: { mode: 'DIRECT', startConfirmed: true } });
  controller.startWorkout();
  clock += 1000;
  controller.completeSet();
  await controller.syncSets();
  assert.equal(controller.view().state, SESSION_STATES.FINISHED);

  clock += 1000;
  assert.equal(controller.canAddSet(0), true);
  const setId = controller.addSet(0);
  assert.match(setId, /^[a-z]{6}$/);
  assert.equal(controller.view().state, SESSION_STATES.ACTIVE_SET);
  clock += 1000;
  controller.completeSet();
  await controller.syncSets();

  const last = cloud.log[cloud.log.length - 1];
  assert.equal(last.append, true);
  assert.equal(last.setId, setId);
  assert.equal(cloud.completedSets().length, 2, 'the account holds both sets');
  assert.equal(controller.getPendingSetCount(), 0);
  assert.equal(link.sent.filter((message) => message.type === MESSAGE_TYPES.SYNC_WORKOUT_SETS).length, 2);
});
