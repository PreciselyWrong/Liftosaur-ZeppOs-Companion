/**
 * Shared local workout controller.
 *
 * Authoritative owner of day plan, workout session state machine, direct-sync
 * metadata and persistent snapshot storage.
 *
 * Platform independent: runs under Node, Zepp OS companion app and workout
 * extension.
 */

import { SESSION_STATES, createWorkoutSession } from './workout-session.js';

export function defaultDirectSync(mode = 'LEGACY') {
  return {
    mode: mode === 'DIRECT' ? 'DIRECT' : 'LEGACY',
    startConfirmed: false,
    acknowledgedSetCount: 0,
    finishRequestedAt: null,
    discardRequestedAt: null,
    conflict: false,
    remoteMissing: false,
    preservedIntervals: [],
    intervalsPreservedThrough: null,
  };
}

export function normalizeDirectSync(sync, defaultMode = 'LEGACY') {
  const base = defaultDirectSync(sync?.mode || defaultMode);
  if (!sync) return base;

  const parsedAcknowledged = Number(sync.acknowledgedSetCount);
  const acknowledgedSetCount =
    Number.isFinite(parsedAcknowledged) && parsedAcknowledged >= 0
      ? Math.floor(parsedAcknowledged)
      : 0;

  const finishRequestedAt = Number.isFinite(sync.finishRequestedAt)
    ? sync.finishRequestedAt
    : null;
  const discardRequestedAt = Number.isFinite(sync.discardRequestedAt)
    ? sync.discardRequestedAt
    : null;

  const preservedIntervals = Array.isArray(sync.preservedIntervals)
    ? sync.preservedIntervals.filter(
        (i) => Array.isArray(i) && i.length === 2 && Number.isFinite(i[0]) && Number.isFinite(i[1])
      )
    : [];

  const intervalsPreservedThrough = Number.isFinite(sync.intervalsPreservedThrough)
    ? sync.intervalsPreservedThrough
    : null;

  return {
    mode: base.mode,
    startConfirmed: Boolean(sync.startConfirmed),
    acknowledgedSetCount,
    finishRequestedAt,
    discardRequestedAt,
    conflict: Boolean(sync.conflict),
    remoteMissing: Boolean(sync.remoteMissing),
    preservedIntervals,
    intervalsPreservedThrough,
  };
}

export function createWorkoutController({
  store = null,
  now = () => Date.now(),
  onChange = null,
  logger = null,
} = {}) {
  let dayPlan = null;
  let session = createWorkoutSession({ plan: null });
  let directSync = defaultDirectSync('LEGACY');

  function log(message, data = {}) {
    if (!logger) return;
    if (typeof logger.log === 'function') {
      logger.log(data, message);
    }
  }

  function logError(message, err = null) {
    if (!logger) return;
    if (typeof logger.error === 'function') {
      logger.error({ error: err?.message || String(err) }, message);
    } else if (typeof logger.log === 'function') {
      logger.log({ error: err?.message || String(err) }, message);
    }
  }

  function notifyChange() {
    if (typeof onChange === 'function') {
      onChange(session.view(now()));
    }
  }

  function persist() {
    if (!dayPlan || !store) return false;
    return store.save({
      plan: dayPlan,
      journal: session.getJournal(),
      startedAt: session.view(now()).startedAt,
      sync: directSync,
    });
  }

  function mutateSession(action) {
    action();
    persist();
    notifyChange();
  }

  function loadPlan(
    plan,
    {
      sync = null,
      resumeFromEntryId = null,
      clearStore = false,
      persist: shouldPersist = false,
    } = {}
  ) {
    dayPlan = plan;
    session = createWorkoutSession({ plan: dayPlan, resumeFromEntryId });
    const defaultMode = plan?.source === 'WORKOUT_API' ? 'DIRECT' : 'LEGACY';
    directSync = normalizeDirectSync(sync, defaultMode);

    if (clearStore && store) {
      store.clear();
    } else if (shouldPersist) {
      persist();
    }
    notifyChange();
  }

  function restore() {
    if (!store) {
      return { success: false, reason: 'NO_STORE' };
    }

    const snapshot = store.load();
    if (!snapshot || !snapshot.plan || !Array.isArray(snapshot.journal)) {
      return { success: false, reason: 'NO_SNAPSHOT' };
    }

    let restoredSession;
    try {
      restoredSession = createWorkoutSession({
        plan: snapshot.plan,
        initialJournal: snapshot.journal,
      });
    } catch (err) {
      logError('restore session failed', err);
      return { success: false, reason: 'INVALID_SNAPSHOT', error: err };
    }

    const view = restoredSession.view(now());
    if (view.state === SESSION_STATES.NO_PLAN) {
      return { success: false, reason: 'NO_PLAN' };
    }

    dayPlan = snapshot.plan;
    session = restoredSession;
    const defaultMode = snapshot.plan?.source === 'WORKOUT_API' ? 'DIRECT' : 'LEGACY';
    directSync = normalizeDirectSync(snapshot.sync, defaultMode);

    log('Session resumed');
    notifyChange();
    return {
      success: true,
      state: view.state,
      plan: dayPlan,
      sync: directSync,
    };
  }

  function updateSync(patch = {}) {
    directSync = normalizeDirectSync({
      ...directSync,
      ...patch,
    });
    persist();
    notifyChange();
    return directSync;
  }

  function preserveIntervals(capturedAt = now()) {
    if (directSync.mode !== 'DIRECT') return;
    const through = directSync.intervalsPreservedThrough;
    const nextIntervals = session
      .getWorkoutIntervals(capturedAt)
      .map(([start, end]) => [through === null ? start : Math.max(start, through), end])
      .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start);

    directSync.preservedIntervals = [
      ...(Array.isArray(directSync.preservedIntervals) ? directSync.preservedIntervals : []),
      ...nextIntervals,
    ];
    directSync.intervalsPreservedThrough = capturedAt;
    persist();
  }

  function getIntervals(endTime = null) {
    const effectiveEnd = Number.isFinite(endTime) ? endTime : now();
    const through = directSync.intervalsPreservedThrough;
    const currentIntervals = session
      .getWorkoutIntervals(effectiveEnd)
      .map(([start, end]) => [through === null ? start : Math.max(start, through), end])
      .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start);

    return [
      ...(Array.isArray(directSync.preservedIntervals) ? directSync.preservedIntervals : []),
      ...currentIntervals,
    ];
  }

  function replaceFromServer(
    newPlan,
    {
      resumeFromEntryId = null,
      preserveNavigation = true,
      acknowledgedSetCount = null,
    } = {}
  ) {
    if (directSync.mode === 'DIRECT') {
      preserveIntervals(now());
    }
    const resolvedResume = preserveNavigation
      ? (resumeFromEntryId ?? session.view(now()).entryId)
      : resumeFromEntryId;

    dayPlan = newPlan;
    session = createWorkoutSession({ plan: dayPlan, resumeFromEntryId: resolvedResume });
    directSync = normalizeDirectSync({
      ...directSync,
      acknowledgedSetCount:
      acknowledgedSetCount !== null && acknowledgedSetCount !== undefined
        ? acknowledgedSetCount
        : session.getWorkoutSetWrites().length,
    });

    persist();
    notifyChange();
  }

  function clear() {
    if (store) {
      store.clear();
    }
    session.cancelWorkout({ timestamp: now() });
    session = createWorkoutSession({ plan: null });
    dayPlan = null;
    directSync = defaultDirectSync('LEGACY');
    notifyChange();
  }

  return {
    loadPlan,
    restore,
    view: (nowTimestamp = now()) => session.view(nowTimestamp),
    plan: () => dayPlan,
    sync: () => ({
      ...directSync,
      preservedIntervals: directSync.preservedIntervals.map((interval) => [...interval]),
    }),

    startWorkout: (options = {}) =>
      mutateSession(() => session.startWorkout({ timestamp: options.timestamp ?? now() })),
    selectExercise: (index, options = {}) =>
      mutateSession(() =>
        session.selectExercise(index, { timestamp: options.timestamp ?? now() })
      ),
    adjustWeight: (steps = 1, options = {}) =>
      mutateSession(() =>
        session.adjustWeight(steps, { timestamp: options.timestamp ?? now() })
      ),
    adjustReps: (delta, options = {}) =>
      mutateSession(() => session.adjustReps(delta, { timestamp: options.timestamp ?? now() })),
    adjustRpe: (delta, options = {}) =>
      mutateSession(() => session.adjustRpe(delta, { timestamp: options.timestamp ?? now() })),
    completeSet: (options = {}) =>
      mutateSession(() => session.completeSet({ timestamp: now(), ...options })),
    pauseRest: (options = {}) =>
      mutateSession(() => session.pauseRest({ timestamp: options.timestamp ?? now() })),
    resumeRest: (options = {}) =>
      mutateSession(() => session.resumeRest({ timestamp: options.timestamp ?? now() })),
    toggleRestPause: (options = {}) =>
      mutateSession(() =>
        session.toggleRestPause({ timestamp: options.timestamp ?? now() })
      ),
    adjustRest: (deltaSeconds, options = {}) =>
      mutateSession(() =>
        session.adjustRest(deltaSeconds, { timestamp: options.timestamp ?? now() })
      ),
    nextSet: (options = {}) =>
      mutateSession(() => session.nextSet({ timestamp: options.timestamp ?? now() })),
    finishWorkout: (options = {}) =>
      mutateSession(() => session.finishWorkout({ timestamp: options.timestamp ?? now() })),
    cancelWorkout: (options = {}) =>
      mutateSession(() => session.cancelWorkout({ timestamp: options.timestamp ?? now() })),

    updateSync,
    replaceFromServer,
    preserveIntervals,
    getIntervals,
    persist,
    clear,

    getCompletedSets: () => session.getCompletedSets(),
    getWorkoutSetWrites: () => session.getWorkoutSetWrites(),
    getLastWorkoutSetWrite: () => session.getLastWorkoutSetWrite(),
    getJournal: () => session.getJournal(),
    getWorkoutIntervals: (endTime) => session.getWorkoutIntervals(endTime),
    clearPersisted: () => store?.clear(),
    isAllCompleted: () => session.isAllCompleted(),
  };
}
