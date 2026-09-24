export const WORKOUT_DISPLAY_DEFAULTS = Object.freeze({
  showWorkoutProgress: false,
  showPlateBreakdown: true,
  showRestInfo: true,
});

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return fallback; }
  }
  if (value && typeof value === 'object') value = value.value;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
}

export function normalizeWorkoutDisplaySettings(settings = {}) {
  return {
    showWorkoutProgress: normalizeBoolean(settings?.showWorkoutProgress, WORKOUT_DISPLAY_DEFAULTS.showWorkoutProgress),
    showPlateBreakdown: normalizeBoolean(settings?.showPlateBreakdown, WORKOUT_DISPLAY_DEFAULTS.showPlateBreakdown),
    showRestInfo: normalizeBoolean(settings?.showRestInfo, WORKOUT_DISPLAY_DEFAULTS.showRestInfo),
  };
}

export function workoutProgress(exercises = []) {
  const total = exercises.reduce((sum, exercise) => sum + Math.max(0, exercise.totalSets || 0), 0);
  const completed = Math.min(total, exercises.reduce((sum, exercise) =>
    sum + Math.max(0, exercise.completedSetsCount || 0), 0));
  return { completed, total, fraction: total > 0 ? completed / total : 0 };
}

export function weightStepperDisplay(weight, unit, loadoutLabel, showPlateBreakdown) {
  const value = weight === null || weight === undefined ? '-' : String(weight);
  const unitLabel = String(unit || 'kg').toUpperCase();
  return showPlateBreakdown
    ? { value, label: loadoutLabel || unitLabel }
    : { value: `${value} ${unitLabel}`, label: '' };
}
