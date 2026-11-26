import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createExerciseImageClient, holdExerciseImagesDuring } from '../shared/exercise-image-client.js';
import { MESSAGE_TYPES } from '../shared/protocol.js';
import { hasImageMemoryHeadroom } from '../shared/exercise-images.js';
import { OVERVIEW_PAGE_SIZE } from '../shared/watch-layout.js';

const url = '/externalimages/exercises/single/small/squat.png';
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(response = 'queued', { receivedFileSize = 0, maxCachedImages, onChange } = {}) {
  let receive;
  let incoming;
  let consumed = 0;
  const requests = [];
  const removed = [];
  const client = createExerciseImageClient({
    inbox: { on(_, handler) { receive = handler; }, getNextFile() { consumed++; return incoming; } },
    request: async (_, payload) => { requests.push(payload); return { payload: { status: response } }; },
    removeFile(path) { removed.push(path); },
    fileSize: () => receivedFileSize,
    maxCachedImages,
    onChange,
  });
  client.setEnabled(true);
  return { client, requests, removed, receive: file => { incoming = file; receive(); }, consumed: () => consumed };
}

test('Workout image transfers settle after filling the visible overview page', async () => {
  const source = readFileSync(new URL('../data-widget/common/index.js', import.meta.url), 'utf8');
  const capacity = source.match(/maxCachedImages:\s*([^,\r\n]+)/)[1];
  const urls = Array.from({ length: OVERVIEW_PAGE_SIZE }, (_, index) =>
    `https://example.com/exercise-${index}.png`);
  let h;
  const renderOverview = () => {
    for (const imageUrl of urls) {
      h.client.load(imageUrl);
      h.client.get(imageUrl);
    }
  };
  h = harness('queued', {
    maxCachedImages: vm.runInNewContext(capacity, { OVERVIEW_PAGE_SIZE }),
    onChange: renderOverview,
  });
  try {
    renderOverview();
    for (let index = 0; index < urls.length; index++) {
      await flush();
      h.receive({
        params: { type: 'exercise-image', ...h.requests[index] },
        fileSize: 100, filePath: `data://download/overview-${index}.png`,
        readyState: 'transferred', on() {}, cancel() {},
      });
    }
    await flush();
    assert.deepEqual(h.requests.map(request => request.imageUrl), urls);
    assert.deepEqual(h.removed, []);
    assert.deepEqual(urls.map(imageUrl => h.client.get(imageUrl).status),
      Array(OVERVIEW_PAGE_SIZE).fill('ready'));
  } finally {
    h.client.dispose();
  }
});

test('accepts a transferred watch file when native transfer metadata stays at zero', async () => {
  const h = harness('queued', { receivedFileSize: 100 });
  h.client.load(url);
  await flush();

  h.receive({ params: { type: 'exercise-image', ...h.requests[0] }, fileSize: 0,
    filePath: 'data://download/squat.png', readyState: 'transferred', on() {}, cancel() {} });

  assert.equal(h.client.get(url).status, 'ready');
  assert.equal(h.client.get(url).src, 'data://download/squat.png');
  h.client.dispose();
});

test('accepts the file supplied by the page callback without a second inbox', async () => {
  const requests = [];
  const client = createExerciseImageClient({
    request: async (_, payload) => {
      requests.push(payload);
      return { payload: { status: 'queued' } };
    },
    removeFile() {},
  });
  client.setEnabled(true);
  client.load(url);
  await flush();
  assert.equal(requests.length, 1);
  client.receive({
    params: { type: 'exercise-image', ...requests[0] },
    fileSize: 100,
    filePath: 'data://download/squat.png_converted',
    readyState: 'transferred',
    on() {},
  });
  assert.equal(client.get(url).status, 'ready');
  client.dispose();
});

test('a failed cached transfer requests one fresh conversion before showing unavailable', async () => {
  const h = harness();
  h.client.load(url);
  await flush();
  let fail;
  h.receive({ params: { type: 'exercise-image', ...h.requests[0], cached: true },
    filePath: 'data://download/old.png', on(_, callback) { fail = callback; }, cancel() {} });
  fail({ data: { readyState: 'error' } });
  await flush();
  assert.equal(h.client.get(url).status, 'loading');
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].forceRefresh, true);
  assert.notEqual(h.requests[1].requestId, h.requests[0].requestId);
  h.receive({ params: { type: 'exercise-image', ...h.requests[1], cached: false },
    fileSize: 100, filePath: 'data://download/new.png', readyState: 'transferred',
    on() {}, cancel() {} });
  assert.equal(h.client.get(url).status, 'ready');
  h.client.dispose();
});

test('disable before the deferred request prevents all transport work', async () => {
  const h = harness();
  h.client.load(url);
  h.client.setEnabled(false);
  await flush();
  assert.equal(h.requests.length, 0);
  h.client.dispose();
});

test('explicit reopening retries unavailable images but repeated loading does not duplicate work', async () => {
  const h = harness('unavailable');
  h.client.load(url);
  h.client.load(url);
  await flush();
  assert.equal(h.requests.length, 1);
  h.client.load(url, { retry: true });
  await flush();
  assert.equal(h.requests.length, 2);
  assert.notEqual(h.requests[0].requestId, h.requests[1].requestId);
  h.client.dispose();
});

test('serializes distinct image requests and keeps completed images available together', async () => {
  const h = harness();
  const secondUrl = '/externalimages/exercises/single/small/deadlift.png';
  h.client.load(url);
  h.client.load(secondUrl);
  await flush();
  assert.deepEqual(h.requests.map(request => request.imageUrl), [
    'https://www.liftosaur.com/externalimages/exercises/single/small/squat.png',
  ]);

  h.receive({ params: { type: 'exercise-image', ...h.requests[0] }, fileSize: 100,
    filePath: 'data://download/squat.png', readyState: 'transferred', on() {}, cancel() {} });
  await flush();
  assert.deepEqual(h.requests.map(request => request.imageUrl), [
    'https://www.liftosaur.com/externalimages/exercises/single/small/squat.png',
    'https://www.liftosaur.com/externalimages/exercises/single/small/deadlift.png',
  ]);

  h.receive({ params: { type: 'exercise-image', ...h.requests[1] }, fileSize: 100,
    filePath: 'data://download/deadlift.png', readyState: 'transferred', on() {}, cancel() {} });
  assert.equal(h.client.get(url).src, 'data://download/squat.png');
  assert.equal(h.client.get(secondUrl).src, 'data://download/deadlift.png');
  h.client.dispose();
});

test('prefetches the current exercise before queued thumbnails without interrupting a transfer', async () => {
  const h = harness();
  const queuedUrl = '/externalimages/exercises/single/small/deadlift.png';
  const currentUrl = '/externalimages/exercises/single/small/row.png';
  h.client.load(url);
  await flush();
  h.client.load(queuedUrl);
  h.client.prefetch(currentUrl);
  h.client.prefetch(currentUrl);

  assert.equal(h.requests.length, 1);
  h.receive({ params: { type: 'exercise-image', ...h.requests[0] }, fileSize: 100,
    filePath: 'data://download/squat.png', readyState: 'transferred', on() {}, cancel() {} });
  await flush();
  assert.equal(h.requests[1].imageUrl, `https://www.liftosaur.com${currentUrl}`);

  h.receive({ params: { type: 'exercise-image', ...h.requests[1] }, fileSize: 100,
    filePath: 'data://download/row.png', readyState: 'transferred', on() {}, cancel() {} });
  await flush();
  assert.equal(h.requests[2].imageUrl, `https://www.liftosaur.com${queuedUrl}`);
  h.client.dispose();
});

test('keeps four images and removes evicted and disposed watch files', async () => {
  const h = harness();
  const urls = Array.from({ length: 5 }, (_, index) =>
    `/externalimages/exercises/single/small/exercise-${index}.png`);

  for (let index = 0; index < urls.length; index++) {
    h.client.load(urls[index]);
    await flush();
    h.receive({ params: { type: 'exercise-image', ...h.requests[index] }, fileSize: 100,
      filePath: `data://download/exercise-${index}.png`, readyState: 'transferred', on() {}, cancel() {} });
  }

  assert.equal(h.client.get(urls[0]).status, 'unavailable');
  assert.deepEqual(h.removed, ['data://download/exercise-0.png']);
  h.client.dispose();
  assert.deepEqual(h.removed, urls.map((_, index) => `data://download/exercise-${index}.png`));
});

test('a disposed client never consumes an inbox file belonging to a new lifecycle', () => {
  const h = harness();
  h.client.dispose();
  h.receive({});
  assert.equal(h.consumed(), 0);
});

test('abandon stops callbacks without touching native transfer or files during host teardown', async () => {
  const h = harness();
  let cancelled = 0;
  let complete;
  h.client.load(url);
  await flush();
  h.receive({
    params: { type: 'exercise-image', ...h.requests[0] },
    fileSize: 100,
    filePath: 'data://download/image.png',
    on(_, callback) { complete = callback; },
    cancel() { cancelled++; },
  });

  h.client.abandon();
  complete({ data: { readyState: 'transferred' } });

  assert.equal(cancelled, 0);
  assert.deepEqual(h.removed, []);
  assert.equal(h.client.get(url).status, 'disabled');
});

test('a late same-URL transfer is rejected when its request belongs to an earlier lifecycle', async () => {
  const h = harness();
  h.client.load(url);
  await flush();
  const old = h.requests[0];
  h.client.setEnabled(false);
  h.client.setEnabled(true);
  h.client.load(url);
  await flush();
  let cancelled = false;
  h.receive({ params: { type: 'exercise-image', ...old }, fileSize: 100,
    filePath: 'data://download/image.png', on() {}, cancel() { cancelled = true; } });
  assert.equal(cancelled, true);
  assert.equal(h.client.get(url).status, 'loading');
  h.client.dispose();
});

test('stale transfer completion cannot delete the newer image sharing its bounded filename', async () => {
  const h = harness();
  const path = 'data://download/image.png';
  let oldCompletion;
  h.client.load(url);
  await flush();
  h.receive({ params: { type: 'exercise-image', ...h.requests[0] }, fileSize: 100,
    filePath: path, on(_, callback) { oldCompletion = callback; }, cancel() {} });
  h.client.setEnabled(false);
  h.client.setEnabled(true);
  h.client.load(url);
  await flush();
  h.receive({ params: { type: 'exercise-image', ...h.requests[1] }, fileSize: 100,
    filePath: path, readyState: 'transferred', on() {}, cancel() {} });
  assert.equal(h.client.get(url).status, 'ready');
  oldCompletion({ data: { readyState: 'transferred' } });
  assert.deepEqual(h.removed, []);
  h.client.dispose();
});

test('queue accepts more than four exercises before completion while preserving disk cache bound', async () => {
  const h = harness();
  const urls = Array.from({ length: 6 }, (_, index) =>
    `/externalimages/exercises/single/small/exercise-${index}.png`);

  for (const item of urls) {
    h.client.load(item);
  }
  await flush();

  for (const item of urls) {
    assert.equal(h.client.get(item).status, 'loading', `expected ${item} to be loading`);
  }
  h.client.dispose();
});

test('persists completed images to storage and restores them on next launch without re-requesting', async () => {
  const map = new Map();
  const storage = {
    getItem: (key) => map.get(key) || null,
    setItem: (key, value) => map.set(key, value),
  };
  const requests = [];
  const client = createExerciseImageClient({
    request: async (_, payload) => { requests.push(payload); return { payload: { status: 'queued' } }; },
    removeFile() {},
    fileSize: () => 100,
    storage,
  });
  client.setEnabled(true);
  client.load(url);
  await flush();
  assert.equal(requests.length, 1);
  client.receive({
    params: { type: 'exercise-image', ...requests[0] },
    fileSize: 100,
    filePath: 'data://download/cached-squat.png',
    readyState: 'transferred',
    on() {},
  });
  assert.equal(client.get(url).status, 'ready');
  assert.equal(client.get(url).src, 'data://download/cached-squat.png');
  client.dispose();

  const newRequests = [];
  const restoredClient = createExerciseImageClient({
    request: async (_, payload) => { newRequests.push(payload); return { payload: { status: 'queued' } }; },
    removeFile() {},
    fileSize: () => 100,
    storage,
  });
  restoredClient.setEnabled(true);
  assert.equal(restoredClient.get(url).status, 'ready');
  assert.equal(restoredClient.get(url).src, 'data://download/cached-squat.png');
  restoredClient.load(url);
  await flush();
  assert.equal(newRequests.length, 0);
  restoredClient.dispose();
});

test('a missing watch image file is requested again after restart', async () => {
  const saved = JSON.stringify([{ url: `https://www.liftosaur.com${url}`, src: 'data://download/gone.png' }]);
  const requests = [];
  const client = createExerciseImageClient({
    storage: { getItem: () => saved, setItem() {} },
    fileSize: () => null,
    request: async (_, payload) => { requests.push(payload); return { payload: { status: 'queued' } }; },
    removeFile() {},
  });
  client.setEnabled(true);
  assert.equal(client.get(url).status, 'unavailable');
  client.load(url);
  await flush();
  assert.equal(requests.length, 1);
  client.dispose();
});

test('Image requests are refused while system memory is exhausted', async () => {
  const requests = [];
  const changes = [];
  const client = createExerciseImageClient({
    inbox: { on() {}, getNextFile() { return null; } },
    request: async (_, payload) => { requests.push(payload); return { payload: { status: 'queued' } }; },
    removeFile() {},
    hasMemoryHeadroom: () => false,
    onChange: (changedUrl, status, failure) => changes.push({ changedUrl, status, failure }),
  });
  client.setEnabled(true);
  client.load(url);
  await flush();
  client.dispose();
  assert.deepEqual(requests, []);
  assert.deepEqual(changes.map(({ status, failure }) => ({ status, failure })),
    [{ status: 'unavailable', failure: { reason: 'LOW_MEMORY' } }]);
});

test('Memory headroom check only fails on a known near-zero reading', () => {
  const MIB = 1024 * 1024;
  assert.equal(hasImageMemoryHeadroom(null), true);
  assert.equal(hasImageMemoryHeadroom({ systemUsed: 3 * MIB - 0.3 * MIB, systemTotal: 3 * MIB }), true);
  assert.equal(hasImageMemoryHeadroom({ systemUsed: 3128592, systemTotal: 3145728 }), false);
});

function fileFor(request, path = 'data://download/squat.png') {
  return { params: { type: 'exercise-image', ...request }, fileSize: 100, filePath: path,
    readyState: 'transferred', on() {}, cancel() {} };
}

test('A set sync awaiting its reply defers new image requests until a quiet moment after it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = harness();
  const release = h.client.hold();
  h.client.load(url);
  await flush();
  assert.equal(h.requests.length, 0);
  release();
  await flush();
  assert.equal(h.requests.length, 0, 'the post-set redraw gets a quiet moment first');
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(h.requests.length, 1);
  h.client.dispose();
});

test('An image file arriving during a set sync is shown only after the sync settles', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const changes = [];
  const h = harness('queued', { onChange: (_, status) => changes.push(status) });
  h.client.load(url);
  await flush();
  const release = h.client.hold();
  h.receive(fileFor(h.requests[0]));
  assert.equal(h.client.get(url).status, 'loading');
  assert.deepEqual(changes, []);
  release();
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(h.client.get(url).status, 'ready');
  assert.deepEqual(changes, ['ready']);
  h.client.dispose();
});

test('A delivered image file is kept and shown even when memory reads low as it lands', async () => {
  let headroom = true;
  const changes = [];
  const requests = [];
  const removed = [];
  const client = createExerciseImageClient({
    request: async (_, payload) => { requests.push(payload); return { payload: { status: 'queued' } }; },
    removeFile: (path) => removed.push(path),
    hasMemoryHeadroom: () => headroom,
    onChange: (_, status, failure) => changes.push({ status, failure }),
  });
  client.setEnabled(true);
  client.load(url);
  await flush();
  // The transfer was the costly step and cached images are drawn without a check, so dropping
  // a fresh file protects nothing and left the exercise without its image.
  headroom = false;
  client.receive(fileFor(requests[0]));
  assert.equal(client.get(url).status, 'ready');
  assert.deepEqual(removed, []);
  assert.deepEqual(changes, [{ status: 'ready', failure: null }]);
  client.dispose();
});

test('A temporary image failure is retried by a later plain load, a bounded number of times', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let headroom = false;
  const requests = [];
  const client = createExerciseImageClient({
    request: async (_, payload) => {
      requests.push(payload);
      return { payload: { status: 'unavailable', reason: 'DOWNLOAD_HTTP_STATUS' } };
    },
    removeFile() {},
    hasMemoryHeadroom: () => headroom,
  });
  client.setEnabled(true);
  client.load(url);
  await flush();
  assert.equal(client.get(url).status, 'unavailable');
  client.load(url);
  await flush();
  assert.equal(requests.length, 0, 'an immediate render does not ask again');
  headroom = true;
  t.mock.timers.tick(60000);
  client.load(url);
  await flush();
  assert.equal(requests.length, 1, 'the low-memory skip is retried later');
  for (let i = 0; i < 5; i++) {
    t.mock.timers.tick(60000);
    client.load(url);
    await flush();
  }
  assert.equal(requests.length, 1, 'a phone refusal is not temporary and is not retried');
  client.dispose();
});

test('A repeatedly timing-out image stops auto-retrying after its bound', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const requests = [];
  const client = createExerciseImageClient({
    request: (_, payload) => { requests.push(payload); return new Promise(() => {}); },
    removeFile() {},
  });
  client.setEnabled(true);
  for (let round = 0; round < 6; round++) {
    client.load(url);
    await flush();
    t.mock.timers.tick(45000);
    t.mock.timers.tick(45000);
    await flush();
    t.mock.timers.tick(60000);
  }
  // Each attempt asks twice (first wait, then its one retry): the first load plus two automatic retries.
  assert.equal(requests.length, 6);
  assert.equal(client.get(url).status, 'unavailable');
  client.dispose();
});

test('Images are held only while a set sync awaits its reply, failed or not', async () => {
  const calls = [];
  const images = { hold() { calls.push('hold'); return () => calls.push('release'); } };
  assert.equal(await holdExerciseImagesDuring(images, MESSAGE_TYPES.GET_EXERCISE_IMAGE, async () => 'ok'), 'ok');
  assert.deepEqual(calls, []);
  await assert.rejects(holdExerciseImagesDuring(images, MESSAGE_TYPES.SYNC_WORKOUT_SETS,
    async () => { calls.push('send'); throw new Error('offline'); }));
  assert.deepEqual(calls, ['hold', 'send', 'release']);
  assert.equal(await holdExerciseImagesDuring(null, MESSAGE_TYPES.SYNC_WORKOUT_SETS, async () => 'ok'), 'ok');
});

test('An image retry that falls due during a set sync waits for the quiet moment after it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = harness();
  h.client.load(url);
  await flush();
  assert.equal(h.requests.length, 1);
  const release = h.client.hold();
  t.mock.timers.tick(20000);
  await flush();
  assert.equal(h.requests.length, 1, 'no image request while the set sync awaits its reply');
  release();
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].forceRefresh, true, 'the promised file never came, so the retry asks for a fresh one');
  h.client.dispose();
});

test('Images still loading when images are switched off are asked for again once they are back', async () => {
  const map = new Map();
  const storage = { getItem: (key) => map.get(key) || null, setItem: (key, value) => map.set(key, value) };
  const bench = '/externalimages/exercises/single/small/bench.png';
  const requests = [];
  const client = createExerciseImageClient({
    request: (_, payload) => { requests.push(payload.imageUrl); return new Promise(() => {}); },
    removeFile() {},
    fileSize: () => 100,
    storage,
  });
  client.setEnabled(true);
  client.load(url);
  client.load(bench);
  await flush();
  assert.equal(requests.length, 1);
  // A settings reply without the image setting switches images off for a moment.
  client.setEnabled(false);
  client.setEnabled(true);
  client.load(url);
  client.load(bench);
  await flush();
  assert.equal(requests.length, 2, 'the cancelled image is not left loading forever');
  assert.equal(client.get(url).status, 'loading');
  assert.equal(client.get(bench).status, 'loading');
  client.dispose();
});

function dayHarness({ maxCachedImages = 12, response = () => ({ payload: { status: 'queued' } }), headroom = () => true, storage } = {}) {
  const requests = [];
  const changes = [];
  const removed = [];
  const client = createExerciseImageClient({
    request: async (_, payload) => { requests.push(payload); return response(payload); },
    removeFile: (path) => removed.push(path),
    fileSize: () => 100,
    maxCachedImages,
    hasMemoryHeadroom: headroom,
    storage,
    onChange: (changedUrl, status, failure, origin) => changes.push({ changedUrl, status, failure, origin }),
  });
  client.setEnabled(true);
  const deliver = (index, path = `data://download/day-${index}.png`) => client.receive(fileFor(requests[index], path));
  return { client, requests, changes, removed, deliver, asked: () => requests.map(request => request.imageUrl) };
}

const day = ['squat', 'bench', 'row', 'curl'].map(name => `https://www.liftosaur.com/externalimages/exercises/single/small/${name}.png`);

test('Preloading a day fetches each exercise image once, one at a time, in workout order', async () => {
  const h = dayHarness();
  h.client.preload([day[0], null, day[1], undefined, day[0], 'not a link', day[2]]);
  await flush();
  assert.deepEqual(h.asked(), [day[0]], 'strictly one transfer at a time');
  h.deliver(0);
  await flush();
  assert.deepEqual(h.asked(), [day[0], day[1]]);
  h.deliver(1);
  await flush();
  h.deliver(2);
  await flush();
  assert.deepEqual(h.asked(), [day[0], day[1], day[2]], 'exercises without an image are skipped');
  assert.deepEqual([day[0], day[1], day[2]].map(item => h.client.get(item).status), ['ready', 'ready', 'ready']);
  h.client.preload(day.slice(0, 3));
  await flush();
  assert.equal(h.requests.length, 3, 'cached images are drawn from flash without asking again');
  h.client.dispose();
});

test('Images a screen asks for go before the day preload', async () => {
  const h = dayHarness();
  h.client.preload([day[0], day[1]]);
  h.client.load(day[3]);
  await flush();
  assert.deepEqual(h.asked(), [day[3]]);
  h.deliver(0);
  await flush();
  assert.deepEqual(h.asked(), [day[3], day[0]]);
  h.client.dispose();
});

test('Preloading waits for a set sync reply and the quiet moment after it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = dayHarness();
  const release = h.client.hold();
  h.client.preload(day);
  await flush();
  assert.equal(h.requests.length, 0);
  release();
  await flush();
  assert.equal(h.requests.length, 0);
  t.mock.timers.tick(3000);
  await flush();
  assert.deepEqual(h.asked(), [day[0]]);
  h.client.dispose();
});

test('Preloading asks nothing while memory is short and leaves the image to the screens', async () => {
  let headroom = false;
  const h = dayHarness({ headroom: () => headroom });
  h.client.preload([day[0]]);
  await flush();
  assert.equal(h.requests.length, 0);
  assert.deepEqual(h.changes, [], 'no screen redraws for an image nobody showed');
  headroom = true;
  h.client.load(day[0]);
  await flush();
  assert.deepEqual(h.asked(), [day[0]], 'a screen asks at once instead of waiting out a retry delay');
  h.client.dispose();
});

test('A failed preload does not mark the image unavailable for the screens', async () => {
  let reason = 'DOWNLOAD_HTTP_STATUS';
  const h = dayHarness({ response: () => (reason ? { payload: { status: 'unavailable', reason } } : { payload: { status: 'queued' } }) });
  h.client.preload([day[0], day[1]]);
  await flush();
  await flush();
  assert.deepEqual(h.asked(), [day[0], day[1]], 'a failure moves on to the next exercise');
  await flush();
  assert.deepEqual(h.changes, [], 'no screen is told the image is unavailable');
  h.client.preload([day[0], day[1]]);
  await flush();
  assert.equal(h.requests.length, 2, 'a failed preload is not repeated in a loop');
  reason = null;
  h.client.load(day[0]);
  await flush();
  assert.equal(h.requests.length, 3);
  assert.equal(h.client.get(day[0]).status, 'loading');
  h.client.dispose();
});

test('Starting a set pauses preloading until an idle screen preloads again', async () => {
  const h = dayHarness();
  h.client.preload([day[0], day[1]]);
  await flush();
  h.client.pausePreload();
  h.deliver(0);
  await flush();
  assert.equal(h.requests.length, 1, 'the transfer under way finishes, no new one starts');
  h.client.preload([day[0], day[1]]);
  await flush();
  assert.deepEqual(h.asked(), [day[0], day[1]]);
  h.client.dispose();
});

test('A tap pauses preloading for a quiet moment that one timer ends', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = dayHarness();
  h.client.preload([day[0], day[1]]);
  await flush();
  h.client.pausePreload(5000);
  h.deliver(0);
  h.client.preload([day[0], day[1]]);
  await flush();
  assert.equal(h.requests.length, 1, 'the redraw after a tap does not end the quiet moment');
  t.mock.timers.tick(4999);
  await flush();
  assert.equal(h.requests.length, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.deepEqual(h.asked(), [day[0], day[1]]);
  h.client.dispose();
});

test('Only images a screen showed ask for a redraw when they land', async () => {
  const h = dayHarness();
  h.client.preload([day[0], day[1]]);
  await flush();
  h.deliver(0);
  await flush();
  h.client.load(day[1]);
  h.deliver(1);
  await flush();
  assert.deepEqual(h.changes.map(({ status, origin }) => ({ status, preload: Boolean(origin?.preload) })), [
    { status: 'ready', preload: true },
    { status: 'ready', preload: false },
  ]);
  h.client.dispose();
});

test('Preloading never fetches more images than the flash cache keeps', async () => {
  const h = dayHarness({ maxCachedImages: 2 });
  h.client.preload(day);
  for (let index = 0; index < 4; index++) {
    await flush();
    if (h.requests[index]) h.deliver(index);
  }
  await flush();
  assert.deepEqual(h.asked(), [day[0], day[1]], 'a day larger than the cache would evict its own first images');
  assert.deepEqual(h.removed, []);
  h.client.dispose();
});

test('Preloading keeps the day images already in flash ahead of newer arrivals, across a relaunch', async () => {
  const map = new Map();
  const storage = { getItem: (key) => map.get(key) || null, setItem: (key, value) => map.set(key, value) };
  const older = 'https://www.liftosaur.com/externalimages/exercises/single/small/older.png';
  const first = dayHarness({ maxCachedImages: 2, storage });
  first.client.load(day[0]);
  await flush();
  first.deliver(0, 'data://download/squat.png');
  first.client.load(older);
  await flush();
  first.deliver(1, 'data://download/older.png');
  first.client.dispose();

  const relaunched = dayHarness({ maxCachedImages: 2, storage });
  relaunched.client.preload([day[0], day[1]]);
  await flush();
  assert.deepEqual(relaunched.asked(), [day[1]], 'the cached image of the same exercise is a hit after a relaunch');
  relaunched.deliver(0, 'data://download/bench.png');
  assert.deepEqual(relaunched.removed, ['data://download/older.png']);
  assert.equal(relaunched.client.get(day[0]).status, 'ready');
  relaunched.client.dispose();
});
