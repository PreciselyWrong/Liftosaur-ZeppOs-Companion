/**
 * Loadable weight resolution.
 *
 * Liftoscript expresses warmups as percentages of the working weight
 * (`warmup: 1x8 40%`). Turning one into a number the user can actually load
 * needs the gym's equipment: the bar, the plates on hand, and how many of each.
 *
 * Behaviour was established against real `GET /history` records rather than
 * from the source description, which says "nearest". It is not nearest — it is
 * the largest achievable load **at or below** the target:
 *
 *   85% of 87.5kg = 74.375  -> 72.5, not 75   (barbell, 20kg bar)
 *   60% of 90kg   = 54      -> 52.5, not 55   (cable, 5kg bar)
 *
 * Both would round up under nearest-neighbour. See `tests/weight-rounding.test.js`,
 * which pins those cases.
 *
 * When the equipment is unknown the target is returned untouched and the caller
 * is told so, because showing an unloadable number is worse than showing none.
 */

/** `"52.5kg"` -> `{ value: 52.5, unit: 'kg' }`. Bare numbers take the fallback unit. */
export function parseWeightString(raw, fallbackUnit = 'kg') {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { value: raw, unit: fallbackUnit } : null;
  }
  const match = String(raw).trim().match(/^(-?[0-9]*\.?[0-9]+)\s*(kg|lb|lbs)?$/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2] ? (match[2].toLowerCase() === 'lbs' ? 'lb' : match[2].toLowerCase()) : fallbackUnit;
  return { value, unit };
}

/** Floating point sums of 1.25 and 2.5 need a leash. */
function round5(value) {
  return Math.round(value * 100000) / 100000;
}

/**
 * Plates usable in this unit, one entry per *pair* when the multiplier is 2.
 * `num` is the total count on hand, so a barbell with `num: 2` can take one
 * plate per side, not two.
 */
function usablePlates(equipment, unit) {
  const multiplier = equipment.multiplier || 1;
  const plates = [];

  for (const plate of equipment.plates || []) {
    const parsed = parseWeightString(plate.weight, unit);
    if (!parsed || parsed.unit !== unit || parsed.value <= 0) continue;

    const groups = Math.floor((plate.num || 0) / multiplier);
    for (let i = 0; i < groups; i++) {
      plates.push(round5(parsed.value * multiplier));
    }
  }

  return plates.sort((a, b) => b - a);
}

/**
 * Largest subset sum of `plates` that does not exceed `capacity`.
 *
 * Exhaustive over distinct values with their available counts, so it does not
 * miss a combination the way a plain greedy fill would.
 */
function bestFill(plates, capacity) {
  let best = 0;
  const reachable = new Set([0]);

  for (const plate of plates) {
    const additions = [];
    for (const total of reachable) {
      const next = round5(total + plate);
      if (next <= capacity + 1e-9 && !reachable.has(next)) {
        additions.push(next);
        if (next > best) best = next;
      }
    }
    for (const value of additions) reachable.add(value);
  }

  return best;
}

/**
 * @param {number} target        weight asked for, in `unit`
 * @param {object|null} equipment  one entry of `GET /gyms/:id/equipment`
 * @param {string} unit          'kg' or 'lb'
 * @returns {{value: number, exact: boolean, resolved: boolean}}
 *          `resolved: false` means the equipment could not answer, so `value`
 *          is the untouched target and the caller must not present it as loadable.
 */
export function roundToLoadable(target, equipment, unit = 'kg') {
  if (!Number.isFinite(target) || target < 0) {
    return { value: target, exact: false, resolved: false };
  }
  if (!equipment) {
    return { value: target, exact: false, resolved: false };
  }

  // Fixed equipment — dumbbells, kettlebells — is picked from a list, not built.
  if (equipment.isFixed) {
    const fixed = (equipment.fixed || [])
      .map((entry) => parseWeightString(entry, unit))
      .filter((parsed) => parsed && parsed.unit === unit)
      .map((parsed) => parsed.value)
      .sort((a, b) => a - b);

    if (fixed.length === 0) {
      return { value: target, exact: false, resolved: false };
    }

    let chosen = fixed[0];
    for (const weight of fixed) {
      if (weight <= target + 1e-9) chosen = weight;
    }
    return { value: round5(chosen), exact: Math.abs(chosen - target) < 1e-9, resolved: true };
  }

  const bar = parseWeightString(equipment.bar?.[unit], unit);
  const barWeight = bar ? bar.value : 0;

  if (target <= barWeight + 1e-9) {
    return { value: round5(barWeight), exact: Math.abs(barWeight - target) < 1e-9, resolved: true };
  }

  const plates = usablePlates(equipment, unit);
  if (plates.length === 0) {
    return { value: round5(barWeight), exact: Math.abs(barWeight - target) < 1e-9, resolved: true };
  }

  const total = round5(barWeight + bestFill(plates, target - barWeight));
  return { value: total, exact: Math.abs(total - target) < 1e-9, resolved: true };
}

/**
 * Resolves the equipment id an exercise uses.
 *
 * `GET /exercise-data` maps equipment per gym, so the current gym wins, then
 * the `default` entry. Failing both, the exercise key carries it as a suffix
 * (`latPulldown_cable`), and the Liftohistory line names it after the comma
 * (`Face Pull, Cable`).
 */
export function resolveEquipmentId({ exerciseData = null, exerciseKey = null, equipmentName = null, currentGymId = null } = {}) {
  const mapping = exerciseData?.equipment;
  if (mapping) {
    if (currentGymId && mapping[currentGymId]) return mapping[currentGymId];
    if (mapping.default) return mapping.default;
  }

  if (exerciseKey && exerciseKey.includes('_')) {
    return exerciseKey.slice(exerciseKey.indexOf('_') + 1);
  }

  if (equipmentName) {
    // "Cable" -> "cable", "Leverage Machine" -> "leverageMachine"
    const words = String(equipmentName).trim().split(/\s+/);
    return words
      .map((word, i) =>
        i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      )
      .join('');
  }

  return null;
}
