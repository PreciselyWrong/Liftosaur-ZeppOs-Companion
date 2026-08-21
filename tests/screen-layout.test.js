/**
 * The square adaptation must never move a pixel on a round watch, and must
 * keep the design geometry proportional on a square one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createScreenLayout, DESIGN_BOX, DESIGN_CANVAS } from '../shared/screen-layout.js';

const ROUND_480 = { width: 480, height: 480, isRound: true };
const BIP_6 = { width: 390, height: 450, isRound: false };

test('a round screen gets the identity transform', () => {
  const layout = createScreenLayout(ROUND_480);
  assert.equal(layout.isFitted, false);
  const props = { x: 62, y: 100, w: 356, h: 88, radius: 22, text_size: 22, color: 0x8356f6 };
  assert.deepEqual(layout.fit(props), props);
  assert.equal(layout.fit(props), props, 'round must not even copy the props');
});

test('an unreported shape on a square canvas stays round', () => {
  assert.equal(createScreenLayout({ width: 480, height: 480 }).isFitted, false);
});

test('unknown device dimensions fail instead of inventing a screen size', () => {
  assert.throws(
    () => createScreenLayout({}),
    /Device width and height are required/,
  );
});

test('a square screen fits the design box inside the panel', () => {
  const layout = createScreenLayout(BIP_6);
  assert.equal(layout.isFitted, true);

  const base = BIP_6.width / DESIGN_CANVAS;
  const topLeft = layout.fit({ x: DESIGN_BOX.x * base, y: DESIGN_BOX.y * base });
  const bottomRight = layout.fit({
    x: (DESIGN_BOX.x + DESIGN_BOX.w) * base,
    y: (DESIGN_BOX.y + DESIGN_BOX.h) * base,
  });

  assert.ok(topLeft.x >= 0 && topLeft.y >= 0, `top left ${JSON.stringify(topLeft)} off screen`);
  assert.ok(bottomRight.x <= BIP_6.width, `right edge ${bottomRight.x} past ${BIP_6.width}`);
  assert.ok(bottomRight.y <= BIP_6.height, `bottom edge ${bottomRight.y} past ${BIP_6.height}`);
});

test('the clock row fits both panels', () => {
  // The clock is the bottom row of the design box: x 160..320, y 442..462.
  const box = { x: 160, y: 442, w: 160, h: 20 };
  assert.equal(DESIGN_BOX.y + DESIGN_BOX.h, box.y + box.h, 'the box must end on the clock row');

  // Round: the far corners of that row stay inside the 480 circle.
  const radius = DESIGN_CANVAS / 2;
  for (const x of [box.x, box.x + box.w]) {
    const dx = x - radius;
    const dy = box.y + box.h - radius;
    assert.ok(Math.sqrt(dx * dx + dy * dy) < radius, `clock corner ${x} clipped by the bezel`);
  }

  // Square: the fitted row stays above the bottom edge.
  const layout = createScreenLayout(BIP_6);
  const base = BIP_6.width / DESIGN_CANVAS;
  const fitted = layout.fit({ x: box.x * base, y: box.y * base, w: box.w * base, h: box.h * base });
  assert.ok(fitted.y + fitted.h <= BIP_6.height, `clock bottom ${fitted.y + fitted.h} past the panel`);
  assert.ok(fitted.x >= 0 && fitted.x + fitted.w <= BIP_6.width);
});

test('nothing is drawn under the square status bar', () => {
  const layout = createScreenLayout(BIP_6);
  const base = BIP_6.width / DESIGN_CANVAS;

  // The topmost widget of every screen is the title, at design y 38.
  const top = layout.fit({ y: DESIGN_BOX.y * base }).y;
  assert.ok(
    top >= layout.insetTop,
    `top widget at ${top} sits inside the ${layout.insetTop}px status bar band`,
  );
  assert.ok(layout.insetTop >= 48, 'the reserved band must clear a real status bar');
});

test('a square screen uses the width the round safe area left unused', () => {
  const layout = createScreenLayout(BIP_6);
  const base = BIP_6.width / DESIGN_CANVAS;
  const card = layout.fit({ x: 62 * base, w: 356 * base });
  assert.ok(card.w > 356 * base, 'the content column must grow, not shrink');
  assert.ok(card.x + card.w <= BIP_6.width);
  assert.ok(layout.scale > 1);
});

test('scaling is uniform, so a label keeps its place inside its card', () => {
  const layout = createScreenLayout(BIP_6);
  const card = layout.fit({ x: 62, y: 104, w: 356, h: 226 });
  const label = layout.fit({ x: 62, y: 104, w: 356, h: 40 });

  assert.equal(label.x, card.x);
  assert.equal(label.y, card.y);
  assert.equal(label.w, card.w);
  assert.ok(label.h < card.h);

  // Same ratio in and out: nothing that fitted on the round watch overflows.
  const ratio = layout.fit({ x: 0, w: 100 }).w / 100;
  assert.ok(Math.abs(ratio - layout.scale) < 0.02);
});

test('non numeric props and colors pass through untouched', () => {
  const layout = createScreenLayout(BIP_6);
  const onClick = () => {};
  const fitted = layout.fit({
    x: 62,
    y: 100,
    color: 0x8356f6,
    normal_color: 0x332d42,
    text: 'Squat',
    click_func: onClick,
  });
  assert.equal(fitted.color, 0x8356f6);
  assert.equal(fitted.normal_color, 0x332d42);
  assert.equal(fitted.text, 'Squat');
  assert.equal(fitted.click_func, onClick);
});

test('a text size never collapses to zero', () => {
  const layout = createScreenLayout({ width: 100, height: 200, isRound: false });
  assert.ok(layout.fit({ text_size: 1 }).text_size >= 1);
});

test('fitting a square screen never shrinks text a second time', () => {
  const layout = createScreenLayout(BIP_6);
  const deviceTextSize = 18;
  assert.ok(layout.fit({ text_size: deviceTextSize }).text_size >= deviceTextSize);
});
