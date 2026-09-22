import { recordingLabel, recordingDetails } from '../../shared/recording-status.js';
import { timedSetPresentation, timedSetIdentity } from '../../shared/timed-set-ui.js';
import { ACTIVE_SET_ACTION_LAYOUT, PREPARED_TOP_BAR_LAYOUT, TIMED_SET_LAYOUT, WORKOUT_TIMER_MODAL_LAYOUT, SET_CORRECTION_LAYOUT, stepperRowLayout } from '../../shared/watch-layout.js';
import { normalizeGetReadySeconds } from '../../shared/timed-settings.js';
import { createRestPresentationState, updateRestPresentation, readAutoPreparePreference, saveAutoPreparePreference } from '../../shared/auto-prepare.js';
import { exerciseInfoPages } from '../../shared/exercise-info-pages.js';
import { INFO_NAV, INFO_TEXT_LAYOUT, WORKOUT_INFO_PANEL } from '../../shared/exercise-info-layout.js';
import { normalizeExerciseImages } from '../../shared/exercise-images.js';
import { createWatchExerciseImages } from '../../shared/watch-exercise-images.js';
import { exerciseDisplayImageUrl } from '../../shared/exercise-notes.js';
import {
  createRestHaloLayers,
  darkenColor,
  isPurpleRestRing,
  getChangedFieldTextColor,
  startRestPulseAnimation,
  stopRestPulseAnimation,
} from '../../shared/rest-visual.js';
import { createWidget, deleteWidget, redraw, widget, align, text_style, prop, sport_data, edit_widget_group_type, anim_status } from '@zos/ui';
import { px } from '@zos/utils';
import { getDeviceInfo, SCREEN_SHAPE_ROUND } from '@zos/device';
import {
  Time,
  TIME_HOUR_FORMAT_12,
  Vibrator,
  VIBRATOR_SCENE_STRONG_REMINDER,
  VIBRATOR_SCENE_SHORT_LIGHT,
} from '@zos/sensor';
import { LocalStorage } from '@zos/storage';
import * as appApi from '@zos/app';
import { getSportData } from '@zos/app-access';
import {
  setPageBrightTime,
  resetPageBrightTime,
  pauseDropWristScreenOff,
  resetDropWristScreenOff,
  pausePalmScreenOff,
  resetPalmScreenOff,
} from '@zos/display';
import { BasePage } from '@zeppos/zml/base-page';

import { createScreenLayout } from '../../shared/screen-layout.js';
import { createMessage, MESSAGE_TYPES } from '../../shared/protocol.js';
import { SESSION_STATES } from '../../shared/workout-session.js';
import { createWorkoutController, defaultDirectSync } from '../../shared/workout-controller.js';
import { createFallbackStorageAdapter, createSessionStore } from '../../shared/session-storage.js';
import { createWorkoutDiagnostics, readWorkoutMemory, normalizeWorkoutDiagnosticsEnabled, WORKOUT_DIAGNOSTIC_CODES } from '../../shared/workout-diagnostics.js';
import { workoutToDayPlan } from '../../shared/workout-api-plan.js';
import { formatLoadoutLabel } from '../../shared/weight-rounding.js';
import {
  PHONE_CONNECTING_MESSAGE,
  PHONE_CONNECTION_TITLE,
  PHONE_REQUEST_TIMEOUT_MS,
  isTemporaryPhoneError,
  nextPhoneRetryDelay,
  phoneConnectionMessage,
} from '../../shared/connection-state.js';
import { withRequestTimeout } from '../../shared/request-timeout.js';
import {
  TYPOGRAPHY,
  LIST_PAGE_SIZE,
  OVERVIEW_PAGE_SIZE,
  EXTENSION_CLOCK_LAYOUT,
  extensionActiveSetLayout,
  extensionRestActionsLayout,
  readyExercisePage,
  formatWorkoutPosition,
  formatMarqueeText,
} from '../../shared/watch-layout.js';
import {
  parseSportDataResult,
  parseDurationToSeconds,
  createNativePauseReconciler,
} from '../../shared/workout-extension-metrics.js';
import { createRestAlertTracker } from '../../shared/rest-alert.js';
import {
  EXTENSION_SCREENS,
  EXTENSION_TOP_BAR_LAYOUT,
  MENU_LABEL,
  checkRequiredPhoneInput,
  formatSeconds,
  formatEditableSetValue,
  formatWeightValue,
  formatNextTargetSummary,
  formatActiveSetProgress,
  formatOverviewExerciseLines,
  formatSupersetProgress,
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

const DEFAULT_SCREEN_ON_SECONDS = 120;
const ALWAYS_SCREEN_ON_MS = 1800000;
const PENDING_SYNC_RETRY_MS = 15000;

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
const workoutDiagnostics = createWorkoutDiagnostics(deviceStorage, undefined, (code) => {
  if (code !== WORKOUT_DIAGNOSTIC_CODES.BUILD &&
      code !== WORKOUT_DIAGNOSTIC_CODES.SET_TAP &&
      code !== WORKOUT_DIAGNOSTIC_CODES.SET_SAVED &&
      code !== WORKOUT_DIAGNOSTIC_CODES.SET_SYNCED &&
      code !== WORKOUT_DIAGNOSTIC_CODES.FINISH_TAP) return null;
  return readWorkoutMemory(appApi.getPackageInfo, appApi.getPerformance);
});

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

function setRestVibrationMode() {
  try {
    vibrator.setMode(VIBRATOR_SCENE_STRONG_REMINDER);
    return;
  } catch (e) {
    // Firmware versions disagree with the SDK typings on the accepted signature.
  }
  try {
    vibrator.setMode({ mode: VIBRATOR_SCENE_STRONG_REMINDER });
  } catch (err) {
    console.log('[lifto-ext] vibrator mode error:', err?.message || String(err));
  }
}

function setLightVibrationMode() {
  try {
    vibrator.setMode(VIBRATOR_SCENE_SHORT_LIGHT);
    return;
  } catch (e) {
    // Firmware versions disagree with the SDK typings on the accepted signature.
  }
  try {
    vibrator.setMode({ mode: VIBRATOR_SCENE_SHORT_LIGHT });
  } catch (err) {
    console.log('[lifto-ext] vibrator light mode error:', err?.message || String(err));
  }
}

function triggerRestVibration() {
  if (isTearingDown || isPaused || !hasBuilt) return;
  const generation = lifecycleGeneration;
  try {
    stopVibration();
    if (!vibrator) {
      vibrator = new Vibrator();
    }
    setRestVibrationMode();
    vibrator.start();
    vibrationTimer = setTimeout(() => {
      if (isTearingDown || isPaused || generation !== lifecycleGeneration) return;
      vibrationTimer = null;
      stopVibration();
    }, 1400);
  } catch (err) {
    console.log('[lifto-ext] vibrator error:', err?.message || String(err));
  }
}

function triggerLightVibration() {
  if (isTearingDown || isPaused || !hasBuilt) return;
  const generation = lifecycleGeneration;
  try {
    stopVibration();
    if (!vibrator) {
      vibrator = new Vibrator();
    }
    setLightVibrationMode();
    vibrator.start();
    vibrationTimer = setTimeout(() => {
      if (isTearingDown || isPaused || generation !== lifecycleGeneration) return;
      vibrationTimer = null;
      stopVibration();
    }, 300);
  } catch (err) {
    console.log('[lifto-ext] vibrator light error:', err?.message || String(err));
  }
}

let widgetInstance = null;
let workoutController = null;
let restAlertTracker = createRestAlertTracker();
let hasBuilt = false;
let isTearingDown = false;
let isPaused = false;
let lifecycleGeneration = 0;
let initialLoadPending = false;
let restoredDisplaySettingsPending = false;
let terminalActionPending = null;
let connectionRetryTimer = null;
let connectionRetryAttempt = 0;

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
let accountSettings = { autoPrepare: readAutoPreparePreference(deviceStorage) };

let listPage = 0;
let readyPage = 0;
let overviewPage = 0;
let notesPage = 0;
let notesModalHasImage = false;
let activeNotesImageUrl = null;
let notesImageWidget = null;
let exerciseImages = null;
let preparationImageUrl = null;

let isOverviewOpen = false;
let isNotesModalOpen = false;
let activeNotesTitle = '';
let activeNotesContent = '';
let isRestMinimized = false;
let restPresentation = createRestPresentationState();
let isWorkoutTimerControlsOpen = false;
let isSyncDetailsOpen = false;
let isEditLastSetOpen = false;
let lastSetDraft = null;
let lastSetEditError = null;
let phoneRequiredReason = null;
let discardConfirmationRequested = false;

let finishState = null;
let syncWarning = null;
let controllerUiDirty = false;

let lastPendingSyncRetryAt = 0;
const nativePauseReconciler = createNativePauseReconciler();

function setRestPrepared(isPrepared) {
  isRestMinimized = Boolean(isPrepared);
  restPresentation = { ...restPresentation, isPrepared: isRestMinimized };
}

function syncRestPresentation(rest) {
  const next = updateRestPresentation(restPresentation, rest, accountSettings?.autoPrepare);
  if (next !== restPresentation) isRestMinimized = next.isPrepared;
  restPresentation = next;
}

let clockTimer = null;
// Rest countdowns and alerts need a tighter cadence; network requests and
// sport-metric sampling remain independently throttled.
const TICK_FAST_MS = 250;
const TICK_SLOW_MS = 1000;
let clockInterval = null;
let lastRenderedState = null;
let lastRenderedSecond = null;
let lastRenderedClock = null;

let activeWidgets = [];
let liveWidgets = {};

function send(type, payload = {}, options = {}) {
  if (isTearingDown) return Promise.reject(new Error('Workout page closed'));
  if (!widgetInstance || typeof widgetInstance.request !== 'function') {
    return Promise.reject(new Error('Phone not reachable'));
  }
  const timeoutMs = options.timeoutMs;
  return withRequestTimeout(widgetInstance.request(createMessage({ type, payload })), timeoutMs ? { timeoutMs } : {
    timeoutMs: PHONE_REQUEST_TIMEOUT_MS,
  }).then((res) => {
    if (isTearingDown) throw new Error('Workout page closed');
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

let isDispatchingClick = false;
let renderTimer = null;

function markControllerUiDirty() {
  if (isTearingDown) return;
  controllerUiDirty = true;
}

function scheduleRenderUI() {
  if (isTearingDown) return;
  controllerUiDirty = true;
  if (isPaused || !hasBuilt || renderTimer !== null) return;
  const generation = lifecycleGeneration;
  renderTimer = setTimeout(() => {
    if (generation !== lifecycleGeneration || isTearingDown || isPaused) return;
    renderTimer = null;
    renderUI();
  }, 0);
}

function cancelScheduledRender() {
  if (renderTimer !== null) clearTimeout(renderTimer);
  renderTimer = null;
}

function consumeControllerUiChange() {
  if (!controllerUiDirty || !workoutController) return false;
  controllerUiDirty = false;
  dayPlan = workoutController.plan();
  updateSyncWarning();
  return true;
}

function beginRequest(message) {
  isBusy = true;
  errorMessage = '';
  statusMessage = message;
  renderUI();
}

function failRequest(err) {
  if (isTearingDown) return;
  workoutDiagnostics.record(WORKOUT_DIAGNOSTIC_CODES.PHONE_FAILED);
  isBusy = false;
  statusMessage = '';
  errorMessage = err?.message || 'Request failed';
  console.log('[lifto-ext] request failed');
  renderUI();
}

function logRecoverableError(message, err) {
  if (isTearingDown) return;
  console.log(message, { code: err?.code || 'UNKNOWN' });
}

function handlePollFailure(err) {
  if (isTearingDown) return;
  logRecoverableError('[lifto-ext] workout refresh failed', err);
  const previousWarning = syncWarning;
  updateSyncWarning();
  if (previousWarning !== syncWarning) renderUI();
}

function applyNativePauseActions(actions) {
  if (isTearingDown || isPaused || !workoutController || !Array.isArray(actions) || actions.length === 0) return;
  for (const action of actions) {
    if (action.type === 'pause') {
      workoutController.pauseWorkout({ timestamp: action.timestamp, source: 'native' });
    } else if (action.type === 'resume') {
      workoutController.resumeWorkout({ timestamp: action.timestamp, source: 'native' });
    }
  }
  scheduleRenderUI();
}

const SPORT_METRICS_INTERVAL_MS = 3000;
let lastSportMetricsSampleAt = 0;

function refreshSportMetrics() {
  if (isTearingDown || isPaused || !hasBuilt) return;
  const generation = lifecycleGeneration;
  const requestedAt = Date.now();
  if (requestedAt - lastSportMetricsSampleAt < SPORT_METRICS_INTERVAL_MS) return;
  lastSportMetricsSampleAt = requestedAt;
  try {
    getSportData({ type: 'duration' }, (result) => {
      if (isTearingDown || isPaused || generation !== lifecycleGeneration) return;
      const parsed = parseSportDataResult(result, 'duration');
      const durationSeconds = parsed.ok ? parseDurationToSeconds(parsed.value) : null;
      const view = workoutController?.view();
      if (
        durationSeconds !== null &&
        (view?.state === SESSION_STATES.ACTIVE_SET || view?.state === SESSION_STATES.REST)
      ) {
        applyNativePauseActions(
          nativePauseReconciler.sample({ durationSeconds, timestamp: requestedAt })
        );
      } else if (view?.state !== SESSION_STATES.ACTIVE_SET && view?.state !== SESSION_STATES.REST) {
        nativePauseReconciler.reset();
      }
    });
  } catch (err) {
    // A missing duration sample cannot establish a pause or resume.
    return;
  }
}

function selectedScreenOnDuration() {
  const configured = accountSettings?.screenOnDuration;
  if (configured === 'always') return 'always';
  const seconds = Number(configured);
  return [60, 120, 240].includes(seconds) ? seconds : DEFAULT_SCREEN_ON_SECONDS;
}

function applyDisplayHold() {
  if (isTearingDown || isPaused || !hasBuilt) return;
  const duration = selectedScreenOnDuration();
  const durationMs = duration === 'always' ? ALWAYS_SCREEN_ON_MS : duration * 1000;
  const gestureDuration = duration === 'always' ? 0 : durationMs;
  try {
    setPageBrightTime({ brightTime: durationMs });
    pauseDropWristScreenOff({ duration: gestureDuration });
    pausePalmScreenOff({ duration: gestureDuration });
  } catch (err) {
    console.log('[lifto-ext] display hold unavailable');
  }
}

function resetDisplayHold() {
  try {
    resetPageBrightTime();
    resetDropWristScreenOff();
    resetPalmScreenOff();
  } catch (err) {
    console.log('[lifto-ext] display reset unavailable');
  }
}

function retryPendingWrites() {
  if (!workoutController) return;
  const requestedAt = Date.now();
  if (requestedAt - lastPendingSyncRetryAt < PENDING_SYNC_RETRY_MS) return;
  lastPendingSyncRetryAt = requestedAt;
  workoutController
    .retryPendingWrites()
    .then((changed) => {
      if (!changed) return;
      updateSyncWarning();
      renderUI();
    })
    .catch(handlePollFailure);
}

function syncCompletedSets() {
  const recordResult = (synced) => {
    if (isTearingDown) return;
    workoutDiagnostics.record(synced
      ? WORKOUT_DIAGNOSTIC_CODES.SET_SYNCED
      : WORKOUT_DIAGNOSTIC_CODES.SET_SYNC_FAILED);
    if (!synced) controllerUiDirty = true;
  };
  return workoutController.syncSets().then(recordResult, () => recordResult(false));
}

let restHaloWidgets = [];
let restPulseAnimHandles = [];
let restPulseAttempted = false;

function stopRestBezelAnimation() {
  restPulseAttempted = false;
  if (restPulseAnimHandles.length > 0) {
    stopRestPulseAnimation(restPulseAnimHandles, prop, anim_status);
    restPulseAnimHandles = [];
  }
}

function clearWidgets() {
  stopRestBezelAnimation();
  restHaloWidgets = [];
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
  const handler = props.click_func;
  return addRawWidget(widget.BUTTON, {
    ...props,
    click_func: typeof handler === 'function' ? (w) => {
      if (isTearingDown || isPaused || !hasBuilt) return;
      workoutDiagnostics.record(WORKOUT_DIAGNOSTIC_CODES.ACTION_TAP);
      isDispatchingClick = true;
      try {
        handler(w);
      } finally {
        isDispatchingClick = false;
      }
      if (controllerUiDirty) {
        scheduleRenderUI();
      }
    } : undefined,
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

const LIVE_WIDGET_MUTABLE_KEYS = ['x', 'y', 'w', 'h', 'text', 'color', 'text_size', 'radius', 'line_width'];

function updateLiveWidget(key, changes) {
  if (isTearingDown || isPaused || !hasBuilt) return false;
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
  const sync = workoutController?.sync() || {};
  const writes = workoutController?.getWorkoutSetWrites?.() || [];
  const pendingCount = workoutController?.getPendingSetCount?.();
  const label = [
    currentClockLabel(),
    recordingLabel(sync, writes.length, pendingCount),
  ].filter(Boolean).join(' | ');
  if (!label) return;
  lastRenderedClock = label;
  const props = {
    x: px(EXTENSION_CLOCK_LAYOUT.x),
    y: px(EXTENSION_CLOCK_LAYOUT.y),
    w: px(EXTENSION_CLOCK_LAYOUT.width),
    h: px(EXTENSION_CLOCK_LAYOUT.height),
    radius: px(4),
    normal_color: THEME.bg,
    press_color: THEME.card,
    color: THEME.textSecondary,
    text_size: font('micro'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: label,
  };
  if (canOpenSyncDetails()) {
    addLiveButton('clock', { ...props, click_func: openSyncDetailsModal });
  } else {
    const clock = addLiveLabel('clock', { ...props, press_color: THEME.bg });
    clock.setEnable(false);
  }
}

function updateClock() {
  const sync = workoutController?.sync() || {};
  const writes = workoutController?.getWorkoutSetWrites?.() || [];
  const pendingCount = workoutController?.getPendingSetCount?.();
  const label = [
    currentClockLabel(),
    recordingLabel(sync, writes.length, pendingCount),
  ].filter(Boolean).join(' | ');
  if (!label || label === lastRenderedClock) return;
  lastRenderedClock = label;
  updateLiveWidget('clock', { text: label });
}


function openNotes(title, content, imageUrl = null) {
  notesPage = 0;
  activeNotesTitle = title;
  activeNotesContent = content;
  activeNotesImageUrl = exerciseDisplayImageUrl(imageUrl);
  notesImageWidget = null;
  notesModalHasImage = Boolean(currentNotesPages()[0]?.image);
  exerciseImages?.load(activeNotesImageUrl, { retry: true, priority: true });
  isNotesModalOpen = true;
  scheduleRenderUI();
}

function renderExerciseInfo(exerciseName, details, y, height, imageUrl) {
  exerciseImages?.prefetch(imageUrl);
  addWidget(widget.BUTTON, {
    x: px(356),
    y: px(y),
    w: px(62),
    h: px(height),
    radius: px(height / 2),
    normal_color: THEME.cardActive,
    press_color: THEME.card,
    color: THEME.primaryLight,
    text: 'Info',
    text_size: font('micro'),
    click_func: () => openNotes(exerciseName,
      details || 'No exercise notes or description available.', imageUrl),
  });
}

function closeNotes() {
  isNotesModalOpen = false;
  notesModalHasImage = false;
  notesImageWidget = null;
  activeNotesTitle = '';
  activeNotesContent = '';
  notesPage = 0;
  scheduleRenderUI();
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
  const metricIconWidth = 32;
  addWidget(widget.BUTTON, {
    x: px(topBar.menu.x),
    y: px(topBar.y),
    w: px(topBar.menu.width),
    h: px(topBar.height),
    radius: px(topBar.height / 2),
    normal_color: THEME.card,
    press_color: THEME.cardActive,
    text: syncWarning ? 'Sync!' : MENU_LABEL,
    color: syncWarning ? THEME.orange : THEME.textPrimary,
    text_size: font('button'),
    click_func: onBack,
  });

  addLiveButton('elapsed', {
    x: px(topBar.elapsed.x),
    y: px(topBar.y),
    w: px(topBar.elapsed.width),
    h: px(topBar.height),
    radius: px(12),
    normal_color: THEME.bg,
    press_color: THEME.primaryDark,
    color: view.isWorkoutPaused ? THEME.yellow : THEME.primaryLight,
    text_size: font('button'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: formatSeconds(view.elapsedSeconds),
    click_func: openWorkoutTimerControls,
  });

  addLiveLabel('heart', {
    x: px(topBar.metric.x),
    y: px(topBar.y),
    w: px(metricIconWidth),
    h: px(topBar.height),
    color: THEME.textSecondary,
    normal_color: THEME.bg,
    press_color: THEME.bg,
    radius: 0,
    text_size: font('caption'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: '\u2665',
  });

  addWidget(widget.SPORT_DATA, {
    x: px(topBar.metric.x + metricIconWidth),
    y: px(topBar.y),
    w: px(topBar.metric.width - metricIconWidth),
    h: px(topBar.height),
    edit_id: 1,
    category: edit_widget_group_type.SPORTS,
    default_type: sport_data.HR,
    text_size: font('caption'),
    text_color: THEME.textSecondary,
    text_x: 0,
    text_y: 0,
    text_w: px(topBar.metric.width - metricIconWidth),
    text_h: px(topBar.height),
    sub_text_visible: false,
    rect_visible: false,
  });
}

function restStatusColor(rest) {
  if (rest?.isPaused) return THEME.yellow;
  if (rest?.isOvertime) return THEME.error;
  return THEME.primary;
}

function updateRestBezelAndHalo(rest) {
  const baseColor = restStatusColor(rest);
  if (liveWidgets.restBezel?.props.color !== baseColor) {
    if (!updateLiveWidget('restBezel', { color: baseColor })) controllerUiDirty = true;
  }
  for (let i = 1; i < restHaloWidgets.length; i++) {
    const h = restHaloWidgets[i];
    const color = darkenColor(baseColor, h.factor);
    if (h.props.color !== color && !updateLiveWidget(`restHalo_${i}`, { color })) {
      controllerUiDirty = true;
    }
  }
  if (rest?.isPaused) {
    stopRestBezelAnimation();
  } else if (!restPulseAttempted && restHaloWidgets.length > 0) {
    restPulseAttempted = true;
    restPulseAnimHandles = startRestPulseAnimation(restHaloWidgets.map((h) => h.widget), prop);
  }
}

function renderRestBezel(rest) {
  stopRestBezelAnimation();
  restHaloWidgets = [];

  const { layers } = createRestHaloLayers({
    width: W,
    height: H,
    isFitted: LAYOUT.isFitted,
  });
  const baseColor = restStatusColor(rest);

  for (const layer of layers) {
    const layerColor = darkenColor(baseColor, layer.factor);
    const props = {
      x: layer.x,
      y: layer.y,
      w: layer.w,
      h: layer.h,
      radius: layer.radius,
      line_width: layer.line_width,
      color: layerColor,
    };
    const nativeWidget = addRawWidget(widget.STROKE_RECT, props);
    restHaloWidgets.push({ widget: nativeWidget, props, factor: layer.factor });
    if (layer.index === 0) {
      liveWidgets.restBezel = { widget: nativeWidget, props };
    } else {
      liveWidgets[`restHalo_${layer.index}`] = { widget: nativeWidget, props };
    }
  }

  if (!rest?.isPaused) {
    restPulseAttempted = true;
    restPulseAnimHandles = startRestPulseAnimation(restHaloWidgets.map((h) => h.widget), prop);
  }
}

function updatePreparedRestVisuals(view) {
  if (!liveWidgets.restBezel || view.state !== SESSION_STATES.REST || !view.rest) return;
  updateRestBezelAndHalo(view.rest);
  const action = liveWidgets.actionButton;
  const actionColor = restStatusColor(view.rest);
  if (action && action.props.normal_color !== actionColor) {
    // BUTTON background updates are undocumented; replace only this action.
    const previousWidget = action.widget;
    action.props = { ...action.props, normal_color: actionColor, press_color: darkenColor(actionColor, 0.75) };
    action.widget = addActionWidget(action.props);
    deleteWidget(previousWidget);
    activeWidgets = activeWidgets.filter(item => item !== previousWidget);
  }
  for (const field of ['exercise', 'weight', 'reps', 'rpe']) {
    const key = field === 'exercise' ? 'exerciseTitle' : `${field}-value`;
    const color = getChangedFieldTextColor({
      isChanged: view.pending?.changes[field], isResting: true, rest: view.rest,
      primaryColor: THEME.primaryLight, normalColor: THEME.textPrimary,
    });
    if (liveWidgets[key] && liveWidgets[key].props.color !== color) {
      if (!updateLiveWidget(key, { color })) controllerUiDirty = true;
    }
  }
}

function renderPreparedTopBar(view, onRest) {
  const topBar = PREPARED_TOP_BAR_LAYOUT;
  const metricIconWidth = 32;
  addWidget(widget.BUTTON, {
    x: px(topBar.menu.x), y: px(topBar.y), w: px(topBar.menu.width), h: px(topBar.height),
    radius: px(topBar.height / 2), normal_color: THEME.card, press_color: THEME.cardActive,
    text: syncWarning ? 'Sync!' : '<',
    color: syncWarning ? THEME.orange : THEME.textPrimary,
    text_size: font('button'), click_func: onRest,
  });
  addLiveButton('elapsed', {
    x: px(topBar.elapsed.x), y: px(topBar.y), w: px(topBar.elapsed.width), h: px(topBar.height),
    radius: px(12), normal_color: THEME.bg, press_color: THEME.primaryDark,
    color: view.isWorkoutPaused ? THEME.yellow : THEME.primaryLight,
    text_size: font('button'), align_h: align.CENTER_H, align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: formatSeconds(view.elapsedSeconds), click_func: openWorkoutTimerControls,
  });
  addLiveLabel('heart', {
    x: px(topBar.metric.x), y: px(topBar.y), w: px(metricIconWidth), h: px(topBar.height),
    radius: px(topBar.height / 2), normal_color: THEME.card, press_color: THEME.card,
    color: THEME.textSecondary, text_size: font('caption'), text: '\u2665',
    text_style: text_style.NONE,
  });
  addWidget(widget.SPORT_DATA, {
    x: px(topBar.metric.x + metricIconWidth), y: px(topBar.y),
    w: px(topBar.metric.width - metricIconWidth), h: px(topBar.height),
    edit_id: 2, category: edit_widget_group_type.SPORTS, default_type: sport_data.HR,
    text_size: font('caption'), text_color: THEME.textSecondary,
    text_x: 0, text_y: 0, text_w: px(topBar.metric.width - metricIconWidth),
    text_h: px(topBar.height), sub_text_visible: false, rect_visible: false,
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
        scheduleRenderUI();
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
        scheduleRenderUI();
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
  renderTitle(PHONE_CONNECTION_TITLE, THEME.orange);

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
    text: phoneConnectionMessage(connectionRetryAttempt),
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
    click_func: retryConnection,
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
      scheduleRenderUI();
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
      scheduleRenderUI();
    },
  });

  const last = outline?.lastWorkout;
  addWidget(widget.TEXT, {
    x: px(74),
    y: px(394),
    w: px(332),
    h: px(28),
    color: THEME.textSecondary,
    text_size: font('micro'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: last && last.dayName ? `Last: ${last.dayName}` : 'No workout recorded yet',
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
          scheduleRenderUI();
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
    scheduleRenderUI();
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
      scheduleRenderUI();
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
      scheduleRenderUI();
    },
  });
}

function renderReadyScreen(view) {
  renderTitle(formatWorkoutPosition(view.week, view.dayInWeek));
  renderSubtitle(truncate(view.programName || '', 30));

  const ready = readyExercisePage(view.overviewExercises, readyPage);
  const { exercises, page, totalPages } = ready;
  const imagesEnabled = normalizeExerciseImages(accountSettings?.exerciseImages);
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
    const rowY = 112 + index * 84;
    let showsImage = imagesEnabled && Boolean(exercise.imageUrl);
    let image = null;

    if (showsImage) {
      exerciseImages?.load(exercise.imageUrl);
      image = exerciseImages?.get(exercise.imageUrl);
      if (image?.status === 'unavailable') showsImage = false;
    }

    if (exercise.supersetGroup) {
      addWidget(widget.FILL_RECT, {
        x: px(68),
        y: px(rowY + 6),
        w: px(5),
        h: px(64),
        radius: px(3),
        color: supersetColor(exercise.supersetGroup),
      });
    }

    if (image?.status === 'ready') {
      addWidget(widget.FILL_RECT, {
        x: px(76),
        y: px(rowY + 4),
        w: px(70),
        h: px(70),
        radius: px(12),
        color: 0xffffff,
      });
      addWidget(widget.IMG, {
        x: px(80),
        y: px(rowY + 8),
        w: px(62),
        h: px(62),
        src: image.src,
        auto_scale: true,
        auto_scale_obj_fit: false,
      });
    }

    addWidget(widget.TEXT, {
      x: px(showsImage ? 154 : 78),
      y: px(rowY + 6),
      w: px(showsImage ? 248 : 324),
      h: px(32),
      color: THEME.textPrimary,
      text_size: font('caption'),
      align_h: align.LEFT,
      align_v: align.TOP,
      text_style: text_style.NONE,
      text: exercise.name,
    });

    addWidget(widget.TEXT, {
      x: px(showsImage ? 154 : 78),
      y: px(rowY + 40),
      w: px(showsImage ? 248 : 324),
      h: px(28),
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
        scheduleRenderUI();
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
        scheduleRenderUI();
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
      scheduleRenderUI();
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
      nativePauseReconciler.reset();
      workoutController.startWorkout();
      scheduleRenderUI();
    },
  });
}

function renderStepper({ key, y, height, label, value, valueColor = THEME.textPrimary, onMinus, onPlus }) {
  const buttonSize = px(height);
  const row = stepperRowLayout(height);
  const valueHeight = px(row.valueHeight);
  const labelHeight = px(row.labelHeight);

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

  addLiveLabel(`${key}-value`, {
    x: px(142),
    y,
    w: px(196),
    h: valueHeight,
    color: valueColor,
    text_size: font('value'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: value,
  });

  addLiveLabel(`${key}-label`, {
    x: px(142),
    y: y + valueHeight,
    w: px(196),
    h: labelHeight,
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

function refreshActiveSetControls() {
  const view = workoutController.view();
  const isResting = view.state === SESSION_STATES.REST && view.rest;
  const pending = view.pending;
  const set = (isResting && pending ? pending.set : null) || view.currentSet;
  const loadingEquipment = isResting && pending ? pending.loadingEquipment : view.loadingEquipment;
  if (!set) return;

  consumeControllerUiChange();
  const hasPurpleBezel = isPurpleRestRing({ isResting, rest: view.rest, hasRing: Boolean(liveWidgets.restBezel) });
  const updates = [
    updateLiveWidget('exerciseTitle', {
      color: hasPurpleBezel && pending?.changes.exercise ? THEME.primaryLight : THEME.textPrimary,
    }),
    updateLiveWidget('weight-value', {
      text: set.weight === null || set.weight === undefined ? '-' : String(set.weight),
      color: hasPurpleBezel && pending?.changes.weight ? THEME.primaryLight : THEME.textPrimary,
    }),
    updateLiveWidget('weight-label', {
      text: formatLoadoutLabel(
        set.weight,
        loadingEquipment,
        view.unit,
        set.plates,
        set.targetWeight,
      ) || (view.unit || 'KG').toUpperCase(),
    }),
    updateLiveWidget('reps-value', {
      text: formatEditableSetValue(set.reps, set.isAmrap),
      color: hasPurpleBezel && pending?.changes.reps ? THEME.primaryLight : THEME.textPrimary,
    }),
    updateLiveWidget('rpe-value', {
      text: formatEditableSetValue(set.rpe, set.logRpe),
      color: hasPurpleBezel && pending?.changes.rpe ? THEME.primaryLight : THEME.textPrimary,
    }),
  ];
  if (updates.includes(false)) controllerUiDirty = true;
}

let renderedTimedPhase = null;
let timedTargetAlerted = false;
let timedAlertIdentity = null;

function addLiveShape(key, props) {
  const fitted = LAYOUT.fit(props);
  const nativeWidget = addRawWidget(widget.FILL_RECT, fitted);
  liveWidgets[key] = { widget: nativeWidget, props: { ...fitted } };
}

function renderTimedSetScreen(view) {
  const timer = view.timedSet;
  const identity = timedSetIdentity(view);
  const ui = timedSetPresentation(timer);
  const layout = TIMED_SET_LAYOUT;
  renderedTimedPhase = timer.phase;
  renderTopBar(view, () => { isOverviewOpen = true; renderUI(); });
  renderExerciseInfo(view.exerciseName, view.exerciseDetails, 88, 36, view.exerciseImageUrl);
  const label = (key, y, h, text, size, color = THEME.textPrimary) => addLiveLabel(key, {
    x: px(62), y: px(y), w: px(356), h: px(h), text, text_size: font(size),
    color, normal_color: THEME.bg, press_color: THEME.bg, radius: 0,
  });
  addWidget(widget.TEXT, { x: px(62), y: px(92), w: px(280), h: px(30),
    color: THEME.textPrimary, text_size: font('title'), align_h: align.CENTER_H,
    text: truncate(view.exerciseName, 20) });
  label('timedSide', 126, 28, `SET ${view.currentSetIndex + 1}/${view.totalSets}${timer.side ? ' - ' + timer.side : ''}`, 'caption');
  for (let i = 0; i < layout.segments; i += 1) {
    const angle = i * Math.PI * 2 / layout.segments - Math.PI / 2;
    addLiveShape(`timedSegment${i}`, {
      x: px(layout.centerX + Math.cos(angle) * layout.horizontalRadius - layout.dotSize / 2),
      y: px(layout.centerY + Math.sin(angle) * layout.radius - layout.dotSize / 2),
      w: px(layout.dotSize), h: px(layout.dotSize), radius: px(layout.dotSize / 2),
      color: i / layout.segments < ui.progress ? ui.color : THEME.card,
    });
  }
  addLiveLabel('timedValue', { x: px(layout.valueX), y: px(layout.valueY), w: px(layout.valueWidth), h: px(layout.valueHeight),
    text: ui.value, text_size: font(ui.valueFont), color: ui.color, normal_color: THEME.bg, press_color: THEME.bg });
  label('timedLabel', layout.labelY, 30, ui.label, 'title', ui.color);
  label('timedDetail', layout.detailY, 28, ui.detail, 'caption', THEME.textSecondary);
  const action = (index, text, callback) => addWidget(widget.BUTTON, {
    x: px(layout.actionX + index * (layout.actionWidth + layout.actionGap)), y: px(layout.actionY),
    w: px(layout.actionWidth), h: px(layout.actionHeight), radius: px(layout.actionHeight / 2),
    normal_color: THEME.card, press_color: THEME.cardActive, text, text_size: font('button'),
    click_func: () => {
      const currentView = workoutController.view();
      if (timedSetIdentity(currentView) !== identity) return;
      callback(currentView.timedSet);
      controllerUiDirty = true;
    },
  });
  action(0, ui.pauseAction, (current) => {
    if (current.isWorkoutPaused) return;
    if (current.isPaused) workoutController.resumeTimedSet();
    else workoutController.pauseTimedSet();
  });
  action(1, ui.action, (current) => {
    if (current.isWorkoutPaused || current.isPaused) return;
    if (current.phase === 'GET_READY') workoutController.startTimedSet();
    else {
      workoutDiagnostics.record(WORKOUT_DIAGNOSTIC_CODES.SET_TAP);
      workoutController.stopTimedSide();
      workoutDiagnostics.record(WORKOUT_DIAGNOSTIC_CODES.SET_SAVED);
      syncCompletedSets();
      if (workoutController.view().state === SESSION_STATES.FINISHED) submitWorkout();
    }
  });
}

function updateTimedSetScreen(view) {
  const timer = view.timedSet;
  if (!timer || timer.phase === 'READY' || timer.phase === 'REST') {
    if (renderedTimedPhase) { renderedTimedPhase = null; renderUI(); }
    return false;
  }
  const ui = timedSetPresentation(timer);
  const identity = timedSetIdentity(view);
  if (identity !== timedAlertIdentity) { timedTargetAlerted = false; timedAlertIdentity = identity; }
  if (timer.phase !== renderedTimedPhase && !isOverviewOpen) { renderUI(); return true; }
  if (timer.phase !== 'WORK' || timer.remaining > 0) timedTargetAlerted = false;
  if (timer.phase === 'WORK' && timer.remaining <= 0 && !timer.isPaused && !timer.isWorkoutPaused && !timedTargetAlerted) {
    timedTargetAlerted = true;
    triggerRestVibration();
  }
  updateLiveWidget('timedValue', { text: ui.value, color: ui.color, text_size: font(ui.valueFont) });
  updateLiveWidget('timedLabel', { text: ui.label, color: ui.color });
  updateLiveWidget('timedDetail', { text: ui.detail });
  for (let i = 0; i < TIMED_SET_LAYOUT.segments; i += 1) {
    updateLiveWidget(`timedSegment${i}`, { color: i / TIMED_SET_LAYOUT.segments < ui.progress ? ui.color : THEME.card });
  }
  return true;
}

function renderActiveSetScreen(view) {
  const isResting = view.state === SESSION_STATES.REST && view.rest;
  const pending = view.pending;
  const set = (isResting && pending ? pending.set : null) || view.currentSet;
  const exerciseName = isResting && pending ? pending.exerciseName : view.exerciseName;
  const exerciseDetails = isResting && pending ? pending.exerciseDetails : view.exerciseDetails;
  const supersetGroup = isResting && pending ? pending.supersetGroup : view.supersetGroup;
  const supersetContext = isResting && pending ? pending.supersetContext : view.supersetContext;
  const setIndex = isResting && pending ? pending.setIndex : view.currentSetIndex;
  const totalSets = isResting && pending ? pending.totalSets : view.totalSets;
  const loadingEquipment = isResting && pending ? pending.loadingEquipment : view.loadingEquipment;
  const canSkipWarmup = Boolean(set?.isWarmup && (!view.timedSet || view.timedSet.phase === 'READY'));
  const controls = extensionActiveSetLayout(set);

  if (isResting) {
    renderRestBezel(view.rest);
    renderPreparedTopBar(view, () => {
      setRestPrepared(false);
      scheduleRenderUI();
    });
  } else {
    renderTopBar(view, () => {
      isOverviewOpen = true;
      scheduleRenderUI();
    });
  }

  const showsPreparationImage = isResting && !canSkipWarmup && renderPreparationImage(pending?.exerciseImageUrl);
  const headerX = (canSkipWarmup || showsPreparationImage) ? 132 : 64;
  const headerWidth = (canSkipWarmup || showsPreparationImage) ? 216 : 282;
  const hasPurpleBezel = isPurpleRestRing({ isResting, rest: view.rest });

  addLiveLabel('exerciseTitle', {
    x: px(headerX),
    y: px(92),
    w: px(headerWidth),
    h: px(30),
    color: (hasPurpleBezel && pending?.changes.exercise) ? THEME.primaryLight : THEME.textPrimary,
    text_size: font('title'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: formatMarqueeText(exerciseName, 16),
  });

  renderExerciseInfo(exerciseName, exerciseDetails, 88, 38, isResting && pending ? pending.exerciseImageUrl : view.exerciseImageUrl);

  if (canSkipWarmup) {
    addWidget(widget.BUTTON, {
      x: px(62),
      y: px(88),
      w: px(64),
      h: px(38),
      radius: px(19),
      normal_color: THEME.card,
      press_color: THEME.cardActive,
      color: 0xffb544,
      text: 'Skip',
      text_size: font('caption'),
      click_func: () => {
        const skipped = workoutController.skipWarmup();
        controllerUiDirty = true;
        if (skipped && workoutController.view().state === SESSION_STATES.FINISHED) submitWorkout();
      },
    });
  }

  const ssColor = supersetColor(supersetGroup);
  addWidget(widget.TEXT, {
    x: px(headerX),
    y: px(124),
    w: px(headerWidth),
    h: px(26),
    color: set?.isWarmup ? 0xffb544 : (supersetGroup ? ssColor : THEME.textSecondary),
    text_size: font('caption'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: formatActiveSetProgress(set, setIndex, totalSets),
  });

  if (supersetContext) {
    addWidget(widget.TEXT, {
      x: px(headerX),
      y: px(148),
      w: px(headerWidth),
      h: px(22),
      color: THEME.textSecondary,
      text_size: font('micro'),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: supersetContext.nextExerciseName
        ? `Next: ${truncate(supersetContext.nextExerciseName, 28)}`
        : 'Last set',
    });
  }

  // Steppers
  renderStepper({
    key: 'weight',
    y: px(controls.rows[0].y),
    height: controls.rowHeight,
    label: formatLoadoutLabel(set?.weight, loadingEquipment, view.unit, set?.plates, set?.targetWeight) || (view.unit || 'KG').toUpperCase(),
    value: set?.weight === null || set?.weight === undefined ? '-' : String(set.weight),
    valueColor: (hasPurpleBezel && pending?.changes.weight) ? THEME.primaryLight : THEME.textPrimary,
    onMinus: () => {
      workoutController.adjustWeight(-1);
      refreshActiveSetControls();
    },
    onPlus: () => {
      workoutController.adjustWeight(1);
      refreshActiveSetControls();
    },
  });

  renderStepper({
    key: 'reps',
    y: px(controls.rows[1].y),
    height: controls.rowHeight,
    label: 'REPS',
    value: formatEditableSetValue(set?.reps, set?.isAmrap),
    valueColor: (hasPurpleBezel && pending?.changes.reps) ? THEME.primaryLight : THEME.textPrimary,
    onMinus: () => {
      workoutController.adjustReps(-1);
      refreshActiveSetControls();
    },
    onPlus: () => {
      workoutController.adjustReps(1);
      refreshActiveSetControls();
    },
  });

  if (controls.showRpe) {
    renderStepper({
      key: 'rpe',
      y: px(controls.rows[2].y),
      height: controls.rowHeight,
      label: 'RPE',
      value: formatEditableSetValue(set?.rpe, set?.logRpe),
      valueColor: (hasPurpleBezel && pending?.changes.rpe) ? THEME.primaryLight : THEME.textPrimary,
      onMinus: () => {
        workoutController.adjustRpe(-0.5);
        refreshActiveSetControls();
      },
      onPlus: () => {
        workoutController.adjustRpe(0.5);
        refreshActiveSetControls();
      },
    });
  }

  // Action button
  const actionText = view.timedSet?.phase === 'REST' ? 'Armed'
    : isResting ? (view.rest ? `> Start set ${formatSeconds(view.rest.remaining)}` : '> Start set')
    : view.timedSet ? (set.isUnilateral ? 'Start left' : 'Start set') : 'Done';

  addLiveButton('actionButton', {
    x: px(ACTIVE_SET_ACTION_LAYOUT.x),
    y: px(controls.actionY),
    w: px(ACTIVE_SET_ACTION_LAYOUT.width),
    h: px(controls.actionHeight),
    radius: px(controls.actionHeight / 2),
    normal_color: isResting ? restStatusColor(view.rest) : THEME.success,
    press_color: isResting ? darkenColor(restStatusColor(view.rest), 0.75) : 0x1c9c6d,
    color: isResting ? THEME.bg : 0x00281c,
    text: actionText,
    text_size: font('button'),
    click_func: () => {
      if (!isResting && view.timedSet) {
        const reason = checkRequiredPhoneInput(set);
        if (reason) { phoneRequiredReason = reason; controllerUiDirty = true; return; }
        timedTargetAlerted = false;
        workoutController.startTimedSet();
        controllerUiDirty = true;
        return;
      }
      if (isResting) {
        const reason = view.timedSet && checkRequiredPhoneInput(set);
        if (reason) { phoneRequiredReason = reason; controllerUiDirty = true; return; }
        restAlertTracker.reset();
        stopVibration();
        setRestPrepared(false);
        if (view.timedSet) workoutController.startTimedSet();
        else workoutController.nextSet();
        controllerUiDirty = true;
        return;
      }

      const phoneReason = checkRequiredPhoneInput(set);
      if (phoneReason) {
        phoneRequiredReason = phoneReason;
        controllerUiDirty = true;
        return;
      }

      phoneRequiredReason = null;
      workoutDiagnostics.record(WORKOUT_DIAGNOSTIC_CODES.SET_TAP);
      workoutController.completeSet({
        repsLeft: set?.isUnilateral ? set.reps : null,
      });
      workoutDiagnostics.record(WORKOUT_DIAGNOSTIC_CODES.SET_SAVED);
      syncCompletedSets();
      if (workoutController.view().state === SESSION_STATES.FINISHED) {
        submitWorkout();
      }
    },
  });
}

function renderRestScreen(view) {
  const rest = view.rest;
  renderTopBar(view, () => {
    isOverviewOpen = true;
    scheduleRenderUI();
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

  addLiveButton('restValue', {
    x: px(62),
    y: px(118),
    w: px(356),
    h: px(64),
    radius: px(12),
    normal_color: THEME.bg,
    press_color: THEME.primaryDark,
    color: restColor,
    text_size: font('timer'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: formatSeconds(rest.remaining),
    click_func: openWorkoutTimerControls,
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
      scheduleRenderUI();
    },
  });

  addLiveButton('restPause', {
    x: px(164),
    y: px(190),
    w: px(152),
    h: px(44),
    radius: px(22),
    normal_color: rest.isPaused ? THEME.yellow : THEME.card,
    press_color: THEME.cardActive,
    color: rest.isPaused ? 0x000000 : THEME.textPrimary,
    text: rest.isWorkoutPaused ? 'Zepp paused' : (rest.isPaused ? 'Resume' : 'Pause'),
    text_size: font('caption'),
    click_func: () => {
      if (workoutController.view().rest?.isWorkoutPaused) return;
      workoutController.toggleRestPause();
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
      scheduleRenderUI();
    },
  });

  // Next Set Preview Card
  if (rest.nextExerciseName) {
    const ssColor = supersetColor(rest.nextSupersetGroup);
    const ssText = rest.nextSupersetGroup ? ` (SS ${rest.nextSupersetGroup})` : '';
    const nextLoadoutLabel = formatLoadoutLabel(
      rest.nextTargetWeight,
      view.pending?.loadingEquipment,
      rest.nextUnit,
      view.pending?.set?.plates || rest.nextPlates,
      rest.nextTargetWeight
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
      w: px(300),
      h: px(26),
      color: THEME.textPrimary,
      text_size: font('body'),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `Next: ${truncate(rest.nextExerciseName, 20)}`,
    });

    renderExerciseInfo(rest.nextExerciseName, rest.nextExerciseDetails, 246, 32, rest.nextExerciseImageUrl);

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
      text: formatSupersetProgress(rest.nextSupersetContext) || setProg,
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

  const actions = extensionRestActionsLayout(rest.remaining);
  if (actions.prepare) {
    addWidget(widget.BUTTON, {
      x: px(actions.prepare.x),
      y: px(actions.y),
      w: px(actions.prepare.width),
      h: px(actions.height),
      radius: px(actions.height / 2),
      normal_color: THEME.cardActive,
      press_color: THEME.card,
      text: 'Prepare',
      text_size: font('button'),
      click_func: () => {
        setRestPrepared(true);
        scheduleRenderUI();
      },
    });
  }

  addWidget(widget.BUTTON, {
    x: px(actions.start.x),
    y: px(actions.y),
    w: px(actions.start.width),
    h: px(actions.height),
    radius: px(actions.height / 2),
    normal_color: THEME.primary,
    press_color: THEME.primaryDeep,
    text: view.timedSet?.phase === 'REST' ? 'Armed' : 'Start set',
    text_size: font('button'),
    click_func: () => {
      const reason = view.timedSet && checkRequiredPhoneInput(view.pending?.set || view.currentSet);
      if (reason) { phoneRequiredReason = reason; controllerUiDirty = true; return; }
      restAlertTracker.reset();
      stopVibration();
      setRestPrepared(false);
      if (view.timedSet) workoutController.startTimedSet();
      else workoutController.nextSet();
      scheduleRenderUI();
    },
  });
}

function renderPreparationImage(apiImageUrl) {
  if (!normalizeExerciseImages(accountSettings?.exerciseImages)) return false;
  const imageUrl = exerciseDisplayImageUrl(apiImageUrl);
  if (!imageUrl) return false;
  preparationImageUrl = imageUrl;
  exerciseImages?.load(imageUrl);
  const image = exerciseImages?.get(imageUrl);
  if (image?.status === 'unavailable') return false;
  if (image?.status === 'ready') {
    addWidget(widget.FILL_RECT, {
      x: px(62),
      y: px(88),
      w: px(64),
      h: px(64),
      radius: px(12),
      color: 0xffffff,
    });
    addWidget(widget.IMG, {
      x: px(66), y: px(92), w: px(56), h: px(56), src: image.src,
      auto_scale: true, auto_scale_obj_fit: false,
    });
  }
  return true;
}

function openWorkoutTimerControls() {
  isWorkoutTimerControlsOpen = true;
  controllerUiDirty = true;
  scheduleRenderUI();
}

function closeWorkoutTimerControls() {
  isWorkoutTimerControlsOpen = false;
  controllerUiDirty = true;
  scheduleRenderUI();
}

function renderWorkoutTimerControlsModal(view) {
  const layout = WORKOUT_TIMER_MODAL_LAYOUT;
  const isPaused = view.isWorkoutPaused;
  const stateText = view.isNativeWorkoutPaused && !view.isManualWorkoutPaused
    ? 'Zepp paused'
    : (isPaused ? 'Paused' : 'Running');

  addWidget(widget.FILL_RECT, {
    x: px(layout.panelX),
    y: px(layout.panelY),
    w: px(layout.panelWidth),
    h: px(layout.panelHeight),
    radius: px(layout.panelRadius),
    color: THEME.card,
  });
  addWidget(widget.TEXT, {
    x: px(layout.contentX),
    y: px(layout.titleY),
    w: px(layout.contentWidth),
    h: px(34),
    color: THEME.textPrimary,
    text_size: font('title'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: 'Workout timer',
  });
  addLiveLabel('workoutTimerModalState', {
    x: px(layout.contentX),
    y: px(layout.stateY),
    w: px(layout.contentWidth),
    h: px(28),
    color: isPaused ? THEME.yellow : THEME.textSecondary,
    text_size: font('body'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: stateText,
  });
  addLiveLabel('workoutTimerModalValue', {
    x: px(layout.contentX),
    y: px(layout.valueY),
    w: px(layout.contentWidth),
    h: px(layout.valueHeight),
    color: isPaused ? THEME.yellow : THEME.primaryPale,
    text_size: font('timer'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: formatSeconds(view.elapsedSeconds),
  });
  addLiveButton('workoutTimerModalPause', {
    x: px(layout.pauseX),
    y: px(layout.pauseY),
    w: px(layout.pauseWidth),
    h: px(layout.pauseHeight),
    radius: px(layout.pauseHeight / 2),
    normal_color: view.isManualWorkoutPaused ? THEME.yellow : THEME.primary,
    press_color: view.isManualWorkoutPaused ? THEME.yellow : THEME.primaryDark,
    color: view.isManualWorkoutPaused ? 0x000000 : THEME.textPrimary,
    text: view.isNativeWorkoutPaused && !view.isManualWorkoutPaused
      ? 'Zepp paused'
      : (view.isManualWorkoutPaused ? 'Resume' : 'Pause'),
    text_size: font('button'),
    click_func: () => {
      const current = workoutController.view();
      if (current.isNativeWorkoutPaused && !current.isManualWorkoutPaused) return;
      if (current.isManualWorkoutPaused) workoutController.resumeWorkout();
      else workoutController.pauseWorkout();
    },
  });
  addLiveButton('workoutTimerModalClose', {
    x: px(layout.closeX),
    y: px(layout.closeY),
    w: px(layout.closeWidth),
    h: px(layout.closeHeight),
    radius: px(layout.closeHeight / 2),
    normal_color: THEME.cardActive,
    press_color: THEME.card,
    color: THEME.textPrimary,
    text: 'Close',
    text_size: font('caption'),
    click_func: closeWorkoutTimerControls,
  });
}

function canOpenSyncDetails() {
  if (isEditLastSetOpen || isNotesModalOpen || isWorkoutTimerControlsOpen) return false;
  const state = workoutController?.view().state;
  return state === SESSION_STATES.ACTIVE_SET || state === SESSION_STATES.REST ||
    state === SESSION_STATES.FINISHED;
}

function openSyncDetailsModal() {
  if (isTearingDown || isPaused) return;
  if (!canOpenSyncDetails()) return;
  if (isSyncDetailsOpen) {
    closeSyncDetailsModal();
    return;
  }
  isSyncDetailsOpen = true;
  lastSetEditError = null;
  controllerUiDirty = true;
  scheduleRenderUI();
}

function closeSyncDetailsModal() {
  if (isTearingDown || isPaused) return;
  isSyncDetailsOpen = false;
  controllerUiDirty = true;
  scheduleRenderUI();
}

function startEditLastSet() {
  if (isTearingDown || isPaused) return;
  const draftResult = workoutController?.createLastSetDraft?.();
  if (!draftResult || !draftResult.success || !draftResult.draft) {
    lastSetEditError = draftResult?.reason || 'Cannot edit this set.';
    scheduleRenderUI();
    return;
  }
  lastSetEditError = null;
  lastSetDraft = draftResult.draft;
  isSyncDetailsOpen = false;
  isEditLastSetOpen = true;
  controllerUiDirty = true;
  scheduleRenderUI();
}

function cancelEditLastSet() {
  if (isTearingDown || isPaused) return;
  isEditLastSetOpen = false;
  lastSetDraft = null;
  lastSetEditError = null;
  controllerUiDirty = true;
  scheduleRenderUI();
}

function saveEditLastSet() {
  if (isTearingDown || isPaused) return;
  const result = workoutController?.saveLastSetCorrection?.(lastSetDraft);
  if (!result?.success) {
    lastSetEditError = result?.reason || 'Could not save. Try again.';
    controllerUiDirty = true;
    scheduleRenderUI();
    return;
  }
  lastSetEditError = null;
  isEditLastSetOpen = false;
  lastSetDraft = null;
  controllerUiDirty = true;
  scheduleRenderUI();
}

function renderSyncDetailsModal() {
  const layout = WORKOUT_TIMER_MODAL_LAYOUT;
  addWidget(widget.FILL_RECT, {
    x: px(layout.panelX),
    y: px(layout.panelY),
    w: px(layout.panelWidth),
    h: px(layout.panelHeight),
    radius: px(layout.panelRadius),
    color: THEME.card,
  });

  addWidget(widget.TEXT, {
    x: px(layout.contentX),
    y: px(layout.titleY),
    w: px(layout.contentWidth),
    h: px(34),
    color: THEME.textPrimary,
    text_size: font('title'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: 'Sync status',
  });

  const sync = workoutController?.sync() || {};
  const writes = workoutController?.getWorkoutSetWrites?.() || [];
  const pendingCount = workoutController?.getPendingSetCount?.();
  const details = recordingDetails(sync, {
    completedCount: writes.length,
    pendingCount,
  });

  const statusColor = (details.statusLabel === 'Conflict' || details.statusLabel === 'Recovery')
    ? THEME.yellow
    : (details.statusLabel === 'Synced' ? THEME.success : THEME.textPrimary);

  addWidget(widget.TEXT, {
    x: px(layout.contentX),
    y: px(layout.stateY),
    w: px(layout.contentWidth),
    h: px(28),
    color: statusColor,
    text_size: font('body'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: details.statusLabel || 'On watch',
  });

  addWidget(widget.TEXT, {
    x: px(layout.contentX),
    y: px(layout.valueY),
    w: px(layout.contentWidth),
    h: px(110),
    color: THEME.textSecondary,
    text_size: font('caption'),
    align_h: align.CENTER_H,
    align_v: align.TOP,
    text_style: text_style.WRAP,
    text: lastSetEditError || details.description,
  });

  const canEdit = workoutController?.canCorrectLastSet?.() || { allowed: false, reason: 'Unavailable' };
  if (canEdit.allowed) {
    addWidget(widget.BUTTON, {
      x: px(layout.pauseX),
      y: px(layout.pauseY),
      w: px(layout.pauseWidth),
      h: px(layout.pauseHeight),
      radius: px(layout.pauseHeight / 2),
      normal_color: THEME.primary,
      press_color: THEME.primaryDeep,
      color: THEME.textPrimary,
      text: 'Edit last set',
      text_size: font('button'),
      click_func: startEditLastSet,
    });
  } else {
    addWidget(widget.BUTTON, {
      x: px(layout.pauseX),
      y: px(layout.pauseY),
      w: px(layout.pauseWidth),
      h: px(layout.pauseHeight),
      radius: px(layout.pauseHeight / 2),
      normal_color: THEME.cardActive,
      press_color: THEME.cardActive,
      color: THEME.textSecondary,
      text: canEdit.reason ? `No edit: ${canEdit.reason}` : 'Cannot edit last set',
      text_size: font('micro'),
    });
  }

  addWidget(widget.BUTTON, {
    x: px(layout.closeX),
    y: px(layout.closeY),
    w: px(layout.closeWidth),
    h: px(layout.closeHeight),
    radius: px(layout.closeHeight / 2),
    normal_color: THEME.cardActive,
    press_color: THEME.card,
    color: THEME.textPrimary,
    text: 'Close',
    text_size: font('caption'),
    click_func: closeSyncDetailsModal,
  });
}

function renderEditLastSetScreen() {
  const draft = lastSetDraft;
  if (!draft) return;
  const layout = SET_CORRECTION_LAYOUT;

  addWidget(widget.BUTTON, {
    x: px(layout.titleX),
    y: px(layout.titleY),
    w: px(layout.titleWidth),
    h: px(layout.titleHeight),
    radius: px(1),
    normal_color: THEME.bg,
    press_color: THEME.bg,
    color: THEME.primaryLight,
    text_size: font('title'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text: formatMarqueeText(draft.exerciseName || 'Last set', 16),
  });

  const setLabel = `Set ${draft.setIndex}${draft.isWarmup ? ' (Warmup)' : ''}`;
  addWidget(widget.TEXT, {
    x: px(layout.setX),
    y: px(layout.setY),
    w: px(layout.setWidth),
    h: px(layout.setHeight),
    color: THEME.textSecondary,
    text_size: font('body'),
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text: setLabel,
  });

  const step = draft.step;
  renderStepper({
    key: 'edit-weight',
    y: px(layout.weightY),
    height: layout.rowHeight,
    label: draft.unit.toUpperCase(),
    value: draft.weight === null ? '-' : String(draft.weight),
    onMinus: () => {
      draft.weight = Math.max(0, Math.round((draft.weight - step) * 100) / 100);
      scheduleRenderUI();
    },
    onPlus: () => {
      draft.weight = Math.max(0, Math.round((draft.weight + step) * 100) / 100);
      scheduleRenderUI();
    },
  });

  renderStepper({
    key: 'edit-reps',
    y: px(layout.repsY),
    height: layout.rowHeight,
    label: 'REPS',
    value: String(draft.reps),
    onMinus: () => {
      draft.reps = Math.max(0, Math.round(draft.reps - 1));
      scheduleRenderUI();
    },
    onPlus: () => {
      draft.reps = Math.max(0, Math.round(draft.reps + 1));
      scheduleRenderUI();
    },
  });

  addWidget(widget.BUTTON, {
    x: px(layout.cancelX),
    y: px(layout.actionY),
    w: px(layout.actionWidth),
    h: px(layout.actionHeight),
    radius: px(layout.actionHeight / 2),
    normal_color: THEME.card,
    press_color: THEME.cardActive,
    color: THEME.textPrimary,
    text: 'Cancel',
    text_size: font('button'),
    click_func: cancelEditLastSet,
  });

  addWidget(widget.BUTTON, {
    x: px(layout.saveX),
    y: px(layout.actionY),
    w: px(layout.actionWidth),
    h: px(layout.actionHeight),
    radius: px(layout.actionHeight / 2),
    normal_color: THEME.primary,
    press_color: THEME.primaryDeep,
    color: THEME.textPrimary,
    text: 'Save',
    text_size: font('button'),
    click_func: saveEditLastSet,
  });
  if (lastSetEditError) {
    addWidget(widget.TEXT, {
      x: px(layout.errorX), y: px(layout.errorY),
      w: px(layout.errorWidth), h: px(layout.errorHeight),
      color: THEME.error, text_size: font('micro'),
      align_h: align.CENTER_H, align_v: align.TOP,
      text_style: text_style.WRAP, text: lastSetEditError,
    });
  }

}

function renderOverviewScreen(view) {
  renderTopBar(view, () => {
    isOverviewOpen = false;
    scheduleRenderUI();
  });

  const all = view.overviewExercises || [];
  const imagesEnabled = normalizeExerciseImages(accountSettings?.exerciseImages);
  const totalPages = Math.max(1, Math.ceil(all.length / OVERVIEW_PAGE_SIZE));
  if (overviewPage >= totalPages) overviewPage = totalPages - 1;
  if (overviewPage < 0) overviewPage = 0;

  const start = overviewPage * OVERVIEW_PAGE_SIZE;
  let rowY = 94;

  all.slice(start, start + OVERVIEW_PAGE_SIZE).forEach((ex, i) => {
    const idx = start + i;
    const currentTargetIndex = view.state === SESSION_STATES.REST
      ? (view.pending?.exerciseIndex ?? view.currentExerciseIndex)
      : view.currentExerciseIndex;
    const isCurrent = idx === currentTargetIndex;
    let showsImage = imagesEnabled && Boolean(ex.imageUrl);
    let image = null;
    const lines = formatOverviewExerciseLines(ex);
    const ssColor = ex.supersetGroup ? supersetColor(ex.supersetGroup) : null;

    if (showsImage) {
      exerciseImages?.load(ex.imageUrl);
      image = exerciseImages?.get(ex.imageUrl);
      if (image?.status === 'unavailable') showsImage = false;
    }
    if (showsImage) {
      addWidget(widget.FILL_RECT, {
        x: px(64), y: px(rowY), w: px(352), h: px(68), radius: px(14),
        color: isCurrent ? THEME.primaryDark : THEME.card,
      });
      if (image?.status === 'ready') {
        addWidget(widget.FILL_RECT, {
          x: px(70),
          y: px(rowY + 6),
          w: px(56),
          h: px(56),
          radius: px(10),
          color: 0xffffff,
        });
        addWidget(widget.IMG, {
          x: px(73), y: px(rowY + 9), w: px(50), h: px(50), src: image.src,
          auto_scale: true, auto_scale_obj_fit: false,
        });
      }
    }

    const buttonX = showsImage ? 132 : 64;
    const buttonW = showsImage ? 284 : 352;
    addWidget(widget.BUTTON, {
      x: px(buttonX),
      y: px(rowY),
      w: px(buttonW),
      h: px(68),
      radius: px(14),
      normal_color: isCurrent ? THEME.primaryDark : THEME.card,
      press_color: THEME.cardActive,
      text: '',
      click_func: () => {
        workoutController.selectExercise(idx);
        isOverviewOpen = false;
        scheduleRenderUI();
      },
    });
    for (const [text, offset, color] of [
      [lines.title, 3, ssColor || (isCurrent ? THEME.primaryPale : THEME.textPrimary)],
      [lines.prescription, 35, THEME.textSecondary],
    ]) {
      const label = addWidget(widget.TEXT, {
        x: px(buttonX + 12), y: px(rowY + offset), w: px(buttonW - 24), h: px(29),
        color, text_size: font('caption'), align_h: align.LEFT, align_v: align.CENTER_V,
        text_style: text_style.NONE, text,
      });
      label.setEnable(false);
    }
    rowY += 74;
  });

  const actionY = px(324);

  addWidget(widget.BUTTON, {
    x: px(64),
    y: actionY,
    w: px(108),
    h: px(60),
    radius: px(30),
    normal_color: THEME.card,
    press_color: THEME.cardActive,
    text: 'Sync',
    text_size: font('button'),
    click_func: () => {
      const previousWarning = syncWarning;
      workoutController
        .requestRefresh()
        .then((changed) => {
          updateSyncWarning();
          if (changed || previousWarning !== syncWarning) scheduleRenderUI();
        })
        .catch(handlePollFailure);
    },
  });

  addWidget(widget.BUTTON, {
    x: px(186),
    y: actionY,
    w: px(108),
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
    x: px(308),
    y: actionY,
    w: px(108),
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
        scheduleRenderUI();
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
        scheduleRenderUI();
      },
    });
  }
}

function updateNotesImage() {
  if (!isNotesModalOpen) return;
  const enabled = normalizeExerciseImages(accountSettings?.exerciseImages);
  const image = exerciseImages?.get(activeNotesImageUrl);
  const pages = exerciseInfoPages(activeNotesContent, enabled, activeNotesImageUrl, image?.status);
  const imagePage = Boolean(pages[notesPage]?.image && notesPage === 0 && image?.status === 'ready');
  notesImageWidget?.setProperty(prop.VISIBLE, false);
  updateLiveWidget('modal-subtitle', {
    y: px(imagePage ? -999 : INFO_TEXT_LAYOUT.subtitleY),
    h: px(imagePage ? 0 : INFO_TEXT_LAYOUT.subtitleH),
    text: pages[notesPage]?.subtitle && !imagePage ? pages[notesPage].subtitle : '',
  });
  updateLiveWidget('modal-content', {
    y: px(imagePage ? -999 : INFO_TEXT_LAYOUT.bodyY),
    h: px(imagePage ? 0 : INFO_TEXT_LAYOUT.bodyH),
    text: pages[notesPage]?.body && !imagePage ? pages[notesPage].body : '',
  });
  if (!imagePage) return;
  if (!notesImageWidget) notesImageWidget = addWidget(widget.IMG, {
    x: px(INFO_TEXT_LAYOUT.image.x), y: px(INFO_TEXT_LAYOUT.image.y),
    w: px(INFO_TEXT_LAYOUT.image.w), h: px(INFO_TEXT_LAYOUT.image.h),
    src: image.src, auto_scale: true, auto_scale_obj_fit: false,
  });
  notesImageWidget.setProperty(prop.VISIBLE, true);
}

function currentNotesPages() {
  return exerciseInfoPages(activeNotesContent, normalizeExerciseImages(accountSettings?.exerciseImages),
    activeNotesImageUrl, exerciseImages?.get(activeNotesImageUrl)?.status);
}

function moveNotesPage(delta) {
  const pages = currentNotesPages();
  notesPage = (notesPage + delta + pages.length) % pages.length;
  updateLiveWidget('modal-subtitle', { text: pages[notesPage]?.subtitle || '' });
  updateLiveWidget('modal-content', { text: pages[notesPage]?.body || '' });
  updateLiveWidget('modal-page', { text: `${notesPage + 1}/${pages.length}` });
  updateNotesImage();
  redraw();
}

function renderNotesScreen() {
  notesImageWidget = null;
  const pages = currentNotesPages();
  const hasImage = Boolean(pages[0]?.image);
  // Reconcile during render so image arrivals while paused preserve the reading position.
  if (hasImage !== notesModalHasImage) {
    notesPage = Math.max(0, notesPage + (hasImage ? 1 : -1));
    notesModalHasImage = hasImage;
  }
  const totalPages = pages.length;
  if (notesPage >= totalPages) notesPage = totalPages - 1;
  if (notesPage < 0) notesPage = 0;

  renderTitle(activeNotesTitle || 'Notes');

  addWidget(widget.FILL_RECT, {
    x: px(WORKOUT_INFO_PANEL.x),
    y: px(WORKOUT_INFO_PANEL.y),
    w: px(WORKOUT_INFO_PANEL.w),
    h: px(WORKOUT_INFO_PANEL.h),
    radius: px(WORKOUT_INFO_PANEL.radius),
    color: THEME.card,
  });

  addLiveLabel('modal-subtitle', {
    x: px(66),
    y: px(INFO_TEXT_LAYOUT.subtitleY),
    w: px(348),
    h: px(INFO_TEXT_LAYOUT.subtitleH),
    normal_color: THEME.card,
    press_color: THEME.card,
    color: THEME.textPrimary,
    text_size: font('body'),
    align_h: align.CENTER_H,
    align_v: align.TOP,
    text_style: text_style.NONE,
    text: pages[notesPage]?.subtitle || '',
  });

  addLiveLabel('modal-content', {
    x: px(66),
    y: px(INFO_TEXT_LAYOUT.bodyY),
    w: px(348),
    h: px(INFO_TEXT_LAYOUT.bodyH),
    normal_color: THEME.card,
    press_color: THEME.card,
    color: THEME.textSecondary,
    text_size: font('caption'),
    align_h: align.CENTER_H,
    align_v: align.TOP,
    text_style: text_style.WRAP,
    text: pages[notesPage]?.body || '',
  });

  updateNotesImage();
  if (totalPages > 1) {
    addWidget(widget.BUTTON, {
      x: px(INFO_NAV.previous.x),
      y: px(348),
      w: px(INFO_NAV.previous.w),
      h: px(54),
      radius: px(27),
      normal_color: THEME.cardActive,
      press_color: THEME.card,
      text: '<',
      text_size: font('button'),
      click_func: () => moveNotesPage(-1),
    });

    addLiveLabel('modal-page', {
      x: px(INFO_NAV.page.x),
      y: px(348),
      w: px(INFO_NAV.page.w),
      h: px(54),
      color: THEME.textSecondary,
      text_size: font('micro'),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: `${notesPage + 1}/${totalPages}`,
    });

    addWidget(widget.BUTTON, {
      x: px(INFO_NAV.next.x),
      y: px(348),
      w: px(INFO_NAV.next.w),
      h: px(54),
      radius: px(27),
      normal_color: THEME.cardActive,
      press_color: THEME.card,
      text: '>',
      text_size: font('button'),
      click_func: () => moveNotesPage(1),
    });

    addWidget(widget.BUTTON, {
      x: px(INFO_NAV.close.x),
      y: px(348),
      w: px(INFO_NAV.close.w),
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
      x: px(INFO_NAV.singleClose.x),
      y: px(348),
      w: px(INFO_NAV.singleClose.w),
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
      scheduleRenderUI();
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
      scheduleRenderUI();
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
      returnAfterDiscard();
    },
  });
}

function renderFinishSwipeHint() {
  // A text widget leaves the native Workout swipe entirely in Zepp's control.
  const props = LAYOUT.fit({
    x: px(130), y: px(348), w: px(60), h: px(58),
    color: THEME.primaryPale, text_size: font('timer'),
    align_h: align.CENTER_H, align_v: align.CENTER_V,
    text_style: text_style.NONE, text: '>>',
  });
  liveWidgets.finishSwipe = { widget: addRawWidget(widget.TEXT, props), props };
  updateFinishSwipeHint();
}

function updateFinishSwipeHint(now = Date.now()) {
  if (!liveWidgets.finishSwipe) return;
  updateLiveWidget('finishSwipe', { x: LAYOUT.fit({ x: px(130 + (Math.floor(now / 1000) % 3) * 80) }).x });
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
    ? 'Liftosaur saved.\nSwipe right, then finish\nthe native Zepp workout.'
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
      renderFinishSwipeHint();
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
          scheduleRenderUI();
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
        () => scheduleRenderUI(),
        () => scheduleRenderUI(),
      );
    },
  });
}

function handleExerciseImageChange(_imageUrl, status) {
  if (isTearingDown) return;
  if (isPaused || !hasBuilt) {
    controllerUiDirty = true;
    return;
  }
  if (isNotesModalOpen) {
    if (!_imageUrl || _imageUrl === activeNotesImageUrl) {
      const hasImageNow = Boolean(currentNotesPages()[0]?.image);
      if (hasImageNow !== notesModalHasImage) {
        renderUI();
        return;
      }
      if (status === 'unavailable') { renderUI(); return; }
    }
    updateNotesImage();
    redraw();
    return;
  }
  if ((status === 'ready' || status === 'unavailable') && (workoutController?.view().state === SESSION_STATES.READY || isOverviewOpen)) {
    renderUI();
    return;
  }
  if (preparationImageUrl === _imageUrl && (status === 'ready' || status === 'unavailable')) {
    renderUI();
    return;
  }
  redraw();
}

function renderUI() {
  if (isTearingDown || !hasBuilt) return;
  if (isPaused) {
    controllerUiDirty = true;
    return;
  }
  if (isDispatchingClick) {
    scheduleRenderUI();
    return;
  }
  cancelScheduledRender();
  if (clockTimer) startClock();
  workoutDiagnostics.record(WORKOUT_DIAGNOSTIC_CODES.RENDER_START);
  consumeControllerUiChange();
  preparationImageUrl = null;
  updateSyncWarning();
  clearWidgets();

  // Full-screen background
  addRawWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: THEME.bg });

  renderScreen();
  // Keep the opaque footer above perimeter effects and outside action targets.
  renderClock();
  redraw();
  workoutDiagnostics.record(WORKOUT_DIAGNOSTIC_CODES.RENDER_END);
}

function renderScreen() {
  if (isEditLastSetOpen) {
    if (lastSetDraft) return renderEditLastSetScreen();
    isEditLastSetOpen = false;
  }
  if (isSyncDetailsOpen) return renderSyncDetailsModal();
  if (isWorkoutTimerControlsOpen) {
    const timerView = workoutController.view();
    if (timerView.state === SESSION_STATES.ACTIVE_SET || timerView.state === SESSION_STATES.REST) {
      return renderWorkoutTimerControlsModal(timerView);
    }
    isWorkoutTimerControlsOpen = false;
  }
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
  syncRestPresentation(view.rest);
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
  if (view.timedSet && view.timedSet.phase !== 'READY' && view.timedSet.phase !== 'REST') return renderTimedSetScreen(view);
  if (view.state === SESSION_STATES.ACTIVE_SET) return renderActiveSetScreen(view);
  if (view.state === SESSION_STATES.REST) {
    if (isRestMinimized) return renderActiveSetScreen(view);
    return renderRestScreen(view);
  }
  return renderFinishedScreen(view);
}

function startInitialNetworkLoad() {
  beginRequest(PHONE_CONNECTING_MESSAGE);

  loadDisplaySettings()
    .then(() => send(MESSAGE_TYPES.GET_WORKOUT_CURRENT))
    .then((currentRes) => {
      resetConnectionRetry();
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
        scheduleConnectionRetry();
        return;
      }
      screen = EXTENSION_SCREENS.SETUP;
      failRequest(err);
    });
}

function resetConnectionRetry() {
  if (connectionRetryTimer) clearTimeout(connectionRetryTimer);
  connectionRetryTimer = null;
  connectionRetryAttempt = 0;
}

function scheduleConnectionRetry() {
  if (isTearingDown || isPaused || !hasBuilt) return;
  const generation = lifecycleGeneration;
  const delay = nextPhoneRetryDelay(connectionRetryAttempt);
  if (delay === null || connectionRetryTimer) return;
  connectionRetryAttempt += 1;
  connectionRetryTimer = setTimeout(() => {
    if (isTearingDown || isPaused || generation !== lifecycleGeneration) return;
    connectionRetryTimer = null;
    if (!isTearingDown && screen === EXTENSION_SCREENS.CONNECTION && !isBusy) {
      startInitialNetworkLoad();
    }
  }, delay);
}

function retryConnection() {
  resetConnectionRetry();
  startInitialNetworkLoad();
}

function loadDisplaySettings() {
  const generation = lifecycleGeneration;
  const diagnosticsPayload = workoutDiagnostics.isEnabled() ? { diagnostics: workoutDiagnostics.read() } : {};
  return send(MESSAGE_TYPES.GET_SETTINGS, diagnosticsPayload).then((settingsRes) => {
    if (isTearingDown || generation !== lifecycleGeneration) return accountSettings;
    const diagnosticsWereEnabled = workoutDiagnostics.isEnabled();
    workoutDiagnostics.setEnabled(normalizeWorkoutDiagnosticsEnabled(settingsRes.payload?.workoutDiagnosticsEnabled));
    if (!diagnosticsWereEnabled && workoutDiagnostics.isEnabled()) {
      workoutDiagnostics.record(WORKOUT_DIAGNOSTIC_CODES.DIAGNOSTICS_ON);
    }
    const imagesWereEnabled = normalizeExerciseImages(accountSettings?.exerciseImages);
    const autoPrepareWasEnabled = accountSettings?.autoPrepare === true;
    accountSettings = settingsRes.payload || {};
    saveAutoPreparePreference(deviceStorage, accountSettings.autoPrepare);
    const autoPrepareChanged = autoPrepareWasEnabled !== (accountSettings.autoPrepare === true);
    if (autoPrepareChanged) restPresentation = createRestPresentationState();
    exerciseImages?.setEnabled(normalizeExerciseImages(accountSettings.exerciseImages));
    if (isNotesModalOpen && imagesWereEnabled !== normalizeExerciseImages(accountSettings.exerciseImages)) {
      notesPage = 0;
      exerciseImages?.load(activeNotesImageUrl, { retry: true, priority: true });
      renderUI();
    }
    workoutController.configureTimedSets({ getReadySeconds: normalizeGetReadySeconds(accountSettings.getReadySeconds) });
    applyDisplayHold();
    if (autoPrepareChanged && screen === EXTENSION_SCREENS.SESSION && !isNotesModalOpen) {
      controllerUiDirty = true;
    }
    return accountSettings;
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

  workoutDiagnostics.record(WORKOUT_DIAGNOSTIC_CODES.FINISH_TAP);
  finishState = { status: 'SENDING', message: 'Saving to Liftosaur...' };
  controllerUiDirty = true;

  workoutController
    .finishWorkoutRemote()
    .then((result) => {
      if (isTearingDown) return;
      if (result.reason === 'SESSION_REPLACED') return;
      if (!result.success) throw new Error(result.reason || 'Save failed');
      workoutDiagnostics.record(WORKOUT_DIAGNOSTIC_CODES.FINISH_SAVED);
      finishState = {
        status: 'SAVED',
        message: 'Saved to Liftosaur',
      };
      renderUI();
    })
    .catch((err) => {
      if (isTearingDown) return;
      workoutDiagnostics.record(WORKOUT_DIAGNOSTIC_CODES.FINISH_FAILED);
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
      if (isTearingDown) return;
      if (result.reason === 'SESSION_REPLACED') return;
      if (!result.success) throw new Error(result.reason || 'Discard pending');
      returnAfterDiscard();
    })
    .catch((err) => {
      failRequest(err);
    });
}

function returnAfterDiscard() {
  isBusy = false;
  statusMessage = '';
  errorMessage = '';
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
  if (isTearingDown || isPaused || !hasBuilt) return;
  updateClock();
  if (liveWidgets.finishSwipe) updateFinishSwipeHint();

  if (screen !== EXTENSION_SCREENS.SESSION) return;
  if (controllerUiDirty) {
    renderUI();
    return;
  }
  refreshSportMetrics();
  retryPendingWrites();

  workoutController
    .pollCurrent()
    .then((changed) => {
      const previousWarning = syncWarning;
      updateSyncWarning();
      if (changed || previousWarning !== syncWarning) renderUI();
    })
    .catch(handlePollFailure);

  workoutController.advanceTimedSet();
  const view = workoutController.view();
  updateTimedSetScreen(view);

  if (view.state !== lastRenderedState) {
    renderUI();
    return;
  }

  if (view.state === SESSION_STATES.REST && view.rest) {
    const alertResult = restAlertTracker.checkTick({ rest: view.rest, now: Date.now() });
    if (alertResult.shouldAlert) {
      if (alertResult.reason === 'WARNING') {
        triggerLightVibration();
      } else {
        triggerRestVibration();
      }
    }
  }

  if (liveWidgets.restValue && lastRenderedSecond > 0 && view.rest?.remaining <= 0) {
    renderUI();
    return;
  }

  updatePreparedRestVisuals(view);

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
      updateLiveWidget('actionButton', {
        text: view.timedSet?.phase === 'REST' ? 'Armed' : `> Start set ${formatSeconds(view.rest.remaining)}`,
      });
    }
    updateLiveWidget('elapsed', {
      text: formatSeconds(view.elapsedSeconds),
      color: view.isWorkoutPaused ? THEME.yellow : THEME.primaryLight,
    });
    updateLiveWidget('workoutTimerModalState', {
      text: view.isNativeWorkoutPaused && !view.isManualWorkoutPaused
        ? 'Zepp paused'
        : (view.isWorkoutPaused ? 'Paused' : 'Running'),
      color: view.isWorkoutPaused ? THEME.yellow : THEME.textSecondary,
    });
    updateLiveWidget('workoutTimerModalValue', {
      text: formatSeconds(view.elapsedSeconds),
      color: view.isWorkoutPaused ? THEME.yellow : THEME.primaryPale,
    });
  }
}

function startClock() {
  const interval = screen === EXTENSION_SCREENS.SESSION && workoutController?.view().state === SESSION_STATES.REST
    ? TICK_FAST_MS
    : TICK_SLOW_MS;
  if (clockTimer && clockInterval === interval) return;
  if (clockTimer) clearInterval(clockTimer);
  clockInterval = interval;
  clockTimer = setInterval(tick, interval);
}

function stopClock() {
  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
  clockInterval = null;
}

DataWidget(
  BasePage({
    onInit() {
      isSyncDetailsOpen = false;
      isEditLastSetOpen = false;
      lastSetDraft = null;
      lastSetEditError = null;
      workoutDiagnostics.record(WORKOUT_DIAGNOSTIC_CODES.BOOT);
      exerciseImages = createWatchExerciseImages({
        request: (type, payload) => send(type, payload, { timeoutMs: 45000 }),
        onChange: handleExerciseImageChange,
        storage: deviceStorage,
        maxCachedImages: OVERVIEW_PAGE_SIZE,
      });
      widgetInstance = this;
      console.log('[lifto-ext] data-widget onInit');

      workoutController = createWorkoutController({
        store: sessionStore,
        request: (type, payload) => send(type, payload),
        onChange: markControllerUiDirty,
        onStatus: markControllerUiDirty,
        mapWorkout: (workout, options) =>
          workoutToDayPlan(workout, {
            ...options,
            units: accountSettings?.units || options?.units || null,
          }),
      });

      const restored = workoutController.restore();
      if (restored.success) {
        workoutDiagnostics.record(WORKOUT_DIAGNOSTIC_CODES.RESTORED);
        restoredDisplaySettingsPending = true;
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
      workoutDiagnostics.record(WORKOUT_DIAGNOSTIC_CODES.BUILD);
      console.log('[lifto-ext] data-widget build');
      hasBuilt = true;
      isTearingDown = false;
      applyDisplayHold();
      if (restoredDisplaySettingsPending) {
        restoredDisplaySettingsPending = false;
        loadDisplaySettings().catch((err) => {
          logRecoverableError('[lifto-ext] display settings unavailable', err);
        });
      }
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
      if (!hasBuilt || isTearingDown) return;
      isPaused = false;
      workoutDiagnostics.record(WORKOUT_DIAGNOSTIC_CODES.RESUME);
      console.log('[lifto-ext] data-widget onResume');
      loadDisplaySettings().catch((err) => {
        logRecoverableError('[lifto-ext] display settings unavailable', err);
      });
      applyDisplayHold();
      refreshSportMetrics();
      startClock();
      lastPendingSyncRetryAt = 0;
      retryPendingWrites();

      if (workoutController) {
        const view = workoutController.view();
        if (view.state === SESSION_STATES.REST && view.rest) {
          const resumeAlert = restAlertTracker.checkResume({ rest: view.rest, now: Date.now() });
          if (resumeAlert.shouldAlert) {
            if (resumeAlert.reason === 'WARNING') {
              triggerLightVibration();
            } else {
              triggerRestVibration();
            }
          }
        }
        workoutController
          .requestRefresh()
          .then((changed) => {
            if (changed) renderUI();
          })
          .catch(handlePollFailure);
      }
      renderUI();
      if (screen === EXTENSION_SCREENS.CONNECTION && !isBusy) scheduleConnectionRetry();
    },

    onPause() {
      stopRestBezelAnimation();
      isPaused = true;
      lifecycleGeneration += 1;
      cancelScheduledRender();
      resetConnectionRetry();
      workoutDiagnostics.record(WORKOUT_DIAGNOSTIC_CODES.PAUSE);
      console.log('[lifto-ext] data-widget onPause');
      nativePauseReconciler.loseFocus({ timestamp: Date.now() });
      resetDisplayHold();
      stopClock();
      stopVibration();
      if (workoutController) {
        workoutController.persist();
      }
    },

    onReceivedFile(file) {
      if (isTearingDown) return;
      exerciseImages?.receive(file);
    },

    onDestroy() {
      isTearingDown = true;
      hasBuilt = false;
      lifecycleGeneration += 1;
      cancelScheduledRender();
      resetConnectionRetry();
      workoutController?.dispose();
      stopClock();
      if (vibrationTimer) clearTimeout(vibrationTimer);
      vibrationTimer = null;
      exerciseImages?.abandon();
      exerciseImages = null;
      widgetInstance = null;
      restHaloWidgets = [];
      restPulseAnimHandles = [];
      restPulseAttempted = false;
      activeWidgets = [];
      liveWidgets = {};
    },
  })
);
