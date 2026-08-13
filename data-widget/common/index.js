import {
  createWidget,
  widget,
  align,
  text_style,
  prop,
  event,
  sport_data,
  edit_widget_group_type,
} from '@zos/ui';
import { px } from '@zos/utils';

import { createWidgetState } from './state.js';

const BACKGROUND = 0x000000;
const FOREGROUND = 0xffffff;
const ACCENT = 0xffb300;

/**
 * Phase 0 spike widget: proves rendering, a mocked SPORT_DATA field, one CLICK
 * transition, and the lifecycle order. It carries no workout logic.
 */
DataWidget({
  state: createWidgetState(),
  statusText: null,

  render() {
    const { status } = this.state.view();
    if (this.statusText) {
      this.statusText.setProperty(prop.MORE, { text: status });
    }
  },

  onInit() {
    console.log('[liftosaur] onInit');
  },

  build() {
    console.log('[liftosaur] build');

    createWidget(widget.FILL_RECT, {
      x: 0,
      y: 0,
      w: px(480),
      h: px(480),
      color: BACKGROUND,
    });

    createWidget(widget.TEXT, {
      x: 0,
      y: px(140),
      w: px(480),
      h: px(46),
      color: FOREGROUND,
      text_size: px(32),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: this.state.view().title,
    });

    // Heart rate stays owned by the System Workout: read it, never start a sensor.
    createWidget(widget.SPORT_DATA, {
      x: 0,
      y: px(200),
      w: px(480),
      h: px(80),
      edit_id: 1,
      category: edit_widget_group_type.SPORTS,
      default_type: sport_data.HR,
      text_size: px(56),
      text_color: FOREGROUND,
      sub_text_visible: true,
      sub_text_size: px(20),
      sub_text_color: ACCENT,
      mock_data: 128,
    });

    this.statusText = createWidget(widget.TEXT, {
      x: 0,
      y: px(300),
      w: px(480),
      h: px(46),
      color: ACCENT,
      text_size: px(28),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: this.state.view().status,
    });

    // Single full-screen tap target: no scroll, no gesture, no physical button.
    const touchArea = createWidget(widget.FILL_RECT, {
      x: 0,
      y: 0,
      w: px(480),
      h: px(480),
      alpha: 0,
      color: BACKGROUND,
    });

    touchArea.addEventListener(event.CLICK_UP, () => {
      const status = this.state.click();
      console.log(`[liftosaur] click -> ${status} (${this.state.transitionCount()})`);
      this.render();
    });
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
