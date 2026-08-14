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

import {
  parseLiftohistoryRecord,
  expandSetGroups,
  serializeLiftohistoryRecord,
} from './liftohistory.js';

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
 * @param {Array<{exerciseIndex: number, setIndex: number, weight: number|null, reps: number, rpe: number|null, unit: string, seconds: number|null}>} completedSets
 *        Indices are 1-based and refer to the day plan.
 */
export function buildWorkoutCommands(completedSets, { finish = false } = {}) {
  const commands = [];

  for (const set of completedSets) {
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

/**
 * A Liftohistory record for a workout still in progress.
 *
 * This is written to the history after every set so the session is visible in
 * the Liftosaur app while it happens, and survives a dead watch. It states only
 * what the user did — no `target:`, no progression — because those are the
 * playground's to compute. At finish the whole text is replaced by the record
 * the playground returns, so nothing here can end up authoritative.
 *
 * It deliberately writes **no `duration:`**. Liftosaur derives the end of a
 * workout from it — `endTime = durationSec != null ? startTime + durationSec :
 * undefined` — so a record carrying a duration is a finished workout. Omitting
 * it leaves `endTime` undefined, which is what an ongoing session looks like.
 * The duration is stated once, at finish, when it is actually known.
 */
export function buildProgressRecord({ plan, completedSets = [], startedAt = null } = {}) {
  if (!plan || !Array.isArray(plan.exercises)) return null;

  const byExercise = new Map();
  for (const set of completedSets) {
    const list = byExercise.get(set.exerciseIndex) || [];
    list.push(set);
    byExercise.set(set.exerciseIndex, list);
  }

  const exercises = [];
  for (const exercise of plan.exercises) {
    const sets = byExercise.get(exercise.index);
    if (!sets || sets.length === 0) continue;

    exercises.push({
      name: exercise.name,
      equipment: exercise.equipment,
      sets: sets
        .slice()
        .sort((a, b) => a.setIndex - b.setIndex)
        .map((set) => ({
          reps: set.reps,
          weight: set.weight,
          unit: set.unit,
          rpe: set.rpe,
          isAmrap: false,
          repsLeft: null,
        })),
      // The prescription is known from the day plan, so the record carries it
      // like any Liftosaur record. Without it the exercise reads as having no
      // target at all.
      targetSets: Array.isArray(exercise.sets) ? exercise.sets : [],
    });
  }

  if (exercises.length === 0) return null;

  return serializeLiftohistoryRecord({
    date: startedAt ? new Date(startedAt) : new Date(),
    programName: plan.programName,
    dayName: plan.dayName,
    week: plan.week,
    dayInWeek: plan.dayInWeek,
    durationSeconds: null,
    exercises,
  });
}
