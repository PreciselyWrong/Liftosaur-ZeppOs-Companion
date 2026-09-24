import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeWorkoutDisplaySettings, workoutProgress } from '../shared/workout-display-settings.js';
import { WORKOUT_PROGRESS_LAYOUT, extensionRestActionsLayout } from '../shared/watch-layout.js';

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\nfunction ', start + 1));
}

for (const product of ['page', 'data-widget']) {
  const source = fs.readFileSync(path.join(process.cwd(), product, 'common', 'index.js'), 'utf8');

  test(`${product} shows the optional progress bar within the top chord`, () => {
    const widgets = [];
    const env = {
      accountSettings: { showWorkoutProgress: true }, normalizeWorkoutDisplaySettings, workoutProgress,
      WORKOUT_PROGRESS_LAYOUT, addWidget: (_type, props) => widgets.push(props),
      widget: { FILL_RECT: 1 }, px: x => x, THEME: { card: 1, primaryLight: 2 },
    };
    const render = new Function('env', `with (env) { ${extractFunction(source, 'renderWorkoutProgress')}; return renderWorkoutProgress; }`)(env);
    render({ overviewExercises: [{ totalSets: 2, completedSetsCount: 1 }] });
    assert.deepEqual(widgets.map(({ w, color }) => [w, color]), [[240, 1], [120, 2]]);
    assert.ok(widgets.every(({ y, h }) => y + h < (product === 'page' ? 45 : 48)));
    env.accountSettings = { showWorkoutProgress: false };
    widgets.length = 0;
    render({ overviewExercises: [{ totalSets: 2, completedSetsCount: 1 }] });
    assert.equal(widgets.length, 0);
  });

  test(`${product} hides rest plates and Info independently while enlarging the target`, () => {
    const widgets = [];
    const env = {
      accountSettings: {}, normalizeWorkoutDisplaySettings,
      addWidget: (_type, props) => widgets.push(props),
      addLiveLabel: (_key, props) => widgets.push(props),
      addLiveButton: (_key, props) => widgets.push(props),
      renderTopBar() {}, renderExerciseInfo: () => widgets.push({ text: 'Info' }),
      openWorkoutTimerControls() {},
      widget: { BUTTON: 1, TEXT: 2, FILL_RECT: 3 },
      px: x => x, font: role => ({ title: 30, value: 38 })[role] || 23,
      THEME: { card: 1 }, align: {}, text_style: {},
      formatSeconds: () => '1:00', formatLoadoutLabel: () => '20 + 10 KG',
      formatNextTargetSummary: () => '5 x 60 KG', formatSupersetProgress: () => '',
      supersetColor: () => 1, truncate: text => text, extensionRestActionsLayout,
      exerciseImages: null,
    };
    const render = new Function('env', `with (env) { ${extractFunction(source, 'renderRestScreen')}; return renderRestScreen; }`)(env);
    const view = { rest: { remaining: 60, nextExerciseName: 'Squat', nextTargetWeight: 60, nextUnit: 'kg' } };
    render(view);
    assert.ok(widgets.some(({ text }) => text === 'Info'));
    assert.ok(widgets.some(({ text }) => text === '20 + 10 KG'));
    const normalTarget = widgets.find(({ text }) => text === '5 x 60 KG');
    assert.equal(normalTarget.text_size, 30);

    widgets.length = 0;
    env.accountSettings = { showPlateBreakdown: false, showRestInfo: false };
    render(view);
    assert.ok(!widgets.some(({ text }) => text === 'Info'));
    assert.ok(!widgets.some(({ text }) => text === '20 + 10 KG'));
    const largeTarget = widgets.find(({ text }) => text === '5 x 60 KG');
    assert.equal(largeTarget.text_size, 38);
    assert.equal(largeTarget.h, 50);
  });
}
