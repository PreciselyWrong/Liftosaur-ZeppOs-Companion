export const WORKOUT_DIAGNOSTICS_KEY = 'liftosaur.workout.diagnostics.v1';
export const WORKOUT_DIAGNOSTICS_ENABLED_KEY = 'liftosaur.workout.diagnostics.enabled';

export function normalizeWorkoutDiagnosticsEnabled(value) {
  if (value && typeof value === 'object') return normalizeWorkoutDiagnosticsEnabled(value.value);
  return value === true || value === 'true';
}

export const WORKOUT_DIAGNOSTIC_CODES = Object.freeze({
  BOOT: 'BOOT',
  ACTION_TAP: 'ACTION_TAP',
  RENDER_START: 'RENDER_START',
  RENDER_END: 'RENDER_END',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  BUILD: 'BUILD',
  DIAGNOSTICS_ON: 'DIAGNOSTICS_ON',
  RESTORED: 'RESTORED',
  SET_TAP: 'SET_TAP',
  SET_SAVED: 'SET_SAVED',
  SET_SYNCED: 'SET_SYNCED',
  SET_SYNC_FAILED: 'SET_SYNC_FAILED',
  FINISH_TAP: 'FINISH_TAP',
  FINISH_SAVED: 'FINISH_SAVED',
  FINISH_FAILED: 'FINISH_FAILED',
  PHONE_FAILED: 'PHONE_FAILED',
});

const VERSION = 1;
const MAX_EVENTS = 12;
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;
const VALID_CODES = new Set(Object.values(WORKOUT_DIAGNOSTIC_CODES));
const MEMORY_FIELDS = ['appUsed', 'appPeak', 'systemUsed', 'systemTotal'];

function sanitizeMemory(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const memory = {};
  for (const field of MEMORY_FIELDS) {
    if (Number.isSafeInteger(raw[field]) && raw[field] >= 0) memory[field] = raw[field];
  }
  return Object.keys(memory).length > 0 ? memory : null;
}

export function readWorkoutMemory(getPackageInfo, getPerformance) {
  if (typeof getPackageInfo !== 'function' || typeof getPerformance !== 'function') return null;
  try {
    const appId = getPackageInfo()?.appId;
    const profile = getPerformance('memory')?.memory;
    if (!Number.isSafeInteger(appId) || !profile) return null;
    const app = profile.app?.find((entry) => entry.appid === appId);
    return sanitizeMemory({
      appUsed: app?.used,
      appPeak: app?.peak,
      systemUsed: profile.system?.used,
      systemTotal: profile.system?.total,
    });
  } catch {
    return null;
  }
}

function sanitizeEvents(raw) {
  if (!Array.isArray(raw)) return [];
  const events = [];
  for (const event of raw.slice(-MAX_EVENTS)) {
    if (!event || !VALID_CODES.has(event.code)) continue;
    if (!Number.isSafeInteger(event.at) || event.at < 0 || event.at > MAX_DATE_MILLISECONDS) continue;
    const cleaned = { at: event.at, code: event.code };
    const memory = sanitizeMemory(event.memory);
    if (memory) cleaned.memory = memory;
    events.push(cleaned);
  }
  return events;
}

function reportWithPrevious(events, previousEvents) {
  return {
    version: VERSION,
    events,
    ...(previousEvents.length > 0 ? { previousEvents } : {}),
  };
}

function sanitizeReport(raw) {
  let report = raw;
  if (typeof report === 'string') {
    try {
      report = JSON.parse(report);
    } catch {
      return null;
    }
  }
  if (!report || report.version !== VERSION || !Array.isArray(report.events)) return null;
  return reportWithPrevious(sanitizeEvents(report.events), sanitizeEvents(report.previousEvents));
}

export function createWorkoutDiagnostics(storage, now = () => Date.now(), sampleMemory = () => null) {
  let enabled = false;
  let memory = { version: VERSION, events: [] };
  try {
    enabled = normalizeWorkoutDiagnosticsEnabled(storage?.getItem(WORKOUT_DIAGNOSTICS_ENABLED_KEY));
    if (enabled) memory = sanitizeReport(storage.getItem(WORKOUT_DIAGNOSTICS_KEY)) || memory;
  } catch {
    // Diagnostics must never interfere with the durable workout journal.
  }

  function write(report) {
    memory = report;
    try {
      if (!storage || typeof storage.setItem !== 'function') return false;
      storage.setItem(WORKOUT_DIAGNOSTICS_KEY, JSON.stringify(report));
      return true;
    } catch {
      return false;
    }
  }

  return {
    isEnabled() {
      return enabled;
    },
    setEnabled(value) {
      const next = normalizeWorkoutDiagnosticsEnabled(value);
      enabled = next;
      if (!next) memory = { version: VERSION, events: [] };
      try {
        storage?.setItem(WORKOUT_DIAGNOSTICS_ENABLED_KEY, String(next));
      } catch {
        // Diagnostics must never block workout actions.
      }
      if (!next && storage) {
        try {
          if (typeof storage.removeItem === 'function') storage.removeItem(WORKOUT_DIAGNOSTICS_KEY);
          else storage.setItem(WORKOUT_DIAGNOSTICS_KEY, JSON.stringify(memory));
        } catch {}
      }
      return enabled;
    },
    record(code) {
      if (!enabled) return false;
      if (!VALID_CODES.has(code)) return false;
      try {
        const at = Math.trunc(now());
        if (!Number.isSafeInteger(at) || at < 0 || at > MAX_DATE_MILLISECONDS) return false;
        const event = { at, code };
        const previousEvents = code === WORKOUT_DIAGNOSTIC_CODES.BOOT
          && memory.events.some((entry) => entry.code !== WORKOUT_DIAGNOSTIC_CODES.BOOT)
          ? memory.events.slice(-MAX_EVENTS)
          : (memory.previousEvents || []);
        const events = code === WORKOUT_DIAGNOSTIC_CODES.BOOT
          ? [event]
          : [...memory.events, event].slice(-MAX_EVENTS);
        const report = reportWithPrevious(events, previousEvents);
        write(report);
        let sampled = null;
        try { sampled = sanitizeMemory(sampleMemory(code)); } catch {}
        if (sampled) {
          event.memory = sampled;
          write(report);
        }
        return true;
      } catch {
        return false;
      }
    },
    read() {
      return sanitizeReport(memory);
    },
    replace(report) {
      if (!enabled) return false;
      const sanitized = sanitizeReport(report);
      return sanitized ? write(sanitized) : false;
    },
  };
}

export function formatWorkoutDiagnostics(raw) {
  const report = sanitizeReport(raw);
  if (!report || (report.events.length === 0 && !report.previousEvents?.length)) return 'No watch diagnostics yet';
  const mib = (bytes) => (bytes / (1024 * 1024)).toFixed(1);
  const formatEvent = (event) => {
    const parts = [`${new Date(event.at).toISOString()} ${event.code}`];
    const memory = event.memory;
    if (memory && Number.isSafeInteger(memory.appUsed)) {
      const peak = Number.isSafeInteger(memory.appPeak) ? ` (peak ${mib(memory.appPeak)})` : '';
      parts.push(`app ${mib(memory.appUsed)} MiB${peak}`);
    }
    if (memory && Number.isSafeInteger(memory.systemUsed) && Number.isSafeInteger(memory.systemTotal) && memory.systemTotal >= memory.systemUsed) {
      parts.push(`system free ${mib(memory.systemTotal - memory.systemUsed)}/${mib(memory.systemTotal)} MiB`);
    }
    return parts.join(' | ');
  };
  return [
    ...(report.previousEvents || []).map((event) => `Previous run: ${formatEvent(event)}`),
    ...report.events.map(formatEvent),
  ].join('\n');
}
