import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SET_CORRECTION_LAYOUT } from '../shared/watch-layout.js';

function fixture(product) {
  const source = fs.readFileSync(new URL('../' + product + '/common/index.js', import.meta.url), 'utf8');
  const widgets = [];
  const draft = { setId: 's1', exerciseName: 'Bench', setIndex: 1, weight: 60, reps: 8, unit: 'kg', step: 2.5 };
  const env = {
    SET_CORRECTION_LAYOUT,
    isTearingDown: false, isPaused: false, isEditLastSetOpen: true, isSyncDetailsOpen: false,
    isNotesModalOpen: false, isWorkoutTimerControlsOpen: false, lastSetDraft: draft,
    lastSetEditError: null, controllerUiDirty: false,
    workoutController: { saveLastSetCorrection: () => ({ success: false, reason: 'Set changed. Reopen the editor.' }) },
    THEME: { primaryLight: 1, textSecondary: 2, textPrimary: 3, card: 4, cardActive: 5, primary: 6, primaryDeep: 7, error: 8 },
    px: n => n, font: () => 20, formatMarqueeText: text => text,
    widget: { TEXT: 'text', BUTTON: 'button' }, align: { CENTER_H: 1, CENTER_V: 2, TOP: 3 },
    text_style: { NONE: 0, WRAP: 1, SCROLL: 2 },
    addWidget: (type, props) => widgets.push({ type, ...props }),
    cancelEditLastSet() {}, renderStepper() {}, renderUI() {}, scheduleRenderUI() {},
  };
  vm.createContext(env);
  for (const name of ['saveEditLastSet', 'renderEditLastSetScreen']) {
    const start = source.indexOf('function ' + name + '(');
    const end = source.indexOf('\nfunction ', start + 1);
    vm.runInContext(source.slice(start, end < 0 ? undefined : end), env);
  }
  return { env, widgets, draft };
}

for (const product of ['page', 'data-widget']) {
  test(product + ': the editor displays the one-based completed set number', () => {
    const { env, widgets } = fixture(product);
    env.renderEditLastSetScreen();
    assert.ok(widgets.some(widget => widget.text === 'Set 1'));
  });

  test(product + ': rejected correction keeps the draft and displays the refusal', () => {
    const { env, widgets, draft } = fixture(product);
    env.saveEditLastSet();
    assert.equal(env.isEditLastSetOpen, true);
    assert.equal(env.lastSetDraft, draft);
    env.renderEditLastSetScreen();
    assert.ok(widgets.some(widget => String(widget.text).includes('Set changed')));
  });
}

test('sync clock touch area fits the round bezel and shared content box', async () => {
  const { EXTENSION_CLOCK_LAYOUT } = await import('../shared/watch-layout.js');
  const { DESIGN_BOX } = await import('../shared/screen-layout.js');
  const { x, y, width, height } = EXTENSION_CLOCK_LAYOUT;
  assert.ok(y + height <= DESIGN_BOX.y + DESIGN_BOX.h);
  for (const cx of [x, x + width]) {
    for (const cy of [y, y + height]) {
      assert.ok(Math.hypot(cx - 240, cy - 240) <= 240, 'Clock button lies within round bezel');
    }
  }
});
