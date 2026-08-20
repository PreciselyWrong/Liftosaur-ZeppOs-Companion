/** Readable type sizes in the 480px watch design space. */
export const TYPOGRAPHY = Object.freeze({
  micro: 18,
  caption: 20,
  body: 22,
  button: 24,
  title: 26,
  value: 34,
  timer: 62,
});

export const LIST_PAGE_SIZE = 3;
export const OVERVIEW_PAGE_SIZE = 3;
export const READY_PREVIEW_SIZE = 3;

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

export function shouldShowRpe(set) {
  return set?.targetRpe !== null && set?.targetRpe !== undefined;
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
