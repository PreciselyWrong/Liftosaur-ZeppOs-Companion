import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readProductSource(product) {
  return fs.readFileSync(path.join(process.cwd(), product, 'common', 'index.js'), 'utf8');
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  return source.slice(start, source.indexOf('\nfunction ', start + 1));
}

for (const product of ['page', 'data-widget']) {
  test(`${product} opens pause controls from the running rest timer`, () => {
    const source = readProductSource(product);
    const restScreen = extractFunction(source, 'renderRestScreen');
    const open = extractFunction(source, 'openRestControls');
    const root = extractFunction(source, 'renderScreen');

    assert.match(source, /let isRestControlsOpen = false/);
    assert.match(restScreen, /addLiveButton\('restValue'/);
    assert.match(restScreen, /click_func: openRestControls/);
    assert.match(open, /isRestControlsOpen = true/);
    assert.match(open, /controllerUiDirty = true/);
    assert.doesNotMatch(open, /renderUI\(\)/);
    assert.match(root, /isRestControlsOpen[\s\S]*renderRestControlsModal/);
  });

  test(`${product} rest modal toggles the authoritative timer and closes safely`, () => {
    const source = readProductSource(product);
    const modal = extractFunction(source, 'renderRestControlsModal');
    const close = extractFunction(source, 'closeRestControls');
    const toggleOwner = product === 'page' ? 'session' : 'workoutController';

    assert.match(modal, /addLiveLabel\('restModalValue'/);
    assert.match(modal, /addLiveButton\('restModalPause'/);
    assert.match(modal, /rest\.isPaused \? 'Resume' : 'Pause'/);
    assert.match(modal, new RegExp(`${toggleOwner}\\.toggleRestPause\\(\\)`));
    assert.match(modal, /click_func: closeRestControls/);
    assert.match(close, /isRestControlsOpen = false/);
    assert.match(close, /controllerUiDirty = true/);
    assert.doesNotMatch(close, /renderUI\(\)/);
  });
}
