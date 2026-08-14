/**
 * Pure conflict detection and resolution engine.
 *
 * Invariant: Never silently overwrite a modified remote program.
 * History entries are always safe to commit because they are append-only.
 * Program modifications trigger explicit conflict state when baseVersion !== remoteCurrentVersion.
 */

export function detectProgramConflict({ baseVersion, remoteCurrentVersion }) {
  if (!baseVersion || !remoteCurrentVersion) return false;
  return baseVersion !== remoteCurrentVersion;
}

export function resolveProgramConflict({
  localHistoryEntry,
  remoteCurrentProgram,
}) {
  return {
    canSaveHistory: Boolean(localHistoryEntry),
    historyToSave: localHistoryEntry,
    programConflictAction: 'PROMPT_USER_OR_PRESERVE_REMOTE',
    remoteVersion: remoteCurrentProgram?.version ?? null,
  };
}
