import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_REFRESH_INTERVAL_MS,
  PASSIVE_REFRESH_INTERVAL_MS,
  createWorkoutRefreshPolicy,
} from '../shared/workout-refresh-policy.js';

test('policy passive interval is 120 seconds', () => {
  assert.equal(PASSIVE_REFRESH_INTERVAL_MS, 120_000);
  let now = 1000;
  const policy = createWorkoutRefreshPolicy({ now: () => now });

  policy.markAuthoritativeResponse();
  now += PASSIVE_REFRESH_INTERVAL_MS - 1;
  assert.equal(policy.beginPoll(), false);
  now += 1;
  assert.equal(policy.beginPoll(), true);
});

test('beginPoll with passive disabled returns false without consuming the next explicit refresh', () => {
  let now = 1000;
  const policy = createWorkoutRefreshPolicy({ now: () => now });

  policy.markAuthoritativeResponse();
  now += PASSIVE_REFRESH_INTERVAL_MS;
  // Passive disabled and no explicit request: returns false without consuming schedule
  assert.equal(policy.beginPoll({ allowPassive: false }), false);

  // Explicit request arrives
  policy.request();
  assert.equal(policy.beginPoll({ allowPassive: false }), true);
  // Request is now consumed
  assert.equal(policy.beginPoll({ allowPassive: false }), false);

  // New explicit request before 10s floor
  policy.request();
  now += MIN_REFRESH_INTERVAL_MS - 1;
  assert.equal(policy.beginPoll({ allowPassive: false }), false);
  now += 1;
  assert.equal(policy.beginPoll({ allowPassive: false }), true);
  assert.equal(policy.beginPoll({ allowPassive: false }), false);
});

test('explicit refresh respects 10 seconds', () => {
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

test('failure backoff is exactly 60/120/300 and requested refresh does not bypass it', () => {
  let now = 1000;
  const policy = createWorkoutRefreshPolicy({ now: () => now });

  assert.equal(policy.beginPoll(), true);
  policy.markFailure();

  // 1st failure: 60s backoff. Requested refresh must not bypass backoff.
  policy.request();
  now += 59999;
  assert.equal(policy.beginPoll(), false);
  now += 1;
  assert.equal(policy.beginPoll(), true);

  // 2nd failure: 120s backoff
  policy.markFailure();
  policy.request();
  now += 119999;
  assert.equal(policy.beginPoll(), false);
  now += 1;
  assert.equal(policy.beginPoll(), true);

  // 3rd failure: 300s backoff
  policy.markFailure();
  policy.request();
  now += 299999;
  assert.equal(policy.beginPoll(), false);
  now += 1;
  assert.equal(policy.beginPoll(), true);

  // 4th failure: capped at 300s
  policy.markFailure();
  now += 300000;
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
