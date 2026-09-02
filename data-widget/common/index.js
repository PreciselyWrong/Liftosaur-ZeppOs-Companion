import { createWidget, deleteWidget, redraw, widget, align, text_style, prop } from '@zos/ui';
import { px } from '@zos/utils';
import { getDeviceInfo, SCREEN_SHAPE_ROUND } from '@zos/device';
import { Time, TIME_HOUR_FORMAT_12, Vibrator, VIBRATOR_SCENE_DURATION } from '@zos/sensor';
import { LocalStorage } from '@zos/storage';
import { getSportData } from '@zos/app-access';
import { BasePage } from '@zeppos/zml/base-page';

import { createScreenLayout } from '../../shared/screen-layout.js';
import { createMessage, MESSAGE_TYPES } from '../../shared/protocol.js';
import { SESSION_STATES } from '../../shared/workout-session.js';
import { createWorkoutController, defaultDirectSync } from '../../shared/workout-controller.js';
import { createFallbackStorageAdapter, createSessionStore } from '../../shared/session-storage.js';
import { workoutToDayPlan } from '../../shared/workout-api-plan.js';
import { formatLoadoutLabel } from '../../shared/weight-rounding.js';
import { isTemporaryPhoneError } from '../../shared/connection-state.js';
import {
  TYPOGRAPHY,
  LIST_PAGE_SIZE,
  OVERVIEW_PAGE_SIZE,
  EXTENSION_CLOCK_LAYOUT,
  extensionActiveSetLayout,
  readyExercisePage,
  formatWorkoutPosition,
  formatMarqueeText,
} from '../../shared/watch-layout.js';
import { parseSportDataResult } from '../../shared/workout-extension-metrics.js';
import { createRestAlertTracker } from '../../shared/rest-alert.js';
import {
  EXTENSION_SCREENS,
  EXTENSION_TOP_BAR_LAYOUT,
  checkRequiredPhoneInput,
  formatSeconds,
  formatWeightValue,
  formatTargetRepsSummary,
  formatNextTargetSummary,
  formatDots,
  supersetColor,
  truncate,
} from '../../shared/workout-extension-nav.js';
import {
  suggestedProgramIndex,
  suggestedWeekIndex,
  suggestedDayIndex,
  suggestedStart,
  withoutIndex,
} from '../../shared/selection.js';

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
};

const deviceInfo = getDeviceInfo();
const LAYOUT = createScreenLayout({
  width: deviceInfo?.width,
  height: deviceInfo?.height,
  isRound:
    typeof SCREEN_SHAPE_ROUND === 'number' && typeof deviceInfo?.screenShape === 'number'
      ? deviceInfo.screenShape === SCREEN_SHAPE_ROUND
      : undefined,
});

const W = LAYOUT.width;
const H = LAYOUT.height;

function font(role) {
  return px(TYPOGRAPHY[role] || 24);
}

const STORAGE_KEY = 'liftosaur.extension.session.v2';

let deviceStorage = null;
try {
  deviceStorage = new LocalStorage();
} catch (err) {
  console.log('[lifto-ext] storage fallback to memory');
}

const deviceStorageAdapter = deviceStorage
  ? {
      read: () => deviceStorage.getItem(STORAGE_KEY, null),
      write: (data) => deviceStorage.setItem(STORAGE_KEY, data),
      remove: () => deviceStorage.removeItem(STORAGE_KEY),
    }
  : null;

const localStoreAdapter = createFallbackStorageAdapter(
  deviceStorageAdapter,
  undefined,
  () => console.log('[lifto-ext] storage fallback to memory')
);
const sessionStore = createSessionStore(localStoreAdapter);

let timeSensor = null;
try {
  timeSensor = new Time();
} catch (err) {
  console.log('[lifto-ext] time sensor unavailable');
}

let vibrator = null;
let vibrationTimer = null;

function stopVibration() {
  if (vibrationTimer) {
    clearTimeout(vibrationTimer);
    vibrationTimer = null;
  }
  try {
    if (vibrator) vibrator.stop();
  } catch (err) {
    console.log('[lifto-ext] vibrator error');
  }
}

function triggerRestVibration() {
  try {
    stopVibration();
    if (!vibrator) {
      vibrator = new Vibrator();
      vibrator.setMode({ mode: VIBRATOR_SCENE_DURATION });
    }
    vibrator.start();
    vibrationTimer = setTimeout(() => {
      vibrationTimer = null;
      stopVibration();
    }, 1200);
  } catch (err) {
    console.log('[lifto-ext] vibrator error');
  }
}

let widgetInstance = null;
let workoutController = null;
let restAlertTracker = createRestAlertTracker();
let hasBuilt = false;
let initialLoadPending = false;
let terminalActionPending = null;

let screen = EXTENSION_SCREENS.LOADING;
let isBusy = false;
let statusMessage = '';
let errorMessage = '';

let programs = [];
let selectedProgram = null;
let outline = null;
let selectedWeek = null;
let defaultWorkoutPlan = null;
let dayPlan = null;
let accountSettings = null;

let listPage = 0;
let readyPage = 0;
let overviewPage = 0;
let notesPage = 0;

let isOverviewOpen = false;
let isNotesModalOpen = false;
let activeNotesTitle = '';
let activeNotesContent = '';
let isRestMinimized = false;
let phoneRequiredReason = null;
let discardConfirmationRequested = false;

let finishState = null;
let syncWarning = null;

let sportDuration = '--';
let sportCalories = '--';

let clockTimer = null;
let lastRenderedState = null;
let lastRenderedSecond = null;
let lastRenderedClock = null;

let activeWidgets = [];
let liveWidgets = {};

function send(type, payload = {}) {
  if (!widgetInstance || typeof widgetInstance.request !== 'function') {
    return Promise.reject(new Error('Phone not reachable'));
  }
  return widgetInstance.request(createMessage({ type, payload })).then((res) => {
    if (res && res.type === MESSAGE_TYPES.ERROR) {
      const err = new Error(res.payload?.message || 'Liftosaur API error');
      err.code = res.payload?.code;
      throw err;
    }
    return res;
  });
}

function updateSyncWarning() {
  if (!workoutController) return;
  const status = workoutController.status();
  if (status.code === 'pending') {
    syncWarning = 'Sync pending';
  } else if (status.code === 'remote-missing') {
    syncWarning = 'Phone workout missing';
  } else if (status.code === 'conflict') {
    syncWarning = 'Sync conflict';
  } else if (status.code === 'error') {
    syncWarning = 'Sync needs attention';
  } else {
    syncWarning = null;
  }
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
  console.log('[lifto-ext] request failed');
  renderUI();
}

function logRecoverableError(message, err) {
  console.log(message, { code: err?.code || 'UNKNOWN' });
}

function handlePollFailure(err) {
  logRecoverableError('[lifto-ext] workout refresh failed', err);
  const previousWarning = syncWarning;
  updateSyncWarning();
  if (previousWarning !== syncWarning) renderUI();
}

function refreshSportMetrics() {
  try {
    getSportData({ type: 'duration' }, (result) => {
      const parsed = parseSportDataResult(result, 'duration');
      sportDuration = parsed.ok ? parsed.value : '--';
      updateLiveWidget('sport-metric', { text: formatSportBarText() });
    });
  } catch (err) {
    sportDuration = '--';
  }

  try {
    getSportData({ type: 'calories' }, (result) => {
      const parsed = parseSportDataResult(result, 'calories');
      sportCalories = parsed.ok ? `${parsed.value} kcal` : '--';
      updateLiveWidget('sport-metric', { text: formatSportBarText() });
    });
  } catch (err) {
    sportCalories = '--';
  }
}

function formatSportBarText() {
  if (sportDuration !== '--' && sportCalories !== '--') {
    return `${sportDuration} | ${sportCalories}`;
  }
  if (sportDuration !== '--') return sportDuration;
  if (sportCalories !== '--') return sportCalories;
  return '--';
}

function clearWidgets() {
  for (const w of activeWidgets) {
    try {
      deleteWidget(w);
    } catch (err) {
      console.log('[lifto-ext] widget removal failed');
    }
  }
  activeWidgets = [];
  liveWidgets = {};
}

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
    return false;
  }
}

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
    timeSensor = null;
    return '';
  }
}

function renderClock() {
  const label = currentClockLabel();
  if (!label) return;
  lastRenderedClock = label;
  addLiveLabel('clock', {
    x: px(EXTENSION_CLOCK_LAYOUT.x),
    y: px(EXTENSION_CLOCK_LAYOUT.y),
    w: px(EXTENSION_CLOCK_LAYOUT.width),
    h: px(EXTENSION_CLOCK_LAYOUT.height),
    color: THEME.textSecondary,
    text_size: font('micro'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: label,
  });
}

function updateClock() {
  const label = currentClockLabel();
  if (!label || label === lastRenderedClock) return;
  lastRenderedClock = label;
  updateLiveWidget('clock', { text: label });
}

function formatNotesMarkdown(raw) {
  if (!raw) return 'No notes for this exercise.';
  return String(raw)
    .replace(/\r\n/g, '\n')
    .replace(/^#{1,6}\s+(.*)$/gm, '$1')
    .replace(/^[\*\-]\s+(.*)$/gm, '- $1')
    .replace(/^\d+\.\s+(.*)$/gm, '- $1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function paginateNotes(text, maxCharsPerPage = 80) {
  const formatted = formatNotesMarkdown(text);
  const words = formatted.split(/\s+/);
  const pages = [];
  let currentPage = '';

  for (const word of words) {
    const candidate = currentPage ? `${currentPage} ${word}` : word;
    if (candidate.length > maxCharsPerPage && currentPage.length > 0) {
      pages.push(currentPage);
      currentPage = word;
    } else {
      currentPage = candidate;
    }
  }
  if (currentPage) pages.push(currentPage);
  return pages.length > 0 ? pages : [formatted];
}

function openNotes(title, content) {
  notesPage = 0;
  activeNotesTitle = title;
  activeNotesContent = content;
  isNotesModalOpen = true;
  renderUI();
}

function closeNotes() {
  isNotesModalOpen = false;
  activeNotesTitle = '';
  activeNotesContent = '';
  notesPage = 0;
  renderUI();
}

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
    text: truncate(text, 22),
  });
}

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

function renderTopBar(view, onBack) {
  const topBar = EXTENSION_TOP_BAR_LAYOUT;
  addWidget(widget.BUTTON, {
    x: px(topBar.menu.x),
    y: px(topBar.y),
    w: px(topBar.menu.width),
    h: px(topBar.height),
    radius: px(topBar.height / 2),
    normal_color: THEME.card,
    press_color: THEME.cardActive,
    text: 'Menu',
    text_size: font('button'),
    click_func: onBack,
  });

  addLiveLabel('elapsed', {
    x: px(topBar.elapsed.x),
    y: px(topBar.y),
    w: px(topBar.elapsed.width),
    h: px(topBar.height),
    color: THEME.primaryLight,
    text_size: font('button'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: formatSeconds(view.elapsedSeconds),
  });

  addLiveLabel('sport-metric', {
    x: px(topBar.metric.x),
    y: px(topBar.y),
    w: px(topBar.metric.width),
    h: px(topBar.height),
    color: syncWarning ? THEME.orange : THEME.textSecondary,
    text_size: font('caption'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: syncWarning ? truncate(syncWarning, 14) : formatSportBarText(),
  });
}

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
      x: px(70),
      y: pagerY,
      w: px(80),
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
      x: px(160),
      y: pagerY,
      w: px(62),
      h: px(52),
      radius: px(26),
      normal_color: THEME.primaryDark,
      press_color: THEME.cardActive,
      text: '<',
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
      x: px(294),
      y: pagerY,
      w: px(62),
      h: px(52),
      radius: px(26),
      normal_color: THEME.primaryDark,
      press_color: THEME.cardActive,
      text: '>',
      text_size: font('button'),
      click_func: () => {
        listPage = (listPage + 1) % totalPages;
        renderUI();
      },
    });
  }
}

function renderLoadingScreen() {
  renderTitle('Lifto Workout');
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
    text: statusMessage || 'Connecting to phone...',
  });
}

function renderSetupScreen() {
  renderTitle('Lifto Workout');

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
    text: isBusy ? 'Connecting...' : 'Setup required',
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
    text: errorMessage || 'Add your Liftosaur API key in the Zepp app:\n\nProfile > Apps > Lifto Workout > Settings',
  });

  addWidget(widget.BUTTON, {
    x: px(90),
    y: px(330),
    w: px(300),
    h: px(76),
    radius: px(38),
    normal_color: THEME.primary,
    press_color: THEME.primaryDeep,
    text: isBusy ? 'Checking...' : 'Retry',
    text_size: font('title'),
    click_func: startInitialNetworkLoad,
  });
}

function renderConnectionScreen() {
  renderTitle('Phone needed', THEME.orange);

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
    click_func: startInitialNetworkLoad,
  });
}

function renderEmptyScreen() {
  renderTitle('No programs');

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
    text: 'No programs on this Liftosaur account. Create a program in Liftosaur on your phone.',
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
    click_func: startInitialNetworkLoad,
  });
}

function renderHomeScreen() {
  let start = null;
  if (defaultWorkoutPlan && outline?.weeks) {
    const week = outline.weeks.find((candidate) => candidate.number === defaultWorkoutPlan.week);
    const day = week?.days.find((candidate) => candidate.number === defaultWorkoutPlan.dayInWeek);
    if (week && day) start = { week, day };
  } else if (outline?.weeks) {
    start = suggestedStart(outline.weeks, outline.lastWorkout);
  }

  if (!start) {
    screen = EXTENSION_SCREENS.PROGRAMS;
    return renderProgramsScreen();
  }

  renderTitle(outline.programName || 'Liftosaur');
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
      screen = EXTENSION_SCREENS.WEEKS;
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
      screen = EXTENSION_SCREENS.PROGRAMS;
      renderUI();
    },
  });
}

function renderProgramsScreen() {
  renderTitle('Choose program');
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
          screen = EXTENSION_SCREENS.HOME;
          renderUI();
        }
      : null,
  });
}

function renderWeeksScreen() {
  renderTitle(truncate(outline?.programName || 'Program', 24));

  const last = outline?.lastWorkout;
  renderSubtitle(
    errorMessage ||
      (last && last.week
        ? `Last: week ${last.week} | day ${last.dayInWeek}`
        : 'Choose a week'),
    { isError: Boolean(errorMessage) }
  );

  const openWeek = (week) => {
    selectedWeek = week;
    listPage = 0;
    screen = EXTENSION_SCREENS.DAYS;
    renderUI();
  };

  const weekLabel = (week) => truncate(week.name || `Week ${week.number}`, 22);
  const featuredIndex = suggestedWeekIndex(outline?.weeks || [], last);
  const rest = withoutIndex(outline?.weeks || [], featuredIndex);

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
      screen = EXTENSION_SCREENS.PROGRAMS;
      renderUI();
    },
  });
}

function renderDaysScreen() {
  renderTitle(truncate(selectedWeek?.name || `Week ${selectedWeek?.number}`, 24));
  renderSubtitle(errorMessage || 'Choose a day', { isError: Boolean(errorMessage) });

  const featuredIndex = suggestedDayIndex(selectedWeek, outline?.lastWorkout);
  const rest = withoutIndex(selectedWeek?.days || [], featuredIndex);

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
      screen = EXTENSION_SCREENS.WEEKS;
      renderUI();
    },
  });
}

function renderReadyScreen(view) {
  renderTitle(formatWorkoutPosition(view.week, view.dayInWeek));
  renderSubtitle(truncate(view.programName || '', 30));

  const ready = readyExercisePage(view.overviewExercises, readyPage);
  const { exercises, page, totalPages } = ready;
  readyPage = page;

  addWidget(widget.FILL_RECT, {
    x: px(62),
    y: px(104),
    w: px(356),
    h: px(184),
    radius: px(20),
    color: THEME.card,
  });

  if (exercises.length === 0) {
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

  exercises.forEach((exercise, index) => {
    const rowY = 108 + index * 58;

    if (exercise.supersetGroup) {
      addWidget(widget.FILL_RECT, {
        x: px(68),
        y: px(rowY + 3),
        w: px(5),
        h: px(48),
        radius: px(3),
        color: supersetColor(exercise.supersetGroup),
      });
    }

    addWidget(widget.TEXT, {
      x: px(78),
      y: px(rowY),
      w: px(324),
      h: px(28),
      color: THEME.textPrimary,
      text_size: font('caption'),
      align_h: align.LEFT,
      align_v: align.TOP,
      text_style: text_style.NONE,
      text: truncate(exercise.name, 20),
    });

    addWidget(widget.TEXT, {
      x: px(78),
      y: px(rowY + 28),
      w: px(324),
      h: px(26),
      color: THEME.textSecondary,
      text_size: font('micro'),
      align_h: align.LEFT,
      align_v: align.TOP,
      text_style: text_style.NONE,
      text: exercise.prescriptionSummary,
    });
  });

  if (totalPages > 1) {
    addWidget(widget.BUTTON, {
      x: px(62),
      y: px(294),
      w: px(54),
      h: px(40),
      radius: px(20),
      normal_color: THEME.cardActive,
      press_color: THEME.card,
      color: THEME.primaryPale,
      text: '<',
      text_size: font('button'),
      click_func: () => {
        readyPage = (readyPage - 1 + totalPages) % totalPages;
        renderUI();
      },
    });

    addWidget(widget.BUTTON, {
      x: px(364),
      y: px(294),
      w: px(54),
      h: px(40),
      radius: px(20),
      normal_color: THEME.cardActive,
      press_color: THEME.card,
      color: THEME.primaryPale,
      text: '>',
      text_size: font('button'),
      click_func: () => {
        readyPage = (readyPage + 1) % totalPages;
        renderUI();
      },
    });
  }

  addWidget(widget.TEXT, {
    x: px(120),
    y: px(294),
    w: px(240),
    h: px(40),
    color: THEME.textSecondary,
    text_size: font('micro'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: totalPages > 1
      ? `${page + 1}/${totalPages} | ${view.totalExercises} exercises`
      : `${view.totalExercises} exercises`,
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
      screen = EXTENSION_SCREENS.DAYS;
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
      workoutController.startWorkout();
      renderUI();
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
    text: '-',
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

function renderActiveSetScreen(view) {
  const isResting = view.state === SESSION_STATES.REST && view.rest;
  const pending = view.pending;
  const set = (isResting && pending ? pending.set : null) || view.currentSet;
  const exerciseName = isResting && pending ? pending.exerciseName : view.exerciseName;
  const exerciseNotes = isResting && pending ? pending.exerciseNotes : view.exerciseNotes;
  const supersetGroup = isResting && pending ? pending.supersetGroup : view.supersetGroup;
  const setsDots = isResting && pending ? pending.setsDots : view.exerciseSetsDots;
  const setIndex = isResting && pending ? pending.setIndex : view.currentSetIndex;
  const totalSets = isResting && pending ? pending.totalSets : view.totalSets;
  const loadingEquipment = isResting && pending ? pending.loadingEquipment : view.loadingEquipment;
  const controls = extensionActiveSetLayout(set);

  if (isResting) {
    const topBar = EXTENSION_TOP_BAR_LAYOUT;
    const bannerColor = view.rest.isOvertime
      ? THEME.error
      : (view.rest.isPaused ? THEME.yellow : THEME.primaryPale);

    addWidget(widget.BUTTON, {
      x: px(topBar.menu.x),
      y: px(topBar.y),
      w: px(topBar.menu.width),
      h: px(topBar.height),
      radius: px(topBar.height / 2),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      text: 'Menu',
      text_size: font('button'),
      click_func: () => {
        isOverviewOpen = true;
        renderUI();
      },
    });

    addLiveButton('restBannerText', {
      x: px(topBar.restBanner.x),
      y: px(topBar.y),
      w: px(topBar.restBanner.width),
      h: px(topBar.height),
      radius: px(topBar.height / 2),
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
    w: exerciseNotes ? px(290) : px(356),
    h: px(30),
    color: THEME.textPrimary,
    text_size: font('title'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: truncate(exerciseName, 20),
  });

  if (exerciseNotes) {
    addWidget(widget.BUTTON, {
      x: px(356),
      y: px(88),
      w: px(62),
      h: px(36),
      radius: px(18),
      normal_color: THEME.cardActive,
      press_color: THEME.card,
      color: THEME.primaryLight,
      text: 'Info',
      text_size: font('micro'),
      click_func: () => openNotes('Exercise details', `${exerciseName}\n\n${exerciseNotes}`),
    });
  }

  const ssColor = supersetColor(supersetGroup);
  const ssBadge = supersetGroup ? ` (SS ${supersetGroup})` : '';

  const setLabel = set?.isWarmup
    ? `WARMUP ${set.warmupIndex}/${set.totalWarmups}${ssBadge}`
    : `SET ${(set?.workSetIndex || setIndex + 1)}/${set?.totalWorkSets || totalSets}${ssBadge}`;

  addWidget(widget.TEXT, {
    x: px(62),
    y: px(122),
    w: px(356),
    h: px(26),
    color: set?.isWarmup ? 0xffb544 : (supersetGroup ? ssColor : THEME.textSecondary),
    text_size: font('caption'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: `${setLabel}   ${formatDots(setsDots)}`,
  });

  let targetText;
  if (set?.isWarmup) {
    if (set.targetWeight !== null) {
      targetText = `Warmup: ${formatTargetRepsSummary(set)} x ${formatWeightValue(set.targetWeight, view.unit)}${
        set.targetWeightPercent ? ` (${set.targetWeightPercent}%)` : ''
      }`;
    } else {
      targetText = `Warmup: ${formatTargetRepsSummary(set)} x ${
        set.targetWeightPercent ? `${set.targetWeightPercent}%` : '-'
      }`;
    }
  } else {
    targetText = `Target: ${formatTargetRepsSummary(set)} x ${formatWeightValue(set?.targetWeight, view.unit)}${
      set?.targetRpe !== null && set?.targetRpe !== undefined ? ` @${set.targetRpe}` : ''
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

  // Steppers
  renderStepper({
    y: px(controls.rows[0].y),
    height: px(controls.rowHeight),
    label: formatLoadoutLabel(set?.weight, loadingEquipment, view.unit) || (view.unit || 'KG').toUpperCase(),
    value: set?.weight === null || set?.weight === undefined ? '-' : String(set.weight),
    onMinus: () => {
      workoutController.adjustWeight(-1);
      renderUI();
    },
    onPlus: () => {
      workoutController.adjustWeight(1);
      renderUI();
    },
  });

  renderStepper({
    y: px(controls.rows[1].y),
    height: px(controls.rowHeight),
    label: 'REPS',
    value: set?.reps === null || set?.reps === undefined ? '-' : String(set.reps),
    onMinus: () => {
      workoutController.adjustReps(-1);
      renderUI();
    },
    onPlus: () => {
      workoutController.adjustReps(1);
      renderUI();
    },
  });

  if (controls.showRpe) {
    renderStepper({
      y: px(controls.rows[2].y),
      height: px(controls.rowHeight),
      label: 'RPE',
      value: set?.rpe === null || set?.rpe === undefined ? '-' : String(set.rpe),
      onMinus: () => {
        workoutController.adjustRpe(-0.5);
        renderUI();
      },
      onPlus: () => {
        workoutController.adjustRpe(0.5);
        renderUI();
      },
    });
  }

  // Action button
  addWidget(widget.BUTTON, {
    x: px(100),
    y: px(controls.actionY),
    w: px(280),
    h: px(controls.actionHeight),
    radius: px(controls.actionHeight / 2),
    normal_color: THEME.success,
    press_color: 0x1c9c6d,
    color: 0x00281c,
    text: isResting ? 'Start set' : 'Done',
    text_size: font('title'),
    click_func: () => {
      if (isResting) {
        restAlertTracker.reset();
        stopVibration();
        isRestMinimized = false;
        workoutController.nextSet();
        renderUI();
        return;
      }

      const phoneReason = checkRequiredPhoneInput(set);
      if (phoneReason) {
        phoneRequiredReason = phoneReason;
        renderUI();
        return;
      }

      phoneRequiredReason = null;
      workoutController.completeSet({
        repsLeft: set?.isUnilateral ? set.reps : null,
      });
      workoutController.syncSets().then(
        () => renderUI(),
        () => renderUI(),
      );
      if (workoutController.view().state === SESSION_STATES.FINISHED) {
        submitWorkout();
      } else {
        renderUI();
      }
    },
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
    x: px(52),
    y: px(190),
    w: px(104),
    h: px(44),
    radius: px(22),
    normal_color: THEME.card,
    press_color: THEME.cardActive,
    text: '-10s',
    text_size: font('caption'),
    click_func: () => {
      workoutController.adjustRest(-10);
      renderUI();
    },
  });

  addWidget(widget.BUTTON, {
    x: px(164),
    y: px(190),
    w: px(152),
    h: px(44),
    radius: px(22),
    normal_color: rest.isPaused ? THEME.yellow : THEME.card,
    press_color: THEME.cardActive,
    color: rest.isPaused ? 0x000000 : THEME.textPrimary,
    text: rest.isPaused ? 'Resume' : 'Pause',
    text_size: font('caption'),
    click_func: () => {
      workoutController.toggleRestPause();
      renderUI();
    },
  });

  addWidget(widget.BUTTON, {
    x: px(324),
    y: px(190),
    w: px(104),
    h: px(44),
    radius: px(22),
    normal_color: THEME.card,
    press_color: THEME.cardActive,
    text: '+10s',
    text_size: font('caption'),
    click_func: () => {
      workoutController.adjustRest(10);
      renderUI();
    },
  });

  // Next Set Preview Card
  if (rest.nextExerciseName) {
    const ssColor = supersetColor(rest.nextSupersetGroup);
    const ssText = rest.nextSupersetGroup ? ` (SS ${rest.nextSupersetGroup})` : '';
    const nextLoadoutLabel = formatLoadoutLabel(
      rest.nextTargetWeight,
      view.pending?.loadingEquipment,
      rest.nextUnit
    );
    const setProg = rest.nextIsWarmup
      ? `WARMUP ${(rest.nextWarmupIndex ?? (rest.nextSetIndex ?? 0) + 1)}/${rest.nextTotalWarmups || rest.nextTotalSets}${ssText}`
      : `SET ${(rest.nextWorkSetIndex ?? (rest.nextSetIndex ?? 0) + 1)}/${rest.nextTotalWorkSets || rest.nextTotalSets}${ssText}`;

    addWidget(widget.FILL_RECT, {
      x: px(52),
      y: px(244),
      w: px(376),
      h: px(116),
      radius: px(18),
      color: THEME.card,
    });

    addWidget(widget.TEXT, {
      x: px(60),
      y: px(250),
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
        x: px(356),
        y: px(246),
        w: px(62),
        h: px(32),
        radius: px(16),
        normal_color: THEME.cardActive,
        press_color: THEME.card,
        color: THEME.primaryLight,
        text: 'Info',
        text_size: font('micro'),
        click_func: () => openNotes('Exercise details', `${rest.nextExerciseName}\n\n${rest.nextExerciseNotes}`),
      });
    }

    addWidget(widget.TEXT, {
      x: px(60),
      y: px(276),
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
      y: px(300),
      w: px(360),
      h: px(32),
      color: THEME.yellow,
      text_size: font('title'),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: formatNextTargetSummary(rest),
    });

    if (nextLoadoutLabel) {
      addWidget(widget.TEXT, {
        x: px(60),
        y: px(332),
        w: px(360),
        h: px(22),
        color: THEME.textSecondary,
        text_size: font('micro'),
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
        text_style: text_style.NONE,
        text: nextLoadoutLabel,
      });
    }
  }

  // Action buttons
  addWidget(widget.BUTTON, {
    x: px(64),
    y: px(370),
    w: px(150),
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
    x: px(226),
    y: px(370),
    w: px(190),
    h: px(58),
    radius: px(29),
    normal_color: THEME.primary,
    press_color: THEME.primaryDeep,
    text: 'Start set',
    text_size: font('button'),
    click_func: () => {
      restAlertTracker.reset();
      stopVibration();
      isRestMinimized = false;
      workoutController.nextSet();
      renderUI();
    },
  });
}

function renderOverviewScreen(view) {
  renderTopBar(view, () => {
    isOverviewOpen = false;
    renderUI();
  });

  const all = view.overviewExercises || [];
  const totalPages = Math.max(1, Math.ceil(all.length / OVERVIEW_PAGE_SIZE));
  if (overviewPage >= totalPages) overviewPage = totalPages - 1;
  if (overviewPage < 0) overviewPage = 0;

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
        workoutController.selectExercise(idx);
        isOverviewOpen = false;
        renderUI();
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
      workoutController.finishWorkout();
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
      handleDiscardWorkout();
    },
  });

  if (totalPages > 1) {
    addWidget(widget.BUTTON, {
      x: px(160),
      y: px(396),
      w: px(62),
      h: px(44),
      radius: px(22),
      normal_color: THEME.primaryDark,
      press_color: THEME.cardActive,
      text: '<',
      text_size: font('button'),
      click_func: () => {
        overviewPage = (overviewPage - 1 + totalPages) % totalPages;
        renderUI();
      },
    });

    addWidget(widget.TEXT, {
      x: px(228),
      y: px(396),
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
      x: px(294),
      y: px(396),
      w: px(62),
      h: px(44),
      radius: px(22),
      normal_color: THEME.primaryDark,
      press_color: THEME.cardActive,
      text: '>',
      text_size: font('button'),
      click_func: () => {
        overviewPage = (overviewPage + 1) % totalPages;
        renderUI();
      },
    });
  }
}

function renderNotesScreen() {
  const pages = paginateNotes(activeNotesContent);
  const totalPages = pages.length;
  if (notesPage >= totalPages) notesPage = totalPages - 1;
  if (notesPage < 0) notesPage = 0;

  renderTitle(activeNotesTitle || 'Notes');

  addWidget(widget.FILL_RECT, {
    x: px(50),
    y: px(80),
    w: px(380),
    h: px(250),
    radius: px(20),
    color: THEME.card,
  });

  addWidget(widget.TEXT, {
    x: px(66),
    y: px(96),
    w: px(348),
    h: px(218),
    color: THEME.textSecondary,
    text_size: font('body'),
    align_h: align.CENTER_H,
    align_v: align.TOP,
    text_style: text_style.WRAP,
    text: pages[notesPage] || 'No notes for this exercise.',
  });

  if (totalPages > 1) {
    addWidget(widget.BUTTON, {
      x: px(50),
      y: px(348),
      w: px(70),
      h: px(54),
      radius: px(27),
      normal_color: THEME.cardActive,
      press_color: THEME.card,
      text: '<',
      text_size: font('button'),
      click_func: () => {
        notesPage = (notesPage - 1 + totalPages) % totalPages;
        renderUI();
      },
    });

    addWidget(widget.TEXT, {
      x: px(126),
      y: px(348),
      w: px(50),
      h: px(54),
      color: THEME.textSecondary,
      text_size: font('micro'),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `${notesPage + 1}/${totalPages}`,
    });

    addWidget(widget.BUTTON, {
      x: px(182),
      y: px(348),
      w: px(70),
      h: px(54),
      radius: px(27),
      normal_color: THEME.cardActive,
      press_color: THEME.card,
      text: '>',
      text_size: font('button'),
      click_func: () => {
        notesPage = (notesPage + 1) % totalPages;
        renderUI();
      },
    });

    addWidget(widget.BUTTON, {
      x: px(264),
      y: px(348),
      w: px(166),
      h: px(54),
      radius: px(27),
      normal_color: THEME.primary,
      press_color: THEME.primaryDeep,
      text: 'Close',
      text_size: font('button'),
      click_func: closeNotes,
    });
  } else {
    addWidget(widget.BUTTON, {
      x: px(140),
      y: px(348),
      w: px(200),
      h: px(56),
      radius: px(28),
      normal_color: THEME.primary,
      press_color: THEME.primaryDeep,
      text: 'Close',
      text_size: font('button'),
      click_func: closeNotes,
    });
  }
}

function renderPhoneRequiredModal() {
  renderTitle('Phone input needed', THEME.orange);

  addWidget(widget.FILL_RECT, {
    x: px(50),
    y: px(100),
    w: px(380),
    h: px(210),
    radius: px(20),
    color: THEME.card,
  });

  addWidget(widget.TEXT, {
    x: px(68),
    y: px(120),
    w: px(344),
    h: px(170),
    color: THEME.textSecondary,
    text_size: font('body'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.WRAP,
    text: phoneRequiredReason || 'This set requires input in the Liftosaur app on your phone.',
  });

  addWidget(widget.BUTTON, {
    x: px(140),
    y: px(330),
    w: px(200),
    h: px(64),
    radius: px(32),
    normal_color: THEME.primary,
    press_color: THEME.primaryDeep,
    text: 'Dismiss',
    text_size: font('button'),
    click_func: () => {
      phoneRequiredReason = null;
      renderUI();
    },
  });
}

function renderDiscardConfirmation() {
  renderTitle('Discard local workout?', THEME.error);
  renderSubtitle('Unsynced sets cannot be recovered.', { isError: true });

  addWidget(widget.BUTTON, {
    x: px(64),
    y: px(300),
    w: px(170),
    h: px(64),
    radius: px(32),
    normal_color: THEME.card,
    press_color: THEME.cardActive,
    text: 'Keep local',
    text_size: font('button'),
    click_func: () => {
      discardConfirmationRequested = false;
      renderUI();
    },
  });

  addWidget(widget.BUTTON, {
    x: px(246),
    y: px(300),
    w: px(170),
    h: px(64),
    radius: px(32),
    normal_color: 0x3a1a1a,
    press_color: 0x551111,
    color: THEME.error,
    text: 'Discard',
    text_size: font('button'),
    click_func: () => {
      discardConfirmationRequested = false;
      handleDiscardWorkout();
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
    h: px(140),
    radius: px(20),
    color: THEME.card,
  });

  addWidget(widget.TEXT, {
    x: px(78),
    y: px(116),
    w: px(324),
    h: px(116),
    color: THEME.textPrimary,
    text_size: font('title'),
    align_h: align.CENTER_H,
    align_v: align.TOP,
    text_style: text_style.WRAP,
    text: `${view.totalCompletedSetsCount} sets | ${formatSeconds(view.elapsedSeconds)}\nVolume ${Math.round(
      view.totalVolume
    )} ${view.unit}`,
  });

  const status = finishState || { status: 'IDLE', message: '' };
  const isSending = status.status === 'SENDING';
  const isSaved = status.status === 'SAVED';
  const isFailed = status.status === 'FAILED';

  const statusColor = isSaved
    ? THEME.success
    : isSending
      ? THEME.textSecondary
      : THEME.error;

  const displayMessage = isSaved
    ? 'Liftosaur saved. Finish the Zepp workout with native controls.'
    : (status.message || (isSending ? 'Saving to Liftosaur...' : ''));

  addWidget(widget.TEXT, {
    x: px(60),
    y: px(254),
    w: px(360),
    h: px(76),
    color: statusColor,
    text_size: font('caption'),
    align_h: align.CENTER_H,
    align_v: align.TOP,
    text_style: text_style.WRAP,
    text: displayMessage,
  });

  if (!isSending) {
    if (isSaved) {
      addWidget(widget.BUTTON, {
        x: px(120),
        y: px(340),
        w: px(240),
        h: px(66),
        radius: px(33),
        normal_color: THEME.primary,
        press_color: THEME.primaryDeep,
        text: 'Done',
        text_size: font('title'),
        click_func: () => {
          workoutController.clear();
          dayPlan = null;
          finishState = null;
          listPage = 0;
          screen = EXTENSION_SCREENS.HOME;
          renderUI();
        },
      });
    } else if (isFailed) {
      addWidget(widget.BUTTON, {
        x: px(78),
        y: px(340),
        w: px(150),
        h: px(66),
        radius: px(33),
        normal_color: THEME.card,
        press_color: THEME.cardActive,
        color: THEME.error,
        text: 'Discard',
        text_size: font('button'),
        click_func: handleDiscardWorkout,
      });

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
}

function renderConflictScreen() {
  const sync = workoutController.sync();
  renderTitle('Sync conflict', THEME.orange);
  renderSubtitle(syncWarning || 'Another workout is active in Liftosaur', { isError: true });

  addWidget(widget.TEXT, {
    x: px(72),
    y: px(120),
    w: px(336),
    h: px(120),
    color: THEME.textSecondary,
    text_size: font('body'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.WRAP,
    text: sync.remoteMissing
      ? 'The shared workout is no longer active on phone. Return home or adopt remote workout.'
      : 'Continue phone workout here, or resolve conflict on phone and retry.',
  });

  addWidget(widget.BUTTON, {
    x: px(90),
    y: px(260),
    w: px(300),
    h: px(64),
    radius: px(32),
    normal_color: THEME.primary,
    press_color: THEME.primaryDeep,
    text: sync.remoteMissing ? 'Discard local' : 'Use phone workout',
    text_size: font('button'),
    click_func: sync.remoteMissing
      ? () => {
          discardConfirmationRequested = true;
          renderUI();
        }
      : adoptCurrentWorkout,
  });

  addWidget(widget.BUTTON, {
    x: px(90),
    y: px(336),
    w: px(300),
    h: px(58),
    radius: px(29),
    normal_color: THEME.card,
    press_color: THEME.cardActive,
    text: 'Retry sync',
    text_size: font('button'),
    click_func: () => {
      workoutController.updateSync({ conflict: false });
      syncWarning = null;
      workoutController.ensureStarted().then(
        () => renderUI(),
        () => renderUI(),
      );
    },
  });
}

function renderUI() {
  if (!hasBuilt) return;
  updateSyncWarning();
  clearWidgets();

  // Full-screen background
  addRawWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: THEME.bg });

  renderClock();
  renderScreen();
  redraw();
}

function renderScreen() {
  if (discardConfirmationRequested) return renderDiscardConfirmation();
  if (phoneRequiredReason) return renderPhoneRequiredModal();
  if (isNotesModalOpen) return renderNotesScreen();
  if (screen === EXTENSION_SCREENS.CONNECTION) return renderConnectionScreen();
  if (screen === EXTENSION_SCREENS.SETUP) return renderSetupScreen();
  if (screen === EXTENSION_SCREENS.EMPTY) return renderEmptyScreen();
  if (screen === EXTENSION_SCREENS.LOADING) return renderLoadingScreen();
  if (screen === EXTENSION_SCREENS.HOME) {
    if (isBusy) return renderLoadingScreen();
    return renderHomeScreen();
  }
  if (screen === EXTENSION_SCREENS.PROGRAMS) return renderProgramsScreen();
  if (screen === EXTENSION_SCREENS.WEEKS) return renderWeeksScreen();
  if (screen === EXTENSION_SCREENS.DAYS) {
    if (isBusy) return renderLoadingScreen();
    return renderDaysScreen();
  }

  const view = workoutController.view();
  const sync = workoutController.sync();

  if (sync.conflict) {
    return renderConflictScreen();
  }

  lastRenderedState = view.state;
  lastRenderedSecond = view.rest ? view.rest.remaining : view.elapsedSeconds;

  if (view.state === SESSION_STATES.NO_PLAN) {
    screen = EXTENSION_SCREENS.PROGRAMS;
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

function startInitialNetworkLoad() {
  beginRequest('Connecting to phone...');

  send(MESSAGE_TYPES.GET_SETTINGS)
    .then((settingsRes) => {
      accountSettings = settingsRes.payload || {};
      return send(MESSAGE_TYPES.GET_WORKOUT_CURRENT);
    })
    .then((currentRes) => {
      workoutController.markAuthoritativeResponse();
      const currentWorkout = currentRes.payload?.workout || null;
      if (currentWorkout) {
        const plan = workoutToDayPlan(currentWorkout, {
          units: accountSettings?.units || null,
          isCurrent: true,
        });
        if (!plan || !plan.unit) {
          throw new Error('Workout has no unit specified');
        }
        dayPlan = plan;
        workoutController.loadPlan(dayPlan, {
          sync: {
            mode: 'DIRECT',
            startConfirmed: true,
            acknowledgedSetCount: workoutController.getWorkoutSetWrites().length,
            finishRequestedAt: null,
            discardRequestedAt: null,
            conflict: false,
            remoteMissing: false,
            preservedIntervals: [],
            intervalsPreservedThrough: null,
          },
          persist: true,
        });
        isBusy = false;
        statusMessage = '';
        screen = EXTENSION_SCREENS.SESSION;
        renderUI();
        return;
      }

      return Promise.all([
        send(MESSAGE_TYPES.GET_WORKOUT_NEXT).catch((err) => {
          logRecoverableError('[lifto-ext] next workout unavailable', err);
          return null;
        }),
        send(MESSAGE_TYPES.LIST_PROGRAMS).catch((err) => {
          logRecoverableError('[lifto-ext] program list unavailable', err);
          return null;
        }),
      ]).then(([nextRes, listRes]) => {
        const nextWorkout = nextRes?.payload?.workout || null;
        if (nextWorkout) {
          defaultWorkoutPlan = workoutToDayPlan(nextWorkout, {
            units: accountSettings?.units || null,
            isCurrent: false,
          });
        } else {
          defaultWorkoutPlan = null;
        }

        programs = listRes?.payload?.programs || [];
        if (programs.length === 0) {
          isBusy = false;
          statusMessage = '';
          screen = EXTENSION_SCREENS.EMPTY;
          renderUI();
          return;
        }

        const currentIndex = suggestedProgramIndex(programs);
        if (currentIndex === -1) {
          isBusy = false;
          statusMessage = '';
          screen = EXTENSION_SCREENS.PROGRAMS;
          renderUI();
          return;
        }

        loadOutline(programs[currentIndex], { nextScreen: EXTENSION_SCREENS.HOME });
      });
    })
    .catch((err) => {
      if (isTemporaryPhoneError(err)) {
        isBusy = false;
        statusMessage = '';
        errorMessage = '';
        screen = EXTENSION_SCREENS.CONNECTION;
        renderUI();
        return;
      }
      screen = EXTENSION_SCREENS.SETUP;
      failRequest(err);
    });
}

function loadOutline(program, { nextScreen = EXTENSION_SCREENS.WEEKS } = {}) {
  selectedProgram = program;
  beginRequest('Loading outline...');
  send(MESSAGE_TYPES.GET_PROGRAM_OUTLINE, { programId: program.id })
    .then((res) => {
      isBusy = false;
      statusMessage = '';
      outline = res.payload;
      listPage = 0;
      screen = outline?.weeks && outline.weeks.length > 0 ? nextScreen : EXTENSION_SCREENS.PROGRAMS;
      if (screen === EXTENSION_SCREENS.PROGRAMS) {
        errorMessage = 'This program has no days';
      }
      renderUI();
    })
    .catch(failRequest);
}

function loadDayPlan(week, day) {
  selectedWeek = week;
  beginRequest('Loading workout...');

  send(MESSAGE_TYPES.GET_WORKOUT_NEXT, {
    programId: selectedProgram?.id || outline?.programId,
    week: week.number,
    dayInWeek: day.number,
  })
    .then((res) => {
      const rawWorkout = res.payload?.workout || null;
      if (!rawWorkout) {
        throw new Error('No workout data returned');
      }
      const plan = workoutToDayPlan(rawWorkout, {
        units: accountSettings?.units || null,
        isCurrent: false,
      });
      if (!plan || !plan.unit) {
        throw new Error('Workout has no unit specified');
      }
      if (!plan.exercises || plan.exercises.length === 0) {
        throw new Error('This workout has no exercises');
      }
      isBusy = false;
      statusMessage = '';
      dayPlan = plan;
      workoutController.loadPlan(dayPlan, {
        sync: defaultDirectSync('DIRECT'),
        clearStore: true,
      });
      finishState = null;
      isOverviewOpen = false;
      overviewPage = 0;
      readyPage = 0;
      screen = EXTENSION_SCREENS.SESSION;
      renderUI();
    })
    .catch(failRequest);
}

function submitWorkout() {
  if (finishState?.status === 'SENDING') return;

  finishState = { status: 'SENDING', message: 'Saving to Liftosaur...' };
  renderUI();

  workoutController
    .finishWorkoutRemote()
    .then((result) => {
      if (!result.success) throw new Error(result.reason || 'Save failed');
      finishState = {
        status: 'SAVED',
        message: 'Saved to Liftosaur',
      };
      renderUI();
    })
    .catch((err) => {
      finishState = {
        status: 'FAILED',
        message: err?.message || 'Save failed - retry',
      };
      renderUI();
    });
}

function handleDiscardWorkout() {
  beginRequest('Discarding workout...');

  workoutController
    .discardWorkoutRemote()
    .then((result) => {
      if (!result.success) throw new Error(result.reason || 'Discard pending');
      returnAfterDiscard();
    })
    .catch((err) => {
      failRequest(err);
    });
}

function returnAfterDiscard() {
  workoutController.clear();
  dayPlan = null;
  listPage = 0;

  if (outline) {
    screen = EXTENSION_SCREENS.HOME;
    renderUI();
    return;
  }

  screen = EXTENSION_SCREENS.LOADING;
  startInitialNetworkLoad();
}

function adoptCurrentWorkout() {
  beginRequest('Loading phone workout...');
  workoutController
    .adoptCurrent({ preserveNavigation: false })
    .then(() => {
      dayPlan = workoutController.plan();
      isBusy = false;
      statusMessage = '';
      renderUI();
    })
    .catch(failRequest);
}

function tick() {
  updateClock();

  if (screen !== EXTENSION_SCREENS.SESSION) return;

  workoutController
    .pollCurrent()
    .then((changed) => {
      const previousWarning = syncWarning;
      updateSyncWarning();
      if (changed || previousWarning !== syncWarning) renderUI();
    })
    .catch(handlePollFailure);

  const view = workoutController.view();

  if (view.state !== lastRenderedState) {
    renderUI();
    return;
  }

  if (view.state === SESSION_STATES.REST && view.rest) {
    const alertResult = restAlertTracker.checkTick({ rest: view.rest, now: Date.now() });
    if (alertResult.shouldAlert) {
      triggerRestVibration();
    }
  }

  const currentSecond = view.rest ? view.rest.remaining : view.elapsedSeconds;
  if (currentSecond !== lastRenderedSecond) {
    lastRenderedSecond = currentSecond;
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

      updateLiveWidget('restLabel', { text: labelText, color: labelColor });
      updateLiveWidget('restValue', { text: formatSeconds(view.rest.remaining), color: restColor });
      updateLiveWidget('restBannerText', { text: `Rest ${formatSeconds(view.rest.remaining)}`, color: restColor });
    }
    updateLiveWidget('elapsed', { text: formatSeconds(view.elapsedSeconds) });
  }
}

function startClock() {
  if (clockTimer) return;
  clockTimer = setInterval(tick, 1000);
}

function stopClock() {
  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
}

DataWidget(
  BasePage({
    onInit() {
      widgetInstance = this;
      console.log('[lifto-ext] data-widget onInit');

      workoutController = createWorkoutController({
        store: sessionStore,
        request: (type, payload) => send(type, payload),
        mapWorkout: (workout, options) =>
          workoutToDayPlan(workout, {
            ...options,
            units: accountSettings?.units || options?.units || null,
          }),
      });

      const restored = workoutController.restore();
      if (restored.success) {
        dayPlan = workoutController.plan();
        const sync = workoutController.sync();
        if (sync.finishRequestedAt) {
          screen = EXTENSION_SCREENS.SESSION;
          terminalActionPending = 'finish';
        } else if (sync.discardRequestedAt) {
          screen = EXTENSION_SCREENS.SESSION;
          terminalActionPending = 'discard';
        } else {
          screen = EXTENSION_SCREENS.SESSION;
        }
      } else {
        screen = EXTENSION_SCREENS.LOADING;
        initialLoadPending = true;
      }
    },

    build() {
      console.log('[lifto-ext] data-widget build');
      hasBuilt = true;
      renderUI();
      refreshSportMetrics();
      startClock();
      if (terminalActionPending === 'finish') {
        terminalActionPending = null;
        submitWorkout();
      } else if (terminalActionPending === 'discard') {
        terminalActionPending = null;
        handleDiscardWorkout();
      } else if (initialLoadPending) {
        initialLoadPending = false;
        startInitialNetworkLoad();
      }
    },

    onResume() {
      console.log('[lifto-ext] data-widget onResume');
      if (!hasBuilt) return;
      refreshSportMetrics();
      startClock();

      if (workoutController) {
        const view = workoutController.view();
        if (view.state === SESSION_STATES.REST && view.rest) {
          const resumeAlert = restAlertTracker.checkResume({ rest: view.rest, now: Date.now() });
          if (resumeAlert.shouldAlert) {
            triggerRestVibration();
          }
        }
        workoutController
          .pollCurrent()
          .then((changed) => {
            if (changed) renderUI();
          })
          .catch(handlePollFailure);
      }
      renderUI();
    },

    onPause() {
      console.log('[lifto-ext] data-widget onPause');
      stopClock();
      stopVibration();
      if (workoutController) {
        workoutController.persist();
      }
    },

    onDestroy() {
      console.log('[lifto-ext] data-widget onDestroy');
      stopClock();
      stopVibration();
      clearWidgets();
      hasBuilt = false;
      widgetInstance = null;
    },
  })
);
