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

export function normalizeName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

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
 * Enriches a day plan with warmups and superset groupings read from the program
 * text. Applies metadata only when the exercise names and count align
 * strictly with the playground's output.
 *
 * @param {object} plan Day plan produced by buildDayPlan
 * @param {Array<{name: string, equipment: string|null, warmupText: string|null, supersetTag: string|null}>} programExercises
 * @param {{referenceData?: object}} options
 * @returns {object} The enriched plan
 */
export function applyProgramMetadata(plan, programExercises, { referenceData = null } = {}) {
  if (!plan || !Array.isArray(plan.exercises) || !Array.isArray(programExercises)) return plan;
  if (plan.exercises.length !== programExercises.length) return plan;

  for (let i = 0; i < plan.exercises.length; i++) {
    if (normalizeName(plan.exercises[i].name) !== normalizeName(programExercises[i].name)) {
      return plan; // Name mismatch: do not guess
    }
  }

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
    ex.warmupSets = [];

    if (meta.warmupText && meta.warmupText.toLowerCase() !== 'none') {
      const warmupGroups = parseSetGroups(meta.warmupText);
      const rawWarmupSets = expandSetGroups(warmupGroups);
      const firstWorkSetWeight = ex.sets[0]?.targetWeight ?? null;

      for (let wIdx = 0; wIdx < rawWarmupSets.length; wIdx++) {
        const wSet = rawWarmupSets[wIdx];
        let targetWeight = null;

        if (wSet.percent !== null) {
          if (Number.isFinite(firstWorkSetWeight) && firstWorkSetWeight > 0) {
            const rawTarget = (wSet.percent / 100) * firstWorkSetWeight;
            if (referenceData && typeof referenceData.resolveWeight === 'function') {
              const resolved = referenceData.resolveWeight(ex.name, ex.equipment, rawTarget, plan.unit);
              targetWeight = resolved.resolved ? resolved.value : null;
            }
            if (targetWeight === null) {
              const step = plan.unit === 'lb' ? 5 : 2.5;
              targetWeight = Math.round(rawTarget / step) * step;
            }
          }
        } else {
          targetWeight = wSet.weight;
        }

        const warmupRest =
          Number.isFinite(wSet.restSeconds) && wSet.restSeconds > 0
            ? wSet.restSeconds
            : 60;

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

  return plan;
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
