import {
  MESSAGE_TYPES,
  validateEnvelope,
  createPong,
  createError,
} from '../shared/protocol.js';

export function createSideRouter() {
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
