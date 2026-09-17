export const MAX_EXERCISE_IMAGE_BYTES = 512 * 1024;

export function normalizeExerciseImages(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return false; }
  }
  if (value && typeof value === 'object') return value.value === true || value.value === 'true';
  return value === true;
}

const EQUIPMENTS = ['barbell', 'dumbbell', 'cable', 'bodyweight', 'kettlebell', 'smith', 'band', 'leveragemachine', 'ezbar', 'trapbar', 'medicineball'];

export function mapOgSlugToSingleSmall(ogSlug) {
  for (const eq of EQUIPMENTS) {
    if (ogSlug.startsWith(eq + '-')) {
      const namePart = ogSlug.slice(eq.length + 1).replace(/-/g, '');
      return `${namePart}_${eq}`;
    }
    if (ogSlug.endsWith('-' + eq)) {
      const namePart = ogSlug.slice(0, -(eq.length + 1)).replace(/-/g, '');
      return `${namePart}_${eq}`;
    }
  }
  const noHyphen = ogSlug.replace(/-/g, '');
  return `${noHyphen}_bodyweight`;
}

export function normalizeExerciseImageUrl(value) {
  if (typeof value !== 'string' || value.length > 512) return null;
  const path = value.replace(/^https:\/\/www\.liftosaur\.com/, '');
  const ogMatch = /^\/externalimages\/exercises\/ogimages\/([a-zA-Z0-9_-]+)\.png$/.exec(path);
  if (ogMatch) {
    const slug = mapOgSlugToSingleSmall(ogMatch[1]);
    return `https://www.liftosaur.com/externalimages/exercises/single/small/${slug}_single_small.png`;
  }
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
