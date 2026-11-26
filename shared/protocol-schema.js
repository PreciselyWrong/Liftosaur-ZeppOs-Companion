/**
 * The shape of every Device <-> Side Service message, in one table both sides
 * check: the phone router before it sends a reply, the watch controller before
 * it acknowledges sets or adopts a workout.
 *
 * Checks are cheap on purpose (top-level shape and reply kind only): a workout
 * can weigh 13 KB, and the watch never walks it here.
 */

import { MESSAGE_TYPES as T } from './protocol.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasEntries = (workout) => isObject(workout) && Array.isArray(workout.entries);

/** Reply kinds: each checks one reply payload (always an object). */
export const REPLY_KINDS = {
  object: () => true,
  // A workout to start from, with its entries, or none.
  workout: (payload) => payload.workout == null || hasEntries(payload.workout),
  // Full snapshot of the running workout: entries plus the start time naming it, or none.
  snapshot: (payload) => payload.workout == null
    || (hasEntries(payload.workout) && Number.isFinite(payload.workout.startTime)),
  // Acknowledgement: the running workout's start time. A phone older than the watch during an
  // update may still add the entries; they are never adopted, and this phone never sends them.
  ack: (payload) => payload.workout === undefined
    || (isObject(payload.workout) && Number.isFinite(payload.workout.startTime)
      && (payload.workout.entries === undefined || Array.isArray(payload.workout.entries))),
  programs: (payload) => Array.isArray(payload.programs),
  outline: (payload) => Array.isArray(payload.weeks),
  plan: (payload) => Array.isArray(payload.exercises),
  image: (payload) => typeof payload.status === 'string',
  abandoned: (payload) => payload.abandoned === true,
  error: (payload) => typeof payload.code === 'string',
};

/** Request type -> [reply type, reply kind, request payload fields]. ERROR answers any request with kind `error`. */
export const PROTOCOL_SCHEMA = {
  [T.PING]: [T.PONG, 'object', ''],
  [T.LIST_PROGRAMS]: [T.PROGRAMS_DATA, 'programs', ''],
  [T.GET_PROGRAM_OUTLINE]: [T.PROGRAM_OUTLINE_DATA, 'outline', 'programId'],
  [T.GET_DAY_PLAN]: [T.DAY_PLAN_DATA, 'plan', 'programId week day'],
  [T.FINISH_WORKOUT]: [T.FINISH_WORKOUT_RESULT, 'object',
    'startTime endTime intervals programId programVersion week day completedSets startedAt durationSeconds programName dayName'],
  [T.ABANDON_WORKOUT]: [T.ABANDON_WORKOUT_RESPONSE, 'abandoned', 'dayName startedAt abandonedAt'],
  [T.GET_WORKOUT_NEXT]: [T.WORKOUT_NEXT_DATA, 'workout', 'programId week dayInWeek'],
  [T.GET_WORKOUT_CURRENT]: [T.WORKOUT_CURRENT_DATA, 'snapshot', ''],
  [T.START_WORKOUT]: [T.START_WORKOUT_DATA, 'snapshot', 'programId week dayInWeek startTime'],
  [T.SYNC_WORKOUT_SETS]: [T.SYNC_WORKOUT_SETS_RESULT, 'ack', 'sets'],
  [T.GET_SETTINGS]: [T.SETTINGS_DATA, 'object', 'diagnostics'],
  [T.GET_EXERCISE_IMAGE]: [T.EXERCISE_IMAGE_DATA, 'image', 'imageUrl requestId forceRefresh'],
  [T.DISCARD_WORKOUT]: [T.DISCARD_WORKOUT_RESULT, 'object', 'startTime'],
};

/** Whether `payload` has the reply kind a `requestType` request expects. */
export function isExpectedReply(requestType, payload) {
  const entry = PROTOCOL_SCHEMA[requestType];
  return Boolean(entry) && isObject(payload) && REPLY_KINDS[entry[1]](payload);
}

/** Whether `reply` is a message the phone may send in answer to a `requestType` request. */
export function isValidReply(requestType, reply) {
  if (reply?.type === T.ERROR) return isObject(reply.payload) && REPLY_KINDS.error(reply.payload);
  return reply?.type === PROTOCOL_SCHEMA[requestType]?.[0] && isExpectedReply(requestType, reply.payload)
    && !(PROTOCOL_SCHEMA[requestType][1] === 'ack' && reply.payload.workout && reply.payload.workout.entries);
}
