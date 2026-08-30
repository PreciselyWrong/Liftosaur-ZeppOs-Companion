import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function readWatchPage() {
  return fs.readFileSync(path.join(root, 'page', 'common', 'index.js'), 'utf8');
}

test('imports workoutToDayPlan from shared workout-api-plan', () => {
  const source = readWatchPage();
  assert.match(
    source,
    /import\s*\{[^}]*workoutToDayPlan[^}]*\}\s*from\s*['"]\.\.\/\.\.\/shared\/workout-api-plan\.js['"]/,
  );
});

test('declares direct sync state variables', () => {
  const source = readWatchPage();
  assert.match(source, /let\s+accountSettings\s*=\s*null/);
  assert.match(source, /let\s+defaultWorkoutPlan\s*=\s*null/);
  assert.match(source, /let\s+directSync\s*=/);
});

test('uses official protocol message types for direct workout operations', () => {
  const source = readWatchPage();
  assert.match(source, /MESSAGE_TYPES\.GET_SETTINGS/);
  assert.match(source, /MESSAGE_TYPES\.GET_WORKOUT_CURRENT/);
  assert.match(source, /MESSAGE_TYPES\.GET_WORKOUT_NEXT/);
  assert.match(source, /MESSAGE_TYPES\.START_WORKOUT/);
  assert.match(source, /MESSAGE_TYPES\.SYNC_WORKOUT_SETS/);
  assert.match(source, /MESSAGE_TYPES\.DISCARD_WORKOUT/);
  assert.match(source, /MESSAGE_TYPES\.FINISH_WORKOUT/);
});

test('loadPrograms fetches settings and current workout before opening flow in CLOUD mode', () => {
  const source = readWatchPage();
  const loadProg = source.slice(source.indexOf('function loadPrograms()'), source.indexOf('function loadOutline('));

  assert.match(loadProg, /MESSAGE_TYPES\.LIST_PROGRAMS/);
  assert.match(loadProg, /MESSAGE_TYPES\.GET_SETTINGS/);
  assert.match(loadProg, /MESSAGE_TYPES\.GET_WORKOUT_CURRENT/);
  assert.match(loadProg, /MESSAGE_TYPES\.GET_WORKOUT_NEXT/);
  assert.match(loadProg, /workoutToDayPlan\(/);
});

test('home screen uses defaultWorkoutPlan when matching loaded outline without history inference in CLOUD mode', () => {
  const source = readWatchPage();
  const home = source.slice(source.indexOf('function renderHomeScreen()'), source.indexOf('function renderProgramsScreen()'));

  assert.match(home, /defaultWorkoutPlan/);
  assert.match(home, /serviceMode !== 'DEMO'/);
});

test('loadDayPlan branches between DEMO (GET_DAY_PLAN) and CLOUD (GET_WORKOUT_NEXT)', () => {
  const source = readWatchPage();
  const loadDay = source.slice(source.indexOf('function loadDayPlan('), source.indexOf('function submitWorkout('));

  assert.match(loadDay, /serviceMode === 'DEMO'/);
  assert.match(loadDay, /MESSAGE_TYPES\.GET_DAY_PLAN/);
  assert.match(loadDay, /MESSAGE_TYPES\.GET_WORKOUT_NEXT/);
  assert.match(loadDay, /workoutToDayPlan\(/);
});

test('persists local session before network calls for start, set sync, finish, and discard', () => {
  const source = readWatchPage();

  // Start persists before network call
  assert.match(source, /function handleStartWorkout[\s\S]*?persistAndRender[\s\S]*?ensureDirectWorkoutStarted/);

  // Set sync persists before network call
  assert.match(source, /persistAndRender\(\(\)\s*=>[\s\S]*?session\.completeSet\([\s\S]*?synchronizeDirectSets/);

  // Finish persists finishRequestedAt before FINISH_WORKOUT
  assert.match(source, /directSync\.finishRequestedAt\s*=[\s\S]*?persistSession\(\)[\s\S]*?MESSAGE_TYPES\.FINISH_WORKOUT/);

  // Discard persists discardRequestedAt before DISCARD_WORKOUT
  assert.match(source, /directSync\.discardRequestedAt\s*=[\s\S]*?persistSession\(\)[\s\S]*?MESSAGE_TYPES\.DISCARD_WORKOUT/);
});

test('direct finish sends exact startTime, endTime, and intervals only when non-empty', () => {
  const source = readWatchPage();
  const submit = source.slice(source.indexOf('function submitWorkout()'), source.indexOf('function abandonWorkout()'));

  assert.match(submit, /startTime:\s*view\.startedAt/);
  assert.match(submit, /endTime/);
  assert.match(submit, /getDirectWorkoutIntervals\(/);
  assert.match(submit, /intervals\.length > 0/);
});

test('direct discard never invokes legacy ABANDON_WORKOUT', () => {
  const source = readWatchPage();
  const discard = source.slice(
    source.indexOf('function handleDiscardWorkout()'),
    source.indexOf('function abandonWorkout()'),
  );
  assert.match(discard, /directSync\.mode !== 'DIRECT'/);
  assert.match(discard, /MESSAGE_TYPES\.DISCARD_WORKOUT/);
  assert.doesNotMatch(discard, /MESSAGE_TYPES\.ABANDON_WORKOUT/);
});

test('polls GET_WORKOUT_CURRENT no faster than 15 seconds with guards', () => {
  const source = readWatchPage();
  assert.match(source, /15000/);
  assert.match(source, /MESSAGE_TYPES\.GET_WORKOUT_CURRENT/);
  assert.match(source, /SESSION_STATES\.ACTIVE_SET/);
});

test('adopts the whole server workout after a successful set batch', () => {
  const source = readWatchPage();
  const sync = source.slice(
    source.indexOf('async function synchronizeDirectSets()'),
    source.indexOf('function applyAdoptedSnapshot('),
  );

  assert.match(sync, /returnedWorkout/);
  assert.match(sync, /deferredServerWorkout\s*=\s*returnedWorkout/);
  assert.match(sync, /applyAdoptedSnapshot\(returnedWorkout\)/);
});

test('shows pending synchronization instead of hiding an offline queue', () => {
  const source = readWatchPage();
  assert.match(source, /syncWarning \? truncate\(syncWarning, 16\) : formatHeartRate/);
});

test('required set inputs are never guessed by the watch', () => {
  const source = readWatchPage();
  const inputGuard = source.slice(
    source.indexOf('function requiredPhoneInput('),
    source.indexOf('async function synchronizeDirectSets('),
  );

  assert.match(inputGuard, /promptedVars/);
  assert.match(inputGuard, /setTimer/);
  assert.match(inputGuard, /isAmrap/);
  assert.match(inputGuard, /askWeight/);
  assert.match(inputGuard, /logRpe/);
  assert.match(inputGuard, /repsLeft: set\?\.isUnilateral \? set\.reps : null/);
});

test('a batch response is adopted only after every newer local set is acknowledged', () => {
  const source = readWatchPage();
  const sync = source.slice(
    source.indexOf('async function synchronizeDirectSets()'),
    source.indexOf('function applyAdoptedSnapshot('),
  );
  assert.match(sync, /remainingPendingCount\s*===\s*0[\s\S]*?applyAdoptedSnapshot/);
});

test('finish refuses to clear a workout while set writes remain pending', () => {
  const source = readWatchPage();
  const submit = source.slice(source.indexOf('function submitWorkout()'), source.indexOf('function handleDiscardWorkout()'));
  assert.match(submit, /pendingSetCount/);
  assert.match(submit, /if \(pendingSetCount > 0\) throw/);
});

test('an empty current-workout poll opens recovery instead of clearing local state', () => {
  const source = readWatchPage();
  const poll = source.slice(source.indexOf('async function pollCurrentWorkout()'), source.indexOf('function submitWorkout()'));
  const emptyBranch = poll.slice(poll.indexOf('if (!serverWorkout)'));
  assert.match(emptyBranch, /remoteMissing\s*=\s*true/);
  assert.doesNotMatch(emptyBranch, /sessionStore\.clear\(\)/);
});

test('server snapshot adoption preserves earlier pause intervals for finish', () => {
  const source = readWatchPage();
  const adopt = source.slice(source.indexOf('function preserveDirectIntervals('), source.indexOf('async function adoptCurrentWorkout()'));
  const submit = source.slice(source.indexOf('function submitWorkout()'), source.indexOf('function handleDiscardWorkout()'));
  assert.match(adopt, /preservedIntervals/);
  assert.match(adopt, /intervalsPreservedThrough/);
  assert.match(submit, /getDirectWorkoutIntervals\(endTime\)/);
});

test('session restore recovers directSync metadata and retries finish or discard if requested', () => {
  const source = readWatchPage();
  const restore = source.slice(source.indexOf('function restoreSession()'), source.indexOf('function formatSeconds('));

  assert.match(restore, /snapshot\.sync/);
  assert.match(source, /directSync\.finishRequestedAt/);
  assert.match(source, /directSync\.discardRequestedAt/);
});
