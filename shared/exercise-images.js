export const MAX_EXERCISE_IMAGE_BYTES = 512 * 1024;

// Every step at which an exercise image can stop: the phone service reports the first group as
// `${STAGE}_${ERROR}` or a fixed code, the watch client adds the rest.
export const EXERCISE_IMAGE_FAILURES = new Set([
  'INVALID_URL', 'SERVICE_UNAVAILABLE', 'STORAGE_INVALID', 'STORAGE_FULL', 'CONVERSION_IN_PROGRESS',
  'DOWNLOAD_PATH_INVALID', 'CONVERSION_OUTPUT_INVALID',
  'PHONE_DISABLED', 'REQUEST_FAILED', 'TIMEOUT', 'TRANSFER_ERROR', 'TRANSFER_CANCELED', 'FILE_INVALID', 'FILE_TOO_LARGE', 'UNKNOWN',
]);
for (const stage of ['DOWNLOAD', 'CONVERSION', 'TRANSFER']) {
  for (const error of ['SIMULATOR_UNSUPPORTED', 'HTTP_STATUS', 'NATIVE_FAILURE', 'TIMEOUT', 'CANCELED', 'UNEXPECTED']) {
    EXERCISE_IMAGE_FAILURES.add(`${stage}_${error}`);
  }
}

export function normalizeExerciseImages(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return false; }
  }
  if (value && typeof value === 'object') return value.value === true || value.value === 'true';
  return value === true;
}

export function normalizeExerciseImageUrl(value) {
  if (typeof value !== 'string' || value.length > 512) return null;
  const path = value.replace(/^https:\/\/www\.liftosaur\.com/, '');
  if (/^\/externalimages\/exercises\/(?:[a-zA-Z0-9_-]+\/)+[a-zA-Z0-9_-]+\.png$/.test(path)) {
    return `https://www.liftosaur.com${path}`;
  }
  const match = /^https:\/\/([^/?#]+)(\/[^?#\s]*)$/i.exec(value);
  if (!match || !/\.(?:gif|jpe?g|png|webp)$/i.test(match[2])) return null;
  const host = match[1].toLowerCase();
  if (host.includes('@') || host.includes(':') || !host.includes('.') ||
      host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      /^\d+(?:\.\d+){3}$/.test(host) ||
      !host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) return null;
  return value;
}

export function exerciseImageFileExtension(value) {
  const url = normalizeExerciseImageUrl(value);
  return url ? /\.([a-z0-9]+)$/i.exec(url)?.[1].toLowerCase() || null : null;
}

export function exerciseDownloadUrl(value) {
  const url = normalizeExerciseImageUrl(value);
  if (!url) return null;
  if (!/\.png$/i.test(url)) return url;
  return `https://wsrv.nl/exercise.png?url=${encodeURIComponent(url)}&w=140&h=140&fit=contain&cbg=white&bg=white&output=png`;
}


