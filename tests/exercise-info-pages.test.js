import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { exerciseInfoPages } from '../shared/exercise-info-pages.js';
import { INFO_NAV, INFO_TEXT_LAYOUT, WORKOUT_INFO_PANEL } from '../shared/exercise-info-layout.js';

test('Info makes description, session notes and recent comments separate subtitles', () => {
  const content = '## Description\nBrace your core.\n\n## This session\nUse a lighter weight.\n\n## Recent sessions\nLast time: better.';
  assert.deepEqual(exerciseInfoPages(content, false, null), [
    { subtitle: 'Description', body: 'Brace your core.' },
    { subtitle: 'This session', body: 'Use a lighter weight.' },
    { subtitle: 'Recent sessions', body: 'Last time: better.' },
  ]);
});

test('Info keeps the description first and budgets less text below an image', () => {
  const content = Array.from({ length: 8 }, (_, index) => `Line ${index + 1}`).join('\n');
  const withoutImage = exerciseInfoPages(content, false, '/image.png');
  const withImage = exerciseInfoPages(content, true, '/image.png');
  assert.equal(withoutImage.map(page => page.body).join('\n').replaceAll('\n\n', '\n'), content);
  assert.equal(withImage.map(page => page.body).join('\n').replaceAll('\n\n', '\n'), content);
  assert.ok(withImage.length >= withoutImage.length);
  assert.ok(withImage[0].body.split('\n').length < withoutImage[0].body.split('\n').length);
  assert.equal(withImage[0].subtitle, 'Details');
});

test('Info uses the full text area when the image download fails', () => {
  const content = Array.from({ length: 8 }, (_, index) => `Line ${index + 1}`).join('\n');
  const url = 'https://www.liftosaur.com/image.png';
  const unavailable = exerciseInfoPages(content, true, url, 'unavailable');
  const loading = exerciseInfoPages(content, true, url, 'loading');
  const noImage = exerciseInfoPages(content, false, url);
  assert.deepEqual(unavailable, noImage);
  assert.ok(loading[0].body.split('\n').length < unavailable[0].body.split('\n').length);
});

test('Info keeps the Side Plank comment above navigation on every page', () => {
  const content = '## This session\nDescription\nKeep your hips level and breathe steadily throughout the hold.\n\nPast sessions\n• 2026-08-18: Keep the hold steady.';
  const pages = exerciseInfoPages(content, false, null);
  assert.ok(pages.length > 1);
  assert.ok(pages.every(page => page.body.split('\n').length <= 6));
  assert.ok(pages.every(page => page.subtitle === 'This session'));
  assert.equal(pages.map(page => page.body).join('').replace(/\s/g, ''),
    'DescriptionKeep your hips level and breathe steadily throughout the hold.Past sessions• 2026-08-18: Keep the hold steady.'.replace(/\s/g, ''));
});

test('Info fits text above navigation and shortens only the image page', () => {
  const content = `## Exercise\n${Array.from({ length: 15 }, (_, index) => `Instruction ${index + 1}`).join('\n')}`;
  const withImage = exerciseInfoPages(content, true, '/image.png');
  const withoutImage = exerciseInfoPages(content, false, '/image.png');
  assert.ok(withImage[0].body.split('\n').length <= 3);
  assert.ok(withoutImage[0].body.split('\n').length <= 6);
  assert.ok(withImage.slice(1).every(page => page.body.split('\n').length <= 6));
  assert.equal(withImage.map(page => page.body).join(' ').replace(/\s/g, ''),
    withoutImage.map(page => page.body).join(' ').replace(/\s/g, ''));
});

test('Companion rebuilds modal controls above the panel after a full redraw', () => {
  const source = fs.readFileSync('page/common/index.js', 'utf8');
  const render = source.slice(source.indexOf('function renderUI()'), source.indexOf('function renderScreen()'));
  assert.match(render, /if \(isNotesModalOpen\) destroyModalControls\(\);[\s\S]*clearWidgets\(\)/);
});

test('both variants leave room for a double-digit page label and reachable actions', () => {
  assert.ok(INFO_NAV.page.w >= 60);
  assert.ok(INFO_NAV.previous.x + INFO_NAV.previous.w <= INFO_NAV.page.x);
  assert.ok(INFO_NAV.page.x + INFO_NAV.page.w <= INFO_NAV.next.x);
  assert.ok(INFO_NAV.next.x + INFO_NAV.next.w <= INFO_NAV.close.x);
  assert.ok(INFO_NAV.close.x + INFO_NAV.close.w <= 430);
  for (const product of ['page', 'data-widget']) {
    const source = fs.readFileSync(`${product}/common/index.js`, 'utf8');
    assert.match(source, /INFO_NAV\.page\.x/);
    assert.match(source, /INFO_NAV\.page\.w/);
    assert.match(source, /INFO_NAV\.close\.x/);
  }
});

test('Info image takes the full first page when ready and collapses text widgets', () => {
  assert.ok(INFO_TEXT_LAYOUT.imageBodyH >= 3 * 23);
  assert.ok(INFO_TEXT_LAYOUT.bodyH >= 6 * 23);
  assert.ok(INFO_TEXT_LAYOUT.imageBodyY + INFO_TEXT_LAYOUT.imageBodyH < 348);
  assert.ok(INFO_TEXT_LAYOUT.bodyY + INFO_TEXT_LAYOUT.bodyH < 348);
  for (const product of ['page', 'data-widget']) {
    const source = fs.readFileSync(`${product}/common/index.js`, 'utf8');
    const start = source.indexOf('function updateNotesImage()');
    const image = source.slice(start, source.indexOf('\nfunction ', start + 1));
    assert.match(image, /h: px\(imagePage \? 0 : INFO_TEXT_LAYOUT\.bodyH\)/, product);
  }
});

test('Info geometry lifts only the subtitle and contains long Workout text above navigation', () => {
  assert.equal(INFO_TEXT_LAYOUT.subtitleY, 93);
  assert.equal(INFO_TEXT_LAYOUT.bodyY, 124);
  assert.equal(INFO_TEXT_LAYOUT.bodyY + INFO_TEXT_LAYOUT.bodyH, 344);
  assert.equal(WORKOUT_INFO_PANEL.y + WORKOUT_INFO_PANEL.h, 346);
  assert.ok(INFO_TEXT_LAYOUT.bodyY + INFO_TEXT_LAYOUT.bodyH <= WORKOUT_INFO_PANEL.y + WORKOUT_INFO_PANEL.h);
  assert.ok(WORKOUT_INFO_PANEL.y + WORKOUT_INFO_PANEL.h < 348);

  const source = fs.readFileSync('data-widget/common/index.js', 'utf8');
  const start = source.indexOf('function renderNotesScreen(');
  const render = source.slice(start, source.indexOf('\nfunction ', start + 1));
  assert.match(render, /WORKOUT_INFO_PANEL\.x/);
  assert.match(render, /WORKOUT_INFO_PANEL\.y/);
  assert.match(render, /WORKOUT_INFO_PANEL\.h/);
});

for (const product of ['page', 'data-widget']) {
  test(`${product} renders ready-screen API thumbnails without placeholders`, () => {
    const source = fs.readFileSync(`${product}/common/index.js`, 'utf8');
    const start = source.indexOf('function renderReadyScreen(');
    const ready = source.slice(start, source.indexOf('\nfunction ', start + 1));
    assert.match(ready, /let showsImage = imagesEnabled && Boolean\(exercise\.imageUrl\)/);
    assert.match(ready, /exerciseImages\?\.load\(exercise\.imageUrl\)/);
    assert.match(ready, /exerciseImages\?\.get\(exercise\.imageUrl\)/);
    assert.match(ready, /image\?\.status === 'ready'/);
    assert.match(ready, /image\?\.status === 'unavailable'/);
    assert.match(ready, /widget\.IMG/);
    assert.doesNotMatch(ready, /Image unavailable|Loading image/);
  });

  test(`${product} renders aligned API thumbnails in the workout overview`, () => {
    const source = fs.readFileSync(`${product}/common/index.js`, 'utf8');
    const start = source.indexOf('function renderOverviewScreen(');
    const overview = source.slice(start, source.indexOf('\nfunction ', start + 1));
    assert.match(overview, /let showsImage = imagesEnabled && Boolean\(ex\.imageUrl\)/);
    assert.match(overview, /exerciseImages\?\.load\(ex\.imageUrl\)/);
    assert.match(overview, /exerciseImages\?\.get\(ex\.imageUrl\)/);
    assert.match(overview, /image\?\.status === 'ready'/);
    assert.match(overview, /image\?\.status === 'unavailable'/);
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

  test(`${product} keeps active set progress separate from overview dots and supersets`, () => {
    const source = fs.readFileSync(`${product}/common/index.js`, 'utf8');
    const start = source.indexOf('function renderActiveSetScreen(');
    const active = source.slice(start, source.indexOf('\nfunction ', start + 1));
    assert.match(active, /formatActiveSetProgress\(/);
    assert.doesNotMatch(active, /formatDots\(|formatSupersetProgress\(/);
  });

  test(`${product} shows a compact top Skip button on the left only for an available warmup`, () => {
    const source = fs.readFileSync(`${product}/common/index.js`, 'utf8');
    const start = source.indexOf('function renderActiveSetScreen(');
    const active = source.slice(start, source.indexOf('\nfunction ', start + 1));
    assert.match(active, /canSkipWarmup/);
    assert.match(active, /text:\s*'Skip'/);
    assert.match(active, /x:\s*px\(62\)[\s\S]*?y:\s*px\((?:86|88)\)[\s\S]*?w:\s*px\((?:64|74)\)[\s\S]*?h:\s*px\((?:36|38)\)/);
    assert.match(active, /skipWarmup\(/);
  });

  test(`${product} renders the resolved exercise image on the Prepare editor`, () => {
    const source = fs.readFileSync(`${product}/common/index.js`, 'utf8');
    const helperStart = source.indexOf('function renderPreparationImage(');
    assert.ok(helperStart >= 0);
    const helper = source.slice(helperStart, source.indexOf('\nfunction ', helperStart + 1));
    assert.match(helper, /exerciseDisplayImageUrl\(/);
    assert.match(helper, /exerciseImages\?\.load\(/);
    assert.match(helper, /image\?\.status === 'unavailable'/);
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
    assert.match(info, /updateLiveWidget\('modal-subtitle', \{[\s\S]*?text: pages\[notesPage\]\?\.subtitle/);
    assert.match(info, /updateLiveWidget\('modal-content', \{[\s\S]*?text: pages\[notesPage\]\?\.body/);
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
    const currentStart = source.indexOf('function currentNotesPages()');
    const currentSource = source.slice(currentStart, source.indexOf('\nfunction ', currentStart + 1));
    const moveStart = source.indexOf('function moveNotesPage(');
    const moveSource = source.slice(moveStart, source.indexOf('\nfunction ', moveStart + 1));
    const calls = [];
    const imageWidget = { setProperty: (key, value) => calls.push([key, value]) };
    const controller = new Function('calls', 'imageWidget', 'makePages', 'INFO_TEXT_LAYOUT', `
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
      ${currentSource}
      ${moveSource}
      return { move: moveNotesPage, run: (state, page = 0, enabled = true, imageUrl = '/api-image.png') => {
        activeNotesImageUrl = imageUrl;
        imageState = state; notesPage = page; accountSettings.exerciseImages = enabled;
        updateNotesImage();
      }};
    `)(calls, imageWidget, () => [
      { subtitle: 'Description', body: 'Notes' },
      { subtitle: 'Recent sessions', body: 'More' },
    ], INFO_TEXT_LAYOUT);
    const run = controller.run;
    const lastVisible = () => calls.findLast(([key]) => key === 'visible');
    run({ status: 'loading' });
    assert.equal(calls.findLast(([key]) => key === 'modal-content')[1].text, 'Notes');
    assert.equal(calls.findLast(([key]) => key === 'modal-subtitle')[1].text, 'Description');
    run({ status: 'unavailable' });
    assert.equal(calls.findLast(([key]) => key === 'modal-content')[1].text, 'Notes');
    run({ status: 'ready', src: 'data://image.png' });
    assert.equal(calls.find(([type]) => type === 'image')[1].src, 'data://image.png');
    assert.deepEqual(calls.at(-1), ['visible', true]);
    controller.move(1);
    assert.equal(calls.findLast(([key]) => key === 'modal-content')[1].text, 'More');
    assert.equal(calls.findLast(([key]) => key === 'modal-subtitle')[1].text, 'Recent sessions');
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
