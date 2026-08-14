import { createWidget, deleteWidget, widget, align, text_style, prop } from '@zos/ui';
import { px } from '@zos/utils';
import { HeartRate, Vibrator } from '@zos/sensor';
import { LocalStorage } from '@zos/storage';
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
import {
  suggestedProgramIndex,
  suggestedWeekIndex,
  suggestedDayIndex,
  suggestedStart,
  withoutIndex,
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

const W = px(480);
const H = px(480);
const LIST_PAGE_SIZE = 4;

// ── Screens ──────────────────────────────────────────────────────────────────
//
// The watch never picks a program or a day on its own. It asks the API for the
// lists and shows them; every selection below is a deliberate tap.

const SCREEN = {
  LOADING: 'LOADING',
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
let selectedProgram = null;
let outline = null;
let selectedWeek = null;
let dayPlan = null;

let session = createWorkoutSession({ plan: null });
let isOverviewOpen = false;
let overviewPage = 0;

/** Live history sync state. */
let liveHistoryId = null;
let syncInFlight = false;
let syncDirty = false;
let syncFailed = false;
let finishState = null; // { status, message }

let liveHr = 'N/A';
let hrSensor = null;
let hrCallback = null;
let vibrator = null;
let hasVibratedThisRest = false;
let clockTimer = null;
let lastRenderedSecond = null;
let lastRenderedState = null;
let activeWidgets = [];

/**
 * Widgets whose text changes every second.
 *
 * Rebuilding the whole screen once a second is what made the countdown skip:
 * tearing down and recreating twenty widgets takes long enough that ticks get
 * dropped. These are patched in place instead. The creation props are kept so
 * an update re-sends the complete property set — a partial `prop.MORE` would
 * clear the geometry.
 */
let liveWidgets = {};

function clearWidgets() {
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

function addWidget(type, props) {
  const w = createWidget(type, props);
  activeWidgets.push(w);
  return w;
}

function addLiveText(key, props) {
  const w = addWidget(widget.TEXT, props);
  liveWidgets[key] = { widget: w, props: { ...props } };
  return w;
}

/** Returns false when the runtime refused the in-place update, so the caller can fall back. */
function updateLiveText(key, changes) {
  const entry = liveWidgets[key];
  if (!entry) return true;
  try {
    Object.assign(entry.props, changes);
    entry.widget.setProperty(prop.MORE, entry.props);
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
      liveHistoryId = null;
      syncFailed = false;
      syncDirty = false;
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
    historyId: liveHistoryId,
  })
    .then((res) => {
      const payload = res.payload || {};
      finishState = {
        status: payload.status || 'SAVED',
        message:
          payload.status === 'HISTORY_SAVED_PROGRAM_CONFLICT'
            ? 'Saved. Program changed on Liftosaur, progression not written.'
            : payload.status === 'BASE_PROGRAM_UNAVAILABLE'
              ? 'Program changed on Liftosaur. Nothing saved — pick the day again.'
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
      finishState = { status: 'FAILED', message: err?.message || 'Save failed — retry' };
      renderUI();
    });
}

function abandonWorkout() {
  const view = session.view();
  // startedAt identifies the live record the Side Service must delete.
  send(MESSAGE_TYPES.ABANDON_WORKOUT, {
    dayName: view.dayName,
    startedAt: view.startedAt,
    historyId: liveHistoryId,
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
    historyId: liveHistoryId,
  });
}

/** Persist first, render second, sync third — a tap never waits on the phone. */
function persistAndRender(action, { sync = false } = {}) {
  if (action) {
    action();
    persistSession();
  }
  renderUI();
  if (sync) syncProgress();
}

/**
 * Pushes the session to the history after every set. Writes are coalesced: a
 * set completed while a write is in flight marks the state dirty and one more
 * write follows, so a fast superset never queues a backlog.
 */
function syncProgress() {
  if (!dayPlan) return;
  if (syncInFlight) {
    syncDirty = true;
    return;
  }

  const view = session.view();
  if (view.totalCompletedSetsCount === 0) return;

  syncInFlight = true;
  renderUI();

  send(MESSAGE_TYPES.SYNC_PROGRESS, {
    programId: dayPlan.programId,
    week: dayPlan.week,
    day: dayPlan.dayInWeek,
    startedAt: view.startedAt,
    durationSeconds: view.elapsedSeconds,
    completedSets: session.getCompletedSets(),
    // The Side Service is not a long-lived process, so the watch carries the
    // two things it cannot be trusted to remember: what the day contains, and
    // which history record this session already owns.
    historyId: liveHistoryId,
    plan: {
      programName: dayPlan.programName,
      dayName: dayPlan.dayName,
      week: dayPlan.week,
      dayInWeek: dayPlan.dayInWeek,
      exercises: dayPlan.exercises.map((exercise) => ({
        index: exercise.index,
        name: exercise.name,
        equipment: exercise.equipment,
      })),
    },
  })
    .then((res) => {
      syncInFlight = false;
      const payload = res.payload || {};

      // `synced: false` used to pass for success, which is exactly how this
      // failed silently. Only "nothing done yet" is a normal negative answer.
      syncFailed = payload.synced === false && payload.reason !== 'NOTHING_DONE';
      if (syncFailed) {
        console.log('[liftosaur] live sync refused:', payload.reason || 'unknown');
      }

      const historyId = payload.historyId;
      if (historyId !== null && historyId !== undefined && historyId !== liveHistoryId) {
        liveHistoryId = historyId;
        persistSession();
      }
      renderUI();
      drainSync();
    })
    .catch((err) => {
      syncInFlight = false;
      syncFailed = true;
      console.log('[liftosaur] live sync failed:', err?.message || String(err));
      renderUI();
      drainSync();
    });
}

function drainSync() {
  if (!syncDirty) return;
  syncDirty = false;
  syncProgress();
}

/**
 * Brings back a session the app was killed in the middle of. The plan is stored
 * with the journal, so the exercises, targets and history record are all
 * restored — no network needed to carry on lifting.
 */
function restoreSession() {
  const snapshot = sessionStore.load();
  if (!snapshot) return false;

  try {
    dayPlan = snapshot.plan;
    session = createWorkoutSession({ plan: snapshot.plan, initialJournal: snapshot.journal });
    liveHistoryId = snapshot.historyId;
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
  // Push whatever was done before the interruption.
  syncProgress();
  return true;
}

function formatSeconds(sec) {
  const isNeg = sec < 0;
  const abs = Math.abs(sec);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${isNeg ? '-' : ''}${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

/** The elapsed clock, flagged when the live history sync is behind. */
function elapsedLabel(view) {
  return `▶ ${formatSeconds(view.elapsedSeconds)}${syncFailed ? ' ⚠' : ''}`;
}

function formatDots(dots) {
  return dots.map((d) => (d === 'pending' ? '○' : '●')).join(' ');
}

function truncate(str, max) {
  const value = String(str ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function formatWeight(weight, unit) {
  if (weight === null || weight === undefined) return '—';
  return `${weight}${unit === 'lb' ? ' lb' : ' kg'}`;
}

function formatTargetReps(set) {
  if (!set || set.targetReps === null) return '—';
  const range = set.targetRepsMax ? `${set.targetReps}-${set.targetRepsMax}` : `${set.targetReps}`;
  return set.isAmrap ? `${range}+` : range;
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

function triggerVibration() {
  try {
    if (!vibrator) vibrator = new Vibrator();
    vibrator.start();
  } catch (err) {
    console.log('[liftosaur] vibrator error:', err?.message || String(err));
  }
}

// ── Shared chrome ────────────────────────────────────────────────────────────

function renderTitle(text, color = THEME.primaryLight) {
  addWidget(widget.TEXT, {
    x: px(60),
    y: px(38),
    w: px(360),
    h: px(32),
    color,
    text_size: px(22),
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
    text_size: px(16),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: truncate(text, 44),
  });
}

/**
 * Paged list with an optional featured entry on top.
 *
 * The featured entry is the one the account data points at — the active
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
      text_size: px(22),
      click_func: featured.onSelect,
    });
  }

  const pageSize = featured ? LIST_PAGE_SIZE - 1 : LIST_PAGE_SIZE;
  const cardH = featured ? px(54) : px(62);
  const cardStep = featured ? px(60) : px(68);
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
      text_size: item.subtitle ? px(17) : px(20),
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
      text_size: px(17),
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
      text_size: px(24),
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
      text_size: px(17),
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
      text_size: px(24),
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
    text_size: px(22),
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
    text_size: px(17),
    align_h: align.CENTER_H,
    align_v: align.TOP,
    text_style: text_style.WRAP,
    text: errorMessage
      ? errorMessage
      : 'Add your Liftosaur API key in the Zepp app:\n\nProfile > Apps > Liftosaur > Settings',
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
    text_size: px(26),
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

  renderTitle(truncate(outline.programName || 'Liftosaur', 26));
  renderSubtitle(errorMessage || 'Next workout', { isError: Boolean(errorMessage) });

  addWidget(widget.BUTTON, {
    x: px(62),
    y: px(100),
    w: px(356),
    h: px(148),
    radius: px(32),
    normal_color: THEME.primary,
    press_color: THEME.primaryDeep,
    color: THEME.textPrimary,
    text: `${truncate(start.day.name, 18)}\n${truncate(start.week.name || `Week ${start.week.number}`, 20)}`,
    text_size: px(26),
    click_func: () => loadDayPlan(start.week, start.day),
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
    text_size: px(20),
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
    text_size: px(20),
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
    color: THEME.textDisabled,
    text_size: px(15),
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
  renderTitle(truncate(view.dayName || 'Workout', 26));
  renderSubtitle(truncate(view.programName || '', 30));

  addWidget(widget.FILL_RECT, {
    x: px(62),
    y: px(104),
    w: px(356),
    h: px(196),
    radius: px(20),
    color: THEME.card,
  });

  const preview = view.overviewExercises
    .slice(0, 5)
    .map((ex) => `${truncate(ex.name, 20)}  ${ex.prescriptionSummary}`)
    .join('\n');

  addWidget(widget.TEXT, {
    x: px(78),
    y: px(118),
    w: px(324),
    h: px(168),
    color: THEME.textPrimary,
    text_size: px(16),
    align_h: align.LEFT,
    align_v: align.TOP,
    text_style: text_style.WRAP,
    text: preview || 'This day has no exercises',
  });

  addWidget(widget.TEXT, {
    x: px(62),
    y: px(306),
    w: px(356),
    h: px(24),
    color: THEME.textDisabled,
    text_size: px(16),
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
    text_size: px(20),
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
    text_size: px(24),
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
    w: px(44),
    h: px(40),
    radius: px(20),
    normal_color: THEME.card,
    press_color: THEME.cardActive,
    text: '≡',
    text_size: px(22),
    click_func: onBack,
  });

  addLiveText('elapsed', {
    x: px(130),
    y: px(45),
    w: px(120),
    h: px(40),
    color: THEME.primaryLight,
    text_size: px(20),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: elapsedLabel(view),
  });

  addLiveText('hr', {
    x: px(252),
    y: px(45),
    w: px(120),
    h: px(40),
    color: heartRateColor(liveHr),
    text_size: px(20),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: `♥ ${liveHr}`,
  });
}

function renderOverviewScreen(view) {
  renderTopBar(view, () => {
    isOverviewOpen = false;
    renderUI();
  });

  const all = view.overviewExercises;
  const totalPages = Math.max(1, Math.ceil(all.length / LIST_PAGE_SIZE));
  if (overviewPage >= totalPages) overviewPage = totalPages - 1;

  const start = overviewPage * LIST_PAGE_SIZE;
  let y = px(94);

  all.slice(start, start + LIST_PAGE_SIZE).forEach((ex, i) => {
    const idx = start + i;
    const isCurrent = idx === view.currentExerciseIndex;
    addWidget(widget.BUTTON, {
      x: px(64),
      y,
      w: px(352),
      h: px(54),
      radius: px(14),
      normal_color: isCurrent ? THEME.primaryDark : THEME.card,
      press_color: THEME.cardActive,
      color: isCurrent ? THEME.primaryPale : THEME.textPrimary,
      text: `${truncate(ex.name, 18)}  ${formatDots(ex.setsDots)}\n${ex.prescriptionSummary}`,
      text_size: px(16),
      click_func: () => {
        session.selectExercise(idx);
        isOverviewOpen = false;
        persistAndRender();
      },
    });
    y += px(60);
  });

  const actionY = px(336);

  // Finishing is blocked only while a write is actually in flight — a second
  // at most. It stays available when a sync has failed, because finishing is
  // itself the authoritative write and therefore the way out of a failed sync,
  // not something to be trapped behind it.
  const isSyncing = syncInFlight;

  addWidget(widget.BUTTON, {
    x: px(64),
    y: actionY,
    w: px(170),
    h: px(54),
    radius: px(27),
    normal_color: isSyncing ? THEME.card : syncFailed ? THEME.orange : THEME.primary,
    press_color: THEME.primaryDeep,
    color: isSyncing ? THEME.textDisabled : THEME.textPrimary,
    text: isSyncing ? 'Saving…' : syncFailed ? 'Finish ⚠' : 'Finish ✓',
    text_size: px(19),
    click_func: () => {
      if (isSyncing) return;
      isOverviewOpen = false;
      persistAndRender(() => session.finishWorkout());
      submitWorkout();
    },
  });

  addWidget(widget.BUTTON, {
    x: px(246),
    y: actionY,
    w: px(170),
    h: px(54),
    radius: px(27),
    normal_color: 0x3a1a1a,
    press_color: 0x551111,
    color: THEME.error,
    text: 'Discard',
    text_size: px(20),
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
      text_size: px(22),
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
      text_size: px(16),
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
      text_size: px(22),
      click_func: () => {
        overviewPage = (overviewPage + 1) % totalPages;
        renderUI();
      },
    });
  }
}

function renderActiveSetScreen(view) {
  const set = view.currentSet;
  renderTopBar(view, () => {
    isOverviewOpen = true;
    renderUI();
  });

  addWidget(widget.TEXT, {
    x: px(62),
    y: px(92),
    w: px(356),
    h: px(30),
    color: THEME.textPrimary,
    text_size: px(22),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: truncate(view.exerciseName, 24),
  });

  addWidget(widget.TEXT, {
    x: px(62),
    y: px(122),
    w: px(356),
    h: px(26),
    color: THEME.textSecondary,
    text_size: px(16),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: `Set ${view.currentSetIndex + 1}/${view.totalSets}   ${formatDots(view.exerciseSetsDots)}`,
  });

  addWidget(widget.TEXT, {
    x: px(62),
    y: px(146),
    w: px(356),
    h: px(22),
    color: THEME.textDisabled,
    text_size: px(15),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: `Target ${formatTargetReps(set)} × ${formatWeight(set.targetWeight, view.unit)}${
      set.targetRpe !== null ? ` @${set.targetRpe}` : ''
    }`,
  });

  // Weight stepper
  renderStepper({
    y: px(170),
    label: view.unit.toUpperCase(),
    value: set.weight === null ? '—' : String(set.weight),
    onMinus: () => persistAndRender(() => session.adjustWeight(-1)),
    onPlus: () => persistAndRender(() => session.adjustWeight(1)),
  });

  // Reps stepper
  renderStepper({
    y: px(236),
    label: 'REPS',
    value: set.reps === null ? '—' : String(set.reps),
    onMinus: () => persistAndRender(() => session.adjustReps(-1)),
    onPlus: () => persistAndRender(() => session.adjustReps(1)),
  });

  // RPE stepper
  renderStepper({
    y: px(302),
    label: 'RPE',
    value: set.rpe === null ? '—' : String(set.rpe),
    onMinus: () => persistAndRender(() => session.adjustRpe(-0.5)),
    onPlus: () => persistAndRender(() => session.adjustRpe(0.5)),
  });

  addWidget(widget.BUTTON, {
    x: px(120),
    y: px(372),
    w: px(240),
    h: px(64),
    radius: px(32),
    normal_color: THEME.success,
    press_color: 0x1c9c6d,
    color: 0x00281c,
    text: 'Done',
    text_size: px(24),
    click_func: () => {
      hasVibratedThisRest = false;
      persistAndRender(() => session.completeSet(), { sync: true });
      if (session.view().state === SESSION_STATES.FINISHED) {
        submitWorkout();
      }
    },
  });
}

function renderStepper({ y, label, value, onMinus, onPlus }) {
  addWidget(widget.BUTTON, {
    x: px(74),
    y,
    w: px(62),
    h: px(62),
    radius: px(31),
    normal_color: THEME.card,
    press_color: THEME.cardActive,
    text: '−',
    text_size: px(28),
    click_func: onMinus,
  });

  addWidget(widget.TEXT, {
    x: px(142),
    y,
    w: px(196),
    h: px(36),
    color: THEME.textPrimary,
    text_size: px(30),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: value,
  });

  addWidget(widget.TEXT, {
    x: px(142),
    y: y + px(34),
    w: px(196),
    h: px(24),
    color: THEME.textMuted,
    text_size: px(14),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: label,
  });

  addWidget(widget.BUTTON, {
    x: px(344),
    y,
    w: px(62),
    h: px(62),
    radius: px(31),
    normal_color: THEME.card,
    press_color: THEME.cardActive,
    text: '+',
    text_size: px(28),
    click_func: onPlus,
  });
}

function renderRestScreen(view) {
  const rest = view.rest;
  renderTopBar(view, () => {
    isOverviewOpen = true;
    renderUI();
  });

  addLiveText('restLabel', {
    x: px(62),
    y: px(110),
    w: px(356),
    h: px(30),
    color: rest.isOvertime ? THEME.error : THEME.textSecondary,
    text_size: px(20),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: rest.isOvertime ? 'Overtime' : 'Rest',
  });

  addLiveText('restValue', {
    x: px(62),
    y: px(150),
    w: px(356),
    h: px(90),
    color: rest.isOvertime ? THEME.error : THEME.primaryPale,
    text_size: px(72),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: formatSeconds(rest.remaining),
  });

  addWidget(widget.TEXT, {
    x: px(62),
    y: px(250),
    w: px(356),
    h: px(60),
    color: THEME.textSecondary,
    text_size: px(17),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.WRAP,
    text: rest.nextExerciseName
      ? `Next: ${truncate(rest.nextExerciseName, 22)}\nSet ${(rest.nextSetIndex ?? 0) + 1}/${rest.nextTotalSets}`
      : 'Last set done',
  });

  addWidget(widget.BUTTON, {
    x: px(120),
    y: px(340),
    w: px(240),
    h: px(70),
    radius: px(35),
    normal_color: THEME.primary,
    press_color: THEME.primaryDeep,
    text: 'Next set',
    text_size: px(24),
    click_func: () => {
      hasVibratedThisRest = false;
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
    text_size: px(18),
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
    text_size: px(16),
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
    text_size: px(20),
    click_func: () => {
      sessionStore.clear();
      session = createWorkoutSession({ plan: null });
      dayPlan = null;
      finishState = null;
      listPage = 0;
      // Re-read the outline so the home shortcut points at the day after the
      // one just saved.
      if (selectedProgram) {
        loadOutline(selectedProgram, { nextScreen: SCREEN.HOME });
      } else {
        screen = SCREEN.PROGRAMS;
        renderUI();
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
      text_size: px(20),
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
    text_size: px(20),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.WRAP,
    text: statusMessage || 'Connecting to phone…',
  });
}

// ── Root render ──────────────────────────────────────────────────────────────

function renderUI() {
  clearWidgets();
  addWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: THEME.bg });

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
  if (view.state === SESSION_STATES.REST) return renderRestScreen(view);
  return renderFinishedScreen(view);
}

// ── Clock ────────────────────────────────────────────────────────────────────

/**
 * Sampled faster than once a second so a tick is never missed, but it only
 * touches the screen when the displayed second actually changes.
 */
function tick() {
  if (screen !== SCREEN.SESSION) return;

  const view = session.view();

  if (view.state !== lastRenderedState) {
    renderUI();
    return;
  }
  if (view.state !== SESSION_STATES.ACTIVE_SET && view.state !== SESSION_STATES.REST) return;

  if (view.rest && view.rest.remaining <= 0 && !hasVibratedThisRest) {
    hasVibratedThisRest = true;
    triggerVibration();
  }

  const second = view.rest ? view.rest.remaining : view.elapsedSeconds;
  if (second === lastRenderedSecond) return;
  lastRenderedSecond = second;

  let patched = updateLiveText('elapsed', {
    text: elapsedLabel(view),
    color: syncFailed ? THEME.orange : THEME.primaryLight,
  });
  patched = updateLiveText('hr', { text: `♥ ${liveHr}`, color: heartRateColor(liveHr) }) && patched;

  if (view.rest) {
    const restColor = view.rest.isOvertime ? THEME.error : THEME.primaryPale;
    const labelColor = view.rest.isOvertime ? THEME.error : THEME.textSecondary;
    patched =
      updateLiveText('restValue', { text: formatSeconds(view.rest.remaining), color: restColor }) && patched;
    patched =
      updateLiveText('restLabel', {
        text: view.rest.isOvertime ? 'Overtime' : 'Rest',
        color: labelColor,
      }) && patched;
  }

  if (!patched) {
    renderUI();
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
}

Page(
  BasePage({
    onInit() {
      pageInstance = this;
      console.log('[liftosaur] page init');
    },

    build() {
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
      pageInstance = null;
    },
  })
);
