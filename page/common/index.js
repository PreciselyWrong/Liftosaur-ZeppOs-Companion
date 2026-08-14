import { createWidget, deleteWidget, widget, align, text_style } from '@zos/ui';
import { px } from '@zos/utils';
import { HeartRate } from '@zos/sensor';
import { BasePage } from '@zeppos/zml/base-page';

import { createWidgetState } from './state.js';
import { createMessage, MESSAGE_TYPES } from '../../shared/protocol.js';

// ── Layout constants ─────────────────────────────────────────────────────────

const W = px(480);
const H = px(480);

function textProps({ y, h, size, text }) {
  return {
    x: 0,
    y,
    w: W,
    h,
    color: 0xffffff,
    text_size: size,
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: text_style.NONE,
    text,
  };
}

// ── State & sensor (closure variables) ───────────────────────────────────────

const state = createWidgetState();

let titleWidget = null;
let statusWidget = null;
let hrWidget = null;
let sideStatusWidget = null;
let sideStatus = 'SIDE: --';

let hrSensor = null;
let hrCallback = null;
let pageContext = null;

function render() {
  const view = state.view();

  if (titleWidget) deleteWidget(titleWidget);
  titleWidget = createWidget(widget.TEXT, textProps({
    y: px(70), h: px(60), size: px(38), text: view.title,
  }));

  if (statusWidget) deleteWidget(statusWidget);
  statusWidget = createWidget(widget.TEXT, textProps({
    y: px(140), h: px(45), size: px(28), text: view.status,
  }));

  if (hrWidget) deleteWidget(hrWidget);
  hrWidget = createWidget(widget.TEXT, textProps({
    y: px(195), h: px(45), size: px(28), text: 'HR ' + view.hr,
  }));

  if (sideStatusWidget) deleteWidget(sideStatusWidget);
  sideStatusWidget = createWidget(widget.TEXT, textProps({
    y: px(250), h: px(45), size: px(24), text: sideStatus,
  }));
}

function sendPing() {
  if (!pageContext || typeof pageContext.request !== 'function') {
    console.log('[liftosaur] pageContext.request not ready');
    return;
  }
  const ping = createMessage({
    type: MESSAGE_TYPES.PING,
    payload: { tap: state.transitionCount() },
  });

  sideStatus = 'SIDE: PING...';
  render();

  pageContext
    .request(ping)
    .then((res) => {
      console.log('[liftosaur] side response: ' + JSON.stringify(res));
      if (res && res.type === MESSAGE_TYPES.PONG) {
        sideStatus = 'SIDE: PONG OK';
      } else {
        sideStatus = 'SIDE: RES ' + (res?.type || 'UNKNOWN');
      }
      render();
    })
    .catch((err) => {
      console.log('[liftosaur] side error: ' + JSON.stringify(err));
      sideStatus = 'SIDE: ERR';
      render();
    });
}

// ── Page ──────────────────────────────────────────────────────────────────────

Page(
  BasePage({
    onInit() {
      console.log('[liftosaur] onInit');
      pageContext = this;
    },

    build() {
      console.log('[liftosaur] build');
      pageContext = this;

      createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: 0x000000 });

      createWidget(widget.BUTTON, {
        x: px(140),
        y: px(340),
        w: px(200),
        h: px(70),
        radius: px(12),
        normal_color: 0x333333,
        press_color: 0x666666,
        text: 'TAP',
        text_size: px(28),
        click_func: () => {
          const next = state.click();
          console.log('[liftosaur] click → ' + next + ' (' + state.transitionCount() + ')');
          sendPing();
          render();
        },
      });

      if (!hrSensor) {
        try {
          hrSensor = new HeartRate();
          const initialHr = hrSensor.getCurrent?.() || hrSensor.getLast?.();
          if (initialHr) {
            state.setHeartRate(initialHr);
          }
          hrCallback = () => {
            const currentHr = hrSensor.getCurrent?.() || hrSensor.getLast?.();
            console.log('[liftosaur] hr update: ' + currentHr);
            if (currentHr) {
              state.setHeartRate(currentHr);
              render();
            }
          };
          hrSensor.onCurrentChange?.(hrCallback);
        } catch (err) {
          console.log('[liftosaur] hr sensor init error: ' + err);
        }
      }

      render();
      sendPing();
    },

    onResume() {
      console.log('[liftosaur] onResume');
    },

    onPause() {
      console.log('[liftosaur] onPause');
    },

    onDestroy() {
      console.log('[liftosaur] onDestroy');
      if (hrSensor && hrCallback) {
        try {
          hrSensor.offCurrentChange?.(hrCallback);
        } catch (e) {}
      }
    },
  })
);
