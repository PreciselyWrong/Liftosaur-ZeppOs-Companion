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
              'My Program';

            const historyRecords =
              historyData?.data?.records ||
              historyData?.records ||
              (Array.isArray(historyData) ? historyData : []);

            // 2. Resolve program structure and current week/day
            const targetSession = resolveNextProgramSession({
              programText,
              programName,
              routineName: programName,
              historyRecords,
              requestedDayIndex,
            });

            let finalWorkout = null;

            // 3. Ask Liftosaur Cloud Playground to compute official workout for (week, day)
            if (playgroundSimulator && programText) {
              try {
                const playgroundRes = await playgroundSimulator({
                  programText,
                  week: targetSession.week,
                  day: targetSession.dayInWeek,
                });

                if (playgroundRes?.data?.workout) {
                  const rawWorkoutText = playgroundRes.data.workout;
                  const parsedPlayground = parseLiftoscriptWorkout({
                    text: rawWorkoutText,
                    name: targetSession.dayName,
                    routineName: programName,
                  });

                  if (parsedPlayground && parsedPlayground.exercises.length > 0) {
                    finalWorkout = {
                      ...parsedPlayground,
                      name: parsedPlayground.name || targetSession.fullName || targetSession.dayName,
                      routineName: programName,
                      availableDays: targetSession.availableDays,
                      currentDayIndex: targetSession.dayIndex,
                      totalDays: targetSession.totalDays,
                      week: targetSession.week,
                      dayInWeek: targetSession.dayInWeek,
                    };
                  }
                }
              } catch (simErr) {
                console.log('[liftosaur-router] playground resolution fallback to local parser:', simErr?.message || String(simErr));
              }
            }

            // 4. Fallback to local parser if playground was offline or empty
            if (!finalWorkout) {
              finalWorkout = {
                id: 'workout-' + Date.now(),
                name: targetSession.fullName || targetSession.dayName,
                routineName: programName,
                exercises: targetSession.exercises,
                availableDays: targetSession.availableDays,
                currentDayIndex: targetSession.dayIndex,
                totalDays: targetSession.totalDays,
                week: targetSession.week,
                dayInWeek: targetSession.dayInWeek,
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
