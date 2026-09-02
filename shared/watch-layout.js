/** Readable type sizes in the 480px watch design space. */
export const TYPOGRAPHY = Object.freeze({
  micro: 20,
  caption: 23,
  body: 25,
  button: 27,
  title: 30,
  value: 38,
  timer: 66,
});

export const LIST_PAGE_SIZE = 3;
export const OVERVIEW_PAGE_SIZE = 3;
export const READY_PREVIEW_SIZE = 3;

export function readyExercisePage(exercises = [], requestedPage = 0) {
  const totalPages = Math.max(1, Math.ceil(exercises.length / READY_PREVIEW_SIZE));
  const page = ((requestedPage % totalPages) + totalPages) % totalPages;
  const start = page * READY_PREVIEW_SIZE;

  return {
    exercises: exercises.slice(start, start + READY_PREVIEW_SIZE),
    page,
    totalPages,
  };
}

export function formatWorkoutPosition(week, dayInWeek) {
  return `Week ${week} - Day ${dayInWeek}`;
}

export function formatMarqueeText(text, threshold = 22) {
  const value = String(text ?? '').trim();
  if (value.length <= threshold) return value;
  return Array(4).fill(value).join('      ');
}

export const ACTIVE_SET_LAYOUT = Object.freeze({
  withRpe: Object.freeze({
    rowYs: Object.freeze([170, 236, 302]),
    rowHeight: 62,
    actionY: 372,
    actionHeight: 64,
  }),
  withoutRpe: Object.freeze({
    rowYs: Object.freeze([178, 260]),
    rowHeight: 72,
    actionY: 354,
    actionHeight: 76,
  }),
});

export const EXTENSION_CLOCK_LAYOUT = Object.freeze({
  x: 160,
  y: 442,
  width: 160,
  height: 20,
  minimumActionGap: 20,
});

export function shouldShowRpe(set) {
  return Boolean(set?.logRpe) || (set?.targetRpe !== null && set?.targetRpe !== undefined);
}

export function activeSetLayout(set) {
  const showRpe = shouldShowRpe(set);
  const source = showRpe ? ACTIVE_SET_LAYOUT.withRpe : ACTIVE_SET_LAYOUT.withoutRpe;
  const keys = showRpe ? ['weight', 'reps', 'rpe'] : ['weight', 'reps'];

  return {
    showRpe,
    rowHeight: source.rowHeight,
    actionY: source.actionY,
    actionHeight: source.actionHeight,
    rows: keys.map((key, index) => ({ key, y: source.rowYs[index] })),
  };
}

export function extensionActiveSetLayout(set) {
  const layout = activeSetLayout(set);
  const availableHeight =
    EXTENSION_CLOCK_LAYOUT.y - EXTENSION_CLOCK_LAYOUT.minimumActionGap - layout.actionY;

  return {
    ...layout,
    actionHeight: Math.min(layout.actionHeight, availableHeight),
  };
}
