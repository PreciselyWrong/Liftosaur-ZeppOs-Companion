export const MAX_EXERCISE_IMAGE_BYTES = 512 * 1024;

export function normalizeExerciseImages(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return false; }
  }
  if (value && typeof value === 'object') return value.value === true || value.value === 'true';
  return value === true;
}

export function normalizeExerciseImageUrl(value) {
  if (typeof value !== 'string' || value.length > 512) return null;
  const path = value.replace(/^https:\/\/www\.liftosaur\.com/, '');
  return /^\/externalimages\/exercises\/(?:[a-zA-Z0-9_-]+\/)+[a-zA-Z0-9_-]+\.png$/.test(path)
    ? `https://www.liftosaur.com${path}` : null;
}
