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

/** Bounding box of all drawn widgets in that canvas, background fill aside. */
export const DESIGN_BOX = { x: 40, y: 38, w: 400, h: 404 };

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
const SCALED_KEYS = ['w', 'h', 'radius', 'text_size', 'line_space', 'char_space'];

/**
 * `isRound` is resolved by the caller against `SCREEN_SHAPE_ROUND`, since
 * `@zeppos/device-types` types the shape constants as bare numbers and their
 * values are not documented. When it cannot be resolved, only a strictly
 * square canvas counts as round: that is the geometry the screens were drawn
 * for, so the unknown case keeps the current rendering.
 *
 * @param {{ width?: number, height?: number, isRound?: boolean }} deviceInfo
 * @returns {{ width: number, height: number, isFitted: boolean, scale: number, fit: (props: object) => object }}
 */
export function createScreenLayout(deviceInfo = {}) {
  const { width, height, isRound } = deviceInfo;

  const identity = {
    width: width > 0 ? width : DESIGN_CANVAS,
    height: height > 0 ? height : DESIGN_CANVAS,
    isFitted: false,
    scale: 1,
    fit: (props) => props,
  };

  if (!(width > 0) || !(height > 0)) return identity;
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
