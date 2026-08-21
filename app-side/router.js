/**
 * Side Service message router.
 *
 * Pure transport: it validates envelopes and forwards to the program service.
 * It holds no workout knowledge of its own, so there is nowhere for a local
 * guess about programs, days, weights or progressions to hide.
 */

import { MESSAGE_TYPES, ERROR_CODES, validateEnvelope, createPong, createError, createReply } from '../shared/protocol.js';

export function createSideRouter({ programService = null, workoutAbandoner = null } = {}) {
  /** Guards against a retried FINISH_WORKOUT committing the same session twice. */
  const finishedSessions = new Map();

  function notConfigured(message) {
    return createError(message, ERROR_CODES.NOT_CONFIGURED, 'No Liftosaur API key configured on the phone');
  }

  function apiFailure(message, err) {
    const code = err?.code || ERROR_CODES.API_FAILED;
    const text = err?.apiMessage || err?.message || 'Liftosaur API error';
    return createError(message, code, text);
  }

  return {
    async handle(rawMessage) {
      const validation = validateEnvelope(rawMessage);
      if (!validation.valid) {
        return createError(rawMessage, ERROR_CODES.INVALID_ENVELOPE, validation.reason);
      }

      if (rawMessage.type === MESSAGE_TYPES.PING) {
        return createPong(rawMessage, { serverTime: Date.now(), echo: rawMessage.payload });
      }

      if (rawMessage.type === MESSAGE_TYPES.ABANDON_WORKOUT) {
        try {
          // Nothing was written to the account: a session only reaches the
          // history when it is finished. Abandoning is purely local.
          if (workoutAbandoner) await workoutAbandoner(rawMessage.payload || {});
          return createReply(rawMessage, MESSAGE_TYPES.ABANDON_WORKOUT_RESPONSE, { abandoned: true });
        } catch (err) {
          return apiFailure(rawMessage, err);
        }
      }

      if (!programService) {
        return notConfigured(rawMessage);
      }

      switch (rawMessage.type) {
        case MESSAGE_TYPES.LIST_PROGRAMS:
          try {
            const programs = await programService.listPrograms();
            return createReply(rawMessage, MESSAGE_TYPES.PROGRAMS_DATA, {
              programs,
              serviceMode: programService.mode || 'CLOUD',
            });
          } catch (err) {
            return apiFailure(rawMessage, err);
          }

        case MESSAGE_TYPES.GET_PROGRAM_OUTLINE:
          try {
            const { programId } = rawMessage.payload || {};
            if (!programId) {
              return createError(rawMessage, ERROR_CODES.INVALID_ENVELOPE, 'programId is required');
            }
            const outline = await programService.getProgramOutline(programId);
            return createReply(rawMessage, MESSAGE_TYPES.PROGRAM_OUTLINE_DATA, outline);
          } catch (err) {
            return apiFailure(rawMessage, err);
          }

        case MESSAGE_TYPES.GET_DAY_PLAN:
          try {
            const { programId, week, day } = rawMessage.payload || {};
            if (!programId || !Number.isFinite(week) || !Number.isFinite(day)) {
              return createError(rawMessage, ERROR_CODES.INVALID_ENVELOPE, 'programId, week and day are required');
            }
            const plan = await programService.getDayPlan(programId, week, day);
            return createReply(rawMessage, MESSAGE_TYPES.DAY_PLAN_DATA, plan);
          } catch (err) {
            return apiFailure(rawMessage, err);
          }

        case MESSAGE_TYPES.FINISH_WORKOUT:
          try {
            const payload = rawMessage.payload || {};
            const key = String(payload.startedAt || rawMessage.sessionId || '');
            if (key && finishedSessions.has(key)) {
              return createReply(rawMessage, MESSAGE_TYPES.FINISH_WORKOUT_RESULT, finishedSessions.get(key));
            }

            const result = await programService.finishWorkout(payload);
            if (key) finishedSessions.set(key, result);
            return createReply(rawMessage, MESSAGE_TYPES.FINISH_WORKOUT_RESULT, result);
          } catch (err) {
            return apiFailure(rawMessage, err);
          }

        default:
          return createError(
            rawMessage,
            ERROR_CODES.UNSUPPORTED_TYPE,
            `Message type '${rawMessage.type}' is not supported`
          );
      }
    },
  };
}
