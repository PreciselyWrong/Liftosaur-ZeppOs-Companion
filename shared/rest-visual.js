/**
 * Rest visual feedback: authoritative rest status predicates, inward gradient halo
 * geometry and darkening, and native breathing pulse animation controls.
 */

export const REST_HALO_CONFIG = {
  LAYER_COUNT: 5,
  BASE_DEPTH_DESIGN_PX: 12,
  DESIGN_SCREEN_WIDTH: 480,
  FADE_FACTORS: [1.0, 0.65, 0.40, 0.22, 0.10],
  ANIM_MIN_ALPHA: 210,
  ANIM_MAX_ALPHA: 255,
  ANIM_DURATION_MS: 2000,
  ANIM_FPS: 20,
};

/**
 * Returns true only when rest is active, rest ring is present, and status is running
 * (neither paused nor overtime), so the ring is actually presented in purple.
 */
export function isPurpleRestRing({ isResting, rest, hasRing = true } = {}) {
  if (!isResting || !hasRing || !rest) return false;
  if (rest.isPaused || rest.isOvertime) return false;
  return true;
}

/** The gap in the rest arc grows clockwise from 12 o'clock. */
export function getRestRingStartAngle(rest) {
  const duration = Number(rest?.duration);
  const remaining = Number(rest?.remaining);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(remaining)) return -90;
  return 270 - 360 * Math.max(0, Math.min(1, remaining / duration));
}

/**
 * Gating changed-field text color: purple only at same time as purple rest perimeter ring.
 * When ring is absent or non-purple (paused, overtime, or inactive), returns normal text color.
 */
export function getChangedFieldTextColor({
  isChanged,
  isResting,
  rest,
  hasRing = true,
  primaryColor,
  normalColor,
}) {
  if (isChanged && isPurpleRestRing({ isResting, rest, hasRing })) {
    return primaryColor;
  }
  return normalColor;
}

/**
 * Darkens a 24-bit RGB color toward black by a float factor [0..1].
 */
export function darkenColor(color, factor) {
  if (factor >= 1) return color;
  if (factor <= 0) return 0;
  const r = Math.min(255, Math.max(0, Math.round(((color >> 16) & 0xff) * factor)));
  const g = Math.min(255, Math.max(0, Math.round(((color >> 8) & 0xff) * factor)));
  const b = Math.min(255, Math.max(0, Math.round((color & 0xff) * factor)));
  return (r << 16) | (g << 8) | b;
}

/**
 * Creates concentric raw geometry for 5 halo stroke rect layers, bounded to ~12 design px
 * inward depth proportional to screen width. Preserves round and fitted rectangular shapes.
 */
export function createRestHaloLayers({ width, height, isFitted }) {
  const depth = Math.max(6, Math.round(width * (REST_HALO_CONFIG.BASE_DEPTH_DESIGN_PX / REST_HALO_CONFIG.DESIGN_SCREEN_WIDTH)));
  const outerRadius = isFitted ? Math.round(width * 0.12) : Math.round(width / 2);
  const outerLineWidth = Math.max(4, Math.round(width * 0.014));
  const innerLineWidth = Math.max(2, Math.round(width * 0.006));
  const count = REST_HALO_CONFIG.LAYER_COUNT;

  const layers = [];
  for (let i = 0; i < count; i++) {
    const inset = Math.round(2 + (i * (depth / (count - 1))));
    const w = width - 2 * inset;
    const h = height - 2 * inset;
    const radius = isFitted
      ? Math.max(0, Math.round(outerRadius - (inset - 2)))
      : Math.round(w / 2);
    const lineWidth = i === 0 ? outerLineWidth : innerLineWidth;
    const factor = REST_HALO_CONFIG.FADE_FACTORS[i];

    layers.push({
      index: i,
      x: inset,
      y: inset,
      w,
      h,
      radius,
      line_width: lineWidth,
      factor,
    });
  }
  return { depth, layers };
}

/**
 * Native widget animation configuration for gentle breathing cycle (~4s, 210..255 opacity).
 * https://docs.zepp.com/docs/reference/device-app-api/newAPI/ui/widgetAnimations/
 */
export function createRestPulseAnimationParams(prop) {
  const alphaProp = prop.ALPHA;
  return {
    anim_steps: [
      {
        anim_prop: alphaProp,
        anim_from: REST_HALO_CONFIG.ANIM_MAX_ALPHA,
        anim_to: REST_HALO_CONFIG.ANIM_MIN_ALPHA,
        anim_duration: REST_HALO_CONFIG.ANIM_DURATION_MS,
        anim_rate: 'easeinout',
        anim_offset: 0,
      },
      {
        anim_prop: alphaProp,
        anim_from: REST_HALO_CONFIG.ANIM_MIN_ALPHA,
        anim_to: REST_HALO_CONFIG.ANIM_MAX_ALPHA,
        anim_duration: REST_HALO_CONFIG.ANIM_DURATION_MS,
        anim_rate: 'easeinout',
        anim_offset: REST_HALO_CONFIG.ANIM_DURATION_MS,
      },
    ],
    anim_fps: REST_HALO_CONFIG.ANIM_FPS,
    anim_repeat: -1,
  };
}

/**
 * Starts pulse animation on native widgets. Returns array of animation IDs.
 */
export function startRestPulseAnimation(widgets, prop) {
  if (prop?.ANIM === undefined || prop?.ALPHA === undefined) return [];
  const animIds = [];
  const params = createRestPulseAnimationParams(prop);
  for (const w of widgets) {
    if (w && typeof w.setProperty === 'function') {
      try {
        const id = w.setProperty(prop.ANIM, params);
        if (id !== undefined && id !== null) animIds.push({ widget: w, id });
      } catch (err) {
        console.log('[lifto] rest pulse unavailable');
      }
    }
  }
  return animIds;
}

/**
 * Stops pulse animations and restores full alpha.
 */
export function stopRestPulseAnimation(animHandles, prop, anim_status) {
  if (!Array.isArray(animHandles)) return;
  for (const handle of animHandles) {
    const { widget, id } = handle || {};
    if (widget && typeof widget.setProperty === 'function') {
      try {
        if (prop?.ANIM_STATUS !== undefined && anim_status?.STOP !== undefined) {
          widget.setProperty(prop.ANIM_STATUS, { anim_id: id, anim_status: anim_status.STOP });
        }
      } catch (err) { console.log('[lifto] rest pulse cleanup unavailable'); }
      try {
        if (prop?.ALPHA !== undefined) {
          widget.setProperty(prop.ALPHA, 255);
        }
      } catch (err) { console.log('[lifto] rest pulse cleanup unavailable'); }
    }
  }
}
