/**
 * Pure protocol implementation for Device ↔ Side Service communication.
 * No framework / Zepp OS dependencies: runnable in Node, Device, and Side App.
 */

export const PROTOCOL_VERSION = 1;

export const MESSAGE_TYPES = {
  PING: 'PING',
  PONG: 'PONG',
  ERROR: 'ERROR',
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
    payload: {
      code,
      message,
    },
  });
}
