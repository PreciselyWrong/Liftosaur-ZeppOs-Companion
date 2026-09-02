import assert from 'node:assert/strict';
import test from 'node:test';
import { createRestAlertTracker } from '../shared/rest-alert.js';

test('createRestAlertTracker initializes in idle state', () => {
  const tracker = createRestAlertTracker();
  const res = tracker.checkTick({ rest: null, now: 1000 });
  assert.equal(res.shouldAlert, false);
  assert.equal(res.reason, null);
});

test('does not alert before rest timer expires', () => {
  const tracker = createRestAlertTracker();
  const rest = { endsAt: 10000, duration: 60, isPaused: false };

  const res1 = tracker.checkTick({ rest, now: 5000 });
  assert.equal(res1.shouldAlert, false);

  const res2 = tracker.checkTick({ rest, now: 9000 });
  assert.equal(res2.shouldAlert, false);
});

test('does not alert when rest is paused', () => {
  const tracker = createRestAlertTracker();
  const rest = { endsAt: 10000, duration: 60, isPaused: true };

  const res = tracker.checkTick({ rest, now: 11000 });
  assert.equal(res.shouldAlert, false);
});

test('alerts once when rest reaches zero in foreground', () => {
  const tracker = createRestAlertTracker();
  const rest = { endsAt: 10000, duration: 60, isPaused: false };

  // Before zero
  assert.equal(tracker.checkTick({ rest, now: 9000 }).shouldAlert, false);

  // Exactly at zero
  const zeroRes = tracker.checkTick({ rest, now: 10000 });
  assert.equal(zeroRes.shouldAlert, true);
  assert.equal(zeroRes.reason, 'ZERO_REACHED');

  // Immediately after zero (deduplication)
  const nextRes = tracker.checkTick({ rest, now: 11000 });
  assert.equal(nextRes.shouldAlert, false);
  assert.equal(nextRes.reason, null);
});

test('alerts on overtime steps in foreground', () => {
  const tracker = createRestAlertTracker({ overtimeStepSeconds: 30 });
  const rest = { endsAt: 10000, duration: 60, isPaused: false };

  // Zero alert
  tracker.checkTick({ rest, now: 10000 });

  // 15s overtime - no alert
  assert.equal(tracker.checkTick({ rest, now: 25000 }).shouldAlert, false);

  // 30s overtime - alert step 1
  const step1 = tracker.checkTick({ rest, now: 40000 });
  assert.equal(step1.shouldAlert, true);
  assert.equal(step1.reason, 'OVERTIME');
  assert.equal(step1.step, 1);

  // 35s overtime - no alert
  assert.equal(tracker.checkTick({ rest, now: 45000 }).shouldAlert, false);

  // 60s overtime - alert step 2
  const step2 = tracker.checkTick({ rest, now: 70000 });
  assert.equal(step2.shouldAlert, true);
  assert.equal(step2.reason, 'OVERTIME');
  assert.equal(step2.step, 2);
});

test('checkResume alerts once if rest expired while unfocused / screen-off', () => {
  const tracker = createRestAlertTracker();
  const rest = { endsAt: 10000, duration: 60, isPaused: false };

  // User unfocused at now=5000 (no tick at 10000)
  // On resume at now=15000:
  const resumeRes = tracker.checkResume({ rest, now: 15000 });
  assert.equal(resumeRes.shouldAlert, true);
  assert.equal(resumeRes.reason, 'RESUME_EXPIRED');

  // Subsequent ticks do not re-alert for zero
  assert.equal(tracker.checkTick({ rest, now: 16000 }).shouldAlert, false);
});

test('checkResume does not alert if rest was already alerted before pause', () => {
  const tracker = createRestAlertTracker();
  const rest = { endsAt: 10000, duration: 60, isPaused: false };

  // Alerted at zero in foreground
  tracker.checkTick({ rest, now: 10000 });

  // Screen paused then resumed later
  const resumeRes = tracker.checkResume({ rest, now: 20000 });
  assert.equal(resumeRes.shouldAlert, false);
});

test('reset clears alert state for new rest periods', () => {
  const tracker = createRestAlertTracker();
  const rest1 = { endsAt: 10000, duration: 60, isPaused: false };

  tracker.checkTick({ rest: rest1, now: 10000 });
  tracker.reset();

  const rest2 = { endsAt: 20000, duration: 60, isPaused: false };
  assert.equal(tracker.checkTick({ rest: rest2, now: 15000 }).shouldAlert, false);

  const res = tracker.checkTick({ rest: rest2, now: 20000 });
  assert.equal(res.shouldAlert, true);
  assert.equal(res.reason, 'ZERO_REACHED');
});

test('handles new rest period automatically when endsAt changes', () => {
  const tracker = createRestAlertTracker();
  const rest1 = { endsAt: 10000, duration: 60, isPaused: false };
  tracker.checkTick({ rest: rest1, now: 10000 });

  // New set completed, new rest starts with endsAt=30000
  const rest2 = { endsAt: 30000, duration: 60, isPaused: false };
  assert.equal(tracker.checkTick({ rest: rest2, now: 25000 }).shouldAlert, false);

  const res = tracker.checkTick({ rest: rest2, now: 30000 });
  assert.equal(res.shouldAlert, true);
  assert.equal(res.reason, 'ZERO_REACHED');
});
