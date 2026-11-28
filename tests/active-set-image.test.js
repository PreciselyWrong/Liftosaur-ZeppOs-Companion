import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as watchLayout from '../shared/watch-layout.js';
import { normalizeWorkoutDisplaySettings, weightStepperDisplay } from '../shared/workout-display-settings.js';
import { normalizeExerciseImages } from '../shared/exercise-images.js';
import { exerciseDisplayImageUrl } from '../shared/exercise-notes.js';
import { isPurpleRestRing, darkenColor } from '../shared/rest-visual.js';

const imageUrl = 'https://www.liftosaur.com/externalimages/exercises/single/small/squat.png';

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  return source.slice(start, source.indexOf('\nfunction ', start + 1));
}

// Renders the real set screen of a product with recording widget and image stubs.
function renderSetScreen(product, { resting, warmup, imageStatus }) {
  const source = fs.readFileSync(`${product}/common/index.js`, 'utf8');
  const widgets = [];
  const imageCalls = [];
  const record = (type) => (props) => {
    const entry = { type, ...props };
    widgets.push(entry);
    return entry;
  };
  const set = { isWarmup: warmup, weight: 60, reps: 5, targetRpe: null };
  const pending = {
    setIndex: 0, totalSets: 3, exerciseName: 'Squat', exerciseDetails: 'Deep squat', exerciseImageUrl: imageUrl,
    loadingEquipment: 'barbell', changes: { exercise: false, weight: false, reps: false, rpe: false }, set,
  };
  const view = {
    state: resting ? 'REST' : 'ACTIVE_SET',
    rest: resting ? { remaining: 59, isPaused: false, isOvertime: false } : null,
    pending: resting ? pending : null,
    currentSet: set, exerciseName: 'Squat', exerciseDetails: 'Deep squat', exerciseImageUrl: imageUrl,
    currentSetIndex: 0, totalSets: 3, unit: 'kg', elapsedSeconds: 125, isWorkoutPaused: false,
  };
  const controller = {
    skipWarmup: () => false, adjustWeight() {}, adjustReps() {}, adjustRpe() {}, completeSet() {}, nextSet() {},
    startTimedSet() {}, view: () => view,
  };
  const env = {
    ...watchLayout,
    normalizeWorkoutDisplaySettings, weightStepperDisplay, normalizeExerciseImages, exerciseDisplayImageUrl,
    isPurpleRestRing, darkenColor,
    accountSettings: { exerciseImages: true },
    THEME: { bg: 0, card: 1, cardActive: 2, primaryLight: 3, textPrimary: 4, textSecondary: 5, success: 6 },
    widget: { BUTTON: 'button', TEXT: 'text', IMG: 'img', FILL_RECT: 'fill_rect' },
    align: { CENTER_H: 1, CENTER_V: 2, LEFT: 3 },
    text_style: { NONE: 0 },
    px: (value) => value,
    font: (role) => watchLayout.TYPOGRAPHY[role] || 20,
    formatSeconds: () => '0:59',
    formatActiveSetProgress: () => (warmup ? 'WARMUP 1/2' : 'SET 1/3'),
    formatLoadoutLabel: () => '60 KG',
    formatEditableSetValue: (value) => String(value),
    truncate: (text) => text,
    supersetColor: () => 0,
    SESSION_STATES: { REST: 'REST', FINISHED: 'FINISHED', ACTIVE_SET: 'ACTIVE_SET' },
    renderRestBezel() {}, renderPreparedTopBar() {}, renderTopBar() {},
    preparationImageUrl: null,
    exerciseImages: {
      load: (url) => imageCalls.push(['load', url]),
      prefetch: (url) => imageCalls.push(['prefetch', url]),
      get: () => ({ status: imageStatus, src: imageStatus === 'ready' ? 'data://download/squat.png' : null }),
    },
    openNotes() {}, openTextModal() {}, checkRequiredPhoneInput: () => null, stopVibration() {},
    restAlertTracker: { reset() {} }, restStatusColor: () => 7,
    workoutController: controller, session: controller,
    submitWorkout() {}, scheduleRenderUI() {}, renderUI() {}, persistAndRender: (fn) => fn(),
    controllerUiDirty: false, liveWidgets: {}, phoneRequiredReason: null, timedTargetAlerted: false,
    refreshActiveSetControls() {},
    addWidget: (type, props) => record(type)(props),
    addLiveLabel: (key, props) => record('button')({ key, ...props }),
    addLiveButton: (key, props) => record('button')({ key, ...props }),
    updateLiveWidget: () => true,
  };
  const helpers = ['renderExerciseInfo', 'renderStepper', 'renderPreparationImage']
    .filter((name) => source.includes(`function ${name}(`))
    .map((name) => extractFunction(source, name)).join('\n');
  const render = new Function('env', `with (env) { ${helpers}\n${extractFunction(source, 'renderActiveSetScreen')}; return renderActiveSetScreen; }`)(env);
  render(view);
  const button = (text) => widgets.find((entry) => entry.text === text);
  return {
    widgets,
    imageCalls,
    image: widgets.find((entry) => entry.type === 'img'),
    tile: widgets.find((entry) => entry.type === 'fill_rect' && entry.color === 0xffffff),
    skip: button('Skip'),
    info: button('Info'),
    title: widgets.find((entry) => entry.key === 'exerciseTitle'),
    firstRowY: Math.min(...widgets.filter((entry) => entry.text === '-').map((entry) => entry.y)),
  };
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

for (const product of ['data-widget', 'page']) {
  test(`${product} Prepare shows the exercise image and Skip warm-up together`, () => {
    const screen = renderSetScreen(product, { resting: true, warmup: true, imageStatus: 'ready' });
    assert.ok(screen.image, 'the image is drawn next to Skip');
    assert.ok(screen.skip, 'Skip stays available');
    for (const [name, other] of [['Info', screen.info], ['title', screen.title], ['image', screen.tile]]) {
      assert.ok(!overlaps(screen.skip, other), `Skip must not cover the ${name}`);
    }
    assert.ok(!overlaps(screen.tile, screen.title));
    assert.ok(screen.tile.y + screen.tile.h <= screen.firstRowY && screen.skip.y + screen.skip.h <= screen.firstRowY);
  });

  test(`${product} set screen shows a cached exercise image without asking the phone`, () => {
    const screen = renderSetScreen(product, { resting: false, warmup: false, imageStatus: 'ready' });
    assert.ok(screen.image, 'a flash-cached image is drawn during the set');
    assert.equal(screen.image.src, 'data://download/squat.png');
    assert.deepEqual(screen.imageCalls, [], 'the set screen never starts a BLE image transfer');
    assert.ok(!overlaps(screen.tile, screen.title));
    assert.ok(screen.tile.y + screen.tile.h <= screen.firstRowY, 'the steppers keep their rows');
  });

  test(`${product} set screen leaves the header unchanged when the image is not in flash`, () => {
    for (const imageStatus of ['loading', 'unavailable']) {
      const screen = renderSetScreen(product, { resting: false, warmup: true, imageStatus });
      assert.equal(screen.image, undefined);
      assert.deepEqual(screen.imageCalls, []);
      assert.deepEqual({ x: screen.skip.x, y: screen.skip.y }, { x: 62, y: 88 }, 'Skip keeps its corner');
    }
  });
}
