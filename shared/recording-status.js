function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function pendingCount(sync, writeCount, distinctCount) {
  const queued = Math.max(0, count(writeCount) - count(sync?.acknowledgedSetCount));
  return Number.isSafeInteger(distinctCount) && distinctCount > 0 && distinctCount <= queued
    ? distinctCount
    : queued;
}

export function recordingLabel(sync, writeCount, distinctCount) {
  if (sync?.mode === 'DIRECT') {
    if (sync.remoteMissing) return 'Recovery';
    if (sync.conflict) return 'Conflict';
  }
  if (!count(writeCount)) return '';
  if (sync?.mode !== 'DIRECT' || !sync.startConfirmed) return 'On watch';
  const pending = pendingCount(sync, writeCount, distinctCount);
  return pending ? `${pending} pending` : 'Synced';
}

export function recordingDetails(sync, { completedCount = 0, pendingCount: distinctCount } = {}) {
  const pending = pendingCount(sync, completedCount, distinctCount);
  const statusLabel = recordingLabel(sync, completedCount, distinctCount);
  let description;
  if (sync?.mode !== 'DIRECT') {
    description = 'Recorded locally on watch. No direct Cloud sync.';
  } else if (sync.remoteMissing) {
    description = 'Cloud workout missing. Local sets preserved. Check your phone.';
  } else if (sync.conflict) {
    description = 'Sync conflict. Local sets preserved. Resolve it on your phone.';
  } else if (!sync.startConfirmed) {
    description = 'Cloud start pending. Sets stay on watch until the phone reconnects.';
  } else if (pending) {
    description = `${pending} set${pending === 1 ? '' : 's'} waiting to sync. Saved on watch; will retry.`;
  } else if (!count(completedCount)) {
    description = 'No completed sets yet.';
  } else {
    description = 'All sets confirmed by Liftosaur Cloud. Local copy preserved.';
  }
  return { statusLabel, description, pendingCount: pending };
}
