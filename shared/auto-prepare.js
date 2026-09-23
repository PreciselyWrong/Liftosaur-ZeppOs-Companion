export function normalizeAutoPrepare(value) {
  let candidate = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch (error) {
      return candidate === 'true';
    }
  }
  if (candidate && typeof candidate === 'object') candidate = candidate.value;
  return candidate === true || candidate === 'true';
}

export function createRestPresentationState() {
  return { restIdentity: null, isPrepared: false };
}

export function updateRestPresentation(previous, rest, autoPrepare) {
  if (!rest) return createRestPresentationState();
  const restIdentity = String(rest.identity ?? rest.startedAt ?? rest.endsAt);
  if (restIdentity === previous?.restIdentity) return previous;
  return { restIdentity, isPrepared: normalizeAutoPrepare(autoPrepare) };
}

const AUTO_PREPARE_STORAGE_KEY = 'liftosaur.autoPrepare';

// Restore presentation before the phone can reply, including while offline.
export function readAutoPreparePreference(storage) {
  try {
    return normalizeAutoPrepare(storage?.getItem(AUTO_PREPARE_STORAGE_KEY));
  } catch (error) {
    return false;
  }
}

export function saveAutoPreparePreference(storage, value) {
  try {
    storage?.setItem(AUTO_PREPARE_STORAGE_KEY, normalizeAutoPrepare(value));
  } catch (error) {
    // A display preference must never prevent local session recovery.
  }
}
