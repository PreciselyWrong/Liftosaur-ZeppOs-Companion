const TEMPORARY_PHONE_ERRORS = [
  'shake timeout',
  'phone not reachable',
  'request timeout',
];

const PHONE_RETRY_DELAYS_MS = [750, 1500, 3000];

export const PHONE_CONNECTING_MESSAGE = 'Connecting to phone...';
export const PHONE_CONNECTION_TITLE = 'Phone connection needed';
export const PHONE_REQUEST_TIMEOUT_MS = 20000;

export function isTemporaryPhoneError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return TEMPORARY_PHONE_ERRORS.some((needle) => message.includes(needle));
}

export function nextPhoneRetryDelay(attempt) {
  return PHONE_RETRY_DELAYS_MS[attempt] ?? null;
}

export function phoneConnectionMessage(attempt) {
  return nextPhoneRetryDelay(attempt) === null
    ? 'Zepp connection unavailable. Tap Retry.'
    : 'Waiting for Zepp connection. Retrying automatically...';
}
