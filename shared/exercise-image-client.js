import { MESSAGE_TYPES } from './protocol.js';
import { MAX_EXERCISE_IMAGE_BYTES, normalizeExerciseImageUrl } from './exercise-images.js';

let requestSequence = 0;

export function createExerciseImageClient({ inbox, request, removeFile, onChange = () => {} }) {
  let enabled = false;
  let disposed = false;
  let current = null;
  let transfer = null;
  let timer = null;
  function cleanup() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    try { transfer?.cancel(); } catch {}
    transfer = null;
    if (current?.src) { try { removeFile(current.src); } catch {} }
    current = null;
  }
  function abandon() {
    disposed = true;
    enabled = false;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    transfer = null;
    current = null;
  }
  function receive() {
    if (disposed) return;
    const file = inbox.getNextFile();
    if (!file || file.params?.type !== 'exercise-image') return;
    const url = normalizeExerciseImageUrl(file.params.imageUrl);
    const expected = current;
    function accept(event) {
      const state = event?.data?.readyState || file.readyState;
      if (state !== 'transferred' && state !== 'error' && state !== 'canceled') return;
      if (disposed) return;
      if (!enabled || !expected || current !== expected || url !== current.url || file.params.requestId !== expected.requestId) {
        if (state === 'transferred' && file.filePath !== current?.src) { try { removeFile(file.filePath); } catch {} }
        return;
      }
      if (timer !== null) clearTimeout(timer);
      timer = null;
      transfer = null;
      const valid = state === 'transferred' && file.fileSize > 0 && file.fileSize <= MAX_EXERCISE_IMAGE_BYTES && typeof file.filePath === 'string' && file.filePath.startsWith('data://');
      current.status = valid ? 'ready' : 'unavailable';
      current.src = valid ? file.filePath : null;
      if (!valid && state === 'transferred') { try { removeFile(file.filePath); } catch {} }
      onChange();
    }
    file.on('change', accept);
    if (!enabled || !expected || url !== expected.url || file.params.requestId !== expected.requestId || file.fileSize > MAX_EXERCISE_IMAGE_BYTES) {
      try { file.cancel(); } catch {}
      accept();
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
      return current?.url === normalizeExerciseImageUrl(imageUrl) ? { status: current.status, src: current.src } : { status: 'unavailable', src: null };
    },
    load(imageUrl) {
      const url = normalizeExerciseImageUrl(imageUrl);
      if (!enabled || disposed || !url || !inbox || (current?.url === url && current.status !== 'unavailable')) return;
      cleanup();
      const expected = current = { url, requestId: `${Date.now()}-${++requestSequence}`, status: 'loading', src: null };
      const fail = () => {
        if (disposed || !enabled || current !== expected || current.status !== 'loading') return;
        current.status = 'unavailable';
        onChange();
      };
      timer = setTimeout(fail, 45000);
      if (timer && typeof timer.unref === 'function') timer.unref();
      Promise.resolve().then(() => {
        if (disposed || !enabled || current !== expected) return;
        return request(MESSAGE_TYPES.GET_EXERCISE_IMAGE, { imageUrl: url, requestId: expected.requestId });
      })
        .then((response) => { if (response?.payload?.status !== 'queued') fail(); }).catch(fail);
    },
    abandon,
    dispose() { disposed = true; enabled = false; cleanup(); },
  };
}
