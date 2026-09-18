import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { exerciseDownloadUrl, exerciseImageFileExtension, normalizeExerciseImageUrl, normalizeExerciseImages } from '../shared/exercise-images.js';
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

test('exercise download url proxies PNG images to white background and passes GIFs', () => {
  const png = 'https://www.liftosaur.com/externalimages/exercises/single/small/squat.png';
  assert.equal(
    exerciseDownloadUrl(png),
    'https://wsrv.nl/exercise.png?url=https%3A%2F%2Fwww.liftosaur.com%2Fexternalimages%2Fexercises%2Fsingle%2Fsmall%2Fsquat.png&w=140&h=140&fit=contain&cbg=white&bg=white&output=png',
  );
  const gif = 'https://www.docteur-fitness.com/wp-content/uploads/2021/12/oiseau-assis-sur-banc.gif';
  assert.equal(exerciseDownloadUrl(gif), gif);
  assert.equal(exerciseDownloadUrl(null), null);
});

test('image policy accepts public HTTPS image files and explicit opt-in', () => {
  assert.equal(normalizeExerciseImageUrl(imageUrl), `https://www.liftosaur.com${imageUrl}`);
  const gif = 'https://www.docteur-fitness.com/wp-content/uploads/2021/12/oiseau-assis-sur-banc.gif';
  assert.equal(normalizeExerciseImageUrl(gif), gif);
  assert.equal(exerciseImageFileExtension(gif), 'gif');
  for (const url of [
    'http://example.com/a.png',
    'https://localhost/a.png',
    'https://127.0.0.1/a.png',
    'https://user:password@example.com/a.png',
    'https://example.com/a.svg',
    'https://example.com/a.png?key=secret',
    '/externalimages/exercises/../secret.png',
  ]) assert.equal(normalizeExerciseImageUrl(url), null, url);
  for (const value of [undefined, null, false, 'false', 1, 'yes']) assert.equal(normalizeExerciseImages(value), false);
  assert.equal(normalizeExerciseImages(undefined, true), true);
  assert.equal(normalizeExerciseImages(false, true), false);
  assert.equal(normalizeExerciseImages('{"value":true}'), true);
  assert.equal(normalizeExerciseImages({ value: 'true' }), true);
});

function serviceHarness(enabled = true) {
  let options;
  const task = {};
  const transfers = [];
  const failures = [];
  const saved = new Map();
  let convertOptions;
  let downloadImpl = (url, value) => { options = { url, ...value }; return task; };
  let convertImpl = async (value) => ({ targetFilePath: value.targetFilePath, options: { size: 100 } });
  const dependencies = {
    storage: { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) },
    isEnabled: () => enabled,
    download: (...args) => downloadImpl(...args),
    convert: (value) => { convertOptions = value; return convertImpl(value); },
    sendFile(path, params) { transfers.push({ path, params }); return { on() {} }; },
    onFailure(details) { failures.push(details); },
  };
  const service = createExerciseImageService(dependencies);
  return {
    service, task, transfers, failures, dependencies, saved, options: () => options,
    convertOptions: () => convertOptions,
    setDownload: (value) => { downloadImpl = value; },
    setConvert: (value) => { convertImpl = value; },
  };
}
function completeDownload(h) {
  h.task.onSuccess({ statusCode: 200, tempFilePath: 'data://download/native-temp.png' });
}
test('disabled image service performs no download', async () => {
  const h = serviceHarness(false);
  assert.equal((await h.service.load({ imageUrl })).status, 'disabled');
  assert.equal(h.options(), undefined);
});
test('image service converts the temporary path returned by Zepp', async () => {
  const h = serviceHarness();
  const result = h.service.load({ imageUrl });
  assert.deepEqual(h.options().headers, {});
  assert.equal(h.options().filePath, undefined);
  h.task.onSuccess({ statusCode: 200, tempFilePath: 'data://download/native-temp.png' });
  assert.equal((await result).status, 'queued');
  assert.equal(h.convertOptions().filePath, 'data://download/native-temp.png');
  assert.equal(h.transfers[0].params.imageUrl, `https://www.liftosaur.com${imageUrl}`);
});
test('download without a returned file path never reaches conversion', async () => {
  const h = serviceHarness();
  const result = h.service.load({ imageUrl });
  h.task.onSuccess({ statusCode: 200 });
  assert.deepEqual(await result, { status: 'unavailable', reason: 'DOWNLOAD_PATH_INVALID' });
  assert.equal(h.convertOptions(), undefined);
});
test('image service transfers the converter output path but rebuilds it after a Side Service restart', async () => {
  const h = serviceHarness();
  h.setConvert(async () => ({ targetFilePath: 'data://download/native-image', options: { size: 100 } }));
  const first = h.service.load({ imageUrl });
  completeDownload(h);
  assert.equal((await first).status, 'queued');
  assert.equal(h.transfers[0].path, 'data://download/native-image');
  h.setConvert(async (value) => ({ targetFilePath: value.targetFilePath, options: { size: 100 } }));
  const restarted = createExerciseImageService(h.dependencies);
  const second = restarted.load({ imageUrl });
  assert.ok(h.options(), 'a new service must not trust a path from the previous service');
  completeDownload(h);
  assert.equal((await second).status, 'queued');
  assert.notEqual(h.transfers[1].path, 'data://download/native-image');
});
test('a legacy ready image without its converter path is rebuilt at a new path', async () => {
  const h = serviceHarness();
  h.saved.set(EXERCISE_IMAGE_STORAGE_KEY, JSON.stringify([{ url: `https://www.liftosaur.com${imageUrl}`, ready: true }]));
  const result = h.service.load({ imageUrl });
  assert.ok(h.options(), 'the old ambiguous file must be downloaded again');
  completeDownload(h);
  assert.equal((await result).status, 'queued');
  assert.notEqual(h.transfers[0].path, 'data://download/lifto-exercise-0.png');
});
test('a stuck conversion from a prior service does not block the new service', async () => {
  const h = serviceHarness();
  h.saved.set(EXERCISE_IMAGE_STORAGE_KEY, JSON.stringify([{
    url: `https://www.liftosaur.com${imageUrl}`, converting: true, ready: false,
  }]));
  const result = h.service.load({ imageUrl });
  // Must re-download, not return CONVERSION_IN_PROGRESS from the stale slot.
  assert.equal(h.options().filePath, undefined);
  h.task.onSuccess({ statusCode: 200, tempFilePath: 'data://download/native-temp.png' });
  assert.equal((await result).status, 'queued');
  // Path carries the current generation, confirming stale slot was not reused.
  assert.match(h.convertOptions().targetFilePath, /lifto-exercise-[^-]+-\d+-0-source\.png_converted$/);
});
test('invalid converted image reports a bounded reason in the image reply', async () => {
  const h = serviceHarness();
  h.setConvert(async () => ({ targetFilePath: 'data://download/image', options: { size: 0 } }));
  const result = h.service.load({ imageUrl });
  completeDownload(h);
  assert.deepEqual(await result, { status: 'unavailable', reason: 'CONVERSION_OUTPUT_INVALID' });
});
test('image service passes a downloaded GIF to the experimental native conversion', async () => {
  const gif = 'https://www.docteur-fitness.com/wp-content/uploads/2021/12/oiseau-assis-sur-banc.gif';
  const h = serviceHarness();
  const result = h.service.load({ imageUrl: gif });
  assert.match(h.options().url, /\.gif$/);
  h.task.onSuccess({ statusCode: 200, tempFilePath: 'data://download/native-temp.gif' });
  assert.equal((await result).status, 'queued');
  assert.equal(h.convertOptions().filePath, 'data://download/native-temp.gif');
});
test('download failure is optional and never queues a file', async () => {
  const h = serviceHarness();
  const result = h.service.load({ imageUrl });
  h.task.onFail({ code: 7, message: 'Cannot write data://download/private.png' });
  assert.deepEqual(await result, { status: 'unavailable', reason: 'DOWNLOAD_NATIVE_FAILURE', nativeCode: 7, detail: 'Cannot write [path]' });
  assert.equal(h.transfers.length, 0);
  assert.deepEqual(h.failures, [{ stage: 'download', code: 'NATIVE_FAILURE', nativeCode: 7, message: 'Cannot write [path]' }]);
});
test('native failures without an event stay identifiable in replies', async () => {
  const h = serviceHarness();
  const result = h.service.load({ imageUrl });
  h.task.onFail();
  assert.deepEqual(await result, { status: 'unavailable', reason: 'DOWNLOAD_NATIVE_FAILURE', detail: 'NO_EVENT' });
});

test('simulator unsupported download stops without a second native attempt', async () => {
  const h = serviceHarness();
  let calls = 0;
  const task = {};
  h.setDownload(() => { calls++; return task; });
  const result = h.service.load({ imageUrl });
  task.onFail({ message: 'downloadFile is not supported in simulator' });
  assert.deepEqual(await result, { status: 'unavailable', reason: 'DOWNLOAD_SIMULATOR_UNSUPPORTED' });
  assert.equal(calls, 1);
  assert.equal(h.transfers.length, 0);
});

test('non-200 image downloads report the HTTP status without leaking the URL', async () => {
  const h = serviceHarness();
  const result = h.service.load({ imageUrl });
  h.task.onSuccess({ statusCode: 403 });
  assert.deepEqual(await result, { status: 'unavailable', reason: 'DOWNLOAD_HTTP_STATUS' });
  assert.deepEqual(h.failures, [{ stage: 'download', code: 'HTTP_STATUS', statusCode: 403 }]);
});
test('a Side Service restart redownloads into a distinct immutable path', async () => {
  const h = serviceHarness();
  const first = h.service.load({ imageUrl, requestId: 'first' });
  completeDownload(h);
  await first;
  const restarted = createExerciseImageService(h.dependencies);
  const second = restarted.load({ imageUrl, requestId: 'second' });
  completeDownload(h);
  assert.equal((await second).status, 'queued');
  assert.notEqual(h.transfers[0].path, h.transfers[1].path);
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
  completeDownload(h);
  assert.equal((await second).status, 'queued');
  assert.equal(JSON.parse(h.saved.get(EXERCISE_IMAGE_STORAGE_KEY)).length, 1);
});
test('disabling during conversion suppresses transfer even when enabled again', async () => {
  const h = serviceHarness();
  let convertDone;
  h.setConvert(() => new Promise((resolve) => { convertDone = resolve; }));
  const result = h.service.load({ imageUrl });
  completeDownload(h);
  await Promise.resolve();
  h.service.cancel();
  convertDone({ options: { size: 100 } });
  assert.equal((await result).status, 'disabled');
  assert.equal(h.transfers.length, 0);
});
test('full immutable slots refuse new URLs without network activity', async () => {
  const h = serviceHarness();
  h.saved.set(EXERCISE_IMAGE_STORAGE_KEY, JSON.stringify(Array.from({ length: 32 }, (_, i) => ({ url: `${imageUrl}${i}`, ready: true, generation: h.service.generation }))));
  assert.equal((await h.service.load({ imageUrl })).status, 'unavailable');
  assert.equal(h.options(), undefined);
});
test('conversion timeout protects unfinished output and retries at a fresh path', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = serviceHarness();
  h.setConvert(() => new Promise(() => {}));
  const result = h.service.load({ imageUrl });
  completeDownload(h);
  await Promise.resolve();
  t.mock.timers.tick(20000);
  assert.deepEqual(await result, { status: 'unavailable', reason: 'CONVERSION_TIMEOUT' });
  h.setConvert(async (value) => ({ targetFilePath: value.targetFilePath, options: { size: 100 } }));
  const retry = h.service.load({ imageUrl });
  assert.equal(h.options().filePath, undefined);
  h.task.onSuccess({ statusCode: 200, tempFilePath: 'data://download/native-temp.png' });
  assert.equal((await retry).status, 'queued');
  assert.equal(JSON.parse(h.saved.get(EXERCISE_IMAGE_STORAGE_KEY))[0].converting, true);
  assert.equal(h.transfers.length, 1);
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

test('serializes concurrent image requests without rejecting with BUSY', async () => {
  const h = serviceHarness();
  const secondUrl = '/externalimages/exercises/single/small/deadlift.png';
  const firstPromise = h.service.load({ imageUrl });
  const secondPromise = h.service.load({ imageUrl: secondUrl });

  completeDownload(h);
  const firstResult = await firstPromise;
  assert.equal(firstResult.status, 'queued');

  await Promise.resolve();
  completeDownload(h);
  const secondResult = await secondPromise;
  assert.equal(secondResult.status, 'queued');
  assert.equal(h.transfers.length, 2);
  assert.equal(h.transfers[1].params.imageUrl, `https://www.liftosaur.com${secondUrl}`);
});

test('watch exercise images accepts both native inbox shapes and the ZML file callback', () => {
  const source = fs.readFileSync('shared/watch-exercise-images.js', 'utf8');
  assert.match(source, /transfer\.getInbox\(\)/);
  assert.match(source, /transfer\.inbox/);
  assert.match(source, /client\.receive\(file\)/);
  assert.doesNotMatch(source, /\?\.\(/);
});


