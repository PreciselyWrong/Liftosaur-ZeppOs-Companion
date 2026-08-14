/**
 * Persistent session store for crash recovery and offline durability.
 */

export function createMemoryStorageAdapter() {
  let memoryData = null;
  return {
    read() {
      return memoryData;
    },
    write(data) {
      memoryData = data;
    },
    remove() {
      memoryData = null;
    },
  };
}

export function createSessionStore(adapter) {
  return {
    hasActiveSession() {
      const journal = this.loadJournal();
      return Array.isArray(journal) && journal.length > 0;
    },

    loadJournal() {
      try {
        const raw = adapter.read();
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        console.log('[session-store] failed to parse journal', err?.message || String(err));
        return [];
      }
    },

    saveJournal(journal) {
      try {
        adapter.write(JSON.stringify(journal));
      } catch (err) {
        console.log('[session-store] failed to write journal', err?.message || String(err));
      }
    },

    appendEvent(event) {
      const current = this.loadJournal();
      current.push(event);
      this.saveJournal(current);
    },

    clearSession() {
      try {
        adapter.remove();
      } catch (err) {
        console.log('[session-store] failed to clear session', err?.message || String(err));
      }
    },
  };
}
