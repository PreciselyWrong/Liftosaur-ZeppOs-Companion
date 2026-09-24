import fs from 'node:fs';
import vm from 'node:vm';
import { TIMED_SET_LAYOUT, TYPOGRAPHY } from '../../shared/watch-layout.js';
import { timedSetPresentation, timedSetIdentity } from '../../shared/timed-set-ui.js';

export function captureTimedScreen(product, timer) {
  const source = fs.readFileSync(new URL(`../../${product}/common/index.js`, import.meta.url), 'utf8');
  const start = source.indexOf('function renderTimedSetScreen(view)');
  const end = source.indexOf('function renderActiveSetScreen(view)', start);
  const widgets = [];
  const actions = [];
  const context = {
    timedSetPresentation, timedSetIdentity, TIMED_SET_LAYOUT, renderedTimedPhase: null, timedTargetAlerted: false, timedAlertIdentity: null,
    THEME: { bg: 0, textPrimary: 0xffffff, textSecondary: 0xa4b0bc, card: 0x332d42, cardActive: 0x453d58 },
    px: (n) => n, font: (role) => TYPOGRAPHY[role], truncate: (text) => text,
    widget: { BUTTON: 'BUTTON', TEXT: 'TEXT' }, align: { CENTER_H: 'CENTER' },
    addLiveLabel: (key, props) => widgets.push({ key, type: 'BUTTON', ...props }),
    addLiveShape: (key, props) => widgets.push({ key, type: 'FILL_RECT', ...props }),
    addWidget: (type, props) => widgets.push({ type, ...props }),
    renderTopBar: () => {}, renderExerciseInfo: () => {}, openTextModal: () => {},
    exerciseImages: null,
    isOverviewOpen: false, controllerUiDirty: false,
    renderUI: () => actions.push('render'),
    triggerVibration: () => actions.push('buzz'), triggerRestVibration: () => actions.push('buzz'),
    updateLiveWidget: (key, props) => { Object.assign(widgets.find((w) => w.key === key) || {}, props); return true; },
    SESSION_STATES: { FINISHED: 'FINISHED' },
    workoutController: {
      startTimedSet: () => actions.push('start'), stopTimedSide: () => actions.push('stop'),
      pauseTimedSet: () => actions.push('pause'), resumeTimedSet: () => actions.push('resume'),
      syncSets: () => Promise.resolve(), view: () => ({ state: 'ACTIVE_SET' }),
    },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const view = { timedSet: timer, exerciseName: 'Side Plank', currentSetIndex: 0, totalSets: 2 };
  context.workoutController.view = () => view;
  context.renderTimedSetScreen(view);
  return { widgets, actions, context, view };
}
