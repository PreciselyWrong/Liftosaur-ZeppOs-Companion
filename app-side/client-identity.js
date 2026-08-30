/**
 * Persistent device identity management for Liftosaur Cloud.
 *
 * Keeps a stable, low-cardinality device ID stored in Zepp settingsStorage.
 * The ID is created once on first run and reused on all subsequent runs.
 * It is never emitted in log streams.
 */

function extractDeviceId(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const str = raw.trim();
    if (str.length === 0) return null;
    if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith('{') && str.endsWith('}'))) {
      try {
        const parsed = JSON.parse(str);
        return extractDeviceId(parsed);
      } catch (e) {
        // Not JSON
      }
    }
    return str;
  }
  if (typeof raw === 'object' && raw !== null) {
    if (typeof raw.value === 'string') return extractDeviceId(raw.value);
    if (typeof raw.deviceId === 'string') return extractDeviceId(raw.deviceId);
  }
  return null;
}

export function getOrCreateClientIdentity(storage, { now, random } = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new TypeError('Invalid settings storage');
  }

  const existingRaw = storage.getItem('liftosaurDeviceId');
  const existing = extractDeviceId(existingRaw);
  if (existing) {
    return existing;
  }

  const timeVal = typeof now === 'function' ? now() : (Number.isFinite(now) ? now : Date.now());
  const randVal = typeof random === 'function' ? random() : (random !== undefined ? random : Math.random());
  const timePart = Number(timeVal).toString(36);
  const randPart = typeof randVal === 'number'
    ? randVal.toString(36).slice(2, 10).padEnd(8, '0')
    : String(randVal).padEnd(8, '0').slice(0, 8);
  const newId = `${timePart}-${randPart}`;

  storage.setItem('liftosaurDeviceId', newId);
  return newId;
}
