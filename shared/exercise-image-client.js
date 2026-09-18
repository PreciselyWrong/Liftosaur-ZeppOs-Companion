import { MESSAGE_TYPES } from './protocol.js';
import { MAX_EXERCISE_IMAGE_BYTES, normalizeExerciseImageUrl } from './exercise-images.js';

const MAX_CACHED_IMAGES = 4;
const MAX_QUEUE_SIZE = 16;
export const EXERCISE_IMAGE_WATCH_STORAGE_KEY = 'watchExerciseImagesV7';
let requestSequence = 0;

export function createExerciseImageClient({
  inbox,
  request,
  removeFile,
  fileSize = () => null,
  onChange = () => {},
  storage = null,
  maxCachedImages = storage ? 32 : 4,
}) {
  let enabled = false;
  let disposed = false;
  let active = null;
  let transfer = null;
  let timer = null;
  let scheduled = false;
  const entries = new Map();
  const queue = [];

  if (storage && typeof storage.getItem === 'function') {
    try {
      const raw = storage.getItem(EXERCISE_IMAGE_WATCH_STORAGE_KEY);
      const saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(saved)) {
        for (const item of saved) {
          if (item?.url && item?.src) {
            const size = fileSize(item.src);
            if (size === null || size > 0) {
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

  function cleanup() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    try { transfer?.cancel(); } catch {}
    transfer = null;
    active = null;
    queue.length = 0;
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
      const size = state === 'transferred' ? transferredFileSize(file) : 0;
      const valid = state === 'transferred'
        && size > 0
        && size <= MAX_EXERCISE_IMAGE_BYTES
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

  try {
    if (inbox && typeof inbox.on === 'function') inbox.on('NEWFILE', () => receive());
  } catch { inbox = null; }

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
    load(imageUrl, { retry = false, priority = false } = {}) {
      const url = normalizeExerciseImageUrl(imageUrl);
      if (!enabled || disposed || !url) return;
      const existing = entries.get(url);
      if (existing && (existing.status !== 'unavailable' || !retry)) {
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
      const entry = { url, requestId: null, status: 'loading', src: null };
      entries.set(url, entry);
      if (priority) {
        queue.unshift(entry);
      } else {
        queue.push(entry);
      }
      scheduleNext();
    },
    dispose() {
      disposed = true;
      enabled = false;
      cleanup();
    },
    abandon,
    receive,
  };
}
