import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  TYPOGRAPHY,
  ACTIVE_SET_LAYOUT,
  activeSetLayout,
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
  assert.match(settingsSource, /No Liftosaur account is connected/);
  assert.match(watchSource, /serviceMode === 'DEMO'/);
  assert.match(watchSource, /function renderDemoBadge/);
  assert.match(watchSource, /renderDemoBadge\(\)/);
});

test('dense screens show fewer readable rows instead of shrinking text', () => {
  assert.equal(LIST_PAGE_SIZE, 3);
  assert.equal(OVERVIEW_PAGE_SIZE, 3);
  assert.equal(READY_PREVIEW_SIZE, 3);
});

test('ready exercise pages preserve order and wrap in both directions', () => {
  const exercises = ['Squat', 'Bench', 'Deadlift', 'Row', 'Curl', 'Press', 'Carry'];

  assert.deepEqual(readyExercisePage(exercises, 0), {
    exercises: ['Squat', 'Bench', 'Deadlift'],
    page: 0,
    totalPages: 3,
  });
  assert.deepEqual(readyExercisePage(exercises, 1), {
    exercises: ['Row', 'Curl', 'Press'],
    page: 1,
    totalPages: 3,
  });
  assert.equal(readyExercisePage(exercises, 3).page, 0);
  assert.equal(readyExercisePage(exercises, -1).page, 2);
});

test('an empty ready exercise page remains stable without controls', () => {
  assert.deepEqual(readyExercisePage([], 4), {
    exercises: [],
    page: 0,
    totalPages: 1,
  });
});

test('ready-screen actions render above decorative labels', () => {
  const source = fs.readFileSync(
    path.join(root, 'page', 'common', 'index.js'),
    'utf8',
  );
  const renderUi = source.slice(source.indexOf('function renderUI()'), source.indexOf('function renderScreen()'));
  assert.ok(renderUi.indexOf('renderClock()') < renderUi.indexOf('renderScreen()'));
  assert.match(source, /function renderReadyScreen[\s\S]*?text_size:\s*font\('body'\)/);
});

test('button actions run in the native Zepp click callback', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const addWidget = source.slice(source.indexOf('function addActionWidget'), source.indexOf('function addLiveLabel'));

  assert.doesNotMatch(source, /function deferAction\(clickFunc\)/);
  assert.match(addWidget, /click_func: props\.click_func/);
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
  assert.ok(renderUi.indexOf('renderScreen()') < renderUi.indexOf('redraw()'));
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

test('the ready preview shows three readable rows above fixed actions', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const ready = source.slice(source.indexOf('function renderReadyScreen'), source.indexOf('function renderTopBar'));

  assert.match(ready, /exercises\.forEach/);
  assert.match(ready, /const rowY = 108 \+ index \* 58/);
  assert.match(ready, /y: px\(rowY\)[\s\S]*?h: px\(28\)[\s\S]*?text: truncate\(exercise\.name, 20\)/);
  assert.match(ready, /y: px\(rowY \+ 28\)[\s\S]*?h: px\(26\)[\s\S]*?color: THEME\.textSecondary[\s\S]*?text_size: font\('micro'\)[\s\S]*?text: exercise\.prescriptionSummary/);
  assert.doesNotMatch(ready, /`\$\{truncate\(exercise\.name, 20\)\}\\n\$\{exercise\.prescriptionSummary\}`/);
  assert.equal((ready.match(/y: px\(338\)/g) || []).length, 2);
});

test('the ready preview marks supersets with their existing group colour', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const ready = source.slice(source.indexOf('function renderReadyScreen'), source.indexOf('function renderTopBar'));

  assert.match(ready, /if \(exercise\.supersetGroup\)/);
  assert.match(ready, /color: supersetColor\(exercise\.supersetGroup\)/);
  assert.match(ready, /x: px\(68\)[\s\S]*?w: px\(5\)[\s\S]*?h: px\(48\)/);
});

test('ready-screen swipes mirror its paging buttons', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const handler = source.slice(source.indexOf('function handleGesture'), source.indexOf('function heartRateColor'));

  assert.match(handler, /view\.state === SESSION_STATES\.READY/);
  assert.match(handler, /readyPage [+-]= 1/);
});

test('modal pages stay short enough to clear their controls', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  assert.match(source, /function paginateNotes\(text, maxCharsPerPage = 70, maxLinesPerPage = 5\)/);
});

test('modal actions use large central touch targets and ASCII labels', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const modal = source.slice(source.indexOf('function renderNotesModal'), source.indexOf('function heartRateColor'));
  const controls = source.slice(source.indexOf('function ensureModalControls'), source.indexOf('function destroyModalControls'));

  assert.match(modal, /h: px\(246\)/);
  assert.match(controls, /x: px\(48\),[\s\S]*?w: px\(80\),[\s\S]*?text: '<'/);
  assert.match(controls, /x: px\(166\),[\s\S]*?w: px\(80\),[\s\S]*?text: '>'/);
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

test('modal gestures are registered directly and removed on teardown', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');

  assert.match(source, /onGesture\(\{ callback: handleGesture \}\)/);
  assert.match(source, /offGesture\(\)/);
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
  assert.match(handler, /isRestMinimized = true/);
  assert.match(handler, /isRestMinimized = false/);
  assert.match(handler, /overviewPage = \(overviewPage [+-] 1/);
  assert.match(handler, /isOverviewOpen = false/);
});

test('connection title uses the same marquee renderer as long program names', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const connection = source.slice(source.indexOf('function renderConnectionScreen'), source.indexOf('function renderHomeScreen'));

  assert.match(source, /function renderMarqueeTitle\(text, color/);
  assert.match(connection, /renderMarqueeTitle\('Phone connection needed', THEME\.orange\)/);
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

  assert.match(home, /renderMarqueeTitle\(outline\.programName \|\| 'Liftosaur'\)/);
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

test('sets with RPE keep all three controls inside the design box', () => {
  const layout = activeSetLayout({ targetRpe: 8 });
  assert.equal(layout.showRpe, true);
  assert.deepEqual(layout.rows.map((row) => row.key), ['weight', 'reps', 'rpe']);
  assert.ok(layout.actionY + layout.actionHeight <= 440);
});

test('discarding a restored workout reloads programs when no outline is in memory', () => {
  const source = fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
  const handler = source.match(/function returnAfterDiscard\(\) \{([\s\S]*?)\n\}/)?.[1] || '';

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
    /formatLoadoutLabel\(\s*rest\.nextTargetWeight,\s*view\.pending\?\.loadingEquipment,\s*rest\.nextUnit\s*\)/,
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
