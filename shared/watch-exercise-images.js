import { rmSync } from '@zos/fs';
import { createExerciseImageClient } from './exercise-image-client.js';

export function createWatchExerciseImages({ request, onChange }) {
  let receiver;
  let incoming;
  // ZML owns the native inbox and forwards completed/started files to the page.
  const inbox = { on(event, callback) { receiver = callback; }, getNextFile() { return incoming; } };
  const client = createExerciseImageClient({ inbox, request, onChange, removeFile: (path) => {
    if (typeof path === 'string' && path.startsWith('data://')) rmSync({ path: path.slice(7) });
  } });
  return { ...client, receive(file) { incoming = file; if (receiver) receiver(); incoming = null; } };
}
