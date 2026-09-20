import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { WORKOUT_TIMER_MODAL_LAYOUT, SET_CORRECTION_LAYOUT, EXTENSION_CLOCK_LAYOUT } from '../shared/watch-layout.js';
import { recordingLabel, recordingDetails } from '../shared/recording-status.js';
import { createScreenLayout } from '../shared/screen-layout.js';

function readSource(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} must exist`);
  const nextFunc = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, nextFunc >= 0 ? nextFunc : undefined);
}

for (const product of ['page', 'data-widget']) {
  const relPath = `${product}/common/index.js`;
  const source = readSource(relPath);

  test(`${product}: VM execution of clock tap, sync details modal, and draft correction workflow`, () => {
    const createdWidgets = [];
    const calls = [];
    let savedDraft = null;

    const controller = {
      view: () => ({ state: 'REST' }),
      sync: () => ({ mode: 'DIRECT', startConfirmed: true, acknowledgedSetCount: 1 }),
      getWorkoutSetWrites: () => [{ setId: 's1', reps: 5, weight: 80 }],
      getPendingSetCount: () => 0,
      canCorrectLastSet: () => ({
        allowed: true,
        set: {
          setId: 's1',
          exerciseName: 'Bench Press',
          setIndex: 1,
          weight: 80,
          reps: 5,
          unit: 'kg',
          isWarmup: false,
        },
      }),
      createLastSetDraft: () => ({
        success: true,
        draft: {
          setId: 's1',
          exerciseName: 'Bench Press',
          setIndex: 1,
          weight: 80,
          reps: 5,
          unit: 'kg',
          step: 2.5,
          isWarmup: false,
        },
      }),
      saveLastSetCorrection: (draft) => {
        savedDraft = { ...draft };
        return { success: true };
      },
    };

    const env = {
      SESSION_STATES: { ACTIVE_SET: 'ACTIVE_SET', REST: 'REST', FINISHED: 'FINISHED' },
      isNotesModalOpen: false, isWorkoutTimerControlsOpen: false, lastSetEditError: null,
      SET_CORRECTION_LAYOUT,
      isTearingDown: false,
      isPaused: false,
      isSyncDetailsOpen: false,
      isEditLastSetOpen: false,
      lastSetDraft: null,
      controllerUiDirty: false,
      workoutController: controller,
      THEME: { bg: 0, card: 1, cardActive: 2, textPrimary: 3, textSecondary: 4, primary: 5, primaryDeep: 6, primaryLight: 7, success: 8, yellow: 9 },
      WORKOUT_TIMER_MODAL_LAYOUT, EXTENSION_CLOCK_LAYOUT,
      currentClockLabel: () => '12:34', lastRenderedClock: null, recordingLabel,
      widget: { FILL_RECT: 1, TEXT: 2, BUTTON: 3 },
      align: { CENTER_H: 1, CENTER_V: 2, TOP: 3 },
      text_style: { NONE: 0, WRAP: 1 },
      px: (val) => val,
      font: () => 20,
      formatMarqueeText: (txt) => txt,
      stepperRowLayout: () => ({ valueHeight: 40, labelHeight: 20 }),
      recordingDetails,
      addWidget: (type, props) => {
        const item = { type, props };
        createdWidgets.push(item);
        return item;
      },
      addLiveButton: (key, props) => {
        const item = { key, props };
        createdWidgets.push(item);
        return item;
      },
      addLiveLabel: (key, props) => {
        const item = { key, props };
        createdWidgets.push(item);
        return item;
      },
      renderUI: () => { calls.push('renderUI'); },
      scheduleRenderUI: () => { calls.push('scheduleRenderUI'); },
      Math,
      String,
      Boolean,
    };

    vm.createContext(env);

    const fnNames = [
      'renderClock',
      'canOpenSyncDetails',
      'openSyncDetailsModal',
      'closeSyncDetailsModal',
      'startEditLastSet',
      'cancelEditLastSet',
      'saveEditLastSet',
      'renderSyncDetailsModal',
      'renderEditLastSetScreen',
    ];

    for (const name of fnNames) {
      vm.runInContext(extractFunction(source, name), env);
    }
    // Also include renderStepper if present
    if (source.includes('function renderStepper(')) {
      vm.runInContext(extractFunction(source, 'renderStepper'), env);
    }

    // 1. Open sync details modal
    env.renderClock();
    const clock = createdWidgets.find(w => w.key === 'clock');
    assert.equal(typeof clock.props.click_func, 'function');
    clock.props.click_func();
    assert.equal(env.isSyncDetailsOpen, true);
    assert.equal(env.isEditLastSetOpen, false);

    // 2. Render sync details modal
    createdWidgets.length = 0;
    env.renderSyncDetailsModal();
    assert.ok(createdWidgets.some(w => w.props?.text === 'Sync status'), 'Must render title');
    assert.ok(createdWidgets.some(w => w.props?.text === 'Synced'), 'Must render status label');

    const editButton = createdWidgets.find(w => w.props?.text === 'Edit last set');
    assert.ok(editButton, 'Edit last set button must exist when allowed');
    assert.equal(typeof editButton.props?.click_func, 'function');

    const closeButton = createdWidgets.find(w => w.props?.text === 'Close');
    assert.ok(closeButton, 'Close button must exist');

    // 3. Test Close button
    closeButton.props.click_func();
    assert.equal(env.isSyncDetailsOpen, false);

    // 4. Reopen and tap "Edit last set"
    env.openSyncDetailsModal();
    assert.equal(env.isSyncDetailsOpen, true);
    editButton.props.click_func();
    assert.equal(env.isSyncDetailsOpen, false);
    assert.equal(env.isEditLastSetOpen, true);
    assert.ok(env.lastSetDraft, 'Draft must be created');
    assert.equal(env.lastSetDraft.weight, 80);
    assert.equal(env.lastSetDraft.reps, 5);

    // 5. Render Edit Last Set screen
    createdWidgets.length = 0;
    env.renderEditLastSetScreen();
    assert.ok(createdWidgets.some(w => w.props?.text === 'Bench Press'), 'Must render exercise title');
    assert.ok(createdWidgets.some(w => w.props?.text === 'Set 1'), 'Must render set index');

    // Find stepper plus/minus buttons
    const plusButtons = createdWidgets.filter(w => w.props?.text === '+');
    const minusButtons = createdWidgets.filter(w => w.props?.text === '-' || w.props?.text === '−');
    assert.equal(plusButtons.length, 2, 'Must have weight and reps plus buttons');
    assert.equal(minusButtons.length, 2, 'Must have weight and reps minus buttons');

    // Weight is the first stepper (step = 2.5)
    plusButtons[0].props.click_func();
    assert.equal(env.lastSetDraft.weight, 82.5, 'Weight increased by 2.5');
    minusButtons[0].props.click_func();
    assert.equal(env.lastSetDraft.weight, 80, 'Weight decreased by 2.5');

    // Reps is the second stepper (step = 1)
    plusButtons[1].props.click_func();
    assert.equal(env.lastSetDraft.reps, 6, 'Reps increased by 1');
    minusButtons[1].props.click_func();
    assert.equal(env.lastSetDraft.reps, 5, 'Reps decreased by 1');

    // 6. Test Cancel button
    const cancelButton = createdWidgets.find(w => w.props?.text === 'Cancel');
    assert.ok(cancelButton, 'Cancel button must exist');
    cancelButton.props.click_func();
    assert.equal(env.isEditLastSetOpen, false);
    assert.equal(env.lastSetDraft, null, 'Draft discarded on cancel');

    // 7. Test Save button workflow
    env.startEditLastSet();
    assert.equal(env.isEditLastSetOpen, true);
    assert.ok(env.lastSetDraft);
    env.lastSetDraft.weight = 85;
    env.lastSetDraft.reps = 8;
    env.saveEditLastSet();
    assert.equal(env.isEditLastSetOpen, false);
    assert.equal(env.lastSetDraft, null);
    assert.deepEqual(savedDraft.weight, 85);
    assert.deepEqual(savedDraft.reps, 8);

    controller.view = () => ({ state: 'READY' });
    env.openSyncDetailsModal();
    assert.equal(env.isSyncDetailsOpen, false, 'No sync modal before an active session');
    controller.view = () => ({ state: 'REST' });
    env.startEditLastSet();
    const retainedDraft = env.lastSetDraft;
    env.openSyncDetailsModal();
    assert.equal(env.isEditLastSetOpen, true, 'Clock cannot dismiss an edit draft');
    assert.equal(env.lastSetDraft, retainedDraft);
    env.cancelEditLastSet();

    // 8. Test lifecycle guards (torn down or paused)
    env.isTearingDown = true;
    env.openSyncDetailsModal();
    assert.equal(env.isSyncDetailsOpen, false, 'openSyncDetailsModal ignored when tearing down');
    env.startEditLastSet();
    assert.equal(env.isEditLastSetOpen, false, 'startEditLastSet ignored when tearing down');

    if (product === 'data-widget') {
      env.isTearingDown = false;
      env.isPaused = true;
      env.openSyncDetailsModal();
      assert.equal(env.isSyncDetailsOpen, false, 'openSyncDetailsModal ignored when paused');
      env.startEditLastSet();
      assert.equal(env.isEditLastSetOpen, false, 'startEditLastSet ignored when paused');
    }
  });
}

test('layout geometry fits within round (480x480) and square (390x450) watch screens', () => {
  const roundLayout = createScreenLayout({ width: 480, height: 480, screenShape: 1 });
  const squareLayout = createScreenLayout({ width: 390, height: 450, screenShape: 0 });

  for (const layout of [roundLayout, squareLayout]) {
    const base = layout.isFitted ? 390 / 480 : 1;
    const maxW = layout.isFitted ? 390 : 480;
    const maxH = layout.isFitted ? 450 : 480;
    const fittedPanel = layout.fit({
      x: WORKOUT_TIMER_MODAL_LAYOUT.panelX * base,
      y: WORKOUT_TIMER_MODAL_LAYOUT.panelY * base,
      w: WORKOUT_TIMER_MODAL_LAYOUT.panelWidth * base,
      h: WORKOUT_TIMER_MODAL_LAYOUT.panelHeight * base,
    });
    assert.ok(fittedPanel.x >= 0, `Panel x (${fittedPanel.x}) within screen`);
    assert.ok(fittedPanel.y >= 0, `Panel y (${fittedPanel.y}) within screen`);
    assert.ok(fittedPanel.x + fittedPanel.w <= maxW, `Panel width within screen`);
    assert.ok(fittedPanel.y + fittedPanel.h <= maxH, `Panel height within screen`);
  }
});
