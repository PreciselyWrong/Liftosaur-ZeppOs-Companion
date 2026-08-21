const TEMPORARY_PHONE_ERRORS = [
  'shake timeout',
  'phone not reachable',
  'request timeout',
];

export function isTemporaryPhoneError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return TEMPORARY_PHONE_ERRORS.some((needle) => message.includes(needle));
}
