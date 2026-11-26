import { rmSync, statSync } from '@zos/fs';
import TransferFile from '@zos/ble/TransferFile';
import { createExerciseImageClient } from './exercise-image-client.js';
import { hasImageMemoryHeadroom } from './exercise-images.js';

export function createWatchExerciseImages({ request, onChange, storage = null, maxCachedImages = 4, readMemory = () => null }) {
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
    hasMemoryHeadroom: (stage) => {
      const memory = readMemory();
      const free = memory && Number.isFinite(memory.systemTotal) && Number.isFinite(memory.systemUsed)
        ? memory.systemTotal - memory.systemUsed : 'unknown';
      console.log('[lifto] exercise image memory ' + stage + ' free=' + free
        + ' used=' + (memory ? memory.systemUsed : 'unknown') + ' app=' + (memory ? memory.appUsed : 'unknown'));
      return hasImageMemoryHeadroom(memory);
    },
    onChange: (...change) => {
      console.log('[lifto] exercise image state ' + change[1] + (change[3]?.preload ? ' preload' : ''));
      onChange(...change);
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

