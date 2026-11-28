/**
 * Screen layout adapter.
 *
 * Every screen in `page/common/index.js` is authored against the round 480x480
 * canvas of the Amazfit Active 2, inside the circular safe area
 * `DESIGN_BOX`. `px()` already rescales that canvas for the other round
 * resolutions, so round watches need no adaptation at all and get the identity
 * transform: the square support below cannot regress them.
 *
 * A square watch (Amazfit Bip 6, Cheetah Square: `st: "s"`, 390x450) has no
 * corner clipping and is taller than it is wide, so the circular safe area
 * wastes both edges. `fit()` maps the design box onto the real screen with a
 * single uniform scale, applied to positions and to sizes alike. Because it is
 * a plain zoom, every relative distance is preserved: a label that fitted its
 * card on the round watch still fits it here.
 */

/** The canvas every screen is authored against. */
export const DESIGN_CANVAS = 480;

/**
 * Bounding box of all drawn widgets in that canvas, background fill aside.
 *
 * The last 20 rows are the clock line drawn under the bottom button of every
 * screen. They belong to the box even though only one small label lives there:
 * on a square watch the fit is height bound, so a row left out of the box is a
 * row drawn past the bottom edge.
 */
export const DESIGN_BOX = { x: 40, y: 38, w: 400, h: 424 };

/** Breathing room kept against the bezel, in device pixels. */
const MARGIN_X = 6;
const MARGIN_BOTTOM = 10;

/**
 * Top band left free on a square screen, as a fraction of the panel height.
 * The system status bar carrying the app name is drawn over the page there.
 * `hmUI.setStatusBarVisible(false)` removes it, but the call is only
 * documented, not guaranteed on every firmware, so the layout also keeps out
 * of its way: a covered button is a broken app, a slightly shorter one is not.
 * 0.14 is 63 device pixels on the 390x450 Bip 6.
 */
const TOP_INSET_RATIO = 0.14;

/** Widget properties expressed in pixels, so scaled with the layout. */
const SCALED_KEYS = ['w', 'h', 'radius', 'text_size', 'text_w', 'text_h', 'line_space', 'char_space'];

/**
 * `isRound` is resolved by the caller against `SCREEN_SHAPE_ROUND`, since
 * `@zeppos/device-types` types the shape constants as bare numbers and their
 * values are not documented. When it cannot be resolved, only a strictly
 * square canvas counts as round: that is the geometry the screens were drawn
 * for, so the unknown case keeps the current rendering.
 *
 * @param {{ width?: number, height?: number, isRound?: boolean }} deviceInfo
 * @returns {{ width: number, height: number, isFitted: boolean, scale: number, fit: (props: object) => object }}
 * @throws {TypeError} when the device did not report valid screen dimensions
 */
export function createScreenLayout(deviceInfo = {}) {
  const { width, height, isRound } = deviceInfo;

  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new TypeError('Device width and height are required');
  }

  const identity = {
    width,
    height,
    isFitted: false,
    scale: 1,
    fit: (props) => props,
  };

  if (isRound === undefined ? width === height : isRound) return identity;

  // The incoming props are already device pixels: `px()` mapped the 480 canvas
  // onto the real width before they reached us.
  const base = width / DESIGN_CANVAS;
  const boxX = DESIGN_BOX.x * base;
  const boxY = DESIGN_BOX.y * base;
  const boxW = DESIGN_BOX.w * base;
  const boxH = DESIGN_BOX.h * base;

  // The usable band starts below the status bar and stops short of the chin.
  const insetTop = Math.round(height * TOP_INSET_RATIO);
  const bandTop = insetTop;
  const bandHeight = height - insetTop - MARGIN_BOTTOM;

  const scale = Math.min((width - 2 * MARGIN_X) / boxW, bandHeight / boxH);
  const offsetX = (width - boxW * scale) / 2 - boxX * scale;
  const offsetY = bandTop + (bandHeight - boxH * scale) / 2 - boxY * scale;

  const fit = (props) => {
    const out = {};
    for (const key in props) {
      const value = props[key];
      if (typeof value !== 'number') {
        out[key] = value;
      } else if (key === 'x') {
        out[key] = Math.round(value * scale + offsetX);
      } else if (key === 'y') {
        out[key] = Math.round(value * scale + offsetY);
      } else if (SCALED_KEYS.indexOf(key) !== -1) {
        out[key] = Math.max(1, Math.round(value * scale));
      } else {
        out[key] = value;
      }
    }
    return out;
  };

  return { width, height, isFitted: true, scale, insetTop, fit };
}

/**
 * Pairs the widgets a redraw would create (`next`) with those on screen (`current`), each a
 * `{ type, props, key }` spec in drawing order. Returns one `{ previous, next, changes }` per widget,
 * `changes` holding the values to set in place, or null when anything else differs: a widget added,
 * removed, reordered, moved or restyled needs a full rebuild. `mutable` lists, per widget type, the
 * props an in-place update may change. A keyed spec is a transparent label: it pairs by key, because
 * its only safe update (a replacement: TEXT does not repaint after setProperty) moves it to the top,
 * and only its text and color may change. Handlers are compared by presence, not identity.
 */
export function pairWidgetSpecs(current, next, mutable) {
  if (current.length !== next.length) return null;
  const labels = new Map();
  const solid = [];
  for (const spec of current) {
    if (spec.key) labels.set(spec.key, spec);
    else solid.push(spec);
  }
  const pairs = [];
  let index = 0;
  for (const spec of next) {
    const previous = spec.key ? labels.get(spec.key) : solid[index++];
    if (!previous || previous.type !== spec.type || previous.key !== spec.key) return null;
    labels.delete(spec.key);
    const allowed = spec.key ? ['text', 'color'] : mutable[spec.type] || [];
    const changes = {};
    for (const name of new Set([...Object.keys(previous.props), ...Object.keys(spec.props)])) {
      const before = previous.props[name];
      const after = spec.props[name];
      if (before === after || (typeof before === 'function' && typeof after === 'function')) continue;
      if (allowed.indexOf(name) === -1) return null;
      changes[name] = after;
    }
    pairs.push({ previous, next: spec, changes });
  }
  return pairs;
}
