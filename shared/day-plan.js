/**
 * Day plan model.
 *
 * A day plan is the prescription for one workout, built exclusively from the
 * `target:` sections that `POST /api/v1/playground` returns. Nothing in this
 * module invents a weight, a rep count or a rest timer: a field the API left
 * unstated stays null and the UI shows it as unknown.
 *
 * The same module builds the playground command list that replays the workout
 * back to the server, so exercise and set indices are produced by one place
 * only. Both are 1-based, matching the playground command grammar.
 */

import { parseLiftohistoryRecord, parseSetGroups, expandSetGroups } from './liftohistory.js';
import { normalizeName } from './name.js';

export { normalizeName } from './name.js';

/**
 * Builds a day plan from a probe response: a playground run whose only purpose
 * was to make every exercise emit its `target:` section.
 *
 * @param {string} workoutText `data.workout` from POST /playground
 * @returns {{programName: string|null, dayName: string|null, week: number|null, dayInWeek: number|null, unit: string, exercises: Array}|null}
 */
export function buildDayPlan(workoutText) {
  const record = parseLiftohistoryRecord(workoutText);
  if (!record) return null;

  const exercises = record.exercises.map((exercise, index) => {
    const targetSets = expandSetGroups(exercise.targetGroups);
    return {
      index: index + 1,
      id: `ex-${index + 1}`,
      name: exercise.name,
      fullName: exercise.fullName || exercise.name,
      equipment: exercise.equipment,
      supersetGroup: null,
      supersetTag: null,
      warmupSets: [],
      sets: targetSets.map((set, setIndex) => ({
        index: setIndex + 1,
        targetReps: set.reps,
        targetRepsMax: set.maxReps,
        targetWeight: set.weight,
        targetRpe: set.rpe,
        unit: set.unit,
        restSeconds: set.restSeconds,
        isAmrap: set.isAmrap,
        askWeight: set.askWeight,
      })),
    };
  });

  return {
    programName: record.programName,
    dayName: record.dayName,
    week: record.week,
    dayInWeek: record.dayInWeek,
    unit: detectUnit(exercises),
    exercises: exercises.filter((exercise) => exercise.sets.length > 0),
  };
}

/**
 * Applies default rest timers across a day plan when none were explicitly
 * prescribed by the Liftoscript source.
 *
 * Precedence:
 * 1. Explicit timer in Liftoscript (e.g. target: 3x8 80kg @8 90s) -> preserved
 * 2. Superset work set with no timer -> defaultTimers.supersetRest (default 90s)
 * 3. Standard work set with no timer -> defaultTimers.standardRest (default 120s)
 * 4. Warmup set with no timer -> defaultTimers.warmupRest (default 60s)
 *
 * A value of 0 or null for any default means "Off" (no rest timer).
 *
 * @param {object} plan Day plan produced by buildDayPlan
 * @param {{standardRest?: number|null, supersetRest?: number|null, warmupRest?: number|null}} defaultTimers
 * @returns {object} The plan with default timers applied
 */
export function applyDefaultTimers(plan, defaultTimers = {}) {
  if (!plan || !Array.isArray(plan.exercises)) return plan;

  const std = defaultTimers?.standardRest !== undefined ? defaultTimers.standardRest : 120;
  const sup = defaultTimers?.supersetRest !== undefined ? defaultTimers.supersetRest : 90;
  const wrm = defaultTimers?.warmupRest !== undefined ? defaultTimers.warmupRest : 60;

  for (const ex of plan.exercises) {
    const isSuperset = Boolean(ex.supersetGroup || ex.supersetTag);
    const workDefault = isSuperset ? sup : std;
    const workRest = Number.isFinite(workDefault) && workDefault > 0 ? workDefault : null;
    const warmupDefault = Number.isFinite(wrm) && wrm > 0 ? wrm : null;

    for (const set of ex.sets || []) {
      if (set.restSeconds === null || set.restSeconds === undefined) {
        set.restSeconds = workRest;
      }
    }

    for (const wSet of ex.warmupSets || []) {
      if (wSet.restSeconds === null || wSet.restSeconds === undefined) {
        wSet.restSeconds = warmupDefault;
      }
    }
  }

  return plan;
}

/**
 * Enriches a day plan with warmups and superset groupings read from the program
 * text. Applies metadata only when the exercise names and count align
 * strictly with the playground's output.
 *
 * @param {object} plan Day plan produced by buildDayPlan
 * @param {Array<{name: string, equipment: string|null, warmupText: string|null, supersetTag: string|null}>} programExercises
 * @param {{referenceData?: object, defaultTimers?: object}} options
 * @returns {object} The enriched plan
 */
export function applyProgramMetadata(
  plan,
  programExercises,
  { referenceData = null, defaultTimers = {} } = {}
) {
  if (!plan || !Array.isArray(plan.exercises) || !Array.isArray(programExercises)) {
    return applyDefaultTimers(plan, defaultTimers);
  }
  if (plan.exercises.length !== programExercises.length) {
    return applyDefaultTimers(plan, defaultTimers);
  }

  for (let i = 0; i < plan.exercises.length; i++) {
    if (normalizeName(plan.exercises[i].name) !== normalizeName(programExercises[i].name)) {
      return applyDefaultTimers(plan, defaultTimers); // Name mismatch: do not guess, but apply timers
    }
  }

  const effectiveTimers = {
    standardRest: defaultTimers?.standardRest !== undefined ? defaultTimers.standardRest : 120,
    warmupRest: defaultTimers?.warmupRest !== undefined ? defaultTimers.warmupRest : 60,
    supersetRest: defaultTimers?.supersetRest !== undefined ? defaultTimers.supersetRest : 90,
  };

  for (let i = 0; i < plan.exercises.length; i++) {
    const ex = plan.exercises[i];
    const meta = programExercises[i];

    ex.supersetGroup = meta.supersetTag || null;
    ex.supersetTag = meta.supersetTag || null;
    ex.notes =
      meta.note ||
      (referenceData && typeof referenceData.resolveNotes === 'function'
        ? referenceData.resolveNotes(ex.name)
        : null) ||
      null;
    ex.loadingEquipment =
      referenceData && typeof referenceData.resolveEquipment === 'function'
        ? referenceData.resolveEquipment(ex.name, ex.equipment, ex.fullName)
        : null;
    ex.warmupSets = [];

    if (meta.warmupText && meta.warmupText.toLowerCase() !== 'none') {
      const warmupGroups = parseSetGroups(meta.warmupText);
      const rawWarmupSets = expandSetGroups(warmupGroups);
      const firstWorkSet = ex.sets.find((s) => Number.isFinite(s.targetWeight) && s.targetWeight > 0);
      const firstWorkSetWeight = firstWorkSet?.targetWeight ?? (ex.sets[0]?.targetWeight ?? null);

      for (let wIdx = 0; wIdx < rawWarmupSets.length; wIdx++) {
        const wSet = rawWarmupSets[wIdx];
        let targetWeight = null;

        if (wSet.percent !== null) {
          if (Number.isFinite(firstWorkSetWeight) && firstWorkSetWeight > 0) {
            const rawTarget = (wSet.percent / 100) * firstWorkSetWeight;
            if (referenceData && typeof referenceData.resolveWeight === 'function') {
              const resolved = referenceData.resolveWeight(
                ex.name,
                ex.equipment,
                rawTarget,
                plan.unit,
                ex.fullName
              );
              targetWeight = resolved.resolved ? resolved.value : null;
            }
            if (targetWeight === null) {
              const step = plan.unit === 'lb' ? 5 : 2.5;
              const rounded = Math.round((rawTarget / step) + 1e-9) * step;
              targetWeight = Math.round(rounded * 100000) / 100000;
            }
          }
        } else {
          targetWeight = wSet.weight;
        }

        const warmupRest =
          Number.isFinite(wSet.restSeconds) && wSet.restSeconds > 0
            ? wSet.restSeconds
            : (Number.isFinite(effectiveTimers.warmupRest) && effectiveTimers.warmupRest > 0 ? effectiveTimers.warmupRest : null);

        ex.warmupSets.push({
          index: wIdx + 1,
          isWarmup: true,
          targetReps: wSet.reps,
          targetRepsMax: wSet.maxReps,
          targetWeight,
          targetWeightPercent: wSet.percent ?? null,
          targetRpe: wSet.rpe,
          unit: wSet.unit || plan.unit,
          restSeconds: warmupRest,
          isAmrap: wSet.isAmrap,
          askWeight: wSet.askWeight,
        });
      }
    }
  }

  return applyDefaultTimers(plan, defaultTimers);
}

function detectUnit(exercises) {
  for (const exercise of exercises) {
    for (const set of exercise.sets) {
      if (set.unit) return set.unit;
    }
  }
  return 'kg';
}

/** `complete_set(1, 1)` … used to make every exercise reveal its target sets. */
export function buildProbeCommands(exerciseCount) {
  const commands = [];
  for (let i = 1; i <= exerciseCount; i++) {
    commands.push(`complete_set(${i}, 1)`);
  }
  return commands;
}

/**
 * Reads the exercise count out of the playground's own out-of-range error.
 * `Exercise 7 not found` after six valid completions means the day has six.
 * Returns null when the message is not that error.
 */
export function exerciseCountFromProbeError(message) {
  const match = String(message || '').match(/Exercise\s+(\d+)\s+not found/i);
  if (!match) return null;
  return Math.max(0, parseInt(match[1], 10) - 1);
}

function formatWeightArg(weight, unit) {
  const rounded = Math.round(weight * 100) / 100;
  return `${rounded}${unit || 'kg'}`;
}

/**
 * Translates the local journal of completed sets into playground commands.
 * Adjustments are emitted before the completion they belong to, so the server
 * records exactly the weight, reps and RPE the user confirmed on the watch.
 *
 * Warmup sets are skipped because the playground does not track them.
 *
 * @param {Array<{exerciseIndex: number, setIndex: number, weight: number|null, reps: number, rpe: number|null, unit: string, seconds: number|null, isWarmup?: boolean}>} completedSets
 *        Indices are 1-based and refer to the day plan.
 */
export function buildWorkoutCommands(completedSets, { finish = false } = {}) {
  const commands = [];

  for (const set of completedSets) {
    if (set.isWarmup) continue;
    const { exerciseIndex, setIndex } = set;
    if (!Number.isFinite(exerciseIndex) || !Number.isFinite(setIndex)) continue;

    if (set.weight !== null && set.weight !== undefined) {
      commands.push(`change_weight(${exerciseIndex}, ${setIndex}, ${formatWeightArg(set.weight, set.unit)})`);
    }
    if (set.reps !== null && set.reps !== undefined) {
      commands.push(`change_reps(${exerciseIndex}, ${setIndex}, ${set.reps})`);
    }
    commands.push(`complete_set(${exerciseIndex}, ${setIndex})`);
    if (set.rpe !== null && set.rpe !== undefined) {
      commands.push(`change_rpe(${exerciseIndex}, ${setIndex}, ${set.rpe})`);
    }
    if (set.seconds !== null && set.seconds !== undefined) {
      commands.push(`change_set_time(${exerciseIndex}, ${setIndex}, ${set.seconds})`);
    }
  }

  if (finish) {
    commands.push('finish_workout()');
  }

  return commands;
}
