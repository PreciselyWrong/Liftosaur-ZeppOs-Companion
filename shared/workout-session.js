/**
 * Pure state machine and event journal for workout sessions.
 * Platform-independent: runs in Node tests, Device App, and Side Service.
 */

export const SESSION_STATES = {
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
};

export function createWorkoutSession({ workout, exercise, initialJournal = [] }) {
  const exercises = workout?.exercises ?? (exercise ? [exercise] : []);
  const workoutName = workout?.name ?? (exercise?.name ?? 'Workout');
  const routineName = workout?.routineName ?? 'Routine';

  let state = SESSION_STATES.READY;
  let currentExerciseIndex = 0;
  let workoutStartTime = null;
  let workoutEndTime = null;

  // Per-exercise progress tracking: exerciseIndex -> { setIndex, currentWeight, currentReps, currentRpe, completedSets: [] }
  const exerciseProgress = exercises.map((ex) => ({
    currentSetIndex: 0,
    currentWeight: ex.sets[0]?.targetWeight ?? 0,
    currentReps: ex.sets[0]?.targetReps ?? 0,
    currentRpe: ex.sets[0]?.targetRpe ?? null,
    completedSets: [],
  }));

  let restInfo = null; // { startedAt, duration, endsAt }
  let journal = [];

  function getCurrentExercise() {
    return exercises[currentExerciseIndex];
  }

  function getCurrentProgress() {
    return exerciseProgress[currentExerciseIndex];
  }

  function applyEvent(event) {
    journal.push(event);

    switch (event.type) {
      case EVENT_TYPES.START_WORKOUT:
        state = SESSION_STATES.ACTIVE_SET;
        workoutStartTime = event.timestamp;
        break;


      case EVENT_TYPES.SELECT_EXERCISE: {
        const targetIdx = event.payload.exerciseIndex;
        if (targetIdx >= 0 && targetIdx < exercises.length) {
          currentExerciseIndex = targetIdx;
          const prog = getCurrentProgress();
          const ex = getCurrentExercise();
          const currentSetTarget = ex.sets[prog.currentSetIndex];
          if (prog.currentWeight === 0 && currentSetTarget) {
            prog.currentWeight = currentSetTarget.targetWeight;
            prog.currentReps = currentSetTarget.targetReps;
            prog.currentRpe = currentSetTarget.targetRpe ?? null;
          }
          if (prog.completedSets.length < ex.sets.length) {
            state = SESSION_STATES.ACTIVE_SET;
            restInfo = null;
          }
        }
        break;
      }

      case EVENT_TYPES.ADJUST_WEIGHT: {
        const prog = getCurrentProgress();
        prog.currentWeight = Math.max(0, prog.currentWeight + event.payload.delta);
        break;
      }

      case EVENT_TYPES.ADJUST_REPS: {
        const prog = getCurrentProgress();
        prog.currentReps = Math.max(1, prog.currentReps + event.payload.delta);
        break;
      }

      case EVENT_TYPES.ADJUST_RPE: {
        const prog = getCurrentProgress();
        const cur = prog.currentRpe ?? 8;
        prog.currentRpe = Math.min(10, Math.max(5, cur + event.payload.delta));
        break;
      }

      case EVENT_TYPES.COMPLETE_SET: {
        const prog = getCurrentProgress();
        const ex = getCurrentExercise();

        const completed = {
          exerciseIndex: currentExerciseIndex,
          setIndex: prog.currentSetIndex,
          weight: prog.currentWeight,
          reps: prog.currentReps,
          rpe: prog.currentRpe,
          completedAt: event.timestamp,
        };
        prog.completedSets.push(completed);

        const allCompleted = exercises.every(
          (e, i) => exerciseProgress[i].completedSets.length >= e.sets.length
        );

        if (allCompleted) {
          state = SESSION_STATES.FINISHED;
          restInfo = null;
        } else {
          // Check if there is an alternating superset partner or next exercise
          let isTransitionToNextExercise = false;
          let nextExerciseName = null;
          let nextSupersetTag = null;
          let nextSetIndex = null;
          let nextTotalSets = null;

          if (ex.supersetGroup) {
            const groupIndices = exercises
              .map((e, idx) => (e.supersetGroup === ex.supersetGroup ? idx : -1))
              .filter((idx) => idx !== -1);
            
            // Check next exercise in group that still needs set (prog.completedSets.length - 1)
            const currentCount = prog.completedSets.length;
            const partnerIdx = groupIndices.find(
              (idx) => idx !== currentExerciseIndex && exerciseProgress[idx].completedSets.length < currentCount
            );
            if (partnerIdx !== undefined) {
              isTransitionToNextExercise = true;
              const nextEx = exercises[partnerIdx];
              nextExerciseName = nextEx.name;
              nextSupersetTag = nextEx.supersetTag ?? null;
              nextSetIndex = exerciseProgress[partnerIdx].completedSets.length;
              nextTotalSets = nextEx.sets.length;
            } else {
              // Check if group loops back to first exercise
              const nextInGroupWithSets = groupIndices.find(
                (idx) => exerciseProgress[idx].completedSets.length < exercises[idx].sets.length
              );
              if (nextInGroupWithSets !== undefined) {
                if (nextInGroupWithSets !== currentExerciseIndex) {
                  isTransitionToNextExercise = true;
                }
                const nextEx = exercises[nextInGroupWithSets];
                nextExerciseName = nextEx.name;
                nextSupersetTag = nextEx.supersetTag ?? null;
                nextSetIndex = exerciseProgress[nextInGroupWithSets].completedSets.length;
                nextTotalSets = nextEx.sets.length;
              }
            }
          } else {
            const isLastSetOfExercise = prog.completedSets.length >= ex.sets.length;
            if (isLastSetOfExercise && currentExerciseIndex + 1 < exercises.length) {
              isTransitionToNextExercise = true;
              const nextEx = exercises[currentExerciseIndex + 1];
              nextExerciseName = nextEx.name;
              nextSupersetTag = nextEx.supersetTag ?? null;
              nextSetIndex = 0;
              nextTotalSets = nextEx.sets.length;
            } else if (!isLastSetOfExercise) {
              nextExerciseName = ex.name;
              nextSupersetTag = ex.supersetTag ?? null;
              nextSetIndex = prog.completedSets.length;
              nextTotalSets = ex.sets.length;
            }
          }

          const restDuration = ex.sets[prog.currentSetIndex]?.restSeconds ?? 90;
          state = SESSION_STATES.REST;
          restInfo = {
            startedAt: event.timestamp,
            duration: restDuration,
            endsAt: event.timestamp + restDuration * 1000,
            isTransitionToNextExercise,
            nextExerciseName,
            nextSupersetTag,
            nextSetIndex,
            nextTotalSets,
          };
        }
        break;
      }


      case EVENT_TYPES.NEXT_SET: {
        const prog = getCurrentProgress();
        const ex = getCurrentExercise();

        // 1. Superset alternating logic
        if (ex.supersetGroup) {
          const groupIndices = exercises
            .map((e, idx) => (e.supersetGroup === ex.supersetGroup ? idx : -1))
            .filter((idx) => idx !== -1);

          const currentCount = prog.completedSets.length;
          // Find partner in group that needs to catch up
          const partnerIdx = groupIndices.find(
            (idx) => idx !== currentExerciseIndex && exerciseProgress[idx].completedSets.length < currentCount
          );

          if (partnerIdx !== undefined) {
            currentExerciseIndex = partnerIdx;
            const nextProg = getCurrentProgress();
            const nextEx = getCurrentExercise();
            nextProg.currentSetIndex = nextProg.completedSets.length;
            const nextTarget = nextEx.sets[nextProg.currentSetIndex];
            nextProg.currentWeight = nextTarget?.targetWeight ?? nextProg.currentWeight;
            nextProg.currentReps = nextTarget?.targetReps ?? nextProg.currentReps;
            nextProg.currentRpe = nextTarget?.targetRpe ?? nextProg.currentRpe;
            state = SESSION_STATES.ACTIVE_SET;
            restInfo = null;
            break;
          }

          // If all in group finished current round, check if group has more sets
          const nextInGroupWithSets = groupIndices.find(
            (idx) => exerciseProgress[idx].completedSets.length < exercises[idx].sets.length
          );
          if (nextInGroupWithSets !== undefined) {
            currentExerciseIndex = nextInGroupWithSets;
            const nextProg = getCurrentProgress();
            const nextEx = getCurrentExercise();
            nextProg.currentSetIndex = nextProg.completedSets.length;
            const nextTarget = nextEx.sets[nextProg.currentSetIndex];
            nextProg.currentWeight = nextTarget?.targetWeight ?? nextProg.currentWeight;
            nextProg.currentReps = nextTarget?.targetReps ?? nextProg.currentReps;
            nextProg.currentRpe = nextTarget?.targetRpe ?? nextProg.currentRpe;
            state = SESSION_STATES.ACTIVE_SET;
            restInfo = null;
            break;
          }
        }

        // 2. Standard sequential progression
        if (prog.completedSets.length < ex.sets.length) {
          prog.currentSetIndex = prog.completedSets.length;
          const nextTarget = ex.sets[prog.currentSetIndex];
          prog.currentWeight = nextTarget?.targetWeight ?? prog.currentWeight;
          prog.currentReps = nextTarget?.targetReps ?? prog.currentReps;
          prog.currentRpe = nextTarget?.targetRpe ?? prog.currentRpe;
          state = SESSION_STATES.ACTIVE_SET;
          restInfo = null;
        } else if (currentExerciseIndex + 1 < exercises.length) {
          currentExerciseIndex += 1;
          const nextProg = getCurrentProgress();
          const nextEx = getCurrentExercise();
          nextProg.currentSetIndex = nextProg.completedSets.length;
          const nextTarget = nextEx.sets[nextProg.currentSetIndex];
          nextProg.currentWeight = nextTarget?.targetWeight ?? nextProg.currentWeight;
          nextProg.currentReps = nextTarget?.targetReps ?? nextProg.currentReps;
          nextProg.currentRpe = nextTarget?.targetRpe ?? nextProg.currentRpe;
          state = SESSION_STATES.ACTIVE_SET;
          restInfo = null;
        } else {
          state = SESSION_STATES.FINISHED;
          restInfo = null;
        }
        break;
      }


      case EVENT_TYPES.FINISH_WORKOUT:
        state = SESSION_STATES.FINISHED;
        workoutEndTime = event.timestamp;
        restInfo = null;
        break;
    }
  }

  // Replay initial journal
  for (const event of initialJournal) {
    applyEvent(event);
  }

  return {
    view(now = Date.now()) {
      const ex = getCurrentExercise() || { name: 'Workout', sets: [] };
      const prog = getCurrentProgress() || { currentSetIndex: 0, currentWeight: 0, currentReps: 0, currentRpe: null, completedSets: [] };

      let calculatedRest = null;
      if (restInfo) {
        const diffMs = restInfo.endsAt - now;
        const remaining = Math.ceil(diffMs / 1000);
        calculatedRest = {
          duration: restInfo.duration,
          remaining,
          isOvertime: remaining <= 0,
          startedAt: restInfo.startedAt,
          endsAt: restInfo.endsAt,
          isTransitionToNextExercise: Boolean(restInfo.isTransitionToNextExercise),
          nextExerciseName: restInfo.nextExerciseName ?? null,
          nextSupersetTag: restInfo.nextSupersetTag ?? null,
          nextSetIndex: restInfo.nextSetIndex ?? null,
          nextTotalSets: restInfo.nextTotalSets ?? null,
        };
      }


      // Elapsed time calculation
      let elapsedSeconds = 0;
      if (workoutStartTime) {
        const end = workoutEndTime || (state === SESSION_STATES.FINISHED ? now : now);
        elapsedSeconds = Math.max(0, Math.floor((end - workoutStartTime) / 1000));
      }

      // Total Volume calculation (sum of reps * weight across all completed sets)
      const allCompletedSets = exerciseProgress.flatMap((p) => p.completedSets);
      const totalVolume = allCompletedSets.reduce((sum, s) => sum + (s.weight * s.reps), 0);

      // Set status dots for current exercise (e.g. ['completed', 'active', 'pending'])
      const exerciseSetsDots = ex.sets.map((_, setIdx) => {
        if (setIdx < prog.completedSets.length) return 'completed';
        if (setIdx === prog.currentSetIndex && state === SESSION_STATES.ACTIVE_SET) return 'active';
        return 'pending';
      });

      // Exercises overview summary for the list view
      const overviewExercises = exercises.map((e, idx) => {
        const p = exerciseProgress[idx];
        const dots = e.sets.map((_, sIdx) => {
          if (sIdx < p.completedSets.length) return 'completed';
          if (idx === currentExerciseIndex && sIdx === p.currentSetIndex && state === SESSION_STATES.ACTIVE_SET) return 'active';
          return 'pending';
        });
        return {
          index: idx,
          id: e.id,
          name: e.name,
          supersetTag: e.supersetTag ?? null,
          totalSets: e.sets.length,
          completedSetsCount: p.completedSets.length,
          setsDots: dots,
          prescriptionSummary: `${e.sets.length} × ${e.sets[0]?.targetReps ?? 0} @ ${e.sets[0]?.targetWeight ?? 0} kg`,
        };
      });

      return {
        state,
        workoutName,
        routineName,
        elapsedSeconds,
        totalVolume,
        totalCompletedSetsCount: allCompletedSets.length,
        totalExercises: exercises.length,
        currentExerciseIndex,
        exerciseId: ex.id,
        exerciseName: ex.name,
        supersetTag: ex.supersetTag ?? null,
        totalSets: ex.sets.length,
        currentSetIndex: prog.currentSetIndex,
        exerciseSetsDots,
        overviewExercises,
        currentSet: {
          weight: prog.currentWeight,
          reps: prog.currentReps,
          rpe: prog.currentRpe,
          targetWeight: ex.sets[prog.currentSetIndex]?.targetWeight ?? prog.currentWeight,
          targetReps: ex.sets[prog.currentSetIndex]?.targetReps ?? prog.currentReps,
          targetRpe: ex.sets[prog.currentSetIndex]?.targetRpe ?? null,
        },
        completedSets: [...prog.completedSets],
        allCompletedSets,
        rest: calculatedRest,
      };
    },


    startWorkout({ timestamp = Date.now() } = {}) {
      if (state !== SESSION_STATES.READY) return;
      applyEvent({
        type: EVENT_TYPES.START_WORKOUT,
        timestamp,
      });
    },

    selectExercise(exerciseIndex, { timestamp = Date.now() } = {}) {
      applyEvent({
        type: EVENT_TYPES.SELECT_EXERCISE,
        payload: { exerciseIndex },
        timestamp,
      });
    },

    nextExercise() {
      if (currentExerciseIndex + 1 < exercises.length) {
        this.selectExercise(currentExerciseIndex + 1);
      }
    },

    prevExercise() {
      if (currentExerciseIndex > 0) {
        this.selectExercise(currentExerciseIndex - 1);
      }
    },

    adjustWeight(delta, { timestamp = Date.now() } = {}) {
      if (state !== SESSION_STATES.ACTIVE_SET) return;
      applyEvent({
        type: EVENT_TYPES.ADJUST_WEIGHT,
        payload: { delta },
        timestamp,
      });
    },

    adjustReps(delta, { timestamp = Date.now() } = {}) {
      if (state !== SESSION_STATES.ACTIVE_SET) return;
      applyEvent({
        type: EVENT_TYPES.ADJUST_REPS,
        payload: { delta },
        timestamp,
      });
    },

    adjustRpe(delta, { timestamp = Date.now() } = {}) {
      if (state !== SESSION_STATES.ACTIVE_SET) return;
      applyEvent({
        type: EVENT_TYPES.ADJUST_RPE,
        payload: { delta },
        timestamp,
      });
    },


    completeSet({ timestamp = Date.now() } = {}) {
      if (state !== SESSION_STATES.ACTIVE_SET) return;
      applyEvent({
        type: EVENT_TYPES.COMPLETE_SET,
        timestamp,
      });
    },

    nextSet({ timestamp = Date.now() } = {}) {
      if (state !== SESSION_STATES.REST) return;
      applyEvent({
        type: EVENT_TYPES.NEXT_SET,
        timestamp,
      });
    },

    finishWorkout({ timestamp = Date.now() } = {}) {
      applyEvent({
        type: EVENT_TYPES.FINISH_WORKOUT,
        timestamp,
      });
    },

    isAllCompleted() {
      return exercises.every((ex, i) => exerciseProgress[i].completedSets.length >= ex.sets.length);
    },

    getJournal() {
      return [...journal];
    },
  };
}
