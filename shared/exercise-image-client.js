import { MESSAGE_TYPES } from './protocol.js';
import { MAX_EXERCISE_IMAGE_BYTES, normalizeExerciseImageUrl } from './exercise-images.js';

const MAX_CACHED_IMAGES = 4;
let requestSequence = 0;

export function createExerciseImageClient({ inbox, request, removeFile, onChange = () => {} }) {
  let enabled = false;
  let disposed = false;
  let active = null;
  let transfer = null;
  let timer = null;
  let scheduled = false;
  const entries = new Map();
  const queue = [];

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

  function clearTransfer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    transfer = null;
    active = null;
  }

  function cleanup() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    try { transfer?.cancel(); } catch {}
    transfer = null;
    active = null;
    queue.length = 0;
    const removed = new Set();
    for (const entry of entries.values()) {
      if (entry.src && !removed.has(entry.src)) {
        removed.add(entry.src);
        remove(entry.src);
      }
    }
    entries.clear();
  }
  function abandon() {
    disposed = true;
    enabled = false;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    transfer = null;
    active = null;
    queue.length = 0;
    entries.clear();
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
    while (readyCount > MAX_CACHED_IMAGES) {
      for (const [url, entry] of entries) {
        if (entry.status !== 'ready') continue;
        entries.delete(url);
        remove(entry.src);
        readyCount--;
        break;
      }
    }
  }

  function scheduleNext() {
    if (scheduled || active || disposed || !enabled || queue.length === 0) return;
    scheduled = true;
    Promise.resolve().then(() => {
      scheduled = false;
      processNext();
    });
  }

  function finish(entry, status, src = null) {
    if (active !== entry) return;
    clearTransfer();
    entry.status = status;
    entry.src = src;
    if (status === 'ready') {
      touch(entry);
      evictOldImages();
    }
    onChange(entry.url, status);
    scheduleNext();
  }

  function processNext() {
    if (active || disposed || !enabled) return;
    const entry = queue.shift();
    if (!entry) return;
    if (entries.get(entry.url) !== entry || entry.status !== 'loading') {
      scheduleNext();
      return;
    }
    active = entry;
    entry.requestId = `${Date.now()}-${++requestSequence}`;
    const fail = () => {
      if (active === entry && entry.status === 'loading') finish(entry, 'unavailable');
    };
    timer = setTimeout(fail, 45000);
    if (timer && typeof timer.unref === 'function') timer.unref();
    let response;
    try {
      response = request(MESSAGE_TYPES.GET_EXERCISE_IMAGE, {
        imageUrl: entry.url,
        requestId: entry.requestId,
      });
    } catch {
      fail();
      return;
    }
    Promise.resolve(response)
      .then((response) => {
        if (response?.payload?.status !== 'queued') fail();
      })
      .catch(fail);
  }

  function receive() {
    if (disposed) return;
    const file = inbox.getNextFile();
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
      const valid = state === 'transferred'
        && file.fileSize > 0
        && file.fileSize <= MAX_EXERCISE_IMAGE_BYTES
        && typeof file.filePath === 'string'
        && file.filePath.startsWith('data://');
      if (!valid && state === 'transferred' && !isCachedPath(file.filePath)) remove(file.filePath);
      finish(expected, valid ? 'ready' : 'unavailable', valid ? file.filePath : null);
    }

    file.on('change', accept);
    const matches = enabled && expected && url === expected.url
      && file.params.requestId === expected.requestId;
    if (!matches || file.fileSize > MAX_EXERCISE_IMAGE_BYTES) {
      try { file.cancel(); } catch {}
      if (matches) finish(expected, 'unavailable');
      return;
    }
    transfer = file;
    accept();
  }

  try { inbox?.on('NEWFILE', receive); } catch { inbox = null; }

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
    load(imageUrl, { retry = false } = {}) {
      const url = normalizeExerciseImageUrl(imageUrl);
      if (!enabled || disposed || !url || !inbox) return;
      const existing = entries.get(url);
      if (existing && (existing.status !== 'unavailable' || !retry)) return;
      if (!existing && queue.length >= MAX_CACHED_IMAGES) return;
      if (existing) entries.delete(url);
      const entry = { url, requestId: null, status: 'loading', src: null };
      entries.set(url, entry);
      queue.push(entry);
      scheduleNext();
    },
    dispose() {
      disposed = true;
      enabled = false;
      cleanup();
    },
    abandon,
  };
}
