import assert from 'node:assert/strict';
import test from 'node:test';

import { loadWatchPage } from './helpers/watch-page.js';
import { buildApiWorkout, createFakeCloud, createPhoneLink, flush } from './helpers/phone-harness.js';
import { createWorkoutService } from '../app-side/workout-service.js';
import { createDummyProgramService } from '../app-side/dummy-program-service.js';

// The Workout interface from its first screen to the saved workout: the lifter's taps go in, the real
// controller, protocol and Side Service run, and the Liftosaur account model on the far side is read back.
const START = 1_700_000_000_000;
const DAY = [[0, 2], [0, 1]];

async function workoutOnWatch({ auto = true } = {}) {
  const cloud = createFakeCloud(buildApiWorkout(DAY));
  await cloud.client.startRunningWorkout({ startTime: START - 60_000 });
  const catalogService = { ...createDummyProgramService(), mode: 'CLOUD' };
  const link = createPhoneLink(cloud, { workoutService: createWorkoutService({ client: cloud.client, catalogService }) });
  link.setAuto(true);
  const watch = await loadWatchPage('workout', { link, start: START });
  await settle(watch);
  link.setAuto(auto);
  return { ...watch, cloud, link };
}

async function settle(watch, ms = 0) {
  await flush();
  watch.clock.advance(ms);
  await flush();
}

async function tap(watch, text, index = 0) {
  const targets = watch.screen.widgets.filter((w) => w.visible && typeof w.props.click_func === 'function' && w.props.text === text);
  assert.ok(targets[index], `a "${text}" button among ${JSON.stringify(watch.screen.texts())}`);
  targets[index].props.click_func(targets[index]);
  await settle(watch, 1500);
}

const shows = (watch, text) => watch.screen.texts().some((shown) => shown.includes(text));

test('a lifter edits a set, completes the day and the account holds exactly what was lifted', async () => {
  const watch = await workoutOnWatch();
  assert.ok(shows(watch, 'SET 1/2'));

  await tap(watch, '+', 0);
  assert.ok(shows(watch, '62.5'), 'the weight stepper shows the edit');
  await tap(watch, 'Done');
  assert.ok(shows(watch, 'Rest'), 'resting after the first set');
  await tap(watch, 'Start set');
  await tap(watch, 'Done');
  await tap(watch, 'Start set');
  assert.ok(shows(watch, 'Exercise 2'));
  await tap(watch, 'Done');

  assert.ok(shows(watch, 'Workout complete'));
  assert.ok(shows(watch, 'Liftosaur saved.'));
  assert.equal(watch.cloud.history.length, 1, 'one finished workout');
  const sets = watch.cloud.completedSets(watch.cloud.history[0].workout);
  assert.equal(sets.length, 3);
  assert.equal(sets[0].completed.weight, '62.5kg', 'the edited weight, not the target');
  assert.equal(sets[1].completed.weight, '60kg');
  assert.equal(watch.cloud.current(), null, 'nothing is left running on the account');
  assert.equal(watch.link.queue.length, 0);
});

test('sets completed while the phone link drops reach the account once, in order, before the workout is saved', async () => {
  const watch = await workoutOnWatch({ auto: false });
  await tap(watch, 'Done');
  assert.equal(watch.link.queue.filter((item) => item.type === 'SYNC_WORKOUT_SETS').length, 1);
  await watch.link.deliver(0, 'lost');
  await settle(watch, 1000);
  assert.ok(shows(watch, 'Rest'), 'the watch keeps going without the phone');
  assert.equal(watch.cloud.log.length, 0, 'nothing reached the account yet');

  await tap(watch, 'Start set');
  await tap(watch, 'Done');
  await tap(watch, 'Start set');
  await tap(watch, 'Done');
  assert.ok(shows(watch, 'Workout complete'), 'the day is finished on the watch alone');
  assert.equal(watch.cloud.history.length, 0, 'but the account is not told it is saved');

  watch.link.setAuto(true);
  await watch.link.deliver(0, 'ok').catch(() => {});
  for (let i = 0; i < 6; i++) await settle(watch, 5000);
  await flush();
  const written = watch.cloud.log.map((write) => write.setId);
  assert.equal(new Set(written).size, written.length, 'no set is written twice');
  assert.equal(written.length, 3, 'every set is written');
  assert.equal(watch.cloud.history.length, 1, 'the workout is saved once the phone answers');
});
