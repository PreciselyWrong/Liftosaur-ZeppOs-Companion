/**
 * Pure shared model adapter for Liftosaur Running Workout API data.
 *
 * Translates the official `data.workout` object from GET /workout/next
 * or /workout/current into the standard day plan shape consumed by
 * createWorkoutSession, preserving all server identifiers and metadata.
 */

import { parseWeightString } from './weight-rounding.js';

/**
 * Normalizes a unit string.
 * @param {string|null} unit
 * @returns {string|null}
 */
function normalizeUnit(unit) {
  if (!unit || typeof unit !== 'string') return null;
  const trimmed = unit.trim().toLowerCase();
  if (trimmed === 'lbs') return 'lb';
  return trimmed || null;
}

/**
 * Detects the day plan unit from explicit options or from the first parseable set weight.
 * Leaves the unit null if neither is present (never defaults to 'kg').
 *
 * @param {object} workout
 * @param {string|null} explicitUnit
 * @returns {string|null}
 */
function detectWorkoutUnit(workout, explicitUnit) {
  const normalizedExplicit = normalizeUnit(explicitUnit);
  if (normalizedExplicit) return normalizedExplicit;

  const entries = workout?.entries || [];
  for (const entry of entries) {
    const allSets = [...(entry.warmupSets || []), ...(entry.sets || [])];
    for (const set of allSets) {
      if (set?.weight !== null && set?.weight !== undefined) {
        const parsed = parseWeightString(set.weight, null);
        if (parsed?.unit) {
          return parsed.unit;
        }
      }
    }
  }

  return null;
}

/**
 * Maps a single workout set object into the plan set shape.
 *
 * @param {object} set
 * @param {number} setIndex 0-based
 * @param {boolean} isWarmupDefault
 * @param {string|null} planUnit
 * @returns {object}
 */
function mapWorkoutSet(set, setIndex, isWarmupDefault, planUnit) {
  const isWarmup = set?.isWarmup !== undefined ? Boolean(set.isWarmup) : isWarmupDefault;
  const minReps = Number.isFinite(set?.minReps) ? set.minReps : null;
  const reps = Number.isFinite(set?.reps) ? set.reps : null;

  const targetReps = minReps !== null ? minReps : reps;
  const targetRepsMax = minReps !== null && reps !== null && minReps !== reps ? reps : null;

  const parsedWeight = parseWeightString(set?.weight, planUnit);
  const targetWeight = parsedWeight ? parsedWeight.value : null;
  const setUnit = parsedWeight?.unit || planUnit || null;

  const timer = Number.isFinite(set?.timer) ? set.timer : (Number.isFinite(set?.restSeconds) ? set.restSeconds : null);
  const completedWeight = parseWeightString(set?.completed?.weight, planUnit);
  const completed = set?.completed === null || set?.completed === undefined
    ? null
    : {
        ...(set.completed.reps !== undefined ? { reps: set.completed.reps } : {}),
        ...(set.completed.repsLeft !== undefined ? { repsLeft: set.completed.repsLeft } : {}),
        ...(completedWeight ? { weight: completedWeight.value, unit: completedWeight.unit } : {}),
        ...(set.completed.rpe !== undefined ? { rpe: set.completed.rpe } : {}),
        ...(set.completed.setTimer !== undefined ? { setTimer: set.completed.setTimer } : {}),
        ...(set.completed.userVars !== undefined ? { userVars: set.completed.userVars } : {}),
      };

  return {
    setId: set?.setId ?? null,
    serverIndex: set?.index !== undefined ? set.index : null,
    index: setIndex + 1,
    isWarmup,
    targetReps,
    targetRepsMax,
    isAmrap: Boolean(set?.isAmrap),
    targetWeight,
    originalWeight: set?.weight ?? null,
    unit: setUnit,
    plates: set?.plates ?? null,
    rpe: set?.rpe ?? null,
    targetRpe: set?.rpe ?? null,
    logRpe: Boolean(set?.logRpe),
    askWeight: Boolean(set?.askWeight),
    isUnilateral: Boolean(set?.isUnilateral),
    restSeconds: timer,
    timer: set?.timer ?? null,
    setTimer: set?.setTimer ?? null,
    completed,
  };
}

/**
 * Translates a Liftosaur Running Workout object into a Day Plan.
 *
 * @param {object} workout Unmodified `data.workout` from GET /workout/next or /current
 * @param {{ units?: string|null }} options
 * @returns {object|null}
 */
export function workoutToDayPlan(workout, { units = null, isCurrent = false } = {}) {
  if (!workout || typeof workout !== 'object') return null;

  const planUnit = detectWorkoutUnit(workout, units);
  const entries = workout.entries || [];

  const exercises = entries.map((entry, index) => {
    const rawWarmupSets = entry.warmupSets || [];
    const rawSets = entry.sets || [];

    const warmupSets = rawWarmupSets.map((s, idx) => mapWorkoutSet(s, idx, true, planUnit));
    const sets = rawSets.map((s, idx) => mapWorkoutSet(s, idx, false, planUnit));

    return {
      index: index + 1,
      id: entry.entryId || `ex-${index + 1}`,
      entryId: entry.entryId ?? null,
      exerciseId: entry.exerciseId ?? null,
      name: entry.name || `Exercise ${index + 1}`,
      equipment: entry.equipment ?? null,
      supersetGroup: entry.superset ?? null,
      supersetTag: entry.superset ?? null,
      notes: entry.notes ?? null,
      description: entry.description ?? null,
      hasUpdateScript: Boolean(entry.hasUpdateScript),
      promptedVars: entry.promptedVars ?? null,
      warmupSets,
      sets,
    };
  });

  return {
    programId: workout.programId ?? null,
    programName: workout.programName ?? null,
    dayName: workout.dayName ?? null,
    week: workout.dayData?.week ?? null,
    dayInWeek: workout.dayData?.dayInWeek ?? null,
    startTime: workout.startTime ?? null,
    isCurrent: Boolean(isCurrent),
    unit: planUnit,
    source: 'WORKOUT_API',
    exercises,
  };
}
