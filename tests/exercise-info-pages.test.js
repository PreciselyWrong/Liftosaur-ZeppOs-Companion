import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { exerciseInfoPages } from '../shared/exercise-info-pages.js';

test('Info keeps the description first and budgets less text below an image', () => {
  const content = Array.from({ length: 8 }, (_, index) => `Line ${index + 1}`).join('\n');
  const withoutImage = exerciseInfoPages(content, false, '/image.png');
  const withImage = exerciseInfoPages(content, true, '/image.png');
  assert.equal(withoutImage.join('\n').replaceAll('\n\n', '\n'), content);
  assert.equal(withImage.join('\n').replaceAll('\n\n', '\n'), content);
  assert.ok(withImage.length > withoutImage.length);
  assert.notEqual(withImage[0], null);
});

for (const product of ['page', 'data-widget']) {
  test(`${product} renders ready-screen API thumbnails without placeholders`, () => {
    const source = fs.readFileSync(`${product}/common/index.js`, 'utf8');
    const start = source.indexOf('function renderReadyScreen(');
    const ready = source.slice(start, source.indexOf('\nfunction ', start + 1));
    assert.match(ready, /const showsImage = imagesEnabled && Boolean\(exercise\.imageUrl\)/);
    assert.match(ready, /exerciseImages\?\.load\(exercise\.imageUrl\)/);
    assert.match(ready, /exerciseImages\?\.get\(exercise\.imageUrl\)/);
    assert.match(ready, /image\?\.status === 'ready'/);
    assert.match(ready, /widget\.IMG/);
    assert.doesNotMatch(ready, /Image unavailable|Loading image/);
  });

  test(`${product} renders aligned API thumbnails in the workout overview`, () => {
    const source = fs.readFileSync(`${product}/common/index.js`, 'utf8');
    const start = source.indexOf('function renderOverviewScreen(');
    const overview = source.slice(start, source.indexOf('\nfunction ', start + 1));
    assert.match(overview, /const showsImage = imagesEnabled && Boolean\(ex\.imageUrl\)/);
    assert.match(overview, /exerciseImages\?\.load\(ex\.imageUrl\)/);
    assert.match(overview, /exerciseImages\?\.get\(ex\.imageUrl\)/);
    assert.match(overview, /image\?\.status === 'ready'/);
    assert.match(overview, /widget\.IMG/);
    assert.match(overview, /align_h: align\.LEFT/);
  });

  test(`${product} removes the redundant active-set target line`, () => {
    const source = fs.readFileSync(`${product}/common/index.js`, 'utf8');
    const start = source.indexOf('function renderActiveSetScreen(');
    const active = source.slice(start, source.indexOf('\nfunction ', start + 1));
    assert.doesNotMatch(active, /let targetText|Warmup Target:|Target:/);
    assert.match(active, /if \(supersetContext\)/);
    assert.match(active, /Next:/);
  });

  test(`${product} renders the resolved exercise image on the Prepare editor`, () => {
    const source = fs.readFileSync(`${product}/common/index.js`, 'utf8');
    const helperStart = source.indexOf('function renderPreparationImage(');
    assert.ok(helperStart >= 0);
    const helper = source.slice(helperStart, source.indexOf('\nfunction ', helperStart + 1));
    assert.match(helper, /exerciseDisplayImageUrl\(/);
    assert.match(helper, /exerciseImages\?\.load\(/);
    assert.match(helper, /widget\.IMG/);
    const activeStart = source.indexOf('function renderActiveSetScreen(');
    const active = source.slice(activeStart, source.indexOf('\nfunction ', activeStart + 1));
    assert.match(active, /isResting.*renderPreparationImage/s);
  });

  test(`${product} places the Info image above its first description page`, () => {
    const source = fs.readFileSync(`${product}/common/index.js`, 'utf8');
    const start = source.indexOf('function updateNotesImage()');
    const info = source.slice(start, source.indexOf('\nfunction ', start + 1));
    assert.match(info, /notesPage === 0/);
    assert.match(info, /image\?\.status === 'ready'/);
    assert.match(info, /widget\.IMG/);
    assert.match(info, /updateLiveWidget\('modal-content', \{[\s\S]*?y: px\([^)]*\),[\s\S]*?h: px\([^)]*\),[\s\S]*?text: pages\[notesPage\]/);
    assert.doesNotMatch(info, /Loading image|Image unavailable/);
  });

  test(`${product} forwards received ZML files to the image client`, () => {
    const source = fs.readFileSync(`${product}/common/index.js`, 'utf8');
    const callback = source.match(/onReceivedFile\(file\) \{([\s\S]*?)\n    \}/);
    assert.ok(callback);
    const received = [];
    const file = { filePath: '/data/image.png' };
    new Function('exerciseImages', 'file', 'isTearingDown', callback[1])({ receive: (value) => received.push(value) }, file, false);
    assert.deepEqual(received, [file]);
    new Function('exerciseImages', 'file', 'isTearingDown', callback[1])(null, file, false);
  });

  test(`${product} image page handles loading, failure, navigation and disabling`, () => {
    const source = fs.readFileSync(`${product}/common/index.js`, 'utf8');
    const start = source.indexOf('function updateNotesImage()');
    const functionSource = source.slice(start, source.indexOf('\nfunction ', start + 1));
    const moveStart = source.indexOf('function moveNotesPage(');
    const moveSource = source.slice(moveStart, source.indexOf('\nfunction ', moveStart + 1));
    const calls = [];
    const imageWidget = { setProperty: (key, value) => calls.push([key, value]) };
    const controller = new Function('calls', 'imageWidget', 'makePages', `
      let notesImageWidget = null;
      let notesPage = 0;
      let isNotesModalOpen = true;
      let activeNotesImageUrl = '/api-image.png';
      const activeNotesContent = 'Notes';
      const exerciseInfoPages = makePages;
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
    `)(calls, imageWidget, () => ['Notes', 'More']);
    const run = controller.run;
    const lastVisible = () => calls.findLast(([key]) => key === 'visible');
    run({ status: 'loading' });
    assert.equal(calls.findLast(([key]) => key === 'modal-content')[1].text, 'Notes');
    run({ status: 'unavailable' });
    assert.equal(calls.findLast(([key]) => key === 'modal-content')[1].text, 'Notes');
    run({ status: 'ready', src: 'data://image.png' });
    assert.equal(calls.find(([type]) => type === 'image')[1].src, 'data://image.png');
    assert.deepEqual(calls.at(-1), ['visible', true]);
    controller.move(1);
    assert.ok(calls.some(([key, value]) => key === 'modal-content' && value.text === 'Notes'));
    assert.deepEqual(lastVisible(), ['visible', false]);
    controller.move(-1);
    assert.deepEqual(lastVisible(), ['visible', true]);
    run({ status: 'ready', src: 'data://image.png' }, 1);
    assert.deepEqual(lastVisible(), ['visible', false]);
    run({ status: 'ready', src: 'data://image.png' }, 0, false);
    assert.deepEqual(lastVisible(), ['visible', false]);
    run({ status: 'ready', src: 'data://image.png' }, 0, true, null);
    assert.deepEqual(lastVisible(), ['visible', false]);
  });
}
