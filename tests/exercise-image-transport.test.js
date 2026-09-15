import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeExerciseImageUrl, normalizeExerciseImages } from '../shared/exercise-images.js';
import { createExerciseImageService, EXERCISE_IMAGE_STORAGE_KEY } from '../app-side/exercise-image-service.js';
import { createExerciseImageClient } from '../shared/exercise-image-client.js';

const imageUrl = '/externalimages/exercises/single/small/squat_barbell_single_small.png';
test('exercise image runtime avoids optional calls unsupported by Zepp QuickJS', () => {
  for (const file of [
    'app-side/exercise-image-service.js',
    'shared/exercise-image-client.js',
    'shared/watch-exercise-images.js',
  ]) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\?\.\(/, file);
  const source = fs.readFileSync('app-side/index.js', 'utf8');
  const onInit = source.slice(source.indexOf('onInit()'), source.indexOf('onSettingsChange'));

  assert.match(onInit, /download:\s*\(url, options\) => this\.download\(url, options\)/);
  assert.match(onInit, /convert:\s*\(options\) => this\.convert\(options\)/);
  assert.match(onInit, /sendFile:\s*\(path, params\) => this\.sendFile\(path, params\)/);
  assert.doesNotMatch(onInit, /typeof (?:network|image|transferFile)/);
});

test('image policy accepts only the public PNG exercise directory and explicit opt-in', () => {
  assert.equal(normalizeExerciseImageUrl(imageUrl), `https://www.liftosaur.com${imageUrl}`);
  for (const url of ['https://evil.test/a.png', '/externalimages/exercises/../secret.png', imageUrl + '?key=secret', imageUrl.replace('.png', '.gif')]) assert.equal(normalizeExerciseImageUrl(url), null);
  for (const value of [undefined, null, false, 'false', 1, 'yes']) assert.equal(normalizeExerciseImages(value), false);
  assert.equal(normalizeExerciseImages('{"value":true}'), true);
  assert.equal(normalizeExerciseImages({ value: 'true' }), true);
});

function serviceHarness(enabled = true) {
  let options;
  const task = {};
  const transfers = [];
  const saved = new Map();
  let downloadImpl = (url, value) => { options = { url, ...value }; return task; };
  let convertImpl = async (value) => ({ targetFilePath: value.targetFilePath, options: { size: 100 } });
  const dependencies = {
    storage: { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) },
    isEnabled: () => enabled,
    download: (...args) => downloadImpl(...args),
    convert: (...args) => convertImpl(...args),
    sendFile(path, params) { transfers.push({ path, params }); return { on() {} }; },
  };
  const service = createExerciseImageService(dependencies);
  return {
    service, task, transfers, dependencies, saved, options: () => options,
    setDownload: (value) => { downloadImpl = value; },
    setConvert: (value) => { convertImpl = value; },
  };
}
test('disabled image service performs no download', async () => {
  const h = serviceHarness(false);
  assert.equal((await h.service.load({ imageUrl })).status, 'disabled');
  assert.equal(h.options(), undefined);
});
test('image service downloads without authentication, converts and transfers bounded local files', async () => {
  const h = serviceHarness();
  const result = h.service.load({ imageUrl });
  assert.equal(h.options().headers, undefined);
  h.task.onSuccess({ statusCode: 200, filePath: h.options().filePath });
  assert.equal((await result).status, 'queued');
  assert.equal(h.transfers[0].params.imageUrl, `https://www.liftosaur.com${imageUrl}`);
});
test('download failure is optional and never queues a file', async () => {
  const h = serviceHarness();
  const result = h.service.load({ imageUrl });
  h.task.onFail({ message: 'private error' });
  assert.deepEqual(await result, { status: 'unavailable' });
  assert.equal(h.transfers.length, 0);
});
test('immutable converted images are reused after Side Service restart without overwriting transfers', async () => {
  const h = serviceHarness();
  const first = h.service.load({ imageUrl, requestId: 'first' });
  h.task.onSuccess({ statusCode: 200 });
  await first;
  h.setDownload(() => { throw new Error('Must reuse'); });
  const restarted = createExerciseImageService(h.dependencies);
  assert.equal((await restarted.load({ imageUrl, requestId: 'second' })).status, 'queued');
  assert.equal(h.transfers[0].path, h.transfers[1].path);
  assert.equal(h.transfers[1].params.requestId, 'second');
  assert.equal(JSON.parse(h.saved.get(EXERCISE_IMAGE_STORAGE_KEY))[0].ready, true);
});
test('failed downloads retry their reserved slot and oversize downloads never transfer', async () => {
  const h = serviceHarness();
  let canceled = false;
  h.task.cancel = () => { canceled = true; };
  const first = h.service.load({ imageUrl });
  h.task.onProgress({ total: 600000, loaded: 100 });
  assert.equal((await first).status, 'unavailable');
  assert.equal(canceled, true);
  const second = h.service.load({ imageUrl });
  h.task.onSuccess({ statusCode: 200 });
  assert.equal((await second).status, 'queued');
  assert.equal(JSON.parse(h.saved.get(EXERCISE_IMAGE_STORAGE_KEY)).length, 1);
});
test('disabling during conversion suppresses transfer even when enabled again', async () => {
  const h = serviceHarness();
  let convertDone;
  h.setConvert(() => new Promise((resolve) => { convertDone = resolve; }));
  const result = h.service.load({ imageUrl });
  h.task.onSuccess({ statusCode: 200 });
  await Promise.resolve();
  h.service.cancel();
  convertDone({ options: { size: 100 } });
  assert.equal((await result).status, 'disabled');
  assert.equal(h.transfers.length, 0);
});
test('full immutable slots refuse new URLs without network activity', async () => {
  const h = serviceHarness();
  h.saved.set(EXERCISE_IMAGE_STORAGE_KEY, JSON.stringify(Array.from({ length: 32 }, (_, i) => ({ url: `${imageUrl}${i}`, ready: true }))));
  assert.equal((await h.service.load({ imageUrl })).status, 'unavailable');
  assert.equal(h.options(), undefined);
});
test('conversion timeout releases service but keeps unfinished native output protected', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = serviceHarness();
  h.setConvert(() => new Promise(() => {}));
  const result = h.service.load({ imageUrl });
  h.task.onSuccess({ statusCode: 200 });
  await Promise.resolve();
  t.mock.timers.tick(20000);
  assert.equal((await result).status, 'unavailable');
  assert.equal((await h.service.load({ imageUrl })).status, 'unavailable');
  assert.equal(JSON.parse(h.saved.get(EXERCISE_IMAGE_STORAGE_KEY))[0].converting, true);
  assert.equal(h.transfers.length, 0);
});
test('watch accepts completion only for requested images and ignores late completion after disable', async () => {
  let incoming;
  let receive;
  let changed = 0;
  let requestId;
  const client = createExerciseImageClient({
    inbox: { on(event, fn) { receive = fn; }, getNextFile() { return incoming; } },
    request: async (type, payload) => { requestId = payload.requestId; return { payload: { status: 'queued' } }; },
    removeFile() {}, onChange() { changed++; },
  });
  client.setEnabled(true);
  client.load(imageUrl);
  await Promise.resolve();
  let finish;
  incoming = { params: { type: 'exercise-image', imageUrl: `https://www.liftosaur.com${imageUrl}`, requestId }, filePath: 'data://download/lifto-exercise-image.png', fileSize: 100, on(event, fn) { finish = fn; }, cancel() {} };
  receive();
  finish({ data: { readyState: 'transferred' } });
  assert.equal(client.get(imageUrl).status, 'ready');
  client.setEnabled(false);
  const before = changed;
  finish({ data: { readyState: 'transferred' } });
  assert.equal(changed, before);
  assert.equal(client.get(imageUrl).status, 'disabled');
  client.dispose();
});
