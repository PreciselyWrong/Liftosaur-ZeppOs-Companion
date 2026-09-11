import { formatSeconds } from './workout-extension-nav.js';

export function timedSetIdentity(view) {
  return JSON.stringify([view.currentSet?.entryId, view.currentSet?.setId, view.exerciseIndex,
    view.currentSetIndex, view.timedSet?.side, view.timedSet?.phase]);
}

export function timedSetPresentation(timer) {
  const ready = timer.phase === 'GET_READY';
  const paused = timer.isPaused || timer.isWorkoutPaused;
  const remaining = Math.round(timer.remaining || 0);
  return {
    value: ready ? String(Math.max(0, remaining)) : `${remaining < 0 ? '+' : ''}${formatSeconds(Math.abs(remaining))}`,
    valueFont: ready ? 'timer' : Math.abs(remaining) >= 3600 ? 'caption'
      : Math.abs(remaining) >= 600 || remaining < 0 ? 'value' : 'timedTimer',
    label: timer.isWorkoutPaused ? 'Workout paused' : paused ? 'Paused'
      : ready ? 'Get Ready' : remaining <= 0 ? 'Target reached' : 'Hold',
    detail: ready ? `then ${formatSeconds(timer.targetSeconds)}` : `${formatSeconds(timer.elapsedSeconds || 0)} elapsed`,
    action: ready ? 'Start now' : 'Stop',
    pauseAction: timer.isWorkoutPaused ? 'Paused' : timer.isPaused ? 'Resume' : 'Pause',
    color: ready || paused ? 0xffd820 : 0x8356f6,
    progress: Math.max(0, Math.min(1, remaining / (ready ? timer.preparationSeconds || 5 : timer.targetSeconds || 1))),
  };
}
