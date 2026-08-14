import { createWidget, deleteWidget, widget, align, text_style } from '@zos/ui';
import { px } from '@zos/utils';

import { createWidgetState } from './state.js';

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

// ── Widget state (closure, not `this` — confirmed EMULATOR TESTED 2026-08-14) ─

const state = createWidgetState();

let titleWidget = null;
let statusWidget = null;
let hrWidget = null;

function render() {
  const view = state.view();


  if (titleWidget) deleteWidget(titleWidget);
  titleWidget = createWidget(widget.TEXT, textProps({
    y: px(100), h: px(70), size: px(38), text: view.title,
  }));

  if (statusWidget) deleteWidget(statusWidget);
  statusWidget = createWidget(widget.TEXT, textProps({
    y: px(190), h: px(50), size: px(28), text: view.status,
  }));

  if (hrWidget) deleteWidget(hrWidget);
  hrWidget = createWidget(widget.TEXT, textProps({
    y: px(260), h: px(50), size: px(28), text: 'HR ' + view.hr,
  }));
}

// ── Page ──────────────────────────────────────────────────────────────────────

Page({
  onInit() {
    console.log('[liftosaur] onInit');
  },

  build() {
    console.log('[liftosaur] build');

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
        render();
      },
    });

    render();
  },

  onResume() {
    console.log('[liftosaur] onResume');
  },

  onPause() {
    console.log('[liftosaur] onPause');
  },

  onDestroy() {
    console.log('[liftosaur] onDestroy');
  },
});
