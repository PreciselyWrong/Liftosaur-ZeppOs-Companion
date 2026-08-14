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
  SELECT_EXERCISE: 'SELECT_EXERCISE',
  FINISH_WORKOUT: 'FINISH_WORKOUT',
  CANCEL_WORKOUT: 'CANCEL_WORKOUT',
};

export function weightStepFor(unit) {
  return unit === 'lb' ? 5 : 2.5;
}

export function createWorkoutSession({ plan = null, initialJournal = [] } = {}) {
  const unit = plan?.unit || 'kg';
  const step = weightStepFor(unit);

  const exercises = (plan?.exercises || []).map((exercise, index) => {
    const warmups = exercise.warmupSets || [];
    const workSets = exercise.sets || [];
    const sets = [];

    warmups.forEach((w, wIdx) => {
      sets.push({
        index: sets.length + 1,
        isWarmup: true,
        warmupIndex: wIdx + 1,
        totalWarmups: warmups.length,
        workSetIndex: null,
        totalWorkSets: workSets.length,
        targetReps: w.targetReps ?? null,
        targetRepsMax: w.targetRepsMax ?? null,
        targetWeight: w.targetWeight ?? null,
        targetWeightPercent: w.targetWeightPercent ?? null,
        targetRpe: w.targetRpe ?? null,
        restSeconds: Number.isFinite(w.restSeconds) ? w.restSeconds : null,
        isAmrap: Boolean(w.isAmrap),
        askWeight: Boolean(w.askWeight),
        unit: w.unit || unit,
      });
    });

    workSets.forEach((s, sIdx) => {
      sets.push({
        index: sets.length + 1,
        isWarmup: false,
        warmupIndex: null,
        totalWarmups: warmups.length,
        workSetIndex: s.index ?? sIdx + 1,
        totalWorkSets: workSets.length,
        targetReps: s.targetReps ?? null,
        targetRepsMax: s.targetRepsMax ?? null,
        targetWeight: s.targetWeight ?? null,
        targetWeightPercent: null,
        targetRpe: s.targetRpe ?? null,
        restSeconds: Number.isFinite(s.restSeconds) ? s.restSeconds : null,
        isAmrap: Boolean(s.isAmrap),
        askWeight: Boolean(s.askWeight),
        unit: s.unit || unit,
      });
    });

    return {
      index: exercise.index ?? index + 1,
      id: exercise.id || `ex-${index + 1}`,
      name: exercise.name || `Exercise ${index + 1}`,
      equipment: exercise.equipment || null,
      supersetGroup: exercise.supersetGroup || exercise.supersetTag || null,
      warmupSetsCount: warmups.length,
      workSetsCount: workSets.length,
      sets,
    };
  });

  let state = exercises.length === 0 ? SESSION_STATES.NO_PLAN : SESSION_STATES.READY;
  let currentExerciseIndex = 0;
  let workoutStartTime = null;
  let workoutEndTime = null;
  let restInfo = null;
  let journal = [];

  const progress = exercises.map((exercise) => ({
    currentSetIndex: 0,
    currentWeight: exercise.sets[0]?.targetWeight ?? null,
    currentReps: exercise.sets[0]?.targetReps ?? null,
    currentRpe: exercise.sets[0]?.targetRpe ?? null,
    completedSets: [],
  }));

  function currentExercise() {
    return exercises[currentExerciseIndex] || null;
  }

  function currentProgress() {
    return progress[currentExerciseIndex] || null;
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
          }
        }
        break;
      }

      case EVENT_TYPES.ADJUST_WEIGHT: {
        const prog = currentProgress();
        if (!prog) break;
        const base = prog.currentWeight ?? 0;
        prog.currentWeight = Math.max(0, Math.round((base + event.payload.delta) * 100) / 100);
        break;
      }

      case EVENT_TYPES.ADJUST_REPS: {
        const prog = currentProgress();
        if (!prog) break;
        prog.currentReps = Math.max(0, (prog.currentReps ?? 0) + event.payload.delta);
        break;
      }

      case EVENT_TYPES.ADJUST_RPE: {
        const prog = currentProgress();
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

        prog.completedSets.push({
          exerciseIndex: exercise.index,
          exerciseArrayIndex: currentExerciseIndex,
          exerciseName: exercise.name,
          setIndex: setIndex + 1,
          isWarmup: Boolean(target?.isWarmup),
          workSetIndex: target?.workSetIndex ?? null,
          warmupIndex: target?.warmupIndex ?? null,
          weight: prog.currentWeight,
          reps: prog.currentReps,
          rpe: prog.currentRpe,
          unit,
          completedAt: event.timestamp,
        });

        if (allSetsDone()) {
          state = SESSION_STATES.FINISHED;
          restInfo = null;
          break;
        }

        const restDuration = target?.restSeconds ?? null;
        const next = describeNextSet();

        if (restDuration && restDuration > 0) {
          state = SESSION_STATES.REST;
          restInfo = {
            startedAt: event.timestamp,
            duration: restDuration,
            endsAt: event.timestamp + restDuration * 1000,
            ...next,
          };
        } else {
          restInfo = null;
          advanceToNextSet();
        }
        break;
      }

      case EVENT_TYPES.NEXT_SET: {
        restInfo = null;
        advanceToNextSet();
        break;
      }

      case EVENT_TYPES.FINISH_WORKOUT: {
        state = SESSION_STATES.FINISHED;
        workoutEndTime = event.timestamp;
        restInfo = null;
        break;
      }

      case EVENT_TYPES.CANCEL_WORKOUT: {
        state = exercises.length === 0 ? SESSION_STATES.NO_PLAN : SESSION_STATES.READY;
        workoutStartTime = null;
        workoutEndTime = null;
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

  function describeNextSet() {
    const nextIdx = findNextExerciseIndex(currentExerciseIndex);
    if (nextIdx === -1) {
      return {
        isTransitionToNextExercise: false,
        nextExerciseName: null,
        nextSetIndex: null,
        nextTotalSets: null,
        nextIsWarmup: false,
        nextSupersetGroup: null,
      };
    }

    const nextEx = exercises[nextIdx];
    const nextProg = progress[nextIdx];
    const nextSetIdx = nextProg.completedSets.length;
    const nextTarget = nextEx.sets[nextSetIdx];

    return {
      isTransitionToNextExercise: nextIdx !== currentExerciseIndex,
      nextExerciseName: nextEx.name,
      nextSetIndex: nextSetIdx,
      nextTotalSets: nextEx.sets.length,
      nextIsWarmup: Boolean(nextTarget?.isWarmup),
      nextSupersetGroup: nextEx.supersetGroup ?? null,
    };
  }

  function advanceToNextSet() {
    const nextIdx = findNextExerciseIndex(currentExerciseIndex);
    if (nextIdx === -1) {
      state = SESSION_STATES.FINISHED;
      return;
    }

    currentExerciseIndex = nextIdx;
    loadSetTargets(nextIdx, progress[nextIdx].completedSets.length);
    state = SESSION_STATES.ACTIVE_SET;
  }

  for (const event of initialJournal) {
    applyEvent(event);
  }

  function allCompletedSets() {
    return progress
      .flatMap((prog) => prog.completedSets)
      .sort((a, b) => a.completedAt - b.completedAt);
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

      const elapsedSeconds =
        workoutStartTime === null
          ? 0
          : Math.max(0, Math.floor(((workoutEndTime ?? now) - workoutStartTime) / 1000));

      let rest = null;
      if (restInfo) {
        const remaining = Math.ceil((restInfo.endsAt - now) / 1000);
        rest = {
          duration: restInfo.duration,
          remaining,
          isOvertime: remaining <= 0,
          startedAt: restInfo.startedAt,
          endsAt: restInfo.endsAt,
          isTransitionToNextExercise: Boolean(restInfo.isTransitionToNextExercise),
          nextExerciseName: restInfo.nextExerciseName ?? null,
          nextSetIndex: restInfo.nextSetIndex ?? null,
          nextTotalSets: restInfo.nextTotalSets ?? null,
          nextIsWarmup: Boolean(restInfo.nextIsWarmup),
          nextSupersetGroup: restInfo.nextSupersetGroup ?? null,
        };
      }

      const overviewExercises = exercises.map((ex, idx) => {
        const p = progress[idx];
        return {
          index: idx,
          id: ex.id,
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
        startedAt: workoutStartTime,
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

      const target = exercise.sets[prog.currentSetIndex] || null;

      return {
        ...base,
        currentExerciseIndex,
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        supersetGroup: exercise.supersetGroup,
        totalSets: exercise.sets.length,
        currentSetIndex: prog.currentSetIndex,
        exerciseSetsDots: exercise.sets.map((_, setIdx) => {
          if (setIdx < prog.completedSets.length) return 'completed';
          if (setIdx === prog.currentSetIndex && state === SESSION_STATES.ACTIVE_SET) return 'active';
          return 'pending';
        }),
        currentSet: {
          isWarmup: Boolean(target?.isWarmup),
          warmupIndex: target?.warmupIndex ?? null,
          totalWarmups: target?.totalWarmups ?? 0,
          workSetIndex: target?.workSetIndex ?? null,
          totalWorkSets: target?.totalWorkSets ?? exercise.workSetsCount,
          targetWeightPercent: target?.targetWeightPercent ?? null,
          supersetGroup: exercise.supersetGroup ?? null,
          weight: prog.currentWeight,
          reps: prog.currentReps,
          rpe: prog.currentRpe,
          targetWeight: target?.targetWeight ?? null,
          targetReps: target?.targetReps ?? null,
          targetRepsMax: target?.targetRepsMax ?? null,
          targetRpe: target?.targetRpe ?? null,
          isAmrap: Boolean(target?.isAmrap),
          restSeconds: target?.restSeconds ?? null,
        },
        completedSets: [...prog.completedSets],
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

    adjustWeight(steps = 1, { timestamp = Date.now() } = {}) {
      if (state !== SESSION_STATES.ACTIVE_SET) return;
      applyEvent({ type: EVENT_TYPES.ADJUST_WEIGHT, payload: { delta: steps * step }, timestamp });
    },

    adjustReps(delta, { timestamp = Date.now() } = {}) {
      if (state !== SESSION_STATES.ACTIVE_SET) return;
      applyEvent({ type: EVENT_TYPES.ADJUST_REPS, payload: { delta }, timestamp });
    },

    adjustRpe(delta, { timestamp = Date.now() } = {}) {
      if (state !== SESSION_STATES.ACTIVE_SET) return;
      applyEvent({ type: EVENT_TYPES.ADJUST_RPE, payload: { delta }, timestamp });
    },

    completeSet({ timestamp = Date.now() } = {}) {
      if (state !== SESSION_STATES.ACTIVE_SET) return;
      applyEvent({ type: EVENT_TYPES.COMPLETE_SET, timestamp });
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

    isAllCompleted: allSetsDone,
    getJournal: () => [...journal],
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
