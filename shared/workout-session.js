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
  COMPLETE_SET: 'COMPLETE_SET',
  NEXT_SET: 'NEXT_SET',
  SELECT_EXERCISE: 'SELECT_EXERCISE',
  FINISH_WORKOUT: 'FINISH_WORKOUT',
};

export function createWorkoutSession({ workout, exercise, initialJournal = [] }) {
  const exercises = workout?.exercises ?? (exercise ? [exercise] : []);
  const workoutName = workout?.name ?? (exercise?.name ?? 'Workout');

  let state = SESSION_STATES.READY;
  let currentExerciseIndex = 0;

  // Per-exercise progress tracking: exerciseIndex -> { setIndex, currentWeight, currentReps, completedSets: [] }
  const exerciseProgress = exercises.map((ex) => ({
    currentSetIndex: 0,
    currentWeight: ex.sets[0]?.targetWeight ?? 0,
    currentReps: ex.sets[0]?.targetReps ?? 0,
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

      case EVENT_TYPES.COMPLETE_SET: {
        const prog = getCurrentProgress();
        const ex = getCurrentExercise();

        const completed = {
          exerciseIndex: currentExerciseIndex,
          setIndex: prog.currentSetIndex,
          weight: prog.currentWeight,
          reps: prog.currentReps,
          completedAt: event.timestamp,
        };
        prog.completedSets.push(completed);

        const isLastSetOfExercise = prog.currentSetIndex + 1 >= ex.sets.length;
        const allCompleted = exercises.every(
          (e, i) => exerciseProgress[i].completedSets.length >= e.sets.length
        );

        if (allCompleted) {
          state = SESSION_STATES.FINISHED;
          restInfo = null;
        } else {
          const hasNextExercise = currentExerciseIndex + 1 < exercises.length;
          const restDuration = ex.sets[prog.currentSetIndex]?.restSeconds ?? 90;
          state = SESSION_STATES.REST;
          restInfo = {
            startedAt: event.timestamp,
            duration: restDuration,
            endsAt: event.timestamp + restDuration * 1000,
            isTransitionToNextExercise: isLastSetOfExercise && hasNextExercise,
          };
        }
        break;
      }


      case EVENT_TYPES.NEXT_SET: {
        const prog = getCurrentProgress();
        const ex = getCurrentExercise();

        if (prog.currentSetIndex + 1 < ex.sets.length) {
          // Next set in current exercise
          prog.currentSetIndex += 1;
          const nextTarget = ex.sets[prog.currentSetIndex];
          prog.currentWeight = nextTarget?.targetWeight ?? prog.currentWeight;
          prog.currentReps = nextTarget?.targetReps ?? prog.currentReps;
          state = SESSION_STATES.ACTIVE_SET;
          restInfo = null;
        } else if (currentExerciseIndex + 1 < exercises.length) {
          // Advance to next exercise
          currentExerciseIndex += 1;
          const nextProg = getCurrentProgress();
          const nextEx = getCurrentExercise();
          const nextTarget = nextEx.sets[nextProg.currentSetIndex];
          nextProg.currentWeight = nextTarget?.targetWeight ?? nextProg.currentWeight;
          nextProg.currentReps = nextTarget?.targetReps ?? nextProg.currentReps;
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
      const prog = getCurrentProgress() || { currentSetIndex: 0, currentWeight: 0, currentReps: 0, completedSets: [] };

      let calculatedRest = null;
      if (restInfo) {
        const remainingMs = Math.max(0, restInfo.endsAt - now);
        calculatedRest = {
          duration: restInfo.duration,
          remaining: Math.ceil(remainingMs / 1000),
          startedAt: restInfo.startedAt,
          endsAt: restInfo.endsAt,
          isTransitionToNextExercise: Boolean(restInfo.isTransitionToNextExercise),
        };
      }

      return {
        state,
        workoutName,
        totalExercises: exercises.length,
        currentExerciseIndex,
        exerciseId: ex.id,
        exerciseName: ex.name,
        totalSets: ex.sets.length,
        currentSetIndex: prog.currentSetIndex,
        currentSet: {
          weight: prog.currentWeight,
          reps: prog.currentReps,
          targetWeight: ex.sets[prog.currentSetIndex]?.targetWeight ?? prog.currentWeight,
          targetReps: ex.sets[prog.currentSetIndex]?.targetReps ?? prog.currentReps,
        },
        completedSets: [...prog.completedSets],
        allCompletedSets: exerciseProgress.flatMap((p) => p.completedSets),
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
