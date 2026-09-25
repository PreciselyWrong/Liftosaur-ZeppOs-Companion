import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { exerciseInfoPages } from '../shared/exercise-info-pages.js';
import { INFO_TEXT_LAYOUT } from '../shared/exercise-info-layout.js';

import {
  TYPOGRAPHY,
  ACTIVE_SET_LAYOUT,
  ACTIVE_SET_ACTION_LAYOUT,
  EXTENSION_CLOCK_LAYOUT,
  PREPARED_TOP_BAR_LAYOUT,
  WORKOUT_PROGRESS_LAYOUT,
  activeSetLayout,
  extensionActiveSetLayout,
  stepperRowLayout,
  shouldShowRpe,
  LIST_PAGE_SIZE,
  OVERVIEW_PAGE_SIZE,
  READY_PREVIEW_SIZE,
  readyExercisePage,
  formatWorkoutPosition,
  formatMarqueeText,
} from '../shared/watch-layout.js';

const root = process.cwd();

test('every typography role is readable at physical watch size', () => {
  assert.equal(Math.min(...Object.values(TYPOGRAPHY)), 20);
  assert.equal(TYPOGRAPHY.body, 25);
  assert.equal(TYPOGRAPHY.title, 30);
  assert.equal(TYPOGRAPHY.value, 38);
  assert.ok(TYPOGRAPHY.title > TYPOGRAPHY.body);
  assert.ok(TYPOGRAPHY.value > TYPOGRAPHY.button);
  assert.ok(TYPOGRAPHY.timer > TYPOGRAPHY.value);
});

test('the watch renderer uses semantic typography instead of local sizes', () => {
  const source = fs.readFileSync(
    path.join(root, 'page', 'common', 'index.js'),
    'utf8',
  );
  assert.doesNotMatch(source, /text_size:\s*px\(/);
  assert.match(source, /text_size:\s*font\('/);
});

test('the phone settings page has no tiny text', () => {
  const source = fs.readFileSync(
    path.join(root, 'setting', 'index.js'),
    'utf8',
  );
  const sizes = [...source.matchAll(/fontSize:\s*'(\d+)px'/g)].map((match) => Number(match[1]));
  assert.ok(sizes.length > 0);
  assert.ok(Math.min(...sizes) >= 15);
});

test('demo mode is explicit in settings and on every watch screen', () => {
  const settingsSource = fs.readFileSync(
    path.join(root, 'setting', 'index.js'),
    'utf8',
  );
  const watchSource = fs.readFileSync(
    path.join(root, 'page', 'common', 'index.js'),
    'utf8',
  );

  assert.match(settingsSource, /isDemoApiKey/);
  assert.match(settingsSource, /Demo mode/);
  assert.match(watchSource, /serviceMode === 'DEMO'/);
  assert.match(watchSource, /function renderDemoBadge/);
  assert.match(watchSource, /renderDemoBadge\(\)/);
});

test('dense screens show fewer readable rows instead of shrinking text', () => {
  assert.equal(LIST_PAGE_SIZE, 3);
  assert.equal(OVERVIEW_PAGE_SIZE, 3);
  assert.equal(READY_PREVIEW_SIZE, 2);
});

test('Prepare top bar fits the round-screen chord without overlapping controls', () => {
  const { y, height, menu, elapsed, metric } = PREPARED_TOP_BAR_LAYOUT;
  const radius = 240;
  const inset = radius - Math.sqrt(radius ** 2 - (radius - y) ** 2);
  const visibleRight = 480 - inset;

  assert.ok(menu.x >= inset);
  assert.ok(menu.x + menu.width <= elapsed.x);
  assert.ok(elapsed.x + elapsed.width <= metric.x);
  assert.ok(metric.x + metric.width <= visibleRight);
  assert.ok(y + height <= 90);
  assert.equal(PREPARED_TOP_BAR_LAYOUT.rest, undefined, 'Rest pill must be removed from prepared top bar layout');
});

test('stepper value line-box provides breathing room without label overlap across row modes and scales', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  assert.doesNotMatch(source, /h:\s*height\s*-\s*px\(24\)/, 'Value line box must not use clamped height-24 formula');
  assert.doesNotMatch(source, /y:\s*y\s*\+\s*height\s*-\s*px\(28\)/, 'Label must not overlap value box');

  for (const rowHeight of [ACTIVE_SET_LAYOUT.withRpe.rowHeight, ACTIVE_SET_LAYOUT.withoutRpe.rowHeight]) {
    const layout = stepperRowLayout(rowHeight);
    assert.ok(layout.valueHeight > TYPOGRAPHY.value, 'Value line-box must be taller than font size for breathing room');
    assert.ok(layout.labelOffsetY >= layout.valueHeight, 'Label must not overlap value box vertically');
    assert.equal(layout.valueHeight + layout.labelHeight, rowHeight, 'Row elements must fill row height exactly');
  }

  for (const scale of [1.0, 0.8, 0.75]) {
    const rowHeight = Math.round(ACTIVE_SET_LAYOUT.withRpe.rowHeight * scale);
    const design = stepperRowLayout(ACTIVE_SET_LAYOUT.withRpe.rowHeight);
    const layout = Object.fromEntries(Object.entries(design).map(([key, value]) => [key, Math.round(value * scale)]));
    assert.ok(layout.valueHeight + layout.labelHeight <= rowHeight + 1);
    assert.ok(layout.labelHeight >= Math.round(TYPOGRAPHY.micro * scale) + Math.round(2 * scale));
    const scaledFont = Math.round(TYPOGRAPHY.value * scale);
    assert.ok(layout.valueHeight >= scaledFont, 'Scaled value line-box must fit scaled font');
    assert.ok(layout.labelOffsetY >= layout.valueHeight, 'Scaled label must not overlap value box');
  }
});

test('active set action button fits within circular screen chord and keeps clock gap', () => {
  const radius = 240;
  const layout = extensionActiveSetLayout({ targetRpe: 8 });
  const bottomY = layout.actionY + layout.actionHeight;
  const chordHalf = Math.sqrt(radius ** 2 - (bottomY - radius) ** 2);
  const leftEdge = radius - chordHalf;
  const rightEdge = radius + chordHalf;

  assert.ok(ACTIVE_SET_ACTION_LAYOUT.x >= leftEdge, 'Action button left must fit within round chord');
  assert.ok(ACTIVE_SET_ACTION_LAYOUT.x + ACTIVE_SET_ACTION_LAYOUT.width <= rightEdge, 'Action button right must fit within round chord');
  assert.ok(EXTENSION_CLOCK_LAYOUT.y - bottomY >= EXTENSION_CLOCK_LAYOUT.minimumActionGap, 'Must keep minimum clock gap');
});

test('ready exercise pages preserve order and wrap in both directions', () => {
  const exercises = ['Squat', 'Bench', 'Deadlift', 'Row', 'Curl', 'Press', 'Carry'];

  assert.deepEqual(readyExercisePage(exercises, 0), {
    exercises: ['Squat', 'Bench'],
    page: 0,
    totalPages: 4,
  });
  assert.deepEqual(readyExercisePage(exercises, 1), {
    exercises: ['Deadlift', 'Row'],
    page: 1,
    totalPages: 4,
  });
  assert.equal(readyExercisePage(exercises, 4).page, 0);
  assert.equal(readyExercisePage(exercises, -1).page, 3);
});

test('an empty ready exercise page remains stable without controls', () => {
  assert.deepEqual(readyExercisePage([], 4), {
    exercises: [],
    page: 0,
    totalPages: 1,
  });
});

test('ready-screen actions render above the demo badge and below the disabled footer', () => {
  const source = fs.readFileSync(
    path.join(root, 'page', 'common', 'index.js'),
    'utf8',
  );
  const renderUi = source.slice(source.indexOf('function renderUI()'), source.indexOf('function renderScreen()'));
  assert.ok(renderUi.indexOf('renderClock()') > renderUi.indexOf("trace('SCREEN', renderScreen)"));
  assert.match(source, /function renderReadyScreen[\s\S]*?text_size:\s*font\('body'\)/);
});

test('button actions run in the native Zepp click callback', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const addWidget = source.slice(source.indexOf('function addActionWidget'), source.indexOf('function addLiveLabel'));

  assert.doesNotMatch(source, /function deferAction\(clickFunc\)/);
  assert.match(addWidget, /click_func: wrapNativeAction\(nativeProps\.click_func, diagnosticAction \|\| 'BUTTON'\)/);
  assert.doesNotMatch(addWidget, /setEnable\(false\)/);
  assert.match(source, /function addLiveButton[\s\S]*?addActionWidget\(fitted\)/);
});

test('the Zepp view is redrawn after the replacement tree is complete', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const clearWidgets = source.slice(source.indexOf('function clearWidgets()'), source.indexOf('function addRawWidget'));
  const renderUi = source.slice(source.indexOf('function renderUI()'), source.indexOf('function renderScreen()'));

  assert.match(source, /import \{[^}]*redraw[^}]*\} from '@zos\/ui'/);
  assert.match(clearWidgets, /deleteWidget\(w\)/);
  assert.doesNotMatch(clearWidgets, /redraw\(\)/);
  assert.ok(renderUi.indexOf("trace('SCREEN', renderScreen)") < renderUi.indexOf("trace('REDRAW', redraw)"));
});

test('live labels use mutable buttons so timer ticks cannot recreate action targets', () => {
  const source = fs.readFileSync(
    path.join(root, 'page', 'common', 'index.js'),
    'utf8',
  );
  const liveLabel = source.slice(source.indexOf('function addLiveLabel'), source.indexOf('function addLiveButton'));

  assert.match(liveLabel, /addRawWidget\(widget\.BUTTON, fitted\)/);
  assert.doesNotMatch(liveLabel, /addRawWidget\(widget\.TEXT, fitted\)/);
});

test('the workout preview pages its exercise list without opening a modal', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const ready = source.slice(source.indexOf('function renderReadyScreen'), source.indexOf('function renderTopBar'));

  assert.match(ready, /readyExercisePage\(view\.overviewExercises, readyPage\)/);
  assert.match(ready, /text: '<'/);
  assert.match(ready, /text: '>'/);
  assert.match(ready, /`\$\{page \+ 1\}\/\$\{totalPages\}.*\$\{view\.totalExercises\} exercises`/);
  assert.doesNotMatch(ready, /openTextModal/);
  assert.doesNotMatch(ready, /more/);
});

test('the ready preview shows two readable rows above fixed actions', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const ready = source.slice(source.indexOf('function renderReadyScreen'), source.indexOf('function renderTopBar'));

  assert.match(ready, /exercises\.forEach/);
  assert.match(ready, /const rowY = 112 \+ index \* 84/);
  assert.match(ready, /x: px\(showsImage \? 154 : 78\)[\s\S]*?y: px\(rowY \+ 6\)[\s\S]*?h: px\(32\)[\s\S]*?text: exercise\.name/);
  assert.match(ready, /x: px\(showsImage \? 154 : 78\)[\s\S]*?y: px\(rowY \+ 40\)[\s\S]*?h: px\(28\)[\s\S]*?color: THEME\.textSecondary[\s\S]*?text_size: font\('micro'\)[\s\S]*?text: exercise\.prescriptionSummary/);
  assert.doesNotMatch(ready, /`\$\{truncate\(exercise\.name, 20\)\}\\n\$\{exercise\.prescriptionSummary\}`/);
  assert.equal((ready.match(/y: px\(338\)/g) || []).length, 2);
});

test('the ready preview marks supersets with their existing group colour', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const ready = source.slice(source.indexOf('function renderReadyScreen'), source.indexOf('function renderTopBar'));

  assert.match(ready, /if \(exercise\.supersetGroup\)/);
  assert.match(ready, /color: supersetColor\(exercise\.supersetGroup\)/);
  assert.match(ready, /x: px\(68\)[\s\S]*?w: px\(5\)[\s\S]*?h: px\(64\)/);
});

test('ready-screen swipes mirror its paging buttons', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const handler = source.slice(source.indexOf('function handleGesture'), source.indexOf('function heartRateColor'));

  assert.match(handler, /view\.state === SESSION_STATES\.READY/);
  assert.match(handler, /readyPage [+-]= 1/);
});

test('modal pages stay short enough to clear their controls', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  assert.match(source, /import \{ exerciseInfoPages \} from '..\/..\/shared\/exercise-info-pages.js'/);
  const content = `## Description\n${'Long instruction. '.repeat(50)}`;
  assert.ok(exerciseInfoPages(content, false, null).every((page) => page.body.split('\n').length <= 6));
  const imagePages = exerciseInfoPages(content, true, '/image.png', 'ready');
  assert.deepEqual(imagePages[0], { image: true, subtitle: '', body: '' });
  assert.deepEqual(imagePages.slice(1), exerciseInfoPages(content, false, null));
  assert.ok(imagePages.slice(1).every((page) => page.body.split('\n').length <= 6));
  assert.deepEqual(exerciseInfoPages(content, true, '/image.png', 'loading'),
    exerciseInfoPages(content, false, null));
  assert.ok(INFO_TEXT_LAYOUT.bodyY + INFO_TEXT_LAYOUT.bodyH < 348);
  assert.ok(INFO_TEXT_LAYOUT.imageBodyY + INFO_TEXT_LAYOUT.imageBodyH < 348);
});

for (const product of ['page', 'data-widget']) {
  test(`${product} scrolls complete overview lines while retaining the row button`, () => {
    const source = fs.readFileSync(path.join(root, product, 'common', 'index.js'), 'utf8');
    const overview = source.slice(source.indexOf('function renderOverviewScreen('), source.indexOf('\nfunction ', source.indexOf('function renderOverviewScreen(') + 1));
    assert.match(overview, /formatOverviewExerciseLines\(ex\)/);
    assert.match(overview, /\[lines\.title, 3,/);
    assert.match(overview, /\[lines\.prescription, 35,/);
    assert.match(overview, /text_style: text_style\.NONE, text/);
    assert.match(overview, /\.setEnable\(false\)/);
    assert.doesNotMatch(overview, /truncate\(ex\.name/);
    assert.match(overview, /click_func:/);
  });
}

test('modal actions use large central touch targets and ASCII labels', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const modal = source.slice(source.indexOf('function renderNotesModal'), source.indexOf('function heartRateColor'));
  const controls = source.slice(source.indexOf('function ensureModalControls'), source.indexOf('function destroyModalControls'));

  assert.match(modal, /h: px\(INFO_TEXT_LAYOUT\.bodyH\)/);
  assert.match(controls, /x: px\(INFO_NAV\.previous\.x\),[\s\S]*?w: px\(INFO_NAV\.previous\.w\),[\s\S]*?text: '<'/);
  assert.match(controls, /x: px\(INFO_NAV\.next\.x\),[\s\S]*?w: px\(INFO_NAV\.next\.w\),[\s\S]*?text: '>'/);
  assert.match(controls, /text: '<'/);
  assert.match(controls, /text: '>'/);
  assert.doesNotMatch(controls, /[‹›]/);
});

test('modal controls persist across their own callbacks', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const clearWidgets = source.slice(source.indexOf('function clearWidgets()'), source.indexOf('function addRawWidget'));
  const modal = source.slice(source.indexOf('function renderNotesModal'), source.indexOf('function handleGesture'));

  assert.match(source, /let modalControls = null/);
  assert.match(source, /function ensureModalControls\(totalPages\)/);
  assert.match(source, /setProperty\(prop\.VISIBLE, visible\)/);
  assert.match(modal, /ensureModalControls\(totalPages\)/);
  assert.doesNotMatch(modal, /addWidget\(widget\.BUTTON/);
  assert.doesNotMatch(clearWidgets, /modalControls/);
});

test('changing modal pages updates labels without rebuilding over persistent controls', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const movePage = source.slice(source.indexOf('function moveNotesPage'), source.indexOf('function renderNotesModal'));
  const modal = source.slice(source.indexOf('function renderNotesModal'), source.indexOf('function handleGesture'));

  assert.match(movePage, /updateLiveWidget\('modal-content'/);
  assert.match(movePage, /updateLiveWidget\('modal-page'/);
  assert.doesNotMatch(movePage, /renderUI\(\)/);
  assert.match(modal, /addLiveLabel\('modal-content'/);
  assert.match(modal, /addLiveLabel\('modal-page'/);
});

test('reopening a modal recreates controls above the new modal content', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const openModal = source.slice(source.indexOf('function openTextModal'), source.indexOf('function renderDemoBadge'));

  assert.match(openModal, /destroyModalControls\(\)/);
  assert.ok(openModal.indexOf('destroyModalControls()') < openModal.indexOf('renderUI()'));
});

test('modal gestures are registered directly while teardown stays native-free', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const onDestroy = source.slice(source.indexOf('onDestroy()'), source.indexOf('\n    },', source.indexOf('onDestroy()')));

  assert.match(source, /onGesture\(\{ callback: handleGesture \}\)/);
  assert.doesNotMatch(onDestroy, /offGesture\(\)/);
  assert.match(source, /GESTURE_LEFT/);
  assert.match(source, /GESTURE_RIGHT/);
  assert.match(source, /GESTURE_DOWN/);
});

test('session gestures mirror reversible rest and overview controls', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const handler = source.slice(source.indexOf('function handleGesture'), source.indexOf('function heartRateColor'));

  assert.match(source, /GESTURE_UP/);
  assert.match(handler, /session\.adjustRest\(-10\)/);
  assert.match(handler, /session\.adjustRest\(10\)/);
  assert.match(handler, /session\.toggleRestPause\(\)/);
  assert.match(handler, /setRestPrepared\(true\)/);
  assert.match(handler, /setRestPrepared\(false\)/);
  assert.match(handler, /overviewPage = \(overviewPage [+-] 1/);
  assert.match(handler, /isOverviewOpen = false/);
});

test('connection title uses the same marquee renderer as long program names', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const connection = source.slice(source.indexOf('function renderConnectionScreen'), source.indexOf('function renderHomeScreen'));

  assert.match(source, /function renderMarqueeTitle\(text, color/);
  assert.match(connection, /renderMarqueeTitle\(PHONE_CONNECTION_TITLE, THEME\.orange\)/);
});

test('the exercise details control is a labeled button without emoji', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const activeSet = source.slice(source.indexOf('function renderActiveSetScreen'), source.indexOf('function renderStepper'));

  assert.match(activeSet, /text: 'Info'/);
  assert.doesNotMatch(activeSet, /[🔥ℹ]/);
  assert.doesNotMatch(source, /[🔥ℹ⏱▶]/);
});

test('live button updates omit properties unsupported by setProperty', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const update = source.slice(source.indexOf('function updateLiveWidget'), source.indexOf('function persistSession'));

  assert.match(source, /LIVE_WIDGET_MUTABLE_KEYS/);
  assert.doesNotMatch(update, /setProperty\(prop\.MORE, entry\.props\)/);
});

test('workout position remains readable when a day name is long', () => {
  assert.equal(formatWorkoutPosition(1, 1), 'Week 1 - Day 1');
  assert.equal(formatWorkoutPosition(12, 4), 'Week 12 - Day 4');
});

test('long marquee text repeats with short gaps while short text stays still', () => {
  assert.equal(formatMarqueeText('Short title'), 'Short title');
  const marquee = formatMarqueeText('Day 2: Overhead Press & Deadlift');
  assert.equal(marquee.match(/Day 2: Overhead Press & Deadlift/g)?.length, 4);
  assert.match(marquee, /Deadlift {6}Day 2/);
});

test('the home screen separates the fixed workout position from the moving day name', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const home = source.slice(source.indexOf('function renderHomeScreen'), source.indexOf('function renderProgramsScreen'));

  assert.match(home, /renderMarqueeTitle\(outline\.programName \|\| 'Lifto Companion'\)/);
  assert.match(home, /text: formatWorkoutPosition\(start\.week\.number, start\.day\.number\)/);
  assert.match(home, /text: formatMarqueeText\(start\.day\.name\)/);
  assert.doesNotMatch(home, /formatWorkoutButtonLabel/);
});

test('the home workout is one rounded card with flat text layers', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const home = source.slice(source.indexOf('function renderHomeScreen'), source.indexOf('function renderProgramsScreen'));

  assert.match(home, /h: px\(148\),[\s\S]*?text: ''/);
  assert.equal((home.match(/radius: px\(1\)/g) || []).length, 2);
});

test('RPE is shown only when the current set asks for it', () => {
  assert.equal(shouldShowRpe({ targetRpe: 8 }), true);
  assert.equal(shouldShowRpe({ targetRpe: 0 }), true);
  assert.equal(shouldShowRpe({ targetRpe: null }), false);
  assert.equal(shouldShowRpe({}), false);
});

test('RPE is shown when Liftosaur requires logging without a target', () => {
  assert.equal(activeSetLayout({ targetRpe: null, logRpe: true }).showRpe, true);
});

test('sets without RPE get two larger controls and a larger action', () => {
  const compact = activeSetLayout({ targetRpe: null });
  assert.equal(compact.showRpe, false);
  assert.deepEqual(compact.rows.map((row) => row.key), ['weight', 'reps']);
  assert.ok(compact.rowHeight > ACTIVE_SET_LAYOUT.withRpe.rowHeight);
  assert.ok(compact.actionHeight > ACTIVE_SET_LAYOUT.withRpe.actionHeight);
});

test('the optional progress bar fits inside the round Active 2 top chord', () => {
  const { x, y, width, height } = WORKOUT_PROGRESS_LAYOUT;
  for (const cornerX of [x, x + width]) {
    for (const cornerY of [y, y + height]) {
      assert.ok((cornerX - 240) ** 2 + (cornerY - 240) ** 2 < 240 ** 2);
    }
  }
  assert.ok(y + height < 45, 'clear the Companion top controls');
  assert.ok(y + height < PREPARED_TOP_BAR_LAYOUT.y, 'clear prepared controls');
});

test('an unlabeled weight row gives its full height to the value and unit', () => {
  assert.deepEqual(stepperRowLayout(72, false), {
    valueHeight: 72, labelHeight: 0, labelOffsetY: 72,
  });
});

test('sets with RPE keep all three controls inside the design box', () => {
  const layout = activeSetLayout({ targetRpe: 8 });
  assert.equal(layout.showRpe, true);
  assert.deepEqual(layout.rows.map((row) => row.key), ['weight', 'reps', 'rpe']);
  assert.ok(layout.actionY + layout.actionHeight <= 440);
});

test('Workout Extension action keeps breathing room above the clock', () => {
  for (const set of [{ targetRpe: null }, { targetRpe: 8 }]) {
    const layout = extensionActiveSetLayout(set);
    const gap = EXTENSION_CLOCK_LAYOUT.y - (layout.actionY + layout.actionHeight);

    assert.ok(gap >= EXTENSION_CLOCK_LAYOUT.minimumActionGap);
    assert.ok(layout.actionHeight >= 48, 'action must remain a large touch target');
  }
});

test('discarding a restored workout reloads programs when no outline is in memory', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const handler = source.match(/function returnAfterDiscard\(\) \{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(handler, /isBusy = false/);
  assert.match(handler, /statusMessage = ''/);
  assert.match(handler, /if \(outline\)/);
  assert.match(handler, /loadPrograms\(\)/);
  assert.match(handler, /workoutController\.clear\(\)/);
});

test('a restored finished workout resumes saving instead of becoming dismissible', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');

  assert.match(source, /directSync\.finishRequestedAt \|\| restoredState === SESSION_STATES\.FINISHED/);
  assert.match(source, /submitWorkout\(\)/);
  assert.match(source, /const isSending = status\.status === 'SENDING'/);
  assert.match(source, /if \(!isSending\)[\s\S]*text: canLeave \? 'Done' : 'Discard'/);
});

test('the rest preview shows the exact loading below the next target', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const restScreen = source.match(/function renderRestScreen\(view\) \{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(
    restScreen,
    /formatLoadoutLabel\(\s*rest\.nextTargetWeight,\s*view\.pending\?\.loadingEquipment,\s*rest\.nextUnit/,
  );
  assert.match(restScreen, /text:\s*nextLoadoutLabel/);
});

test('heart rate uses a monochrome heart instead of the HR abbreviation', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');

  assert.match(source, /return `♥ \$\{hrVal\}`/);
  assert.match(source, /text:\s*formatHeartRate\(liveHr\)/);
  assert.doesNotMatch(source, /`HR \$\{liveHr\}`/);
});

test('the production page never invents a heart rate when the sensor is unavailable', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');

  assert.doesNotMatch(source, /liveHr\s*=\s*['"]138['"]/);
});

test('standalone loading and setup screens use the Lifto Companion name', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const setup = source.slice(source.indexOf('function renderSetupScreen()'), source.indexOf('function renderConnectionScreen()'));
  const loading = source.slice(source.indexOf('function renderLoadingScreen()'), source.indexOf('function handleExerciseImageChange'));

  assert.match(setup, /renderTitle\('Lifto Companion'\)/);
  assert.match(loading, /renderTitle\('Lifto Companion'\)/);
});

test('Companion teardown cannot perform native work that breaks the next launch', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const renderUI = source.slice(source.indexOf('function renderUI()'), source.indexOf('\nfunction ', source.indexOf('function renderUI()') + 1));
  const onDestroy = source.slice(source.indexOf('onDestroy()'), source.indexOf('\n    },', source.indexOf('onDestroy()')));

  assert.match(source, /let isTearingDown = false/);
  assert.match(renderUI, /if \(isTearingDown\) return/);
  assert.match(onDestroy, /isTearingDown = true/);
  assert.match(onDestroy, /exerciseImages\?\.abandon\(\)/);
  assert.doesNotMatch(
    onDestroy,
    /\.dispose\(|stopClock\(|stopVibration\(|offGesture\(|offCurrentChange|resetDisplayHold\(|clearWidgets\(|destroyModalControls\(/,
  );
});

test('exercise thumbnails in companion and extension have a white backing tile', () => {
  for (const relPath of ['page/common/index.js', 'data-widget/common/index.js']) {
    const source = fs.readFileSync(path.join(root, relPath), 'utf8');
    assert.match(
      source,
      /addWidget\(widget\.FILL_RECT,\s*\{[\s\S]*?color:\s*0xffffff[\s\S]*?\}\);\s*addWidget\(widget\.IMG/,
      `expected white FILL_RECT before widget.IMG in ${relPath}`,
    );
  }
});

