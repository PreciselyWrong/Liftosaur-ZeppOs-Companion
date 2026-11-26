import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { exerciseImagePreloadFor, PRELOAD_TAP_QUIET_MS } from '../shared/exercise-image-client.js';
import { SESSION_STATES } from '../shared/workout-session.js';

const exercises = ['a', 'b', null, 'd'].map((name) => ({ imageUrl: name && `https://example.com/${name}.png` }));

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  return source.slice(start, source.indexOf('\nfunction ', start + 1));
}

test('The day preload is fed by every idle screen of the day, upcoming exercises first', () => {
  assert.deepEqual(exerciseImagePreloadFor({ state: SESSION_STATES.READY, overviewExercises: exercises, currentExerciseIndex: 0 }),
    { urls: exercises.map((exercise) => exercise.imageUrl) });
  assert.deepEqual(exerciseImagePreloadFor({
    state: SESSION_STATES.REST, overviewExercises: exercises, currentExerciseIndex: 1, pending: { exerciseIndex: 2 },
  }), { urls: [null, exercises[3].imageUrl, exercises[0].imageUrl, exercises[1].imageUrl] });
});

test('A set under way stops the day preload, timed or not', () => {
  assert.deepEqual(exerciseImagePreloadFor({ state: SESSION_STATES.ACTIVE_SET, overviewExercises: exercises }), { pause: true });
  assert.deepEqual(exerciseImagePreloadFor({
    state: SESSION_STATES.REST, overviewExercises: exercises, timedSet: { phase: 'WORK' },
  }), { pause: true });
  assert.notDeepEqual(exerciseImagePreloadFor({
    state: SESSION_STATES.REST, overviewExercises: exercises, timedSet: { phase: 'REST' },
  }), { pause: true });
  assert.equal(exerciseImagePreloadFor({ state: SESSION_STATES.FINISHED, overviewExercises: exercises }), null);
  assert.equal(exerciseImagePreloadFor(null), null);
});

for (const [product, dispatcher] of [['data-widget', 'addActionWidget'], ['page', 'wrapNativeAction']]) {
  const source = fs.readFileSync(`${product}/common/index.js`, 'utf8');

  test(`${product} steers the day preload from the workout screens`, () => {
    const screen = extractFunction(source, 'renderScreen');
    const steer = screen.indexOf('exerciseImagePreloadFor(view)');
    assert.ok(steer > 0 && steer < screen.indexOf('renderReadyScreen(view)'), 'decided before any workout screen draws');
    assert.match(source, /maxCachedImages:\s*12\b/);
  });

  test(`${product} pauses the day preload the instant a button is tapped`, () => {
    const calls = [];
    const env = {
      exerciseImages: { pausePreload: (ms) => calls.push(['pause', ms]) },
      PRELOAD_TAP_QUIET_MS,
      isTearingDown: false, isPaused: false, hasBuilt: true, isDispatchingClick: false, controllerUiDirty: false,
      activeWidgets: [], widget: { BUTTON: 'button' }, controllerChanges: 0,
      workoutDiagnostics: { record() {}, trace: (_, run) => run() }, WORKOUT_DIAGNOSTIC_CODES: {},
      scheduleRenderUI() {},
      addRawWidget: (type, props, slot) => {
        const entry = Object.assign(slot, { type, ...props });
        entry.widget = entry;
        env.activeWidgets.push(entry);
        return entry;
      },
    };
    const code = product === 'page'
      ? `${extractFunction(source, 'wrapNativeAction')}; return wrapNativeAction(() => calls.push(['tap']));`
      : `${extractFunction(source, dispatcher)}; return addActionWidget({ click_func: () => calls.push(['tap']) }).click_func;`;
    const click = new Function('env', 'calls', `with (env) { ${code} }`)(env, calls);
    click({});
    assert.deepEqual(calls, [['pause', PRELOAD_TAP_QUIET_MS], ['tap']]);
  });

  test(`${product} does not redraw for a preloaded image no screen shows`, () => {
    let drawn = 0;
    const recorded = [];
    const env = {
      isTearingDown: false, isPaused: false, hasBuilt: true, isNotesModalOpen: false, isOverviewOpen: true,
      controllerUiDirty: false, preparationImageUrl: 'https://example.com/a.png', activeNotesImageUrl: null,
      SESSION_STATES, workoutController: { view: () => ({ state: SESSION_STATES.READY }) },
      session: { view: () => ({ state: SESSION_STATES.READY }) },
      workoutDiagnostics: { record: (code) => recorded.push(code) },
      WORKOUT_DIAGNOSTIC_CODES: { IMAGE_READY: 'IMAGE_READY', IMAGE_UNAVAILABLE: 'IMAGE_UNAVAILABLE' },
      renderUI: () => { drawn++; }, redraw: () => { drawn++; }, updateNotesImage() {}, currentNotesPages: () => [],
    };
    const handle = new Function('env', `with (env) { ${extractFunction(source, 'handleExerciseImageChange')}; return handleExerciseImageChange; }`)(env);
    handle('https://example.com/a.png', 'ready', null, { preload: true });
    assert.equal(drawn, 0);
    assert.deepEqual(recorded, ['IMAGE_READY']);
    handle('https://example.com/a.png', 'ready', null, null);
    assert.equal(drawn, 1, 'an image a screen asked for still redraws');
  });
}
