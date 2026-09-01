import { createWidget, deleteWidget, widget, prop } from '@zos/ui';
import { px } from '@zos/utils';
import { getDeviceInfo, SCREEN_SHAPE_ROUND } from '@zos/device';
import { LocalStorage } from '@zos/storage';
import { getSportData } from '@zos/app-access';
import { BasePage } from '@zeppos/zml/base-page';

import { createScreenLayout } from '../../shared/screen-layout.js';
import { createMessage, MESSAGE_TYPES } from '../../shared/protocol.js';
import {
  EXTENSION_SPIKE_STORAGE_KEY,
  createSpikeSession,
  deserializeSpikeState,
  serializeSpikeState,
  parseSportDataResult,
  parsePingResponse,
  formatPingStatus,
} from '../../shared/workout-extension-spike.js';

const THEME = {
  primary: 0x8356f6,
  primaryLight: 0xa48bfa,
  primaryPale: 0xccc1f9,
  primaryDark: 0x393248,
  primaryDeep: 0x2c1065,
  success: 0x2bdc9b,
  error: 0xff8066,
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

let deviceStorage = null;
try {
  deviceStorage = new LocalStorage();
} catch (err) {
  console.log('[lifto-ext] storage fallback to memory');
}

function loadPersistedState() {
  if (!deviceStorage) return null;
  try {
    return deviceStorage.getItem(EXTENSION_SPIKE_STORAGE_KEY, null);
  } catch (error) {
    console.log('[lifto-ext] storage read failed');
    return null;
  }
}

function savePersistedState(state) {
  if (!deviceStorage) return;
  try {
    deviceStorage.setItem(EXTENSION_SPIKE_STORAGE_KEY, serializeSpikeState(state));
  } catch (error) {
    console.log('[lifto-ext] storage write failed');
  }
}

let session = createSpikeSession();
let widgetInstance = null;
let activeWidgets = [];
let liveWidgets = {};
let clockTimer = null;
let sportMetric = '--';
let pingStatusText = 'PING: ...';

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

function addLiveAction(key, props) {
  const fitted = LAYOUT.fit(props);
  const action = addActionWidget(fitted);
  liveWidgets[key] = { widget: action, props: { ...fitted } };
  return action;
}

const LIVE_WIDGET_MUTABLE_KEYS = ['x', 'y', 'w', 'h', 'text', 'color', 'text_size', 'radius'];

function updateLiveWidget(key, changes) {
  const entry = liveWidgets[key];
  if (!entry) return;
  try {
    Object.assign(entry.props, changes);
    const mutableProps = {};
    for (const property of LIVE_WIDGET_MUTABLE_KEYS) {
      if (property in entry.props) mutableProps[property] = entry.props[property];
    }
    entry.widget.setProperty(prop.MORE, mutableProps);
  } catch (err) {
    console.log('[lifto-ext] live widget update skipped');
  }
}

function clearWidgets() {
  for (const w of activeWidgets) {
    try {
      deleteWidget(w);
    } catch (error) {
      console.log('[lifto-ext] widget removal failed');
    }
  }
  activeWidgets = [];
  liveWidgets = {};
}

function updateUI() {
  const elapsedText = `Elapsed: ${session.formatElapsed(Date.now())}`;
  const clicksText = `Tap Counter: ${session.getState().clickCount}`;
  const sportText = `Sport: ${sportMetric}`;

  updateLiveWidget('elapsed', { text: elapsedText });
  updateLiveWidget('clicks', { text: clicksText });
  updateLiveWidget('sport', { text: sportText });
  updateLiveWidget('ping', { text: pingStatusText });
}

function requestSportData() {
  try {
    getSportData({ type: 'duration' }, (result) => {
      const parsed = parseSportDataResult(result, 'duration');
      if (parsed.ok) {
        sportMetric = parsed.value;
      } else {
        sportMetric = 'N/A';
      }
      updateUI();
    });
  } catch (err) {
    console.log('[lifto-ext] sport data request unavailable');
    sportMetric = 'N/A';
    updateUI();
  }
}

function pingSideService() {
  if (!widgetInstance || typeof widgetInstance.request !== 'function') {
    pingStatusText = 'PING: FAILED';
    updateUI();
    return;
  }

  pingStatusText = 'PING: ...';
  updateUI();

  widgetInstance
    .request(createMessage({ type: MESSAGE_TYPES.PING }))
    .then((res) => {
      const parsed = parsePingResponse(res);
      pingStatusText = formatPingStatus(parsed);
      updateUI();
    })
    .catch((err) => {
      const parsed = parsePingResponse(err);
      pingStatusText = formatPingStatus(parsed);
      updateUI();
    });
}

function startClock() {
  if (clockTimer) return;
  clockTimer = setInterval(() => {
    updateUI();
  }, 1000);
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

      const saved = loadPersistedState();
      session = createSpikeSession(deserializeSpikeState(saved));
      session.start(Date.now());
      savePersistedState(session.getState());
    },

    build() {
      console.log('[lifto-ext] data-widget build');
      clearWidgets();

      addWidget(widget.BUTTON, {
        x: px(40),
        y: px(40),
        w: px(400),
        h: px(50),
        radius: px(12),
        normal_color: THEME.primaryDark,
        press_color: THEME.primaryDark,
        text: 'Lifto Extension',
        text_size: px(26),
        color: THEME.primaryPale,
      });

      addLiveLabel('elapsed', {
        x: px(40),
        y: px(100),
        w: px(400),
        h: px(45),
        radius: px(10),
        normal_color: THEME.card,
        press_color: THEME.card,
        text: `Elapsed: ${session.formatElapsed(Date.now())}`,
        text_size: px(22),
        color: THEME.textPrimary,
      });

      addLiveLabel('sport', {
        x: px(40),
        y: px(155),
        w: px(400),
        h: px(45),
        radius: px(10),
        normal_color: THEME.card,
        press_color: THEME.card,
        text: `Sport: ${sportMetric}`,
        text_size: px(22),
        color: THEME.textSecondary,
      });

      addLiveLabel('ping', {
        x: px(40),
        y: px(210),
        w: px(400),
        h: px(45),
        radius: px(10),
        normal_color: THEME.card,
        press_color: THEME.card,
        text: pingStatusText,
        text_size: px(22),
        color: THEME.textSecondary,
      });

      addLiveAction('clicks', {
        x: px(40),
        y: px(270),
        w: px(400),
        h: px(70),
        radius: px(35),
        normal_color: THEME.primary,
        press_color: THEME.primaryDeep,
        text: `Tap Counter: ${session.getState().clickCount}`,
        text_size: px(24),
        color: THEME.textPrimary,
        click_func: () => {
          session.incrementClicks();
          savePersistedState(session.getState());
          updateLiveWidget('clicks', { text: `Tap Counter: ${session.getState().clickCount}` });
          updateUI();
        },
      });

      addWidget(widget.BUTTON, {
        x: px(40),
        y: px(355),
        w: px(400),
        h: px(55),
        radius: px(27),
        normal_color: THEME.cardActive,
        press_color: THEME.card,
        text: 'Send PING',
        text_size: px(22),
        color: THEME.primaryPale,
        click_func: () => {
          pingSideService();
        },
      });

      requestSportData();
      pingSideService();
      startClock();
    },

    onResume() {
      console.log('[lifto-ext] data-widget onResume');
      session.resume(Date.now());
      requestSportData();
      startClock();
      updateUI();
    },

    onPause() {
      console.log('[lifto-ext] data-widget onPause');
      session.pause(Date.now());
      savePersistedState(session.getState());
      stopClock();
    },

    onDestroy() {
      console.log('[lifto-ext] data-widget onDestroy');
      stopClock();
      clearWidgets();
      widgetInstance = null;
    },
  })
);
