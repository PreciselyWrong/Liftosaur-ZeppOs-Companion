import { MESSAGE_TYPES } from './protocol.js';
import { EXERCISE_IMAGE_FAILURES, MAX_EXERCISE_IMAGE_BYTES, normalizeExerciseImageUrl } from './exercise-images.js';

const MAX_CACHED_IMAGES = 4;
const MAX_QUEUE_SIZE = 16;
export const EXERCISE_IMAGE_WATCH_STORAGE_KEY = 'watchExerciseImagesV7';
let requestSequence = 0;

const MAX_REFUSED_URLS = 32;
const PHONE_REPLY_WAIT_MS = 45000;
const FILE_WAIT_MS = 20000;
// The Active 2 closed the app silently while an image transfer, a set sync awaiting its reply and the
// post-set redraw overlapped. Images wait for the sync and this quiet moment after it.
const WORKOUT_QUIET_MS = 3000;
// Failures that say nothing about the image itself; a later visible load asks again, spaced and bounded.
const TEMPORARY_FAILURES = new Set([
  'PHONE_NO_REPLY', 'FILE_NOT_RECEIVED', 'LOW_MEMORY', 'REQUEST_FAILED', 'TRANSFER_ERROR', 'TRANSFER_CANCELED',
]);
const AUTO_RETRY_AFTER_MS = 60000;
const MAX_AUTO_RETRIES = 2;
// The quiet moment a tap buys before the day preload asks for its next image.
export const PRELOAD_TAP_QUIET_MS = 5000;
// The quiet moment after a full screen rebuild or a session save, the other heavy steps an image must
// not overlap: the native redraw and the flash write finish after the JavaScript call returns.
export const UI_WORK_QUIET_MS = 1000;

// What a workout screen does to the day preload: a set under way stops it; the ready, rest and Prepare
// screens feed it the day's images, the upcoming exercise first, then the rest in workout order.
export function exerciseImagePreloadFor(view) {
  if (!view) return null;
  const timedSetRunning = view.timedSet && view.timedSet.phase !== 'READY' && view.timedSet.phase !== 'REST';
  if (view.state === 'ACTIVE_SET' || timedSetRunning) return { pause: true };
  if (view.state !== 'READY' && view.state !== 'REST') return null;
  const exercises = Array.isArray(view.overviewExercises) ? view.overviewExercises : [];
  const current = view.state === 'REST' ? (view.pending?.exerciseIndex ?? view.currentExerciseIndex) : view.currentExerciseIndex;
  const start = Number.isInteger(current) && current >= 0 && current < exercises.length ? current : 0;
  return { urls: [...exercises.slice(start), ...exercises.slice(0, start)].map((exercise) => exercise?.imageUrl) };
}

// A critical workout request never waits on an image: the image work waits on it instead.
export function holdExerciseImagesDuring(images, type, start) {
  if (type !== MESSAGE_TYPES.SYNC_WORKOUT_SETS || !images || typeof images.hold !== 'function') return start();
  const release = images.hold();
  let pending;
  try {
    pending = Promise.resolve(start());
  } catch (error) {
    release();
    throw error;
  }
  return pending.then((value) => { release(); return value; }, (error) => { release(); throw error; });
}

// Image work waits for `work` and `quietMs` after it; the work itself never waits on images.
export function holdExerciseImagesWhile(images, work, quietMs = UI_WORK_QUIET_MS) {
  const release = images && typeof images.hold === 'function' ? images.hold() : null;
  try {
    return work();
  } finally {
    if (release) release(quietMs);
  }
}

// The same store with every save holding image work: a controller save runs inside a tap, long before
// the UI could wrap it. The images are read at save time because a page creates them after its store.
export function holdExerciseImagesDuringSaves(store, getImages) {
  return Object.create(store, {
    save: { value: (snapshot) => holdExerciseImagesWhile(getImages(), () => store.save(snapshot)) },
  });
}

export function createExerciseImageClient({
  inbox,
  request,
  removeFile,
  fileSize = () => null,
  onChange = () => {},
  storage = null,
  maxCachedImages = storage ? 32 : 4,
  hasMemoryHeadroom = () => true,
}) {
  let enabled = false;
  let disposed = false;
  let active = null;
  let transfer = null;
  let timer = null;
  let scheduled = false;
  let holds = 0;
  let quietUntil = 0;
  let resumeTimer = null;
  let arrival = null;
  let preloadUrls = [];
  let preloadStopped = false;
  let preloadQuietUntil = 0;
  let preloadTimer = null;
  const preloadTried = new Set();
  const entries = new Map();
  const queue = [];
  const refusedUrls = new Set();

  if (storage && typeof storage.getItem === 'function') {
    try {
      const raw = storage.getItem(EXERCISE_IMAGE_WATCH_STORAGE_KEY);
      const saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(saved)) {
        for (const item of saved) {
          if (item?.url && item?.src) {
            const size = fileSize(item.src);
            if (size > 0) {
              entries.set(item.url, { url: item.url, status: 'ready', src: item.src });
            }
          }
        }
      }
    } catch {}
  }

  function saveStorage() {
    if (!storage || typeof storage.setItem !== 'function') return;
    try {
      const list = [];
      for (const entry of entries.values()) {
        if (entry.status === 'ready' && entry.src) {
          list.push({ url: entry.url, src: entry.src });
        }
      }
      storage.setItem(EXERCISE_IMAGE_WATCH_STORAGE_KEY, JSON.stringify(list));
    } catch {}
  }

  function remove(path) {
    if (!path) return;
    try { removeFile(path); } catch {}
  }

  function isCachedPath(path) {
    for (const entry of entries.values()) {
      if (entry.src === path) return true;
    }
    return false;
  }

  function transferredFileSize(file) {
    if (Number.isFinite(file.fileSize) && file.fileSize > 0) return file.fileSize;
    try {
      const size = fileSize(file.filePath);
      return Number.isFinite(size) ? size : 0;
    } catch {
      return 0;
    }
  }

  function clearTransfer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    transfer = null;
    active = null;
  }

  function clearResume() {
    if (resumeTimer !== null) clearTimeout(resumeTimer);
    resumeTimer = null;
  }

  function clearPreloadTimer() {
    if (preloadTimer !== null) clearTimeout(preloadTimer);
    preloadTimer = null;
  }

  function forgetPreload() {
    clearPreloadTimer();
    preloadUrls = [];
    preloadTried.clear();
  }

  function cleanup() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    clearResume();
    if (arrival && !isCachedPath(arrival.path)) remove(arrival.path);
    arrival = null;
    try { transfer?.cancel(); } catch {}
    transfer = null;
    active = null;
    queue.length = 0;
    forgetPreload();
    // A kept entry still loading would never be asked for again: load() skips loading entries.
    for (const [url, entry] of entries) {
      if (entry.status === 'loading') entries.delete(url);
    }
    if (!storage) {
      const removed = new Set();
      for (const entry of entries.values()) {
        if (entry.src && !removed.has(entry.src)) {
          removed.add(entry.src);
          remove(entry.src);
        }
      }
      entries.clear();
    }
  }
  function abandon() {
    disposed = true;
    enabled = false;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    clearResume();
    arrival = null;
    transfer = null;
    active = null;
    queue.length = 0;
    forgetPreload();
    entries.clear();
  }

  function deferred() {
    return holds > 0 || Date.now() < quietUntil;
  }

  // One timer per quiet moment, never a poll: it fires once the last hold has been released.
  function armResume() {
    if (resumeTimer !== null || holds > 0 || disposed) return;
    const wait = quietUntil - Date.now();
    if (wait <= 0) {
      resume();
      return;
    }
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      armResume();
    }, wait);
    if (resumeTimer && typeof resumeTimer.unref === 'function') resumeTimer.unref();
  }

  function resume() {
    const pending = arrival;
    arrival = null;
    if (pending) pending.settle();
    scheduleNext();
  }

  function defer(ms = WORKOUT_QUIET_MS) {
    quietUntil = Math.max(quietUntil, Date.now() + ms);
    clearResume();
    armResume();
  }

  // The release starts the quiet moment, `quietMs` long, once no other hold remains.
  function hold() {
    holds++;
    let released = false;
    return (quietMs = WORKOUT_QUIET_MS) => {
      if (released) return;
      released = true;
      holds--;
      quietUntil = Math.max(quietUntil, Date.now() + quietMs);
      if (holds === 0) defer(0);
    };
  }

  function touch(entry) {
    entries.delete(entry.url);
    entries.set(entry.url, entry);
  }

  function evictOldImages() {
    let readyCount = 0;
    for (const entry of entries.values()) {
      if (entry.status === 'ready') readyCount++;
    }
    while (readyCount > maxCachedImages) {
      for (const [url, entry] of entries) {
        if (entry.status !== 'ready') continue;
        entries.delete(url);
        remove(entry.src);
        readyCount--;
        break;
      }
    }
    saveStorage();
  }

  function scheduleNext() {
    if (scheduled || active || disposed || !enabled || (queue.length === 0 && preloadUrls.length === 0)) return;
    scheduled = true;
    Promise.resolve().then(() => {
      scheduled = false;
      processNext();
    });
  }

  // The failure names the step that stopped, so a report can tell download, transfer and file problems apart.
  function finish(entry, status, src = null, failure = null) {
    if (active !== entry) return;
    clearTransfer();
    if (entry.preload && status !== 'ready') {
      // No screen showed this image, so its failure stays out of their way: a screen asks afresh.
      entries.delete(entry.url);
      if (failure?.reason === 'LOW_MEMORY') {
        // Short memory ends this pass; the next idle screen preloads again and memory is read anew.
        preloadTried.delete(entry.url);
        preloadUrls = [];
      }
      scheduleNext();
      return;
    }
    entry.status = status;
    entry.src = src;
    entry.failure = failure ? failure.reason : null;
    entry.failedAt = failure ? Date.now() : 0;
    if (status === 'ready') {
      touch(entry);
      evictOldImages();
    }
    onChange(entry.url, status, failure, entry.preload ? { preload: true } : null);
    scheduleNext();
  }

  function requestActive(entry, forceRefresh = false) {
    entry.requestId = `${Date.now()}-${++requestSequence}`;
    const requestId = entry.requestId;
    const isCurrent = () => active === entry && entry.requestId === requestId && entry.status === 'loading';
    const fail = (reason, httpStatus) => {
      if (!isCurrent()) return;
      finish(entry, 'unavailable', null, Number.isInteger(httpStatus) ? { reason, httpStatus } : { reason });
    };
    let queued = false;
    const waitFor = (ms) => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!isCurrent()) return;
        if (!entry.timeoutRetried) {
          entry.timeoutRetried = true;
          transfer = null;
          // A slow first download often finishes on the phone meanwhile. A promised file that never
          // came usually means the phone's saved copy is gone, so that retry asks for a fresh one.
          const retry = () => {
            if (isCurrent()) requestActive(entry, forceRefresh || queued);
          };
          if (!deferred()) {
            retry();
            return;
          }
          // Like a file landing during a set sync, the retry waits for the quiet moment after it.
          arrival = { path: null, settle: retry };
          armResume();
          return;
        }
        fail(queued ? 'FILE_NOT_RECEIVED' : 'PHONE_NO_REPLY');
      }, ms);
      if (timer && typeof timer.unref === 'function') timer.unref();
    };
    waitFor(PHONE_REPLY_WAIT_MS);
    let response;
    try {
      response = request(MESSAGE_TYPES.GET_EXERCISE_IMAGE, {
        imageUrl: entry.url,
        requestId,
        forceRefresh,
      });
    } catch {
      fail('REQUEST_FAILED');
      return;
    }
    Promise.resolve(response)
      .then((response) => {
        const payload = response ? response.payload : null;
        if (payload?.status === 'queued') {
          // On an Active 2 a sent image arrived 0.6 s after this reply, so the file gets a shorter wait.
          if (!isCurrent()) return;
          queued = true;
          waitFor(FILE_WAIT_MS);
          return;
        }
        if (payload?.status === 'disabled') fail('PHONE_DISABLED');
        else fail(EXERCISE_IMAGE_FAILURES.has(payload?.reason) ? payload.reason : 'UNKNOWN', payload?.statusCode);
      })
      .catch(() => fail('REQUEST_FAILED'));
  }

  // A preload goes only when no screen waits on an image; a tap's quiet moment ends with one timer.
  function nextPreload() {
    if (preloadStopped) return null;
    const wait = preloadQuietUntil - Date.now();
    if (wait > 0) {
      if (preloadTimer === null) {
        preloadTimer = setTimeout(() => {
          preloadTimer = null;
          scheduleNext();
        }, wait);
        if (preloadTimer && typeof preloadTimer.unref === 'function') preloadTimer.unref();
      }
      return null;
    }
    for (const url of preloadUrls) {
      if (entries.has(url) || preloadTried.has(url)) continue;
      preloadTried.add(url);
      const entry = { url, requestId: null, status: 'loading', src: null, autoRetries: 0, preload: true };
      entries.set(url, entry);
      return entry;
    }
    return null;
  }

  function processNext() {
    if (active || disposed || !enabled) return;
    if (deferred()) {
      armResume();
      return;
    }
    const entry = queue.shift() || nextPreload();
    if (!entry) return;
    if (entries.get(entry.url) !== entry || entry.status !== 'loading') {
      scheduleNext();
      return;
    }
    active = entry;
    // A refused request is not retried by timers; a later visible load asks again.
    if (!hasMemoryHeadroom('request')) {
      finish(entry, 'unavailable', null, { reason: 'LOW_MEMORY' });
      return;
    }
    requestActive(entry);
  }

  function receive(file) {
    if (disposed) return;
    if (file === undefined) file = inbox?.getNextFile();
    if (!file || file.params?.type !== 'exercise-image') return;
    const url = normalizeExerciseImageUrl(file.params.imageUrl);
    const expected = active;

    function accept(event) {
      const state = event?.data?.readyState || file.readyState;
      if (state !== 'transferred' && state !== 'error' && state !== 'canceled') return;
      if (disposed) return;
      const matches = enabled && expected && active === expected
        && url === expected.url && file.params.requestId === expected.requestId;
      if (!matches) {
        if (state === 'transferred' && !isCachedPath(file.filePath)) remove(file.filePath);
        return;
      }
      if (state === 'error' && file.params.cached === true && !expected.cacheRetried) {
        expected.cacheRetried = true;
        transfer = null;
        requestActive(expected, true);
        return;
      }
      const size = state === 'transferred' ? transferredFileSize(file) : 0;
      const valid = state === 'transferred'
        && size > 0
        && size <= MAX_EXERCISE_IMAGE_BYTES
        && typeof file.filePath === 'string'
        && file.filePath.startsWith('data://');
      if (!valid && state === 'transferred' && !isCachedPath(file.filePath)) remove(file.filePath);
      if (valid) {
        // Showing the image redraws the screen, so that waits for any set sync. The file is kept whatever
        // memory reads now: the transfer was the costly step and cached images are drawn without a check.
        const settle = () => {
          if (active !== expected || expected.status !== 'loading') return;
          finish(expected, 'ready', file.filePath);
        };
        if (!deferred()) {
          settle();
          return;
        }
        if (timer !== null) clearTimeout(timer);
        timer = null;
        arrival = { path: file.filePath, settle };
        armResume();
      } else finish(expected, 'unavailable', null, { reason: state === 'transferred' ? 'FILE_INVALID' : `TRANSFER_${state.toUpperCase()}` });
    }

    file.on('change', accept);
    const matches = enabled && expected && url === expected.url
      && file.params.requestId === expected.requestId;
    if (!matches || file.fileSize > MAX_EXERCISE_IMAGE_BYTES) {
      try { file.cancel(); } catch {}
      if (matches) finish(expected, 'unavailable', null, { reason: 'FILE_TOO_LARGE' });
      return;
    }
    transfer = file;
    accept();
  }

  try {
    if (inbox && typeof inbox.on === 'function') inbox.on('NEWFILE', () => receive());
  } catch { inbox = null; }

  function load(imageUrl, { retry = false, priority = false } = {}) {
    const url = normalizeExerciseImageUrl(imageUrl);
    if (!enabled || disposed) return;
    if (!url) {
      // A link the watch refuses would otherwise never show up anywhere; each one is reported once.
      if (typeof imageUrl === 'string' && imageUrl && !refusedUrls.has(imageUrl) && refusedUrls.size < MAX_REFUSED_URLS) {
        refusedUrls.add(imageUrl);
        onChange(imageUrl, 'unavailable', { reason: 'INVALID_URL' });
      }
      return;
    }
    const existing = entries.get(url);
    if (existing) existing.preload = false;
    const autoRetry = !retry && existing && existing.status === 'unavailable'
      && TEMPORARY_FAILURES.has(existing.failure)
      && existing.autoRetries < MAX_AUTO_RETRIES
      && Date.now() - existing.failedAt >= AUTO_RETRY_AFTER_MS;
    if (existing && (existing.status !== 'unavailable' || !(retry || autoRetry))) {
      if (priority && existing.status === 'loading') {
        const idx = queue.indexOf(existing);
        if (idx > 0) {
          queue.splice(idx, 1);
          queue.unshift(existing);
        }
      }
      return;
    }
    if (!existing && queue.length >= MAX_QUEUE_SIZE) return;
    if (existing) {
      const idx = queue.indexOf(existing);
      if (idx >= 0) queue.splice(idx, 1);
      entries.delete(url);
    }
    const autoRetries = existing ? existing.autoRetries + (autoRetry ? 1 : 0) : 0;
    const entry = { url, requestId: null, status: 'loading', src: null, autoRetries };
    entries.set(url, entry);
    if (priority) {
      queue.unshift(entry);
    } else {
      queue.push(entry);
    }
    scheduleNext();
  }

  return {
    setEnabled(value) {
      enabled = value === true && !disposed;
      if (!enabled) cleanup();
    },
    get(imageUrl) {
      if (!enabled || disposed) return { status: 'disabled', src: null };
      const entry = entries.get(normalizeExerciseImageUrl(imageUrl));
      if (!entry) return { status: 'unavailable', src: null };
      if (entry.status === 'ready') touch(entry);
      return { status: entry.status, src: entry.src };
    },
    load,
    prefetch(imageUrl) { load(imageUrl, { priority: true }); },
    // The day's images, in workout order, fetched in the background into the flash cache. Only as many
    // as the cache keeps: a longer day would evict its own first images and fetch them again later.
    preload(imageUrls) {
      if (!enabled || disposed || !Array.isArray(imageUrls)) return;
      const urls = [];
      for (const imageUrl of imageUrls) {
        const url = normalizeExerciseImageUrl(imageUrl);
        if (url && !urls.includes(url)) urls.push(url);
        if (urls.length >= maxCachedImages) break;
      }
      // The day's cached images become the most recent, so the day's new arrivals evict other days.
      const before = [...entries.keys()].join('\n');
      for (const url of urls) {
        const entry = entries.get(url);
        if (entry?.status === 'ready') touch(entry);
      }
      if ([...entries.keys()].join('\n') !== before) saveStorage();
      preloadUrls = urls;
      preloadStopped = false;
      scheduleNext();
    },
    // A set under way stops preloading until an idle screen preloads again; a tap only pauses it for `quietMs`.
    pausePreload(quietMs) {
      if (Number.isFinite(quietMs) && quietMs > 0) {
        preloadQuietUntil = Math.max(preloadQuietUntil, Date.now() + quietMs);
        clearPreloadTimer();
        scheduleNext();
      } else preloadStopped = true;
    },
    hold,
    defer,
    dispose() {
      disposed = true;
      enabled = false;
      cleanup();
    },
    abandon,
    receive,
  };
}
