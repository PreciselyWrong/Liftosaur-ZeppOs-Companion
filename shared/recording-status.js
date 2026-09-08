export function recordingLabel(sync, completedCount) {
  if (!completedCount) return '';
  return sync.mode === 'DIRECT' && sync.startConfirmed && !sync.conflict &&
    !sync.remoteMissing && sync.acknowledgedSetCount >= completedCount
    ? 'Synced' : 'On watch';
}
