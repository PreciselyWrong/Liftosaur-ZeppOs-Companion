import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../page/common/index.js', import.meta.url), 'utf8');

function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

function fixture() {
  const calls = [];
  const timers = new Map();
  let nextTimer = 0;
  let inClick = false;
  let buttonProps;
  const events = [];
  const env = {
    isTearingDown: false, isDispatchingClick: false, renderTimer: null,
    controllerUiDirty: false, activeWidgets: [], liveWidgets: {},
    preparationImageUrl: null, isNotesModalOpen: false,
    workoutDiagnostics: { record(code, context) { events.push({ code, context }); }, trace(_phase, operation) { return operation(); } }, WORKOUT_DIAGNOSTIC_CODES: {
      ACTION_TAP: 'ACTION_TAP', RENDER_START: 'RENDER_START', RENDER_END: 'RENDER_END',
      CLEAR_START: 'CLEAR_START', CLEAR_END: 'CLEAR_END', SCREEN_START: 'SCREEN_START',
      SCREEN_END: 'SCREEN_END', REDRAW_START: 'REDRAW_START', REDRAW_END: 'REDRAW_END', CLEAR_START: 'CLEAR_START', CLEAR_END: 'CLEAR_END',
    },
    widget: { BUTTON: 1, FILL_RECT: 2 }, W: 480, H: 480, THEME: { bg: 0 },
    createWidget: (_type, props) => { if (props.click_func) buttonProps = props; return {}; },
    deleteWidget: () => { if (inClick) throw new Error('deleted the clicked button'); calls.push('delete'); },
    clearWidgets() { env.activeWidgets.forEach(env.deleteWidget); env.activeWidgets = []; },
    consumeControllerUiChange() {}, destroyModalControls() {}, hideModalControls() {},
    renderDemoBadge() {}, renderScreen() {}, renderClock() {},
    redraw: () => calls.push('redraw'),
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.createContext(env);
  vm.runInContext(['addRawWidget', 'wrapNativeAction', 'addActionWidget', 'renderUI', 'scheduleRenderUI', 'cancelScheduledRender'].map(extract).join('\n'), env);
  return { env, calls, timers, events, get buttonProps() { return buttonProps; }, set inClick(value) { inClick = value; } };
}

test('Companion applies a tap immediately and redraws after the native callback returns', () => {
  const state = fixture();
  let actionCount = 0;
  state.env.addActionWidget({ click_func: () => { actionCount += 1; state.env.renderUI(); } });
  state.inClick = true;
  assert.doesNotThrow(() => state.buttonProps.click_func());
  state.inClick = false;
  assert.equal(actionCount, 1);
  assert.deepEqual(state.calls, []);
  assert.equal(state.timers.size, 1);
  [...state.timers.values()][0]();
  assert.deepEqual(state.calls, ['delete', 'redraw']);
  assert.deepEqual(state.events.map(event => event.code), [
    'ACTION_TAP', 'RENDER_START', 'CLEAR_START', 'CLEAR_END', 'SCREEN_START', 'SCREEN_END',
    'REDRAW_START', 'REDRAW_END', 'RENDER_END',
  ]);
});

test('a queued Companion redraw and stale button cannot touch a destroyed page', () => {
  const state = fixture();
  let actionCount = 0;
  state.env.addActionWidget({ click_func: () => { actionCount += 1; state.env.renderUI(); } });
  const staleButton = state.buttonProps;
  state.inClick = true;
  staleButton.click_func();
  state.inClick = false;
  const staleTimer = [...state.timers.values()][0];
  state.env.isTearingDown = true;
  state.calls.length = 0;
  staleTimer();
  staleButton.click_func();
  assert.equal(actionCount, 1);
  assert.deepEqual(state.calls, []);
});

test('Companion action metadata is semantic and removed before native widget creation', () => {
  const state = fixture();
  state.env.addActionWidget({ diagnosticAction: 'START_SET', click_func() {} });
  assert.equal(Object.hasOwn(state.buttonProps, 'diagnosticAction'), false);
  state.buttonProps.click_func();
  assert.equal(state.events[0].context.action, 'START_SET');
});
