import { createWidget, deleteWidget, widget, align, text_style } from '@zos/ui';
import { px } from '@zos/utils';
import { HeartRate } from '@zos/sensor';
import { BasePage } from '@zeppos/zml/base-page';

import {
  SESSION_STATES,
  createWorkoutSession,
} from '../../shared/workout-session.js';
import { createSessionStore } from '../../shared/session-storage.js';

// ── Prescription Mock (Phase 1 Slice) ────────────────────────────────────────

const BENCH_PRESS_MOCK = {
  id: 'mock-bench-press',
  name: 'Bench Press',
  sets: [
    { targetReps: 10, targetWeight: 60, restSeconds: 90 },
    { targetReps: 10, targetWeight: 60, restSeconds: 90 },
    { targetReps: 10, targetWeight: 60, restSeconds: 90 },
  ],
};

// ── In-Memory / Local Storage Fallback ────────────────────────────────────────

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
  exercise: BENCH_PRESS_MOCK,
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
  addWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: 0x000000 });

  // Top Header: Title & HR
  addWidget(widget.TEXT, {
    x: 0,
    y: px(35),
    w: W,
    h: px(40),
    color: 0x888888,
    text_size: px(24),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: `${view.exerciseName} • HR ${liveHr}`,
  });

  if (view.state === SESSION_STATES.READY) {
    // ── READY SCREEN ──
    addWidget(widget.TEXT, {
      x: 0,
      y: px(130),
      w: W,
      h: px(60),
      color: 0xffffff,
      text_size: px(38),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: 'Ready to Start',
    });

    addWidget(widget.TEXT, {
      x: 0,
      y: px(200),
      w: W,
      h: px(45),
      color: 0xaaaaaa,
      text_size: px(26),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: '3 sets × 10 reps @ 60 kg',
    });

    addWidget(widget.BUTTON, {
      x: px(100),
      y: px(290),
      w: px(280),
      h: px(85),
      radius: px(42),
      normal_color: 0x1e88e5,
      press_color: 0x1565c0,
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
      y: px(85),
      w: W,
      h: px(45),
      color: 0xffb300,
      text_size: px(28),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `SET ${setNum} OF ${view.totalSets}`,
    });

    // Weight Controls: [-2.5] [ 60 kg ] [+2.5]
    addWidget(widget.BUTTON, {
      x: px(45),
      y: px(140),
      w: px(75),
      h: px(60),
      radius: px(12),
      normal_color: 0x263238,
      press_color: 0x37474f,
      text: '-2.5',
      text_size: px(24),
      click_func: () => {
        persistAndRender(() => session.adjustWeight(-2.5));
      },
    });

    addWidget(widget.TEXT, {
      x: px(130),
      y: px(140),
      w: px(220),
      h: px(60),
      color: 0xffffff,
      text_size: px(34),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `${view.currentSet.weight} kg`,
    });

    addWidget(widget.BUTTON, {
      x: px(360),
      y: px(140),
      w: px(75),
      h: px(60),
      radius: px(12),
      normal_color: 0x263238,
      press_color: 0x37474f,
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
      normal_color: 0x263238,
      press_color: 0x37474f,
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
      color: 0xffffff,
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
      normal_color: 0x263238,
      press_color: 0x37474f,
      text: '+1',
      text_size: px(26),
      click_func: () => {
        persistAndRender(() => session.adjustReps(1));
      },
    });

    // Complete Set Button
    addWidget(widget.BUTTON, {
      x: px(90),
      y: px(315),
      w: px(300),
      h: px(85),
      radius: px(42),
      normal_color: 0x2e7d32,
      press_color: 0x1b5e20,
      text: 'COMPLETE SET',
      text_size: px(28),
      click_func: () => {
        persistAndRender(() => session.completeSet());
        startRestTimer();
      },
    });
  } else if (view.state === SESSION_STATES.REST) {
    // ── REST SCREEN ──
    const nextSetNum = view.currentSetIndex + 2;

    addWidget(widget.TEXT, {
      x: 0,
      y: px(90),
      w: W,
      h: px(40),
      color: 0x29b6f6,
      text_size: px(26),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: 'REST TIMER',
    });

    addWidget(widget.TEXT, {
      x: 0,
      y: px(145),
      w: W,
      h: px(80),
      color: 0xffffff,
      text_size: px(56),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: formatSeconds(view.rest ? view.rest.remaining : 0),
    });

    addWidget(widget.TEXT, {
      x: 0,
      y: px(240),
      w: W,
      h: px(40),
      color: 0x888888,
      text_size: px(24),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `Next: Set ${nextSetNum} (60 kg × 10)`,
    });

    addWidget(widget.BUTTON, {
      x: px(90),
      y: px(315),
      w: px(300),
      h: px(80),
      radius: px(40),
      normal_color: 0x37474f,
      press_color: 0x455a64,
      text: 'SKIP REST',
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
      color: 0x4caf50,
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
      color: 0xaaaaaa,
      text_size: px(28),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `${view.completedSets.length} sets completed`,
    });

    addWidget(widget.BUTTON, {
      x: px(110),
      y: px(295),
      w: px(260),
      h: px(80),
      radius: px(40),
      normal_color: 0x1e88e5,
      press_color: 0x1565c0,
      text: 'RESET',
      text_size: px(28),
      click_func: () => {
        sessionStore.clearSession();
        session = createWorkoutSession({ exercise: BENCH_PRESS_MOCK });
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
