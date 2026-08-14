import {
  MESSAGE_TYPES,
  validateEnvelope,
  createPong,
  createError,
  createMessage,
} from '../shared/protocol.js';
import { parseLiftoscriptWorkout } from '../shared/workout-parser.js';

export function createSideRouter({ programProvider = null } = {}) {
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
              // Default fixture if no API provider passed
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
