import assert from 'node:assert/strict';
import test from 'node:test';

import { loadWatchPage } from './helpers/watch-page.js';
import { buildApiWorkout, createFakeCloud, createPhoneLink, flush } from './helpers/phone-harness.js';
import { createWorkoutService } from '../app-side/workout-service.js';
import { createDummyProgramService } from '../app-side/dummy-program-service.js';

const START = 1_700_000_000_000;

async function settle(watch) {
  await flush();
  watch.clock.advance(0);
  await flush();
}

// The steppers change the set without redrawing the Done button, so Done must not keep the values
// of the screen it was drawn on: a unilateral set records its reps for both sides.
for (const product of ['workout', 'companion']) {
  test(`${product}: Done records the reps the steppers left on screen`, async () => {
    const cloud = createFakeCloud(buildApiWorkout([[0, 2, { isUnilateral: true }]]));
    await cloud.client.startRunningWorkout({ startTime: START - 60_000 });
    const catalogService = { ...createDummyProgramService(), mode: 'CLOUD' };
    const link = createPhoneLink(cloud, { workoutService: createWorkoutService({ client: cloud.client, catalogService }) });
    link.setAuto(true);
    const watch = await loadWatchPage(product, { link, start: START });
    await settle(watch);
    const button = (text, index = 0) => watch.screen.widgets.filter((w) => w.props.text === text)[index];
    for (let i = 0; i < 2; i++) {
      button('+', 1).props.click_func(button('+', 1));
      await settle(watch);
    }
    assert.ok(watch.screen.texts().includes('7'));
    button('Done').props.click_func(button('Done'));
    await settle(watch);
    assert.deepEqual(cloud.log.map((write) => [write.completed.reps, write.completed.repsLeft]), [[7, 7]]);
  });
}
