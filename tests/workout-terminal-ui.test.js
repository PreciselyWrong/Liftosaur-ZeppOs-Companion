import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  return source.slice(start, source.indexOf('\nfunction ', start + 1));
}

test('terminal UI ignores responses belonging to a replaced session in both products', async () => {
  for (const path of ['page/common/index.js', 'data-widget/common/index.js']) {
    for (const [action, method] of [
      ['submitWorkout', 'finishWorkoutRemote'],
      ['handleDiscardWorkout', 'discardWorkoutRemote'],
    ]) {
      let resolve;
      const pending = new Promise((done) => { resolve = done; });
      const calls = [];
      const env = {
        finishState: null,
        dayPlan: { id: 'old' },
        session: { view: () => ({}) },
        directSync: { mode: 'DIRECT' },
        workoutController: { [method]: () => pending },
        renderUI: () => calls.push('render'),
        updateControllerStatus: () => calls.push('status'),
        beginRequest: () => calls.push('begin'),
        failRequest: () => calls.push('fail'),
        returnAfterDiscard: () => calls.push('clear'),
      };
      const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
      const run = new Function('env', `with (env) { ${extractFunction(source, action)}; return ${action}; }`)(env);
      run();
      assert.equal(calls.length, 1, 'the original operation starts before replacement');

      const newerPlan = { id: 'new' };
      const newerFinishState = { status: 'READY', message: 'New workout' };
      env.dayPlan = newerPlan;
      env.finishState = newerFinishState;
      calls.length = 0;
      resolve({ success: false, reason: 'SESSION_REPLACED' });
      await pending;
      await new Promise((done) => setImmediate(done));

      assert.equal(env.dayPlan, newerPlan);
      assert.equal(env.finishState, newerFinishState);
      assert.deepEqual(calls, [], 'no stale save, failure, redraw, or clear reaches the newer UI');
    }
  }
});
