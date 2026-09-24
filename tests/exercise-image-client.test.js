import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createExerciseImageClient } from '../shared/exercise-image-client.js';
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

