import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EXTENSION_CLOCK_LAYOUT, WORKOUT_TIMER_MODAL_LAYOUT } from '../shared/watch-layout.js';
import { recordingLabel, recordingDetails } from '../shared/recording-status.js';

for (const product of ['page', 'data-widget']) {
  test(product + ': status tap explains pending writes and retains the clock', () => {
    const source = fs.readFileSync(new URL('../' + product + '/common/index.js', import.meta.url), 'utf8');
    const widgets = [];
    const env = {
      EXTENSION_CLOCK_LAYOUT, WORKOUT_TIMER_MODAL_LAYOUT, recordingLabel, recordingDetails,
      isTearingDown: false, isPaused: false, isNotesModalOpen: false, isWorkoutTimerControlsOpen: false,
      isSyncDetailsOpen: false, isEditLastSetOpen: false, lastSetEditError: null, controllerUiDirty: false,
      SESSION_STATES: { ACTIVE_SET: 'ACTIVE_SET', REST: 'REST', FINISHED: 'FINISHED' },
      workoutController: {
        view: () => ({ state: 'REST' }),
        sync: () => ({ mode: 'DIRECT', startConfirmed: true, acknowledgedSetCount: 1 }),
        getWorkoutSetWrites: () => [{ setId: 's1' }, { setId: 's2' }], getPendingSetCount: () => 1,
      },
      THEME: { bg: 0, card: 1, cardActive: 2, textPrimary: 3, textSecondary: 4, yellow: 5, success: 6 },
      currentClockLabel: () => '12:34', lastRenderedClock: null,
      widget: { TEXT: 'text', BUTTON: 'button', FILL_RECT: 'rect' },
      align: { CENTER_H: 1, CENTER_V: 2, TOP: 3 }, text_style: { NONE: 0, WRAP: 1 },
      font: () => 20, px: value => value, renderUI() {}, scheduleRenderUI() {},
      addWidget: (type, props) => widgets.push({ type, ...props }),
      addLiveButton: (key, props) => widgets.push({ key, ...props }),
      addLiveLabel: (key, props) => widgets.push({ key, ...props }),
    };
    vm.createContext(env);
    for (const name of ['renderClock', 'canOpenSyncDetails', 'openSyncDetailsModal', 'closeSyncDetailsModal', 'renderSyncDetailsModal']) {
      const start = source.indexOf('function ' + name + '(');
      const end = source.indexOf('\nfunction ', start + 1);
      vm.runInContext(source.slice(start, end), env);
    }
    env.renderClock();
    const clock = widgets.find(item => item.key === 'clock');
    assert.equal(clock.text, '12:34 | 1 pending');
    clock.click_func();
    assert.equal(env.isSyncDetailsOpen, true);
    env.renderSyncDetailsModal();
    assert.ok(widgets.some(item => String(item.text).includes('Saved on watch')));
    widgets.find(item => item.text === 'Close').click_func();
    assert.equal(env.isSyncDetailsOpen, false);
    env.workoutController.view = () => ({ state: 'READY' });
    env.openSyncDetailsModal();
    assert.equal(env.isSyncDetailsOpen, false);
  });
}

test('status touch target stays inside the round screen', () => {
  const { x, y, width, height } = EXTENSION_CLOCK_LAYOUT;
  for (const cornerX of [x, x + width]) {
    for (const cornerY of [y, y + height]) {
      assert.ok(Math.hypot(cornerX - 240, cornerY - 240) <= 240);
    }
  }
});
