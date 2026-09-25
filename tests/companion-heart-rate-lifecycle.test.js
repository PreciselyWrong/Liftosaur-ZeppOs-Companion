import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../page/common/index.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sensorStart = source.indexOf('      try {\n        hrSensor = new HeartRate();');
const sensorEnd = source.indexOf('      // An interrupted session', sensorStart);
const destroyStart = source.lastIndexOf('    onDestroy() {');
const destroyEnd = source.indexOf('\n    },', destroyStart) + 7;

function fixture() {
  assert.ok(sensorStart >= 0 && sensorEnd > sensorStart);
  const callbacks = [];
  let reads = 0;
  const env = {
    isTearingDown: false, hrSensor: null, hrCallback: null, liveHr: '',
    HeartRate: class {
      getCurrent() { reads += 1; return 80; }
      onCurrentChange(callback) { callbacks.push(callback); }
    },
    cancelScheduledRender() {}, clockTimer: null, flashTimer: null,
    vibrationTimer: null, connectionRetryTimer: null, exerciseImages: null,
    console: { log() {} },
  };
  vm.createContext(env);
  const buildSensor = () => vm.runInContext(source.slice(sensorStart, sensorEnd), env);
  const destroy = () => vm.runInContext(`({${source.slice(destroyStart, destroyEnd)}}).onDestroy()`, env);
  return { env, callbacks, buildSensor, destroy, get reads() { return reads; } };
}

test('a queued heart-rate callback after Companion destruction cannot sample a released sensor', () => {
  const state = fixture();
  state.buildSensor();
  assert.equal(state.env.liveHr, '80');
  const queued = state.callbacks[0];
  state.destroy();
  const readsBefore = state.reads;
  assert.doesNotThrow(queued);
  assert.equal(state.reads, readsBefore);
});

test('an old heart-rate callback cannot sample the next Companion page sensor', () => {
  const state = fixture();
  state.buildSensor();
  const queued = state.callbacks[0];
  state.destroy();
  state.env.isTearingDown = false;
  state.buildSensor();
  state.env.liveHr = 'unchanged';
  const readsBefore = state.reads;
  queued();
  assert.equal(state.reads, readsBefore);
  assert.equal(state.env.liveHr, 'unchanged');
  state.callbacks[1]();
  assert.equal(state.env.liveHr, '80');
});
