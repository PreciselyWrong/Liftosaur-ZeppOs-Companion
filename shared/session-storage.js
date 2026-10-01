/**
 * Durable session snapshot.
 *
 * A session is only recoverable if the plan is stored alongside the journal:
 * the journal alone is a list of taps with no exercises to replay them against.
 * Both are written as one snapshot on every critical event.
 *
 * The adapter is injected so this file stays runnable under plain Node. On the
 * watch it is backed by `@zos/storage`.
 */

const SNAPSHOT_VERSION = 2;

export function createMemoryStorageAdapter() {
  let memoryData = null;
  return {
    read: () => memoryData,
    write: (data) => {
      memoryData = data;
    },
    remove: () => {
      memoryData = null;
    },
  };
}

/**
 * Watch storage with a memory copy of the snapshot it could not write.
 * Every write tries the watch again: one transient failure, for example while
 * memory is short, must not silently keep every later save in memory only.
 * `write` returns false while the newest snapshot exists only in memory.
 */
export function createFallbackStorageAdapter(
  primary,
  fallback = createMemoryStorageAdapter(),
  onFallback = null
) {
  let newestInMemory = !primary;

  function report(err) {
    if (typeof onFallback === 'function') onFallback(err);
  }

  return {
    read() {
      if (newestInMemory) return fallback.read();
      try {
        return primary.read();
      } catch (err) {
        report(err);
        return fallback.read();
      }
    },
    write(data) {
      if (primary) {
        try {
          primary.write(data);
          newestInMemory = false;
          fallback.remove();
          return true;
        } catch (err) {
          report(err);
        }
      }
      fallback.write(data);
      newestInMemory = true;
      return false;
    },
    remove() {
      fallback.remove();
      newestInMemory = !primary;
      if (!primary) return;
      try {
        primary.remove();
      } catch (err) {
        report(err);
      }
    },
  };
}

export function createSessionStore(adapter) {
  return {
    /** Returns `{plan, journal, startedAt}` or null when there is nothing to resume. */
    load() {
      let raw;
      try {
        raw = adapter.read();
      } catch (err) {
        console.log('[session-store] read failed:', err?.message || String(err));
        return null;
      }
      if (!raw) return null;

      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!parsed || (parsed.version !== 1 && parsed.version !== SNAPSHOT_VERSION)) return null;
        if (!parsed.plan || !Array.isArray(parsed.journal)) return null;
        return {
          plan: parsed.plan,
          journal: parsed.journal,
          startedAt: parsed.startedAt ?? null,
          sync: parsed.version === 1
            ? { mode: 'LEGACY' }
            : (parsed.sync || {
                mode: parsed.plan?.source === 'WORKOUT_API' ? 'DIRECT' : 'LEGACY',
              }),
        };
      } catch (err) {
        console.log('[session-store] snapshot unreadable:', err?.message || String(err));
        return null;
      }
    },

    save({ plan, journal, startedAt = null, sync = null }) {
      if (!plan || !Array.isArray(journal)) return false;
      try {
        const written = adapter.write(JSON.stringify({
          version: SNAPSHOT_VERSION,
          plan,
          journal,
          startedAt,
          sync: sync || { mode: plan?.source === 'WORKOUT_API' ? 'DIRECT' : 'LEGACY' },
        }));
        return written !== false;
      } catch (err) {
        console.log('[session-store] write failed:', err?.message || String(err));
        return false;
      }
    },

    hasSession() {
      return this.load() !== null;
    },

    clear() {
      try {
        adapter.remove();
      } catch (err) {
        console.log('[session-store] clear failed:', err?.message || String(err));
      }
    },
  };
}
