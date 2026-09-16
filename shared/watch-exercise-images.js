import { rmSync, statSync } from '@zos/fs';
import { createExerciseImageClient } from './exercise-image-client.js';

export function createWatchExerciseImages({ request, onChange }) {
  let receiver;
  let incoming;
  // ZML owns the native inbox and forwards completed/started files to the page.
  const inbox = { on(event, callback) { receiver = callback; }, getNextFile() { return incoming; } };
  const dataPath = (path) =>
    typeof path === 'string' && path.startsWith('data://') ? path.slice(7) : null;
  const client = createExerciseImageClient({
    inbox,
    request,
    onChange,
    fileSize: (path) => {
      const resolved = dataPath(path);
      return resolved ? statSync({ path: resolved })?.size : null;
    },
    removeFile: (path) => {
      const resolved = dataPath(path);
      if (resolved) rmSync({ path: resolved });
    },
  });
  return { ...client, receive(file) { incoming = file; if (receiver) receiver(); incoming = null; } };
}
