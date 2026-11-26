import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkoutController } from '../shared/workout-controller.js';
import { createMemoryStorageAdapter, createSessionStore } from '../shared/session-storage.js';
import { SESSION_STATES } from '../shared/workout-session.js';
import { workoutToDayPlan } from '../shared/workout-api-plan.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';
import { PROTOCOL_SCHEMA, isValidReply } from '../shared/protocol-schema.js';
import { createExerciseImageClient } from '../shared/exercise-image-client.js';
import { createWorkoutService } from '../app-side/workout-service.js';
import { createDummyProgramService } from '../app-side/dummy-program-service.js';
import { createExerciseImageService } from '../app-side/exercise-image-service.js';
import {
  buildApiWorkout, createCompanionPage, createDemoPhoneServices, createFakeCloud, createPhoneLink, flush,
} from './helpers/phone-harness.js';

async function startDirectWorkout(shape, { time = () => 1_000_000, auto = true, cloudOptions = {} } = {}) {
  const cloud = createFakeCloud(buildApiWorkout(shape), cloudOptions);
  const link = createPhoneLink(cloud);
  link.setAuto(auto);
  const store = createSessionStore(createMemoryStorageAdapter());
  const controller = createWorkoutController({ store, request: link.request, now: time });
  const next = await link.phoneHandle(MESSAGE_TYPES.GET_WORKOUT_NEXT, {});
  controller.loadPlan(workoutToDayPlan(next.payload.workout), { clearStore: true });
  controller.startWorkout();
  await flush();
  return { cloud, link, store, controller };
}

function writtenSetIds(controller) {
  return [...new Set(controller.getWorkoutSetWrites().map((write) => write.setId))];
}

test('every message the watch sends is accepted by the phone router and its reply is used', async () => {
  let time = 1_000_000;
  const { cloud, link, store, controller } = await startDirectWorkout([[1, 2], [0, 1]], { time: () => time });
  assert.equal(controller.sync().startConfirmed, true);
  assert.equal(controller.view().currentSet.setId, 'live1-entry-1-warmup-1');

  controller.completeSet();
  await flush();
  time += 30_000;
  controller.nextSet();
  controller.adjustReps(2);
  controller.completeSet();
  await flush();
  const draft = controller.createLastSetDraft();
  assert.equal(draft.success, true);
  assert.deepEqual(controller.saveLastSetCorrection({ ...draft.draft, reps: 4 }), { success: true });
  await flush();
  assert.deepEqual(cloud.current().entries[0].sets[0].completed, { reps: 4, weight: '60kg' });
  assert.equal(controller.sync().acknowledgedSetCount, controller.getWorkoutSetWrites().length);

  const phoneEdit = structuredClone(cloud.current());
  phoneEdit.entries[1].sets[0].weight = '90kg';
  cloud.setCurrent(phoneEdit);
  time += 200_000;
  controller.nextSet();
  await flush();
  controller.selectExercise(1);
  assert.equal(controller.view().currentSet.targetWeight, 90);
  assert.equal(writtenSetIds(controller).length, 2);

  controller.finishWorkout();
  assert.equal((await controller.finishWorkoutRemote()).success, true);
  assert.equal(store.load(), null);
  assert.equal(cloud.history.length, 1);
  assert.deepEqual(cloud.completedSets(cloud.history[0].workout).map((set) => set.setId), [
    'live1-entry-1-warmup-1',
    'live1-entry-1-work-1',
  ]);
  assert.deepEqual(cloud.history[0].intervals, [[1_000_000, time]]);
  assert.deepEqual(
    [...new Set(link.sent.map((message) => message.type))],
    [MESSAGE_TYPES.START_WORKOUT, MESSAGE_TYPES.SYNC_WORKOUT_SETS, MESSAGE_TYPES.GET_WORKOUT_CURRENT, MESSAGE_TYPES.FINISH_WORKOUT]
  );
});

test('a discard reaches the phone and clears the watch only once the phone confirms', async () => {
  const { cloud, link, store, controller } = await startDirectWorkout([[0, 1]], { auto: false });
  await link.deliver(0, 'ok');
  const discard = controller.discardWorkoutRemote().catch((err) => err);
  await flush();
  await link.deliver(0, 'noReply');
  assert.equal((await discard).code, 'NETWORK');
  assert.notEqual(store.load(), null);

  link.setAuto(true);
  assert.deepEqual(await controller.discardWorkoutRemote(), { success: true });
  assert.equal(cloud.current(), null);
  assert.equal(store.load(), null);
  assert.equal(controller.view().state, SESSION_STATES.NO_PLAN);
});

test('a refresh after skipping a warmup keeps the work set logged after it', async () => {
  let time = 1_000_000;
  const { cloud, controller } = await startDirectWorkout([[1, 2], [0, 1]], { time: () => time });

  assert.equal(controller.skipWarmup(), true);
  controller.completeSet();
  await flush();
  assert.deepEqual(cloud.completedSets().map((set) => set.setId), ['live1-entry-1-work-1']);

  time += 30_000;
  controller.nextSet();
  await flush();

  assert.deepEqual(writtenSetIds(controller), ['live1-entry-1-work-1']);
  assert.equal(controller.sync().acknowledgedSetCount, 1);
  assert.equal(controller.view().currentSet.setId, 'live1-entry-1-work-2');
});

test('a finish retry after a lost reply reports the missing phone workout and keeps the session', async () => {
  const { cloud, link, store, controller } = await startDirectWorkout([[0, 1]], { auto: false });
  await link.deliver(0, 'ok');
  await flush();
  controller.completeSet();
  await flush();
  await link.deliver(0, 'ok');
  await flush();

  const first = controller.finishWorkoutRemote().catch((err) => err);
  await flush();
  await link.deliver(0, 'noReply');
  assert.equal((await first).code, 'NETWORK');
  assert.equal(cloud.history.length, 1);

  const retry = controller.finishWorkoutRemote().catch((err) => err);
  await flush();
  await link.deliver(0, 'ok');
  assert.equal((await retry).code, 'no_active_workout');

  assert.equal(controller.sync().remoteMissing, true);
  assert.equal(controller.status().code, 'remote-missing');
  assert.notEqual(store.load(), null);
});

// Without entries the reply breaks the protocol, so the phone sends a retryable error instead.
for (const [label, strip, adoptOutcome] of [
  ['without entries', (workout) => { delete workout.entries; }, (adopt) => assert.rejects(adopt, { code: 'API_FAILED' })],
  ['with no entries', (workout) => { workout.entries = []; }, async (adopt) => assert.equal((await adopt).success, false)],
]) {
  test(`a current workout reply ${label} keeps the running plan and its sets`, async () => {
    let time = 1_000_000;
    const { cloud, controller } = await startDirectWorkout([[0, 2], [0, 1]], { time: () => time });
    controller.completeSet();
    await flush();
    time += 200_000;
    controller.nextSet();
    await flush();
    const exerciseCount = controller.plan().exercises.length;

    const reduced = structuredClone(cloud.current());
    strip(reduced);
    cloud.setCurrent(reduced);
    time += 200_000;
    controller.requestRefresh();
    await flush();

    assert.equal(controller.view().state, SESSION_STATES.ACTIVE_SET);
    assert.equal(controller.plan().exercises.length, exerciseCount);
    assert.equal(controller.getWorkoutSetWrites().length, 1);

    await adoptOutcome(controller.adoptCurrent({ preserveNavigation: false }));
    assert.equal(controller.view().state, SESSION_STATES.ACTIVE_SET);
    assert.equal(controller.plan().exercises.length, exerciseCount);
  });
}

for (const code of ['workout_start_time_taken', 'workout_already_active']) {
  test(`a start retry refused with ${code} after a lost reply binds the phone workout it created`, async () => {
    let time = 1_000_000;
    const { cloud, link, controller } = await startDirectWorkout([[0, 3]], {
      time: () => time,
      auto: false,
      cloudOptions: { strictStart: true },
    });
    if (code === 'workout_already_active') {
      const create = cloud.client.startRunningWorkout;
      cloud.client.startRunningWorkout = async (payload) => {
        if (cloud.current()) throw Object.assign(new Error(code), { code });
        return create(payload);
      };
    }
    await link.deliver(0, 'noReply');
    await flush();
    controller.completeSet();
    time += 100_000;
    controller.nextSet();
    controller.completeSet();
    await flush();

    link.setAuto(true);
    while (link.queue.length) await link.deliver(0, 'ok');
    await controller.retryPendingWrites().catch(() => {});
    await flush();

    assert.equal(controller.sync().conflict, false);
    assert.equal(controller.sync().startConfirmed, true);
    assert.equal(controller.sync().acknowledgedSetCount, 2);
    assert.deepEqual(cloud.completedSets().map((set) => set.setId), ['live1-entry-1-work-1', 'live1-entry-1-work-2']);
  });
}

test('a lost reply while checking the running workout after a refused start stays retryable', async () => {
  const { cloud, link, controller } = await startDirectWorkout([[0, 2]], {
    auto: false,
    cloudOptions: { strictStart: true },
  });
  await link.deliver(0, 'noReply');
  await flush();
  controller.completeSet();
  await flush();
  await link.deliver(0, 'ok');
  await flush();
  assert.equal(link.queue[0].type, MESSAGE_TYPES.GET_WORKOUT_CURRENT);
  await link.deliver(0, 'lost');
  await flush();

  assert.equal(controller.sync().conflict, false);
  assert.equal(controller.status().code, 'pending');

  link.setAuto(true);
  await controller.retryPendingWrites().catch(() => {});
  await flush();
  assert.equal(controller.sync().startConfirmed, true);
  assert.deepEqual(cloud.completedSets().map((set) => set.setId), ['live1-entry-1-work-1']);
});

test('a start refused for a different running phone workout still raises the conflict', async () => {
  const { cloud, link, controller } = await startDirectWorkout([[0, 2]], { auto: false });
  cloud.setCurrent({ ...buildApiWorkout([[0, 2]]), startTime: 5 });
  link.setAuto(true);
  await link.deliver(0, 'ok');
  await flush();

  assert.equal(controller.sync().conflict, true);
  assert.equal(controller.status().detail, 'workout_already_active');
});

test('a native pause after the workout is saved does not bring it back on the next launch', async () => {
  const { link, store, controller } = await startDirectWorkout([[0, 1]]);
  controller.completeSet();
  await flush();
  assert.equal((await controller.finishWorkoutRemote()).success, true);
  assert.equal(store.load(), null);

  controller.pauseWorkout({ source: 'native' });
  controller.resumeWorkout({ source: 'native' });
  controller.adjustWeight(1);

  assert.equal(store.load(), null);
  const relaunched = createWorkoutController({ store, request: link.request, now: () => 2_000_000 });
  assert.equal(relaunched.restore().success, false);
});

// One end-to-end case per request type: the real watch code sends it through the real phone
// router and services, and uses the reply. Each case returns the link it talked over.
const T = MESSAGE_TYPES;

function cloudCompanion(template = buildApiWorkout([[0, 2]])) {
  const cloud = createFakeCloud(template);
  const catalogService = { ...createDummyProgramService(), mode: 'CLOUD' };
  const link = createPhoneLink(cloud, { workoutService: createWorkoutService({ client: cloud.client, catalogService }) });
  link.setAuto(true);
  return { cloud, link, page: createCompanionPage(link) };
}

async function demoCompanionDay() {
  const link = createPhoneLink(null, { ...createDemoPhoneServices(), workoutAbandoner: async () => {} });
  link.setAuto(true);
  const page = createCompanionPage(link);
  page.loadPrograms();
  await flush();
  assert.equal(page.screen, 'HOME');
  const [week] = page.outline.weeks;
  page.loadDayPlan(week, week.days[0]);
  await flush();
  assert.equal(page.screen, 'SESSION');
  page.workoutController.startWorkout();
  page.workoutController.completeSet();
  return { link, page };
}

async function directWorkout() {
  let time = 1_000_000;
  const { cloud, link, controller } = await startDirectWorkout([[0, 2]], { time: () => time });
  controller.completeSet();
  await flush();
  time += 200_000;
  controller.nextSet();
  await flush();
  assert.equal(controller.sync().acknowledgedSetCount, 1);
  return { cloud, link, controller };
}

const END_TO_END = {
  async [T.PING]() {
    // No watch screen pings; the reply still has to match the schema.
    const link = createPhoneLink(createFakeCloud(buildApiWorkout([[0, 1]])));
    link.setAuto(true);
    assert.deepEqual((await link.request(T.PING, {})).payload.echo, {});
    return link;
  },
  async [T.LIST_PROGRAMS]() {
    const { link, page } = cloudCompanion();
    page.loadPrograms();
    await flush();
    assert.equal(page.screen, 'HOME');
    assert.ok(page.programs.length > 0);
    assert.equal(page.serviceMode, 'CLOUD');
    return link;
  },
  async [T.GET_PROGRAM_OUTLINE]() {
    const { link, page } = cloudCompanion();
    page.loadPrograms();
    await flush();
    assert.ok(page.outline.weeks.length > 0);
    assert.equal(page.outline.programId, page.selectedProgram.id);
    return link;
  },
  async [T.GET_SETTINGS]() {
    const { link, page } = cloudCompanion();
    page.loadPrograms();
    await flush();
    assert.equal(page.accountSettings.units, 'kg');
    assert.equal(page.accountSettings.workoutDiagnosticsEnabled, false);
    return link;
  },
  async [T.GET_WORKOUT_NEXT]() {
    const { link, page } = cloudCompanion(buildApiWorkout([[1, 2], [0, 1]]));
    page.loadPrograms();
    await flush();
    assert.deepEqual(page.defaultWorkoutPlan.exercises.map((exercise) => exercise.sets.length), [2, 1]);
    return link;
  },
  async [T.GET_WORKOUT_CURRENT]() {
    const { cloud, link, page } = cloudCompanion();
    cloud.setCurrent({ ...buildApiWorkout([[0, 3]]), startTime: 5 });
    page.loadPrograms();
    await flush();
    assert.equal(page.screen, 'SESSION');
    assert.equal(page.workoutController.sync().startConfirmed, true);
    assert.equal(page.workoutController.view().startedAt, 5);
    return link;
  },
  async [T.GET_DAY_PLAN]() {
    const { link, page } = await demoCompanionDay();
    assert.ok(page.dayPlan.exercises.length > 0);
    assert.equal(page.workoutController.sync().mode, 'LEGACY');
    return link;
  },
  async [T.START_WORKOUT]() {
    const { cloud, link, controller } = await directWorkout();
    assert.equal(controller.sync().startConfirmed, true);
    assert.equal(cloud.current().startTime, 1_000_000);
    return link;
  },
  async [T.SYNC_WORKOUT_SETS]() {
    const { cloud, link } = await directWorkout();
    assert.deepEqual(cloud.completedSets().map((set) => set.setId), ['live1-entry-1-work-1']);
    return link;
  },
  async [T.FINISH_WORKOUT]() {
    const { cloud, link, controller } = await directWorkout();
    assert.equal((await controller.finishWorkoutRemote()).success, true);
    assert.equal(cloud.history.length, 1);
    // The legacy finish of a demo day goes through the page itself.
    const demo = await demoCompanionDay();
    demo.page.submitWorkout();
    await flush();
    assert.equal(demo.page.finishState.status, 'SAVED');
    link.exchanges.push(...demo.link.exchanges);
    return link;
  },
  async [T.DISCARD_WORKOUT]() {
    const { cloud, link, controller } = await directWorkout();
    assert.deepEqual(await controller.discardWorkoutRemote(), { success: true });
    assert.equal(cloud.current(), null);
    return link;
  },
  async [T.ABANDON_WORKOUT]() {
    const { link, page } = await demoCompanionDay();
    page.abandonWorkout();
    await flush();
    return link;
  },
  async [T.GET_EXERCISE_IMAGE]() {
    const link = createPhoneLink(null, {
      exerciseImageService: createExerciseImageService({
        isEnabled: () => false, storage: { getItem: () => null, setItem() {} },
        download() {}, convert() {}, sendFile() {},
      }),
    });
    link.setAuto(true);
    const changes = [];
    const client = createExerciseImageClient({
      inbox: { on() {}, getNextFile() {} },
      request: link.request,
      removeFile() {},
      onChange: (url, status, failure) => changes.push([status, failure?.reason]),
    });
    client.setEnabled(true);
    client.load('https://www.liftosaur.com/externalimages/exercises/single/small/squat.png');
    await flush();
    client.dispose();
    assert.deepEqual(changes, [['unavailable', 'PHONE_DISABLED']]);
    return link;
  },
};

test('every message type has a schema entry and every request an end-to-end case', () => {
  const requests = Object.keys(PROTOCOL_SCHEMA);
  const replies = Object.values(PROTOCOL_SCHEMA).map(([reply]) => reply);
  assert.deepEqual([...requests, ...replies, T.ERROR].sort(), Object.values(MESSAGE_TYPES).sort());
  assert.deepEqual(Object.keys(END_TO_END).sort(), requests.sort());
});

for (const [type, run] of Object.entries(END_TO_END)) {
  test(`end to end: ${type} goes from the watch through the phone router and its reply is used`, async () => {
    const link = await run();
    const own = link.exchanges.filter((exchange) => exchange.type === type);
    assert.ok(own.length > 0, `${type} never reached the phone`);
    assert.ok(own.some(({ reply }) => reply.type === PROTOCOL_SCHEMA[type][0]), `${type} never got its reply`);
    for (const { type: sentType, payload, reply } of link.exchanges) {
      assert.ok(isValidReply(sentType, reply), `${sentType} answered with ${reply.type}`);
      assert.notEqual(reply.type, T.ERROR, `${sentType} failed: ${reply.payload && reply.payload.message}`);
      const fields = PROTOCOL_SCHEMA[sentType][2].split(' ');
      for (const field of Object.keys(payload || {})) {
        assert.ok(fields.includes(field), `${sentType} sent the undeclared field ${field}`);
      }
    }
  });
}
