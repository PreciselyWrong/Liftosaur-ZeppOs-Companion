/**
 * Shared local workout controller.
 *
 * Authoritative owner of day plan, workout session state machine, direct-sync
 * metadata, network orchestration and persistent snapshot storage.
 *
 * Platform independent: runs under Node, Zepp OS companion app and workout
 * extension.
 */

import { SESSION_STATES, createWorkoutSession } from './workout-session.js';
import { MESSAGE_TYPES } from './protocol.js';
import { workoutToDayPlan } from './workout-api-plan.js';
import { createWorkoutRefreshPolicy } from './workout-refresh-policy.js';

export const SYNC_STATUS_CODES = {
  IDLE: 'idle',
  PENDING: 'pending',
  CONFLICT: 'conflict',
  REMOTE_MISSING: 'remote-missing',
  SAVING: 'saving',
  SAVED: 'saved',
  ERROR: 'error',
};

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
  request = null,
  mapWorkout = workoutToDayPlan,
  refreshPolicy = null,
  onStatus = null,
} = {}) {
  let dayPlan = null;
  let session = createWorkoutSession({ plan: null });
  let directSync = defaultDirectSync('LEGACY');
  let currentStatus = { code: SYNC_STATUS_CODES.IDLE, detail: null, error: null };
  const policy = refreshPolicy || createWorkoutRefreshPolicy({ now });

  let directSyncPromise = null;
  let directStartPromise = null;
  let isDirectWriteInFlight = false;
  let isPollingCurrent = false;
  let deferredServerWorkout = null;
  let lastServerWorkoutSignature = null;

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

  function setStatus(patch = {}) {
    currentStatus = {
      code: patch.code || SYNC_STATUS_CODES.IDLE,
      detail: patch.detail ?? null,
      error: patch.error ?? null,
    };
    if (typeof onStatus === 'function') {
      onStatus(currentStatus);
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

  function applyAdoptedSnapshot(serverWorkout, { preserveNavigation = true } = {}) {
    const resumeFromEntryId = preserveNavigation ? session.view(now()).entryId : null;
    preserveIntervals(now());
    const plan = mapWorkout(serverWorkout, {
      units: dayPlan?.unit || null,
      isCurrent: true,
    });
    if (!plan || !plan.unit) return;
    dayPlan = plan;
    lastServerWorkoutSignature = JSON.stringify(serverWorkout);
    session = createWorkoutSession({ plan: dayPlan, resumeFromEntryId });
    directSync = normalizeDirectSync({
      ...directSync,
      acknowledgedSetCount: session.getWorkoutSetWrites().length,
    });
    deferredServerWorkout = null;
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
    deferredServerWorkout = null;
    lastServerWorkoutSignature = null;
    currentStatus = { code: SYNC_STATUS_CODES.IDLE, detail: null, error: null };

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
    deferredServerWorkout = null;
    lastServerWorkoutSignature = null;
    currentStatus = {
      code: directSync.conflict
        ? SYNC_STATUS_CODES.CONFLICT
        : directSync.remoteMissing
          ? SYNC_STATUS_CODES.REMOTE_MISSING
          : SYNC_STATUS_CODES.IDLE,
      detail: null,
      error: null,
    };

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
    deferredServerWorkout = null;
    lastServerWorkoutSignature = null;
    setStatus({ code: SYNC_STATUS_CODES.IDLE });
    notifyChange();
  }

  function ensureDirectWorkoutStarted() {
    if (directSync.mode !== 'DIRECT' || directSync.startConfirmed) {
      return Promise.resolve(false);
    }
    if (directSync.conflict) {
      const err = new Error('Workout sync conflict');
      err.code = 'SYNC_CONFLICT';
      return Promise.reject(err);
    }
    if (directStartPromise) {
      return directStartPromise;
    }
    if (!request) {
      return Promise.resolve(false);
    }

    const view = session.view(now());
    const payload = {
      ...(dayPlan?.programId ? { programId: dayPlan.programId } : {}),
      ...(dayPlan?.week !== null && dayPlan?.week !== undefined ? { week: dayPlan.week } : {}),
      ...(dayPlan?.dayInWeek !== null && dayPlan?.dayInWeek !== undefined ? { dayInWeek: dayPlan.dayInWeek } : {}),
      startTime: view.startedAt,
    };

    directStartPromise = (async () => {
      try {
        const res = await request(MESSAGE_TYPES.START_WORKOUT, payload);
        policy.markAuthoritativeResponse();
        const payloadObj = res ? res.payload : null;
        const returnedWorkout = payloadObj ? payloadObj.workout : null;
        if (returnedWorkout) {
          if (returnedWorkout.startTime && returnedWorkout.startTime !== view.startedAt) {
            directSync.conflict = true;
            persist();
            setStatus({ code: SYNC_STATUS_CODES.CONFLICT, detail: 'START_TIME_MISMATCH' });
            notifyChange();
            return false;
          }
        }
        directSync.startConfirmed = true;
        persist();
        setStatus({ code: SYNC_STATUS_CODES.IDLE });
        notifyChange();
        return true;
      } catch (err) {
        if (err?.code === 'workout_already_active' || err?.code === 'workout_start_time_taken') {
          directSync.conflict = true;
          persist();
          setStatus({ code: SYNC_STATUS_CODES.CONFLICT, detail: err.code, error: err });
          notifyChange();
        } else {
          const retryable = !err?.code || err.code === 'NETWORK' || err.code === 'API_FAILED';
          if (!retryable) {
            directSync.conflict = true;
            persist();
            setStatus({ code: SYNC_STATUS_CODES.CONFLICT, detail: err?.code || 'START_FAILED', error: err });
            notifyChange();
          } else {
            setStatus({ code: SYNC_STATUS_CODES.PENDING, detail: 'START_PENDING', error: err });
          }
        }
        throw err;
      } finally {
        directStartPromise = null;
      }
    })();

    return directStartPromise;
  }

  function synchronizeDirectSets() {
    if (directSync.mode !== 'DIRECT' || directSync.conflict) return Promise.resolve(false);
    if (directSyncPromise) {
      return directSyncPromise;
    }
    if (!request) {
      return Promise.resolve(false);
    }

    directSyncPromise = (async () => {
      try {
        await ensureDirectWorkoutStarted();
        if (directSync.conflict) return false;

        while (true) {
          if (directSync.conflict) break;
          const allWrites = session.getWorkoutSetWrites();
          const pendingWrites = allWrites.slice(directSync.acknowledgedSetCount);
          if (pendingWrites.length === 0) {
            setStatus({ code: SYNC_STATUS_CODES.IDLE });
            break;
          }

          const batch = pendingWrites;
          const batchLength = batch.length;

          const res = await request(MESSAGE_TYPES.SYNC_WORKOUT_SETS, { sets: batch });
          policy.markAuthoritativeResponse();
          const payloadObj = res ? res.payload : null;
          const returnedWorkout = payloadObj ? payloadObj.workout : null;
          if (returnedWorkout) {
            if (returnedWorkout.startTime && returnedWorkout.startTime !== session.view(now()).startedAt) {
              directSync.conflict = true;
              persist();
              setStatus({ code: SYNC_STATUS_CODES.CONFLICT, detail: 'START_TIME_MISMATCH' });
              notifyChange();
              break;
            }
          }

          directSync.acknowledgedSetCount += batchLength;
          persist();
          notifyChange();

          const remainingPendingCount =
            session.getWorkoutSetWrites().length - directSync.acknowledgedSetCount;
          if (returnedWorkout && remainingPendingCount === 0) {
            const currentState = session.view(now()).state;
            if (currentState === SESSION_STATES.REST) {
              deferredServerWorkout = returnedWorkout;
              lastServerWorkoutSignature = JSON.stringify(returnedWorkout);
            } else if (currentState === SESSION_STATES.ACTIVE_SET) {
              applyAdoptedSnapshot(returnedWorkout);
            }
          }
        }
        return true;
      } catch (err) {
        logError('sync direct sets failed', err);
        const retryable = !err?.code || err.code === 'NETWORK' || err.code === 'API_FAILED';
        if (!retryable) {
          directSync.conflict = true;
          persist();
          setStatus({ code: SYNC_STATUS_CODES.CONFLICT, detail: err?.code || 'SYNC_FAILED', error: err });
          notifyChange();
        } else {
          setStatus({ code: SYNC_STATUS_CODES.PENDING, detail: 'SYNC_PENDING', error: err });
        }
        throw err;
      } finally {
        directSyncPromise = null;
      }
    })();

    return directSyncPromise;
  }

  async function pollCurrentWorkout() {
    if (directSync.mode !== 'DIRECT' || directSync.conflict) return false;
    if (!request) return false;
    const currentState = session.view(now()).state;
    if (currentState !== SESSION_STATES.ACTIVE_SET && currentState !== SESSION_STATES.REST) return false;
    const pendingCount = session.getWorkoutSetWrites().length - directSync.acknowledgedSetCount;
    if (pendingCount > 0) return false;
    if (directSyncPromise || directStartPromise || isDirectWriteInFlight || isPollingCurrent) return false;
    if (!policy.beginPoll()) return false;

    const writeCountAtPollStart = session.getWorkoutSetWrites().length;
    isPollingCurrent = true;

    try {
      const res = await request(MESSAGE_TYPES.GET_WORKOUT_CURRENT);
      policy.markSuccess();
      const payloadObj = res ? res.payload : null;
      const serverWorkout = payloadObj ? payloadObj.workout : null;
      const currentWriteCount = session.getWorkoutSetWrites().length;
      const currentPending = currentWriteCount - directSync.acknowledgedSetCount;

      if (currentWriteCount !== writeCountAtPollStart) return false;

      if (!serverWorkout) {
        if (!directSync.startConfirmed) {
          ensureDirectWorkoutStarted().catch((err) => {
            logError('background workout start failed', err);
          });
          return false;
        }
        directSync.conflict = true;
        directSync.remoteMissing = true;
        persist();
        setStatus({ code: SYNC_STATUS_CODES.REMOTE_MISSING, detail: 'NO_REMOTE_WORKOUT' });
        notifyChange();
        return false;
      }

      const localStartTime = session.view(now()).startedAt;
      if (serverWorkout.startTime && serverWorkout.startTime !== localStartTime) {
        directSync.conflict = true;
        persist();
        setStatus({ code: SYNC_STATUS_CODES.CONFLICT, detail: 'START_TIME_MISMATCH' });
        notifyChange();
        return false;
      }

      if (currentPending === 0 && currentWriteCount === writeCountAtPollStart) {
        const serverSignature = JSON.stringify(serverWorkout);
        if (serverSignature === lastServerWorkoutSignature) return false;
        const stateNow = session.view(now()).state;
        if (stateNow === SESSION_STATES.REST) {
          deferredServerWorkout = serverWorkout;
          lastServerWorkoutSignature = serverSignature;
        } else {
          applyAdoptedSnapshot(serverWorkout);
        }
        return true;
      }
      return false;
    } catch (err) {
      policy.markFailure();
      logError('poll current workout failed', err);
      return false;
    } finally {
      isPollingCurrent = false;
    }
  }

  function requestWorkoutRefresh() {
    if (directSync.mode !== 'DIRECT') return;
    policy.request();
    pollCurrentWorkout().catch((err) => {
      logError('background workout refresh failed', err);
    });
  }

  async function adoptCurrentWorkout({ preserveNavigation = false } = {}) {
    if (!request) return { success: false, reason: 'NO_TRANSPORT' };
    setStatus({ code: SYNC_STATUS_CODES.PENDING, detail: 'ADOPTING' });
    try {
      const res = await request(MESSAGE_TYPES.GET_WORKOUT_CURRENT);
      policy.markAuthoritativeResponse();
      const payloadObj = res ? res.payload : null;
      const workout = payloadObj ? payloadObj.workout : null;
      if (!workout) {
        directSync.conflict = true;
        directSync.remoteMissing = true;
        persist();
        setStatus({ code: SYNC_STATUS_CODES.REMOTE_MISSING, detail: 'NO_REMOTE_WORKOUT' });
        notifyChange();
        return { success: false, reason: 'NO_REMOTE_WORKOUT' };
      }
      directSync.conflict = false;
      directSync.remoteMissing = false;
      directSync.startConfirmed = true;
      directSync.finishRequestedAt = null;
      directSync.discardRequestedAt = null;
      applyAdoptedSnapshot(workout, { preserveNavigation });
      setStatus({ code: SYNC_STATUS_CODES.IDLE });
      return { success: true, workout };
    } catch (err) {
      logError('adopt current workout failed', err);
      setStatus({ code: SYNC_STATUS_CODES.ERROR, error: err });
      throw err;
    }
  }

  async function finishWorkoutRemote() {
    if (directSync.mode !== 'DIRECT' || !dayPlan) {
      return { success: false, reason: 'NOT_DIRECT' };
    }
    if (isDirectWriteInFlight) {
      return { success: false, reason: 'IN_FLIGHT' };
    }
    if (!request) {
      return { success: false, reason: 'NO_TRANSPORT' };
    }

    isDirectWriteInFlight = true;
    if (!directSync.finishRequestedAt) {
      directSync.finishRequestedAt = now();
      persist();
    }
    setStatus({ code: SYNC_STATUS_CODES.SAVING, detail: 'FINISHING' });

    try {
      await ensureDirectWorkoutStarted();
      if (directSync.conflict) {
        throw new Error('Workout sync conflict');
      }
      await synchronizeDirectSets();
      const pendingSetCount =
        session.getWorkoutSetWrites().length - directSync.acknowledgedSetCount;
      if (pendingSetCount > 0) {
        throw new Error('Set sync is still pending');
      }

      const view = session.view(now());
      const endTime = view.endedAt || now();
      const intervals = getIntervals(endTime);
      const payload = {
        startTime: view.startedAt,
        endTime,
      };
      if (intervals && intervals.length > 0) {
        payload.intervals = intervals;
      }

      const res = await request(MESSAGE_TYPES.FINISH_WORKOUT, payload);
      if (store) {
        store.clear();
      }
      setStatus({ code: SYNC_STATUS_CODES.SAVED, detail: 'FINISH_CONFIRMED' });
      return { success: true, response: res };
    } catch (err) {
      logError('finish workout remote failed', err);
      setStatus({ code: SYNC_STATUS_CODES.ERROR, detail: 'FINISH_FAILED', error: err });
      throw err;
    } finally {
      isDirectWriteInFlight = false;
    }
  }

  async function discardWorkoutRemote() {
    if (directSync.mode !== 'DIRECT') {
      clear();
      return { success: true };
    }

    const view = session.view(now());
    if (!Number.isFinite(view.startedAt)) {
      clear();
      return { success: true };
    }

    if (!directSync.discardRequestedAt) {
      directSync.discardRequestedAt = now();
      persist();
    }
    setStatus({ code: SYNC_STATUS_CODES.SAVING, detail: 'DISCARDING' });

    if (!request) {
      setStatus({ code: SYNC_STATUS_CODES.PENDING, detail: 'DISCARD_PENDING' });
      return { success: false, reason: 'NO_TRANSPORT' };
    }

    try {
      await request(MESSAGE_TYPES.DISCARD_WORKOUT, { startTime: view.startedAt });
      clear();
      setStatus({ code: SYNC_STATUS_CODES.IDLE });
      return { success: true };
    } catch (err) {
      if (err?.code === 'no_active_workout') {
        clear();
        setStatus({ code: SYNC_STATUS_CODES.IDLE });
        return { success: true };
      }
      logError('discard workout remote failed', err);
      setStatus({ code: SYNC_STATUS_CODES.ERROR, detail: 'DISCARD_FAILED', error: err });
      throw err;
    }
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
    status: () => ({ ...currentStatus }),
    getStatus: () => ({ ...currentStatus }),

    startWorkout: (options = {}) => {
      mutateSession(() => session.startWorkout({ timestamp: options.timestamp ?? now() }));
      if (directSync.mode === 'DIRECT' && request) {
        ensureDirectWorkoutStarted().catch((err) => {
          logError('background workout start failed', err);
        });
      }
    },
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
    completeSet: (options = {}) => {
      mutateSession(() => session.completeSet({ timestamp: now(), ...options }));
      if (directSync.mode === 'DIRECT' && request) {
        synchronizeDirectSets().catch((err) => {
          logError('background set sync failed', err);
        });
      }
    },
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
    nextSet: (options = {}) => {
      if (deferredServerWorkout) {
        const sw = deferredServerWorkout;
        deferredServerWorkout = null;
        applyAdoptedSnapshot(sw);
      } else {
        mutateSession(() => session.nextSet({ timestamp: options.timestamp ?? now() }));
        if (directSync.mode === 'DIRECT') {
          requestWorkoutRefresh();
        }
      }
    },
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

    ensureStarted: ensureDirectWorkoutStarted,
    ensureDirectWorkoutStarted,
    syncSets: synchronizeDirectSets,
    synchronizeDirectSets,
    pollCurrent: pollCurrentWorkout,
    pollCurrentWorkout,
    requestRefresh: requestWorkoutRefresh,
    requestWorkoutRefresh,
    adoptCurrent: adoptCurrentWorkout,
    adoptCurrentWorkout,
    applyAdoptedSnapshot,
    finishWorkoutRemote,
    discardWorkoutRemote,
    hasDeferredServerWorkout: () => deferredServerWorkout !== null,
    getDeferredServerWorkout: () => deferredServerWorkout,
    markAuthoritativeResponse: () => policy.markAuthoritativeResponse(),
    applyDeferredServerWorkout: () => {
      if (deferredServerWorkout) {
        const sw = deferredServerWorkout;
        deferredServerWorkout = null;
        applyAdoptedSnapshot(sw);
      }
    },

    getCompletedSets: () => session.getCompletedSets(),
    getWorkoutSetWrites: () => session.getWorkoutSetWrites(),
    getLastWorkoutSetWrite: () => session.getLastWorkoutSetWrite(),
    getJournal: () => session.getJournal(),
    getWorkoutIntervals: (endTime) => session.getWorkoutIntervals(endTime),
    clearPersisted: () => store?.clear(),
    isAllCompleted: () => session.isAllCompleted(),
  };
}
