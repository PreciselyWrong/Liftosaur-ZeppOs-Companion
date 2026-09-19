/**
 * Workout session state machine and event journal.
 *
 * The session is driven entirely by a day plan the API produced. It records
 * what the user did - weight, reps, RPE, in which order - and nothing else. It
 * computes no progression and rewrites no prescription: those belong to
 * `POST /playground`, which replays this journal when the workout ends.
 *
 * Platform independent: runs under plain Node, on the device and in the Side
 * Service.
 */

import { formatExerciseDetails } from './exercise-notes.js';

export const SESSION_STATES = {
  NO_PLAN: 'NO_PLAN',
  READY: 'READY',
  ACTIVE_SET: 'ACTIVE_SET',
  REST: 'REST',
  FINISHED: 'FINISHED',
};

export const EVENT_TYPES = {
  START_WORKOUT: 'START_WORKOUT',
  ADJUST_WEIGHT: 'ADJUST_WEIGHT',
  ADJUST_REPS: 'ADJUST_REPS',
  ADJUST_RPE: 'ADJUST_RPE',
  COMPLETE_SET: 'COMPLETE_SET',
  SKIP_WARMUP: 'SKIP_WARMUP',
  NEXT_SET: 'NEXT_SET',
  PAUSE_REST: 'PAUSE_REST',
  RESUME_REST: 'RESUME_REST',
  PAUSE_WORKOUT: 'PAUSE_WORKOUT',
  RESUME_WORKOUT: 'RESUME_WORKOUT',
  ADJUST_REST: 'ADJUST_REST',
  SELECT_EXERCISE: 'SELECT_EXERCISE',
  FINISH_WORKOUT: 'FINISH_WORKOUT',
  CANCEL_WORKOUT: 'CANCEL_WORKOUT',
  TIMED_SET: 'TIMED_SET',
};

export function weightStepFor(unit) {
  return unit === 'lb' ? 5 : 2.5;
}

function initialWeightFor(set) {
  return set?.targetWeight ?? (set?.askWeight ? 0 : null);
}

function combineExerciseDetails(exercise) {
  return formatExerciseDetails(exercise);
}

export function createWorkoutSession({
  plan = null,
  initialJournal = [],
  resumeFromEntryId = null,
} = {}) {
  const unit = plan?.unit || 'kg';
  const step = weightStepFor(unit);

  const exercises = (plan?.exercises || []).map((exercise, index) => {
    const warmups = exercise.warmupSets || [];
    const workSets = exercise.sets || [];
    const sets = [];

    warmups.forEach((w, wIdx) => {
      sets.push({
        index: sets.length + 1,
        setId: w.setId ?? null,
        serverIndex: w.serverIndex !== undefined ? w.serverIndex : (w.index !== undefined ? w.index : null),
        isWarmup: true,
        warmupIndex: wIdx + 1,
        totalWarmups: warmups.length,
        workSetIndex: null,
        totalWorkSets: workSets.length,
        targetReps: w.targetReps ?? null,
        targetRepsMax: w.targetRepsMax ?? null,
        targetWeight: w.targetWeight ?? null,
        targetWeightPercent: w.targetWeightPercent ?? null,
        originalWeight: w.originalWeight ?? null,
        plates: w.plates ?? null,
        targetRpe: w.targetRpe ?? w.rpe ?? null,
        rpe: w.rpe ?? w.targetRpe ?? null,
        logRpe: Boolean(w.logRpe),
        askWeight: Boolean(w.askWeight),
        isUnilateral: Boolean(w.isUnilateral),
        restSeconds: Number.isFinite(w.restSeconds) ? w.restSeconds : (Number.isFinite(w.timer) ? w.timer : null),
        setTimer: w.setTimer ?? null,
        completed: w.completed ?? null,
        isAmrap: Boolean(w.isAmrap),
        unit: w.unit || unit,
      });
    });

    workSets.forEach((s, sIdx) => {
      sets.push({
        index: sets.length + 1,
        setId: s.setId ?? null,
        serverIndex: s.serverIndex !== undefined ? s.serverIndex : (s.index !== undefined ? s.index : null),
        isWarmup: false,
        warmupIndex: null,
        totalWarmups: warmups.length,
        workSetIndex: s.index ?? sIdx + 1,
        totalWorkSets: workSets.length,
        targetReps: s.targetReps ?? null,
        targetRepsMax: s.targetRepsMax ?? null,
        targetWeight: s.targetWeight ?? null,
        targetWeightPercent: null,
        originalWeight: s.originalWeight ?? null,
        plates: s.plates ?? null,
        targetRpe: s.targetRpe ?? s.rpe ?? null,
        rpe: s.rpe ?? s.targetRpe ?? null,
        logRpe: Boolean(s.logRpe),
        askWeight: Boolean(s.askWeight),
        isUnilateral: Boolean(s.isUnilateral),
        restSeconds: Number.isFinite(s.restSeconds) ? s.restSeconds : (Number.isFinite(s.timer) ? s.timer : null),
        setTimer: s.setTimer ?? null,
        completed: s.completed ?? null,
        isAmrap: Boolean(s.isAmrap),
        unit: s.unit || unit,
      });
    });

    return {
      index: exercise.index ?? index + 1,
      id: exercise.id || exercise.entryId || `ex-${index + 1}`,
      entryId: exercise.entryId ?? (exercise.id && !exercise.id.startsWith('ex-') ? exercise.id : null),
      exerciseId: exercise.exerciseId ?? null,
      name: exercise.name || `Exercise ${index + 1}`,
      equipment: exercise.equipment || null,
      loadingEquipment: exercise.loadingEquipment || null,
      supersetGroup: exercise.supersetGroup || exercise.supersetTag || null,
      notes: exercise.notes || null,
      exerciseNotes: exercise.exerciseNotes || null,
      historyNotes: exercise.historyNotes || null,
      description: exercise.description || null,
      imageUrl: exercise.imageUrl ?? null,
      hasUpdateScript: Boolean(exercise.hasUpdateScript),
      promptedVars: exercise.promptedVars ?? null,
      warmupSetsCount: warmups.length,
      workSetsCount: workSets.length,
      sets,
    };
  });

  let state = exercises.length === 0 ? SESSION_STATES.NO_PLAN : SESSION_STATES.READY;
  let currentExerciseIndex = 0;
  let workoutStartTime = null;
  let workoutEndTime = null;
  let totalPausedWorkoutDurationMs = 0;
  let pauseStartedAt = null;
  const activePauseReasons = new Set();
  const hasWorkoutPause = () =>
    activePauseReasons.has('manual-workout') || activePauseReasons.has('native-workout');
  const pauseSourceForEvent = (event) =>
    event.payload?.source === 'manual' ? 'manual-workout' : 'native-workout';
  let restInfo = null;
  let activeTimer = null;
  let journal = [];
  const intervals = [];
  let intervalStart = null;

  const progress = exercises.map((exercise) => ({
    currentSetIndex: 0,
    currentWeight: initialWeightFor(exercise.sets[0]),
    currentReps: exercise.sets[0]?.targetReps ?? null,
    currentRpe: exercise.sets[0]?.targetRpe ?? null,
    completedSets: [],
  }));

  if (plan?.isCurrent && exercises.length > 0) {
    let completionOrder = 0;
    for (let exerciseIdx = 0; exerciseIdx < exercises.length; exerciseIdx++) {
      const exercise = exercises[exerciseIdx];
      const prog = progress[exerciseIdx];
      for (let setIdx = 0; setIdx < exercise.sets.length; setIdx++) {
        const target = exercise.sets[setIdx];
        if (!target.completed) break;
        const completed = target.completed;
        prog.completedSets.push({
          exerciseIndex: exercise.index,
          exerciseArrayIndex: exerciseIdx,
          exerciseName: exercise.name,
          entryId: exercise.entryId ?? null,
          exerciseId: exercise.exerciseId ?? null,
          setId: target.setId ?? null,
          setIndex: setIdx + 1,
          isWarmup: Boolean(target.isWarmup),
          workSetIndex: target.workSetIndex ?? null,
          warmupIndex: target.warmupIndex ?? null,
          weight: completed.weight ?? null,
          reps: completed.reps ?? null,
          rpe: completed.rpe ?? null,
          repsLeft: completed.repsLeft ?? null,
          setTimer: completed.setTimer ?? null,
          setTimerLeft: completed.setTimerLeft ?? null,
          userVars: completed.userVars ?? null,
          unit: completed.unit || target.unit || unit,
          completedAt: completionOrder++,
        });
      }
      const nextSetIdx = prog.completedSets.length;
      prog.currentSetIndex = nextSetIdx;
      if (nextSetIdx < exercise.sets.length) {
        const next = exercise.sets[nextSetIdx];
        prog.currentWeight = initialWeightFor(next);
        prog.currentReps = next.targetReps;
        prog.currentRpe = next.targetRpe;
      }
    }

    workoutStartTime = Number.isFinite(plan.startTime) ? plan.startTime : null;
    intervalStart = workoutStartTime;
    const anchorIndex = resumeFromEntryId === null
      ? -1
      : exercises.findIndex((exercise) => exercise.entryId === resumeFromEntryId);
    const resumeIndex = anchorIndex === -1
      ? 0
      : progress[anchorIndex].completedSets.length < exercises[anchorIndex].sets.length
        ? anchorIndex
        : (anchorIndex + 1) % exercises.length;
    const firstPending = findServerResumeExerciseIndex(resumeIndex);
    if (firstPending === -1) {
      state = SESSION_STATES.FINISHED;
      currentExerciseIndex = Math.max(0, exercises.length - 1);
    } else {
      state = SESSION_STATES.ACTIVE_SET;
      currentExerciseIndex = firstPending;
    }
  }

  function currentExercise() {
    return exercises[currentExerciseIndex] || null;
  }

  function findServerResumeExerciseIndex(from = 0) {
    const visitedGroups = new Set();
    for (let offset = 0; offset < exercises.length; offset++) {
      const index = (from + offset) % exercises.length;
      const exercise = exercises[index];
      if (progress[index].completedSets.length >= exercise.sets.length) continue;
      if (!exercise.supersetGroup) return index;
      if (visitedGroups.has(exercise.supersetGroup)) continue;
      visitedGroups.add(exercise.supersetGroup);

      const candidates = exercises
        .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
        .filter(({ candidate, candidateIndex }) =>
          candidate.supersetGroup === exercise.supersetGroup &&
          progress[candidateIndex].completedSets.length < candidate.sets.length
        );
      const fewestCompleted = Math.min(
        ...candidates.map(({ candidateIndex }) => progress[candidateIndex].completedSets.length)
      );
      const next = candidates.find(
        ({ candidateIndex }) => progress[candidateIndex].completedSets.length === fewestCompleted
      );
      if (next) return next.candidateIndex;
    }
    return -1;
  }

  function currentProgress() {
    return progress[currentExerciseIndex] || null;
  }

  /**
   * The set the lifter is about to perform: the active one normally, and during
   * rest the one the "Prepare" screen shows. Adjustments made while resting
   * belong to that upcoming set, not to the one already logged.
   */
  function pendingIndex() {
    if (state !== SESSION_STATES.REST) return currentExerciseIndex;
    const nextIdx = findNextExerciseIndex(currentExerciseIndex);
    return nextIdx === -1 ? currentExerciseIndex : nextIdx;
  }

  function pendingProgress() {
    return progress[pendingIndex()] || null;
  }

  function loadSetTargets(exerciseIdx, setIdx) {
    const exercise = exercises[exerciseIdx];
    const prog = progress[exerciseIdx];
    if (!exercise || !prog) return;
    const target = exercise.sets[setIdx];
    prog.currentSetIndex = setIdx;
    if (target) {
      prog.currentWeight = initialWeightFor(target);
      prog.currentReps = target.targetReps;
      prog.currentRpe = target.targetRpe;
    }
  }

  function allSetsDone() {
    return exercises.every((exercise, i) => progress[i].completedSets.length >= exercise.sets.length);
  }

  function firstUnfinishedExercise(from = 0, completedCount = index => progress[index].completedSets.length) {
    for (let i = from; i < exercises.length; i++) {
      if (completedCount(i) < exercises[i].sets.length) return i;
    }
    for (let i = 0; i < from; i++) {
      if (completedCount(i) < exercises[i].sets.length) return i;
    }
    return -1;
  }

  function findNextExerciseIndex(currentIdx, completedCount = index => progress[index].completedSets.length) {
    const curEx = exercises[currentIdx];
    const curProg = progress[currentIdx];

    // If current exercise still has warmups to do, finish warmups first
    if (curEx && curProg && completedCount(currentIdx) < curEx.sets.length) {
      const isWarmup = completedCount(currentIdx) < curEx.warmupSetsCount;
      if (isWarmup) return currentIdx;
    }

    // If current exercise is in a superset group:
    if (curEx && curEx.supersetGroup) {
      const group = curEx.supersetGroup;
      const groupIndices = [];
      for (let i = 0; i < exercises.length; i++) {
        if (exercises[i].supersetGroup === group) groupIndices.push(i);
      }

      const curWorkSets = Math.max(0, completedCount(currentIdx) - curEx.warmupSetsCount);

      // If current exercise just finished warmups and has not completed Work Set 1 yet
      if (curProg && completedCount(currentIdx) < curEx.sets.length && curWorkSets === 0) {
        return currentIdx;
      }

      // 1. Look for any partner in group with FEWER completed work sets than current
      for (let offset = 1; offset <= groupIndices.length; offset++) {
        const idx = groupIndices[(groupIndices.indexOf(currentIdx) + offset) % groupIndices.length];
        const ex = exercises[idx];
        const pWorkSets = Math.max(0, completedCount(idx) - ex.warmupSetsCount);
        if (completedCount(idx) < ex.sets.length && pWorkSets < curWorkSets) {
          return idx;
        }
      }

      // 2. If all partners have reached this level, start next round at the first unfinished in group
      for (const idx of groupIndices) {
        const ex = exercises[idx];
        if (completedCount(idx) < ex.sets.length) {
          return idx;
        }
      }
    }

    // If not in a superset, or superset is completely done:
    if (curProg && completedCount(currentIdx) < curEx.sets.length) {
      return currentIdx;
    }

    return firstUnfinishedExercise(currentIdx + 1, completedCount);
  }

  function describeSuperset(exerciseIndex, setIndex) {
    const exercise = exercises[exerciseIndex];
    if (state === SESSION_STATES.FINISHED || !exercise?.supersetGroup || !exercise.sets[setIndex]) return null;
    const members = exercises.filter(candidate => candidate.supersetGroup === exercise.supersetGroup);
    if (members.length < 2) return null;
    const nextIndex = findNextExerciseIndex(exerciseIndex, index =>
      index === exerciseIndex
        ? Math.max(progress[index].completedSets.length, setIndex + 1)
        : progress[index].completedSets.length
    );
    return {
      group: exercise.supersetGroup,
      position: members.indexOf(exercise) + 1,
      size: members.length,
      round: setIndex < exercise.warmupSetsCount ? null : setIndex - exercise.warmupSetsCount + 1,
      totalRounds: Math.max(...members.map(member => member.workSetsCount)),
      nextExerciseName: exercises[nextIndex]?.name ?? null,
    };
  }

  function canSelectExercise(index) {
    if (activeTimer) return false;
    if (state === SESSION_STATES.FINISHED || state === SESSION_STATES.NO_PLAN || !Number.isInteger(index)) return false;
    const exercise = exercises[index];
    return Boolean(exercise && progress[index].completedSets.length < exercise.sets.length);
  }

  function applyEvent(event) {
    journal.push(event);

    switch (event.type) {
      case EVENT_TYPES.TIMED_SET: {
        activeTimer = event.payload ? { ...event.payload } : null;
        break;
      }
      case EVENT_TYPES.START_WORKOUT: {
        state = SESSION_STATES.ACTIVE_SET;
        workoutStartTime = event.timestamp;
        intervalStart = event.timestamp;
        intervals.length = 0;
        activePauseReasons.clear();
        pauseStartedAt = null;
        loadSetTargets(currentExerciseIndex, 0);
        break;
      }

      case EVENT_TYPES.SELECT_EXERCISE: {
        const target = event.payload?.exerciseIndex;
        if (!canSelectExercise(target)) break;
        const targetProg = progress[target];
        currentExerciseIndex = target;
        loadSetTargets(target, targetProg.completedSets.length);
        state = SESSION_STATES.ACTIVE_SET;
        restInfo = null;
        endPause('rest', event.timestamp);
        break;
      }

      case EVENT_TYPES.ADJUST_WEIGHT: {
        const prog = pendingProgress();
        if (!prog) break;
        const base = prog.currentWeight ?? 0;
        prog.currentWeight = Math.max(0, Math.round((base + event.payload.delta) * 100) / 100);
        break;
      }

      case EVENT_TYPES.ADJUST_REPS: {
        const prog = pendingProgress();
        if (!prog) break;
        prog.currentReps = Math.max(0, (prog.currentReps ?? 0) + event.payload.delta);
        break;
      }

      case EVENT_TYPES.ADJUST_RPE: {
        const prog = pendingProgress();
        if (!prog) break;
        const base = prog.currentRpe ?? 8;
        prog.currentRpe = Math.min(10, Math.max(1, Math.round((base + event.payload.delta) * 2) / 2));
        break;
      }

      case EVENT_TYPES.COMPLETE_SET: {
        const prog = currentProgress();
        const exercise = currentExercise();
        if (!prog || !exercise) break;

        const setIndex = prog.currentSetIndex;
        const target = exercise.sets[setIndex];
        if (!target || prog.completedSets.length >= exercise.sets.length) break;

        if (workoutStartTime === null) {
          workoutStartTime = event.timestamp;
          if (intervalStart === null) intervalStart = event.timestamp;
        }

        const payload = event.payload;
        const completedWeight = payload?.weight !== undefined ? payload.weight : prog.currentWeight;
        const completedReps = payload?.reps !== undefined ? payload.reps : prog.currentReps;
        const completedRpe = payload?.rpe !== undefined ? payload.rpe : prog.currentRpe;
        const entryId = payload?.entryId !== undefined ? payload.entryId : (exercise.entryId ?? null);
        const setId = payload?.setId !== undefined ? payload.setId : (target?.setId ?? null);
        const repsLeft = payload?.repsLeft !== undefined ? payload.repsLeft : null;
        const setTimer = payload?.setTimer !== undefined ? payload.setTimer : null;
        const setTimerLeft = payload?.setTimerLeft ?? null;
        const userVars = payload?.userVars !== undefined ? payload.userVars : null;
        const setUnit = payload?.unit || target?.unit || unit;

        prog.completedSets.push({
          exerciseIndex: exercise.index,
          exerciseArrayIndex: currentExerciseIndex,
          exerciseName: exercise.name,
          entryId,
          exerciseId: exercise.exerciseId ?? null,
          setId,
          setIndex: setIndex + 1,
          isWarmup: Boolean(target?.isWarmup),
          workSetIndex: target?.workSetIndex ?? null,
          warmupIndex: target?.warmupIndex ?? null,
          weight: completedWeight,
          reps: completedReps,
          rpe: completedRpe,
          repsLeft,
          setTimer,
          setTimerLeft,
          userVars,
          unit: setUnit,
          completedAt: event.timestamp,
        });
        activeTimer = null;

        if (allSetsDone()) {
          clearPauses(event.timestamp);
          state = SESSION_STATES.FINISHED;
          workoutEndTime = event.timestamp;
          restInfo = null;
          break;
        }

        const restDuration = target?.restSeconds ?? null;
        if (restDuration && restDuration > 0) {
          state = SESSION_STATES.REST;
          // The upcoming set's targets are loaded now rather than when rest
          // ends, so the "Prepare" screen has real numbers to edit and what the
          // lifter changes there survives into the set itself.
          const upcomingIdx = findNextExerciseIndex(currentExerciseIndex);
          if (upcomingIdx !== -1) {
            loadSetTargets(upcomingIdx, progress[upcomingIdx].completedSets.length);
          }
          restInfo = {
            startedAt: event.timestamp,
            duration: restDuration,
            endsAt: event.timestamp + restDuration * 1000,
            isPaused: false,
            pausedRemaining: null,
            nativePausedRemainingMs: hasWorkoutPause()
              ? restDuration * 1000
              : null,
          };
        } else {
          restInfo = null;
          advanceToNextSet({ timestamp: event.timestamp });
        }
        break;
      }

      case EVENT_TYPES.SKIP_WARMUP: {
        const payload = event.payload || {};
        const exerciseIndex = exercises.findIndex((exercise) =>
          exercise.index === payload.exerciseIndex &&
          (payload.entryId == null || exercise.entryId === payload.entryId)
        );
        const exercise = exercises[exerciseIndex];
        const prog = progress[exerciseIndex];
        if (!exercise || !prog) break;

        const setIndex = payload.setId != null
          ? exercise.sets.findIndex((set) => set.setId === payload.setId)
          : payload.setIndex - 1;
        const target = exercise.sets[setIndex];
        if (!target?.isWarmup) break;

        const pendingExerciseIndex = pendingIndex();
        const pendingProg = progress[pendingExerciseIndex];
        const pendingSetIndex = state === SESSION_STATES.REST
          ? pendingProg?.completedSets.length
          : pendingProg?.currentSetIndex;
        const removesPending = pendingExerciseIndex === exerciseIndex && pendingSetIndex === setIndex;

        exercise.sets.splice(setIndex, 1);
        exercise.warmupSetsCount -= 1;
        let warmupIndex = 0;
        exercise.sets.forEach((set, index) => {
          set.index = index + 1;
          set.totalWarmups = exercise.warmupSetsCount;
          if (set.isWarmup) set.warmupIndex = ++warmupIndex;
        });
        if (setIndex < prog.currentSetIndex) prog.currentSetIndex -= 1;

        if (!removesPending) break;
        if (allSetsDone()) {
          clearPauses(event.timestamp);
          state = SESSION_STATES.FINISHED;
          workoutEndTime = event.timestamp;
          restInfo = null;
          break;
        }
        if (state === SESSION_STATES.REST) {
          const nextIndex = findNextExerciseIndex(currentExerciseIndex);
          if (nextIndex !== -1) {
            loadSetTargets(nextIndex, progress[nextIndex].completedSets.length);
          }
          break;
        }
        advanceToNextSet({ timestamp: event.timestamp });
        break;
      }

      case EVENT_TYPES.PAUSE_REST: {
        if (state === SESSION_STATES.REST && restInfo && !restInfo.isPaused) {
          const remainingMs = hasWorkoutPause()
            ? (restInfo.nativePausedRemainingMs ?? restInfo.endsAt - event.timestamp)
            : restInfo.endsAt - event.timestamp;
          restInfo.isPaused = true;
          restInfo.pausedRemaining = Math.ceil(remainingMs / 1000);
          beginPause('rest', event.timestamp);
        }
        break;
      }

      case EVENT_TYPES.RESUME_REST: {
        if (state === SESSION_STATES.REST && restInfo && restInfo.isPaused) {
          const remaining = restInfo.pausedRemaining ?? restInfo.duration;
          restInfo.isPaused = false;
          restInfo.endsAt = event.timestamp + remaining * 1000;
          restInfo.startedAt = event.timestamp - (restInfo.duration - remaining) * 1000;
          restInfo.pausedRemaining = null;
          if (hasWorkoutPause()) {
            restInfo.nativePausedRemainingMs = remaining * 1000;
          }
          endPause('rest', event.timestamp);
        }
        break;
      }

      case EVENT_TYPES.PAUSE_WORKOUT: {
        const reason = pauseSourceForEvent(event);
        if (
          (state === SESSION_STATES.ACTIVE_SET || state === SESSION_STATES.REST) &&
          !activePauseReasons.has(reason)
        ) {
          if (!hasWorkoutPause() && restInfo && !restInfo.isPaused) {
            restInfo.nativePausedRemainingMs = restInfo.endsAt - event.timestamp;
          }
          beginPause(reason, event.timestamp);
        }
        break;
      }

      case EVENT_TYPES.RESUME_WORKOUT: {
        const reason = pauseSourceForEvent(event);
        if (activePauseReasons.has(reason)) {
          if (
            activePauseReasons.size === 1 &&
            restInfo &&
            !restInfo.isPaused &&
            Number.isFinite(restInfo.nativePausedRemainingMs)
          ) {
            restInfo.endsAt = event.timestamp + restInfo.nativePausedRemainingMs;
          }
          endPause(reason, event.timestamp);
          if (!hasWorkoutPause() && restInfo) restInfo.nativePausedRemainingMs = null;
        }
        break;
      }

      case EVENT_TYPES.ADJUST_REST: {
        if (state === SESSION_STATES.REST && restInfo) {
          const delta = event.payload?.delta || 0;
          if (restInfo.isPaused) {
            restInfo.pausedRemaining = Math.max(0, (restInfo.pausedRemaining ?? 0) + delta);
          } else if (hasWorkoutPause()) {
            restInfo.nativePausedRemainingMs = Math.max(
              0,
              (restInfo.nativePausedRemainingMs ?? 0) + delta * 1000
            );
            restInfo.duration = Math.max(0, restInfo.duration + delta);
          } else {
            restInfo.endsAt = restInfo.endsAt + delta * 1000;
            restInfo.duration = Math.max(0, restInfo.duration + delta);
          }
        }
        break;
      }

      case EVENT_TYPES.NEXT_SET: {
        endPause('rest', event.timestamp);
        restInfo = null;
        advanceToNextSet({ keepAdjustments: true, timestamp: event.timestamp });
        break;
      }

      case EVENT_TYPES.FINISH_WORKOUT: {
        clearPauses(event.timestamp);
        state = SESSION_STATES.FINISHED;
        if (workoutEndTime === null) {
          workoutEndTime = event.timestamp;
        }
        restInfo = null;
        break;
      }

      case EVENT_TYPES.CANCEL_WORKOUT: {
        state = exercises.length === 0 ? SESSION_STATES.NO_PLAN : SESSION_STATES.READY;
        workoutStartTime = null;
        workoutEndTime = null;
        totalPausedWorkoutDurationMs = 0;
        pauseStartedAt = null;
        activePauseReasons.clear();
        restInfo = null;
        intervals.length = 0;
        activeTimer = null;
        intervalStart = null;
        currentExerciseIndex = 0;
        progress.forEach((prog, i) => {
          prog.completedSets = [];
          prog.currentSetIndex = 0;
          prog.currentWeight = initialWeightFor(exercises[i].sets[0]);
          prog.currentReps = exercises[i].sets[0]?.targetReps ?? null;
          prog.currentRpe = exercises[i].sets[0]?.targetRpe ?? null;
        });
        journal = [];
        break;
      }
    }
  }

  function beginPause(reason, timestamp) {
    if (activePauseReasons.has(reason)) return;
    if (activePauseReasons.size === 0) {
      if (activeTimer && activeTimer.pausedAt === null) activeTimer.pausedAt = timestamp;
      pauseStartedAt = timestamp;
      if (intervalStart !== null) {
        intervals.push([intervalStart, timestamp]);
        intervalStart = null;
      }
    }
    activePauseReasons.add(reason);
  }

  function endPause(reason, timestamp) {
    if (!activePauseReasons.delete(reason)) return;
    if (activePauseReasons.size === 0) {
      resumeTimerClock(timestamp);
      if (pauseStartedAt !== null) {
        totalPausedWorkoutDurationMs += Math.max(0, timestamp - pauseStartedAt);
        pauseStartedAt = null;
      }
      if (intervalStart === null && (state === SESSION_STATES.ACTIVE_SET || state === SESSION_STATES.REST)) {
        intervalStart = timestamp;
      }
    }
  }

  function clearPauses(timestamp) {
    if (pauseStartedAt !== null) {
      totalPausedWorkoutDurationMs += Math.max(0, timestamp - pauseStartedAt);
    }
    pauseStartedAt = null;
    activePauseReasons.clear();
  }

  function resumeTimerClock(timestamp) {
    if (!activeTimer || activeTimer.manualPaused || activeTimer.pausedAt === null) return;
    activeTimer.startedAt += Math.max(0, timestamp - activeTimer.pausedAt);
    activeTimer.pausedAt = null;
  }

  function timedView(timestamp) {
    if (state !== SESSION_STATES.ACTIVE_SET && state !== SESSION_STATES.REST) return null;
    const target = describePendingSet()?.set;
    if (!Number.isFinite(target?.setTimer) || target.setTimer <= 0) return null;
    const timer = activeTimer;
    const elapsed = timer ? Math.max(0, Math.floor(((timer.pausedAt ?? timestamp) - timer.startedAt) / 1000)) : 0;
    return {
      phase: timer?.phase || 'READY', side: timer?.side ?? (target.isUnilateral ? 'LEFT' : null),
      remaining: timer?.phase === 'REST' ? restRemaining(timestamp)
        : timer ? (timer.phase === 'GET_READY' ? timer.readySeconds : timer.targetSeconds) - elapsed : target.setTimer,
      elapsedSeconds: timer?.phase === 'WORK' ? elapsed : 0,
      targetSeconds: timer?.targetSeconds ?? target.setTimer,
      preparationSeconds: timer?.readySeconds ?? 0,
      isPaused: Boolean(timer?.manualPaused || activePauseReasons.size),
      isWorkoutPaused: hasWorkoutPause(),
      completedLeftSeconds: timer?.completedLeftSeconds ?? null,
    };
  }

  function restRemaining(timestamp) {
    if (!restInfo) return 0;
    if (restInfo.isPaused) return restInfo.pausedRemaining ?? 0;
    if (hasWorkoutPause() && Number.isFinite(restInfo.nativePausedRemainingMs)) {
      return Math.ceil(restInfo.nativePausedRemainingMs / 1000);
    }
    return Math.ceil((restInfo.endsAt - timestamp) / 1000);
  }

  function writeTimer(timer, timestamp) {
    applyEvent({ type: EVENT_TYPES.TIMED_SET, payload: timer, timestamp });
  }

  function startTimerSide(side, target, timestamp, readySeconds, completedLeftSeconds = null) {
    writeTimer({
      phase: readySeconds > 0 ? 'GET_READY' : 'WORK', side,
      startedAt: timestamp, targetSeconds: target.setTimer, readySeconds,
      completedLeftSeconds, manualPaused: false,
      pausedAt: activePauseReasons.size ? timestamp : null,
    }, timestamp);
  }

  function advanceToNextSet({ keepAdjustments = false, timestamp = null } = {}) {
    const nextIdx = findNextExerciseIndex(currentExerciseIndex);
    if (nextIdx === -1) {
      state = SESSION_STATES.FINISHED;
      if (Number.isFinite(timestamp)) {
        clearPauses(timestamp);
        workoutEndTime = timestamp;
      }
      return;
    }

    currentExerciseIndex = nextIdx;
    const nextSetIdx = progress[nextIdx].completedSets.length;
    // Coming out of rest the targets are already loaded, and reloading them
    // would silently undo whatever was set on the "Prepare" screen.
    if (!keepAdjustments || progress[nextIdx].currentSetIndex !== nextSetIdx) {
      loadSetTargets(nextIdx, nextSetIdx);
    }
    state = SESSION_STATES.ACTIVE_SET;
  }

  for (const event of initialJournal) {
    applyEvent(event);
  }

  /**
   * The upcoming set as the "Prepare" screen needs it: which exercise, which
   * set of it, and the editable weight / reps / RPE. During an active set this
   * is simply the current set, so one screen can render either state.
   */
  function describePendingSet() {
    const idx = pendingIndex();
    const exercise = exercises[idx];
    const prog = progress[idx];
    if (!exercise || !prog) return null;

    const setIdx = state === SESSION_STATES.REST ? prog.completedSets.length : prog.currentSetIndex;
    return {
      exerciseIndex: idx,
      exerciseName: exercise.name,
      exerciseDetails: combineExerciseDetails(exercise),
      exerciseImageUrl: exercise.imageUrl,
      equipment: exercise.equipment ?? null,
      loadingEquipment: exercise.loadingEquipment ?? null,
      supersetGroup: exercise.supersetGroup ?? null,
      supersetContext: describeSuperset(idx, setIdx),
      setIndex: setIdx,
      totalSets: exercise.sets.length,
      setsDots: exercise.sets.map((_, i) =>
        i < prog.completedSets.length ? 'completed' : i === setIdx ? 'active' : 'pending'
      ),
      set: describeSet(exercise, prog, setIdx),
    };
  }

  function isAdjustable() {
    return state === SESSION_STATES.ACTIVE_SET || state === SESSION_STATES.REST;
  }

  function allCompletedSets() {
    return progress
      .flatMap((prog) => prog.completedSets)
      .sort((a, b) => a.completedAt - b.completedAt);
  }

  function describeSet(exercise, prog, setIdx) {
    const target = exercise?.sets[setIdx] || null;
    return {
      entryId: exercise?.entryId ?? null,
      exerciseId: exercise?.exerciseId ?? null,
      hasUpdateScript: Boolean(exercise?.hasUpdateScript),
      promptedVars: exercise?.promptedVars ?? null,
      setId: target?.setId ?? null,
      serverIndex: target?.serverIndex ?? null,
      isWarmup: Boolean(target?.isWarmup),
      warmupIndex: target?.warmupIndex ?? null,
      totalWarmups: target?.totalWarmups ?? 0,
      workSetIndex: target?.workSetIndex ?? null,
      totalWorkSets: target?.totalWorkSets ?? exercise?.workSetsCount ?? 0,
      targetWeightPercent: target?.targetWeightPercent ?? null,
      originalWeight: target?.originalWeight ?? null,
      plates: target?.plates ?? null,
      logRpe: Boolean(target?.logRpe),
      askWeight: Boolean(target?.askWeight),
      isUnilateral: Boolean(target?.isUnilateral),
      setTimer: target?.setTimer ?? null,
      completed: target?.completed ?? null,
      supersetGroup: exercise?.supersetGroup ?? null,
      weight: prog?.currentWeight ?? null,
      reps: prog?.currentReps ?? null,
      rpe: prog?.currentRpe ?? null,
      targetWeight: target?.targetWeight ?? null,
      targetReps: target?.targetReps ?? null,
      targetRepsMax: target?.targetRepsMax ?? null,
      targetRpe: target?.targetRpe ?? null,
      isAmrap: Boolean(target?.isAmrap),
      restSeconds: target?.restSeconds ?? null,
      unit: target?.unit || unit,
    };
  }

  return {
    view(now = Date.now()) {
      const exercise = currentExercise();
      const prog = currentProgress();
      const completed = allCompletedSets();

      const totalVolume = completed.reduce(
        (sum, set) => sum + (set.weight || 0) * (set.reps || 0),
        0
      );

      const effectiveStartTime =
        workoutStartTime ?? (completed.length > 0 ? completed[0].completedAt : null);

      const currentPauseMs =
        pauseStartedAt !== null ? Math.max(0, (workoutEndTime ?? now) - pauseStartedAt) : 0;
      const activeElapsedMs =
        effectiveStartTime === null
          ? 0
          : Math.max(
              0,
              (workoutEndTime ?? now) - effectiveStartTime - totalPausedWorkoutDurationMs - currentPauseMs
            );
      const elapsedSeconds = Math.floor(activeElapsedMs / 1000);

      let rest = null;
      if (restInfo) {
        const pending = describePendingSet();
        const pendingSet = pending?.set || null;
        const workoutPaused = hasWorkoutPause();
        const remaining = restRemaining(now);
        rest = {
          duration: restInfo.duration,
          remaining,
          isPaused: Boolean(restInfo.isPaused || workoutPaused),
          isWorkoutPaused: workoutPaused,
          pausedRemaining: restInfo.pausedRemaining ?? null,
          isOvertime: !restInfo.isPaused && remaining <= 0,
          startedAt: restInfo.startedAt,
          endsAt: restInfo.endsAt,
          isTransitionToNextExercise:
            pending ? pending.exerciseIndex !== currentExerciseIndex : false,
          nextExerciseName: pending?.exerciseName ?? null,
          nextExerciseDetails: pending?.exerciseDetails ?? null,
          nextExerciseImageUrl: pending?.exerciseImageUrl ?? null,
          nextEquipment: pending?.equipment ?? null,
          nextSetIndex: pending?.setIndex ?? null,
          nextTotalSets: pending?.totalSets ?? null,
          nextIsWarmup: Boolean(pendingSet?.isWarmup),
          nextWarmupIndex: pendingSet?.warmupIndex ?? null,
          nextTotalWarmups: pendingSet?.totalWarmups ?? 0,
          nextWorkSetIndex: pendingSet?.workSetIndex ?? null,
          nextTotalWorkSets: pendingSet?.totalWorkSets ?? 0,
          nextTargetWeight: pendingSet?.weight ?? null,
          nextTargetReps: pendingSet?.reps ?? null,
          nextTargetRepsMax: pendingSet?.targetRepsMax ?? null,
          nextTargetRpe: pendingSet?.targetRpe ?? null,
          nextIsAmrap: Boolean(pendingSet?.isAmrap),
          nextLogRpe: Boolean(pendingSet?.logRpe),
          nextTargetWeightPercent: pendingSet?.targetWeightPercent ?? null,
          nextPlates: pendingSet?.plates ?? null,
          nextUnit: pendingSet?.unit ?? unit,
          nextSupersetGroup: pending?.supersetGroup ?? null,
          nextSupersetContext: pending?.supersetContext ?? null,
        };
      }

      const overviewExercises = exercises.map((ex, idx) => {
        const p = progress[idx];
        return {
          index: idx,
          id: ex.id,
          entryId: ex.entryId ?? null,
          exerciseId: ex.exerciseId ?? null,
          name: ex.name,
          imageUrl: ex.imageUrl ?? null,
          supersetGroup: ex.supersetGroup,
          warmupSetsCount: ex.warmupSetsCount,
          workSetsCount: ex.workSetsCount,
          totalSets: ex.sets.length,
          completedSetsCount: p.completedSets.length,
          setsDots: ex.sets.map((_, setIdx) => {
            if (setIdx < p.completedSets.length) return 'completed';
            if (idx === currentExerciseIndex && setIdx === p.currentSetIndex && state === SESSION_STATES.ACTIVE_SET) {
              return 'active';
            }
            return 'pending';
          }),
          prescriptionSummary: summarizeSets(ex, unit),
        };
      });

      const base = {
        timedSet: timedView(now),
        state,
        unit,
        programId: plan?.programId ?? null,
        programName: plan?.programName ?? null,
        dayName: plan?.dayName ?? null,
        week: plan?.week ?? null,
        dayInWeek: plan?.dayInWeek ?? null,
        programVersion: plan?.programVersion ?? null,
        elapsedSeconds,
        startedAt: effectiveStartTime,
        endedAt: workoutEndTime,
        isWorkoutPaused: hasWorkoutPause(),
        isManualWorkoutPaused: activePauseReasons.has('manual-workout'),
        isNativeWorkoutPaused: activePauseReasons.has('native-workout'),
        totalVolume,
        totalCompletedSetsCount: completed.length,
        totalExercises: exercises.length,
        overviewExercises,
        allCompletedSets: completed,
      };

      if (!exercise || !prog) {
        return {
          ...base,
          currentExerciseIndex: 0,
          exerciseId: null,
          entryId: null,
          exerciseName: null,
          supersetGroup: null,
          supersetContext: null,
          totalSets: 0,
          currentSetIndex: 0,
          exerciseSetsDots: [],
          currentSet: null,
          completedSets: [],
          rest: null,
        };
      }

      return {
        ...base,
        currentExerciseIndex,
        exerciseId: exercise.exerciseId || exercise.id,
        entryId: exercise.entryId ?? exercise.id,
        exerciseName: exercise.name,
        exerciseDetails: combineExerciseDetails(exercise),
        exerciseImageUrl: exercise.imageUrl,
        loadingEquipment: exercise.loadingEquipment ?? null,
        supersetGroup: exercise.supersetGroup,
        supersetContext: describeSuperset(currentExerciseIndex, prog.currentSetIndex),
        totalSets: exercise.sets.length,
        currentSetIndex: prog.currentSetIndex,
        exerciseSetsDots: exercise.sets.map((_, setIdx) => {
          if (setIdx < prog.completedSets.length) return 'completed';
          if (setIdx === prog.currentSetIndex && state === SESSION_STATES.ACTIVE_SET) return 'active';
          return 'pending';
        }),
        currentSet: describeSet(exercise, prog, prog.currentSetIndex),
        completedSets: [...prog.completedSets],
        pending: describePendingSet(),
        rest,
      };
    },

    startWorkout({ timestamp = Date.now() } = {}) {
      if (state !== SESSION_STATES.READY) return;
      applyEvent({ type: EVENT_TYPES.START_WORKOUT, timestamp });
    },

    startTimedSet({ timestamp = Date.now(), getReadySeconds = 5 } = {}) {
      if (activePauseReasons.size || activeTimer?.manualPaused) return;
      if (activeTimer) {
        if (activeTimer.phase === 'GET_READY') {
          writeTimer({ ...activeTimer, phase: 'WORK', startedAt: timestamp }, timestamp);
        }
        return;
      }
      if (!timedView(timestamp)) return;
      let readySeconds = Math.max(0, Number.isFinite(getReadySeconds) ? getReadySeconds : 5);
      const target = describePendingSet()?.set;
      if (!target?.setTimer) return;
      const hadRest = Boolean(restInfo);
      if (restInfo) {
        const remaining = Math.max(0, restRemaining(timestamp));
        readySeconds = Math.min(readySeconds, remaining);
        if (remaining > readySeconds) {
          startTimerSide(target.isUnilateral ? 'LEFT' : null, target, timestamp, readySeconds);
          writeTimer({ ...activeTimer, phase: 'REST' }, timestamp);
          return;
        }
        applyEvent({ type: EVENT_TYPES.NEXT_SET, timestamp });
      }
      // Existing rest belongs to the previous set; the next set's rest cannot shorten it.
      if (!hadRest && target.restSeconds === 0) readySeconds = 0;
      startTimerSide(target.isUnilateral ? 'LEFT' : null, target, timestamp, readySeconds);
    },

    advanceTimedSet({ timestamp = Date.now() } = {}) {
      const timer = timedView(timestamp);
      if (timer?.phase === 'REST') {
        if (timer.isPaused || timer.remaining > timer.preparationSeconds) return false;
        const remaining = Math.max(0, timer.remaining);
        applyEvent({ type: EVENT_TYPES.NEXT_SET, timestamp });
        writeTimer({ ...activeTimer, phase: remaining > 0 ? 'GET_READY' : 'WORK',
          startedAt: timestamp, readySeconds: remaining }, timestamp);
        return true;
      }
      if (timer?.phase !== 'GET_READY' || timer.isPaused || timer.remaining > 0) return false;
      // A sleeping watch cannot assume the lifter began exercising at the old deadline.
      writeTimer({ ...activeTimer, phase: 'WORK', startedAt: timestamp }, timestamp);
      return true;
    },

    pauseTimedSet({ timestamp = Date.now() } = {}) {
      if (!activeTimer || activeTimer.manualPaused) return;
      writeTimer({ ...activeTimer, manualPaused: true, pausedAt: activeTimer.pausedAt ?? timestamp }, timestamp);
    },

    resumeTimedSet({ timestamp = Date.now() } = {}) {
      if (!activeTimer?.manualPaused) return;
      const timer = { ...activeTimer, manualPaused: false };
      if (!activePauseReasons.size) {
        timer.startedAt += Math.max(0, timestamp - timer.pausedAt);
        timer.pausedAt = null;
      }
      writeTimer(timer, timestamp);
    },

    stopTimedSide({ timestamp = Date.now(), getReadySeconds = 5 } = {}) {
      const timer = timedView(timestamp);
      if (timer?.phase !== 'WORK' || timer.isWorkoutPaused) return;
      // Repeated native clicks must not complete a side that has only just started.
      if (timer.elapsedSeconds === 0) return;
      const target = describePendingSet()?.set;
      if (timer.side === 'LEFT') {
        const ready = target.restSeconds === 0 ? 0 : Math.max(0, getReadySeconds);
        startTimerSide('RIGHT', target, timestamp, ready, timer.elapsedSeconds);
        return;
      }
      const prog = currentProgress();
      const exercise = currentExercise();
      applyEvent({ type: EVENT_TYPES.COMPLETE_SET, timestamp, payload: {
        exerciseIndex: exercise.index, setIndex: prog.currentSetIndex + 1,
        entryId: exercise.entryId, setId: target.setId,
        weight: prog.currentWeight, reps: prog.currentReps, rpe: prog.currentRpe,
        setTimer: timer.elapsedSeconds, setTimerLeft: timer.completedLeftSeconds,
        unit: target.unit || unit,
      } });
    },

    selectExercise(exerciseIndex, { timestamp = Date.now() } = {}) {
      if (!canSelectExercise(exerciseIndex)) return;
      applyEvent({ type: EVENT_TYPES.SELECT_EXERCISE, payload: { exerciseIndex }, timestamp });
    },

    // Adjusting is allowed during rest too: that is what the "Prepare" screen is
    // for, and the change lands on the set about to be performed.
    adjustWeight(steps = 1, { timestamp = Date.now() } = {}) {
      if (!isAdjustable()) return;
      applyEvent({ type: EVENT_TYPES.ADJUST_WEIGHT, payload: { delta: steps * step }, timestamp });
    },

    adjustReps(delta, { timestamp = Date.now() } = {}) {
      if (!isAdjustable()) return;
      applyEvent({ type: EVENT_TYPES.ADJUST_REPS, payload: { delta }, timestamp });
    },

    adjustRpe(delta, { timestamp = Date.now() } = {}) {
      if (!isAdjustable()) return;
      applyEvent({ type: EVENT_TYPES.ADJUST_RPE, payload: { delta }, timestamp });
    },

    completeSet({
      timestamp = Date.now(),
      repsLeft = null,
      setTimer = null,
      setTimerLeft = null,
      userVars = null,
    } = {}) {
      if (state !== SESSION_STATES.ACTIVE_SET) return;
      const exercise = currentExercise();
      const prog = currentProgress();
      const setIndex = prog ? prog.currentSetIndex : 0;
      const target = exercise?.sets[setIndex] || null;
      if (!exercise || !prog || !target || prog.completedSets.length >= exercise.sets.length) return;
      if (activeTimer) return;

      const payload = {
        exerciseIndex: exercise?.index ?? currentExerciseIndex + 1,
        setIndex: setIndex + 1,
        entryId: exercise?.entryId ?? null,
        setId: target?.setId ?? null,
        weight: prog?.currentWeight ?? null,
        reps: prog?.currentReps ?? null,
        rpe: prog?.currentRpe ?? null,
        repsLeft,
        setTimer,
        ...(setTimerLeft !== null ? { setTimerLeft } : {}),
        userVars,
        unit: target?.unit || unit,
      };

      applyEvent({ type: EVENT_TYPES.COMPLETE_SET, payload, timestamp });
    },

    skipWarmup({ timestamp = Date.now() } = {}) {
      if (state !== SESSION_STATES.ACTIVE_SET && state !== SESSION_STATES.REST) return false;
      if (activeTimer) return false;
      const pending = describePendingSet();
      if (!pending?.set?.isWarmup) return false;
      const exercise = exercises[pending.exerciseIndex];
      applyEvent({
        type: EVENT_TYPES.SKIP_WARMUP,
        timestamp,
        payload: {
          exerciseIndex: exercise.index,
          setIndex: pending.setIndex + 1,
          entryId: exercise.entryId,
          setId: pending.set.setId,
        },
      });
      return true;
    },

    pauseRest({ timestamp = Date.now() } = {}) {
      if (state !== SESSION_STATES.REST) return;
      applyEvent({ type: EVENT_TYPES.PAUSE_REST, timestamp });
    },

    resumeRest({ timestamp = Date.now() } = {}) {
      if (state !== SESSION_STATES.REST) return;
      applyEvent({ type: EVENT_TYPES.RESUME_REST, timestamp });
    },

    pauseWorkout({ timestamp = Date.now(), source = 'manual' } = {}) {
      if (state !== SESSION_STATES.ACTIVE_SET && state !== SESSION_STATES.REST) return;
      const reason = source === 'native' ? 'native-workout' : 'manual-workout';
      if (activePauseReasons.has(reason)) return;
      applyEvent({ type: EVENT_TYPES.PAUSE_WORKOUT, payload: { source }, timestamp });
    },

    resumeWorkout({ timestamp = Date.now(), source = 'manual' } = {}) {
      const reason = source === 'native' ? 'native-workout' : 'manual-workout';
      if (!activePauseReasons.has(reason)) return;
      applyEvent({ type: EVENT_TYPES.RESUME_WORKOUT, payload: { source }, timestamp });
    },

    toggleRestPause({ timestamp = Date.now() } = {}) {
      if (state !== SESSION_STATES.REST || !restInfo) return;
      if (restInfo.isPaused) {
        applyEvent({ type: EVENT_TYPES.RESUME_REST, timestamp });
      } else {
        applyEvent({ type: EVENT_TYPES.PAUSE_REST, timestamp });
      }
    },

    adjustRest(deltaSeconds, { timestamp = Date.now() } = {}) {
      if (state !== SESSION_STATES.REST) return;
      applyEvent({ type: EVENT_TYPES.ADJUST_REST, payload: { delta: deltaSeconds }, timestamp });
    },

    nextSet({ timestamp = Date.now() } = {}) {
      if (state !== SESSION_STATES.REST) return;
      applyEvent({ type: EVENT_TYPES.NEXT_SET, timestamp });
    },

    finishWorkout({ timestamp = Date.now() } = {}) {
      if (activeTimer) return;
      if (state === SESSION_STATES.FINISHED || state === SESSION_STATES.NO_PLAN) return;
      applyEvent({ type: EVENT_TYPES.FINISH_WORKOUT, timestamp });
    },

    cancelWorkout({ timestamp = Date.now() } = {}) {
      applyEvent({ type: EVENT_TYPES.CANCEL_WORKOUT, timestamp });
    },

    /** The payload `POST /playground` replays, in the order the user did it. */
    getCompletedSets() {
      return allCompletedSets()
        .filter((set) => !set.isWarmup)
        .map((set) => ({
          exerciseIndex: set.exerciseIndex,
          setIndex: set.workSetIndex || set.setIndex,
          weight: set.weight,
          reps: set.reps,
          rpe: set.rpe,
          unit: set.unit,
        }));
    },

    /** Exact API payload writes for completed sets in completion order. */
    getWorkoutSetWrites() {
      return allCompletedSets()
        .map(formatSetWrite)
        .filter(Boolean);
    },

    /** The newest API set write payload, or null if none exist. */
    getLastWorkoutSetWrite() {
      const writes = allCompletedSets()
        .map(formatSetWrite)
        .filter(Boolean);
      return writes.length > 0 ? writes[writes.length - 1] : null;
    },

    getWorkoutIntervals(endTime = workoutEndTime) {
      const result = intervals.map((interval) => [...interval]);
      if (intervalStart !== null && Number.isFinite(endTime) && endTime >= intervalStart) {
        result.push([intervalStart, endTime]);
      }
      return result;
    },

    isAllCompleted: allSetsDone,
    getJournal: () => [...journal],
  };
}

function formatSetWrite(set) {
  if (!set || !set.setId) return null;

  const completed = {};
  if (set.reps !== null && set.reps !== undefined) {
    completed.reps = set.reps;
  }
  if (set.repsLeft !== null && set.repsLeft !== undefined) {
    completed.repsLeft = set.repsLeft;
  }
  if (set.weight !== null && set.weight !== undefined) {
    if (typeof set.weight === 'number' && set.unit) {
      const rounded = Math.round(set.weight * 100000) / 100000;
      completed.weight = `${rounded}${set.unit}`;
    } else {
      if (typeof set.weight === 'string') completed.weight = set.weight;
    }
  }
  if (set.rpe !== null && set.rpe !== undefined) {
    completed.rpe = set.rpe;
  }
  if (set.setTimer !== null && set.setTimer !== undefined) {
    completed.setTimer = set.setTimer;
  }
  if (set.setTimerLeft !== null && set.setTimerLeft !== undefined) {
    completed.setTimerLeft = set.setTimerLeft;
  }
  if (set.userVars !== null && set.userVars !== undefined) {
    completed.userVars = set.userVars;
  }

  return {
    ...(set.entryId ? { entryId: set.entryId } : {}),
    setId: set.setId,
    completed,
  };
}

function summarizeSets(ex, unit) {
  const workSets = (ex.sets || []).filter((s) => !s.isWarmup);
  if (workSets.length === 0) return '';
  const first = workSets[0];
  const reps = first.targetRepsMax ? `${first.targetReps}-${first.targetRepsMax}` : first.targetReps;
  const weight = first.targetWeight === null ? '-' : `${first.targetWeight}${first.unit || unit}`;
  const workStr = `${workSets.length} × ${reps} · ${weight}`;
  if (ex.warmupSetsCount > 0) {
    return `${ex.warmupSetsCount}W + ${workStr}`;
  }
  return workStr;
}
