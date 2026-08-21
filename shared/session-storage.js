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

const SNAPSHOT_VERSION = 1;

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

export function createFallbackStorageAdapter(
  primary,
  fallback = createMemoryStorageAdapter(),
  onFallback = null
) {
  let fallbackActive = !primary;

  function activateFallback(err) {
    fallbackActive = true;
    if (typeof onFallback === 'function') onFallback(err);
  }

  return {
    read() {
      if (fallbackActive) return fallback.read();
      try {
        return primary.read();
      } catch (err) {
        activateFallback(err);
        return fallback.read();
      }
    },
    write(data) {
      if (fallbackActive) return fallback.write(data);
      try {
        return primary.write(data);
      } catch (err) {
        activateFallback(err);
        return fallback.write(data);
      }
    },
    remove() {
      if (fallbackActive) return fallback.remove();
      try {
        return primary.remove();
      } catch (err) {
        activateFallback(err);
        return fallback.remove();
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
        if (!parsed || parsed.version !== SNAPSHOT_VERSION) return null;
        if (!parsed.plan || !Array.isArray(parsed.journal)) return null;
        return {
          plan: parsed.plan,
          journal: parsed.journal,
          startedAt: parsed.startedAt ?? null,
        };
      } catch (err) {
        console.log('[session-store] snapshot unreadable:', err?.message || String(err));
        return null;
      }
    },

    save({ plan, journal, startedAt = null }) {
      if (!plan || !Array.isArray(journal)) return false;
      try {
        adapter.write(JSON.stringify({ version: SNAPSHOT_VERSION, plan, journal, startedAt }));
        return true;
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
