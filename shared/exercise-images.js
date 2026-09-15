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
