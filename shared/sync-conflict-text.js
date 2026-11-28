/**
 * What the lifter reads when Liftosaur refuses a write for good. The codes are the API's own
 * (plus the two the phone adds), kept apart so each failure points at what to fix; a code that is
 * not listed has no text here and the screen falls back to its generic line.
 */
const CHANGED = 'Workout changed in Liftosaur';
const NO_KEY = 'No API key on the phone';
const ANOTHER_ACTIVE = 'Another workout is active in Liftosaur';

const MESSAGES = {
  workout_mismatch: 'Phone workout is not this one',
  workout_already_active: ANOTHER_ACTIVE,
  workout_start_time_taken: ANOTHER_ACTIVE,
  no_active_workout: 'No active workout in Liftosaur',
  set_not_found: CHANGED,
  entry_not_found: CHANGED,
  ambiguous_entry: CHANGED,
  missing_set_input: 'A set lacks reps or weight',
  invalid_input: 'Liftosaur refused a set',
  program_error: 'Program error in Liftosaur',
  day_not_found: 'Day not found in Liftosaur',
  NO_API_KEY: NO_KEY,
  NOT_CONFIGURED: NO_KEY,
};

export function syncConflictMessage(code) {
  return Object.prototype.hasOwnProperty.call(MESSAGES, code) ? MESSAGES[code] : null;
}
