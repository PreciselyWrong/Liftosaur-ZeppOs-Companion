import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  TYPOGRAPHY,
  ACTIVE_SET_LAYOUT,
  activeSetLayout,
  shouldShowRpe,
  LIST_PAGE_SIZE,
  OVERVIEW_PAGE_SIZE,
  READY_PREVIEW_SIZE,
} from '../shared/watch-layout.js';

const root = process.cwd();

test('every typography role is readable at physical watch size', () => {
  assert.equal(Math.min(...Object.values(TYPOGRAPHY)), 18);
  assert.ok(TYPOGRAPHY.title > TYPOGRAPHY.body);
  assert.ok(TYPOGRAPHY.value > TYPOGRAPHY.button);
  assert.ok(TYPOGRAPHY.timer > TYPOGRAPHY.value);
});

test('the watch renderer uses semantic typography instead of local sizes', () => {
  const source = fs.readFileSync(
    path.join(root, 'page', 'common', 'index.js'),
    'utf8',
  );
  assert.doesNotMatch(source, /text_size:\s*px\(/);
  assert.match(source, /text_size:\s*font\('/);
});

test('the phone settings page has no tiny text', () => {
  const source = fs.readFileSync(
    path.join(root, 'setting', 'index.js'),
    'utf8',
  );
  const sizes = [...source.matchAll(/fontSize:\s*'(\d+)px'/g)].map((match) => Number(match[1]));
  assert.ok(sizes.length > 0);
  assert.ok(Math.min(...sizes) >= 15);
});

test('dense screens show fewer readable rows instead of shrinking text', () => {
  assert.equal(LIST_PAGE_SIZE, 3);
  assert.equal(OVERVIEW_PAGE_SIZE, 3);
  assert.equal(READY_PREVIEW_SIZE, 3);
});

test('RPE is shown only when the current set asks for it', () => {
  assert.equal(shouldShowRpe({ targetRpe: 8 }), true);
  assert.equal(shouldShowRpe({ targetRpe: 0 }), true);
  assert.equal(shouldShowRpe({ targetRpe: null }), false);
  assert.equal(shouldShowRpe({}), false);
});

test('sets without RPE get two larger controls and a larger action', () => {
  const compact = activeSetLayout({ targetRpe: null });
  assert.equal(compact.showRpe, false);
  assert.deepEqual(compact.rows.map((row) => row.key), ['weight', 'reps']);
  assert.ok(compact.rowHeight > ACTIVE_SET_LAYOUT.withRpe.rowHeight);
  assert.ok(compact.actionHeight > ACTIVE_SET_LAYOUT.withRpe.actionHeight);
});

test('sets with RPE keep all three controls inside the design box', () => {
  const layout = activeSetLayout({ targetRpe: 8 });
  assert.equal(layout.showRpe, true);
  assert.deepEqual(layout.rows.map((row) => row.key), ['weight', 'reps', 'rpe']);
  assert.ok(layout.actionY + layout.actionHeight <= 440);
});
