import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createWorkoutDiagnostics, WORKOUT_DIAGNOSTIC_CODES } from '../shared/workout-diagnostics.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';

const source = readFileSync(new URL('../page/common/index.js', import.meta.url), 'utf8');
const sendSource = source.slice(source.indexOf('function send('), source.indexOf('\n}', source.indexOf('function send(')) + 2);

function fixture(enabled, reply = Promise.resolve({ payload: { workoutDiagnosticsEnabled: true } })) {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key),
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const diagnostics = createWorkoutDiagnostics(storage, () => 1_000);
  if (enabled) {
    diagnostics.setEnabled(true);
    diagnostics.record(WORKOUT_DIAGNOSTIC_CODES.BOOT);
    diagnostics.record(WORKOUT_DIAGNOSTIC_CODES.ACTION_TAP);
  }
  let request;
  const env = {
    isTearingDown: false,
    pageInstance: { request: message => {
      request = message;
      return reply;
    } },
    MESSAGE_TYPES, workoutDiagnostics: diagnostics, WORKOUT_DIAGNOSTIC_CODES,
    normalizeWorkoutDiagnosticsEnabled: value => value === true,
    createMessage: value => value,
    withRequestTimeout: value => value,
    PHONE_REQUEST_TIMEOUT_MS: 1_000,
    Promise, Error,
  };
  vm.createContext(env);
  vm.runInContext(sendSource, env);
  return { env, diagnostics, get request() { return request; } };
}

test('Companion forwards opt-in watch steps during settings refresh', async () => {
  const state = fixture(true);
  await state.env.send(MESSAGE_TYPES.GET_SETTINGS);
  assert.deepEqual(state.request.payload.diagnostics, state.diagnostics.read());
  assert.deepEqual(state.request.payload.diagnostics.events.map(event => event.code), ['BOOT', 'ACTION_TAP']);
});

test('Companion learns the phone opt-in before recording and forwarding steps', async () => {
  const state = fixture(false);
  await state.env.send(MESSAGE_TYPES.GET_SETTINGS);
  assert.equal(state.request.payload.diagnostics, undefined);
  assert.equal(state.diagnostics.isEnabled(), true);
  assert.equal(state.diagnostics.read().events[0].code, 'DIAGNOSTICS_ON');
  await state.env.send(MESSAGE_TYPES.GET_SETTINGS);
  assert.deepEqual(state.request.payload.diagnostics, state.diagnostics.read());
});

test('a late phone reply cannot enable diagnostics after the Companion page closes', async () => {
  let resolve;
  const reply = new Promise(yes => { resolve = yes; });
  const state = fixture(false, reply);
  const request = state.env.send(MESSAGE_TYPES.GET_SETTINGS);
  state.env.isTearingDown = true;
  resolve({ payload: { workoutDiagnosticsEnabled: true } });
  await assert.rejects(request, /closed/);
  assert.equal(state.diagnostics.isEnabled(), false);
});

test('Companion records set boundaries around the durable local action', () => {
  const events = [];
  const start = source.indexOf('function completeCurrentSet(');
  const completeSource = source.slice(start, source.indexOf('\n}', start) + 2);
  const env = {
    session: {
      view: () => ({ currentSet: { reps: 5 }, state: 'ACTIVE_SET' }),
      completeSet: () => events.push('persisted'),
    },
    checkRequiredPhoneInput: () => null,
    persistAndRender: action => action(),
    synchronizeDirectSets: () => Promise.resolve(),
    workoutDiagnostics: { record: code => events.push(code) },
    WORKOUT_DIAGNOSTIC_CODES,
    SESSION_STATES: { FINISHED: 'FINISHED' },
    Promise,
  };
  vm.createContext(env);
  vm.runInContext(completeSource, env);
  env.completeCurrentSet();
  assert.deepEqual(events, ['SET_TAP', 'persisted', 'SET_SAVED']);
});

test('Companion samples only whitelisted diagnostic codes and rotates on restart', () => {
  assert.match(source, /createWorkoutDiagnostics\(deviceStorage/);
  assert.match(source, /readWorkoutMemory\(appApi\.getPackageInfo, appApi\.getPerformance\)/);
  assert.match(source, /workoutDiagnostics\.record\(WORKOUT_DIAGNOSTIC_CODES\.BOOT\)/);
  assert.match(source, /workoutDiagnostics\.record\(WORKOUT_DIAGNOSTIC_CODES\.BUILD\)/);
  assert.doesNotMatch(source, /workoutDiagnostics\.record\([^)]*(?:dayName|exerciseName|apiKey|weight|reps)/);
});
