import assert from 'node:assert/strict';
import test from 'node:test';

import { syncConflictMessage } from '../shared/sync-conflict-text.js';
import { recordingDetails } from '../shared/recording-status.js';
import { loadWatchPage } from './helpers/watch-page.js';
import { createFakeZosFs } from './helpers/fake-zos-fs.js';
import { buildApiWorkout, createFakeCloud, createPhoneLink, flush } from './helpers/phone-harness.js';
import { createWorkoutService } from '../app-side/workout-service.js';
import { createDummyProgramService } from '../app-side/dummy-program-service.js';

const CODES = [
  'workout_mismatch', 'workout_already_active', 'workout_start_time_taken', 'no_active_workout', 'set_not_found',
  'entry_not_found', 'ambiguous_entry', 'missing_set_input', 'invalid_input', 'program_error', 'day_not_found',
  'NO_API_KEY', 'NOT_CONFIGURED',
];

test('every documented Liftosaur error code has its own short message', () => {
  const seen = new Map();
  for (const code of CODES) {
    const text = syncConflictMessage(code);
    assert.equal(typeof text, 'string', code);
    assert.ok(text.length > 0 && text.length <= 40, `${code} fits a watch line: ${text}`);
    assert.doesNotMatch(text, /\u2014/);
    seen.set(text, [...(seen.get(text) || []), code]);
  }
  assert.equal(syncConflictMessage('workout_mismatch'), 'Phone workout is not this one');
  assert.equal(seen.get(syncConflictMessage('set_not_found')).length, 3, 'set, entry and ambiguity all mean the workout changed');
  assert.equal(syncConflictMessage('something_new'), null, 'an unknown code has no message of its own');
  assert.equal(syncConflictMessage(undefined), null);
});

test('the sync details name the reason of a conflict when the code is known', () => {
  const sync = { mode: 'DIRECT', startConfirmed: true, acknowledgedSetCount: 0, conflict: true };
  const known = recordingDetails(sync, { completedCount: 2, conflictCode: 'workout_mismatch' });
  assert.match(known.description, /Phone workout is not this one/);
  assert.match(known.description, /preserved/i);
  assert.equal(recordingDetails(sync, { completedCount: 2 }).description, recordingDetails(sync, { completedCount: 2, conflictCode: 'x' }).description);
});

const START = 1_700_000_000_000;

for (const [code, expected] of [['workout_mismatch', 'Phone workout is not this one'], ['set_not_found', 'Workout changed in Liftosaur']]) {
  test(`Workout shows "${expected}" when the account answers ${code} to a set`, async () => {
    const cloud = createFakeCloud(buildApiWorkout([[0, 2]]));
    await cloud.client.startRunningWorkout({ startTime: START - 60_000 });
    const rejecting = {
      ...cloud.client,
      logWorkoutSets: async () => { const err = new Error(code); err.code = code; err.status = 409; throw err; },
    };
    const catalogService = { ...createDummyProgramService(), mode: 'CLOUD' };
    const link = createPhoneLink(cloud, { workoutService: createWorkoutService({ client: rejecting, catalogService }) });
    link.setAuto(true);
    const watch = await loadWatchPage('workout', { link, start: START, fs: createFakeZosFs() });
    await flush();
    watch.clock.advance(0);
    await flush();
    const done = watch.screen.widgets.find((w) => w.visible && w.props.text === 'Done');
    done.props.click_func(done);
    await flush();
    watch.clock.advance(1500);
    await flush();
    assert.ok(watch.screen.texts().some((text) => text.includes(expected)), JSON.stringify(watch.screen.texts()));
  });
}
