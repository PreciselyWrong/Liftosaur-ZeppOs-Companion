import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_REFRESH_INTERVAL_MS,
  PASSIVE_REFRESH_INTERVAL_MS,
  createWorkoutRefreshPolicy,
} from '../shared/workout-refresh-policy.js';

test('passive refresh becomes due after 15 seconds', () => {
  let now = 1000;
  const policy = createWorkoutRefreshPolicy({ now: () => now });

  policy.markAuthoritativeResponse();
  now += PASSIVE_REFRESH_INTERVAL_MS - 1;
  assert.equal(policy.beginPoll(), false);
  now += 1;
  assert.equal(policy.beginPoll(), true);
});

test('action refresh uses a strict 10 second floor', () => {
  let now = 1000;
  const policy = createWorkoutRefreshPolicy({ now: () => now });

  policy.markAuthoritativeResponse();
  policy.request();
  now += MIN_REFRESH_INTERVAL_MS - 1;
  assert.equal(policy.beginPoll(), false);
  now += 1;
  assert.equal(policy.beginPoll(), true);
});

test('repeated action requests coalesce into one poll', () => {
  let now = 1000;
  const policy = createWorkoutRefreshPolicy({ now: () => now });

  policy.markAuthoritativeResponse();
  policy.request();
  policy.request();
  policy.request();
  now += MIN_REFRESH_INTERVAL_MS;

  assert.equal(policy.beginPoll(), true);
  assert.equal(policy.beginPoll(), false);
});

test('failures back off at 30, 60, then 120 seconds', () => {
  let now = 1000;
  const policy = createWorkoutRefreshPolicy({ now: () => now });

  assert.equal(policy.beginPoll(), true);
  policy.markFailure();
  now += 29999;
  assert.equal(policy.beginPoll(), false);
  now += 1;
  assert.equal(policy.beginPoll(), true);

  policy.markFailure();
  now += 59999;
  assert.equal(policy.beginPoll(), false);
  now += 1;
  assert.equal(policy.beginPoll(), true);

  policy.markFailure();
  now += 119999;
  assert.equal(policy.beginPoll(), false);
  now += 1;
  assert.equal(policy.beginPoll(), true);

  policy.markFailure();
  now += 120000;
  assert.equal(policy.beginPoll(), true);
});

test('success resets failure backoff', () => {
  let now = 1000;
  const policy = createWorkoutRefreshPolicy({ now: () => now });

  assert.equal(policy.beginPoll(), true);
  policy.markFailure();
  policy.markSuccess();
  now += PASSIVE_REFRESH_INTERVAL_MS;

  assert.equal(policy.beginPoll(), true);
});

test('an authoritative write response suppresses a redundant immediate GET', () => {
  let now = 1000;
  const policy = createWorkoutRefreshPolicy({ now: () => now });

  policy.request();
  policy.markFailure();
  policy.markAuthoritativeResponse();
  assert.equal(policy.beginPoll(), false);

  now += PASSIVE_REFRESH_INTERVAL_MS;
  assert.equal(policy.beginPoll(), true);
});
