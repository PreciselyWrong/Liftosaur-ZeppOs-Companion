import {
  MESSAGE_TYPES,
  validateEnvelope,
  createPong,
  createError,
  createMessage,
} from '../shared/protocol.js';
import {
  parseLiftoscriptWorkout,
  resolveNextProgramSession,
} from '../shared/workout-parser.js';

export function createSideRouter({
  programProvider = null,
  historyProvider = null,
  playgroundSimulator = null,
  historySubmitter = null,
  workoutAbandoner = null,
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

            // 1. Fetch current program and recent workout history in parallel
            const [programData, historyData] = await Promise.all([
              programProvider(),
              historyProvider ? historyProvider().catch(() => null) : Promise.resolve(null),
            ]);

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

            const programText =
              programData.data?.text ||
              programData.text ||
              programData.program?.text ||
              '';
            const programName =
              programData.data?.name ||
              programData.name ||
              programData.program?.name ||
              'Liftosaur';

            let finalWorkout = null;

            // 1. Direct authoritative workout generation from Liftosaur Cloud Playground
            if (playgroundSimulator && programText) {
              try {
                const playgroundPayload = { programText };
                if (requestedDayIndex !== null && requestedDayIndex !== undefined && requestedDayIndex >= 0) {
                  playgroundPayload.day = requestedDayIndex + 1;
                }

                const playgroundRes = await playgroundSimulator(playgroundPayload);
                if (playgroundRes?.data?.workout) {
                  const rawWorkoutText = playgroundRes.data.workout;
                  const parsedPlayground = parseLiftoscriptWorkout({
                    text: rawWorkoutText,
                    name: programName,
                    routineName: programName,
                  });

                  if (parsedPlayground && parsedPlayground.exercises.length > 0) {
                    finalWorkout = {
                      ...parsedPlayground,
                      id: 'workout-' + Date.now(),
                      name: parsedPlayground.name || programName,
                      routineName: programName,
                      currentDayIndex: requestedDayIndex ?? 0,
                    };
                  }
                }
              } catch (simErr) {
                console.log('[liftosaur-router] playground API failed, falling back to local text parse:', simErr?.message || String(simErr));
              }
            }

            // 2. Fallback only if playground is offline or returned empty
            if (!finalWorkout) {
              const fallbackSession = parseLiftoscriptWorkout({
                text: programText,
                name: programName,
                routineName: programName,
              }, requestedDayIndex);

              finalWorkout = {
                id: 'workout-' + Date.now(),
                name: fallbackSession.name || programName,
                routineName: programName,
                exercises: fallbackSession.exercises,
                availableDays: fallbackSession.availableDays,
                currentDayIndex: fallbackSession.currentDayIndex || 0,
                totalDays: fallbackSession.totalDays || 1,
              };
            }

            return createMessage({
              type: MESSAGE_TYPES.WORKOUT_DATA,
              replyToId: rawMessage.messageId,
              sessionId: rawMessage.sessionId,
              payload: {
                configured: true,
                workout: finalWorkout,
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

        case MESSAGE_TYPES.ABANDON_WORKOUT: {
          try {
            const payload = rawMessage.payload || {};
            if (workoutAbandoner) {
              await workoutAbandoner(payload);
            }
            return createMessage({
              type: MESSAGE_TYPES.ABANDON_WORKOUT_RESPONSE,
              replyToId: rawMessage.messageId,
              sessionId: rawMessage.sessionId,
              payload: {
                abandoned: true,
              },
            });
          } catch (err) {
            return createError(
              rawMessage,
              'ABANDON_FAILED',
              err.message || 'Failed to abandon workout'
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
