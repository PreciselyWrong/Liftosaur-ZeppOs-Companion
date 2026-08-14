import test from 'node:test';
import assert from 'node:assert/strict';

import { detectProgramConflict, resolveProgramConflict } from '../shared/conflict-resolver.js';

test('detectProgramConflict identifies clean sync vs concurrent remote edits', () => {
  const baseVersion = 'hash-abc-123';
  const remoteVersionUnchanged = 'hash-abc-123';
  const remoteVersionChanged = 'hash-xyz-789';

  assert.equal(
    detectProgramConflict({ baseVersion, remoteCurrentVersion: remoteVersionUnchanged }),
    false
  );

  assert.equal(
    detectProgramConflict({ baseVersion, remoteCurrentVersion: remoteVersionChanged }),
    true
  );
});

test('resolveProgramConflict preserves history while providing conflict recovery options', () => {
  const localHistoryEntry = {
    workoutId: 'w-1',
    completedAt: 50000,
    totalVolume: 1200,
  };

  const conflictResolution = resolveProgramConflict({
    localHistoryEntry,
    remoteCurrentProgram: { id: 'prog-1', version: 'hash-xyz-789', name: 'Updated Routine' },
  });

  assert.equal(conflictResolution.canSaveHistory, true);
  assert.equal(conflictResolution.programConflictAction, 'PROMPT_USER_OR_PRESERVE_REMOTE');
  assert.deepEqual(conflictResolution.historyToSave, localHistoryEntry);
});
