import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  createRestPresentationState,
  normalizeAutoPrepare,
  updateRestPresentation,
} from '../shared/auto-prepare.js';
import { createWorkoutSession } from '../shared/workout-session.js';

const root = process.cwd();
const companionSource = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
const workoutSource = fs.readFileSync(path.join(root, 'data-widget', 'common', 'index.js'), 'utf8');

test('Auto prepare is opt-in and accepts phone storage shapes', () => {
  for (const value of [true, 'true', { value: true }, { value: 'true' }, JSON.stringify({ value: 'true' })]) {
    assert.equal(normalizeAutoPrepare(value), true);
  }
  for (const value of [undefined, null, false, 'false', '', 0, 1, {}, 'invalid']) {
    assert.equal(normalizeAutoPrepare(value), false);
  }
});

test('each new rest opens Prepare once while an explicit Rest choice stays open', () => {
  let state = createRestPresentationState();

  state = updateRestPresentation(state, { identity: 'set-a:1000', startedAt: 1_000, endsAt: 61_000 }, true);
  assert.deepEqual(state, { restIdentity: 'set-a:1000', isPrepared: true });

  state = { ...state, isPrepared: false };
  assert.deepEqual(
    updateRestPresentation(state, { identity: 'set-a:1000', startedAt: 8_000, endsAt: 68_000, remaining: -5 }, true),
    state,
    'overtime must not reopen Prepare or start the set'
  );

  state = updateRestPresentation(state, { identity: 'set-b:70000', startedAt: 70_000, endsAt: 130_000 }, true);
  assert.deepEqual(state, { restIdentity: 'set-b:70000', isPrepared: true });
  assert.deepEqual(updateRestPresentation(state, null, true), { restIdentity: null, isPrepared: false });
});

test('disabled Auto prepare keeps the detailed rest screen for a new rest', () => {
  const state = updateRestPresentation(
    createRestPresentationState(),
    { identity: 'set-a:1000', startedAt: 1_000, endsAt: 61_000 },
    false
  );
  assert.deepEqual(state, { restIdentity: 'set-a:1000', isPrepared: false });
});

function plan(exercises) {
  return { programId: 'auto-prepare', unit: 'kg', exercises };
}

test('Prepare identifies changed weight, reps and RPE against the last completed set', () => {
  const session = createWorkoutSession({
    plan: plan([{
      index: 1,
      entryId: 'entry-a',
      name: 'Squat',
      sets: [
        { setId: 'a1', targetWeight: 100, targetReps: 5, targetRpe: 8, logRpe: true, restSeconds: 60 },
        { setId: 'a2', targetWeight: 105, targetReps: 6, targetRpe: 9, logRpe: true, restSeconds: 60 },
      ],
    }]),
  });
  session.startWorkout({ timestamp: 0 });
  assert.deepEqual(session.view(0).pending.changes, {
    exercise: false, weight: false, reps: false, rpe: false,
  });

  session.completeSet({ timestamp: 1_000 });
  assert.deepEqual(session.view(1_000).pending.changes, {
    exercise: false, weight: true, reps: true, rpe: true,
  });

  session.adjustWeight(-2);
  session.adjustReps(-1);
  session.adjustRpe(-1);
  assert.deepEqual(session.view(1_000).pending.changes, {
    exercise: false, weight: false, reps: false, rpe: false,
  });
});

test('Prepare identifies a change of exercise', () => {
  const session = createWorkoutSession({
    plan: plan([
      { index: 1, entryId: 'entry-a', name: 'Squat', sets: [{ setId: 'a1', targetWeight: 100, targetReps: 5, restSeconds: 60 }] },
      { index: 2, entryId: 'entry-b', name: 'Press', sets: [{ setId: 'b1', targetWeight: 50, targetReps: 8, restSeconds: 60 }] },
    ]),
  });
  session.startWorkout({ timestamp: 0 });
  session.completeSet({ timestamp: 1_000 });
  assert.equal(session.view(1_000).pending.changes.exercise, true);
});

for (const [name, source] of [['Companion', companionSource], ['Workout', workoutSource]]) {
  test(`${name} Prepare keeps rest, workout time, heart rate, bezel and explicit start visible`, () => {
    const start = source.indexOf('function renderActiveSetScreen(');
    const end = source.indexOf('function renderRestScreen(', start);
    const active = source.slice(start, end);

    assert.match(active, /renderPreparedTopBar\(view/);
    assert.match(active, /renderRestBezel\(view\.rest\)/);
    assert.match(active, /\\u25b6 Start set/);
    assert.match(active, /pending\?\.changes/);
    assert.match(active, /renderChangeUnderline/);
  });
}

test('Workout no longer advances the prepared set when rest reaches zero', () => {
  assert.doesNotMatch(workoutSource, /shouldAutoStartPreparedSet/);
  assert.doesNotMatch(workoutSource, /remaining\s*<=\s*0[\s\S]{0,200}workoutController\.nextSet\(\)/);
});
