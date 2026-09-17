/**
 * Pure rest alert tracker and deduplicator.
 *
 * Tracks impending rest warning (at warningSeconds remaining), absolute rest
 * expiry, foreground zero-crossing alerts, overtime interval alerts, and
 * onResume rest expiry detection while unfocused.
 *
 * Platform independent: runs under Node and Zepp OS DataWidget / Mini Program.
 */

export function createRestAlertTracker({ warningSeconds = 8, overtimeStepSeconds = 30 } = {}) {
  let lastAlertedWarningEndsAt = null;
  let lastAlertedRestEndsAt = null;
  let lastAlertedOvertimeStep = -1;

  return {
    reset() {
      lastAlertedWarningEndsAt = null;
      lastAlertedRestEndsAt = null;
      lastAlertedOvertimeStep = -1;
    },

    checkTick({ rest, now = Date.now() } = {}) {
      if (!rest || rest.isPaused || !Number.isFinite(rest.endsAt)) {
        return { shouldAlert: false, reason: null };
      }

      const remaining = Math.ceil((rest.endsAt - now) / 1000);

      // Warning when approaching zero (e.g. at 8 seconds remaining)
      if (remaining > 0) {
        if (
          warningSeconds > 0 &&
          remaining <= warningSeconds &&
          (!Number.isFinite(rest.duration) || rest.duration > warningSeconds) &&
          lastAlertedWarningEndsAt !== rest.endsAt
        ) {
          lastAlertedWarningEndsAt = rest.endsAt;
          return { shouldAlert: true, reason: 'WARNING', step: 0 };
        }
        return { shouldAlert: false, reason: null };
      }

      // Past or at zero: suppress any later warning for this rest period
      lastAlertedWarningEndsAt = rest.endsAt;

      // First time reaching zero for this rest period
      if (lastAlertedRestEndsAt !== rest.endsAt) {
        lastAlertedRestEndsAt = rest.endsAt;
        lastAlertedOvertimeStep = 0;
        return { shouldAlert: true, reason: 'ZERO_REACHED', step: 0 };
      }

      // Overtime step tracking (e.g. every 30 seconds of overtime)
      const overtimeSeconds = -remaining;
      const step = Math.floor(overtimeSeconds / overtimeStepSeconds);
      if (step > lastAlertedOvertimeStep && step > 0) {
        lastAlertedOvertimeStep = step;
        return { shouldAlert: true, reason: 'OVERTIME', step };
      }

      return { shouldAlert: false, reason: null };
    },

    checkResume({ rest, now = Date.now() } = {}) {
      if (!rest || rest.isPaused || !Number.isFinite(rest.endsAt)) {
        return { shouldAlert: false, reason: null };
      }

      const remaining = Math.ceil((rest.endsAt - now) / 1000);
      if (remaining <= 0 && lastAlertedRestEndsAt !== rest.endsAt) {
        lastAlertedRestEndsAt = rest.endsAt;
        lastAlertedWarningEndsAt = rest.endsAt;
        lastAlertedOvertimeStep = Math.max(0, Math.floor(-remaining / overtimeStepSeconds));
        return { shouldAlert: true, reason: 'RESUME_EXPIRED', step: 0 };
      }

      if (
        remaining > 0 &&
        warningSeconds > 0 &&
        remaining <= warningSeconds &&
        (!Number.isFinite(rest.duration) || rest.duration > warningSeconds) &&
        lastAlertedWarningEndsAt !== rest.endsAt
      ) {
        lastAlertedWarningEndsAt = rest.endsAt;
        return { shouldAlert: true, reason: 'WARNING', step: 0 };
      }

      return { shouldAlert: false, reason: null };
    },
  };
}
