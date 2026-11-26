import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { launchPlanFor, programForSavedPlan, suggestedProgramIndex } from '../shared/selection.js';

const widgetSource = readFileSync(new URL('../data-widget/common/index.js', import.meta.url), 'utf8');

function extract(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

function compile(source, names, state, entry) {
  const scope = new Proxy(state, { has: (target, key) => key in target });
  return new Function('scope', `with (scope) { ${names.map((name) => extract(source, name)).join('\n')}; return ${entry}; }`)(scope);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const MESSAGE_TYPES = {
  GET_SETTINGS: 'GET_SETTINGS', GET_WORKOUT_CURRENT: 'GET_WORKOUT_CURRENT', GET_WORKOUT_NEXT: 'GET_WORKOUT_NEXT',
  LIST_PROGRAMS: 'LIST_PROGRAMS', GET_PROGRAM_OUTLINE: 'GET_PROGRAM_OUTLINE',
};
const EXTENSION_SCREENS = {
  CONNECTION: 'CONNECTION', EMPTY: 'EMPTY', SETUP: 'SETUP', SESSION: 'SESSION', PROGRAMS: 'PROGRAMS',
  HOME: 'HOME', LOADING: 'LOADING', WEEKS: 'WEEKS', DAYS: 'DAYS',
};

function widgetLaunch() {
  const replies = {};
  const sent = [];
  const state = {
    screen: 'LOADING', programs: null, accountSettings: null, defaultWorkoutPlan: null, defaultWorkoutFetchedAt: null,
    isBusy: false, statusMessage: '', errorMessage: '', selectedProgram: null, outline: null, listPage: 0,
    isTearingDown: false, console: { log() {} }, Date,
    EXTENSION_SCREENS, MESSAGE_TYPES, PHONE_CONNECTING_MESSAGE: 'Connecting',
    programForSavedPlan, suggestedProgramIndex,
    renderUI() {}, resetConnectionRetry() {}, logRecoverableError() {}, scheduleConnectionRetry() {},
    isTemporaryPhoneError: () => false,
    workoutController: { markAuthoritativeResponse() {} },
    workoutToDayPlan: (workout) => ({ ...workout, unit: 'kg' }),
    loadDisplaySettings() { sent.push('GET_SETTINGS'); return (replies.GET_SETTINGS = deferred()).promise; },
    send(type) { sent.push(type); return (replies[type] = deferred()).promise; },
  };
  const load = compile(widgetSource,
    ['startInitialNetworkLoad', 'loadOutline', 'beginRequest', 'failRequest', 'handleInitialLoadFailure'],
    state, 'startInitialNetworkLoad');
  return { state, sent, replies, load };
}

test('Workout launch asks for settings, the running and next workout and the programs at once', async () => {
  const { sent, load } = widgetLaunch();
  load();
  await settle();
  // The phone answers in parallel: chaining them cost about 2.5 s of serial round trips on an Active 2.
  assert.deepEqual([...sent].sort(), ['GET_SETTINGS', 'GET_WORKOUT_CURRENT', 'GET_WORKOUT_NEXT', 'LIST_PROGRAMS']);
});

test('Workout launch asks for the active program outline as soon as the list names it', async () => {
  const { state, sent, replies, load } = widgetLaunch();
  load();
  replies.GET_SETTINGS.resolve({});
  replies.GET_WORKOUT_CURRENT.resolve({ payload: { workout: null } });
  replies.LIST_PROGRAMS.resolve({ payload: { programs: [{ id: 'p0' }, { id: 'p1', isCurrent: true }] } });
  await settle();
  assert.equal(sent.filter((type) => type === 'GET_PROGRAM_OUTLINE').length, 1, 'outline must not wait for the next workout');
  replies.GET_PROGRAM_OUTLINE.resolve({ payload: { programId: 'p1', weeks: [{ number: 1, days: [{ number: 1 }] }] } });
  await settle();
  assert.equal(state.screen, 'LOADING', 'Home waits for the next workout it offers');
  replies.GET_WORKOUT_NEXT.resolve({ payload: { workout: { programId: 'p1', week: 1, dayInWeek: 1, exercises: [{}] } } });
  await settle();
  assert.equal(state.screen, 'HOME');
  assert.equal(state.selectedProgram.id, 'p1');
  assert.equal(state.defaultWorkoutPlan.programId, 'p1');
  assert.equal(sent.filter((type) => type === 'GET_PROGRAM_OUTLINE').length, 1, 'the early outline is the one Home uses');
});

test('Workout launch still resumes a running workout found while the other requests are in flight', async () => {
  const { state, replies, load } = widgetLaunch();
  const loaded = [];
  state.workoutController.loadPlan = (plan) => loaded.push(plan);
  state.workoutController.getWorkoutSetWrites = () => [];
  load();
  replies.GET_SETTINGS.resolve({});
  replies.GET_WORKOUT_CURRENT.resolve({ payload: { workout: { programId: 'p1', week: 1, dayInWeek: 2 } } });
  replies.LIST_PROGRAMS.resolve({ payload: { programs: [{ id: 'p1', isCurrent: true }] } });
  replies.GET_PROGRAM_OUTLINE?.reject(new Error('unused'));
  replies.GET_WORKOUT_NEXT.reject(new Error('unused'));
  await settle();
  assert.equal(state.screen, 'SESSION');
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].dayInWeek, 2);
});

test('the launch and the onResume that follows it share one settings request', async () => {
  const sent = [];
  const reply = deferred();
  const state = {
    lifecycleGeneration: 3, displaySettingsLoad: null, isTearingDown: false, accountSettings: null,
    isNotesModalOpen: false, screen: 'LOADING', EXTENSION_SCREENS, MESSAGE_TYPES,
    workoutDiagnostics: { isEnabled: () => false, setEnabled() {}, record() {}, prepareUpload: () => ({ payload: {}, commit() {} }) },
    WORKOUT_DIAGNOSTIC_CODES: {}, deviceStorage: null, restPresentation: null,
    exerciseImages: null, workoutController: { configureTimedSets() {} },
    normalizeWorkoutDiagnosticsEnabled: Boolean, normalizeExerciseImages: Boolean, normalizeGetReadySeconds: Number,
    normalizeWorkoutDisplaySettings: () => ({}), saveAutoPreparePreference() {}, createRestPresentationState: () => ({}),
    applyDisplayHold() {}, renderUI() {},
    send(type) { sent.push(type); return reply.promise; },
  };
  const loadDisplaySettings = compile(widgetSource, ['loadDisplaySettings'], state, 'loadDisplaySettings');
  const first = loadDisplaySettings();
  const second = loadDisplaySettings();
  assert.deepEqual(sent, ['GET_SETTINGS']);
  reply.resolve({ payload: { units: 'kg' } });
  assert.deepEqual(await first, { units: 'kg' });
  assert.deepEqual(await second, { units: 'kg' });
  // A later resume reads the settings again: they may have changed on the phone meanwhile.
  loadDisplaySettings();
  assert.equal(sent.length, 2);
  // A pause in between starts a new request instead of reusing one whose reply will be ignored.
  state.lifecycleGeneration += 1;
  loadDisplaySettings();
  assert.equal(sent.length, 3);
});

test('Workout Home preloads the images of the next workout it offers', () => {
  const preloads = [];
  const state = {
    isEditLastSetOpen: false, isSyncDetailsOpen: false, isWorkoutTimerControlsOpen: false,
    discardConfirmationRequested: false, phoneRequiredReason: null, isNotesModalOpen: false,
    screen: 'HOME', isBusy: false, EXTENSION_SCREENS,
    defaultWorkoutPlan: { exercises: [{ imageUrl: 'https://example.com/a.png' }, { imageUrl: null }, { imageUrl: 'https://example.com/b.jpeg' }] },
    exerciseImages: { preload: (urls) => preloads.push(urls) },
    renderHomeScreen: () => 'home', renderLoadingScreen: () => 'loading',
  };
  const renderScreen = compile(widgetSource, ['renderScreen'], state, 'renderScreen');
  assert.equal(renderScreen(), 'home');
  // The first image used to wait 2 to 3 s for the phone download after the day was opened.
  assert.deepEqual(preloads, [['https://example.com/a.png', null, 'https://example.com/b.jpeg']]);
  state.isBusy = true;
  assert.equal(renderScreen(), 'loading');
  assert.equal(preloads.length, 1);
});

function widgetDayPick({ fetchedAt }) {
  const sent = [];
  const loaded = [];
  const plan = { programId: 'p1', week: 6, dayInWeek: 5, unit: 'kg', exercises: [{ name: 'Pull Up' }] };
  const state = {
    selectedWeek: null, selectedProgram: { id: 'p1' }, outline: { programId: 'p1' }, dayPlan: null,
    defaultWorkoutPlan: plan, defaultWorkoutFetchedAt: fetchedAt, accountSettings: { units: 'kg' },
    isBusy: false, statusMessage: '', errorMessage: '', finishState: null, isOverviewOpen: false,
    overviewPage: 0, readyPage: 0, screen: 'DAYS', isTearingDown: false, console: { log() {} }, Date,
    EXTENSION_SCREENS, MESSAGE_TYPES, launchPlanFor, renderUI() {},
    defaultDirectSync: (mode) => ({ mode }),
    workoutToDayPlan: (workout) => ({ ...workout, unit: 'kg' }),
    workoutController: { loadPlan: (value) => loaded.push(value) },
    send(type, payload) {
      sent.push({ type, payload });
      return Promise.resolve({ payload: { workout: { ...plan, dayInWeek: payload.dayInWeek } } });
    },
  };
  const names = ['loadDayPlan', 'beginRequest', 'failRequest'];
  if (widgetSource.includes('function openDayPlan(')) names.push('openDayPlan');
  const loadDayPlan = compile(widgetSource, names, state, 'loadDayPlan');
  return { state, sent, loaded, plan, loadDayPlan };
}

test('picking the day the launch already fetched opens it without asking the phone again', async () => {
  const { state, sent, loaded, plan, loadDayPlan } = widgetDayPick({ fetchedAt: Date.now() });
  loadDayPlan({ number: 6 }, { number: 5 });
  assert.deepEqual(sent, []);
  assert.equal(state.screen, 'SESSION');
  assert.equal(loaded[0], plan);
  // The launch answer serves one workout; picking the day again later asks the phone.
  loadDayPlan({ number: 6 }, { number: 5 });
  await settle();
  assert.equal(sent.length, 1);
});

test('another day, or a launch answer past its freshness, is asked from the phone', async () => {
  for (const [fetchedAt, day] of [[Date.now(), 4], [Date.now() - 10 * 60000, 5]]) {
    const { state, sent, loadDayPlan } = widgetDayPick({ fetchedAt });
    loadDayPlan({ number: 6 }, { number: day });
    await settle();
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].payload, { programId: 'p1', week: 6, dayInWeek: day });
    assert.equal(state.screen, 'SESSION');
  }
});

const pageSource = readFileSync(new URL('../page/common/index.js', import.meta.url), 'utf8');
const SCREEN = { CONNECTION: 'CONNECTION', SETUP: 'SETUP', LOADING: 'LOADING', PROGRAMS: 'PROGRAMS', HOME: 'HOME', WEEKS: 'WEEKS', DAYS: 'DAYS', SESSION: 'SESSION' };

function companionLaunch() {
  const replies = {};
  const sent = [];
  const state = {
    screen: 'LOADING', programs: [], serviceMode: 'CLOUD', listPage: 0, accountSettings: null,
    defaultWorkoutPlan: null, defaultWorkoutFetchedAt: null, selectedProgram: null, outline: null,
    isBusy: false, statusMessage: '', errorMessage: '', isTearingDown: false, console: { log() {} }, Date,
    SCREEN, MESSAGE_TYPES, PHONE_CONNECTING_MESSAGE: 'Connecting', suggestedProgramIndex,
    renderUI() {}, resetConnectionRetry() {}, scheduleConnectionRetry() {}, isTemporaryPhoneError: () => false,
    adoptAccountSettings(value) { state.accountSettings = value || {}; },
    workoutController: { markAuthoritativeResponse() {} },
    workoutToDayPlan: (workout) => ({ ...workout, unit: 'kg' }),
    send(type) { sent.push(type); return (replies[type] = deferred()).promise; },
  };
  const load = compile(pageSource,
    ['loadPrograms', 'loadOutline', 'beginRequest', 'failRequest', 'handleInitialLoadFailure'], state, 'loadPrograms');
  return { state, sent, replies, load };
}

test('Companion launch asks for the programs, settings and workouts at once', async () => {
  const { sent, load } = companionLaunch();
  load();
  await settle();
  assert.deepEqual([...sent].sort(), ['GET_SETTINGS', 'GET_WORKOUT_CURRENT', 'GET_WORKOUT_NEXT', 'LIST_PROGRAMS']);
});

test('Companion launch asks for the active outline as soon as the list names it and opens Home', async () => {
  const { state, sent, replies, load } = companionLaunch();
  load();
  replies.LIST_PROGRAMS.resolve({ payload: { programs: [{ id: 'p1', isCurrent: true }], serviceMode: 'CLOUD' } });
  await settle();
  assert.equal(sent.filter((type) => type === 'GET_PROGRAM_OUTLINE').length, 1);
  replies.GET_PROGRAM_OUTLINE.resolve({ payload: { programId: 'p1', weeks: [{ number: 1, days: [{ number: 1 }] }] } });
  replies.GET_SETTINGS.resolve({ payload: { units: 'kg' } });
  replies.GET_WORKOUT_CURRENT.resolve({ payload: { workout: null } });
  replies.GET_WORKOUT_NEXT.resolve({ payload: { workout: { programId: 'p1', week: 1, dayInWeek: 1, exercises: [{}] } } });
  await settle();
  assert.equal(state.screen, 'HOME');
  assert.equal(state.defaultWorkoutPlan.programId, 'p1');
  assert.equal(sent.filter((type) => type === 'GET_PROGRAM_OUTLINE').length, 1);
});

test('Companion opens the day its launch already fetched without asking the phone again', () => {
  const sent = [];
  const loaded = [];
  const plan = { programId: 'p1', week: 6, dayInWeek: 5, unit: 'kg', exercises: [{ name: 'Pull Up' }] };
  const state = {
    selectedWeek: null, selectedProgram: { id: 'p1' }, serviceMode: 'CLOUD', dayPlan: null, directSync: null,
    defaultWorkoutPlan: plan, defaultWorkoutFetchedAt: Date.now(), accountSettings: {}, launchPlanFor,
    isBusy: false, statusMessage: '', errorMessage: '', finishState: null, isOverviewOpen: false,
    overviewPage: 0, readyPage: 0, screen: 'DAYS', isTearingDown: false, console: { log() {} }, Date,
    SCREEN, MESSAGE_TYPES, renderUI() {},
    workoutController: { loadPlan: (value) => loaded.push(value) },
    send(type) { sent.push(type); return new Promise(() => {}); },
  };
  const names = ['loadDayPlan', 'beginRequest', 'failRequest'];
  if (pageSource.includes('function openDayPlan(')) names.push('openDayPlan');
  const loadDayPlan = compile(pageSource, names, state, 'loadDayPlan');
  loadDayPlan({ number: 6 }, { number: 5 });
  assert.deepEqual(sent, []);
  assert.equal(state.screen, 'SESSION');
  assert.equal(loaded[0], plan);
  assert.equal(state.directSync.startConfirmed, false);
});

test('Companion Home preloads the images of the next workout it offers', () => {
  const preloads = [];
  const state = {
    isEditLastSetOpen: false, isSyncDetailsOpen: false, isWorkoutTimerControlsOpen: false, isNotesModalOpen: false,
    screen: 'HOME', isBusy: false, SCREEN,
    defaultWorkoutPlan: { exercises: [{ imageUrl: 'https://example.com/a.png' }] },
    exerciseImages: { preload: (urls) => preloads.push(urls) },
    renderHomeScreen: () => 'home', renderLoadingScreen: () => 'loading',
  };
  const renderScreen = compile(pageSource, ['renderScreen'], state, 'renderScreen');
  assert.equal(renderScreen(), 'home');
  assert.deepEqual(preloads, [['https://example.com/a.png']]);
});
