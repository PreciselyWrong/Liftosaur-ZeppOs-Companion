import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeWorkoutDisplaySettings, workoutProgress } from '../shared/workout-display-settings.js';
import { WORKOUT_PROGRESS_LAYOUT } from '../shared/watch-layout.js';

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
}
