export function parseSportDataResult(result, metricType) {
  if (!result || result.code !== 0 || typeof result.data !== 'string') {
    return { ok: false, value: null, error: 'Sport data unavailable' };
  }

  let parsed;
  try {
    parsed = JSON.parse(result.data);
  } catch (err) {
    return { ok: false, value: null, error: 'Malformed sport data' };
  }

  const items = Array.isArray(parsed) ? parsed : [parsed];
  const match = items.find(
    (item) => item && typeof item === 'object' && metricType in item,
  );
  return match
    ? { ok: true, value: String(match[metricType]), error: null }
    : { ok: false, value: null, error: 'Metric not found' };
}

export function parseDurationToSeconds(value) {
  if (typeof value !== 'string' || !/^\d+:\d{2}(?::\d{2})?$/.test(value)) return null;
  const parts = value.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return seconds < 60 ? minutes * 60 + seconds : null;
  }

  const [hours, minutes, seconds] = parts;
  return minutes < 60 && seconds < 60 ? hours * 3600 + minutes * 60 + seconds : null;
}

export function createNativePauseReconciler({ stallThresholdMs = 2500 } = {}) {
  let lastDurationSeconds = null;
  let lastProgressAt = null;
  let focusLostAt = null;
  let focusLostDurationSeconds = null;
  let paused = false;

  function sample({ durationSeconds, timestamp }) {
    if (!Number.isFinite(durationSeconds) || !Number.isFinite(timestamp)) return [];
    const actions = [];

    if (lastDurationSeconds === null || durationSeconds < lastDurationSeconds) {
      lastDurationSeconds = durationSeconds;
      lastProgressAt = timestamp;
      focusLostAt = null;
      focusLostDurationSeconds = null;
      paused = false;
      return actions;
    }

    if (focusLostAt !== null && focusLostDurationSeconds !== null) {
      const wallGapMs = Math.max(0, timestamp - focusLostAt);
      const activeGapMs = Math.max(0, durationSeconds - focusLostDurationSeconds) * 1000;
      const inferredPauseMs = Math.max(0, wallGapMs - activeGapMs);
      const progressedDuringGap = durationSeconds > focusLostDurationSeconds;

      if (!progressedDuringGap) {
        if (!paused && inferredPauseMs >= stallThresholdMs) {
          actions.push({ type: 'pause', timestamp: timestamp - inferredPauseMs });
          paused = true;
        }
      } else {
        if (paused) {
          actions.push({ type: 'resume', timestamp });
        } else if (inferredPauseMs >= stallThresholdMs) {
          actions.push({ type: 'pause', timestamp: timestamp - inferredPauseMs });
          actions.push({ type: 'resume', timestamp });
        }
        paused = false;
      }

      lastProgressAt = timestamp;
      focusLostAt = null;
      focusLostDurationSeconds = null;
    } else if (durationSeconds > lastDurationSeconds) {
      if (paused) {
        actions.push({ type: 'resume', timestamp });
        paused = false;
      }
      lastProgressAt = timestamp;
    } else if (!paused && timestamp - lastProgressAt >= stallThresholdMs) {
      actions.push({ type: 'pause', timestamp: lastProgressAt + 1000 });
      paused = true;
    }

    lastDurationSeconds = durationSeconds;
    return actions;
  }

  return {
    sample,
    loseFocus({ timestamp }) {
      if (!Number.isFinite(timestamp) || lastDurationSeconds === null) return;
      focusLostAt = timestamp;
      focusLostDurationSeconds = lastDurationSeconds;
    },
    reset() {
      lastDurationSeconds = null;
      lastProgressAt = null;
      focusLostAt = null;
      focusLostDurationSeconds = null;
      paused = false;
    },
  };
}
