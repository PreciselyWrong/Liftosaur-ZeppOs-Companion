import { MAX_EXERCISE_IMAGE_BYTES, normalizeExerciseImageUrl } from '../shared/exercise-images.js';

export const EXERCISE_IMAGE_STORAGE_KEY = 'exerciseImageFilesV1';
export const MAX_EXERCISE_IMAGE_FILES = 32;

export function createExerciseImageService({ downloader, image, outbox, isEnabled, storage }) {
  let operation = null;
  function records() {
    try {
      const value = JSON.parse(storage.getItem(EXERCISE_IMAGE_STORAGE_KEY) || '[]');
      return Array.isArray(value) && value.length <= MAX_EXERCISE_IMAGE_FILES ? value : null;
    } catch { return null; }
  }
  function save(value) { storage.setItem(EXERCISE_IMAGE_STORAGE_KEY, JSON.stringify(value)); }
  function cancel() {
    if (!operation) return;
    operation.canceled = true;
    try { operation.task?.cancel(); } catch {}
    operation.reject?.(new Error('Image download stopped'));
  }
  return {
    cancel,
    async load({ imageUrl, requestId } = {}) {
      if (!isEnabled()) return { status: 'disabled' };
      const url = normalizeExerciseImageUrl(imageUrl);
      if (!url || operation || !downloader || !image || !outbox || !storage) return { status: 'unavailable' };
      const active = operation = { canceled: false };
      const allowed = () => !active.canceled && isEnabled();
      try {
        const files = records();
        if (!files) return { status: 'unavailable' };
        let index = files.findIndex((entry) => entry.url === url);
        if (index < 0) {
          if (files.length >= MAX_EXERCISE_IMAGE_FILES) return { status: 'unavailable' };
          index = files.length;
          files.push({ url, ready: false });
          save(files);
        }
        const source = `data://download/lifto-exercise-${index}-source.png`;
        const target = `data://download/lifto-exercise-${index}.png`;
        // Ready slots are immutable because transfers can survive Side Service teardown.
        if (!files[index].ready) {
          if (files[index].converting) return { status: 'unavailable' };
          await new Promise((resolve, reject) => {
            active.reject = reject;
            const task = active.task = downloader.downloadFile({ url, timeout: 20000, filePath: source });
            task.onProgress = ({ total, loaded }) => {
              if (total > MAX_EXERCISE_IMAGE_BYTES || loaded > MAX_EXERCISE_IMAGE_BYTES || !allowed()) cancel();
            };
            task.onSuccess = ({ statusCode }) => statusCode === 200 ? resolve() : reject(new Error('Image unavailable'));
            task.onFail = () => reject(new Error('Image unavailable'));
          });
          active.task = null;
          active.reject = null;
          if (!allowed()) return { status: 'disabled' };
          files[index].converting = true;
          save(files);
          let timeout;
          const conversion = (async () => image.convert({ filePath: source, targetFilePath: target }))();
          conversion.then(() => {
            const latest = records();
            if (latest?.[index]?.url === url) { latest[index].converting = false; save(latest); }
          }, () => {
            const latest = records();
            if (latest?.[index]?.url === url) { latest[index].converting = false; save(latest); }
          });
          let converted;
          try {
            converted = await Promise.race([conversion, new Promise((resolve, reject) => {
              timeout = setTimeout(() => { active.canceled = true; reject(new Error('Image conversion timeout')); }, 20000);
              timeout?.unref?.();
            })]);
          } finally { clearTimeout(timeout); }
          if (!allowed()) return { status: 'disabled' };
          if (!Number.isFinite(converted?.options?.size) || converted.options.size <= 0 || converted.options.size > MAX_EXERCISE_IMAGE_BYTES) return { status: 'unavailable' };
          files[index].ready = true;
          files[index].converting = false;
          save(files);
        }
        if (!allowed()) return { status: 'disabled' };
        outbox.enqueueFile(target, { type: 'exercise-image', imageUrl: url, requestId });
        return { status: 'queued', imageUrl: url };
      } catch {
        return { status: 'unavailable' };
      } finally {
        if (operation === active) operation = null;
      }
    },
  };
}
