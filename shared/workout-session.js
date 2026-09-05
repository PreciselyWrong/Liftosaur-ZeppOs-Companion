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
  NEXT_SET: 'NEXT_SET',
  PAUSE_REST: 'PAUSE_REST',
  RESUME_REST: 'RESUME_REST',
  PAUSE_WORKOUT: 'PAUSE_WORKOUT',
  RESUME_WORKOUT: 'RESUME_WORKOUT',
  ADJUST_REST: 'ADJUST_REST',
  SELECT_EXERCISE: 'SELECT_EXERCISE',
  FINISH_WORKOUT: 'FINISH_WORKOUT',
  CANCEL_WORKOUT: 'CANCEL_WORKOUT',
};

export function weightStepFor(unit) {
  return unit === 'lb' ? 5 : 2.5;
}

function combineExerciseDetails(description, notes) {
  const descriptionText = typeof description === 'string' ? description.trim() : '';
  const notesText = typeof notes === 'string' ? notes.trim() : '';

  if (!descriptionText) return notesText || null;
  if (!notesText) return descriptionText;
  if (descriptionText === notesText || notesText.includes(descriptionText)) return notesText;
  if (descriptionText.includes(notesText)) return descriptionText;
  return `${notesText}\n\n${descriptionText}`;
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
      description: exercise.description || null,
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
  let restInfo = null;
  let journal = [];

  const progress = exercises.map((exercise) => ({
    currentSetIndex: 0,
    currentWeight: exercise.sets[0]?.targetWeight ?? null,
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
          userVars: completed.userVars ?? null,
          unit: completed.unit || target.unit || unit,
          completedAt: completionOrder++,
        });
      }
      const nextSetIdx = prog.completedSets.length;
      prog.currentSetIndex = nextSetIdx;
      if (nextSetIdx < exercise.sets.length) {
        const next = exercise.sets[nextSetIdx];
        prog.currentWeight = next.targetWeight;
        prog.currentReps = next.targetReps;
        prog.currentRpe = next.targetRpe;
      }
    }

    workoutStartTime = Number.isFinite(plan.startTime) ? plan.startTime : null;
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
      prog.currentWeight = target.targetWeight;
      prog.currentReps = target.targetReps;
      prog.currentRpe = target.targetRpe;
    }
  }

  function allSetsDone() {
    return exercises.every((exercise, i) => progress[i].completedSets.length >= exercise.sets.length);
  }

  function firstUnfinishedExercise(from = 0) {
    for (let i = from; i < exercises.length; i++) {
      if (progress[i].completedSets.length < exercises[i].sets.length) return i;
    }
    for (let i = 0; i < from; i++) {
      if (progress[i].completedSets.length < exercises[i].sets.length) return i;
    }
    return -1;
  }

  function findNextExerciseIndex(currentIdx) {
    const curEx = exercises[currentIdx];
    const curProg = progress[currentIdx];

    // If current exercise still has warmups to do, finish warmups first
    if (curEx && curProg && curProg.completedSets.length < curEx.sets.length) {
      const isWarmup = curProg.completedSets.length < curEx.warmupSetsCount;
      if (isWarmup) return currentIdx;
    }

    // If current exercise is in a superset group:
    if (curEx && curEx.supersetGroup) {
      const group = curEx.supersetGroup;
      const groupIndices = [];
      for (let i = 0; i < exercises.length; i++) {
        if (exercises[i].supersetGroup === group) groupIndices.push(i);
      }

      const curWorkSets = Math.max(0, curProg.completedSets.length - curEx.warmupSetsCount);

      // If current exercise just finished warmups and has not completed Work Set 1 yet
      if (curProg && curProg.completedSets.length < curEx.sets.length && curWorkSets === 0) {
        return currentIdx;
      }

      // 1. Look for any partner in group with FEWER completed work sets than current
      for (let offset = 1; offset <= groupIndices.length; offset++) {
        const idx = groupIndices[(groupIndices.indexOf(currentIdx) + offset) % groupIndices.length];
        const p = progress[idx];
        const ex = exercises[idx];
        const pWorkSets = Math.max(0, p.completedSets.length - ex.warmupSetsCount);
        if (p.completedSets.length < ex.sets.length && pWorkSets < curWorkSets) {
          return idx;
        }
      }

      // 2. If all partners have reached this level, start next round at the first unfinished in group
      for (const idx of groupIndices) {
        const p = progress[idx];
        const ex = exercises[idx];
        if (p.completedSets.length < ex.sets.length) {
          return idx;
        }
      }
    }

    // If not in a superset, or superset is completely done:
    if (curProg && curProg.completedSets.length < curEx.sets.length) {
      return currentIdx;
    }

    return firstUnfinishedExercise(currentIdx + 1);
  }

  function applyEvent(event) {
    journal.push(event);

    switch (event.type) {
      case EVENT_TYPES.START_WORKOUT: {
        state = SESSION_STATES.ACTIVE_SET;
        workoutStartTime = event.timestamp;
        loadSetTargets(currentExerciseIndex, 0);
        break;
      }

      case EVENT_TYPES.SELECT_EXERCISE: {
        const target = event.payload.exerciseIndex;
        if (target >= 0 && target < exercises.length) {
          currentExerciseIndex = target;
          const prog = currentProgress();
          loadSetTargets(target, prog.completedSets.length);
          if (prog.completedSets.length < exercises[target].sets.length) {
            state = SESSION_STATES.ACTIVE_SET;
            restInfo = null;
            endPause('rest', event.timestamp);
          }
        }
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

        if (workoutStartTime === null) {
          workoutStartTime = event.timestamp;
        }

        const setIndex = prog.currentSetIndex;
        const target = exercise.sets[setIndex];

        const payload = event.payload;
        const completedWeight = payload?.weight !== undefined ? payload.weight : prog.currentWeight;
        const completedReps = payload?.reps !== undefined ? payload.reps : prog.currentReps;
        const completedRpe = payload?.rpe !== undefined ? payload.rpe : prog.currentRpe;
        const entryId = payload?.entryId !== undefined ? payload.entryId : (exercise.entryId ?? null);
        const setId = payload?.setId !== undefined ? payload.setId : (target?.setId ?? null);
        const repsLeft = payload?.repsLeft !== undefined ? payload.repsLeft : null;
        const setTimer = payload?.setTimer !== undefined ? payload.setTimer : null;
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
          userVars,
          unit: setUnit,
          completedAt: event.timestamp,
        });

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
            nativePausedRemainingMs: activePauseReasons.has('workout')
              ? restDuration * 1000
              : null,
          };
        } else {
          restInfo = null;
          advanceToNextSet({ timestamp: event.timestamp });
        }
        break;
      }

      case EVENT_TYPES.PAUSE_REST: {
        if (state === SESSION_STATES.REST && restInfo && !restInfo.isPaused) {
          const remainingMs = activePauseReasons.has('workout')
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
          if (activePauseReasons.has('workout')) {
            restInfo.nativePausedRemainingMs = remaining * 1000;
          }
          endPause('rest', event.timestamp);
        }
        break;
      }

      case EVENT_TYPES.PAUSE_WORKOUT: {
        if (
          (state === SESSION_STATES.ACTIVE_SET || state === SESSION_STATES.REST) &&
          !activePauseReasons.has('workout')
        ) {
          if (restInfo && !restInfo.isPaused) {
            restInfo.nativePausedRemainingMs = restInfo.endsAt - event.timestamp;
          }
          beginPause('workout', event.timestamp);
        }
        break;
      }

      case EVENT_TYPES.RESUME_WORKOUT: {
        if (activePauseReasons.has('workout')) {
          if (restInfo && !restInfo.isPaused && Number.isFinite(restInfo.nativePausedRemainingMs)) {
            restInfo.endsAt = event.timestamp + restInfo.nativePausedRemainingMs;
          }
          if (restInfo) restInfo.nativePausedRemainingMs = null;
          endPause('workout', event.timestamp);
        }
        break;
      }

      case EVENT_TYPES.ADJUST_REST: {
        if (state === SESSION_STATES.REST && restInfo) {
          const delta = event.payload?.delta || 0;
          if (restInfo.isPaused) {
            restInfo.pausedRemaining = Math.max(0, (restInfo.pausedRemaining ?? 0) + delta);
          } else if (activePauseReasons.has('workout')) {
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
        workoutEndTime = event.timestamp;
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
        currentExerciseIndex = 0;
        progress.forEach((prog, i) => {
          prog.completedSets = [];
          prog.currentSetIndex = 0;
          prog.currentWeight = exercises[i].sets[0]?.targetWeight ?? null;
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
    if (activePauseReasons.size === 0) pauseStartedAt = timestamp;
    activePauseReasons.add(reason);
  }

  function endPause(reason, timestamp) {
    if (!activePauseReasons.delete(reason)) return;
    if (activePauseReasons.size === 0 && pauseStartedAt !== null) {
      totalPausedWorkoutDurationMs += Math.max(0, timestamp - pauseStartedAt);
      pauseStartedAt = null;
    }
  }

  function clearPauses(timestamp) {
    if (pauseStartedAt !== null) {
      totalPausedWorkoutDurationMs += Math.max(0, timestamp - pauseStartedAt);
    }
    pauseStartedAt = null;
    activePauseReasons.clear();
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
      exerciseDetails: combineExerciseDetails(exercise.description, exercise.notes),
      equipment: exercise.equipment ?? null,
      loadingEquipment: exercise.loadingEquipment ?? null,
      supersetGroup: exercise.supersetGroup ?? null,
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
        const nativePaused = activePauseReasons.has('workout');
        const remaining = restInfo.isPaused
          ? (restInfo.pausedRemaining ?? 0)
          : nativePaused && Number.isFinite(restInfo.nativePausedRemainingMs)
            ? Math.ceil(restInfo.nativePausedRemainingMs / 1000)
            : Math.ceil((restInfo.endsAt - now) / 1000);
        rest = {
          duration: restInfo.duration,
          remaining,
          isPaused: Boolean(restInfo.isPaused || nativePaused),
          isWorkoutPaused: nativePaused,
          pausedRemaining: restInfo.pausedRemaining ?? null,
          isOvertime: !restInfo.isPaused && remaining <= 0,
          startedAt: restInfo.startedAt,
          endsAt: restInfo.endsAt,
          isTransitionToNextExercise:
            pending ? pending.exerciseIndex !== currentExerciseIndex : false,
          nextExerciseName: pending?.exerciseName ?? null,
          nextExerciseDetails: pending?.exerciseDetails ?? null,
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
        exerciseDetails: combineExerciseDetails(exercise.description, exercise.notes),
        loadingEquipment: exercise.loadingEquipment ?? null,
        supersetGroup: exercise.supersetGroup,
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

    selectExercise(exerciseIndex, { timestamp = Date.now() } = {}) {
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
      userVars = null,
    } = {}) {
      if (state !== SESSION_STATES.ACTIVE_SET) return;
      const exercise = currentExercise();
      const prog = currentProgress();
      const setIndex = prog ? prog.currentSetIndex : 0;
      const target = exercise?.sets[setIndex] || null;

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
        userVars,
        unit: target?.unit || unit,
      };

      applyEvent({ type: EVENT_TYPES.COMPLETE_SET, payload, timestamp });
    },

    pauseRest({ timestamp = Date.now() } = {}) {
      if (state !== SESSION_STATES.REST) return;
      applyEvent({ type: EVENT_TYPES.PAUSE_REST, timestamp });
    },

    resumeRest({ timestamp = Date.now() } = {}) {
      if (state !== SESSION_STATES.REST) return;
      applyEvent({ type: EVENT_TYPES.RESUME_REST, timestamp });
    },

    pauseWorkout({ timestamp = Date.now() } = {}) {
      if (state !== SESSION_STATES.ACTIVE_SET && state !== SESSION_STATES.REST) return;
      if (activePauseReasons.has('workout')) return;
      applyEvent({ type: EVENT_TYPES.PAUSE_WORKOUT, timestamp });
    },

    resumeWorkout({ timestamp = Date.now() } = {}) {
      if (!activePauseReasons.has('workout')) return;
      applyEvent({ type: EVENT_TYPES.RESUME_WORKOUT, timestamp });
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
      const intervals = [];
      let intervalStart = workoutStartTime;
      const pauseReasons = new Set();

      for (const event of journal) {
        if (event.type === EVENT_TYPES.START_WORKOUT) {
          intervalStart = event.timestamp;
          pauseReasons.clear();
        } else if (event.type === EVENT_TYPES.PAUSE_REST || event.type === EVENT_TYPES.PAUSE_WORKOUT) {
          const reason = event.type === EVENT_TYPES.PAUSE_REST ? 'rest' : 'workout';
          if (!pauseReasons.has(reason) && pauseReasons.size === 0 && intervalStart !== null) {
            intervals.push([intervalStart, event.timestamp]);
            intervalStart = null;
          }
          pauseReasons.add(reason);
        } else if (event.type === EVENT_TYPES.RESUME_REST || event.type === EVENT_TYPES.NEXT_SET) {
          pauseReasons.delete('rest');
          if (pauseReasons.size === 0 && intervalStart === null) intervalStart = event.timestamp;
        } else if (event.type === EVENT_TYPES.RESUME_WORKOUT) {
          pauseReasons.delete('workout');
          if (pauseReasons.size === 0 && intervalStart === null) intervalStart = event.timestamp;
        }
      }

      if (intervalStart !== null && Number.isFinite(endTime)) {
        intervals.push([intervalStart, endTime]);
      }
      return intervals;
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
