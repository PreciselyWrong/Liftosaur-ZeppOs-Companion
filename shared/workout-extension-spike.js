import { MESSAGE_TYPES } from './protocol.js';

export const EXTENSION_SPIKE_STORAGE_KEY = 'liftosaur.extension.spike';

export const DEFAULT_SPIKE_STATE = Object.freeze({
  clickCount: 0,
  startedAt: null,
  pausedDuration: 0,
  lastPausedAt: null,
});

export function deserializeSpikeState(raw) {
  if (!raw) return { ...DEFAULT_SPIKE_STATE };
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_SPIKE_STATE };
    }
  }
  if (!data || typeof data !== 'object') {
    return { ...DEFAULT_SPIKE_STATE };
  }

  const clickCount = Number.isInteger(data.clickCount) && data.clickCount >= 0 ? data.clickCount : 0;
  const startedAt = Number.isFinite(data.startedAt) && data.startedAt > 0 ? data.startedAt : null;
  const pausedDuration =
    Number.isFinite(data.pausedDuration) && data.pausedDuration >= 0 ? data.pausedDuration : 0;
  const lastPausedAt =
    Number.isFinite(data.lastPausedAt) && data.lastPausedAt > 0 ? data.lastPausedAt : null;

  return {
    clickCount,
    startedAt,
    pausedDuration,
    lastPausedAt,
  };
}

export function serializeSpikeState(state) {
  return JSON.stringify(state);
}

export function createSpikeSession(initialState = {}) {
  let state = deserializeSpikeState(initialState);

  return {
    getState() {
      return { ...state };
    },
    incrementClicks() {
      state = { ...state, clickCount: state.clickCount + 1 };
      return { ...state };
    },
    start(now = Date.now()) {
      if (!state.startedAt) {
        state = { ...state, startedAt: now };
      }
      return { ...state };
    },
    pause(now = Date.now()) {
      if (state.startedAt && !state.lastPausedAt) {
        state = { ...state, lastPausedAt: now };
      }
      return { ...state };
    },
    resume(now = Date.now()) {
      if (state.lastPausedAt) {
        const added = Math.max(0, now - state.lastPausedAt);
        state = {
          ...state,
          pausedDuration: state.pausedDuration + added,
          lastPausedAt: null,
        };
      }
      return { ...state };
    },
    getElapsedSeconds(now = Date.now()) {
      if (!state.startedAt) return 0;
      const current = state.lastPausedAt ? state.lastPausedAt : now;
      const elapsedMs = Math.max(0, current - state.startedAt - state.pausedDuration);
      return Math.floor(elapsedMs / 1000);
    },
    formatElapsed(now = Date.now()) {
      const totalSeconds = this.getElapsedSeconds(now);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      const secStr = String(seconds).padStart(2, '0');

      if (hours > 0) {
        const minStr = String(minutes).padStart(2, '0');
        return `${hours}:${minStr}:${secStr}`;
      }
      return `${minutes}:${secStr}`;
    },
  };
}

export function parseSportDataResult(result, metricType = 'duration') {
  if (!result || result.code !== 0) {
    return { ok: false, value: null, error: 'Sport data unavailable' };
  }
  if (!result.data || typeof result.data !== 'string') {
    return { ok: false, value: null, error: 'Malformed sport data' };
  }

  let parsed;
  try {
    parsed = JSON.parse(result.data);
  } catch {
    return { ok: false, value: null, error: 'Malformed sport data' };
  }

  const items = Array.isArray(parsed) ? parsed : [parsed];
  for (const item of items) {
    if (item && typeof item === 'object' && metricType in item) {
      return { ok: true, value: String(item[metricType]), error: null };
    }
  }

  return { ok: false, value: null, error: 'Metric not found' };
}

export function parsePingResponse(response) {
  if (!response) {
    return { ok: false, status: 'FAILED', code: null, error: 'No response' };
  }
  if (response instanceof Error) {
    return {
      ok: false,
      status: 'FAILED',
      code: response.code || null,
      error: response.message || 'Error',
    };
  }
  if (response.type === MESSAGE_TYPES.PONG) {
    return {
      ok: true,
      status: 'PONG',
      serverTime: response.payload?.serverTime ?? null,
      error: null,
    };
  }
  if (response.type === MESSAGE_TYPES.ERROR) {
    return {
      ok: false,
      status: 'ERROR',
      code: response.payload?.code || null,
      error: response.payload?.message || 'Side service error',
    };
  }
  return { ok: false, status: 'FAILED', code: null, error: 'Unexpected response' };
}

export function formatPingStatus(pingState) {
  if (!pingState) return 'PING: --';
  if (pingState.ok) return 'PING: OK';
  if (pingState.status === 'ERROR') return 'PING: ERROR';
  return 'PING: FAILED';
}
