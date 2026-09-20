/** Readable type sizes in the 480px watch design space. */
export const TYPOGRAPHY = Object.freeze({
  micro: 20,
  caption: 23,
  body: 25,
  button: 27,
  title: 30,
  value: 38,
  timer: 66,
  timedTimer: 54,
});

export const LIST_PAGE_SIZE = 3;
export const PREPARED_TOP_BAR_LAYOUT = Object.freeze({
  y: 48,
  height: 40,
  menu: Object.freeze({ x: 100, width: 82 }),
  elapsed: Object.freeze({ x: 186, width: 96 }),
  metric: Object.freeze({ x: 286, width: 96 }),
});
export const ACTIVE_SET_ACTION_LAYOUT = Object.freeze({
  x: 84,
  width: 312,
});

export function stepperRowLayout(rowHeight) {
  const labelHeight = TYPOGRAPHY.micro + 2;
  const valueHeight = rowHeight - labelHeight;
  return {
    valueHeight,
    labelHeight,
    labelOffsetY: valueHeight,
  };
}
export const TIMED_SET_LAYOUT = Object.freeze({
  centerX: 240, centerY: 232, radius: 76, horizontalRadius: 84, dotSize: 12, segments: 12,
  valueX: 176, valueWidth: 128, valueY: 195, valueHeight: 74, labelY: 316, detailY: 346,
  actionY: 382, actionHeight: 40, actionX: 82, actionWidth: 152, actionGap: 12,
});
export const WORKOUT_TIMER_MODAL_LAYOUT = Object.freeze({
  panelX: 44,
  panelY: 52,
  panelWidth: 392,
  panelHeight: 382,
  panelRadius: 28,
  contentX: 64,
  contentWidth: 352,
  titleY: 72,
  stateY: 114,
  valueY: 146,
  valueHeight: 100,
  pauseX: 82,
  pauseY: 278,
  pauseWidth: 316,
  pauseHeight: 70,
  closeX: 140,
  closeY: 368,
  closeWidth: 200,
  closeHeight: 52,
});
export const OVERVIEW_PAGE_SIZE = 3;
export const READY_PREVIEW_SIZE = 2;

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

export function extensionRestActionsLayout(remaining) {
  const x = 64;
  const width = 352;
  const prepareWidth = 150;
  const gap = 12;
  const offset = remaining > 0 ? prepareWidth + gap : 0;
  return {
    y: 370,
    height: 58,
    prepare: remaining > 0 ? { x, width: prepareWidth } : null,
    start: { x: x + offset, width: width - offset },
  };
}

export const EXTENSION_CLOCK_LAYOUT = Object.freeze({
  x: 130,
  y: 442,
  width: 220,
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
