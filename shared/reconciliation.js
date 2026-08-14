/**
 * Pure deterministic reconciliation engine.
 *
 * Invariant: Completed local sets are the single source of truth and are immutable.
 * Future pending sets are updated when Playground recalculations become available.
 */
export function reconcileWorkoutSets({
  localCompletedCount,
  currentPrescription = [],
  playgroundPrescription = null,
} = {}) {
  if (!playgroundPrescription || !Array.isArray(playgroundPrescription)) {
    return currentPrescription;
  }

  const result = [];
  const maxLen = Math.max(currentPrescription.length, playgroundPrescription.length);

  for (let i = 0; i < maxLen; i++) {
    if (i < localCompletedCount) {
      // Completed sets remain locked to local history
      result.push(currentPrescription[i] || playgroundPrescription[i]);
    } else {
      // Future sets take updated prescription from Playground, or fallback
      result.push(playgroundPrescription[i] || currentPrescription[i]);
    }
  }

  return result;
}
