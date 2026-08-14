import { createWidget, deleteWidget, widget, align, text_style } from '@zos/ui';
import { px } from '@zos/utils';
import { HeartRate, Vibrator } from '@zos/sensor';
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
  success: 0x2bdc9b,          // Vert / succès / completed dot (#2BDC9B)
  error: 0xff8066,            // Rouge / erreur / overtime (#FF8066)
  yellow: 0xffd820,           // Jaune (#FFD820)
  orange: 0xffb544,           // Orange / active dot (#FFB544)

  bg: 0x000000,               // Background principal (#000000)
  bgSubtle: 0x0c0819,         // Background subtil (#0C0819)
  bgNeutral: 0x252034,        // Background neutre / menus (#252034)
  card: 0x332d42,             // Cards / sets / input bg (#332D42)
  cardActive: 0x453d58,       // Card sélectionnée / set actif (#453D58)
  border: 0x494457,           // Bordure input (#494457)

  textPrimary: 0xffffff,      // Texte principal (#FFFFFF)
  textSecondary: 0xa4b0bc,    // Texte secondaire (#A4B0BC)
  textMuted: 0x4f5c6b,        // Texte secondaire discret (#4F5C6B)
  textDisabled: 0x607284,     // Texte disabled / pending dot (#607284)
};

// ── Liftosaur Workout Routine Mock ──────────────────────────────────────────

const WORKOUT_MOCK = {
  id: 'week-1-workout-a',
  name: 'Week 1 - Workout A',
  routineName: 'Basic Beginner Routine',
  exercises: [
    {
      id: 'bench-press',
      name: 'Bench Press, Barbell',
      supersetGroup: null,
      supersetTag: null,
      sets: [
        { targetReps: 5, targetWeight: 60, targetRpe: 8, restSeconds: 60 },
        { targetReps: 5, targetWeight: 60, targetRpe: 8, restSeconds: 60 },
        { targetReps: 5, targetWeight: 60, targetRpe: 8.5, restSeconds: 60 },
      ],
    },
    {
      id: 'overhead-squat',
      name: 'Overhead Squat, Barbell',
      supersetGroup: null,
      supersetTag: null,
      sets: [
        { targetReps: 5, targetWeight: 40, targetRpe: 8, restSeconds: 90 },
        { targetReps: 5, targetWeight: 40, targetRpe: 8, restSeconds: 90 },
        { targetReps: 5, targetWeight: 40, targetRpe: 8, restSeconds: 90 },
      ],
    },
    {
      id: 'incline-db-bench',
      name: 'Incline DB Bench',
      supersetGroup: 'A',
      supersetTag: 'SUPERSET A1',
      sets: [
        { targetReps: 10, targetWeight: 30, targetRpe: 8, restSeconds: 30 },
        { targetReps: 10, targetWeight: 30, targetRpe: 8.5, restSeconds: 30 },
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

let isOverviewListOpen = false;
let liveHr = 'N/A';
let hrSensor = null;
let hrCallback = null;
let vibrator = null;
let hasVibratedThisRest = false;
let clockTimerId = null;
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
  const isNeg = sec < 0;
  const abs = Math.abs(sec);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  const formatted = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  return isNeg ? `-${formatted}` : formatted;
}

function formatDots(dots) {
  return dots
    .map((d) => (d === 'completed' ? '●' : d === 'active' ? '●' : '○'))
    .join(' ');
}

function triggerVibration() {
  try {
    if (!vibrator) {
      vibrator = new Vibrator();
    }
    vibrator.start();
  } catch (err) {
    console.log('[liftosaur] vibrator error:', err?.message || String(err));
  }
}

// ── UI Rendering ─────────────────────────────────────────────────────────────

function renderUI() {
  clearWidgets();

  const now = Date.now();
  const view = session.view(now);

  // Background
  addWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: THEME.bg });

  // ── 1. OVERVIEW EXERCISE LIST VIEW ──
  if (isOverviewListOpen && view.state !== SESSION_STATES.READY && view.state !== SESSION_STATES.FINISHED) {
    // Top Bar (Safe Circular Zone): [< Back] [ ▶ Elapsed • HR ]
    addWidget(widget.BUTTON, {
      x: px(80),
      y: px(45),
      w: px(42),
      h: px(42),
      radius: px(21),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '<',
      text_size: px(22),
      click_func: () => {
        isOverviewListOpen = false;
        renderUI();
      },
    });

    addWidget(widget.TEXT, {
      x: px(130),
      y: px(45),
      w: px(240),
      h: px(42),
      color: THEME.primaryLight,
      text_size: px(20),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `▶ ${formatSeconds(view.elapsedSeconds)} • HR ${liveHr}`,
    });

    // Exercise Cards List
    let cardY = px(100);
    view.overviewExercises.forEach((ex, idx) => {
      const isCurrent = idx === view.currentExerciseIndex;
      const cardBg = isCurrent ? THEME.cardActive : THEME.card;

      addWidget(widget.BUTTON, {
        x: px(65),
        y: cardY,
        w: px(350),
        h: px(76),
        radius: px(16),
        normal_color: cardBg,
        press_color: THEME.primaryDark,
        text: '',
        click_func: () => {
          session.selectExercise(idx);
          isOverviewListOpen = false;
          persistAndRender();
        },
      });

      // Name & Dots
      addWidget(widget.TEXT, {
        x: px(80),
        y: cardY + px(8),
        w: px(320),
        h: px(28),
        color: isCurrent ? THEME.primaryPale : THEME.textPrimary,
        text_size: px(20),
        align_h: align.LEFT,
        align_v: align.CENTER_V,
        text_style: text_style.NONE,
        text: `${ex.name.length > 18 ? ex.name.slice(0, 16) + '…' : ex.name}  ${formatDots(ex.setsDots)}`,
      });

      // Prescription
      addWidget(widget.TEXT, {
        x: px(80),
        y: cardY + px(38),
        w: px(320),
        h: px(26),
        color: THEME.textSecondary,
        text_size: px(18),
        align_h: align.LEFT,
        align_v: align.CENTER_V,
        text_style: text_style.NONE,
        text: ex.supersetTag ? `[${ex.supersetTag}] ${ex.prescriptionSummary}` : ex.prescriptionSummary,
      });

      cardY += px(84);
    });
    return;
  }

  // ── 2. READY SCREEN (Liftosaur Watch "New Workout") ──
  if (view.state === SESSION_STATES.READY) {
    // Header
    addWidget(widget.TEXT, {
      x: 0,
      y: px(45),
      w: W,
      h: px(30),
      color: THEME.textSecondary,
      text_size: px(20),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `New Workout • HR ${liveHr}`,
    });

    // Workout Preview Card (#332D42)
    addWidget(widget.FILL_RECT, {
      x: px(65),
      y: px(95),
      w: px(350),
      h: px(185),
      radius: px(20),
      color: THEME.card,
    });

    addWidget(widget.TEXT, {
      x: px(85),
      y: px(110),
      w: px(310),
      h: px(36),
      color: THEME.textPrimary,
      text_size: px(26),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: view.workoutName,
    });

    addWidget(widget.TEXT, {
      x: px(85),
      y: px(148),
      w: px(310),
      h: px(28),
      color: THEME.primaryLight,
      text_size: px(20),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: view.routineName,
    });

    addWidget(widget.TEXT, {
      x: px(85),
      y: px(185),
      w: px(310),
      h: px(26),
      color: THEME.textSecondary,
      text_size: px(19),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `${view.totalExercises} exercises • Swipe to switch`,
    });

    addWidget(widget.TEXT, {
      x: px(85),
      y: px(220),
      w: px(310),
      h: px(40),
      color: THEME.textDisabled,
      text_size: px(18),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `First: ${view.exerciseName}`,
    });

    // Start Button (Liftosaur Purple #8356F6)
    addWidget(widget.BUTTON, {
      x: px(90),
      y: px(305),
      w: px(300),
      h: px(76),
      radius: px(38),
      normal_color: THEME.primary,
      press_color: THEME.primaryDeep,
      text: 'Start',
      text_size: px(28),
      click_func: () => {
        persistAndRender(() => session.startWorkout());
      },
    });
    return;
  }

  // ── 3. ACTIVE SET SCREEN (Liftosaur Watch Pure UI) ──
  if (view.state === SESSION_STATES.ACTIVE_SET) {
    const setNum = view.currentSetIndex + 1;
    const dotsString = formatDots(view.exerciseSetsDots);

    // Top Bar (Safe Zone): [< Back to List] [ ▶ 00:29 • HR 67 ]
    addWidget(widget.BUTTON, {
      x: px(80),
      y: px(45),
      w: px(40),
      h: px(40),
      radius: px(20),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '<',
      text_size: px(22),
      click_func: () => {
        isOverviewListOpen = true;
        renderUI();
      },
    });

    addWidget(widget.TEXT, {
      x: px(128),
      y: px(45),
      w: px(240),
      h: px(40),
      color: THEME.primaryLight,
      text_size: px(20),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `▶ ${formatSeconds(view.elapsedSeconds)} • HR ${liveHr}`,
    });

    // Exercise Name (y=90)
    const shortEx = view.exerciseName.length > 22 ? view.exerciseName.slice(0, 20) + '…' : view.exerciseName;
    addWidget(widget.TEXT, {
      x: 0,
      y: px(88),
      w: W,
      h: px(32),
      color: THEME.textPrimary,
      text_size: px(24),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: view.supersetTag ? `[${view.supersetTag}] ${shortEx}` : shortEx,
    });

    // Set X/Y with Status Dots (y=122)
    addWidget(widget.TEXT, {
      x: 0,
      y: px(122),
      w: W,
      h: px(28),
      color: THEME.orange,
      text_size: px(21),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `Set ${setNum}/${view.totalSets}   ${dotsString}`,
    });

    // ── Apple Watch Style Two Input Boxes (Reps [5]  ×  Weight [60 kg]) ──
    // Left Box: REPS (x: 65, y: 156, w: 160, h: 84)
    addWidget(widget.FILL_RECT, {
      x: px(65),
      y: px(156),
      w: px(160),
      h: px(84),
      radius: px(16),
      color: THEME.card,
    });

    // Reps - / + tap controls
    addWidget(widget.BUTTON, {
      x: px(65),
      y: px(156),
      w: px(45),
      h: px(84),
      radius: px(16),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '-',
      text_size: px(28),
      click_func: () => {
        persistAndRender(() => session.adjustReps(-1));
      },
    });

    addWidget(widget.TEXT, {
      x: px(108),
      y: px(160),
      w: px(74),
      h: px(46),
      color: THEME.textPrimary,
      text_size: px(34),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `${view.currentSet.reps}`,
    });

    addWidget(widget.TEXT, {
      x: px(108),
      y: px(206),
      w: px(74),
      h: px(24),
      color: THEME.textSecondary,
      text_size: px(16),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: 'reps',
    });

    addWidget(widget.BUTTON, {
      x: px(180),
      y: px(156),
      w: px(45),
      h: px(84),
      radius: px(16),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '+',
      text_size: px(28),
      click_func: () => {
        persistAndRender(() => session.adjustReps(1));
      },
    });

    // Middle '×' (x: 228, y: 178)
    addWidget(widget.TEXT, {
      x: px(226),
      y: px(176),
      w: px(28),
      h: px(44),
      color: THEME.textSecondary,
      text_size: px(26),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: '×',
    });

    // Right Box: WEIGHT (x: 255, y: 156, w: 160, h: 84)
    addWidget(widget.FILL_RECT, {
      x: px(255),
      y: px(156),
      w: px(160),
      h: px(84),
      radius: px(16),
      color: THEME.card,
    });

    addWidget(widget.BUTTON, {
      x: px(255),
      y: px(156),
      w: px(45),
      h: px(84),
      radius: px(16),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '-',
      text_size: px(28),
      click_func: () => {
        persistAndRender(() => session.adjustWeight(-2.5));
      },
    });

    addWidget(widget.TEXT, {
      x: px(298),
      y: px(160),
      w: px(74),
      h: px(46),
      color: THEME.textPrimary,
      text_size: px(32),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `${view.currentSet.weight}`,
    });

    addWidget(widget.TEXT, {
      x: px(298),
      y: px(206),
      w: px(74),
      h: px(24),
      color: THEME.textSecondary,
      text_size: px(16),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: 'kg',
    });

    addWidget(widget.BUTTON, {
      x: px(370),
      y: px(156),
      w: px(45),
      h: px(84),
      radius: px(16),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '+',
      text_size: px(28),
      click_func: () => {
        persistAndRender(() => session.adjustWeight(2.5));
      },
    });

    // Target prescription line (y=252)
    const rpeText = view.currentSet.rpe ? ` @ ${view.currentSet.rpe}` : '';
    addWidget(widget.TEXT, {
      x: 0,
      y: px(250),
      w: W,
      h: px(28),
      color: THEME.textSecondary,
      text_size: px(19),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `Target: ${view.currentSet.targetReps} × ${view.currentSet.targetWeight} kg${rpeText}`,
    });

    // Bottom Action Bar: [<]  [  ✓  ]  [>] (y=292, perfectly centered)
    addWidget(widget.BUTTON, {
      x: px(75),
      y: px(290),
      w: px(60),
      h: px(70),
      radius: px(30),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '<',
      text_size: px(26),
      click_func: () => {
        persistAndRender(() => session.prevExercise());
      },
    });

    // Main Checkmark Button (Pure Liftosaur Apple Watch ✓ Icon)
    addWidget(widget.BUTTON, {
      x: px(148),
      y: px(290),
      w: px(184),
      h: px(70),
      radius: px(35),
      normal_color: THEME.primary,
      press_color: THEME.primaryDeep,
      text: '✓',
      text_size: px(36),
      click_func: () => {
        hasVibratedThisRest = false;
        persistAndRender(() => session.completeSet());
        startRestTimer();
      },
    });

    addWidget(widget.BUTTON, {
      x: px(345),
      y: px(290),
      w: px(60),
      h: px(70),
      radius: px(30),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '>',
      text_size: px(26),
      click_func: () => {
        persistAndRender(() => session.nextExercise());
      },
    });
    return;
  }

  // ── 4. REST TIMER SCREEN (Liftosaur Watch Rest) ──
  if (view.state === SESSION_STATES.REST) {
    const isOvertime = Boolean(view.rest?.isOvertime);
    const remaining = view.rest ? view.rest.remaining : 0;
    const isTransition = view.rest?.isTransitionToNextExercise;

    const timerColor = isOvertime ? THEME.error : THEME.textPrimary;
    const headerLabel = isOvertime ? 'REST OVERTIME' : 'REST TIMER';
    const headerColor = isOvertime ? THEME.error : THEME.blue;
    const subtitle = isTransition
      ? `Next: Superset Switch`
      : `Next: Set ${view.currentSetIndex + 2} of ${view.totalSets}`;

    addWidget(widget.TEXT, {
      x: 0,
      y: px(45),
      w: W,
      h: px(28),
      color: THEME.textSecondary,
      text_size: px(19),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `▶ ${formatSeconds(view.elapsedSeconds)} • HR ${liveHr}`,
    });

    addWidget(widget.TEXT, {
      x: 0,
      y: px(115),
      w: W,
      h: px(30),
      color: headerColor,
      text_size: px(24),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: headerLabel,
    });

    addWidget(widget.TEXT, {
      x: 0,
      y: px(155),
      w: W,
      h: px(70),
      color: timerColor,
      text_size: px(56),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: formatSeconds(remaining),
    });

    addWidget(widget.TEXT, {
      x: 0,
      y: px(238),
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
      y: px(295),
      w: px(310),
      h: px(74),
      radius: px(37),
      normal_color: isOvertime ? THEME.primary : THEME.card,
      press_color: isOvertime ? THEME.primaryDeep : THEME.cardActive,
      text: isOvertime ? (isTransition ? 'NEXT EXERCISE' : 'START NEXT SET') : (isTransition ? 'NEXT EXERCISE' : 'SKIP REST'),
      text_size: px(26),
      click_func: () => {
        stopRestTimer();
        persistAndRender(() => session.nextSet());
      },
    });
    return;
  }

  // ── 5. FINISHED SUMMARY SCREEN (Liftosaur Watch Summary) ──
  if (view.state === SESSION_STATES.FINISHED) {
    addWidget(widget.TEXT, {
      x: 0,
      y: px(45),
      w: W,
      h: px(32),
      color: THEME.primaryLight,
      text_size: px(24),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: 'Summary',
    });

    addWidget(widget.TEXT, {
      x: 0,
      y: px(82),
      w: W,
      h: px(28),
      color: THEME.textPrimary,
      text_size: px(22),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: view.workoutName,
    });

    addWidget(widget.TEXT, {
      x: 0,
      y: px(112),
      w: W,
      h: px(24),
      color: THEME.textSecondary,
      text_size: px(18),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: view.routineName,
    });

    addWidget(widget.FILL_RECT, {
      x: px(65),
      y: px(145),
      w: px(350),
      h: px(145),
      radius: px(16),
      color: THEME.card,
    });

    addWidget(widget.TEXT, {
      x: px(85),
      y: px(155),
      w: px(310),
      h: px(24),
      color: THEME.textSecondary,
      text_size: px(17),
      align_h: align.LEFT,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: '⏱ TIME',
    });

    addWidget(widget.TEXT, {
      x: px(85),
      y: px(178),
      w: px(310),
      h: px(36),
      color: THEME.textPrimary,
      text_size: px(28),
      align_h: align.LEFT,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: formatSeconds(view.elapsedSeconds),
    });

    addWidget(widget.TEXT, {
      x: px(85),
      y: px(218),
      w: px(310),
      h: px(24),
      color: THEME.textSecondary,
      text_size: px(17),
      align_h: align.LEFT,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: '🏋️ VOLUME',
    });

    addWidget(widget.TEXT, {
      x: px(85),
      y: px(240),
      w: px(310),
      h: px(36),
      color: THEME.textPrimary,
      text_size: px(28),
      align_h: align.LEFT,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `${view.totalVolume} kg  (${view.totalCompletedSetsCount} sets)`,
    });

    addWidget(widget.BUTTON, {
      x: px(110),
      y: px(305),
      w: px(260),
      h: px(72),
      radius: px(36),
      normal_color: THEME.primary,
      press_color: THEME.primaryDeep,
      text: 'Done',
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
      if (view.rest && view.rest.remaining <= 0 && !hasVibratedThisRest) {
        hasVibratedThisRest = true;
        triggerVibration();
      }
      renderUI();
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

function startGlobalClock() {
  if (clockTimerId) clearInterval(clockTimerId);
  clockTimerId = setInterval(() => {
    const view = session.view(Date.now());
    if (view.state === SESSION_STATES.ACTIVE_SET || isOverviewListOpen) {
      renderUI();
    }
  }, 1000);
}

// ── Page Declaration ──────────────────────────────────────────────────────────

Page(
  BasePage({
    onInit() {
      console.log('[liftosaur] page onInit');
    },

    build() {
      console.log('[liftosaur] page build');

      // Register horizontal swipe gestures to switch exercises
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
      startGlobalClock();
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
      if (clockTimerId) {
        clearInterval(clockTimerId);
        clockTimerId = null;
      }
      if (hrSensor && hrCallback) {
        try {
          hrSensor.offCurrentChange?.(hrCallback);
        } catch (e) {}
      }
    },
  })
);
