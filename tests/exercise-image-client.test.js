import test from 'node:test';
import assert from 'node:assert/strict';
import { createExerciseImageClient } from '../shared/exercise-image-client.js';

const url = '/externalimages/exercises/single/small/squat.png';
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(response = 'queued') {
  let receive;
  let incoming;
  let consumed = 0;
  const requests = [];
  const removed = [];
  const client = createExerciseImageClient({
    inbox: { on(_, handler) { receive = handler; }, getNextFile() { consumed++; return incoming; } },
    request: async (_, payload) => { requests.push(payload); return { payload: { status: response } }; },
    removeFile(path) { removed.push(path); },
  });
  client.setEnabled(true);
  return { client, requests, removed, receive: file => { incoming = file; receive(); }, consumed: () => consumed };
}

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
  h.client.load(url);
  await flush();
  assert.equal(h.requests.length, 2);
  assert.notEqual(h.requests[0].requestId, h.requests[1].requestId);
  h.client.dispose();
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
