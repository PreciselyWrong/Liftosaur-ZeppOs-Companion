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
