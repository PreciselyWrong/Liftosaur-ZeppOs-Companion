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
            if (!programProvider) {
              return createMessage({
                type: MESSAGE_TYPES.WORKOUT_DATA,
                replyToId: rawMessage.messageId,
                sessionId: rawMessage.sessionId,
                payload: {
                  configured: false,
                  workout: null,
                },
              });
            }

            const requestedDayIndex = rawMessage.payload?.dayIndex ?? null;
            const programData = await programProvider();

            if (!programData) {
              return createMessage({
                type: MESSAGE_TYPES.WORKOUT_DATA,
                replyToId: rawMessage.messageId,
                sessionId: rawMessage.sessionId,
                payload: {
                  configured: false,
                  workout: null,
                },
              });
            }

            // Extract program text from API response
            const programText =
              programData.data?.text ||
              programData.text ||
              programData.program?.text ||
              '';

            let resolvedWorkoutText = null;

            // 1. Ask Liftosaur Cloud Playground to compute the official next workout
            if (playgroundSimulator && programText) {
              try {
                const playgroundRes = await playgroundSimulator({
                  programText,
                  day: requestedDayIndex !== null ? requestedDayIndex + 1 : null,
                });
                if (playgroundRes?.data?.workout) {
                  resolvedWorkoutText = playgroundRes.data.workout;
                }
              } catch (simErr) {
                console.log('[liftosaur-router] playground resolution fallback to local parser:', simErr?.message || String(simErr));
              }
            }

            // 2. Parse resolved workout text (or fallback to full program text)
            const inputToParse = resolvedWorkoutText || programData;
            const parsedWorkout = parseLiftoscriptWorkout(inputToParse, requestedDayIndex);

            return createMessage({
              type: MESSAGE_TYPES.WORKOUT_DATA,
              replyToId: rawMessage.messageId,
              sessionId: rawMessage.sessionId,
              payload: {
                configured: true,
                workout: parsedWorkout,
              },
            });

          } catch (err) {
            return createError(
              rawMessage,
              'WORKOUT_FETCH_FAILED',
              err.message || 'Liftosaur API error'
            );
          }
        }

        case MESSAGE_TYPES.SYNC_JOURNAL: {
          try {
            const journal = rawMessage.payload?.journal || [];
            let simulationResult = null;

            if (playgroundSimulator) {
              simulationResult = await playgroundSimulator({ journal });
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
