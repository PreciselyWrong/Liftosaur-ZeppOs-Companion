import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingLabel, recordingDetails } from '../shared/recording-status.js';

test('recording label follows acknowledged writes, showing pending set count and clear cloud status', () => {
  assert.equal(recordingLabel({ mode: 'DIRECT', startConfirmed: true, acknowledgedSetCount: 1 }, 0), '');
  assert.equal(recordingLabel({ mode: 'DIRECT', startConfirmed: true, acknowledgedSetCount: 0 }, 1), '1 pending');
  assert.equal(recordingLabel({ mode: 'DIRECT', startConfirmed: true, acknowledgedSetCount: 1 }, 3), '2 pending');
  assert.equal(recordingLabel({ mode: 'DIRECT', startConfirmed: true, acknowledgedSetCount: 1 }, 1), 'Synced');
  assert.equal(recordingLabel({ mode: 'DIRECT', startConfirmed: true, acknowledgedSetCount: 1, conflict: true }, 1), 'Conflict');
  assert.equal(recordingLabel({ mode: 'DIRECT', startConfirmed: true, acknowledgedSetCount: 1, remoteMissing: true }, 1), 'Recovery');
  assert.equal(recordingLabel({ mode: 'LEGACY' }, 1), 'On watch');
  assert.equal(recordingLabel({ mode: 'DIRECT', acknowledgedSetCount: 1 }, 1), 'On watch');
});

test('recording label uses deduplicated pending count when provided', () => {
  // 2 writes in queue for the same setId -> distinct pending sets is 1
  assert.equal(recordingLabel({ mode: 'DIRECT', startConfirmed: true, acknowledgedSetCount: 0 }, 2, 1), '1 pending');
  // No negative counts or false Synced
  assert.equal(recordingLabel({ mode: 'DIRECT', startConfirmed: true, acknowledgedSetCount: 5 }, 2), 'Synced');
  assert.equal(recordingLabel({ mode: 'DIRECT', startConfirmed: true, acknowledgedSetCount: 0 }, 1, -1), '1 pending');
});

test('recordingDetails explains local retention, pending/retry, and conflicts', () => {
  const synced = recordingDetails({ mode: 'DIRECT', startConfirmed: true, acknowledgedSetCount: 1 }, { completedCount: 1 });
  assert.equal(synced.statusLabel, 'Synced');
  assert.match(synced.description, /Liftosaur Cloud/i);

  const pending = recordingDetails({ mode: 'DIRECT', startConfirmed: true, acknowledgedSetCount: 0 }, { completedCount: 2 });
  assert.equal(pending.statusLabel, '2 pending');
  assert.match(pending.description, /waiting to sync/i);
  assert.match(pending.description, /retry/i);

  const conflict = recordingDetails({ mode: 'DIRECT', startConfirmed: true, acknowledgedSetCount: 1, conflict: true }, { completedCount: 1 });
  assert.equal(conflict.statusLabel, 'Conflict');
  assert.match(conflict.description, /conflict/i);
  assert.match(conflict.description, /preserved/i);

  const recovery = recordingDetails({ mode: 'DIRECT', startConfirmed: true, acknowledgedSetCount: 1, remoteMissing: true }, { completedCount: 1 });
  assert.equal(recovery.statusLabel, 'Recovery');
  assert.match(recovery.description, /missing/i);
  assert.match(recovery.description, /preserved/i);

  const local = recordingDetails({ mode: 'LEGACY' }, { completedCount: 1 });
  assert.equal(local.statusLabel, 'On watch');
  assert.match(local.description, /locally/i);
});

test('invalid pending counts cannot hide queued writes or conflicts', () => {
  for (const pending of [-1, NaN, Infinity, 0]) {
    assert.equal(recordingLabel({ mode: 'DIRECT', startConfirmed: true, acknowledgedSetCount: 0 }, 2, pending), '2 pending');
  }
  assert.equal(recordingLabel({ mode: 'DIRECT', conflict: true }, 0), 'Conflict');
  assert.equal(recordingLabel({ mode: 'DIRECT', remoteMissing: true }, 0), 'Recovery');
});
