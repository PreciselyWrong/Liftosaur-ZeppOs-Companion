import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseSportDataResult,
  parseDurationToSeconds,
  createNativePauseReconciler,
} from '../shared/workout-extension-metrics.js';

test('parses duration and calories from defensive sport data responses', () => {
  assert.deepEqual(
    parseSportDataResult({ code: 0, data: '[{"duration":"1:15:15"}]' }, 'duration'),
    { ok: true, value: '1:15:15', error: null },
  );
  assert.deepEqual(
    parseSportDataResult({ code: 0, data: '[{"calories":"120"}]' }, 'calories'),
    { ok: true, value: '120', error: null },
  );
  assert.equal(parseSportDataResult({ code: 1, data: '[]' }, 'duration').ok, false);
  assert.equal(parseSportDataResult({ code: 0, data: 'invalid' }, 'duration').ok, false);
  assert.equal(parseSportDataResult({ code: 0, data: '[]' }, 'duration').ok, false);
});

test('parses duration strings into seconds', () => {
  assert.equal(parseDurationToSeconds('00:01:05'), 65);
  assert.equal(parseDurationToSeconds('1:15:15'), 4515);
  assert.equal(parseDurationToSeconds('01:15:15'), 4515);
  assert.equal(parseDurationToSeconds('00:00:00'), 0);
  assert.equal(parseDurationToSeconds('00:00'), 0);
  assert.equal(parseDurationToSeconds('05:30'), 330);
  assert.equal(parseDurationToSeconds('2:00:00'), 7200);
});

test('handles malformed duration strings safely', () => {
  assert.equal(parseDurationToSeconds(''), null);
  assert.equal(parseDurationToSeconds(null), null);
  assert.equal(parseDurationToSeconds(undefined), null);
  assert.equal(parseDurationToSeconds('invalid'), null);
  assert.equal(parseDurationToSeconds('1:2:3:4'), null);
  assert.equal(parseDurationToSeconds('::'), null);
  assert.equal(parseDurationToSeconds('-01:00'), null);
  assert.equal(parseDurationToSeconds(12345), null);
});

test('detects a native pause without mistaking normal duration ticks for one', () => {
  const reconciler = createNativePauseReconciler();

  assert.deepEqual(reconciler.sample({ durationSeconds: 10, timestamp: 10_000 }), []);
  assert.deepEqual(reconciler.sample({ durationSeconds: 11, timestamp: 11_000 }), []);
  assert.deepEqual(reconciler.sample({ durationSeconds: 11, timestamp: 12_000 }), []);
  assert.deepEqual(reconciler.sample({ durationSeconds: 11, timestamp: 14_000 }), [
    { type: 'pause', timestamp: 12_000 },
  ]);
  assert.deepEqual(reconciler.sample({ durationSeconds: 12, timestamp: 18_000 }), [
    { type: 'resume', timestamp: 18_000 },
  ]);
});

test('reconciles only the inactive part of a focus gap', () => {
  const reconciler = createNativePauseReconciler();
  reconciler.sample({ durationSeconds: 20, timestamp: 20_000 });
  reconciler.loseFocus({ timestamp: 21_000 });

  assert.deepEqual(reconciler.sample({ durationSeconds: 25, timestamp: 31_000 }), [
    { type: 'pause', timestamp: 26_000 },
    { type: 'resume', timestamp: 31_000 },
  ]);
});

test('does not pause when native duration covers the focus gap', () => {
  const reconciler = createNativePauseReconciler();
  reconciler.sample({ durationSeconds: 20, timestamp: 20_000 });
  reconciler.loseFocus({ timestamp: 21_000 });
  assert.deepEqual(reconciler.sample({ durationSeconds: 30, timestamp: 31_000 }), []);
  assert.deepEqual(reconciler.sample({ durationSeconds: 30, timestamp: 32_000 }), []);
});

test('keeps the workout paused when duration is still stalled after returning', () => {
  const reconciler = createNativePauseReconciler();
  reconciler.sample({ durationSeconds: 20, timestamp: 20_000 });
  reconciler.loseFocus({ timestamp: 21_000 });

  assert.deepEqual(reconciler.sample({ durationSeconds: 20, timestamp: 31_000 }), [
    { type: 'pause', timestamp: 21_000 },
  ]);
  assert.deepEqual(reconciler.sample({ durationSeconds: 20, timestamp: 32_000 }), []);
  assert.deepEqual(reconciler.sample({ durationSeconds: 21, timestamp: 33_000 }), [
    { type: 'resume', timestamp: 33_000 },
  ]);
});
