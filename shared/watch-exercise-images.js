import { rmSync, statSync } from '@zos/fs';
import TransferFile from '@zos/ble/TransferFile';
import { createExerciseImageClient } from './exercise-image-client.js';

export function createWatchExerciseImages({ request, onChange, storage = null, maxCachedImages = 4 }) {
  let nativeInbox = null;
  try {
    const TransferClass = typeof TransferFile === 'function'
      ? TransferFile
      : TransferFile?.TransferFile;
    if (TransferClass) {
      const transfer = new TransferClass();
      nativeInbox = transfer.inbox || (typeof transfer.getInbox === 'function' ? transfer.getInbox() : null);
    }
  } catch {}
  console.log('[lifto] exercise image inbox ' + (nativeInbox ? 'ready' : 'missing'));
  const inbox = nativeInbox && typeof nativeInbox.getNextFile === 'function'
    ? {
      on(_, callback) {
        for (const event of ['NEWFILE', 'FILE', 'newfile', 'file']) {
          try { nativeInbox.on(event, callback); } catch {}
        }
      },
      getNextFile() { return nativeInbox.getNextFile(); },
    }
    : null;
  const dataPath = (path) =>
    typeof path === 'string' && path.startsWith('data://') ? path.slice(7) : null;
  const client = createExerciseImageClient({
    inbox,
    request,
    storage,
    maxCachedImages,
    onChange: (url, status) => {
      console.log('[lifto] exercise image state ' + status);
      onChange(url, status);
    },
    fileSize: (path) => {
      const resolved = dataPath(path);
      if (!resolved) return null;
      try {
        const stat = statSync({ path: resolved });
        return stat && typeof stat.size === 'number' ? stat.size : null;
      } catch {
        return null;
      }
    },
    removeFile: (path) => {
      const resolved = dataPath(path);
      if (resolved) {
        try { rmSync({ path: resolved }); } catch {}
      }
    },
  });

  return {
    ...client,
    receive(file) {
      console.log('[lifto] exercise image received ' + (file?.readyState || 'unknown')
        + ' ' + (file?.params?.type || 'no-type'));
      client.receive(file);
    },
  };
}

