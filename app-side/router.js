import {
  MESSAGE_TYPES,
  validateEnvelope,
  createPong,
  createError,
  createMessage,
} from '../shared/protocol.js';
import { parseLiftoscriptWorkout } from '../shared/workout-parser.js';

export function createSideRouter({
  programProvider = null,
  playgroundSimulator = null,
  historySubmitter = null,
} = {}) {
  // In-memory idempotency cache for history submissions (startedAt -> response)
  const submittedHistoryCache = new Map();

  return {
    async handle(rawMessage) {
      const validation = validateEnvelope(rawMessage);
      if (!validation.valid) {
        return createError(
          rawMessage,
          'INVALID_ENVELOPE',
          validation.reason || 'Envelope validation failed'
        );
      }

      switch (rawMessage.type) {
        case MESSAGE_TYPES.PING:
          return createPong(rawMessage, {
            serverTime: Date.now(),
            echo: rawMessage.payload,
          });

        case MESSAGE_TYPES.GET_CURRENT_WORKOUT: {
          try {
            let programData;
            if (programProvider) {
              programData = await programProvider();
            } else {
              programData = {
                id: 'default-prog-1',
                name: 'Week 1 - Workout A',
                routineName: 'Basic Beginner Routine',
                text: `
                  Bench Press, Barbell / 3x5 @ 60kg / rest 60s / rpe 8
                  Overhead Squat, Barbell / 3x5 @ 40kg / rest 90s / rpe 8
                  [SUPERSET A1] Incline DB Bench / 2x10 @ 30kg / rest 30s / rpe 8.5
                  [SUPERSET A2] DB Chest Row / 2x12 @ 26kg / rest 60s / rpe 8.5
                `,
              };
            }

            const parsedWorkout = parseLiftoscriptWorkout(programData);
            return createMessage({
              type: MESSAGE_TYPES.WORKOUT_DATA,
              replyToId: rawMessage.messageId,
              sessionId: rawMessage.sessionId,
              payload: { workout: parsedWorkout },
            });
          } catch (err) {
            return createError(
              rawMessage,
              'WORKOUT_FETCH_FAILED',
              err.message || 'Failed to retrieve workout'
            );
          }
        }

        case MESSAGE_TYPES.SYNC_JOURNAL: {
          try {
            const journal = rawMessage.payload?.journal || [];
            let simulationResult = null;

            if (playgroundSimulator) {
              simulationResult = await playgroundSimulator(journal);
            }

            return createMessage({
              type: MESSAGE_TYPES.SYNC_JOURNAL_RESPONSE,
              replyToId: rawMessage.messageId,
              sessionId: rawMessage.sessionId,
              payload: {
                synced: true,
                syncedCount: journal.length,
                updatedPrescription: simulationResult?.updatedPrescription ?? null,
              },
            });
          } catch (err) {
            return createError(
              rawMessage,
              'SYNC_FAILED',
              err.message || 'Journal synchronization failed'
            );
          }
        }

        case MESSAGE_TYPES.SUBMIT_WORKOUT_HISTORY: {
          try {
            const history = rawMessage.payload || {};
            const deduplicationKey = String(history.startedAt || history.workoutId || rawMessage.sessionId);

            // Idempotency check: return cached success if already submitted
            if (submittedHistoryCache.has(deduplicationKey)) {
              return createMessage({
                type: MESSAGE_TYPES.SUBMIT_WORKOUT_HISTORY_RESPONSE,
                replyToId: rawMessage.messageId,
                sessionId: rawMessage.sessionId,
                payload: submittedHistoryCache.get(deduplicationKey),
              });
            }

            let result = { id: 'local-hist-' + Date.now(), status: 'saved' };
            if (historySubmitter) {
              result = await historySubmitter(history);
            }

            submittedHistoryCache.set(deduplicationKey, result);

            return createMessage({
              type: MESSAGE_TYPES.SUBMIT_WORKOUT_HISTORY_RESPONSE,
              replyToId: rawMessage.messageId,
              sessionId: rawMessage.sessionId,
              payload: result,
            });
          } catch (err) {
            return createError(
              rawMessage,
              'HISTORY_SUBMIT_FAILED',
              err.message || 'Failed to submit workout history'
            );
          }
        }

        default:
          return createError(
            rawMessage,
            'UNSUPPORTED_TYPE',
            `Message type '${rawMessage.type}' is not supported`
          );
      }
    },
  };
}
