import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as autoPrepareHelpers from '../shared/auto-prepare.js';
import { createWorkoutSession, SESSION_STATES } from '../shared/workout-session.js';

const { createRestPresentationState, updateRestPresentation } = autoPrepareHelpers;

function renderer(product, session, autoPrepare, storedPreferences = new Map()) {
  const source = fs.readFileSync(new URL(`../${product}/common/index.js`, import.meta.url), 'utf8');
  const screens = { SESSION: 'SESSION' };
  const rendered = [];
  const env = {
    ...autoPrepareHelpers, deviceStorage: { getItem: key => storedPreferences.get(key) },
    session, workoutController: { view: () => session.view(), sync: () => ({}) },
    SESSION_STATES, SCREEN: screens, EXTENSION_SCREENS: screens, screen: screens.SESSION,
    accountSettings: { autoPrepare }, restPresentation: createRestPresentationState(),
    createRestPresentationState, updateRestPresentation,
    isRestMinimized: false, isWorkoutTimerControlsOpen: false, isNotesModalOpen: false,
    isEditLastSetOpen: false, lastSetDraft: null, isSyncDetailsOpen: false,
    isOverviewOpen: false, discardConfirmationRequested: false, phoneRequiredReason: null,
    directSync: {}, lastRenderedState: null, lastRenderedSecond: null,
    renderActiveSetScreen: view => rendered.push(view.rest ? 'Prepare' : 'Active'),
    renderRestScreen: () => rendered.push('Rest'),
    renderFinishedScreen: () => rendered.push('Finished'),
    renderTimedSetScreen: () => rendered.push('Timed'),
  };
  vm.createContext(env);
  if (autoPrepare === undefined) {
    const initializer = source.match(/let accountSettings = ([^;]+);/)[1];
    env.accountSettings = vm.runInContext('(' + initializer + ')', env);
  }
  for (const name of ['setRestPrepared', 'syncRestPresentation', 'renderScreen']) {
    const start = source.indexOf(`function ${name}(`);
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), env);
  }
  return { env, rendered };
}

function sessionPlan() {
  return { programId: 'prepare-routing', unit: 'kg', exercises: [{
    index: 1, entryId: 'squat', name: 'Squat', sets: [1, 2, 3].map(index => ({
      setId: `squat-${index}`, targetWeight: 100, targetReps: 5, restSeconds: 60,
    })),
  }] };
}

for (const product of ['page', 'data-widget']) {
  test(`${product}: every completed set opens Prepare on the first render before sync`, () => {
    const session = createWorkoutSession({ plan: sessionPlan() });
    session.startWorkout({ timestamp: 0 });
    const { env, rendered } = renderer(product, session, true);
    env.renderScreen();
    session.completeSet({ timestamp: 1_000 });
    env.renderScreen();
    env.setRestPrepared(false);
    env.renderScreen();
    session.nextSet({ timestamp: 2_000 });
    env.renderScreen();
    session.completeSet({ timestamp: 3_000 });
    env.renderScreen();
    assert.deepEqual(rendered, ['Active', 'Prepare', 'Rest', 'Active', 'Prepare']);
  });

  test(`${product}: disabled Auto prepare retains the detailed rest screen`, () => {
    const session = createWorkoutSession({ plan: sessionPlan() });
    session.startWorkout({ timestamp: 0 });
    const { env, rendered } = renderer(product, session, false);
    session.completeSet({ timestamp: 1_000 });
    env.renderScreen();
    assert.deepEqual(rendered, ['Rest']);
  });
}

for (const product of ['page', 'data-widget']) {
  test(`${product}: restored rest prepares before the phone settings reply`, () => {
    const plan = sessionPlan();
    const original = createWorkoutSession({ plan });
    original.startWorkout({ timestamp: 0 });
    original.completeSet({ timestamp: 1_000 });
    const session = createWorkoutSession({ plan, initialJournal: original.getJournal() });
    const { env, rendered } = renderer(product, session, undefined,
      new Map([['liftosaur.autoPrepare', true]]));
    env.renderScreen();
    assert.deepEqual(rendered, ['Prepare']);
  });
}

for (const product of ['page', 'data-widget']) {
  test(`${product}: phone settings persist Auto prepare and can turn it off again`, async () => {
    const source = fs.readFileSync(new URL(`../${product}/common/index.js`, import.meta.url), 'utf8');
    const values = new Map();
    const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
    const env = {
      ...autoPrepareHelpers, deviceStorage: storage,
      accountSettings: {}, restPresentation: createRestPresentationState(),
      normalizeExerciseImages: Boolean, normalizeGetReadySeconds: value => value,
      normalizeWorkoutDiagnosticsEnabled: Boolean, exerciseImages: null,
      isNotesModalOpen: false, isTearingDown: false, lifecycleGeneration: 1,
      controllerUiDirty: false, screen: 'SESSION', SCREEN: { SESSION: 'SESSION' },
      EXTENSION_SCREENS: { SESSION: 'SESSION' }, MESSAGE_TYPES: { GET_SETTINGS: 'GET_SETTINGS' },
      workoutDiagnostics: { isEnabled: () => false, setEnabled() {} },
      workoutController: { configureTimedSets() {} }, applyDisplayHold() {}, renderUI() {},
    };
    vm.createContext(env);
    const name = product === 'page' ? 'adoptAccountSettings' : 'loadDisplaySettings';
    const start = source.indexOf(`function ${name}(`);
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), env);
    for (const autoPrepare of [true, false]) {
      env.send = async () => ({ payload: { autoPrepare } });
      await env[name]({ autoPrepare });
      assert.equal(autoPrepareHelpers.readAutoPreparePreference(storage), autoPrepare);
    }
  });
}

test('missing or failing preference storage cannot block the session', () => {
  const broken = { getItem() { throw new Error('unavailable'); }, setItem() { throw new Error('full'); } };
  for (const storage of [null, broken]) {
    assert.equal(autoPrepareHelpers.readAutoPreparePreference(storage), false);
    assert.doesNotThrow(() => autoPrepareHelpers.saveAutoPreparePreference(storage, true));
  }
});
