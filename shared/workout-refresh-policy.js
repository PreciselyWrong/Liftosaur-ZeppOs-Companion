export const MIN_REFRESH_INTERVAL_MS = 10000;
export const PASSIVE_REFRESH_INTERVAL_MS = 15000;

const FAILURE_BACKOFF_MS = [30000, 60000, 120000];

export function createWorkoutRefreshPolicy({ now = () => Date.now() } = {}) {
  let lastRequestAt = null;
  let refreshRequested = false;
  let failureCount = 0;

  function requiredInterval() {
    if (failureCount > 0) {
      return FAILURE_BACKOFF_MS[Math.min(failureCount - 1, FAILURE_BACKOFF_MS.length - 1)];
    }
    return refreshRequested ? MIN_REFRESH_INTERVAL_MS : PASSIVE_REFRESH_INTERVAL_MS;
  }

  return {
    request() {
      refreshRequested = true;
    },

    beginPoll() {
      const requestedAt = now();
      if (lastRequestAt !== null && requestedAt - lastRequestAt < requiredInterval()) {
        return false;
      }
      lastRequestAt = requestedAt;
      refreshRequested = false;
      return true;
    },

    markSuccess() {
      failureCount = 0;
    },

    markFailure() {
      failureCount += 1;
    },

    markAuthoritativeResponse() {
      lastRequestAt = now();
      refreshRequested = false;
      failureCount = 0;
    },
  };
}
