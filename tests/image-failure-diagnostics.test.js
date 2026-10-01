import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { mock } from 'node:test';
import vm from 'node:vm';
import { createExerciseImageClient } from '../shared/exercise-image-client.js';
import { MAX_EXERCISE_IMAGE_BYTES } from '../shared/exercise-images.js';
import { createWorkoutDiagnostics, formatWorkoutDiagnostics, WORKOUT_DIAGNOSTIC_CODES as CODES } from '../shared/workout-diagnostics.js';

const url = '/externalimages/exercises/single/small/squat.png';
const flush = () => new Promise((resolve) => setImmediate(resolve));

function client(reply) {
  let receive;
  let incoming = null;
  const changes = [];
  const requests = [];
  const imageClient = createExerciseImageClient({
    inbox: { on(_, handler) { receive = handler; }, getNextFile: () => incoming },
    request: async (_, payload) => { requests.push(payload); return reply(); },
    removeFile() {},
    fileSize: () => 0,
    onChange: (imageUrl, status, failure) => changes.push({ status, failure }),
  });
  imageClient.setEnabled(true);
  imageClient.load(url);
  return {
    changes,
    deliver: (file) => { incoming = file; receive(); },
    file: (fields) => ({ params: { type: 'exercise-image', ...requests[0] }, on() {}, cancel() {}, ...fields }),
  };
}

test('the phone reason and HTTP status reach the watch when an image is unavailable', async () => {
  const h = client(() => ({ payload: { status: 'unavailable', reason: 'DOWNLOAD_HTTP_STATUS', statusCode: 404 } }));
  await flush();
  assert.deepEqual(h.changes.at(-1), { status: 'unavailable', failure: { reason: 'DOWNLOAD_HTTP_STATUS', httpStatus: 404 } });
});

test('the watch names the step where an image stopped', async () => {
  const cases = [
    [() => ({ payload: { status: 'disabled' } }), null, 'PHONE_DISABLED'],
    [() => { throw new Error('Phone not reachable'); }, null, 'REQUEST_FAILED'],
    [() => ({ payload: { status: 'queued' } }), { readyState: 'error', fileSize: 10 }, 'TRANSFER_ERROR'],
    [() => ({ payload: { status: 'queued' } }), { readyState: 'canceled', fileSize: 10 }, 'TRANSFER_CANCELED'],
    [() => ({ payload: { status: 'queued' } }), { readyState: 'transferred', fileSize: 0, filePath: 'data://download/x.png' }, 'FILE_INVALID'],
    [() => ({ payload: { status: 'queued' } }), { readyState: 'transferred', fileSize: MAX_EXERCISE_IMAGE_BYTES + 1 }, 'FILE_TOO_LARGE'],
  ];
  for (const [reply, file, reason] of cases) {
    const h = client(reply);
    await flush();
    if (file) h.deliver(h.file(file));
    assert.deepEqual(h.changes.at(-1), { status: 'unavailable', failure: { reason } }, reason);
  }
});

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

test('the report keeps only known image failure steps and HTTP statuses', () => {
  const diagnostics = createWorkoutDiagnostics(storage(), () => 1_000);
  diagnostics.setEnabled(true);
  diagnostics.record(CODES.BOOT);
  diagnostics.record(CODES.IMAGE_UNAVAILABLE, { image: 'DOWNLOAD_HTTP_STATUS', httpStatus: 404 });
  diagnostics.record(CODES.IMAGE_UNAVAILABLE, { image: 'https://example.com/private?token=1', httpStatus: 70_000 });
  const [known, unknown] = diagnostics.read().events.slice(1);
  assert.equal(known.context.image, 'DOWNLOAD_HTTP_STATUS');
  assert.equal(known.context.httpStatus, 404);
  assert.equal(unknown.context?.image, undefined);
  assert.equal(unknown.context?.httpStatus, undefined);
  assert.match(formatWorkoutDiagnostics(diagnostics.read()), /IMAGE_UNAVAILABLE \(\+0ms\) \| image DOWNLOAD_HTTP_STATUS http 404/);
});

for (const [name, file] of [['Companion', '../page/common/index.js'], ['Workout', '../data-widget/common/index.js']]) {
  test(`${name} records why an image is unavailable`, () => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /WORKOUT_DIAGNOSTIC_CODES\.IMAGE_UNAVAILABLE, \{ image: failure\?\.reason, httpStatus: failure\?\.httpStatus \}/);
  });
}

// Real runs always carry their runtime, so their details are never empty.
const runtime = { runtime: () => ({ product: 'companion' }) };

test('each run keeps its last image outcome and counts beyond the retained steps', () => {
  let at = 1_000;
  const diagnostics = createWorkoutDiagnostics(storage(), () => at, () => null, runtime);
  diagnostics.setEnabled(true);
  diagnostics.record(CODES.BOOT);
  diagnostics.record(CODES.IMAGE_READY);
  at = 2_000;
  diagnostics.record(CODES.IMAGE_UNAVAILABLE, { image: 'TRANSFER_ERROR' });
  for (let step = 0; step < 20; step++) diagnostics.record(CODES.HEARTBEAT);
  const { details } = diagnostics.read();
  assert.deepEqual(details.images, { ready: 1, unavailable: 1 });
  assert.equal(details.lastImage.code, CODES.IMAGE_UNAVAILABLE);
  assert.equal(details.lastImage.context.image, 'TRANSFER_ERROR');
  const text = formatWorkoutDiagnostics(diagnostics.read());
  assert.match(text, /Images: 1 shown, 1 unavailable/);
  assert.match(text, /Last image at 1970-01-01T00:00:02\.000Z UTC: IMAGE_UNAVAILABLE image TRANSFER_ERROR/);
  diagnostics.record(CODES.BOOT);
  assert.equal(diagnostics.read().details?.images, undefined);
});

test('a run without any image request says so', () => {
  const diagnostics = createWorkoutDiagnostics(storage(), () => 1_000, () => null, runtime);
  diagnostics.setEnabled(true);
  diagnostics.record(CODES.BOOT);
  assert.match(formatWorkoutDiagnostics(diagnostics.read()), /Images: none requested/);
});

test('a link the watch refuses is reported once instead of failing silently', () => {
  const changes = [];
  const imageClient = createExerciseImageClient({
    request: async () => assert.fail('no request for a refused link'),
    removeFile() {},
    fileSize: () => 0,
    onChange: (imageUrl, status, failure) => changes.push({ status, failure }),
  });
  imageClient.setEnabled(true);
  for (let render = 0; render < 3; render++) imageClient.load('https://cdn.example.com/squat.svg');
  imageClient.load(null);
  assert.deepEqual(changes, [{ status: 'unavailable', failure: { reason: 'INVALID_URL' } }]);
});

test('the watch wrapper passes the failure step on to the app', () => {
  const source = readFileSync(new URL('../shared/watch-exercise-images.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '')
    .replace('export function', 'function');
  let clientOptions;
  const context = {
    console: { log() {} },
    TransferFile: null,
    rmSync() {},
    statSync() {},
    createExerciseImageClient: (options) => { clientOptions = options; return { receive() {} }; },
  };
  vm.createContext(context);
  vm.runInContext(`${source}
this.create = createWatchExerciseImages;`, context);
  const changes = [];
  context.create({ request() {}, onChange: (...args) => changes.push(args) });
  clientOptions.onChange(url, 'unavailable', { reason: 'TRANSFER_ERROR' });
  assert.deepEqual(changes, [[url, 'unavailable', { reason: 'TRANSFER_ERROR' }]]);
});

function slowPhone() {
  let receive;
  let incoming = null;
  const requests = [];
  const changes = [];
  const imageClient = createExerciseImageClient({
    inbox: { on(_, handler) { receive = handler; }, getNextFile: () => incoming },
    request: (_, payload) => new Promise((resolve) => requests.push({ payload, resolve })),
    removeFile() {},
    fileSize: () => 100,
    onChange: (imageUrl, status, failure) => changes.push({ status, failure }),
  });
  imageClient.setEnabled(true);
  return {
    imageClient,
    requests,
    changes,
    queue: (index) => requests[index].resolve({ payload: { status: 'queued' } }),
    deliver: (index) => {
      incoming = { params: { type: 'exercise-image', ...requests[index].payload }, fileSize: 100,
        filePath: 'data://download/squat.png', readyState: 'transferred', on() {}, cancel() {} };
      receive();
    },
  };
}

test('an image that outlasts the first wait is requested once more and shown', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = slowPhone();
  h.imageClient.load(url);
  await flush();
  t.mock.timers.tick(45_000);
  await flush();
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.changes, []);
  h.queue(1);
  await flush();
  h.deliver(1);
  assert.equal(h.imageClient.get(url).status, 'ready');
  h.imageClient.dispose();
});

test('a second timeout says whether the phone or the transfer kept the watch waiting', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [answer, reason] of [[false, 'PHONE_NO_REPLY'], [true, 'FILE_NOT_RECEIVED']]) {
    const h = slowPhone();
    h.imageClient.load(url);
    for (const attempt of [0, 1]) {
      await flush();
      if (answer) h.queue(attempt);
      await flush();
      t.mock.timers.tick(45_000);
    }
    await flush();
    assert.equal(h.requests.length, 2, reason);
    assert.equal(h.requests[1].payload.forceRefresh, answer, reason);
    assert.deepEqual(h.changes, [{ status: 'unavailable', failure: { reason } }], reason);
    h.imageClient.dispose();
  }
});

test('a promised image that never arrives is fetched fresh after 20 seconds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = slowPhone();
  h.imageClient.load(url);
  await flush();
  h.queue(0);
  await flush();
  t.mock.timers.tick(19_999);
  await flush();
  assert.equal(h.requests.length, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].payload.forceRefresh, true);
  h.queue(1);
  await flush();
  h.deliver(1);
  assert.equal(h.imageClient.get(url).status, 'ready');
  h.imageClient.dispose();
});
