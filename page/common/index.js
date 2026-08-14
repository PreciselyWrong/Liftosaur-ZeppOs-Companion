import { createWidget, deleteWidget, widget, align, text_style } from '@zos/ui';
import { px } from '@zos/utils';
import { HeartRate, Vibrator } from '@zos/sensor';
import { onGesture, offGesture, GESTURE_LEFT, GESTURE_RIGHT } from '@zos/interaction';
import {
  setPageBrightTime,
  resetPageBrightTime,
  pauseDropWristScreenOff,
  resetDropWristScreenOff,
  pausePalmScreenOff,
  resetPalmScreenOff,
} from '@zos/display';
import { BasePage } from '@zeppos/zml/base-page';

import {
  SESSION_STATES,
  createWorkoutSession,
} from '../../shared/workout-session.js';
import { createSessionStore } from '../../shared/session-storage.js';
import {
  MESSAGE_TYPES,
  createMessage,
} from '../../shared/protocol.js';

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

  textPrimary: 0xffffff,      // Texte principal (#FFFFFF)
  textSecondary: 0xa4b0bc,    // Texte secondaire (#A4B0BC)
  textMuted: 0x4f5c6b,        // Texte secondaire discret (#4F5C6B)
  textDisabled: 0x607284,     // Texte disabled / pending dot (#607284)
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

let pageInstance = null;
let session = createWorkoutSession({
  workout: null,
  initialJournal: sessionStore.loadJournal(),
});

let isOverviewListOpen = false;
let isSyncing = false;
let syncErrorMessage = '';
let liveHr = 'N/A';
let hrSensor = null;
let hrCallback = null;
let vibrator = null;
let hasVibratedThisRest = false;
let singleClockTimer = null;
let lastRenderedSecond = -1;
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

let currentRequestedDayIndex = 0;

function requestProgramFromSideService(isManual = false, dayIndex = null) {
  if (!pageInstance || typeof pageInstance.request !== 'function') return;
  isSyncing = true;
  syncErrorMessage = '';
  if (dayIndex !== null) {
    currentRequestedDayIndex = dayIndex;
  }
  if (isManual) renderUI();

  try {
    pageInstance
      .request(createMessage({
        type: MESSAGE_TYPES.GET_CURRENT_WORKOUT,
        payload: { dayIndex: currentRequestedDayIndex },
      }))
      .then((res) => {
        isSyncing = false;
        if (res && res.type === MESSAGE_TYPES.WORKOUT_DATA && res.payload) {
          if (res.payload.configured && res.payload.workout) {
            console.log('[liftosaur] received workout:', res.payload.workout.name);
            session = createWorkoutSession({ workout: res.payload.workout });
            renderUI();
          } else {
            console.log('[liftosaur] side service: no api key configured');
            syncErrorMessage = 'No API key in Zepp App';
            renderUI();
          }
        } else if (res && res.type === MESSAGE_TYPES.ERROR) {
          syncErrorMessage = res.payload?.message || 'Liftosaur API error';
          renderUI();
        }
      })
      .catch((err) => {
        isSyncing = false;
        console.log('[liftosaur] side fetch error:', err?.message || String(err));
        syncErrorMessage = 'Phone not reachable';
        renderUI();
      });
  } catch (err) {
    isSyncing = false;
    console.log('[liftosaur] request dispatch error:', err?.message || String(err));
    syncErrorMessage = 'Dispatch error';
    renderUI();
  }
}


function asyncSideSyncJournal() {
  if (!pageInstance || typeof pageInstance.request !== 'function') return;
  try {
    const journal = session.getJournal();
    pageInstance
      .request(
        createMessage({
          type: MESSAGE_TYPES.SYNC_JOURNAL,
          sessionId: session.view().workoutName,
          payload: { journal },
        })
      )
      .then((res) => {
        console.log('[liftosaur] async journal synced with side service');
      })
      .catch((err) => {
        console.log('[liftosaur] async journal sync queued locally:', err?.message || String(err));
      });
  } catch (err) {
    console.log('[liftosaur] sync dispatch error:', err?.message || String(err));
  }
}

function asyncSideSubmitHistory() {
  if (!pageInstance || typeof pageInstance.request !== 'function') return;
  try {
    const view = session.view();
    const historyPayload = {
      workoutName: view.workoutName,
      routineName: view.routineName,
      elapsedSeconds: view.elapsedSeconds,
      totalVolume: view.totalVolume,
      completedSetsCount: view.totalCompletedSetsCount,
      completedSets: view.allCompletedSets,
      journal: session.getJournal(),
    };

    pageInstance
      .request(
        createMessage({
          type: MESSAGE_TYPES.SUBMIT_WORKOUT_HISTORY,
          sessionId: view.workoutName,
          payload: historyPayload,
        })
      )
      .then((res) => {
        console.log('[liftosaur] history submitted successfully to side service');
      })
      .catch((err) => {
        console.log('[liftosaur] history submission saved locally for later retry:', err?.message || String(err));
      });
  } catch (err) {
    console.log('[liftosaur] history dispatch error:', err?.message || String(err));
  }
}

function persistAndRender(action) {
  if (action) {
    action();
    sessionStore.saveJournal(session.getJournal());
    asyncSideSyncJournal();
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

  // ── 0. SETUP REQUIRED (NO API KEY / NO WORKOUT) ONBOARDING SCREEN ──
  if (view.state === SESSION_STATES.SETUP_REQUIRED) {
    addWidget(widget.TEXT, {
      x: 0,
      y: px(45),
      w: W,
      h: px(30),
      color: THEME.primaryLight,
      text_size: px(22),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: 'Liftosaur',
    });

    addWidget(widget.FILL_RECT, {
      x: px(60),
      y: px(95),
      w: px(360),
      h: px(215),
      radius: px(20),
      color: THEME.card,
    });

    addWidget(widget.TEXT, {
      x: px(75),
      y: px(110),
      w: px(330),
      h: px(30),
      color: THEME.orange,
      text_size: px(22),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: isSyncing ? 'Connecting...' : 'API Key Required',
    });

    const statusDetail = syncErrorMessage
      ? `Error: ${syncErrorMessage}\n\nCheck Zepp App > Liftosaur > Settings.`
      : 'Enter your Liftosaur API key in the Zepp app on your phone:\n\nProfile > Apps > Liftosaur > Settings';

    addWidget(widget.TEXT, {
      x: px(80),
      y: px(148),
      w: px(320),
      h: px(140),
      color: THEME.textSecondary,
      text_size: px(17),
      align_h: align.CENTER_H,
      align_v: align.TOP,
      text_style: text_style.WRAP,
      text: statusDetail,
    });

    addWidget(widget.BUTTON, {
      x: px(90),
      y: px(330),
      w: px(300),
      h: px(76),
      radius: px(38),
      normal_color: THEME.primary,
      press_color: THEME.primaryDeep,
      text: isSyncing ? 'Checking...' : 'Sync Program',
      text_size: px(26),
      click_func: () => {
        requestProgramFromSideService(true);
      },
    });
    return;
  }

  // ── 1. OVERVIEW EXERCISE LIST VIEW ──
  if (isOverviewListOpen && view.state !== SESSION_STATES.READY && view.state !== SESSION_STATES.FINISHED) {
    // Top Bar (Safe Zone): [< Back] [ ▶ Elapsed • HR ]
    addWidget(widget.BUTTON, {
      x: px(85),
      y: px(45),
      w: px(40),
      h: px(40),
      radius: px(20),
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
      h: px(40),
      color: THEME.primaryLight,
      text_size: px(20),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `▶ ${formatSeconds(view.elapsedSeconds)} • HR ${liveHr}`,
    });

    const cardH = px(68);
    const cardGap = px(8);
    let cardY = px(95);

    view.overviewExercises.forEach((ex, idx) => {
      const isCurrent = idx === view.currentExerciseIndex;
      const cardBg = isCurrent ? THEME.primaryDark : THEME.card;
      const title = ex.name.length > 16 ? ex.name.slice(0, 14) + '…' : ex.name;
      const dots = formatDots(ex.setsDots);
      const sub = ex.supersetTag ? `[${ex.supersetTag}] ${ex.prescriptionSummary}` : ex.prescriptionSummary;

      addWidget(widget.BUTTON, {
        x: px(65),
        y: cardY,
        w: px(350),
        h: cardH,
        radius: px(14),
        normal_color: cardBg,
        press_color: THEME.cardActive,
        text: `${title}  ${dots}\n${sub}`,
        text_size: px(18),
        color: isCurrent ? THEME.primaryPale : THEME.textPrimary,
        click_func: () => {
          session.selectExercise(idx);
          isOverviewListOpen = false;
          persistAndRender();
        },
      });

      cardY += cardH + cardGap;
    });
    return;
  }

  // ── 2. READY SCREEN ──
  if (view.state === SESSION_STATES.READY) {
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

    addWidget(widget.FILL_RECT, {
      x: px(65),
      y: px(95),
      w: px(350),
      h: px(210),
      radius: px(20),
      color: THEME.card,
    });

    const shortWorkoutName = view.workoutName.length > 20 ? view.workoutName.slice(0, 18) + '…' : view.workoutName;
    addWidget(widget.TEXT, {
      x: px(85),
      y: px(108),
      w: px(310),
      h: px(36),
      color: THEME.textPrimary,
      text_size: px(24),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: shortWorkoutName,
    });

    addWidget(widget.TEXT, {
      x: px(85),
      y: px(144),
      w: px(310),
      h: px(28),
      color: THEME.primaryLight,
      text_size: px(19),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: view.routineName,
    });

    // Multi-day selector if program has multiple days
    if (view.totalDays && view.totalDays > 1) {
      const curIdx = view.currentDayIndex ?? currentRequestedDayIndex;

      addWidget(widget.BUTTON, {
        x: px(75),
        y: px(178),
        w: px(44),
        h: px(38),
        radius: px(12),
        normal_color: THEME.primaryDark,
        press_color: THEME.cardActive,
        text: '<',
        text_size: px(22),
        click_func: () => {
          const prevDay = (curIdx - 1 + view.totalDays) % view.totalDays;
          requestProgramFromSideService(true, prevDay);
        },
      });

      addWidget(widget.TEXT, {
        x: px(122),
        y: px(178),
        w: px(236),
        h: px(38),
        color: THEME.orange,
        text_size: px(18),
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
        text_style: text_style.NONE,
        text: `Day ${curIdx + 1}/${view.totalDays}`,
      });

      addWidget(widget.BUTTON, {
        x: px(361),
        y: px(178),
        w: px(44),
        h: px(38),
        radius: px(12),
        normal_color: THEME.primaryDark,
        press_color: THEME.cardActive,
        text: '>',
        text_size: px(22),
        click_func: () => {
          const nextDay = (curIdx + 1) % view.totalDays;
          requestProgramFromSideService(true, nextDay);
        },
      });
    } else {
      addWidget(widget.TEXT, {
        x: px(85),
        y: px(180),
        w: px(310),
        h: px(26),
        color: THEME.textSecondary,
        text_size: px(18),
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
        text_style: text_style.NONE,
        text: `${view.totalExercises} exercises`,
      });
    }

    const shortFirstEx = view.exerciseName.length > 22 ? view.exerciseName.slice(0, 20) + '…' : view.exerciseName;
    addWidget(widget.TEXT, {
      x: px(85),
      y: px(224),
      w: px(310),
      h: px(36),
      color: THEME.textDisabled,
      text_size: px(17),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `First: ${shortFirstEx}`,
    });


    addWidget(widget.BUTTON, {
      x: px(90),
      y: px(330),
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

  // ── 3. ACTIVE SET SCREEN (Balanced Spacing) ──
  if (view.state === SESSION_STATES.ACTIVE_SET) {
    const setNum = view.currentSetIndex + 1;
    const dotsString = formatDots(view.exerciseSetsDots);

    // Top Bar (y=45): [< Back] [ ▶ 00:29 • HR 67 ]
    addWidget(widget.BUTTON, {
      x: px(82),
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
      x: px(126),
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

    // Superset pill (if present)
    let titleY = px(90);
    if (view.supersetTag) {
      addWidget(widget.TEXT, {
        x: 0,
        y: px(86),
        w: W,
        h: px(22),
        color: THEME.blue,
        text_size: px(18),
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
        text_style: text_style.NONE,
        text: `[${view.supersetTag}]`,
      });
      titleY = px(110);
    }

    // Exercise Name
    const shortEx = view.exerciseName.length > 22 ? view.exerciseName.slice(0, 20) + '…' : view.exerciseName;
    addWidget(widget.TEXT, {
      x: 0,
      y: titleY,
      w: W,
      h: px(30),
      color: THEME.textPrimary,
      text_size: px(23),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: shortEx,
    });

    // Set Status Line with Interactive Dots
    const setStatusY = view.supersetTag ? px(142) : px(124);
    addWidget(widget.BUTTON, {
      x: px(90),
      y: setStatusY,
      w: px(300),
      h: px(32),
      radius: px(16),
      normal_color: THEME.bg,
      press_color: THEME.card,
      text: `Set ${setNum}/${view.totalSets}   ${dotsString}`,
      text_size: px(21),
      color: THEME.orange,
      click_func: () => {
        persistAndRender(() => {
          session.selectExercise(view.currentExerciseIndex);
        });
      },
    });

    // ── Input Boxes (y=164, h=86) ──
    const boxesY = view.supersetTag ? px(176) : px(162);
    const boxH = px(86);

    // Left Box: REPS
    addWidget(widget.FILL_RECT, {
      x: px(65),
      y: boxesY,
      w: px(160),
      h: boxH,
      radius: px(16),
      color: THEME.card,
    });

    addWidget(widget.BUTTON, {
      x: px(65),
      y: boxesY,
      w: px(45),
      h: boxH,
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
      y: boxesY + px(4),
      w: px(74),
      h: px(48),
      color: THEME.textPrimary,
      text_size: px(34),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `${view.currentSet.reps}`,
    });

    addWidget(widget.TEXT, {
      x: px(108),
      y: boxesY + px(52),
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
      y: boxesY,
      w: px(45),
      h: boxH,
      radius: px(16),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '+',
      text_size: px(28),
      click_func: () => {
        persistAndRender(() => session.adjustReps(1));
      },
    });

    // Middle '×'
    addWidget(widget.TEXT, {
      x: px(226),
      y: boxesY + px(22),
      w: px(28),
      h: px(44),
      color: THEME.textSecondary,
      text_size: px(26),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: '×',
    });

    // Right Box: WEIGHT
    addWidget(widget.FILL_RECT, {
      x: px(255),
      y: boxesY,
      w: px(160),
      h: boxH,
      radius: px(16),
      color: THEME.card,
    });

    addWidget(widget.BUTTON, {
      x: px(255),
      y: boxesY,
      w: px(45),
      h: boxH,
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
      y: boxesY + px(4),
      w: px(74),
      h: px(48),
      color: THEME.textPrimary,
      text_size: px(32),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `${view.currentSet.weight}`,
    });

    addWidget(widget.TEXT, {
      x: px(298),
      y: boxesY + px(52),
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
      y: boxesY,
      w: px(45),
      h: boxH,
      radius: px(16),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '+',
      text_size: px(28),
      click_func: () => {
        persistAndRender(() => session.adjustWeight(2.5));
      },
    });

    // Target prescription line (y=258)
    const targetY = boxesY + boxH + px(8);
    const rpeText = view.currentSet.rpe ? ` @ ${view.currentSet.rpe}` : '';
    addWidget(widget.TEXT, {
      x: 0,
      y: targetY,
      w: W,
      h: px(26),
      color: THEME.textSecondary,
      text_size: px(18),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `Target: ${view.currentSet.targetReps} × ${view.currentSet.targetWeight} kg${rpeText}`,
    });

    // ── Bottom Action Bar: [<]  [  ✓  ]  [>] (Unified at y=316) ──
    const actionY = px(316);
    const actionH = px(74);

    addWidget(widget.BUTTON, {
      x: px(78),
      y: actionY,
      w: px(64),
      h: actionH,
      radius: px(32),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '<',
      text_size: px(26),
      click_func: () => {
        persistAndRender(() => session.prevExercise());
      },
    });

    addWidget(widget.BUTTON, {
      x: px(158),
      y: actionY,
      w: px(164),
      h: actionH,
      radius: px(37),
      normal_color: THEME.primary,
      press_color: THEME.primaryDeep,
      text: '✓',
      text_size: px(38),
      click_func: () => {
        hasVibratedThisRest = false;
        persistAndRender(() => session.completeSet());
      },
    });

    addWidget(widget.BUTTON, {
      x: px(338),
      y: actionY,
      w: px(64),
      h: actionH,
      radius: px(32),
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

  // ── 4. REST TIMER SCREEN ──
  if (view.state === SESSION_STATES.REST) {
    const isOvertime = Boolean(view.rest?.isOvertime);
    const remaining = view.rest ? view.rest.remaining : 0;
    const isTransition = view.rest?.isTransitionToNextExercise;

    const timerColor = isOvertime ? THEME.error : THEME.textPrimary;
    const headerLabel = isOvertime ? 'REST OVERTIME' : 'REST TIMER';
    const headerColor = isOvertime ? THEME.error : THEME.blue;

    let subtitle = '';
    if (view.rest?.nextExerciseName) {
      const nextExName = view.rest.nextExerciseName;
      const shortNext = nextExName.length > 18 ? nextExName.slice(0, 16) + '…' : nextExName;
      const tag = view.rest.nextSupersetTag ? `[${view.rest.nextSupersetTag}] ` : '';
      const setInfo = view.rest.nextSetIndex !== null ? ` (Set ${view.rest.nextSetIndex + 1}/${view.rest.nextTotalSets})` : '';
      subtitle = `Next: ${tag}${shortNext}${setInfo}`;
    } else {
      subtitle = isTransition
        ? `Next: Exercise ${view.currentExerciseIndex + 2}/${view.totalExercises}`
        : `Next: Set ${view.currentSetIndex + 2} of ${view.totalSets}`;
    }

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
      y: px(158),
      w: W,
      h: px(75),
      color: timerColor,
      text_size: px(60),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: formatSeconds(remaining),
    });

    addWidget(widget.TEXT, {
      x: 0,
      y: px(248),
      w: W,
      h: px(35),
      color: THEME.textSecondary,
      text_size: px(21),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: subtitle,
    });

    addWidget(widget.BUTTON, {
      x: px(95),
      y: px(316),
      w: px(290),
      h: px(76),
      radius: px(38),
      normal_color: isOvertime ? THEME.primary : THEME.card,
      press_color: isOvertime ? THEME.primaryDeep : THEME.cardActive,
      text: isOvertime ? (isTransition ? 'NEXT EXERCISE' : 'START NEXT SET') : (isTransition ? 'NEXT EXERCISE' : 'SKIP REST'),
      text_size: px(26),
      click_func: () => {
        persistAndRender(() => session.nextSet());
      },
    });
    return;
  }

  // ── 5. FINISHED SUMMARY SCREEN ──
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
      y: px(85),
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
      y: px(118),
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
      y: px(155),
      w: px(350),
      h: px(150),
      radius: px(16),
      color: THEME.card,
    });

    addWidget(widget.TEXT, {
      x: px(85),
      y: px(168),
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
      y: px(192),
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
      y: px(234),
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
      y: px(258),
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
      y: px(325),
      w: px(260),
      h: px(76),
      radius: px(38),
      normal_color: THEME.primary,
      press_color: THEME.primaryDeep,
      text: 'Done',
      text_size: px(26),
      click_func: () => {
        asyncSideSubmitHistory();
        sessionStore.clearSession();
        requestProgramFromSideService(false);
      },
    });
  }
}

function startUnifiedClock() {
  if (singleClockTimer) {
    clearInterval(singleClockTimer);
    singleClockTimer = null;
  }

  singleClockTimer = setInterval(() => {
    const now = Date.now();
    const view = session.view(now);

    if (view.state === SESSION_STATES.ACTIVE_SET || view.state === SESSION_STATES.REST || isOverviewListOpen) {
      const currentSec = view.state === SESSION_STATES.REST ? (view.rest?.remaining ?? 0) : view.elapsedSeconds;
      if (currentSec !== lastRenderedSecond) {
        lastRenderedSecond = currentSec;

        if (view.state === SESSION_STATES.REST && view.rest && view.rest.remaining <= 0 && !hasVibratedThisRest) {
          hasVibratedThisRest = true;
          triggerVibration();
        }

        renderUI();
      }
    }
  }, 500);
}

function stopUnifiedClock() {
  if (singleClockTimer) {
    clearInterval(singleClockTimer);
    singleClockTimer = null;
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
      pageInstance = this;

      // Keep screen on and prevent palm/wrist drop sleep during workouts
      try {
        setPageBrightTime({ brightTime: 0 });
        pauseDropWristScreenOff({ duration: 0 });
        pausePalmScreenOff({ duration: 0 });
      } catch (err) {
        console.log('[liftosaur] display keep-awake error:', err?.message || String(err));
      }

      // Fetch fresh workout prescription from Side Service if no active in-flight session
      if (session.view().state === SESSION_STATES.SETUP_REQUIRED || (session.view().state === SESSION_STATES.READY && session.getJournal().length === 0)) {
        requestProgramFromSideService(false);
      }

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
      startUnifiedClock();
    },

    onDestroy() {
      console.log('[liftosaur] page onDestroy');
      try {
        offGesture();
      } catch (e) {}
      try {
        resetPageBrightTime();
        resetDropWristScreenOff();
        resetPalmScreenOff();
      } catch (e) {}
      stopUnifiedClock();
      pageInstance = null;
      if (hrSensor && hrCallback) {
        try {
          hrSensor.offCurrentChange?.(hrCallback);
        } catch (e) {}
      }
    },
  })
);
