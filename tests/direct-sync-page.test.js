import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function readWatchPage() {
  return fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
}

function readWorkoutController() {
  return fs.readFileSync(path.join(root, 'shared', 'workout-controller.js'), 'utf8');
}

test('imports workoutToDayPlan from shared workout-api-plan', () => {
  assert.match(readWatchPage(), /import\s*\{[^}]*workoutToDayPlan[^}]*\}\s*from\s*['"]\.\.\/\.\.\/shared\/workout-api-plan\.js['"]/);
});

test('declares direct sync state variables', () => {
  const source = readWatchPage();
  assert.match(source, /let\s+accountSettings\s*=\s*null/);
  assert.match(source, /let\s+defaultWorkoutPlan\s*=\s*null/);
  assert.match(source, /let\s+directSync\s*=/);
});

test('uses official protocol message types for direct workout operations', () => {
  const source = `${readWatchPage()}\n${readWorkoutController()}`;
  for (const type of ['GET_SETTINGS', 'GET_WORKOUT_CURRENT', 'GET_WORKOUT_NEXT', 'START_WORKOUT', 'SYNC_WORKOUT_SETS', 'DISCARD_WORKOUT', 'FINISH_WORKOUT']) {
    assert.match(source, new RegExp(`MESSAGE_TYPES\\.${type}`));
  }
});

test('loadPrograms fetches settings and current workout before opening flow in CLOUD mode', () => {
  const source = readWatchPage();
  const loadPrograms = source.slice(source.indexOf('function loadPrograms()'), source.indexOf('function loadOutline('));
  assert.match(loadPrograms, /MESSAGE_TYPES\.LIST_PROGRAMS/);
  assert.match(loadPrograms, /MESSAGE_TYPES\.GET_SETTINGS/);
  assert.match(loadPrograms, /MESSAGE_TYPES\.GET_WORKOUT_CURRENT/);
  assert.match(loadPrograms, /MESSAGE_TYPES\.GET_WORKOUT_NEXT/);
  assert.match(loadPrograms, /workoutToDayPlan\(/);
});

test('companion applies the local screen-on duration received with API settings', () => {
  const source = readWatchPage();
  assert.match(source, /accountSettings\?\.screenOnDuration/);
  assert.match(source, /function applyDisplayHold\(/);
  assert.doesNotMatch(source, /setPageBrightTime\(\{\s*brightTime:\s*60000\s*\}\)/);
});

test('home screen uses the authoritative default workout without history inference', () => {
  const source = readWatchPage();
  const home = source.slice(source.indexOf('function renderHomeScreen()'), source.indexOf('function renderProgramsScreen()'));
  assert.match(home, /defaultWorkoutPlan/);
  assert.match(home, /serviceMode !== 'DEMO'/);
});

test('loadDayPlan branches between demo and Cloud plans', () => {
  const source = readWatchPage();
  const loadDay = source.slice(source.indexOf('function loadDayPlan('), source.indexOf('function submitWorkout('));
  assert.match(loadDay, /serviceMode === 'DEMO'/);
  assert.match(loadDay, /MESSAGE_TYPES\.GET_DAY_PLAN/);
  assert.match(loadDay, /MESSAGE_TYPES\.GET_WORKOUT_NEXT/);
  assert.match(loadDay, /workoutToDayPlan\(/);
});

test('the page delegates direct workout writes to the shared controller', () => {
  const source = readWatchPage();
  assert.match(source, /workoutController\.ensureStarted\(\)/);
  assert.match(source, /workoutController\.syncSets\(\)/);
  assert.match(source, /workoutController\.finishWorkoutRemote\(\)/);
  assert.match(source, /workoutController\.discardWorkoutRemote\(\)/);
});

test('the controller persists local actions before their network calls', () => {
  const page = readWatchPage();
  const source = readWorkoutController();
  assert.match(page, /function handleStartWorkout[\s\S]*?persistAndRender/);
  assert.match(source, /startWorkout:[\s\S]*?mutateSession[\s\S]*?ensureDirectWorkoutStarted/);
  assert.match(source, /completeSet:[\s\S]*?mutateSession[\s\S]*?synchronizeDirectSets/);
  assert.match(source, /directSync\.finishRequestedAt\s*=[\s\S]*?persist\(\)[\s\S]*?MESSAGE_TYPES\.FINISH_WORKOUT/);
  assert.match(source, /directSync\.discardRequestedAt\s*=[\s\S]*?persist\(\)[\s\S]*?MESSAGE_TYPES\.DISCARD_WORKOUT/);
});

test('direct finish sends exact timestamps and non-empty intervals', () => {
  const source = readWorkoutController();
  const finish = source.slice(source.indexOf('async function finishWorkoutRemote()'), source.indexOf('async function discardWorkoutRemote()'));
  assert.match(finish, /startTime:\s*view\.startedAt/);
  assert.match(finish, /endTime/);
  assert.match(finish, /getIntervals\(endTime\)/);
  assert.match(finish, /intervals\.length > 0/);
});

test('direct discard never invokes legacy abandonment', () => {
  const page = readWatchPage();
  const source = readWorkoutController();
  const start = source.indexOf('async function discardWorkoutRemote()');
  const discard = source.slice(start, source.indexOf('\n  return {', start));
  assert.match(page, /workoutController\.discardWorkoutRemote\(\)/);
  assert.match(discard, /MESSAGE_TYPES\.DISCARD_WORKOUT/);
  assert.doesNotMatch(discard, /MESSAGE_TYPES\.ABANDON_WORKOUT/);
});

test('one refresh policy serves passive and action-triggered reads', () => {
  const source = readWorkoutController();
  assert.match(source, /createWorkoutRefreshPolicy/);
  assert.match(source, /function requestWorkoutRefresh/);
  assert.match(source, /MESSAGE_TYPES\.GET_WORKOUT_CURRENT/);
  assert.match(source, /SESSION_STATES\.ACTIVE_SET[\s\S]*?SESSION_STATES\.REST/);
  assert.match(source, /policy\.beginPoll\(\{ allowPassive:/);
});

test('meaningful workout navigation requests a coalesced refresh', () => {
  const source = readWatchPage();
  const nextSet = source.slice(source.indexOf('function handleNextSet()'), source.indexOf('async function pollCurrentWorkout()'));
  const gestures = source.slice(source.indexOf('function handleGesture('), source.indexOf('function heartRateColor('));
  const overview = source.slice(source.indexOf('function renderOverviewScreen('), source.indexOf('function renderActiveSetScreen('));
  assert.match(nextSet, /requestWorkoutRefresh\(\)/);
  assert.match(gestures, /requestWorkoutRefresh\(\)/);
  assert.match(overview, /requestWorkoutRefresh\(\)/);
});

test('poll failures back off and authoritative writes reset refresh timing', () => {
  const source = readWorkoutController();
  const poll = source.slice(source.indexOf('async function pollCurrentWorkout()'), source.indexOf('function requestWorkoutRefresh()'));
  const sync = source.slice(source.indexOf('function synchronizeDirectSets()'), source.indexOf('async function pollCurrentWorkout()'));
  assert.match(poll, /policy\.markSuccess\(\)/);
  assert.match(poll, /policy\.markFailure\(\)/);
  assert.match(sync, /policy\.markAuthoritativeResponse\(\)/);
});

test('a stale poll cannot overwrite a newer local set', () => {
  const source = readWorkoutController();
  const poll = source.slice(source.indexOf('async function pollCurrentWorkout()'), source.indexOf('function requestWorkoutRefresh()'));
  assert.match(poll, /writeCountAtPollStart/);
  assert.match(poll, /currentWriteCount\s*!==\s*writeCountAtPollStart/);
});

test('a successful set batch adopts the whole server workout', () => {
  const source = readWorkoutController();
  const sync = source.slice(source.indexOf('function synchronizeDirectSets()'), source.indexOf('async function pollCurrentWorkout()'));
  assert.match(sync, /returnedWorkout/);
  assert.match(sync, /deferredServerWorkout\s*=\s*returnedWorkout/);
  assert.match(sync, /applyAdoptedSnapshot\(returnedWorkout\)/);
});

test('start response avoids the QuickJS optional-chain stack bug', () => {
  const source = readWorkoutController();
  const start = source.slice(source.indexOf('function ensureDirectWorkoutStarted()'), source.indexOf('function synchronizeDirectSets()'));
  assert.doesNotMatch(start, /res\.payload\?\.workout/);
  assert.match(start, /const payloadObj = res \? res\.payload : null/);
  assert.match(start, /const returnedWorkout = payloadObj \? payloadObj\.workout : null/);
});

test('shows pending synchronization instead of hiding an offline queue', () => {
  assert.match(readWatchPage(), /syncWarning \? truncate\(syncWarning, 16\) : formatHeartRate/);
});

test('required set inputs are never guessed by the watch', () => {
  const source = readWatchPage();
  const inputGuard = source.slice(source.indexOf('function requiredPhoneInput('), source.indexOf('async function synchronizeDirectSets('));
  assert.match(inputGuard, /promptedVars/);
  assert.match(inputGuard, /setTimer/);
  assert.match(inputGuard, /isAmrap/);
  assert.match(inputGuard, /askWeight/);
  assert.match(inputGuard, /logRpe/);
  assert.match(inputGuard, /repsLeft: set\?\.isUnilateral \? set\.reps : null/);
});

test('a batch is adopted only after every newer local set is acknowledged', () => {
  const source = readWorkoutController();
  const sync = source.slice(source.indexOf('function synchronizeDirectSets()'), source.indexOf('async function pollCurrentWorkout()'));
  assert.match(sync, /remainingPendingCount\s*===\s*0[\s\S]*?applyAdoptedSnapshot/);
});

test('finish refuses to clear a workout while set writes remain pending', () => {
  const source = readWorkoutController();
  const finish = source.slice(source.indexOf('async function finishWorkoutRemote()'), source.indexOf('async function discardWorkoutRemote()'));
  assert.match(finish, /pendingSetCount/);
  assert.match(finish, /if \(pendingSetCount > 0\)/);
});

test('an empty current-workout poll opens recovery without clearing local state', () => {
  const source = readWorkoutController();
  const poll = source.slice(source.indexOf('async function pollCurrentWorkout()'), source.indexOf('function requestWorkoutRefresh()'));
  const emptyBranch = poll.slice(poll.indexOf('if (!serverWorkout)'));
  assert.match(emptyBranch, /remoteMissing\s*=\s*true/);
  assert.doesNotMatch(emptyBranch, /store\.clear\(\)/);
});

test('server adoption preserves earlier pause intervals for finish', () => {
  const source = readWorkoutController();
  const preserve = source.slice(source.indexOf('function preserveIntervals('), source.indexOf('function getIntervals('));
  const finish = source.slice(source.indexOf('async function finishWorkoutRemote()'), source.indexOf('async function discardWorkoutRemote()'));
  assert.match(preserve, /preservedIntervals/);
  assert.match(preserve, /intervalsPreservedThrough/);
  assert.match(finish, /getIntervals\(endTime\)/);
});

test('server adoption preserves the watch navigation anchor unless explicitly disabled', () => {
  const source = readWorkoutController();
  const apply = source.slice(source.indexOf('function applyAdoptedSnapshot('), source.indexOf('async function adoptCurrentWorkout('));
  assert.match(apply, /resumeFromEntryId/);
  assert.match(apply, /session\.view\(now\(\)\)\.entryId/);
  const adopt = source.slice(source.indexOf('async function adoptCurrentWorkout('), source.indexOf('async function finishWorkoutRemote()'));
  assert.match(adopt, /preserveNavigation/);
});

test('session restore recovers direct sync and retries requested terminal writes', () => {
  const source = readWatchPage();
  const restore = source.slice(source.indexOf('function restoreSession()'), source.indexOf('function formatSeconds('));
  assert.match(restore, /workoutController\.restore\(\)/);
  assert.match(restore, /directSync\s*=\s*workoutController\.sync\(\)/);
  assert.match(source, /directSync\.finishRequestedAt/);
  assert.match(source, /directSync\.discardRequestedAt/);
});
