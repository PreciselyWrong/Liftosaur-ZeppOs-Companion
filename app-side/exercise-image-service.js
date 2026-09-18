import { exerciseDownloadUrl, exerciseImageFileExtension, MAX_EXERCISE_IMAGE_BYTES, normalizeExerciseImageUrl } from '../shared/exercise-images.js';

export const EXERCISE_IMAGE_STORAGE_KEY = 'exerciseImageFilesV7';
export const MAX_EXERCISE_IMAGE_FILES = 32;
let serviceSequence = 0;
const unavailable = (reason) => ({ status: 'unavailable', reason });
const safeDetail = (value) => typeof value === 'string'
  ? value.replace(/(?:https?:\/\/|data:\/\/|[a-zA-Z]:[\\/])\S+/g, '[path]').slice(0, 120)
  : null;

export function createExerciseImageService({ download, convert, sendFile, isEnabled, storage, onFailure, generation = `${Date.now()}-${++serviceSequence}` }) {
  let operation = null;
  let queuePromise = Promise.resolve();

  function records() {
    try {
      const value = JSON.parse(storage.getItem(EXERCISE_IMAGE_STORAGE_KEY) || '[]');
      return Array.isArray(value) && value.length <= MAX_EXERCISE_IMAGE_FILES
        ? value.filter((entry) => entry.generation === generation) : null;
    } catch { return null; }
  }
  function save(value) {
    storage.setItem(EXERCISE_IMAGE_STORAGE_KEY,
      JSON.stringify(value.map((entry) => ({ ...entry, generation }))));
  }
  function cancel() {
    if (!operation) return;
    operation.canceled = true;
    try { operation.task?.cancel(); } catch {}
    if (operation.reject) operation.reject(new Error('Image download stopped'));
  }

  async function performLoad({ imageUrl, requestId } = {}) {
    if (!isEnabled()) return { status: 'disabled' };
    const url = normalizeExerciseImageUrl(imageUrl);
    if (!url) return unavailable('INVALID_URL');
    if (!download || !convert || !sendFile || !storage) return unavailable('SERVICE_UNAVAILABLE');
    const active = operation = { canceled: false };
    const allowed = () => !active.canceled && isEnabled();
    let stage = 'download';
      try {
        const files = records();
        if (!files) return unavailable('STORAGE_INVALID');
        let index = files.findIndex((entry) => entry.url === url && entry.ready && entry.targetPath);
        if (index < 0) {
          for (let i = files.length - 1; i >= 0; i--) {
            if (files[i].url === url && !files[i].converting) { index = i; break; }
          }
        }
        if (index < 0) {
          if (files.length >= MAX_EXERCISE_IMAGE_FILES) return unavailable('STORAGE_FULL');
          index = files.length;
          files.push({ url, ready: false });
          save(files);
        }
        const source = `data://download/lifto-exercise-${generation}-${index}-source.${exerciseImageFileExtension(url)}`;
        const target = `${source}_converted`;
        // Ready slots are immutable because transfers can survive Side Service teardown.
        if (!files[index].ready || !files[index].targetPath) {
          if (files[index].converting) return unavailable('CONVERSION_IN_PROGRESS');
          const downloadUrl = exerciseDownloadUrl(url) || url;
          const downloadFile = (options) => new Promise((resolve, reject) => {
            active.reject = reject;
            const task = active.task = download(downloadUrl, options);
            task.onProgress = ({ total, loaded }) => {
              if (total > MAX_EXERCISE_IMAGE_BYTES || loaded > MAX_EXERCISE_IMAGE_BYTES || !allowed()) cancel();
            };
            task.onSuccess = (event = {}) => event.statusCode === 200
              ? resolve(event)
              : reject({ code: 'HTTP_STATUS', statusCode: event.statusCode });
            task.onFail = (event) => reject({
              code: 'NATIVE_FAILURE', nativeCode: event?.code,
              nativeMessage: typeof event === 'string' ? event : event?.message,
              eventPresent: event !== undefined,
            });
          });
          const downloaded = await downloadFile({ headers: {}, timeout: 20000 });
          const inputPath = downloaded.tempFilePath || downloaded.filePath;
          active.task = null;
          active.reject = null;
          if (!allowed()) return { status: 'disabled' };
          if (typeof inputPath !== 'string' || !inputPath.startsWith('data://download/')) return unavailable('DOWNLOAD_PATH_INVALID');
          files[index].converting = true;
          save(files);
          stage = 'conversion';
          let timeout;
          const conversion = (async () => convert({ filePath: inputPath, targetFilePath: target }))();
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
              timeout = setTimeout(() => { active.canceled = true; reject({ code: 'TIMEOUT' }); }, 20000);
              if (timeout && typeof timeout.unref === 'function') timeout.unref();
            })]);
          } finally { clearTimeout(timeout); }
          if (!allowed()) return { status: 'disabled' };
          if (!Number.isFinite(converted?.options?.size) || converted.options.size <= 0 || converted.options.size > MAX_EXERCISE_IMAGE_BYTES ||
              typeof converted.targetFilePath !== 'string' || !converted.targetFilePath.startsWith('data://download/')) return unavailable('CONVERSION_OUTPUT_INVALID');
          files[index].ready = true;
          files[index].targetPath = converted.targetFilePath;
          files[index].converting = false;
          save(files);
        }
        if (!allowed()) return { status: 'disabled' };
        stage = 'transfer';
        sendFile(files[index].targetPath, { type: 'exercise-image', imageUrl: url, requestId });
        return { status: 'queued', imageUrl: url };
      } catch (error) {
        if (!active.canceled && onFailure) {
          const details = { stage, code: error?.code === 'HTTP_STATUS' || error?.code === 'NATIVE_FAILURE' ? error.code : 'UNEXPECTED' };
          if (details.code === 'HTTP_STATUS' && Number.isInteger(error.statusCode)) details.statusCode = error.statusCode;
          if (details.code === 'NATIVE_FAILURE' && Number.isInteger(error.nativeCode)) details.nativeCode = error.nativeCode;
          if (details.code === 'NATIVE_FAILURE' && safeDetail(error.nativeMessage)) details.message = safeDetail(error.nativeMessage);
          if (details.code === 'UNEXPECTED') details.message = String(error?.message || error).replace(/(?:https?:\/\/|data:\/\/)\S+/g, '[path]').slice(0, 120);
          onFailure(details);
        }
        const code = /downloadFile is not supported in simulator/i.test(error?.nativeMessage || '')
          ? 'SIMULATOR_UNSUPPORTED'
          : error?.code === 'HTTP_STATUS' || error?.code === 'NATIVE_FAILURE' || error?.code === 'TIMEOUT'
          ? error.code : active.canceled ? 'CANCELED' : 'UNEXPECTED';
        const result = unavailable(`${stage.toUpperCase()}_${code}`);
        if (code === 'NATIVE_FAILURE') {
          if (Number.isInteger(error.nativeCode)) result.nativeCode = error.nativeCode;
          result.detail = safeDetail(error.nativeMessage) || (error.eventPresent ? 'NO_MESSAGE' : 'NO_EVENT');
        }
        return result;
      } finally {
        if (operation === active) operation = null;
      }
    }

  return {
    cancel,
    generation,
    load(params = {}) {
      if (!isEnabled()) return Promise.resolve({ status: 'disabled' });
      if (!operation) {
        const currentPromise = performLoad(params);
        queuePromise = currentPromise.catch(() => {});
        return currentPromise;
      }
      const run = () => performLoad(params);
      const nextPromise = queuePromise.then(run, run);
      queuePromise = nextPromise.catch(() => {});
      return nextPromise;
    },
  };
}


