/**
 * Which entry to feature in each picker.
 *
 * These functions suggest; they never choose. Each returns an index the UI
 * renders large and first, and the user still has to tap it. A return of -1
 * means the account data points nowhere, so the list is shown flat.
 *
 * The only input is what Liftosaur reports: the active program flag and the
 * most recent history record. Nothing here reads a name or a date.
 */

/** The program Liftosaur marks as active. */
export function suggestedProgramIndex(programs = []) {
  return programs.findIndex((program) => program.isCurrent);
}

/**
 * A restored session retains the program identity in its persisted plan while
 * picker state lives only in memory. Reconstruct the minimum safe selection
 * from that server-provided identity before asking for a fresh outline.
 */
export function programForSavedPlan(selectedProgram, programs = [], plan = null) {
  if (selectedProgram?.id === plan?.programId) return selectedProgram;

  const listed = programs.find((program) => program.id === plan?.programId);
  if (listed) return listed;

  if (!plan?.programId) return null;
  return {
    id: plan.programId,
    name: plan.programName || 'Program',
    isCurrent: true,
  };
}

/**
 * The week the last workout was in - or the one after it, when that workout was
 * the last day of its week.
 */
export function suggestedWeekIndex(weeks = [], lastWorkout = null) {
  if (weeks.length === 0) return -1;
  if (!lastWorkout || !lastWorkout.week) return -1;

  const index = weeks.findIndex((week) => week.number === lastWorkout.week);
  if (index === -1) return -1;

  const isLastDayOfWeek =
    Number.isFinite(lastWorkout.dayInWeek) && lastWorkout.dayInWeek >= weeks[index].days.length;

  if (isLastDayOfWeek && index + 1 < weeks.length) {
    return index + 1;
  }
  return index;
}

/**
 * The day after the last one logged, within the week being shown. A week the
 * user has not touched starts at its first day.
 */
export function suggestedDayIndex(week = null, lastWorkout = null) {
  if (!week || !Array.isArray(week.days) || week.days.length === 0) return -1;
  if (!lastWorkout || !Number.isFinite(lastWorkout.dayInWeek)) return -1;

  if (lastWorkout.week !== week.number) return 0;

  return week.days.findIndex((day) => day.number === lastWorkout.dayInWeek + 1);
}

/** The same list without its featured entry, order preserved. */
export function withoutIndex(list = [], index = -1) {
  if (index < 0) return list.slice();
  return list.filter((_, i) => i !== index);
}

/**
 * The one week and day behind the home screen's start button, so that the
 * common case - carry on with the program - is a single tap.
 *
 * With no history to go on it offers the very first day of the program. That is
 * still an offer: the button names the day it would start.
 */
export function suggestedStart(weeks = [], lastWorkout = null) {
  if (weeks.length === 0) return null;

  const weekIndex = suggestedWeekIndex(weeks, lastWorkout);
  const week = weeks[weekIndex === -1 ? 0 : weekIndex];
  if (!week || week.days.length === 0) return null;

  const dayIndex = suggestedDayIndex(week, lastWorkout);
  const day = week.days[dayIndex === -1 ? 0 : dayIndex];
  if (!day) return null;

  return { week, day };
}
