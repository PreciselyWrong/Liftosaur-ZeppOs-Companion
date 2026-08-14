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
  FINISH_WORKOUT: 'FINISH_WORKOUT',
};

export function createWorkoutSession({ exercise, initialJournal = [] }) {
  let state = SESSION_STATES.READY;
  let currentSetIndex = 0;
  let currentWeight = exercise.sets[0]?.targetWeight ?? 0;
  let currentReps = exercise.sets[0]?.targetReps ?? 0;
  let completedSets = [];
  let restInfo = null; // { startedAt, duration, endsAt }
  let journal = [];

  function applyEvent(event) {
    journal.push(event);

    switch (event.type) {
      case EVENT_TYPES.START_WORKOUT:
        state = SESSION_STATES.ACTIVE_SET;
        currentSetIndex = 0;
        currentWeight = exercise.sets[0]?.targetWeight ?? 0;
        currentReps = exercise.sets[0]?.targetReps ?? 0;
        break;

      case EVENT_TYPES.ADJUST_WEIGHT:
        currentWeight = Math.max(0, currentWeight + event.payload.delta);
        break;

      case EVENT_TYPES.ADJUST_REPS:
        currentReps = Math.max(1, currentReps + event.payload.delta);
        break;

      case EVENT_TYPES.COMPLETE_SET: {
        const completed = {
          setIndex: currentSetIndex,
          weight: currentWeight,
          reps: currentReps,
          completedAt: event.timestamp,
        };
        completedSets.push(completed);

        const isLastSet = currentSetIndex + 1 >= exercise.sets.length;
        if (isLastSet) {
          state = SESSION_STATES.FINISHED;
          restInfo = null;
        } else {
          state = SESSION_STATES.REST;
          const restDuration = exercise.sets[currentSetIndex]?.restSeconds ?? 90;
          restInfo = {
            startedAt: event.timestamp,
            duration: restDuration,
            endsAt: event.timestamp + restDuration * 1000,
          };
        }
        break;
      }

      case EVENT_TYPES.NEXT_SET: {
        if (currentSetIndex + 1 < exercise.sets.length) {
          currentSetIndex += 1;
          state = SESSION_STATES.ACTIVE_SET;
          currentWeight = exercise.sets[currentSetIndex]?.targetWeight ?? currentWeight;
          currentReps = exercise.sets[currentSetIndex]?.targetReps ?? currentReps;
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

  // Replay initial journal if provided (e.g. crash recovery)
  for (const event of initialJournal) {
    applyEvent(event);
  }

  return {
    view(now = Date.now()) {
      let calculatedRest = null;
      if (restInfo) {
        const remainingMs = Math.max(0, restInfo.endsAt - now);
        calculatedRest = {
          duration: restInfo.duration,
          remaining: Math.ceil(remainingMs / 1000),
          startedAt: restInfo.startedAt,
          endsAt: restInfo.endsAt,
        };
      }

      return {
        state,
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        totalSets: exercise.sets.length,
        currentSetIndex,
        currentSet: {
          weight: currentWeight,
          reps: currentReps,
          targetWeight: exercise.sets[currentSetIndex]?.targetWeight ?? currentWeight,
          targetReps: exercise.sets[currentSetIndex]?.targetReps ?? currentReps,
        },
        completedSets: [...completedSets],
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

    getJournal() {
      return [...journal];
    },
  };
}
