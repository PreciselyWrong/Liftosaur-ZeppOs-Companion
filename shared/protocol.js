/**
 * Device <-> Side Service protocol.
 *
 * Version 2 replaces the single "give me the current workout" call of version 1
 * with an explicit selection flow: the watch asks for programs, then for a
 * program's weeks and days, then for one chosen day. Nothing is inferred on
 * either side, and a version 1 message is rejected rather than guessed at.
 */

export const PROTOCOL_VERSION = 2;

export const MESSAGE_TYPES = {
  PING: 'PING',
  PONG: 'PONG',
  ERROR: 'ERROR',

  LIST_PROGRAMS: 'LIST_PROGRAMS',
  PROGRAMS_DATA: 'PROGRAMS_DATA',

  GET_PROGRAM_OUTLINE: 'GET_PROGRAM_OUTLINE',
  PROGRAM_OUTLINE_DATA: 'PROGRAM_OUTLINE_DATA',

  GET_DAY_PLAN: 'GET_DAY_PLAN',
  DAY_PLAN_DATA: 'DAY_PLAN_DATA',

  SYNC_PROGRESS: 'SYNC_PROGRESS',
  SYNC_PROGRESS_RESULT: 'SYNC_PROGRESS_RESULT',

  FINISH_WORKOUT: 'FINISH_WORKOUT',
  FINISH_WORKOUT_RESULT: 'FINISH_WORKOUT_RESULT',

  ABANDON_WORKOUT: 'ABANDON_WORKOUT',
  ABANDON_WORKOUT_RESPONSE: 'ABANDON_WORKOUT_RESPONSE',
};

export const ERROR_CODES = {
  INVALID_ENVELOPE: 'INVALID_ENVELOPE',
  UNSUPPORTED_TYPE: 'UNSUPPORTED_TYPE',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  API_FAILED: 'API_FAILED',
};

function generateId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

export function createMessage({
  type,
  payload = {},
  sessionId = null,
  messageId = generateId(),
  replyToId = null,
}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    messageId,
    type,
    sessionId,
    replyToId,
    payload,
  };
}

export function validateEnvelope(msg) {
  if (!msg || typeof msg !== 'object') {
    return { valid: false, reason: 'Message must be an object' };
  }
  if (msg.protocolVersion !== PROTOCOL_VERSION) {
    return { valid: false, reason: `Unsupported protocol version: ${msg.protocolVersion}` };
  }
  if (typeof msg.messageId !== 'string' || msg.messageId.trim() === '') {
    return { valid: false, reason: 'Missing or invalid messageId' };
  }
  if (!Object.values(MESSAGE_TYPES).includes(msg.type)) {
    return { valid: false, reason: `Unknown message type: ${msg.type}` };
  }
  return { valid: true };
}

export function parseMessage(raw) {
  try {
    const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const validation = validateEnvelope(msg);
    if (!validation.valid) {
      return { valid: false, error: validation.reason };
    }
    return { valid: true, message: msg };
  } catch (err) {
    return { valid: false, error: 'Malformed JSON payload: ' + err.message };
  }
}

export function createPong(incomingMessage, payload = {}) {
  return createMessage({
    type: MESSAGE_TYPES.PONG,
    replyToId: incomingMessage?.messageId || null,
    sessionId: incomingMessage?.sessionId || null,
    payload,
  });
}

export function createError(incomingMessage, code, message) {
  return createMessage({
    type: MESSAGE_TYPES.ERROR,
    replyToId: incomingMessage?.messageId || null,
    sessionId: incomingMessage?.sessionId || null,
    payload: { code, message },
  });
}

export function createReply(incomingMessage, type, payload = {}) {
  return createMessage({
    type,
    replyToId: incomingMessage?.messageId || null,
    sessionId: incomingMessage?.sessionId || null,
    payload,
  });
}
