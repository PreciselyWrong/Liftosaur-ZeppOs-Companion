/**
 * Pure widget state for the phase 0 spike.
 *
 * No Zepp OS import belongs in this file: it must stay runnable under plain
 * Node so the state can be tested without a device or simulator.
 */

export const STATUS_READY = 'READY';
export const STATUS_TEST = 'TEST';
export const NO_HEART_RATE = 'N/A';


function isUsableHeartRate(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function createWidgetState() {
  let status = STATUS_READY;
  let heartRate = null;
  let transitions = 0;

  return {
    view() {
      return {
        title: 'Liftosaur',
        status,
        hr: heartRate === null ? NO_HEART_RATE : String(heartRate),
      };
    },

    /** One tap, one transition. */
    click() {
      status = status === STATUS_READY ? STATUS_TEST : STATUS_READY;
      transitions += 1;
      return status;
    },

    /** A reading the System Workout owns; an unusable one keeps the last good value. */
    setHeartRate(value) {
      if (isUsableHeartRate(value)) {
        heartRate = value;
      }
    },

    transitionCount() {
      return transitions;
    },
  };
}
