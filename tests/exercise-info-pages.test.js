import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { exerciseInfoPages } from '../shared/exercise-info-pages.js';

test('Info only adds an image page for enabled API images', () => {
  assert.deepEqual(exerciseInfoPages(['Notes'], false, '/image.png'), ['Notes']);
  assert.deepEqual(exerciseInfoPages(['Notes'], true, null), ['Notes']);
  assert.deepEqual(exerciseInfoPages(['Notes'], true, '/image.png'), [null, 'Notes']);
});

for (const product of ['page', 'data-widget']) {
  test(`${product} forwards received ZML files to the image client`, () => {
    const source = fs.readFileSync(`${product}/common/index.js`, 'utf8');
    const callback = source.match(/onReceivedFile\(file\) \{([\s\S]*?)\n    \}/);
    assert.ok(callback);
    const received = [];
    const file = { filePath: '/data/image.png' };
    new Function('exerciseImages', 'file', callback[1])({ receive: (value) => received.push(value) }, file);
    assert.deepEqual(received, [file]);
    new Function('exerciseImages', 'file', callback[1])(null, file);
  });

  test(`${product} image page handles loading, failure, navigation and disabling`, () => {
    const source = fs.readFileSync(`${product}/common/index.js`, 'utf8');
    const start = source.indexOf('function updateNotesImage()');
    const functionSource = source.slice(start, source.indexOf('\nfunction ', start + 1));
    const moveStart = source.indexOf('function moveNotesPage(');
    const moveSource = source.slice(moveStart, source.indexOf('\nfunction ', moveStart + 1));
    const calls = [];
    const imageWidget = { setProperty: (key, value) => calls.push([key, value]) };
    const controller = new Function('calls', 'imageWidget', 'exerciseInfoPages', `
      let notesImageWidget = null;
      let notesPage = 0;
      let isNotesModalOpen = true;
      let activeNotesImageUrl = '/api-image.png';
      const activeNotesContent = 'Notes';
      const paginateNotes = () => ['Notes'];
      const redraw = () => {};
      let accountSettings = { exerciseImages: true };
      let imageState = { status: 'loading', src: null };
      const exerciseImages = { get: () => imageState };
      const normalizeExerciseImages = value => value === true;
      const prop = { VISIBLE: 'visible', MORE: 'more' };
      const widget = { IMG: 'image' };
      const px = value => value;
      const addWidget = (type, props) => { calls.push([type, props]); return imageWidget; };
      const updateLiveWidget = (key, props) => calls.push([key, props]);
      ${functionSource}
      ${moveSource}
      return { move: moveNotesPage, run: (state, page = 0, enabled = true, imageUrl = '/api-image.png') => {
        activeNotesImageUrl = imageUrl;
        imageState = state; notesPage = page; accountSettings.exerciseImages = enabled;
        updateNotesImage();
      }};
    `)(calls, imageWidget, exerciseInfoPages);
    const run = controller.run;
    run({ status: 'loading' });
    assert.match(calls.at(-1)[1].text, /Loading/);
    run({ status: 'unavailable' });
    assert.match(calls.at(-1)[1].text, /unavailable/);
    run({ status: 'ready', src: 'data://image.png' });
    assert.equal(calls.find(([type]) => type === 'image')[1].src, 'data://image.png');
    assert.deepEqual(calls.at(-1), ['visible', true]);
    controller.move(1);
    assert.ok(calls.some(([key, value]) => key === 'modal-content' && value.text === 'Notes'));
    assert.deepEqual(calls.at(-1), ['visible', false]);
    controller.move(-1);
    assert.deepEqual(calls.at(-1), ['visible', true]);
    run({ status: 'ready', src: 'data://image.png' }, 1);
    assert.deepEqual(calls.at(-1), ['visible', false]);
    run({ status: 'ready', src: 'data://image.png' }, 0, false);
    assert.deepEqual(calls.at(-1), ['visible', false]);
    run({ status: 'ready', src: 'data://image.png' }, 0, true, null);
    assert.deepEqual(calls.at(-1), ['visible', false]);
  });
}
