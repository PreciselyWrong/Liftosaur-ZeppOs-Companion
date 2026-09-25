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
  CLEAR_START: 'CLEAR_START',
  CLEAR_END: 'CLEAR_END',
  SCREEN_START: 'SCREEN_START',
  SCREEN_END: 'SCREEN_END',
  REDRAW_START: 'REDRAW_START',
  REDRAW_END: 'REDRAW_END',
  ACTION_DONE: 'ACTION_DONE',
  JS_ERROR: 'JS_ERROR',
  HEARTBEAT: 'HEARTBEAT',
  VIBRATION_START: 'VIBRATION_START',
  VIBRATION_END: 'VIBRATION_END',
  IMAGE_READY: 'IMAGE_READY',
  IMAGE_UNAVAILABLE: 'IMAGE_UNAVAILABLE',
});

const VERSION = 1;
const MAX_EVENTS = 12;
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;
const VALID_CODES = new Set(Object.values(WORKOUT_DIAGNOSTIC_CODES));
const MEMORY_FIELDS = ['appUsed', 'appPeak', 'systemUsed', 'systemTotal'];
const MAX_REPORT_BYTES = 16 * 1024;
const MEMORY_INTERVAL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const VALID_ACTIONS = new Set([
  'START_SET', 'COMPLETE_SET', 'INCREASE_WEIGHT', 'DECREASE_WEIGHT', 'INCREASE_REPS', 'DECREASE_REPS',
  'INCREASE_RPE', 'DECREASE_RPE', 'PAUSE', 'RESUME', 'SKIP_WARMUP', 'NEXT_EXERCISE', 'PREVIOUS_EXERCISE',
  'SELECT_EXERCISE', 'OPEN_INFO', 'NEXT_INFO', 'PREVIOUS_INFO', 'CLOSE_MODAL', 'BACK', 'OPEN_MENU', 'START_WORKOUT',
  'FINISH_WORKOUT', 'DISCARD_WORKOUT', 'BUTTON', 'UNKNOWN',
]);
const VALID_SCREENS = new Set(['LOADING', 'CONNECTION', 'SETUP', 'EMPTY', 'HOME', 'PROGRAMS', 'WEEKS', 'DAYS', 'SESSION', 'UNKNOWN']);
const VALID_STATES = new Set(['NO_PLAN', 'IDLE', 'READY', 'ACTIVE_SET', 'REST', 'PAUSED', 'FINISHED', 'UNKNOWN']);
const VALID_PHASES = new Set(['CLEAR', 'SCREEN', 'REDRAW', 'ACTION', 'VIBRATION', 'IMAGE', 'UNKNOWN']);

function safeEnum(value, allowed) {
  return typeof value === 'string' && allowed.has(value) ? value : undefined;
}

function sanitizeRuntime(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const result = {};
  if (raw.product === 'companion' || raw.product === 'workout') result.product = raw.product;
  if (raw.revision === 'crash-trace-1') result.revision = raw.revision;
  for (const field of ['appVersion', 'firmware', 'os', 'api']) {
    if (typeof raw[field] === 'string' && raw[field].length <= 48 && /^(?:v)?\d+(?:\.\d+){0,5}$/i.test(raw[field])) result[field] = raw[field];
  }
  for (const field of ['appCode', 'deviceSource', 'width', 'height', 'screenShape']) {
    if (Number.isSafeInteger(raw[field]) && raw[field] >= 0) result[field] = raw[field];
  }
  return Object.keys(result).length ? result : undefined;
}

function sanitizeContext(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const context = {};
  const action = safeEnum(raw.action, VALID_ACTIONS);
  const screen = safeEnum(raw.screen, VALID_SCREENS);
  const state = safeEnum(raw.state, VALID_STATES);
  const phase = safeEnum(raw.phase, VALID_PHASES);
  if (action) context.action = action;
  if (screen) context.screen = screen;
  if (state) context.state = state;
  if (phase) context.phase = phase;
  if (Number.isSafeInteger(raw.widgets) && raw.widgets >= 0 && raw.widgets <= 500) context.widgets = raw.widgets;
  for (const field of ['modal', 'overview', 'preparation', 'imagesEnabled']) {
    if (typeof raw[field] === 'boolean') context[field] = raw[field];
  }
  const errorClass = safeEnum(raw.errorClass, new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'UNKNOWN']));
  if (errorClass) context.errorClass = errorClass;
  return Object.keys(context).length ? context : undefined;
}

function sanitizeDetail(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const result = {};
  const runtime = sanitizeRuntime(raw.runtime);
  if (runtime) result.runtime = runtime;
  for (const field of ['lastAction', 'lastError', 'lastMemory']) {
    const value = raw[field];
    if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.at) || value.at < 0 || value.at > MAX_DATE_MILLISECONDS) continue;
    if (field === 'lastMemory') {
      const memory = sanitizeMemory(value.memory);
      if (memory) result.lastMemory = { at: value.at, memory };
    } else {
      const context = sanitizeContext(value.context);
      if (context) result[field] = { at: value.at, context };
    }
  }
  return Object.keys(result).length ? result : undefined;
}

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
    const context = sanitizeContext(event.context);
    if (context) cleaned.context = context;
    events.push(cleaned);
  }
  return events;
}

function reportWithPrevious(events, previousEvents, details, previousDetails) {
  return {
    version: VERSION,
    events,
    ...(previousEvents.length > 0 ? { previousEvents } : {}),
    ...(details ? { details } : {}),
    ...(previousDetails ? { previousDetails } : {}),
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
  const clean = reportWithPrevious(
    sanitizeEvents(report.events),
    sanitizeEvents(report.previousEvents),
    sanitizeDetail(report.details),
    sanitizeDetail(report.previousDetails),
  );
  return JSON.stringify(clean).length <= MAX_REPORT_BYTES ? clean : reportWithPrevious(clean.events.slice(-4), clean.previousEvents.slice(-4));
}

export function readWorkoutRuntimeInfo(product, getPackageInfo, deviceInfo, getSystemInfo) {
  const result = { product: product === 'companion' ? 'companion' : 'workout', revision: 'crash-trace-1' };
  try {
    // Zepp's QuickJS compiler rejects optional direct calls inside its with wrapper.
    const info = typeof getPackageInfo === 'function' ? getPackageInfo() : null;
    if (typeof info?.version?.name === 'string') result.appVersion = info.version.name;
    else if (typeof info?.version === 'string') result.appVersion = info.version;
    if (Number.isSafeInteger(info?.version?.code)) result.appCode = info.version.code;
  } catch {}
  if (deviceInfo && typeof deviceInfo === 'object') {
    for (const field of ['deviceSource', 'width', 'height', 'screenShape']) {
      if (Number.isSafeInteger(deviceInfo[field]) && deviceInfo[field] >= 0) result[field] = deviceInfo[field];
    }
  }
  try {
    const info = typeof getSystemInfo === 'function' ? getSystemInfo() : null;
    if (typeof info?.firmwareVersion === 'string') result.firmware = info.firmwareVersion;
    if (typeof info?.osVersion === 'string') result.os = info.osVersion;
    if (typeof info?.minAPI === 'string') result.api = info.minAPI;
  } catch {}
  return sanitizeRuntime(result) || { product: result.product, revision: result.revision };
}

export function createWorkoutDiagnostics(storage, now = () => Date.now(), sampleMemory = () => null, providers = {}) {
  let enabled = false;
  let memory = { version: VERSION, events: [] };
  let runtimeReadAttempted = false;
  let lastHeartbeatAt = -Infinity;
  let lastMemoryAttemptAt = -Infinity;
  try {
    enabled = normalizeWorkoutDiagnosticsEnabled(storage?.getItem(WORKOUT_DIAGNOSTICS_ENABLED_KEY));
    if (enabled) memory = sanitizeReport(storage.getItem(WORKOUT_DIAGNOSTICS_KEY)) || memory;
  } catch {
    // Diagnostics must never interfere with the durable workout journal.
  }

  function write(report) {
    memory = sanitizeReport(report) || { version: VERSION, events: [] };
    try {
      if (!storage || typeof storage.setItem !== 'function') return false;
      storage.setItem(WORKOUT_DIAGNOSTICS_KEY, JSON.stringify(memory));
      return true;
    } catch {
      return false;
    }
  }

  let recorder;
  function recordEvent(code, context) {
    return recorder.record(code, context);
  }

  recorder = {
    isEnabled() {
      return enabled;
    },
    setEnabled(value) {
      const next = normalizeWorkoutDiagnosticsEnabled(value);
      const wasEnabled = enabled;
      enabled = next;
      if (!next) memory = { version: VERSION, events: [] };
      if (next !== wasEnabled) {
        runtimeReadAttempted = false;
        lastHeartbeatAt = -Infinity;
        lastMemoryAttemptAt = -Infinity;
      }
      try {
        storage?.setItem(WORKOUT_DIAGNOSTICS_ENABLED_KEY, String(next));
      } catch {
        // Diagnostics must never block workout actions.
      }
      if (!next && storage) {
        try {
          if (typeof storage.removeItem === 'function') storage.removeItem(WORKOUT_DIAGNOSTICS_KEY);
          else storage.setItem(WORKOUT_DIAGNOSTICS_KEY, JSON.stringify(memory));
        } catch {
          try { storage.setItem(WORKOUT_DIAGNOSTICS_KEY, JSON.stringify(memory)); } catch {}
        }
      }
      return enabled;
    },
    record(code, rawContext) {
      if (!enabled) return false;
      if (!VALID_CODES.has(code)) return false;
      try {
        const at = Math.trunc(now());
        if (!Number.isSafeInteger(at) || at < 0 || at > MAX_DATE_MILLISECONDS) return false;
        let baseContext = null;
        if (code !== WORKOUT_DIAGNOSTIC_CODES.JS_ERROR) {
          try { baseContext = typeof providers.context === 'function' ? providers.context() : null; } catch {}
        }
        const context = sanitizeContext({ ...(baseContext || {}), ...(rawContext || {}) });
        const event = { at, code, ...(context ? { context } : {}) };
        const previousHasAction = Boolean(memory.details?.lastAction || memory.details?.lastError);
        const isBoot = code === WORKOUT_DIAGNOSTIC_CODES.BOOT;
        const hasUserEvidence = memory.events.some((entry) => [WORKOUT_DIAGNOSTIC_CODES.ACTION_TAP, WORKOUT_DIAGNOSTIC_CODES.SET_TAP, WORKOUT_DIAGNOSTIC_CODES.FINISH_TAP].includes(entry.code));
        const hasStartupFailureEvidence = !memory.previousEvents?.length && memory.events.length > 1;
        const hasMeaningfulEvidence = previousHasAction || hasUserEvidence || hasStartupFailureEvidence;
        const previousEvents = isBoot && hasMeaningfulEvidence ? memory.events.slice(-MAX_EVENTS) : (memory.previousEvents || []);
        const previousDetails = isBoot && hasMeaningfulEvidence ? memory.details : memory.previousDetails;
        let details = isBoot ? {} : (memory.details || {});
        let runtime = details.runtime;
        if (isBoot) runtimeReadAttempted = false;
        if (!runtimeReadAttempted && typeof providers.runtime === 'function') {
          runtimeReadAttempted = true;
          try { runtime = sanitizeRuntime(providers.runtime()) || runtime; } catch {}
        }
        if (runtime) details = { ...details, runtime };
        if (code === WORKOUT_DIAGNOSTIC_CODES.ACTION_TAP && context?.action) details = { ...details, lastAction: { at, context } };
        if (code === WORKOUT_DIAGNOSTIC_CODES.JS_ERROR && context?.errorClass && context?.phase) details = { ...details, lastError: { at, context } };
        const events = code === WORKOUT_DIAGNOSTIC_CODES.BOOT
          ? [event]
          : [...memory.events, event].slice(-MAX_EVENTS);
        let report = reportWithPrevious(events, previousEvents, details, previousDetails);
        write(report);
        if ((code === WORKOUT_DIAGNOSTIC_CODES.BUILD || code === WORKOUT_DIAGNOSTIC_CODES.RESTORED || code === WORKOUT_DIAGNOSTIC_CODES.SET_TAP || code === WORKOUT_DIAGNOSTIC_CODES.SET_SAVED || code === WORKOUT_DIAGNOSTIC_CODES.HEARTBEAT || code === WORKOUT_DIAGNOSTIC_CODES.RENDER_END) && at - lastMemoryAttemptAt >= MEMORY_INTERVAL_MS) {
          lastMemoryAttemptAt = at;
          let sampled = null;
          try { sampled = sanitizeMemory(sampleMemory(code)); } catch {}
          if (sampled) {
            details = { ...details, lastMemory: { at, memory: sampled } };
            event.memory = sampled;
            report = reportWithPrevious(events, previousEvents, details, previousDetails);
            write(report);
          }
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
    heartbeat() {
      if (!enabled) return false;
      let at;
      try { at = Math.trunc(now()); } catch { return false; }
      if (!Number.isSafeInteger(at) || at - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) return false;
      lastHeartbeatAt = at;
      return recordEvent(WORKOUT_DIAGNOSTIC_CODES.HEARTBEAT);
    },
    trace(phase, operation) {
      if (typeof operation !== 'function') return undefined;
      if (!enabled) return operation();
      try {
        const result = operation();
        if (phase === 'ACTION') recordEvent(WORKOUT_DIAGNOSTIC_CODES.ACTION_DONE);
        return result;
      } catch (error) {
        let errorClass = 'UNKNOWN';
        try { if (['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError'].includes(error?.constructor?.name)) errorClass = error.constructor.name; } catch {}
        const eventContext = sanitizeContext({ phase, errorClass });
        if (eventContext) recordEvent(WORKOUT_DIAGNOSTIC_CODES.JS_ERROR, eventContext);
        throw error;
      }
    },
  };
  return recorder;
}

export function formatWorkoutDiagnostics(raw) {
  const report = sanitizeReport(raw);
  if (!report || (report.events.length === 0 && !report.previousEvents?.length)) return 'No watch diagnostics yet';
  const mib = (bytes) => (bytes / (1024 * 1024)).toFixed(1);
  const formatEvent = (event, index, runEvents) => {
    const elapsedMs = index === 0 ? null : event.at - runEvents[index - 1].at;
    const interval = elapsedMs === null ? ''
      : (elapsedMs < 0 ? ' (clock moved backwards)' : ` (+${elapsedMs}ms)`);
    const parts = [`${new Date(event.at).toISOString()} UTC ${event.code}${interval}`];
    if (event.context) {
      const context = event.context;
      parts.push([
        context.action && `action ${context.action}`,
        context.screen && `screen ${context.screen}`,
        context.state && `state ${context.state}`,
        context.phase && `phase ${context.phase}`,
        Number.isSafeInteger(context.widgets) && `widgets ${context.widgets}`,
        context.errorClass && `error ${context.errorClass}`,
        typeof context.modal === 'boolean' && `modal ${context.modal ? 'open' : 'closed'}`,
        typeof context.overview === 'boolean' && `overview ${context.overview ? 'open' : 'closed'}`,
        typeof context.preparation === 'boolean' && `preparation ${context.preparation ? 'on' : 'off'}`,
        typeof context.imagesEnabled === 'boolean' && `images ${context.imagesEnabled ? 'on' : 'off'}`,
      ].filter(Boolean).join(' '));
    }
    const memory = event.memory;
    if (memory && Number.isSafeInteger(memory.appUsed)) {
      const peak = Number.isSafeInteger(memory.appPeak) ? ` (peak ${mib(memory.appPeak)} MiB)` : '';
      parts.push(`app ${mib(memory.appUsed)} MiB${peak}`);
    }
    if (memory && Number.isSafeInteger(memory.systemUsed) && Number.isSafeInteger(memory.systemTotal) && memory.systemTotal >= memory.systemUsed) {
      parts.push(`system free ${mib(memory.systemTotal - memory.systemUsed)}/${mib(memory.systemTotal)} MiB`);
    }
    return parts.join(' | ');
  };

  const lines = [
    'Latest snapshot received from the watch. The last event does not prove the crash cause.',
  ];

  const formatDetails = (label, details) => {
    if (!details) return;
    lines.push(`${label} details:`);
    const runtime = details.runtime;
    if (runtime) lines.push(`Runtime: ${runtime.product || 'unknown'} revision ${runtime.revision || 'unknown'} app ${runtime.appVersion || 'unknown'} (${runtime.appCode ?? 'unknown'}), firmware ${runtime.firmware || 'unknown'}, OS ${runtime.os || 'unknown'}, API ${runtime.api || 'unknown'}, device source ${runtime.deviceSource ?? 'unknown'}, screen ${runtime.width ?? 'unknown'}x${runtime.height ?? 'unknown'} shape ${runtime.screenShape ?? 'unknown'}`);
    if (details.lastAction) lines.push(`Last action at ${new Date(details.lastAction.at).toISOString()} UTC: ${details.lastAction.context.action || 'unknown'}${details.lastAction.context.screen ? ` on ${details.lastAction.context.screen}` : ''}${details.lastAction.context.state ? ` in ${details.lastAction.context.state}` : ''}`);
    if (details.lastError) lines.push(`Last JavaScript error at ${new Date(details.lastError.at).toISOString()} UTC: ${details.lastError.context.errorClass || 'unknown'} during ${details.lastError.context.phase || 'unknown'}`);
    if (details.lastMemory) lines.push(`Memory sample at ${new Date(details.lastMemory.at).toISOString()} UTC: ${JSON.stringify(details.lastMemory.memory)}`);
  };
  formatDetails('Previous run', report.previousDetails);
  formatDetails('Current run', report.details);

  if (report.previousEvents?.length) {
    const count = report.previousEvents.length;
    lines.push(`Previous run (${count} ${count === 1 ? 'event' : 'events'}, latest ${MAX_EVENTS} retained):`);
    for (let index = 0; index < count; index++) {
      lines.push(formatEvent(report.previousEvents[index], index, report.previousEvents));
    }
  }

  if (report.events?.length) {
    const count = report.events.length;
    lines.push(`Current run (${count} ${count === 1 ? 'event' : 'events'}, latest ${MAX_EVENTS} retained):`);
    for (let index = 0; index < count; index++) {
      lines.push(formatEvent(report.events[index], index, report.events));
    }
  }

  return lines.join('\n');
}
