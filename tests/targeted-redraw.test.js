import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { loadWatchPage } from './helpers/watch-page.js';
import { UI_WORK_QUIET_MS } from '../shared/exercise-image-client.js';
import { buildApiWorkout, createFakeCloud, createPhoneLink, createRandom, flush } from './helpers/phone-harness.js';
import { createWorkoutService } from '../app-side/workout-service.js';
import { createDummyProgramService } from '../app-side/dummy-program-service.js';

// A full redraw costs 430 to 550 ms on an Active 2, so the workout screens update the values a tap or
// a phone reply changed in place. Every check here compares the screen with the one a full rebuild of
// the same moment draws: a stale value is worse than a slow screen.
const START = 1_700_000_000_000;

const DAY = [[1, 3], [0, 2, { rpe: 8, logRpe: true }], [0, 2, { isUnilateral: true }], [0, 1, { setTimer: 20 }]];

const imageUrl = (index) => `https://www.liftosaur.com/externalimages/exercises/single/small/exercise-${index}.png`;

async function workoutPage(product, { rebuildAlways = false, shape = DAY } = {}) {
  const template = buildApiWorkout(shape);
  template.entries.forEach((entry, index) => { entry.imageUrl = imageUrl(index); });
  const cloud = createFakeCloud(template);
  await cloud.client.startRunningWorkout({ startTime: START - 60_000 });
  // A program list the Companion launch needs, from a phone with an API key.
  const catalogService = { ...createDummyProgramService(), mode: 'CLOUD' };
  const link = createPhoneLink(cloud, { workoutService: createWorkoutService({ client: cloud.client, catalogService }) });
  link.setAuto(true);
  const watch = await loadWatchPage(product, { link, start: START, rebuildAlways });
  await settle(watch);
  link.setAuto(false);
  // The phone settings of these tests leave images off; the lifter has them on.
  vm.runInContext('accountSettings = { ...accountSettings, exerciseImages: true }; exerciseImages.setEnabled(true);', watch.context);
  await settle(watch);
  return { ...watch, cloud, link };
}

async function settle(watch) {
  await flush();
  watch.clock.advance(0);
  await flush();
}

const tappable = (watch) => watch.screen.widgets.filter((w) => w.visible && typeof w.props.click_func === 'function');
const label = (w) => w.props.text || '';

// Taps the `index`th widget whose label passes `match`, in drawing order.
function tapWhere(watch, match, index = 0) {
  const targets = tappable(watch).filter((w) => match(label(w)));
  const target = targets[index % Math.max(1, targets.length)];
  if (!target) return false;
  target.props.click_func(target);
  return true;
}

const HOT_TAPS = [
  (text) => text === '+', (text) => text === '-' || text === '\u2212', (text) => text === 'Done', (text) => text.startsWith('> Start set'),
  (text) => text === 'Start set', (text) => text === 'Prepare', (text) => text === '<', (text) => text === 'Skip',
  (text) => text === '-10s', (text) => text === '+10s', (text) => text === 'Pause' || text === 'Resume',
  (text) => /^(Start|Stop|Resume|Pause|Done)/.test(text),
];

async function act(watch, action) {
  if (action.kind === 'tap') tapWhere(watch, HOT_TAPS[action.tap], action.index);
  else if (action.kind === 'anyTap') tapWhere(watch, () => true, action.index);
  else if (action.kind === 'deliver') await watch.link.deliver(0, action.fate);
  else watch.clock.advance(action.ms);
  await settle(watch);
}

function randomAction(random) {
  const roll = random.next();
  if (roll < 0.55) return { kind: 'tap', tap: random.int(HOT_TAPS.length), index: random.int(3) };
  if (roll < 0.6) return { kind: 'anyTap', index: random.int(40) };
  if (roll < 0.8) return { kind: 'deliver', fate: random.chance(0.85) ? 'ok' : 'lost' };
  return { kind: 'time', ms: random.pick([250, 1000, 1000, 5000, 30_000, 70_000]) };
}

for (const product of ['workout', 'companion']) {
  test(`${product}: after random taps, replies and time, every widget matches a full rebuild and images wait for rebuilds`, async (t) => {
    const totals = { live: 0, reference: 0, steps: 0, images: 0 };
    const seen = new Set();
    for (let seed = 1; seed <= 6; seed++) {
      const random = createRandom(seed);
      // Half the runs start with the timed and the unilateral exercises.
      const shape = seed % 2 ? DAY : [...DAY].reverse();
      const live = await workoutPage(product, { shape });
      const reference = await workoutPage(product, { shape, rebuildAlways: true });
      assert.deepEqual(live.screen.snapshot(), reference.screen.snapshot(), `seed ${seed} at launch`);
      for (let step = 0; step < 80; step++) {
        const action = randomAction(random);
        await act(live, action);
        await act(reference, action);
        assert.deepEqual(live.screen.snapshot(), reference.screen.snapshot(), `seed ${seed} step ${step} ${JSON.stringify(action)}`);
        assert.deepEqual(live.screen.stats.textRepaints, [], 'a TEXT widget is never repainted with setProperty');
        for (const text of live.screen.texts()) seen.add(text);
      }
      let rebuiltAt = -Infinity;
      for (const event of live.events) {
        if (event.type === 'REBUILD') rebuiltAt = event.at;
        if (event.type !== 'GET_EXERCISE_IMAGE') continue;
        totals.images++;
        assert.ok(event.at >= rebuiltAt + UI_WORK_QUIET_MS,
          `seed ${seed}: an image request started ${event.at - rebuiltAt} ms after a full rebuild`);
      }
      totals.live += live.screen.stats.rebuilds;
      totals.reference += reference.screen.stats.rebuilds;
      totals.steps += 80;
    }
    t.diagnostic(`full rebuilds over ${totals.steps} random steps: ${totals.reference} before, ${totals.live} after`);
    t.diagnostic([...seen].filter((text) => !/^[\d:.]+$/.test(text)).join(' | '));
    assert.ok(totals.live < totals.reference, 'redraws update in place');
    assert.ok(totals.images > 0, 'the walk asks for exercise images');
  });

  test(`${product}: a stepper tap repaints its number at once without a rebuild`, async () => {
    const watch = await workoutPage(product);
    const rebuilds = watch.screen.stats.rebuilds;
    const weight = watch.screen.find((w) => w.props.text === '20');
    tapWhere(watch, (text) => text === '+');
    assert.equal(weight.props.text, '22.5', 'the new weight shows inside the tap');
    await settle(watch);
    watch.clock.advance(1000);
    await settle(watch);
    assert.equal(watch.screen.stats.rebuilds - rebuilds, 0);
  });

  test(`${product}: completing a set and its sync reply cost at most one rebuild`, async (t) => {
    const counts = {};
    for (const [name, rebuildAlways] of [['before', true], ['after', false]]) {
      const watch = await workoutPage(product, { rebuildAlways });
      const rebuilds = watch.screen.stats.rebuilds;
      tapWhere(watch, (text) => text === 'Done');
      await settle(watch);
      watch.clock.advance(1000);
      await settle(watch);
      const sync = watch.link.queue.findIndex((item) => item.type === 'SYNC_WORKOUT_SETS');
      assert.ok(sync >= 0, 'the set is sent to the phone');
      await watch.link.deliver(sync, 'ok');
      await settle(watch);
      watch.clock.advance(1000);
      await settle(watch);
      counts[name] = watch.screen.stats.rebuilds - rebuilds;
      assert.ok(watch.screen.texts().some((text) => text.includes('Start set')), 'the rest view is up');
    }
    t.diagnostic(`full rebuilds for Done and its sync reply: before ${counts.before}, after ${counts.after}`);
    assert.ok(counts.after <= 1);
  });

  test(`${product}: a sync reply that changes nothing visible costs no rebuild`, async () => {
    const watch = await workoutPage(product);
    tapWhere(watch, (text) => text === 'Done');
    await settle(watch);
    const rebuilds = watch.screen.stats.rebuilds;
    const sync = watch.link.queue.findIndex((item) => item.type === 'SYNC_WORKOUT_SETS');
    await watch.link.deliver(sync, 'ok');
    await settle(watch);
    watch.clock.advance(1000);
    await settle(watch);
    assert.equal(watch.screen.stats.rebuilds - rebuilds, 0);
  });
}
