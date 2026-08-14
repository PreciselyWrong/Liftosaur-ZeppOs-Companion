import { createWidget, deleteWidget, widget, align, text_style } from '@zos/ui';
import { px } from '@zos/utils';
import { HeartRate } from '@zos/sensor';
import { BasePage } from '@zeppos/zml/base-page';

import {
  SESSION_STATES,
  createWorkoutSession,
} from '../../shared/workout-session.js';
import { createSessionStore } from '../../shared/session-storage.js';

// ── Official Liftosaur Color Palette ────────────────────────────────────────

const THEME = {
  // Brand & Accents
  primary: 0x8356f6,          // Violet principal / bouton primaire (#8356F6)
  primaryLight: 0xa48bfa,     // Violet clair / actif (#A48BFA)
  primaryPale: 0xccc1f9,      // Violet très clair (#CCC1F9)
  primaryDark: 0x393248,      // Violet sombre (#393248)
  primaryDeep: 0x2c1065,      // Violet très sombre (#2C1065)
  blue: 0x45b3cb,             // Bleu / liens (#45B3CB)
  success: 0x2bdc9b,          // Vert / succès (#2BDC9B)
  error: 0xff8066,            // Rouge / erreur (#FF8066)
  yellow: 0xffd820,           // Jaune (#FFD820)
  orange: 0xffb544,           // Orange (#FFB544)

  // Backgrounds & Surfaces
  bg: 0x000000,               // Background principal (#000000)
  bgSubtle: 0x0c0819,         // Background subtil (#0C0819)
  bgNeutral: 0x252034,        // Background neutre / menus (#252034)
  card: 0x332d42,             // Cards / sets / input bg (#332D42)
  cardActive: 0x453d58,       // Card sélectionnée / set actif (#453D58)

  // Typography
  textPrimary: 0xffffff,      // Texte principal (#FFFFFF)
  textSecondary: 0xa4b0bc,    // Texte secondaire (#A4B0BC)
  textMuted: 0x4f5c6b,        // Texte secondaire discret (#4F5C6B)
  textDisabled: 0x607284,     // Texte disabled (#607284)
};

// ── Mock Workout (Multi-Exercise Day) ────────────────────────────────────────

const WORKOUT_MOCK = {
  id: 'workout-push-day',
  name: 'Push Workout',
  exercises: [
    {
      id: 'bench-press',
      name: 'Bench Press',
      sets: [
        { targetReps: 10, targetWeight: 60, restSeconds: 90 },
        { targetReps: 10, targetWeight: 60, restSeconds: 90 },
        { targetReps: 10, targetWeight: 60, restSeconds: 90 },
      ],
    },
    {
      id: 'overhead-press',
      name: 'Overhead Press',
      sets: [
        { targetReps: 8, targetWeight: 40, restSeconds: 90 },
        { targetReps: 8, targetWeight: 40, restSeconds: 90 },
        { targetReps: 8, targetWeight: 40, restSeconds: 90 },
      ],
    },
    {
      id: 'triceps-pushdown',
      name: 'Triceps Pushdown',
      sets: [
        { targetReps: 12, targetWeight: 25, restSeconds: 60 },
        { targetReps: 12, targetWeight: 25, restSeconds: 60 },
        { targetReps: 12, targetWeight: 25, restSeconds: 60 },
      ],
    },
  ],
};

// ── Persistent Storage Adapter ───────────────────────────────────────────────

let storageData = null;
const localStoreAdapter = {
  read() {
    return storageData;
  },
  write(data) {
    storageData = data;
  },
  remove() {
    storageData = null;
  },
};
const sessionStore = createSessionStore(localStoreAdapter);

// ── State variables ──────────────────────────────────────────────────────────

let session = createWorkoutSession({
  workout: WORKOUT_MOCK,
  initialJournal: sessionStore.loadJournal(),
});

let liveHr = 'N/A';
let hrSensor = null;
let hrCallback = null;
let restTimerId = null;
let activeWidgets = [];

const W = px(480);
const H = px(480);

function clearWidgets() {
  for (const w of activeWidgets) {
    try {
      deleteWidget(w);
    } catch (e) {}
  }
  activeWidgets = [];
}

function addWidget(type, props) {
  const w = createWidget(type, props);
  activeWidgets.push(w);
  return w;
}

function persistAndRender(action) {
  if (action) {
    action();
    sessionStore.saveJournal(session.getJournal());
  }
  renderUI();
}

function formatSeconds(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

// ── UI Rendering ─────────────────────────────────────────────────────────────

function renderUI() {
  clearWidgets();

  const now = Date.now();
  const view = session.view(now);

  // Background
  addWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: THEME.bg });

  // Top Bar: Heart Rate & Workout Progress
  addWidget(widget.TEXT, {
    x: 0,
    y: px(15),
    w: W,
    h: px(35),
    color: THEME.textSecondary,
    text_size: px(22),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: `HR ${liveHr} • ${view.workoutName}`,
  });

  // Exercise Navigation Bar [<] [ Exercise Name (X/Y) ] [>]
  const exNum = view.currentExerciseIndex + 1;
  const hasPrevEx = view.currentExerciseIndex > 0;
  const hasNextEx = view.currentExerciseIndex + 1 < view.totalExercises;

  if (hasPrevEx) {
    addWidget(widget.BUTTON, {
      x: px(15),
      y: px(50),
      w: px(45),
      h: px(45),
      radius: px(22),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '<',
      text_size: px(24),
      click_func: () => {
        persistAndRender(() => session.prevExercise());
      },
    });
  }

  addWidget(widget.TEXT, {
    x: px(65),
    y: px(50),
    w: px(350),
    h: px(45),
    color: THEME.primaryLight,
    text_size: px(26),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: `${view.exerciseName} (${exNum}/${view.totalExercises})`,
  });

  if (hasNextEx) {
    addWidget(widget.BUTTON, {
      x: px(420),
      y: px(50),
      w: px(45),
      h: px(45),
      radius: px(22),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '>',
      text_size: px(24),
      click_func: () => {
        persistAndRender(() => session.nextExercise());
      },
    });
  }

  if (view.state === SESSION_STATES.READY) {
    // ── READY SCREEN ──
    addWidget(widget.TEXT, {
      x: 0,
      y: px(140),
      w: W,
      h: px(60),
      color: THEME.textPrimary,
      text_size: px(36),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: 'Ready to Start',
    });

    addWidget(widget.TEXT, {
      x: 0,
      y: px(205),
      w: W,
      h: px(40),
      color: THEME.textSecondary,
      text_size: px(24),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `${view.totalExercises} exercises planned`,
    });

    addWidget(widget.BUTTON, {
      x: px(90),
      y: px(290),
      w: px(300),
      h: px(85),
      radius: px(42),
      normal_color: THEME.primary,
      press_color: THEME.primaryDeep,
      text: 'START WORKOUT',
      text_size: px(28),
      click_func: () => {
        persistAndRender(() => session.startWorkout());
      },
    });
  } else if (view.state === SESSION_STATES.ACTIVE_SET) {
    // ── ACTIVE SET SCREEN ──
    const setNum = view.currentSetIndex + 1;

    addWidget(widget.TEXT, {
      x: 0,
      y: px(100),
      w: W,
      h: px(40),
      color: THEME.orange,
      text_size: px(26),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `SET ${setNum} OF ${view.totalSets}`,
    });

    // Weight Controls: [-2.5] [ 60 kg ] [+2.5]
    addWidget(widget.BUTTON, {
      x: px(45),
      y: px(145),
      w: px(75),
      h: px(60),
      radius: px(12),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '-2.5',
      text_size: px(24),
      click_func: () => {
        persistAndRender(() => session.adjustWeight(-2.5));
      },
    });

    addWidget(widget.TEXT, {
      x: px(130),
      y: px(145),
      w: px(220),
      h: px(60),
      color: THEME.textPrimary,
      text_size: px(34),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `${view.currentSet.weight} kg`,
    });

    addWidget(widget.BUTTON, {
      x: px(360),
      y: px(145),
      w: px(75),
      h: px(60),
      radius: px(12),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '+2.5',
      text_size: px(24),
      click_func: () => {
        persistAndRender(() => session.adjustWeight(2.5));
      },
    });

    // Reps Controls: [-1] [ 10 reps ] [+1]
    addWidget(widget.BUTTON, {
      x: px(45),
      y: px(215),
      w: px(75),
      h: px(60),
      radius: px(12),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '-1',
      text_size: px(26),
      click_func: () => {
        persistAndRender(() => session.adjustReps(-1));
      },
    });

    addWidget(widget.TEXT, {
      x: px(130),
      y: px(215),
      w: px(220),
      h: px(60),
      color: THEME.textPrimary,
      text_size: px(34),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `${view.currentSet.reps} reps`,
    });

    addWidget(widget.BUTTON, {
      x: px(360),
      y: px(215),
      w: px(75),
      h: px(60),
      radius: px(12),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '+1',
      text_size: px(26),
      click_func: () => {
        persistAndRender(() => session.adjustReps(1));
      },
    });

    // Complete Set Button (Liftosaur Primary Purple #8356F6)
    addWidget(widget.BUTTON, {
      x: px(90),
      y: px(315),
      w: px(300),
      h: px(85),
      radius: px(42),
      normal_color: THEME.primary,
      press_color: THEME.primaryDeep,
      text: 'COMPLETE SET',
      text_size: px(28),
      click_func: () => {
        persistAndRender(() => session.completeSet());
        startRestTimer();
      },
    });
  } else if (view.state === SESSION_STATES.REST) {
    // ── REST SCREEN ──
    const isTransition = view.rest?.isTransitionToNextExercise;
    const subtitle = isTransition
      ? `Next Exercise (${exNum + 1}/${view.totalExercises})`
      : `Next: Set ${view.currentSetIndex + 2} of ${view.totalSets}`;

    addWidget(widget.TEXT, {
      x: 0,
      y: px(95),
      w: W,
      h: px(35),
      color: THEME.blue,
      text_size: px(26),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: 'REST TIMER',
    });

    addWidget(widget.TEXT, {
      x: 0,
      y: px(140),
      w: W,
      h: px(80),
      color: THEME.textPrimary,
      text_size: px(56),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: formatSeconds(view.rest ? view.rest.remaining : 0),
    });

    addWidget(widget.TEXT, {
      x: 0,
      y: px(235),
      w: W,
      h: px(40),
      color: THEME.textSecondary,
      text_size: px(24),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: subtitle,
    });

    addWidget(widget.BUTTON, {
      x: px(90),
      y: px(315),
      w: px(300),
      h: px(80),
      radius: px(40),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: isTransition ? 'NEXT EXERCISE' : 'SKIP REST',
      text_size: px(28),
      click_func: () => {
        stopRestTimer();
        persistAndRender(() => session.nextSet());
      },
    });
  } else if (view.state === SESSION_STATES.FINISHED) {
    // ── FINISHED SCREEN ──
    addWidget(widget.TEXT, {
      x: 0,
      y: px(120),
      w: W,
      h: px(60),
      color: THEME.success,
      text_size: px(38),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: 'WORKOUT DONE!',
    });

    addWidget(widget.TEXT, {
      x: 0,
      y: px(195),
      w: W,
      h: px(45),
      color: THEME.textSecondary,
      text_size: px(26),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `${view.allCompletedSets.length} sets completed`,
    });

    addWidget(widget.BUTTON, {
      x: px(110),
      y: px(295),
      w: px(260),
      h: px(80),
      radius: px(40),
      normal_color: THEME.primary,
      press_color: THEME.primaryDeep,
      text: 'RESET',
      text_size: px(28),
      click_func: () => {
        sessionStore.clearSession();
        session = createWorkoutSession({ workout: WORKOUT_MOCK });
        stopRestTimer();
        renderUI();
      },
    });
  }
}

function startRestTimer() {
  stopRestTimer();
  restTimerId = setInterval(() => {
    const view = session.view(Date.now());
    if (view.state === SESSION_STATES.REST) {
      renderUI();
      if (view.rest && view.rest.remaining <= 0) {
        stopRestTimer();
      }
    } else {
      stopRestTimer();
    }
  }, 1000);
}

function stopRestTimer() {
  if (restTimerId) {
    clearInterval(restTimerId);
    restTimerId = null;
  }
}

// ── Page Declaration ──────────────────────────────────────────────────────────

Page(
  BasePage({
    onInit() {
      console.log('[liftosaur] page onInit');
    },

    build() {
      console.log('[liftosaur] page build');

      if (!hrSensor) {
        try {
          hrSensor = new HeartRate();
          const initialHr = hrSensor.getCurrent?.() || hrSensor.getLast?.();
          if (initialHr && initialHr > 0) {
            liveHr = String(initialHr);
          }
          hrCallback = () => {
            const currentHr = hrSensor.getCurrent?.() || hrSensor.getLast?.();
            if (currentHr && currentHr > 0) {
              liveHr = String(currentHr);
              renderUI();
            }
          };
          hrSensor.onCurrentChange?.(hrCallback);
        } catch (err) {
          console.log('[liftosaur] hr sensor error:', err?.message || String(err));
        }
      }

      renderUI();
      if (session.view().state === SESSION_STATES.REST) {
        startRestTimer();
      }
    },

    onDestroy() {
      console.log('[liftosaur] page onDestroy');
      stopRestTimer();
      if (hrSensor && hrCallback) {
        try {
          hrSensor.offCurrentChange?.(hrCallback);
        } catch (e) {}
      }
    },
  })
);
