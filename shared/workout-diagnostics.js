import { ERROR_CODES, MESSAGE_TYPES } from './protocol.js';
import { EXERCISE_IMAGE_FAILURES } from './exercise-images.js';

export const WORKOUT_DIAGNOSTICS_KEY = 'liftosaur.workout.diagnostics.v1';
export const WORKOUT_DIAGNOSTICS_ENABLED_KEY = 'liftosaur.workout.diagnostics.enabled';

const DIAGNOSTICS_FILES = ['lifto-diagnostics-a.json', 'lifto-diagnostics-b.json'];
const DIAGNOSTICS_LOG = 'lifto-diagnostics.log';

function readDiagnosticsCopy(readFileSync, path) {
  try {
    const copy = JSON.parse(readFileSync({ path, options: { encoding: 'utf8' } }));
    const valid = Number.isSafeInteger(copy?.sequence) && copy.values && typeof copy.values === 'object' && !Array.isArray(copy.values);
    return valid ? copy : null;
  } catch {
    return null;
  }
}

// Steps hold only allowlisted ASCII values, so each character is one byte.
function asciiBuffer(text) {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    bytes[index] = code < 0x80 ? code : 0x3f;
  }
  return bytes.buffer;
}

// LocalStorage rewrites every key, the session included, on each save; a report kept there
// made every set save heavier, so the watch keeps it in its own files. A restart during a write
// can leave that file empty, so writes alternate between two copies and the newest valid one wins.
// Rewriting that report on every tap cost the watch over half a second, so each step is appended
// to a log instead and folded into the report only from time to time.
export function createFileDiagnosticsStorage(fs, paths = DIAGNOSTICS_FILES, logPath = DIAGNOSTICS_LOG) {
  const { readFileSync, writeFileSync } = fs;
  let values = null;
  let sequence = 0;
  let target = 0;
  function load() {
    if (values) return values;
    const copies = paths.map((path) => readDiagnosticsCopy(readFileSync, path));
    const newest = copies[1] && (!copies[0] || copies[1].sequence > copies[0].sequence) ? 1 : 0;
    values = copies[newest]?.values || {};
    sequence = copies[newest]?.sequence || 0;
    target = 1 - newest;
    return values;
  }
  function save() {
    writeFileSync({ path: paths[target], data: JSON.stringify({ sequence: sequence + 1, values }), options: { encoding: 'utf8' } });
    // A failed write retries the same copy, so the last complete report is never overwritten.
    sequence += 1;
    target = 1 - target;
  }
  return {
    getItem: (key) => load()[key],
    setItem: (key, value) => {
      load()[key] = value;
      save();
    },
    removeItem: (key) => {
      delete load()[key];
      // A cleared report must not linger in the older copy.
      save();
      save();
    },
    // Each batch starts a new line, so a line cut short by a restart never swallows the next one.
    appendLines(lines) {
      const fd = fs.openSync({ path: logPath, flag: fs.O_WRONLY | fs.O_CREAT | fs.O_APPEND });
      try {
        fs.writeSync({ fd, buffer: asciiBuffer(`\n${lines.join('\n')}`) });
      } finally {
        fs.closeSync({ fd });
      }
    },
    readLines() {
      try {
        const text = readFileSync({ path: logPath, options: { encoding: 'utf8' } });
        return typeof text === 'string' ? text.split('\n').filter(Boolean) : [];
      } catch {
        return [];
      }
    },
    clearLines() {
      writeFileSync({ path: logPath, data: '', options: { encoding: 'utf8' } });
    },
  };
}

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
  PHONE_REQUEST: 'PHONE_REQUEST',
  PHONE_REPLY: 'PHONE_REPLY',
});

const VERSION = 1;
const MAX_EVENTS = 12;
// A reopening where the user taps must not push the crashed run out of the report.
const MAX_PREVIOUS_RUNS = 3;
const EVENTS_PER_RUN_WHEN_FULL = 6;
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;
const VALID_CODES = new Set(Object.values(WORKOUT_DIAGNOSTIC_CODES));
const IMAGE_OUTCOMES = new Set([WORKOUT_DIAGNOSTIC_CODES.IMAGE_READY, WORKOUT_DIAGNOSTIC_CODES.IMAGE_UNAVAILABLE]);
const MEMORY_FIELDS = ['appUsed', 'appPeak', 'systemUsed', 'systemTotal'];
const MAX_REPORT_BYTES = 16 * 1024;
// Folding rewrites the whole report, so it waits for a few hundred short steps.
const FOLD_AFTER_LINES = 400;
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
const VALID_REQUESTS = new Set(Object.values(MESSAGE_TYPES));
const VALID_FAILURES = new Set(['TIMEOUT', 'UNKNOWN', ...Object.values(ERROR_CODES)]);

// Minimum milliseconds between memory probes per code. Periodic probes bound their cost; taps, handler
// ends and phone traffic show where memory goes before a restart, so each request and reply is sampled.
const MEMORY_INTERVAL_MS_BY_CODE = new Map([
  [WORKOUT_DIAGNOSTIC_CODES.BUILD, 30_000],
  [WORKOUT_DIAGNOSTIC_CODES.RESTORED, 30_000],
  [WORKOUT_DIAGNOSTIC_CODES.SET_TAP, 30_000],
  [WORKOUT_DIAGNOSTIC_CODES.SET_SAVED, 30_000],
  [WORKOUT_DIAGNOSTIC_CODES.HEARTBEAT, 30_000],
  [WORKOUT_DIAGNOSTIC_CODES.RENDER_END, 30_000],
  [WORKOUT_DIAGNOSTIC_CODES.ACTION_TAP, 250],
  [WORKOUT_DIAGNOSTIC_CODES.ACTION_DONE, 250],
  [WORKOUT_DIAGNOSTIC_CODES.PHONE_REQUEST, 0],
  [WORKOUT_DIAGNOSTIC_CODES.PHONE_REPLY, 0],
]);

// Intermediate drawing markers must not rebuild the full session view.
const CONTEXT_FREE_CODES = new Set([
  WORKOUT_DIAGNOSTIC_CODES.CLEAR_START,
  WORKOUT_DIAGNOSTIC_CODES.CLEAR_END,
  WORKOUT_DIAGNOSTIC_CODES.SCREEN_START,
  WORKOUT_DIAGNOSTIC_CODES.SCREEN_END,
  WORKOUT_DIAGNOSTIC_CODES.REDRAW_START,
  WORKOUT_DIAGNOSTIC_CODES.REDRAW_END,
  WORKOUT_DIAGNOSTIC_CODES.ACTION_DONE,
  WORKOUT_DIAGNOSTIC_CODES.JS_ERROR,
]);

// A restart while a reply is arriving must still show which request was pending.
const SYNCHRONOUS_WRITE_CODES = new Set([
  WORKOUT_DIAGNOSTIC_CODES.ACTION_TAP,
  WORKOUT_DIAGNOSTIC_CODES.PHONE_REQUEST,
  WORKOUT_DIAGNOSTIC_CODES.JS_ERROR,
  WORKOUT_DIAGNOSTIC_CODES.BOOT,
  WORKOUT_DIAGNOSTIC_CODES.PAUSE,
]);

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
  const request = safeEnum(raw.request, VALID_REQUESTS);
  if (request) context.request = request;
  const failure = safeEnum(raw.failure, VALID_FAILURES);
  if (failure) context.failure = failure;
  const image = safeEnum(raw.image, EXERCISE_IMAGE_FAILURES);
  if (image) context.image = image;
  if (Number.isSafeInteger(raw.httpStatus) && raw.httpStatus >= 100 && raw.httpStatus <= 599) context.httpStatus = raw.httpStatus;
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
  const lastImage = raw.lastImage;
  if (lastImage && Number.isSafeInteger(lastImage.at) && lastImage.at >= 0 && lastImage.at <= MAX_DATE_MILLISECONDS
    && IMAGE_OUTCOMES.has(lastImage.code)) {
    const context = sanitizeContext(lastImage.context);
    result.lastImage = { at: lastImage.at, code: lastImage.code, ...(context ? { context } : {}) };
  }
  const images = raw.images;
  if (images && ['ready', 'unavailable'].every((field) => Number.isSafeInteger(images[field]) && images[field] >= 0)) {
    result.images = { ready: images.ready, unavailable: images.unavailable };
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

function buildReport(events, details, previousRuns = []) {
  return {
    version: VERSION,
    events,
    ...(details ? { details } : {}),
    ...(previousRuns.length > 0 ? { previousRuns } : {}),
  };
}

function sanitizeRun(raw) {
  const events = sanitizeEvents(raw?.events);
  const details = sanitizeDetail(raw?.details);
  return events.length > 0 || details ? { events, ...(details ? { details } : {}) } : null;
}

// Trims events before whole runs so every retained run keeps its last action and runtime.
function fitReport(report) {
  const fits = (candidate) => JSON.stringify(candidate).length <= MAX_REPORT_BYTES;
  if (fits(report)) return report;
  let runs = (report.previousRuns || []).map((run) => ({ ...run, events: run.events.slice(-EVENTS_PER_RUN_WHEN_FULL) }));
  const events = report.events.slice(-EVENTS_PER_RUN_WHEN_FULL);
  let trimmed = buildReport(events, report.details, runs);
  while (!fits(trimmed) && runs.length > 0) {
    runs = runs.slice(0, -1);
    trimmed = buildReport(events, report.details, runs);
  }
  return fits(trimmed) ? trimmed : buildReport(events.slice(-4));
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
  const previousRuns = (Array.isArray(report.previousRuns) ? report.previousRuns : [])
    .slice(0, MAX_PREVIOUS_RUNS)
    .map(sanitizeRun)
    .filter(Boolean);
  return fitReport(buildReport(sanitizeEvents(report.events), sanitizeDetail(report.details), previousRuns));
}

// One recorded step: an event, or the memory sampled right after the previous event.
function applyStep(report, step) {
  if (!step.code) {
    const events = report.events.map((event, index) => (index === report.events.length - 1 ? { ...event, memory: step.memory } : event));
    return buildReport(events, { ...(report.details || {}), lastMemory: { at: step.at, memory: step.memory } }, report.previousRuns || []);
  }
  const { at, code, context } = step;
  const event = { at, code, ...(context ? { context } : {}) };
  const isBoot = code === WORKOUT_DIAGNOSTIC_CODES.BOOT;
  const previousHasAction = Boolean(report.details?.lastAction || report.details?.lastError);
  const hasUserEvidence = report.events.some((entry) => [WORKOUT_DIAGNOSTIC_CODES.ACTION_TAP, WORKOUT_DIAGNOSTIC_CODES.SET_TAP, WORKOUT_DIAGNOSTIC_CODES.FINISH_TAP].includes(entry.code));
  const hasStartupFailureEvidence = !report.previousRuns?.length && report.events.length > 1;
  const hasMeaningfulEvidence = previousHasAction || hasUserEvidence || hasStartupFailureEvidence;
  const finishedRun = { events: report.events.slice(-MAX_EVENTS), ...(report.details ? { details: report.details } : {}) };
  const previousRuns = isBoot && hasMeaningfulEvidence
    ? [finishedRun, ...(report.previousRuns || [])].slice(0, MAX_PREVIOUS_RUNS)
    : (report.previousRuns || []);
  let details = isBoot ? {} : (report.details || {});
  if (step.runtime) details = { ...details, runtime: step.runtime };
  if (code === WORKOUT_DIAGNOSTIC_CODES.ACTION_TAP && context?.action) details = { ...details, lastAction: { at, context } };
  if (code === WORKOUT_DIAGNOSTIC_CODES.JS_ERROR && context?.errorClass && context?.phase) details = { ...details, lastError: { at, context } };
  // Image outcomes are rare among drawing steps, so the run keeps its last one and a count.
  if (IMAGE_OUTCOMES.has(code)) {
    const counts = details.images || { ready: 0, unavailable: 0 };
    const field = code === WORKOUT_DIAGNOSTIC_CODES.IMAGE_READY ? 'ready' : 'unavailable';
    details = { ...details, lastImage: event, images: { ...counts, [field]: counts[field] + 1 } };
  }
  const events = isBoot ? [event] : [...report.events, event].slice(-MAX_EVENTS);
  return buildReport(events, details, previousRuns);
}

function sanitizeStep(raw) {
  if (!raw || !Number.isSafeInteger(raw.seq) || !Number.isSafeInteger(raw.at) || raw.at < 0 || raw.at > MAX_DATE_MILLISECONDS) return null;
  if (raw.code === undefined) {
    const memory = sanitizeMemory(raw.memory);
    return memory ? { seq: raw.seq, at: raw.at, memory } : null;
  }
  if (!VALID_CODES.has(raw.code)) return null;
  const context = sanitizeContext(raw.context);
  const runtime = sanitizeRuntime(raw.runtime);
  return { seq: raw.seq, at: raw.at, code: raw.code, ...(context ? { context } : {}), ...(runtime ? { runtime } : {}) };
}

function snapshotSequence(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Number.isSafeInteger(parsed?.seq) ? parsed.seq : 0;
  } catch {
    return 0;
  }
}

// Only the transport outcome and the phone's protocol code are kept; messages may carry workout details.
export function phoneFailureReason(error) {
  if (error?.code === 'NETWORK') return 'TIMEOUT';
  return VALID_FAILURES.has(error?.code) ? error.code : 'UNKNOWN';
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
  const flushDelayMs = Number.isSafeInteger(providers?.flushDelayMs) && providers.flushDelayMs >= 0 ? providers.flushDelayMs : 0;
  const setTimer = typeof providers?.setTimeout === 'function' ? providers.setTimeout : setTimeout;
  const clearTimer = typeof providers?.clearTimeout === 'function' ? providers.clearTimeout : clearTimeout;
  // Watch files append steps; key-value storage, such as the phone's, rewrites the whole report.
  const journal = typeof storage?.appendLines === 'function' ? storage : null;
  let sequence = 0;
  let pendingLines = [];
  let loggedLines = 0;
  let flushTimer = null;
  let flushGeneration = 0;
  let isDirty = false;

  try {
    enabled = normalizeWorkoutDiagnosticsEnabled(storage?.getItem(WORKOUT_DIAGNOSTICS_ENABLED_KEY));
    if (enabled) {
      const stored = storage.getItem(WORKOUT_DIAGNOSTICS_KEY);
      memory = sanitizeReport(stored) || memory;
      if (journal) {
        const folded = snapshotSequence(stored);
        sequence = folded;
        for (const line of journal.readLines()) {
          let step = null;
          try { step = sanitizeStep(JSON.parse(line)); } catch {}
          // Steps already folded into the report, or cut short by a restart, are skipped.
          if (!step || step.seq <= folded) continue;
          memory = applyStep(memory, step);
          sequence = Math.max(sequence, step.seq);
          loggedLines += 1;
        }
      }
    }
  } catch {
    // Diagnostics must never interfere with the durable workout journal.
  }

  function writeStorage(report) {
    cancelFlush();
    memory = sanitizeReport(report) || { version: VERSION, events: [] };
    try {
      if (!storage || typeof storage.setItem !== 'function') return false;
      storage.setItem(WORKOUT_DIAGNOSTICS_KEY, JSON.stringify(journal ? { ...memory, seq: sequence } : memory));
    } catch {
      return false;
    }
    if (journal) {
      pendingLines = [];
      loggedLines = 0;
      try { journal.clearLines(); } catch {}
    }
    return true;
  }

  function flushLines() {
    if (pendingLines.length === 0) return true;
    const lines = pendingLines;
    pendingLines = [];
    try {
      journal.appendLines(lines);
    } catch {
      return false;
    }
    loggedLines += lines.length;
    if (loggedLines >= FOLD_AFTER_LINES) writeStorage(memory);
    return true;
  }

  function scheduleFlush() {
    if (!enabled || flushTimer !== null) return;
    const generation = ++flushGeneration;
    flushTimer = setTimer(() => {
      if (generation !== flushGeneration || !enabled) return;
      flushTimer = null;
      if (journal) flushLines();
      else if (isDirty) writeStorage(memory);
    }, flushDelayMs);
  }

  function save(step, synchronous) {
    if (!journal) {
      isDirty = true;
      if (synchronous) return writeStorage(memory);
      scheduleFlush();
      return true;
    }
    pendingLines.push(JSON.stringify(step));
    if (synchronous) return flushLines();
    scheduleFlush();
    return true;
  }

  function cancelFlush() {
    flushGeneration += 1;
    if (flushTimer !== null) {
      clearTimer(flushTimer);
      flushTimer = null;
    }
    isDirty = false;
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
      if (!next) {
        cancelFlush();
        memory = { version: VERSION, events: [] };
        pendingLines = [];
        loggedLines = 0;
      }
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
        try { journal?.clearLines(); } catch {}
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
        if (!CONTEXT_FREE_CODES.has(code)) {
          try { baseContext = typeof providers.context === 'function' ? providers.context() : null; } catch {}
        }
        const context = sanitizeContext({ ...(baseContext || {}), ...(rawContext || {}) });
        const step = { seq: ++sequence, at, code, ...(context ? { context } : {}) };
        if (code === WORKOUT_DIAGNOSTIC_CODES.BOOT) runtimeReadAttempted = false;
        if (!runtimeReadAttempted && typeof providers.runtime === 'function') {
          runtimeReadAttempted = true;
          try {
            const runtime = sanitizeRuntime(providers.runtime());
            if (runtime) step.runtime = runtime;
          } catch {}
        }
        memory = applyStep(memory, step);
        const synchronous = SYNCHRONOUS_WRITE_CODES.has(code) || flushDelayMs === 0;
        save(step, synchronous);
        // The step is saved before the probe, so a probe that never returns still leaves it behind.
        const memoryInterval = MEMORY_INTERVAL_MS_BY_CODE.get(code);
        if (memoryInterval !== undefined && at - lastMemoryAttemptAt >= memoryInterval) {
          lastMemoryAttemptAt = at;
          let sampled = null;
          try { sampled = sanitizeMemory(sampleMemory(code)); } catch {}
          if (sampled) {
            const sample = { seq: ++sequence, at, memory: sampled };
            memory = applyStep(memory, sample);
            save(sample, synchronous);
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
      return sanitized ? writeStorage(sanitized) : false;
    },
    cancel() {
      cancelFlush();
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

export const WORKOUT_DIAGNOSTICS_EMPTY = 'No watch diagnostics yet';

export function formatWorkoutDiagnostics(raw) {
  const report = sanitizeReport(raw);
  if (!report || (report.events.length === 0 && !report.previousRuns?.length)) return WORKOUT_DIAGNOSTICS_EMPTY;
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
        context.request && `request ${context.request}`,
        context.failure && `failure ${context.failure}`,
        context.image && `image ${context.image}`,
        context.httpStatus && `http ${context.httpStatus}`,
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
    const images = details.images;
    lines.push(images ? `Images: ${images.ready} shown, ${images.unavailable} unavailable` : 'Images: none requested');
    if (details.lastImage) {
      const context = details.lastImage.context || {};
      lines.push(`Last image at ${new Date(details.lastImage.at).toISOString()} UTC: ${details.lastImage.code}${context.image ? ` image ${context.image}` : ''}${context.httpStatus ? ` http ${context.httpStatus}` : ''}`);
    }
    if (details.lastMemory) lines.push(`Memory sample at ${new Date(details.lastMemory.at).toISOString()} UTC: ${JSON.stringify(details.lastMemory.memory)}`);
  };
  const formatRun = (label, run) => {
    formatDetails(label, run.details);
    const count = run.events.length;
    if (count === 0) return;
    lines.push(`${label} (${count} ${count === 1 ? 'event' : 'events'}, latest ${MAX_EVENTS} retained):`);
    for (let index = 0; index < count; index++) {
      lines.push(formatEvent(run.events[index], index, run.events));
    }
  };
  const previousRuns = report.previousRuns || [];
  for (let index = previousRuns.length - 1; index >= 0; index--) {
    formatRun(`Previous run ${index + 1}`, previousRuns[index]);
  }
  formatRun('Current run', report);

  return lines.join('\n');
}
