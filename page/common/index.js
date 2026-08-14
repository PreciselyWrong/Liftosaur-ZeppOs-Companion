import { createWidget, deleteWidget, widget, align, text_style } from '@zos/ui';
import { px } from '@zos/utils';
import { HeartRate } from '@zos/sensor';
import { onGesture, offGesture, GESTURE_LEFT, GESTURE_RIGHT } from '@zos/interaction';
import { BasePage } from '@zeppos/zml/base-page';

import {
  SESSION_STATES,
  createWorkoutSession,
} from '../../shared/workout-session.js';
import { createSessionStore } from '../../shared/session-storage.js';

// ── Official Liftosaur Color Palette ────────────────────────────────────────

const THEME = {
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

  bg: 0x000000,               // Background principal (#000000)
  bgSubtle: 0x0c0819,         // Background subtil (#0C0819)
  bgNeutral: 0x252034,        // Background neutre / menus (#252034)
  card: 0x332d42,             // Cards / sets / input bg (#332D42)
  cardActive: 0x453d58,       // Card sélectionnée / set actif (#453D58)

  textPrimary: 0xffffff,      // Texte principal (#FFFFFF)
  textSecondary: 0xa4b0bc,    // Texte secondaire (#A4B0BC)
  textMuted: 0x4f5c6b,        // Texte secondaire discret (#4F5C6B)
  textDisabled: 0x607284,     // Texte disabled (#607284)
};

// ── Long Workout Mock with Alternating Superset & RPE ────────────────────────

const WORKOUT_MOCK = {
  id: 'workout-push-hypertrophy',
  name: 'Upper Body Superset Focus',
  exercises: [
    {
      id: 'incline-db-bench',
      name: 'Incline DB Bench',
      supersetGroup: 'A',
      supersetTag: 'SUPERSET A1',
      sets: [
        { targetReps: 10, targetWeight: 30, targetRpe: 8, restSeconds: 30 },
        { targetReps: 10, targetWeight: 30, targetRpe: 8.5, restSeconds: 30 },
        { targetReps: 10, targetWeight: 30, targetRpe: 9, restSeconds: 30 },
      ],
    },
    {
      id: 'chest-supported-row',
      name: 'DB Chest Row',
      supersetGroup: 'A',
      supersetTag: 'SUPERSET A2',
      sets: [
        { targetReps: 12, targetWeight: 26, targetRpe: 8, restSeconds: 60 },
        { targetReps: 12, targetWeight: 26, targetRpe: 8.5, restSeconds: 60 },
        { targetReps: 12, targetWeight: 26, targetRpe: 9, restSeconds: 60 },
      ],
    },
    {
      id: 'standing-military-press',
      name: 'Military Overhead Press',
      supersetGroup: null,
      supersetTag: null,
      sets: [
        { targetReps: 8, targetWeight: 45, targetRpe: 8, restSeconds: 90 },
        { targetReps: 8, targetWeight: 45, targetRpe: 8.5, restSeconds: 90 },
        { targetReps: 8, targetWeight: 45, targetRpe: 9, restSeconds: 90 },
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

// ── UI Rendering (Centered for 480x480 Round Display) ────────────────────────

function renderUI() {
  clearWidgets();

  const now = Date.now();
  const view = session.view(now);

  // Background
  addWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: THEME.bg });

  // Top Bar: Heart Rate & Workout Title (Comfortably inside top safe zone at y=45)
  const shortTitle = view.workoutName.length > 20 ? view.workoutName.slice(0, 18) + '…' : view.workoutName;
  addWidget(widget.TEXT, {
    x: 0,
    y: px(42),
    w: W,
    h: px(28),
    color: THEME.textSecondary,
    text_size: px(20),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: `HR ${liveHr} • ${shortTitle}`,
  });

  // Superset Tag Pill (y=75)
  if (view.supersetTag) {
    addWidget(widget.TEXT, {
      x: 0,
      y: px(74),
      w: W,
      h: px(26),
      color: THEME.blue,
      text_size: px(19),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `[${view.supersetTag}]`,
    });
  }

  // Exercise Navigation Line [<] [ Exercise Name (X/Y) ] [>] (y=104)
  const exNum = view.currentExerciseIndex + 1;
  const hasPrevEx = view.currentExerciseIndex > 0;
  const hasNextEx = view.currentExerciseIndex + 1 < view.totalExercises;

  if (hasPrevEx) {
    addWidget(widget.BUTTON, {
      x: px(80),
      y: px(104),
      w: px(36),
      h: px(36),
      radius: px(18),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '<',
      text_size: px(20),
      click_func: () => {
        persistAndRender(() => session.prevExercise());
      },
    });
  }

  addWidget(widget.TEXT, {
    x: px(120),
    y: px(104),
    w: px(240),
    h: px(36),
    color: THEME.primaryLight,
    text_size: px(22),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: `${view.exerciseName} (${exNum}/${view.totalExercises})`,
  });

  if (hasNextEx) {
    addWidget(widget.BUTTON, {
      x: px(364),
      y: px(104),
      w: px(36),
      h: px(36),
      radius: px(18),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '>',
      text_size: px(20),
      click_func: () => {
        persistAndRender(() => session.nextExercise());
      },
    });
  }

  if (view.state === SESSION_STATES.READY) {
    // ── READY SCREEN (Centered) ──
    addWidget(widget.TEXT, {
      x: 0,
      y: px(170),
      w: W,
      h: px(50),
      color: THEME.textPrimary,
      text_size: px(34),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: 'Ready to Start',
    });

    addWidget(widget.TEXT, {
      x: 0,
      y: px(230),
      w: W,
      h: px(35),
      color: THEME.textSecondary,
      text_size: px(22),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `${view.totalExercises} exercises • Swipe to switch`,
    });

    addWidget(widget.BUTTON, {
      x: px(90),
      y: px(310),
      w: px(300),
      h: px(76),
      radius: px(38),
      normal_color: THEME.primary,
      press_color: THEME.primaryDeep,
      text: 'START WORKOUT',
      text_size: px(26),
      click_func: () => {
        persistAndRender(() => session.startWorkout());
      },
    });
  } else if (view.state === SESSION_STATES.ACTIVE_SET) {
    // ── ACTIVE SET SCREEN (Centered) ──
    const setNum = view.currentSetIndex + 1;
    const rpeLabel = view.currentSet.rpe ? ` • @ RPE ${view.currentSet.rpe}` : '';

    addWidget(widget.TEXT, {
      x: 0,
      y: px(148),
      w: W,
      h: px(30),
      color: THEME.orange,
      text_size: px(22),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `SET ${setNum} OF ${view.totalSets}${rpeLabel}`,
    });

    // Weight Controls: [-2.5] [ 30 kg ] [+2.5] (y=188)
    addWidget(widget.BUTTON, {
      x: px(65),
      y: px(186),
      w: px(70),
      h: px(50),
      radius: px(12),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '-2.5',
      text_size: px(22),
      click_func: () => {
        persistAndRender(() => session.adjustWeight(-2.5));
      },
    });

    addWidget(widget.TEXT, {
      x: px(140),
      y: px(186),
      w: px(200),
      h: px(50),
      color: THEME.textPrimary,
      text_size: px(32),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `${view.currentSet.weight} kg`,
    });

    addWidget(widget.BUTTON, {
      x: px(345),
      y: px(186),
      w: px(70),
      h: px(50),
      radius: px(12),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '+2.5',
      text_size: px(22),
      click_func: () => {
        persistAndRender(() => session.adjustWeight(2.5));
      },
    });

    // Reps Controls: [-1] [ 10 reps ] [+1] (y=246)
    addWidget(widget.BUTTON, {
      x: px(65),
      y: px(246),
      w: px(70),
      h: px(50),
      radius: px(12),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '-1',
      text_size: px(24),
      click_func: () => {
        persistAndRender(() => session.adjustReps(-1));
      },
    });

    addWidget(widget.TEXT, {
      x: px(140),
      y: px(246),
      w: px(200),
      h: px(50),
      color: THEME.textPrimary,
      text_size: px(32),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `${view.currentSet.reps} reps`,
    });

    addWidget(widget.BUTTON, {
      x: px(345),
      y: px(246),
      w: px(70),
      h: px(50),
      radius: px(12),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '+1',
      text_size: px(24),
      click_func: () => {
        persistAndRender(() => session.adjustReps(1));
      },
    });

    // Complete Set Button (y=325 to y=398)
    addWidget(widget.BUTTON, {
      x: px(85),
      y: px(325),
      w: px(310),
      h: px(74),
      radius: px(37),
      normal_color: THEME.primary,
      press_color: THEME.primaryDeep,
      text: 'COMPLETE SET',
      text_size: px(26),
      click_func: () => {
        persistAndRender(() => session.completeSet());
        startRestTimer();
      },
    });
  } else if (view.state === SESSION_STATES.REST) {
    // ── REST SCREEN (Centered) ──
    const isTransition = view.rest?.isTransitionToNextExercise;
    const subtitle = isTransition
      ? `Next: Superset Switch`
      : `Next: Set ${view.currentSetIndex + 2} of ${view.totalSets}`;

    addWidget(widget.TEXT, {
      x: 0,
      y: px(145),
      w: W,
      h: px(30),
      color: THEME.blue,
      text_size: px(24),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: 'REST TIMER',
    });

    addWidget(widget.TEXT, {
      x: 0,
      y: px(185),
      w: W,
      h: px(70),
      color: THEME.textPrimary,
      text_size: px(52),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: formatSeconds(view.rest ? view.rest.remaining : 0),
    });

    addWidget(widget.TEXT, {
      x: 0,
      y: px(265),
      w: W,
      h: px(35),
      color: THEME.textSecondary,
      text_size: px(22),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: subtitle,
    });

    addWidget(widget.BUTTON, {
      x: px(85),
      y: px(325),
      w: px(310),
      h: px(72),
      radius: px(36),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: isTransition ? 'NEXT EXERCISE' : 'SKIP REST',
      text_size: px(26),
      click_func: () => {
        stopRestTimer();
        persistAndRender(() => session.nextSet());
      },
    });
  } else if (view.state === SESSION_STATES.FINISHED) {
    // ── FINISHED SCREEN (Centered) ──
    addWidget(widget.TEXT, {
      x: 0,
      y: px(160),
      w: W,
      h: px(45),
      color: THEME.success,
      text_size: px(34),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: 'WORKOUT DONE!',
    });

    addWidget(widget.TEXT, {
      x: 0,
      y: px(220),
      w: W,
      h: px(38),
      color: THEME.textSecondary,
      text_size: px(24),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `${view.allCompletedSets.length} sets completed`,
    });

    addWidget(widget.BUTTON, {
      x: px(110),
      y: px(310),
      w: px(260),
      h: px(74),
      radius: px(37),
      normal_color: THEME.primary,
      press_color: THEME.primaryDeep,
      text: 'RESET',
      text_size: px(26),
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

      // Register horizontal swipe / slide gestures to switch exercises
      try {
        onGesture({
          callback: (event) => {
            console.log('[liftosaur] gesture event:', event);
            if (event === GESTURE_LEFT) {
              persistAndRender(() => session.nextExercise());
              return true;
            } else if (event === GESTURE_RIGHT) {
              persistAndRender(() => session.prevExercise());
              return true;
            }
            return false;
          },
        });
      } catch (err) {
        console.log('[liftosaur] onGesture error:', err?.message || String(err));
      }

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
      try {
        offGesture();
      } catch (e) {}
      stopRestTimer();
      if (hrSensor && hrCallback) {
        try {
          hrSensor.offCurrentChange?.(hrCallback);
        } catch (e) {}
      }
    },
  })
);
