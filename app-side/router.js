/**
 * Side Service message router.
 *
 * Pure transport: it validates envelopes and forwards to the program service.
 * It holds no workout knowledge of its own, so there is nowhere for a local
 * guess about programs, days, weights or progressions to hide.
 */

import { MESSAGE_TYPES, ERROR_CODES, validateEnvelope, createPong, createError, createReply } from '../shared/protocol.js';

export function createSideRouter({ programService = null, workoutService = null, workoutAbandoner = null } = {}) {
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

      const catalogService = workoutService || programService;

      switch (rawMessage.type) {
        case MESSAGE_TYPES.LIST_PROGRAMS:
          if (!catalogService) return notConfigured(rawMessage);
          try {
            const programs = await catalogService.listPrograms();
            return createReply(rawMessage, MESSAGE_TYPES.PROGRAMS_DATA, {
              programs,
              serviceMode: catalogService.mode || 'CLOUD',
            });
          } catch (err) {
            return apiFailure(rawMessage, err);
          }

        case MESSAGE_TYPES.GET_PROGRAM_OUTLINE:
          if (!catalogService) return notConfigured(rawMessage);
          try {
            const { programId } = rawMessage.payload || {};
            if (!programId) {
              return createError(rawMessage, ERROR_CODES.INVALID_ENVELOPE, 'programId is required');
            }
            const outline = await catalogService.getProgramOutline(programId);
            return createReply(rawMessage, MESSAGE_TYPES.PROGRAM_OUTLINE_DATA, outline);
          } catch (err) {
            return apiFailure(rawMessage, err);
          }

        case MESSAGE_TYPES.GET_DAY_PLAN:
          if (!programService || typeof programService.getDayPlan !== 'function') {
            return notConfigured(rawMessage);
          }
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

        case MESSAGE_TYPES.GET_WORKOUT_NEXT:
          if (!workoutService) return notConfigured(rawMessage);
          try {
            const payload = rawMessage.payload;
            if (payload !== undefined && payload !== null) {
              if (typeof payload !== 'object' || Array.isArray(payload)) {
                return createError(rawMessage, ERROR_CODES.INVALID_ENVELOPE, 'payload must be an object');
              }
              const { week, dayInWeek } = payload;
              const hasWeek = week !== undefined && week !== null;
              const hasDay = dayInWeek !== undefined && dayInWeek !== null;
              if (hasWeek !== hasDay || (hasWeek && (!Number.isFinite(week) || !Number.isFinite(dayInWeek)))) {
                return createError(
                  rawMessage,
                  ERROR_CODES.INVALID_ENVELOPE,
                  'week and dayInWeek must appear together as finite numbers'
                );
              }
            }
            const result = await workoutService.getNextWorkout(payload || undefined);
            return createReply(rawMessage, MESSAGE_TYPES.WORKOUT_NEXT_DATA, result);
          } catch (err) {
            return apiFailure(rawMessage, err);
          }

        case MESSAGE_TYPES.GET_WORKOUT_CURRENT:
          if (!workoutService) return notConfigured(rawMessage);
          try {
            const result = await workoutService.getCurrentWorkout();
            return createReply(rawMessage, MESSAGE_TYPES.WORKOUT_CURRENT_DATA, result);
          } catch (err) {
            return apiFailure(rawMessage, err);
          }

        case MESSAGE_TYPES.START_WORKOUT:
          if (!workoutService) return notConfigured(rawMessage);
          try {
            const payload = rawMessage.payload;
            if (payload !== undefined && payload !== null) {
              if (typeof payload !== 'object' || Array.isArray(payload)) {
                return createError(rawMessage, ERROR_CODES.INVALID_ENVELOPE, 'payload must be an object');
              }
              const { week, dayInWeek, startTime } = payload;
              const hasWeek = week !== undefined && week !== null;
              const hasDay = dayInWeek !== undefined && dayInWeek !== null;
              if (hasWeek !== hasDay || (hasWeek && (!Number.isFinite(week) || !Number.isFinite(dayInWeek)))) {
                return createError(
                  rawMessage,
                  ERROR_CODES.INVALID_ENVELOPE,
                  'week and dayInWeek must appear together as finite numbers'
                );
              }
              if (startTime !== undefined && startTime !== null && !Number.isFinite(startTime)) {
                return createError(rawMessage, ERROR_CODES.INVALID_ENVELOPE, 'startTime must be a finite number');
              }
            }
            const result = await workoutService.startWorkout(payload || {});
            return createReply(rawMessage, MESSAGE_TYPES.START_WORKOUT_DATA, result);
          } catch (err) {
            return apiFailure(rawMessage, err);
          }

        case MESSAGE_TYPES.SYNC_WORKOUT_SETS:
          if (!workoutService) return notConfigured(rawMessage);
          try {
            const payload = rawMessage.payload || {};
            const { sets } = payload;
            if (!Array.isArray(sets) || sets.length === 0) {
              return createError(rawMessage, ERROR_CODES.INVALID_ENVELOPE, 'sets must be a non-empty array');
            }
            const result = await workoutService.syncWorkoutSets(sets);
            return createReply(rawMessage, MESSAGE_TYPES.SYNC_WORKOUT_SETS_RESULT, result);
          } catch (err) {
            return apiFailure(rawMessage, err);
          }

        case MESSAGE_TYPES.GET_SETTINGS:
          if (!workoutService) return notConfigured(rawMessage);
          try {
            const result = await workoutService.getSettings();
            return createReply(rawMessage, MESSAGE_TYPES.SETTINGS_DATA, result);
          } catch (err) {
            return apiFailure(rawMessage, err);
          }

        case MESSAGE_TYPES.DISCARD_WORKOUT:
          if (!workoutService) return notConfigured(rawMessage);
          try {
            const { startTime } = rawMessage.payload || {};
            if (!Number.isFinite(startTime)) {
              return createError(rawMessage, ERROR_CODES.INVALID_ENVELOPE, 'startTime must be a finite number');
            }
            const result = await workoutService.discardWorkout(startTime);
            return createReply(rawMessage, MESSAGE_TYPES.DISCARD_WORKOUT_RESULT, result);
          } catch (err) {
            return apiFailure(rawMessage, err);
          }

        case MESSAGE_TYPES.FINISH_WORKOUT:
          try {
            const payload = rawMessage.payload || {};
            const isNewPayload = Number.isFinite(payload.startTime);
            const isLegacyPayload =
              Boolean(payload.programId) &&
              Number.isFinite(payload.week) &&
              Number.isFinite(payload.day) &&
              Number.isFinite(payload.startedAt) &&
              Array.isArray(payload.completedSets);

            if (!isNewPayload && !isLegacyPayload) {
              const directPayload =
                Object.prototype.hasOwnProperty.call(payload, 'endTime') ||
                Object.prototype.hasOwnProperty.call(payload, 'intervals');
              return createError(
                rawMessage,
                ERROR_CODES.INVALID_ENVELOPE,
                directPayload
                  ? 'startTime must be a finite number'
                  : 'programId, week, day, startedAt and completedSets are required for legacy recovery'
              );
            }

            let result;
            if (isNewPayload) {
              if (!workoutService && !programService) return notConfigured(rawMessage);
              const service = workoutService || programService;
              result = await service.finishWorkout(payload);
            } else {
              if (!programService && !workoutService) return notConfigured(rawMessage);
              const service = programService || workoutService;
              result = await service.finishWorkout(payload);
            }
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
