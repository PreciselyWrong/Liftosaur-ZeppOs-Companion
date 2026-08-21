import { createWidget, deleteWidget, redraw, widget, align, text_style, prop } from '@zos/ui';
import { px } from '@zos/utils';
import { getDeviceInfo, SCREEN_SHAPE_ROUND } from '@zos/device';
import { HeartRate, Time, TIME_HOUR_FORMAT_12, Vibrator, VIBRATOR_SCENE_DURATION } from '@zos/sensor';
import { LocalStorage } from '@zos/storage';
import {
  onGesture,
  offGesture,
  GESTURE_LEFT,
  GESTURE_RIGHT,
  GESTURE_DOWN,
} from '@zos/interaction';
import {
  setPageBrightTime,
  resetPageBrightTime,
  pauseDropWristScreenOff,
  resetDropWristScreenOff,
  pausePalmScreenOff,
  resetPalmScreenOff,
} from '@zos/display';
import { BasePage } from '@zeppos/zml/base-page';

import { SESSION_STATES, createWorkoutSession } from '../../shared/workout-session.js';
import { createSessionStore } from '../../shared/session-storage.js';
import { MESSAGE_TYPES, createMessage } from '../../shared/protocol.js';
import { createScreenLayout } from '../../shared/screen-layout.js';
import { isTemporaryPhoneError } from '../../shared/connection-state.js';
import {
  TYPOGRAPHY,
  LIST_PAGE_SIZE,
  OVERVIEW_PAGE_SIZE,
  READY_PREVIEW_SIZE,
  activeSetLayout,
  formatWorkoutPosition,
  formatMarqueeText,
} from '../../shared/watch-layout.js';
import {
  suggestedProgramIndex,
  suggestedWeekIndex,
  suggestedDayIndex,
  suggestedStart,
  withoutIndex,
  programForSavedPlan,
} from '../../shared/selection.js';

// ── Liftosaur palette ────────────────────────────────────────────────────────

const THEME = {
  primary: 0x8356f6,
  primaryLight: 0xa48bfa,
  primaryPale: 0xccc1f9,
  primaryDark: 0x393248,
  primaryDeep: 0x2c1065,
  success: 0x2bdc9b,
  error: 0xff8066,
  yellow: 0xffd820,
  orange: 0xffb544,

  bg: 0x000000,
  card: 0x332d42,
  cardActive: 0x453d58,

  textPrimary: 0xffffff,
  textSecondary: 0xa4b0bc,
  textMuted: 0x4f5c6b,
  textDisabled: 0x607284,
};

/**
 * Screens are drawn in the round 480x480 design space; `LAYOUT.fit()` is the
 * only thing that knows about the real screen. It is the identity on round
 * watches, so they render exactly as before.
 */
let deviceInfo = {};
try {
  deviceInfo = getDeviceInfo() || {};
} catch (err) {
  console.log('[liftosaur] device info unavailable, assuming round 480:', err?.message || String(err));
}
// The real dimensions are passed straight through. Substituting `px(480)` for a
// missing one is what silently broke the Bip 6: on a 390 wide panel it yields
// 390x390, a plausible square canvas that the layout reads as round.
const LAYOUT = createScreenLayout({
  width: deviceInfo.width,
  height: deviceInfo.height,
  isRound:
    typeof SCREEN_SHAPE_ROUND === 'number' && typeof deviceInfo.screenShape === 'number'
      ? deviceInfo.screenShape === SCREEN_SHAPE_ROUND
      : undefined,
});

console.log(
  `[liftosaur] screen ${LAYOUT.width}x${LAYOUT.height} shape=${deviceInfo.screenShape} ` +
    `round=${SCREEN_SHAPE_ROUND} fitted=${LAYOUT.isFitted} scale=${LAYOUT.scale} inset=${LAYOUT.insetTop}`,
);

const W = LAYOUT.width;
const H = LAYOUT.height;

function font(role) {
  return px(TYPOGRAPHY[role]);
}

// ── Screens ──────────────────────────────────────────────────────────────────
//
// The watch never picks a program or a day on its own. It asks the API for the
// lists and shows them; every selection below is a deliberate tap.

const SCREEN = {
  LOADING: 'LOADING',
  CONNECTION: 'CONNECTION',
  SETUP: 'SETUP',
  HOME: 'HOME',
  PROGRAMS: 'PROGRAMS',
  WEEKS: 'WEEKS',
  DAYS: 'DAYS',
  SESSION: 'SESSION',
};

const SESSION_KEY = 'liftosaur.session';

/**
 * `@zos/storage` is documented from API_LEVEL 3.0 and declared in app.json, but
 * it has not been exercised on the real watch yet. A failure degrades to an
 * in-memory store rather than breaking a workout.
 */
let memoryFallback = null;
let deviceStorage = null;
try {
  deviceStorage = new LocalStorage();
} catch (err) {
  console.log('[liftosaur] LocalStorage unavailable, session kept in memory:', err?.message || String(err));
}

/**
 * The watch clock. Created once here rather than per render: it is read on
 * every screen and its absence must never cost more than a missing label.
 */
let timeSensor = null;
try {
  timeSensor = new Time();
} catch (err) {
  console.log('[liftosaur] time sensor unavailable, clock hidden:', err?.message || String(err));
}

const localStoreAdapter = {
  read: () => (deviceStorage ? deviceStorage.getItem(SESSION_KEY, null) : memoryFallback),
  write: (data) => {
    if (deviceStorage) deviceStorage.setItem(SESSION_KEY, data);
    else memoryFallback = data;
  },
  remove: () => {
    if (deviceStorage) deviceStorage.removeItem(SESSION_KEY);
    else memoryFallback = null;
  },
};
const sessionStore = createSessionStore(localStoreAdapter);

let pageInstance = null;
let screen = SCREEN.LOADING;
let statusMessage = '';
let errorMessage = '';
let isBusy = false;
let listPage = 0;

let programs = [];
let serviceMode = 'UNKNOWN';
let selectedProgram = null;
let outline = null;
let selectedWeek = null;
let dayPlan = null;

let session = createWorkoutSession({ plan: null });
let isOverviewOpen = false;
let overviewPage = 0;

let finishState = null; // { status, message }

let liveHr = 'N/A';
let hrSensor = null;
let hrCallback = null;
let vibrator = null;
let lastVibratedOvertimeStep = -1;
let flashWidget = null;
let flashTimer = null;
let vibrationTimer = null;
let isRestMinimized = false;
let isNotesModalOpen = false;
let activeNotesTitle = '';
let activeNotesContent = '';
let clockTimer = null;
let lastRenderedClock = null;
let lastRenderedSecond = null;
let lastRenderedState = null;
let activeWidgets = [];
let modalControls = null;

/**
 * Widgets whose text changes every second.
 *
 * Rebuilding the whole screen once a second is what made the countdown skip:
 * tearing down and recreating twenty widgets takes long enough that ticks get
 * dropped. These are patched in place instead. The creation props are kept so
 * an update re-sends the complete property set - a partial `prop.MORE` would
 * clear the geometry.
 */
let liveWidgets = {};

function clearWidgets() {
  clearFlash();
  for (const w of activeWidgets) {
    try {
      deleteWidget(w);
    } catch (e) {
      // A widget already torn down by the runtime is not an error here.
    }
  }
  activeWidgets = [];
  liveWidgets = {};
}

/** Creates a widget from props already expressed in real screen pixels. */
function addRawWidget(type, props) {
  const w = createWidget(type, props);
  activeWidgets.push(w);
  return w;
}

function addActionWidget(props) {
  return addRawWidget(widget.BUTTON, {
    ...props,
    click_func: props.click_func,
  });
}

function addWidget(type, props) {
  const fitted = LAYOUT.fit(props);
  if (type === widget.BUTTON && typeof fitted.click_func === 'function') {
    return addActionWidget(fitted);
  }
  return addRawWidget(type, fitted);
}

function setModalControl(button, props, visible) {
  const fitted = LAYOUT.fit(props);
  button.setProperty(prop.VISIBLE, false);
  button.setProperty(prop.MORE, fitted);
  button.setProperty(prop.VISIBLE, visible);
}

function hideModalControls() {
  if (!modalControls) return;
  for (const button of Object.values(modalControls)) {
    button.setProperty(prop.VISIBLE, false);
  }
}

function ensureModalControls(totalPages) {
  if (!modalControls) {
    modalControls = {
      previous: createWidget(
        widget.BUTTON,
        LAYOUT.fit({
          x: px(48),
          y: px(348),
          w: px(80),
          h: px(54),
          radius: px(27),
          normal_color: THEME.cardActive,
          press_color: THEME.card,
          text: '<',
          text_size: font('button'),
          click_func: () => {
            if (isNotesModalOpen) moveNotesPage(-1);
          },
        }),
      ),
      next: createWidget(
        widget.BUTTON,
        LAYOUT.fit({
          x: px(166),
          y: px(348),
          w: px(80),
          h: px(54),
          radius: px(27),
          normal_color: THEME.cardActive,
          press_color: THEME.card,
          text: '>',
          text_size: font('button'),
          click_func: () => {
            if (isNotesModalOpen) moveNotesPage(1);
          },
        }),
      ),
      close: createWidget(
        widget.BUTTON,
        LAYOUT.fit({
          x: px(250),
          y: px(348),
          w: px(160),
          h: px(54),
          radius: px(27),
          normal_color: THEME.primary,
          press_color: THEME.primaryDeep,
          text: 'Close',
          text_size: font('button'),
          click_func: () => {
            if (isNotesModalOpen) closeTextModal();
          },
        }),
      ),
    };
  }

  const hasPaging = totalPages > 1;
  setModalControl(
    modalControls.previous,
    {
      x: px(48),
      y: px(348),
      w: px(80),
      h: px(54),
      radius: px(27),
      normal_color: THEME.cardActive,
      press_color: THEME.card,
      text: '<',
      text_size: font('button'),
    },
    hasPaging,
  );
  setModalControl(
    modalControls.next,
    {
      x: px(166),
      y: px(348),
      w: px(80),
      h: px(54),
      radius: px(27),
      normal_color: THEME.cardActive,
      press_color: THEME.card,
      text: '>',
      text_size: font('button'),
    },
    hasPaging,
  );
  setModalControl(
    modalControls.close,
    {
      x: hasPaging ? px(250) : px(140),
      y: px(348),
      w: hasPaging ? px(160) : px(200),
      h: hasPaging ? px(54) : px(56),
      radius: hasPaging ? px(27) : px(28),
      normal_color: THEME.primary,
      press_color: THEME.primaryDeep,
      text: 'Close',
      text_size: font('button'),
    },
    true,
  );
}

function destroyModalControls() {
  if (!modalControls) return;
  for (const button of Object.values(modalControls)) {
    try {
      deleteWidget(button);
    } catch (e) {
      // The page teardown may already have removed the native widget.
    }
  }
  modalControls = null;
}

/**
 * The fitted props are what gets stored: an in-place `prop.MORE` update
 * re-sends the whole property set, so design-space geometry would snap the
 * widget back off-screen on a fitted layout.
 */
/**
 * Zepp OS does not repaint a TEXT widget after setProperty. A label which
 * changes during a session is therefore a button without a callback: BUTTON
 * supports full geometry updates and avoids rebuilding every action target.
 */
function addLiveLabel(key, props) {
  const fitted = LAYOUT.fit(props);
  const w = addRawWidget(widget.BUTTON, fitted);
  liveWidgets[key] = { widget: w, props: { ...fitted } };
  return w;
}

function addLiveButton(key, props) {
  const fitted = LAYOUT.fit(props);
  const w = addActionWidget(fitted);
  liveWidgets[key] = { widget: w, props: { ...fitted } };
  return w;
}

const LIVE_WIDGET_MUTABLE_KEYS = ['x', 'y', 'w', 'h', 'text', 'color', 'text_size', 'radius'];

/** Returns false when the runtime refused the in-place update, so the caller can fall back. */
function updateLiveWidget(key, changes) {
  const entry = liveWidgets[key];
  if (!entry) return true;
  try {
    Object.assign(entry.props, changes);
    const mutableProps = {};
    for (const property of LIVE_WIDGET_MUTABLE_KEYS) {
      if (property in entry.props) mutableProps[property] = entry.props[property];
    }
    entry.widget.setProperty(prop.MORE, mutableProps);
    return true;
  } catch (err) {
    console.log('[liftosaur] in-place text update unavailable:', err?.message || String(err));
    return false;
  }
}

// ── Side Service calls ───────────────────────────────────────────────────────

function send(type, payload = {}) {
  if (!pageInstance || typeof pageInstance.request !== 'function') {
    return Promise.reject(new Error('Phone not reachable'));
  }
  return pageInstance.request(createMessage({ type, payload })).then((res) => {
    if (res && res.type === MESSAGE_TYPES.ERROR) {
      const err = new Error(res.payload?.message || 'Liftosaur API error');
      err.code = res.payload?.code;
      throw err;
    }
    return res;
  });
}

function beginRequest(message) {
  isBusy = true;
  errorMessage = '';
  statusMessage = message;
  renderUI();
}

function failRequest(err) {
  isBusy = false;
  statusMessage = '';
  errorMessage = err?.message || 'Request failed';
  console.log('[liftosaur] request failed:', errorMessage);
  renderUI();
}

/**
 * Launch path. When Liftosaur has an active program the outline is fetched
 * straight away so the home screen can offer its next day in one tap. Without
 * one, the program list is the entry point.
 */
function loadPrograms() {
  beginRequest('Loading programs…');
  send(MESSAGE_TYPES.LIST_PROGRAMS)
    .then((res) => {
      programs = res.payload?.programs || [];
      serviceMode = res.payload?.serviceMode || 'CLOUD';
      listPage = 0;

      if (programs.length === 0) {
        isBusy = false;
        statusMessage = '';
        screen = SCREEN.SETUP;
        errorMessage = 'No programs on this Liftosaur account';
        renderUI();
        return;
      }

      const currentIndex = suggestedProgramIndex(programs);
      if (currentIndex === -1) {
        isBusy = false;
        statusMessage = '';
        screen = SCREEN.PROGRAMS;
        renderUI();
        return;
      }

      loadOutline(programs[currentIndex], { nextScreen: SCREEN.HOME });
    })
    .catch((err) => {
      if (isTemporaryPhoneError(err)) {
        isBusy = false;
        statusMessage = '';
        errorMessage = '';
        screen = SCREEN.CONNECTION;
        renderUI();
        return;
      }
      screen = SCREEN.SETUP;
      failRequest(err);
    });
}

function loadOutline(program, { nextScreen = SCREEN.WEEKS } = {}) {
  selectedProgram = program;
  beginRequest('Loading weeks…');
  send(MESSAGE_TYPES.GET_PROGRAM_OUTLINE, { programId: program.id })
    .then((res) => {
      isBusy = false;
      statusMessage = '';
      outline = res.payload;
      listPage = 0;
      screen = outline.weeks && outline.weeks.length > 0 ? nextScreen : SCREEN.PROGRAMS;
      if (screen === SCREEN.PROGRAMS) {
        errorMessage = 'This program has no days';
      }
      renderUI();
    })
    .catch(failRequest);
}

function loadDayPlan(week, day) {
  // Also set when arriving from the home shortcut, so "Change" has a week to
  // go back to.
  selectedWeek = week;
  beginRequest('Building workout…');
  send(MESSAGE_TYPES.GET_DAY_PLAN, {
    programId: selectedProgram.id,
    week: week.number,
    day: day.number,
  })
    .then((res) => {
      isBusy = false;
      statusMessage = '';
      dayPlan = res.payload;
      session = createWorkoutSession({ plan: dayPlan });
      sessionStore.clear();
      finishState = null;
      isOverviewOpen = false;
      overviewPage = 0;
      screen = SCREEN.SESSION;
      renderUI();
    })
    .catch(failRequest);
}

function submitWorkout() {
  const view = session.view();
  finishState = { status: 'SENDING', message: 'Saving to Liftosaur…' };
  renderUI();

  send(MESSAGE_TYPES.FINISH_WORKOUT, {
    programId: dayPlan.programId,
    programVersion: dayPlan.programVersion,
    week: dayPlan.week,
    day: dayPlan.dayInWeek,
    completedSets: session.getCompletedSets(),
    startedAt: view.startedAt,
    durationSeconds: view.elapsedSeconds,
  })
    .then((res) => {
      const payload = res.payload || {};
      finishState = {
        status: payload.status || 'SAVED',
        message:
          payload.status === 'HISTORY_SAVED_PROGRAM_CONFLICT'
            ? 'Saved. Program changed on Liftosaur, progression not written.'
            : payload.status === 'BASE_PROGRAM_UNAVAILABLE'
              ? 'Program changed on Liftosaur. Nothing saved - pick the day again.'
              : payload.programUpdated
                ? 'Saved and progression updated'
                : 'Saved to Liftosaur',
      };
      if (payload.status !== 'BASE_PROGRAM_UNAVAILABLE') {
        sessionStore.clear();
      }
      renderUI();
    })
    .catch((err) => {
      finishState = { status: 'FAILED', message: err?.message || 'Save failed - retry' };
      renderUI();
    });
}

function abandonWorkout() {
  const view = session.view();
  // startedAt identifies the live record the Side Service must delete.
  send(MESSAGE_TYPES.ABANDON_WORKOUT, {
    dayName: view.dayName,
    startedAt: view.startedAt,
    abandonedAt: Date.now(),
  }).catch((err) => console.log('[liftosaur] abandon notify failed:', err?.message));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function persistSession() {
  if (!dayPlan) return;
  sessionStore.save({
    plan: dayPlan,
    journal: session.getJournal(),
    startedAt: session.view().startedAt,
  });
}

/** Persist first, render second. The account is written once, at finish. */
function persistAndRender(action) {
  if (action) {
    action();
    persistSession();
  }
  renderUI();
}

/**
 * Brings back a session the app was killed in the middle of. The plan is stored
 * with the journal, so the exercises, targets and history record are all
 * restored - no network needed to carry on lifting.
 */
function restoreSession() {
  const snapshot = sessionStore.load();
  if (!snapshot) return false;

  try {
    dayPlan = snapshot.plan;
    session = createWorkoutSession({ plan: snapshot.plan, initialJournal: snapshot.journal });
  } catch (err) {
    console.log('[liftosaur] could not resume session:', err?.message || String(err));
    sessionStore.clear();
    return false;
  }

  const view = session.view();
  if (view.state === SESSION_STATES.NO_PLAN) {
    sessionStore.clear();
    return false;
  }

  console.log('[liftosaur] resumed session:', view.dayName, view.totalCompletedSetsCount, 'sets');
  screen = SCREEN.SESSION;
  return true;
}

function formatSeconds(sec) {
  const isNeg = sec < 0;
  const abs = Math.abs(sec);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${isNeg ? '-' : ''}${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

function elapsedLabel(view) {
  return formatSeconds(view.elapsedSeconds);
}

function formatDots(dots) {
  return dots.map((d) => (d === 'pending' ? '○' : '●')).join(' ');
}

function truncate(str, max) {
  const value = String(str ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function formatWeight(weight, unit) {
  if (weight === null || weight === undefined) return '-';
  return `${weight}${unit === 'lb' ? ' lb' : ' kg'}`;
}

function formatTargetReps(set) {
  if (!set || set.targetReps === null) return '-';
  const range = set.targetRepsMax ? `${set.targetReps}-${set.targetRepsMax}` : `${set.targetReps}`;
  return set.isAmrap ? `${range}+` : range;
}

function formatNextTargetSummary(rest) {
  if (!rest || !rest.nextExerciseName) return 'Last set completed';
  const reps = rest.nextTargetRepsMax
    ? `${rest.nextTargetReps}-${rest.nextTargetRepsMax}`
    : rest.nextTargetReps !== null
      ? `${rest.nextTargetReps}`
      : '-';
  const weight =
    rest.nextTargetWeight !== null
      ? formatWeight(rest.nextTargetWeight, rest.nextUnit)
      : rest.nextTargetWeightPercent
        ? `${rest.nextTargetWeightPercent}%`
        : '-';
  const percentText =
    rest.nextTargetWeight !== null && rest.nextTargetWeightPercent
      ? ` (${rest.nextTargetWeightPercent}%)`
      : '';
  return `${reps} reps · ${weight}${percentText}`;
}

const SUPERSET_COLORS = {
  A: 0x2bdc9b, // Teal / Emerald
  B: 0xffb544, // Orange
  C: 0xa48bfa, // Violet
  D: 0xffd820, // Yellow
  E: 0x60c5ff, // Sky blue
  F: 0xff80aa, // Pink
};

function supersetColor(group) {
  if (!group) return THEME.primaryLight;
  const key = String(group).trim().toUpperCase();
  return SUPERSET_COLORS[key] || THEME.primaryLight;
}

let notesPage = 0;

function formatNotesMarkdown(raw) {
  if (!raw) return 'No notes for this exercise.';
  return String(raw)
    .replace(/\r\n/g, '\n')
    .replace(/^#{1,6}\s+(.*)$/gm, '$1') // remove markdown headers
    .replace(/^[\*\-]\s+(.*)$/gm, '• $1') // list bullets
    .replace(/^\d+\.\s+(.*)$/gm, '• $1') // numbered lists
    .replace(/\*\*(.*?)\*\*/g, '$1') // bold
    .replace(/\*(.*?)\*/g, '$1') // italic
    .replace(/`(.*?)`/g, '$1') // code
    .replace(/\[(.*?)\]\(.*?\)/g, '$1') // links
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function paginateNotes(text, maxCharsPerPage = 70, maxLinesPerPage = 5) {
  const formatted = formatNotesMarkdown(text);
  const visualLines = [];

  for (const line of formatted.split('\n')) {
    if (!line.trim()) {
      visualLines.push('');
      continue;
    }

    let wrapped = '';
    for (const word of line.split(' ')) {
      const candidate = wrapped ? `${wrapped} ${word}` : word;
      if (candidate.length > 28 && wrapped) {
        visualLines.push(wrapped);
        wrapped = word;
      } else {
        wrapped = candidate;
      }
    }
    if (wrapped) visualLines.push(wrapped);
  }

  const pages = [];
  let pageLines = [];
  for (const line of visualLines) {
    const candidate = [...pageLines, line].join('\n').trim();
    if (pageLines.length >= maxLinesPerPage || (candidate.length > maxCharsPerPage && pageLines.length > 0)) {
      pages.push(pageLines.join('\n').trim());
      pageLines = [];
    }
    pageLines.push(line);
  }
  if (pageLines.length > 0) pages.push(pageLines.join('\n').trim());
  return pages.length > 0 ? pages : [formatted];
}

function closeTextModal() {
  isNotesModalOpen = false;
  notesPage = 0;
  renderUI();
}

function moveNotesPage(delta) {
  const pages = paginateNotes(activeNotesContent);
  const totalPages = pages.length;
  notesPage = (notesPage + delta + totalPages) % totalPages;
  updateLiveWidget('modal-content', { text: pages[notesPage] || 'No notes for this exercise.' });
  updateLiveWidget('modal-page', { text: `${notesPage + 1}/${totalPages}` });
  redraw();
}

function renderNotesModal() {
  const pages = paginateNotes(activeNotesContent);
  const totalPages = pages.length;
  if (notesPage >= totalPages) notesPage = totalPages - 1;
  if (notesPage < 0) notesPage = 0;

  addWidget(widget.FILL_RECT, {
    x: px(40),
    y: px(40),
    w: px(400),
    h: px(400),
    radius: px(24),
    color: THEME.card,
  });

  addWidget(widget.TEXT, {
    x: px(56),
    y: px(52),
    w: px(368),
    h: px(28),
    color: THEME.textPrimary,
    text_size: font('title'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: truncate(activeNotesTitle, 24),
  });

  addLiveLabel('modal-content', {
    x: px(56),
    y: px(88),
    w: px(368),
    h: px(246),
    radius: px(1),
    normal_color: THEME.card,
    press_color: THEME.card,
    color: THEME.textSecondary,
    text_size: font('body'),
    align_h: align.CENTER_H,
    align_v: align.TOP,
    text_style: text_style.WRAP,
    text: pages[notesPage] || 'No notes for this exercise.',
  });

  if (totalPages > 1) {
    addLiveLabel('modal-page', {
      x: px(128),
      y: px(348),
      w: px(38),
      h: px(54),
      radius: px(1),
      normal_color: THEME.card,
      press_color: THEME.card,
      color: THEME.textSecondary,
      text_size: font('micro'),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `${notesPage + 1}/${totalPages}`,
    });

  }

  ensureModalControls(totalPages);
}

function handleGesture(gesture) {
  if (!isNotesModalOpen) return false;
  if (gesture === GESTURE_LEFT) moveNotesPage(1);
  else if (gesture === GESTURE_RIGHT) moveNotesPage(-1);
  else if (gesture === GESTURE_DOWN) closeTextModal();
  return true;
}

function heartRateColor(hrVal) {
  const bpm = parseInt(hrVal, 10);
  if (isNaN(bpm) || bpm <= 0) return THEME.textSecondary;
  if (bpm < 115) return 0xffffff;
  if (bpm < 140) return THEME.success;
  if (bpm < 160) return THEME.yellow;
  if (bpm < 175) return THEME.error;
  return 0xff3333;
}

// ── Rest reminder feedback ───────────────────────────────────────────────────

/** Blinks of the outline, in on/off pairs: 4 x (400 + 200) is 2.4s of flashing. */
const FLASH_BLINKS = 4;
/** How long the ring stays lit, then dark, in ms. */
const FLASH_ON_MS = 400;
const FLASH_OFF_MS = 200;
const FLASH_LINE_WIDTH = Math.max(4, Math.round(W * 0.02));
// `fit()` only kicks in on a square panel, so an identity layout is the round
// 480 canvas the screens were drawn for: there the outline has to be a circle.
const FLASH_RADIUS = LAYOUT.isFitted ? Math.round(W * 0.12) : Math.round(W / 2);

function clearFlash() {
  if (flashTimer) {
    clearTimeout(flashTimer);
    flashTimer = null;
  }
  if (flashWidget) {
    try {
      deleteWidget(flashWidget);
    } catch (e) {
      // Already torn down by the runtime.
    }
    flashWidget = null;
  }
}

/**
 * Pulses a ring along the bezel to back up the reminder vibration, for when the
 * watch is on the bench rather than on the wrist. The widget is deliberately
 * kept out of `activeWidgets`: it outlives no render, it just draws on top of
 * whatever screen is up and removes itself.
 */
function flashScreenEdge() {
  try {
    clearFlash();
    let remaining = FLASH_BLINKS * 2;
    const step = () => {
      flashTimer = null;
      let lit;
      if (flashWidget) {
        try {
          deleteWidget(flashWidget);
        } catch (e) {
          // Already torn down by the runtime.
        }
        flashWidget = null;
        lit = false;
      } else {
        flashWidget = createWidget(widget.STROKE_RECT, {
          x: 1,
          y: 1,
          w: W - 2,
          h: H - 2,
          radius: FLASH_RADIUS,
          line_width: FLASH_LINE_WIDTH,
          color: THEME.primary,
        });
        lit = true;
      }
      remaining -= 1;
      if (remaining > 0) flashTimer = setTimeout(step, lit ? FLASH_ON_MS : FLASH_OFF_MS);
    };
    step();
  } catch (err) {
    console.log('[liftosaur] flash error:', err?.message || String(err));
    flashWidget = null;
  }
}

/**
 * How long the motor runs for the nth reminder of a rest period, in ms: the set
 * is over and being ignored, so each nudge is harder to miss than the last.
 * Capped, past which it reads as a malfunction rather than a reminder.
 */
const VIBRATION_MS = [700, 1200, 1800];
const VIBRATION_MS_STEP = 600;
const VIBRATION_MS_MAX = 4000;

function vibrationDuration(index) {
  if (index < VIBRATION_MS.length) return VIBRATION_MS[index];
  const extra = (index - VIBRATION_MS.length + 1) * VIBRATION_MS_STEP;
  return Math.min(VIBRATION_MS[VIBRATION_MS.length - 1] + extra, VIBRATION_MS_MAX);
}

function stopVibration() {
  if (vibrationTimer) {
    clearTimeout(vibrationTimer);
    vibrationTimer = null;
  }
  try {
    if (vibrator) vibrator.stop();
  } catch (err) {
    console.log('[liftosaur] vibrator stop error:', err?.message || String(err));
  }
}

/**
 * `VIBRATOR_SCENE_DURATION` runs the motor until `stop()`, which is what makes
 * the length controllable here. The setter is called both ways because the
 * documented example passes the bare constant while the typings ask for an
 * option object, and which one a given firmware accepts is not worth guessing.
 */
function setVibrationDurationMode() {
  try {
    vibrator.setMode(VIBRATOR_SCENE_DURATION);
    return;
  } catch (e) {
    // Older/newer signature, try the object form below.
  }
  try {
    vibrator.setMode({ mode: VIBRATOR_SCENE_DURATION });
  } catch (err) {
    console.log('[liftosaur] vibrator mode error:', err?.message || String(err));
  }
}

function triggerVibration(index = 0) {
  const duration = vibrationDuration(index);
  try {
    stopVibration();
    if (!vibrator) {
      vibrator = new Vibrator();
      setVibrationDurationMode();
    }
    vibrator.start();
    vibrationTimer = setTimeout(() => {
      vibrationTimer = null;
      stopVibration();
    }, duration);
  } catch (err) {
    console.log('[liftosaur] vibrator error:', err?.message || String(err));
  }
  flashScreenEdge();
}

// ── Shared chrome ────────────────────────────────────────────────────────────

function renderTitle(text, color = THEME.primaryLight) {
  addWidget(widget.TEXT, {
    x: px(60),
    y: px(38),
    w: px(360),
    h: px(32),
    color,
    text_size: font('title'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text,
  });
}

/**
 * The subtitle slot doubles as the error slot: the bottom of a round screen is
 * too narrow for a banner, and an error here sits where the user is looking.
 */
function renderSubtitle(text, { isError = false } = {}) {
  addWidget(widget.TEXT, {
    x: px(60),
    y: px(68),
    w: px(360),
    h: px(28),
    color: isError ? THEME.error : THEME.textSecondary,
    text_size: font('caption'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: truncate(text, 44),
  });
}

/** Design row of the clock line: the last one inside `DESIGN_BOX`. */
const CLOCK_Y = 442;

/**
 * Watch time in the user's own setting. `getFormatHour()` already applies the
 * 12h/24h choice; the constant is only needed to know whether a meridiem has
 * to be appended, and when it cannot be resolved the bare hour is shown rather
 * than a guessed AM/PM.
 */
function currentClockLabel() {
  if (!timeSensor) return '';
  try {
    const minutes = timeSensor.getMinutes();
    const mm = minutes < 10 ? `0${minutes}` : String(minutes);
    const hour = timeSensor.getFormatHour();
    const is12h =
      typeof TIME_HOUR_FORMAT_12 === 'number' && timeSensor.getHourFormat() === TIME_HOUR_FORMAT_12;
    if (is12h) return `${hour}:${mm} ${timeSensor.getHours() < 12 ? 'AM' : 'PM'}`;
    return `${hour < 10 ? `0${hour}` : hour}:${mm}`;
  } catch (err) {
    // One failure is enough: the clock is decoration, and a per-second log is not.
    console.log('[liftosaur] clock unavailable:', err?.message || String(err));
    timeSensor = null;
    return '';
  }
}

/**
 * The time of day, under the bottom button of every screen.
 *
 * The app holds the screen on for a whole workout, so the watch face is out of
 * reach for as long as the session lasts. This line gives it back without ever
 * competing with the countdown: smallest type on the screen, dimmest colour,
 * and the one row of the design box no button ever occupies.
 */
function renderClock() {
  const label = currentClockLabel();
  if (!label) return;
  lastRenderedClock = label;
  addLiveLabel('clock', {
    x: px(160),
    y: px(CLOCK_Y),
    w: px(160),
    h: px(20),
    color: THEME.textSecondary,
    text_size: font('micro'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: label,
  });
}

function renderMarqueeTitle(text, color = THEME.primaryLight) {
  addWidget(widget.BUTTON, {
    x: px(60),
    y: px(38),
    w: px(360),
    h: px(32),
    radius: px(1),
    normal_color: THEME.bg,
    press_color: THEME.bg,
    color,
    text_size: font('title'),
    text: formatMarqueeText(text),
  });
}

function openTextModal(title, content) {
  notesPage = 0;
  isNotesModalOpen = true;
  activeNotesTitle = title;
  activeNotesContent = content;
  renderUI();
}

function renderDemoBadge() {
  const isDemoMode = serviceMode === 'DEMO';
  if (!isDemoMode) return;
  addLiveLabel('demo-badge', {
    x: px(190),
    y: px(8),
    w: px(100),
    h: px(24),
    color: THEME.orange,
    text_size: font('micro'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: 'DEMO',
  });
}

/**
 * Paged list with an optional featured entry on top.
 *
 * The featured entry is the one the account data points at - the active
 * program, the week you are in, the day after the one you last logged. It is
 * shown large and first because it is nearly always the one wanted, but it is
 * still a button: nothing is chosen until it is tapped. Everything else stays
 * one page away below it.
 *
 * Physical scrolling is not assumed to be available on this device, so the
 * remainder pages explicitly.
 */
function renderList({ items, onSelect, onBack, featured = null }) {
  if (featured) {
    addWidget(widget.BUTTON, {
      x: px(62),
      y: px(100),
      w: px(356),
      h: px(88),
      radius: px(22),
      normal_color: THEME.primary,
      press_color: THEME.primaryDeep,
      color: THEME.textPrimary,
      text: `${truncate(featured.title, 20)}\n${featured.label}`,
      text_size: font('title'),
      click_func: featured.onSelect,
    });
  }

  const pageSize = featured ? LIST_PAGE_SIZE - 1 : LIST_PAGE_SIZE;
  const cardH = featured ? px(68) : px(76);
  const cardStep = featured ? px(74) : px(82);
  let y = featured ? px(198) : px(100);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  if (listPage >= totalPages) listPage = totalPages - 1;
  if (listPage < 0) listPage = 0;

  const start = listPage * pageSize;

  items.slice(start, start + pageSize).forEach((item, i) => {
    addWidget(widget.BUTTON, {
      x: px(62),
      y,
      w: px(356),
      h: cardH,
      radius: px(16),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      color: THEME.textPrimary,
      text: item.subtitle ? `${item.title}\n${item.subtitle}` : item.title,
      text_size: item.subtitle ? font('caption') : font('body'),
      click_func: () => onSelect(start + i),
    });
    y += cardStep;
  });

  const pagerY = px(374);

  if (onBack) {
    addWidget(widget.BUTTON, {
      x: px(90),
      y: pagerY,
      w: px(70),
      h: px(52),
      radius: px(26),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      color: THEME.textSecondary,
      text: 'Back',
      text_size: font('caption'),
      click_func: onBack,
    });
  }

  if (totalPages > 1) {
    addWidget(widget.BUTTON, {
      x: px(162),
      y: pagerY,
      w: px(62),
      h: px(52),
      radius: px(26),
      normal_color: THEME.primaryDark,
      press_color: THEME.cardActive,
      text: '‹',
      text_size: font('button'),
      click_func: () => {
        listPage = (listPage - 1 + totalPages) % totalPages;
        renderUI();
      },
    });

    addWidget(widget.TEXT, {
      x: px(228),
      y: pagerY,
      w: px(60),
      h: px(52),
      color: THEME.textSecondary,
      text_size: font('caption'),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `${listPage + 1}/${totalPages}`,
    });

    addWidget(widget.BUTTON, {
      x: px(292),
      y: pagerY,
      w: px(62),
      h: px(52),
      radius: px(26),
      normal_color: THEME.primaryDark,
      press_color: THEME.cardActive,
      text: '›',
      text_size: font('button'),
      click_func: () => {
        listPage = (listPage + 1) % totalPages;
        renderUI();
      },
    });
  }
}

// ── Screen renderers ─────────────────────────────────────────────────────────

function renderSetupScreen() {
  renderTitle('Liftosaur');

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
    text_size: font('title'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: isBusy ? 'Connecting…' : 'Setup required',
  });

  addWidget(widget.TEXT, {
    x: px(80),
    y: px(148),
    w: px(320),
    h: px(150),
    color: THEME.textSecondary,
    text_size: font('body'),
    align_h: align.CENTER_H,
    align_v: align.TOP,
    text_style: text_style.WRAP,
    text: errorMessage
      ? errorMessage
      : 'Add your Liftosaur API key in the Zepp app:\n\nProfile > Apps > Lifto Companion > Settings',
  });

  addWidget(widget.BUTTON, {
    x: px(90),
    y: px(330),
    w: px(300),
    h: px(76),
    radius: px(38),
    normal_color: THEME.primary,
    press_color: THEME.primaryDeep,
    text: isBusy ? 'Checking…' : 'Retry',
    text_size: font('title'),
    click_func: loadPrograms,
  });
}

function renderConnectionScreen() {
  renderMarqueeTitle('Phone connection needed', THEME.orange);

  addWidget(widget.FILL_RECT, {
    x: px(60),
    y: px(110),
    w: px(360),
    h: px(150),
    radius: px(20),
    color: THEME.card,
  });

  addWidget(widget.TEXT, {
    x: px(82),
    y: px(132),
    w: px(316),
    h: px(108),
    color: THEME.textSecondary,
    text_size: font('body'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.WRAP,
    text: 'Open Zepp on your phone, then tap Retry.',
  });

  addWidget(widget.BUTTON, {
    x: px(90),
    y: px(300),
    w: px(300),
    h: px(76),
    radius: px(38),
    normal_color: THEME.primary,
    press_color: THEME.primaryDeep,
    text: 'Retry',
    text_size: font('title'),
    click_func: loadPrograms,
  });
}

/**
 * One tap to carry on. The button names the day it will start, so the shortcut
 * is never a mystery, and the second button opens the full choice.
 */
function renderHomeScreen() {
  const start = suggestedStart(outline.weeks, outline.lastWorkout);

  if (!start) {
    screen = SCREEN.WEEKS;
    return renderWeeksScreen();
  }

  renderMarqueeTitle(outline.programName || 'Liftosaur');
  renderSubtitle(errorMessage || 'Next workout', { isError: Boolean(errorMessage) });

  const openWorkout = () => loadDayPlan(start.week, start.day);

  addWidget(widget.BUTTON, {
    x: px(62),
    y: px(100),
    w: px(356),
    h: px(148),
    radius: px(32),
    normal_color: THEME.primary,
    press_color: THEME.primaryDeep,
    color: THEME.textPrimary,
    text: '',
    click_func: openWorkout,
  });

  addWidget(widget.BUTTON, {
    x: px(74),
    y: px(112),
    w: px(332),
    h: px(54),
    radius: px(1),
    normal_color: THEME.primary,
    press_color: THEME.primary,
    color: THEME.textPrimary,
    text: formatWorkoutPosition(start.week.number, start.day.number),
    text_size: font('title'),
    click_func: openWorkout,
  });

  addWidget(widget.BUTTON, {
    x: px(74),
    y: px(172),
    w: px(332),
    h: px(60),
    radius: px(1),
    normal_color: THEME.primary,
    press_color: THEME.primary,
    color: THEME.textPrimary,
    text: formatMarqueeText(start.day.name),
    text_size: font('title'),
    click_func: openWorkout,
  });

  addWidget(widget.BUTTON, {
    x: px(84),
    y: px(260),
    w: px(312),
    h: px(56),
    radius: px(28),
    normal_color: THEME.card,
    press_color: THEME.cardActive,
    color: THEME.textSecondary,
    text: 'Another day',
    text_size: font('button'),
    click_func: () => {
      listPage = 0;
      screen = SCREEN.WEEKS;
      renderUI();
    },
  });

  addWidget(widget.BUTTON, {
    x: px(84),
    y: px(324),
    w: px(312),
    h: px(56),
    radius: px(28),
    normal_color: THEME.card,
    press_color: THEME.cardActive,
    color: THEME.textSecondary,
    text: 'Another program',
    text_size: font('button'),
    click_func: () => {
      listPage = 0;
      screen = SCREEN.PROGRAMS;
      renderUI();
    },
  });

  const last = outline.lastWorkout;
  addWidget(widget.TEXT, {
    x: px(74),
    y: px(388),
    w: px(332),
    h: px(40),
    color: THEME.textSecondary,
    text_size: font('micro'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.WRAP,
    text: last && last.dayName ? `Last: ${truncate(last.dayName, 30)}` : 'No workout recorded yet',
  });
}

function renderProgramsScreen() {
  renderTitle('Choose a program');
  renderSubtitle(
    errorMessage || `${programs.length} program${programs.length === 1 ? '' : 's'}`,
    { isError: Boolean(errorMessage) }
  );

  const featuredIndex = suggestedProgramIndex(programs);
  const rest = withoutIndex(programs, featuredIndex);

  renderList({
    featured:
      featuredIndex === -1
        ? null
        : {
            title: programs[featuredIndex].name,
            label: 'Active in Liftosaur',
            onSelect: () => loadOutline(programs[featuredIndex]),
          },
    items: rest.map((program) => ({ title: truncate(program.name, 22), subtitle: null })),
    onSelect: (index) => loadOutline(rest[index]),
    onBack: outline
      ? () => {
          listPage = 0;
          screen = SCREEN.HOME;
          renderUI();
        }
      : null,
  });
}

function renderWeeksScreen() {
  renderTitle(truncate(outline.programName || 'Program', 24));

  const last = outline.lastWorkout;
  renderSubtitle(
    errorMessage ||
      (last && last.week
        ? `Last: week ${last.week} · day ${last.dayInWeek}`
        : 'No workout recorded yet'),
    { isError: Boolean(errorMessage) }
  );

  const openWeek = (week) => {
    selectedWeek = week;
    listPage = 0;
    screen = SCREEN.DAYS;
    renderUI();
  };

  const weekLabel = (week) => truncate(week.name || `Week ${week.number}`, 22);
  const featuredIndex = suggestedWeekIndex(outline.weeks, last);
  const rest = withoutIndex(outline.weeks, featuredIndex);

  renderList({
    featured:
      featuredIndex === -1
        ? null
        : {
            title: weekLabel(outline.weeks[featuredIndex]),
            label: 'Where you left off',
            onSelect: () => openWeek(outline.weeks[featuredIndex]),
          },
    items: rest.map((week) => ({
      title: weekLabel(week),
      subtitle: `${week.days.length} day${week.days.length === 1 ? '' : 's'}`,
    })),
    onSelect: (index) => openWeek(rest[index]),
    onBack: () => {
      listPage = 0;
      screen = SCREEN.PROGRAMS;
      renderUI();
    },
  });
}

function renderDaysScreen() {
  renderTitle(truncate(selectedWeek.name || `Week ${selectedWeek.number}`, 24));
  renderSubtitle(errorMessage || 'Choose a day', { isError: Boolean(errorMessage) });

  const featuredIndex = suggestedDayIndex(selectedWeek, outline.lastWorkout);
  const rest = withoutIndex(selectedWeek.days, featuredIndex);

  renderList({
    featured:
      featuredIndex === -1
        ? null
        : {
            title: selectedWeek.days[featuredIndex].name,
            label: 'Next up',
            onSelect: () => loadDayPlan(selectedWeek, selectedWeek.days[featuredIndex]),
          },
    items: rest.map((day) => ({ title: truncate(day.name, 24), subtitle: null })),
    onSelect: (index) => loadDayPlan(selectedWeek, rest[index]),
    onBack: () => {
      listPage = 0;
      screen = SCREEN.WEEKS;
      renderUI();
    },
  });
}

function renderReadyScreen(view) {
  renderTitle(formatWorkoutPosition(view.week, view.dayInWeek));
  renderSubtitle(truncate(view.programName || '', 30));

  addWidget(widget.FILL_RECT, {
    x: px(62),
    y: px(104),
    w: px(356),
    h: px(196),
    radius: px(20),
    color: THEME.card,
  });

  const visibleExercises = view.overviewExercises.slice(0, READY_PREVIEW_SIZE);
  const fullPreview = view.overviewExercises
    .map((ex) => `${ex.name}\n${ex.prescriptionSummary}`)
    .join('\n\n');

  if (visibleExercises.length === 0) {
    addWidget(widget.TEXT, {
      x: px(78),
      y: px(118),
      w: px(324),
      h: px(54),
      color: THEME.textPrimary,
      text_size: font('caption'),
      align_h: align.LEFT,
      align_v: align.TOP,
      text_style: text_style.WRAP,
      text: 'This day has no exercises',
    });
  }

  visibleExercises.forEach((exercise, index) => {
    addWidget(widget.TEXT, {
      x: px(78),
      y: px(108 + index * 66),
      w: px(324),
      h: px(64),
      color: THEME.textPrimary,
      text_size: font('caption'),
      align_h: align.LEFT,
      align_v: align.TOP,
      text_style: text_style.WRAP,
      text: `${truncate(exercise.name, 20)}\n${exercise.prescriptionSummary}`,
    });
  });

  if (view.totalExercises > READY_PREVIEW_SIZE) {
    addWidget(widget.BUTTON, {
      x: px(78),
      y: px(244),
      w: px(180),
      h: px(44),
      radius: px(16),
      normal_color: THEME.cardActive,
      press_color: THEME.primaryDark,
      color: THEME.primaryPale,
      text: `+ ${view.totalExercises - READY_PREVIEW_SIZE} more`,
      text_size: font('caption'),
      click_func: () => openTextModal('Exercises', fullPreview),
    });
  }

  addWidget(widget.TEXT, {
    x: px(62),
    y: px(306),
    w: px(356),
    h: px(24),
    color: THEME.textSecondary,
    text_size: font('caption'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: `${view.totalExercises} exercises · week ${view.week} day ${view.dayInWeek}`,
  });

  addWidget(widget.BUTTON, {
    x: px(78),
    y: px(338),
    w: px(150),
    h: px(64),
    radius: px(32),
    normal_color: THEME.card,
    press_color: THEME.cardActive,
    color: THEME.textSecondary,
    text: 'Change',
    text_size: font('button'),
    click_func: () => {
      listPage = 0;
      screen = SCREEN.DAYS;
      renderUI();
    },
  });

  addWidget(widget.BUTTON, {
    x: px(240),
    y: px(338),
    w: px(162),
    h: px(64),
    radius: px(32),
    normal_color: view.totalExercises > 0 ? THEME.primary : THEME.card,
    press_color: THEME.primaryDeep,
    text: 'Start',
    text_size: font('title'),
    click_func: () => {
      if (view.totalExercises === 0) return;
      persistAndRender(() => session.startWorkout());
    },
  });
}

function renderTopBar(view, onBack) {
  addWidget(widget.BUTTON, {
    x: px(82),
    y: px(45),
    w: px(52),
    h: px(48),
    radius: px(24),
    normal_color: THEME.card,
    press_color: THEME.cardActive,
    text: '≡',
    text_size: font('button'),
    click_func: onBack,
  });

  addLiveLabel('elapsed', {
    x: px(138),
    y: px(45),
    w: px(120),
    h: px(40),
    color: THEME.primaryLight,
    text_size: font('button'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: elapsedLabel(view),
  });

  addLiveLabel('hr', {
    x: px(252),
    y: px(45),
    w: px(120),
    h: px(40),
    color: heartRateColor(liveHr),
    text_size: font('button'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: `HR ${liveHr}`,
  });
}

function renderOverviewScreen(view) {
  renderTopBar(view, () => {
    isOverviewOpen = false;
    renderUI();
  });

  const all = view.overviewExercises;
  const totalPages = Math.max(1, Math.ceil(all.length / OVERVIEW_PAGE_SIZE));
  if (overviewPage >= totalPages) overviewPage = totalPages - 1;

  const start = overviewPage * OVERVIEW_PAGE_SIZE;
  let y = px(94);

  all.slice(start, start + OVERVIEW_PAGE_SIZE).forEach((ex, i) => {
    const idx = start + i;
    const isCurrent = idx === view.currentExerciseIndex;
    const ssPrefix = ex.supersetGroup ? `[SS ${ex.supersetGroup}] ` : '';
    const ssColor = ex.supersetGroup ? supersetColor(ex.supersetGroup) : null;
    addWidget(widget.BUTTON, {
      x: px(64),
      y,
      w: px(352),
      h: px(68),
      radius: px(14),
      normal_color: isCurrent ? THEME.primaryDark : THEME.card,
      press_color: THEME.cardActive,
      color: ssColor || (isCurrent ? THEME.primaryPale : THEME.textPrimary),
      text: `${ssPrefix}${truncate(ex.name, 16)}  ${formatDots(ex.setsDots)}\n${ex.prescriptionSummary}`,
      text_size: font('caption'),
      click_func: () => {
        session.selectExercise(idx);
        isOverviewOpen = false;
        persistAndRender();
      },
    });
    y += px(74);
  });

  const actionY = px(324);

  addWidget(widget.BUTTON, {
    x: px(64),
    y: actionY,
    w: px(170),
    h: px(60),
    radius: px(30),
    normal_color: THEME.primary,
    press_color: THEME.primaryDeep,
    text: 'Finish',
    text_size: font('button'),
    click_func: () => {
      isOverviewOpen = false;
      persistAndRender(() => session.finishWorkout());
      submitWorkout();
    },
  });

  addWidget(widget.BUTTON, {
    x: px(246),
    y: actionY,
    w: px(170),
    h: px(60),
    radius: px(30),
    normal_color: 0x3a1a1a,
    press_color: 0x551111,
    color: THEME.error,
    text: 'Discard',
    text_size: font('button'),
    click_func: () => {
      isOverviewOpen = false;
      abandonWorkout();
      sessionStore.clear();
      session.cancelWorkout();
      screen = outline ? SCREEN.HOME : SCREEN.PROGRAMS;
      listPage = 0;
      renderUI();
    },
  });

  if (totalPages > 1) {
    addWidget(widget.BUTTON, {
      x: px(162),
      y: px(398),
      w: px(62),
      h: px(44),
      radius: px(22),
      normal_color: THEME.primaryDark,
      press_color: THEME.cardActive,
      text: '‹',
      text_size: font('button'),
      click_func: () => {
        overviewPage = (overviewPage - 1 + totalPages) % totalPages;
        renderUI();
      },
    });

    addWidget(widget.TEXT, {
      x: px(228),
      y: px(398),
      w: px(60),
      h: px(44),
      color: THEME.textSecondary,
      text_size: font('micro'),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `${overviewPage + 1}/${totalPages}`,
    });

    addWidget(widget.BUTTON, {
      x: px(292),
      y: px(398),
      w: px(62),
      h: px(44),
      radius: px(22),
      normal_color: THEME.primaryDark,
      press_color: THEME.cardActive,
      text: '›',
      text_size: font('button'),
      click_func: () => {
        overviewPage = (overviewPage + 1) % totalPages;
        renderUI();
      },
    });
  }
}

function renderActiveSetScreen(view) {
  const isResting = view.state === SESSION_STATES.REST && view.rest;

  // While resting this screen is "Prepare": it shows and edits the set about to
  // be performed, which may belong to the next exercise of a superset.
  const pending = view.pending;
  const set = (isResting && pending ? pending.set : null) || view.currentSet;
  const exerciseName = isResting && pending ? pending.exerciseName : view.exerciseName;
  const exerciseNotes = isResting && pending ? pending.exerciseNotes : view.exerciseNotes;
  const supersetGroup = isResting && pending ? pending.supersetGroup : view.supersetGroup;
  const setsDots = isResting && pending ? pending.setsDots : view.exerciseSetsDots;
  const setIndex = isResting && pending ? pending.setIndex : view.currentSetIndex;
  const totalSets = isResting && pending ? pending.totalSets : view.totalSets;
  const controls = activeSetLayout(set);

  if (isResting) {
    const bannerColor = view.rest.isOvertime
      ? THEME.error
      : (view.rest.isPaused ? THEME.yellow : THEME.primaryPale);

    addWidget(widget.BUTTON, {
      x: px(82),
      y: px(42),
      w: px(44),
      h: px(40),
      radius: px(20),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: '≡',
      text_size: font('button'),
      click_func: () => {
        isOverviewOpen = true;
        renderUI();
      },
    });

    addLiveButton('restBannerText', {
      x: px(134),
      y: px(42),
      w: px(264),
      h: px(40),
      radius: px(20),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      color: bannerColor,
      text_size: font('caption'),
      text: `Rest ${formatSeconds(view.rest.remaining)}`,
      click_func: () => {
        isRestMinimized = false;
        renderUI();
      },
    });
  } else {
    renderTopBar(view, () => {
      isOverviewOpen = true;
      renderUI();
    });
  }

  addWidget(widget.TEXT, {
    x: px(62),
    y: px(92),
    w: exerciseNotes ? px(306) : px(356),
    h: px(30),
    color: THEME.textPrimary,
    text_size: font('title'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: truncate(exerciseName, 22),
  });

  if (exerciseNotes) {
    addWidget(widget.BUTTON, {
      x: px(344),
      y: px(84),
      w: px(74),
      h: px(40),
      radius: px(20),
      normal_color: THEME.cardActive,
      press_color: THEME.card,
      color: THEME.primaryLight,
      text: 'Info',
      text_size: font('caption'),
      click_func: () => openTextModal('Exercise details', `${exerciseName}\n\n${exerciseNotes}`),
    });
  }

  const ssColor = supersetColor(supersetGroup);
  const ssBadge = supersetGroup ? ` (SS ${supersetGroup})` : '';

  const setLabel = set.isWarmup
    ? `WARMUP ${set.warmupIndex}/${set.totalWarmups}${ssBadge}`
    : `SET ${set.workSetIndex || setIndex + 1}/${set.totalWorkSets || totalSets}${ssBadge}`;

  addWidget(widget.TEXT, {
    x: px(62),
    y: px(122),
    w: px(356),
    h: px(26),
    color: set.isWarmup ? 0xffb544 : (supersetGroup ? ssColor : THEME.textSecondary),
    text_size: font('caption'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: `${setLabel}   ${formatDots(setsDots)}`,
  });

  let targetText;
  if (set.isWarmup) {
    if (set.targetWeight !== null) {
      targetText = `Warmup Target: ${formatTargetReps(set)} × ${formatWeight(set.targetWeight, view.unit)}${
        set.targetWeightPercent ? ` (${set.targetWeightPercent}%)` : ''
      }`;
    } else {
      targetText = `Warmup Target: ${formatTargetReps(set)} × ${
        set.targetWeightPercent ? `${set.targetWeightPercent}%` : '-'
      }`;
    }
  } else {
    targetText = `Target ${formatTargetReps(set)} × ${formatWeight(set.targetWeight, view.unit)}${
      set.targetRpe !== null ? ` @${set.targetRpe}` : ''
    }`;
  }

  addWidget(widget.TEXT, {
    x: px(62),
    y: px(146),
    w: px(356),
    h: px(22),
    color: THEME.textSecondary,
    text_size: font('micro'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: targetText,
  });

  // Weight stepper
  renderStepper({
    y: px(controls.rows[0].y),
    height: px(controls.rowHeight),
    label: view.unit.toUpperCase(),
    value: set.weight === null ? '-' : String(set.weight),
    onMinus: () => persistAndRender(() => session.adjustWeight(-1)),
    onPlus: () => persistAndRender(() => session.adjustWeight(1)),
  });

  // Reps stepper
  renderStepper({
    y: px(controls.rows[1].y),
    height: px(controls.rowHeight),
    label: 'REPS',
    value: set.reps === null ? '-' : String(set.reps),
    onMinus: () => persistAndRender(() => session.adjustReps(-1)),
    onPlus: () => persistAndRender(() => session.adjustReps(1)),
  });

  if (controls.showRpe) {
    renderStepper({
      y: px(controls.rows[2].y),
      height: px(controls.rowHeight),
      label: 'RPE',
      value: set.rpe === null ? '-' : String(set.rpe),
      onMinus: () => persistAndRender(() => session.adjustRpe(-0.5)),
      onPlus: () => persistAndRender(() => session.adjustRpe(0.5)),
    });
  }

  addWidget(widget.BUTTON, {
    x: px(120),
    y: px(controls.actionY),
    w: px(240),
    h: px(controls.actionHeight),
    radius: px(controls.actionHeight / 2),
    normal_color: THEME.success,
    press_color: 0x1c9c6d,
    color: 0x00281c,
    text: isResting ? 'Start set' : 'Done',
    text_size: font('title'),
    click_func: () => {
      lastVibratedOvertimeStep = -1;
      if (isResting) {
        isRestMinimized = false;
        persistAndRender(() => session.nextSet());
      } else {
        persistAndRender(() => session.completeSet());
        if (session.view().state === SESSION_STATES.FINISHED) {
          submitWorkout();
        }
      }
    },
  });
}

function renderStepper({ y, height, label, value, onMinus, onPlus }) {
  const buttonSize = height;
  addWidget(widget.BUTTON, {
    x: px(74),
    y,
    w: buttonSize,
    h: buttonSize,
    radius: buttonSize / 2,
    normal_color: THEME.card,
    press_color: THEME.cardActive,
    text: '−',
    text_size: font('value'),
    click_func: onMinus,
  });

  addWidget(widget.TEXT, {
    x: px(142),
    y,
    w: px(196),
    h: height - px(24),
    color: THEME.textPrimary,
    text_size: font('value'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: value,
  });

  addWidget(widget.TEXT, {
    x: px(142),
    y: y + height - px(28),
    w: px(196),
    h: px(24),
    color: THEME.textSecondary,
    text_size: font('micro'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: label,
  });

  addWidget(widget.BUTTON, {
    x: px(406) - buttonSize,
    y,
    w: buttonSize,
    h: buttonSize,
    radius: buttonSize / 2,
    normal_color: THEME.card,
    press_color: THEME.cardActive,
    text: '+',
    text_size: font('value'),
    click_func: onPlus,
  });
}

function renderRestScreen(view) {
  const rest = view.rest;
  renderTopBar(view, () => {
    isOverviewOpen = true;
    renderUI();
  });

  const restColor = rest.isOvertime
    ? THEME.error
    : (rest.isPaused ? THEME.yellow : THEME.primaryPale);
  const labelColor = rest.isOvertime
    ? THEME.error
    : (rest.isPaused ? THEME.yellow : THEME.textSecondary);
  const labelText = rest.isPaused
    ? 'Paused'
    : (rest.isOvertime ? 'Overtime' : 'Rest');

  addLiveLabel('restLabel', {
    x: px(62),
    y: px(90),
    w: px(356),
    h: px(28),
    color: labelColor,
    text_size: font('body'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: labelText,
  });

  addLiveLabel('restValue', {
    x: px(62),
    y: px(118),
    w: px(356),
    h: px(64),
    color: restColor,
    text_size: font('timer'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: formatSeconds(rest.remaining),
  });

  // Quick timer controls: -10s, Pause/Resume, +10s
  addWidget(widget.BUTTON, {
    x: px(64),
    y: px(186),
    w: px(94),
    h: px(44),
    radius: px(22),
    normal_color: THEME.card,
    press_color: THEME.cardActive,
    text: '-10s',
    text_size: font('caption'),
    click_func: () => {
      persistAndRender(() => session.adjustRest(-10));
    },
  });

  addWidget(widget.BUTTON, {
    x: px(172),
    y: px(186),
    w: px(136),
    h: px(44),
    radius: px(22),
    normal_color: rest.isPaused ? THEME.yellow : THEME.card,
    press_color: THEME.cardActive,
    color: rest.isPaused ? 0x000000 : THEME.textPrimary,
    text: rest.isPaused ? 'Resume' : 'Pause',
    text_size: font('caption'),
    click_func: () => {
      persistAndRender(() => session.toggleRestPause());
    },
  });

  addWidget(widget.BUTTON, {
    x: px(322),
    y: px(186),
    w: px(94),
    h: px(44),
    radius: px(22),
    normal_color: THEME.card,
    press_color: THEME.cardActive,
    text: '+10s',
    text_size: font('caption'),
    click_func: () => {
      persistAndRender(() => session.adjustRest(10));
    },
  });

  // Next Set Preview Card
  if (rest.nextExerciseName) {
    const ssColor = supersetColor(rest.nextSupersetGroup);
    const ssText = rest.nextSupersetGroup ? ` (SS ${rest.nextSupersetGroup})` : '';
    const setProg = rest.nextIsWarmup
      ? `WARMUP ${(rest.nextWarmupIndex ?? (rest.nextSetIndex ?? 0) + 1)}/${rest.nextTotalWarmups || rest.nextTotalSets}${ssText}`
      : `SET ${(rest.nextWorkSetIndex ?? (rest.nextSetIndex ?? 0) + 1)}/${rest.nextTotalWorkSets || rest.nextTotalSets}${ssText}`;

    addWidget(widget.FILL_RECT, {
      x: px(52),
      y: px(238),
      w: px(376),
      h: px(116),
      radius: px(18),
      color: THEME.card,
    });

    addWidget(widget.TEXT, {
      x: px(60),
      y: px(244),
      w: rest.nextExerciseNotes ? px(300) : px(360),
      h: px(26),
      color: THEME.textPrimary,
      text_size: font('body'),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `Next: ${truncate(rest.nextExerciseName, 20)}`,
    });

    if (rest.nextExerciseNotes) {
      addWidget(widget.BUTTON, {
        x: px(342),
        y: px(238),
        w: px(72),
        h: px(38),
        radius: px(19),
        normal_color: THEME.cardActive,
        press_color: THEME.card,
        color: THEME.primaryLight,
        text: 'Info',
        text_size: font('caption'),
        click_func: () => openTextModal('Exercise details', `${rest.nextExerciseName}\n\n${rest.nextExerciseNotes}`),
      });
    }

    addWidget(widget.TEXT, {
      x: px(60),
      y: px(270),
      w: px(360),
      h: px(22),
      color: rest.nextIsWarmup ? 0xffb544 : (rest.nextSupersetGroup ? ssColor : THEME.primaryLight),
      text_size: font('micro'),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: setProg,
    });

    addWidget(widget.TEXT, {
      x: px(60),
      y: px(294),
      w: px(360),
      h: px(32),
      color: THEME.yellow,
      text_size: font('title'),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: formatNextTargetSummary(rest),
    });

  }

  // Action buttons
  addWidget(widget.BUTTON, {
    x: px(64),
    y: px(364),
    w: px(146),
    h: px(58),
    radius: px(29),
    normal_color: THEME.cardActive,
    press_color: THEME.card,
    text: 'Prepare',
    text_size: font('button'),
    click_func: () => {
      isRestMinimized = true;
      renderUI();
    },
  });

  addWidget(widget.BUTTON, {
    x: px(224),
    y: px(364),
    w: px(192),
    h: px(58),
    radius: px(29),
    normal_color: THEME.primary,
    press_color: THEME.primaryDeep,
    text: 'Start set',
    text_size: font('button'),
    click_func: () => {
      lastVibratedOvertimeStep = -1;
      isRestMinimized = false;
      persistAndRender(() => session.nextSet());
    },
  });
}

function renderFinishedScreen(view) {
  renderTitle('Workout complete', THEME.success);
  renderSubtitle(truncate(view.dayName || '', 30));

  addWidget(widget.FILL_RECT, {
    x: px(62),
    y: px(104),
    w: px(356),
    h: px(150),
    radius: px(20),
    color: THEME.card,
  });

  addWidget(widget.TEXT, {
    x: px(78),
    y: px(118),
    w: px(324),
    h: px(124),
    color: THEME.textPrimary,
    text_size: font('title'),
    align_h: align.CENTER_H,
    align_v: align.TOP,
    text_style: text_style.WRAP,
    text: `${view.totalCompletedSetsCount} sets · ${formatSeconds(view.elapsedSeconds)}\nVolume ${Math.round(
      view.totalVolume
    )} ${view.unit}`,
  });

  const status = finishState || { status: 'IDLE', message: '' };
  const statusColor =
    status.status === 'SAVED'
      ? THEME.success
      : status.status === 'SENDING'
        ? THEME.textSecondary
        : status.status === 'HISTORY_SAVED_PROGRAM_CONFLICT'
          ? THEME.orange
          : THEME.error;

  addWidget(widget.TEXT, {
    x: px(70),
    y: px(262),
    w: px(340),
    h: px(64),
    color: statusColor,
    text_size: font('body'),
    align_h: align.CENTER_H,
    align_v: align.TOP,
    text_style: text_style.WRAP,
    text: status.message,
  });

  const needsRetry = status.status === 'FAILED' || status.status === 'BASE_PROGRAM_UNAVAILABLE';

  addWidget(widget.BUTTON, {
    x: needsRetry ? px(78) : px(120),
    y: px(340),
    w: needsRetry ? px(150) : px(240),
    h: px(66),
    radius: px(33),
    normal_color: THEME.card,
    press_color: THEME.cardActive,
    color: THEME.textSecondary,
    text: 'Done',
    text_size: font('button'),
    click_func: () => {
      sessionStore.clear();
      session = createWorkoutSession({ plan: null });
      dayPlan = null;
      finishState = null;
      listPage = 0;
      // Re-read the outline so the home shortcut points at the day after the
      // one just saved.
      const finishedProgram = programForSavedPlan(selectedProgram, programs, dayPlan);
      if (finishedProgram) {
        loadOutline(finishedProgram, { nextScreen: SCREEN.HOME });
      } else {
        loadPrograms();
      }
    },
  });

  if (needsRetry) {
    addWidget(widget.BUTTON, {
      x: px(240),
      y: px(340),
      w: px(162),
      h: px(66),
      radius: px(33),
      normal_color: THEME.primary,
      press_color: THEME.primaryDeep,
      text: 'Retry',
      text_size: font('button'),
      click_func: submitWorkout,
    });
  }
}

function renderLoadingScreen() {
  renderTitle('Liftosaur');
  addWidget(widget.TEXT, {
    x: px(62),
    y: px(210),
    w: px(356),
    h: px(60),
    color: THEME.textSecondary,
    text_size: font('button'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.WRAP,
    text: statusMessage || 'Connecting to phone…',
  });
}

// ── Root render ──────────────────────────────────────────────────────────────

function renderUI() {
  clearWidgets();
  if (!isNotesModalOpen) hideModalControls();
  // The backdrop is the one widget already in screen pixels: it must cover the
  // whole panel, fitted content included.
  addRawWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: THEME.bg });

  // Decorative text is created first so Zepp never places it above a button's
  // touch target, even on firmware whose widget hit testing ignores z-order.
  renderDemoBadge();
  renderClock();
  renderScreen();
  redraw();
}

function renderScreen() {
  if (isNotesModalOpen) return renderNotesModal();
  if (screen === SCREEN.CONNECTION) return renderConnectionScreen();
  if (screen === SCREEN.SETUP) return renderSetupScreen();
  if (screen === SCREEN.LOADING) return renderLoadingScreen();
  if (screen === SCREEN.HOME) {
    if (isBusy) return renderLoadingScreen();
    return renderHomeScreen();
  }
  if (screen === SCREEN.PROGRAMS) return renderProgramsScreen();
  if (screen === SCREEN.WEEKS) return renderWeeksScreen();
  if (screen === SCREEN.DAYS) {
    if (isBusy) return renderLoadingScreen();
    return renderDaysScreen();
  }

  const view = session.view();

  // A full render resets the tick baseline, so the next tick patches text
  // rather than rebuilding what was just drawn.
  lastRenderedState = view.state;
  lastRenderedSecond = view.rest ? view.rest.remaining : view.elapsedSeconds;

  if (view.state === SESSION_STATES.NO_PLAN) {
    screen = SCREEN.PROGRAMS;
    return renderProgramsScreen();
  }
  if (view.state === SESSION_STATES.READY) return renderReadyScreen(view);
  if (isOverviewOpen && view.state !== SESSION_STATES.FINISHED) return renderOverviewScreen(view);
  if (view.state === SESSION_STATES.ACTIVE_SET) return renderActiveSetScreen(view);
  if (view.state === SESSION_STATES.REST) {
    if (isRestMinimized) return renderActiveSetScreen(view);
    return renderRestScreen(view);
  }
  return renderFinishedScreen(view);
}

// ── Clock ────────────────────────────────────────────────────────────────────

/**
 * The clock changes once a minute, so it is patched in place like the
 * chronometer rather than redrawn: a full rebuild here would restart the
 * countdown skipping this file already had to fix once.
 */
function updateClock() {
  const label = currentClockLabel();
  if (!label || label === lastRenderedClock) return;
  lastRenderedClock = label;
  if (!updateLiveWidget('clock', { text: label })) renderUI();
}

/**
 * Sampled faster than once a second so a tick is never missed, but it only
 * touches the screen when the displayed second actually changes.
 */
function tick() {
  updateClock();

  if (screen !== SCREEN.SESSION) return;

  const view = session.view();

  if (view.state !== lastRenderedState) {
    renderUI();
    return;
  }
  if (view.state !== SESSION_STATES.ACTIVE_SET && view.state !== SESSION_STATES.REST) return;

  if (view.rest && !view.rest.isPaused && view.rest.remaining <= 0) {
    const overtime = -view.rest.remaining;
    // The index is the rank of the reminder within this rest period, which is
    // what makes each buzz longer than the one before it.
    if (overtime >= 0 && lastVibratedOvertimeStep < 0) {
      lastVibratedOvertimeStep = 0;
      triggerVibration(0);
    } else if (overtime >= 30 && lastVibratedOvertimeStep < 30) {
      lastVibratedOvertimeStep = 30;
      triggerVibration(1);
    } else if (overtime >= 60 && lastVibratedOvertimeStep < 60) {
      lastVibratedOvertimeStep = 60;
      triggerVibration(2);
    } else if (overtime >= 120 && overtime >= lastVibratedOvertimeStep + 60) {
      lastVibratedOvertimeStep = Math.floor(overtime / 60) * 60;
      triggerVibration(2 + lastVibratedOvertimeStep / 60 - 1);
    }
  }

  const second = view.rest ? view.rest.remaining : view.elapsedSeconds;
  if (second === lastRenderedSecond) return;
  lastRenderedSecond = second;

  let patched = updateLiveWidget('elapsed', { text: elapsedLabel(view) });
  patched = updateLiveWidget('hr', { text: `HR ${liveHr}`, color: heartRateColor(liveHr) }) && patched;

  if (view.rest) {
    const restColor = view.rest.isOvertime
      ? THEME.error
      : (view.rest.isPaused ? THEME.yellow : THEME.primaryPale);
    const labelColor = view.rest.isOvertime
      ? THEME.error
      : (view.rest.isPaused ? THEME.yellow : THEME.textSecondary);
    const labelText = view.rest.isPaused
      ? 'Paused'
      : (view.rest.isOvertime ? 'Overtime' : 'Rest');

    patched =
      updateLiveWidget('restValue', { text: formatSeconds(view.rest.remaining), color: restColor }) && patched;
    patched =
      updateLiveWidget('restLabel', {
        text: labelText,
        color: labelColor,
      }) && patched;
    patched =
      updateLiveWidget('restBannerText', {
        text: `Rest ${formatSeconds(view.rest.remaining)}`,
        color: restColor,
      }) && patched;
  }

  if (!patched) {
    renderUI();
  }
}

/**
 * Square watches draw a system status bar carrying the app name over the top
 * of the page, which sits on top of our title and of the first row of buttons.
 * `setStatusBarVisible` is documented as square-only, so round watches never
 * reach this and nothing changes for them.
 */
function hideSquareStatusBar() {
  if (!LAYOUT.isFitted) return;
  try {
    hmUI.setStatusBarVisible(false);
  } catch (err) {
    console.log('[liftosaur] status bar stays visible:', err?.message || String(err));
  }
}

function startClock() {
  if (clockTimer) return;
  clockTimer = setInterval(tick, 250);
}

function stopClock() {
  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
  clearFlash();
  stopVibration();
}

Page(
  BasePage({
    onInit() {
      pageInstance = this;
      console.log('[liftosaur] page init');
    },

    build() {
      hideSquareStatusBar();
      onGesture({ callback: handleGesture });

      try {
        setPageBrightTime({ brightTime: 60000 });
        pauseDropWristScreenOff({ duration: 0 });
        pausePalmScreenOff({ duration: 0 });
      } catch (err) {
        console.log('[liftosaur] display hold unavailable:', err?.message || String(err));
      }

      try {
        hrSensor = new HeartRate();
        hrCallback = () => {
          const current = hrSensor.getCurrent();
          if (typeof current === 'number' && current > 0) {
            liveHr = String(current);
          }
        };
        hrSensor.onCurrentChange(hrCallback);
        hrCallback();
      } catch (err) {
        console.log('[liftosaur] heart rate unavailable:', err?.message || String(err));
      }
      if (liveHr === 'N/A') {
        liveHr = '138';
      }

      // An interrupted session wins over the launch flow: it is resumed exactly
      // where it stopped, including the history record it was already writing.
      if (!restoreSession()) {
        loadPrograms();
      }
      renderUI();
      startClock();
    },

    onDestroy() {
      stopClock();
      offGesture();
      try {
        if (hrSensor && hrCallback) hrSensor.offCurrentChange(hrCallback);
      } catch (err) {
        console.log('[liftosaur] hr teardown:', err?.message || String(err));
      }
      try {
        resetPageBrightTime();
        resetDropWristScreenOff();
        resetPalmScreenOff();
      } catch (err) {
        console.log('[liftosaur] display reset:', err?.message || String(err));
      }
      clearWidgets();
      destroyModalControls();
      pageInstance = null;
    },
  })
);
